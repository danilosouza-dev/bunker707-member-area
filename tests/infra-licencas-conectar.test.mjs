import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { cloudDir, criarInfraDeMentira as setup, faltamBinarios, limparInfraDeMentira, oldImage, record, serverFixture } from "./fixtures/infra-de-mentira.mjs";
import { apiInternaFalsa } from "./support/emissor-interno-falso.mjs";

// A etapa conectar-licencas (infra/cloud/licencas.sh conectar; docs/20 §8C.9): a nossa escola (bunker707-membros) ligada a
// API interna do Emissor sem ninguem colar segredo. Roda de verdade contra a Hetzner, a Cloudflare e os dois servidores de
// mentira de tests/fixtures/infra-de-mentira.mjs; a credencial e sorteada pelo infra/cloud/credencial-interna.mjs de
// verdade, e a conferencia de dentro do app (infra/cloud/conferir-interno.mjs) roda contra a API interna falsa de
// tests/support/emissor-interno-falso.mjs. O que roda no servidor do Emissor (credencial-interna.sh) esta em
// tests/infra-licencas-servidor.test.mjs. Nada fala com a rede.

after(limparInfraDeMentira);

const skip = faltamBinarios.length ? `faltam ${faltamBinarios.join(", ")}` : false;
const root = fileURLToPath(new URL("..", import.meta.url));
const IP_EMISSOR = "192.0.2.7";
const IP_ESCOLA = "192.0.2.1";
const PAINEL = "licencas.bunker707.com.br";
const API = "licencas-api.bunker707.com.br";
const INTERNO = "licencas-interno.bunker707.com.br";
const DNS_CERTO = [record(PAINEL, "A", IP_EMISSOR, true), record(API, "A", IP_EMISSOR, false), record(INTERNO, "A", IP_EMISSOR, false)];
const CHECK = "exec -T app node -";
const KV = "cat > /tmp/conectar-licencas.kv";
const EMISSOR_GRAVA = "bash infra/licencas/scripts/credencial-interna.sh";
const resumoDe = (credencial) => createHash("sha256").update(`bunker-licensing/interno:${credencial}`, "utf8").digest("hex");

const conta = (extra = {}) =>
  setup({
    servers: [serverFixture("bunker707-licencas", "licencas", 7), serverFixture("bunker707-membros", "membros", 1)],
    firewalls: ["bunker707-licencas", "bunker707-membros"].map((s) => ({ name: `${s}-fw`, applied_to: [], rules: [] })),
    records: DNS_CERTO,
    ...extra
  });
// A conferencia de dentro do app responde o que o teste escolhe (a linha que o conferir-interno.mjs imprime).
const rodar = (c, env = {}) =>
  c.runScript("licencas.sh", {
    CONFIRMAR: "conectar",
    SSH_SHIM_STDIN_COMPLETO: `${KV}|${EMISSOR_GRAVA}`,
    SSH_SHIM_REPLIES: JSON.stringify([{ contem: CHECK, saida: "200 planos=2\n" }]),
    CONFERIR_ESPERA: "0",
    ...env
  }, ["conectar"]);
const ssh = (c) => c.calls().filter((x) => x.tool === "ssh" && !x.control);
const naEscola = (c) => ssh(c).filter((x) => x.target === `deploy@${IP_ESCOLA}`);
const noEmissor = (c) => ssh(c).filter((x) => x.target === `deploy@${IP_EMISSOR}`);
const credencialDe = (kv) => /^EMISSOR_INTERNO_CREDENCIAL=(.*)$/m.exec(kv)?.[1];
const gravadosNoCaddy = (c) =>
  Object.fromEntries(noEmissor(c).filter((x) => x.command.startsWith("python3 -I - '/opt/bunker707/infra/licencas/.env'")).map((x) => {
    const [, chave, b64] = x.command.match(/'\/opt\/bunker707\/infra\/licencas\/\.env' '([A-Z_]+)' '([^']*)'/);
    return [chave, Buffer.from(b64, "base64").toString()];
  }));

test("credencial-interna.mjs: o formato e o resumo do Emissor (vetor tirado do src/interno/credential.ts dele), arquivos 0600 e nada na saida", async () => {
  const modulo = await import(new URL("../infra/cloud/credencial-interna.mjs", import.meta.url));
  // Vetor do contrato: calculado com internalCredentialHash do bunker-licensing (commit 5811308) em 11/11/2026.
  assert.equal(modulo.resumoDaCredencial("bki_AAAAAAAAAAbbbbbbbbbb-_0123456789xyzXYZ0123k"), "bf4d7d1945f572e0ad4a2c02ebca4983f7885c8d56ecacdb2f8a951a9f497b06");
  assert.throws(() => modulo.resumoDaCredencial("bki_curta"), /fora do formato/);
  assert.match(modulo.novaCredencial(), modulo.PADRAO_CREDENCIAL);

  const dir = mkdtempSync(join(tmpdir(), "bunker707-credencial-"));
  try {
    const gerar = (n) => spawnSync(process.execPath, [join(cloudDir, "credencial-interna.mjs"), "--credencial", join(dir, `c${n}`), "--resumo", join(dir, `r${n}`)], { encoding: "utf8" });
    const a = gerar(1);
    const b = gerar(2);
    assert.equal(a.status, 0, a.stderr);
    assert.equal(a.stdout + a.stderr + b.stdout + b.stderr, "", "nada na saida: nem a credencial, nem o resumo");
    const c1 = readFileSync(join(dir, "c1"), "utf8");
    assert.match(c1, /^bki_[A-Za-z0-9_-]{43}$/);
    assert.equal(readFileSync(join(dir, "r1"), "utf8"), `${resumoDe(c1)}\n`);
    for (const f of ["c1", "r1"]) assert.equal(statSync(join(dir, f)).mode & 0o777, 0o600, f);
    assert.notEqual(readFileSync(join(dir, "c2"), "utf8"), c1, "cada rodada sorteia outra");
    assert.equal(spawnSync(process.execPath, [join(cloudDir, "credencial-interna.mjs")], { encoding: "utf8" }).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("conferir-interno.mjs: com a credencial e o X-Pedido, pela entrada do node como no container; imprime so o codigo e o detalhe, nunca a credencial", async () => {
  const credencial = "bki_credencial-da-conferencia-0123456789abcdefghijkl";
  const falso = await apiInternaFalsa({ simulador: null, credencial });
  try {
    const programa = readFileSync(join(cloudDir, "conferir-interno.mjs"), "utf8");
    // Como no container: `node - <X-Pedido>`, o programa pela entrada, o endereco e a credencial do ambiente do app. Sem
    // spawnSync: a API falsa roda neste processo e precisa do laco de eventos livre para responder.
    const conferir = (env) =>
      new Promise((resolve) => {
        const filho = spawn(process.execPath, ["-", "conectar-licencas-20261111T120000Z-1"], { env: { PATH: process.env.PATH, ...env } });
        let stdout = "";
        let stderr = "";
        filho.stdout.on("data", (parte) => (stdout += parte));
        filho.stderr.on("data", (parte) => (stderr += parte));
        filho.on("close", (status) => resolve({ status, stdout, stderr }));
        filho.stdin.end(programa);
      });
    const env = { EMISSOR_INTERNO_URL: `${falso.endereco}/`, EMISSOR_INTERNO_CREDENCIAL: credencial };

    falso.proximas.push({ caminho: "/interno/v1/planos", status: 200, corpo: { planos: [{ produto: "1" }, { produto: "2" }] } });
    const ok = await conferir(env);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout, "200 planos=2\n");
    const pedido = falso.pedidos.at(-1);
    assert.deepEqual([pedido.metodo, pedido.caminho, pedido.credencialCerta, pedido.xPedido], ["GET", "/interno/v1/planos", true, "conectar-licencas-20261111T120000Z-1"]);

    const errada = await conferir({ ...env, EMISSOR_INTERNO_CREDENCIAL: "bki_outra-credencial-0123456789abcdefghijklmnopq" });
    assert.equal(errada.stdout, "401 credencial_invalida\n");
    falso.proximas.push({ caminho: "/interno/v1/planos", status: 403, texto: "" });
    assert.equal((await conferir(env)).stdout, "403 -\n", "o 403 do Caddy, sem corpo");
    assert.equal((await conferir({})).stdout, "000 sem_configuracao\n");
    for (const r of [ok, errada]) assert.ok(!(r.stdout + r.stderr).includes(credencial), "a credencial nunca na saida");
  } finally {
    await falso.fechar();
  }
});

test("conectar-licencas sem CONFIRMAR=conectar, com REVOGAR_ANTERIORES fora do formato ou fora da main recusa antes de qualquer chamada", { skip }, () => {
  const c = conta();
  const sem = c.runScript("licencas.sh", {}, ["conectar"]);
  assert.equal(sem.status, 1);
  assert.match(sem.stderr, /Confirme com CONFIRMAR=conectar nas opcoes/);
  const revogar = c.runScript("licencas.sh", { CONFIRMAR: "conectar", REVOGAR_ANTERIORES: "talvez" }, ["conectar"]);
  assert.match(revogar.stderr, /REVOGAR_ANTERIORES so aceita sim/);
  const dev = c.runScript("licencas.sh", { CONFIRMAR: "conectar", GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/dev" }, ["conectar"]);
  assert.equal(dev.status, 1);
  assert.match(dev.stderr, /As etapas que mudam o servidor de licencas so rodam da main \(recebido: refs\/heads\/dev\)/);
  const runDev = c.runScript("run.sh", { OPCOES: "CONFIRMAR=conectar", GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/dev" }, ["conectar-licencas"]);
  assert.equal(runDev.status, 1, "pelo run.sh tambem");
  assert.deepEqual(c.calls(), [], "nada chamado");

  // O workflow: a etapa existe, passa pela trava "Licencas so da main" e precisa do token da Cloudflare (o DNS e conferido).
  const workflow = readFileSync(join(root, ".github/workflows/infra.yml"), "utf8");
  assert.match(workflow, /^ {10}- conectar-licencas$/m);
  const trava = workflow.match(/- name: Licencas so da main\n\s+if: (.+)\n\s+run: \|\n\s+(.+)\n/);
  const roda = (ref) => spawnSync("bash", ["-e", "-c", trava[2]], { encoding: "utf8", env: { ...process.env, ETAPA: "conectar-licencas", GITHUB_REF: ref } });
  assert.equal(trava[1], "endsWith(inputs.etapa, '-licencas')");
  assert.equal(roda("refs/heads/main").status, 0);
  assert.equal(roda("refs/heads/dev").status, 1);
  assert.match(workflow, /case "\$ETAPA" in dns-licencas\|deploy-licencas\|conectar-licencas\) \[ -n "\$CLOUDFLARE_API_TOKEN" \]/);
});

test("conectar-licencas: o resumo so no Emissor, a credencial so na escola (0600, dono deploy, como o secrets-membros), o Caddy so para o IPv4 da escola e a conferencia de dentro do app", { skip }, () => {
  const c = conta();
  const r = rodar(c);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const emissor = noEmissor(c);
  const escola = naEscola(c);

  // A credencial: so na entrada do SSH da escola, no formato do Emissor; o resumo dela, so na entrada do Emissor.
  const kv = escola.find((x) => x.command.includes(KV));
  assert.ok(kv, "a credencial vai pela entrada do SSH");
  const credencial = credencialDe(kv.stdin);
  assert.match(credencial, /^bki_[A-Za-z0-9_-]{43}$/);
  assert.match(kv.stdin, /^EMISSOR_INTERNO_URL=https:\/\/licencas-interno\.bunker707\.com\.br\nEMISSOR_INTERNO_CREDENCIAL=bki_/);
  assert.match(kv.command, /^umask 077 && cat > \/tmp\/conectar-licencas\.kv$/);
  const grava = emissor.find((x) => x.command === `cd '/opt/bunker707' && ${EMISSOR_GRAVA}`);
  assert.ok(grava, "o Emissor recebe o resumo pelo script dele, sem opcao");
  assert.equal(grava.stdin, `${resumoDe(credencial)}\n`, "so o resumo da credencial sorteada");
  const tudoNoEmissor = emissor.map((x) => `${x.command}\n${x.stdin}`).join("\n");
  assert.ok(!tudoNoEmissor.includes(credencial), "a credencial nunca vai ao servidor do Emissor");
  assert.ok(!escola.map((x) => `${x.command}\n${x.stdin}`).join("\n").includes(resumoDe(credencial)), "o resumo nao vai a escola");

  // Nunca no registro nem em linha de comando (nem em base64).
  const b64 = Buffer.from(credencial).toString("base64");
  for (const pedaco of [credencial, credencial.slice(4), b64]) {
    assert.ok(!(r.stdout + r.stderr).includes(pedaco), "nada da credencial no registro");
    assert.ok(!ssh(c).some((x) => x.command.includes(pedaco)), "nada da credencial em linha de comando");
  }
  assert.ok(!(r.stdout + r.stderr).includes(resumoDe(credencial)), "nem o resumo inteiro no registro");
  assert.match(r.stdout, new RegExp(`resumo ${resumoDe(credencial).slice(0, 8)}\\.\\.\\.: a credencial so vai para a escola`));

  // O .env da escola: o mesmo programa do secrets-membros (env_aplicar_kv), no .env do compose, e o app recriado com o smoke.
  const aplica = escola.findIndex((x) => x.command === "python3 -I - '/opt/bunker707/infra/compose/.env' '/tmp/conectar-licencas.kv'");
  assert.ok(aplica >= 0, "o env_aplicar_kv de lib.sh");
  const lib = readFileSync(join(cloudDir, "lib.sh"), "utf8");
  const programa = lib.slice(lib.indexOf("\n", lib.indexOf("python3 -I - '$2' '$3'\" <<'PY'", lib.indexOf("env_aplicar_kv() {"))) + 1, lib.indexOf("\nPY\n", lib.indexOf("env_aplicar_kv() {")));
  assert.equal(escola[aplica].stdin, programa.slice(0, 80), "o programa vai pela entrada");
  assert.ok(escola.some((x) => x.command === "stat -c '  %n %U %a' '/opt/bunker707/infra/compose/.env'"), "o dono e o modo aparecem no registro");
  const recria = escola.findIndex((x) => x.command.includes("docker compose -f infra/compose/docker-compose.yml up -d && bash -c '. infra/scripts/lib.sh; for s in auth app; do wait_healthy $s 180; done' && bash infra/scripts/smoke.sh"));
  const confere = escola.findIndex((x) => x.command.includes(CHECK));
  assert.ok(escola.findIndex((x) => x.command.includes(KV)) < aplica && aplica < recria && recria < confere, "grava, recria e so entao confere");
  assert.match(escola[confere].command, /^cd '\/opt\/bunker707' && docker compose -f infra\/compose\/docker-compose\.yml exec -T app node - 'conectar-licencas-\d{8}T\d{6}Z-1'$/);
  assert.equal(escola[confere].stdin, readFileSync(join(cloudDir, "conferir-interno.mjs"), "utf8").slice(0, 80), "o programa da conferencia pela entrada");

  // A ordem: antes de mudar qualquer coisa, os dois servidores conferidos; o Emissor aceita a nova antes de a escola usar.
  const tudo = ssh(c);
  const at = (piece, target) => tudo.findIndex((x) => x.command.includes(piece) && (!target || x.target === target));
  const conferirEmissor = at("credencial-interna.sh --conferir");
  const composeEscola = at("grep -q 'EMISSOR_INTERNO_CREDENCIAL' '/opt/bunker707/infra/compose/docker-compose.yml'");
  const resumoNoEmissor = tudo.findIndex((x) => x.command === `cd '/opt/bunker707' && ${EMISSOR_GRAVA}`);
  const caddy = at("docker compose -f infra/licencas/docker-compose.yml pull --quiet");
  const credNaEscola = at(KV);
  assert.ok(conferirEmissor >= 0 && conferirEmissor < composeEscola && composeEscola < resumoNoEmissor && resumoNoEmissor < caddy && caddy < credNaEscola, `ordem: ${[conferirEmissor, composeEscola, resumoNoEmissor, caddy, credNaEscola]}`);
  assert.ok(at("tar -x -C '/opt/bunker707'", `deploy@${IP_EMISSOR}`) < conferirEmissor, "a infra do commit no Emissor antes de rodar o script dele");
  assert.ok(!naEscola(c).some((x) => x.command.includes("tar -x")), "nada do repositorio vai a escola por aqui");

  // O Caddy do endereco interno: so o IPv4 de agora da escola, a porta do .env do Emissor e o nome.
  const caddyEnv = gravadosNoCaddy(c);
  assert.equal(caddyEnv.LICENCAS_INTERNO_IPS, `${IP_ESCOLA}/32`);
  assert.equal(caddyEnv.LICENCAS_INTERNO_DOMAIN, INTERNO);
  assert.equal(caddyEnv.INTERNO_PORTA_NO_HOST, "8082");
  assert.match(tudo[caddy].command, /caddy validate --config \/etc\/caddy\/Caddyfile --adapter caddyfile && .* up -d && .*caddy reload/);

  // O fim: a 22 fechada nos dois, a pasta da credencial apagada do runner, e o resumo do que ficou.
  for (const fw of c.hz().firewalls) assert.ok(!fw.rules.some((x) => x.port === "22"), `${fw.name}: a 22 termina fechada`);
  assert.equal(existsSync(join(c.work, "bunker707-cloud", "conectar")), false, "a credencial nao fica no runner");
  assert.match(r.stdout, /GET https:\/\/licencas-interno\.bunker707\.com\.br\/interno\/v1\/planos de dentro do app da escola: 200 planos=2/);
  assert.match(r.stdout, /A nossa escola fala com o Emissor: https:\/\/licencas-interno\.bunker707\.com\.br, so do IPv4 192\.0\.2\.1 do servidor dela, com a credencial nova \(planos=2 no mapa de produtos\)/);
  assert.match(r.stdout, /O Emissor aceita a nova e as anteriores \(ate 4\)/);
  assert.ok(!emissor.some((x) => x.command.includes("--so-a-nova")), "sem REVOGAR_ANTERIORES, as anteriores ficam");
});

test("conectar-licencas de novo troca a credencial (a rotacao); com REVOGAR_ANTERIORES=sim o Emissor fica so com a nova, depois de a escola conferir", { skip }, () => {
  const c = conta();
  assert.equal(rodar(c).status, 0);
  const segunda = rodar(c, { REVOGAR_ANTERIORES: "sim" });
  assert.equal(segunda.status, 0, segunda.stdout + segunda.stderr);
  const kvs = naEscola(c).filter((x) => x.command.includes(KV)).map((x) => credencialDe(x.stdin));
  const resumos = noEmissor(c).filter((x) => x.command === `cd '/opt/bunker707' && ${EMISSOR_GRAVA}`).map((x) => x.stdin.trim());
  assert.equal(kvs.length, 2);
  assert.notEqual(kvs[0], kvs[1], "cada rodada, uma credencial nova");
  assert.deepEqual(resumos, kvs.map(resumoDe), "o Emissor recebe o resumo de cada uma");

  // REVOGAR_ANTERIORES=sim: so depois do 200, o mesmo resumo com --so-a-nova, e a conferencia de novo.
  const tudo = ssh(c);
  const revoga = tudo.findIndex((x) => x.command === `cd '/opt/bunker707' && ${EMISSOR_GRAVA} --so-a-nova`);
  assert.ok(revoga > 0);
  assert.equal(tudo[revoga].stdin, `${resumoDe(kvs[1])}\n`);
  const conferencias = tudo.map((x, i) => [x, i]).filter(([x]) => x.command.includes(CHECK)).map(([, i]) => i);
  assert.equal(conferencias.length, 3, "uma na primeira rodada, duas na segunda");
  assert.ok(conferencias[1] < revoga && revoga < conferencias[2], "a escola confere a nova antes e depois de as anteriores sairem");
  assert.match(segunda.stdout, /O Emissor aceita so a credencial nova: as anteriores pararam de valer\./);
});

test("conectar-licencas para antes de mudar qualquer coisa: a escola guardada em snapshot, o DNS interno fora do lugar, o Emissor sem a API interna e o compose da escola antigo", { skip }, () => {
  // A escola guardada: manda restaurar e deploy-membros, sem abrir a 22 de ninguem.
  const guardada = setup({
    servers: [serverFixture("bunker707-licencas", "licencas", 7)],
    images: [oldImage(501, "membros", "2026-11-03T19:26:00Z")],
    firewalls: [{ name: "bunker707-licencas-fw", applied_to: [], rules: [] }],
    records: DNS_CERTO
  });
  const r1 = rodar(guardada);
  assert.equal(r1.status, 1);
  assert.match(r1.stderr, /A nossa escola \(bunker707-membros\) esta guardada em snapshot: rode restaurar \(PAPEIS=membros\) e deploy-membros da main antes do conectar-licencas/);
  assert.equal(ssh(guardada).length, 0);

  const semDns = conta({ records: DNS_CERTO.filter((x) => x.name !== INTERNO) });
  const r2 = rodar(semDns);
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /DNS do Emissor fora do lugar: licencas-interno\.bunker707\.com\.br .*Rode dns-licencas/);
  assert.equal(ssh(semDns).length, 0);

  // O Emissor sem a API interna (o script dele recusa no --conferir): a escola nem e tocada e nada e sorteado.
  const emissorVelho = conta();
  const r3 = rodar(emissorVelho, { SSH_SHIM_REPLIES: JSON.stringify([{ contem: "credencial-interna.sh --conferir", codigo: 1 }, { contem: CHECK, saida: "200 planos=0\n" }]) });
  assert.equal(r3.status, 1);
  assert.equal(naEscola(emissorVelho).length, 0, "a 22 da escola nem abriu");
  assert.ok(!noEmissor(emissorVelho).some((x) => x.command === `cd '/opt/bunker707' && ${EMISSOR_GRAVA}`), "nenhum resumo no Emissor");

  // O compose da escola sem EMISSOR_INTERNO_*: deploy-membros antes; o Emissor nao recebe resumo nenhum.
  const escolaVelha = conta();
  const r4 = rodar(escolaVelha, { SSH_SHIM_REPLIES: JSON.stringify([{ contem: "grep -q 'EMISSOR_INTERNO_CREDENCIAL'", codigo: 1 }]) });
  assert.equal(r4.status, 1);
  assert.match(r4.stderr, /O compose da escola no ar ainda nao leva EMISSOR_INTERNO_URL e EMISSOR_INTERNO_CREDENCIAL ao app: rode deploy-membros da main antes do conectar-licencas\. Nada mudou\./);
  assert.ok(!noEmissor(escolaVelha).some((x) => x.command === `cd '/opt/bunker707' && ${EMISSOR_GRAVA}`), "nenhum resumo no Emissor");
  assert.ok(!naEscola(escolaVelha).some((x) => x.command.includes(KV)), "nenhuma credencial na escola");
  for (const c of [emissorVelho, escolaVelha]) {
    for (const fw of c.hz().firewalls) assert.ok(!fw.rules.some((x) => x.port === "22"), `${fw.name}: a 22 fecha mesmo na recusa`);
    assert.equal(existsSync(join(c.work, "bunker707-cloud", "conectar")), false);
  }
});

test("conectar-licencas: a conferencia que falha para com o que fazer; o 401 nao repete (cada credencial errada conta para o bloqueio do IP da escola)", { skip }, () => {
  const com = (saida, env = {}) => {
    const c = conta();
    const r = rodar(c, { SSH_SHIM_REPLIES: JSON.stringify([{ contem: CHECK, saida }]), CONFERIR_TENTATIVAS: "3", ...env });
    return { r, conferencias: ssh(c).filter((x) => x.command.includes(CHECK)).length, c };
  };
  const recusada = com("401 credencial_invalida\n");
  assert.equal(recusada.r.status, 1);
  assert.equal(recusada.conferencias, 1, "o 401 para na primeira");
  assert.match(recusada.r.stderr, /O Emissor recusou a credencial nova \(401\)/);

  const ipErrado = com("403 -\n");
  assert.equal(ipErrado.conferencias, 3, "o 403 tenta de novo enquanto o Caddy recarrega");
  assert.match(ipErrado.r.stderr, /O Caddy do Emissor recusou o pedido \(403\): ele nao saiu do IPv4 192\.0\.2\.1 do servidor da escola/);

  const semApi = com("502 -\n");
  assert.match(semApi.r.stderr, /O Caddy do Emissor nao chegou na API interna \(502\)/);
  const semConfig = com("000 sem_configuracao\n");
  assert.match(semConfig.r.stderr, /O app da escola nao recebeu EMISSOR_INTERNO_URL e EMISSOR_INTERNO_CREDENCIAL/);
  const semRede = com("000 ENOTFOUND\n");
  assert.match(semRede.r.stderr, /Sem resposta de https:\/\/licencas-interno\.bunker707\.com\.br de dentro do app da escola \(ENOTFOUND\)/);
  // O docker compose exec que falha (o app fora do ar): nem chegou a perguntar.
  const execFalhou = (() => {
    const c = conta();
    const r = rodar(c, { SSH_SHIM_REPLIES: JSON.stringify([{ contem: CHECK, codigo: 1 }]), CONFERIR_TENTATIVAS: "2" });
    return { r, c };
  })();
  assert.match(execFalhou.r.stdout, /de dentro do app da escola: 000 exec_falhou/);
  assert.match(execFalhou.r.stderr, /A conferencia nao rodou dentro do app da escola \(docker compose exec\): o app esta no ar\?/);
  for (const { r, c } of [recusada, ipErrado, semApi, semConfig, semRede, execFalhou]) {
    assert.equal(r.status, 1);
    for (const fw of c.hz().firewalls) assert.ok(!fw.rules.some((x) => x.port === "22"), "a 22 fecha");
    const cred = credencialDe(naEscola(c).find((x) => x.command.includes(KV)).stdin);
    assert.ok(!(r.stdout + r.stderr).includes(cred), "a credencial nunca no registro, nem na falha");
  }
});

test("conectar-licencas no Actions: a credencial so aparece no ::add-mask:: (o runner a esconde), e o env_aplicar_kv grava 0600 com a credencial e o endereco", { skip }, () => {
  const c = conta();
  const r = rodar(c, { GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/main" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const cred = credencialDe(naEscola(c).find((x) => x.command.includes(KV)).stdin);
  const linhas = (r.stdout + r.stderr).split("\n").filter((l) => l.includes(cred));
  assert.deepEqual(linhas, [`::add-mask::${cred}`]);

  // O programa de verdade do env_aplicar_kv, com o .env da escola e o arquivo que chegou pela entrada.
  const dir = mkdtempSync(join(tmpdir(), "bunker707-conectar-env-"));
  try {
    const lib = readFileSync(join(cloudDir, "lib.sh"), "utf8");
    const inicio = lib.indexOf("env_aplicar_kv() {");
    const programa = lib.slice(lib.indexOf("\n", lib.indexOf("<<'PY'", inicio)) + 1, lib.indexOf("\nPY\n", inicio));
    writeFileSync(join(dir, "p.py"), programa);
    writeFileSync(join(dir, "env"), "APP_IMAGE=ghcr.io/x:hetzner-sha-1\nEMISSOR_INTERNO_URL=\nEMISSOR_INTERNO_CREDENCIAL=bki_antiga\n");
    writeFileSync(join(dir, "kv"), naEscola(c).find((x) => x.command.includes(KV)).stdin);
    const aplicado = spawnSync("python3", ["-I", join(dir, "p.py"), join(dir, "env"), join(dir, "kv")], { encoding: "utf8" });
    assert.equal(aplicado.status, 0, aplicado.stderr);
    assert.equal(readFileSync(join(dir, "env"), "utf8"), `APP_IMAGE=ghcr.io/x:hetzner-sha-1\nEMISSOR_INTERNO_URL=https://${INTERNO}\nEMISSOR_INTERNO_CREDENCIAL=${cred}\n`);
    assert.equal(statSync(join(dir, "env")).mode & 0o777, 0o600);
    assert.equal(existsSync(join(dir, "kv")), false, "o arquivo com a credencial sai do disco");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("restaurar da escola ligada ao Emissor lembra o conectar-licencas (o IP muda); a escola que nao fala com o Emissor nao ganha o lembrete", { skip }, () => {
  const lembrete = /a escola fala com o Emissor de licencas \(EMISSOR_INTERNO_URL\), que so aceita o IP de antes: rode conectar-licencas da main com CONFIRMAR=conectar/;
  const voltar = (replies) => {
    const c = setup({ images: [oldImage(801, "membros", "2026-11-03T19:26:00Z")] });
    const r = c.runScript("restaurar.sh", { PAPEIS: "membros", ...(replies ? { SSH_SHIM_REPLIES: JSON.stringify(replies) } : {}) });
    return { c, r };
  };
  const ligada = voltar([{ contem: "grep -qE '^EMISSOR_INTERNO_URL=.+'", saida: "sim\n" }]);
  assert.equal(ligada.r.status, 0, ligada.r.stdout + ligada.r.stderr);
  assert.match(ligada.r.stdout, lembrete);
  assert.ok(!ligada.c.calls().some((x) => x.tool === "hcloud" && x.args.join(" ").includes("bunker707-licencas")), "o servidor do Emissor nao e tocado");
  const sem = voltar();
  assert.equal(sem.r.status, 0, sem.r.stderr);
  assert.doesNotMatch(sem.r.stdout, lembrete);
});

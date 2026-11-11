import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { cloudDir, criarInfraDeMentira as setup, faltamBinarios, hzCall, limparInfraDeMentira, record, serverFixture } from "./fixtures/infra-de-mentira.mjs";

// O servidor do Emissor de licencas, bunker707-licencas (docs/32 D39 e §11.2; docs/20 §8C). As etapas de verdade
// (infra/cloud/licencas.sh, provision.sh licencas e o workflow) rodam contra a Hetzner, a Cloudflare e o servidor de
// mentira de tests/fixtures/infra-de-mentira.mjs. Nada fala com a rede. O que roda dentro do servidor (implantar,
// backup, restaurar e o ensaio) esta em tests/infra-licencas-servidor.test.mjs.

after(limparInfraDeMentira);

const skip = faltamBinarios.length ? `faltam ${faltamBinarios.join(", ")}` : false;
const root = fileURLToPath(new URL("..", import.meta.url));
const workflow = readFileSync(join(root, ".github/workflows/infra.yml"), "utf8");
const caddyfile = readFileSync(join(root, "infra/licencas/caddy/Caddyfile"), "utf8");
const caddyCompose = readFileSync(join(root, "infra/licencas/docker-compose.yml"), "utf8");
const LICENCAS = "bunker707-licencas";
const IP = "192.0.2.7";
const PAINEL = "licencas.bunker707.com.br";
const API = "licencas-api.bunker707.com.br";

// ---- a cerimonia das chaves, de mentira (a de verdade e o bin/chaves.ts do bunker-licensing) ----------------------
const CERT_CONTEXT = "bunker-licensing/certificate/v1\n";
const novaChave = () => generateKeyPairSync("ed25519").privateKey;
const publica = (key) => createPublicKey(key).export({ format: "jwk" }).x;
const SENHA = "senha-da-emissao-de-teste-0001";
const cifrada = (key, senha = SENHA) => key.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: senha });
function certificado(raiz, rid, emissao, { use = "license", kid = "emissao-teste", inicio = Date.now() - 60_000, dias = 400 } = {}) {
  const payload = { v: 1, use, kid, rid, publicKey: publica(emissao), notBefore: new Date(inicio).toISOString(), notAfter: new Date(inicio + dias * 86_400_000).toISOString() };
  const segment = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(null, Buffer.from(CERT_CONTEXT + segment), raiz).toString("base64url");
  return `${JSON.stringify({ kid, rid, certificate: { segment, signature } }, null, 2)}\n`;
}
const raiz = novaChave();
const reserva = novaChave();
const emissao = novaChave();
const RAIZES = JSON.stringify([{ rid: "raiz-teste", publicKey: publica(raiz) }, { rid: "raiz-reserva", publicKey: publica(reserva) }]);
const SEGREDOS = {
  LICENCAS_EMISSAO_CHAVE: cifrada(emissao),
  LICENCAS_EMISSAO_SENHA: SENHA,
  LICENCAS_EMISSAO_CERTIFICADO: certificado(raiz, "raiz-teste", emissao),
  LICENCAS_RAIZES: RAIZES,
  LICENCAS_RESEND_CHAVE: "re_chave_de_teste_do_emissor"
};

// ---- tipos da Hetzner para o plano: precos e estoque por local, incluindo um local fora da Europa -----------------
const preco = (location, net) => ({ location, price_monthly: { net: String(net) }, price_hourly: { net: String(net / 720) } });
const TIPOS = {
  // x86 de 4 GB: o mesmo preco nos tres locais da Europa, sem estoque em hel1.
  cx23: { cores: 2, memory: 4, disk: 40, cpu_type: "shared", architecture: "x86", deprecated: false, prices: [preco("fsn1", 3.79), preco("nbg1", 3.79), preco("hel1", 3.79)], locations: [{ name: "fsn1", available: true }, { name: "nbg1", available: true }, { name: "hel1", available: false }] },
  // ARM de 4 GB: mais barato, sem estoque em fsn1; nbg1 e hel1 pelo mesmo preco.
  cax11: { cores: 2, memory: 4, disk: 40, cpu_type: "shared", architecture: "arm", deprecated: false, prices: [preco("fsn1", 3.49), preco("nbg1", 3.49), preco("hel1", 3.49)], locations: [{ name: "fsn1", available: false }, { name: "nbg1", available: true }, { name: "hel1", available: true }] },
  // x86 de 2 GB (o minimo) mais barato de todos, mas so em Singapura: um local que nao e fsn1, nbg1 nem hel1.
  cpx12: { cores: 1, memory: 2, disk: 40, cpu_type: "shared", architecture: "x86", deprecated: false, prices: [preco("sin", 3.29), preco("fsn1", 4.99)], locations: [{ name: "sin", available: true }, { name: "fsn1", available: true }] },
  // Abaixo do minimo (1 GB) e o descontinuado: nunca escolhidos, mesmo mais baratos.
  cx11: { cores: 1, memory: 1, disk: 20, cpu_type: "shared", architecture: "x86", deprecated: false, prices: [preco("fsn1", 1.99)], locations: [{ name: "fsn1", available: true }] },
  cx22: { cores: 2, memory: 4, disk: 40, cpu_type: "shared", architecture: "x86", deprecated: true, prices: [preco("fsn1", 2.49)], locations: [{ name: "fsn1", available: true }] }
};

// ---- o Painel e a conta de envio do Emissor: as variaveis do repositorio que o workflow entrega ao deploy-licencas ----
const AUD = "0123456789abcdef".repeat(4);
const PAINEL_ENV = {
  LICENCAS_PAINEL_ACCESS_EQUIPE: "https://Bunker707.cloudflareaccess.com/",
  LICENCAS_PAINEL_ACCESS_AUD: AUD,
  LICENCAS_EMISSOR_EMAIL_REMETENTE: "Emissor Bunker707 <emissor@mail.bunker707.com.br>",
  PRODUCER_EMAIL: "Produtor@Exemplo.com.br"
};
const configDe = (command) => JSON.parse(Buffer.from(command.match(/--config-b64='([^']+)'/)[1], "base64").toString());

const servidorLicencas = () => serverFixture(LICENCAS, "licencas", 7);
const firewallLicencas = () => [{ name: `${LICENCAS}-fw`, applied_to: [], rules: [] }];
const sshCmds = (calls) => calls.filter((c) => c.tool === "ssh" && !c.control);
const indexOfCmd = (calls, piece) => calls.findIndex((c) => c.tool === "ssh" && !c.control && c.command.includes(piece));

test("plan-licencas lista os tipos que servem em todos os locais da API e escolhe o mais barato, x86 ou ARM, sem criar nada", { skip }, () => {
  const conta = setup({ tipos: TIPOS });
  const result = conta.runScript("licencas.sh", {}, ["plan"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  // O mais barato que serve e o x86 de 2 GB em Singapura: o plano olha todo local que a API informa.
  assert.match(result.stdout, /licencas: cpx12 em sin \(1 vCPU x86, 2 GB, 40 GB disco\) por EUR 3\.29\/mes sem IVA, mais o IPv4/);
  assert.match(result.stdout, /^cax11\s+nbg1 .* arm\s+3\.49 sim$/m, "o ARM entra na tabela");
  assert.match(result.stdout, /^cax11\s+fsn1 .* 3\.49 nao$/m, "o esgotado aparece como indisponivel");
  assert.match(result.stdout, /Fora \(abaixo do minimo ou de outra arquitetura\): cx11/);
  assert.doesNotMatch(result.stdout, /^cx22 /m, "tipo descontinuado nem aparece");
  assert.match(result.stdout, /IPv4: um, obrigatorio/);
  const calls = conta.calls().filter((c) => c.tool === "hcloud");
  assert.deepEqual(calls.map((c) => c.args.slice(0, 2).join(" ")), ["version", "server-type list"], "o plano so le a lista de tipos");
  assert.equal(conta.hz().servers.length, 0);
});

test("plan-licencas: empate de preco fica com o local preferido; LICENCAS_LOCAIS, o tipo forcado e um minimo alto mudam a escolha", { skip }, () => {
  const conta = setup({ tipos: TIPOS });
  const europa = conta.runScript("licencas.sh", { LICENCAS_LOCAIS: "fsn1,nbg1,hel1" }, ["plan"]);
  assert.equal(europa.status, 0, europa.stderr);
  // cax11 sem estoque em fsn1: nbg1 vem antes de hel1 (a ordem de LOCATION e FALLBACK_LOCATIONS), e hel1 fica de reserva.
  assert.match(europa.stdout, /licencas: cax11 em nbg1 .* por EUR 3\.49\/mes/);
  assert.match(europa.stdout, /o mesmo tipo pelo mesmo preco em: hel1/);

  const x86 = conta.runScript("licencas.sh", { LICENCAS_LOCAIS: "fsn1,nbg1,hel1", LICENCAS_ARQUITETURAS: "x86" }, ["plan"]);
  assert.match(x86.stdout, /licencas: cx23 em fsn1 .* por EUR 3\.79\/mes/);
  assert.match(x86.stdout, /o mesmo tipo pelo mesmo preco em: nbg1$/m, "hel1 sem estoque nao vira reserva");

  const forcado = conta.runScript("licencas.sh", { LICENCAS_TYPE: "cx23", LICENCAS_LOCATION: "nbg1" }, ["plan"]);
  assert.match(forcado.stdout, /licencas: cx23 em nbg1/);

  const grande = conta.runScript("licencas.sh", { LICENCAS_MIN_RAM_GB: "64" }, ["plan"]);
  assert.equal(grande.status, 1);
  assert.match(grande.stdout, /Nenhum tipo disponivel serve para o Emissor\. Nada foi criado\./);
});

test("provision-licencas sem CONFIRMADO=sim recusa antes de qualquer chamada; com ele cria o mais barato com labels, firewall proprio e bootstrap", { skip }, () => {
  const sem = setup({ tipos: TIPOS });
  const recusa = sem.runScript("provision.sh", {}, ["licencas"]);
  assert.equal(recusa.status, 1);
  assert.match(recusa.stderr, /provision-licencas cria o servidor do Emissor de licencas \(cobrado por mes a partir de agora\)\. .*CONFIRMADO=sim/);
  assert.deepEqual(sem.calls(), [], "sem confirmacao nada e chamado");

  const conta = setup({ tipos: TIPOS, storageBox: { name: "bunker707-backups", username: "u100", server: "u100.your-storagebox.de" } });
  const result = conta.runScript("provision.sh", { CONFIRMADO: "sim", LICENCAS_LOCAIS: "fsn1,nbg1,hel1" }, ["licencas"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const state = conta.hz();
  const criado = state.servers.find((s) => s.name === LICENCAS);
  assert.ok(criado, "servidor criado");
  assert.equal(criado.server_type.name, "cax11");
  assert.equal(criado.location.name, "nbg1");
  assert.deepEqual(criado.labels, { app: "bunker707", papel: "licencas" });
  assert.equal(state.servers.length, 1, "so o servidor de licencas");
  const fw = state.firewalls.find((f) => f.name === `${LICENCAS}-fw`);
  assert.ok(fw && fw.applied_to.some((a) => a.server.id === criado.id), "o firewall proprio esta aplicado");
  assert.ok(!fw.rules.some((r) => r.port === "22"), "a 22 termina fechada");
  assert.deepEqual(fw.rules.filter((r) => r.protocol === "tcp").map((r) => [r.port, r.source_ips]), [["80", ["0.0.0.0/0", "::/0"]], ["443", ["0.0.0.0/0", "::/0"]]]);
  assert.ok(!fw.rules.some((r) => r.protocol === "udp"), "sem HTTP/3 nem outra porta UDP");
  const calls = conta.calls();
  const bootstrap = sshCmds(calls).find((c) => c.command.includes("bash /root/bootstrap.sh"));
  assert.match(bootstrap.command, /SEM_SUPABASE_CLI=1 SSH_PUBLIC_KEY=/, "bootstrap sem a CLI do Supabase");
  assert.ok(indexOfCmd(calls, "id_ed25519_storagebox &&") > 0, "a chave do Storage Box e instalada");
  assert.equal(calls.filter((c) => c.tool === "curl" && c.url.includes("cloudflare.com/client")).length, 0, "o DNS e outra etapa");
});

test("provision-licencas para antes de criar quando o preco passou do aprovado, e tenta so os locais do mesmo tipo e preco sem estoque", { skip }, () => {
  const caro = setup({ tipos: TIPOS });
  const recusa = caro.runScript("provision.sh", { CONFIRMADO: "sim", LICENCAS_LOCAIS: "fsn1,nbg1,hel1", LICENCAS_PRECO_MAX: "3.00" }, ["licencas"]);
  assert.equal(recusa.status, 1);
  assert.match(recusa.stderr, /passa do LICENCAS_PRECO_MAX=3\.00 aprovado pelo produtor\. Nada foi criado/);
  assert.equal(hzCall(caro.calls(), "server create"), -1);
  assert.equal(hzCall(caro.calls(), "firewall create"), -1);

  // nbg1 acabou o estoque entre o plano e a criacao: vai para hel1 (mesmo tipo, mesmo preco), nunca para um mais caro.
  const sem = setup({ tipos: TIPOS, unavailable: ["cax11@nbg1"] });
  const result = sem.runScript("provision.sh", { CONFIRMADO: "sim", LICENCAS_LOCAIS: "fsn1,nbg1,hel1" }, ["licencas"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(sem.hz().servers.map((s) => [s.server_type.name, s.location.name]), [["cax11", "hel1"]]);
});

test("dns-licencas: so registros A, o Painel com proxy e a API sem; AAAA que existir sai, e o resto da zona fica", { skip }, () => {
  const conta = setup({
    servers: [servidorLicencas()],
    firewalls: firewallLicencas(),
    records: [
      record(PAINEL, "AAAA", "2001:db8::1", true),
      record(API, "AAAA", "2001:db8::1", false),
      record(API, "A", "203.0.113.99", true),
      record("membros.bunker707.com.br", "AAAA", "2001:db8:a1::1", true)
    ]
  });
  const result = conta.runScript("licencas.sh", {}, ["dns"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const records = conta.cf().records;
  const de = (name) => records.filter((r) => r.name === name).map((r) => [r.type, r.content, r.proxied]);
  assert.deepEqual(de(PAINEL), [["A", IP, true]]);
  assert.deepEqual(de(API), [["A", IP, false]], "a API sem proxy: nenhum desafio de robos, so IPv4");
  assert.deepEqual(de("membros.bunker707.com.br"), [["AAAA", "2001:db8:a1::1", true]], "os outros nomes nao mudam");
  assert.ok(!conta.calls().some((c) => c.tool === "curl" && c.method === "POST" && JSON.parse(c.data ?? "{}").type === "AAAA"), "nunca cria AAAA");
  assert.deepEqual(conta.cf().settings, { ssl: "strict", always_use_https: "off" });
  assert.match(result.stdout, /aplicacao do\s+Access/);

  const semServidor = setup({});
  const recusa = semServidor.runScript("licencas.sh", {}, ["dns"]);
  assert.equal(recusa.status, 1);
  assert.match(recusa.stderr, /O servidor bunker707-licencas nao existe/);
  assert.ok(!semServidor.calls().some((c) => c.tool === "curl"), "nada na Cloudflare sem o servidor");
});

test("as etapas de licencas que mudam alguma coisa so rodam da main: a trava do workflow e a do script recusam a dev", { skip }, () => {
  const step = workflow.match(/- name: Licencas so da main\n\s+if: (.+)\n\s+run: \|\n\s+(.+)\n/);
  assert.ok(step, "passo de trava das licencas no workflow");
  assert.equal(step[1], "endsWith(inputs.etapa, '-licencas')");
  const infraJob = workflow.slice(workflow.indexOf("\n  infra:\n"));
  assert.ok(infraJob.indexOf("Licencas so da main") < infraJob.indexOf("Segredos presentes?"), "a trava vem antes de qualquer segredo");
  const run = (etapa, ref) => spawnSync("bash", ["-e", "-c", step[2]], { encoding: "utf8", env: { ...process.env, ETAPA: etapa, GITHUB_REF: ref } });
  const runSource = readFileSync(join(cloudDir, "run.sh"), "utf8");
  const etapas = [...runSource.matchAll(/^\s+([a-z-]+-licencas)\)/gm)].map((m) => m[1]);
  assert.deepEqual(etapas.sort(), ["backup-licencas", "deploy-licencas", "dns-licencas", "ensaio-licencas", "exec-licencas", "plan-licencas", "provision-licencas", "restaurar-licencas", "secrets-licencas", "status-licencas"]);
  for (const etapa of etapas) {
    assert.equal(run(etapa, "refs/heads/main").status, 0, `${etapa} na main`);
    const dev = run(etapa, "refs/heads/dev");
    if (etapa === "plan-licencas" || etapa === "status-licencas") {
      assert.equal(dev.status, 0, `${etapa} so le e roda de qualquer branch`);
    } else {
      assert.equal(dev.status, 1, `${etapa} recusada na dev`);
      assert.match(dev.stdout, new RegExp(`::error::${etapa} muda o servidor de licencas e so roda na main \\(recebido: refs/heads/dev\\)`));
    }
  }
  // O deploy-licencas passa tambem pela trava dos deploy-*.
  const deployGuard = workflow.match(/- name: Deploy so da main\n\s+if: .+\n\s+run: \|\n\s+(.+)\n/)[1];
  assert.equal(spawnSync("bash", ["-e", "-c", deployGuard], { env: { ...process.env, ETAPA: "deploy-licencas", GITHUB_REF: "refs/heads/dev" } }).status, 1);

  // A segunda trava, no proprio script, para quem chamar de outro lugar no Actions.
  const conta = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas() });
  for (const [script, args] of [["licencas.sh", ["dns"]], ["licencas.sh", ["deploy"]], ["licencas.sh", ["segredos"]], ["licencas.sh", ["restaurar"]], ["provision.sh", ["licencas"]], ["run.sh", ["exec-licencas"]]]) {
    const recusa = conta.runScript(script, { GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/dev", CONFIRMADO: "sim", CONFIRMAR: "restaurar", COMANDO: "true" }, args);
    assert.equal(recusa.status, 1, `${script} ${args}`);
    assert.match(recusa.stderr, /As etapas que mudam o servidor de licencas so rodam da main \(recebido: refs\/heads\/dev\)/, `${script} ${args}`);
  }
  assert.deepEqual(conta.calls(), [], "nada chamado fora da main");
  const plano = setup({ tipos: TIPOS }).runScript("licencas.sh", { GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/dev" }, ["plan"]);
  assert.equal(plano.status, 0, "plan-licencas so le");
});

test("o workflow so entrega cada segredo LICENCAS_* na etapa que o usa, e confere que existem antes; a configuracao do Painel vem das variaveis do repositorio, so no deploy", () => {
  const step = workflow.slice(workflow.indexOf("      - name: ${{ inputs.etapa }}"), workflow.indexOf("      - name: Fechar o SSH (sempre)"));
  const todas = [...step.matchAll(/^ {10}(LICENCAS_[A-Z_]+): \$\{\{ (.+) \}\}$/gm)].map((m) => [m[1], m[2]]);
  const linhas = todas.filter(([, expressao]) => expressao.includes("secrets."));
  assert.deepEqual(linhas.map(([nome]) => nome).sort(), ["LICENCAS_BANCO_SENHA", "LICENCAS_EMISSAO_CERTIFICADO", "LICENCAS_EMISSAO_CHAVE", "LICENCAS_EMISSAO_SENHA", "LICENCAS_RAIZES", "LICENCAS_RESEND_CHAVE"]);
  for (const [nome, expressao] of linhas) {
    assert.match(expressao, new RegExp(`^\\(?inputs\\.etapa == '(secrets|deploy)-licencas'.*&& secrets\\.${nome} \\|\\| ''$`), `${nome} so na etapa certa`);
  }
  // As variaveis do repositorio (nao sao segredo): o Painel, a conta de envio, as chaves anteriores, os links e o "sem Painel".
  const variaveis = todas.filter(([, expressao]) => !expressao.includes("secrets."));
  assert.deepEqual(variaveis.map(([nome]) => nome).sort(), ["LICENCAS_EMISSOR_EMAIL_PRODUTOR", "LICENCAS_EMISSOR_EMAIL_REMETENTE", "LICENCAS_EMISSOR_KIDS_ANTERIORES", "LICENCAS_EMISSOR_LINK_LOJA", "LICENCAS_EMISSOR_LINK_RENOVAR", "LICENCAS_PAINEL_ACCESS_AUD", "LICENCAS_PAINEL_ACCESS_EQUIPE", "LICENCAS_PAINEL_TETO_DIARIO", "LICENCAS_SEM_PAINEL"]);
  for (const [nome, expressao] of variaveis) {
    assert.equal(expressao, `inputs.etapa == 'deploy-licencas' && vars.${nome} || ''`, `${nome}: a variavel do repositorio, so no deploy-licencas`);
  }
  // Cada variavel que o workflow entrega e uma que o deploy le (infra/cloud/licencas.sh).
  const licencasSh = readFileSync(join(cloudDir, "licencas.sh"), "utf8");
  for (const [nome] of variaveis) assert.ok(licencasSh.includes(nome), `${nome} lida pelo deploy-licencas`);
  assert.match(step, /LICENCAS_EMISSAO_CHAVE: \$\{\{ inputs\.etapa == 'secrets-licencas' && /, "a chave de emissao so no secrets-licencas");
  assert.doesNotMatch(workflow, /RAIZ_PRIVADA|LICENCAS_RAIZ_CHAVE|secrets\.LICENCAS_RAIZ[^E]/, "nenhum segredo de chave raiz no workflow");
  const presentes = workflow.slice(workflow.indexOf("- name: Segredos presentes?"), workflow.indexOf("      - name: ${{ inputs.etapa }}"));
  assert.match(presentes, /TEM_LICENCAS_RAIZES: \$\{\{ secrets\.LICENCAS_RAIZES != '' \}\}/, "a conferencia so ve se existe, nunca o valor");
  assert.match(presentes, /secrets-licencas\|deploy-licencas\) \[ "\$TEM_LICENCAS_RAIZES" = true \]/);
});

test("licencas-chave.mjs: aceita a chave de emissao certa e recusa a raiz, a chave sem cifra, o certificado de outra chave, de outra raiz ou vencido", () => {
  const conferir = (overrides) => spawnSync(process.execPath, [join(cloudDir, "licencas-chave.mjs")], { encoding: "utf8", env: { PATH: process.env.PATH, ...SEGREDOS, ...overrides } });
  const ok = conferir({});
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /chave de emissao emissao-teste \(raiz raiz-teste\), certificado valido ate .* \(399 dias\)/);
  assert.ok(!ok.stdout.includes("-----BEGIN") && !ok.stdout.includes(SENHA), "nada secreto na saida");

  const casos = [
    [{ LICENCAS_EMISSAO_CHAVE: cifrada(raiz), LICENCAS_EMISSAO_CERTIFICADO: certificado(raiz, "raiz-teste", raiz) }, /e uma das RAIZES de LICENCAS_RAIZES\. A raiz nunca vai para servidor nenhum/],
    [{ LICENCAS_EMISSAO_CHAVE: cifrada(reserva) }, /e uma das RAIZES/],
    [{ LICENCAS_EMISSAO_CHAVE: emissao.export({ type: "pkcs8", format: "pem" }) }, /cifrada com senha \(ENCRYPTED PRIVATE KEY\)/],
    [{ LICENCAS_EMISSAO_SENHA: "outra-senha-com-mais-de-16" }, /A senha nao abre a chave/],
    [{ LICENCAS_EMISSAO_SENHA: "curta" }, /pelo menos 16 caracteres/],
    [{ LICENCAS_EMISSAO_CERTIFICADO: certificado(raiz, "raiz-teste", novaChave()) }, /O certificado e de outra chave/],
    [{ LICENCAS_EMISSAO_CERTIFICADO: certificado(novaChave(), "raiz-teste", emissao) }, /A assinatura do certificado nao confere com a raiz raiz-teste/],
    [{ LICENCAS_EMISSAO_CERTIFICADO: certificado(raiz, "raiz-de-fora", emissao) }, /assinado pela raiz raiz-de-fora, que nao esta em LICENCAS_RAIZES/],
    [{ LICENCAS_EMISSAO_CERTIFICADO: certificado(raiz, "raiz-teste", emissao, { use: "pacote" }) }, /nao e de uma chave de emissao de licencas/],
    [{ LICENCAS_EMISSAO_CERTIFICADO: certificado(raiz, "raiz-teste", emissao, { inicio: Date.now() - 500 * 86_400_000 }) }, /venceu em/],
    [{ LICENCAS_RAIZES: "[]" }, /lista de 1 a 4 raizes/],
    [{ LICENCAS_EMISSAO_CERTIFICADO: "nao e json" }, /LICENCAS_EMISSAO_CERTIFICADO nao e JSON/]
  ];
  for (const [overrides, mensagem] of casos) {
    const recusa = conferir(overrides);
    assert.equal(recusa.status, 1, `${Object.keys(overrides)}: ${recusa.stdout}`);
    assert.match(recusa.stderr, mensagem);
    assert.ok(!(recusa.stdout + recusa.stderr).includes("-----BEGIN"), "a chave nunca aparece na saida");
  }
});

test("secrets-licencas grava os segredos em segredos/ como 1000:1000 e 0400, so pelo stdin do SSH, e a raiz nunca sai do runner", { skip }, () => {
  const conta = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas() });
  const result = conta.runScript("licencas.sh", SEGREDOS, ["segredos"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = sshCmds(conta.calls());
  const dir = calls.find((c) => c.command.includes("sudo install -d -m 700"));
  assert.match(dir.command, /sudo install -d -m 700 -o 'deploy' -g 'deploy' '\/opt\/bunker707\/emissor\/segredos'/);
  const grava = (arquivo) => calls.find((c) => c.command.includes(`mv -f "$t" "/opt/bunker707/emissor/segredos/${arquivo}"`));
  for (const [arquivo, variavel] of [["emissao.pem", "LICENCAS_EMISSAO_CHAVE"], ["emissao-senha", "LICENCAS_EMISSAO_SENHA"], ["emissao-certificado.json", "LICENCAS_EMISSAO_CERTIFICADO"], ["resend-chave", "LICENCAS_RESEND_CHAVE"]]) {
    const call = grava(arquivo);
    assert.ok(call, `segredos/${arquivo} gravado`);
    assert.match(call.command, /umask 077; .*chown 1000:1000 "\$t" && chmod 400 "\$t" && mv -f/);
    assert.equal(call.stdin, SEGREDOS[variavel].slice(0, 80), `${variavel} vai pelo stdin`);
  }
  // Nenhum valor secreto aparece em linha de comando (ps, log do Actions).
  const comandos = calls.map((c) => c.command).join("\n") + result.stdout + result.stderr;
  for (const valor of [SENHA, "re_chave_de_teste_do_emissor", "ENCRYPTED PRIVATE KEY", JSON.parse(SEGREDOS.LICENCAS_EMISSAO_CERTIFICADO).certificate.signature]) {
    assert.ok(!comandos.includes(valor), `valor secreto fora da linha de comando e do log: ${valor.slice(0, 12)}`);
  }
  // Sem LICENCAS_BANCO_SENHA, a senha do banco nasce no servidor.
  assert.ok(calls.some((c) => c.command.includes("openssl rand -hex 24") && c.command.includes("chown 1000:1000") && c.command.includes("chmod 400")));
  assert.ok(!conta.hz().firewalls[0].rules.some((r) => r.port === "22"), "a 22 termina fechada");

  // Sem a chave do Resend: o arquivo que ja esta no servidor fica; sem nenhum, nasce vazio (o compose do Emissor o monta
  // sempre), e o aviso diz que o Painel nao sobe sem ela.
  const semResend = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas() });
  const semChave = Object.fromEntries(Object.entries(SEGREDOS).filter(([nome]) => nome !== "LICENCAS_RESEND_CHAVE"));
  const vazia = semResend.runScript("licencas.sh", semChave, ["segredos"]);
  assert.equal(vazia.status, 0, vazia.stdout + vazia.stderr);
  const arquivo = sshCmds(semResend.calls()).find((c) => c.command.includes('segredos/resend-chave'));
  assert.match(arquivo.command, /test -s "\/opt\/bunker707\/emissor\/segredos\/resend-chave" && echo .*mantida.* \|\| \{ umask 077; : > "\/opt\/bunker707\/emissor\/segredos\/resend-chave" && chown 1000:1000 .* && chmod 400 /);
  assert.match(vazia.stderr, /LICENCAS_RESEND_CHAVE vazio: sem a chave do Resend o Painel nao sobe .*LICENCAS_SEM_PAINEL=sim/);
  // A chave fora do formato que o Emissor confere ao subir: recusada no runner, antes de qualquer chamada.
  const malFeita = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas() });
  const ruim = malFeita.runScript("licencas.sh", { ...SEGREDOS, LICENCAS_RESEND_CHAVE: "chave.sem.prefixo.0001" }, ["segredos"]);
  assert.equal(ruim.status, 1);
  assert.match(ruim.stderr, /LICENCAS_RESEND_CHAVE fora do formato de uma chave do Resend \(uma linha, re_\.\.\.\)/);
  assert.deepEqual(malFeita.calls(), []);

  // A raiz no lugar da chave de emissao: recusada no runner, antes de qualquer SSH ou chamada a Hetzner.
  const raizComoEmissao = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas() });
  const recusa = raizComoEmissao.runScript("licencas.sh", { ...SEGREDOS, LICENCAS_EMISSAO_CHAVE: cifrada(raiz), LICENCAS_EMISSAO_CERTIFICADO: certificado(raiz, "raiz-teste", raiz) }, ["segredos"]);
  assert.equal(recusa.status, 1);
  assert.match(recusa.stderr, /e uma das RAIZES/);
  assert.deepEqual(raizComoEmissao.calls(), [], "nada saiu do runner");
});

test("secrets-licencas: a senha do banco que ja existe com outro valor so muda com TROCAR_SENHA_BANCO=sim, que troca dentro do banco antes do arquivo", { skip }, () => {
  const comBanco = (extra = {}) => ({
    ...SEGREDOS,
    LICENCAS_BANCO_SENHA: "senha-nova-do-banco-0001",
    SSH_SHIM_REPLIES: JSON.stringify([
      { contem: "sha256sum <", saida: `${"a".repeat(64)}\n` },
      { contem: "docker volume inspect bunker-licensing_banco", codigo: 0 }
    ]),
    ...extra
  });
  const conta = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas() });
  const recusa = conta.runScript("licencas.sh", comBanco(), ["segredos"]);
  assert.equal(recusa.status, 1);
  assert.match(recusa.stderr, /O banco do Emissor ja existe com outra senha .*TROCAR_SENHA_BANCO=sim/);
  assert.ok(!sshCmds(conta.calls()).some((c) => c.command.includes("segredos/postgres-senha\"'")), "o arquivo nao foi trocado");
  assert.ok(!conta.hz().firewalls[0].rules.some((r) => r.port === "22"), "a 22 fecha mesmo com a recusa");

  const troca = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas() });
  const result = troca.runScript("licencas.sh", comBanco({ TROCAR_SENHA_BANCO: "sim" }), ["segredos"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = sshCmds(troca.calls());
  const alter = calls.findIndex((c) => c.command.includes("psql -U emissor -d emissor"));
  const arquivo = calls.findIndex((c) => c.command.includes('"/opt/bunker707/emissor/segredos/postgres-senha"\''));
  assert.ok(alter >= 0 && arquivo > alter, "a senha muda no banco antes do arquivo");
  assert.match(calls[alter].stdin, /^alter role emissor password 'senha-nova-do-banco-0001';/);
  assert.doesNotMatch(calls[alter].command, /senha-nova-do-banco/);
});

test("deploy-licencas: DNS conferido, so a infra dele vai ao servidor, token so pelo stdin, imagem do GHCR, Caddy validado e o backup de hora em hora", { skip }, () => {
  const conta = setup({
    servers: [servidorLicencas()],
    firewalls: firewallLicencas(),
    storageBox: { name: "bunker707-backups", username: "u100", server: "u100.your-storagebox.de" },
    records: [record(PAINEL, "A", IP, true), record(API, "A", IP, false)]
  });
  const TOKEN = "ghs_token_efemero_do_job_0001";
  const result = conta.runScript("licencas.sh", {
    ...PAINEL_ENV,
    GITHUB_TOKEN: TOKEN,
    GITHUB_ACTOR: "danilosouza-dev",
    LICENCAS_RAIZES: RAIZES,
    LICENCAS_PAINEL_IPS: "203.0.113.10,2001:db8:1234::/48",
    PUBLICO_TENTATIVAS: "1",
    SSH_SHIM_ENV: JSON.stringify({ EMISSOR_PORTA_NO_HOST: "8080", PAINEL_PORTA_NO_HOST: "8081" })
  }, ["deploy"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = conta.calls();
  const at = (piece) => indexOfCmd(calls, piece);
  const login = at("docker login ghcr.io");
  const implantar = at("bash infra/licencas/scripts/implantar.sh");
  const logout = at("docker logout ghcr.io");
  const caddy = at("docker compose -f infra/licencas/docker-compose.yml pull --quiet");
  const init = at("backup.sh --init --chave-recuperacao=");
  const addKey = at("backup.sh --add-key=");
  const timer = at("sudo bash infra/licencas/scripts/backup.sh --install-timer");
  assert.ok(at("tar -x -C '/opt/bunker707'") < login && login < implantar && implantar < logout && logout < caddy && caddy < init && init < addKey && addKey < timer, `ordem: ${[login, implantar, logout, caddy, init, addKey, timer]}`);
  assert.equal(calls[login].stdin, TOKEN, "o token do job vai pelo stdin");
  assert.ok(!sshCmds(calls).some((c) => c.command.includes(TOKEN)) && !(result.stdout + result.stderr).includes(TOKEN), "o token nunca em linha de comando nem no log");
  const imp = calls[implantar].command;
  assert.match(imp, /--imagem='ghcr\.io\/danilosouza-dev\/bunker-licensing:main'/);
  assert.equal(Buffer.from(imp.match(/--raizes-b64='([^']+)'/)[1], "base64").toString(), RAIZES);
  // O Painel e a conta de envio, como o Emissor confere ao subir: o endereco vem do nome do Painel, a equipe do Access sem
  // https:// nem barra, o produtor (o PRODUCER_EMAIL, sem a variavel) em minusculas, e o teto padrao.
  assert.deepEqual(configDe(imp), {
    PAINEL_ENDERECO: `https://${PAINEL}`,
    PAINEL_ACCESS_EQUIPE: "bunker707.cloudflareaccess.com",
    PAINEL_ACCESS_AUD: AUD,
    PAINEL_TETO_DIARIO: "10",
    EMISSOR_EMAIL_PRODUTOR: "produtor@exemplo.com.br",
    EMISSOR_EMAIL_REMETENTE: "Emissor Bunker707 <emissor@mail.bunker707.com.br>",
    EMISSOR_KIDS_ANTERIORES: "",
    EMISSOR_LINK_RENOVAR: "",
    EMISSOR_LINK_LOJA: ""
  });
  const geridas = JSON.parse(readFileSync(join(root, "infra/licencas/scripts/implantar.sh"), "utf8").match(/GERIDAS = (\[[^\]]+\])/)[1]);
  assert.deepEqual(Object.keys(configDe(imp)).sort(), geridas, "o JSON do deploy traz exatamente as variaveis que o implantar.sh confere");
  assert.match(result.stdout, /Painel em https:\/\/licencas\.bunker707\.com\.br \(Access de bunker707\.cloudflareaccess\.com; teto de 10 /);
  assert.doesNotMatch(result.stdout + result.stderr, /produtor@exemplo/i, "o e-mail do produtor nao vai para o log");
  assert.match(result.stdout, /A primeira conta do Painel, uma vez .*\n\s+cd emissor && docker compose exec -T emissor node bin\/painel\.ts adicionar <e-mail do login do Access> --funcao produtor --motivo "Primeira conta"/);
  assert.match(calls[caddy].command, /run --rm --no-deps caddy caddy validate --config \/etc\/caddy\/Caddyfile --adapter caddyfile && .* up -d && .*caddy reload/);
  assert.match(calls[timer].command, /systemctl start bunker707-licencas-backup\.service/);
  // .env do lado nosso: os nomes, as portas lidas do .env do Emissor, a lista do Painel e o repositorio do backup.
  const gravados = Object.fromEntries(sshCmds(calls).filter((c) => c.command.startsWith("python3 -I - '/opt/bunker707/infra/licencas/.env'")).map((c) => {
    const [, chave, b64] = c.command.match(/'\/opt\/bunker707\/infra\/licencas\/\.env' '([A-Z_]+)' '([^']*)'/);
    return [chave, Buffer.from(b64, "base64").toString()];
  }));
  assert.equal(gravados.LICENCAS_API_DOMAIN, API);
  assert.equal(gravados.LICENCAS_PAINEL_DOMAIN, PAINEL);
  assert.equal(gravados.EMISSOR_PORTA_NO_HOST, "8080");
  assert.equal(gravados.PAINEL_PORTA_NO_HOST, "8081");
  assert.equal(gravados.LICENCAS_PAINEL_IPS, "203.0.113.10/32 2001:db8:1234::/48");
  assert.equal(gravados.RESTIC_REPOSITORY, "sftp:storagebox:bunker707/restic-licencas");
  assert.equal(gravados.STORAGE_BOX_USER, "u100");
  assert.equal(gravados.BACKUP_KEEP_HOURLY, "48");
  assert.equal(gravados.BACKUP_KEEP_DAILY, "30");
  assert.equal(gravados.RESTIC_PASSWORD, undefined, "a senha do restic nasce no servidor");
  assert.ok(at("openssl rand -hex 32") > 0);
  assert.match(calls[init].stdin, /^[0-9a-f]{64}\n?$/, "a senha de recuperacao (derivada do token) vai pelo stdin");
  assert.ok(!conta.hz().firewalls[0].rules.some((r) => r.port === "22"), "a 22 termina fechada");
  assert.match(result.stderr, /ainda nao respondeu \{"ok":true\} de fora/, "sem o nome no ar, so o aviso");
});

test("deploy-licencas para antes do SSH sem o DNS certo, sem as raizes ou com a lista do Painel ampla demais", { skip }, () => {
  const base = { ...PAINEL_ENV, GITHUB_TOKEN: "ghs_x", LICENCAS_RAIZES: RAIZES };
  const comAAAA = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas(), storageBox: { name: "bunker707-backups", username: "u", server: "h" }, records: [record(PAINEL, "A", IP, true), record(API, "A", IP, false), record(API, "AAAA", "2001:db8::1", false)] });
  const aaaa = comAAAA.runScript("licencas.sh", base, ["deploy"]);
  assert.equal(aaaa.status, 1);
  assert.match(aaaa.stderr, /DNS do Emissor fora do lugar: licencas-api\.bunker707\.com\.br .*Rode dns-licencas antes do deploy-licencas/);
  assert.equal(sshCmds(comAAAA.calls()).length, 0);

  const comProxy = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas(), records: [record(PAINEL, "A", IP, true), record(API, "A", IP, true)] });
  assert.match(comProxy.runScript("licencas.sh", base, ["deploy"]).stderr, /esperado: A 192\.0\.2\.7 proxy=false; achado: A 192\.0\.2\.7 proxy=true/);

  const semRaizes = setup({ servers: [servidorLicencas()] }).runScript("licencas.sh", { GITHUB_TOKEN: "ghs_x" }, ["deploy"]);
  assert.match(semRaizes.stderr, /Variavel LICENCAS_RAIZES ausente/);
  const ampla = setup({ servers: [servidorLicencas()] }).runScript("licencas.sh", { ...base, LICENCAS_PAINEL_IPS: "0.0.0.0/0" }, ["deploy"]);
  assert.match(ampla.stderr, /LICENCAS_PAINEL_IPS tem um IP invalido ou uma rede ampla demais/);
});

test("deploy-licencas sem a configuracao do Painel, ou com ela fora do formato, para antes de qualquer chamada; so LICENCAS_SEM_PAINEL=sim sobe o Emissor sem o Painel", { skip }, () => {
  const base = { GITHUB_TOKEN: "ghs_x", LICENCAS_RAIZES: RAIZES };
  const recusa = (extra, mensagem) => {
    const conta = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas() });
    const result = conta.runScript("licencas.sh", { ...base, ...extra }, ["deploy"]);
    assert.equal(result.status, 1, `${JSON.stringify(extra)}: ${result.stdout}`);
    assert.match(result.stderr, mensagem);
    assert.deepEqual(conta.calls(), [], "nada chamado: nem a Hetzner, nem a Cloudflare, nem o servidor");
    return result;
  };
  recusa({}, /falta a configuracao do Painel de licencas: LICENCAS_PAINEL_ACCESS_EQUIPE, LICENCAS_PAINEL_ACCESS_AUD, LICENCAS_EMISSOR_EMAIL_REMETENTE\. Cadastre como variavel do repositorio no GitHub .* LICENCAS_SEM_PAINEL=sim para subir o Emissor sem o Painel/);
  recusa({ ...PAINEL_ENV, LICENCAS_PAINEL_ACCESS_AUD: "" }, /falta a configuracao do Painel de licencas: LICENCAS_PAINEL_ACCESS_AUD\./);
  recusa({ ...PAINEL_ENV, LICENCAS_PAINEL_ACCESS_AUD: AUD.toUpperCase() }, /LICENCAS_PAINEL_ACCESS_AUD precisa ser a etiqueta AUD do aplicativo do Painel no Access/);
  recusa({ ...PAINEL_ENV, LICENCAS_PAINEL_ACCESS_EQUIPE: PAINEL }, /LICENCAS_PAINEL_ACCESS_EQUIPE precisa ser o dominio da equipe no Cloudflare Zero Trust, <equipe>\.cloudflareaccess\.com \(veio licencas\.bunker707\.com\.br\)/);
  recusa({ ...PAINEL_ENV, LICENCAS_EMISSOR_EMAIL_REMETENTE: "Emissor 'Bunker' <emissor@mail.bunker707.com.br>" }, /LICENCAS_EMISSOR_EMAIL_REMETENTE precisa ser um e-mail, ou Nome <e-mail>/);
  recusa({ ...PAINEL_ENV, LICENCAS_EMISSOR_EMAIL_REMETENTE: "emissor" }, /LICENCAS_EMISSOR_EMAIL_REMETENTE precisa ser um e-mail/);
  const produtor = recusa({ ...PAINEL_ENV, PRODUCER_EMAIL: "produtor-sem-arroba" }, /LICENCAS_EMISSOR_EMAIL_PRODUTOR \(sem ele, PRODUCER_EMAIL\) nao e um e-mail\./);
  assert.doesNotMatch(produtor.stderr, /produtor-sem-arroba/, "o e-mail do produtor nao vai para o log");
  recusa({ ...PAINEL_ENV, LICENCAS_PAINEL_TETO_DIARIO: "0" }, /LICENCAS_PAINEL_TETO_DIARIO precisa ser um numero de 1 a 1000 \(veio 0\)/);
  recusa({ ...PAINEL_ENV, LICENCAS_EMISSOR_KIDS_ANTERIORES: "Emissao_2026" }, /LICENCAS_EMISSOR_KIDS_ANTERIORES precisa ser uma lista de ate 8 kid/);
  recusa({ ...PAINEL_ENV, LICENCAS_EMISSOR_LINK_LOJA: "http://membros.bunker707.com.br/modulos" }, /LICENCAS_EMISSOR_LINK_LOJA precisa ser um endereco https:\/\//);
  recusa({ ...PAINEL_ENV, LICENCAS_SEM_PAINEL: "talvez" }, /LICENCAS_SEM_PAINEL so aceita sim \(veio talvez\)/);

  // Sem o Painel: o JSON vai com o Painel e o e-mail vazios; o teto, as chaves anteriores e os links seguem.
  const conta = setup({
    servers: [servidorLicencas()],
    firewalls: firewallLicencas(),
    storageBox: { name: "bunker707-backups", username: "u100", server: "u100.your-storagebox.de" },
    records: [record(PAINEL, "A", IP, true), record(API, "A", IP, false)]
  });
  const link = "https://membros.bunker707.com.br/minhas-licencas/{licenca}/renovar";
  const result = conta.runScript("licencas.sh", { ...base, LICENCAS_SEM_PAINEL: "sim", LICENCAS_EMISSOR_KIDS_ANTERIORES: "emissao-2026-11, emissao-2025-10", LICENCAS_EMISSOR_LINK_RENOVAR: link, PUBLICO_TENTATIVAS: "1" }, ["deploy"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const implantar = sshCmds(conta.calls()).find((c) => c.command.includes("bash infra/licencas/scripts/implantar.sh"));
  assert.deepEqual(configDe(implantar.command), {
    PAINEL_ENDERECO: "",
    PAINEL_ACCESS_EQUIPE: "",
    PAINEL_ACCESS_AUD: "",
    PAINEL_TETO_DIARIO: "10",
    EMISSOR_EMAIL_PRODUTOR: "",
    EMISSOR_EMAIL_REMETENTE: "",
    EMISSOR_KIDS_ANTERIORES: "emissao-2026-11,emissao-2025-10",
    EMISSOR_LINK_RENOVAR: link,
    EMISSOR_LINK_LOJA: ""
  });
  assert.match(result.stdout, /Sem o Painel \(LICENCAS_SEM_PAINEL=sim\): o Emissor sobe sem ele e sem e-mail/);
  assert.match(result.stdout, /Emissor no ar: https:\/\/licencas-api\.bunker707\.com\.br \(API das Instalacoes\), sem o Painel/);
  assert.doesNotMatch(result.stdout, /A primeira conta do Painel/);
});

test("restaurar-licencas exige CONFIRMAR=restaurar; o ensaio e o backup rodam os scripts do servidor com o backup escolhido", { skip }, () => {
  const conta = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas() });
  const recusa = conta.runScript("licencas.sh", {}, ["restaurar"]);
  assert.equal(recusa.status, 1);
  assert.match(recusa.stderr, /Confirme com CONFIRMAR=restaurar/);
  assert.deepEqual(conta.calls(), []);
  assert.match(conta.runScript("licencas.sh", { SNAPSHOT: "abc; rm -rf /" }, ["ensaio"]).stderr, /SNAPSHOT precisa ser o id de um backup/);

  const ok = conta.runScript("licencas.sh", { CONFIRMAR: "restaurar", SNAPSHOT: "1a2b3c4d", PUBLICO_TENTATIVAS: "1" }, ["restaurar"]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.ok(indexOfCmd(conta.calls(), "bash infra/licencas/scripts/restore.sh --yes --snapshot=1a2b3c4d") > 0);
  const ensaio = conta.runScript("licencas.sh", {}, ["ensaio"]);
  assert.equal(ensaio.status, 0, ensaio.stderr);
  assert.ok(indexOfCmd(conta.calls(), "bash infra/licencas/scripts/restore.sh --ensaio") > 0);
  const backup = conta.runScript("licencas.sh", {}, ["backup"]);
  assert.equal(backup.status, 0, backup.stderr);
  assert.ok(indexOfCmd(conta.calls(), "bash infra/licencas/scripts/backup.sh --check") > 0);
});

test("o servidor de licencas recebe so infra/licencas e o que ela usa, nunca o codigo do produto", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "bunker707-sync-licencas-"));
  try {
    const tarFile = join(dir, "envio.tar");
    const result = spawnSync("bash", ["-c", `. "${join(cloudDir, "lib.sh")}"; rsh() { [ "$2" != "\${2#mkdir}" ] && cat > "$TAR_OUT" || true; }; sync_repo deploy@x infra/licencas infra/scripts/lib.sh infra/compose/caddy/cloudflare-trusted-proxies.caddyfile`], { encoding: "utf8", env: { ...process.env, TAR_OUT: tarFile, TMPDIR: dir } });
    assert.equal(result.status, 0, result.stderr);
    const files = spawnSync("tar", ["-tf", tarFile], { encoding: "utf8" }).stdout.split("\n").filter((f) => f && !f.endsWith("/"));
    assert.ok(files.includes("infra/licencas/caddy/Caddyfile") && files.includes("infra/licencas/scripts/backup.sh") && files.includes("infra/scripts/lib.sh"), files.join(" "));
    assert.ok(files.every((f) => f.startsWith("infra/licencas/") || f === "infra/scripts/lib.sh" || f === "infra/compose/caddy/cloudflare-trusted-proxies.caddyfile" || f === "pax_global_header"), `arquivo fora da infra de licencas: ${files.find((f) => !f.startsWith("infra/"))}`);
    assert.ok(!files.some((f) => f.startsWith("src/") || f.startsWith("supabase/")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fw_rules_licencas: 80 e 443 de qualquer lugar, ping, nada de UDP, e a 22 so para o CIDR da etapa", { skip }, () => {
  const rules = (args) => JSON.parse(spawnSync("bash", ["-c", `. "${join(cloudDir, "lib.sh")}"; fw_rules_for ${LICENCAS} ${args}`], { encoding: "utf8", env: { ...process.env, TMPDIR: tmpdir() } }).stdout);
  const fechado = rules("");
  assert.deepEqual(fechado.map((r) => `${r.protocol}/${r.port ?? "-"}`), ["tcp/80", "tcp/443", "icmp/-"]);
  assert.ok(fechado.every((r) => r.source_ips.join() === "0.0.0.0/0,::/0"));
  const aberto = rules("203.0.113.7/32");
  assert.deepEqual(aberto[0], { direction: "in", protocol: "tcp", port: "22", source_ips: ["203.0.113.7/32"], description: "SSH (sessao de deploy / produtor)" });
});

test("Caddy do servidor de licencas: a API so com /v1 e /health e o IP da conexao; o Painel so com a lista de IPs e o token do Access", () => {
  const site = (variavel) => {
    const start = caddyfile.indexOf(`{$${variavel}} {`);
    assert.ok(start > 0, variavel);
    const end = caddyfile.indexOf("\n}\n", start);
    return caddyfile.slice(start, end);
  };
  const global = caddyfile.slice(0, caddyfile.indexOf("(sem_server)"));
  assert.match(global, /import \/etc\/caddy\/cloudflare-trusted-proxies\.caddyfile/);
  assert.match(global, /^\t\tclient_ip_headers CF-Connecting-IP$/m, "so o CF-Connecting-IP, e so das faixas da Cloudflare");
  assert.match(global, /protocols h1 h2/);

  const api = site("LICENCAS_API_SITE_ADDRESS");
  assert.match(api, /@api path \/v1\/\* \/health/);
  assert.match(api, /reverse_proxy 127\.0\.0\.1:\{\$EMISSOR_PORTA_NO_HOST\} \{\n\t\t\t# .*\n\t\t\theader_up X-Forwarded-For \{remote_host\}/, "um IP so no X-Forwarded-For: o da conexao");
  assert.match(api, /max_size 64KB/);
  assert.match(api, /handle \{\n\t\trespond 404\n\t\}/);
  assert.doesNotMatch(api, /PAINEL_PORTA_NO_HOST|client_ip/);

  const painel = site("LICENCAS_PAINEL_SITE_ADDRESS");
  assert.match(painel, /@permitido \{\n\t\tclient_ip \{\$LICENCAS_PAINEL_IPS\}\n\t\theader Cf-Access-Jwt-Assertion \*\n\t\}/);
  assert.match(painel, /handle @permitido \{\n\t\treverse_proxy 127\.0\.0\.1:\{\$PAINEL_PORTA_NO_HOST\} \{\n\t\t\theader_up X-Forwarded-For \{client_ip\}/);
  assert.match(painel, /handle \{\n\t\trespond 403\n\t\}/);
  assert.doesNotMatch(painel, /header_up -Cf-Access/, "os cabecalhos do Access chegam ao Painel");

  // O compose: Caddy fixado na mesma versao dos outros servidores, na rede do servidor, com as portas pelos nomes do
  // .env.example do bunker-licensing (EMISSOR_PORTA_NO_HOST) e o do Painel (PAINEL_PORTA_NO_HOST, ainda a confirmar).
  assert.match(caddyCompose, /^    image: caddy:2\.11\.7-alpine$/m);
  assert.match(readFileSync(join(root, "infra/mautic/docker-compose.yml"), "utf8"), /image: caddy:2\.11\.7-alpine/);
  assert.match(caddyCompose, /^    network_mode: host$/m);
  assert.doesNotMatch(caddyCompose, /^\s+ports:/m);
  assert.match(caddyCompose, /EMISSOR_PORTA_NO_HOST: \$\{EMISSOR_PORTA_NO_HOST:-8080\}/);
  assert.match(caddyCompose, /PAINEL_PORTA_NO_HOST: \$\{PAINEL_PORTA_NO_HOST:-8081\}/);
  assert.match(caddyCompose, /LICENCAS_PAINEL_IPS: \$\{LICENCAS_PAINEL_IPS:-127\.0\.0\.1\/32\}/, "sem lista, ninguem abre o Painel");
});

test("lib.sh: os nomes do servidor de licencas sao variaveis com padrao, e a API fica fora do proxy da Cloudflare", () => {
  const out = spawnSync("bash", ["-c", `. "${join(cloudDir, "lib.sh")}"; echo "$LICENCAS_NAME $LICENCAS_PAINEL_DOMAIN $LICENCAS_API_DOMAIN $LICENCAS_IMAGEM:$LICENCAS_TAG $LICENCAS_RESTIC_REPOSITORY $LICENCAS_MIN_RAM_GB $LICENCAS_ARQUITETURAS"`], { encoding: "utf8", env: { ...process.env, TMPDIR: tmpdir() } });
  assert.equal(out.stdout.trim(), "bunker707-licencas licencas.bunker707.com.br licencas-api.bunker707.com.br ghcr.io/danilosouza-dev/bunker-licensing:main sftp:storagebox:bunker707/restic-licencas 2 x86 arm");
  const outro = spawnSync("bash", ["-c", `. "${join(cloudDir, "lib.sh")}"; echo "$LICENCAS_API_DOMAIN"; licencas_sub "$LICENCAS_API_DOMAIN"; echo; licencas_sub api.outra.zona`], { encoding: "utf8", env: { ...process.env, TMPDIR: tmpdir(), LICENCAS_API_DOMAIN: "ativacao.bunker707.com.br" } });
  assert.match(outro.stdout, /^ativacao\.bunker707\.com\.br\nativacao\n$/);
  assert.match(outro.stderr, /api\.outra\.zona nao esta na zona bunker707\.com\.br/);
});

test("infra/licencas/.env.example traz toda variavel que o Caddy e os scripts do servidor de licencas leem do .env", () => {
  const example = new Set([...readFileSync(join(root, "infra/licencas/.env.example"), "utf8").matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
  const lidas = new Set([...caddyCompose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]));
  const scripts = join(root, "infra/licencas/scripts");
  for (const file of ["backup.sh", "restore.sh", "implantar.sh", "smoke.sh", "_env.sh"]) {
    for (const m of readFileSync(join(scripts, file), "utf8").matchAll(/(?<!ENV_FILE="[^"]*" )\b(?:require_)?env_value ([A-Z][A-Z0-9_]*)/g)) lidas.add(m[1]);
  }
  // O alias do Storage Box (storagebox_ssh_alias, infra/scripts/lib.sh) le usuario, host e porta do mesmo .env.
  for (const nome of ["STORAGE_BOX_USER", "STORAGE_BOX_HOST", "STORAGE_BOX_SSH_PORT"]) lidas.add(nome);
  const faltam = [...lidas].filter((nome) => !example.has(nome));
  assert.deepEqual(faltam, [], `faltam no .env.example: ${faltam.join(", ")}`);
  assert.ok(lidas.has("RESTIC_PASSWORD") && lidas.has("BACKUP_KEEP_HOURLY") && lidas.has("LICENCAS_PAINEL_IPS"));
});

test("status-licencas so le: servidor, preco, DNS com aviso de AAAA e respostas publicas; sem SSH=1 nao abre a 22", { skip }, () => {
  const conta = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas(), records: [record(PAINEL, "A", IP, true), record(API, "A", IP, false), record(API, "AAAA", "2001:db8::1", false)] });
  const result = conta.runScript("licencas.sh", { GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/dev" }, ["status"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /bunker707-licencas: cx23 em fsn1, 192\.0\.2\.7, running/);
  assert.match(result.stdout, /preco: EUR 6\.4900\/mes sem IVA, mais o IPv4/);
  assert.match(result.stderr, /licencas-api\.bunker707\.com\.br tem AAAA: a conferencia inicial so funciona por IPv4/);
  assert.match(result.stdout, /https:\/\/licencas-api\.bunker707\.com\.br\/health\s+000 \(esperado 200\)/);
  const calls = conta.calls();
  assert.ok(!calls.some((c) => c.tool === "ssh"), "sem SSH=1, nenhum SSH");
  assert.ok(!calls.some((c) => c.tool === "hcloud" && /create|delete|replace-rules|apply/.test(c.args.join(" "))), "nada muda na Hetzner");
  assert.ok(!calls.some((c) => c.tool === "curl" && ["POST", "PUT", "PATCH", "DELETE"].includes(c.method) && c.url.includes("api.cloudflare.com")), "nada muda na Cloudflare");
  assert.deepEqual(conta.hz().firewalls[0].rules, [], "o firewall nao foi tocado");
});

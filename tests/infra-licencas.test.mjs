import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const INTERNO = "licencas-interno.bunker707.com.br";

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
// O Painel entra com e-mail e senha (docs/32 D40): nada do Cloudflare Access nem da lista de IPs. Todas tem padrao.
const PAINEL_ENV = {
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

test("dns-licencas: so registros A, o Painel com proxy e a API e a API interna sem; AAAA que existir sai, e o resto da zona fica", { skip }, () => {
  const conta = setup({
    servers: [servidorLicencas()],
    firewalls: firewallLicencas(),
    records: [
      record(PAINEL, "AAAA", "2001:db8::1", true),
      record(API, "AAAA", "2001:db8::1", false),
      record(API, "A", "203.0.113.99", true),
      record(INTERNO, "AAAA", "2001:db8::1", false),
      record("membros.bunker707.com.br", "AAAA", "2001:db8:a1::1", true)
    ]
  });
  const result = conta.runScript("licencas.sh", {}, ["dns"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const records = conta.cf().records;
  const de = (name) => records.filter((r) => r.name === name).map((r) => [r.type, r.content, r.proxied]);
  assert.deepEqual(de(PAINEL), [["A", IP, true]]);
  assert.deepEqual(de(API), [["A", IP, false]], "a API sem proxy: nenhum desafio de robos, so IPv4");
  assert.deepEqual(de(INTERNO), [["A", IP, false]], "a API interna sem proxy: o Caddy do Emissor confere o IP da propria conexao");
  assert.deepEqual(de("membros.bunker707.com.br"), [["AAAA", "2001:db8:a1::1", true]], "os outros nomes nao mudam");
  assert.ok(!conta.calls().some((c) => c.tool === "curl" && c.method === "POST" && JSON.parse(c.data ?? "{}").type === "AAAA"), "nunca cria AAAA");
  assert.deepEqual(conta.cf().settings, { ssl: "strict", always_use_https: "off" });
  assert.match(result.stdout, /com o proxy da Cloudflare; o login e o de e-mail e senha do proprio Painel \(D40\)/);
  assert.doesNotMatch(result.stdout, /Access/, "o Painel nao pede o Cloudflare Access (D40)");
  assert.match(result.stdout, /licencas-interno\.bunker707\.com\.br -> 192\.0\.2\.7 sem proxy: a API interna, que o Caddy do Emissor so abre para o IPv4 do servidor da nossa escola/);

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
  assert.deepEqual(etapas.sort(), ["backup-licencas", "cerimonia-licencas", "conectar-licencas", "deploy-licencas", "dns-licencas", "ensaio-licencas", "exec-licencas", "plan-licencas", "provision-licencas", "restaurar-licencas", "secrets-licencas", "status-licencas"]);
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
  for (const [script, args, confirmar] of [["licencas.sh", ["dns"]], ["licencas.sh", ["deploy"]], ["licencas.sh", ["segredos"]], ["licencas.sh", ["cerimonia"]], ["licencas.sh", ["restaurar"]], ["licencas.sh", ["conectar"], "conectar"], ["provision.sh", ["licencas"]], ["run.sh", ["exec-licencas"]]]) {
    const recusa = conta.runScript(script, { GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/dev", CONFIRMADO: "sim", CONFIRMAR: confirmar ?? "restaurar", COMANDO: "true" }, args);
    assert.equal(recusa.status, 1, `${script} ${args}`);
    assert.match(recusa.stderr, /As etapas que mudam o servidor de licencas so rodam da main \(recebido: refs\/heads\/dev\)/, `${script} ${args}`);
  }
  assert.deepEqual(conta.calls(), [], "nada chamado fora da main");
  const plano = setup({ tipos: TIPOS }).runScript("licencas.sh", { GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/dev" }, ["plan"]);
  assert.equal(plano.status, 0, "plan-licencas so le");
});

test("o workflow so entrega cada segredo LICENCAS_* na etapa que o usa, e nenhum e obrigatorio depois da cerimonia; a configuracao do Painel vem das variaveis do repositorio, so no deploy", () => {
  const step = workflow.slice(workflow.indexOf("      - name: ${{ inputs.etapa }}"), workflow.indexOf("      - name: Fechar o SSH (sempre)"));
  const todas = [...step.matchAll(/^ {10}(LICENCAS_[A-Z_]+): \$\{\{ (.+) \}\}$/gm)].map((m) => [m[1], m[2]]);
  const linhas = todas.filter(([, expressao]) => expressao.includes("secrets."));
  assert.deepEqual(linhas.map(([nome]) => nome).sort(), ["LICENCAS_BANCO_SENHA", "LICENCAS_EMISSAO_CERTIFICADO", "LICENCAS_EMISSAO_CHAVE", "LICENCAS_EMISSAO_SENHA", "LICENCAS_RAIZES", "LICENCAS_RESEND_CHAVE"]);
  for (const [nome, expressao] of linhas) {
    assert.match(expressao, new RegExp(`^\\(?inputs\\.etapa == '(secrets|deploy)-licencas'.*&& secrets\\.${nome} \\|\\| ''$`), `${nome} so na etapa certa`);
  }
  // As variaveis do repositorio (nao sao segredo): o Painel, a conta de envio, as chaves anteriores, os links e o "sem Painel".
  const variaveis = todas.filter(([, expressao]) => !expressao.includes("secrets."));
  assert.deepEqual(variaveis.map(([nome]) => nome).sort(), ["LICENCAS_EMISSOR_EMAIL_PRODUTOR", "LICENCAS_EMISSOR_EMAIL_REMETENTE", "LICENCAS_EMISSOR_KIDS_ANTERIORES", "LICENCAS_EMISSOR_LINK_LOJA", "LICENCAS_EMISSOR_LINK_RENOVAR", "LICENCAS_PAINEL_TETO_DIARIO", "LICENCAS_SEM_PAINEL"]);
  assert.doesNotMatch(workflow, /PAINEL_ACCESS|LICENCAS_PAINEL_IPS/, "nada do Cloudflare Access nem da lista de IPs no workflow (D40)");
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
  // O deploy precisa das raizes publicas: o infra/licencas/raizes.json da cerimonia, ou o segredo de antes.
  const conferencia = presentes.match(/case "\$ETAPA" in deploy-licencas\) (.+) ;; esac/)[1];
  const roda = (comArquivo, tem) => {
    const dir = mkdtempSync(join(tmpdir(), "bunker707-presentes-"));
    try {
      if (comArquivo) { spawnSync("mkdir", ["-p", join(dir, "infra/licencas")]); writeFileSync(join(dir, "infra/licencas/raizes.json"), RAIZES); }
      return spawnSync("bash", ["-c", conferencia], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH, TEM_LICENCAS_RAIZES: tem } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  assert.equal(roda(true, "false").status, 0, "com o raizes.json, sem segredo nenhum");
  assert.equal(roda(false, "true").status, 0, "sem o arquivo, o segredo de antes");
  const falta = roda(false, "false");
  assert.equal(falta.status, 1);
  assert.match(falta.stdout, /::error::Faltam as raizes publicas: rode cerimonia-licencas/);
  assert.doesNotMatch(presentes, /TEM_LICENCAS_EMISSAO|secrets-licencas\)/, "o secrets-licencas nao exige mais os segredos da chave de emissao");
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
  assert.match(vazia.stderr, /Sem a chave do Resend \(nem o envelope no payload, nem LICENCAS_RESEND_CHAVE\): sem ela o Painel nao sobe .*LICENCAS_SEM_PAINEL=sim/);
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

test("secrets-licencas depois da cerimonia: sem os segredos da chave de emissao, mantem a do servidor; sem ela no servidor, manda rodar a cerimonia; os tres andam juntos", { skip }, () => {
  const semEmissao = { LICENCAS_RESEND_CHAVE: SEGREDOS.LICENCAS_RESEND_CHAVE };
  const conta = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas() });
  const result = conta.runScript("licencas.sh", semEmissao, ["segredos"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = sshCmds(conta.calls());
  assert.ok(calls.some((c) => c.command.includes('for f in emissao.pem emissao-senha emissao-certificado.json; do test -s')), "confere a chave da cerimonia no servidor");
  for (const arquivo of ["emissao.pem", "emissao-senha", "emissao-certificado.json"]) {
    assert.ok(!calls.some((c) => c.command.includes(`mv -f "$t" "/opt/bunker707/emissor/segredos/${arquivo}"`)), `${arquivo} nao e trocado`);
  }
  assert.match(result.stdout, /os da cerimonia-licencas, ja no servidor \(mantidos\)/);
  assert.ok(calls.some((c) => c.command.includes('mv -f "$t" "/opt/bunker707/emissor/segredos/resend-chave"')), "a chave do Resend do segredo vai");

  const semChave = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas() });
  const recusa = semChave.runScript("licencas.sh", { ...semEmissao, SSH_SHIM_REPLIES: JSON.stringify([{ contem: "do test -s", codigo: 1 }]) }, ["segredos"]);
  assert.equal(recusa.status, 1);
  assert.match(recusa.stderr, /Falta a chave de emissao no servidor .*rode a etapa cerimonia-licencas da main, com CONFIRMAR=cerimonia/);
  assert.ok(!semChave.hz().firewalls[0].rules.some((r) => r.port === "22"), "a 22 fecha mesmo com a recusa");

  const metade = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas() });
  const parcial = metade.runScript("licencas.sh", { LICENCAS_EMISSAO_CHAVE: SEGREDOS.LICENCAS_EMISSAO_CHAVE }, ["segredos"]);
  assert.equal(parcial.status, 1);
  assert.match(parcial.stderr, /andam juntos\. Com a cerimonia-licencas .* nenhum dos tres e preciso/);
  assert.deepEqual(metade.calls(), []);
});

test("secrets-licencas com o envelope no payload: a chave do Resend so e aberta no servidor e vai direto para segredos/resend-chave", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "bunker707-envelope-licencas-"));
  try {
    // A transfer.key do servidor e o envelope que a IA monta com a chave criada pelo conector do Resend.
    spawnSync("openssl", ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", join(dir, "transfer.key")]);
    spawnSync("openssl", ["pkey", "-in", join(dir, "transfer.key"), "-pubout", "-out", join(dir, "transfer.pub")]);
    writeFileSync(join(dir, "kv"), "RESEND_API_KEY=re_chave_do_envelope_0001\n");
    const envelope = spawnSync("bash", [join(cloudDir, "envelope.sh"), "encrypt", join(dir, "transfer.pub"), join(dir, "kv")], { encoding: "utf8" }).stdout.trim();
    assert.match(envelope, /^[A-Za-z0-9+/]+=*\.[A-Za-z0-9+/]+=*$/);

    const conta = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas() });
    const result = conta.runScript("licencas.sh", { PAYLOAD: envelope, LICENCAS_RESEND_CHAVE: "re_segredo_que_perde_para_o_envelope" }, ["segredos"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const calls = sshCmds(conta.calls());
    const payload = calls.find((c) => c.command.includes("cat > /tmp/payload-licencas.b64"));
    assert.equal(payload.stdin, envelope.slice(0, 80), "o envelope (cifrado) vai pelo stdin");
    const abre = calls.find((c) => c.command.includes("envelope-licencas.sh decrypt /etc/bunker707/transfer.key"));
    assert.ok(abre, "o servidor abre o envelope com a transfer.key dele");
    assert.ok(!calls.some((c) => c.command.includes('segredos/resend-chave"\'') && c.command.includes("mv -f")), "nada da chave sai do runner");
    const tudo = calls.map((c) => `${c.command}\n${c.stdin}`).join("\n") + result.stdout + result.stderr;
    assert.ok(!tudo.includes("re_chave_do_envelope") && !tudo.includes("re_segredo_que_perde"), "a chave nunca em texto no runner, no log ou no SSH");

    // O programa que roda no servidor, de verdade: o envelope aberto com a transfer.key, a chave conferida e gravada.
    const programa = join(dir, "programa.py");
    const remoto = abre.command;
    const ssh = conta.calls().find((c) => c.tool === "ssh" && c.command === remoto);
    assert.ok(ssh);
    const pasta = join(dir, "segredos");
    spawnSync("mkdir", ["-p", pasta]);
    const fonte = readFileSync(join(cloudDir, "licencas.sh"), "utf8");
    writeFileSync(programa, fonte.slice(fonte.indexOf("import os, re, sys, tempfile"), fonte.indexOf("PY\n}\nsegredos() {")));
    const abrir = (kv) => {
      writeFileSync(join(dir, "kv2"), kv);
      const env = spawnSync("bash", [join(cloudDir, "envelope.sh"), "encrypt", join(dir, "transfer.pub"), join(dir, "kv2")], { encoding: "utf8" }).stdout.trim();
      writeFileSync(join(dir, "payload.b64"), env);
      return spawnSync("bash", ["-c", `set -o pipefail; bash "${join(cloudDir, "envelope.sh")}" decrypt "${join(dir, "transfer.key")}" "${join(dir, "payload.b64")}" | python3 -c "import os; os.chown = lambda *a: None; exec(open('${programa}').read())" "${pasta}"`], { encoding: "utf8" });
    };
    const ok = abrir("EMAIL_PROVIDER=resend\nRESEND_API_KEY=re_chave_do_envelope_0001\n");
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(readFileSync(join(pasta, "resend-chave"), "utf8"), "re_chave_do_envelope_0001");
    assert.match(ok.stdout, /segredos\/resend-chave \(do envelope; so este servidor o abre\)/);
    assert.doesNotMatch(ok.stdout + ok.stderr, /re_chave/);
    const ruim = abrir("RESEND_API_KEY=chave sem prefixo\n");
    assert.equal(ruim.status, 1);
    assert.match(ruim.stderr, /fora do formato/);
    const semLinha = abrir("OUTRA=1\n");
    assert.equal(semLinha.status, 1);
    assert.match(semLinha.stderr, /nao traz a linha RESEND_API_KEY/);

    const malFeito = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas() });
    const recusa = malFeito.runScript("licencas.sh", { PAYLOAD: "isto nao e um envelope" }, ["segredos"]);
    assert.equal(recusa.status, 1);
    assert.match(recusa.stderr, /PAYLOAD nao e um envelope de infra\/cloud\/envelope\.sh/);
    assert.deepEqual(malFeito.calls(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
    records: [record(PAINEL, "A", IP, true), record(API, "A", IP, false), record(INTERNO, "A", IP, false)]
  });
  const TOKEN = "ghs_token_efemero_do_job_0001";
  const result = conta.runScript("licencas.sh", {
    ...PAINEL_ENV,
    GITHUB_TOKEN: TOKEN,
    GITHUB_ACTOR: "danilosouza-dev",
    LICENCAS_RAIZES: RAIZES,
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
  // O Painel e a conta de envio, como o Emissor confere ao subir: o endereco vem do nome do Painel, o produtor (o
  // PRODUCER_EMAIL, sem a variavel) em minusculas, e o teto padrao. Nada do Access (D40).
  assert.deepEqual(configDe(imp), {
    PAINEL_ENDERECO: `https://${PAINEL}`,
    PAINEL_TETO_DIARIO: "10",
    EMISSOR_EMAIL_PRODUTOR: "produtor@exemplo.com.br",
    EMISSOR_EMAIL_REMETENTE: "Emissor Bunker707 <emissor@mail.bunker707.com.br>",
    EMISSOR_KIDS_ANTERIORES: "",
    EMISSOR_LINK_RENOVAR: "",
    EMISSOR_LINK_LOJA: ""
  });
  const geridas = JSON.parse(readFileSync(join(root, "infra/licencas/scripts/implantar.sh"), "utf8").match(/GERIDAS = (\[[^\]]+\])/)[1]);
  assert.deepEqual(Object.keys(configDe(imp)).sort(), geridas, "o JSON do deploy traz exatamente as variaveis que o implantar.sh confere");
  assert.match(result.stdout, /Painel em https:\/\/licencas\.bunker707\.com\.br \(login de e-mail e senha, de qualquer internet, D40; teto de 10 /);
  assert.doesNotMatch(result.stdout + result.stderr, /produtor@exemplo/i, "o e-mail do produtor nao vai para o log");
  // A conta do produtor no Painel, depois do backup e com a 22 ainda aberta: o e-mail so pelo stdin, sem mostrar o link.
  const contaDoProdutor = at("bash infra/licencas/scripts/conta-do-produtor.sh");
  assert.ok(contaDoProdutor > timer, "a conta vem depois do Emissor no ar e do backup");
  assert.equal(calls[contaDoProdutor].stdin, "Produtor@Exemplo.com.br", "o e-mail do produtor vai pelo stdin do SSH");
  assert.equal(calls[contaDoProdutor].command, "cd '/opt/bunker707' && bash infra/licencas/scripts/conta-do-produtor.sh", "sem as opcoes, o link nunca aparece");
  assert.match(result.stdout, /O produtor define a senha pelo link de uso unico que o Emissor manda ao e-mail dele/);
  assert.match(calls[caddy].command, /run --rm --no-deps caddy caddy validate --config \/etc\/caddy\/Caddyfile --adapter caddyfile && .* up -d && .*caddy reload/);
  assert.match(calls[timer].command, /systemctl start bunker707-licencas-backup\.service/);
  // .env do lado nosso: os nomes, as portas lidas do .env do Emissor e o repositorio do backup; lista de IPs, nenhuma.
  const gravados = Object.fromEntries(sshCmds(calls).filter((c) => c.command.startsWith("python3 -I - '/opt/bunker707/infra/licencas/.env'")).map((c) => {
    const [, chave, b64] = c.command.match(/'\/opt\/bunker707\/infra\/licencas\/\.env' '([A-Z_]+)' '([^']*)'/);
    return [chave, Buffer.from(b64, "base64").toString()];
  }));
  assert.equal(gravados.LICENCAS_API_DOMAIN, API);
  assert.equal(gravados.LICENCAS_PAINEL_DOMAIN, PAINEL);
  assert.equal(gravados.EMISSOR_PORTA_NO_HOST, "8080");
  assert.equal(gravados.PAINEL_PORTA_NO_HOST, "8081");
  // A API interna: o endereco, a porta local do compose do Emissor e quem chega. Sem o servidor da escola (a producao
  // guardada em snapshot), ninguem de fora.
  assert.equal(gravados.LICENCAS_INTERNO_DOMAIN, INTERNO);
  assert.equal(gravados.INTERNO_PORTA_NO_HOST, "8082", "o padrao do compose do Emissor quando o .env dele nao diz");
  assert.equal(gravados.LICENCAS_INTERNO_IPS, "127.0.0.1/32");
  assert.match(result.stdout, /API interna -> 127\.0\.0\.1:8082, fechada para todos: o servidor da escola \(bunker707-membros\) nao existe agora/);
  assert.ok(at("python3 -I - '/opt/bunker707/infra/licencas/.env' 'LICENCAS_INTERNO_IPS'") < caddy, "a lista do Caddy e escrita antes de ele subir");
  assert.equal(gravados.LICENCAS_PAINEL_IPS, undefined, "o Painel nao tem lista de IPs (D40)");
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

test("deploy-licencas com a escola no ar: o Caddy do endereco interno abre so para o IPv4 dela, lido da API da Hetzner, e a porta e a do .env do Emissor", { skip }, () => {
  const conta = setup({
    servers: [servidorLicencas(), serverFixture("bunker707-membros", "membros", 1)],
    firewalls: firewallLicencas(),
    storageBox: { name: "bunker707-backups", username: "u100", server: "u100.your-storagebox.de" },
    records: [record(PAINEL, "A", IP, true), record(API, "A", IP, false), record(INTERNO, "A", IP, false)]
  });
  const result = conta.runScript("licencas.sh", {
    ...PAINEL_ENV,
    GITHUB_TOKEN: "ghs_x",
    LICENCAS_RAIZES: RAIZES,
    PUBLICO_TENTATIVAS: "1",
    SSH_SHIM_ENV: JSON.stringify({ INTERNO_PORTA_NO_HOST: "'8092'" })
  }, ["deploy"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const gravados = Object.fromEntries(sshCmds(conta.calls()).filter((c) => c.command.startsWith("python3 -I - '/opt/bunker707/infra/licencas/.env'")).map((c) => {
    const [, chave, b64] = c.command.match(/'\/opt\/bunker707\/infra\/licencas\/\.env' '([A-Z_]+)' '([^']*)'/);
    return [chave, Buffer.from(b64, "base64").toString()];
  }));
  assert.equal(gravados.LICENCAS_INTERNO_IPS, "192.0.2.1/32", "o IPv4 do bunker707-membros, /32; nunca o IPv6");
  assert.equal(gravados.INTERNO_PORTA_NO_HOST, "8092", "a porta do .env do Emissor, sem as aspas");
  assert.match(result.stdout, /API interna -> 127\.0\.0\.1:8092, so do servidor da escola \(bunker707-membros, 192\.0\.2\.1\/32\) e so \/interno\/v1\/\*/);
  // O deploy so le o servidor da escola: nada muda nele, e a 22 dele nunca abre.
  assert.ok(!conta.calls().some((c) => c.tool === "ssh" && String(c.target).includes("192.0.2.1")), "nenhum SSH no servidor da escola");
  assert.ok(!conta.calls().some((c) => c.tool === "hcloud" && c.args.join(" ").includes("bunker707-membros-fw")));
  assert.match(result.stdout, /conectar-licencas com CONFIRMAR=conectar: a API interna em https:\/\/licencas-interno\.bunker707\.com\.br/);
});

test("a conta do produtor no Painel (conta-do-produtor.sh): so quando nao existe; o link so por e-mail, conferido na fila; so com LICENCAS_MOSTRAR_LINK=sim e o e-mail falhando ele aparece", { skip }, () => {
  // As opcoes do deploy viram as do script.
  const conta = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas(), storageBox: { name: "bunker707-backups", username: "u100", server: "u100.your-storagebox.de" }, records: [record(PAINEL, "A", IP, true), record(API, "A", IP, false), record(INTERNO, "A", IP, false)] });
  const deploy = conta.runScript("licencas.sh", { ...PAINEL_ENV, GITHUB_TOKEN: "ghs_x", LICENCAS_RAIZES: RAIZES, PUBLICO_TENTATIVAS: "1", LICENCAS_NOVO_LINK: "sim", LICENCAS_MOSTRAR_LINK: "sim" }, ["deploy"]);
  assert.equal(deploy.status, 0, deploy.stdout + deploy.stderr);
  assert.ok(sshCmds(conta.calls()).some((c) => c.command.endsWith("conta-do-produtor.sh --novo-link --mostrar-link-se-falhar")));

  // O script de verdade, com um docker de mentira no lugar do compose do Emissor (o bin/painel.ts e a fila de e-mail).
  const dir = mkdtempSync(join(tmpdir(), "bunker707-conta-painel-"));
  try {
    const bin = join(dir, "bin");
    spawnSync("mkdir", ["-p", bin, join(dir, "emissor")]);
    const log = join(dir, "docker.log");
    writeFileSync(join(bin, "docker"), [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> "${log}"`,
      'case "$*" in',
      '  *" listar") printf "%s" "$SHIM_LISTAR" ;;',
      '  *" psql "*) cat > /dev/null; printf "%s\\n" "$SHIM_FILA" ;;',
      '  *" adicionar "*|*" redefinir-senha "*) printf "%s\\n" "$SHIM_PAINEL"; case "$*" in *--mostrar-link*) printf "%s\\n" "Link: https://licencas.bunker707.com.br/senha/TOKEN-DE-USO-UNICO" ;; esac; exit "${SHIM_PAINEL_CODIGO:-0}" ;;',
      "esac",
      ""
    ].join("\n"));
    chmodSync(join(bin, "docker"), 0o755);
    const script = join(root, "infra/licencas/scripts/conta-do-produtor.sh");
    const rodar = (env, args = []) => {
      writeFileSync(log, "");
      return spawnSync("bash", [script, ...args], { encoding: "utf8", input: "Produtor@Exemplo.com.br", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LICENCAS_EMISSOR_DIR: join(dir, "emissor"), ESPERA_EMAIL_INTERVALO: "0", ESPERA_EMAIL_TENTATIVAS: "3", ...env } });
    };
    const chamadas = () => readFileSync(log, "utf8");

    const existe = rodar({ SHIM_LISTAR: "outra@exemplo.com.br\tAtendente\tativa\nproDUTOR@exemplo.com.br\tProdutor\tativa\n" });
    assert.equal(existe.status, 0, existe.stderr);
    assert.match(existe.stdout, /A conta do produtor ja existe no Painel: nada a fazer/);
    assert.doesNotMatch(chamadas(), /adicionar|redefinir-senha/, "conta que existe nao e criada de novo");

    const nova = rodar({ SHIM_LISTAR: "", SHIM_PAINEL: "produtor@exemplo.com.br entrou no Painel como Produtor.", SHIM_FILA: "sent" });
    assert.equal(nova.status, 0, nova.stderr);
    assert.match(chamadas(), /exec -T emissor node bin\/painel\.ts adicionar produtor@exemplo\.com\.br --funcao produtor --motivo Primeira conta \(deploy-licencas\)\n/);
    assert.doesNotMatch(chamadas(), /--mostrar-link/, "o link nunca e pedido quando o e-mail sai");
    assert.match(chamadas(), /exec -T postgres psql -U emissor -d emissor -X -At -v ON_ERROR_STOP=1 -v e=produtor@exemplo\.com\.br/, "confere a fila do e-mail do link");
    assert.equal(nova.stdout, "  <e-mail do produtor> entrou no Painel como Produtor.\n  O link para definir a senha saiu por e-mail para o produtor (vale 60 minutos, uma vez so).\n");

    // O e-mail nao sai: sem a opcao, nenhum link na tela e o codigo 3 (o deploy so avisa).
    const falhou = rodar({ SHIM_LISTAR: "", SHIM_FILA: "failed" });
    assert.equal(falhou.status, 3);
    assert.match(falhou.stderr, /o e-mail com o link de senha nao saiu \(situacao na fila: failed\)/);
    assert.doesNotMatch(falhou.stdout + falhou.stderr, /TOKEN-DE-USO-UNICO|https:\/\/licencas/);
    // Com --mostrar-link-se-falhar (LICENCAS_MOSTRAR_LINK=sim): um link novo, so neste caso.
    const mostra = rodar({ SHIM_LISTAR: "", SHIM_FILA: "pending" }, ["--mostrar-link-se-falhar"]);
    assert.equal(mostra.status, 0, mostra.stderr);
    assert.match(chamadas(), /redefinir-senha produtor@exemplo\.com\.br --motivo O e-mail do link nao saiu \(deploy-licencas\) --mostrar-link/);
    assert.match(mostra.stdout, /Link: https:\/\/licencas\.bunker707\.com\.br\/senha\/TOKEN-DE-USO-UNICO/);
    const comEmail = rodar({ SHIM_LISTAR: "", SHIM_FILA: "sent" }, ["--mostrar-link-se-falhar"]);
    assert.doesNotMatch(comEmail.stdout, /TOKEN-DE-USO-UNICO/, "com o e-mail saindo, nem com a opcao o link aparece");
    // --novo-link: a conta que existe recebe outro link, pelo e-mail.
    const outro = rodar({ SHIM_LISTAR: "produtor@exemplo.com.br\tProdutor\tativa\n", SHIM_FILA: "sent" }, ["--novo-link"]);
    assert.equal(outro.status, 0, outro.stderr);
    assert.match(chamadas(), /redefinir-senha produtor@exemplo\.com\.br --motivo Link novo pedido pelo deploy-licencas\n/);
    for (const r of [nova, falhou, mostra, outro]) assert.doesNotMatch(r.stdout + r.stderr, /produtor@exemplo/i, "o e-mail do produtor nunca na saida");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deploy-licencas para antes do SSH sem o DNS certo ou sem as raizes", { skip }, () => {
  const base = { ...PAINEL_ENV, GITHUB_TOKEN: "ghs_x", LICENCAS_RAIZES: RAIZES };
  const comAAAA = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas(), storageBox: { name: "bunker707-backups", username: "u", server: "h" }, records: [record(PAINEL, "A", IP, true), record(API, "A", IP, false), record(INTERNO, "A", IP, false), record(API, "AAAA", "2001:db8::1", false)] });
  const aaaa = comAAAA.runScript("licencas.sh", base, ["deploy"]);
  assert.equal(aaaa.status, 1);
  assert.match(aaaa.stderr, /DNS do Emissor fora do lugar: licencas-api\.bunker707\.com\.br .*Rode dns-licencas antes do deploy-licencas/);
  assert.equal(sshCmds(comAAAA.calls()).length, 0);

  const comProxy = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas(), records: [record(PAINEL, "A", IP, true), record(API, "A", IP, true)] });
  assert.match(comProxy.runScript("licencas.sh", base, ["deploy"]).stderr, /esperado: A 192\.0\.2\.7 proxy=false; achado: A 192\.0\.2\.7 proxy=true/);

  // O endereco da API interna: sem o registro (o dns-licencas de antes desta mudanca) ou atras do proxy, o deploy para.
  const semInterno = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas(), records: [record(PAINEL, "A", IP, true), record(API, "A", IP, false)] });
  const falta = semInterno.runScript("licencas.sh", base, ["deploy"]);
  assert.equal(falta.status, 1);
  assert.match(falta.stderr, /DNS do Emissor fora do lugar: licencas-interno\.bunker707\.com\.br \(esperado: A 192\.0\.2\.7 proxy=false; achado: nada\)\. Rode dns-licencas/);
  assert.equal(sshCmds(semInterno.calls()).length, 0);
  const internoComProxy = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas(), records: [record(PAINEL, "A", IP, true), record(API, "A", IP, false), record(INTERNO, "A", IP, true)] });
  assert.match(internoComProxy.runScript("licencas.sh", base, ["deploy"]).stderr, /licencas-interno\.bunker707\.com\.br \(esperado: A 192\.0\.2\.7 proxy=false; achado: A 192\.0\.2\.7 proxy=true\)/);

  const semRaizes = setup({ servers: [servidorLicencas()] }).runScript("licencas.sh", { GITHUB_TOKEN: "ghs_x" }, ["deploy"]);
  assert.match(semRaizes.stderr, /Sem as raizes publicas: rode a cerimonia-licencas e grave em infra\/licencas\/raizes\.json/);
});

test("deploy-licencas com a configuracao do Painel fora do formato para antes de qualquer chamada; sem nenhuma variavel valem os padroes; so LICENCAS_SEM_PAINEL=sim sobe o Emissor sem o Painel", { skip }, () => {
  const base = { GITHUB_TOKEN: "ghs_x", LICENCAS_RAIZES: RAIZES };
  const recusa = (extra, mensagem) => {
    const conta = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas() });
    const result = conta.runScript("licencas.sh", { ...base, ...extra }, ["deploy"]);
    assert.equal(result.status, 1, `${JSON.stringify(extra)}: ${result.stdout}`);
    assert.match(result.stderr, mensagem);
    assert.deepEqual(conta.calls(), [], "nada chamado: nem a Hetzner, nem a Cloudflare, nem o servidor");
    return result;
  };
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
    records: [record(PAINEL, "A", IP, true), record(API, "A", IP, false), record(INTERNO, "A", IP, false)]
  });
  const link = "https://membros.bunker707.com.br/minhas-licencas/{licenca}/renovar";
  const result = conta.runScript("licencas.sh", { ...base, LICENCAS_SEM_PAINEL: "sim", LICENCAS_EMISSOR_KIDS_ANTERIORES: "emissao-2026-11, emissao-2025-10", LICENCAS_EMISSOR_LINK_RENOVAR: link, PUBLICO_TENTATIVAS: "1" }, ["deploy"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const implantar = sshCmds(conta.calls()).find((c) => c.command.includes("bash infra/licencas/scripts/implantar.sh"));
  assert.ok(!sshCmds(conta.calls()).some((c) => c.command.includes("bin/painel.ts")), "sem o Painel, nenhuma conta");
  assert.deepEqual(configDe(implantar.command), {
    PAINEL_ENDERECO: "",
    PAINEL_TETO_DIARIO: "10",
    EMISSOR_EMAIL_PRODUTOR: "",
    EMISSOR_EMAIL_REMETENTE: "",
    EMISSOR_KIDS_ANTERIORES: "emissao-2026-11,emissao-2025-10",
    EMISSOR_LINK_RENOVAR: link,
    EMISSOR_LINK_LOJA: ""
  });
  assert.match(result.stdout, /Sem o Painel \(LICENCAS_SEM_PAINEL=sim\): o Emissor sobe sem ele e sem e-mail/);
  assert.match(result.stdout, /Emissor no ar: https:\/\/licencas-api\.bunker707\.com\.br \(API das Instalacoes\), sem o Painel/);
  assert.doesNotMatch(result.stdout, /link de uso unico/);

  // Sem nenhuma variavel do repositorio: os padroes de lib.sh (o remetente no dominio de envio ja verificado e o
  // produtor do PRODUCER_EMAIL) ligam o Painel; o produtor nao cadastra nada.
  const padrao = setup({
    servers: [servidorLicencas()],
    firewalls: firewallLicencas(),
    storageBox: { name: "bunker707-backups", username: "u100", server: "u100.your-storagebox.de" },
    records: [record(PAINEL, "A", IP, true), record(API, "A", IP, false), record(INTERNO, "A", IP, false)]
  });
  const comPadrao = padrao.runScript("licencas.sh", { ...base, PUBLICO_TENTATIVAS: "1" }, ["deploy"]);
  assert.equal(comPadrao.status, 0, comPadrao.stdout + comPadrao.stderr);
  const padraoImplantar = sshCmds(padrao.calls()).find((c) => c.command.includes("bash infra/licencas/scripts/implantar.sh"));
  assert.equal(configDe(padraoImplantar.command).EMISSOR_EMAIL_REMETENTE, "Bunker Members <licencas@mail.bunker707.com.br>");
  assert.equal(configDe(padraoImplantar.command).PAINEL_ENDERECO, `https://${PAINEL}`);
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

test("Caddy do servidor de licencas: a API so com /v1 e /health e o IP da conexao; o Painel de qualquer internet, com o IP real da Cloudflare e sem os cabecalhos do Access (D40)", () => {
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
  assert.match(painel, /\treverse_proxy 127\.0\.0\.1:\{\$PAINEL_PORTA_NO_HOST\} \{\n\t\theader_up X-Forwarded-For \{client_ip\}/, "o IP real que a Cloudflare repassa, so das faixas dela");
  assert.match(painel, /header_up -Cf-Access-Jwt-Assertion\n\t\theader_up -Cf-Access-Authenticated-User-Email/, "a identidade e so a do login do Painel");
  assert.doesNotMatch(painel, /client_ip \{|LICENCAS_PAINEL_IPS|respond 403|header Cf-Access/, "sem lista de IPs e sem exigir o Access (D40)");
  assert.doesNotMatch(caddyfile, /LICENCAS_PAINEL_IPS/);

  // A API interna da nossa escola: so do IP da conexao do servidor da escola (remote_ip, nunca client_ip, que leria um
  // cabecalho), so /interno/v1/*, um IP so no X-Forwarded-For; o resto, 403 sem chegar ao Emissor.
  const interno = site("LICENCAS_INTERNO_SITE_ADDRESS");
  assert.match(interno, /@escola \{\n\t\tremote_ip \{\$LICENCAS_INTERNO_IPS\}\n\t\tpath \/interno\/v1\/\*\n\t\}/);
  assert.match(interno, /handle @escola \{[\s\S]*max_size 32KB[\s\S]*reverse_proxy 127\.0\.0\.1:\{\$INTERNO_PORTA_NO_HOST\} \{\n\t\t\t# .*\n\t\t\theader_up X-Forwarded-For \{remote_host\}/);
  assert.match(interno, /\thandle \{\n\t\trespond 403\n\t\}$/, "outro IP ou outro caminho: 403");
  assert.doesNotMatch(interno, /client_ip|PAINEL_PORTA_NO_HOST|EMISSOR_PORTA_NO_HOST/);
  assert.equal((caddyfile.match(/INTERNO_PORTA_NO_HOST/g) ?? []).length, 2, "a porta interna so no site dela (e no comentario do topo)");

  // O compose: Caddy fixado na mesma versao dos outros servidores, na rede do servidor, com as portas pelos nomes do
  // .env.example do bunker-licensing (EMISSOR_PORTA_NO_HOST) e o do Painel (PAINEL_PORTA_NO_HOST, ainda a confirmar).
  assert.match(caddyCompose, /^    image: caddy:2\.11\.7-alpine$/m);
  assert.match(readFileSync(join(root, "infra/mautic/docker-compose.yml"), "utf8"), /image: caddy:2\.11\.7-alpine/);
  assert.match(caddyCompose, /^    network_mode: host$/m);
  assert.doesNotMatch(caddyCompose, /^\s+ports:/m);
  assert.match(caddyCompose, /EMISSOR_PORTA_NO_HOST: \$\{EMISSOR_PORTA_NO_HOST:-8080\}/);
  assert.match(caddyCompose, /PAINEL_PORTA_NO_HOST: \$\{PAINEL_PORTA_NO_HOST:-8081\}/);
  assert.doesNotMatch(caddyCompose, /LICENCAS_PAINEL_IPS/, "o Painel nao tem lista de IPs (D40)");
  assert.match(caddyCompose, /LICENCAS_INTERNO_SITE_ADDRESS: \$\{LICENCAS_INTERNO_DOMAIN:\?/);
  assert.match(caddyCompose, /INTERNO_PORTA_NO_HOST: \$\{INTERNO_PORTA_NO_HOST:-8082\}/);
  assert.match(caddyCompose, /LICENCAS_INTERNO_IPS: \$\{LICENCAS_INTERNO_IPS:-127\.0\.0\.1\/32\}/, "sem a lista, ninguem de fora");
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
  assert.ok(lidas.has("RESTIC_PASSWORD") && lidas.has("BACKUP_KEEP_HOURLY") && lidas.has("LICENCAS_PAINEL_DOMAIN"));
});

test("status-licencas so le: servidor, preco, DNS com aviso de AAAA e respostas publicas; sem SSH=1 nao abre a 22", { skip }, () => {
  const conta = setup({ servers: [servidorLicencas()], firewalls: firewallLicencas(), records: [record(PAINEL, "A", IP, true), record(API, "A", IP, false), record(API, "AAAA", "2001:db8::1", false), record(INTERNO, "A", IP, false)] });
  const result = conta.runScript("licencas.sh", { GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/dev" }, ["status"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /bunker707-licencas: cx23 em fsn1, 192\.0\.2\.7, running/);
  assert.match(result.stdout, /preco: EUR 6\.4900\/mes sem IVA, mais o IPv4/);
  assert.match(result.stderr, /licencas-api\.bunker707\.com\.br tem AAAA: a conferencia inicial so funciona por IPv4/);
  assert.match(result.stdout, /https:\/\/licencas-api\.bunker707\.com\.br\/health\s+000 \(esperado 200\)/);
  assert.match(result.stdout, /^ {2}licencas-interno\.bunker707\.com\.br A 192\.0\.2\.7 proxy=false$/m);
  // De fora (o runner), a API interna fecha na borda: o status so pergunta, sem credencial nenhuma.
  assert.match(result.stdout, /https:\/\/licencas-interno\.bunker707\.com\.br\/interno\/v1\/planos\s+000 \(esperado 403: so o servidor da escola entra\)/);
  const calls = conta.calls();
  assert.ok(!calls.some((c) => c.tool === "ssh"), "sem SSH=1, nenhum SSH");
  assert.ok(!calls.some((c) => c.tool === "hcloud" && /create|delete|replace-rules|apply/.test(c.args.join(" "))), "nada muda na Hetzner");
  assert.ok(!calls.some((c) => c.tool === "curl" && ["POST", "PUT", "PATCH", "DELETE"].includes(c.method) && c.url.includes("api.cloudflare.com")), "nada muda na Cloudflare");
  assert.deepEqual(conta.hz().firewalls[0].rules, [], "o firewall nao foi tocado");
});

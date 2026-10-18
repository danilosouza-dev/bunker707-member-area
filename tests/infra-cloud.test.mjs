import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

// Bracos da migracao para a Hetzner (infra/cloud e .github/workflows/infra.yml; docs/20, "Sessao na nuvem").
// Nada aqui fala com a Hetzner, a Cloudflare ou um servidor. O que se prova e o que roda na maquina de quem
// opera (ou no runner do GitHub): a chave de deploy derivada do token, o envelope de segredos, a escolha do
// servidor mais barato a partir de uma lista de tipos, o despacho das etapas e as regras de seguranca do
// workflow. Testes que dependem de ssh-keygen, openssl ou python3 pulam com motivo quando o binario falta.

const cloudDir = fileURLToPath(new URL("../infra/cloud/", import.meta.url));
const workflowSource = readFileSync(new URL("../.github/workflows/infra.yml", import.meta.url), "utf8");
const runPath = join(cloudDir, "run.sh");
const runSource = readFileSync(runPath, "utf8");
const libSource = readFileSync(join(cloudDir, "lib.sh"), "utf8");
const planSource = readFileSync(join(cloudDir, "plan.sh"), "utf8");
const provisionSource = readFileSync(join(cloudDir, "provision.sh"), "utf8");
const cloudInit = readFileSync(join(cloudDir, "cloud-init.yaml"), "utf8");
const shellScripts = readdirSync(cloudDir).filter((name) => name.endsWith(".sh")).sort();
const tokenNames = ["HCLOUD_TOKEN", "CLOUDFLARE_API_TOKEN", "GITHUB_TOKEN"];

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

function hasBinary(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return !result.error && result.status === 0;
}

// Ambiente limpo para os scripts: sem token nenhum, sem variaveis do GitHub Actions e com TMPDIR proprio
// (lib.sh cria a pasta de trabalho em RUNNER_TEMP ou TMPDIR).
function cleanEnv(overrides = {}) {
  const env = { ...process.env, TMPDIR: tempDir("bunker707-cloud-work-") };
  for (const name of [...tokenNames, "GITHUB_OUTPUT", "GITHUB_ACTIONS", "RUNNER_TEMP", "OPCOES", "PAYLOAD", "COMANDO"]) delete env[name];
  return { ...env, ...overrides };
}

// Blocos de um YAML simples por texto (sem biblioteca): entradas de dois espacos dentro de uma chave de
// primeiro nivel, por exemplo os jobs do workflow.
function yamlChildren(source, topKey) {
  const start = source.indexOf(`\n${topKey}:\n`);
  assert.ok(start >= 0, `${topKey}: precisa existir no primeiro nivel`);
  const rest = source.slice(start + topKey.length + 3);
  const next = rest.search(/^[a-z]/m);
  const block = next >= 0 ? rest.slice(0, next) : rest;
  const headers = [...block.matchAll(/^  ([a-z_-]+):\s*$/gm)];
  const children = new Map();
  headers.forEach((header, index) => {
    const to = index + 1 < headers.length ? headers[index + 1].index : block.length;
    children.set(header[1], block.slice(header.index, to));
  });
  return { block, children };
}

test("scripts de infra/cloud passam na conferencia de sintaxe do bash", () => {
  assert.deepEqual(shellScripts, ["deploy.sh", "envelope.sh", "equipe.sh", "lib.sh", "plan.sh", "provision.sh", "restaurar.sh", "run.sh", "secrets.sh", "snapshot.sh", "status.sh"]);
  for (const file of shellScripts) {
    const result = run("bash", ["-n", join(cloudDir, file)]);
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  }
});

test("run.sh: etapa desconhecida sai com codigo 2, e as etapas do case sao exatamente as opcoes do workflow", () => {
  const unknown = run("bash", [runPath, "etapa-que-nao-existe"], { env: cleanEnv() });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /etapa desconhecida: 'etapa-que-nao-existe'/);
  const semEtapa = run("bash", [runPath], { env: cleanEnv() });
  assert.equal(semEtapa.status, 2, "sem etapa tambem e uso errado");

  const caseStart = runSource.indexOf('case "$etapa" in');
  const caseBlock = runSource.slice(caseStart, runSource.indexOf("\nesac", caseStart));
  const etapas = [...caseBlock.matchAll(/^\s+([a-z][a-z-]*)\)/gm)].map((match) => match[1]);
  const inputStart = workflowSource.indexOf("      etapa:");
  const inputBlock = workflowSource.slice(inputStart, workflowSource.indexOf("      opcoes:", inputStart));
  const options = [...inputBlock.matchAll(/^\s+- ([a-z][a-z-]*)\s*$/gm)].map((match) => match[1]);
  assert.ok(etapas.length >= 10, `esperava as etapas no case, achei ${etapas.length}`);
  assert.equal(new Set(etapas).size, etapas.length, "etapa repetida no case");
  assert.deepEqual([...etapas].sort(), [...options].sort(), "run.sh e o input etapa do workflow precisam listar as mesmas etapas");
  for (const etapa of ["plan", "provision", "deploy-membros", "deploy-marketing", "secrets-membros", "secrets-marketing", "equipe", "status", "backup-membros", "exec-marketing"]) {
    assert.ok(etapas.includes(etapa), `${etapa} precisa existir`);
  }
  const defaultOption = /^\s+default:\s*(\S+)\s*$/m.exec(inputBlock)?.[1];
  assert.ok(options.includes(defaultOption), `o padrao do input (${defaultOption}) precisa ser uma das opcoes`);
  // O cabecalho de uso do run.sh (impresso junto com o erro) tambem lista todas.
  const usage = unknown.stdout + unknown.stderr;
  for (const etapa of etapas) assert.ok(usage.includes(etapa), `${etapa} falta no texto de uso`);
});

test("run.sh despacha a etapa e para na checagem do HCLOUD_TOKEN antes de chamar a Hetzner; opcao fora do formato e avisada", () => {
  const status = run("bash", [runPath, "status"], { env: cleanEnv() });
  assert.equal(status.status, 1);
  assert.match(status.stderr, /ERRO: Variavel HCLOUD_TOKEN ausente/);
  assert.doesNotMatch(status.stdout + status.stderr, /hcloud\.tgz|curl/, "sem token nada e baixado");

  const opcoes = run("bash", [runPath, "status"], { env: cleanEnv({ OPCOES: "MEMBROS_TYPE=cx33 semigual" }) });
  assert.equal(opcoes.status, 1);
  assert.match(opcoes.stderr, /opcao ignorada \(formato CHAVE=VALOR\): semigual/);
  assert.doesNotMatch(opcoes.stderr, /opcao ignorada.*MEMBROS_TYPE/);
});

test("deploy-key.mjs: chave OpenSSH Ed25519 derivada do HCLOUD_TOKEN, determinista, 0600, e sem token nada sai", () => {
  const dir = tempDir("bunker707-deploy-key-");
  const script = join(cloudDir, "deploy-key.mjs");
  const tokenA = "token-de-teste-A-".padEnd(48, "a");
  const tokenB = "token-de-teste-B-".padEnd(48, "b");
  const derive = (token, out, extra = []) => run(process.execPath, [script, "--out", out, ...extra], { env: cleanEnv({ HCLOUD_TOKEN: token }) });

  const first = derive(tokenA, join(dir, "a1"));
  assert.equal(first.status, 0, first.stderr);
  const privateKey = readFileSync(join(dir, "a1"), "utf8");
  const publicKey = readFileSync(join(dir, "a1.pub"), "utf8");
  assert.ok(privateKey.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----\n"));
  assert.ok(privateKey.endsWith("-----END OPENSSH PRIVATE KEY-----\n"));
  assert.match(publicKey, /^ssh-ed25519 [A-Za-z0-9+/=]+ bunker707-deploy\n$/);
  assert.equal(statSync(join(dir, "a1")).mode & 0o777, 0o600, "a chave privada fica so para o dono");
  assert.ok(!first.stdout.includes("PRIVATE KEY") && !first.stderr.includes("PRIVATE KEY"), "a chave privada nunca e impressa");
  assert.match(first.stderr, /SHA256:/, "so a impressao digital vai para o terminal");

  // Mesmo token, mesma chave (a sessao na nuvem e descartavel: a chave precisa nascer igual toda vez).
  const second = derive(tokenA, join(dir, "a2"));
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(join(dir, "a2"), "utf8"), privateKey);
  assert.equal(readFileSync(join(dir, "a2.pub"), "utf8"), publicKey);
  // Token diferente, chave diferente.
  const other = derive(tokenB, join(dir, "b"));
  assert.equal(other.status, 0, other.stderr);
  assert.notEqual(readFileSync(join(dir, "b.pub"), "utf8"), publicKey);
  assert.notEqual(readFileSync(join(dir, "b"), "utf8"), privateKey);
  // --print-public imprime so a linha publica.
  const printed = derive(tokenA, join(dir, "a3"), ["--print-public"]);
  assert.equal(printed.status, 0);
  assert.equal(printed.stdout, publicKey);
  assert.ok(!printed.stdout.includes("PRIVATE KEY"));

  // Sem token (ou curto demais): erro, nada gravado, nada impresso.
  for (const env of [cleanEnv(), cleanEnv({ HCLOUD_TOKEN: "curto" })]) {
    const missing = run(process.execPath, [script, "--out", join(dir, "nunca")], { env });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /HCLOUD_TOKEN ausente ou curto demais/);
    assert.equal(missing.stdout, "");
    assert.ok(!existsSync(join(dir, "nunca")) && !existsSync(join(dir, "nunca.pub")));
  }

});

test("ssh-keygen le a chave de deploy derivada e chega na mesma chave publica", (t) => {
  if (run("ssh-keygen", ["-?"]).error) {
    t.skip("ssh-keygen nao esta nesta maquina");
    return;
  }
  const dir = tempDir("bunker707-deploy-key-ssh-");
  const token = "token-de-teste-A-".padEnd(48, "a");
  const derived = run(process.execPath, [join(cloudDir, "deploy-key.mjs"), "--out", join(dir, "chave")], { env: cleanEnv({ HCLOUD_TOKEN: token }) });
  assert.equal(derived.status, 0, derived.stderr);
  const keygen = run("ssh-keygen", ["-y", "-f", join(dir, "chave")]);
  assert.equal(keygen.status, 0, keygen.stderr);
  const keyFields = (line) => line.trim().split(" ").slice(0, 2).join(" ");
  assert.equal(keyFields(keygen.stdout), keyFields(readFileSync(join(dir, "chave.pub"), "utf8")), "o OpenSSH le a privada e chega na mesma publica");
  assert.match(keyFields(keygen.stdout), /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI/);
});

test("envelope.sh: segredo cifrado para a chave RSA do servidor volta igual ao decifrar, e o payload nao carrega o valor em claro", (t) => {
  if (!hasBinary("openssl", ["version"])) {
    t.skip("openssl nao esta nesta maquina");
    return;
  }
  if (run("sh", ["-c", "printf x | base64 -w0 >/dev/null && tar --version >/dev/null"]).status !== 0) {
    t.skip("envelope.sh precisa do base64 com -w0 e do tar (GNU coreutils, como no servidor e no runner)");
    return;
  }
  const dir = tempDir("bunker707-envelope-");
  const envelope = join(cloudDir, "envelope.sh");
  // RSA 2048 so para o teste ser rapido; provision.sh gera 4096 no servidor.
  assert.equal(run("openssl", ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", join(dir, "transfer.key")]).status, 0);
  assert.equal(run("openssl", ["pkey", "-in", join(dir, "transfer.key"), "-pubout", "-out", join(dir, "transfer.pub")]).status, 0);
  const original = "RESEND_API_KEY=re_valor_secreto_de_teste_123\nMAUTIC_MAILER_DSN=smtp://resend:re_valor_secreto_de_teste_123@smtp.resend.com:587\n";
  writeFileSync(join(dir, "segredos.kv"), original);

  const encrypted = run("bash", [envelope, "encrypt", join(dir, "transfer.pub"), join(dir, "segredos.kv")]);
  assert.equal(encrypted.status, 0, encrypted.stderr);
  const payload = encrypted.stdout.trim();
  assert.match(payload, /^[A-Za-z0-9+/=]+$/, "o payload e base64 numa linha (cabe no input do workflow)");
  assert.ok(!Buffer.from(payload, "base64").includes("re_valor_secreto_de_teste_123"), "o conteudo vai cifrado");
  writeFileSync(join(dir, "payload.b64"), `${payload}\n`);

  const decrypted = run("bash", [envelope, "decrypt", join(dir, "transfer.key"), join(dir, "payload.b64")]);
  assert.equal(decrypted.status, 0, decrypted.stderr);
  assert.equal(decrypted.stdout, original);

  // A chave publica tambem pode vir como base64 numa linha (como provision.sh e status.sh a imprimem).
  const publicBase64 = readFileSync(join(dir, "transfer.pub")).toString("base64");
  const encryptedFromBase64 = run("bash", [envelope, "encrypt", publicBase64, join(dir, "segredos.kv")]);
  assert.equal(encryptedFromBase64.status, 0, encryptedFromBase64.stderr);
  assert.notEqual(encryptedFromBase64.stdout, encrypted.stdout, "cada envelope usa uma chave AES nova");
  writeFileSync(join(dir, "payload2.b64"), encryptedFromBase64.stdout);
  assert.equal(run("bash", [envelope, "decrypt", join(dir, "transfer.key"), join(dir, "payload2.b64")]).stdout, original);

  // Outra chave privada nao abre; chamada sem modo e uso errado.
  assert.equal(run("openssl", ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", join(dir, "outra.key")]).status, 0);
  const wrongKey = run("bash", [envelope, "decrypt", join(dir, "outra.key"), join(dir, "payload.b64")]);
  assert.notEqual(wrongKey.status, 0);
  assert.ok(!wrongKey.stdout.includes("re_valor_secreto_de_teste_123"));
  assert.equal(run("bash", [envelope]).status, 2);
});

// Bloco Python do plan.sh (entre <<'PY' e a linha PY): escolhe o tipo mais barato por papel a partir do JSON
// de tipos da Hetzner. Rodado aqui com um JSON sintetico, sem token e sem hcloud.
function planPythonBlock() {
  const marker = "<<'PY'\n";
  const start = planSource.indexOf(marker);
  assert.ok(start >= 0, "plan.sh precisa do heredoc PY");
  const bodyStart = start + marker.length;
  const end = planSource.indexOf("\nPY\n", bodyStart);
  assert.ok(end > bodyStart, "o heredoc PY precisa fechar");
  return planSource.slice(bodyStart, end + 1);
}

const serverTypes = [
  // 4 GB, o mais barato x86 disponivel em fsn1 e nbg1.
  { name: "cx23", cores: 2, memory: 4, disk: 40, cpu_type: "shared", architecture: "x86", deprecated: false,
    prices: [{ location: "fsn1", price_monthly: { net: "5.4900", gross: "6.5331" } }, { location: "nbg1", price_monthly: { net: "5.4900", gross: "6.5331" } }],
    locations: [{ name: "fsn1", available: true }, { name: "nbg1", available: true }] },
  // 8 GB barato, mas esgotado em fsn1 (so nbg1 tem).
  { name: "cx33", cores: 4, memory: 8, disk: 80, cpu_type: "shared", architecture: "x86", deprecated: false,
    prices: [{ location: "fsn1", price_monthly: { net: "8.4900", gross: "10.1031" } }, { location: "nbg1", price_monthly: { net: "8.4900", gross: "10.1031" } }],
    locations: [{ name: "fsn1", available: false }, { name: "nbg1", available: true }] },
  // 8 GB caro, disponivel em fsn1.
  { name: "cpx32", cores: 4, memory: 8, disk: 160, cpu_type: "shared", architecture: "x86", deprecated: false,
    prices: [{ location: "fsn1", price_monthly: { net: "35.4900", gross: "42.2331" } }],
    locations: [{ name: "fsn1", available: true }] },
  // ARM mais barato de todos: a imagem do app e x86, entao nunca pode ser escolhido.
  { name: "cax11", cores: 2, memory: 4, disk: 40, cpu_type: "shared", architecture: "arm", deprecated: false,
    prices: [{ location: "fsn1", price_monthly: { net: "3.7900", gross: "4.5101" } }],
    locations: [{ name: "fsn1", available: true }] }
];

function runPlan(t, { preferred = "fsn1", fallbacks = "nbg1 hel1", membrosRam = "8", marketingRam = "4", membrosType = "", marketingType = "", skip = "", githubOutput } = {}) {
  const dir = tempDir("bunker707-plan-");
  const jsonPath = join(dir, "server-types.json");
  writeFileSync(jsonPath, JSON.stringify(serverTypes));
  const env = cleanEnv();
  if (githubOutput) env.GITHUB_OUTPUT = githubOutput;
  const result = run("python3", ["-I", "-", jsonPath, preferred, fallbacks, membrosRam, marketingRam, membrosType, marketingType, skip], { input: planPythonBlock(), env });
  const planEnv = existsSync(join(dir, "plan.env")) ? readFileSync(join(dir, "plan.env"), "utf8") : null;
  return { ...result, dir, planEnv };
}

test("plan.sh escolhe o tipo mais barato com a memoria minima por papel, pula o esgotado e o ARM, e grava plan.env ao lado do JSON", (t) => {
  if (!hasBinary("python3", ["--version"])) {
    t.skip("python3 nao esta nesta maquina");
    return;
  }
  const githubOutput = join(tempDir("bunker707-plan-output-"), "output.txt");
  const plan = runPlan(t, { githubOutput });
  assert.equal(plan.status, 0, plan.stderr);
  // membros (>= 8 GB): cx33 em nbg1 (8,49), porque em fsn1 esta esgotado e o cpx32 custa 35,49.
  // marketing (>= 4 GB): cx23 em fsn1 (5,49), o local preferido; o cax11 e mais barato mas e ARM.
  assert.equal(plan.planEnv, "MEMBROS_TYPE=cx33\nMEMBROS_LOCATION=nbg1\nMARKETING_TYPE=cx23\nMARKETING_LOCATION=fsn1\n");
  assert.match(plan.stdout, /membros: cx33 em nbg1 \(4 vCPU, 8 GB, 80 GB disco\) por EUR 8\.49\/mes/);
  assert.match(plan.stdout, /marketing: cx23 em fsn1 \(2 vCPU, 4 GB, 40 GB disco\) por EUR 5\.49\/mes/);
  assert.match(plan.stdout, /Total estimado dos servidores: EUR 13\.98\/mes/);
  assert.doesNotMatch(plan.stdout, /cax11/, "tipo ARM nem aparece na tabela");
  assert.match(plan.stdout, /cx33\s+fsn1 .* nao$/m, "a tabela mostra o esgotado como indisponivel");
  assert.equal(readFileSync(githubOutput, "utf8"), "membros_type=cx33\nmembros_location=nbg1\nmarketing_type=cx23\nmarketing_location=fsn1\n");
});

test("plan.sh respeita MEMBROS_TYPE e MARKETING_TYPE forcados, SKIP_MARKETING tira o segundo servidor, e sem opcao com memoria suficiente falha", (t) => {
  if (!hasBinary("python3", ["--version"])) {
    t.skip("python3 nao esta nesta maquina");
    return;
  }
  const forced = runPlan(t, { membrosType: "cpx32", marketingType: "cx33" });
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(forced.planEnv, "MEMBROS_TYPE=cpx32\nMEMBROS_LOCATION=fsn1\nMARKETING_TYPE=cx33\nMARKETING_LOCATION=nbg1\n");

  const skipped = runPlan(t, { skip: "1" });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(skipped.planEnv, "MEMBROS_TYPE=cx33\nMEMBROS_LOCATION=nbg1\n");
  assert.match(skipped.stdout, /SKIP_MARKETING: o Mautic vai no mesmo servidor do app/);

  const tooBig = runPlan(t, { membrosRam: "64" });
  assert.equal(tooBig.status, 1);
  assert.match(tooBig.stdout, /Nenhum tipo com >= 64\.0 GB para 'membros'/);
  assert.equal(tooBig.planEnv, null, "sem escolha nao grava plan.env");

  const forcedUnavailable = runPlan(t, { membrosType: "cx33", fallbacks: "" });
  assert.equal(forcedUnavailable.status, 1, "cx33 forcado so em fsn1 (esgotado) nao tem como");
  assert.match(forcedUnavailable.stdout, /forcado: cx33/);
});

test("o workflow de infra so executa etapas por workflow_dispatch: um push apenas registra o arquivo, sem segredos nem run.sh", () => {
  const { block: onBlock } = yamlChildren(workflowSource, "on");
  assert.match(onBlock, /^  workflow_dispatch:\s*$/m);
  for (const trigger of ["pull_request", "pull_request_target", "schedule", "workflow_call", "repository_dispatch"]) {
    assert.doesNotMatch(onBlock, new RegExp(`^  ${trigger}:`, "m"), `${trigger} nao pode disparar a infra`);
  }
  const { children: jobs } = yamlChildren(workflowSource, "jobs");
  const infraJob = jobs.get("infra");
  assert.ok(infraJob, "o job infra precisa existir");
  if (/^  push:/m.test(onBlock)) {
    // O push existe so para o GitHub registrar o workflow (sem isso um workflow novo nao aparece para disparo
    // manual): limitado a este arquivo, e o job que tem os tokens nao roda nele.
    const pushBlock = onBlock.slice(onBlock.indexOf("  push:"), onBlock.indexOf("  workflow_dispatch:"));
    assert.deepEqual([...pushBlock.matchAll(/^\s+- (\S+)\s*$/gm)].map((match) => match[1]), [".github/workflows/infra.yml"]);
    assert.match(infraJob, /^    if: github\.event_name == 'workflow_dispatch'\s*$/m);
  }
  for (const [name, job] of jobs) {
    if (name === "infra") continue;
    assert.doesNotMatch(job, /secrets\./, `o job ${name} nao pode tocar em segredo`);
    assert.doesNotMatch(job, /run\.sh|hcloud|ssh /, `o job ${name} nao pode operar a infra`);
  }
  assert.match(infraJob, /HCLOUD_TOKEN: \$\{\{ secrets\.HCLOUD_TOKEN \}\}/);
  assert.match(infraJob, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(infraJob, /run: bash infra\/cloud\/run\.sh "\$\{\{ inputs\.etapa \}\}"/);
  // O input payload so vira PAYLOAD nas etapas secrets-* e COMANDO nas exec-*.
  assert.match(infraJob, /PAYLOAD: \$\{\{ \(startsWith\(inputs\.etapa, 'secrets-'\) && inputs\.payload\) \|\| '' \}\}/);
  assert.match(infraJob, /COMANDO: \$\{\{ \(startsWith\(inputs\.etapa, 'exec-'\) && inputs\.payload\) \|\| '' \}\}/);

  const { block: permissions } = yamlChildren(workflowSource, "permissions");
  assert.match(permissions, /^  packages: write\s*$/m, "publicar a imagem no GHCR precisa de packages: write");
  assert.match(permissions, /^  contents: read\s*$/m);
  const { block: concurrency } = yamlChildren(workflowSource, "concurrency");
  assert.match(concurrency, /^  group: \S+/m, "uma etapa por vez: duas juntas disputariam o firewall e o .env");
  assert.match(concurrency, /^  cancel-in-progress: false\s*$/m, "uma etapa no meio nunca e cancelada por outra");
});

test("lib.sh nunca liga o rastreio do shell e nenhum script imprime os tokens com echo ou printf", () => {
  const xtrace = /^\s*set\s+(-[a-zA-Z]*x[a-zA-Z]*|-o\s+xtrace)\b/m;
  assert.doesNotMatch(libSource, xtrace, "set -x levaria os tokens para o log do Actions");
  // echo/printf cuja linha, do comando ate o fim, contem o token sem um pipe no meio (o que vai por pipe
  // alimenta outro processo, como docker login --password-stdin, e nao o log).
  const printsToken = new RegExp(`\\b(echo|printf)\\b[^|\\n]*\\$\\{?(${tokenNames.join("|")})\\b[^|\\n]*$`, "m");
  const sources = [...shellScripts.map((file) => [file, readFileSync(join(cloudDir, file), "utf8")]), [".github/workflows/infra.yml", workflowSource]];
  for (const [file, source] of sources) {
    assert.doesNotMatch(source, xtrace, `${file} nao pode usar set -x`);
    assert.doesNotMatch(source, printsToken, `${file} imprime um token`);
    for (const line of source.split("\n")) {
      // Mensagens de log e de erro com o nome do token sao permitidas; com o valor ($TOKEN) nao.
      if (/\b(log|warn|die)\b/.test(line)) assert.doesNotMatch(line, new RegExp(`\\$\\{?(${tokenNames.join("|")})\\b`), `${file}: ${line.trim()}`);
    }
  }
  // O token da Hetzner entra so no ambiente do processo do hcloud, e o da Cloudflare so no cabecalho do curl.
  assert.match(libSource, /HCLOUD_TOKEN="\$HCLOUD_TOKEN" hcloud/);
  assert.match(libSource, /-H "Authorization: Bearer \$CLOUDFLARE_API_TOKEN"/);
  assert.match(libSource, /::add-mask::/, "o que precisa aparecer no log e mascarado");
});

test("cloud-init.yaml comeca com #cloud-config e provision.sh troca os marcadores do usuario e da chave", () => {
  assert.ok(cloudInit.startsWith("#cloud-config\n"), "sem a primeira linha o cloud-init ignora o arquivo");
  assert.match(cloudInit, /^\s+- name: __DEPLOY_USER__\s*$/m);
  assert.match(cloudInit, /^\s+- __SSH_PUBLIC_KEY__\s*$/m);
  assert.match(cloudInit, /lock_passwd: true/, "o usuario de deploy entra so por chave");
  assert.doesNotMatch(cloudInit, /^\s+- name: root/m);
  assert.match(provisionSource, /s\|__DEPLOY_USER__\|\$DEPLOY_USER\|/);
  assert.match(provisionSource, /s\|__SSH_PUBLIC_KEY__\|\$pub\|/);

  // A mesma troca que provision.sh faz, com valores de teste: nenhum marcador sobra.
  const publicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGVzdGEgY2hhdmUgZSBzbyBkZSB0ZXN0ZQ bunker707-deploy";
  const rendered = run("sed", ["-e", "s|__DEPLOY_USER__|deploy|", "-e", `s|__SSH_PUBLIC_KEY__|${publicKey}|`, join(cloudDir, "cloud-init.yaml")]);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.ok(rendered.stdout.startsWith("#cloud-config\n"));
  assert.match(rendered.stdout, /^\s+- name: deploy\s*$/m);
  assert.match(rendered.stdout, new RegExp(`^\\s+- ${publicKey.replace(/[+/]/g, "\\$&")}\\s*$`, "m"));
  assert.doesNotMatch(rendered.stdout, /__[A-Z_]+__/, "marcador sem troca");
});

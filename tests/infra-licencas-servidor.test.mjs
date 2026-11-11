import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

// O que roda dentro do servidor do Emissor de licencas (infra/licencas/scripts; docs/20 §8C): implantar a imagem do GHCR,
// o backup de hora em hora, a restauracao e o ensaio. Os scripts de verdade rodam com docker, restic, systemctl, date e
// curl de mentira na frente do PATH, numa pasta temporaria no lugar de /opt/bunker707; nada fala com a rede nem com um
// Docker de verdade. Cada chamada vai para um log, na ordem.

const scriptsDir = fileURLToPath(new URL("../infra/licencas/scripts/", import.meta.url));
const faltam = ["jq", "python3"].filter((bin) => spawnSync(bin, ["--version"]).error);
const skip = faltam.length ? `faltam ${faltam.join(", ")}` : false;
const realDate = spawnSync("bash", ["-c", "command -v date"], { encoding: "utf8" }).stdout.trim();
const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const COMPOSE_JSON = JSON.stringify({
  name: "bunker-licensing",
  services: {
    postgres: { image: "postgres:16-alpine" },
    migrar: { image: "bunker-licensing-emissor:local", build: { context: "." } },
    emissor: { image: "bunker-licensing-emissor:local", build: { context: "." } }
  }
});
const ENV_EXAMPLE = [
  "# Variaveis do compose.yaml do Emissor (copia de teste do .env.example do bunker-licensing, com o Painel).",
  "ARQUIVO_SENHA_POSTGRES=./segredos/postgres-senha",
  "ARQUIVO_CHAVE_RESEND=./segredos/resend-chave",
  "EMISSOR_RAIZES='[{\"rid\":\"<rid da raiz>\",\"publicKey\":\"<chave publica da raiz>\"}]'",
  "EMISSOR_KIDS_ANTERIORES=",
  "# EMISSOR_LINK_RENOVAR=https://<area de membros>/minhas-licencas/{licenca}/renovar",
  "EMISSOR_PORTA_NO_HOST=8080",
  "EMISSOR_PROXIES_CONFIAVEIS=172.30.70.1",
  "EMISSOR_CABECALHO_IP=x-forwarded-for",
  "EMISSOR_REDE_BORDA=172.30.70.0/24",
  "EMISSOR_GATEWAY_BORDA=172.30.70.1",
  "PAINEL_PORTA_NO_HOST=8081",
  "PAINEL_ENDERECO=https://licencas.bunker707.com.br",
  "PAINEL_ACCESS_EQUIPE=<equipe>.cloudflareaccess.com",
  "PAINEL_ACCESS_AUD=<a etiqueta AUD do aplicativo, 64 caracteres de 0 a 9 e a a f>",
  "PAINEL_PROXIES_CONFIAVEIS=172.30.70.1",
  "PAINEL_CABECALHO_IP=x-forwarded-for",
  "PAINEL_TETO_DIARIO=10",
  "EMISSOR_EMAIL_PRODUTOR=<e-mail do produtor>",
  "EMISSOR_EMAIL_REMETENTE=Emissor Bunker707 <emissor@licencas.bunker707.com.br>",
  ""
].join("\n");
// O que o deploy-licencas manda em --config-b64 (infra/cloud/licencas.sh): o Painel ligado, ou tudo dele vazio.
const AUD = "0123456789abcdef".repeat(4);
const CONFIG_PAINEL = {
  PAINEL_ENDERECO: "https://licencas.bunker707.com.br",
  PAINEL_ACCESS_EQUIPE: "bunker707.cloudflareaccess.com",
  PAINEL_ACCESS_AUD: AUD,
  PAINEL_TETO_DIARIO: "10",
  EMISSOR_EMAIL_PRODUTOR: "produtor@exemplo.com.br",
  EMISSOR_EMAIL_REMETENTE: "Emissor Bunker707 <emissor@mail.bunker707.com.br>",
  EMISSOR_KIDS_ANTERIORES: "",
  EMISSOR_LINK_RENOVAR: "",
  EMISSOR_LINK_LOJA: ""
};
const SEM_PAINEL = { ...CONFIG_PAINEL, PAINEL_ENDERECO: "", PAINEL_ACCESS_EQUIPE: "", PAINEL_ACCESS_AUD: "", EMISSOR_EMAIL_PRODUTOR: "", EMISSOR_EMAIL_REMETENTE: "" };
const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64");
const IMAGEM = "--imagem=ghcr.io/danilosouza-dev/bunker-licensing:main";
const RAIZES_ARG = `--raizes-b64=${b64([{ rid: "raiz-teste", publicKey: "A".repeat(43) }])}`;
const configArg = (config = CONFIG_PAINEL) => `--config-b64=${b64(config)}`;

const DOCKER_SHIM = String.raw`
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
let stdin = "";
const leStdin = () => { try { stdin = fs.readFileSync(0, "utf8"); } catch {} };
const log = (extra = {}) => fs.appendFileSync(process.env.SHIM_LOG, JSON.stringify({ tool: "docker", args, ...extra }) + "\n");
const env = process.env;
if (args[0] === "compose") {
  let i = 1;
  while (args[i] === "-f") i += 2;
  const sub = args[i], rest = args.slice(i + 1);
  if (sub === "exec") {
    const at = rest.findIndex((a) => !a.startsWith("-"));
    const cmd = rest.slice(at + 1);
    if (cmd[0] === "pg_dump") { log(); process.stdout.write("PGDMP-falso-" + (env.SHIM_TOTAL ?? "3")); process.exit(env.SHIM_PG_DUMP_FALHA ? 1 : 0); }
    if (cmd[0] === "pg_restore") { leStdin(); log({ stdin: stdin.slice(0, 40) }); if (cmd.includes("--list")) process.stdout.write("; Archive created\n"); process.exit(0); }
    if (cmd[0] === "psql") {
      const sql = cmd[cmd.indexOf("-c") + 1] ?? "";
      if (!cmd.includes("-c")) leStdin();
      log({ sql, stdin: stdin.slice(0, 40) });
      if (sql.includes("+ (select count(*) from installations)")) console.log(env.SHIM_TOTAL ?? "3");
      else if (sql.includes("concat_ws")) console.log(env.SHIM_RESUMO ?? "3 2 10 0001_emissor_inicial");
      process.exit(0);
    }
    log(); process.exit(0);
  }
  log();
  if (sub === "ps") { console.log(env.SHIM_SAUDE_CONTAINER ?? "healthy|running"); process.exit(0); }
  if (sub === "config" && rest.includes("--services")) { console.log("postgres\nmigrar\nemissor"); process.exit(0); }
  if (sub === "config") { console.log(env.SHIM_COMPOSE_JSON); process.exit(0); }
  if (sub === "run" && env.SHIM_MIGRAR_FALHA) { process.stderr.write("migracao falhou\n"); process.exit(1); }
  process.exit(0);
}
if (args[0] === "exec" && args.includes("-i")) { leStdin(); log({ stdin: stdin.slice(0, 40) }); process.exit(0); }
log();
if (args[0] === "pull") process.exit(env.SHIM_PULL_FALHA && args.at(-1).endsWith(env.SHIM_PULL_FALHA) ? 1 : 0);
if (args[0] === "create") { console.log("cid-de-teste"); process.exit(0); }
if (args[0] === "cp") {
  const destino = args[2];
  fs.mkdirSync(destino, { recursive: true });
  fs.writeFileSync(path.join(destino, "compose.yaml"), "name: bunker-licensing\n# compose de teste vindo da imagem -implantacao\n");
  fs.writeFileSync(path.join(destino, ".env.example"), env.SHIM_ENV_EXAMPLE);
  process.exit(0);
}
if (args[0] === "image") { console.log("ghcr.io/danilosouza-dev/bunker-licensing@sha256:" + "a".repeat(64)); process.exit(0); }
if (args[0] === "exec" && args.includes("psql")) { console.log(env.SHIM_RESUMO_ENSAIO ?? "5 4 20 0001_emissor_inicial"); process.exit(0); }
if (args[0] === "inspect") { console.log("true"); process.exit(0); }
process.exit(0);
`;

const RESTIC_SHIM = String.raw`
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const env = process.env;
fs.appendFileSync(env.SHIM_LOG, JSON.stringify({ tool: "restic", args, recuperacao: args.includes("--password-file"), temSenha: Boolean(env.RESTIC_PASSWORD) }) + "\n");
const sub = args.filter((a) => !a.startsWith("-") && !a.includes("/") && !/^[0-9a-f]{64}$/.test(a))[0];
// Depois de um "key add", a senha nova (a deste servidor) passa a abrir o repositorio.
const chaveNova = env.SHIM_LOG + ".chave-nova";
if (sub === "key") fs.writeFileSync(chaveNova, "1");
if (sub === "cat") {
  if (args.includes("--password-file")) process.exit(env.SHIM_RESTIC_RECUPERACAO === "abre" ? 0 : 1);
  process.exit((env.SHIM_RESTIC_CONFIG ?? "abre") === "abre" || fs.existsSync(chaveNova) ? 0 : 1);
}
if (sub === "snapshots") { console.log(env.SHIM_SNAPSHOTS ?? "[]"); process.exit(0); }
if (sub === "restore") {
  const destino = args[args.indexOf("--target") + 1];
  const pasta = path.join(destino, "var/backups/bunker707-licencas/stage/20261110T120000Z");
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, "emissor.dump"), "PGDMP-do-backup-" + args[1]);
  process.exit(0);
}
if (sub === "check") process.exit(env.SHIM_RESTIC_CHECK_FALHA ? 1 : 0);
process.exit(0);
`;

const LOGGER = (tool, extra = "") => String.raw`
import fs from "node:fs";
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SHIM_LOG, JSON.stringify({ tool: "${tool}", args }) + "\n");
${extra}
process.exit(0);
`;

/**
 * Um servidor de licencas de mentira: /opt/bunker707 numa pasta temporaria, com o Emissor ja implantado ou nao. `resend`
 * e o conteudo de segredos/resend-chave (null: o arquivo nao existe).
 */
function servidor({ implantado = true, segredos = true, resend = "re_chave_de_teste_do_emissor", envLicencas = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bunker707-licencas-servidor-"));
  dirs.push(dir);
  const emissor = join(dir, "emissor");
  mkdirSync(emissor, { recursive: true });
  if (implantado) {
    writeFileSync(join(emissor, "compose.yaml"), "name: bunker-licensing\n");
    writeFileSync(join(emissor, ".env"), "EMISSOR_PORTA_NO_HOST=8080\nEMISSOR_LINK_LOJA=https://membros.exemplo.com.br/loja\n");
    writeFileSync(join(emissor, ".imagem"), "ghcr.io/danilosouza-dev/bunker-licensing@sha256:" + "b".repeat(64) + "\n");
  }
  if (segredos) {
    mkdirSync(join(emissor, "segredos"));
    for (const f of ["postgres-senha", "emissao.pem", "emissao-senha", "emissao-certificado.json"]) writeFileSync(join(emissor, "segredos", f), "x");
    if (resend !== null) writeFileSync(join(emissor, "segredos", "resend-chave"), resend);
  }
  const envFile = join(dir, "licencas.env");
  const valores = { RESTIC_REPOSITORY: "sftp:storagebox:bunker707/restic-licencas", RESTIC_PASSWORD: "senha-restic-de-teste", STORAGE_BOX_USER: "u100", STORAGE_BOX_HOST: "u100.your-storagebox.de", BACKUP_KEEP_HOURLY: "48", BACKUP_KEEP_DAILY: "30", BACKUP_PRUNE_HOUR: "03", ...envLicencas };
  writeFileSync(envFile, Object.entries(valores).map(([k, v]) => `${k}=${v}\n`).join(""));
  const home = join(dir, "home");
  mkdirSync(join(home, ".ssh"), { recursive: true });
  writeFileSync(join(home, ".ssh", "id_ed25519_storagebox"), "chave");
  const shims = join(dir, "shims");
  mkdirSync(shims);
  const date = String.raw`if (process.argv.slice(2).join(" ") === "-u +%H") { console.log(process.env.SHIM_HORA ?? "12"); process.exit(0); }
const r = (await import("node:child_process")).spawnSync(process.env.SHIM_DATE_REAL, process.argv.slice(2), { stdio: "inherit" }); process.exit(r.status ?? 1);`;
  const curl = String.raw`if (process.argv.slice(2).some((a) => /^http:\/\/127\.0\.0\.1:\d+\/health$/.test(a))) { process.stdout.write(process.env.SHIM_SAUDE ?? '{"ok":true}'); process.exit(0); }`;
  for (const [name, source] of [["docker", DOCKER_SHIM], ["restic", RESTIC_SHIM], ["systemctl", LOGGER("systemctl")], ["date", LOGGER("date", date)], ["curl", LOGGER("curl", curl)]]) {
    writeFileSync(join(dir, `${name}.mjs`), source);
    writeFileSync(join(shims, name), `#!/bin/sh\nexec "${process.execPath}" "${join(dir, `${name}.mjs`)}" "$@"\n`);
    chmodSync(join(shims, name), 0o755);
  }
  writeFileSync(join(shims, "sleep"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(shims, "sleep"), 0o755);
  const log = join(dir, "chamadas.log");
  const backups = join(dir, "backups");
  const units = join(dir, "systemd");
  mkdirSync(units);
  const run = (script, args = [], extra = {}) => {
    const env = {
      ...process.env,
      PATH: `${shims}:${process.env.PATH}`,
      HOME: home,
      LICENCAS_EMISSOR_DIR: emissor,
      BUNKER707_ENV_FILE: envFile,
      LICENCAS_BACKUP_DIR: backups,
      LICENCAS_SYSTEMD_DIR: units,
      SUDO_USER: userInfo().username,
      SHIM_LOG: log,
      SHIM_DATE_REAL: realDate,
      SHIM_COMPOSE_JSON: COMPOSE_JSON,
      SHIM_ENV_EXAMPLE: ENV_EXAMPLE,
      ...extra
    };
    for (const name of ["BUNKER707_COMPOSE_FILE", "BUNKER707_COMPOSE_OVERRIDE", "SEM_BACKUP_ANTES", "COMPOSE_PROFILES"]) if (!(name in extra)) delete env[name];
    const result = spawnSync("bash", [join(scriptsDir, script), ...args], { encoding: "utf8", env });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { dir, emissor, envFile, backups, units, run, calls };
}

const docker = (calls, ...pedaco) => calls.findIndex((c) => c.tool === "docker" && pedaco.every((p) => c.args.join(" ").includes(p)));
const restic = (calls, sub) => calls.filter((c) => c.tool === "restic" && c.args.includes(sub));

test("scripts do servidor de licencas: sintaxe do bash e a guarda do dash", () => {
  for (const file of readdirSync(scriptsDir).filter((f) => f.endsWith(".sh"))) {
    const result = spawnSync("bash", ["-n", join(scriptsDir, file)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
    if (file === "_env.sh") continue;
    const source = readFileSync(join(scriptsDir, file), "utf8");
    assert.match(source, /^#!\/usr\/bin\/env bash\n/, file);
    assert.ok(source.includes('[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"'), `${file}: sem a guarda do dash`);
  }
});

test("backup: pg_dump de dentro do container, restic com a marca com-dados, retencao de 48 h e 30 dias agrupada pelo host, e sem segredo nenhum", { skip }, () => {
  const s = servidor();
  const result = s.run("backup.sh");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = s.calls();
  const dump = docker(calls, "exec -T postgres pg_dump -U emissor -d emissor -Fc");
  const backup = calls.findIndex((c) => c.tool === "restic" && c.args[0] === "backup");
  assert.ok(docker(calls, "ps --format") < dump && dump < backup, "espera o banco, exporta e so entao envia");
  assert.deepEqual(calls[backup].args.slice(0, 7), ["backup", "--tag", "bunker707-licencas", "--tag", "com-dados", "--host", "bunker707-licencas"]);
  const forget = restic(calls, "forget")[0].args;
  assert.deepEqual(forget, ["forget", "--tag", "bunker707-licencas", "--host", "bunker707-licencas", "--group-by", "host", "--keep-hourly", "48", "--keep-daily", "30", "--quiet"], "fora da hora da limpeza, sem prune");
  assert.equal(restic(calls, "check").length, 0);
  const stage = join(s.backups, "stage");
  const [pasta] = readdirSync(stage);
  assert.deepEqual(readdirSync(join(stage, pasta)).sort(), ["emissor.dump", "imagem"], "so o dump e a imagem: nenhum segredo, nenhum .env");
  assert.equal(readFileSync(join(stage, pasta, "emissor.dump"), "utf8"), "PGDMP-falso-3");
  assert.equal(statSync(join(stage, pasta, "emissor.dump")).mode & 0o777, 0o600);
  assert.equal(statSync(join(stage, pasta)).mode & 0o777, 0o700);
  assert.match(readFileSync(join(s.backups, "ultimo-sucesso"), "utf8"), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n$/);
});

test("backup: banco vazio sai marcado vazio; a limpeza pesada (prune) so na hora dela ou no --check, que tambem confere 10% dos dados", { skip }, () => {
  const vazio = servidor();
  assert.equal(vazio.run("backup.sh", [], { SHIM_TOTAL: "0" }).status, 0);
  assert.deepEqual(restic(vazio.calls(), "backup")[0].args.slice(3, 5), ["--tag", "vazio"]);

  const hora = servidor();
  assert.equal(hora.run("backup.sh", [], { SHIM_HORA: "03" }).status, 0);
  assert.ok(restic(hora.calls(), "forget")[0].args.includes("--prune"), "as 03 UTC, com prune");

  const check = servidor();
  assert.equal(check.run("backup.sh", ["--check"]).status, 0);
  const calls = check.calls();
  assert.ok(restic(calls, "forget")[0].args.includes("--prune"));
  assert.deepEqual(restic(calls, "check")[0].args, ["check", "--read-data-subset=10%"]);

  const falha = servidor();
  const result = falha.run("backup.sh", ["--check"], { SHIM_RESTIC_CHECK_FALHA: "1" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /restic check encontrou problema/);
});

test("backup --install-timer: o timer do systemd de hora em hora (minuto 17 UTC, Persistent) roda o backup como o usuario do deploy", { skip }, () => {
  const s = servidor();
  const result = s.run("backup.sh", ["--install-timer"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const timer = readFileSync(join(s.units, "bunker707-licencas-backup.timer"), "utf8");
  const service = readFileSync(join(s.units, "bunker707-licencas-backup.service"), "utf8");
  assert.match(timer, /^OnCalendar=\*-\*-\* \*:17:00 UTC$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^WantedBy=timers\.target$/m);
  assert.match(service, new RegExp(`^User=${userInfo().username}$`, "m"));
  assert.match(service, /^ExecStart=\/usr\/bin\/env bash .*\/infra\/licencas\/scripts\/backup\.sh$/m);
  assert.match(service, /^Type=oneshot$/m);
  const systemctl = s.calls().filter((c) => c.tool === "systemctl").map((c) => c.args.join(" "));
  assert.deepEqual(systemctl.slice(0, 2), ["daemon-reload", "enable --now bunker707-licencas-backup.timer"]);
  assert.equal(statSync(s.backups).mode & 0o777, 0o700);
});

test("backup --init: repositorio novo e criado; o de um servidor anterior e adotado pela senha de recuperacao, sem criar outro", { skip }, () => {
  const novo = servidor();
  assert.equal(novo.run("backup.sh", ["--init"], { SHIM_RESTIC_CONFIG: "nao" }).status, 0);
  assert.equal(restic(novo.calls(), "init").length, 1);
  assert.match(readFileSync(join(novo.dir, "home", ".ssh", "config"), "utf8"), /Host storagebox\n {2}HostName u100\.your-storagebox\.de\n {2}User u100\n {2}Port 23/);

  const existente = servidor();
  assert.equal(existente.run("backup.sh", ["--init"]).status, 0);
  assert.equal(restic(existente.calls(), "init").length, 0, "repositorio que ja abre fica como esta");

  const recuperacao = join(tmpdir(), `bunker707-recuperacao-${process.pid}`);
  writeFileSync(recuperacao, "f".repeat(64));
  try {
    const adotado = servidor();
    const result = adotado.run("backup.sh", ["--init", `--chave-recuperacao=${recuperacao}`], { SHIM_RESTIC_CONFIG: "nao", SHIM_RESTIC_RECUPERACAO: "abre" });
    assert.match(result.stdout, /Repositorio de um servidor anterior adotado/, result.stderr);
    const calls = adotado.calls();
    const keyAdd = calls.find((c) => c.tool === "restic" && c.args.includes("key"));
    assert.ok(keyAdd && keyAdd.recuperacao && !keyAdd.temSenha, "a senha deste servidor entra pela de recuperacao");
    assert.ok(keyAdd.args.includes("--new-password-file"));
    assert.equal(restic(calls, "init").length, 0, "nunca um segundo repositorio por cima do antigo");
  } finally {
    rmSync(recuperacao, { force: true });
  }
});

test("restore: sem --yes nada acontece; com --yes escolhe o backup mais novo com dados, faz um backup antes e so entao troca o banco", { skip }, () => {
  const semConfirmar = servidor();
  const recusa = semConfirmar.run("restore.sh");
  assert.equal(recusa.status, 1);
  assert.match(recusa.stderr, /confirme com --yes/);
  assert.deepEqual(semConfirmar.calls(), []);

  const snapshots = JSON.stringify([
    { id: "1111111111", short_id: "11111111", time: "2026-11-10T10:17:00Z", tags: ["bunker707-licencas", "com-dados"] },
    { id: "2222222222", short_id: "22222222", time: "2026-11-10T11:17:00Z", tags: ["bunker707-licencas", "com-dados"] },
    // O servidor novo e vazio de uma recuperacao: mais novo, mas nunca passa na frente do backup com dados.
    { id: "3333333333", short_id: "33333333", time: "2026-11-10T12:17:00Z", tags: ["bunker707-licencas", "vazio"] }
  ]);
  const s = servidor();
  const result = s.run("restore.sh", ["--yes"], { SHIM_SNAPSHOTS: snapshots });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = s.calls();
  const restore = calls.findIndex((c) => c.tool === "restic" && c.args[0] === "restore");
  assert.equal(calls[restore].args[1], "22222222");
  const lista = docker(calls, "pg_restore --list");
  const backupAntes = calls.findIndex((c) => c.tool === "restic" && c.args[0] === "backup");
  const stop = docker(calls, "compose", "stop");
  const drop = calls.findIndex((c) => c.tool === "docker" && (c.sql ?? "").startsWith("drop database if exists emissor with (force)"));
  const create = calls.findIndex((c) => c.tool === "docker" && (c.sql ?? "").startsWith("create database emissor owner emissor"));
  const pgRestore = calls.findIndex((c, i) => i > create && c.tool === "docker" && c.args.join(" ").includes("pg_restore -U emissor -d emissor --no-owner --exit-on-error"));
  const up = docker(calls, "compose", "up -d --no-build");
  assert.ok(restore < lista && lista < backupAntes && backupAntes < stop && stop < drop && drop < create && create < pgRestore && pgRestore < up, `ordem: ${[restore, lista, backupAntes, stop, drop, create, pgRestore, up]}`);
  assert.deepEqual(calls[stop].args.slice(-2), ["migrar", "emissor"], "para o Emissor e o migrar, nunca o banco");
  assert.equal(calls[drop].args[calls[drop].args.indexOf("-d") + 1], "postgres", "o drop roda conectado ao banco postgres");
  assert.equal(calls[pgRestore].stdin, "PGDMP-do-backup-22222222");
  assert.match(result.stdout, /Readocao: a Instalacao ativada ou ativada de novo depois de 2026-11-10T11:17:00 UTC volta sozinha/);
  assert.ok(!readdirSync(s.backups).some((f) => f.startsWith("restaurar.")), "o arquivo restaurado sai no fim");
});

test("restore --ensaio: Postgres descartavel sem rede, nada no banco em uso, container e arquivo apagados; recusa backup sem migracao", { skip }, () => {
  const snapshots = JSON.stringify([{ id: "4444444444", short_id: "44444444", time: "2026-11-10T09:17:00Z", tags: ["bunker707-licencas", "vazio"] }]);
  const s = servidor();
  const result = s.run("restore.sh", ["--ensaio"], { SHIM_SNAPSHOTS: snapshots });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = s.calls();
  const run = docker(calls, "run -d --rm --name bunker707-licencas-ensaio --network none");
  assert.ok(run >= 0, "um container proprio, sem rede");
  assert.ok(calls[run].args.includes("POSTGRES_HOST_AUTH_METHOD=trust") && calls[run].args.at(-1) === "postgres:16-alpine");
  assert.ok(docker(calls, "exec bunker707-licencas-ensaio pg_isready -h 127.0.0.1") > run, "espera o Postgres pelo TCP, depois da inicializacao");
  const restoreEnsaio = docker(calls, "exec -i bunker707-licencas-ensaio pg_restore");
  assert.equal(calls[restoreEnsaio].stdin, "PGDMP-do-backup-44444444");
  assert.equal(docker(calls, "compose", "stop"), -1, "o Emissor no ar nao para");
  assert.ok(!calls.some((c) => (c.sql ?? "").includes("drop database")), "o banco em uso nao e tocado");
  assert.equal(restic(calls, "backup").length, 0);
  assert.ok(calls.findLastIndex((c) => c.tool === "docker" && c.args.join(" ") === "rm -f bunker707-licencas-ensaio") > restoreEnsaio, "o container do ensaio sai no fim");
  assert.match(result.stdout, /restaurado no ensaio: 5 Licencas, 4 Instalacoes, 20 eventos de auditoria, ultima migracao 0001_emissor_inicial/);
  assert.match(result.stdout, /Ensaio de restauracao OK \(backup 44444444/);

  const semMigracao = servidor();
  const recusa = semMigracao.run("restore.sh", ["--ensaio"], { SHIM_SNAPSHOTS: snapshots, SHIM_RESUMO_ENSAIO: "0 0 0 -" });
  assert.equal(recusa.status, 1);
  assert.match(recusa.stderr, /nao tem migracao aplicada .*o backup 44444444 nao serve/);
  assert.ok(semMigracao.calls().some((c) => c.tool === "docker" && c.args.join(" ") === "rm -f bunker707-licencas-ensaio"), "o container sai mesmo com a falha");

  const nenhum = servidor().run("restore.sh", ["--ensaio"]);
  assert.equal(nenhum.status, 1);
  assert.match(nenhum.stderr, /nenhum backup do Emissor neste repositorio/);
});

test("implantar: compose e .env.example da imagem -implantacao; .env com as variaveis novas, as raizes, o Painel, a conta de envio e os proxies das duas portas; imagem do GHCR com o nome local, migracoes e /health", { skip }, () => {
  const s = servidor({ implantado: false });
  writeFileSync(join(s.emissor, ".env"), [
    "EMISSOR_PORTA_NO_HOST=8080",
    "ARQUIVO_SENHA_POSTGRES=./segredos/outra-senha",
    "EMISSOR_LINK_LOJA=https://membros.exemplo.com.br/loja",
    "EMISSOR_RAIZES='antigo'",
    "PAINEL_PROXIES_CONFIAVEIS=173.245.48.0/20,172.30.70.1",
    "PAINEL_TETO_DIARIO=50",
    "PAINEL_TETO_DIARIO=60",
    ""
  ].join("\n"));
  const imagem = "ghcr.io/danilosouza-dev/bunker-licensing:main";
  const config = { ...CONFIG_PAINEL, EMISSOR_KIDS_ANTERIORES: "emissao-2026-11", EMISSOR_LINK_RENOVAR: "https://membros.bunker707.com.br/minhas-licencas/{licenca}/renovar" };
  const result = s.run("implantar.sh", [`--imagem=${imagem}`, RAIZES_ARG, configArg(config)]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = s.calls();
  const at = (...p) => docker(calls, ...p);
  const exato = (linha) => calls.findIndex((c) => c.tool === "docker" && c.args.join(" ") === linha);
  const ordem = [
    exato(`pull --quiet ${imagem}-implantacao`),
    exato(`create ${imagem}-implantacao /nada`),
    at("cp cid-de-teste:/implantacao/."),
    exato("rm -f cid-de-teste"),
    exato(`pull --quiet ${imagem}`),
    exato(`tag ${imagem} bunker-licensing-emissor:local`),
    at("compose", "up -d --no-build postgres"),
    at("compose", "run --rm --pull never migrar"),
    at("compose", "up -d --no-build --remove-orphans")
  ];
  assert.ok(ordem.every((i, n) => i >= 0 && (n === 0 || i > ordem[n - 1])), `ordem: ${ordem}`);
  assert.ok(!calls.some((c) => c.tool === "docker" && (c.args[0] === "build" || c.args[0] === "buildx" || c.args.includes("--build"))), "nada e construido no servidor");
  assert.match(readFileSync(join(s.emissor, "compose.yaml"), "utf8"), /compose de teste vindo da imagem -implantacao/);
  const env = readFileSync(join(s.emissor, ".env"), "utf8");
  const linhas = (nome) => env.match(new RegExp(`^${nome}=.*$`, "gm")) ?? [];
  assert.deepEqual(linhas("ARQUIVO_SENHA_POSTGRES"), ["ARQUIVO_SENHA_POSTGRES=./segredos/outra-senha"], "o que ja estava, e o deploy nao decide, fica");
  assert.deepEqual(linhas("ARQUIVO_CHAVE_RESEND"), ["ARQUIVO_CHAVE_RESEND=./segredos/resend-chave"], "a variavel nova do .env.example entra");
  assert.deepEqual(linhas("PAINEL_PORTA_NO_HOST"), ["PAINEL_PORTA_NO_HOST=8081"]);
  assert.deepEqual(linhas("EMISSOR_RAIZES"), [`EMISSOR_RAIZES='[{"rid":"raiz-teste","publicKey":"${"A".repeat(43)}"}]'`]);
  // O Painel, a conta de envio, as chaves anteriores e os links: o que o deploy decidiu, a cada rodada, nunca o exemplo.
  assert.deepEqual(linhas("PAINEL_ENDERECO"), ["PAINEL_ENDERECO='https://licencas.bunker707.com.br'"]);
  assert.deepEqual(linhas("PAINEL_ACCESS_EQUIPE"), ["PAINEL_ACCESS_EQUIPE='bunker707.cloudflareaccess.com'"]);
  assert.deepEqual(linhas("PAINEL_ACCESS_AUD"), [`PAINEL_ACCESS_AUD='${AUD}'`]);
  assert.deepEqual(linhas("PAINEL_TETO_DIARIO"), ["PAINEL_TETO_DIARIO='10'"], "a linha repetida sai e vale o valor do deploy");
  assert.deepEqual(linhas("EMISSOR_EMAIL_PRODUTOR"), ["EMISSOR_EMAIL_PRODUTOR='produtor@exemplo.com.br'"]);
  assert.deepEqual(linhas("EMISSOR_EMAIL_REMETENTE"), ["EMISSOR_EMAIL_REMETENTE='Emissor Bunker707 <emissor@mail.bunker707.com.br>'"]);
  assert.deepEqual(linhas("EMISSOR_KIDS_ANTERIORES"), ["EMISSOR_KIDS_ANTERIORES='emissao-2026-11'"]);
  assert.deepEqual(linhas("EMISSOR_LINK_RENOVAR"), ["EMISSOR_LINK_RENOVAR='https://membros.bunker707.com.br/minhas-licencas/{licenca}/renovar'"]);
  assert.deepEqual(linhas("EMISSOR_LINK_LOJA"), ["EMISSOR_LINK_LOJA="], "o link que o deploy nao manda fica vazio");
  // As duas portas: so o Caddy, pelo gateway da rede borda, e o X-Forwarded-For com o IP que ele escreve.
  assert.deepEqual(linhas("EMISSOR_PROXIES_CONFIAVEIS"), ["EMISSOR_PROXIES_CONFIAVEIS='172.30.70.1'"]);
  assert.deepEqual(linhas("PAINEL_PROXIES_CONFIAVEIS"), ["PAINEL_PROXIES_CONFIAVEIS='172.30.70.1'"], "as faixas da Cloudflare saem da lista do Painel");
  assert.deepEqual(linhas("EMISSOR_CABECALHO_IP"), ["EMISSOR_CABECALHO_IP='x-forwarded-for'"]);
  assert.deepEqual(linhas("PAINEL_CABECALHO_IP"), ["PAINEL_CABECALHO_IP='x-forwarded-for'"]);
  assert.equal(statSync(join(s.emissor, ".env")).mode & 0o777, 0o600);
  assert.match(readFileSync(join(s.emissor, ".imagem"), "utf8"), /^ghcr\.io\/danilosouza-dev\/bunker-licensing@sha256:a{64}\n$/);
  assert.match(result.stdout, /Painel: ligado em https:\/\/licencas\.bunker707\.com\.br \(Access de bunker707\.cloudflareaccess\.com; teto de 10/);
  assert.match(result.stdout, /chaves anteriores aceitas na readocao: emissao-2026-11/);
  assert.match(result.stdout, /proxies confiaveis da API e do Painel: 172\.30\.70\.1/);
  assert.doesNotMatch(result.stdout + result.stderr, /produtor@exemplo|re_chave/, "nem o e-mail do produtor nem a chave do Resend vao para o log");
  assert.match(result.stdout, /\/health ok na porta local 8080/);
  assert.ok(s.calls().some((c) => c.tool === "curl" && c.args.includes("http://127.0.0.1:8080/health")));
});

test("implantar sem o Painel (LICENCAS_SEM_PAINEL=sim no deploy): a chave do Resend vazia serve, o Painel e o e-mail ficam vazios, o exemplo nunca entra e os proxies seguem o gateway da rede borda", { skip }, () => {
  const s = servidor({ implantado: false, resend: "" });
  writeFileSync(join(s.emissor, ".env"), "EMISSOR_GATEWAY_BORDA=172.30.71.1\nEMISSOR_REDE_BORDA=172.30.71.0/24\n");
  const exemplo = ENV_EXAMPLE + "# Uma variavel que um .env.example futuro traga so com o exemplo.\nEMISSOR_NOVA=<um exemplo>\n";
  const result = s.run("implantar.sh", [IMAGEM, RAIZES_ARG, configArg(SEM_PAINEL)], { SHIM_ENV_EXAMPLE: exemplo });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const env = readFileSync(join(s.emissor, ".env"), "utf8");
  for (const nome of ["PAINEL_ENDERECO", "PAINEL_ACCESS_EQUIPE", "PAINEL_ACCESS_AUD", "EMISSOR_EMAIL_PRODUTOR", "EMISSOR_EMAIL_REMETENTE", "EMISSOR_NOVA"]) {
    assert.deepEqual(env.match(new RegExp(`^${nome}=.*$`, "gm")), [`${nome}=`], `${nome} vazia`);
  }
  assert.doesNotMatch(env, /<[^>\n]*>/, "nenhum exemplo do .env.example no .env");
  assert.match(env, /^EMISSOR_PROXIES_CONFIAVEIS='172\.30\.71\.1'$/m);
  assert.match(env, /^PAINEL_PROXIES_CONFIAVEIS='172\.30\.71\.1'$/m);
  assert.match(result.stdout, /Painel: desligado \(LICENCAS_SEM_PAINEL=sim\)/);
  assert.match(result.stdout, /entraram vazias, so com o exemplo: EMISSOR_NOVA\)/);
});

test("implantar recusa raizes e configuracao fora do formato, o Painel pela metade, segredos que faltam (com o Painel, a chave do Resend) e um Emissor sem saude, sem trocar o que esta no ar", { skip }, () => {
  const nadaMudou = (s, envAntes) => {
    assert.equal(docker(s.calls(), "compose", "up"), -1, "nada sobe");
    if (envAntes !== undefined) assert.equal(readFileSync(join(s.emissor, ".env"), "utf8"), envAntes, "o .env fica como estava");
  };
  const antes = (s) => readFileSync(join(s.emissor, ".env"), "utf8");
  const recusa = (s, args, mensagem, extra) => {
    const envAntes = antes(s);
    const r = s.run("implantar.sh", args, extra);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, mensagem);
    nadaMudou(s, envAntes);
    return r;
  };

  // Formato: conferido antes de qualquer pull, sem tocar no compose nem no .env.
  const ruins = servidor();
  recusa(ruins, [IMAGEM, `--raizes-b64=${b64('[{"rid":"x","publicKey":"curta"}]')}`, configArg()], /LICENCAS_RAIZES precisa ser a lista JSON de 1 a 4 raizes/);
  recusa(ruins, [IMAGEM, RAIZES_ARG], /--config-b64 vazio/);
  recusa(ruins, [IMAGEM, RAIZES_ARG, "--config-b64=nao-e-base64!"], /--config-b64 nao e o JSON em base64/);
  recusa(ruins, [IMAGEM, RAIZES_ARG, configArg({ ...CONFIG_PAINEL, OUTRA: "x" })], /--config-b64 fora do formato/);
  recusa(ruins, [IMAGEM, RAIZES_ARG, configArg({ ...CONFIG_PAINEL, EMISSOR_EMAIL_REMETENTE: "Emissor' ; rm -rf / '" })], /--config-b64 fora do formato/);
  recusa(ruins, [IMAGEM, RAIZES_ARG, configArg({ ...CONFIG_PAINEL, PAINEL_ACCESS_AUD: "" })], /o Painel precisa de PAINEL_ENDERECO, PAINEL_ACCESS_EQUIPE, PAINEL_ACCESS_AUD, EMISSOR_EMAIL_PRODUTOR e EMISSOR_EMAIL_REMETENTE juntos/);
  assert.equal(docker(ruins.calls(), "pull"), -1, "nada foi puxado");
  assert.equal(readFileSync(join(ruins.emissor, "compose.yaml"), "utf8"), "name: bunker-licensing\n", "o compose no ar fica");

  // Segredos: os quatro do Emissor sempre; a chave do Resend com conteudo so com o Painel, e o arquivo sempre.
  const semSegredos = servidor({ implantado: false, segredos: false });
  writeFileSync(join(semSegredos.emissor, ".env"), "");
  recusa(semSegredos, [IMAGEM, RAIZES_ARG, configArg()], /Falta segredos\/postgres-senha no servidor: rode a etapa secrets-licencas/);
  const semResend = servidor({ resend: "" });
  const falta = recusa(semResend, [IMAGEM, RAIZES_ARG, configArg()], /Falta a chave do Resend em segredos\/resend-chave: com o Painel, .*LICENCAS_RESEND_CHAVE .* LICENCAS_SEM_PAINEL=sim/);
  assert.equal(docker(semResend.calls(), "pull"), -1);
  assert.doesNotMatch(falta.stdout + falta.stderr, /produtor@exemplo/);
  recusa(servidor({ resend: null }), [IMAGEM, RAIZES_ARG, configArg(SEM_PAINEL)], /Falta segredos\/resend-chave no servidor \(o compose do Emissor monta o arquivo mesmo sem o Painel; vazio serve\)/);

  // O gateway da rede borda que nao e IP: o .env nao muda e nada sobe.
  const gatewayRuim = servidor();
  writeFileSync(join(gatewayRuim.emissor, ".env"), "EMISSOR_GATEWAY_BORDA=gateway-da-borda\n");
  recusa(gatewayRuim, [IMAGEM, RAIZES_ARG, configArg()], /EMISSOR_GATEWAY_BORDA no \.env do Emissor nao e um IP \(veio gateway-da-borda\)/);

  const doente = servidor({ implantado: false });
  const semSaude = doente.run("implantar.sh", [IMAGEM, RAIZES_ARG, configArg()], { SHIM_SAUDE: '{"ok":false}', SAUDE_TENTATIVAS: "2" });
  assert.equal(semSaude.status, 1);
  assert.match(semSaude.stderr, /O Emissor nao respondeu \{"ok":true\}/);

  const semImagem = servidor({ implantado: false });
  const ghcr = semImagem.run("implantar.sh", [IMAGEM, RAIZES_ARG, configArg()], { SHIM_PULL_FALHA: "-implantacao" });
  assert.equal(ghcr.status, 1);
  assert.match(ghcr.stderr, /Nao consegui puxar .*-implantacao\. Confira: o CI do bunker-licensing publica .*Manage Actions access/);
  assert.match(servidor().run("implantar.sh", ["--imagem=ghcr.io/x/y@sha256:abc", RAIZES_ARG, configArg()]).stderr, /--imagem precisa ser <repositorio>:<tag>/);
});

test("smoke: banco e Emissor saudaveis e /health ok passam; backup velho vira aviso; Emissor sem saude falha", { skip }, () => {
  const s = servidor();
  mkdirSync(s.backups, { recursive: true });
  writeFileSync(join(s.backups, "ultimo-sucesso"), `${new Date(Date.now() - 30 * 60_000).toISOString().slice(0, 19)}Z\n`);
  const ok = s.run("smoke.sh");
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /\/health ok na porta local 8080/);
  assert.match(ok.stdout, /banco: 3 2 10 0001_emissor_inicial/);
  assert.match(ok.stdout, /Caddy: no ar\./);
  assert.match(ok.stdout, /ultimo backup: /);
  assert.doesNotMatch(ok.stderr, /AVISO/);

  writeFileSync(join(s.backups, "ultimo-sucesso"), "2026-01-01T00:00:00Z\n");
  assert.match(s.run("smoke.sh").stderr, /AVISO: o ultimo backup \(2026-01-01T00:00:00Z\) tem mais de 2 horas/);

  const doente = s.run("smoke.sh", [], { SHIM_SAUDE: '{"ok":false}' });
  assert.equal(doente.status, 1);
  assert.match(doente.stderr, /O Emissor nao respondeu/);
});

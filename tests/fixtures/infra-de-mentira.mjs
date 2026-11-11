// Hetzner, Cloudflare, app e servidores de mentira para rodar os scripts de verdade de infra/cloud sem rede (docs/18 §2.5).
// O hcloud guarda servidores, imagens, firewalls, chaves SSH, tipos e o Storage Box num JSON e recusa criar o tipo sem
// estoque; o curl responde como a Cloudflare (DNS num JSON), como o checkip e como o webhook do gravador no app; o ssh e o
// scp anotam o comando e respondem ao backup, ao commit, ao docker, a saude do Jibri, aos .env lidos por get_env e ao que
// o teste escolher em SSH_SHIM_REPLIES; o docker do runner (o GHCR e a imagem do Emissor, que roda a cerimonia com o
// duble do codigo das chaves) e o sftp do Storage Box (uma pasta). Tudo vai para um log so, na ordem em que aconteceu.
// Usado por tests/infra-guardar-producao.test.mjs, tests/infra-gravador-falha.test.mjs, tests/infra-licencas.test.mjs,
// tests/infra-licencas-cerimonia.test.mjs e tests/infra-teste.test.mjs.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const cloudDir = fileURLToPath(new URL("../../infra/cloud/", import.meta.url));

const tempDirs = [];
/** Apaga as pastas temporarias criadas (chamar no `after` do arquivo de teste). */
export function limparInfraDeMentira() {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

function hasBinary(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return !result.error && result.status === 0;
}
/** Os binarios que os scripts usam e que podem faltar na maquina (o teste pula com o motivo). */
export const faltamBinarios = ["jq", "python3", "git"].filter((bin) => !hasBinary(bin, ["--version"]));

const HCLOUD_SHIM = String.raw`
import fs from "node:fs";
const statePath = process.env.HZ_STATE;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
let args = process.argv.slice(2).filter((a) => a !== "--quiet" && a !== "--no-experimental-warnings");
let json = false;
const o = args.indexOf("-o");
if (o >= 0 && args[o + 1] === "json") { json = true; args.splice(o, 2); }
fs.appendFileSync(process.env.SHIM_LOG, JSON.stringify({ tool: "hcloud", args }) + "\n");
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
const out = (value) => { process.stdout.write(json ? JSON.stringify(value) : String(value.name ?? value.id ?? "") + "\n"); };
const fail = (msg) => { process.stderr.write(msg + "\n"); process.exit(1); };
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const labels = () => { const l = {}; args.forEach((a, i) => { if (a === "--label") { const [k, v] = args[i + 1].split("="); l[k] = v; } }); return l; };
const matches = (item, selector) => !selector || selector.split(",").every((pair) => { const [k, v] = pair.split("="); return (item.labels || {})[k] === v; });
const stamp = () => { state.clock = (state.clock || 0) + 1; return new Date(Date.UTC(2026, 10, 3, 12, 0, state.clock)).toISOString(); };
const server = (name) => state.servers.find((s) => s.name === name);
const [group, verb, target] = args;
if (group === "version") { console.log("hcloud 1.70.1"); process.exit(0); }
if (group === "server") {
  if (verb === "describe") { const s = server(target); if (!s) fail("server not found"); out(s); process.exit(0); }
  if (verb === "list") { out(state.servers.filter((s) => matches(s, flag("--selector")))); process.exit(0); }
  if (verb === "shutdown" || verb === "poweroff") { const s = server(target); if (!s) fail("server not found"); s.status = "off"; save(); process.exit(0); }
  if (verb === "poweron") { const s = server(target); if (!s) fail("server not found"); s.status = "running"; save(); process.exit(0); }
  if (verb === "delete") { if (!server(target)) fail("server not found"); state.servers = state.servers.filter((s) => s.name !== target); save(); process.exit(0); }
  if (verb === "create-image") {
    const s = server(target); if (!s) fail("server not found");
    const id = state.nextImageId++;
    state.images.push({ id, type: "snapshot", description: flag("--description"), status: state.imageStatus || "available", labels: labels(), image_size: 3.25, disk_size: state.serverTypes[s.server_type.name].disk, created: stamp(), protection: { delete: false } });
    save(); process.exit(0);
  }
  if (verb === "create") {
    const name = flag("--name"), type = flag("--type"), loc = flag("--location"), image = flag("--image");
    if ((state.unavailable || []).includes(type + "@" + loc)) fail("server type " + type + " unavailable in " + loc + " (resource_unavailable)");
    const n = state.nextIp++;
    state.servers.push({ id: 1000 + n, name, status: "running", image: /^\d+$/.test(String(image)) ? Number(image) : image, server_type: { name: type }, location: { name: loc }, public_net: { ipv4: { ip: "198.51.100." + n }, ipv6: { ip: "2001:db8:" + n + "::/64" } }, labels: labels(), created: stamp() });
    save(); process.exit(0);
  }
}
if (group === "image") {
  const image = state.images.find((i) => String(i.id) === String(target));
  if (verb === "list") { out(state.images.filter((i) => matches(i, flag("--selector")))); process.exit(0); }
  if (verb === "describe") { if (!image) fail("image not found"); out(image); process.exit(0); }
  if (verb === "enable-protection" || verb === "disable-protection") { if (!image) fail("image not found"); image.protection = { delete: verb === "enable-protection" }; save(); process.exit(0); }
  if (verb === "delete") { if (!image) fail("image not found"); if (image.protection?.delete) fail("image is protected"); state.images = state.images.filter((i) => i !== image); save(); process.exit(0); }
}
if (group === "server-type" && verb === "describe") { const t = state.serverTypes[target]; if (!t) fail("server type not found"); out({ name: target, ...t }); process.exit(0); }
if (group === "server-type" && verb === "list") { out(Object.entries(state.serverTypes).map(([name, t]) => ({ name, ...t }))); process.exit(0); }
if (group === "ssh-key") {
  const key = (state.sshKeys || []).find((k) => k.name === target);
  if (verb === "describe") { if (!key) fail("ssh key not found"); out(key); process.exit(0); }
  if (verb === "create") { state.sshKeys = [...(state.sshKeys || []), { name: flag("--name"), public_key: flag("--public-key") }]; save(); process.exit(0); }
}
if (group === "storage-box" && verb === "describe" && state.storageBox) { out(state.storageBox); process.exit(0); }
if (group === "firewall") {
  const fw = state.firewalls.find((f) => f.name === target);
  if (verb === "describe") { if (!fw) fail("firewall not found"); out(fw); process.exit(0); }
  if (verb === "create") { state.firewalls.push({ name: flag("--name"), applied_to: [], rules: [] }); save(); process.exit(0); }
  if (verb === "delete") { if (!fw) fail("firewall not found"); state.firewalls = state.firewalls.filter((f) => f !== fw); save(); process.exit(0); }
  if (verb === "replace-rules") { fw.rules = JSON.parse(fs.readFileSync(flag("--rules-file"), "utf8")); save(); process.exit(0); }
  if (verb === "apply-to-resource") { fw.applied_to.push({ type: "server", server: { id: server(flag("--server")).id } }); save(); process.exit(0); }
}
if (group === "storage-box" && verb === "describe") fail("storage box not found");
fail("hcloud de mentira: comando inesperado: " + args.join(" "));
`;

const CURL_SHIM = String.raw`
import fs from "node:fs";
const args = process.argv.slice(2);
let method = "GET", url = "", data = null, out = null, writeOut = null;
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === "-X") method = args[++i];
  else if (a === "--data" || a === "--data-binary") data = args[++i];
  else if (a === "-o") out = args[++i];
  else if (a === "-w") writeOut = args[++i];
  else if (a === "-H" || a === "--max-time") i += 1;
  else if (/^https?:/.test(a)) url = a;
}
if (data !== null && method === "GET") method = "POST";
fs.appendFileSync(process.env.SHIM_LOG, JSON.stringify({ tool: "curl", method, url, data }) + "\n");
const reply = (body) => { if (out) fs.writeFileSync(out, body); else process.stdout.write(body); if (writeOut) process.stdout.write("200"); process.exit(0); };
if (url === "https://checkip.amazonaws.com") reply("203.0.113.7\n");
if (url === "https://www.cloudflare.com/ips-v4") reply("173.245.48.0/20\n");
if (url === "https://www.cloudflare.com/ips-v6") reply("2400:cb00::/32\n");
// O webhook do gravador no app (docs/30 §5.3): o GET responde a situacao que o teste escolheu; o POST, ok.
const recorderUrl = process.env.SHIM_RECORDER_URL;
if (recorderUrl && url.startsWith(recorderUrl)) {
  if (method === "GET") reply(JSON.stringify({ recorderStatus: process.env.SHIM_RECORDER_STATUS || "preparing", recordingStatus: null }));
  reply('{"ok":true}');
}
const cfPath = process.env.CF_STATE;
const cf = JSON.parse(fs.readFileSync(cfPath, "utf8"));
const save = () => fs.writeFileSync(cfPath, JSON.stringify(cf, null, 2));
const ok = (result) => reply(JSON.stringify({ success: true, errors: [], result }));
const u = new URL(url);
const path = u.pathname.replace("/client/v4", "");
if (path === "/zones") ok([{ id: "zona1" }]);
if (path === "/zones/zona1/dns_records" && method === "GET") {
  const name = u.searchParams.get("name"), type = u.searchParams.get("type");
  ok(cf.records.filter((r) => (!name || r.name === name) && (!type || r.type === type)));
}
if (path === "/zones/zona1/dns_records" && method === "POST") { cf.records.push({ id: "r" + cf.nextId++, ...JSON.parse(data) }); save(); ok({}); }
const rec = /^\/zones\/zona1\/dns_records\/(.+)$/.exec(path);
if (rec && method === "PUT") { cf.records = cf.records.map((r) => (r.id === rec[1] ? { id: r.id, ...JSON.parse(data) } : r)); save(); ok({}); }
if (rec && method === "DELETE") { cf.records = cf.records.filter((r) => r.id !== rec[1]); save(); ok({ id: rec[1] }); }
const setting = /^\/zones\/zona1\/settings\/(.+)$/.exec(path);
if (setting && method === "PATCH") { cf.settings[setting[1]] = JSON.parse(data).value; save(); ok({}); }
process.stderr.write("curl de mentira: inesperado " + method + " " + url + "\n");
process.exit(22);
`;

const SSH_SHIM = String.raw`
import fs from "node:fs";
const args = process.argv.slice(2);
const withValue = new Set(["-i", "-o", "-O", "-p", "-l", "-F"]);
let target = null, control = null;
const rest = [];
for (let i = 0; i < args.length; i += 1) {
  if (target === null && withValue.has(args[i])) { if (args[i] === "-O") control = args[i + 1]; i += 1; continue; }
  if (target === null) { target = args[i]; continue; }
  rest.push(args[i]);
}
const command = rest.join(" ");
let stdin = "";
if (!control && command !== "true") { try { stdin = fs.readFileSync(0, "utf8"); } catch {} }
fs.appendFileSync(process.env.SHIM_LOG, JSON.stringify({ tool: "ssh", target, command, control, stdin: stdin.slice(0, 80) }) + "\n");
if (control) process.exit(0);
const flagOn = (name) => Boolean(process.env[name]);
// Respostas escolhidas pelo teste: [{ contem, saida, codigo }], a primeira cujo trecho aparece no comando.
const replies = process.env.SSH_SHIM_REPLIES ? JSON.parse(process.env.SSH_SHIM_REPLIES) : [];
const reply = replies.find((r) => command.includes(r.contem));
if (reply) { if (reply.saida) process.stdout.write(reply.saida); process.exit(reply.codigo ?? 0); }
// get_env (lib.sh): grep -E '^CHAVE=' arquivo | head -n1 | cut -d= -f2-, respondido pelo mapa SSH_SHIM_ENV.
const key = /grep -E '\^([A-Z0-9_]+)='/.exec(command);
if (key && command.includes("cut -d= -f2-")) {
  const values = process.env.SSH_SHIM_ENV ? JSON.parse(process.env.SSH_SHIM_ENV) : {};
  if (values[key[1]] !== undefined) console.log(values[key[1]]);
  process.exit(0);
}
if (command.includes("systemctl start")) {
  if (flagOn("SSH_SHIM_BACKUP_FAIL")) { process.stderr.write("restic: falhou\n"); process.exit(1); }
  console.log("  ultimo backup: 2026-11-03T12:00:00Z"); process.exit(0);
}
if (command.includes(".deployed-commit")) { console.log(process.env.SSH_SHIM_COMMIT || ""); process.exit(0); }
if (command.includes("docker info")) process.exit(flagOn("SSH_SHIM_NO_DOCKER") ? 1 : 0);
if (command.includes("docker compose up -d") && flagOn("SSH_SHIM_COMPOSE_FAIL")) { process.stderr.write("permission denied while trying to connect to the docker API at unix:///var/run/docker.sock\n"); process.exit(1); }
if (command.includes("/jibri/api/v1.0/health")) {
  if (flagOn("SSH_SHIM_UNHEALTHY")) process.exit(7);
  console.log('{"status":{"busyStatus":"IDLE","health":{"healthStatus":"HEALTHY"}}}'); process.exit(0);
}
if (command.includes("-name '*.mp4'")) { if (process.env.SSH_SHIM_PENDING_MP4) console.log(process.env.SSH_SHIM_PENDING_MP4); process.exit(0); }
if (command.includes("docker ps")) { console.log("  app\tUp 2 minutes (healthy)"); process.exit(0); }
process.exit(0);
`;

// O docker do runner: o login no GHCR (o token pela entrada), o pull e o run da imagem do Emissor, que roda a cerimonia
// (infra/cloud/cerimonia-licencas.mjs) com o duble do codigo das chaves (SHIM_CERIMONIA_MODULOS) e so as variaveis
// passadas por -e NOME; o resto da imagem, como o docker de verdade, nao ve o ambiente do runner.
const DOCKER_SHIM = String.raw`
import fs from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const sub = args[0];
let stdin;
if (sub === "login") { try { stdin = fs.readFileSync(0, "utf8"); } catch { stdin = ""; } }
fs.appendFileSync(process.env.SHIM_LOG, JSON.stringify({ tool: "docker", args, stdin }) + "\n");
if (sub === "login" || sub === "logout") process.exit(0);
if (sub === "pull") process.exit(process.env.SHIM_DOCKER_PULL_FALHA ? 1 : 0);
if (sub === "run") {
  const mount = args.find((a) => a.endsWith(":/cerimonia/cerimonia.mjs:ro"));
  if (!mount) { process.stderr.write("docker de mentira: run sem a cerimonia\n"); process.exit(125); }
  const env = { PATH: process.env.PATH, CERIMONIA_MODULOS: process.env.SHIM_CERIMONIA_MODULOS, CERIMONIA_EXTENSAO: ".mjs" };
  args.forEach((a, i) => { if (a === "-e" && !args[i + 1].includes("=") && process.env[args[i + 1]] !== undefined) env[args[i + 1]] = process.env[args[i + 1]]; });
  const r = spawnSync(process.execPath, [mount.slice(0, -":/cerimonia/cerimonia.mjs:ro".length)], { input: fs.readFileSync(0), env, stdio: ["pipe", "inherit", "inherit"] });
  process.exit(r.status ?? 1);
}
process.stderr.write("docker de mentira: inesperado " + args.join(" ") + "\n");
process.exit(1);
`;

// O sftp do Storage Box: os comandos chegam pela entrada (-b -) e mexem numa pasta (BOX_DIR); o "-" na frente ignora a
// falha, como no sftp de verdade.
const SFTP_SHIM = String.raw`
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const target = args[args.length - 1];
const box = process.env.BOX_DIR;
const lines = fs.readFileSync(0, "utf8").split("\n").filter(Boolean);
if (process.env.SHIM_SFTP_FALHA) { fs.appendFileSync(process.env.SHIM_LOG, JSON.stringify({ tool: "sftp", target, args, cmd: null }) + "\n"); process.stderr.write("Connection refused\n"); process.exit(255); }
for (const line of lines) {
  fs.appendFileSync(process.env.SHIM_LOG, JSON.stringify({ tool: "sftp", target, args: args.slice(0, -1), cmd: line }) + "\n");
  const ignora = line.startsWith("-");
  const [cmd, ...rest] = (ignora ? line.slice(1) : line).trim().split(/\s+/);
  const r = (p) => path.join(box, p);
  try {
    if (cmd === "pwd") console.log("Remote working directory: /home");
    else if (cmd === "ls") { for (const f of fs.readdirSync(r(rest.filter((x) => !x.startsWith("-"))[0])).sort()) console.log(f); }
    else if (cmd === "mkdir") fs.mkdirSync(r(rest[0]));
    else if (cmd === "put") fs.copyFileSync(rest[0], r(rest[1]));
    else if (cmd === "get") fs.copyFileSync(r(rest[0]), rest[1]);
    else throw new Error("comando inesperado: " + cmd);
  } catch (e) {
    if (!ignora) { process.stderr.write(e.message + "\n"); process.exit(1); }
  }
}
`;

const SCP_SHIM = String.raw`
import fs from "node:fs";
fs.appendFileSync(process.env.SHIM_LOG, JSON.stringify({ tool: "scp", args: process.argv.slice(2).filter((a) => !a.startsWith("-") && !a.includes("=")).slice(-2) }) + "\n");
process.exit(0);
`;

/** Um servidor da producao como a API da Hetzner o descreve (cx23 em fsn1). */
export function serverFixture(name, role, n, extra = {}) {
  return {
    id: 100 + n,
    name,
    status: "running",
    server_type: { name: "cx23" },
    location: { name: "fsn1" },
    public_net: { ipv4: { ip: `192.0.2.${n}` }, ipv6: { ip: `2001:db8:a${n}::/64` } },
    labels: { app: "bunker707", papel: role },
    created: "2026-10-19T10:00:00.000Z",
    ...extra
  };
}

export const serverTypes = {
  cx23: { disk: 40, prices: [{ location: "fsn1", price_monthly: { net: "6.4900" }, price_hourly: { net: "0.0104" } }, { location: "nbg1", price_monthly: { net: "6.4900" }, price_hourly: { net: "0.0104" } }] },
  cx33: { disk: 80, prices: [{ location: "fsn1", price_monthly: { net: "9.9900" }, price_hourly: { net: "0.0160" } }] },
  cpx32: { disk: 160, prices: [{ location: "fsn1", price_monthly: { net: "35.4900" }, price_hourly: { net: "0.0569" } }] },
  cpx42: { disk: 320, prices: [{ location: "fsn1", price_monthly: { net: "81.4900" }, price_hourly: { net: "0.1314" } }] }
};

export function oldImage(id, role, created, extra = {}) {
  return { id, type: "snapshot", description: `bunker707-${role}-antigo-${id}`, status: "available", labels: { app: "bunker707", papel: role, tipo: "cx23", local: "fsn1" }, image_size: 3, disk_size: 40, created, protection: { delete: true }, ...extra };
}

export const record = (name, type, content, proxied) => ({ id: `${name}-${type}`, type, name, content, proxied, ttl: 1 });
export const hzCall = (calls, prefix) => calls.findIndex((c) => c.tool === "hcloud" && c.args.join(" ").startsWith(prefix));
export const hzCalls = (calls, prefix) => calls.filter((c) => c.tool === "hcloud" && c.args.join(" ").startsWith(prefix));

/**
 * Uma conta de mentira: servidores, imagens, DNS e firewalls iniciais; `runScript(script, env, args)` roda o script de
 * infra/cloud com os binarios de mentira na frente do PATH; `calls()` le o log na ordem; `hz()` e `cf()` o estado.
 */
export function criarInfraDeMentira({ servers = [], images = [], unavailable = [], records = [], imageStatus, firewalls, tipos, storageBox, sshKeys } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bunker707-infra-"));
  tempDirs.push(dir);
  const shims = join(dir, "shims");
  mkdirSync(shims);
  for (const [name, source] of [["hcloud", HCLOUD_SHIM], ["curl", CURL_SHIM], ["ssh", SSH_SHIM], ["scp", SCP_SHIM], ["docker", DOCKER_SHIM], ["sftp", SFTP_SHIM]]) {
    writeFileSync(join(dir, `${name}-shim.mjs`), source);
    writeFileSync(join(shims, name), `#!/bin/sh\nexec "${process.execPath}" "${join(dir, `${name}-shim.mjs`)}" "$@"\n`);
    chmodSync(join(shims, name), 0o755);
  }
  // As esperas dos scripts (desligar, imagem pronta, saude do Jibri) nao precisam de tempo de verdade aqui.
  writeFileSync(join(shims, "sleep"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(shims, "sleep"), 0o755);
  const hzState = join(dir, "hetzner.json");
  const cfState = join(dir, "cloudflare.json");
  const log = join(dir, "chamadas.log");
  const fws = firewalls ?? ["bunker707-membros", "bunker707-marketing", "bunker707-meet"].map((s) => ({ name: `${s}-fw`, applied_to: [], rules: [] }));
  writeFileSync(hzState, JSON.stringify({ servers, images, firewalls: fws, serverTypes: tipos ?? serverTypes, unavailable, imageStatus, storageBox, sshKeys, nextImageId: 9000, nextIp: 10 }));
  writeFileSync(cfState, JSON.stringify({ records, settings: {}, nextId: 1 }));
  const work = join(dir, "work");
  mkdirSync(work);
  // O Storage Box: uma pasta, mexida pelo sftp de mentira.
  const box = join(dir, "storagebox");
  mkdirSync(box);
  const env = (extra = {}) => {
    const base = { ...process.env };
    for (const name of ["HCLOUD_TOKEN", "CLOUDFLARE_API_TOKEN", "GITHUB_TOKEN", "GITHUB_OUTPUT", "GITHUB_ACTIONS", "GITHUB_REF", "RUNNER_TEMP", "OPCOES", "PAYLOAD", "COMANDO", "PAPEIS", "MEMBROS_TYPE", "MARKETING_TYPE", "MEET_TYPE", "SKIP_MARKETING", "PRODUCER_IP", "JIBRI_SECRETS", "SESSAO", "CONFIRMADO", "CONFIRMAR", "FORCAR", "FORCE", "MANTER_SE_FALHAR", "SO_SE_PREPARANDO", "SNAPSHOT", "SSH", "TROCAR_SENHA_BANCO", "SEM_BACKUP_ANTES", "ROTACIONAR", "GITHUB_EVENT_PATH", "GITHUB_REPOSITORY", "PACOTE_RUN"]) delete base[name];
    for (const name of Object.keys(base)) if (name.startsWith("LICENCAS_") || name.startsWith("TESTE_")) delete base[name];
    return {
      ...base,
      PATH: `${shims}:${process.env.PATH}`,
      TMPDIR: work,
      HCLOUD_TOKEN: "token-de-teste-com-mais-de-32-caracteres-0001",
      CLOUDFLARE_API_TOKEN: "cf-token-de-teste",
      HZ_STATE: hzState,
      CF_STATE: cfState,
      SHIM_LOG: log,
      BOX_DIR: box,
      // As raizes publicas do repositorio: um arquivo desta conta de mentira (so existe se o teste o escrever), nunca o
      // infra/licencas/raizes.json de verdade, que chega num commit depois da cerimonia.
      LICENCAS_RAIZES_ARQUIVO: join(dir, "raizes.json"),
      SHIM_CERIMONIA_MODULOS: fileURLToPath(new URL("./emissor-chaves", import.meta.url)),
      ...extra
    };
  };
  const runScript = (script, extra = {}, args = []) => {
    const result = spawnSync("bash", [join(cloudDir, script), ...args], { encoding: "utf8", env: env(extra) });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  const hz = () => JSON.parse(readFileSync(hzState, "utf8"));
  const cf = () => JSON.parse(readFileSync(cfState, "utf8"));
  return { runScript, calls, hz, cf, envFor: env, box, work, raizesArquivo: join(dir, "raizes.json") };
}

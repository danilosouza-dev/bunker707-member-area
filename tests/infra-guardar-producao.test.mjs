import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

// Guardar a producao em snapshot e trazer de volta (infra/cloud/snapshot.sh e restaurar.sh; docs/20 §4A.7, decisao
// de 03/11/2026). Os scripts de verdade rodam contra um hcloud, um curl e um ssh de mentira: o hcloud guarda servidores,
// imagens e firewalls num JSON e recusa criar o tipo sem estoque; o curl responde como a Cloudflare (DNS num JSON) e
// como o checkip; o ssh anota o comando e responde ao backup, ao commit e ao docker ps. Tudo vai para um log so, na
// ordem em que aconteceu. Nada fala com a Hetzner, a Cloudflare ou um servidor.

const cloudDir = fileURLToPath(new URL("../infra/cloud/", import.meta.url));
const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function hasBinary(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return !result.error && result.status === 0;
}
const missing = ["jq", "python3", "git"].filter((bin) => !hasBinary(bin, ["--version"]));

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
    state.servers.push({ id: 1000 + n, name, status: "running", image: Number(image), server_type: { name: type }, location: { name: loc }, public_net: { ipv4: { ip: "198.51.100." + n }, ipv6: { ip: "2001:db8:" + n + "::/64" } }, labels: labels(), created: stamp() });
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
if (group === "firewall") {
  const fw = state.firewalls.find((f) => f.name === target);
  if (verb === "describe") { if (!fw) fail("firewall not found"); out(fw); process.exit(0); }
  if (verb === "create") { state.firewalls.push({ name: flag("--name"), applied_to: [], rules: [] }); save(); process.exit(0); }
  if (verb === "replace-rules") { fw.rules = JSON.parse(fs.readFileSync(flag("--rules-file"), "utf8")); save(); process.exit(0); }
  if (verb === "apply-to-resource") { fw.applied_to.push({ type: "server", server: { id: server(flag("--server")).id } }); save(); process.exit(0); }
}
if (group === "storage-box" && verb === "describe") fail("storage box not found");
fail("hcloud de mentira: comando inesperado: " + args.join(" "));
`;

const CURL_SHIM = String.raw`
import fs from "node:fs";
const args = process.argv.slice(2);
let method = "GET", url = "", data = null, out = null;
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === "-X") method = args[++i];
  else if (a === "--data" || a === "--data-binary") data = args[++i];
  else if (a === "-o") out = args[++i];
  else if (a === "-H" || a === "-w" || a === "--max-time") i += 1;
  else if (/^https?:/.test(a)) url = a;
}
fs.appendFileSync(process.env.SHIM_LOG, JSON.stringify({ tool: "curl", method, url, data }) + "\n");
const reply = (body) => { if (out) fs.writeFileSync(out, body); else process.stdout.write(body); process.exit(0); };
if (url === "https://checkip.amazonaws.com") reply("203.0.113.7\n");
if (url === "https://www.cloudflare.com/ips-v4") reply("173.245.48.0/20\n");
if (url === "https://www.cloudflare.com/ips-v6") reply("2400:cb00::/32\n");
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
if (command.includes("systemctl start")) {
  if (process.env.SSH_SHIM_BACKUP_FAIL) { process.stderr.write("restic: falhou\n"); process.exit(1); }
  console.log("  ultimo backup: 2026-11-03T12:00:00Z"); process.exit(0);
}
if (command.includes(".deployed-commit")) { console.log(process.env.SSH_SHIM_COMMIT || ""); process.exit(0); }
if (command.includes("docker ps")) { console.log("  app\tUp 2 minutes (healthy)"); process.exit(0); }
process.exit(0);
`;

function serverFixture(name, role, n) {
  return {
    id: 100 + n,
    name,
    status: "running",
    server_type: { name: "cx23" },
    location: { name: "fsn1" },
    public_net: { ipv4: { ip: `192.0.2.${n}` }, ipv6: { ip: `2001:db8:a${n}::/64` } },
    labels: { app: "bunker707", papel: role },
    created: "2026-10-19T10:00:00.000Z"
  };
}

const serverTypes = {
  cx23: { disk: 40, prices: [{ location: "fsn1", price_monthly: { net: "6.4900" }, price_hourly: { net: "0.0104" } }, { location: "nbg1", price_monthly: { net: "6.4900" }, price_hourly: { net: "0.0104" } }] },
  cx33: { disk: 80, prices: [{ location: "fsn1", price_monthly: { net: "9.9900" }, price_hourly: { net: "0.0160" } }] },
  cpx32: { disk: 160, prices: [{ location: "fsn1", price_monthly: { net: "35.4900" }, price_hourly: { net: "0.0569" } }] }
};

function oldImage(id, role, created, extra = {}) {
  return { id, type: "snapshot", description: `bunker707-${role}-antigo-${id}`, status: "available", labels: { app: "bunker707", papel: role, tipo: "cx23", local: "fsn1" }, image_size: 3, disk_size: 40, created, protection: { delete: true }, ...extra };
}

function setup({ servers = [], images = [], unavailable = [], records = [], imageStatus } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bunker707-guardar-"));
  tempDirs.push(dir);
  const shims = join(dir, "shims");
  mkdirSync(shims);
  for (const [name, source] of [["hcloud", HCLOUD_SHIM], ["curl", CURL_SHIM], ["ssh", SSH_SHIM]]) {
    writeFileSync(join(dir, `${name}-shim.mjs`), source);
    writeFileSync(join(shims, name), `#!/bin/sh\nexec "${process.execPath}" "${join(dir, `${name}-shim.mjs`)}" "$@"\n`);
    chmodSync(join(shims, name), 0o755);
  }
  // As esperas dos scripts (desligar, imagem pronta) nao precisam de tempo de verdade aqui.
  writeFileSync(join(shims, "sleep"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(shims, "sleep"), 0o755);
  const hzState = join(dir, "hetzner.json");
  const cfState = join(dir, "cloudflare.json");
  const log = join(dir, "chamadas.log");
  const firewalls = ["bunker707-membros", "bunker707-marketing", "bunker707-meet"].map((s) => ({ name: `${s}-fw`, applied_to: [], rules: [] }));
  writeFileSync(hzState, JSON.stringify({ servers, images, firewalls, serverTypes, unavailable, imageStatus, nextImageId: 9000, nextIp: 10 }));
  writeFileSync(cfState, JSON.stringify({ records, settings: {}, nextId: 1 }));
  const work = join(dir, "work");
  mkdirSync(work);
  const env = (extra = {}) => {
    const base = { ...process.env };
    for (const name of ["HCLOUD_TOKEN", "CLOUDFLARE_API_TOKEN", "GITHUB_TOKEN", "GITHUB_OUTPUT", "GITHUB_ACTIONS", "RUNNER_TEMP", "OPCOES", "PAYLOAD", "COMANDO", "PAPEIS", "MEMBROS_TYPE", "MARKETING_TYPE", "MEET_TYPE", "SKIP_MARKETING", "PRODUCER_IP"]) delete base[name];
    return {
      ...base,
      PATH: `${shims}:${process.env.PATH}`,
      TMPDIR: work,
      HCLOUD_TOKEN: "token-de-teste-com-mais-de-32-caracteres-0001",
      CLOUDFLARE_API_TOKEN: "cf-token-de-teste",
      HZ_STATE: hzState,
      CF_STATE: cfState,
      SHIM_LOG: log,
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
  return { runScript, calls, hz, cf, envFor: env };
}

const hzCall = (calls, prefix) => calls.findIndex((c) => c.tool === "hcloud" && c.args.join(" ").startsWith(prefix));
const hzCalls = (calls, prefix) => calls.filter((c) => c.tool === "hcloud" && c.args.join(" ").startsWith(prefix));
const record = (name, type, content, proxied) => ({ id: `${name}-${type}`, type, name, content, proxied, ttl: 1 });

function productionOn() {
  return {
    servers: [serverFixture("bunker707-membros", "membros", 1), serverFixture("bunker707-marketing", "marketing", 2), serverFixture("bunker707-meet", "meet", 3)],
    images: [oldImage(501, "membros", "2026-10-20T10:00:00.000Z"), oldImage(502, "membros", "2026-10-25T10:00:00.000Z")],
    records: [
      record("membros.bunker707.com.br", "A", "192.0.2.1", true),
      record("membros.bunker707.com.br", "AAAA", "2001:db8:a1::1", true),
      record("api.bunker707.com.br", "A", "192.0.2.1", true),
      record("studio.bunker707.com.br", "A", "192.0.2.1", true),
      record("marketing.bunker707.com.br", "A", "192.0.2.2", true),
      record("meet.bunker707.com.br", "A", "192.0.2.3", false),
      record("www.bunker707.com.br", "CNAME", "site.exemplo.com", true)
    ]
  };
}

test("snapshot guarda os tres papeis: backup novo antes de qualquer imagem, desliga pelo sistema, imagem protegida com tipo e local, apaga so depois e fica com os 2 mais novos", { skip: missing.length ? `faltam ${missing.join(", ")}` : false }, () => {
  const env = setup(productionOn());
  const result = env.runScript("snapshot.sh", { CONFIRMAR: "apagar" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = env.calls();
  const state = env.hz();

  assert.deepEqual(state.servers, [], "os tres servidores apagados");
  const firstImage = hzCall(calls, "server create-image");
  const backups = calls.map((c, i) => ({ c, i })).filter(({ c }) => c.tool === "ssh" && c.command.includes("systemctl start"));
  assert.deepEqual(backups.map(({ c }) => [c.target, c.command.match(/'(bunker707[^']*\.service)'/)[1]]), [
    ["deploy@192.0.2.1", "bunker707-backup.service"],
    ["deploy@192.0.2.2", "bunker707-mautic-backup.service"]
  ], "backup do A e do B, nenhum no C (sem dado de aluno)");
  assert.ok(backups.every(({ i }) => i < firstImage), "todos os backups terminam antes da primeira imagem");

  for (const [role, name] of [["membros", "bunker707-membros"], ["marketing", "bunker707-marketing"], ["meet", "bunker707-meet"]]) {
    const shutdown = hzCall(calls, `server shutdown ${name}`);
    const image = hzCall(calls, `server create-image ${name}`);
    const del = hzCall(calls, `server delete ${name}`);
    assert.ok(shutdown >= 0 && shutdown < image && image < del, `${name}: desliga, faz a imagem e so entao apaga`);
    const newest = state.images.filter((i) => i.labels.papel === role).sort((a, b) => a.created.localeCompare(b.created)).at(-1);
    assert.deepEqual(newest.labels, { app: "bunker707", papel: role, origem: name, tipo: "cx23", local: "fsn1" });
    assert.equal(newest.protection.delete, true, `${role}: o snapshot novo fica protegido contra exclusao`);
  }
  assert.equal(hzCall(calls, "server poweroff"), -1, "o desligar pelo sistema respondeu: a energia nao e cortada");

  const membrosImages = state.images.filter((i) => i.labels.papel === "membros").map((i) => i.id);
  assert.equal(membrosImages.length, 2, "ficam os 2 mais novos do membros");
  assert.ok(!membrosImages.includes(501) && membrosImages.includes(502), "o mais velho (501) sai, mesmo protegido; o 502 fica");
  assert.ok(hzCall(calls, "image disable-protection 501") < hzCall(calls, "image delete 501"));

  assert.deepEqual(env.cf().records.map((r) => r.name), ["www.bunker707.com.br"], "so os nomes dos papeis guardados somem");
  const closed = state.firewalls.find((f) => f.name === "bunker707-membros-fw").rules;
  assert.ok(!closed.some((r) => r.port === "22"), "a porta 22 do A termina fechada");
  assert.match(result.stdout, /total: [\d.]+ GB, cerca de EUR [\d.]+ por mes/);
});

test("snapshot para antes de apagar qualquer coisa: backup que falha, gravador vivo, sem CONFIRMAR ou PAPEIS errado", { skip: missing.length ? `faltam ${missing.join(", ")}` : false }, () => {
  const backupFails = setup(productionOn());
  const failed = backupFails.runScript("snapshot.sh", { CONFIRMAR: "apagar", SSH_SHIM_BACKUP_FAIL: "1" });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /O backup do bunker707-membros falhou; nada foi apagado/);
  assert.equal(backupFails.hz().servers.length, 3, "os tres continuam");
  assert.ok(backupFails.hz().servers.every((s) => s.status === "running"), "e ligados");
  assert.equal(hzCall(backupFails.calls(), "server create-image"), -1);
  assert.equal(hzCall(backupFails.calls(), "server shutdown"), -1);

  const live = productionOn();
  live.servers.push({ ...serverFixture("bunker707-jibri-sessao-1", "jibri", 9), labels: { app: "bunker707", papel: "jibri", sessao: "sessao-1" } });
  const withRecorder = setup(live);
  const blocked = withRecorder.runScript("snapshot.sh", { CONFIRMAR: "apagar" });
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /Gravador vivo \(bunker707-jibri-sessao-1\)/);
  assert.equal(hzCall(withRecorder.calls(), "server shutdown"), -1, "nada desligado com a live no ar");
  assert.ok(!withRecorder.calls().some((c) => c.tool === "ssh"), "nem o backup comeca");

  const onlyMembros = withRecorder.runScript("snapshot.sh", { CONFIRMAR: "apagar", PAPEIS: "membros" });
  assert.equal(onlyMembros.status, 0, onlyMembros.stderr);
  assert.deepEqual(withRecorder.hz().servers.map((s) => s.name).sort(), ["bunker707-jibri-sessao-1", "bunker707-marketing", "bunker707-meet"], "PAPEIS=membros guarda so o A");
  assert.deepEqual(withRecorder.cf().records.map((r) => r.name).sort(), ["marketing.bunker707.com.br", "meet.bunker707.com.br", "www.bunker707.com.br"]);

  const noConfirm = setup(productionOn());
  const refused = noConfirm.runScript("snapshot.sh");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /CONFIRMAR=apagar/);
  assert.deepEqual(noConfirm.calls(), [], "sem confirmacao nada e chamado");
  const wrongRole = noConfirm.runScript("snapshot.sh", { CONFIRMAR: "apagar", PAPEIS: "membros banco" });
  assert.equal(wrongRole.status, 1);
  assert.match(wrongRole.stderr, /PAPEIS: 'banco' nao e um papel desta producao/);
  assert.deepEqual(noConfirm.calls(), []);
});

test("snapshot que nao fica pronto: o servidor nao e apagado e volta a ligar", { skip: missing.length ? `faltam ${missing.join(", ")}` : false }, () => {
  const env = setup({ servers: [serverFixture("bunker707-meet", "meet", 3)], imageStatus: "creating", records: [record("meet.bunker707.com.br", "A", "192.0.2.3", false)] });
  const result = env.runScript("snapshot.sh", { CONFIRMAR: "apagar", SNAPSHOT_WAIT_TRIES: "3" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Snapshot \d+ nao ficou disponivel; o bunker707-meet NAO foi apagado e foi ligado de novo/);
  const calls = env.calls();
  assert.deepEqual(env.hz().servers.map((s) => [s.name, s.status]), [["bunker707-meet", "running"]]);
  assert.ok(hzCall(calls, "server shutdown bunker707-meet") < hzCall(calls, "server poweron bunker707-meet"));
  assert.equal(hzCall(calls, "server delete"), -1);
  assert.deepEqual(env.cf().records.map((r) => r.name), ["meet.bunker707.com.br"], "o DNS fica");
});

test("restaurar volta no tipo e no local do snapshot, refaz o DNS do papel, o IP do JVB e roda o smoke; avisa quando a main andou", { skip: missing.length ? `faltam ${missing.join(", ")}` : false }, () => {
  const images = [
    oldImage(601, "membros", "2026-11-01T10:00:00.000Z"),
    oldImage(602, "membros", "2026-11-03T10:00:00.000Z"),
    oldImage(603, "marketing", "2026-11-03T10:01:00.000Z"),
    oldImage(604, "meet", "2026-11-03T10:02:00.000Z")
  ];
  const env = setup({ images, unavailable: ["cx23@fsn1"] });
  const result = env.runScript("restaurar.sh", { SSH_SHIM_COMMIT: "0000000000000000000000000000000000000000" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = env.calls();
  const servers = env.hz().servers;

  assert.deepEqual(servers.map((s) => [s.name, s.server_type.name, s.location.name, s.image]), [
    ["bunker707-membros", "cx23", "nbg1", 602],
    ["bunker707-marketing", "cx23", "nbg1", 603],
    ["bunker707-meet", "cx23", "nbg1", 604]
  ], "o snapshot mais novo de cada papel, no cx23 de origem; sem estoque em fsn1, vai para o proximo local");
  assert.ok(hzCalls(calls, "server create").every((c) => c.args.includes("cx23")), "nenhuma tentativa em outro tipo");
  assert.match(result.stdout, /preco: EUR 6\.4900\/mes/);

  const ip = Object.fromEntries(servers.map((s) => [s.name, s.public_net.ipv4.ip]));
  const dns = Object.fromEntries(env.cf().records.filter((r) => r.type === "A").map((r) => [r.name, [r.content, r.proxied]]));
  assert.deepEqual(dns, {
    "membros.bunker707.com.br": [ip["bunker707-membros"], true],
    "api.bunker707.com.br": [ip["bunker707-membros"], true],
    "studio.bunker707.com.br": [ip["bunker707-membros"], true],
    "marketing.bunker707.com.br": [ip["bunker707-marketing"], true],
    "meet.bunker707.com.br": [ip["bunker707-meet"], false]
  }, "o Jitsi fica sem proxy (WebRTC nao passa pela Cloudflare)");
  assert.deepEqual(env.cf().settings, { ssl: "strict", always_use_https: "off" });

  const onMeet = calls.filter((c) => c.tool === "ssh" && c.target === `deploy@${ip["bunker707-meet"]}`).map((c) => c.command);
  const b64 = Buffer.from(ip["bunker707-meet"]).toString("base64");
  const setEnv = onMeet.findIndex((c) => c.includes("'/opt/bunker707/infra/jitsi/.env' 'JVB_ADVERTISE_IPS'") && c.includes(b64));
  const up = onMeet.findIndex((c) => c.includes("infra/jitsi/docker-compose.yml --profile borda up -d") && c.includes("reconnect_focus"));
  const smoke = onMeet.findIndex((c) => c.includes("infra/jitsi/scripts/smoke.sh"));
  assert.ok(setEnv >= 0 && setEnv < up && up < smoke, `no C: o IP novo no .env, o stack de pe e o smoke (${JSON.stringify(onMeet)})`);

  const onMembros = calls.filter((c) => c.tool === "ssh" && c.target === `deploy@${ip["bunker707-membros"]}`).map((c) => c.command);
  assert.ok(onMembros.some((c) => c.includes("docker compose -f infra/compose/docker-compose.yml up -d")));
  assert.ok(onMembros.some((c) => c.includes("bash infra/scripts/smoke.sh")));
  assert.ok(calls.filter((c) => c.tool === "ssh" && c.target === `deploy@${ip["bunker707-marketing"]}`).some((c) => c.command.includes("infra/mautic/scripts/smoke.sh")));
  assert.match(result.stdout, /se a main andou, rode deploy-membros da main/);
  assert.equal(env.hz().images.length, 4, "os snapshots ficam depois da volta (continuam sendo a copia)");
  assert.ok(env.hz().firewalls.every((f) => !f.rules.some((r) => r.port === "22")), "a 22 termina fechada nos tres");
});

test("restaurar nunca sobe num tipo mais caro sozinho; PAPEIS=meet traz so o Jitsi; tipo com disco menor que o snapshot e recusado", { skip: missing.length ? `faltam ${missing.join(", ")}` : false }, () => {
  const images = [oldImage(701, "membros", "2026-11-03T10:00:00.000Z"), oldImage(702, "meet", "2026-11-03T10:01:00.000Z")];
  const noStock = setup({ images, unavailable: ["cx23@fsn1", "cx23@nbg1", "cx23@hel1"] });
  const refused = noStock.runScript("restaurar.sh");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Sem estoque de cx23 em fsn1 nbg1 hel1\. Nada mais caro foi criado/);
  assert.deepEqual(noStock.hz().servers, []);
  assert.ok(hzCalls(noStock.calls(), "server create").every((c) => c.args.includes("cx23")), "nem tentou o cx33 ou o cpx32");

  const twoRoles = setup({ images: [...images, oldImage(703, "marketing", "2026-11-03T10:02:00.000Z")] });
  // Pelo run.sh, como o workflow chama: as opcoes vem separadas por espaco, entao varios papeis vao por virgula.
  const viaRun = spawnSync("bash", [join(cloudDir, "run.sh"), "restaurar"], { encoding: "utf8", env: { ...process.env, ...twoRoles.envFor({ OPCOES: "PAPEIS=marketing,membros" }) } });
  assert.equal(viaRun.status, 0, viaRun.stdout + viaRun.stderr);
  assert.deepEqual(twoRoles.hz().servers.map((s) => s.name), ["bunker707-membros", "bunker707-marketing"], "dois papeis por virgula nas opcoes do workflow, na ordem de sempre; o meet fica guardado");

  const meetOnly = setup({ images });
  const meet = meetOnly.runScript("restaurar.sh", { PAPEIS: "meet" });
  assert.equal(meet.status, 0, meet.stdout + meet.stderr);
  assert.deepEqual(meetOnly.hz().servers.map((s) => s.name), ["bunker707-meet"]);
  assert.deepEqual(meetOnly.cf().records.map((r) => r.name), ["meet.bunker707.com.br", "meet.bunker707.com.br"], "A e AAAA so do meet");
  assert.deepEqual(meetOnly.cf().settings, {}, "sem mexer no TLS da zona quando so o C volta");

  const bigDisk = setup({ images: [oldImage(801, "membros", "2026-11-03T10:00:00.000Z", { disk_size: 80, labels: { app: "bunker707", papel: "membros", tipo: "cx33", local: "fsn1" } })] });
  const forcedSmall = bigDisk.runScript("restaurar.sh", { MEMBROS_TYPE: "cx23", PAPEIS: "membros" });
  assert.equal(forcedSmall.status, 1);
  assert.match(forcedSmall.stderr, /O cx23 tem disco de 40 GB e o snapshot 801 precisa de 80 GB/);
  assert.deepEqual(bigDisk.hz().servers, []);

  const existing = setup({ images, servers: [serverFixture("bunker707-membros", "membros", 1)] });
  const skip = existing.runScript("restaurar.sh", { PAPEIS: "membros" });
  assert.equal(skip.status, 0, skip.stderr);
  assert.match(skip.stdout, /ja existe; nada a restaurar/);
  assert.equal(hzCall(existing.calls(), "server create"), -1);
});

test("com a producao guardada, deploy-membros e jibri-up mandam restaurar em vez de provisionar do zero", { skip: missing.length ? `faltam ${missing.join(", ")}` : false }, () => {
  const env = setup({ images: [oldImage(901, "membros", "2026-11-03T10:00:00.000Z"), oldImage(902, "meet", "2026-11-03T10:01:00.000Z")] });
  const deploy = env.runScript("deploy.sh", {}, ["membros"]);
  assert.equal(deploy.status, 1);
  assert.match(deploy.stderr, /A producao do membros esta guardada em snapshot: rode a etapa restaurar e depois este deploy de novo/);
  const deployMeet = env.runScript("deploy.sh", {}, ["meet"]);
  assert.match(deployMeet.stderr, /rode a etapa restaurar \(PAPEIS=meet traz so o Jitsi\)/);
  const jibri = env.runScript("jibri.sh", { CONFIRMADO: "sim", SESSAO: "sessao-1", JIBRI_SECRETS: "WEBINAR_RECORDER_WEBHOOK_SECRET=s\nBUNNY_LIBRARY_ID=1\nBUNNY_API_KEY=k" }, ["up"]);
  assert.equal(jibri.status, 1);
  assert.match(jibri.stderr, /esta guardado em snapshot: rode restaurar com PAPEIS=meet antes/);
  assert.ok(!env.calls().some((c) => c.tool === "hcloud" && c.args[1] === "create"), "nada criado");
});

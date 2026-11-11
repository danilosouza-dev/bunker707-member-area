// O servidor de um comprador, de mentira, para rodar o instalador do kit (infra/kit/instalar; docs/32 §3.2 e §11.7;
// docs/20 §9D) sem Docker, sem rede e sem tocar nesta maquina (docs/18 §2.5).
//
// - O Pacote da versao de verdade, montado por infra/kit/montar-pacote.mjs a partir deste repositorio, com uma imagem
//   do app de mentira (um `docker save` minimo, com o manifest.json e a configuracao) e, se pedido, assinado com uma
//   chave Ed25519 de teste: o instalador confere o sha256 e a assinatura com o openssl de verdade.
// - Shims no PATH, em Node, com o estado num JSON e cada chamada num log: o docker (load, image inspect, run do gerador
//   de segredos, que roda o gerador de verdade nesta maquina, e o compose: up, ps, exec do banco e do app, logs), o curl
//   (o Emissor, a API e o SMTP do Resend, o certificado pelo --resolve), o getent (o DNS), o ip, o ss, o nproc, o uname,
//   o systemd-detect-virt, o df, o systemctl e o sleep (que nao espera).
// - O app de dentro do container (no-app.mjs) e emulado pelo docker: a situacao e a ativacao da Licenca (a Chave certa
//   e SHIM_CHAVE_CERTA), a conta do dono e o link de entrada. O no-app.mjs de verdade e testado em
//   tests/kit-no-app.test.mjs.
// - O preparo do servidor, o migrador e a conferencia final sao scripts de mentira (os de verdade tem os testes deles);
//   o membros e de mentira no backup e no kit de recuperacao e de verdade na licenca (licenca.sh).
// - `pessoa` roda num pseudo-terminal e responde as perguntas, como uma pessoa no terminal.
// Usado por tests/kit-instalar.test.mjs.

import { generateKeyPairSync } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chavePublicaDoKit, montarPacote } from "../../infra/kit/montar-pacote.mjs";

export const CHAVE_CERTA = "BKA-7Q2M9-K4X8P-3RTV6-W1ZNH-5JD0C-8FBGS";
export const RESEND_CHAVE = "re_ChaveDoResendDaEscola_0123456789";
export const AWS_SEGREDO = "SegredoDaChaveDoBucket/0123456789abcdef";
export const ENDERECO = "alunos.escola.test";
export const API = "api.alunos.escola.test";
export const IP = "5.75.100.20";
export const TAG_DO_APP = "area-de-membros/app:1.0.0";

const dirs = [];
export function limparInstaladorDeMentira() {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const temBinario = (bin, args = ["--version"]) => {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  return !r.error && r.status === 0;
};
/** O que o instalador precisa nesta maquina (o teste pula com o motivo). */
export const faltam = [["python3"], ["openssl", ["version"]], ["tar"], ["flock", ["--version"]]].filter(([bin, args]) => !temBinario(bin, args)).map(([bin]) => bin);

/** Um `docker save` minimo: manifest.json e a configuracao (o id da imagem e o sha256 dela). */
export function imagemDeMentira(pasta, tag = TAG_DO_APP, conteudo = "app") {
  const raiz = join(pasta, `imagem-${conteudo}`);
  mkdirSync(join(raiz, "blobs", "sha256"), { recursive: true });
  const config = JSON.stringify({ architecture: "amd64", os: "linux", config: { Labels: { conteudo } }, rootfs: { type: "layers", diff_ids: [] } });
  const r = spawnSync("sha256sum", { input: config, encoding: "utf8" });
  const hex = r.stdout.split(" ")[0];
  writeFileSync(join(raiz, "blobs", "sha256", hex), config);
  writeFileSync(join(raiz, "manifest.json"), JSON.stringify([{ Config: `blobs/sha256/${hex}`, RepoTags: [tag], Layers: [] }]));
  const tar = join(pasta, `imagem-${conteudo}.tar`);
  spawnSync("tar", ["-cf", tar, "-C", raiz, "manifest.json", "blobs"]);
  return { tar, id: `sha256:${hex}` };
}

const DOCKER = String.raw`
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const env = process.env;
const estado = JSON.parse(fs.readFileSync(env.SHIM_ESTADO, "utf8"));
const salvar = () => fs.writeFileSync(env.SHIM_ESTADO, JSON.stringify(estado, null, 1));
let stdin = "";
// O terminal (o teste da pessoa) nunca e lido: so a entrada que vem de um cano ou de um arquivo.
const leStdin = () => { if (process.stdin.isTTY) return; try { stdin = fs.readFileSync(0, "utf8"); } catch {} };
const log = (extra = {}) => fs.appendFileSync(env.SHIM_LOG, JSON.stringify({ tool: "docker", args: args.map((a) => (a.length > 300 ? "<script>" : a)), ...extra }) + "\n");
const sair = (c = 0) => process.exit(c);
const falhaUmaVez = (nome) => {
  const lista = (env.SHIM_FALHA ?? "").split(",");
  if (!lista.includes(nome) || estado.falhou?.[nome]) return false;
  estado.falhou = { ...(estado.falhou ?? {}), [nome]: true };
  salvar();
  return true;
};
const SERVICOS = ["db", "auth", "rest", "storage", "imgproxy", "api-gw", "app", "caddy"];

if (args[0] === "info") { log(); sair(); }
if (args[0] === "image" && args[1] === "inspect") {
  log();
  const tag = args.at(-1);
  if (estado.imagens[tag]) { console.log(estado.imagens[tag]); sair(); }
  process.stderr.write("Error: No such image: " + tag + "\n"); sair(1);
}
if (args[0] === "load") {
  log();
  if (falhaUmaVez("load")) { process.stderr.write("Error processing tar file\n"); sair(1); }
  const arquivo = args[args.indexOf("-i") + 1];
  const r = spawnSync("tar", ["-xOf", arquivo, "manifest.json"], { encoding: "utf8" });
  for (const item of JSON.parse(r.stdout)) {
    const hex = /([0-9a-f]{64})/.exec(item.Config)[1];
    for (const tag of item.RepoTags) estado.imagens[tag] = env.SHIM_ID_ERRADO ? "sha256:" + "0".repeat(64) : "sha256:" + hex;
  }
  salvar();
  console.log("Loaded image: " + JSON.parse(r.stdout)[0].RepoTags[0]);
  sair();
}
if (args[0] === "run") {
  log();
  const imagem = args[args.indexOf("--entrypoint") + 2];
  if (!estado.imagens[imagem]) { process.stderr.write("Unable to find image '" + imagem + "' locally\n"); sair(125); }
  if (!args.includes("--network") || args[args.indexOf("--network") + 1] !== "none") { process.stderr.write("o gerador tem de rodar sem rede\n"); sair(99); }
  if (falhaUmaVez("gerador")) { process.stderr.write("Erro: falha de mentira no gerador\n"); sair(1); }
  const volume = args[args.indexOf("-v") + 1];
  const pasta = volume.split(":")[0];
  const resto = args.slice(args.indexOf("--entrypoint") + 3);
  const r = spawnSync(process.execPath, [path.join(pasta, resto[0]), ...resto.slice(1)], { cwd: pasta, encoding: "utf8" });
  process.stdout.write(r.stdout); process.stderr.write(r.stderr);
  sair(r.status ?? 1);
}
if (args[0] !== "compose") { log(); sair(); }

let i = 1;
while (args[i] === "-f") i += 2;
const sub = args[i], resto = args.slice(i + 1);
if (sub === "config") { log(); console.log(resto.includes("--services") ? SERVICOS.join("\n") : JSON.stringify({ name: "escola", services: {} })); sair(); }
if (sub === "up") {
  log();
  if (falhaUmaVez("up")) { process.stderr.write("Error response from daemon: falha de mentira\n"); sair(1); }
  const alvo = resto.filter((a) => !a.startsWith("-"));
  for (const s of alvo.length ? alvo : SERVICOS) estado.rodando[s] = true;
  salvar();
  sair();
}
if (sub === "restart") { log(); sair(); }
if (sub === "logs") { log(); console.log('caddy | {"level":"error","msg":"could not get certificate from issuer","error":"acme: challenge failed (de mentira)"}'); sair(); }
if (sub === "ps") {
  log();
  const servico = resto.filter((a) => !a.startsWith("-") && !a.includes("{{") && !["running", "json"].includes(a)).at(-1);
  if (resto.includes("-a") && resto.includes("json")) {
    for (const s of SERVICOS) console.log(JSON.stringify({ Service: s, State: estado.rodando[s] ? "running" : "exited", Health: estado.rodando[s] && s !== "caddy" ? "healthy" : "" }));
    sair();
  }
  if (resto.includes("-q")) { if (servico && estado.rodando[servico]) console.log("cid-" + servico); sair(); }
  if (!estado.rodando[servico]) { sair(); }
  const doentes = (env.SHIM_DOENTE ?? "").split(",");
  console.log(doentes.includes(servico) ? "unhealthy|running" : "healthy|running");
  sair();
}
if (sub === "exec") {
  const at = resto.findIndex((a) => !a.startsWith("-"));
  const servico = resto[at];
  const cmd = resto.slice(at + 1);
  if (!estado.rodando[servico]) { log(); process.stderr.write("service " + servico + " is not running\n"); sair(1); }
  leStdin();
  if (servico === "db" && cmd[0] === "psql") {
    const iC = cmd.indexOf("-c");
    const sql = iC >= 0 ? cmd[iC + 1] : null;
    log({ sql, stdin: stdin ? stdin.slice(0, 2000) : undefined });
    if (sql === null) {
      if (stdin.includes("vault.create_secret")) {
        if (falhaUmaVez("vault")) { process.stderr.write("ERROR: falha de mentira no vault\n"); sair(3); }
        estado.vault = (stdin.match(/'jobs_tick_token'/) ? "com-token" : "sem-token");
      }
      salvar();
      sair();
    }
    if (sql.includes("from cron.job")) { console.log(env.SHIM_CRON ?? "1"); sair(); }
    if (sql.includes("from public.job_runs")) { console.log(env.SHIM_JOB_RUNS ?? "3"); sair(); }
    if (sql.includes("select u.email")) { console.log(Object.keys(estado.usuarios).find((e) => estado.papeis[estado.usuarios[e].id] === "owner") ?? ""); sair(); }
    if (sql.includes("from auth.users")) { console.log(Object.values(estado.usuarios)[0]?.id ?? ""); sair(); }
    if (sql.startsWith("insert into public.admin_roles")) { const id = /values \('([^']+)'/.exec(sql)[1]; estado.papeis[id] = "owner"; salvar(); sair(); }
    sair();
  }
  if (servico === "app" && cmd[0] === "node") {
    const acao = cmd.at(-1);
    const entrada = stdin.trim() ? JSON.parse(stdin) : {};
    log({ acao, entrada: acao === "licenca-ativar" ? { chave: entrada.chave ? "<chave>" : "" } : entrada, chaveNaEntrada: Boolean(entrada.chave) });
    const responder = (o, c = 0) => { console.log(JSON.stringify(o)); sair(c); };
    if (acao === "licenca-estado") {
      if (env.SHIM_LICENCA_MODO === "off") responder({ ok: true, modo: "off" });
      responder({ ok: true, modo: "enforce", ativada: Boolean(estado.licenca.ativada), degrau: estado.licenca.ativada ? "ok" : "nao_ativada" });
    }
    if (acao === "licenca-ativar") {
      if (falhaUmaVez("emissor")) responder({ ok: false, codigo: "sem_resposta", mensagem: "Sem resposta do Emissor de licencas." });
      if (env.SHIM_ATIVACAO_ERRO) responder({ ok: false, codigo: env.SHIM_ATIVACAO_ERRO, mensagem: "Recusado pelo Emissor de mentira: " + env.SHIM_ATIVACAO_ERRO });
      if (entrada.chave !== env.SHIM_CHAVE_CERTA) responder({ ok: false, codigo: "chave_invalida", mensagem: "Esta Chave de ativacao nao vale." });
      estado.licenca = { ativada: true, ativacoes: (estado.licenca.ativacoes ?? 0) + 1 };
      salvar();
      responder({ ok: true, codigo: "ativada", mensagem: "Pronto: esta escola esta ativada.", vaga: "livre" });
    }
    if (acao === "dono-criar") {
      if (falhaUmaVez("auth")) responder({ ok: false, codigo: "auth_recusou", mensagem: "O Auth respondeu 500 ao criar a conta." });
      if (estado.usuarios[entrada.email]) responder({ ok: false, codigo: "existe" });
      const id = "0b5d3c1e-" + String(Object.keys(estado.usuarios).length + 1).padStart(4, "0") + "-4a2b-9c8d-123456789abc";
      estado.usuarios[entrada.email] = { id };
      salvar();
      responder({ ok: true, id, criada: true });
    }
    if (acao === "dono-link") responder({ ok: true, token_hash: "f00dfeed" + "ab".repeat(24) });
    responder({ ok: false, codigo: "acao_desconhecida" }, 1);
  }
  log();
  sair();
}
log();
sair();
`;

const CURL = String.raw`
import fs from "node:fs";
const args = process.argv.slice(2);
const env = process.env;
const estado = JSON.parse(fs.readFileSync(env.SHIM_ESTADO, "utf8"));
const salvar = () => fs.writeFileSync(env.SHIM_ESTADO, JSON.stringify(estado, null, 1));
let config = "";
if (args.includes("-K")) { try { config = fs.readFileSync(0, "utf8"); } catch {} }
const valor = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };
let url = valor("--url") ?? args.filter((a) => /^(https?|smtps?):\/\//.test(a)).at(-1);
const metodo = valor("-X") ?? "GET";
const formato = valor("-w");
const resolve = valor("--resolve");
const cabecalhos = [];
for (let i = 0; i < args.length; i++) if (args[i] === "-H") cabecalhos.push(args[++i]);
const auth = /header = "Authorization: Bearer ([^"]+)"/.exec(config)?.[1] ?? null;
const usuario = /user = "([^"]+)"/.exec(config)?.[1] ?? null;
fs.appendFileSync(env.SHIM_LOG, JSON.stringify({ tool: "curl", url, metodo, args, resolve: resolve ?? null, comChaveNoConfig: Boolean(auth || usuario) }) + "\n");
const sair = (c) => process.exit(c);
const responder = (codigo, corpo = "", cab = {}) => {
  if (args.includes("-D")) {
    process.stdout.write("HTTP/1.1 " + codigo + " OK\r\ndate: " + (env.SHIM_DATA ?? new Date().toUTCString()) + "\r\n");
    for (const [k, v] of Object.entries(cab)) process.stdout.write(k + ": " + v + "\r\n");
    process.stdout.write("\r\n");
  }
  if (valor("-o") !== "/dev/null") process.stdout.write(typeof corpo === "string" ? corpo : JSON.stringify(corpo));
  if (formato) process.stdout.write(formato.replace("%{http_code}", String(codigo)).replace(/\\n/g, "\n"));
  sair(0);
};
const semConexao = (c = 7) => { if (formato) process.stdout.write(formato.replace("%{http_code}", "000").replace(/\\n/g, "\n")); process.stderr.write("curl: (" + c + ") Failed to connect\n"); sair(c); };
const u = new URL(url);
const bloqueadas = (env.SHIM_SMTP_BLOQUEADAS ?? "").split(",");

if (u.protocol === "smtp:" || u.protocol === "smtps:") {
  if (env.SHIM_SEM_INTERNET || bloqueadas.includes(u.port)) semConexao(28);
  if (!valor("--mail-from")) sair(0);
  if (usuario !== "resend:" + env.SHIM_RESEND_CHAVE) { process.stderr.write("curl: (67) Login denied\n"); sair(67); }
  if (env.SHIM_SMTP_RECUSA) { process.stderr.write("curl: (55) MAIL failed: 550 The domain is not verified\n"); sair(55); }
  const mensagem = fs.readFileSync(valor("--upload-file"), "utf8");
  estado.emails.push({ porta: u.port, de: valor("--mail-from"), para: valor("--mail-rcpt"), assunto: /^Subject: (.*)$/m.exec(mensagem)?.[1] });
  salvar();
  sair(0);
}
if (env.SHIM_SEM_INTERNET) semConexao();
if (resolve) {
  const host = resolve.split(":")[0];
  if (!estado.rodando?.caddy) semConexao(7);
  estado.tentativasDeCertificado = (estado.tentativasDeCertificado ?? 0) + 1;
  salvar();
  const depois = Number(env.SHIM_CERTIFICADO_DEPOIS ?? 0);
  if (env.SHIM_CERTIFICADO === "nunca" || estado.tentativasDeCertificado <= depois) { process.stderr.write("curl: (60) SSL certificate problem\n"); if (formato) process.stdout.write("000"); sair(60); }
  responder(host.startsWith("api.") ? 404 : 200, "");
}
if (u.hostname === new URL(env.KIT_EMISSOR_URL).hostname) { if (env.SHIM_EMISSOR_FORA) semConexao(28); responder(200, '{"ok":true}'); }
const api = new URL(env.KIT_EMAIL_API_URL);
if (u.hostname === api.hostname) {
  if (u.pathname === "/" ) responder(200, '{"name":"resend"}');
  if (auth !== env.SHIM_RESEND_CHAVE) responder(401, { statusCode: 401, name: "validation_error", message: "API key is invalid" });
  if (env.SHIM_RESEND_RESTRITA && u.pathname.startsWith("/domains")) responder(401, { statusCode: 401, name: "restricted_api_key", message: "This API key is restricted to only send emails" });
  const corpo = valor("--data-binary") ? JSON.parse(fs.readFileSync(valor("--data-binary").slice(1), "utf8")) : null;
  const registros = [{ record: "SPF", name: "send", type: "MX", ttl: "Auto", status: "pending", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10 }, { record: "DKIM", name: "resend._domainkey", type: "TXT", ttl: "Auto", status: "pending", value: "p=MIGfMA0GCSqGSIb3DQEB" }];
  if (u.pathname === "/domains" && metodo === "GET") responder(200, { data: estado.dominios.map(({ id, name, status }) => ({ id, name, status })) });
  if (u.pathname === "/domains" && metodo === "POST") {
    const d = { id: "4dd369bc-aa82-4ff3-97de-514ae3000ee0", name: corpo.name, status: "not_started", records: registros, consultas: 0 };
    estado.dominios.push(d); salvar();
    responder(201, d);
  }
  const m = /^\/domains\/([^/]+)(\/verify)?$/.exec(u.pathname);
  if (m) {
    const d = estado.dominios.find((x) => x.id === m[1]);
    if (!d) responder(404, { name: "not_found" });
    if (m[2]) { d.pedidosDeVerificacao = (d.pedidosDeVerificacao ?? 0) + 1; salvar(); responder(200, { object: "domain", id: d.id }); }
    d.consultas = (d.consultas ?? 0) + 1;
    if (env.SHIM_DOMINIO_VERIFICA !== "nunca" && d.consultas > Number(env.SHIM_DOMINIO_VERIFICA ?? 1)) d.status = "verified";
    salvar();
    responder(200, d);
  }
}
semConexao(6);
`;

const ANOTA = (nome, corpo = "") => String.raw`
import fs from "node:fs";
const args = process.argv.slice(2);
const env = process.env;
fs.appendFileSync(env.SHIM_LOG, JSON.stringify({ tool: "${nome}", args }) + "\n");
${corpo}
process.exit(0);
`;

const SHIMS = {
  docker: DOCKER,
  curl: CURL,
  getent: ANOTA("getent", String.raw`
const dns = JSON.parse(env.SHIM_DNS ?? "{}")[args[1]] ?? {};
const ips = args[0] === "ahostsv4" ? dns.a ?? [] : [...(dns.aaaa ?? []), ...(dns.a ?? []).map((ip) => "::ffff:" + ip)];
if (!ips.length) process.exit(2);
for (const ip of ips) console.log(ip + "       STREAM " + args[1]);`),
  ip: ANOTA("ip", String.raw`
const familia = args.includes("-6") ? "6" : "4";
const ips = (familia === "4" ? env.SHIM_IPS4 ?? "5.75.100.20" : env.SHIM_IPS6 ?? "").split(",").filter(Boolean);
ips.forEach((ip, n) => console.log((n + 2) + ": eth0    inet" + (familia === "6" ? "6" : "") + " " + ip + "/" + (familia === "6" ? "64" : "32") + " scope global eth0\\       valid_lft forever"));
console.log("3: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0");`),
  ss: ANOTA("ss", String.raw`for (const l of (env.SHIM_SS ?? "LISTEN 0 4096 0.0.0.0:22 0.0.0.0:*").split(";")) if (l) console.log(l);`),
  nproc: ANOTA("nproc", String.raw`console.log(env.SHIM_NPROC ?? "2");`),
  uname: ANOTA("uname", String.raw`console.log(env.SHIM_ARQ ?? "x86_64");`),
  "systemd-detect-virt": ANOTA("systemd-detect-virt", String.raw`console.log(args.includes("--container") ? env.SHIM_CONTAINER ?? "none" : "kvm");`),
  df: ANOTA("df", String.raw`
console.log("Filesystem 1024-blocks Used Available Capacity Mounted on");
const [total, livre] = (env.SHIM_DF ?? "41943040,31457280").split(",").map(Number);
console.log("/dev/sda1 " + total + " " + (total - livre) + " " + livre + " " + Math.round(((total - livre) / total) * 100) + "% /");`),
  systemctl: ANOTA("systemctl"),
  sleep: "process.exit(0);"
};

const SISTEMAS = {
  "ubuntu-24.04": 'PRETTY_NAME="Ubuntu 24.04.3 LTS"\nID=ubuntu\nVERSION_ID="24.04"\n',
  "debian-12": 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nID=debian\nVERSION_ID="12"\n',
  "rocky-9": 'PRETTY_NAME="Rocky Linux 9.4 (Blue Onyx)"\nID="rocky"\nVERSION_ID="9.4"\n'
};

// Os scripts reaproveitados, de mentira: o preparo, o migrador, a conferencia final e o membros (backup e kit de
// recuperacao; a licenca e a de verdade, do pacote).
const SCRIPT = (nome, corpo) => `#!/usr/bin/env bash
printf '%s\\n' "$(node -e 'console.log(JSON.stringify({ tool: process.argv[1], args: process.argv.slice(2) }))' "${nome}" "$@")" >> "$SHIM_LOG"
${corpo}
`;

/** Um servidor com o pacote aberto na pasta da instalacao e tudo de mentira em volta. */
export function servidorDoInstalador({ assinar = false, instalacao = null, sistema = "ubuntu-24.04", memoriaKb = 4015048 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "kit-instalar-"));
  dirs.push(dir);
  const { tar, id } = imagemDeMentira(dir);
  const pacote = join(dir, "opt", "escola");
  let chavePrivada = null;
  let chavePublica = "";
  if (assinar) {
    const par = generateKeyPairSync("ed25519");
    chavePrivada = par.privateKey;
    chavePublica = chavePublicaDoKit(par.publicKey);
  }
  montarPacote({ saida: pacote, versao: "1.0.0", app: tar, instalacao, chavePrivada, criadoEm: new Date("2026-11-11T12:00:00Z"), commit: "teste" });
  const estado = join(dir, "var", "lib", "escola");
  const backups = join(dir, "var", "backups", "escola");
  mkdirSync(backups, { recursive: true });
  mkdirSync(join(dir, "shm"));
  const shims = join(dir, "shims");
  mkdirSync(shims);
  for (const [nome, fonte] of Object.entries(SHIMS)) {
    writeFileSync(join(dir, `${nome}.mjs`), fonte);
    writeFileSync(join(shims, nome), `#!/bin/sh\nexec "${process.execPath}" "${join(dir, `${nome}.mjs`)}" "$@"\n`);
    chmodSync(join(shims, nome), 0o755);
  }
  const falsos = join(dir, "falsos");
  mkdirSync(falsos);
  const scripts = {
    preparar: SCRIPT("preparar", 'exit "${SHIM_PREPARAR_RC:-0}"'),
    migrar: SCRIPT("migrar", 'f="$SHIM_ESTADO.migrar"; if [ -n "${SHIM_MIGRAR_RC:-}" ] && [ ! -e "$f" ]; then : > "$f"; exit "$SHIM_MIGRAR_RC"; fi; exit 0'),
    fumaca: SCRIPT("fumaca", 'f="$SHIM_ESTADO.fumaca"; if [ -n "${SHIM_FUMACA_RC:-}" ] && [ ! -e "$f" ]; then : > "$f"; echo "  FALHA app /api/health"; exit "$SHIM_FUMACA_RC"; fi; echo "  ok   app /api/health"; exit 0'),
    membros: SCRIPT(
      "membros",
      String.raw`case "$1 ${"$"}{2:-}" in
  "licenca "*) exec bash "$KIT_PASTA_INSTALACAO/infra/kit/licenca.sh" "${"$"}{@:2}" ;;
  "backup --iniciar") exit "${"$"}{SHIM_BACKUP_INICIAR_RC:-0}" ;;
  "backup --conferir-destino") exit "${"$"}{SHIM_CONFERIR_DESTINO_RC:-5}" ;;
  "backup --instalar-agendamento") exit 0 ;;
  "backup ") f="$SHIM_ESTADO.backup"; if [ -n "${"$"}{SHIM_BACKUP_RC:-}" ] && [ ! -e "$f" ]; then : > "$f"; exit "$SHIM_BACKUP_RC"; fi; exit 0 ;;
  "kit-de-recuperacao --conferir") [ -e "$SHIM_ESTADO.kit" ] && exit 0; exit 6 ;;
  "kit-de-recuperacao ") [ -t 0 ] || exit 7; printf '\n  FOLHA DE RECUPERACAO (de mentira)\n  ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789\n  Confirme digitando o grupo 2: '; read -r g; [ "$g" = EFGH ] || exit 6; : > "$SHIM_ESTADO.kit"; exit 0 ;;
esac
exit 0`
    )
  };
  for (const [nome, fonte] of Object.entries(scripts)) {
    writeFileSync(join(falsos, nome), fonte);
    chmodSync(join(falsos, nome), 0o755);
  }
  writeFileSync(join(dir, "os-release"), SISTEMAS[sistema]);
  writeFileSync(join(dir, "meminfo"), `MemTotal:        ${memoriaKb} kB\nMemFree:          301234 kB\nMemAvailable:    2097152 kB\n`);
  const estadoShim = join(dir, "shim.json");
  writeFileSync(estadoShim, JSON.stringify({ imagens: {}, rodando: {}, usuarios: {}, papeis: {}, licenca: {}, dominios: [], emails: [] }));
  const log = join(dir, "chamadas.log");
  const envFile = join(pacote, "infra", "compose", ".env");
  const arquivoDoInstalador = join(estado, "instalacao.json");
  const link = join(dir, "usr", "local", "sbin", "membros");

  const ambiente = (extra = {}) => {
    const env = { ...process.env };
    for (const nome of Object.keys(env)) {
      if (nome.startsWith("KIT_") || nome.startsWith("BUNKER707_") || nome.startsWith("RESTIC_") || nome.startsWith("AWS_") || nome.startsWith("SHIM_") || nome === "COMPOSE_PROJECT_NAME" || nome === "DOCKER_HOST") delete env[nome];
    }
    return {
      ...env,
      PATH: `${shims}:${process.env.PATH}`,
      KIT_PASTA_INSTALACAO: pacote,
      KIT_PASTA_ESTADO: estado,
      KIT_PASTA_BACKUP: backups,
      KIT_PASTA_CERTIFICADOS: join(estado, "caddy"),
      KIT_PASTA_TEMPORARIA: join(dir, "shm"),
      KIT_PASTA_SYSTEMD: join(dir, "systemd"),
      KIT_ARQUIVO_TRAVA: join(dir, "trava.lock"),
      KIT_LINK_DO_COMANDO: link,
      KIT_ARQUIVO_OS_RELEASE: join(dir, "os-release"),
      KIT_ARQUIVO_MEMINFO: join(dir, "meminfo"),
      KIT_EMISSOR_URL: "https://licencas-api.emissor.test",
      KIT_EMAIL_API_URL: "https://api.resend.test",
      KIT_EMAIL_SMTP_HOST: "smtp.resend.test",
      KIT_ESPERA_DOMINIO_EMAIL: "3",
      KIT_INTERVALO_DOMINIO_EMAIL: "0",
      KIT_ESPERA_CERTIFICADO: "60",
      KIT_ESPERA_AGENDADOR: "30",
      KIT_SCRIPT_PREPARAR: join(falsos, "preparar"),
      KIT_SCRIPT_MIGRAR: join(falsos, "migrar"),
      KIT_SCRIPT_FUMACA: join(falsos, "fumaca"),
      KIT_SCRIPT_MEMBROS: join(falsos, "membros"),
      ...(chavePublica ? { KIT_CHAVE_DO_PACOTE: chavePublica } : {}),
      SHIM_LOG: log,
      SHIM_ESTADO: estadoShim,
      SHIM_CHAVE_CERTA: CHAVE_CERTA,
      SHIM_RESEND_CHAVE: RESEND_CHAVE,
      SHIM_DNS: JSON.stringify({ [ENDERECO]: { a: [IP] }, [API]: { a: [IP] } }),
      ...extra
    };
  };
  const instalar = join(pacote, "infra", "kit", "instalar");
  const rodar = (args = [], extra = {}, entrada = "") => {
    const r = spawnSync("bash", [instalar, ...args], { encoding: "utf8", env: ambiente(extra), input: entrada, timeout: 120_000 });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", saida: (r.stdout ?? "") + (r.stderr ?? "") };
  };
  /** O mesmo, sem bloquear (para rodar varios servidores ao mesmo tempo). */
  const rodarAsync = (args = [], extra = {}) =>
    new Promise((resolver) => {
      const filho = spawn("bash", [instalar, ...args], { env: ambiente(extra), stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      filho.stdout.on("data", (d) => (stdout += d));
      filho.stderr.on("data", (d) => (stderr += d));
      filho.on("close", (status) => resolver({ status, stdout, stderr, saida: stdout + stderr }));
    });
  const comando = (script, args = [], extra = {}) => {
    const r = spawnSync("bash", [join(pacote, "infra", "kit", script), ...args], { encoding: "utf8", env: ambiente(extra), timeout: 60_000 });
    return { status: r.status, saida: (r.stdout ?? "") + (r.stderr ?? ""), stdout: r.stdout ?? "" };
  };
  const pessoa = (args, regras, extra = {}, script = instalar) => {
    const r = spawnSync("python3", ["-I", join(dir, "pessoa.py"), "bash", script, ...args], {
      encoding: "utf8",
      env: { ...ambiente(extra), PESSOA_REGRAS: JSON.stringify(regras) },
      timeout: 120_000
    });
    return { status: r.status, saida: (r.stdout ?? "") + (r.stderr ?? "") };
  };
  writeFileSync(join(dir, "pessoa.py"), PESSOA);
  const respostas = (valores, modo = 0o600, nome = "respostas.conf") => {
    const caminho = join(dir, nome);
    writeFileSync(caminho, Object.entries(valores).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}\n`).join(""), { mode: modo });
    chmodSync(caminho, modo);
    return caminho;
  };
  const chamadas = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const limparLog = () => rmSync(log, { force: true });
  const shim = () => JSON.parse(readFileSync(estadoShim, "utf8"));
  const lerJson = (caminho) => (existsSync(caminho) ? JSON.parse(readFileSync(caminho, "utf8")) : {});
  const passos = () => lerJson(arquivoDoInstalador).passos ?? {};
  const lerSegredos = () =>
    existsSync(envFile)
      ? Object.fromEntries(readFileSync(envFile, "utf8").split("\n").filter((l) => /^[A-Z]/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]))
      : {};
  return { dir, pacote, estado, backups, envFile, link, arquivoDoInstalador, idDoApp: id, chavePublica, chavePrivada, rodar, rodarAsync, comando, pessoa, respostas, chamadas, limparLog, shim, passos, lerJson, lerSegredos, ambiente };
}

/** As respostas de uma instalacao completa (S3 de mentira). */
export function respostasCompletas(extra = {}) {
  return {
    ENDERECO,
    EMAIL_DONO: "dono@escola.test",
    NOME_DA_ESCOLA: "Escola de Teste",
    CHAVE_ATIVACAO: CHAVE_CERTA,
    RESEND_API_KEY: RESEND_CHAVE,
    EMAIL_REMETENTE: "escola@mail.escola.test",
    BACKUP_DESTINO: "s3:https://s3.us-east-005.backblazeb2.com/escola-backup/membros",
    BACKUP_AWS_ACCESS_KEY_ID: "005chaveDeAcessoId",
    BACKUP_AWS_SECRET_ACCESS_KEY: AWS_SEGREDO,
    ...extra
  };
}

/** Uma pessoa no terminal (pseudo-terminal do python): responde as perguntas pelas regras de PESSOA_REGRAS. */
const PESSOA = String.raw`
import json, os, pty, re, select, sys, time
regras = json.loads(os.environ.get("PESSOA_REGRAS", "[]"))
pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])
saida = b""
lido = 0
fim = time.time() + float(os.environ.get("PESSOA_TEMPO", "90"))
while time.time() < fim:
    pronto, _, _ = select.select([fd], [], [], 0.1)
    if pronto:
        try:
            dados = os.read(fd, 65536)
        except OSError:
            break
        if not dados:
            break
        saida += dados
    texto = saida.decode("utf-8", "replace")
    while regras:
        m = re.search(regras[0]["espera"], texto[lido:])
        if not m:
            break
        resposta = regras.pop(0)["responde"]
        lido += m.end()
        os.write(fd, (resposta + "\n").encode())
_, status = os.waitpid(pid, 0)
sys.stdout.write(saida.decode("utf-8", "replace").replace("\r\n", "\n"))
sys.exit(os.waitstatus_to_exitcode(status))
`;

export const instalarDoRepositorio = fileURLToPath(new URL("../../infra/kit/instalar", import.meta.url));

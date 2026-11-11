// O servidor de um comprador, de mentira, para rodar o comando de operacao do kit (infra/kit/membros; docs/32 §4) sem
// Docker e sem armazenamento de verdade (docs/18 §2.5). O docker guarda os containers num JSON, responde ao compose da
// escola (pg_dump, psql, config) e ao container do ensaio (create, inspect montado dos argumentos, cp, start, exec); o
// restic guarda os repositorios, as chaves e os backups num JSON, le os arquivos de verdade no backup e devolve no
// restore, e erra como o restic 0.16 (senha errada, repositorio que nao existe, destino que recusa a chave de acesso);
// o systemctl e o df anotam. Tudo vai para um log so, na ordem. `pessoa` roda um comando num pseudo-terminal, como uma
// pessoa no terminal: le a folha de recuperacao na tela e responde as perguntas. Usado por tests/kit-membros.test.mjs e
// tests/kit-membros-restic.test.mjs.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const membros = fileURLToPath(new URL("../../infra/kit/membros", import.meta.url));
export const kitDir = fileURLToPath(new URL("../../infra/kit/", import.meta.url));

/** Os segredos do arquivo de segredos de mentira: nenhum pode aparecer na situacao, na tela ou no log. */
export const SEGREDOS = {
  RESTIC_PASSWORD: "senha-do-servidor-para-o-backup-0001",
  AWS_SECRET_ACCESS_KEY: "segredo-da-chave-do-armazenamento-0002",
  POSTGRES_PASSWORD: "senha-do-postgres-da-escola-0003",
  JWT_SECRET: "segredo-do-jwt-da-escola-com-32-letras-0004",
  JOBS_TICK_TOKEN: "token-do-tick-da-escola-0005",
  SMTP_PASS: "re_chave-do-resend-da-escola-0006"
};

const dirs = [];
/** Apaga as pastas temporarias criadas (chamar no `after` do arquivo de teste). */
export function limparKitDeMentira() {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export const temBinario = (bin, args = ["--version"]) => {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  return !r.error && r.status === 0;
};
/** O que os scripts do kit precisam na maquina (o teste pula com o motivo). */
export const faltam = [["python3"], ["flock", ["--version"]], ["shred", ["--version"]]].filter(([bin, args]) => !temBinario(bin, args)).map(([bin]) => bin);

const DOCKER = String.raw`
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const env = process.env;
const estadoArq = env.SHIM_DOCKER_ESTADO;
const estado = fs.existsSync(estadoArq) ? JSON.parse(fs.readFileSync(estadoArq, "utf8")) : { containers: {} };
const salvar = () => fs.writeFileSync(estadoArq, JSON.stringify(estado, null, 1));
let stdin = "";
const leStdin = () => { try { stdin = fs.readFileSync(0, "utf8"); } catch {} };
const log = (extra = {}) => fs.appendFileSync(env.SHIM_LOG, JSON.stringify({ tool: "docker", args, ...extra }) + "\n");
const sair = (codigo = 0) => process.exit(codigo);
const CONTAGENS = { contas: 40, alunos: 30, conteudos: 2, aulas: 12, acessos: 30, progresso: 7, licenca: 1, licenca_ativada: true, objetos_storage: 3, ultima_migracao: "202611100001" };
const OBJETOS = [["avatars", "aluno1/foto.webp", "v-1111"], ["avatars", "aluno2/foto.webp", "v-2222"], ["content-assets", "capas/curso.webp", "v-3333"]];

if (args[0] === "compose") {
  let i = 1;
  while (args[i] === "-f") i += 2;
  const sub = args[i], resto = args.slice(i + 1);
  if (sub === "exec") {
    const at = resto.findIndex((a) => !a.startsWith("-"));
    const cmd = resto.slice(at + 1);
    if (cmd[0] === "psql") { log({ sql: cmd[cmd.indexOf("-c") + 1] }); console.log(env.SHIM_CONTAS ?? "40"); sair(); }
    log();
    if (cmd[0] === "pg_dumpall") { process.stdout.write("-- papeis da escola\nCREATE ROLE anon;\n"); sair(); }
    if (cmd[0] === "pg_dump") { if (env.SHIM_PG_DUMP_FALHA) { process.stderr.write("pg_dump: error: connection failed\n"); sair(1); } process.stdout.write("PGDMP-dump-falso-da-escola"); sair(); }
    if (cmd[0] === "cat") { process.stdout.write("chave-raiz-do-vault-0123456789abcdef"); sair(); }
    sair();
  }
  log();
  if (sub === "ps") {
    if (resto.includes("-q")) { if (env.SHIM_BANCO_NO_AR !== "0") console.log("cid-do-banco"); sair(); }
    console.log(env.SHIM_SAUDE ?? "healthy|running"); sair();
  }
  if (sub === "config") { console.log(JSON.stringify({ name: "escola", services: { db: { image: "supabase/postgres:17.6.1.136" }, app: { image: "app:local" } } })); sair(); }
  sair();
}

if (args[0] === "ps") {
  log();
  const filtro = args[args.indexOf("--filter") + 1] ?? "";
  const rotulo = filtro.replace(/^label=/, "");
  const nomes = Object.entries(estado.containers).filter(([, c]) => c.rotulos.some((r) => r.startsWith(rotulo + "="))).map(([n]) => n);
  for (const n of (env.SHIM_SOBRAS ? env.SHIM_SOBRAS.split(",") : [])) nomes.push(n);
  if (nomes.length) console.log(nomes.join("\n"));
  sair();
}
if (args[0] === "rm") { log(); for (const n of args.slice(1).filter((a) => !a.startsWith("-"))) delete estado.containers[n]; salvar(); sair(); }
if (args[0] === "create") {
  log();
  const c = { rotulos: [], volumes: [], rede: "default", portas: [], envFile: null, rodando: false, extra: [] };
  let i = 1;
  for (; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("-")) break;
    const v = args[i + 1];
    if (a === "--name") { c.nome = v; i++; }
    else if (a === "--label") { c.rotulos.push(v); i++; }
    else if (a === "-v" || a === "--volume") { c.volumes.push(v); i++; }
    else if (a === "--network" || a === "--net") { c.rede = v; i++; }
    else if (a === "-p" || a === "--publish") { c.portas.push(v); i++; }
    else if (a === "--env-file") { c.envFile = v; i++; }
    else if (["--memory", "--memory-swap", "--cpus", "--pids-limit", "--restart", "-e", "--env"].includes(a)) { c.extra.push(a, v); i++; }
    else c.extra.push(a);
  }
  c.imagem = args[i];
  c.comando = args.slice(i + 1);
  estado.containers[c.nome] = c;
  salvar();
  console.log("cid-" + c.nome);
  sair();
}
if (args[0] === "inspect") {
  log();
  const fmt = args.indexOf("-f") >= 0 ? args[args.indexOf("-f") + 1] : null;
  const nome = args.at(-1);
  const c = estado.containers[nome];
  if (!c) { process.stderr.write("Error: No such object: " + nome + "\n"); sair(1); }
  if (fmt === "{{.State.Running}}") { console.log(env.SHIM_PRONTO === "morreu" ? "false" : String(c.rodando)); sair(); }
  if (fmt === "{{.State.OOMKilled}}") { console.log(env.SHIM_OOM ?? "false"); sair(); }
  const binds = c.volumes.map((v) => v);
  const mounts = c.volumes.map((v) => { const [origem, destino, modo] = v.split(":"); return { Type: "bind", Source: origem, Destination: destino, RW: modo !== "ro" }; });
  const portas = {};
  for (const p of c.portas) portas[p] = [{ HostPort: p }];
  console.log(JSON.stringify([{ Name: "/" + nome, HostConfig: { NetworkMode: env.SHIM_INSPECT_REDE ?? c.rede, PortBindings: portas, Privileged: c.extra.includes("--privileged"), Binds: binds, PidMode: "", IpcMode: "private" }, Mounts: mounts }]));
  sair();
}
if (args[0] === "cp") { log(); sair(); }
if (args[0] === "start") { log(); const c = estado.containers[args[1]]; if (c) { c.rodando = true; salvar(); } sair(); }
if (args[0] === "logs") { log(); console.log("log do banco do ensaio"); sair(); }
if (args[0] === "exec") {
  const interativo = args[1] === "-i";
  const nome = interativo ? args[2] : args[1];
  const cmd = interativo ? args.slice(3) : args.slice(2);
  if (interativo) leStdin();
  log({ stdin: stdin.slice(0, 300) });
  if (cmd[0] === "pg_isready") sair(env.SHIM_PRONTO === "nunca" || env.SHIM_PRONTO === "morreu" ? 2 : 0);
  if (cmd[0] === "pg_restore" && cmd.includes("--list")) sair(env.SHIM_DUMP_ILEGIVEL ? 1 : 0);
  if (cmd[0] === "pg_restore") {
    if (env.SHIM_INTERROMPER === "pg_restore") { process.kill(process.ppid, "SIGTERM"); sair(0); }
    for (let n = 0; n < Number(env.SHIM_ERROS_RESTORE ?? 0); n++) process.stderr.write("pg_restore: error: could not execute query: ERROR:  already exists\n");
    sair(Number(env.SHIM_ERROS_RESTORE ?? 0) ? 1 : 0);
  }
  if (cmd[0] === "psql") {
    if (stdin.includes("has_table_privilege('anon'")) { console.log(env.SHIM_ANON ?? "false"); sair(); }
    if (stdin.includes("bk_contar")) { console.log(JSON.stringify({ ...CONTAGENS, ...JSON.parse(env.SHIM_CONTAGENS ?? "{}") })); sair(); }
    if (stdin.includes("bk_objetos")) {
      const objetos = env.SHIM_OBJETOS ? JSON.parse(env.SHIM_OBJETOS) : OBJETOS;
      console.log(objetos.map((o) => o.join("\x1f")).join("\x1e"));
      sair();
    }
    sair();
  }
  sair();
}
log();
sair();
`;

const RESTIC = String.raw`
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const env = process.env;
const bruto = process.argv.slice(2);
const estadoArq = env.SHIM_RESTIC_ESTADO;
const estado = fs.existsSync(estadoArq) ? JSON.parse(fs.readFileSync(estadoArq, "utf8")) : { repos: {} };
const salvar = () => fs.writeFileSync(estadoArq, JSON.stringify(estado, null, 1));
// Opcoes globais: --retry-lock <d>, --json, -q/--quiet, -p/--password-file <arq>, -r <repo>.
let json = false, arquivoSenha = env.RESTIC_PASSWORD_FILE || null, repoUrl = env.RESTIC_REPOSITORY || "";
const args = [];
for (let i = 0; i < bruto.length; i++) {
  const a = bruto[i];
  if (a === "--retry-lock") { i++; continue; }
  if (a === "--json") { json = true; continue; }
  if (a === "-q" || a === "--quiet") continue;
  if (a === "-p" || a === "--password-file") { arquivoSenha = bruto[++i]; continue; }
  if (a === "-r" || a === "--repo") { repoUrl = bruto[++i]; continue; }
  args.push(a);
}
const senha = arquivoSenha ? fs.readFileSync(arquivoSenha, "utf8").replace(/\r?\n$/, "") : (env.RESTIC_PASSWORD ?? null);
const repo = estado.repos[repoUrl];
const chave = repo && senha !== null ? repo.chaves.find((c) => c.senha === senha) : null;
fs.appendFileSync(env.SHIM_LOG, JSON.stringify({ tool: "restic", args, repo: repoUrl, porArquivo: Boolean(arquivoSenha), senhaNoAmbiente: Boolean(env.RESTIC_PASSWORD), chave: chave ? chave.id : null, aws: env.AWS_SECRET_ACCESS_KEY ? "com-chave" : "sem-chave" }) + "\n");
const fatal = (msg, codigo = 1) => { process.stderr.write("Fatal: " + msg + "\n"); process.exit(codigo); };
if (!repoUrl) fatal("Please specify repository location (-r or --repository-file)");
if (env.SHIM_RESTIC_DESTINO_FORA) fatal("unable to open config file: Stat: Access Denied.");
const sub = args[0];
const naoExiste = () => { process.stderr.write("Fatal: unable to open config file: Stat: The specified key does not exist.\nIs there a repository at the following location?\n" + repoUrl + "\n"); process.exit(1); };
const id = () => crypto.randomBytes(32).toString("hex");
if (sub === "init") {
  if (repo) fatal("create repository at " + repoUrl + " failed: config file already exists");
  if (senha === null) fatal("an empty password is not allowed by default");
  estado.repos[repoUrl] = { chaves: [{ id: id(), senha }], snapshots: [] };
  salvar();
  console.log("created restic repository at " + repoUrl);
  process.exit(0);
}
if (!repo) naoExiste();
if (!chave) fatal("wrong password or no key found");
const curto = (s) => s.slice(0, 8);
const acha = (ref) => (ref === "latest" ? repo.snapshots.at(-1) : repo.snapshots.find((s) => s.id.startsWith(ref)));
const flag = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };
const flags = (nome) => args.flatMap((a, i) => (a === nome ? [args[i + 1]] : []));
const filtra = (lista) => lista.filter((s) => (!flag("--host") || s.hostname === flag("--host")) && flags("--tag").every((t) => s.tags.includes(t)));
if (sub === "cat") process.exit(0);
if (sub === "unlock") process.exit(0);
if (sub === "key") {
  if (args[1] === "list") { console.log(JSON.stringify(repo.chaves.map((c) => ({ current: c.id === chave.id, id: curto(c.id), userName: "root", hostName: "servidor" })))); process.exit(0); }
  if (args[1] === "add") {
    const nova = fs.readFileSync(flag("--new-password-file"), "utf8").replace(/\r?\n$/, "");
    repo.chaves.push({ id: id(), senha: nova });
    salvar();
    console.log("saved new key as <Key of root@servidor>");
    process.exit(0);
  }
  if (args[1] === "remove") {
    const alvo = repo.chaves.find((c) => c.id.startsWith(args[2]));
    if (!alvo) fatal("key not found");
    if (alvo.id === chave.id) fatal("refusing to remove key currently used to access repository");
    repo.chaves = repo.chaves.filter((c) => c !== alvo);
    salvar();
    console.log("removed key " + curto(alvo.id));
    process.exit(0);
  }
}
if (sub === "backup") {
  const caminhos = args.slice(1).filter((a, i, l) => !a.startsWith("--") && !["--host", "--tag"].includes(l[i - 1]));
  const arquivos = {};
  const anda = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) { for (const n of fs.readdirSync(p)) anda(path.join(p, n)); }
    else arquivos[p] = fs.readFileSync(p).toString("base64");
  };
  for (const c of caminhos) { if (!fs.existsSync(c)) fatal("lstat " + c + ": no such file or directory"); anda(c); }
  const s = { id: id(), time: env.SHIM_RESTIC_HORA || new Date().toISOString(), hostname: flag("--host") || "servidor", tags: flags("--tag"), paths: caminhos, arquivos };
  repo.snapshots.push(s);
  salvar();
  const total = Object.values(arquivos).reduce((n, b) => n + Buffer.from(b, "base64").length, 0);
  console.log(JSON.stringify({ message_type: "status", percent_done: 1 }));
  console.log(JSON.stringify({ message_type: "summary", files_new: Object.keys(arquivos).length, data_added: total, total_files_processed: Object.keys(arquivos).length, total_bytes_processed: total, snapshot_id: s.id }));
  process.exit(0);
}
if (sub === "snapshots") {
  console.log(JSON.stringify(filtra(repo.snapshots).map((s) => ({ time: s.time, tree: "a", paths: s.paths, hostname: s.hostname, username: "root", tags: s.tags, id: s.id, short_id: curto(s.id) }))));
  process.exit(0);
}
if (sub === "ls") {
  const s = acha(args[1]);
  if (!s) fatal("no matching ID found for prefix " + args[1]);
  console.log(JSON.stringify({ time: s.time, tree: "a", paths: s.paths, hostname: s.hostname, tags: s.tags, id: s.id, short_id: curto(s.id), struct_type: "snapshot", message_type: "snapshot" }));
  const pastas = new Set();
  for (const p of Object.keys(s.arquivos)) { let d = path.dirname(p); while (d !== "/" && !pastas.has(d)) { pastas.add(d); d = path.dirname(d); } }
  for (const d of [...pastas].sort()) console.log(JSON.stringify({ name: path.basename(d), type: "dir", path: d, struct_type: "node", message_type: "node" }));
  for (const [p, b] of Object.entries(s.arquivos)) console.log(JSON.stringify({ name: path.basename(p), type: "file", path: p, size: Buffer.from(b, "base64").length, struct_type: "node", message_type: "node" }));
  process.exit(0);
}
if (sub === "restore") {
  const s = acha(args[1]);
  if (!s) fatal("no matching ID found for prefix " + args[1]);
  const alvo = flag("--target");
  const inclui = flags("--include");
  for (const [p, b] of Object.entries(s.arquivos)) {
    if (inclui.length && !inclui.includes(p)) continue;
    const destino = path.join(alvo, p);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, Buffer.from(b, "base64"));
  }
  process.exit(0);
}
if (sub === "dump") {
  const s = acha(args[1]);
  const b = s && s.arquivos[args[2]];
  if (!b) fatal("cannot dump file: path " + JSON.stringify(args[2]) + " not found in snapshot");
  process.stdout.write(Buffer.from(b, "base64"));
  process.exit(0);
}
if (sub === "forget") process.exit(env.SHIM_RESTIC_FORGET_FALHA ? 1 : 0);
if (sub === "check") process.exit(env.SHIM_RESTIC_CHECK_FALHA ? 1 : 0);
fatal("restic de mentira: comando inesperado: " + args.join(" "));
`;

const ANOTA = (nome, extra = "") => String.raw`
import fs from "node:fs";
fs.appendFileSync(process.env.SHIM_LOG, JSON.stringify({ tool: "${nome}", args: process.argv.slice(2) }) + "\n");
${extra}
process.exit(0);
`;

// df -Pk <pasta>: o livre de verdade, ou o que o teste escolher em SHIM_DF_LIVRE_KB.
const DF = String.raw`
import { spawnSync } from "node:child_process";
if (process.env.SHIM_DF_LIVRE_KB) {
  console.log("Filesystem 1024-blocks Used Available Capacity Mounted on");
  console.log("/dev/sda1 41943040 41000000 " + process.env.SHIM_DF_LIVRE_KB + " 99% /");
  process.exit(0);
}
const r = spawnSync("/usr/bin/env", ["-u", "PATH", "PATH=/usr/bin:/bin", "df", ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
`;

/** Uma pessoa no terminal (pseudo-terminal do python): responde as perguntas pelas regras de PESSOA_REGRAS. */
const PESSOA = String.raw`
import json, os, pty, re, select, sys, time
regras = json.loads(os.environ.get("PESSOA_REGRAS", "[]"))
pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])
saida = b""
lido = 0
fim = time.time() + float(os.environ.get("PESSOA_TEMPO", "60"))
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
        chaves = re.findall(r"^\s+([0-9A-Z]{4}(?:-[0-9A-Z]{4}){7})\s*$", texto, re.M)
        if "{GRUPOS}" in resposta:
            g = [int(x) for x in m.groups()[:2]]
            partes = chaves[-1].split("-")
            resposta = resposta.replace("{GRUPOS}", partes[g[0] - 1] + partes[g[1] - 1])
        if "{CHAVE}" in resposta:
            resposta = resposta.replace("{CHAVE}", chaves[-1] if chaves else os.environ.get("PESSOA_CHAVE", ""))
        if "{ACHADO}" in resposta:
            resposta = resposta.replace("{ACHADO}", m.group(1))
        lido += m.end()
        os.write(fd, (resposta + "\n").encode())
_, status = os.waitpid(pid, 0)
sys.stdout.write(saida.decode("utf-8", "replace").replace("\r\n", "\n"))
sys.exit(os.waitstatus_to_exitcode(status))
`;

/**
 * O servidor de um comprador com a escola no ar, de mentira: pastas do kit numa pasta temporaria, o arquivo de segredos,
 * os arquivos do Storage e os shims na frente do PATH. `rodar` chama o membros sem terminal; `pessoa` chama com uma
 * pessoa no terminal. `restic: "de verdade"` deixa o restic da maquina (o teste com restic de verdade).
 */
export function servidorDoKit({ segredos = {}, restic = "de mentira" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "kit-membros-"));
  dirs.push(dir);
  const compose = join(dir, "compose");
  mkdirSync(compose);
  writeFileSync(join(compose, "docker-compose.yml"), "name: escola\nservices: {}\n");
  const valores = {
    APP_PUBLIC_URL: "https://alunos.escola.test",
    POSTGRES_DB: "postgres",
    GLOBAL_S3_BUCKET: "stub",
    STORAGE_TENANT_ID: "stub",
    RESTIC_REPOSITORY: "s3:https://s3.us-east-005.backblazeb2.com/escola-backup/membros",
    AWS_ACCESS_KEY_ID: "005chaveDeAcessoId",
    ...SEGREDOS,
    ...segredos
  };
  const envFile = join(compose, ".env");
  const escreverSegredos = (v) => writeFileSync(envFile, Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${k}=${x}\n`).join(""), { mode: 0o600 });
  escreverSegredos(valores);
  chmodSync(envFile, 0o600);
  const storage = join(compose, "volumes", "storage");
  for (const [bucket, nome, versao] of [["avatars", "aluno1/foto.webp", "v-1111"], ["avatars", "aluno2/foto.webp", "v-2222"], ["content-assets", "capas/curso.webp", "v-3333"]]) {
    const pasta = join(storage, "stub", "stub", bucket, nome);
    mkdirSync(pasta, { recursive: true });
    writeFileSync(join(pasta, versao), `arquivo ${bucket}/${nome}`);
  }
  const estado = join(dir, "estado");
  const backups = join(dir, "backups");
  const temporaria = join(dir, "shm");
  mkdirSync(temporaria);
  const systemd = join(dir, "systemd");
  mkdirSync(systemd);
  const trava = join(dir, "trava.lock");
  const shims = join(dir, "shims");
  mkdirSync(shims);
  const ferramentas = [["docker", DOCKER], ["systemctl", ANOTA("systemctl")], ["df", DF]];
  if (restic !== "de verdade") ferramentas.push(["restic", RESTIC]);
  for (const [nome, fonte] of ferramentas) {
    writeFileSync(join(dir, `${nome}.mjs`), fonte);
    writeFileSync(join(shims, nome), `#!/bin/sh\nexec "${process.execPath}" "${join(dir, `${nome}.mjs`)}" "$@"\n`);
    chmodSync(join(shims, nome), 0o755);
  }
  writeFileSync(join(shims, "sleep"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(shims, "sleep"), 0o755);
  writeFileSync(join(dir, "pessoa.py"), PESSOA);
  const log = join(dir, "chamadas.log");

  const ambiente = (extra) => {
    const env = {
      ...process.env,
      PATH: `${shims}:${process.env.PATH}`,
      KIT_PASTA_COMPOSE: compose,
      KIT_PASTA_ESTADO: estado,
      KIT_PASTA_BACKUP: backups,
      KIT_PASTA_TEMPORARIA: temporaria,
      KIT_PASTA_SYSTEMD: systemd,
      KIT_ARQUIVO_TRAVA: trava,
      SHIM_LOG: log,
      SHIM_DOCKER_ESTADO: join(dir, "docker.json"),
      SHIM_RESTIC_ESTADO: join(dir, "restic.json"),
      ...extra
    };
    for (const nome of Object.keys(env)) {
      if ((nome.startsWith("KIT_") || nome.startsWith("BUNKER707_") || nome.startsWith("RESTIC_") || nome.startsWith("AWS_") || nome === "DOCKER_HOST" || nome === "COMPOSE_PROJECT_NAME") && !(nome in extra) && !["KIT_PASTA_COMPOSE", "KIT_PASTA_ESTADO", "KIT_PASTA_BACKUP", "KIT_PASTA_TEMPORARIA", "KIT_PASTA_SYSTEMD", "KIT_ARQUIVO_TRAVA"].includes(nome)) {
        delete env[nome];
      }
    }
    return env;
  };
  const rodar = (args = [], extra = {}, entrada = "") => {
    const r = spawnSync("bash", [membros, ...args], { encoding: "utf8", env: ambiente(extra), input: entrada });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", saida: (r.stdout ?? "") + (r.stderr ?? "") };
  };
  const pessoa = (args, regras, extra = {}) => {
    const r = spawnSync("python3", ["-I", join(dir, "pessoa.py"), "bash", membros, ...args], { encoding: "utf8", env: { ...ambiente(extra), PESSOA_REGRAS: JSON.stringify(regras) } });
    return { status: r.status, saida: (r.stdout ?? "") + (r.stderr ?? "") };
  };
  const chamadas = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const limparLog = () => rmSync(log, { force: true });
  const situacao = () => (existsSync(join(estado, "situacao.json")) ? JSON.parse(readFileSync(join(estado, "situacao.json"), "utf8")) : {});
  const resticEstado = () => JSON.parse(readFileSync(join(dir, "restic.json"), "utf8"));
  const gravarResticEstado = (e) => writeFileSync(join(dir, "restic.json"), JSON.stringify(e));
  const lerSegredos = () => Object.fromEntries(readFileSync(envFile, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  return { dir, compose, envFile, storage, estado, backups, temporaria, systemd, trava, valores, escreverSegredos, rodar, pessoa, chamadas, limparLog, situacao, resticEstado, gravarResticEstado, lerSegredos };
}

/** O kit de recuperacao confirmado por uma pessoa: devolve a chave que a folha mostrou. */
export function confirmarKit(s, extra = {}) {
  const r = s.pessoa(["kit-de-recuperacao"], [{ espera: "digite o grupo (\\d) e o grupo (\\d)", responde: "{GRUPOS}" }], extra);
  const chave = /^\s+([0-9A-Z]{4}(?:-[0-9A-Z]{4}){7})\s*$/m.exec(r.saida)?.[1];
  return { ...r, chave };
}

/** Grava a chave num arquivo so do dono (0600), como a pessoa faria para o --chave-arquivo. */
export function arquivoDaChave(s, chave, nome = "chave.txt") {
  const caminho = join(s.dir, nome);
  writeFileSync(caminho, `${chave}\n`, { mode: 0o600 });
  chmodSync(caminho, 0o600);
  return caminho;
}

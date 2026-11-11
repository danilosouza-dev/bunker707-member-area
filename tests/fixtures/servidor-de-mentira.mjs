// O servidor de um comprador recem-criado, de mentira, para rodar o preparo do servidor (infra/scripts/bootstrap.sh e
// infra/kit/preparar-servidor.sh; docs/32 §11.7; docs/20 §9C) sem tocar nesta maquina (docs/18 §2.5).
//
// - O servidor inteiro mora numa pasta (BOOTSTRAP_RAIZ): /etc/os-release, o sshd_config e o sshd_config.d, o ufw, o
//   fail2ban, o apt, as contas.
// - Um shim so, em Node, faz o papel de cada ferramenta que muda ou consulta o sistema (apt-get, ufw, systemctl, sshd,
//   journalctl, ss, curl, gpg, ssh-keygen, docker, restic, swapon...), com o estado num JSON, e anota cada chamada num
//   log, na ordem. O `sshd -T` calcula a configuracao efetiva dos arquivos de verdade da pasta (o primeiro valor lido
//   vale, como no OpenSSH); o ufw guarda regras, politica e se esta ligado.
// - O PATH tem so os shims e uma lista de ferramentas de verdade que nao mudam o sistema (cat, grep, sed, python3...):
//   um comando que escapou do shim falha em vez de agir nesta maquina.
// - `pessoa` roda num pseudo-terminal e responde as perguntas, como uma pessoa no terminal.
// Usado por tests/kit-preparar-servidor.test.mjs.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const bootstrap = fileURLToPath(new URL("../../infra/scripts/bootstrap.sh", import.meta.url));
export const preparar = fileURLToPath(new URL("../../infra/kit/preparar-servidor.sh", import.meta.url));
export const membros = fileURLToPath(new URL("../../infra/kit/membros", import.meta.url));

/** A chave do repositorio do Docker que o bootstrap confere. */
export const IMPRESSAO_DOCKER = "9DC858229FC7DD38854AE2D88D81803C0EBFCD88";
export const CHAVE_DONO = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGRvbm8tZGEtZXNjb2xhLWNoYXZlLWRlLXRlc3RlLTAwMQ dono@notebook";
export const CHAVE_PRODUTOR = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHByb2R1dG9yLWNoYXZlLWRlLXRlc3RlLTAwMDAwMDE produtor";
/** A sessao SSH do dono: IP e porta dele, IP e porta do servidor. */
export const SESSAO = "203.0.113.5 51234 198.51.100.7 22";

const SISTEMAS = {
  "ubuntu-24.04": { ID: "ubuntu", VERSION_ID: "24.04", VERSION_CODENAME: "noble", PRETTY_NAME: "Ubuntu 24.04.3 LTS", restic: "0.16.4" },
  "ubuntu-22.04": { ID: "ubuntu", VERSION_ID: "22.04", VERSION_CODENAME: "jammy", PRETTY_NAME: "Ubuntu 22.04.5 LTS", restic: "0.12.1" },
  "debian-12": { ID: "debian", VERSION_ID: "12", VERSION_CODENAME: "bookworm", PRETTY_NAME: "Debian GNU/Linux 12 (bookworm)", restic: "0.14.0" },
  "debian-13": { ID: "debian", VERSION_ID: "13", VERSION_CODENAME: "trixie", PRETTY_NAME: "Debian GNU/Linux 13 (trixie)", restic: "0.18.0" },
  "ubuntu-20.04": { ID: "ubuntu", VERSION_ID: "20.04", VERSION_CODENAME: "focal", PRETTY_NAME: "Ubuntu 20.04.6 LTS", restic: "0.9.6" },
  "rocky-9": { ID: "rocky", VERSION_ID: "9.4", VERSION_CODENAME: "", PRETTY_NAME: "Rocky Linux 9.4 (Blue Onyx)", restic: "0.16.4" }
};

/** O que cada chamada muda no servidor (o --simular nunca pode chamar nenhuma destas). */
export function muda(c) {
  const a = c.args;
  switch (c.tool) {
    case "apt-get":
    case "adduser":
    case "usermod":
    case "chown":
    case "fallocate":
    case "mkswap":
      return true;
    case "ufw":
      return !["status", "show", "version"].includes(a[0]);
    case "systemctl":
      return !["is-active", "show", "is-enabled"].includes(a[0]);
    case "swapon":
      return !a.some((x) => x.startsWith("--show"));
    case "sysctl":
      return a.includes("-p");
    case "dpkg":
      return a.includes("-i");
    case "curl":
      return a.includes("-o");
    default:
      return false;
  }
}

const SHIM = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ferramenta = process.argv[2];
const args = process.argv.slice(3);
const env = process.env;
const RAIZ = env.BOOTSTRAP_RAIZ;
const estado = JSON.parse(fs.readFileSync(env.SHIM_ESTADO, "utf8"));
const salvar = () => fs.writeFileSync(env.SHIM_ESTADO, JSON.stringify(estado, null, 1));
const anotar = (extra = {}) => fs.appendFileSync(env.SHIM_LOG, JSON.stringify({ tool: ferramenta, args, ...extra }) + "\n");
const sair = (c = 0) => process.exit(c);
const naoInstalado = () => { process.stderr.write(ferramenta + ": command not found\n"); sair(127); };
const tem = (pacote) => estado.pacotes.includes(pacote);

function configSshd() {
  const valores = {};
  const portas = [];
  const ler = (arquivo) => {
    if (!fs.existsSync(arquivo)) return;
    for (const bruta of fs.readFileSync(arquivo, "utf8").split("\n")) {
      const linha = bruta.trim();
      if (!linha || linha.startsWith("#")) continue;
      const [nome, ...resto] = linha.split(/\s+/);
      const chave = nome.toLowerCase();
      if (chave === "match") return; // o resto do arquivo e de um bloco Match (o duble nao avalia)
      if (chave === "include") {
        for (const padrao of resto) {
          const abs = padrao.startsWith("/") ? padrao : "/etc/ssh/" + padrao;
          const re = new RegExp("^" + path.basename(abs).replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
          const pasta = path.join(RAIZ, path.dirname(abs));
          if (fs.existsSync(pasta)) for (const f of fs.readdirSync(pasta).filter((n) => re.test(n)).sort()) ler(path.join(pasta, f));
        }
        continue;
      }
      if (chave === "port") { portas.push(resto[0]); continue; }
      if (!(chave in valores)) valores[chave] = resto.join(" ");
    }
  };
  ler(path.join(RAIZ, "etc/ssh/sshd_config"));
  return { port: portas.length ? portas : ["22"], passwordauthentication: "yes", kbdinteractiveauthentication: "yes", pubkeyauthentication: "yes", permitrootlogin: "prohibit-password", ...valores };
}

const CONHECIDAS = new Set(["include", "port", "passwordauthentication", "kbdinteractiveauthentication", "challengeresponseauthentication", "pubkeyauthentication", "permitrootlogin", "permitemptypasswords", "x11forwarding", "maxauthtries", "logingracetime", "clientaliveinterval", "clientalivecountmax", "allowusers", "usepam", "printmotd", "acceptenv", "subsystem", "match"]);

switch (ferramenta) {
  case "id":
    if (args[0] === "-u") { console.log(String(estado.uid)); sair(); }
    sair(estado.usuarios[args[0]] ? 0 : 1);
  case "dpkg":
    if (args[0] === "--print-architecture") { console.log(estado.arch); sair(); }
    anotar(); estado.supabase = true; salvar(); sair();
  case "apt-get": {
    anotar();
    if (estado.apt_falha) { process.stderr.write("E: falha de mentira\n"); sair(100); }
    const i = args.indexOf("install");
    if (i >= 0) {
      for (const p of args.slice(i + 1).filter((a) => !a.startsWith("-"))) if (!tem(p)) estado.pacotes.push(p);
      if (args.includes("docker-ce")) estado.docker = { ...estado.docker, instalado: true, compose: estado.docker.compose ?? "2.40.0" };
      salvar();
    }
    sair();
  }
  case "ufw": {
    if (!tem("ufw")) naoInstalado();
    const u = estado.ufw;
    const linha = (r) => "ufw " + r.regra + (r.comentario ? " comment '" + r.comentario + "'" : "");
    if (args[0] === "version") { console.log("ufw 0.36.2"); sair(); }
    if (args[0] === "status") {
      console.log("Status: " + (u.ativo ? "active" : "inactive"));
      if (u.ativo) { console.log("Default: " + u.entrada + " (incoming), " + u.saida + " (outgoing)"); for (const r of u.regras) console.log(r.regra); }
      sair();
    }
    if (args[0] === "show" && args[1] === "added") {
      console.log("Added user rules (see 'ufw status' for running firewall):");
      console.log(u.regras.length ? u.regras.map(linha).join("\n") : "(None)");
      sair();
    }
    anotar();
    const pos = args.indexOf("comment");
    const comentario = pos >= 0 ? args.slice(pos + 1).join(" ") : "";
    const corpo = (pos >= 0 ? args.slice(0, pos) : args).filter((a) => a !== "--force");
    if (corpo[0] === "default") { u[corpo[2] === "incoming" ? "entrada" : corpo[2] === "outgoing" ? "saida" : "roteada"] = corpo[1]; salvar(); console.log("Default " + corpo[2] + " policy changed to '" + corpo[1] + "'"); sair(); }
    if (corpo[0] === "enable") { u.ativo = true; salvar(); console.log("Firewall is active and enabled on system startup"); sair(); }
    if (corpo[0] === "reset") { u.regras = []; u.ativo = false; u.entrada = "deny"; u.saida = "allow"; salvar(); console.log("Resetting all rules to installed defaults."); sair(); }
    if (corpo[0] === "reload") { console.log("Firewall reloaded"); sair(); }
    const regra = corpo.join(" ");
    if (u.regras.some((r) => r.regra === regra)) { console.log("Skipping adding existing rule"); sair(); }
    u.regras.push({ regra, comentario }); salvar(); console.log("Rule added"); sair();
  }
  case "systemctl": {
    const sub = args.find((a) => !a.startsWith("-"));
    if (sub === "is-active") { const nome = args.at(-1); const ativo = estado.ativos.includes(nome); if (!args.includes("--quiet")) console.log(ativo ? "active" : "inactive"); sair(ativo ? 0 : 3); }
    if (sub === "show") { for (const p of estado.ssh_socket) console.log("[::]:" + p + " (Stream)"); sair(); }
    anotar();
    if (sub === "enable") { for (const n of args.filter((a) => !a.startsWith("-") && a !== "enable")) if (!estado.ativos.includes(n)) estado.ativos.push(n); salvar(); }
    if (sub === "reload" && estado.reload_falha) sair(1);
    sair();
  }
  case "sshd": {
    if (args.includes("-t")) {
      anotar();
      if (env.SHIM_SSHD_T_FALHA) { process.stderr.write("/etc/ssh/sshd_config.d: Bad configuration option: PasswordAuthentcation\n"); sair(255); }
      const pasta = path.join(RAIZ, "etc/ssh/sshd_config.d");
      for (const f of fs.existsSync(pasta) ? fs.readdirSync(pasta) : []) {
        for (const l of fs.readFileSync(path.join(pasta, f), "utf8").split("\n")) {
          const t = l.trim();
          if (t && !t.startsWith("#") && !CONHECIDAS.has(t.split(/\s+/)[0].toLowerCase())) { process.stderr.write(f + ": Bad configuration option: " + t + "\n"); sair(255); }
        }
      }
      sair();
    }
    if (args.includes("-T")) {
      anotar();
      const c = configSshd();
      for (const p of c.port) console.log("port " + p);
      for (const [k, v] of Object.entries(c)) if (k !== "port") console.log(k + " " + v);
      sair();
    }
    sair(1);
  }
  case "journalctl": console.log(estado.journal.join("\n")); sair();
  case "ss": for (const e of estado.escutando) console.log(e.proto + " LISTEN 0 4096 " + e.endereco + " 0.0.0.0:*"); sair();
  case "curl": {
    const url = args.find((a) => /^https?:/.test(a));
    const destino = args.includes("-o") ? args[args.indexOf("-o") + 1] : null;
    anotar({ url });
    if (estado.rede_fora) { process.stderr.write("curl: (6) Could not resolve host\n"); sair(6); }
    let conteudo = null;
    if (/download\.docker\.com\/linux\/(ubuntu|debian)\/gpg$/.test(url)) conteudo = Buffer.from("-----BEGIN PGP PUBLIC KEY BLOCK-----\nchave de mentira\n-----END PGP PUBLIC KEY BLOCK-----\n");
    else if (/restic_[^/]+_linux_amd64\.bz2$/.test(url)) conteudo = fs.readFileSync(env.SHIM_RESTIC_BZ2);
    else if (/supabase_[^/]+\.deb$/.test(url)) conteudo = Buffer.from("deb de mentira\n");
    if (!conteudo) { process.stderr.write("curl: (22) The requested URL returned error: 404\n"); sair(22); }
    if (destino) fs.writeFileSync(destino, conteudo); else process.stdout.write(conteudo);
    sair();
  }
  case "gpg": console.log("pub:-:4096:1:8D81803C0EBFCD88:1487788586:::-:::scESA::::::23::0:\nfpr:::::::::" + estado.gpg_fpr + ":"); sair();
  case "ssh-keygen": {
    const texto = fs.readFileSync(args[args.indexOf("-f") + 1], "utf8");
    if (/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) AAAA[A-Za-z0-9+/]+=*( .*)?$/.test(texto.trim())) { console.log("256 SHA256:chave-de-teste dono (ED25519)"); sair(); }
    process.stderr.write("is not a public key file.\n"); sair(255);
  }
  case "docker": {
    if (!estado.docker.instalado) naoInstalado();
    if (args[0] === "--version") { console.log("Docker version " + estado.docker.versao + ", build e180ab8"); sair(); }
    if (args[0] === "compose") {
      if (!estado.docker.compose) { process.stderr.write("docker: 'compose' is not a docker command.\n"); sair(1); }
      console.log(args.includes("--short") ? estado.docker.compose : "Docker Compose version v" + estado.docker.compose); sair();
    }
    sair();
  }
  case "restic": {
    const local = path.join(RAIZ, "usr/local/bin/restic");
    if (fs.existsSync(local)) { const r = spawnSync(local, args, { stdio: "inherit" }); sair(r.status ?? 1); }
    if (!estado.restic) naoInstalado();
    console.log("restic " + estado.restic + " compiled with go1.22.2 on linux/amd64"); sair();
  }
  case "swapon": {
    const show = args.find((a) => a.startsWith("--show"));
    if (show) { for (const s of estado.swap) console.log(show.includes("SIZE") ? String(s.bytes) : s.nome); sair(); }
    anotar();
    if (estado.swap_falha) { process.stderr.write("swapon: /swapfile: swapon failed: Invalid argument\n"); sair(1); }
    estado.swap.push({ nome: args.at(-1), bytes: 2147483648 }); salvar(); sair();
  }
  case "fallocate": anotar(); fs.writeFileSync(args.at(-1), ""); sair();
  case "mkswap": case "sysctl": case "usermod": case "chown": anotar(); sair();
  case "free": console.log("               total        used        free\nMem:           3.8Gi       1.1Gi       2.0Gi\nSwap:          2.0Gi          0B       2.0Gi"); sair();
  case "getent": { const u = estado.usuarios[args[1]]; if (!u) sair(2); console.log(args[1] + ":x:" + u.uid + ":" + u.uid + "::" + u.home + ":/bin/bash"); sair(); }
  case "adduser": { anotar(); const nome = args.at(-1); estado.usuarios[nome] = { uid: 1000, home: "/home/" + nome }; fs.mkdirSync(path.join(RAIZ, "home", nome), { recursive: true }); salvar(); sair(); }
  case "supabase": if (!estado.supabase) naoInstalado(); console.log(env.SUPABASE_CLI_VERSION ?? "2.121.0"); sair();
  case "sleep": sair();
  default: process.stderr.write("shim sem ferramenta: " + ferramenta + "\n"); sair(1);
}
`;

const FERRAMENTAS = ["id", "dpkg", "apt-get", "ufw", "systemctl", "sshd", "journalctl", "ss", "curl", "gpg", "ssh-keygen", "docker", "restic", "swapon", "fallocate", "mkswap", "sysctl", "usermod", "chown", "free", "getent", "adduser", "supabase", "sleep"];
// Ferramentas de verdade que so leem ou mexem em arquivos da pasta do servidor de mentira.
const PERMITIDAS = ["bash", "sh", "cat", "mkdir", "mktemp", "chmod", "mv", "rm", "cp", "ln", "touch", "grep", "sed", "awk", "tr", "cut", "sort", "uniq", "head", "tail", "wc", "date", "seq", "dirname", "basename", "readlink", "python3", "sha256sum", "stat", "cmp", "env", "tee", "install", "bunzip2", "true", "false", "ls", "printf", "find"];

/** Uma pessoa no terminal (pseudo-terminal do python): responde as perguntas pelas regras de PESSOA_REGRAS. */
const PESSOA = String.raw`
import json, os, pty, re, select, sys, time
regras = json.loads(os.environ.get("PESSOA_REGRAS", "[]"))
pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])
saida = b""
lido = 0
fim = time.time() + 60
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
        lido += m.end()
        os.write(fd, (regras.pop(0)["responde"] + "\n").encode())
_, status = os.waitpid(pid, 0)
sys.stdout.write(saida.decode("utf-8", "replace").replace("\r\n", "\n"))
sys.exit(os.waitstatus_to_exitcode(status))
`;

const pastas = [];
/** Apaga as pastas temporarias (chamar no `after` do arquivo de teste). */
export function limparServidores() {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
}

const UFW_AFTER_RULES = "# rules.input-after\n*filter\n:ufw-after-input - [0:0]\nCOMMIT\n";
const SSHD_CONFIG = [
  "Include /etc/ssh/sshd_config.d/*.conf",
  "KbdInteractiveAuthentication no",
  "UsePAM yes",
  "X11Forwarding yes",
  "PrintMotd no",
  "AcceptEnv LANG LC_*",
  "Subsystem sftp /usr/lib/openssh/sftp-server",
  ""
].join("\n");

/**
 * Um servidor recem-criado. `sistema`: ubuntu-24.04 (padrao), ubuntu-22.04, debian-12, debian-13 ou um que o kit recusa.
 * `estado` troca o que o servidor ja tem (ufw ligado com regras, Docker, swap...). `arquivos` grava arquivos a mais
 * (caminho do servidor -> conteudo), como o 50-cloud-init.conf que liga a senha. Por padrao: criado com senha, o dono
 * entrou como root por senha, nada de firewall ligado.
 */
export function servidorDeMentira({ sistema = "ubuntu-24.04", estado = {}, arquivos = {} } = {}) {
  const os = SISTEMAS[sistema];
  if (!os) throw new Error(`sistema desconhecido: ${sistema}`);
  const dir = mkdtempSync(join(tmpdir(), "servidor-de-mentira-"));
  pastas.push(dir);
  const raiz = join(dir, "raiz");
  const grava = (caminho, conteudo, modo = 0o644) => {
    const destino = join(raiz, caminho);
    mkdirSync(join(destino, ".."), { recursive: true });
    writeFileSync(destino, conteudo);
    chmodSync(destino, modo);
  };
  grava("/etc/os-release", Object.entries(os).filter(([k]) => k !== "restic").map(([k, v]) => `${k}="${v}"`).join("\n") + "\n");
  grava("/etc/ssh/sshd_config", SSHD_CONFIG);
  mkdirSync(join(raiz, "etc/ssh/sshd_config.d"), { recursive: true });
  grava("/etc/ufw/after.rules", UFW_AFTER_RULES);
  grava("/etc/fail2ban/jail.d/defaults-debian.conf", "[sshd]\nenabled = true\n");
  grava("/etc/fstab", "UUID=raiz / ext4 defaults 0 1\n");
  mkdirSync(join(raiz, "root/.ssh"), { recursive: true });
  for (const p of ["tmp", "var/run", "var/log", "run"]) mkdirSync(join(raiz, p), { recursive: true });
  for (const [caminho, conteudo] of Object.entries(arquivos)) grava(caminho, conteudo);

  const ubuntu = os.ID === "ubuntu";
  const inicial = {
    uid: 0,
    arch: "amd64",
    usuarios: { root: { uid: 0, home: "/root" } },
    // O Ubuntu ja vem com o ufw (desligado); o Debian nao.
    pacotes: ["openssh-server", ...(ubuntu ? ["ufw"] : [])],
    ufw: { ativo: false, entrada: "deny", saida: "allow", roteada: "disabled", regras: [] },
    ativos: ["ssh"],
    ssh_socket: [],
    journal: [`Accepted password for root from 203.0.113.5 port 51234 ssh2`],
    escutando: [{ proto: "tcp", endereco: "0.0.0.0:22" }, { proto: "tcp", endereco: "[::]:22" }, { proto: "udp", endereco: "127.0.0.53%lo:53" }],
    docker: { instalado: false, versao: "28.5.1", compose: null },
    restic: os.restic,
    swap: [],
    gpg_fpr: IMPRESSAO_DOCKER,
    supabase: false,
    ...estado
  };
  const arquivoEstado = join(dir, "estado.json");
  writeFileSync(arquivoEstado, JSON.stringify(inicial, null, 1));

  const shims = join(dir, "shims");
  mkdirSync(shims);
  writeFileSync(join(dir, "shim.cjs"), SHIM);
  for (const f of FERRAMENTAS) {
    writeFileSync(join(shims, f), `#!/bin/sh\nexec "${process.execPath}" "${join(dir, "shim.cjs")}" ${f} "$@"\n`);
    chmodSync(join(shims, f), 0o755);
  }
  const permitidas = join(dir, "permitidas");
  mkdirSync(permitidas);
  for (const f of PERMITIDAS) {
    const r = spawnSync("bash", ["-c", `command -v ${f}`], { encoding: "utf8" });
    const caminho = r.stdout.trim();
    if (r.status === 0 && caminho.startsWith("/")) symlinkSync(caminho, join(permitidas, f));
  }
  writeFileSync(join(dir, "pessoa.py"), PESSOA);

  // O restic "oficial" que o curl de mentira entrega: um bz2 de verdade com um script que diz a versao.
  const resticBz2 = join(dir, "restic.bz2");
  const bz = spawnSync("python3", ["-I", "-c", "import bz2,sys; sys.stdout.buffer.write(bz2.compress(b'#!/bin/sh\\necho \"restic 0.99.0-teste compiled with go1.24 on linux/amd64\"\\n'))"]);
  writeFileSync(resticBz2, bz.stdout);
  const log = join(dir, "chamadas.log");

  const ambiente = (extra = {}) => {
    const base = {
      PATH: `${shims}:${permitidas}`,
      HOME: join(raiz, "root"),
      LANG: "C.UTF-8",
      BOOTSTRAP_RAIZ: raiz,
      SHIM_ESTADO: arquivoEstado,
      SHIM_LOG: log,
      SHIM_RESTIC_BZ2: resticBz2,
      RESTIC_VERSAO: "0.99.0-teste",
      RESTIC_SHA256: createHash("sha256").update(readFileSync(resticBz2)).digest("hex"),
      SSH_CONNECTION: SESSAO
    };
    const env = { ...base, ...extra };
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
    return env;
  };
  const rodar = (script, args = [], extra = {}) => {
    const r = spawnSync("bash", [script, ...args], { encoding: "utf8", env: ambiente(extra), input: "" });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", saida: (r.stdout ?? "") + (r.stderr ?? "") };
  };
  const pessoa = (script, args, regras, extra = {}) => {
    const r = spawnSync("python3", ["-I", join(dir, "pessoa.py"), "bash", script, ...args], { encoding: "utf8", env: { ...ambiente(extra), PESSOA_REGRAS: JSON.stringify(regras) } });
    return { status: r.status, saida: (r.stdout ?? "") + (r.stderr ?? "") };
  };
  const chamadas = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const limparLog = () => rmSync(log, { force: true });
  const lerEstado = () => JSON.parse(readFileSync(arquivoEstado, "utf8"));
  const trocarEstado = (mudanca) => writeFileSync(arquivoEstado, JSON.stringify({ ...lerEstado(), ...mudanca }, null, 1));
  const caminho = (c) => join(raiz, c);
  const ler = (c) => readFileSync(caminho(c), "utf8");
  const existe = (c) => existsSync(caminho(c));
  /** Todos os arquivos do servidor com conteudo e permissao: comparar duas fotografias diz se algo mudou. */
  const fotografia = () => {
    const tudo = {};
    const andar = (p) => {
      for (const n of readdirSync(p)) {
        const c = join(p, n);
        const s = statSync(c);
        if (s.isDirectory()) {
          tudo[c.slice(raiz.length) + "/"] = (s.mode & 0o777).toString(8);
          andar(c);
        } else {
          tudo[c.slice(raiz.length)] = `${(s.mode & 0o777).toString(8)} ${readFileSync(c, "utf8")}`;
        }
      }
    };
    andar(raiz);
    return tudo;
  };
  return { dir, raiz, rodar, pessoa, chamadas, limparLog, estado: lerEstado, trocarEstado, caminho, ler, existe, fotografia, ambiente };
}

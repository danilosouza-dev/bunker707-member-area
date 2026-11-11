import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";

import { bootstrap, CHAVE_DONO, CHAVE_PRODUTOR, limparServidores, membros, muda, preparar, servidorDeMentira, SESSAO } from "./fixtures/servidor-de-mentira.mjs";

// O preparo do servidor (infra/scripts/bootstrap.sh, perfis producao e kit; infra/kit/preparar-servidor.sh; docs/32
// §11.7; docs/20 §9C), rodado de verdade num servidor de mentira (tests/fixtures/servidor-de-mentira.mjs): Ubuntu 22.04
// e 24.04 e Debian 12 com o repositorio certo do Docker; servidor criado com senha, sem nada no SSH mudar; o login por
// senha so fecha numa sessao que entrou com chave e com a confirmacao digitada; o firewall que ja existia fica; so as
// portas do SSH (com limite), 80 e 443; reinicio automatico so a pedido; rodar de novo nao repete nada; --simular nao
// muda nada. E a producao continua como era: zera o ufw, SSH sem limite, usuario deploy e senha fechada.

after(limparServidores);
const KIT = { KIT_NOME: "escola-x" };
const ufw = (s) => s.chamadas().filter((c) => c.tool === "ufw").map((c) => c.args.join(" "));
const regras = (s) => s.estado().ufw.regras.map((r) => r.regra);
const reinicios = (s) => s.chamadas().filter((c) => c.tool === "systemctl" && ["restart", "reload"].includes(c.args[0])).map((c) => c.args.join(" "));
const cloudInitComSenha = { "/etc/ssh/sshd_config.d/50-cloud-init.conf": "PasswordAuthentication yes\n" };
const sessaoComChave = { journal: ["Accepted password for root from 203.0.113.5 port 40000 ssh2", "Accepted publickey for root from 203.0.113.5 port 51234 ssh2: ED25519 SHA256:abc"] };

test("os scripts: sintaxe do bash, a guarda do dash, a ajuda e o membros despacha", () => {
  for (const arquivo of [bootstrap, preparar]) {
    const r = spawnSync("bash", ["-n", arquivo], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const fonte = readFileSync(arquivo, "utf8");
    assert.ok(fonte.includes('[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"'), arquivo);
  }
  const s = servidorDeMentira();
  const ajuda = s.rodar(preparar, ["--help"], KIT);
  assert.equal(ajuda.status, 0);
  for (const opcao of ["--simular", "--chave-ssh", "--fechar-login-por-senha", "--reinicio-automatico", "--ssh-sem-limite", "--manter-firewall"]) assert.ok(ajuda.stdout.includes(opcao), opcao);
  assert.match(s.rodar(membros, ["ajuda"], KIT).stdout, /membros preparar-servidor/);
  assert.match(s.rodar(membros, ["preparar-servidor", "--help"], KIT).stdout, /--fechar-login-por-senha/);
  const errado = s.rodar(preparar, ["--apagar-tudo"], KIT);
  assert.equal(errado.status, 1);
  assert.match(errado.stderr, /opcao desconhecida: --apagar-tudo/);
  assert.equal(s.chamadas().filter(muda).length, 0);
  // O perfil kit sem o kit.conf (bootstrap.sh chamado direto) para antes de tudo.
  const direto = s.rodar(bootstrap, [], { PERFIL: "kit" });
  assert.equal(direto.status, 1);
  assert.match(direto.stderr, /Rode o perfil kit pelo infra\/kit\/preparar-servidor\.sh \(falta NOME\)/);
});

test("Ubuntu 24.04 criado com senha: prepara tudo e o SSH continua exatamente como estava", () => {
  const s = servidorDeMentira({ arquivos: cloudInitComSenha });
  const sshAntes = s.fotografia();
  const r = s.rodar(preparar, [], KIT);
  assert.equal(r.status, 0, r.saida);
  // Nada no sshd mudou: nenhum arquivo novo, nenhum reinicio do ssh, a senha continua ligada.
  const depois = s.fotografia();
  for (const caminho of Object.keys(depois).filter((c) => c.startsWith("/etc/ssh"))) assert.equal(depois[caminho], sshAntes[caminho], caminho);
  assert.equal(reinicios(s).filter((c) => /ssh/.test(c)).length, 0);
  assert.match(r.stdout, /login por senha: ligado; esta sessao: password; conta: root/);
  assert.match(r.stdout, /Login por senha: LIGADO \(nada no SSH foi mudado\)/);
  assert.match(r.stdout, /sudo bash \S+\/infra\/kit\/preparar-servidor\.sh --fechar-login-por-senha/);
  // Firewall: politica fechada, o SSH com limite, 80 e 443, e o Docker respeitando o ufw.
  assert.deepEqual(ufw(s), [
    "default deny incoming",
    "default allow outgoing",
    "limit 22/tcp comment escola-x SSH",
    "allow 80/tcp comment escola-x HTTP",
    "allow 443/tcp comment escola-x HTTPS",
    "allow 443/udp comment escola-x HTTP/3",
    "route allow proto tcp from any to any port 80 comment escola-x Caddy",
    "route allow proto tcp from any to any port 443 comment escola-x Caddy",
    "route allow proto udp from any to any port 443 comment escola-x Caddy HTTP/3",
    "--force enable"
  ]);
  assert.equal(s.estado().ufw.ativo, true);
  assert.match(s.ler("/etc/ufw/after.rules"), /# BEGIN UFW AND DOCKER\n\*filter\n[\s\S]*-A DOCKER-USER -j ufw-user-forward[\s\S]*# END UFW AND DOCKER\n$/);
  // fail2ban no SSH, sem banir o IP de quem esta preparando; atualizacoes sem reinicio automatico.
  assert.equal(s.ler("/etc/fail2ban/jail.d/escola-x-sshd.local"), "[sshd]\nenabled = true\nport = 22\nbackend = systemd\nmaxretry = 5\nfindtime = 10m\nbantime = 1h\nignoreip = 127.0.0.1/8 ::1 203.0.113.5\n");
  assert.match(s.ler("/etc/apt/apt.conf.d/52escola-x-unattended"), /^Unattended-Upgrade::Automatic-Reboot "false";$/m);
  // Docker do repositorio do Ubuntu, com a chave conferida, e o daemon.json com rotacao de log.
  assert.equal(s.ler("/etc/apt/sources.list.d/docker.list"), "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable\n");
  assert.ok(s.existe("/etc/apt/keyrings/docker.asc"));
  assert.deepEqual(JSON.parse(s.ler("/etc/docker/daemon.json")), { "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" }, "live-restore": true });
  assert.ok(s.estado().pacotes.includes("docker-compose-plugin"));
  // Swap, restic do apt (0.16.4 basta) e as pastas do kit.conf.
  assert.equal(s.ler("/etc/fstab").split("\n").filter((l) => l.startsWith("/swapfile")).length, 1);
  assert.equal(s.chamadas().filter((c) => c.tool === "curl" && /restic/.test(c.url ?? "")).length, 0);
  for (const [pasta, modo] of [["/var/lib/escola-x", "755"], ["/var/backups/escola-x", "700"], ["/var/lib/escola-x/caddy", "700"], ["/opt/escola-x", "755"]]) {
    assert.equal(s.fotografia()[`${pasta}/`], modo, pasta);
  }
  // Nem a CLI do Supabase nem o git: o kit nao precisa.
  assert.equal(s.chamadas().filter((c) => c.tool === "curl" && /supabase/.test(c.url ?? "")).length, 0);
  const instalar = s.chamadas().find((c) => c.tool === "apt-get" && c.args.includes("install"));
  assert.ok(!instalar.args.includes("git"));
  for (const p of ["ufw", "fail2ban", "python3-systemd", "restic", "unattended-upgrades"]) assert.ok(instalar.args.includes(p), p);
  assert.ok(instalar.args.includes("Dpkg::Options::=--force-confold"), "mantem os arquivos de configuracao do dono");
});

test("os nomes vem do kit.conf: com outro KIT_NOME, nada que o kit grava ou abre leva bunker707 (A10)", () => {
  const s = servidorDeMentira();
  const r = s.rodar(preparar, [], { KIT_NOME: "areabunker" });
  assert.equal(r.status, 0, r.saida);
  for (const [caminho, conteudo] of Object.entries(s.fotografia())) {
    assert.doesNotMatch(caminho, /bunker707/, caminho);
    assert.doesNotMatch(conteudo, /bunker707/, caminho);
  }
  assert.doesNotMatch(JSON.stringify(s.chamadas()), /bunker707/);
  assert.ok(s.existe("/etc/fail2ban/jail.d/areabunker-sshd.local"));
  assert.doesNotMatch(readFileSync(preparar, "utf8"), /bunker707/);
});

test("Debian 12: o Docker vem do repositorio do Debian, o ufw e instalado e o restic velho do apt e trocado pelo oficial conferido", () => {
  const s = servidorDeMentira({ sistema: "debian-12" });
  const r = s.rodar(preparar, [], KIT);
  assert.equal(r.status, 0, r.saida);
  assert.equal(s.ler("/etc/apt/sources.list.d/docker.list"), "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable\n");
  assert.ok(s.chamadas().some((c) => c.tool === "curl" && c.url === "https://download.docker.com/linux/debian/gpg"));
  assert.ok(s.estado().pacotes.includes("ufw"), "o Debian nao vem com o ufw");
  assert.equal(s.estado().ufw.ativo, true);
  // O restic 0.14 do apt nao serve ao backup (--retry-lock): o oficial vai para /usr/local/bin, conferido pelo sha256.
  assert.match(r.stdout, /o restic do apt e o 0\.14\.0; o backup pede o 0\.16 ou mais novo/);
  assert.match(s.ler("/usr/local/bin/restic"), /restic 0\.99\.0-teste/);
  assert.match(r.stdout, /^  restic 0\.99\.0-teste compiled/m, "o restic novo responde");
  assert.equal(s.fotografia()["/usr/local/bin/restic"].split(" ")[0], "755");
  // O sha256 errado nao instala nada.
  const t = servidorDeMentira({ sistema: "debian-12" });
  const errado = t.rodar(preparar, [], { ...KIT, RESTIC_SHA256: "0".repeat(64) });
  assert.equal(errado.status, 3);
  assert.match(errado.stderr, /O sha256 do restic baixado nao bate: nada foi instalado/);
  assert.equal(t.existe("/usr/local/bin/restic"), false);
  // O restic que a versao pinada conhece: o sha256 da 0.18.1 esta no script (conferido no SHA256SUMS do release).
  assert.match(readFileSync(bootstrap, "utf8"), /0\.18\.1\/amd64\) soma=680838f19d67151adba227e1570cdd8af12c19cf1735783ed1ba928bc41f363d ;;/);
});

test("Ubuntu 22.04: repositorio jammy e o restic 0.12 trocado; Debian 13: trixie e o restic do apt", () => {
  const u = servidorDeMentira({ sistema: "ubuntu-22.04" });
  assert.equal(u.rodar(preparar, [], KIT).status, 0);
  assert.match(u.ler("/etc/apt/sources.list.d/docker.list"), / https:\/\/download\.docker\.com\/linux\/ubuntu jammy stable\n$/);
  assert.ok(u.existe("/usr/local/bin/restic"));
  const d = servidorDeMentira({ sistema: "debian-13" });
  assert.equal(d.rodar(preparar, [], KIT).status, 0);
  assert.match(d.ler("/etc/apt/sources.list.d/docker.list"), / https:\/\/download\.docker\.com\/linux\/debian trixie stable\n$/);
  assert.equal(d.existe("/usr/local/bin/restic"), false, "o 0.18 do Debian 13 ja serve");
});

test("sistema ou processador fora do kit param antes de mudar qualquer coisa (codigo 10)", () => {
  for (const sistema of ["ubuntu-20.04", "rocky-9"]) {
    const s = servidorDeMentira({ sistema });
    const r = s.rodar(preparar, [], KIT);
    assert.equal(r.status, 10, sistema);
    assert.match(r.stderr, /O kit roda em Ubuntu 22\.04 ou 24\.04 e em Debian 12 ou 13/);
    assert.equal(s.chamadas().filter(muda).length, 0, sistema);
  }
  const arm = servidorDeMentira({ estado: { arch: "arm64" } });
  const r = arm.rodar(preparar, [], KIT);
  assert.equal(r.status, 10);
  assert.match(r.stderr, /O processador deste servidor e arm64; o kit roda em x86-64/);
  assert.equal(arm.chamadas().filter(muda).length, 0);
  const naoRoot = servidorDeMentira({ estado: { uid: 1000 } });
  assert.equal(naoRoot.rodar(preparar, [], KIT).status, 1);
});

test("ufw ja ligado pelo dono: as regras e a politica dele ficam, as do kit entram depois e o limite avisa da regra que vem antes", () => {
  const doDono = [
    { regra: "allow 22/tcp", comentario: "" },
    { regra: "allow 8080/tcp", comentario: "painel do dono" },
    { regra: "deny from 198.51.100.66", comentario: "" }
  ];
  const s = servidorDeMentira({ estado: { ufw: { ativo: true, entrada: "allow", saida: "allow", roteada: "disabled", regras: doDono } } });
  const r = s.rodar(preparar, [], KIT);
  assert.equal(r.status, 0, r.saida);
  const chamadas = ufw(s);
  assert.equal(chamadas.filter((c) => /reset|^default|--force enable|delete/.test(c)).length, 0, "nada de zerar, mudar a politica ou religar");
  assert.ok(chamadas.includes("reload"), "as regras DOCKER-USER novas entram com o reload");
  assert.equal(s.estado().ufw.entrada, "allow", "a politica do dono fica");
  assert.deepEqual(regras(s).slice(0, 3), doDono.map((d) => d.regra), "as regras do dono continuam, na frente");
  assert.ok(regras(s).includes("limit 22/tcp"));
  assert.match(r.stderr, /a regra que ja existia \(ufw allow 22\) vem antes do limite: o limite do SSH so vale sem ela/);
  assert.match(r.stdout, /o ufw ja estava ligado: a politica e as 3 regra\(s\) que ja existiam ficam como estao/);
  assert.match(r.stdout, /3 regra\(s\) que ja existiam ficaram/);
});

test("ufw desligado: avisa o que vai deixar de responder de fora, fecha a politica e liga; regra de bloqueio da 80 avisa", () => {
  const s = servidorDeMentira({
    estado: {
      ufw: { ativo: false, entrada: "deny", saida: "allow", roteada: "disabled", regras: [{ regra: "deny 80/tcp", comentario: "" }] },
      escutando: [{ proto: "tcp", endereco: "0.0.0.0:22" }, { proto: "tcp", endereco: "0.0.0.0:8080" }, { proto: "tcp", endereco: "127.0.0.1:5432" }, { proto: "udp", endereco: "0.0.0.0:51820" }, { proto: "tcp", endereco: "[::1]:631" }]
    }
  });
  const r = s.rodar(preparar, [], KIT);
  assert.equal(r.status, 0, r.saida);
  assert.match(r.stderr, /estas portas deixam de responder de fora: 51820\/udp 8080\/tcp\./);
  assert.doesNotMatch(r.stderr, /5432|631/, "o que so escuta em 127.0.0.1 nao muda");
  assert.match(r.stderr, /existe uma regra que bloqueia a 80 ou a 443 antes das do kit/);
  assert.equal(regras(s)[0], "deny 80/tcp", "o kit nao apaga a regra do dono");
  assert.ok(ufw(s).includes("--force enable"));
});

test("o firewalld para tudo antes de mudar (codigo 11); com --manter-firewall o kit nem instala o ufw", () => {
  const s = servidorDeMentira({ estado: { ativos: ["ssh", "firewalld"] } });
  const r = s.rodar(preparar, [], KIT);
  assert.equal(r.status, 11);
  assert.match(r.stderr, /Este servidor usa o firewalld\. O kit nao mexe nele/);
  assert.equal(s.chamadas().filter(muda).length, 0);
  const m = s.rodar(preparar, ["--manter-firewall"], KIT);
  assert.equal(m.status, 0, m.saida);
  assert.equal(ufw(s).length, 0);
  assert.ok(!s.chamadas().find((c) => c.tool === "apt-get" && c.args.includes("install")).args.includes("ufw"));
  assert.match(m.stdout, /Firewall: e seu \(--manter-firewall\)\. Deixe abertas: 22 \(SSH\), 80 e 443/);
  assert.match(s.ler("/etc/fail2ban/jail.d/escola-x-sshd.local"), /^port = 22$/m);
});

test("SSH em outra porta (sshd_config e ssh.socket): o kit abre e limita a porta de verdade, nunca so a 22", () => {
  const s = servidorDeMentira({ arquivos: { "/etc/ssh/sshd_config.d/10-porta.conf": "Port 2222\n" }, estado: { ssh_socket: [2222] } });
  const r = s.rodar(preparar, [], { ...KIT, SSH_CONNECTION: "203.0.113.5 51234 198.51.100.7 2222" });
  assert.equal(r.status, 0, r.saida);
  assert.ok(regras(s).includes("limit 2222/tcp"));
  assert.ok(!regras(s).some((x) => /^(limit|allow) 22\/tcp$/.test(x)), "a 22 nao e aberta a toa");
  assert.match(s.ler("/etc/fail2ban/jail.d/escola-x-sshd.local"), /^port = 2222$/m);
  // A porta da sessao de agora entra mesmo que o sshd -T nao a mostre (socket do systemd configurado a mao).
  const t = servidorDeMentira();
  t.rodar(preparar, [], { ...KIT, SSH_CONNECTION: "203.0.113.5 51234 198.51.100.7 2200" });
  assert.ok(regras(t).includes("limit 2200/tcp") && regras(t).includes("limit 22/tcp"));
});

test("--ssh-sem-limite e --reinicio-automatico mudam so o que dizem", () => {
  const s = servidorDeMentira();
  assert.equal(s.rodar(preparar, ["--ssh-sem-limite", "--reinicio-automatico"], KIT).status, 0);
  assert.ok(regras(s).includes("allow 22/tcp"));
  assert.ok(!regras(s).includes("limit 22/tcp"));
  assert.match(s.ler("/etc/apt/apt.conf.d/52escola-x-unattended"), /^Unattended-Upgrade::Automatic-Reboot "true";$/m);
});

test("o fail2ban que o dono ja configurou para o SSH fica como esta", () => {
  const s = servidorDeMentira({ arquivos: { "/etc/fail2ban/jail.local": "[sshd]\nenabled = true\nmaxretry = 3\n" } });
  const r = s.rodar(preparar, [], KIT);
  assert.equal(r.status, 0, r.saida);
  assert.equal(s.existe("/etc/fail2ban/jail.d/escola-x-sshd.local"), false);
  assert.match(r.stdout, /o fail2ban deste servidor ja tem regra para o SSH .*jail\.local.*: fica como esta/);
});

test("rodar de novo nao repete nada: nenhum arquivo muda, nenhuma regra dobra e nenhum servico reinicia", () => {
  const s = servidorDeMentira({ sistema: "debian-12" });
  assert.equal(s.rodar(preparar, ["--chave-ssh", CHAVE_DONO], KIT).status, 0);
  const antes = s.fotografia();
  const regrasAntes = regras(s);
  s.limparLog();
  const r = s.rodar(preparar, ["--chave-ssh", CHAVE_DONO], KIT);
  assert.equal(r.status, 0, r.saida);
  assert.deepEqual(s.fotografia(), antes);
  assert.deepEqual(regras(s), regrasAntes);
  assert.deepEqual(reinicios(s), []);
  const repetidos = s.chamadas().filter((c) => ["adduser", "fallocate", "mkswap"].includes(c.tool) || (c.tool === "swapon" && muda(c)) || (c.tool === "ufw" && /enable|reset|default|reload/.test(c.args.join(" "))) || (c.tool === "curl"));
  assert.deepEqual(repetidos, []);
  assert.match(r.stdout, /sem mudanca: \/etc\/docker\/daemon\.json/);
  assert.match(r.stdout, /ja instalado: Docker version/);
  assert.equal(s.ler("/root/.ssh/authorized_keys"), `${CHAVE_DONO}\n`);
});

test("--simular mostra o que faria e nao muda nada: nem arquivo, nem pacote, nem firewall, nem servico", () => {
  for (const sistema of ["ubuntu-24.04", "debian-12"]) {
    const s = servidorDeMentira({ sistema, arquivos: cloudInitComSenha });
    const antes = s.fotografia();
    const estadoAntes = s.estado();
    const r = s.rodar(preparar, ["--simular", "--chave-ssh", CHAVE_DONO], KIT);
    assert.equal(r.status, 0, r.saida);
    assert.deepEqual(s.fotografia(), antes, sistema);
    assert.deepEqual(s.estado(), estadoAntes, sistema);
    assert.deepEqual(s.chamadas().filter(muda), [], sistema);
    assert.match(r.stdout, /^Simulacao \(--simular\): nada sera mudado/m);
    assert.match(r.stdout, /\[simular\] apt-get .* install -y -q .*ufw/);
    assert.match(r.stdout, /\[simular\] ufw limit 22\/tcp comment escola-x\\ SSH/);
    assert.match(r.stdout, /\[simular\] gravaria \/etc\/docker\/daemon\.json/);
    assert.match(r.stdout, /\[simular\] acrescentaria a \/root\/\.ssh\/authorized_keys/);
    assert.match(r.stdout, /Simulacao: nada foi mudado neste servidor\.$/m);
  }
  const debian = servidorDeMentira({ sistema: "debian-12" });
  assert.match(debian.rodar(preparar, ["--simular"], KIT).stdout, /\[simular\] baixaria https:\/\/github\.com\/restic\/restic\/releases\/download\/v0\.99\.0-teste/);
  // A simulacao do fechar a senha tambem nao muda nada (sessao com chave, num terminal).
  const s = servidorDeMentira({ estado: sessaoComChave, arquivos: cloudInitComSenha });
  const antes = s.fotografia();
  const r = s.pessoa(preparar, ["--fechar-login-por-senha", "--simular"], [], KIT);
  assert.equal(r.status, 0, r.saida);
  assert.match(r.saida, /\[simular\] pediria a confirmacao, gravaria \/etc\/ssh\/sshd_config\.d\/01-escola-x-sem-senha\.conf/);
  assert.deepEqual(s.fotografia(), antes);
});

test("--chave-ssh cadastra a chave publica na conta de quem entrou (root ou a do sudo), uma vez; recusa chave privada e lixo", () => {
  const s = servidorDeMentira({ estado: { usuarios: { root: { uid: 0, home: "/root" }, ubuntu: { uid: 1000, home: "/home/ubuntu" } } } });
  const r = s.rodar(preparar, ["--chave-ssh", CHAVE_DONO], KIT);
  assert.equal(r.status, 0, r.saida);
  assert.equal(s.ler("/root/.ssh/authorized_keys"), `${CHAVE_DONO}\n`);
  assert.match(r.stdout, /Chave nova cadastrada na conta root: teste a entrada com ela num outro terminal/);
  assert.match(r.stdout, /Login por senha: LIGADO/, "cadastrar a chave nao fecha a senha");
  const viaSudo = s.rodar(preparar, ["--chave-ssh", CHAVE_DONO], { ...KIT, SUDO_USER: "ubuntu" });
  assert.equal(viaSudo.status, 0, viaSudo.saida);
  assert.equal(s.ler("/home/ubuntu/.ssh/authorized_keys"), `${CHAVE_DONO}\n`);
  assert.ok(s.chamadas().some((c) => c.tool === "chown" && c.args[0] === "ubuntu:" && c.args[1].endsWith("/home/ubuntu/.ssh/authorized_keys")), "o grupo de login da conta");
  // Um authorized_keys editado a mao, sem quebra de linha no fim: a chave nova entra na linha dela.
  const semQuebra = servidorDeMentira({ arquivos: { "/root/.ssh/authorized_keys": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHZlbGhhLWNoYXZl velha" } });
  assert.equal(semQuebra.rodar(preparar, ["--chave-ssh", CHAVE_DONO], KIT).status, 0);
  assert.equal(semQuebra.ler("/root/.ssh/authorized_keys"), `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHZlbGhhLWNoYXZl velha\n${CHAVE_DONO}\n`);
  for (const [chave, frase] of [
    ["-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjE=\n-----END OPENSSH PRIVATE KEY-----", /Isso e a chave PRIVADA/],
    ["minha senha 123", /nao parece uma chave publica do SSH/],
    ["ssh-ed25519 AAAA\nssh-rsa AAAB", /nao parece uma chave publica do SSH/]
  ]) {
    const t = servidorDeMentira();
    const e = t.rodar(preparar, ["--chave-ssh", chave], KIT);
    assert.equal(e.status, 1, chave);
    assert.match(e.stderr, frase);
    assert.equal(t.existe("/root/.ssh/authorized_keys"), false);
  }
});

test("fechar a senha: so numa sessao SSH que entrou com chave; senha, console ou registro sem a sessao nao mudam nada", () => {
  const casos = [
    [{}, { SSH_CONNECTION: undefined }, /Rode este passo numa sessao SSH aberta com a sua chave \(nao pelo console do provedor\)/],
    [{}, {}, /Esta sessao entrou por senha \(password\)\. Abra outro terminal, entre com a sua chave e rode este passo la/],
    [{ journal: ["Accepted publickey for root from 203.0.113.5 port 40000 ssh2: ED25519"] }, {}, /Nao achei no registro do SSH como esta sessao entrou \(203\.0\.113\.5, porta 51234\)/],
    [{ journal: ["Accepted keyboard-interactive/pam for root from 203.0.113.5 port 51234 ssh2"] }, {}, /entrou por senha \(keyboard-interactive\/pam\)/]
  ];
  for (const [estado, extra, frase] of casos) {
    const s = servidorDeMentira({ estado, arquivos: cloudInitComSenha });
    const antes = s.fotografia();
    const r = s.pessoa(preparar, ["--fechar-login-por-senha"], [{ espera: "Digite FECHAR", responde: "FECHAR" }], { ...KIT, ...extra });
    assert.equal(r.status, 13, r.saida);
    assert.match(r.saida, frase);
    assert.match(r.saida, /nada mudou\./i);
    assert.deepEqual(s.fotografia(), antes);
    assert.deepEqual(s.chamadas().filter(muda), []);
  }
  // Com chave, mas sem uma pessoa no terminal (a IA rodando o comando): codigo 7.
  const s = servidorDeMentira({ estado: sessaoComChave, arquivos: cloudInitComSenha });
  const semTerminal = s.rodar(preparar, ["--fechar-login-por-senha"], KIT);
  assert.equal(semTerminal.status, 7);
  assert.match(semTerminal.stderr, /pede a confirmacao de uma pessoa no terminal/);
  // Uma pessoa que nao digita FECHAR.
  const desistiu = s.pessoa(preparar, ["--fechar-login-por-senha"], [{ espera: "Digite FECHAR", responde: "sim" }], KIT);
  assert.equal(desistiu.status, 1);
  assert.match(desistiu.saida, /Confirmacao diferente de FECHAR: nada mudou/);
  assert.equal(s.existe("/etc/ssh/sshd_config.d/01-escola-x-sem-senha.conf"), false);
  // A producao nao tem esse passo.
  assert.equal(servidorDeMentira().rodar(bootstrap, ["--fechar-login-por-senha"]).status, 1);
});

test("fechar a senha com chave e FECHAR: grava antes do 50-cloud-init, confere no sshd -T e recarrega sem derrubar a sessao", () => {
  const s = servidorDeMentira({ estado: sessaoComChave, arquivos: cloudInitComSenha });
  const r = s.pessoa(preparar, ["--fechar-login-por-senha"], [{ espera: "Digite FECHAR", responde: "FECHAR" }], KIT);
  assert.equal(r.status, 0, r.saida);
  assert.match(r.saida, /Esta sessao entrou com chave \(conta root, de 203\.0\.113\.5\)/);
  assert.equal(s.ler("/etc/ssh/sshd_config.d/01-escola-x-sem-senha.conf").split("\n").filter((l) => !l.startsWith("#")).join("\n"), "PasswordAuthentication no\nKbdInteractiveAuthentication no\nChallengeResponseAuthentication no\n");
  const ordem = s.chamadas().filter((c) => ["sshd", "systemctl"].includes(c.tool)).map((c) => `${c.tool} ${c.args[0]}`);
  assert.deepEqual(ordem.slice(-4), ["sshd -t", "sshd -T", "sshd -T", "systemctl reload"], "valida, confere o efetivo e so entao recarrega (nunca restart)");
  const efetivo = spawnSync("sshd", ["-T"], { encoding: "utf8", env: s.ambiente() }).stdout;
  assert.match(efetivo, /^passwordauthentication no$/m);
  assert.match(r.saida, /entre de novo com a chave num terceiro terminal/);
  // Rodar de novo: ja fechado, sem pergunta e sem mudanca.
  s.limparLog();
  const deNovo = s.rodar(preparar, ["--fechar-login-por-senha"], KIT);
  assert.equal(deNovo.status, 0);
  assert.match(deNovo.stdout, /o login por senha ja esta fechado; nada mudou/);
  assert.deepEqual(s.chamadas().filter(muda), []);
});

test("fechar a senha volta como estava quando o sshd recusa ou quando outro arquivo manda no login por senha (codigo 14)", () => {
  const recusa = servidorDeMentira({ estado: sessaoComChave, arquivos: cloudInitComSenha });
  const r = recusa.pessoa(preparar, ["--fechar-login-por-senha"], [{ espera: "Digite FECHAR", responde: "FECHAR" }], { ...KIT, SHIM_SSHD_T_FALHA: "1" });
  assert.equal(r.status, 14, r.saida);
  assert.match(r.saida, /O sshd recusou a configuracao .*; voltou como estava/);
  assert.equal(recusa.existe("/etc/ssh/sshd_config.d/01-escola-x-sem-senha.conf"), false);
  assert.equal(recusa.chamadas().filter((c) => c.tool === "systemctl").length, 0, "nada recarregado");
  // Um arquivo do provedor que o sshd le antes do nosso (00-) e liga a senha.
  const outro = servidorDeMentira({ estado: sessaoComChave, arquivos: { "/etc/ssh/sshd_config.d/00-provedor.conf": "PasswordAuthentication yes\n" } });
  const o = outro.pessoa(preparar, ["--fechar-login-por-senha"], [{ espera: "Digite FECHAR", responde: "FECHAR" }], KIT);
  assert.equal(o.status, 14, o.saida);
  assert.match(o.saida, /Outro trecho da configuracao do SSH manda no login por senha \(\/etc\/ssh\/sshd_config\.d\/00-provedor\.conf \); voltou como estava/);
  assert.equal(outro.existe("/etc/ssh/sshd_config.d/01-escola-x-sem-senha.conf"), false);
  assert.equal(outro.chamadas().filter((c) => c.tool === "systemctl").length, 0);
});

test("debaixo do sudo, a sessao SSH e achada no processo que chamou (o sudo limpa o SSH_CONNECTION)", () => {
  const s = servidorDeMentira({ estado: sessaoComChave });
  // O processo de cima tem o SSH_CONNECTION; o bootstrap roda sem ele (como depois do sudo) e le os processos de verdade.
  const ambiente = { ...s.ambiente({ ...KIT, BOOTSTRAP_PROC: "/proc" }), PERFIL: "kit", NOME: "escola-x", PASTA_ESTADO: "/var/lib/escola-x", PASTA_BACKUP: "/var/backups/escola-x", PASTA_CERTIFICADOS: "/var/lib/escola-x/caddy", PASTA_INSTALACAO: "/opt/escola-x" };
  // Dois comandos no `bash -c`: ele fica de pe como pai (com um comando so, o bash se troca pelo filho).
  const r = spawnSync("bash", ["-c", `env -u SSH_CONNECTION bash "${bootstrap}" --simular; exit $?`], { encoding: "utf8", env: ambiente });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /esta sessao: publickey; conta: root/);
  assert.match(s.ler("/etc/fail2ban/jail.d/defaults-debian.conf"), /\[sshd\]/, "nada mudou (simulacao)");
  assert.equal(SESSAO.split(" ")[0], "203.0.113.5");
});

test("Docker que ja existe fica; sem o compose 2 para com a frase do que fazer (codigo 12); daemon.json do dono e respeitado", () => {
  const s = servidorDeMentira({ estado: { docker: { instalado: true, versao: "27.3.1", compose: "2.29.7" } }, arquivos: { "/etc/docker/daemon.json": '{ "log-driver": "journald", "data-root": "/srv/docker" }\n' } });
  const r = s.rodar(preparar, [], KIT);
  assert.equal(r.status, 0, r.saida);
  assert.match(r.stdout, /ja instalado: Docker version 27\.3\.1, build e180ab8, compose 2\.29\.7/);
  assert.equal(s.existe("/etc/apt/sources.list.d/docker.list"), false);
  // O que o dono definiu fica; log-opts so com o json-file (com o journald o Docker nem subiria).
  assert.deepEqual(JSON.parse(s.ler("/etc/docker/daemon.json")), { "log-driver": "journald", "data-root": "/srv/docker", "live-restore": true });
  const semCompose = servidorDeMentira({ estado: { docker: { instalado: true, versao: "26.1.3", compose: null } } });
  const e = semCompose.rodar(preparar, [], KIT);
  assert.equal(e.status, 12);
  assert.match(e.stderr, /ja tem o Docker \(Docker version 26\.1\.3, build e180ab8\), mas sem o compose/);
  const velho = servidorDeMentira({ estado: { docker: { instalado: true, versao: "20.10.24", compose: "1.29.2" } } });
  assert.equal(velho.rodar(preparar, [], KIT).status, 12);
  // A chave do repositorio do Docker que nao e a esperada nao instala nada.
  const chaveErrada = servidorDeMentira({ estado: { gpg_fpr: "0".repeat(40) } });
  const c = chaveErrada.rodar(preparar, [], KIT);
  assert.equal(c.status, 3);
  assert.match(c.stderr, /A chave baixada do repositorio do Docker nao e a esperada/);
  assert.equal(chaveErrada.existe("/etc/apt/keyrings/docker.asc"), false);
  assert.ok(!chaveErrada.estado().pacotes.includes("docker-ce"));
});

test("swap: o que o provedor ja deu basta; servidor que recusa swap segue sem ele, com o aviso", () => {
  const s = servidorDeMentira({ estado: { swap: [{ nome: "/dev/sda2", bytes: 4294967296 }] } });
  assert.equal(s.rodar(preparar, [], KIT).status, 0);
  assert.equal(s.chamadas().filter((c) => c.tool === "fallocate").length, 0);
  const t = servidorDeMentira({ estado: { swap_falha: true } });
  const r = t.rodar(preparar, [], KIT);
  assert.equal(r.status, 0, r.saida);
  assert.match(r.stderr, /este servidor nao aceitou ligar o swap/);
  assert.equal(t.existe("/swapfile"), false);
  assert.doesNotMatch(t.ler("/etc/fstab"), /swapfile/);
});

// ---- producao: o perfil de sempre ----------------------------------------------------------------------------------
const PRODUCAO = { SSH_PUBLIC_KEY: CHAVE_PRODUTOR, SUPABASE_CLI_VERSION: "0.0.0-teste", SUPABASE_CLI_SHA256: createHash("sha256").update("deb de mentira\n").digest("hex"), SSH_CONNECTION: undefined };

test("producao: zera o ufw, SSH sem limite, usuario deploy com a chave e o SSH so com chave, como sempre", () => {
  const s = servidorDeMentira({ estado: { ufw: { ativo: true, entrada: "allow", saida: "allow", roteada: "disabled", regras: [{ regra: "allow 8080/tcp", comentario: "" }] } } });
  const r = s.rodar(bootstrap, [], PRODUCAO);
  assert.equal(r.status, 0, r.saida);
  assert.deepEqual(ufw(s), [
    "--force reset",
    "default deny incoming",
    "default allow outgoing",
    "allow 22/tcp comment SSH",
    "allow 80/tcp comment HTTP (Caddy)",
    "allow 443/tcp comment HTTPS (Caddy)",
    "allow 443/udp comment HTTP/3 (Caddy)",
    "route allow proto tcp from any to any port 80 comment Caddy",
    "route allow proto tcp from any to any port 443 comment Caddy",
    "route allow proto udp from any to any port 443 comment Caddy HTTP/3",
    "--force enable"
  ]);
  // O firewall da Hetzner restringe a 22 e o deploy abre dezenas de conexoes seguidas: na producao, nunca limit.
  assert.ok(!ufw(s).some((c) => c.startsWith("limit")));
  assert.equal(s.ler("/etc/ssh/sshd_config.d/90-bunker707.conf"), "Port 22\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nChallengeResponseAuthentication no\nPubkeyAuthentication yes\nPermitRootLogin prohibit-password\nPermitEmptyPasswords no\nX11Forwarding no\nMaxAuthTries 4\nLoginGraceTime 30\nClientAliveInterval 300\nClientAliveCountMax 2\nAllowUsers root deploy\n");
  assert.ok(s.chamadas().some((c) => c.tool === "adduser" && c.args.at(-1) === "deploy"));
  assert.equal(s.ler("/home/deploy/.ssh/authorized_keys"), `${CHAVE_PRODUTOR}\n`);
  assert.equal(s.ler("/etc/sudoers.d/90-deploy"), "deploy ALL=(ALL) NOPASSWD:ALL\n");
  assert.equal(s.fotografia()["/etc/sudoers.d/90-deploy"].split(" ")[0], "440");
  assert.match(s.ler("/etc/apt/apt.conf.d/52bunker707-unattended"), /Automatic-Reboot "true"/);
  assert.equal(s.ler("/etc/fail2ban/jail.d/sshd.local"), "[sshd]\nenabled = true\nport = 22\nbackend = systemd\nmaxretry = 5\nfindtime = 10m\nbantime = 1h\n");
  assert.ok(s.chamadas().some((c) => c.tool === "dpkg" && c.args[0] === "-i"), "a CLI do Supabase");
  assert.ok(s.chamadas().find((c) => c.tool === "apt-get" && c.args.includes("install")).args.includes("git"));
  assert.ok(s.chamadas().some((c) => c.tool === "usermod" && c.args.join(" ") === "-aG docker deploy"));
  for (const pasta of ["/opt/bunker707", "/var/backups/bunker707"]) assert.ok(s.chamadas().some((c) => c.tool === "chown" && c.args[0] === "deploy:deploy" && c.args[1].endsWith(pasta)), pasta);
  assert.match(r.stdout, /Servidor preparado\. Proximos passos \(docs\/20-runbook-hetzner\.md, "Primeiro deploy"\)/);
  assert.match(s.ler("/etc/apt/sources.list.d/docker.list"), /linux\/ubuntu noble stable/);
  assert.equal(r.saida.includes("SSH_CONNECTION"), false);
});

test("producao sem nenhuma chave para o deploy para antes de fechar o SSH por senha", () => {
  const s = servidorDeMentira();
  const r = s.rodar(bootstrap, [], { ...PRODUCAO, SSH_PUBLIC_KEY: undefined });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Nenhuma chave SSH para deploy: informe SSH_PUBLIC_KEY\. Abortando antes de fechar o SSH por senha\./);
  assert.equal(s.existe("/etc/ssh/sshd_config.d/90-bunker707.conf"), false);
  assert.equal(ufw(s).length, 0);
  // A chave do root serve (o provision cria o servidor com ela).
  const t = servidorDeMentira({ arquivos: { "/root/.ssh/authorized_keys": `${CHAVE_PRODUTOR}\n` } });
  const u = t.rodar(bootstrap, [], { ...PRODUCAO, SSH_PUBLIC_KEY: undefined });
  assert.equal(u.status, 0, u.saida);
  assert.match(u.stdout, /Sem SSH_PUBLIC_KEY: copiei as chaves do root para deploy/);
  // E a simulacao da producao tambem nao muda nada.
  const v = servidorDeMentira();
  const antes = v.fotografia();
  assert.equal(v.rodar(bootstrap, ["--simular"], PRODUCAO).status, 0);
  assert.deepEqual(v.fotografia(), antes);
  assert.deepEqual(v.chamadas().filter(muda), []);
});

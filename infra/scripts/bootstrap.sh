#!/usr/bin/env bash
# Prepara um servidor Ubuntu 24.04 recem-criado na Hetzner para rodar a Bunker707. Roda UMA vez, como root,
# logo depois do primeiro acesso:
#   curl -fsSL https://raw.githubusercontent.com/danilosouza-dev/bunker707-member-area/main/infra/scripts/bootstrap.sh -o bootstrap.sh
#   sudo SSH_PUBLIC_KEY="ssh-ed25519 AAAA... produtor" bash bootstrap.sh
# (ou copie o arquivo por scp; o repositorio e privado, entao o curl acima so funciona com token)
#
# O que faz (idempotente; pode rodar de novo):
#   1. apt: atualizacoes, ufw, fail2ban, unattended-upgrades, restic, git, jq, curl;
#   2. usuario `deploy` (sudo sem senha, grupo docker) com a chave SSH informada (ou a do root);
#   3. SSH so com chave: sem senha, root so com chave (PermitRootLogin prohibit-password);
#   4. ufw: tudo fechado menos SSH (com rate limit), 80 e 443; regras DOCKER-USER para o Docker respeitar
#      o ufw (o Docker, por padrao, abre as portas publicadas direto no iptables);
#   5. fail2ban no sshd; unattended-upgrades com reinicio automatico as 05:30 UTC quando preciso;
#   6. Docker CE (repositorio oficial), log rotation e live-restore;
#   7. swap de 2 GB (o Supabase recomenda em maquinas de 8 GB);
#   8. CLI do Supabase (release oficial, versao pinada) para migrate.sh;
#   9. pasta /opt/bunker707 para o repositorio.
# Variaveis: SSH_PUBLIC_KEY, DEPLOY_USER (deploy), SSH_PORT (22), SWAP_GB (2), AUTO_REBOOT (true),
#            SUPABASE_CLI_VERSION (2.121.0), REPO_DIR (/opt/bunker707).
# Depois dele: docs/20-runbook-hetzner.md, "Primeiro deploy".

set -euo pipefail

[ "$(id -u)" = "0" ] || { echo "Rode como root (sudo)." >&2; exit 1; }
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] && [ "${VERSION_ID:-}" = "24.04" ] || echo "AVISO: pensado para Ubuntu 24.04; aqui e ${PRETTY_NAME:-desconhecido}."

DEPLOY_USER="${DEPLOY_USER:-deploy}"
SSH_PORT="${SSH_PORT:-22}"
SWAP_GB="${SWAP_GB:-2}"
AUTO_REBOOT="${AUTO_REBOOT:-true}"
SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-2.121.0}"
REPO_DIR="${REPO_DIR:-/opt/bunker707}"
export DEBIAN_FRONTEND=noninteractive

log() { printf '\n==> %s\n' "$*"; }

log "1/9 Pacotes"
apt-get update -q
apt-get upgrade -y -q
apt-get install -y -q ca-certificates curl gnupg git jq ufw fail2ban unattended-upgrades apt-listchanges restic rsync python3 openssh-client

log "2/9 Usuario $DEPLOY_USER"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
    adduser --disabled-password --gecos "Bunker707 deploy" "$DEPLOY_USER"
fi
usermod -aG sudo "$DEPLOY_USER"
echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$DEPLOY_USER"
chmod 440 "/etc/sudoers.d/90-$DEPLOY_USER"
home=$(getent passwd "$DEPLOY_USER" | cut -d: -f6)
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$home/.ssh"
touch "$home/.ssh/authorized_keys"
if [ -n "${SSH_PUBLIC_KEY:-}" ]; then
    grep -qxF "$SSH_PUBLIC_KEY" "$home/.ssh/authorized_keys" || echo "$SSH_PUBLIC_KEY" >> "$home/.ssh/authorized_keys"
elif [ -s /root/.ssh/authorized_keys ]; then
    cat /root/.ssh/authorized_keys >> "$home/.ssh/authorized_keys"
    sort -u -o "$home/.ssh/authorized_keys" "$home/.ssh/authorized_keys"
    echo "Sem SSH_PUBLIC_KEY: copiei as chaves do root para $DEPLOY_USER."
fi
chmod 600 "$home/.ssh/authorized_keys"; chown -R "$DEPLOY_USER:$DEPLOY_USER" "$home/.ssh"
[ -s "$home/.ssh/authorized_keys" ] || { echo "Nenhuma chave SSH para $DEPLOY_USER: informe SSH_PUBLIC_KEY. Abortando antes de fechar o SSH por senha." >&2; exit 1; }

log "3/9 SSH so com chave (porta $SSH_PORT)"
cat > /etc/ssh/sshd_config.d/90-bunker707.conf <<CONF
Port $SSH_PORT
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password
PermitEmptyPasswords no
X11Forwarding no
MaxAuthTries 4
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
AllowUsers root $DEPLOY_USER
CONF
# Ubuntu 24.04 usa socket activation: a porta vem do systemd, nao do sshd_config.
if [ "$SSH_PORT" != "22" ]; then
    mkdir -p /etc/systemd/system/ssh.socket.d
    printf '[Socket]\nListenStream=\nListenStream=%s\n' "$SSH_PORT" > /etc/systemd/system/ssh.socket.d/listen.conf
    systemctl daemon-reload
fi
sshd -t
systemctl restart ssh.socket 2>/dev/null || true
systemctl restart ssh

log "4/9 ufw (+ regras DOCKER-USER)"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw limit "$SSH_PORT/tcp" comment "SSH"
ufw allow 80/tcp comment "HTTP (Caddy)"
ufw allow 443/tcp comment "HTTPS (Caddy)"
ufw allow 443/udp comment "HTTP/3 (Caddy)"
# Portas publicadas por containers passam pelo DOCKER-USER, nao pelo INPUT: sem este bloco o Docker ignora
# o ufw. Com ele, so o que tiver `ufw route allow` fica acessivel de fora (github.com/chaifeng/ufw-docker).
if ! grep -q "BEGIN UFW AND DOCKER" /etc/ufw/after.rules; then
cat >> /etc/ufw/after.rules <<'RULES'

# BEGIN UFW AND DOCKER
*filter
:ufw-user-forward - [0:0]
:ufw-docker-logging-deny - [0:0]
:DOCKER-USER - [0:0]
-A DOCKER-USER -j ufw-user-forward
-A DOCKER-USER -j RETURN -s 10.0.0.0/8
-A DOCKER-USER -j RETURN -s 172.16.0.0/12
-A DOCKER-USER -j RETURN -s 192.168.0.0/16
-A DOCKER-USER -p udp -m udp --sport 53 --dport 1024:65535 -j RETURN
-A DOCKER-USER -j ufw-docker-logging-deny -p tcp -m tcp --tcp-flags FIN,SYN,RST,ACK SYN -d 192.168.0.0/16
-A DOCKER-USER -j ufw-docker-logging-deny -p tcp -m tcp --tcp-flags FIN,SYN,RST,ACK SYN -d 10.0.0.0/8
-A DOCKER-USER -j ufw-docker-logging-deny -p tcp -m tcp --tcp-flags FIN,SYN,RST,ACK SYN -d 172.16.0.0/12
-A DOCKER-USER -j ufw-docker-logging-deny -p udp -m udp --dport 0:32767 -d 192.168.0.0/16
-A DOCKER-USER -j ufw-docker-logging-deny -p udp -m udp --dport 0:32767 -d 10.0.0.0/8
-A DOCKER-USER -j ufw-docker-logging-deny -p udp -m udp --dport 0:32767 -d 172.16.0.0/12
-A DOCKER-USER -j RETURN
-A ufw-docker-logging-deny -m limit --limit 3/min --limit-burst 10 -j LOG --log-prefix "[UFW DOCKER BLOCK] "
-A ufw-docker-logging-deny -j DROP
COMMIT
# END UFW AND DOCKER
RULES
fi
# O Caddy e o unico container com porta publica (80/443); o resto do stack fica em 127.0.0.1.
ufw route allow proto tcp from any to any port 80 comment "Caddy"
ufw route allow proto tcp from any to any port 443 comment "Caddy"
ufw route allow proto udp from any to any port 443 comment "Caddy HTTP/3"
ufw --force enable
ufw status verbose

log "5/9 fail2ban e unattended-upgrades"
cat > /etc/fail2ban/jail.d/sshd.local <<CONF
[sshd]
enabled = true
port = $SSH_PORT
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
cat > /etc/apt/apt.conf.d/52bunker707-unattended <<CONF
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "$AUTO_REBOOT";
Unattended-Upgrade::Automatic-Reboot-Time "05:30";
CONF
systemctl enable --now unattended-upgrades

log "6/9 Docker CE"
if ! command -v docker >/dev/null 2>&1; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -q
    apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'CONF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true
}
CONF
systemctl enable --now docker
systemctl restart docker
usermod -aG docker "$DEPLOY_USER"
docker --version; docker compose version

log "7/9 Swap de ${SWAP_GB} GB"
if [ "$SWAP_GB" != "0" ] && ! swapon --show | grep -q /swapfile; then
    fallocate -l "${SWAP_GB}G" /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    printf 'vm.swappiness=10\n' > /etc/sysctl.d/90-bunker707.conf
    sysctl -q -p /etc/sysctl.d/90-bunker707.conf
fi
free -h | sed 's/^/  /'

log "8/9 CLI do Supabase $SUPABASE_CLI_VERSION"
if ! supabase --version 2>/dev/null | grep -q "$SUPABASE_CLI_VERSION"; then
    arch=$(dpkg --print-architecture)
    deb="/tmp/supabase_${SUPABASE_CLI_VERSION}_linux_${arch}.deb"
    curl -fsSL -o "$deb" "https://github.com/supabase/cli/releases/download/v${SUPABASE_CLI_VERSION}/supabase_${SUPABASE_CLI_VERSION}_linux_${arch}.deb"
    dpkg -i "$deb" >/dev/null
    rm -f "$deb"
fi
supabase --version
restic self-update >/dev/null 2>&1 || true
restic version

log "9/9 Pasta do repositorio"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$REPO_DIR"
install -d -m 700 /var/backups/bunker707
chown "$DEPLOY_USER:$DEPLOY_USER" /var/backups/bunker707

cat <<FIM

Servidor preparado. Proximos passos (docs/20-runbook-hetzner.md, "Primeiro deploy"):
  1. Em OUTRO terminal, confirme que entra como $DEPLOY_USER antes de fechar este: ssh -p $SSH_PORT $DEPLOY_USER@<ip>
  2. Como $DEPLOY_USER: git clone <repositorio> $REPO_DIR  (chave de deploy, repositorio privado)
  3. cd $REPO_DIR && sh infra/compose/generate-secrets.sh --domain ... --api-domain ... --studio-domain ... --email ...
  4. Preencha SMTP_PASS, STORAGE_BOX_*, STUDIO_ALLOWED_IPS e APP_IMAGE no infra/compose/.env
  5. docker login ghcr.io; docker compose -f infra/compose/docker-compose.yml up -d; sh infra/scripts/migrate.sh
  6. sh infra/scripts/backup.sh --init && sudo sh infra/scripts/backup.sh --install-timer
FIM

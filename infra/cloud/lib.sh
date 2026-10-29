#!/usr/bin/env bash
# Funcoes comuns de infra/cloud (provisionamento e operacao dos servidores da Hetzner a partir do GitHub
# Actions ou de qualquer maquina com os tokens). Carregue com: . "$(dirname "$0")/lib.sh"
#
# Variaveis de ambiente:
#   HCLOUD_TOKEN           token da API da Hetzner Cloud (leitura e escrita)           obrigatorio
#   CLOUDFLARE_API_TOKEN   token da API da Cloudflare (DNS e configuracoes da zona)      provision/status
#   ZONE_NAME              zona na Cloudflare (bunker707.com.br)
#   LOCATION               datacenter preferido (fsn1); FALLBACK_LOCATIONS tenta os outros
#   STORAGE_BOX_LOCATION   local do Storage Box (fsn1), independente do dos servidores
#   PRODUCER_EMAIL         e-mail do produtor (Let's Encrypt, admin do Mautic)
#   PRODUCER_IP            opcional: IP do produtor, mantido no firewall (SSH e Studio)
#   SKIP_MARKETING=1       Mautic no mesmo servidor do app (colocacao), sem o segundo servidor
#   MEET_TYPE              tipo do servidor C do Jitsi (cx23); JIBRI_TYPE, o do gravador por hora (cpx42)
#   JIBRI_SECRETS          segredo do repositorio com as linhas CHAVE=VALOR do gravador (docs/20 §8B.3)
# Nunca imprime segredos; o que precisa ser guardado vai mascarado para o log do Actions (::add-mask::).

set -euo pipefail

CLOUD_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$CLOUD_DIR/../.." && pwd)

ZONE_NAME="${ZONE_NAME:-bunker707.com.br}"
LOCATION="${LOCATION:-fsn1}"
FALLBACK_LOCATIONS="${FALLBACK_LOCATIONS:-nbg1 hel1}"
PRODUCER_EMAIL="${PRODUCER_EMAIL:-ferramentas.bunker707@gmail.com}"
PRODUCER_IP="${PRODUCER_IP:-}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
REMOTE_DIR="${REMOTE_DIR:-/opt/bunker707}"

MEMBROS_NAME="${MEMBROS_NAME:-bunker707-membros}"
MARKETING_NAME="${MARKETING_NAME:-bunker707-marketing}"
STORAGE_BOX_NAME="${STORAGE_BOX_NAME:-bunker707-backups}"
STORAGE_BOX_TYPE="${STORAGE_BOX_TYPE:-bx11}"
STORAGE_BOX_LOCATION="${STORAGE_BOX_LOCATION:-fsn1}"
SSH_KEY_NAME="${SSH_KEY_NAME:-bunker707-deploy}"
# Um so sentido em todos os scripts: vazio, 0, false ou no = dois servidores.
case "${SKIP_MARKETING:-}" in ""|0|false|no) SKIP_MARKETING="" ;; *) SKIP_MARKETING=1 ;; esac
# Webinarios (docs/30 §6.1): servidor C do Jitsi e os gravadores por hora, um por sessao (bunker707-jibri-<sessao>).
MEET_NAME="${MEET_NAME:-bunker707-meet}"
MEET_TYPE="${MEET_TYPE:-cx23}"
JIBRI_NAME_PREFIX="${JIBRI_NAME_PREFIX:-bunker707-jibri-}"
JIBRI_TYPE="${JIBRI_TYPE:-cpx42}"
JIBRI_REMOTE_DIR="${JIBRI_REMOTE_DIR:-/opt/jibri}"

APP_DOMAIN="${APP_DOMAIN:-membros.$ZONE_NAME}"
API_DOMAIN="${API_DOMAIN:-api.$ZONE_NAME}"
STUDIO_DOMAIN="${STUDIO_DOMAIN:-studio.$ZONE_NAME}"
MAUTIC_DOMAIN="${MAUTIC_DOMAIN:-marketing.$ZONE_NAME}"
MEET_DOMAIN="${MEET_DOMAIN:-meet.$ZONE_NAME}"
# Webhook do gravador no app (docs/30 §5.3); JIBRI_SECRETS pode trazer outro WEBINAR_RECORDER_WEBHOOK_URL.
RECORDER_WEBHOOK_URL="${WEBINAR_RECORDER_WEBHOOK_URL:-https://$APP_DOMAIN/api/webhooks/recorder}"

HCLOUD_VERSION="${HCLOUD_VERSION:-1.70.1}"
HCLOUD_SHA256="${HCLOUD_SHA256:-85182e0d51f9a26abeefd79b37de8a7fb51215d54c59ee290c3c9141e8aa887e}"

WORK_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/bunker707-cloud"
mkdir -p "$WORK_DIR"; chmod 700 "$WORK_DIR"
KEY_PATH="$WORK_DIR/deploy_key"
KNOWN_HOSTS="$WORK_DIR/known_hosts"

log()  { printf '\n==> %s\n' "$*"; }
warn() { printf 'AVISO: %s\n' "$*" >&2; }
die()  { printf 'ERRO: %s\n' "$*" >&2; exit 1; }
mask() { [ -n "${GITHUB_ACTIONS:-}" ] && printf '::add-mask::%s\n' "$1" || true; }
need() { for v in "$@"; do [ -n "${!v:-}" ] || die "Variavel $v ausente (segredo do repositorio no GitHub Actions ou export no terminal)."; done; }

# ---- hcloud -----------------------------------------------------------------------------------------
install_hcloud() {
    if command -v hcloud >/dev/null 2>&1 && hcloud version 2>/dev/null | grep -q "$HCLOUD_VERSION"; then return 0; fi
    local dir="$WORK_DIR/hcloud"; mkdir -p "$dir"
    curl -fsSL --max-time 120 -o "$dir/hcloud.tgz" "https://github.com/hetznercloud/cli/releases/download/v${HCLOUD_VERSION}/hcloud-linux-amd64.tar.gz"
    echo "$HCLOUD_SHA256  $dir/hcloud.tgz" | sha256sum -c - >/dev/null || die "Checksum do hcloud v$HCLOUD_VERSION nao bate."
    tar -xzf "$dir/hcloud.tgz" -C "$dir" hcloud
    mkdir -p "$HOME/.local/bin"; install -m 755 "$dir/hcloud" "$HOME/.local/bin/hcloud"
    export PATH="$HOME/.local/bin:$PATH"
    hcloud version >/dev/null
}
hz() { HCLOUD_TOKEN="$HCLOUD_TOKEN" hcloud --quiet --no-experimental-warnings "$@"; }
hzj() { HCLOUD_TOKEN="$HCLOUD_TOKEN" hcloud --no-experimental-warnings "$@" -o json; }

server_exists() { hz server describe "$1" >/dev/null 2>&1; }
# Pelo JSON: `hz` passa --quiet, que na CLI 1.70.1 descarta a saida de `server ip`.
server_ip4() {
    local ip; ip=$(hzj server describe "$1" | jq -r '.public_net.ipv4.ip // empty')
    [ -n "$ip" ] || die "Servidor $1 sem IPv4 publico (hcloud server describe $1)."
    printf '%s' "$ip"
}
server_ip6() {
    # A Hetzner entrega um /64; o servidor responde em ::1 dele.
    local prefix; prefix=$(hzj server describe "$1" | jq -r '.public_net.ipv6.ip // empty')
    [ -n "$prefix" ] || return 0
    printf '%s1' "${prefix%%/*}"
}

# ---- firewall da Hetzner ----------------------------------------------------------------------------
# fw_rules [cidr ...]: regras JSON = 80/443 so da Cloudflare, ICMP, e 22 so dos CIDRs informados (nenhum = sem SSH).
fw_rules() {
    # A lista da Cloudflare e baixada uma vez por execucao e reaproveitada (o fechamento do SSH no trap
    # nao pode depender da rede naquele instante).
    if [ -z "${CF_IPS_JSON:-}" ]; then CF_IPS_JSON=$(bash "$REPO_ROOT/infra/scripts/cloudflare-ips.sh" --json); export CF_IPS_JSON; fi
    local cf_json="$CF_IPS_JSON"
    python3 -I - "$cf_json" "$@" <<'PY'
import json, sys
cf = json.loads(sys.argv[1]); ssh = [c for c in sys.argv[2:] if c]
v4 = [ip for ip in cf if ":" not in ip]; v6 = [ip for ip in cf if ":" in ip]
rules = []
if ssh:
    rules.append({"direction": "in", "protocol": "tcp", "port": "22", "source_ips": ssh, "description": "SSH (sessao de deploy / produtor)"})
rules += [
    {"direction": "in", "protocol": "tcp", "port": "80", "source_ips": v4, "description": "HTTP so da Cloudflare (v4)"},
    {"direction": "in", "protocol": "tcp", "port": "80", "source_ips": v6, "description": "HTTP so da Cloudflare (v6)"},
    {"direction": "in", "protocol": "tcp", "port": "443", "source_ips": v4, "description": "HTTPS so da Cloudflare (v4)"},
    {"direction": "in", "protocol": "tcp", "port": "443", "source_ips": v6, "description": "HTTPS so da Cloudflare (v6)"},
    {"direction": "in", "protocol": "udp", "port": "443", "source_ips": v4 + v6, "description": "HTTP/3 so da Cloudflare"},
    {"direction": "in", "protocol": "icmp", "source_ips": ["0.0.0.0/0", "::/0"], "description": "ping do monitor"},
]
print(json.dumps(rules))
PY
}
# fw_rules_meet [cidr ...]: regras do servidor C do Jitsi (docs/30 §6.2). meet.<dominio> e DNS puro, entao 80 e
# 443 vem de qualquer lugar (site, external_api.js, websocket, Let's Encrypt); UDP 10000 e a midia do JVB;
# 3478 e 5349 ficam reservadas para o TURN (coturn, passo seguinte); TCP 5222 (XMPP) so dos gravadores vivos
# (servidores com label papel=jibri: a regra nasce e morre com eles, sem lista guardada); 22 so dos CIDRs
# informados, como nos outros servidores.
fw_rules_meet() {
    local jibri; jibri=$(jibri_cidrs)
    python3 -I - "$jibri" "$@" <<'PY'
import json, sys
jibri = [c for c in sys.argv[1].split() if c]; ssh = [c for c in sys.argv[2:] if c]
anywhere = ["0.0.0.0/0", "::/0"]
rules = []
if ssh:
    rules.append({"direction": "in", "protocol": "tcp", "port": "22", "source_ips": ssh, "description": "SSH (sessao de deploy / produtor)"})
rules += [
    {"direction": "in", "protocol": "tcp", "port": "80", "source_ips": anywhere, "description": "HTTP (Let's Encrypt; DNS puro, sem Cloudflare)"},
    {"direction": "in", "protocol": "tcp", "port": "443", "source_ips": anywhere, "description": "HTTPS (site, external_api.js, websocket XMPP)"},
    {"direction": "in", "protocol": "udp", "port": "443", "source_ips": anywhere, "description": "HTTP/3"},
    {"direction": "in", "protocol": "udp", "port": "10000", "source_ips": anywhere, "description": "midia (JVB)"},
    {"direction": "in", "protocol": "udp", "port": "3478", "source_ips": anywhere, "description": "TURN (reservado; coturn e passo seguinte)"},
    {"direction": "in", "protocol": "tcp", "port": "3478", "source_ips": anywhere, "description": "TURN/TCP (reservado)"},
    {"direction": "in", "protocol": "tcp", "port": "5349", "source_ips": anywhere, "description": "TURNS (reservado)"},
]
if jibri:
    rules.append({"direction": "in", "protocol": "tcp", "port": "5222", "source_ips": jibri, "description": "XMPP so dos gravadores (Jibri) vivos"})
rules.append({"direction": "in", "protocol": "icmp", "source_ips": ["0.0.0.0/0", "::/0"], "description": "ping do monitor"})
print(json.dumps(rules))
PY
}
# fw_rules_jibri [cidr ...]: o gravador nao recebe nada de fora; so a 22 durante a etapa e o ping.
fw_rules_jibri() {
    python3 -I - "$@" <<'PY'
import json, sys
ssh = [c for c in sys.argv[1:] if c]
rules = []
if ssh:
    rules.append({"direction": "in", "protocol": "tcp", "port": "22", "source_ips": ssh, "description": "SSH (sessao de deploy / produtor)"})
rules.append({"direction": "in", "protocol": "icmp", "source_ips": ["0.0.0.0/0", "::/0"], "description": "ping"})
print(json.dumps(rules))
PY
}
# fw_rules_for SERVER_NAME [cidr ...]: o conjunto de regras de cada papel, pelo nome do servidor.
fw_rules_for() {
    local name="$1"; shift
    case "$name" in
        "$MEET_NAME") fw_rules_meet "$@" ;;
        "$JIBRI_NAME_PREFIX"*) fw_rules_jibri "$@" ;;
        *) fw_rules "$@" ;;
    esac
}
# CIDRs (IPv4/32 e o /64 de IPv6) dos gravadores vivos, lidos pela API e guardados por execucao; jibri-up e
# jibri-down chamam jibri_cidrs_refresh depois de criar ou apagar um.
jibri_cidrs() {
    if [ -z "${JIBRI_CIDRS_CACHE+x}" ]; then
        JIBRI_CIDRS_CACHE=$(hzj server list --selector papel=jibri 2>/dev/null | jq -r '.[] | [((.public_net.ipv4.ip // empty) + "/32"), (.public_net.ipv6.ip // empty)] | .[] | select(. != "/32")' | tr '\n' ' ') || JIBRI_CIDRS_CACHE=""
        export JIBRI_CIDRS_CACHE
    fi
    printf '%s' "$JIBRI_CIDRS_CACHE"
}
jibri_cidrs_refresh() { unset JIBRI_CIDRS_CACHE; }
fw_name() { printf '%s-fw' "$1"; }
fw_ensure() {  # fw_ensure SERVER_NAME
    local name; name=$(fw_name "$1")
    if ! hz firewall describe "$name" >/dev/null 2>&1; then
        log "Criando o firewall $name"
        hz firewall create --name "$name" --label app=bunker707 >/dev/null
    fi
    fw_rules_for "$1" "$(cidr_or_empty "$PRODUCER_IP")" > "$WORK_DIR/rules-$name.json"
    hz firewall replace-rules "$name" --rules-file "$WORK_DIR/rules-$name.json"
}
fw_apply() {  # fw_apply SERVER_NAME (idempotente; a API recusa aplicar duas vezes)
    local name sid; name=$(fw_name "$1"); sid=$(hzj server describe "$1" | jq -r '.id')
    # No JSON do firewall, applied_to[].server traz so o id.
    if hzj firewall describe "$name" | jq -e --argjson id "$sid" '.applied_to[]? | select(.type=="server" and .server.id==$id)' >/dev/null; then return 0; fi
    hz firewall apply-to-resource "$name" --type server --server "$1"
}
cidr_or_empty() { case "${1:-}" in "") ;; */*) printf '%s' "$1" ;; *:*) printf '%s/128' "$1" ;; *) printf '%s/32' "$1" ;; esac; }
# PRODUCER_IP vai para o firewall (SSH e Studio) e para comandos remotos: so um IP ou rede pequena valida.
if [ -n "$PRODUCER_IP" ]; then
    python3 -I -c 'import ipaddress, sys; n = ipaddress.ip_network(sys.argv[1], strict=False); sys.exit(0 if n.prefixlen >= (24 if n.version == 4 else 48) else 1)' \
        "$(cidr_or_empty "$PRODUCER_IP")" 2>/dev/null || die "PRODUCER_IP invalido ou amplo demais (no minimo /24 ou /48): $PRODUCER_IP"
fi
runner_ip() { curl -fsS --max-time 15 https://checkip.amazonaws.com | tr -d '[:space:]'; }
# Abre a porta 22 para esta maquina (e o produtor, se PRODUCER_IP) e fecha de novo ao sair do script.
# O trap e armado ANTES de abrir, e uma falha ao fechar vira falha da etapa (nunca verde com a 22 aberta).
# Cancelamento ou timeout do job matam o script sem trap: o servidor fica anotado em fw-abertos, e o passo
# final do workflow (run.sh fechar-ssh, `if: always()`) fecha o que ficou.
fw_open_ssh() {  # fw_open_ssh SERVER_NAME
    local name me; name=$(fw_name "$1"); me=$(runner_ip)
    log "Abrindo SSH do $1 para $me"
    fw_rules_for "$1" "$(cidr_or_empty "$me")" "$(cidr_or_empty "$PRODUCER_IP")" > "$WORK_DIR/rules-open-$name.json"
    FW_OPENED="${FW_OPENED:-} $1"
    printf '%s\n' "$1" >> "$WORK_DIR/fw-abertos"
    trap 'rc=$?; set +e; fw_close_all || rc=1; exit $rc' EXIT
    hz firewall replace-rules "$name" --rules-file "$WORK_DIR/rules-open-$name.json"
}
fw_close_all() {
    local s name failed=0
    for s in ${FW_OPENED:-}; do
        ssh -o "ControlPath=$WORK_DIR/cm-%C" -O exit "$DEPLOY_USER@$(server_ip4 "$s")" 2>/dev/null || true
        ssh -o "ControlPath=$WORK_DIR/cm-%C" -O exit "root@$(server_ip4 "$s")" 2>/dev/null || true
        name=$(fw_name "$s")
        fw_rules_for "$s" "$(cidr_or_empty "$PRODUCER_IP")" > "$WORK_DIR/rules-close-$name.json"
        if hz firewall replace-rules "$name" --rules-file "$WORK_DIR/rules-close-$name.json"; then
            printf 'SSH do %s fechado.\n' "$s"
            [ -f "$WORK_DIR/fw-abertos" ] && sed -i "/^$s\$/d" "$WORK_DIR/fw-abertos"
        else
            printf '::error::SSH do %s continua aberto; rode a etapa fechar-ssh.\n' "$s"; failed=1
        fi
    done
    FW_OPENED=""
    return "$failed"
}

# ---- SSH --------------------------------------------------------------------------------------------
deploy_key() {
    [ -f "$KEY_PATH" ] && return 0
    command -v node >/dev/null 2>&1 || die "Preciso do Node para derivar a chave de deploy (infra/cloud/deploy-key.mjs)."
    node "$CLOUD_DIR/deploy-key.mjs" --out "$KEY_PATH" >/dev/null
}
deploy_public_key() { deploy_key; cat "$KEY_PATH.pub"; }
# ControlMaster: uma conexao TCP por host, reaproveitada por rsh, rcopy e wait_ssh (dezenas de comandos
# em sequencia sem abrir dezenas de conexoes; o sshd e o fail2ban veriam isso como ataque).
SSH_OPTS=(-i "$KEY_PATH" -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$KNOWN_HOSTS" -o ConnectTimeout=20 -o BatchMode=yes -o ServerAliveInterval=30 -o LogLevel=ERROR
          -o ControlMaster=auto -o "ControlPath=$WORK_DIR/cm-%C" -o ControlPersist=10m)
rsh()   { local target="$1"; shift; ssh "${SSH_OPTS[@]}" "$target" "$@"; }
rcopy() { scp "${SSH_OPTS[@]}" "$@"; }
wait_ssh() {  # wait_ssh user@host [tentativas]
    local target="$1" tries="${2:-40}" i
    for ((i = 1; i <= tries; i++)); do
        if ssh "${SSH_OPTS[@]}" -o ConnectTimeout=8 "$target" true 2>/dev/null; then return 0; fi
        sleep 8
    done
    die "SSH nao respondeu em $target."
}
# Envia o repositorio (o commit atual) para REMOTE_DIR, sem tocar em .env, volumes e dados.
# As migracoes sao trocadas inteiras: uma renomeada ou removida no repositorio nao pode sobrar no servidor
# para o migrate.sh aplicar.
sync_repo() {  # sync_repo user@host
    local target="$1"
    git -C "$REPO_ROOT" archive --format=tar HEAD | rsh "$target" "mkdir -p '$REMOTE_DIR' && rm -rf '$REMOTE_DIR/supabase/migrations' && tar -x -C '$REMOTE_DIR'"
    rsh "$target" "echo '$(git -C "$REPO_ROOT" rev-parse HEAD)' > '$REMOTE_DIR/.deployed-commit'"
}
# set_env user@host ARQUIVO CHAVE VALOR: grava CHAVE=VALOR no .env remoto (troca a linha ou acrescenta).
# O valor vai como argumento em base64 (aguenta qualquer caractere); o stdin fica so com o programa.
set_env() {
    local target="$1" file="$2" key="$3" value="$4" b64
    b64=$(printf '%s' "$value" | base64 -w0)
    rsh "$target" "python3 -I - '$file' '$key' '$b64'" <<'PY'
import base64, os, re, sys
path, key = sys.argv[1], sys.argv[2]
os.umask(0o077)
value = base64.b64decode(sys.argv[3]).decode("utf-8")
lines = open(path, encoding="utf-8").read().split("\n") if os.path.exists(path) else []
pattern = re.compile(r"^%s=" % re.escape(key))
done = False
for i, line in enumerate(lines):
    if pattern.match(line):
        lines[i] = f"{key}={value}"; done = True; break
if not done:
    while lines and lines[-1] == "":
        lines.pop()
    lines.append(f"{key}={value}")
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh: fh.write("\n".join(lines).rstrip("\n") + "\n")
os.chmod(tmp, 0o600); os.replace(tmp, path)
PY
}
get_env() { rsh "$1" "grep -E '^$3=' '$2' | head -n1 | cut -d= -f2-"; }

# remote_auth_curl ENV_FILE: comando (para rodar NO servidor) que chama a API administrativa do Auth com a
# chave secreta do .env. A chave nunca sai do servidor nem entra em argv (ps, /proc): o shell remoto le do
# .env e entrega os cabecalhos ao curl por um config no stdin (-K -). Use como prefixo: "$cmd 'URL' ...".
remote_auth_curl() {
    printf '%s' "k=\$(grep -E '^SUPABASE_SECRET_KEY=' '$1' | head -n1 | cut -d= -f2-) && [ -n \"\$k\" ] && printf 'header = \"apikey: %s\"\\nheader = \"Authorization: Bearer %s\"\\n' \"\$k\" \"\$k\" | curl -fsS -K -"
}

# Senha de recuperacao dos backups: derivada do HCLOUD_TOKEN e cadastrada como segunda chave do repositorio
# restic do papel. Sem o .env do servidor (servidor perdido), quem tem o token abre o backup (docs/20 §10.2).
# A senha vai pelo stdin do SSH para um arquivo temporario 0600 no servidor, apagado em seguida.
backup_recovery_key() {  # backup_recovery_key user@host membros|marketing
    local target="$1" script f="$WORK_DIR/restic-recovery"
    case "$2" in membros) script=infra/scripts/backup.sh ;; marketing) script=infra/mautic/scripts/backup.sh ;; *) die "papel invalido: $2" ;; esac
    node "$CLOUD_DIR/deploy-key.mjs" --secret --info bunker707-restic-recovery-v1 --out "$f" 2>/dev/null
    rsh "$target" "umask 077; k=\$(mktemp); cat > \"\$k\"; cd '$REMOTE_DIR' && bash $script --add-key=\"\$k\"; rc=\$?; rm -f \"\$k\"; exit \$rc" < "$f"
    rm -f "$f"
}

# ---- Cloudflare -------------------------------------------------------------------------------------
cf_api() {  # cf_api METODO CAMINHO [JSON]
    local method="$1" path="$2" data="${3:-}" out
    out=$(curl -fsS --max-time 60 -X "$method" "https://api.cloudflare.com/client/v4$path" \
        -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" ${data:+--data "$data"}) \
        || die "Cloudflare $method $path falhou (HTTP). Confira CLOUDFLARE_API_TOKEN e as permissoes (Zone.DNS edit, Zone Settings edit)."
    if ! printf '%s' "$out" | jq -e '.success == true' >/dev/null; then
        printf '%s' "$out" | jq -r '.errors[]? | "  \(.code): \(.message)"' >&2
        die "Cloudflare $method $path respondeu erro."
    fi
    printf '%s' "$out"
}
cf_zone_id() { [ -n "${CF_ZONE_ID:-}" ] || CF_ZONE_ID=$(cf_api GET "/zones?name=$ZONE_NAME&status=active" | jq -r '.result[0].id // empty'); [ -n "$CF_ZONE_ID" ] || die "Zona $ZONE_NAME nao encontrada com este token."; printf '%s' "$CF_ZONE_ID"; }
# cf_dns_upsert NOME TIPO CONTEUDO proxied(true|false)
cf_dns_upsert() {
    local name="$1" type="$2" content="$3" proxied="$4" zone fqdn existing id
    zone=$(cf_zone_id); fqdn="$name.$ZONE_NAME"
    existing=$(cf_api GET "/zones/$zone/dns_records?type=$type&name=$fqdn")
    id=$(printf '%s' "$existing" | jq -r '.result[0].id // empty')
    local body; body=$(jq -nc --arg t "$type" --arg n "$fqdn" --arg c "$content" --argjson p "$proxied" '{type:$t,name:$n,content:$c,proxied:$p,ttl:1}')
    if [ -z "$id" ]; then
        cf_api POST "/zones/$zone/dns_records" "$body" >/dev/null; printf '  %-10s %-6s %s (criado, proxy=%s)\n' "$fqdn" "$type" "$content" "$proxied"
    elif [ "$(printf '%s' "$existing" | jq -r '.result[0] | "\(.content)|\(.proxied)"')" != "$content|$proxied" ]; then
        cf_api PUT "/zones/$zone/dns_records/$id" "$body" >/dev/null; printf '  %-10s %-6s %s (atualizado, proxy=%s)\n' "$fqdn" "$type" "$content" "$proxied"
    else
        printf '  %-10s %-6s %s (ja estava)\n' "$fqdn" "$type" "$content"
    fi
}
cf_zone_setting() {  # cf_zone_setting CHAVE VALOR
    local zone; zone=$(cf_zone_id)
    cf_api PATCH "/zones/$zone/settings/$1" "$(jq -nc --arg v "$2" '{value:$v}')" >/dev/null
    printf '  %s = %s\n' "$1" "$2"
}

# cf_apply_dns: os quatro nomes (membros, api, studio -> servidor A; marketing -> B ou A) apontando para os
# IPs atuais, proxied; SSL Full (strict); "Always Use HTTPS" desligado (o Let's Encrypt valida por HTTP
# atraves da Cloudflare; um redirecionamento na borda faria a validacao bater num origin sem certificado).
cf_apply_dns() {
    local m4 m6 k4 k6 sub
    m4=$(server_ip4 "$MEMBROS_NAME"); m6=$(server_ip6 "$MEMBROS_NAME")
    for sub in "${APP_DOMAIN%%.*}" "${API_DOMAIN%%.*}" "${STUDIO_DOMAIN%%.*}"; do
        cf_dns_upsert "$sub" A "$m4" true
        [ -n "$m6" ] && cf_dns_upsert "$sub" AAAA "$m6" true
    done
    if [ -n "${SKIP_MARKETING:-}" ] || ! server_exists "$MARKETING_NAME"; then k4="$m4"; k6="$m6"; else k4=$(server_ip4 "$MARKETING_NAME"); k6=$(server_ip6 "$MARKETING_NAME"); fi
    cf_dns_upsert "${MAUTIC_DOMAIN%%.*}" A "$k4" true
    [ -n "$k6" ] && cf_dns_upsert "${MAUTIC_DOMAIN%%.*}" AAAA "$k6" true
    cf_zone_setting ssl strict
    cf_zone_setting always_use_https off
}
# cf_remove_dns: apaga os registros A/AAAA dos quatro nomes (servidores guardados em snapshot).
cf_remove_dns() {
    local zone sub fqdn ids id
    zone=$(cf_zone_id)
    for sub in "${APP_DOMAIN%%.*}" "${API_DOMAIN%%.*}" "${STUDIO_DOMAIN%%.*}" "${MAUTIC_DOMAIN%%.*}"; do
        fqdn="$sub.$ZONE_NAME"
        ids=$(cf_api GET "/zones/$zone/dns_records?name=$fqdn" | jq -r '.result[] | select(.type=="A" or .type=="AAAA") | .id')
        for id in $ids; do cf_api DELETE "/zones/$zone/dns_records/$id" >/dev/null; done
        printf '  %-28s %s registro(s) apagado(s)\n' "$fqdn" "$(printf '%s' "$ids" | grep -c . || true)"
    done
}

# cf_apply_dns_meet: meet.<dominio> -> servidor C, A e AAAA SEM proxy (WebRTC/UDP nao passa pela Cloudflare;
# o certificado e do Caddy do proprio servidor, docs/30 §6.2).
cf_apply_dns_meet() {
    local ip4 ip6 sub; ip4=$(server_ip4 "$MEET_NAME"); ip6=$(server_ip6 "$MEET_NAME"); sub="${MEET_DOMAIN%%.*}"
    cf_dns_upsert "$sub" A "$ip4" false
    [ -n "$ip6" ] && cf_dns_upsert "$sub" AAAA "$ip6" false
    return 0
}

# ---- Storage Box ------------------------------------------------------------------------------------
storage_box_json() { hzj storage-box describe "$STORAGE_BOX_NAME" 2>/dev/null || true; }

# ---- Webinarios: segredos do gravador, webhook assinado e preco por hora --------------------------------
# JIBRI_SECRETS e um segredo do repositorio com linhas CHAVE=VALOR (docs/20 §8B.3; docs/30 §7.3, I4): o
# gravador vive poucas horas e nao tem transfer.key para o envelope. O runner do Actions mascara cada linha.
jibri_secret() {  # jibri_secret CHAVE  (obrigatoria)
    local value; value=$(jibri_secret_opt "$1" "")
    [ -n "$value" ] || die "JIBRI_SECRETS sem a linha $1=... (segredo do repositorio, docs/20 §8B.3)."
    printf '%s' "$value"
}
jibri_secret_opt() {  # jibri_secret_opt CHAVE PADRAO
    local line
    line=$(printf '%s\n' "${JIBRI_SECRETS:-}" | tr -d '\r' | grep -E "^$1=" | head -n1 || true)
    if [ -n "$line" ]; then printf '%s' "${line#*=}"; else printf '%s' "$2"; fi
}
# recorder_request METODO CAMINHO [CORPO]: chama o webhook do gravador do app (docs/30 §5.3) assinado com o
# WEBINAR_RECORDER_WEBHOOK_SECRET de JIBRI_SECRETS: X-Bunker-Timestamp (segundos Unix) e X-Bunker-Signature =
# HMAC-SHA256 de "<timestamp>.<corpo>" (corpo vazio no GET). O segredo entra no python por variavel de ambiente,
# nunca em argv. Imprime o codigo HTTP (000 sem resposta); o corpo da resposta fica em $WORK_DIR/recorder-response.
recorder_request() {
    local method="$1" path="${2:-}" body="${3:-}" secret ts sig url code
    secret=$(jibri_secret WEBINAR_RECORDER_WEBHOOK_SECRET)
    url="$(jibri_secret_opt WEBINAR_RECORDER_WEBHOOK_URL "$RECORDER_WEBHOOK_URL")"; url="${url%/}$path"
    ts=$(date -u +%s)
    sig=$(RECORDER_SECRET="$secret" python3 -I -c 'import hashlib, hmac, os, sys; print(hmac.new(os.environ["RECORDER_SECRET"].encode(), (sys.argv[1] + "." + sys.argv[2]).encode(), hashlib.sha256).hexdigest())' "$ts" "$body")
    : > "$WORK_DIR/recorder-response"
    if [ -n "$body" ]; then
        code=$(curl -sS -o "$WORK_DIR/recorder-response" -w '%{http_code}' --max-time 30 -X "$method" "$url" -H "Content-Type: application/json" -H "X-Bunker-Timestamp: $ts" -H "X-Bunker-Signature: $sig" --data-binary "$body" 2>/dev/null) || code=000
    else
        code=$(curl -sS -o "$WORK_DIR/recorder-response" -w '%{http_code}' --max-time 30 -X "$method" "$url" -H "X-Bunker-Timestamp: $ts" -H "X-Bunker-Signature: $sig" 2>/dev/null) || code=000
    fi
    printf '%s' "${code:-000}"
}
# hourly_price TIPO LOCAL: preco liquido por hora (EUR) do tipo naquele local, pela API; vazio se nao houver.
hourly_price() {
    hzj server-type describe "$1" 2>/dev/null | jq -r --arg l "$2" '.prices[]? | select(.location==$l) | (.price_hourly.net // .price_hourly.gross // empty)' 2>/dev/null | head -n1
}
monthly_price() {
    hzj server-type describe "$1" 2>/dev/null | jq -r --arg l "$2" '.prices[]? | select(.location==$l) | (.price_monthly.net // .price_monthly.gross // empty)' 2>/dev/null | head -n1
}

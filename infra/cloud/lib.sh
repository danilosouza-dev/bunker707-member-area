#!/usr/bin/env bash
# Funcoes comuns de infra/cloud (provisionamento e operacao dos servidores da Hetzner a partir do GitHub
# Actions ou de qualquer maquina com os tokens). Carregue com: . "$(dirname "$0")/lib.sh"
#
# Variaveis de ambiente:
#   HCLOUD_TOKEN           token da API da Hetzner Cloud (leitura e escrita)           obrigatorio
#   CLOUDFLARE_API_TOKEN   token da API da Cloudflare (DNS e configuracoes da zona)      provision/status
#   ZONE_NAME              zona na Cloudflare (bunker707.com.br)
#   LOCATION               datacenter preferido (fsn1); FALLBACK_LOCATIONS tenta os outros
#   PRODUCER_EMAIL         e-mail do produtor (Let's Encrypt, admin do Mautic)
#   PRODUCER_IP            opcional: IP do produtor, mantido no firewall (SSH e Studio)
#   SKIP_MARKETING=1       Mautic no mesmo servidor do app (colocacao), sem o segundo servidor
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
SSH_KEY_NAME="${SSH_KEY_NAME:-bunker707-deploy}"

APP_DOMAIN="${APP_DOMAIN:-membros.$ZONE_NAME}"
API_DOMAIN="${API_DOMAIN:-api.$ZONE_NAME}"
STUDIO_DOMAIN="${STUDIO_DOMAIN:-studio.$ZONE_NAME}"
MAUTIC_DOMAIN="${MAUTIC_DOMAIN:-marketing.$ZONE_NAME}"

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
server_ip4() { hz server ip "$1"; }
server_ip6() {
    # A Hetzner entrega um /64; o servidor responde em ::1 dele.
    local prefix; prefix=$(hzj server describe "$1" | jq -r '.public_net.ipv6.ip // empty')
    [ -n "$prefix" ] || return 0
    printf '%s1' "${prefix%%/*}"
}

# ---- firewall da Hetzner ----------------------------------------------------------------------------
# fw_rules [cidr ...]: regras JSON = 80/443 so da Cloudflare, ICMP, e 22 so dos CIDRs informados (nenhum = sem SSH).
fw_rules() {
    local cf_json; cf_json=$(bash "$REPO_ROOT/infra/scripts/cloudflare-ips.sh" --json)
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
fw_name() { printf '%s-fw' "$1"; }
fw_ensure() {  # fw_ensure SERVER_NAME
    local name; name=$(fw_name "$1")
    if ! hz firewall describe "$name" >/dev/null 2>&1; then
        log "Criando o firewall $name"
        hz firewall create --name "$name" --label app=bunker707 >/dev/null
    fi
    fw_rules "$(cidr_or_empty "$PRODUCER_IP")" > "$WORK_DIR/rules-$name.json"
    hz firewall replace-rules "$name" --rules-file "$WORK_DIR/rules-$name.json"
}
fw_apply() {  # fw_apply SERVER_NAME (idempotente)
    local name; name=$(fw_name "$1")
    if hzj firewall describe "$name" | jq -e --arg s "$1" '.applied_to[]? | select(.type=="server" and .server.name==$s)' >/dev/null; then return 0; fi
    hz firewall apply-to-resource "$name" --type server --server "$1"
}
cidr_or_empty() { case "${1:-}" in "") ;; */*) printf '%s' "$1" ;; *:*) printf '%s/128' "$1" ;; *) printf '%s/32' "$1" ;; esac; }
runner_ip() { curl -fsS --max-time 15 https://checkip.amazonaws.com | tr -d '[:space:]'; }
# Abre a porta 22 para esta maquina (e o produtor, se PRODUCER_IP) e fecha de novo ao sair do script.
fw_open_ssh() {  # fw_open_ssh SERVER_NAME
    local name me; name=$(fw_name "$1"); me=$(runner_ip)
    log "Abrindo SSH do $1 para $me"
    fw_rules "$(cidr_or_empty "$me")" "$(cidr_or_empty "$PRODUCER_IP")" > "$WORK_DIR/rules-open-$name.json"
    hz firewall replace-rules "$name" --rules-file "$WORK_DIR/rules-open-$name.json"
    FW_OPENED="${FW_OPENED:-} $1"
    trap 'fw_close_all' EXIT
}
fw_close_all() {
    local s name
    for s in ${FW_OPENED:-}; do
        name=$(fw_name "$s")
        fw_rules "$(cidr_or_empty "$PRODUCER_IP")" > "$WORK_DIR/rules-close-$name.json"
        hz firewall replace-rules "$name" --rules-file "$WORK_DIR/rules-close-$name.json" && printf 'SSH do %s fechado.\n' "$s" || warn "nao consegui fechar o SSH do $s; rode a etapa status."
    done
    FW_OPENED=""
}

# ---- SSH --------------------------------------------------------------------------------------------
deploy_key() {
    [ -f "$KEY_PATH" ] && return 0
    command -v node >/dev/null 2>&1 || die "Preciso do Node para derivar a chave de deploy (infra/cloud/deploy-key.mjs)."
    node "$CLOUD_DIR/deploy-key.mjs" --out "$KEY_PATH" >/dev/null
}
deploy_public_key() { deploy_key; cat "$KEY_PATH.pub"; }
SSH_OPTS=(-i "$KEY_PATH" -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$KNOWN_HOSTS" -o ConnectTimeout=20 -o BatchMode=yes -o ServerAliveInterval=30 -o LogLevel=ERROR)
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
sync_repo() {  # sync_repo user@host
    local target="$1"
    git -C "$REPO_ROOT" archive --format=tar HEAD | rsh "$target" "mkdir -p '$REMOTE_DIR' && tar -x -C '$REMOTE_DIR'"
    rsh "$target" "cd '$REMOTE_DIR' && git rev-parse HEAD >/dev/null 2>&1 || true; echo '$(git -C "$REPO_ROOT" rev-parse HEAD)' > '$REMOTE_DIR/.deployed-commit'"
}
# set_env user@host ARQUIVO CHAVE VALOR: grava CHAVE=VALOR no .env remoto (troca a linha ou acrescenta).
set_env() {
    local target="$1" file="$2" key="$3" value="$4"
    printf '%s' "$value" | rsh "$target" "python3 -I - '$file' '$key'" <<'PY'
import sys, re, os
path, key = sys.argv[1], sys.argv[2]
value = sys.stdin.read()
lines = open(path, encoding="utf-8").read().split("\n") if os.path.exists(path) else []
pattern = re.compile(r"^%s=" % re.escape(key))
done = False
for i, line in enumerate(lines):
    if pattern.match(line):
        lines[i] = f"{key}={value}"; done = True; break
if not done:
    if lines and lines[-1] != "": lines.append("")
    lines.append(f"{key}={value}")
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh: fh.write("\n".join(lines).rstrip("\n") + "\n")
os.chmod(tmp, 0o600); os.replace(tmp, path)
PY
}
get_env() { rsh "$1" "grep -E '^$3=' '$2' | head -n1 | cut -d= -f2-"; }

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

# ---- Storage Box ------------------------------------------------------------------------------------
storage_box_json() { hzj storage-box describe "$STORAGE_BOX_NAME" 2>/dev/null || true; }

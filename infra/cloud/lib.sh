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
#   LICENCAS_*             o servidor do Emissor de licencas (bunker707-licencas, docs/32 D39; docs/20 §8C): nomes,
#                          imagem e minimos abaixo; LICENCAS_TYPE e LICENCAS_LOCATION forcam o tipo e o local; o Painel e
#                          a conta de envio do Emissor (LICENCAS_PAINEL_*, LICENCAS_EMISSOR_*, LICENCAS_SEM_PAINEL)
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
# O tipo pedido nas opcoes, antes do padrao: o restaurar usa o do snapshot quando ninguem pede outro.
MEET_TYPE_FORCED="${MEET_TYPE:-}"
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

# Emissor de licencas (docs/32 D39 e §11.2; docs/20 §8C): servidor so dele, o tipo e o local mais baratos que servem.
LICENCAS_NAME="${LICENCAS_NAME:-bunker707-licencas}"
# O Painel de licencas (so a equipe: proxy da Cloudflare e o login de e-mail e senha do proprio Painel, de qualquer
# internet, sem lista de IPs e sem o Cloudflare Access; docs/32 D40) e a API publica das Instalacoes (registro A sem
# proxy da Cloudflare: nenhum desafio de robos e so IPv4, que a conferencia inicial pede).
# O nome da API vai gravado no produto vendido: trocar depois pede versao nova para todos os compradores.
LICENCAS_PAINEL_DOMAIN="${LICENCAS_PAINEL_DOMAIN:-licencas.$ZONE_NAME}"
LICENCAS_API_DOMAIN="${LICENCAS_API_DOMAIN:-licencas-api.$ZONE_NAME}"
# A API interna do Emissor, so para a nossa escola (docs/api-interna.md do bunker-licensing; docs/20 §8C.9): um endereco
# proprio, registro A sem proxy da Cloudflare (o Caddy do Emissor so aceita o IPv4 do servidor da escola, e o IP que ele
# confere tem de ser o da conexao), que o conectar-licencas grava no .env da escola (EMISSOR_INTERNO_URL).
LICENCAS_INTERNO_DOMAIN="${LICENCAS_INTERNO_DOMAIN:-licencas-interno.$ZONE_NAME}"
# Imagem do Emissor publicada pelo CI do bunker-licensing no GHCR; a tag <tag>-implantacao traz o compose.yaml e o
# .env.example do mesmo commit (docs/20 §8C.2).
LICENCAS_IMAGEM="${LICENCAS_IMAGEM:-ghcr.io/danilosouza-dev/bunker-licensing}"
LICENCAS_TAG="${LICENCAS_TAG:-main}"
# No servidor: o compose do Emissor, o .env dele e segredos/ ficam em REMOTE_DIR/emissor, fora do que o sync_repo troca.
LICENCAS_EMISSOR_DIR="${LICENCAS_EMISSOR_DIR:-$REMOTE_DIR/emissor}"
# O Painel de licencas e a conta de envio do Emissor (docs/20 §8C.5): o deploy-licencas escreve no .env do compose do
# Emissor, a cada rodada, cada LICENCAS_<NOME> como <NOME> (variaveis do repositorio no GitHub ou opcoes, todas com
# padrao): o teto diario, quem recebe os avisos (e e a conta do produtor no Painel) e quem envia (um endereco do dominio
# de envio ja verificado no Resend), as chaves anteriores da readocao e os links do Renovar e da loja. O endereco do
# Painel e https://LICENCAS_PAINEL_DOMAIN. LICENCAS_SEM_PAINEL=sim sobe o Emissor sem o Painel e sem e-mail.
LICENCAS_EMISSOR_EMAIL_PRODUTOR="${LICENCAS_EMISSOR_EMAIL_PRODUTOR:-$PRODUCER_EMAIL}"
LICENCAS_EMISSOR_EMAIL_REMETENTE="${LICENCAS_EMISSOR_EMAIL_REMETENTE:-Bunker Members <licencas@mail.$ZONE_NAME>}"
LICENCAS_PAINEL_TETO_DIARIO="${LICENCAS_PAINEL_TETO_DIARIO:-10}"
# Backup de hora em hora no Storage Box que ja existe, num repositorio restic so dele.
LICENCAS_RESTIC_REPOSITORY="${LICENCAS_RESTIC_REPOSITORY:-sftp:storagebox:bunker707/restic-licencas}"
# A pasta das duas raizes, so cifradas, no mesmo Storage Box (cerimonia-licencas, docs/32 D41): fora do servidor do
# Emissor e de qualquer repositorio restic.
LICENCAS_RAIZES_PASTA="${LICENCAS_RAIZES_PASTA:-bunker707/licencas-raizes}"
# As raizes publicas no repositorio (o que a cerimonia imprime, num commit): o EMISSOR_RAIZES do deploy-licencas e o
# BUNKER_LICENSING_ROOTS do produto vendido (.github/workflows/pacote-escola.yml).
LICENCAS_RAIZES_ARQUIVO="${LICENCAS_RAIZES_ARQUIVO:-$REPO_ROOT/infra/licencas/raizes.json}"
# O minimo para Node (Emissor e, depois, o Painel), Postgres 16 e Caddy num servidor so (docs/20 §8C.1).
LICENCAS_MIN_RAM_GB="${LICENCAS_MIN_RAM_GB:-2}"
LICENCAS_MIN_DISK_GB="${LICENCAS_MIN_DISK_GB:-20}"
LICENCAS_MIN_VCPU="${LICENCAS_MIN_VCPU:-1}"
LICENCAS_ARQUITETURAS="${LICENCAS_ARQUITETURAS:-x86 arm}"

# O ensaio de comprador real (docs/32 item 13; docs/20 §9E): um servidor novo e vazio, so para o ensaio e apagado
# depois, que simula o servidor de um comprador; a escola fica num endereco da nossa zona, sem o proxy da Cloudflare.
TESTE_NAME="${TESTE_NAME:-bunker707-teste}"
TESTE_DOMAIN="${TESTE_DOMAIN:-escola-teste.$ZONE_NAME}"
TESTE_API_DOMAIN="${TESTE_API_DOMAIN:-api.$TESTE_DOMAIN}"
# O minimo do kit (infra/kit/kit.conf: 2 vCPU, uns 3,5 GB de memoria visiveis, 40 GB de disco; so x86-64).
TESTE_MIN_RAM_GB="${TESTE_MIN_RAM_GB:-4}"
TESTE_MIN_DISK_GB="${TESTE_MIN_DISK_GB:-40}"
TESTE_MIN_VCPU="${TESTE_MIN_VCPU:-2}"
TESTE_ARQUITETURAS="${TESTE_ARQUITETURAS:-x86}"
# A pasta da instalacao no servidor do ensaio (KIT_PASTA_INSTALACAO do kit.conf, com o nome neutro do kit).
TESTE_PASTA="${TESTE_PASTA:-/opt/membros}"

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
server_status() { hzj server describe "$1" | jq -r '.status // empty'; }
# Desliga pelo sistema (ACPI): o systemd para o Docker, os containers recebem o aviso e o Postgres fecha limpo antes
# da imagem. Sem resposta em ~3 min, corta a energia (o Postgres se recupera pelo WAL, como depois de uma queda).
server_shutdown() {  # server_shutdown NOME
    local i
    [ "$(server_status "$1")" = "off" ] && { echo "  ja estava desligado."; return 0; }
    hz server shutdown "$1" >/dev/null 2>&1 || true
    for ((i = 0; i < ${SHUTDOWN_TRIES:-36}; i++)); do
        [ "$(server_status "$1")" = "off" ] && { echo "  desligado pelo sistema."; return 0; }
        sleep "${SHUTDOWN_SLEEP:-5}"
    done
    warn "$1 nao desligou pelo sistema a tempo; cortando a energia."
    hz server poweroff "$1" >/dev/null 2>&1 || true
    for ((i = 0; i < 24; i++)); do
        [ "$(server_status "$1")" = "off" ] && return 0
        sleep "${SHUTDOWN_SLEEP:-5}"
    done
    die "$1 nao desligou (status $(server_status "$1"))."
}

# ---- papeis que a producao guarda em snapshot (snapshot.sh e restaurar.sh; docs/20 §4A.7) ---------------
# membros (A: app + Supabase), marketing (B: Mautic) e meet (C: Jitsi). PAPEIS nas opcoes escolhe alguns deles
# (ex.: PAPEIS=meet so para um teste de live na dev; varios separados por virgula, PAPEIS=membros,marketing, porque as
# opcoes do workflow sao separadas por espaco). Com SKIP_MARKETING o Mautic mora no A e nao e papel proprio.
# Sai sempre na mesma ordem (membros, marketing, meet), sem repetir.
guard_roles() {
    local all="membros marketing meet" r out="" asked="${PAPEIS:-}"
    [ -n "${SKIP_MARKETING:-}" ] && all="membros meet"
    asked="${asked//,/ }"
    for r in $asked; do
        case " $all " in *" $r "*) ;; *) die "PAPEIS: '$r' nao e um papel desta producao (use: $all, separados por virgula)." ;; esac
    done
    for r in $all; do
        case " ${asked:-$all} " in *" $r "*) out="${out:+$out }$r" ;; esac
    done
    [ -n "$out" ] || die "PAPEIS vazio (use: $all)."
    printf '%s' "$out"
}
role_server() {  # role_server PAPEL -> nome do servidor
    case "$1" in
        membros) printf '%s' "$MEMBROS_NAME" ;;
        marketing) printf '%s' "$MARKETING_NAME" ;;
        meet) printf '%s' "$MEET_NAME" ;;
        *) die "papel invalido: $1" ;;
    esac
}
# latest_snapshot PAPEL -> id do snapshot disponivel mais recente do papel (labels app=bunker707, papel=PAPEL)
latest_snapshot() {
    hzj image list --type snapshot | jq -r --arg r "$1" '[.[] | select(.labels.app=="bunker707" and .labels.papel==$r and .status=="available")] | sort_by(.created) | last | .id // empty'
}
# snapshots_summary: os snapshots guardados, com tamanho e o custo do mes (EUR 0,0143 por GB comprimido, docs/19 §3.2).
snapshots_summary() {
    hzj image list --type snapshot | jq -r '[.[] | select(.labels.app=="bunker707")] | sort_by(.created) | .[] | "  \(.id)  \(.labels.papel // "?")  \(.labels.tipo // "?")  \(.image_size // 0 | . * 100 | round / 100) GB  criado \(.created[:16])"'
    hzj image list --type snapshot | jq -r '[.[] | select(.labels.app=="bunker707") | (.image_size // 0)] | add // 0 | "  total: \(. * 100 | round / 100) GB, cerca de EUR \(. * 0.0143 * 100 | round / 100) por mes"'
}
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
# fw_rules_licencas [cidr ...]: o servidor do Emissor (docs/20 §8C.4). A API publica tem registro A sem proxy da
# Cloudflare (as Instalacoes conferem de qualquer lugar, por IPv4), entao 80 e 443 vem de qualquer lugar: 80 para o
# Let's Encrypt e o redirecionamento, 443 para a API e para o Painel (pela Cloudflare, com o login do proprio Painel).
# Sem HTTP/3 (o Caddy dele fala h1 e h2). 22 so dos CIDRs informados, como nos outros servidores.
fw_rules_licencas() {
    python3 -I - "$@" <<'PY'
import json, sys
ssh = [c for c in sys.argv[1:] if c]
anywhere = ["0.0.0.0/0", "::/0"]
rules = []
if ssh:
    rules.append({"direction": "in", "protocol": "tcp", "port": "22", "source_ips": ssh, "description": "SSH (sessao de deploy / produtor)"})
rules += [
    {"direction": "in", "protocol": "tcp", "port": "80", "source_ips": anywhere, "description": "HTTP (Let's Encrypt e redirecionamento)"},
    {"direction": "in", "protocol": "tcp", "port": "443", "source_ips": anywhere, "description": "HTTPS (API das Instalacoes e o Painel, com o login dele)"},
    {"direction": "in", "protocol": "icmp", "source_ips": anywhere, "description": "ping do monitor"},
]
print(json.dumps(rules))
PY
}
# fw_rules_teste [cidr ...]: o servidor do ensaio de comprador (docs/20 §9E), como o de um comprador na Hetzner: 80 e 443
# (TCP e, para o HTTP/3 do Caddy do kit, UDP) de qualquer lugar, ping, e a 22 so para o CIDR da etapa (o preparo do kit
# abre a 22 no ufw do servidor; o firewall da Hetzner a deixa fechada fora das etapas).
fw_rules_teste() {
    python3 -I - "$@" <<'PY'
import json, sys
ssh = [c for c in sys.argv[1:] if c]
anywhere = ["0.0.0.0/0", "::/0"]
rules = []
if ssh:
    rules.append({"direction": "in", "protocol": "tcp", "port": "22", "source_ips": ssh, "description": "SSH (sessao de deploy / produtor)"})
rules += [
    {"direction": "in", "protocol": "tcp", "port": "80", "source_ips": anywhere, "description": "HTTP (Let's Encrypt e redirecionamento)"},
    {"direction": "in", "protocol": "tcp", "port": "443", "source_ips": anywhere, "description": "HTTPS (a escola do ensaio e a API dela)"},
    {"direction": "in", "protocol": "udp", "port": "443", "source_ips": anywhere, "description": "HTTP/3"},
    {"direction": "in", "protocol": "icmp", "source_ips": anywhere, "description": "ping"},
]
print(json.dumps(rules))
PY
}
# fw_rules_for SERVER_NAME [cidr ...]: o conjunto de regras de cada papel, pelo nome do servidor.
fw_rules_for() {
    local name="$1"; shift
    case "$name" in
        "$MEET_NAME") fw_rules_meet "$@" ;;
        "$LICENCAS_NAME") fw_rules_licencas "$@" ;;
        "$TESTE_NAME") fw_rules_teste "$@" ;;
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
# Um script que define on_failure (jibri.sh up: apagar o gravador criado que nao ficou pronto) tem a funcao chamada no
# mesmo trap, depois de fechar a 22, quando a saida e com erro.
fw_open_ssh() {  # fw_open_ssh SERVER_NAME
    local name me; name=$(fw_name "$1"); me=$(runner_ip)
    log "Abrindo SSH do $1 para $me"
    fw_rules_for "$1" "$(cidr_or_empty "$me")" "$(cidr_or_empty "$PRODUCER_IP")" > "$WORK_DIR/rules-open-$name.json"
    FW_OPENED="${FW_OPENED:-} $1"
    printf '%s\n' "$1" >> "$WORK_DIR/fw-abertos"
    trap 'rc=$?; set +e; fw_close_all || rc=1; if [ "$rc" != 0 ] && declare -F on_failure >/dev/null; then on_failure; fi; exit $rc' EXIT
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
# ensure_project_ssh_key: a chave de deploy (derivada do token) cadastrada no projeto da Hetzner (SSH_KEY_NAME), que todo
# servidor nosso recebe ao nascer, no root; define pub (a chave publica). Para se o projeto tem outra com o mesmo nome.
ensure_project_ssh_key() {
    pub=$(deploy_public_key)
    if hzj ssh-key describe "$SSH_KEY_NAME" >/dev/null 2>&1; then
        if [ "$(hzj ssh-key describe "$SSH_KEY_NAME" | jq -r .public_key | awk '{print $2}')" != "$(printf '%s' "$pub" | awk '{print $2}')" ]; then
            die "A chave '$SSH_KEY_NAME' na Hetzner e diferente da derivada do HCLOUD_TOKEN atual (o token mudou?). Veja docs/20, 'Sessao na nuvem', antes de continuar."
        fi
        echo "  ja existe e confere."
    else
        hz ssh-key create --name "$SSH_KEY_NAME" --public-key "$pub" --label app=bunker707 >/dev/null
        echo "  criada."
    fi
}
# Envia o repositorio (o commit atual) para REMOTE_DIR, sem tocar em .env, volumes e dados.
# As migracoes sao trocadas inteiras: uma renomeada ou removida no repositorio nao pode sobrar no servidor
# para o migrate.sh aplicar. Com caminhos, envia so eles (o servidor de licencas recebe so a infra dele, nunca o
# codigo do produto).
sync_repo() {  # sync_repo user@host [caminho ...]
    local target="$1"; shift
    git -C "$REPO_ROOT" archive --format=tar HEAD -- "$@" | rsh "$target" "mkdir -p '$REMOTE_DIR' && rm -rf '$REMOTE_DIR/supabase/migrations' && tar -x -C '$REMOTE_DIR'"
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
# env_aplicar_kv user@host ENV KV: as linhas CHAVE=VALOR do arquivo KV (no servidor, 0600, que chegou pelo stdin do SSH ou
# saiu do envelope) no .env ENV do servidor: troca a linha ou acrescenta, grava 0600 de uma vez (dono: quem roda, o
# deploy) e apaga o KV em qualquer desfecho. O valor com aspas, barra invertida, $ ou quebra de linha e recusado antes de
# gravar. E assim que o secrets-* e o conectar-licencas gravam segredo no .env de um servidor.
env_aplicar_kv() {
    rsh "$1" "python3 -I - '$2' '$3'" <<'PY'
import atexit, os, re, sys
path, kvpath = sys.argv[1], sys.argv[2]
os.umask(0o077)
# O texto claro sai do disco em qualquer desfecho (valor recusado, .env ilegivel).
atexit.register(lambda: os.path.exists(kvpath) and os.remove(kvpath))
updates = {}
for line in open(kvpath, encoding="utf-8"):
    line = line.rstrip("\n")
    if "=" in line and re.match(r"^[A-Z0-9_]+=", line):
        k, v = line.split("=", 1); updates[k] = v
# O compose interpola os valores dentro de JSON (MAUTIC_CONFIG_PARAMETERS) e sem aspas: aspas, barra
# invertida, $ e quebra de linha quebrariam o stack. Senha SMTP com esses caracteres vai codificada na URL.
bad = [k for k, v in updates.items() if re.search(r'["\\$\n\r]', v)]
if bad:
    sys.exit("ERRO: valor com aspas, barra invertida, $ ou quebra de linha em " + ", ".join(bad) + "; codifique na URL (senha SMTP: urlencode) e gere o envelope de novo.")
lines = open(path, encoding="utf-8").read().split("\n")
seen = set()
for i, line in enumerate(lines):
    m = re.match(r"^([A-Z0-9_]+)=", line)
    if m and m.group(1) in updates:
        lines[i] = f"{m.group(1)}={updates[m.group(1)]}"; seen.add(m.group(1))
while lines and lines[-1] == "":
    lines.pop()
for k, v in updates.items():
    if k not in seen:
        lines.append(f"{k}={v}")
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh: fh.write("\n".join(lines).rstrip("\n") + "\n")
os.chmod(tmp, 0o600); os.replace(tmp, path)
PY
}
# membros_recria user@host: o stack da escola (o servidor A) com o .env novo: o compose recria so o que mudou (o app), o
# Auth e o app saudaveis antes do smoke (sem a espera, o primeiro /api/health pega o app ainda subindo e da 502).
membros_recria() {
    rsh "$1" "cd '$REMOTE_DIR' && docker compose -f infra/compose/docker-compose.yml up -d && bash -c '. infra/scripts/lib.sh; for s in auth app; do wait_healthy \$s 180; done' && bash infra/scripts/smoke.sh"
}

# remote_auth_curl ENV_FILE: comando (para rodar NO servidor) que chama a API administrativa do Auth com a
# chave secreta do .env. A chave nunca sai do servidor nem entra em argv (ps, /proc): o shell remoto le do
# .env e entrega os cabecalhos ao curl por um config no stdin (-K -). Use como prefixo: "$cmd 'URL' ...".
remote_auth_curl() {
    printf '%s' "k=\$(grep -E '^SUPABASE_SECRET_KEY=' '$1' | head -n1 | cut -d= -f2-) && [ -n \"\$k\" ] && printf 'header = \"apikey: %s\"\\nheader = \"Authorization: Bearer %s\"\\n' \"\$k\" \"\$k\" | curl -fsS -K -"
}

# Senha de recuperacao dos backups: derivada do HCLOUD_TOKEN e cadastrada como segunda chave do repositorio
# restic do papel. Sem o .env do servidor (servidor perdido), quem tem o token abre o backup (docs/20 §10.2).
# A senha vai pelo stdin do SSH para um arquivo temporario 0600 no servidor, apagado em seguida.
backup_recovery_key() {  # backup_recovery_key user@host membros|marketing|licencas
    local target="$1" script f="$WORK_DIR/restic-recovery"
    case "$2" in
        membros) script=infra/scripts/backup.sh ;;
        marketing) script=infra/mautic/scripts/backup.sh ;;
        licencas) script=infra/licencas/scripts/backup.sh ;;
        *) die "papel invalido: $2" ;;
    esac
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

# cf_apply_dns: os quatro nomes (membros, api, studio -> servidor A; marketing -> B, ou A com SKIP_MARKETING)
# apontando para os IPs atuais, proxied; SSL Full (strict); "Always Use HTTPS" desligado (o Let's Encrypt valida
# por HTTP atraves da Cloudflare; um redirecionamento na borda faria a validacao bater num origin sem certificado).
# O restaurar chama as partes de cada papel que voltou.
cf_apply_dns() {
    cf_apply_dns_membros
    cf_apply_dns_marketing
    cf_zone_tls
}
cf_apply_dns_membros() {
    local m4 m6 sub subs
    m4=$(server_ip4 "$MEMBROS_NAME"); m6=$(server_ip6 "$MEMBROS_NAME")
    subs="${APP_DOMAIN%%.*} ${API_DOMAIN%%.*} ${STUDIO_DOMAIN%%.*}"
    [ -n "${SKIP_MARKETING:-}" ] && subs="$subs ${MAUTIC_DOMAIN%%.*}"
    for sub in $subs; do
        cf_dns_upsert "$sub" A "$m4" true
        [ -n "$m6" ] && cf_dns_upsert "$sub" AAAA "$m6" true
    done
    return 0
}
cf_apply_dns_marketing() {
    local k4 k6
    [ -z "${SKIP_MARKETING:-}" ] || return 0  # o Mautic mora no A: o nome vai com o membros
    if ! server_exists "$MARKETING_NAME"; then
        echo "  ${MAUTIC_DOMAIN}: $MARKETING_NAME nao existe (guardado?); sem registro."
        return 0
    fi
    k4=$(server_ip4 "$MARKETING_NAME"); k6=$(server_ip6 "$MARKETING_NAME")
    cf_dns_upsert "${MAUTIC_DOMAIN%%.*}" A "$k4" true
    [ -n "$k6" ] && cf_dns_upsert "${MAUTIC_DOMAIN%%.*}" AAAA "$k6" true
    return 0
}
cf_zone_tls() {
    cf_zone_setting ssl strict
    cf_zone_setting always_use_https off
}
# cf_remove_dns [PAPEL ...]: apaga os registros A/AAAA dos nomes de cada papel guardado em snapshot (padrao: os tres).
# membros: membros, api e studio (e marketing com SKIP_MARKETING); marketing: marketing; meet: meet.
cf_remove_dns() {
    local zone sub fqdn ids id r subs=""
    for r in ${*:-membros marketing meet}; do
        case "$r" in
            membros) subs="$subs ${APP_DOMAIN%%.*} ${API_DOMAIN%%.*} ${STUDIO_DOMAIN%%.*}"; [ -n "${SKIP_MARKETING:-}" ] && subs="$subs ${MAUTIC_DOMAIN%%.*}" ;;
            marketing) subs="$subs ${MAUTIC_DOMAIN%%.*}" ;;
            meet) subs="$subs ${MEET_DOMAIN%%.*}" ;;
            *) die "cf_remove_dns: papel invalido: $r" ;;
        esac
    done
    zone=$(cf_zone_id)
    for sub in $subs; do
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

# cf_dns_delete NOME TIPO: apaga os registros do tipo para NOME.ZONE_NAME (nenhum = nada a fazer).
cf_dns_delete() {
    local zone fqdn ids id; zone=$(cf_zone_id); fqdn="$1.$ZONE_NAME"
    ids=$(cf_api GET "/zones/$zone/dns_records?type=$2&name=$fqdn" | jq -r '.result[].id')
    for id in $ids; do cf_api DELETE "/zones/$zone/dns_records/$id" >/dev/null; done
    [ -z "$ids" ] || printf '  %-10s %-6s apagado(s): %s\n' "$fqdn" "$2" "$(printf '%s\n' "$ids" | grep -c .)"
}

# ---- Emissor de licencas (bunker707-licencas; docs/32 D39; docs/20 §8C) ------------------------------
# zona_sub DOMINIO: o nome dentro da zona (api.escola-teste.bunker707.com.br -> api.escola-teste); fora da zona, para.
zona_sub() {
    case "$1" in
        *."$ZONE_NAME") printf '%s' "${1%."$ZONE_NAME"}" ;;
        *) die "$1 nao esta na zona $ZONE_NAME." ;;
    esac
}
# licencas_sub DOMINIO: o nome dentro da zona (licencas-api.bunker707.com.br -> licencas-api); fora da zona, para.
licencas_sub() {
    case "$1" in
        *."$ZONE_NAME") printf '%s' "${1%."$ZONE_NAME"}" ;;
        *) die "$1 nao esta na zona $ZONE_NAME (LICENCAS_PAINEL_DOMAIN, LICENCAS_API_DOMAIN e LICENCAS_INTERNO_DOMAIN ficam nela)." ;;
    esac
}
# cf_apply_dns_licencas: so registros A, nunca AAAA (docs/32 §11.2). O Painel com o proxy da Cloudflare (a protecao dela
# na frente do login do Painel, D40); a API sem proxy: nenhum desafio de robos barra a conferencia feita por servidor, e
# o nome so resolve para IPv4, o unico em que a conferencia inicial bate de volta. A API interna tambem sem proxy: o Caddy
# do Emissor so deixa entrar o IPv4 do servidor da nossa escola, e confere o IP da propria conexao (com o proxy, seria o
# da Cloudflare). AAAA que exista nos tres nomes e apagado.
cf_apply_dns_licencas() {
    local ip4 painel api interno; ip4=$(server_ip4 "$LICENCAS_NAME")
    painel=$(licencas_sub "$LICENCAS_PAINEL_DOMAIN"); api=$(licencas_sub "$LICENCAS_API_DOMAIN"); interno=$(licencas_sub "$LICENCAS_INTERNO_DOMAIN")
    cf_dns_upsert "$painel" A "$ip4" true
    cf_dns_upsert "$api" A "$ip4" false
    cf_dns_upsert "$interno" A "$ip4" false
    cf_dns_delete "$painel" AAAA
    cf_dns_delete "$api" AAAA
    cf_dns_delete "$interno" AAAA
}
# licencas_dns_confere: o DNS dos tres nomes como o cf_apply_dns_licencas deixa, apontando para o servidor de agora.
# O deploy so sobe o Caddy com isso certo: antes, o Let's Encrypt falharia e o Caddy esperaria horas para tentar de novo.
licencas_dns_confere() {
    local ip4 zone pair fqdn want got problems=""; ip4=$(server_ip4 "$LICENCAS_NAME"); zone=$(cf_zone_id)
    for pair in "$LICENCAS_PAINEL_DOMAIN:true" "$LICENCAS_API_DOMAIN:false" "$LICENCAS_INTERNO_DOMAIN:false"; do
        fqdn="${pair%:*}"; want="A $ip4 proxy=${pair##*:}"
        got=$(cf_api GET "/zones/$zone/dns_records?name=$fqdn" | jq -r '[.result[] | select(.type=="A" or .type=="AAAA") | "\(.type) \(.content) proxy=\(.proxied)"] | join(", ")')
        [ "$got" = "$want" ] || problems="$problems $fqdn (esperado: $want; achado: ${got:-nada})"
    done
    [ -z "$problems" ] || die "DNS do Emissor fora do lugar:$problems. Rode dns-licencas antes do deploy-licencas."
}
# licencas_interno_ips: quem o Caddy do Emissor deixa chegar na API interna (LICENCAS_INTERNO_IPS): o IPv4 do servidor da
# nossa escola (MEMBROS_NAME), lido da API da Hetzner como as outras etapas leem. Sem o servidor (a producao guardada em
# snapshot), 127.0.0.1/32, ninguem de fora: o IP de antes pode ser de outro cliente da Hetzner, e o restaurar traz IP
# novo. O conectar-licencas abre de novo para o IP de agora.
licencas_interno_ips() {
    if server_exists "$MEMBROS_NAME"; then printf '%s/32' "$(server_ip4 "$MEMBROS_NAME")"; else printf '127.0.0.1/32'; fi
}
# Toda etapa que muda o servidor de licencas so roda da main (a do workflow ja barra; esta e a segunda trava, para o
# script chamado de outro lugar no Actions). Fora do Actions (terminal com os tokens), nao ha branch a conferir.
licencas_so_da_main() {
    [ -z "${GITHUB_ACTIONS:-}" ] || [ "${GITHUB_REF:-}" = "refs/heads/main" ] \
        || die "As etapas que mudam o servidor de licencas so rodam da main (recebido: ${GITHUB_REF:-sem branch}). Fluxo: tarefa -> dev -> main -> servidor."
}

# licencas_raizes_json: as raizes PUBLICAS (rid e chave publica), numa linha de JSON. Vem de infra/licencas/raizes.json,
# que a cerimonia-licencas imprime e vai num commit (docs/32 D41); sem o arquivo, do segredo LICENCAS_RAIZES de antes da
# cerimonia automatica. O arquivo vale por cima do segredo: e com ele que o produto vendido e gerado. Sem nenhum, nada.
licencas_raizes_json() {
    python3 -I - "$LICENCAS_RAIZES_ARQUIVO" "${LICENCAS_RAIZES:-}" <<'PY'
import json, os, re, sys
arquivo, segredo = sys.argv[1], sys.argv[2]
def raizes(texto, origem):
    try:
        lista = json.loads(texto)
    except ValueError:
        sys.exit(f'ERRO: {origem} nao e JSON: [{{"rid":"...","publicKey":"..."}}].')
    if not (isinstance(lista, list) and 1 <= len(lista) <= 4 and all(
            isinstance(r, dict) and set(r) == {"rid", "publicKey"} and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", str(r["rid"]))
            and re.fullmatch(r"[A-Za-z0-9_-]{43}", str(r["publicKey"])) for r in lista)) or len({r["rid"] for r in lista}) != len(lista):
        sys.exit(f"ERRO: {origem} precisa ser a lista de 1 a 4 raizes publicas da cerimonia, so com rid e publicKey.")
    return json.dumps(lista, separators=(",", ":"))
if os.path.exists(arquivo):
    valor = raizes(open(arquivo, encoding="utf-8").read(), "infra/licencas/raizes.json")
    if segredo.strip() and raizes(segredo, "LICENCAS_RAIZES") != valor:
        print("AVISO: o segredo LICENCAS_RAIZES e diferente de infra/licencas/raizes.json; vale o arquivo (apague o segredo no GitHub).", file=sys.stderr)
    print(valor)
elif segredo.strip():
    print(raizes(segredo, "LICENCAS_RAIZES"))
PY
}

# ---- o plano mais barato (plan-licencas e teste-plano) -----------------------------------------------
# plano_barato ROTULO PREFIXO PARA MIN_RAM MIN_DISK MIN_CPU ARQUITETURAS LOCAIS TIPO LOCAL: le $WORK_DIR/server-types.json
# (hcloud server-type list), mostra os tipos que servem com o preco por mes em cada local que a API informa e escolhe o
# mais barato com estoque (empate: LOCATION, depois FALLBACK_LOCATIONS, depois os outros; x86 antes). Grava
# $WORK_DIR/plan-ROTULO.env com PREFIXO_TYPE, PREFIXO_LOCATION, PREFIXO_PRICE e PREFIXO_FALLBACK_LOCATIONS (o mesmo tipo
# pelo mesmo preco noutros locais, para quando faltar estoque na hora de criar). Nao cria nada.
plano_barato() {
    python3 -I - "$WORK_DIR/server-types.json" "$WORK_DIR/plan-$1.env" "$LOCATION" "$FALLBACK_LOCATIONS" "$4" "$5" "$6" "$7" \
        "$8" "$9" "${10}" "$1" "$2" "$3" <<'PY'
import json, os, sys
types = json.load(open(sys.argv[1]))
out_env, preferred, fallbacks = sys.argv[2], sys.argv[3], sys.argv[4].split()
min_ram, min_disk, min_cpu = float(sys.argv[5]), float(sys.argv[6]), float(sys.argv[7])
archs = sys.argv[8].replace(",", " ").split()
only = sys.argv[9].replace(",", " ").split()
forced_type, forced_loc = sys.argv[10], sys.argv[11]
rotulo, prefixo, para = sys.argv[12], sys.argv[13], sys.argv[14]
# Empate de preco: o local preferido e as reservas de sempre primeiro, depois os outros em ordem alfabetica; x86 antes.
order = [preferred] + [l for l in fallbacks if l != preferred]
def rank(loc):
    return (order.index(loc) if loc in order else len(order), loc)

def monthly(price, key="price_monthly"):
    m = price.get(key) or {}
    try:
        return float(m.get("net") or m.get("gross"))
    except (TypeError, ValueError):
        return None

def available(t, loc):
    # server_types[].locations[] = {name, available, deprecation}; sem o campo, desconhecido (a criacao tenta e a API
    # recusa o que nao tem estoque).
    for entry in t.get("locations") or []:
        if isinstance(entry, dict) and entry.get("name") == loc:
            if entry.get("deprecation"):
                return False
            return entry.get("available") if isinstance(entry.get("available"), bool) else None
    return None

rows, below = [], set()
for t in types:
    if t.get("deprecated"):
        continue
    arch = t.get("architecture") or "x86"
    if arch not in archs or (t.get("memory") or 0) < min_ram or (t.get("disk") or 0) < min_disk or (t.get("cores") or 0) < min_cpu:
        below.add(t["name"])
        continue
    if forced_type and t["name"] != forced_type:
        continue
    for p in t.get("prices") or []:
        loc = p.get("location")
        if (only and loc not in only) or (forced_loc and loc != forced_loc):
            continue
        price = monthly(p)
        if price is None:
            continue
        rows.append({"name": t["name"], "loc": loc, "cores": t.get("cores"), "mem": t.get("memory"), "disk": t.get("disk"),
                     "cpu": t.get("cpu_type"), "arch": arch, "price": price, "hourly": monthly(p, "price_hourly"), "avail": available(t, loc)})

rows.sort(key=lambda r: (r["price"], rank(r["loc"]), r["arch"] != "x86", r["name"]))
print(f"Tipos que servem para {para} (minimo {min_ram:g} GB de memoria, {min_disk:g} GB de disco e {min_cpu:g} vCPU; {' ou '.join(archs)}), do mais barato:")
print(f"{'tipo':8} {'local':6} {'vcpu':>4} {'ram':>5} {'disco':>6} {'cpu':10} {'arq':4} {'EUR/mes':>8} disponivel")
for r in rows:
    avail = "?" if r["avail"] is None else ("sim" if r["avail"] else "nao")
    print(f"{r['name']:8} {r['loc']:6} {r['cores']!s:>4} {r['mem']!s:>5} {r['disk']!s:>6} {str(r['cpu']):10} {r['arch']:4} {r['price']:>8.2f} {avail}")
if below:
    print("Fora (abaixo do minimo ou de outra arquitetura): " + ", ".join(sorted(below)))
cands = [r for r in rows if r["avail"] is not False]
if not cands:
    print(f"\nNenhum tipo disponivel serve para {para}" + (f" (forcado: {forced_type})" if forced_type else "") + (f" em {forced_loc}" if forced_loc else "") + ". Nada foi criado.")
    sys.exit(1)
best = cands[0]
fallback = [r["loc"] for r in cands[1:] if r["name"] == best["name"] and abs(r["price"] - best["price"]) < 0.005]
print(f"\n{rotulo}: {best['name']} em {best['loc']} ({best['cores']} vCPU {best['arch']}, {best['mem']} GB, {best['disk']} GB disco) por EUR {best['price']:.2f}/mes sem IVA, mais o IPv4")
if fallback:
    print("Sem estoque na hora de criar, o mesmo tipo pelo mesmo preco em: " + " ".join(fallback))
if best["hourly"] is not None:
    print(f"Por hora: EUR {best['hourly']:.4f} sem IVA (a Hetzner cobra por hora, ate o teto do mes, enquanto o servidor existir).")
with open(out_env, "w") as fh:
    fh.write(f"{prefixo}_TYPE={best['name']}\n{prefixo}_LOCATION={best['loc']}\n{prefixo}_PRICE={best['price']:.2f}\n{prefixo}_FALLBACK_LOCATIONS=\"{' '.join(fallback)}\"\n")
gh = os.environ.get("GITHUB_OUTPUT")
if gh:
    with open(gh, "a") as fh:
        fh.write(f"{rotulo}_type={best['name']}\n{rotulo}_location={best['loc']}\n{rotulo}_price={best['price']:.2f}\n")
PY
}

# ---- Storage Box ------------------------------------------------------------------------------------
storage_box_json() { hzj storage-box describe "$STORAGE_BOX_NAME" 2>/dev/null || true; }
# box_alvo: o usuario e o host do Storage Box (box_user e box_host), ou para.
box_alvo() {
    local box; box=$(storage_box_json)
    box_user=$(printf '%s' "$box" | jq -r '.username // .user // empty'); box_host=$(printf '%s' "$box" | jq -r '.server // .host // empty')
    [ -n "$box_user" ] && [ -n "$box_host" ] || die "Sem o Storage Box $STORAGE_BOX_NAME (ou sem usuario e host no JSON dele)."
}
# box_sftp: os comandos do sftp pela entrada (um por linha), no Storage Box, direto do runner: o box aceita SSH de fora
# (provision.sh) com a chave de backup derivada do token. Com -b, o primeiro comando que falha para tudo (o `-` na frente
# de um comando ignora a falha dele).
box_sftp() {
    local key="$WORK_DIR/storagebox_key"
    [ -f "$key" ] || node "$CLOUD_DIR/deploy-key.mjs" --out "$key" --info bunker707-backup-key-v1 >/dev/null
    sftp -q -b - -P "${STORAGE_BOX_SSH_PORT:-23}" -i "$key" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=20 \
        -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$KNOWN_HOSTS" -o LogLevel=ERROR "$box_user@$box_host"
}

# ---- Webinarios: segredos do gravador, webhook assinado e preco por hora --------------------------------
# JIBRI_SECRETS e um segredo do repositorio com linhas CHAVE=VALOR (docs/20 §8B.3; docs/30 §7.3, I4): o
# gravador vive poucas horas e nao tem transfer.key para o envelope. O runner do Actions mascara cada linha.
# app_env_from_jibri: as linhas CHAVE=VALOR do .env do app que repetem o gravador, lidas do JIBRI_SECRETS (secrets-membros
# com DO_JIBRI=sim, docs/20 §8B.3): a Bunny Stream com os nomes do app, o segredo do webhook e o GITHUB_INFRA_TOKEN. So as
# linhas presentes. Quem chama mascara os valores fora do $(...): o ::add-mask:: vai para a saida, que o $(...) engoliria.
app_env_from_jibri() {
    local pair value
    for pair in BUNNY_API_KEY:BUNNY_STREAM_API_KEY BUNNY_LIBRARY_ID:BUNNY_STREAM_LIBRARY_ID \
        WEBINAR_RECORDER_WEBHOOK_SECRET:WEBINAR_RECORDER_WEBHOOK_SECRET GITHUB_INFRA_TOKEN:GITHUB_INFRA_TOKEN; do
        value=$(jibri_secret_opt "${pair%%:*}" "")
        [ -n "$value" ] || continue
        printf '%s=%s\n' "${pair#*:}" "$value"
    done
}
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

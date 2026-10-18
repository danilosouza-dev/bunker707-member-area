#!/usr/bin/env bash
# Funcoes comuns dos scripts de infra/scripts (carregue com: . "$(dirname "$0")/lib.sh").
# Nunca faca `source .env`: os valores JSON (JWT_KEYS) e os base64 quebram no shell. Leia chave a chave
# com env_value.

set -euo pipefail

INFRA_SCRIPTS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$INFRA_SCRIPTS_DIR/../.." && pwd)
# Por padrao o stack principal (infra/compose). Os scripts do Mautic (infra/mautic/scripts) apontam
# BUNKER707_COMPOSE_FILE para o compose deles; BUNKER707_COMPOSE_OVERRIDE acrescenta um -f (colocacao).
COMPOSE_FILE="${BUNKER707_COMPOSE_FILE:-$REPO_ROOT/infra/compose/docker-compose.yml}"
COMPOSE_DIR=$(cd -- "$(dirname -- "$COMPOSE_FILE")" && pwd)
ENV_FILE="${BUNKER707_ENV_FILE:-$COMPOSE_DIR/.env}"
SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-2.121.0}"

log()  { printf '==> %s\n' "$*"; }
warn() { printf 'AVISO: %s\n' "$*" >&2; }
die()  { printf 'ERRO: %s\n' "$*" >&2; exit 1; }

compose() { docker compose -f "$COMPOSE_FILE" ${BUNKER707_COMPOSE_OVERRIDE:+-f "$BUNKER707_COMPOSE_OVERRIDE"} "$@"; }

require_env_file() {
    [ -f "$ENV_FILE" ] || die "Nao achei $ENV_FILE. Gere com: sh $(basename "$COMPOSE_DIR")/generate-secrets.sh (--local ou --domain ...) em infra/."
}

# env_value CHAVE [padrao]: valor da chave no .env (sem aspas externas), ou o padrao.
env_value() {
    local key="$1" default="${2-}" line
    line=$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -n1 || true)
    if [ -z "$line" ]; then
        printf '%s' "$default"
        return 0
    fi
    line=${line#*=}
    line=${line%$'\r'}
    case "$line" in
        \"*\") line=${line#\"}; line=${line%\"} ;;
        \'*\') line=${line#\'}; line=${line%\'} ;;
    esac
    printf '%s' "$line"
}

require_env_value() {
    local value
    value=$(env_value "$1")
    [ -n "$value" ] || die "A variavel $1 esta vazia em $ENV_FILE."
    printf '%s' "$value"
}

# URL do Postgres direto (127.0.0.1:POSTGRES_DIRECT_PORT), como usuario postgres.
direct_db_url() {
    local password port db
    password=$(require_env_value POSTGRES_PASSWORD)
    port=$(env_value POSTGRES_DIRECT_PORT 5433)
    db=$(env_value POSTGRES_DB postgres)
    # sslmode=disable: conexao em loopback, e o Postgres do stack nao tem TLS (a CLI tenta TLS por padrao).
    printf 'postgresql://postgres:%s@127.0.0.1:%s/%s?sslmode=disable' "$password" "$port" "$db"
}

# Espera um container do compose ficar healthy (ou running, se nao tiver healthcheck).
wait_healthy() {
    local service="$1" timeout="${2:-180}" waited=0 status
    while :; do
        status=$(compose ps --format '{{.Health}}|{{.State}}' "$service" 2>/dev/null | head -n1 || true)
        case "$status" in
            healthy*|"|running") return 0 ;;
        esac
        if [ "$waited" -ge "$timeout" ]; then
            die "$service nao ficou saudavel em ${timeout}s (estado: ${status:-desconhecido}). Veja: docker compose -f $COMPOSE_FILE logs $service"
        fi
        sleep 3
        waited=$((waited + 3))
    done
}

# Binario da CLI do Supabase: instalado (servidor) ou npx (maquina de desenvolvimento).
supabase_cli() {
    if command -v supabase >/dev/null 2>&1; then
        supabase "$@"
    elif command -v npx >/dev/null 2>&1; then
        npx --yes "supabase@${SUPABASE_CLI_VERSION}" "$@"
    else
        die "CLI do Supabase nao encontrada. No servidor o bootstrap.sh instala; na sua maquina use npx (Node)."
    fi
}

# Caminho do repositorio como o compose ve (para mensagens).
project_name() { compose config --format json 2>/dev/null | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["name"])' 2>/dev/null || echo bunker707; }

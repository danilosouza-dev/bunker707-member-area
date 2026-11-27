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

# Alias `storagebox` no ~/.ssh/config para o restic falar SFTP com o Storage Box: usuario e host lidos do .env
# (STORAGE_BOX_USER, STORAGE_BOX_HOST, STORAGE_BOX_SSH_PORT), chave em ~/.ssh/id_ed25519_storagebox (o provision
# instala a derivada do token, que o box ja conhece; sem ela, gera uma e diz como cadastrar). Idempotente.
storagebox_ssh_alias() {
    local user host port key_file config
    user=$(env_value STORAGE_BOX_USER); host=$(env_value STORAGE_BOX_HOST); port=$(env_value STORAGE_BOX_SSH_PORT 23)
    [ -n "$user" ] && [ -n "$host" ] || { warn "STORAGE_BOX_USER/STORAGE_BOX_HOST vazios: pulando o alias SSH (repositorio local?)."; return 0; }
    key_file="$HOME/.ssh/id_ed25519_storagebox"; config="$HOME/.ssh/config"
    mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
    if [ ! -f "$key_file" ]; then
        ssh-keygen -q -t ed25519 -N "" -C "bunker707-backup" -f "$key_file"
        log "Chave SSH criada em $key_file: cadastre no Storage Box com ssh -p $port $user@$host install-ssh-key < $key_file.pub"
    fi
    if ! grep -qE '^Host storagebox$' "$config" 2>/dev/null; then
        printf '\nHost storagebox\n  HostName %s\n  User %s\n  Port %s\n  IdentityFile %s\n  IdentitiesOnly yes\n  StrictHostKeyChecking accept-new\n' "$host" "$user" "$port" "$key_file" >> "$config"
        chmod 600 "$config"; log "Alias 'storagebox' gravado em $config."
    fi
}

# Cadastra no repositorio restic (RESTIC_REPOSITORY, aberto com RESTIC_PASSWORD) uma segunda senha, lida do
# arquivo: a de recuperacao derivada do HCLOUD_TOKEN (infra/cloud/deploy-key.mjs --secret), que abre o backup
# mesmo sem o .env do servidor. Idempotente: se a senha ja abre o repositorio, nao faz nada.
restic_add_recovery_key() {
    local file="$1"
    [ -s "$file" ] || die "Arquivo da senha de recuperacao vazio ou ausente: $file"
    command -v restic >/dev/null 2>&1 || die "restic nao encontrado (bootstrap.sh instala no servidor)."
    if env -u RESTIC_PASSWORD restic --password-file "$file" cat config >/dev/null 2>&1; then
        log "Senha de recuperacao ja cadastrada em $RESTIC_REPOSITORY."
    else
        restic key add --new-password-file "$file" >/dev/null
        env -u RESTIC_PASSWORD restic --password-file "$file" cat config >/dev/null 2>&1 || die "A senha de recuperacao nao abriu $RESTIC_REPOSITORY depois de cadastrada."
        log "Senha de recuperacao cadastrada em $RESTIC_REPOSITORY."
    fi
}

# ---- Segunda copia no Cloudflare R2 (docs/20 §8E) -----------------------------------------------------------
# Com RESTIC_REPOSITORY_R2 no .env (s3:https://<conta>.r2.cloudflarestorage.com/<bucket>/<pasta>, gravado pelo
# deploy-membros/deploy-marketing quando o repositorio do GitHub tem R2_ACCOUNT_ID), cada backup vai tambem para o
# R2: um segundo repositorio restic, com a mesma senha (RESTIC_PASSWORD) e a mesma senha de recuperacao, fora da
# Hetzner. A copia no R2 e independente: se o Storage Box cair, o R2 continua recebendo, e vice-versa.
# As chaves do token do R2 (AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY) ja sao exportadas pelos scripts de backup.
r2_repo() { env_value RESTIC_REPOSITORY_R2; }

# r2_restic ARGS...: o restic apontado para o R2 (sem mexer no RESTIC_REPOSITORY de quem chamou).
r2_restic() {
    local repo; repo=$(r2_repo)
    [ -n "$repo" ] || die "RESTIC_REPOSITORY_R2 vazio no .env."
    command -v restic >/dev/null 2>&1 || die "restic nao encontrado (bootstrap.sh instala no servidor)."
    RESTIC_REPOSITORY="$repo" restic "$@"
}

# r2_init: cria o repositorio no R2 com os parametros de pedaco do principal e copia para ele o historico que ja
# existe (restic copy), para que a primeira copia no R2 ja tenha os backups antigos. Idempotente.
r2_init() {
    [ -n "$(r2_repo)" ] || return 0
    if r2_restic cat config >/dev/null 2>&1; then
        log "Repositorio da copia no R2 ja existe ($(r2_repo))."
        return 0
    fi
    log "Criando o repositorio da copia no R2 ($(r2_repo))..."
    if RESTIC_FROM_PASSWORD="$RESTIC_PASSWORD" r2_restic init --from-repo "$RESTIC_REPOSITORY" --copy-chunker-params >/dev/null 2>&1; then
        log "Copiando para o R2 o historico que ja existe em $RESTIC_REPOSITORY..."
        RESTIC_FROM_PASSWORD="$RESTIC_PASSWORD" r2_restic copy --from-repo "$RESTIC_REPOSITORY" --quiet \
            || warn "A copia do historico para o R2 falhou; os proximos backups vao para la mesmo assim."
    else
        # Sem o principal (Storage Box fora do ar, ou repositorio novo): o R2 nasce sozinho, sem o historico.
        warn "Nao li $RESTIC_REPOSITORY para copiar os parametros; o repositorio do R2 nasce sem o historico."
        r2_restic init >/dev/null
    fi
    log "Repositorio da copia no R2 pronto."
}

# r2_add_recovery_key ARQUIVO: a senha de recuperacao tambem no repositorio do R2.
r2_add_recovery_key() {
    local repo; repo=$(r2_repo)
    [ -n "$repo" ] || return 0
    ( RESTIC_REPOSITORY="$repo"; export RESTIC_REPOSITORY; restic_add_recovery_key "$1" )
}

# r2_backup TAG HOST KEEP_DAILY MARCA CAMINHOS...: o mesmo backup no R2, com a mesma retencao; grava a hora em MARCA
# so quando deu certo. Volta 1 (sem morrer) quando falha: o backup do Storage Box ja esta feito e continua valendo.
r2_backup() {
    local tag="$1" host="$2" keep="$3" mark="$4"; shift 4
    [ -n "$(r2_repo)" ] || return 0
    log "Copia no R2 ($(r2_repo))..."
    if ! r2_restic cat config >/dev/null 2>&1; then r2_init || { warn "Nao criei o repositorio no R2."; return 1; }; fi
    r2_restic backup --tag "$tag" --host "$host" --quiet "$@" || { warn "O backup no R2 falhou."; return 1; }
    r2_restic forget --tag "$tag" --host "$host" --group-by host --keep-daily "$keep" --prune --quiet \
        || { warn "A retencao no R2 falhou (o backup de hoje entrou)."; return 1; }
    date -u +%Y-%m-%dT%H:%M:%SZ > "$mark"
    log "Copia no R2 concluida."
}

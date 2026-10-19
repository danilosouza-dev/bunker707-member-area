#!/usr/bin/env bash
# Deploy de uma versao do app no servidor (stack ja no ar):
#   sh infra/scripts/deploy.sh --image ghcr.io/danilosouza-dev/bunker707-member-area:hetzner-sha-1a2b3c4
#   sh infra/scripts/deploy.sh --build                 constroi a imagem aqui em vez de puxar do ghcr.io
#   ... [--ref main] [--no-migrate]                    --ref faz git fetch/checkout antes (infra e migracoes)
# Passos: atualiza APP_IMAGE no .env (guardando a anterior em .deploy-history) -> pull/build -> migracoes
# (migrate.sh) -> recria o app -> espera saudavel -> smoke.sh. Se falhar, mostra o comando de volta.
# Versao antiga continua no disco: `deploy.sh --image <anterior>` desfaz em segundos.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/lib.sh"

image=""
build=0
migrate=1
ref=""
while [ $# -gt 0 ]; do
    case "$1" in
        --image) image="$2"; shift ;;
        --build) build=1 ;;
        --no-migrate) migrate=0 ;;
        --ref) ref="$2"; shift ;;
        -h|--help) sed -n 2,9p "$0"; exit 0 ;;
        *) die "opcao desconhecida: $1" ;;
    esac
    shift
done
[ -n "$image" ] || [ "$build" = "1" ] || die "Informe --image <imagem> ou --build."
require_env_file

if [ -n "$ref" ]; then
    log "Atualizando o repositorio para $ref..."
    git -C "$REPO_ROOT" fetch --quiet origin
    git -C "$REPO_ROOT" checkout --quiet "$ref" 2>/dev/null || git -C "$REPO_ROOT" checkout --quiet -B "$ref" "origin/$ref"
    git -C "$REPO_ROOT" pull --ff-only --quiet origin "$ref" 2>/dev/null || true
fi

previous=$(env_value APP_IMAGE)
if [ "$build" = "1" ]; then
    image="bunker707-app:$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || date +%s)"
    log "Construindo $image..."
    APP_IMAGE="$image" APP_VERSION="${image#bunker707-app:}" compose build app
else
    # Imagem ja no disco (voltar para a anterior): sem pull, que fora do job do Actions nao tem credencial
    # do GHCR e derrubaria o script.
    if docker image inspect "$image" >/dev/null 2>&1; then
        log "$image ja esta no servidor."
    else
        log "Baixando $image..."
        APP_IMAGE="$image" compose pull app
    fi
fi

# Grava a imagem no .env (o compose le de la) e o historico para voltar atras.
if grep -qE '^APP_IMAGE=' "$ENV_FILE"; then
    sed -i.bak "s|^APP_IMAGE=.*|APP_IMAGE=$image|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
else
    printf '\nAPP_IMAGE=%s\n' "$image" >> "$ENV_FILE"
fi
printf '%s anterior=%s nova=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${previous:-nenhuma}" "$image" >> "$COMPOSE_DIR/.deploy-history"

if [ "$migrate" = "1" ]; then
    bash "$INFRA_SCRIPTS_DIR/migrate.sh"
fi

# Todo o stack: recria o app (imagem nova) e so o que mudou no compose (auth, caddy...); o resto fica.
log "Recriando o app e o que mudou..."
compose up -d
if wait_healthy app 180 && bash "$INFRA_SCRIPTS_DIR/smoke.sh"; then
    log "Deploy de $image concluido."
    docker image prune -f >/dev/null 2>&1 || true
else
    warn "Deploy com problema. Para voltar: sh infra/scripts/deploy.sh --image ${previous:-<imagem anterior>} --no-migrate"
    warn "Logs: docker compose -f infra/compose/docker-compose.yml logs --tail=200 app"
    exit 1
fi

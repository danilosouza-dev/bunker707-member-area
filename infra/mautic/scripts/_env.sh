# Carregado pelos scripts do Mautic: aponta infra/scripts/lib.sh para o compose do Mautic.
#   . "$(dirname -- "$0")/_env.sh"
MAUTIC_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
export BUNKER707_COMPOSE_FILE="${BUNKER707_COMPOSE_FILE:-$MAUTIC_DIR/docker-compose.yml}"
. "$MAUTIC_DIR/../scripts/lib.sh"
# Com Caddy proprio (servidor de marketing) o perfil `borda` precisa estar ligado em todo comando do compose.
# Na colocacao (BUNKER707_COMPOSE_OVERRIDE=compose.colocado.yml) o Caddy e o do stack principal.
if [ -z "${BUNKER707_COMPOSE_OVERRIDE:-}" ]; then
    export COMPOSE_PROFILES="${COMPOSE_PROFILES:-borda}"
fi

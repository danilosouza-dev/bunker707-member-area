# Carregado pelos scripts do Jitsi: aponta infra/scripts/lib.sh para o compose do Jitsi.
#   . "$(dirname -- "$0")/_env.sh"
JITSI_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
export BUNKER707_COMPOSE_FILE="${BUNKER707_COMPOSE_FILE:-$JITSI_DIR/docker-compose.yml}"
. "$JITSI_DIR/../scripts/lib.sh"
# O Caddy proprio (perfil `borda`) entra em todo comando do compose: o servidor C nao tem outra borda.
export COMPOSE_PROFILES="${COMPOSE_PROFILES:-borda}"

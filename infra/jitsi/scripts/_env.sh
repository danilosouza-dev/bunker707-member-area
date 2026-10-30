# Carregado pelos scripts do Jitsi: aponta infra/scripts/lib.sh para o compose do Jitsi.
#   . "$(dirname -- "$0")/_env.sh"
JITSI_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
export BUNKER707_COMPOSE_FILE="${BUNKER707_COMPOSE_FILE:-$JITSI_DIR/docker-compose.yml}"
. "$JITSI_DIR/../scripts/lib.sh"
# O Caddy proprio (perfil `borda`) entra em todo comando do compose: o servidor C nao tem outra borda.
export COMPOSE_PROFILES="${COMPOSE_PROFILES:-borda}"

# Depois de um `up -d` com o stack ja no ar. O prosody recriado (env ou imagem nova) derruba as conexoes XMPP. O jvb
# volta sozinho ao jvbbrewery, mas o jicofo reconecta sem retomar a sessao e fica com 0 pontes: o /about/health
# responde 500 e nenhuma sala abre (visto em 30/10/2026, docs/20 §8B.8). Reiniciar o jicofo com o prosody saudavel
# refaz a lista de pontes; espera o /about/health responder 200.
reconnect_focus() {
    local port waited=0
    wait_healthy prosody 300
    compose restart jicofo >/dev/null
    port=$(env_value JICOFO_REST_PORT 8888)
    until [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/about/health" || true)" = 200 ]; do
        [ "$waited" -ge 180 ] && die "O jicofo nao achou a ponte em 180 s depois de reiniciar (docs/20 §8B.8)."
        sleep 5; waited=$((waited + 5))
    done
}

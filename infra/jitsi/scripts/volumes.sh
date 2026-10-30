#!/usr/bin/env bash
# Cria as pastas dos volumes do Jitsi (infra/jitsi/volumes) antes do primeiro `up`:
#   sh infra/jitsi/scripts/volumes.sh
# As imagens rodam como o usuario s6 (uid 1000) com raiz somente leitura e recusam subir se nao puderem
# escrever em /config e no armazenamento. Criadas pelo Docker na hora do `up`, as pastas nasceriam de root;
# criadas aqui pelo usuario deploy (uid 1000 no servidor), ja nascem do dono certo. Idempotente.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/_env.sh"

dirs=(web storage/web prosody/config storage/prosody jicofo jvb)
for d in "${dirs[@]}"; do
    mkdir -p "$COMPOSE_DIR/volumes/$d"
done
owner=$(stat -c %u "$COMPOSE_DIR/volumes/web" 2>/dev/null || stat -f %u "$COMPOSE_DIR/volumes/web" 2>/dev/null || echo "?")
if [ "$(uname -s)" = "Linux" ] && [ "$owner" != "1000" ]; then
    # Em outra maquina Linux (uid diferente), passa as pastas para o uid das imagens.
    if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
        sudo chown -R 1000:1000 "$COMPOSE_DIR/volumes"
        log "Pastas dos volumes passadas para o uid 1000 (o usuario das imagens)."
    else
        warn "As pastas em $COMPOSE_DIR/volumes sao do uid $owner; as imagens escrevem como uid 1000. Rode: sudo chown -R 1000:1000 $COMPOSE_DIR/volumes"
    fi
fi
log "Pastas dos volumes prontas em $COMPOSE_DIR/volumes (${dirs[*]})."

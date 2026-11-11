#!/usr/bin/env bash
# Entrega segredos externos (chave do Resend etc.) ao .env de um papel, a partir de um envelope cifrado
# para o servidor (infra/cloud/envelope.sh encrypt), e recria os servicos que mudaram:
#   PAYLOAD='<base64>' bash infra/cloud/secrets.sh membros|marketing|meet
# O payload nunca e legivel fora do servidor; as chaves aplicadas sao listadas sem os valores.
# membros com DO_JIBRI=sim e sem payload: em vez do envelope, as chaves do app que repetem o gravador saem do segredo
# JIBRI_SECRETS do repositorio (app_env_from_jibri, lib.sh) e vao ao servidor pelo SSH. O produtor so cadastra o segredo
# na tela do GitHub; nada passa pelo chat (docs/20 §8B.3).
# meet (servidor C do Jitsi): JWT_APP_SECRET, o mesmo valor que o app recebe em WEBINAR_JWT_SECRET (docs/20 §8B.3);
# recria o prosody, o que derruba quem estiver na sala: fora de live.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/lib.sh"
role="${1:-}"; [ "$role" = "membros" ] || [ "$role" = "marketing" ] || [ "$role" = "meet" ] || die "uso: secrets.sh membros|marketing|meet"
from_jibri=""
if [ "$role" = "membros" ] && [ -z "${PAYLOAD:-}" ] && [ "${DO_JIBRI:-}" = "sim" ]; then
    need HCLOUD_TOKEN JIBRI_SECRETS
    from_jibri=$(app_env_from_jibri)
    while IFS= read -r line; do [ -n "$line" ] && mask "${line#*=}"; done <<< "$from_jibri"
    [ -n "$from_jibri" ] || die "JIBRI_SECRETS sem BUNNY_API_KEY, BUNNY_LIBRARY_ID, WEBINAR_RECORDER_WEBHOOK_SECRET nem GITHUB_INFRA_TOKEN (docs/20 §8B.3)."
else
    need HCLOUD_TOKEN PAYLOAD
fi
install_hcloud; deploy_key
case "$role" in
    membros) server="$MEMBROS_NAME"; envf="$REMOTE_DIR/infra/compose/.env" ;;
    meet) server="$MEET_NAME"; envf="$REMOTE_DIR/infra/jitsi/.env" ;;
    *) if [ -n "${SKIP_MARKETING:-}" ]; then server="$MEMBROS_NAME"; else server="$MARKETING_NAME"; fi; envf="$REMOTE_DIR/infra/mautic/.env" ;;
esac
ip=$(server_ip4 "$server"); target="$DEPLOY_USER@$ip"

fw_open_ssh "$server"; wait_ssh "$target"
if [ -n "$from_jibri" ]; then
    log "Chaves do app a partir do JIBRI_SECRETS (sem envelope; pelo SSH)"
    printf '%s\n' "$from_jibri" | rsh "$target" "umask 077 && cat > /tmp/payload.kv"
else
    # Conferencia de que o payload chegou inteiro (e cifrado: o hash nao revela nada).
    log "Payload: ${#PAYLOAD} caracteres, sha256 $(printf '%s' "$PAYLOAD" | tr -d '[:space:]' | sha256sum | cut -c1-16)"
    printf '%s' "$PAYLOAD" | rsh "$target" "umask 077 && cat > /tmp/payload.b64"
    # O envelope.sh deste commit vai junto: decifra no mesmo formato em que a sessao cifrou, mesmo que o
    # servidor ainda tenha uma versao anterior do repositorio.
    rsh "$target" "umask 077 && cat > /tmp/envelope.sh" < "$CLOUD_DIR/envelope.sh"
    # Texto claro so em 0600 e so se a decifragem fechou; em erro, nada fica em /tmp (nem no snapshot).
    rsh "$target" "umask 077; sudo bash /tmp/envelope.sh decrypt /etc/bunker707/transfer.key /tmp/payload.b64 > /tmp/payload.kv; rc=\$?; rm -f /tmp/payload.b64 /tmp/envelope.sh; [ \$rc -eq 0 ] || rm -f /tmp/payload.kv; exit \$rc"
fi
keys=$(rsh "$target" "grep -oE '^[A-Z0-9_]+=' /tmp/payload.kv | tr -d = | tr '\n' ' '")
log "Aplicando em $envf: $keys"
env_aplicar_kv "$target" "$envf" /tmp/payload.kv
if [ "$role" = "membros" ]; then
    membros_recria "$target"
elif [ "$role" = "meet" ]; then
    rsh "$target" "cd '$REMOTE_DIR' && docker compose -f infra/jitsi/docker-compose.yml --profile borda up -d && bash -c '. infra/jitsi/scripts/_env.sh; reconnect_focus; for s in prosody jicofo jvb web; do wait_healthy \$s 300; done' && bash infra/jitsi/scripts/smoke.sh"
else
    extra=""; [ -n "${SKIP_MARKETING:-}" ] && extra="-f infra/mautic/compose.colocado.yml"
    profile=""; [ -n "${SKIP_MARKETING:-}" ] || profile="--profile borda"
    override="${SKIP_MARKETING:+BUNKER707_COMPOSE_OVERRIDE=$REMOTE_DIR/infra/mautic/compose.colocado.yml}"
    rsh "$target" "cd '$REMOTE_DIR' && docker compose -f infra/mautic/docker-compose.yml $extra $profile up -d && $override bash -c '. infra/mautic/scripts/_env.sh; wait_healthy mautic 300' && $override bash infra/mautic/scripts/smoke.sh"
fi
log "Segredos aplicados e servicos recriados."

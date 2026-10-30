#!/usr/bin/env bash
# Logs do Jitsi proprio, sem precisar lembrar o -f e o perfil do compose:
#   sh infra/jitsi/scripts/logs.sh [servico] [--since 1h] [--tail 200]
# servico: web, prosody, jicofo, jvb ou caddy (vazio = todos). Pela etapa exec-meet, o payload e por exemplo
#   bash infra/jitsi/scripts/logs.sh jvb --since 30m
# Nunca passe segredo pelo payload: ele fica no historico do workflow.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/_env.sh"

service=""; since="1h"; tail="200"
while [ $# -gt 0 ]; do
    case "$1" in
        --since) since="$2"; shift ;;
        --tail) tail="$2"; shift ;;
        -h|--help) sed -n 2,7p "$0"; exit 0 ;;
        -*) die "opcao desconhecida: $1" ;;
        web|prosody|jicofo|jvb|caddy) service="$1" ;;
        *) die "servico desconhecido: $1 (web, prosody, jicofo, jvb ou caddy)" ;;
    esac
    shift
done
compose logs --no-color --since "$since" --tail "$tail" ${service:+"$service"}

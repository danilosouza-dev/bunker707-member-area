#!/usr/bin/env bash
# Teste de fumaca do Mautic (depois de subir, instalar ou restaurar):
#   sh infra/mautic/scripts/smoke.sh
# Confere pelo endereco publico: tela de login (200), script de rastreio (200), instalador fechado para
# quem nao esta na allowlist (403; ou 302/404 se o Mautic ja instalado o redireciona) e o worker/cron no ar.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/_env.sh"

require_env_file
url=$(require_env_value MAUTIC_PUBLIC_URL)
failures=0

check() {
    local name="$1" expected="$2" path="$3"; shift 3
    local code
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$@" "$url$path" 2>/dev/null || echo "000")
    if printf '%s' "$code" | grep -qE "^(${expected})$"; then
        printf '  ok   %-30s %s\n' "$name" "$code"
    else
        printf '  FALHA %-30s esperado %s, veio %s (%s)\n' "$name" "$expected" "$code" "$url$path"
        failures=$((failures + 1))
    fi
}

log "Mautic em $url"
check "tela de login /s/login" 200 "/s/login"
check "rastreio /mtc.js" 200 "/mtc.js"
check "instalador fechado" "403|302|404" "/installer"
for service in mautic-db mautic; do
    state=$(compose ps --format '{{.Health}}' "$service" 2>/dev/null | head -n1)
    if [ "$state" = "healthy" ]; then printf '  ok   %-30s %s\n' "$service (healthcheck)" "$state"; else printf '  FALHA %-30s %s\n' "$service (healthcheck)" "${state:-sem container}"; failures=$((failures + 1)); fi
done
for service in mautic-cron mautic-worker; do
    state=$(compose ps --format '{{.State}}' "$service" 2>/dev/null | head -n1)
    if [ "$state" = "running" ]; then printf '  ok   %-30s %s\n' "$service" "$state"; else printf '  FALHA %-30s %s\n' "$service" "${state:-sem container}"; failures=$((failures + 1)); fi
done
[ "$failures" -eq 0 ] || die "$failures verificacao(oes) falharam."
log "Mautic respondendo."

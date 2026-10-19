#!/usr/bin/env bash
# Teste de fumaca do stack (depois de subir, de um deploy ou de uma restauracao):
#   sh infra/scripts/smoke.sh
# Confere, pelos enderecos publicos do .env: o app (/api/health e redirecionamento para /login), o Auth,
# o PostgREST, o Storage e o Realtime do Supabase. Sai com erro no primeiro problema.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/lib.sh"

require_env_file
app_url=$(require_env_value APP_PUBLIC_URL)
supabase_url=$(require_env_value SUPABASE_PUBLIC_URL)
anon_key=$(env_value SUPABASE_PUBLISHABLE_KEY)
[ -n "$anon_key" ] || anon_key=$(require_env_value ANON_KEY)
secret_key=$(env_value SUPABASE_SECRET_KEY)
[ -n "$secret_key" ] || secret_key=$(require_env_value SERVICE_ROLE_KEY)
failures=0

check() {
    # check "nome" codigo-esperado url [curl args...]
    local name="$1" expected="$2" url="$3"; shift 3
    local code
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$@" "$url" 2>/dev/null || true); [ -n "$code" ] || code=000
    # expected pode ter alternativas separadas por |
    if printf '%s' "$code" | grep -qE "^(${expected})$"; then
        printf '  ok   %-28s %s\n' "$name" "$code"
    else
        printf '  FALHA %-28s esperado %s, veio %s (%s)\n' "$name" "$expected" "$code" "$url"
        failures=$((failures + 1))
    fi
}

log "App em $app_url"
check "app /api/health" 200 "$app_url/api/health"
# Sem sessao, o proxy do app (src/proxy.ts) manda `/` para /login na borda: 307, nunca 200.
check "app / redireciona para /login" 307 "$app_url/"
version=$(curl -sS --max-time 15 "$app_url/api/health" 2>/dev/null | python3 -I -c 'import json,sys; print(json.load(sys.stdin).get("version","?"))' 2>/dev/null || echo "?")
printf '  versao no ar: %s\n' "$version"

log "Supabase em $supabase_url"
# O gateway exige a chave publica em quase tudo (so verify/callback/.well-known passam sem ela).
check "auth /health (sem chave)" 401 "$supabase_url/auth/v1/health"
check "auth /health" 200 "$supabase_url/auth/v1/health" -H "apikey: $anon_key"
check "rest /rest/v1/ (sem chave)" 401 "$supabase_url/rest/v1/"
# RLS: tabela interna fechada para a chave publica (401) e aberta para a chave do servidor (200).
check "rest nega anon em tabela interna" 401 "$supabase_url/rest/v1/job_runs?select=id&limit=1" -H "apikey: $anon_key" -H "Authorization: Bearer $anon_key"
check "rest le com a chave do servidor" 200 "$supabase_url/rest/v1/job_runs?select=id&limit=1" -H "apikey: $secret_key" -H "Authorization: Bearer $secret_key"
check "storage /status" 200 "$supabase_url/storage/v1/status"
# O gateway fecha /realtime/v1/api/tenants para todo mundo (correcao de seguranca do self-hosted 0.6.0):
# o Realtime e conferido pelo healthcheck do proprio container. O primeiro teste dele so roda 30 s depois
# da partida: recem-criado, "starting" ganha ate 90 s antes de virar falha.
realtime_health=$(compose ps --format '{{.Health}}' realtime 2>/dev/null | head -n1)
for _ in $(seq 30); do
    [ "$realtime_health" = "starting" ] || break
    sleep 3; realtime_health=$(compose ps --format '{{.Health}}' realtime 2>/dev/null | head -n1)
done
if [ "$realtime_health" = "healthy" ]; then
    printf '  ok   %-28s %s\n' "realtime (healthcheck)" "$realtime_health"
else
    printf '  FALHA %-28s %s\n' "realtime (healthcheck)" "${realtime_health:-sem container}"
    failures=$((failures + 1))
fi
check "realtime fechado em /api/tenants" 403 "$supabase_url/realtime/v1/api/tenants/realtime-dev/health" -H "Authorization: Bearer $secret_key"
# Em producao o Caddy responde 404 fora da API; no ensaio local o Envoy responde 401 (basic auth do Studio).
check "studio fechado no host da API" "404|401" "$supabase_url/"

if [ "$failures" -gt 0 ]; then
    die "$failures verificacao(oes) falharam."
fi
log "Tudo respondendo."

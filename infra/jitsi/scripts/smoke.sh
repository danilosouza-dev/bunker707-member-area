#!/usr/bin/env bash
# Teste de fumaca do Jitsi proprio (depois de subir, de um deploy-meet ou de uma atualizacao):
#   sh infra/jitsi/scripts/smoke.sh
# Confere: os quatro servicos saudaveis (e o Caddy no ar), o site respondendo pelo endereco publico
# (config.js, interface_config.js, external_api.js e o caminho do websocket ate o prosody), a marca do Jitsi
# fora da interface servida (as chaves de marca do interface_config.js com os NOSSOS valores, e a ultima
# palavra e a do custom-interface_config.js), o iframe permitido so para a nossa origem, a saude do jicofo e
# do jvb em 127.0.0.1 e as portas UDP 10000 (midia) e TCP 5222 (Jibri) escutando no servidor.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/_env.sh"

require_env_file
public_url=$(require_env_value PUBLIC_URL)
frame_ancestors=$(env_value MEET_FRAME_ANCESTORS)
local_certs=$(env_value CADDY_LOCAL_CERTS)
jvb_port=$(env_value JVB_PORT 10000)
xmpp_port=$(env_value XMPP_PORT 5222)
jicofo_rest=$(env_value JICOFO_REST_PORT 8888)
jvb_rest=$(env_value JVB_COLIBRI_PORT 8080)
failures=0
# No ensaio local o certificado e da CA interna do Caddy (CADDY_LOCAL_CERTS=local_certs).
insecure=(); [ -n "$local_certs" ] && insecure=(-k)
# A folha do iframe (docs/31 §3): o ?v= do carregador e o comeco do sha256 dela; a servida tem de ser a do commit.
css_file="$(dirname -- "$0")/../web/bunker707.css"
css_sha=$(sha256sum "$css_file" | cut -c1-64); css_v=${css_sha:0:8}

ok()    { printf '  ok   %-40s %s\n' "$1" "$2"; }
falha() { printf '  FALHA %-40s %s\n' "$1" "$2"; failures=$((failures + 1)); }
check() {  # check "nome" codigo-esperado url
    local name="$1" expected="$2" url="$3" code
    code=$(curl -sS "${insecure[@]}" -o /dev/null -w '%{http_code}' --max-time 20 "$url" 2>/dev/null || true); [ -n "$code" ] || code=000
    if printf '%s' "$code" | grep -qE "^(${expected})$"; then ok "$name" "$code"; else falha "$name" "esperado $expected, veio $code ($url)"; fi
}

log "Containers"
for service in web prosody jicofo jvb; do
    state=$(compose ps --format '{{.Health}}' "$service" 2>/dev/null | head -n1)
    if [ "$state" = "healthy" ]; then ok "$service (healthcheck)" "$state"; else falha "$service (healthcheck)" "${state:-sem container}"; fi
done
if printf '%s' "${COMPOSE_PROFILES:-}" | grep -q borda; then
    state=$(compose ps --format '{{.State}}' caddy 2>/dev/null | head -n1)
    if [ "$state" = "running" ]; then ok "caddy" "$state"; else falha "caddy" "${state:-sem container}"; fi
fi

log "Site em $public_url"
check "config.js" 200 "$public_url/config.js"
check "interface_config.js" 200 "$public_url/interface_config.js"
check "external_api.js" 200 "$public_url/external_api.js"
check "css/bunker707.css (o CSS nosso)" 200 "$public_url/css/bunker707.css"
served_sha=$(curl -sS "${insecure[@]}" --max-time 20 "$public_url/css/bunker707.css?v=$css_v" 2>/dev/null | sha256sum | cut -c1-64)
if [ "$served_sha" = "$css_sha" ]; then ok "css/bunker707.css (conteudo)" "sha256 $css_v"; else falha "css/bunker707.css (conteudo)" "a servida nao e a do commit (esperado $css_v, veio ${served_sha:0:8}): o web foi recriado?"; fi
# Sem o upgrade do websocket o prosody responde com texto ou 4xx; 502/503 seria o nginx sem chegar nele.
check "websocket (caminho ate o prosody)" "200|400|404|426" "$public_url/xmpp-websocket"

log "Marca do Jitsi fora da interface (D2)"
iface=$(curl -sS "${insecure[@]}" --max-time 20 "$public_url/interface_config.js" 2>/dev/null || true)
brand_ok=1
for expr in "interfaceConfig.SHOW_JITSI_WATERMARK = false" "interfaceConfig.SHOW_BRAND_WATERMARK = false" \
            "interfaceConfig.SHOW_POWERED_BY = false" "interfaceConfig.APP_NAME = 'Bunker707'" \
            "interfaceConfig.PROVIDER_NAME = 'Bunker707'" "interfaceConfig.MOBILE_APP_PROMO = false" \
            "interfaceConfig.JITSI_WATERMARK_LINK = ''"; do
    printf '%s' "$iface" | grep -qF "$expr" || { brand_ok=0; falha "interface_config.js" "falta: $expr"; }
done
# A ultima mencao a SHOW_JITSI_WATERMARK e a nossa (o padrao `SHOW_JITSI_WATERMARK: true` vem antes).
last=$(printf '%s' "$iface" | grep -n 'SHOW_JITSI_WATERMARK' | tail -n1)
printf '%s' "$last" | grep -q 'false' || { brand_ok=0; falha "interface_config.js" "ultima SHOW_JITSI_WATERMARK nao e false: $last"; }
[ "$brand_ok" = 1 ] && ok "interface_config.js" "custom-interface_config.js no fim, sem a marca"
cfg=$(curl -sS "${insecure[@]}" --max-time 20 "$public_url/config.js" 2>/dev/null || true)
cfg_ok=1
for expr in "config.disableChat = true" "config.readOnlyName = true" "config.hideConferenceTimer = true" "config.channelLastN = 9" "css/bunker707.css?v=$css_v"; do
    printf '%s' "$cfg" | grep -qF "$expr" || { cfg_ok=0; falha "config.js" "falta: $expr"; }
done
# A barra padrao servida e a minima (docs/30 §8.1): a ultima toolbarButtons nao tem tela, gravar, seguranca nem a lista.
toolbar=$(printf '%s' "$cfg" | grep -E '^[[:space:]]*config\.toolbarButtons[[:space:]]*=' | tail -n1)
for button in "'desktop'" "'recording'" "'security'" "'participants-pane'"; do
    if [ -z "$toolbar" ] || printf '%s' "$toolbar" | grep -qF "$button"; then cfg_ok=0; falha "config.js" "barra padrao com $button (ou sem toolbarButtons): $toolbar"; fi
done
[ "$cfg_ok" = 1 ] && ok "config.js" "custom-config.js no fim"
if [ -z "$frame_ancestors" ]; then
    falha "frame-ancestors (MEET_FRAME_ANCESTORS)" "vazio: a sala nao abre no iframe da area de membros"
else
    csp=$(curl -sSI "${insecure[@]}" --max-time 20 "$public_url/config.js" 2>/dev/null | grep -i '^content-security-policy:' | tr -d '\r' || true)
    if printf '%s' "$csp" | grep -qF "frame-ancestors $frame_ancestors"; then ok "frame-ancestors" "$frame_ancestors"; else falha "frame-ancestors" "${csp:-sem cabecalho Content-Security-Policy}"; fi
fi

log "Saude interna (127.0.0.1)"
check "jicofo /about/health (:$jicofo_rest)" 200 "http://127.0.0.1:$jicofo_rest/about/health"
check "jvb /about/health (:$jvb_rest)" 200 "http://127.0.0.1:$jvb_rest/about/health"
if command -v ss >/dev/null 2>&1; then
    if ss -lun 2>/dev/null | grep -qE "[:.]$jvb_port([[:space:]]|$)"; then ok "UDP $jvb_port (midia do JVB) escutando" "sim"; else falha "UDP $jvb_port (midia do JVB)" "ninguem escuta no servidor"; fi
    if ss -ltn 2>/dev/null | grep -qE "[:.]$xmpp_port([[:space:]]|$)"; then ok "TCP $xmpp_port (XMPP para o Jibri) escutando" "sim"; else falha "TCP $xmpp_port (XMPP para o Jibri)" "ninguem escuta no servidor"; fi
else
    warn "ss nao encontrado: as portas $jvb_port/udp e $xmpp_port/tcp nao foram conferidas (ensaio fora do Linux)."
fi

[ "$failures" -eq 0 ] || die "$failures verificacao(oes) falharam."
log "Jitsi respondendo."

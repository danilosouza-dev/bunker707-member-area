#!/usr/bin/env bash
# Estado da infraestrutura (nao muda nada alem de, com SSH=1, abrir e fechar a porta 22 para ler o servidor):
#   bash infra/cloud/status.sh            servidores, Storage Box, DNS, respostas publicas
#   SSH=1 bash infra/cloud/status.sh      + containers, disco, memoria, ultimo backup, transfer.pub
#   bash infra/cloud/status.sh meet       o servidor C do Jitsi e os gravadores vivos (docs/20 §8B): DNS de
#                                         meet.<dominio>, o site, a marca fora da interface, tempo ligado e custo
#                                         estimado de cada Jibri, e por SSH os containers, a memoria e o smoke
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
. "$(dirname -- "$0")/lib.sh"
need HCLOUD_TOKEN; install_hcloud
role="${1:-}"

if [ "$role" = "meet" ]; then
    log "Servidor C ($MEET_NAME)"
    if server_exists "$MEET_NAME"; then
        hzj server describe "$MEET_NAME" | jq -r '"  \(.name): \(.server_type.name) em \((.location.name // .datacenter.location.name)), \(.public_net.ipv4.ip), \(.status), criado \(.created[:10])"'
    else
        echo "  nao existe (etapa provision-meet, com CONFIRMADO=sim, cria)."
    fi
    log "Gravadores (label papel=jibri)"
    jibris=$(hzj server list --selector papel=jibri | jq -r '.[] | "\(.name)\t\(.server_type.name)\t\((.location.name // .datacenter.location.name))\t\(.public_net.ipv4.ip)\t\(.status)\t\(.created)\t\(.labels.sessao // "?")"')
    if [ -z "$jibris" ]; then
        echo "  nenhum ligado."
    else
        while IFS=$'\t' read -r name type loc ip st created sessao; do
            hours=$(python3 -I -c 'import datetime, sys; c=datetime.datetime.fromisoformat(sys.argv[1].replace("Z","+00:00")); print(round((datetime.datetime.now(datetime.timezone.utc)-c).total_seconds()/3600, 2))' "$created" 2>/dev/null || echo "?")
            price=$(hourly_price "$type" "$loc")
            cost=$( [ -n "$price" ] && [ "$hours" != "?" ] && awk -v p="$price" -v h="$hours" 'BEGIN { printf "EUR %.2f ate agora (EUR %.4f/h)", p*h, p }' || echo "custo nao lido pela API")
            printf '  %s: %s em %s, %s, %s, sessao %s, ligado ha %s h, %s\n' "$name" "$type" "$loc" "$ip" "$st" "$sessao" "$hours" "$cost"
            awk -v h="$hours" 'BEGIN { if (h + 0 > 6) print "  AVISO: mais de 6 h ligado: gravador esquecido? etapa jibri-down (docs/20 §8B.5)" }'
        done <<< "$jibris"
    fi
    if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
        log "DNS de $MEET_DOMAIN (precisa ser SEM proxy)"
        zone=$(cf_zone_id)
        cf_api GET "/zones/$zone/dns_records?name=$MEET_DOMAIN" | jq -r '.result[] | "  \(.name) \(.type) \(.content) proxy=\(.proxied)"' | grep . || echo "  (nenhum registro)"
    fi
    log "Respostas publicas"
    for path in / /config.js /interface_config.js /external_api.js; do
        code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://$MEET_DOMAIN$path" 2>/dev/null) || true
        printf '  %-55s %s\n' "https://$MEET_DOMAIN$path" "${code:-000}"
    done
    iface=$(curl -sS --max-time 20 "https://$MEET_DOMAIN/interface_config.js" 2>/dev/null || true)
    if [ -n "$iface" ]; then
        if printf '%s' "$iface" | grep -qF "interfaceConfig.SHOW_JITSI_WATERMARK = false" && printf '%s' "$iface" | grep -qF "interfaceConfig.APP_NAME = 'Bunker707'"; then
            echo "  marca: fora da interface (custom-interface_config.js servido)."
        else
            echo "  AVISO: o interface_config.js servido nao traz os nossos valores (SHOW_JITSI_WATERMARK = false, APP_NAME = 'Bunker707')."
        fi
    fi
    if server_exists "$MEET_NAME"; then
        deploy_key
        ip=$(server_ip4 "$MEET_NAME"); target="$DEPLOY_USER@$ip"
        log "$MEET_NAME por SSH"
        fw_open_ssh "$MEET_NAME"; wait_ssh "$target" 10
        rsh "$target" "cd '$REMOTE_DIR' 2>/dev/null && cat .deployed-commit 2>/dev/null; docker ps --format '  {{.Names}}\t{{.Status}}\t{{.Image}}'; free -h | sed 's/^/  /'; df -h / | sed 's/^/  /'; cd '$REMOTE_DIR' && bash infra/jitsi/scripts/smoke.sh" || warn "o smoke do Jitsi falhou (veja acima)."
        fw_close_all
    fi
    exit 0
fi

log "Servidores"
hzj server list | jq -r '.[] | select(.labels.app=="bunker707") | "  \(.name): \(.server_type.name) em \((.location.name // .datacenter.location.name)), \(.public_net.ipv4.ip), \(.status), criado \(.created[:10])"'
log "Storage Box"
box=$(storage_box_json); [ -n "$box" ] && printf '%s' "$box" | jq -r '"  \(.name): \(.storage_box_type.name // .type // "?"), \(.username // .user // "?")@\(.server // .host // "?"), usado \((.stats.size // 0)/1024/1024/1024*100|round/100) GB"' || echo "  (nenhum)"
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    log "DNS em $ZONE_NAME"
    zone=$(cf_zone_id)
    cf_api GET "/zones/$zone/dns_records?per_page=100" | jq -r --arg z ".$ZONE_NAME" '.result[] | select(.name | test("^(membros|api|studio|marketing|meet)")) | "  \(.name) \(.type) \(.content) proxy=\(.proxied)"'
fi
log "Respostas publicas"
for u in "https://$APP_DOMAIN/api/health" "https://$APP_DOMAIN/" "https://$API_DOMAIN/auth/v1/health" "https://$MAUTIC_DOMAIN/s/login"; do
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$u" 2>/dev/null) || true
    printf '  %-55s %s\n' "$u" "${code:-000}"
done
if [ -n "${SSH:-}" ]; then
    deploy_key
    for name in $(hzj server list | jq -r '.[] | select(.labels.app=="bunker707") | .name'); do
        ip=$(server_ip4 "$name"); target="$DEPLOY_USER@$ip"
        log "$name por SSH"
        fw_open_ssh "$name"; wait_ssh "$target" 10
        rsh "$target" "cd '$REMOTE_DIR' 2>/dev/null && cat .deployed-commit 2>/dev/null; docker ps --format '  {{.Names}}\t{{.Status}}'; free -h | sed 's/^/  /'; df -h / | sed 's/^/  /'; for f in /var/backups/bunker707/ultimo-sucesso /var/backups/bunker707-mautic/ultimo-sucesso; do [ -f \$f ] && echo \"  ultimo backup (\$f): \$(cat \$f)\"; done; echo '  transfer.pub (base64):'; sudo base64 -w0 /etc/bunker707/transfer.pub 2>/dev/null; echo"
        fw_close_all
    done
fi

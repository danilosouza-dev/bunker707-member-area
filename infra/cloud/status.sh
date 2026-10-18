#!/usr/bin/env bash
# Estado da infraestrutura (nao muda nada alem de, com SSH=1, abrir e fechar a porta 22 para ler o servidor):
#   bash infra/cloud/status.sh            servidores, Storage Box, DNS, respostas publicas
#   SSH=1 bash infra/cloud/status.sh      + containers, disco, memoria, ultimo backup, transfer.pub
. "$(dirname -- "$0")/lib.sh"
need HCLOUD_TOKEN; install_hcloud
log "Servidores"
hzj server list | jq -r '.[] | select(.labels.app=="bunker707") | "  \(.name): \(.server_type.name) em \(.datacenter.location.name), \(.public_net.ipv4.ip), \(.status), criado \(.created[:10])"'
log "Storage Box"
box=$(storage_box_json); [ -n "$box" ] && printf '%s' "$box" | jq -r '"  \(.name): \(.storage_box_type.name // .type // "?"), \(.username // .user // "?")@\(.server // .host // "?"), usado \((.stats.size // 0)/1024/1024/1024*100|round/100) GB"' || echo "  (nenhum)"
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    log "DNS em $ZONE_NAME"
    zone=$(cf_zone_id)
    cf_api GET "/zones/$zone/dns_records?per_page=100" | jq -r --arg z ".$ZONE_NAME" '.result[] | select(.name | test("^(membros|api|studio|marketing)")) | "  \(.name) \(.type) \(.content) proxy=\(.proxied)"'
fi
log "Respostas publicas"
for u in "https://$APP_DOMAIN/api/health" "https://$APP_DOMAIN/" "https://$API_DOMAIN/auth/v1/health" "https://$MAUTIC_DOMAIN/s/login"; do
    printf '  %-55s %s\n' "$u" "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$u" 2>/dev/null || echo 000)"
done
if [ -n "${SSH:-}" ]; then
    deploy_key
    for name in $(hzj server list | jq -r '.[] | select(.labels.app=="bunker707") | .name'); do
        ip=$(server_ip4 "$name"); target="$DEPLOY_USER@$ip"
        log "$name por SSH"
        fw_open_ssh "$name"; wait_ssh "$target" 10
        rsh "$target" "cd '$REMOTE_DIR' 2>/dev/null && cat .deployed-commit 2>/dev/null; docker ps --format '  {{.Names}}\t{{.Status}}'; free -h | sed 's/^/  /'; df -h / | sed 's/^/  /'; for f in /var/backups/bunker707/ultimo-sucesso /var/backups/bunker707-mautic/ultimo-sucesso; do [ -f \$f ] && echo \"  ultimo backup (\$f): \$(cat \$f)\"; done; echo '  transfer.pub (base64):'; sudo base64 -w0 /etc/bunker707/transfer.pub; echo"
        fw_close_all
    done
fi

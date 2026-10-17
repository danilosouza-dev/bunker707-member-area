#!/usr/bin/env bash
# Faixas de IP da Cloudflare (https://www.cloudflare.com/ips), para o firewall da Hetzner e o Caddy:
#   sh infra/scripts/cloudflare-ips.sh            uma faixa por linha (v4 e v6)
#   sh infra/scripts/cloudflare-ips.sh --caddy    linha `trusted_proxies static ...` para o Caddyfile
#   sh infra/scripts/cloudflare-ips.sh --json     array JSON
set -euo pipefail

v4=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4)
v6=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6)
[ -n "$v4" ] && [ -n "$v6" ] || { echo "Lista da Cloudflare veio vazia." >&2; exit 1; }

case "${1:-}" in
    --caddy)
        echo "# Faixas de IP da Cloudflare (https://www.cloudflare.com/ips), para o Caddy confiar no CF-Connecting-IP"
        echo "# so quando a conexao vem da Cloudflare. Atualize com: sh infra/scripts/cloudflare-ips.sh --caddy > infra/compose/caddy/cloudflare-trusted-proxies.caddyfile"
        echo "# Copiado em $(date -u +%Y-%m-%d)."
        printf 'trusted_proxies static'
        for ip in $v4 $v6; do printf ' %s' "$ip"; done
        echo ;;
    --json)
        printf '%s\n%s\n' "$v4" "$v6" | python3 -I -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))' ;;
    "")
        printf '%s\n%s\n' "$v4" "$v6" ;;
    *) echo "uso: cloudflare-ips.sh [--caddy|--json]" >&2; exit 2 ;;
esac

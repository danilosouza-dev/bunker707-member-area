#!/usr/bin/env bash
# Firewall da Hetzner Cloud para o servidor da Bunker707, pela CLI hcloud (roda na SUA maquina, com
# HCLOUD_TOKEN no ambiente; nada roda no servidor):
#   sh infra/scripts/hetzner-firewall.sh --server bunker707-prod --admin-ip 203.0.113.10
#   sh infra/scripts/hetzner-firewall.sh --server bunker707-prod --admin-ip auto      # usa o IP publico atual
#   ... [--name bunker707-fw] [--ssh-port 22] [--dry-run]
# Regras (tudo o mais fica fechado na borda da Hetzner, antes do ufw):
#   - TCP 22 (ou --ssh-port) so do IP do produtor;
#   - TCP 80 e 443 so das faixas da Cloudflare (v4 e v6), que fica na frente do dominio;
#   - ICMP de qualquer lugar (ping do monitor).
# Idempotente: cria o firewall se nao existir, SUBSTITUI o conjunto de regras e aplica ao servidor.
# Quando o IP do produtor mudar, rode de novo. Nao cria servidor e nao mexe em nada cobrado.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

set -euo pipefail
here=$(cd -- "$(dirname -- "$0")" && pwd)

server=""; admin_ip=""; name="bunker707-fw"; ssh_port="22"; dry_run=0
while [ $# -gt 0 ]; do
    case "$1" in
        --server) server="$2"; shift ;;
        --admin-ip) admin_ip="$2"; shift ;;
        --name) name="$2"; shift ;;
        --ssh-port) ssh_port="$2"; shift ;;
        --dry-run) dry_run=1 ;;
        -h|--help) sed -n 2,13p "$0"; exit 0 ;;
        *) echo "opcao desconhecida: $1" >&2; exit 2 ;;
    esac
    shift
done
[ -n "$server" ] || { echo "Informe --server <nome do servidor na Hetzner>." >&2; exit 2; }
[ -n "$admin_ip" ] || { echo "Informe --admin-ip <IP do produtor> (ou auto)." >&2; exit 2; }
if [ "$dry_run" != "1" ]; then
    command -v hcloud >/dev/null 2>&1 || { echo "Instale a CLI hcloud (brew install hcloud) e exporte HCLOUD_TOKEN." >&2; exit 1; }
    [ -n "${HCLOUD_TOKEN:-}" ] || hcloud context active >/dev/null 2>&1 || { echo "Exporte HCLOUD_TOKEN ou crie um contexto (hcloud context create)." >&2; exit 1; }
fi

if [ "$admin_ip" = "auto" ]; then
    admin_ip=$(curl -fsS --max-time 10 https://api.ipify.org)
    echo "IP publico atual: $admin_ip"
fi
case "$admin_ip" in
    */*) admin_cidr="$admin_ip" ;;
    *:*) admin_cidr="$admin_ip/128" ;;
    *) admin_cidr="$admin_ip/32" ;;
esac

cf_json=$(bash "$here/cloudflare-ips.sh" --json)
rules_file=$(mktemp)
trap 'rm -f "$rules_file"' EXIT
python3 -I - "$admin_cidr" "$ssh_port" "$cf_json" > "$rules_file" <<'PY'
import json, sys
admin, ssh_port, cf = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
v4 = [ip for ip in cf if ":" not in ip]
v6 = [ip for ip in cf if ":" in ip]
rules = [
    {"direction": "in", "protocol": "tcp", "port": ssh_port, "source_ips": [admin], "description": "SSH so do produtor"},
    {"direction": "in", "protocol": "tcp", "port": "80", "source_ips": v4, "description": "HTTP so da Cloudflare (v4)"},
    {"direction": "in", "protocol": "tcp", "port": "80", "source_ips": v6, "description": "HTTP so da Cloudflare (v6)"},
    {"direction": "in", "protocol": "tcp", "port": "443", "source_ips": v4, "description": "HTTPS so da Cloudflare (v4)"},
    {"direction": "in", "protocol": "tcp", "port": "443", "source_ips": v6, "description": "HTTPS so da Cloudflare (v6)"},
    {"direction": "in", "protocol": "icmp", "source_ips": ["0.0.0.0/0", "::/0"], "description": "ping do monitor"},
]
print(json.dumps(rules, indent=2))
PY

if [ "$dry_run" = "1" ]; then
    echo "Regras que seriam aplicadas ao firewall '$name' do servidor '$server':"
    cat "$rules_file"
    exit 0
fi

if ! hcloud firewall describe "$name" >/dev/null 2>&1; then
    echo "Criando o firewall $name..."
    hcloud firewall create --name "$name" --label app=bunker707 >/dev/null
fi
echo "Substituindo as regras..."
hcloud firewall replace-rules "$name" --rules-file "$rules_file"
if hcloud firewall describe "$name" -o json | python3 -I -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if any(a.get("type")=="server" and (a.get("server") or {}).get("name")==sys.argv[1] for a in d.get("applied_to",[])) else 1)' "$server"; then
    echo "Firewall ja aplicado a $server."
else
    echo "Aplicando ao servidor $server..."
    hcloud firewall apply-to-resource "$name" --type server --server "$server"
fi
hcloud firewall describe "$name"

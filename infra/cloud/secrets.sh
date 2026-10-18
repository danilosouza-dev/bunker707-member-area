#!/usr/bin/env bash
# Entrega segredos externos (chave do Resend etc.) ao .env de um papel, a partir de um envelope cifrado
# para o servidor (infra/cloud/envelope.sh encrypt), e recria os servicos que mudaram:
#   PAYLOAD='<base64>' bash infra/cloud/secrets.sh membros|marketing
# O payload nunca e legivel fora do servidor; as chaves aplicadas sao listadas sem os valores.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/lib.sh"
role="${1:-}"; [ "$role" = "membros" ] || [ "$role" = "marketing" ] || die "uso: secrets.sh membros|marketing"
need HCLOUD_TOKEN PAYLOAD
install_hcloud; deploy_key
if [ "$role" = "membros" ] || [ -n "${SKIP_MARKETING:-}" ]; then server="$MEMBROS_NAME"; else server="$MARKETING_NAME"; fi
ip=$(server_ip4 "$server"); target="$DEPLOY_USER@$ip"
if [ "$role" = "membros" ]; then envf="$REMOTE_DIR/infra/compose/.env"; else envf="$REMOTE_DIR/infra/mautic/.env"; fi

fw_open_ssh "$server"; wait_ssh "$target"
printf '%s' "$PAYLOAD" | rsh "$target" "cat > /tmp/payload.b64"
rsh "$target" "cd '$REMOTE_DIR' && sudo bash infra/cloud/envelope.sh decrypt /etc/bunker707/transfer.key /tmp/payload.b64 > /tmp/payload.kv && chmod 600 /tmp/payload.kv && rm -f /tmp/payload.b64"
keys=$(rsh "$target" "grep -oE '^[A-Z0-9_]+=' /tmp/payload.kv | tr -d = | tr '\n' ' '")
log "Aplicando em $envf: $keys"
rsh "$target" "python3 -I - '$envf' /tmp/payload.kv" <<'PY'
import os, re, sys
path, kvpath = sys.argv[1], sys.argv[2]
updates = {}
for line in open(kvpath, encoding="utf-8"):
    line = line.rstrip("\n")
    if "=" in line and re.match(r"^[A-Z0-9_]+=", line):
        k, v = line.split("=", 1); updates[k] = v
# O compose interpola os valores dentro de JSON (MAUTIC_CONFIG_PARAMETERS) e sem aspas: aspas, barra
# invertida, $ e quebra de linha quebrariam o stack. Senha SMTP com esses caracteres vai codificada na URL.
bad = [k for k, v in updates.items() if re.search(r'["\\$\n\r]', v)]
if bad:
    sys.exit("ERRO: valor com aspas, barra invertida, $ ou quebra de linha em " + ", ".join(bad) + "; codifique na URL (senha SMTP: urlencode) e gere o envelope de novo.")
lines = open(path, encoding="utf-8").read().split("\n")
seen = set()
for i, line in enumerate(lines):
    m = re.match(r"^([A-Z0-9_]+)=", line)
    if m and m.group(1) in updates:
        lines[i] = f"{m.group(1)}={updates[m.group(1)]}"; seen.add(m.group(1))
while lines and lines[-1] == "":
    lines.pop()
for k, v in updates.items():
    if k not in seen:
        lines.append(f"{k}={v}")
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh: fh.write("\n".join(lines).rstrip("\n") + "\n")
os.chmod(tmp, 0o600); os.replace(tmp, path)
os.remove(kvpath)
PY
if [ "$role" = "membros" ]; then
    rsh "$target" "cd '$REMOTE_DIR' && docker compose -f infra/compose/docker-compose.yml up -d && bash infra/scripts/smoke.sh"
else
    extra=""; [ -n "${SKIP_MARKETING:-}" ] && extra="-f infra/mautic/compose.colocado.yml"
    profile=""; [ -n "${SKIP_MARKETING:-}" ] || profile="--profile borda"
    rsh "$target" "cd '$REMOTE_DIR' && docker compose -f infra/mautic/docker-compose.yml $extra $profile up -d && ${SKIP_MARKETING:+BUNKER707_COMPOSE_OVERRIDE=$REMOTE_DIR/infra/mautic/compose.colocado.yml} bash infra/mautic/scripts/smoke.sh"
fi
log "Segredos aplicados e servicos recriados."

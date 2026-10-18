#!/usr/bin/env bash
# Contas da equipe no Auth do servidor (convite por e-mail, que sai pelo SMTP do Resend) e papel em
# public.admin_roles. Idempotente. Formato: EQUIPE="email1:owner email2:admin" (padrao: equipe atual).
#   bash infra/cloud/equipe.sh
. "$(dirname -- "$0")/lib.sh"
need HCLOUD_TOKEN; install_hcloud; deploy_key
EQUIPE="${EQUIPE:-ferramentas.bunker707@gmail.com:owner bertoldomolina8@gmail.com:admin}"
ip=$(server_ip4 "$MEMBROS_NAME"); target="$DEPLOY_USER@$ip"
fw_open_ssh "$MEMBROS_NAME"; wait_ssh "$target"
envf="$REMOTE_DIR/infra/compose/.env"
secret=$(get_env "$target" "$envf" SUPABASE_SECRET_KEY); api="http://127.0.0.1:8000"
for entry in $EQUIPE; do
    email="${entry%%:*}"; papel="${entry##*:}"
    log "$email ($papel)"
    # 1. usuario existe? (admin API do GoTrue pelo gateway, com a chave secreta)
    uid=$(rsh "$target" "curl -fsS '$api/auth/v1/admin/users?page=1&per_page=1000' -H 'apikey: $secret' -H 'Authorization: Bearer $secret' | jq -r --arg e '$email' '.users[]? | select(.email==\$e) | .id' | head -n1")
    if [ -z "$uid" ]; then
        uid=$(rsh "$target" "curl -fsS -X POST '$api/auth/v1/invite' -H 'apikey: $secret' -H 'Authorization: Bearer $secret' -H 'Content-Type: application/json' -d '{\"email\":\"$email\"}' | jq -r '.id'")
        echo "  convite enviado (id $uid)"
    else
        echo "  ja existe (id $uid)"
    fi
    # 2. papel
    rsh "$target" "cd '$REMOTE_DIR' && docker compose -f infra/compose/docker-compose.yml exec -T db psql -U postgres -v ON_ERROR_STOP=1 -q -c \"insert into public.admin_roles (user_id, role) values ('$uid', '$papel') on conflict (user_id) do update set role = excluded.role\""
    echo "  papel $papel gravado"
done

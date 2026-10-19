#!/usr/bin/env bash
# Contas da equipe no Auth do servidor (convite por e-mail, que sai pelo SMTP do Resend) e papel em
# public.admin_roles. Idempotente. Formato: EQUIPE="email1:owner,email2:admin" (virgula, porque as opcoes do
# workflow sao separadas por espaco; padrao: equipe atual).
#   bash infra/cloud/equipe.sh
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
. "$(dirname -- "$0")/lib.sh"
need HCLOUD_TOKEN; install_hcloud; deploy_key
EQUIPE="${EQUIPE:-ferramentas.bunker707@gmail.com:owner,bertoldomolina8@gmail.com:admin}"
ip=$(server_ip4 "$MEMBROS_NAME"); target="$DEPLOY_USER@$ip"
fw_open_ssh "$MEMBROS_NAME"; wait_ssh "$target"
envf="$REMOTE_DIR/infra/compose/.env"; api="http://127.0.0.1:8000"
# A chave secreta nunca sai do servidor nem entra em argv (ps, /proc): o shell remoto le do .env e entrega os
# cabecalhos ao curl por um config no stdin (-K -).
auth_curl="k=\$(grep -E '^SUPABASE_SECRET_KEY=' '$envf' | head -n1 | cut -d= -f2-) && [ -n \"\$k\" ] && printf 'header = \"apikey: %s\"\nheader = \"Authorization: Bearer %s\"\n' \"\$k\" \"\$k\" | curl -fsS -K -"
for entry in ${EQUIPE//,/ }; do
    email="${entry%%:*}"; papel="${entry##*:}"
    # Os dois vao para o comando remoto e para o SQL: so formatos conhecidos.
    [[ "$email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "e-mail invalido em EQUIPE: $email"
    case "$papel" in owner|admin|editor|instructor|support|analyst) ;; *) die "papel invalido em EQUIPE: $papel" ;; esac
    log "$email ($papel)"
    # 1. usuario existe? (admin API do GoTrue pelo gateway, com a chave secreta). Quem existe mas ainda nao
    # confirmou o e-mail (convite nao usado) recebe o convite de novo, com o modelo atual.
    found=$(rsh "$target" "$auth_curl '$api/auth/v1/admin/users?page=1&per_page=1000' | jq -r --arg e '$email' '.users[]? | select(.email==\$e) | \"\\(.id) \\(.email_confirmed_at // \"pendente\")\"' | head -n1")
    uid="${found%% *}"; confirmed="${found#* }"
    if [ -z "$uid" ] || [ "$confirmed" = "pendente" ]; then
        uid=$(rsh "$target" "$auth_curl -X POST '$api/auth/v1/invite' -H 'Content-Type: application/json' -d '{\"email\":\"$email\"}' | jq -r '.id'" || true)
        [ -n "$uid" ] && [ "$uid" != "null" ] || die "Convite para $email nao foi aceito pelo Auth (SMTP configurado? rode secrets-membros antes; veja: docker compose logs auth)."
        if [ -z "$found" ]; then echo "  convite enviado (id $uid)"; else echo "  convite reenviado: ainda nao tinha confirmado (id $uid)"; fi
    else
        echo "  ja existe e ja entrou (id $uid)"
    fi
    # 2. papel
    rsh "$target" "cd '$REMOTE_DIR' && docker compose -f infra/compose/docker-compose.yml exec -T db psql -U postgres -v ON_ERROR_STOP=1 -q -c \"insert into public.admin_roles (user_id, role) values ('$uid', '$papel') on conflict (user_id) do update set role = excluded.role\""
    echo "  papel $papel gravado"
done

#!/usr/bin/env bash
# Recria os servidores a partir do snapshot mais recente de cada papel (snapshot.sh) e refaz o DNS.
#   bash infra/cloud/restaurar.sh
# Tipo: MEMBROS_TYPE/MARKETING_TYPE nas opcoes, ou o mais barato do plan. O servidor volta com tudo
# (banco, .env, certificados, chave de transferencia); so o IP muda, e os quatro registros sao refeitos.
# Depois: etapa status (e status-ssh). Nao precisa de deploy de novo.

. "$(dirname -- "$0")/lib.sh"
need HCLOUD_TOKEN CLOUDFLARE_API_TOKEN
install_hcloud; deploy_key

if [ -z "${MEMBROS_TYPE:-}" ] || { [ -z "${SKIP_MARKETING:-}" ] && [ -z "${MARKETING_TYPE:-}" ]; }; then
    bash "$CLOUD_DIR/plan.sh"
    # shellcheck disable=SC1091
    . "$WORK_DIR/plan.env"
fi
roles="membros"; [ -n "${SKIP_MARKETING:-}" ] || roles="membros marketing"
for role in $roles; do
    case "$role" in
        membros) name="$MEMBROS_NAME"; type="$MEMBROS_TYPE"; loc="${MEMBROS_LOCATION:-$LOCATION}" ;;
        marketing) name="$MARKETING_NAME"; type="$MARKETING_TYPE"; loc="${MARKETING_LOCATION:-$LOCATION}" ;;
    esac
    log "Servidor $name"
    if server_exists "$name"; then echo "  ja existe; nada a restaurar."; continue; fi
    img=$(hzj image list --type snapshot | jq -r --arg r "$role" '[.[] | select(.labels.app=="bunker707" and .labels.papel==$r and .status=="available")] | sort_by(.created) | last | .id // empty')
    [ -n "$img" ] || die "Nenhum snapshot do papel $role (labels app=bunker707, papel=$role). Sem snapshot, o caminho e provision + deploy."
    echo "  snapshot $img: $(hzj image describe "$img" | jq -r .description)"
    fw_ensure "$name"
    created=0
    for l in "$loc" $FALLBACK_LOCATIONS; do
        echo "  criando $name ($type) em $l a partir do snapshot..."
        if hz server create --name "$name" --type "$type" --image "$img" --location "$l" --ssh-key "$SSH_KEY_NAME" \
            --firewall "$(fw_name "$name")" --label app=bunker707 --label papel="$role" >/dev/null 2>"$WORK_DIR/restore-$name.err"; then created=1; break; fi
        grep -qiE 'unavailable|not available|resource_limit|capacity' "$WORK_DIR/restore-$name.err" || { cat "$WORK_DIR/restore-$name.err" >&2; die "Falha ao criar $name."; }
        warn "$type indisponivel em $l"
    done
    [ "$created" = "1" ] || die "Nenhum local tem $type disponivel; force outro tipo com MEMBROS_TYPE/MARKETING_TYPE."
    fw_apply "$name"
    ip=$(server_ip4 "$name")
    fw_open_ssh "$name"; wait_ssh "$DEPLOY_USER@$ip"
    rsh "$DEPLOY_USER@$ip" "cd '$REMOTE_DIR' && docker ps --format '  {{.Names}}\t{{.Status}}' | head -n 25"
    fw_close_all
done

log "DNS e TLS"
cf_apply_dns
log "Pronto. Os certificados e os dados vieram no snapshot; rode a etapa status (e status-ssh) para conferir."

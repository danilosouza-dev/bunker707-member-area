#!/usr/bin/env bash
# Cria (ou confere) toda a infraestrutura da Bunker707 na Hetzner e na Cloudflare, do zero, sem passos
# manuais. Idempotente: rodar de novo so completa o que faltar.
#   bash infra/cloud/provision.sh
# Variaveis: HCLOUD_TOKEN, CLOUDFLARE_API_TOKEN, e as de lib.sh (LOCATION, PRODUCER_EMAIL, PRODUCER_IP,
# SKIP_MARKETING, MEMBROS_TYPE, MARKETING_TYPE). Sem *_TYPE, usa a escolha mais barata de plan.sh.
# Etapas: chave SSH no projeto -> firewalls -> servidores (cloud-init) -> Storage Box -> bootstrap por SSH
# (infra/scripts/bootstrap.sh) + chave de transferencia de segredos -> DNS e TLS na Cloudflare -> resumo.
# Custa dinheiro a partir do minuto em que o servidor existe (docs/19).
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/lib.sh"
need HCLOUD_TOKEN CLOUDFLARE_API_TOKEN
install_hcloud
deploy_key

# ---- 1. chave SSH do projeto ------------------------------------------------------------------------
log "1/7 Chave SSH '$SSH_KEY_NAME' no projeto da Hetzner"
pub=$(deploy_public_key)
if hzj ssh-key describe "$SSH_KEY_NAME" >/dev/null 2>&1; then
    if [ "$(hzj ssh-key describe "$SSH_KEY_NAME" | jq -r .public_key | awk '{print $2}')" != "$(printf '%s' "$pub" | awk '{print $2}')" ]; then
        die "A chave '$SSH_KEY_NAME' na Hetzner e diferente da derivada do HCLOUD_TOKEN atual (o token mudou?). Veja docs/20, 'Sessao na nuvem', antes de continuar."
    fi
    echo "  ja existe e confere."
else
    hz ssh-key create --name "$SSH_KEY_NAME" --public-key "$pub" --label app=bunker707 >/dev/null
    echo "  criada."
fi

# ---- 2. tipos e locais -------------------------------------------------------------------------------
log "2/7 Tipos de servidor"
if [ -z "${MEMBROS_TYPE:-}" ] || { [ -z "${SKIP_MARKETING:-}" ] && [ -z "${MARKETING_TYPE:-}" ]; }; then
    bash "$CLOUD_DIR/plan.sh"
    # shellcheck disable=SC1091
    . "$WORK_DIR/plan.env"
fi
MEMBROS_LOCATION="${MEMBROS_LOCATION:-$LOCATION}"; MARKETING_LOCATION="${MARKETING_LOCATION:-$LOCATION}"
roles="membros"; [ -n "${SKIP_MARKETING:-}" ] || roles="membros marketing"

# ---- 3. firewalls e servidores -----------------------------------------------------------------------
create_server() {  # create_server NOME TIPO LOCAL PAPEL
    local name="$1" type="$2" loc="$3" role="$4" ud l
    ud="$WORK_DIR/cloud-init-$name.yaml"
    sed -e "s|__DEPLOY_USER__|$DEPLOY_USER|" -e "s|__SSH_PUBLIC_KEY__|$pub|" "$CLOUD_DIR/cloud-init.yaml" > "$ud"
    for l in "$loc" $FALLBACK_LOCATIONS; do
        echo "  criando $name ($type) em $l..."
        if hz server create --name "$name" --type "$type" --image ubuntu-24.04 --location "$l" \
            --ssh-key "$SSH_KEY_NAME" --firewall "$(fw_name "$name")" --user-data-from-file "$ud" \
            --label app=bunker707 --label papel="$role" >/dev/null 2>"$WORK_DIR/create-$name.err"; then
            return 0
        fi
        if grep -qiE 'unavailable|not available|resource_limit|capacity' "$WORK_DIR/create-$name.err"; then
            warn "$type indisponivel em $l: $(tr -d '\n' < "$WORK_DIR/create-$name.err" | cut -c1-160)"
            continue
        fi
        cat "$WORK_DIR/create-$name.err" >&2
        die "Falha ao criar $name."
    done
    die "Nenhum local tem $type disponivel para esta conta. Rode plan.sh e force outro tipo (MEMBROS_TYPE/MARKETING_TYPE)."
}
for role in $roles; do
    case "$role" in
        membros) name="$MEMBROS_NAME"; type="$MEMBROS_TYPE"; loc="$MEMBROS_LOCATION" ;;
        marketing) name="$MARKETING_NAME"; type="$MARKETING_TYPE"; loc="$MARKETING_LOCATION" ;;
    esac
    log "3/7 Servidor $name"
    fw_ensure "$name"
    if server_exists "$name"; then
        echo "  ja existe: $(hzj server describe "$name" | jq -r '"\(.server_type.name) em \((.location.name // .datacenter.location.name)), \(.status)"')"
    else
        create_server "$name" "$type" "$loc" "$role"
    fi
    fw_apply "$name"
    hz server poweron "$name" >/dev/null 2>&1 || true
done

# ---- 4. Storage Box ------------------------------------------------------------------------------
log "4/7 Storage Box $STORAGE_BOX_NAME ($STORAGE_BOX_TYPE)"
# A chave de backup (SFTP no Storage Box) e derivada do mesmo token, como a de deploy, com outro proposito:
# nasce igual em toda rodada, entra no box na criacao e e instalada nos servidores sempre (um servidor
# recriado depois tambem a recebe).
backup_key="$WORK_DIR/storagebox_key"
node "$CLOUD_DIR/deploy-key.mjs" --out "$backup_key" --info bunker707-backup-key-v1 >/dev/null
if [ -z "$(storage_box_json)" ]; then
    # A API exige maiuscula, minuscula, numero e um especial (lista da Hetzner, que inclui o hifen).
    box_password="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)Aa1-"; mask "$box_password"
    hz storage-box create --name "$STORAGE_BOX_NAME" --type "$STORAGE_BOX_TYPE" --location "$STORAGE_BOX_LOCATION" \
        --password "$box_password" --enable-ssh --reachable-externally --ssh-key "$(cat "$backup_key.pub")" \
        --label app=bunker707 >/dev/null
    echo "  criado (SSH ligado, acessivel de fora, chave de backup instalada)."
else
    echo "  ja existe (a chave de backup e a derivada do token; se o box foi criado com outra, veja docs/20 §10)."
fi
# Snapshots diarios do proprio box: a chave SFTP esta nos dois servidores, e um deles comprometido poderia
# apagar os backups do outro; snapshot do box nao se apaga por SFTP.
hz storage-box enable-snapshot-plan "$STORAGE_BOX_NAME" --max-snapshots 7 --hour 5 --minute 20 >/dev/null \
    && echo "  plano de snapshots do box: diario, 7 guardados." || warn "plano de snapshots do Storage Box nao ativado."
box=$(storage_box_json)
STORAGE_BOX_USER=$(printf '%s' "$box" | jq -r '.username // .user // empty'); STORAGE_BOX_HOST=$(printf '%s' "$box" | jq -r '.server // .host // empty')
[ -n "$STORAGE_BOX_USER" ] && [ -n "$STORAGE_BOX_HOST" ] || warn "nao li usuario/host do Storage Box no JSON; anote de 'hcloud storage-box describe $STORAGE_BOX_NAME'."
echo "  usuario $STORAGE_BOX_USER em $STORAGE_BOX_HOST (porta 23)"

# ---- 5. bootstrap por SSH -------------------------------------------------------------------------
for role in $roles; do
    case "$role" in membros) name="$MEMBROS_NAME" ;; marketing) name="$MARKETING_NAME" ;; esac
    log "5/7 Bootstrap do $name"
    ip=$(server_ip4 "$name")
    fw_open_ssh "$name"
    wait_ssh "root@$ip"
    # O cloud-init do primeiro boot ainda esta instalando pacotes quando o SSH abre: esperar, senao o apt
    # do bootstrap disputa a trava do dpkg.
    rsh "root@$ip" "cloud-init status --wait >/dev/null 2>&1 || true"
    rcopy "$REPO_ROOT/infra/scripts/bootstrap.sh" "root@$ip:/root/bootstrap.sh"
    rsh "root@$ip" "SSH_PUBLIC_KEY='$pub' DEPLOY_USER='$DEPLOY_USER' REPO_DIR='$REMOTE_DIR' bash /root/bootstrap.sh" | tail -n 15
    # Chave RSA para receber segredos (chave do Resend etc.) cifrados pela sessao do Claude: so o servidor abre.
    rsh "root@$ip" "install -d -m 700 /etc/bunker707 && [ -f /etc/bunker707/transfer.key ] || { openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out /etc/bunker707/transfer.key && chmod 600 /etc/bunker707/transfer.key && openssl pkey -in /etc/bunker707/transfer.key -pubout -out /etc/bunker707/transfer.pub; }"
    rsh "root@$ip" "chown -R '$DEPLOY_USER:$DEPLOY_USER' '$REMOTE_DIR'"
    rsh "root@$ip" "install -d -m 700 -o '$DEPLOY_USER' -g '$DEPLOY_USER' /home/$DEPLOY_USER/.ssh && cat > /home/$DEPLOY_USER/.ssh/id_ed25519_storagebox && chmod 600 /home/$DEPLOY_USER/.ssh/id_ed25519_storagebox && chown '$DEPLOY_USER:$DEPLOY_USER' /home/$DEPLOY_USER/.ssh/id_ed25519_storagebox" < "$backup_key"
    rsh "root@$ip" "cat > /home/$DEPLOY_USER/.ssh/id_ed25519_storagebox.pub && chown '$DEPLOY_USER:$DEPLOY_USER' /home/$DEPLOY_USER/.ssh/id_ed25519_storagebox.pub" < "$backup_key.pub"
    echo "  chave de backup instalada em ~$DEPLOY_USER/.ssh/id_ed25519_storagebox"
    wait_ssh "$DEPLOY_USER@$ip" 10
    echo "  transfer.pub ($name), base64 numa linha (para infra/cloud/envelope.sh):"
    rsh "root@$ip" "base64 -w0 /etc/bunker707/transfer.pub"; echo
    fw_close_all
done
rm -f "$backup_key" "$backup_key.pub"

# ---- 6. DNS e TLS na Cloudflare ------------------------------------------------------------------------
log "6/7 DNS em $ZONE_NAME (proxied) e TLS"
cf_apply_dns

# ---- 7. resumo -----------------------------------------------------------------------------------
log "7/7 Resumo"
for role in $roles; do
    case "$role" in membros) name="$MEMBROS_NAME" ;; marketing) name="$MARKETING_NAME" ;; esac
    hzj server describe "$name" | jq -r '"  \(.name): \(.server_type.name) em \((.location.name // .datacenter.location.name)), \(.public_net.ipv4.ip), \(.status)"'
done
echo "  Storage Box: $STORAGE_BOX_USER@$STORAGE_BOX_HOST"
if [ -n "${SKIP_MARKETING:-}" ]; then mautic_host="$MEMBROS_NAME"; else mautic_host="$MARKETING_NAME"; fi
echo "  DNS: $APP_DOMAIN, $API_DOMAIN, $STUDIO_DOMAIN -> $MEMBROS_NAME; $MAUTIC_DOMAIN -> $mautic_host"
echo "Proximo: etapa deploy-membros (e deploy-marketing), depois secrets-* com o envelope da chave do Resend."

#!/usr/bin/env bash
# Guarda os servidores em snapshot e os apaga, para nao pagar servidor parado (a Hetzner cobra servidor
# desligado por inteiro; snapshot custa EUR 0,0143 por GB comprimido por mes). Os registros DNS dos quatro
# nomes sao apagados. Firewalls, chave SSH e Storage Box ficam (APAGAR_STORAGE_BOX=1 apaga o box tambem:
# os backups vao junto).
#   CONFIRMAR=apagar bash infra/cloud/snapshot.sh
# Para voltar: restaurar.sh (servidor novo a partir do snapshot mais recente de cada papel, DNS refeito).
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/lib.sh"
need HCLOUD_TOKEN CLOUDFLARE_API_TOKEN
[ "${CONFIRMAR:-}" = "apagar" ] || die "Esta etapa APAGA os servidores depois do snapshot. Confirme com CONFIRMAR=apagar nas opcoes."
install_hcloud

stamp=$(date -u +%Y%m%dT%H%M)
for role in membros marketing; do
    case "$role" in membros) name="$MEMBROS_NAME" ;; marketing) name="$MARKETING_NAME" ;; esac
    server_exists "$name" || { echo "  $name nao existe; nada a guardar."; continue; }
    log "Snapshot de $name"
    hz server poweroff "$name" >/dev/null 2>&1 || true
    # `server create-image` nao aceita -o json na CLI 1.70.1: cria (a CLI espera a acao) e acha a imagem
    # pela descricao na lista.
    desc="bunker707-$role-$stamp"
    hz server create-image "$name" --type snapshot --description "$desc" --label app=bunker707 --label papel="$role" --label origem="$name"
    img=$(hzj image list --type snapshot --selector "app=bunker707,papel=$role" | jq -r --arg d "$desc" '.[] | select(.description==$d) | .id' | head -n1)
    [ -n "$img" ] || die "Snapshot de $name nao apareceu em 'hcloud image list --type snapshot' (descricao $desc). O servidor esta desligado: ligue com 'hcloud server poweron $name' ou tente de novo."
    for ((i = 0; i < 120; i++)); do
        st=$(hzj image describe "$img" | jq -r .status); [ "$st" = "available" ] && break; sleep 10
    done
    hzj image describe "$img" | jq -r '"  snapshot \(.id) (\(.description)): \(.image_size // 0 | . * 100 | round / 100) GB comprimidos, status \(.status)"'
    [ "$(hzj image describe "$img" | jq -r .status)" = "available" ] || die "Snapshot $img nao ficou disponivel."
    log "Apagando o servidor $name (o snapshot $img fica)"
    hz server delete "$name"
done

log "Apagando os registros DNS"
cf_remove_dns
if [ -n "${APAGAR_STORAGE_BOX:-}" ] && [ -n "$(storage_box_json)" ]; then
    log "Apagando o Storage Box $STORAGE_BOX_NAME (com os backups)"
    hz storage-box delete "$STORAGE_BOX_NAME"
fi
log "Snapshots guardados"
hzj image list --type snapshot | jq -r '.[] | select(.labels.app=="bunker707") | "  \(.id)  \(.description)  \(.image_size // 0 | . * 100 | round / 100) GB  criado \(.created[:16])"'
echo "Custo: EUR 0,0143 por GB comprimido por mes (precos de docs/19). Para voltar: etapa restaurar."

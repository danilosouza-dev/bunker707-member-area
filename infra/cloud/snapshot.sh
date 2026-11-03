#!/usr/bin/env bash
# Guarda a producao em snapshot e apaga os servidores, para nao pagar servidor parado: a Hetzner cobra o servidor
# desligado por inteiro, e o snapshot custa EUR 0,0143 por GB comprimido por mes (docs/19 §3.2). Decisao de
# 03/11/2026 (docs/20 §4A.7): enquanto a producao so servir para a equipe testar, ela fica guardada e volta pelo
# restaurar.sh quando for preciso, como o gravador por hora.
#   CONFIRMAR=apagar bash infra/cloud/snapshot.sh
# Papeis: membros (A, app + Supabase), marketing (B, Mautic) e meet (C, Jitsi); PAPEIS="meet" guarda so os pedidos.
# Para cada papel que existe, na ordem:
#   1. backup novo no Storage Box (A e B; SEM_BACKUP=1 pula): se falhar, para antes de apagar qualquer coisa;
#   2. desliga pelo sistema (o Postgres fecha limpo; energia cortada so se nao responder);
#   3. snapshot com o tipo e o local de origem nas labels (o restaurar volta no mesmo tipo);
#   4. apaga o servidor so com o snapshot disponivel (e protegido contra exclusao), e os registros DNS do papel;
#      se o snapshot nao ficar pronto, nada e apagado e o servidor volta a ligar;
#   5. fica com os MANTER_SNAPSHOTS (2) mais novos do papel; os mais velhos sao apagados.
# Firewalls, chave SSH e Storage Box ficam (APAGAR_STORAGE_BOX=1 apaga o box tambem: os backups vao junto).
# Com um gravador (Jibri) vivo o C nao e guardado: ha uma live usando a sala (FORCAR=1 passa por cima).
# Para voltar: restaurar.sh.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/lib.sh"
need HCLOUD_TOKEN CLOUDFLARE_API_TOKEN
[ "${CONFIRMAR:-}" = "apagar" ] || die "Esta etapa APAGA os servidores depois do snapshot. Confirme com CONFIRMAR=apagar nas opcoes."
roles=$(guard_roles)
keep="${MANTER_SNAPSHOTS:-2}"
case "$keep" in ""|*[!0-9]*|0) die "MANTER_SNAPSHOTS precisa ser um numero de 1 para cima (veio: $keep)." ;; esac
case "${SEM_BACKUP:-}" in 1|sim|true) skip_backup=1 ;; *) skip_backup="" ;; esac
case "${FORCAR:-}" in 1|sim|true) forced=1 ;; *) forced="" ;; esac
install_hcloud
has_role() { case " $roles " in *" $1 "*) return 0 ;; esac; return 1; }

log "Producao a guardar: $roles"
if has_role meet && server_exists "$MEET_NAME"; then
    live=$(hzj server list --selector papel=jibri | jq -r '.[].name' | tr '\n' ' ')
    if [ -n "${live// /}" ]; then
        [ -n "$forced" ] || die "Gravador vivo (${live% }): ha uma live usando o $MEET_NAME. Rode jibri-down depois da live, ou FORCAR=1 para guardar mesmo assim."
        warn "gravador vivo (${live% }) e FORCAR=1: o $MEET_NAME sera guardado mesmo assim (o gravador continua cobrando por hora)."
    fi
fi

# ---- 1. backup novo antes de qualquer imagem ------------------------------------------------------------
for role in $roles; do
    case "$role" in
        membros) unit=bunker707-backup.service; mark=/var/backups/bunker707/ultimo-sucesso ;;
        marketing) unit=bunker707-mautic-backup.service; mark=/var/backups/bunker707-mautic/ultimo-sucesso ;;
        *) continue ;;  # o C nao guarda dado de aluno (docs/20 §8B.1)
    esac
    name=$(role_server "$role")
    server_exists "$name" || continue
    if [ -n "$skip_backup" ]; then warn "SEM_BACKUP=1: $name vai para o snapshot sem backup novo no Storage Box."; continue; fi
    if [ "$(server_status "$name")" != "running" ]; then warn "$name nao esta ligado; sem backup novo (o snapshot leva o disco como esta)."; continue; fi
    deploy_key
    log "Backup do $name no Storage Box"
    ip=$(server_ip4 "$name")
    fw_open_ssh "$name"; wait_ssh "$DEPLOY_USER@$ip"
    rsh "$DEPLOY_USER@$ip" "sudo systemctl start '$unit' && echo \"  ultimo backup: \$(cat '$mark' 2>/dev/null)\"" \
        || die "O backup do $name falhou; nada foi apagado. Confira com exec-$role ('sudo journalctl -u $unit -n 30 --no-pager') ou rode de novo com SEM_BACKUP=1."
    fw_close_all
done

# ---- 2 a 5. desligar, snapshot, apagar, DNS, snapshots antigos ------------------------------------------
stamp=$(date -u +%Y%m%dT%H%M)
for role in $roles; do
    name=$(role_server "$role")
    server_exists "$name" || { echo "  $name nao existe; nada a guardar."; continue; }
    info=$(hzj server describe "$name")
    type=$(printf '%s' "$info" | jq -r '.server_type.name')
    loc=$(printf '%s' "$info" | jq -r '.location.name // .datacenter.location.name')
    log "Snapshot de $name ($type em $loc)"
    server_shutdown "$name"
    # `server create-image` nao aceita -o json na CLI 1.70.1: cria (a CLI espera a acao) e acha a imagem
    # pela descricao na lista.
    desc="bunker707-$role-$stamp"
    hz server create-image "$name" --type snapshot --description "$desc" --label app=bunker707 --label papel="$role" --label origem="$name" --label tipo="$type" --label local="$loc"
    img=$(hzj image list --type snapshot --selector "app=bunker707,papel=$role" | jq -r --arg d "$desc" '.[] | select(.description==$d) | .id' | head -n1)
    [ -n "$img" ] || die "Snapshot de $name nao apareceu em 'hcloud image list --type snapshot' (descricao $desc). O servidor esta desligado: ligue com 'hcloud server poweron $name' ou tente de novo."
    for ((i = 0; i < ${SNAPSHOT_WAIT_TRIES:-120}; i++)); do  # ate 20 min por imagem
        st=$(hzj image describe "$img" | jq -r .status); [ "$st" = "available" ] && break; sleep 10
    done
    hzj image describe "$img" | jq -r '"  snapshot \(.id) (\(.description)): \(.image_size // 0 | . * 100 | round / 100) GB comprimidos, status \(.status)"'
    if [ "$(hzj image describe "$img" | jq -r .status)" != "available" ]; then
        # Sem imagem pronta nada e apagado, e o servidor volta a ligar: a producao fica como estava.
        hz server poweron "$name" >/dev/null 2>&1 || true
        die "Snapshot $img nao ficou disponivel; o $name NAO foi apagado e foi ligado de novo."
    fi
    # Protegido contra exclusao (console ou API): so este script tira a protecao, ao trocar por um mais novo.
    hz image enable-protection "$img" delete >/dev/null || warn "nao consegui proteger o snapshot $img contra exclusao (segue valendo)."
    log "Apagando o servidor $name (o snapshot $img fica)"
    hz server delete "$name"
    cf_remove_dns "$role"
    old=$(hzj image list --type snapshot --selector "app=bunker707,papel=$role" | jq -r --argjson k "$keep" '[.[] | select(.status=="available")] | sort_by(.created) | reverse | .[$k:] | .[] | .id')
    for id in $old; do
        hz image disable-protection "$id" delete >/dev/null 2>&1 || true
        hz image delete "$id"
        echo "  snapshot antigo $id apagado (ficam os $keep mais novos de $role)."
    done
done

if [ -n "${APAGAR_STORAGE_BOX:-}" ] && [ -n "$(storage_box_json)" ]; then
    log "Apagando o Storage Box $STORAGE_BOX_NAME (com os backups)"
    hz storage-box delete "$STORAGE_BOX_NAME"
fi
log "Snapshots guardados"
snapshots_summary
echo "Para voltar: etapa restaurar (PAPEIS=meet traz so o Jitsi); depois status e, se a main andou, deploy-membros."

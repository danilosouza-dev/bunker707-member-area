#!/usr/bin/env bash
# Ponto de entrada do workflow .github/workflows/infra.yml (e de qualquer terminal com os tokens):
#   bash infra/cloud/run.sh <etapa>
# com OPCOES="CHAVE=VALOR ..." (ex.: MEMBROS_TYPE=cx33 PRODUCER_IP=203.0.113.10 SKIP_MARKETING=1) e, nas
# etapas que precisam, PAYLOAD (envelope cifrado) ou COMANDO (exec-*). Etapas:
#   plan, provision, deploy-membros, deploy-marketing, secrets-membros, secrets-marketing, equipe,
#   status, status-ssh, backup-membros, backup-marketing, exec-membros, exec-marketing,
#   snapshot (guarda e apaga os servidores; CONFIRMAR=apagar), restaurar (recria dos snapshots),
#   fechar-ssh (passo final do workflow: fecha a 22 que um passo cancelado deixou aberta),
#   chave-backup (cadastra a senha de recuperacao derivada do token nos repositorios de backup),
#   carga (teste de carga: VUS alunos navegando pelo dominio publico; dados de teste apagados no fim)
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail
here=$(cd -- "$(dirname -- "$0")" && pwd)
etapa="${1:-}"
for kv in ${OPCOES:-}; do
    case "$kv" in
        [A-Z_]*=*) export "$kv" ;;
        *) echo "opcao ignorada (formato CHAVE=VALOR): $kv" >&2 ;;
    esac
done
exec_remote() {  # exec_remote membros|marketing: roda COMANDO como deploy em REMOTE_DIR
    . "$here/lib.sh"
    need HCLOUD_TOKEN COMANDO; install_hcloud; deploy_key
    if [ "$1" = "membros" ] || [ -n "${SKIP_MARKETING:-}" ]; then server="$MEMBROS_NAME"; else server="$MARKETING_NAME"; fi
    ip=$(server_ip4 "$server"); fw_open_ssh "$server"; wait_ssh "$DEPLOY_USER@$ip"
    rsh "$DEPLOY_USER@$ip" "cd '$REMOTE_DIR' && $COMANDO"
}
case "$etapa" in
    plan) bash "$here/plan.sh" ;;
    provision) bash "$here/provision.sh" ;;
    deploy-membros) bash "$here/deploy.sh" membros ;;
    deploy-marketing) bash "$here/deploy.sh" marketing ;;
    secrets-membros) bash "$here/secrets.sh" membros ;;
    secrets-marketing) bash "$here/secrets.sh" marketing ;;
    equipe) bash "$here/equipe.sh" ;;
    status) bash "$here/status.sh" ;;
    status-ssh) SSH=1 bash "$here/status.sh" ;;
    backup-membros) COMANDO="bash infra/scripts/backup.sh --check" exec_remote membros ;;
    backup-marketing) COMANDO="bash infra/mautic/scripts/backup.sh --check" exec_remote marketing ;;
    exec-membros) exec_remote membros ;;
    exec-marketing) exec_remote marketing ;;
    snapshot) bash "$here/snapshot.sh" ;;
    restaurar) bash "$here/restaurar.sh" ;;
    carga) bash "$here/carga.sh" ;;
    chave-backup)
        . "$here/lib.sh"; need HCLOUD_TOKEN; install_hcloud; deploy_key
        for role in membros marketing; do
            if [ "$role" = "membros" ] || [ -n "${SKIP_MARKETING:-}" ]; then server="$MEMBROS_NAME"; else server="$MARKETING_NAME"; fi
            server_exists "$server" || { echo "  $server nao existe; pulando $role."; continue; }
            ip=$(server_ip4 "$server"); fw_open_ssh "$server"; wait_ssh "$DEPLOY_USER@$ip"
            # Os scripts de backup do commit atual (o --add-key pode ser mais novo que o deploy no servidor).
            sync_repo "$DEPLOY_USER@$ip"
            log "Senha de recuperacao do backup ($role)"
            backup_recovery_key "$DEPLOY_USER@$ip" "$role"
            fw_close_all
        done ;;
    fechar-ssh)
        . "$here/lib.sh"
        [ -s "$WORK_DIR/fw-abertos" ] || { echo "Nenhuma porta 22 aberta por esta execucao."; exit 0; }
        need HCLOUD_TOKEN; install_hcloud
        FW_OPENED=$(sort -u "$WORK_DIR/fw-abertos" | tr '\n' ' ')
        fw_close_all ;;
    *) echo "etapa desconhecida: '$etapa'" >&2; sed -n 2,11p "$0"; exit 2 ;;
esac

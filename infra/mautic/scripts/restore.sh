#!/usr/bin/env bash
# Restaura um backup do Mautic (backup.sh) num servidor limpo e roda o smoke:
#   export RESTIC_REPOSITORY=sftp:storagebox:bunker707/restic-mautic RESTIC_PASSWORD=...   # ou um .env no lugar
#   sh infra/mautic/scripts/restore.sh --snapshot latest [--yes]
# Ordem: restic restore -> .env -> volumes config/ e media/ -> sobe so o MySQL -> importa o dump -> sobe o
# resto -> smoke. O MySQL precisa estar vazio (o script recusa sobrescrever sem --yes).
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/_env.sh"

snapshot="latest"; assume_yes=0
while [ $# -gt 0 ]; do
    case "$1" in
        --snapshot) snapshot="$2"; shift ;;
        --yes) assume_yes=1 ;;
        -h|--help) sed -n 2,7p "$0"; exit 0 ;;
        *) die "opcao desconhecida: $1" ;;
    esac
    shift
done
if [ -z "${RESTIC_REPOSITORY:-}" ] && [ -f "$ENV_FILE" ]; then RESTIC_REPOSITORY=$(env_value RESTIC_REPOSITORY); RESTIC_PASSWORD=$(env_value RESTIC_PASSWORD); fi
[ -n "${RESTIC_REPOSITORY:-}" ] && [ -n "${RESTIC_PASSWORD:-}" ] || die "Exporte RESTIC_REPOSITORY e RESTIC_PASSWORD (ou tenha um .env com eles)."
export RESTIC_REPOSITORY RESTIC_PASSWORD
if [ "$(id -u)" = "0" ]; then restore_root="${BUNKER707_BACKUP_DIR:-/var/backups/bunker707-mautic}/restore"; else restore_root="${BUNKER707_BACKUP_DIR:-$HOME/.bunker707-mautic-backups}/restore"; fi
target="$restore_root/$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$target"; chmod 700 "$restore_root" "$target"

restic_bin() {
    if command -v restic >/dev/null 2>&1; then restic "$@"
    else case "$RESTIC_REPOSITORY" in /*) docker run --rm -e RESTIC_REPOSITORY -e RESTIC_PASSWORD -v "$RESTIC_REPOSITORY:$RESTIC_REPOSITORY" -v "$restore_root:$restore_root" restic/restic:0.19.1 "$@" ;; *) die "restic nao encontrado (bootstrap.sh instala)." ;; esac; fi
}
confirm() { [ "$assume_yes" = "1" ] && return 0; printf '%s [s/N] ' "$1"; read -r a; case "$a" in s|S|y|Y) return 0 ;; *) die "Cancelado." ;; esac; }
copy_tree() {  # copy_tree ORIGEM DESTINO: preserva dono (www-data) mesmo sem ser root
    mkdir -p "$2"
    if cp -a "$1/." "$2/" 2>/dev/null; then return 0; fi
    sudo cp -a "$1/." "$2/"
}

log "Baixando o snapshot '$snapshot' para $target..."
restic_bin restore "$snapshot" --target "$target" --tag bunker707-mautic
dump=$(find "$target" -type f -name mautic.sql.gz | head -n1)
[ -n "$dump" ] || die "Nao achei mautic.sql.gz no snapshot."
stage=$(dirname "$dump")
restored_config=$(find "$target" -type d -path '*/volumes/config' | head -n1)
restored_media=$(find "$target" -type d -path '*/volumes/media' | head -n1)

if [ -f "$ENV_FILE" ] && ! cmp -s "$ENV_FILE" "$stage/env"; then confirm "Ja existe $ENV_FILE e ele difere do backup. Substituir?"; fi
cp "$stage/env" "$ENV_FILE"; chmod 600 "$ENV_FILE"

if docker volume inspect "$(project_name)_mautic-db-data" >/dev/null 2>&1; then
    confirm "O volume do MySQL ja existe. Apagar o banco atual e restaurar por cima?"
    compose down --remove-orphans
    docker volume rm -f "$(project_name)_mautic-db-data" >/dev/null
fi
[ -n "$restored_config" ] && { log "config/ (local.php)..."; copy_tree "$restored_config" "$COMPOSE_DIR/volumes/config"; }
[ -n "$restored_media" ] && { log "media/..."; copy_tree "$restored_media" "$COMPOSE_DIR/volumes/media"; }

log "Subindo so o MySQL..."
compose up -d mautic-db
wait_healthy mautic-db 180
log "Importando o dump..."
# Usuario, senha e banco do ambiente do container (o .env restaurado): nada de segredo na linha de comando.
gunzip -c "$dump" | compose exec -T mautic-db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -u "$MYSQL_USER" "$MYSQL_DATABASE"'
tables=$(compose exec -T mautic-db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -N -u "$MYSQL_USER" "$MYSQL_DATABASE" -e "select count(*) from information_schema.tables where table_schema = database()"' | tr -d '[:space:]')
log "Tabelas restauradas: $tables."
[ "${tables:-0}" -gt 50 ] || die "Poucas tabelas depois da importacao; veja o dump."

log "Subindo o stack completo..."
compose up -d
wait_healthy mautic 300
bash "$MAUTIC_DIR/scripts/smoke.sh"
log "Restauracao concluida. Arquivos baixados em $target (apague quando nao precisar: contem o .env)."

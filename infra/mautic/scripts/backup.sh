#!/usr/bin/env bash
# Backup diario do Mautic para o Storage Box (SFTP), criptografado com restic:
#   sh infra/mautic/scripts/backup.sh                 faz o backup (e o que o timer do systemd roda)
#   sh infra/mautic/scripts/backup.sh --init          chave SSH, alias `storagebox` e repositorio restic
#   sh infra/mautic/scripts/backup.sh --check         backup + `restic check`
#   sh infra/mautic/scripts/backup.sh --install-timer instala o timer (03:50 UTC) do systemd
# Entra em cada snapshot: mautic.sql.gz (mysqldump --single-transaction do banco inteiro), o .env e os
# volumes config/ (local.php) e media/ (imagens e arquivos enviados). Retencao: BACKUP_KEEP_DAILY dias.
# Mesmo Storage Box e mesma chave SSH do stack principal (infra/scripts/backup.sh); outro repositorio.

. "$(dirname -- "$0")/_env.sh"

mode="backup"; do_check=0
for arg in "$@"; do
    case "$arg" in
        --init) mode="init" ;;
        --install-timer) mode="timer" ;;
        --check) do_check=1 ;;
        -h|--help) sed -n 2,9p "$0"; exit 0 ;;
        *) die "opcao desconhecida: $arg" ;;
    esac
done

require_env_file
export RESTIC_REPOSITORY RESTIC_PASSWORD
RESTIC_REPOSITORY=$(require_env_value RESTIC_REPOSITORY)
RESTIC_PASSWORD=$(require_env_value RESTIC_PASSWORD)
keep_daily=$(env_value BACKUP_KEEP_DAILY 30)
heartbeat_url=$(env_value BACKUP_HEARTBEAT_URL)
if [ "$(id -u)" = "0" ]; then backup_root="${BUNKER707_BACKUP_DIR:-/var/backups/bunker707-mautic}"; else backup_root="${BUNKER707_BACKUP_DIR:-$HOME/.bunker707-mautic-backups}"; fi

restic_bin() {
    if command -v restic >/dev/null 2>&1; then restic "$@"
    elif command -v docker >/dev/null 2>&1; then
        case "$RESTIC_REPOSITORY" in
            /*) docker run --rm -e RESTIC_REPOSITORY -e RESTIC_PASSWORD -v "$RESTIC_REPOSITORY:$RESTIC_REPOSITORY" -v "$backup_root:$backup_root" -v "$COMPOSE_DIR/volumes:$COMPOSE_DIR/volumes:ro" restic/restic:0.19.1 "$@" ;;
            *) die "Sem o binario restic so da para usar repositorio em disco local (bootstrap.sh instala o restic)." ;;
        esac
    else die "restic nao encontrado."; fi
}

ssh_config_alias() {
    local user host port key_file config
    user=$(env_value STORAGE_BOX_USER); host=$(env_value STORAGE_BOX_HOST); port=$(env_value STORAGE_BOX_SSH_PORT 23)
    [ -n "$user" ] && [ -n "$host" ] || { warn "STORAGE_BOX_USER/STORAGE_BOX_HOST vazios: pulando o alias SSH (repositorio local?)."; return 0; }
    key_file="$HOME/.ssh/id_ed25519_storagebox"; config="$HOME/.ssh/config"
    mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
    if [ ! -f "$key_file" ]; then ssh-keygen -q -t ed25519 -N "" -C "bunker707-backup" -f "$key_file"; log "Chave SSH criada em $key_file."; fi
    if ! grep -qE '^Host storagebox$' "$config" 2>/dev/null; then
        printf '\nHost storagebox\n  HostName %s\n  User %s\n  Port %s\n  IdentityFile %s\n  IdentitiesOnly yes\n  StrictHostKeyChecking accept-new\n' "$host" "$user" "$port" "$key_file" >> "$config"
        chmod 600 "$config"; log "Alias 'storagebox' gravado em $config."
    fi
    log "A chave publica precisa estar no Storage Box: ssh -p $port $user@$host install-ssh-key < $key_file.pub (ou --ssh-key no hcloud storage-box create)."
}

install_timer() {
    [ "$(id -u)" = "0" ] || die "--install-timer precisa de root (sudo)."
    local unit=/etc/systemd/system/bunker707-mautic-backup
    cat > "$unit.service" <<UNIT
[Unit]
Description=Backup do Mautic da Bunker707 (MySQL, config, media, .env) para o Storage Box via restic
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=${SUDO_USER:-deploy}
WorkingDirectory=$REPO_ROOT
ExecStart=/usr/bin/env bash $REPO_ROOT/infra/mautic/scripts/backup.sh
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
UNIT
    cat > "$unit.timer" <<UNIT
[Unit]
Description=Backup diario do Mautic da Bunker707 as 03:50 UTC (00:50 em Brasilia)

[Timer]
OnCalendar=*-*-* 03:50:00 UTC
RandomizedDelaySec=10m
Persistent=true

[Install]
WantedBy=timers.target
UNIT
    systemctl daemon-reload
    systemctl enable --now bunker707-mautic-backup.timer
    systemctl list-timers bunker707-mautic-backup.timer --no-pager
}

run_backup() {
    local stamp stage db_name db_user db_pass
    stamp=$(date -u +%Y%m%dT%H%M%SZ); stage="$backup_root/stage/$stamp"
    mkdir -p "$stage"; chmod 700 "$backup_root" "$stage"
    db_name=$(env_value MAUTIC_DB_DATABASE mautic); db_user=$(env_value MAUTIC_DB_USER mautic); db_pass=$(require_env_value MAUTIC_DB_PASSWORD)
    wait_healthy mautic-db 60
    log "Exportando o MySQL para $stage..."
    # A senha vai por variavel de ambiente do processo, nunca na linha de comando.
    compose exec -T -e MYSQL_PWD="$db_pass" mautic-db mysqldump --single-transaction --quick --triggers --no-tablespaces -u "$db_user" "$db_name" | gzip -1 > "$stage/mautic.sql.gz"
    cp "$ENV_FILE" "$stage/env"; chmod 600 "$stage"/*
    [ "$(stat -c %s "$stage/mautic.sql.gz")" -gt 1000 ] || die "mautic.sql.gz saiu vazio."
    du -sh "$stage" | sed 's/^/  /'
    log "Enviando ao restic ($RESTIC_REPOSITORY)..."
    restic_bin backup --tag bunker707-mautic --host bunker707-mautic --quiet "$stage" "$COMPOSE_DIR/volumes/config" "$COMPOSE_DIR/volumes/media"
    restic_bin forget --tag bunker707-mautic --host bunker707-mautic --keep-daily "$keep_daily" --prune --quiet
    local failures=0
    if [ "$do_check" = "1" ]; then restic_bin check --read-data-subset=10% || failures=1; fi
    ls -1dt "$backup_root"/stage/*/ 2>/dev/null | tail -n +3 | xargs -r rm -rf
    date -u +%Y-%m-%dT%H:%M:%SZ > "$backup_root/ultimo-sucesso"
    if [ -n "$heartbeat_url" ] && [ "$failures" = "0" ]; then curl -fsS --max-time 10 -o /dev/null "$heartbeat_url" || warn "heartbeat nao respondeu."; fi
    [ "$failures" = "0" ] || die "restic check encontrou problema."
    log "Backup $stamp concluido."
}

case "$mode" in
    init) ssh_config_alias; if restic_bin cat config >/dev/null 2>&1; then log "Repositorio restic ja existe."; else log "Criando o repositorio restic em $RESTIC_REPOSITORY..."; restic_bin init; fi; log "Guarde RESTIC_PASSWORD fora do servidor." ;;
    timer) install_timer ;;
    backup) run_backup ;;
esac

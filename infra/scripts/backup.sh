#!/usr/bin/env bash
# Backup diario do stack para um Storage Box da Hetzner (SFTP), criptografado com restic:
#   sh infra/scripts/backup.sh                 faz o backup (e o que o timer do systemd roda)
#   sh infra/scripts/backup.sh --init          cria chave SSH, alias `storagebox` e o repositorio restic
#   sh infra/scripts/backup.sh --check         backup + `restic check` (integridade; rode toda semana)
#   sh infra/scripts/backup.sh --install-timer instala infra/systemd/bunker707-backup.{service,timer}
#   sh infra/scripts/backup.sh --add-key=ARQ  cadastra a senha do arquivo como segunda chave do repositorio (recuperacao)
#
# O que entra em cada snapshot:
#   roles.sql           pg_dumpall --roles-only (papeis e senhas; so por partes mesmo, como o dump da CLI)
#   schema.sql          pg_dump --schema-only do banco postgres (tudo: public, auth, storage, vault, cron...)
#   data.sql.gz         pg_dump --data-only (COPY) do mesmo banco
#   postgres.dump       pg_dump -Fc completo: e o que restore.sh usa (pg_restore em servidor limpo)
#   pgsodium_root.key   chave raiz do Vault (segredos dos provedores de IA). Sem ela o Vault nao abre.
#   env                 o infra/compose/.env (todos os segredos do stack)
#   volumes/storage     arquivos do Storage (capas, materiais, fotos)
# Tudo roda com as ferramentas de dentro do container do Postgres (mesma versao, sem imagem extra) e sai
# pelo restic (criptografado antes de deixar o servidor). Retencao: BACKUP_KEEP_DAILY snapshots diarios.
# Por que nao `supabase db dump`: ele exclui os esquemas que o Auth e o Storage administram (pensado para
# migrar entre projetos da nuvem); num servidor proprio queremos o banco inteiro. docs/20, "Backup".
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/lib.sh"

mode="backup"
do_check=0
for arg in "$@"; do
    case "$arg" in
        --init) mode="init" ;;
        --install-timer) mode="timer" ;;
        --check) do_check=1 ;;
        --add-key=*) mode="add-key"; recovery_key_file="${arg#*=}" ;;
        -h|--help) sed -n 2,23p "$0"; exit 0 ;;
        *) die "opcao desconhecida: $arg" ;;
    esac
done

require_env_file
export RESTIC_REPOSITORY RESTIC_PASSWORD
RESTIC_REPOSITORY=$(require_env_value RESTIC_REPOSITORY)
RESTIC_PASSWORD=$(require_env_value RESTIC_PASSWORD)
keep_daily=$(env_value BACKUP_KEEP_DAILY 30)
heartbeat_url=$(env_value BACKUP_HEARTBEAT_URL)
# Pasta das exportacoes: /var/backups/bunker707 (criada pelo --install-timer, dona = usuario do timer) ou,
# fora do servidor, uma pasta no HOME. Os scripts de infra/cloud leem /var/backups/bunker707/ultimo-sucesso.
if [ -n "${BUNKER707_BACKUP_DIR:-}" ]; then backup_root="$BUNKER707_BACKUP_DIR"
elif [ "$(id -u)" = "0" ] || [ -w /var/backups/bunker707 ]; then backup_root=/var/backups/bunker707
else backup_root="$HOME/.bunker707-backups"; fi

# restic instalado, ou a imagem oficial (so para repositorio em disco local, como no ensaio).
restic_bin() {
    if command -v restic >/dev/null 2>&1; then
        restic "$@"
    elif command -v docker >/dev/null 2>&1; then
        case "$RESTIC_REPOSITORY" in
            /*) docker run --rm -e RESTIC_REPOSITORY -e RESTIC_PASSWORD -v "$RESTIC_REPOSITORY:$RESTIC_REPOSITORY" \
                    -v "$backup_root:$backup_root" -v "$COMPOSE_DIR/volumes/storage:$COMPOSE_DIR/volumes/storage:ro" \
                    restic/restic:0.19.1 "$@" ;;
            *) die "Sem o binario restic so da para usar repositorio em disco local. No servidor: bootstrap.sh instala o restic." ;;
        esac
    else
        die "restic nao encontrado."
    fi
}

ssh_config_alias() {
    local user host port key_file config
    user=$(env_value STORAGE_BOX_USER); host=$(env_value STORAGE_BOX_HOST); port=$(env_value STORAGE_BOX_SSH_PORT 23)
    [ -n "$user" ] && [ -n "$host" ] || { warn "STORAGE_BOX_USER/STORAGE_BOX_HOST vazios: pulando o alias SSH (repositorio local?)."; return 0; }
    key_file="$HOME/.ssh/id_ed25519_storagebox"
    config="$HOME/.ssh/config"
    mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
    if [ ! -f "$key_file" ]; then
        ssh-keygen -q -t ed25519 -N "" -C "bunker707-backup" -f "$key_file"
        log "Chave SSH criada em $key_file."
    fi
    if ! grep -qE '^Host storagebox$' "$config" 2>/dev/null; then
        {
            echo ""
            echo "Host storagebox"
            echo "  HostName $host"
            echo "  User $user"
            echo "  Port $port"
            echo "  IdentityFile $key_file"
            echo "  IdentitiesOnly yes"
            echo "  StrictHostKeyChecking accept-new"
        } >> "$config"
        chmod 600 "$config"
        log "Alias 'storagebox' gravado em $config."
    fi
    log "Instale a chave publica no Storage Box (uma vez; pede a senha do Storage Box):"
    echo "    ssh -p $port $user@$host install-ssh-key < $key_file.pub"
    echo "    (ou cole $key_file.pub em Storage Box > Acesso > Chaves SSH, no painel da Hetzner)"
}

init_repo() {
    ssh_config_alias
    if restic_bin cat config >/dev/null 2>&1; then
        log "Repositorio restic ja existe em $RESTIC_REPOSITORY."
    else
        log "Criando o repositorio restic em $RESTIC_REPOSITORY..."
        restic_bin init
    fi
    log "Pronto. Guarde RESTIC_PASSWORD fora do servidor (gerenciador de senhas): sem ela nenhum backup abre."
}

install_timer() {
    [ "$(id -u)" = "0" ] || die "--install-timer precisa de root (sudo)."
    local unit_dir="$REPO_ROOT/infra/systemd"
    install -d -m 700 -o "${SUDO_USER:-deploy}" -g "${SUDO_USER:-deploy}" /var/backups/bunker707
    sed "s|__REPO_ROOT__|$REPO_ROOT|g; s|__RUN_AS__|${SUDO_USER:-deploy}|g" "$unit_dir/bunker707-backup.service" > /etc/systemd/system/bunker707-backup.service
    cp "$unit_dir/bunker707-backup.timer" /etc/systemd/system/bunker707-backup.timer
    systemctl daemon-reload
    systemctl enable --now bunker707-backup.timer
    systemctl list-timers bunker707-backup.timer --no-pager
    log "Timer instalado (03:30 UTC = 00:30 em Brasilia). Teste agora com: sudo systemctl start bunker707-backup.service"
}

run_backup() {
    local stamp stage storage_dir failures=0
    stamp=$(date -u +%Y%m%dT%H%M%SZ)
    stage="$backup_root/stage/$stamp"
    storage_dir="$COMPOSE_DIR/volumes/storage"
    mkdir -p "$stage"; chmod 700 "$backup_root" "$stage"

    wait_healthy db 60
    log "Exportando o banco para $stage (dentro do container, como supabase_admin)..."
    # -h 127.0.0.1 forca autenticacao por senha (PGPASSWORD ja esta no container).
    compose exec -T db pg_dumpall -U supabase_admin -h 127.0.0.1 --roles-only > "$stage/roles.sql"
    compose exec -T db pg_dump -U supabase_admin -h 127.0.0.1 -d postgres --schema-only > "$stage/schema.sql"
    compose exec -T db pg_dump -U supabase_admin -h 127.0.0.1 -d postgres --data-only | gzip -1 > "$stage/data.sql.gz"
    compose exec -T db pg_dump -U supabase_admin -h 127.0.0.1 -d postgres -Fc > "$stage/postgres.dump"
    compose exec -T db cat /etc/postgresql-custom/pgsodium_root.key > "$stage/pgsodium_root.key"
    cp "$ENV_FILE" "$stage/env"
    chmod 600 "$stage"/*
    [ -s "$stage/postgres.dump" ] || die "postgres.dump saiu vazio."
    [ -s "$stage/pgsodium_root.key" ] || die "pgsodium_root.key saiu vazio."
    du -sh "$stage" | sed 's/^/  /'

    log "Enviando ao restic ($RESTIC_REPOSITORY)..."
    restic_bin backup --tag bunker707 --host bunker707 --quiet "$stage" "$storage_dir"
    log "Aplicando retencao (ultimos $keep_daily dias)..."
    restic_bin forget --tag bunker707 --host bunker707 --keep-daily "$keep_daily" --prune --quiet
    if [ "$do_check" = "1" ]; then
        log "Conferindo a integridade do repositorio..."
        restic_bin check --read-data-subset=10% || failures=1
    fi

    # Guarda as duas exportacoes mais recentes em disco (restauracao rapida) e apaga o resto.
    ls -1dt "$backup_root"/stage/*/ 2>/dev/null | tail -n +3 | xargs -r rm -rf
    date -u +%Y-%m-%dT%H:%M:%SZ > "$backup_root/ultimo-sucesso"
    if [ -n "$heartbeat_url" ] && [ "$failures" = "0" ]; then
        curl -fsS --max-time 10 -o /dev/null "$heartbeat_url" || warn "heartbeat ($heartbeat_url) nao respondeu."
    fi
    [ "$failures" = "0" ] || die "restic check encontrou problema; veja a saida acima."
    log "Backup $stamp concluido."
}

case "$mode" in
    add-key) restic_add_recovery_key "$recovery_key_file" ;;
    init) init_repo ;;
    timer) install_timer ;;
    backup) run_backup ;;
esac

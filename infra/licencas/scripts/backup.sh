#!/usr/bin/env bash
# Backup do Emissor de licencas, de hora em hora, para o Storage Box (SFTP), criptografado com restic (docs/20 §8C.6):
#   bash infra/licencas/scripts/backup.sh                  faz o backup (e o que o timer do systemd roda, de hora em hora)
#   bash infra/licencas/scripts/backup.sh --check          backup + `restic check` de 10% dos dados + limpeza (prune)
#   bash infra/licencas/scripts/backup.sh --init [--chave-recuperacao=ARQ]
#                                                          alias `storagebox` e o repositorio restic. Se o repositorio ja
#                                                          existe e a senha deste servidor nao abre (servidor novo depois
#                                                          de um perdido), a senha de recuperacao do arquivo cadastra a
#                                                          deste servidor nele
#   bash infra/licencas/scripts/backup.sh --add-key=ARQ    cadastra a senha do arquivo como segunda chave (recuperacao)
#   sudo bash infra/licencas/scripts/backup.sh --install-timer   o timer do systemd, de hora em hora (minuto 17, UTC)
# Cada snapshot leva emissor.dump (pg_dump -Fc do banco do Emissor, de dentro do container do Postgres) e a imagem
# implantada. Os segredos (chave de emissao, senha dela, certificado, senha do banco, chave do Resend) nao entram: voltam
# pela etapa secrets-licencas, dos segredos do GitHub. Tags: bunker707-licencas, e `com-dados` ou `vazio` (banco sem
# Licenca nem Instalacao): o restore.sh prefere o mais novo com dados, para um servidor novo e vazio nunca esconder o
# backup bom do servidor perdido.
# Retencao: BACKUP_KEEP_HOURLY (48) de hora em hora e BACKUP_KEEP_DAILY (30) diarios; o prune, que reescreve o
# repositorio, roda uma vez por dia (BACKUP_PRUNE_HOUR, 03 UTC) e no --check.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/_env.sh"

mode="backup"; do_check=0; recovery_file=""
for arg in "$@"; do
    case "$arg" in
        --init) mode="init" ;;
        --chave-recuperacao=*) recovery_file="${arg#*=}" ;;
        --install-timer) mode="timer" ;;
        --check) do_check=1 ;;
        --add-key=*) mode="add-key"; recovery_key_file="${arg#*=}" ;;
        -h|--help) sed -n 2,20p "$0"; exit 0 ;;
        *) die "opcao desconhecida: $arg" ;;
    esac
done

# Pasta das exportacoes: /var/backups/bunker707-licencas (criada pelo --install-timer, dona = usuario do timer) ou,
# fora do servidor, uma pasta no HOME. A etapa status-licencas le o ultimo-sucesso dela.
if [ -n "${LICENCAS_BACKUP_DIR:-}" ]; then backup_root="$LICENCAS_BACKUP_DIR"
elif [ "$(id -u)" = "0" ] || [ -w /var/backups/bunker707-licencas ]; then backup_root=/var/backups/bunker707-licencas
else backup_root="$HOME/.bunker707-licencas-backups"; fi

install_timer() {
    local units="${LICENCAS_SYSTEMD_DIR:-/etc/systemd/system}" run_as="${SUDO_USER:-deploy}" unit
    [ "$(id -u)" = "0" ] || [ -n "${LICENCAS_SYSTEMD_DIR:-}" ] || die "--install-timer precisa de root (sudo)."
    unit="$units/bunker707-licencas-backup"
    install -d -m 700 -o "$run_as" -g "$(id -gn "$run_as")" "$backup_root"
    cat > "$unit.service" <<UNIT
[Unit]
Description=Backup do Emissor de licencas (pg_dump) para o Storage Box via restic
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$run_as
WorkingDirectory=$REPO_ROOT
Environment=LICENCAS_BACKUP_DIR=$backup_root
ExecStart=/usr/bin/env bash $LICENCAS_INFRA_DIR/scripts/backup.sh
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
UNIT
    cat > "$unit.timer" <<UNIT
[Unit]
Description=Backup do Emissor de licencas de hora em hora (minuto 17, UTC)

[Timer]
OnCalendar=*-*-* *:17:00 UTC
RandomizedDelaySec=5m
Persistent=true

[Install]
WantedBy=timers.target
UNIT
    systemctl daemon-reload
    systemctl enable --now bunker707-licencas-backup.timer
    systemctl list-timers bunker707-licencas-backup.timer --no-pager || true
    log "Timer instalado: de hora em hora, no minuto 17 (UTC). Teste agora com: sudo systemctl start bunker707-licencas-backup.service"
}

if [ "$mode" = "timer" ]; then install_timer; exit 0; fi

require_env_file
command -v restic >/dev/null 2>&1 || die "restic nao encontrado (bootstrap.sh instala no servidor)."
export RESTIC_REPOSITORY RESTIC_PASSWORD
RESTIC_REPOSITORY=$(require_env_value RESTIC_REPOSITORY)
RESTIC_PASSWORD=$(require_env_value RESTIC_PASSWORD)
keep_hourly=$(env_value BACKUP_KEEP_HOURLY 48)
keep_daily=$(env_value BACKUP_KEEP_DAILY 30)
prune_hour=$(env_value BACKUP_PRUNE_HOUR 03)
heartbeat_url=$(env_value BACKUP_HEARTBEAT_URL)
case "$keep_hourly$keep_daily" in ""|*[!0-9]*) die "BACKUP_KEEP_HOURLY e BACKUP_KEEP_DAILY precisam ser numeros." ;; esac

init_repo() {
    local own
    storagebox_ssh_alias
    if restic cat config >/dev/null 2>&1; then
        log "Repositorio restic ja existe em $RESTIC_REPOSITORY e abre com a senha deste servidor."
    elif [ -n "$recovery_file" ] && env -u RESTIC_PASSWORD restic --password-file "$recovery_file" cat config >/dev/null 2>&1; then
        # Servidor novo, repositorio de um servidor anterior: a senha de recuperacao (derivada do token) cadastra a deste.
        own=$(mktemp); chmod 600 "$own"; printf '%s' "$RESTIC_PASSWORD" > "$own"
        env -u RESTIC_PASSWORD restic --password-file "$recovery_file" key add --new-password-file "$own" >/dev/null || { rm -f "$own"; die "Nao consegui cadastrar a senha deste servidor em $RESTIC_REPOSITORY."; }
        rm -f "$own"
        restic cat config >/dev/null 2>&1 || die "A senha deste servidor nao abriu $RESTIC_REPOSITORY depois de cadastrada."
        log "Repositorio de um servidor anterior adotado: a senha deste servidor foi cadastrada pela de recuperacao."
    else
        log "Criando o repositorio restic em $RESTIC_REPOSITORY..."
        restic init
    fi
    log "Pronto. A senha de recuperacao (derivada do HCLOUD_TOKEN) abre este repositorio sem o .env (docs/20 §10.2)."
}

run_backup() {
    local stamp stage total estado prune="" failures=0
    stamp=$(date -u +%Y%m%dT%H%M%SZ); stage="$backup_root/stage/$stamp"
    mkdir -p "$stage"; chmod 700 "$backup_root" "$stage"

    wait_healthy "$LICENCAS_PG_SERVICE" 60
    log "Exportando o banco do Emissor (pg_dump -Fc, dentro do container) para $stage..."
    compose exec -T "$LICENCAS_PG_SERVICE" pg_dump -U "$LICENCAS_PG_USER" -d "$LICENCAS_PG_DB" -Fc > "$stage/emissor.dump"
    [ -s "$stage/emissor.dump" ] || die "emissor.dump saiu vazio."
    total=$(pg_total_dados | tr -d '[:space:]')
    case "$total" in ""|*[!0-9]*) die "Nao consegui contar as Licencas e Instalacoes do banco (veio: '$total')." ;; esac
    if [ "$total" = "0" ]; then estado=vazio; else estado=com-dados; fi
    [ ! -f "$LICENCAS_EMISSOR_DIR/.imagem" ] || cp "$LICENCAS_EMISSOR_DIR/.imagem" "$stage/imagem"
    chmod 600 "$stage"/*
    du -sh "$stage" | sed 's/^/  /'

    log "Enviando ao restic ($RESTIC_REPOSITORY), marcado $estado..."
    restic backup --tag "$LICENCAS_BACKUP_TAG" --tag "$estado" --host "$LICENCAS_BACKUP_HOST" --quiet "$stage"
    if [ "$do_check" = "1" ] || [ "$(date -u +%H)" = "$prune_hour" ]; then prune="--prune"; fi
    log "Retencao: $keep_hourly de hora em hora e $keep_daily diarios${prune:+ (com prune)}"
    # Agrupado so pelo host: a pasta de cada backup tem a hora no nome, e o agrupamento padrao do restic (host e
    # caminhos) deixaria cada snapshot sozinho no grupo dele, e nenhum sairia.
    restic forget --tag "$LICENCAS_BACKUP_TAG" --host "$LICENCAS_BACKUP_HOST" --group-by host \
        --keep-hourly "$keep_hourly" --keep-daily "$keep_daily" $prune --quiet
    if [ "$do_check" = "1" ]; then
        log "Conferindo a integridade do repositorio..."
        restic check --read-data-subset=10% || failures=1
    fi

    # As duas exportacoes mais recentes ficam em disco (restauracao rapida); o resto sai.
    ls -1dt "$backup_root"/stage/*/ 2>/dev/null | tail -n +3 | xargs -r rm -rf
    date -u +%Y-%m-%dT%H:%M:%SZ > "$backup_root/ultimo-sucesso"
    if [ -n "$heartbeat_url" ] && [ "$failures" = "0" ]; then
        curl -fsS --max-time 10 -o /dev/null "$heartbeat_url" || warn "heartbeat ($heartbeat_url) nao respondeu."
    fi
    [ "$failures" = "0" ] || die "restic check encontrou problema; veja a saida acima."
    log "Backup $stamp concluido ($estado: $total Licencas e Instalacoes)."
}

case "$mode" in
    add-key) restic_add_recovery_key "$recovery_key_file" ;;
    init) init_repo ;;
    backup) run_backup ;;
esac

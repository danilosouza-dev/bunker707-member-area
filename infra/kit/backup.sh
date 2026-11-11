#!/usr/bin/env bash
# Backup da escola para o destino que o comprador escolheu (docs/32 §4; docs/20 §9B). Pelo comando de operacao:
#   sudo membros backup                         faz o backup agora (banco, arquivos do Storage e segredos), aplica a
#                                               retencao e grava a situacao
#   sudo membros backup --iniciar               confere o destino e cria o repositorio la (com SFTP, cria a chave SSH)
#   sudo membros backup --conferir              backup + conferencia de 10% dos dados do repositorio (restic check)
#   sudo membros backup --conferir-destino      so diz que destino e esse e se ele abre; nada muda
#   sudo membros backup --instalar-agendamento  o servico e o timer do systemd: todo dia no horario do kit.conf
#   membros backup --agendado                   o que o timer roda: espera outra operacao terminar e confere 10% dos
#                                               dados uma vez por semana
# O destino e um repositorio do restic dado em RESTIC_REPOSITORY no arquivo de segredos: armazenamento compativel com
# S3 (Backblaze B2, Wasabi, Cloudflare R2: s3:https://<servidor>/<bucket>[/pasta], com AWS_ACCESS_KEY_ID,
# AWS_SECRET_ACCESS_KEY e, no R2, AWS_DEFAULT_REGION=auto), SFTP (sftp:usuario@servidor:/pasta, com a chave SSH que o
# --iniciar cria) ou uma pasta deste servidor (/caminho; o backup morre junto com o servidor). Tudo sai cifrado pelo
# restic com RESTIC_PASSWORD, a senha deste servidor; a chave de recuperacao e a segunda (membros kit-de-recuperacao).
# Cada backup leva: roles.sql e postgres.dump (pg_dumpall e pg_dump de dentro do container do banco, o que o
# infra/scripts/restore.sh usa), pgsodium_root.key (a chave do Vault), env (o arquivo de segredos) e a pasta do
# Storage. Marcas: a do kit e `com-dados` ou `vazio` (sem nenhuma conta: instalacao recem-criada).
# Retencao (BACKUP_KEEP_DAILY 7, BACKUP_KEEP_WEEKLY 4, BACKUP_KEEP_MONTHLY 6 no arquivo de segredos): `restic forget`
# agrupado por host e marcas (--group-by host,tags), nunca pelo caminho, e com --prune. O agrupamento padrao do
# restic (host e caminhos) deixa sozinho no grupo todo backup cuja pasta muda de nome, e a retencao nunca apaga nada.
# Uma operacao do backup por vez (trava em KIT_ARQUIVO_TRAVA). Codigos de saida: os de lib-kit.sh.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: o script usa arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "${BASH_SOURCE[0]}")/lib-kit.sh"
KIT_OPERACAO="membros backup"

modo=backup
conferir=0
agendado=0
for arg in "$@"; do
    case "$arg" in
        --iniciar) modo=iniciar ;;
        --conferir) conferir=1 ;;
        --conferir-destino) modo=destino ;;
        --instalar-agendamento) modo=agendamento ;;
        --agendado) agendado=1 ;;
        -h|--help) sed -n 2,25p "$0"; exit 0 ;;
        *) sair "$SAI_USO" "opcao desconhecida: $arg (veja: membros backup --help)" ;;
    esac
done

instalar_agendamento() {
    local unidade="$KIT_PASTA_SYSTEMD/$KIT_UNIDADE_BACKUP"
    [ -w "$KIT_PASTA_SYSTEMD" ] || sair "$SAI_USO" "--instalar-agendamento precisa de root (sudo)."
    [[ $KIT_HORA_DO_BACKUP =~ ^[0-2][0-9]:[0-5][0-9]$ ]] || sair "$SAI_USO" "KIT_HORA_DO_BACKUP precisa ser HH:MM (veio $KIT_HORA_DO_BACKUP)."
    cat > "$unidade.service" <<UNIT
[Unit]
Description=Backup da escola (banco, arquivos e segredos) para o destino do kit, pelo restic
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash $KIT_DIR/membros backup --agendado
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
UNIT
    cat > "$unidade.timer" <<UNIT
[Unit]
Description=Backup diario da escola as $KIT_HORA_DO_BACKUP (horario de Brasilia)

[Timer]
OnCalendar=*-*-* $KIT_HORA_DO_BACKUP:00 America/Sao_Paulo
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
UNIT
    chmod 644 "$unidade.service" "$unidade.timer"
    systemctl daemon-reload
    systemctl enable --now "$KIT_UNIDADE_BACKUP.timer"
    log "Backup agendado: todo dia as $KIT_HORA_DO_BACKUP (horario de Brasilia), com ate 30 minutos de folga. Teste agora: sudo membros backup"
}

if [ "$modo" = agendamento ]; then instalar_agendamento; exit 0; fi

exigir_segredos
destino_carregar
senha_do_servidor

# SFTP: a chave SSH do backup (so do administrador) e a entrada dela no ~/.ssh/config, para o restic (e o restore.sh)
# entrarem sem senha. Idempotente. Imprime a chave publica para a pessoa autorizar no servidor SFTP.
preparar_sftp() {
    local chave usuario servidor porta config bloco casa
    chave=$(env_value BACKUP_SFTP_CHAVE "$KIT_PASTA_ESTADO/backup/sftp_ed25519")
    porta=$(env_value BACKUP_SFTP_PORTA 22)
    [[ $porta =~ ^[0-9]{1,5}$ ]] || sair "$SAI_USO" "BACKUP_SFTP_PORTA precisa ser um numero (veio $porta)."
    usuario=""; servidor=$DESTINO_SERVIDOR
    if [[ $RESTIC_REPOSITORY =~ ^sftp:([^@:/]+)@ ]]; then usuario=${BASH_REMATCH[1]}; fi
    mkdir -p "$(dirname -- "$chave")"
    if [ ! -f "$chave" ]; then
        ssh-keygen -q -t ed25519 -N "" -C "$KIT_NOME-backup" -f "$chave"
        log "Chave SSH do backup criada em $chave."
    fi
    casa=$(getent passwd "$(id -u)" | cut -d: -f6)
    config="$casa/.ssh/config"
    mkdir -p "$casa/.ssh"; chmod 700 "$casa/.ssh"
    bloco="# $KIT_NOME: backup (membros backup --iniciar)"
    if ! grep -qF "$bloco" "$config" 2>/dev/null; then
        {
            printf '\n%s\nHost %s\n' "$bloco" "$servidor"
            [ -z "$usuario" ] || printf '  User %s\n' "$usuario"
            printf '  Port %s\n  IdentityFile %s\n  IdentitiesOnly yes\n  BatchMode yes\n  StrictHostKeyChecking accept-new\n' "$porta" "$chave"
        } >> "$config"
        chmod 600 "$config"
    fi
    log "Autorize esta chave no servidor SFTP (no painel dele, ou em ~/.ssh/authorized_keys da conta ${usuario:-do backup}):"
    printf '    %s\n' "$(cat "$chave.pub")"
}

descrever_destino() {
    case "$DESTINO_TIPO" in
        s3) printf 'armazenamento S3 em %s' "$DESTINO_SERVIDOR" ;;
        sftp) printf 'servidor SFTP %s' "$DESTINO_SERVIDOR" ;;
        local) printf 'pasta deste servidor (%s): se o servidor morrer, o backup morre junto' "$RESTIC_REPOSITORY" ;;
    esac
}

abrir_ou_explicar() {
    local rc=0
    restic_abrir || rc=$?
    case "$rc" in
        0) return 0 ;;
        10) sair "$SAI_DESTINO" "Ainda nao ha backup em $RESTIC_REPOSITORY: rode sudo membros backup --iniciar." ;;
        12) sair "$SAI_CHAVE" "O destino tem um backup que a senha deste servidor nao abre. Se este e um servidor novo, restaure com: sudo membros restaurar." ;;
        *) sair "$SAI_DESTINO" "O destino do backup nao respondeu ou recusou a chave de acesso: $RESTIC_MOTIVO" ;;
    esac
}

if [ "$modo" = destino ]; then
    rc=0; restic_abrir || rc=$?
    log "Destino: $(descrever_destino)."
    case "$rc" in
        0) log "O backup abre com a senha deste servidor." ;;
        10) log "Ainda nao ha backup nesse destino (o --iniciar cria)." ;;
        12) sair "$SAI_CHAVE" "Esse destino tem um backup que a senha deste servidor nao abre (de outro servidor?)." ;;
        *) sair "$SAI_DESTINO" "O destino nao respondeu ou recusou a chave de acesso: $RESTIC_MOTIVO" ;;
    esac
    exit 0
fi

if [ "$modo" = iniciar ]; then
    KIT_OPERACAO="membros backup --iniciar"
    trava_backup 0
    [ "$DESTINO_TIPO" != sftp ] || preparar_sftp
    [ "$DESTINO_TIPO" != local ] || { mkdir -p "$RESTIC_REPOSITORY"; chmod 700 "$RESTIC_REPOSITORY"; warn "o backup fica neste servidor: se ele morrer, o backup morre junto. Prefira um armazenamento fora dele."; }
    rc=0; restic_abrir || rc=$?
    case "$rc" in
        0) log "Ja ha um backup da escola em $(descrever_destino), e ele abre com a senha deste servidor." ;;
        10)
            log "Criando o repositorio do backup em $(descrever_destino)..."
            restic init >/dev/null || sair "$SAI_DESTINO" "Nao consegui criar o repositorio no destino (linhas acima)."
            log "Repositorio criado. Agora: sudo membros backup e, no terminal, sudo membros kit-de-recuperacao."
            ;;
        12) sair "$SAI_CHAVE" "O destino ja tem um backup que a senha deste servidor nao abre. Servidor novo de uma recuperacao? sudo membros restaurar. Outra escola no mesmo destino? Use outra pasta." ;;
        *) sair "$SAI_DESTINO" "O destino nao respondeu ou recusou a chave de acesso: $RESTIC_MOTIVO" ;;
    esac
    situacao_gravar "backup.destino_tipo=$DESTINO_TIPO" "backup.destino_servidor=$DESTINO_SERVIDOR"
    exit 0
fi

# ---- o backup -------------------------------------------------------------------------------------------------------

[ ! -e "$KIT_MARCA_RESTAURACAO" ] || sair "$SAI_RESTAURANDO" "Esta instalacao espera a restauracao de um backup (sudo membros restaurar): o backup fica parado ate la, para um servidor vazio nunca entrar no lugar do backup bom."
for chave in BACKUP_KEEP_DAILY BACKUP_KEEP_WEEKLY BACKUP_KEEP_MONTHLY; do
    valor=$(env_value "$chave")
    [ -z "$valor" ] || [[ $valor =~ ^[0-9]{1,4}$ ]] || sair "$SAI_USO" "$chave precisa ser um numero (veio $valor)."
done
manter_diarios=$(env_value BACKUP_KEEP_DAILY 7)
manter_semanais=$(env_value BACKUP_KEEP_WEEKLY 4)
manter_mensais=$(env_value BACKUP_KEEP_MONTHLY 6)
[ $((manter_diarios + manter_semanais + manter_mensais)) -gt 0 ] || sair "$SAI_USO" "A retencao nao pode ser zero em tudo: o restic apagaria todo backup."

if [ "$agendado" = 1 ]; then trava_backup "${KIT_TRAVA_ESPERA:-3600}"; else trava_backup 0; fi
etapa="$KIT_PASTA_BACKUP/atual"
inicio=$(date +%s)
tentativa=$(agora_utc)
terminou=0
motivo="parou antes do fim"

encerrar() {
    local rc=$?
    rm -rf -- "$etapa"
    if [ "$terminou" != 1 ]; then
        situacao_gravar backup.em_andamento=b:false backup.ultimo_resultado=falhou "backup.ultimo_erro=$motivo" >/dev/null 2>&1 || true
        # 0 e 1 (o die do lib.sh) viram 3; trava, destino, chave e interrupcao guardam o codigo proprio.
        case "$rc" in 0|1) rc=$SAI_FALHOU ;; esac
    fi
    exit "$rc"
}
trap encerrar EXIT
trap 'motivo="interrompido"; exit 130' INT
trap 'motivo="interrompido"; exit 143' TERM HUP

situacao_gravar "backup.ultima_tentativa=$tentativa" backup.em_andamento=b:true
motivo="o destino nao abriu"
abrir_ou_explicar
# So os travamentos que sobraram de um restic que morreu no meio (desligamento, falta de memoria); a trava acima garante
# que nenhuma outra operacao do kit esta usando o repositorio agora.
restic unlock >/dev/null 2>&1 || true

motivo="o banco nao respondeu"
rm -rf -- "$etapa"; mkdir -p "$etapa"; chmod 700 "$etapa"
wait_healthy "$KIT_SERVICO_BANCO" 60
banco=$(env_value POSTGRES_DB postgres)
log "Exportando o banco (de dentro do container, como supabase_admin)..."
motivo="a exportacao do banco falhou"
compose exec -T "$KIT_SERVICO_BANCO" pg_dumpall -U supabase_admin -h 127.0.0.1 --roles-only > "$etapa/roles.sql"
compose exec -T "$KIT_SERVICO_BANCO" pg_dump -U supabase_admin -h 127.0.0.1 -d "$banco" -Fc > "$etapa/postgres.dump"
compose exec -T "$KIT_SERVICO_BANCO" cat /etc/postgresql-custom/pgsodium_root.key > "$etapa/pgsodium_root.key"
cp -- "$ENV_FILE" "$etapa/env"
chmod 600 "$etapa"/*
[ -s "$etapa/postgres.dump" ] || sair "$SAI_FALHOU" "postgres.dump saiu vazio."
[ -s "$etapa/pgsodium_root.key" ] || sair "$SAI_FALHOU" "pgsodium_root.key saiu vazio."
contas=$(contas_da_escola)
[[ $contas =~ ^[0-9]+$ ]] || sair "$SAI_FALHOU" "Nao consegui contar as contas do banco (veio '$contas')."
if [ "$contas" = 0 ]; then estado=vazio; else estado=com-dados; fi
banco_bytes=$(stat -c %s "$etapa/postgres.dump")

caminhos=("$etapa")
if [ -d "$KIT_PASTA_STORAGE" ]; then
    caminhos+=("$KIT_PASTA_STORAGE")
    storage_arquivos=$(find "$KIT_PASTA_STORAGE" -type f | wc -l | tr -d ' ')
    storage_bytes=$(du -sb "$KIT_PASTA_STORAGE" | cut -f1)
else
    warn "a pasta do Storage ($KIT_PASTA_STORAGE) nao existe: o backup leva so o banco."
    storage_arquivos=0; storage_bytes=0
fi

log "Enviando para $(descrever_destino), marcado $estado..."
motivo="o envio para o destino falhou"
resumo=$(restic_kit backup --json --host "$KIT_BACKUP_HOST" --tag "$KIT_BACKUP_TAG" --tag "$estado" "${caminhos[@]}" | kit_py resumo-do-backup)
read -r snapshot enviado _processado _arquivos <<< "$resumo"

log "Retencao: $manter_diarios diarios, $manter_semanais semanais e $manter_mensais mensais..."
motivo="a retencao (restic forget) falhou"
# Agrupado por host e marcas: o caminho nao entra, para mudar a pasta de uma exportacao nunca deixar backup velho de fora.
restic_kit forget --host "$KIT_BACKUP_HOST" --tag "$KIT_BACKUP_TAG" --group-by host,tags \
    --keep-daily "$manter_diarios" --keep-weekly "$manter_semanais" --keep-monthly "$manter_mensais" --prune --quiet

ultima_conferencia=$(situacao_ler backup.ultima_conferencia || true)
if [ "$conferir" = 0 ] && [ "$agendado" = 1 ]; then
    if [ -z "$ultima_conferencia" ] || [ $(( $(date +%s) - $(date -d "$ultima_conferencia" +%s 2>/dev/null || echo 0) )) -ge $((7 * 86400 - 3600)) ]; then
        conferir=1
    fi
fi
conferencia=()
if [ "$conferir" = 1 ]; then
    log "Conferindo 10% dos dados do repositorio (restic check)..."
    if restic_kit check --read-data-subset=10%; then
        conferencia=("backup.ultima_conferencia=$(agora_utc)" backup.ultima_conferencia_resultado=ok)
    else
        conferencia=("backup.ultima_conferencia=$(agora_utc)" backup.ultima_conferencia_resultado=falhou)
    fi
fi

terminou=1
situacao_gravar backup.em_andamento=b:false backup.ultimo_resultado=ok backup.ultimo_erro=x: \
    "backup.ultimo_sucesso=$(agora_utc)" "backup.snapshot=$snapshot" "backup.estado=$estado" \
    "backup.duracao_s=n:$(( $(date +%s) - inicio ))" "backup.banco_bytes=n:$banco_bytes" \
    "backup.storage_arquivos=n:$storage_arquivos" "backup.storage_bytes=n:$storage_bytes" "backup.enviado_bytes=n:$enviado" \
    "backup.destino_tipo=$DESTINO_TIPO" "backup.destino_servidor=$DESTINO_SERVIDOR" \
    "backup.retencao.diarios=n:$manter_diarios" "backup.retencao.semanais=n:$manter_semanais" "backup.retencao.mensais=n:$manter_mensais" \
    "${conferencia[@]}"
if [ "${#conferencia[@]}" -gt 0 ] && [ "${conferencia[1]}" != backup.ultima_conferencia_resultado=ok ]; then
    sair "$SAI_FALHOU" "O backup foi feito, mas a conferencia do repositorio (restic check) achou problema: veja as linhas acima."
fi
log "Backup $snapshot concluido ($estado; banco $(numfmt --to=iec "$banco_bytes" 2>/dev/null || echo "$banco_bytes bytes"), $storage_arquivos arquivos do Storage)."

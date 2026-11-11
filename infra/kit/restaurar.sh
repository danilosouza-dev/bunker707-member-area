#!/usr/bin/env bash
# Restauracao de verdade, num servidor novo (docs/32 §2.3, §4 e §11.7; docs/20 §9B). No terminal do servidor:
#   sudo membros restaurar [--snapshot ID] [--chave-arquivo ARQ] [--destino REPO]
# Para o servidor novo de uma recuperacao, instalado no modo de restauracao (sem Chave de ativacao, para receber um
# backup): o destino e as chaves de acesso ja estao no arquivo de segredos (ou o --destino, a linha "Destino" da folha);
# a chave de recuperacao e digitada (ou vem de um arquivo so do administrador). Passos:
#   1. poe a instalacao no modo de restauracao: o backup diario fica parado ate o fim, para os backups de um servidor
#      vazio nunca passarem na frente do backup bom;
#   2. abre o backup com a chave de recuperacao e escolhe o mais novo com dados (ou o --snapshot);
#   3. mostra de quando e de qual escola e o backup e pede a confirmacao digitada: o endereco da escola, ou
#      "APAGAR <endereco>" quando esta instalacao ja tem contas (elas serao apagadas);
#   4. roda o infra/scripts/restore.sh (o mesmo da nossa producao): banco inteiro, chave do Vault, arquivo de segredos,
#      arquivos do Storage, tudo de pe e o teste de fumaca;
#   5. devolve ao arquivo de segredos o destino e as chaves de acesso com que a restauracao abriu o backup, confere que
#      a senha do servidor restaurada ainda abre o backup (se nao, cadastra uma nova com a chave de recuperacao), aplica
#      as migracoes do pacote que o backup ainda nao tinha (membros migrar) e apaga o que foi baixado;
#   6. sai do modo de restauracao. A licenca veio no backup: no mesmo endereco, o Emissor reconhece a Instalacao na
#      conferencia seguinte (readocao, docs/32 §11.2).
# A confirmacao pede uma pessoa no terminal (codigo 7 sem terminal). Codigos de saida: os de lib-kit.sh.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: o script usa arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "${BASH_SOURCE[0]}")/lib-kit.sh"
KIT_OPERACAO="membros restaurar"

snapshot=""
chave_arquivo=""
destino=""
while [ $# -gt 0 ]; do
    case "$1" in
        --snapshot) [ $# -ge 2 ] || sair "$SAI_USO" "--snapshot precisa do id de um backup."; snapshot=$2; shift ;;
        --snapshot=*) snapshot=${1#*=} ;;
        --chave-arquivo) [ $# -ge 2 ] || sair "$SAI_USO" "--chave-arquivo precisa de um arquivo."; chave_arquivo=$2; shift ;;
        --chave-arquivo=*) chave_arquivo=${1#*=} ;;
        --destino) [ $# -ge 2 ] || sair "$SAI_USO" "--destino precisa do endereco do backup."; destino=$2; shift ;;
        --destino=*) destino=${1#*=} ;;
        -h|--help) sed -n 2,19p "$0"; exit 0 ;;
        *) sair "$SAI_USO" "opcao desconhecida: $1 (veja: membros restaurar --help)" ;;
    esac
    shift
done

exigir_segredos
[ -t 0 ] && [ -t 1 ] || sair "$SAI_TERMINAL" "A restauracao apaga o banco desta instalacao e pede uma confirmacao digitada por uma pessoa: rode no terminal do servidor (sudo membros restaurar)."
destino_carregar "$destino"
[ -f "$KIT_SCRIPT_RESTORE" ] || sair "$SAI_USO" "Nao achei o restore.sh do pacote ($KIT_SCRIPT_RESTORE)."
trava_backup 0

# O que abre o destino agora (pode ser diferente do que o backup guardou, se a chave de acesso foi trocada).
declare -A acesso=([RESTIC_REPOSITORY]=$RESTIC_REPOSITORY)
for chave in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION BACKUP_SFTP_CHAVE BACKUP_SFTP_PORTA; do
    valor=$(env_value "$chave")
    [ -z "$valor" ] || acesso[$chave]=$valor
done

mkdir -p "$KIT_PASTA_ESTADO"
if [ ! -e "$KIT_MARCA_RESTAURACAO" ]; then
    agora_utc > "$KIT_MARCA_RESTAURACAO"
    situacao_gravar "restauracao.pendente_desde=$(agora_utc)"
fi

chave_temporaria_criar
trap 'chave_temporaria_apagar' EXIT
trap 'printf "\nInterrompido. A instalacao continua esperando a restauracao (o backup diario fica parado).\n" >&2; exit 130' INT
trap 'exit 143' TERM HUP
ler_chave_de_recuperacao "$KIT_DIR_CHAVE/chave" "$chave_arquivo"
unset RESTIC_PASSWORD
export RESTIC_PASSWORD_FILE="$KIT_DIR_CHAVE/chave"

rc=0; restic_abrir || rc=$?
case "$rc" in
    0) ;;
    12) sair "$SAI_CHAVE" "A chave de recuperacao digitada nao abre o backup de $RESTIC_REPOSITORY. Confira a folha (8 grupos de 4)." ;;
    10) sair "$SAI_DESTINO" "Nao ha backup em $RESTIC_REPOSITORY: confira a linha Destino da folha." ;;
    *) sair "$SAI_DESTINO" "O destino do backup nao respondeu ou recusou a chave de acesso: $RESTIC_MOTIVO" ;;
esac

escolha=$(restic snapshots --json --host "$KIT_BACKUP_HOST" --tag "$KIT_BACKUP_TAG" | kit_py escolher-backup "$snapshot")
read -r snap_id snap_curto snap_hora snap_marcas <<< "$escolha"
lista=$(mktemp "$KIT_DIR_CHAVE/lista.XXXXXX")
restic ls --json "$snap_id" > "$lista"
eval "$(kit_py plano-do-ensaio "$lista")"
escola=""
[ -z "$PLANO_ENV_NO_BACKUP" ] || escola=$(restic dump "$snap_id" "$PLANO_ENV_NO_BACKUP" | kit_py endereco-da-escola)
[ -n "$escola" ] || escola="(endereco desconhecido)"

contas=0
if banco_no_ar; then contas=$(contas_da_escola); [[ $contas =~ ^[0-9]+$ ]] || contas=0; fi
quando=$(kit_py data-brasilia "$snap_hora")

printf '\n==> Restaurar o backup %s, de %s (horario de Brasilia), da escola %s\n' "$snap_curto" "$quando" "$escola"
printf '    Isso apaga o banco e os arquivos desta instalacao e poe os do backup no lugar.\n'
frase=$escola
if [ "$contas" -gt 0 ]; then
    printf '    ATENCAO: esta instalacao ja tem uma escola com %s conta(s). Ela sera APAGADA.\n' "$contas"
    frase="APAGAR $escola"
fi
printf '    Para confirmar, digite: %s\n> ' "$frase"
resposta=""
IFS= read -r resposta || true
[ "$resposta" = "$frase" ] || sair "$SAI_USO" "Confirmacao diferente de \"$frase\": nada foi feito."

log "Restaurando (infra/scripts/restore.sh)..."
restore_rc=0
BUNKER707_BACKUP_DIR="$KIT_PASTA_BACKUP" BUNKER707_BACKUP_TAG="$KIT_BACKUP_TAG" \
    bash "$KIT_SCRIPT_RESTORE" --snapshot "$snap_id" --yes || restore_rc=$?
if [ "$restore_rc" -ne 0 ]; then
    sair "$SAI_FALHOU" "A restauracao parou (linhas acima). A instalacao continua esperando a restauracao e o backup diario fica parado. Depois de corrigir, rode de novo: sudo membros restaurar"
fi

log "Devolvendo ao arquivo de segredos o destino e as chaves de acesso que abriram o backup..."
for chave in "${!acesso[@]}"; do printf '%s=%s\n' "$chave" "${acesso[$chave]}"; done | kit_py segredos-trocar "$ENV_FILE"
senha_restaurada=$(env_value RESTIC_PASSWORD)
if [ -z "$senha_restaurada" ] || ! env -u RESTIC_PASSWORD_FILE RESTIC_PASSWORD="$senha_restaurada" restic cat config >/dev/null 2>&1; then
    log "A senha do servidor que veio no backup nao abre mais o destino: cadastrando uma nova com a chave de recuperacao..."
    nova="$KIT_DIR_CHAVE/senha-nova"
    head -c 32 /dev/urandom | base64 | tr -d '\n=' > "$nova"
    restic key add --new-password-file "$nova" >/dev/null || sair "$SAI_FALHOU" "Nao consegui cadastrar a senha deste servidor no backup."
    printf 'RESTIC_PASSWORD=%s\n' "$(cat "$nova")" | kit_py segredos-trocar "$ENV_FILE"
fi
rm -rf -- "$KIT_PASTA_BACKUP/restore"

if [ -f "$KIT_SCRIPT_MIGRAR" ]; then
    log "Migracoes do pacote que o backup ainda nao tinha (membros migrar)..."
    bash "$KIT_SCRIPT_MIGRAR" || sair "$SAI_FALHOU" "A escola voltou, mas as migracoes desta versao falharam (linhas acima). A instalacao continua no modo de restauracao: corrija e rode sudo membros migrar."
fi

rm -f -- "$KIT_MARCA_RESTAURACAO"
situacao_gravar restauracao.pendente_desde=x: "restauracao.ultima=$(agora_utc)" "restauracao.backup_hora=$snap_hora" "restauracao.snapshot=$snap_curto"
log "Restaurado: a escola $escola esta como estava no backup de $quando."
printf '    Falta: apontar %s para o IP deste servidor (registro A, no painel de DNS do dominio).\n' "$escola"
printf '    A licenca veio no backup: na conferencia seguinte o Emissor reconhece esta instalacao (ate 24 horas,\n'
printf '    ou na hora em Configuracoes > Licenca > Verificar agora).\n'
printf '    O backup diario volta a rodar hoje a noite. A sua folha de recuperacao continua valendo.\n'

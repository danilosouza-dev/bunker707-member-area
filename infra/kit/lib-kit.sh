# Funcoes comuns do comando de operacao do kit (infra/kit/membros; docs/32 §3.2, §4 e §11.7). Carregue com:
#   . "$(dirname -- "${BASH_SOURCE[0]}")/lib-kit.sh"
# Os nomes tecnicos vem de kit.conf (A10); o resto (compose, env_value, wait_healthy) e o infra/scripts/lib.sh de sempre.
# shellcheck shell=bash

KIT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
KIT_PASTA_PACOTE=$(cd -- "$KIT_DIR/../.." && pwd)
# shellcheck source=kit.conf
. "$KIT_DIR/kit.conf"
# O lib.sh de infra/scripts le o compose e o arquivo de segredos destas duas variaveis.
export BUNKER707_COMPOSE_FILE="${BUNKER707_COMPOSE_FILE:-$KIT_ARQUIVO_COMPOSE}"
export BUNKER707_ENV_FILE="${BUNKER707_ENV_FILE:-$KIT_ARQUIVO_SEGREDOS}"
# shellcheck source=../scripts/lib.sh
. "$KIT_DIR/../scripts/lib.sh"
# O projeto do compose vem do kit.conf, por cima do `name:` do arquivo (a ordem do compose: -p, depois esta variavel).
export COMPOSE_PROJECT_NAME="$KIT_PROJETO_COMPOSE"
umask 077

# Codigos de saida de todos os comandos do kit (docs/20 §9B):
SAI_USO=1          # opcao errada, falta configuracao, confirmacao diferente
SAI_DESTINO=2      # o destino do backup nao responde ou nao aceita a chave de acesso
SAI_FALHOU=3       # o backup, o ensaio ou a restauracao falhou (o motivo vem na mensagem)
SAI_OCUPADO=4      # outra operacao do backup esta rodando neste servidor
SAI_CHAVE=5        # a senha ou a chave de recuperacao nao abre o backup
SAI_PENDENTE=6     # o kit de recuperacao nao foi confirmado
SAI_TERMINAL=7     # o passo mostra ou pede uma chave e so roda com uma pessoa no terminal
SAI_DISCO=8        # falta espaco em disco para o ensaio
SAI_RESTAURANDO=9  # a instalacao espera a restauracao de um backup: o backup diario fica parado

KIT_ARQUIVO_SITUACAO="$KIT_PASTA_ESTADO/situacao.json"
KIT_MARCA_RESTAURACAO="$KIT_PASTA_ESTADO/restauracao-pendente"
KIT_PASTA_RECUPERACAO="$KIT_PASTA_ESTADO/recuperacao"
KIT_FOLHA_PENDENTE="$KIT_PASTA_RECUPERACAO/folha-pendente.txt"

sair() {
    local codigo=$1
    shift
    printf 'ERRO: %s\n' "$*" >&2
    exit "$codigo"
}

kit_py() { python3 -I "$KIT_DIR/kit.py" "$@"; }

agora_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# O arquivo de segredos so o administrador le: e ele que decide se o comando pode rodar (sem sudo, para aqui).
exigir_segredos() {
    [ -f "$ENV_FILE" ] || sair "$SAI_USO" "Nao achei o arquivo de segredos da instalacao ($ENV_FILE)."
    [ -r "$ENV_FILE" ] || sair "$SAI_USO" "Este comando le o arquivo de segredos, que so o administrador le: rode com sudo."
}

# situacao_gravar chave=valor ...: o arquivo de situacao (JSON, sem segredo; membros status e o diagnostico leem).
# Recusa gravar valor que contenha um segredo do arquivo de segredos ou a chave de recuperacao em uso.
situacao_gravar() {
    mkdir -p "$KIT_PASTA_ESTADO"
    chmod 755 "$KIT_PASTA_ESTADO" 2>/dev/null || true
    local extra=()
    [ -z "${KIT_ARQUIVO_CHAVE_EM_USO:-}" ] || [ ! -f "$KIT_ARQUIVO_CHAVE_EM_USO" ] || extra=(--segredo-arquivo "$KIT_ARQUIVO_CHAVE_EM_USO")
    kit_py situacao-gravar "$KIT_ARQUIVO_SITUACAO" --segredos "$ENV_FILE" "${extra[@]}" "$@"
}
situacao_ler() { kit_py situacao-ler "$KIT_ARQUIVO_SITUACAO" "$1"; }

# destino_carregar [destino]: o destino do backup (RESTIC_REPOSITORY do arquivo de segredos, ou o dado) e as chaves de
# acesso a ele, exportadas para o restic. Preenche DESTINO_TIPO (s3, sftp ou local) e DESTINO_SERVIDOR.
destino_carregar() {
    local repo=${1:-} analise
    [ -n "$repo" ] || repo=$(env_value RESTIC_REPOSITORY)
    analise=$(printf '%s' "$repo" | kit_py destino-analisar) || exit "$SAI_USO"
    IFS=$'\x1f' read -r DESTINO_TIPO DESTINO_SERVIDOR RESTIC_REPOSITORY <<< "$analise"
    export RESTIC_REPOSITORY
    case "$DESTINO_TIPO" in
        s3)
            AWS_ACCESS_KEY_ID=$(env_value AWS_ACCESS_KEY_ID)
            AWS_SECRET_ACCESS_KEY=$(env_value AWS_SECRET_ACCESS_KEY)
            [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ] \
                || sair "$SAI_USO" "O destino S3 precisa da chave de acesso no arquivo de segredos: AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY (a chave que voce criou no painel do armazenamento, com acesso ao bucket)."
            export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
            AWS_DEFAULT_REGION=$(env_value AWS_DEFAULT_REGION)
            if [ -n "$AWS_DEFAULT_REGION" ]; then export AWS_DEFAULT_REGION; else unset AWS_DEFAULT_REGION; fi
            ;;
        local)
            [ -d "$(dirname -- "$RESTIC_REPOSITORY")" ] || sair "$SAI_DESTINO" "A pasta do backup ($RESTIC_REPOSITORY) nao existe neste servidor: monte o disco ou crie a pasta."
            ;;
    esac
}

# A senha deste servidor para o backup (RESTIC_PASSWORD do arquivo de segredos).
senha_do_servidor() {
    unset RESTIC_PASSWORD_FILE
    RESTIC_PASSWORD=$(env_value RESTIC_PASSWORD)
    [ -n "$RESTIC_PASSWORD" ] || sair "$SAI_USO" "Falta RESTIC_PASSWORD no arquivo de segredos (a senha deste servidor para o backup)."
    export RESTIC_PASSWORD
}

restic_kit() { restic --retry-lock 2m "$@"; }

# restic_abrir: 0 o repositorio abre; 10 nao ha repositorio no destino; 12 a senha nao abre; 2 o destino nao responde ou
# recusa a chave de acesso (o motivo do restic fica em RESTIC_MOTIVO, sem segredo: o restic nao repete senha).
restic_abrir() {
    local saida rc=0
    saida=$(restic cat config 2>&1 >/dev/null) || rc=$?
    RESTIC_MOTIVO=$(printf '%s\n' "$saida" | grep -v '^$' | tail -n 2 | tr '\n' ' ')
    [ "$rc" -ne 0 ] || return 0
    case "$saida" in
        *"wrong password"*|*"no key found"*) return 12 ;;
        *"Access Denied"*|*"AccessDenied"*|*"InvalidAccessKeyId"*|*"SignatureDoesNotMatch"*|*"403 Forbidden"*|*"Permission denied"*|*"permission denied"*) return 2 ;;
        *"Is there a repository at the following location"*|*"repository does not exist"*|*"The specified bucket does not exist"*) return 10 ;;
    esac
    case "$rc" in 10|12) return "$rc" ;; esac
    return 2
}

# trava_backup [espera]: uma operacao do backup por vez neste servidor (backup, ensaio, restauracao, kit de recuperacao).
# Sem espera, para na hora com o codigo 4; o backup agendado espera ate a outra terminar.
trava_backup() {
    local espera=${1:-0} quem
    mkdir -p "$(dirname -- "$KIT_ARQUIVO_TRAVA")"
    exec 9>>"$KIT_ARQUIVO_TRAVA"
    if ! flock -w "$espera" 9; then
        quem=$(head -n1 "$KIT_ARQUIVO_TRAVA" 2>/dev/null || true)
        sair "$SAI_OCUPADO" "Outra operacao do backup esta rodando neste servidor agora${quem:+ ($quem)}. Espere ela terminar e rode de novo."
    fi
    printf '%s, desde %s\n' "${KIT_OPERACAO:-membros}" "$(date -u '+%d/%m/%Y %H:%M UTC')" > "$KIT_ARQUIVO_TRAVA"
}

# A pasta da chave de recuperacao digitada: na memoria (/dev/shm), so do administrador, apagada no fim.
KIT_DIR_CHAVE=""
chave_temporaria_criar() {
    local base=$KIT_PASTA_TEMPORARIA
    if [ ! -d "$base" ] || [ ! -w "$base" ]; then
        base="$KIT_PASTA_ESTADO/tmp"
        mkdir -p "$base"
    fi
    KIT_DIR_CHAVE=$(mktemp -d "$base/kit-chave.XXXXXX")
    chmod 700 "$KIT_DIR_CHAVE"
}
chave_temporaria_apagar() {
    [ -n "$KIT_DIR_CHAVE" ] || return 0
    find "$KIT_DIR_CHAVE" -type f -exec shred -u {} + 2>/dev/null || true
    rm -rf -- "$KIT_DIR_CHAVE"
    KIT_DIR_CHAVE=""
}

# ler_chave_de_recuperacao DESTINO [ARQUIVO]: a chave da folha, de um arquivo so do administrador ou digitada sem eco,
# no formato da folha (maiusculas, hifens; O vira 0 e I ou L viram 1), gravada em DESTINO (0600) para o restic ler pelo
# RESTIC_PASSWORD_FILE. Nunca passa pela tela, pelo registro, pela linha de comando nem pelo ambiente.
ler_chave_de_recuperacao() {
    local destino=$1 arquivo=${2:-} digitada=""
    if [ -n "$arquivo" ]; then
        [ -f "$arquivo" ] && [ -r "$arquivo" ] || sair "$SAI_USO" "Nao consigo ler $arquivo."
        if [ "$(stat -c %a "$arquivo")" != "600" ] && [ "$(stat -c %a "$arquivo")" != "400" ]; then
            sair "$SAI_USO" "$arquivo pode ser lido por outros usuarios: deixe so o administrador ler (chmod 600) e rode de novo."
        fi
        kit_py normalizar-chave < "$arquivo" > "$destino"
    else
        [ -t 0 ] || sair "$SAI_TERMINAL" "Este passo pede a chave de recuperacao da folha: rode no terminal do servidor, ou passe --chave-arquivo com a chave num arquivo so do administrador."
        printf 'Digite a chave de recuperacao da folha (ela nao aparece na tela): ' >&2
        IFS= read -rs digitada || true
        printf '\n' >&2
        [ -n "$digitada" ] || sair "$SAI_USO" "Nenhuma chave digitada."
        printf '%s' "$digitada" | kit_py normalizar-chave > "$destino"
        digitada=""
    fi
    chmod 600 "$destino"
    [ -s "$destino" ] || sair "$SAI_USO" "A chave de recuperacao veio vazia."
    KIT_ARQUIVO_CHAVE_EM_USO=$destino
}

# Conta as contas do Auth no banco da escola (0 = instalacao vazia, recem-criada ou esperando restauracao).
contas_da_escola() {
    compose exec -T "$KIT_SERVICO_BANCO" psql -U supabase_admin -h 127.0.0.1 -d "$(env_value POSTGRES_DB postgres)" -X -At \
        -c 'select count(*) from auth.users' 2>/dev/null | tr -d '[:space:]'
}

banco_no_ar() { [ -n "$(compose ps -q --status running "$KIT_SERVICO_BANCO" 2>/dev/null | head -n1)" ]; }

#!/usr/bin/env bash
# Migrador do kit do produto licenciado (docs/32 §11.6; docs/20 §9A): aplica as migracoes do pacote no Postgres do
# servidor sem a CLI do Supabase, gravando o mesmo historico que ela grava (supabase_migrations.schema_migrations).
#   bash infra/kit/migrar.sh               confere o historico contra o pacote e aplica o que falta
#   bash infra/kit/migrar.sh --listar      so confere e lista o que seria aplicado; nada muda no banco
#   ... [--pasta <dir>] [--banco <nome>]   outra pasta de migracoes (padrao: supabase/migrations) e outro banco
#                                          (padrao: POSTGRES_DB do .env do compose, ou postgres)
# Como roda: uma sessao so do psql, dentro do container do banco (servico db do compose), como o usuario postgres e com
# ON_ERROR_STOP. A sessao pega uma trava contra outra execucao (pg_advisory_lock), le o historico, confere o pacote e
# aplica cada arquivo pendente numa transacao propria, com a linha do historico na mesma transacao, como a CLI 2.121.0
# (version, name e os comandos cortados pelo mesmo divisor dela). Arquivo cuja primeira linha e exatamente
# "-- pg-delta: transaction=false" roda sem transacao, comando por comando, tambem como na CLI. As ferramentas de SQL
# ficam em infra/kit/migrador.sql e vivem so na sessao (pg_temp).
# Recusa antes de aplicar qualquer coisa: versao no historico sem arquivo no pacote; arquivo pendente mais velho que a
# ultima aplicada; arquivo ja aplicado que mudou (os comandos do historico nao batem com os do arquivo); nome fora do
# padrao; arquivo que nao e UTF-8; comando que nao roda em transacao, ou BEGIN/COMMIT, sem a primeira linha acima;
# DISCARD; barra invertida fora de texto (o psql leria como comando dele).
# Codigos de saida: 0 banco em dia; 1 uso ou ambiente; 2 sem conexao com o banco; 3 uma migracao falhou (desfeita
# inteira; as anteriores ficam); 4 outra execucao do migrador esta aplicando; 5 o historico do banco nao bate com o
# pacote; 6 migracao ja aplicada mudou no pacote; 7 arquivo do pacote recusado.
# Variaveis: MIGRAR_CONTAINER (um container com Postgres no lugar do servico db do compose, ex.: o banco local da CLI
# no CI) e MIGRAR_PSQL (comando de um psql desta maquina, ja com a conexao: ensaio e testes). Nada aqui imprime senha:
# dentro do container, o psql entra pelo socket local.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: o script usa arrays, [[ ]] e PIPESTATUS.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

KIT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$KIT_DIR/../scripts/lib.sh"
shopt -s lastpipe nullglob dotglob

# Igual ao MIGRATE_FILE_PATTERN da CLI: <versao numerica>_<nome>.sql.
PADRAO='^([0-9]+)_(.*)\.sql$'
SEP=$'\x1f'

sair() {
    local codigo=$1
    shift
    printf 'ERRO: %s\n' "$*" >&2
    exit "$codigo"
}

listar=0
pasta="$REPO_ROOT/supabase/migrations"
banco=""
while [ $# -gt 0 ]; do
    case "$1" in
        --listar) listar=1 ;;
        --pasta) [ $# -ge 2 ] || sair 1 "--pasta precisa de uma pasta."; pasta=$2; shift ;;
        --pasta=*) pasta=${1#*=} ;;
        --banco) [ $# -ge 2 ] || sair 1 "--banco precisa de um nome."; banco=$2; shift ;;
        --banco=*) banco=${1#*=} ;;
        -h|--help) sed -n 2,23p "$0"; exit 0 ;;
        *) sair 1 "opcao desconhecida: $1 (veja --help)." ;;
    esac
    shift
done
[ -d "$pasta" ] || sair 1 "Nao achei a pasta de migracoes $pasta."
pasta=$(cd -- "$pasta" && pwd)
[ -z "$banco" ] || [[ $banco =~ ^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$ ]] || sair 1 "Nome de banco invalido: $banco."

# 1. As migracoes do pacote, como a CLI le a pasta: so <versao>_<nome>.sql, o resto e pulado com aviso.
arquivos=()
for caminho in "$pasta"/*; do
    nome=${caminho##*/}
    [ -d "$caminho" ] && continue
    if [[ ! $nome =~ $PADRAO ]] || [[ $nome == *$'\n'* ]]; then
        warn "pulei $nome: o nome precisa ser <versao>_<nome>.sql (a CLI do Supabase tambem pula)."
        continue
    fi
    # Nome que a CLI aceitaria mas que este migrador nao manda ao psql sem escapar: recusado, nunca pulado (pular
    # deixaria a CLI e o migrador com historicos diferentes).
    [[ $nome =~ ^[A-Za-z0-9._-]+$ ]] || sair 7 "$nome: o nome so pode ter letras sem acento, numeros, ponto, hifen e sublinhado."
    [ -r "$caminho" ] || sair 1 "Nao consigo ler $caminho."
    arquivos+=("$nome")
done
[ "${#arquivos[@]}" -gt 0 ] || sair 1 "Nenhuma migracao em $pasta."

# 2. Onde o psql roda: num psql desta maquina (MIGRAR_PSQL), num container dado (MIGRAR_CONTAINER) ou no servico db do
#    compose do kit. Nos dois ultimos, como postgres, pelo socket do container (sem senha na linha de comando).
ambiente_psql=(PGAPPNAME=bunker-migrar PGCLIENTENCODING=UTF8 "PGOPTIONS=-c client_min_messages=warning")
cid=""
if [ -n "${MIGRAR_PSQL:-}" ]; then
    read -r -a psql_cmd <<< "$MIGRAR_PSQL"
    alvo="o banco do psql de MIGRAR_PSQL"
elif [ -n "${MIGRAR_CONTAINER:-}" ]; then
    [ "$(docker inspect -f '{{.State.Running}}' "$MIGRAR_CONTAINER" 2>/dev/null || true)" = "true" ] \
        || sair 2 "O container $MIGRAR_CONTAINER nao esta no ar (ou nao existe)."
    cid=$MIGRAR_CONTAINER
    banco=${banco:-postgres}
    alvo="o banco $banco do container $cid"
else
    if [ -z "$banco" ]; then
        banco=postgres
        [ ! -f "$ENV_FILE" ] || banco=$(env_value POSTGRES_DB postgres)
    fi
    cid=$(compose ps -q --status running db 2>/dev/null | head -n1 || true)
    [ -n "$cid" ] || sair 2 "O banco (servico db de $COMPOSE_FILE) nao esta no ar. Suba antes: docker compose -f $COMPOSE_FILE up -d db"
    alvo="o banco $banco do servico db do compose"
fi
if [ -n "$cid" ]; then
    psql_cmd=(docker exec -i)
    for variavel in "${ambiente_psql[@]}"; do psql_cmd+=(-e "$variavel"); done
    psql_cmd+=("$cid" psql -U postgres -d "$banco")
fi

tmp=$(mktemp -d)
dir_psql=""
limpar() {
    [ -z "$dir_psql" ] || [ -z "$cid" ] || docker exec "$cid" rm -rf -- "$dir_psql" >/dev/null 2>&1 || true
    rm -rf "$tmp"
}
trap limpar EXIT

# 3. Os arquivos onde o psql os le (o \i guarda o nome e a linha nas mensagens de erro): no container, uma pasta
#    temporaria so desta execucao; com MIGRAR_PSQL, a propria pasta.
if [ -n "$cid" ]; then
    mkdir "$tmp/migracoes"
    for nome in "${arquivos[@]}"; do cp -- "$pasta/$nome" "$tmp/migracoes/"; done
    dir_psql="/tmp/bkmigrar.$$.$RANDOM"
    docker cp "$tmp/migracoes/." "$cid:$dir_psql" >/dev/null 2>&1 || { dir_psql=""; sair 2 "Nao consegui copiar as migracoes para o container do banco."; }
else
    dir_psql=""
fi
caminho_no_psql() { if [ -n "$cid" ]; then printf '%s/%s' "$dir_psql" "$1"; else printf '%s/%s' "$pasta" "$1"; fi; }

# Texto entre aspas simples para o SQL e para argumento de comando do psql (que tambem le \ como escape).
sql_texto() { printf "'%s'" "${1//\'/\'\'}"; }
psql_texto() { local s=${1//\\/\\\\}; printf "'%s'" "${s//\'/\'\'}"; }

# 4. O roteiro da sessao: ferramentas, pacote (os bytes de cada arquivo em base64), trava, plano, conferencia e um
#    bloco por arquivo, que so roda se o plano mandar.
roteiro="$tmp/roteiro.sql"
{
    printf '%s\n' '\set QUIET on' '\set ON_ERROR_STOP on' '\set VERBOSITY default' '\set SHOW_CONTEXT errors' \
        '\pset pager off' '\pset format unaligned' '\pset tuples_only on' '\pset footer off'
    cat "$KIT_DIR/migrador.sql"
    for nome in "${arquivos[@]}"; do
        [[ $nome =~ $PADRAO ]]
        printf 'insert into pg_temp.bk_pacote (versao, nome, arquivo, bytes) values (%s, %s, %s, decode(%s\n' \
            "$(sql_texto "${BASH_REMATCH[1]}")" "$(sql_texto "${BASH_REMATCH[2]}")" "$(sql_texto "$nome")" "'"
        base64 < "$pasta/$nome"
        printf "', 'base64'));\n"
    done
    if [ "$listar" = 1 ]; then
        # So leitura daqui para a frente: o --listar nunca muda nada fora das tabelas temporarias da sessao.
        printf '%s\n' 'set session characteristics as transaction read only;' \
            "select pg_temp.bk_linha('A', '', 'outra execucao do migrador esta aplicando agora; a lista pode mudar em instantes.') where not pg_temp.bk_trava_livre();" \
            'select * from pg_temp.bk_planejar();' \
            'select pg_temp.bk_conferir();'
    else
        printf '%s\n' 'select pg_temp.bk_travar();' 'select * from pg_temp.bk_planejar();' 'select pg_temp.bk_conferir();'
        # A tabela do historico, como o createMigrationTable da CLI: so quando ha o que aplicar e ela ainda nao tem as
        # tres colunas.
        cat <<'SQL'
select exists (select 1 from pg_temp.bk_plano where aplicar) as bk_tem_pendentes, pg_temp.bk_historico_pronto() as bk_historico_pronto \gset
\if :bk_tem_pendentes
\if :bk_historico_pronto
\else
BEGIN;
SET LOCAL lock_timeout = '4s';
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY);
ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS statements text[];
ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS name text;
COMMIT;
\endif
\endif
SQL
        for nome in "${arquivos[@]}"; do
            [[ $nome =~ $PADRAO ]]
            versao=${BASH_REMATCH[1]}
            arquivo_psql=$(psql_texto "$(caminho_no_psql "$nome")")
            insert="INSERT INTO supabase_migrations.schema_migrations (version, name, statements) SELECT versao, nome, comandos FROM pg_temp.bk_plano WHERE versao = '$versao';"
            # Como a CLI: RESET ALL antes de cada arquivo; o arquivo e a linha do historico na mesma transacao (ou, com a
            # diretiva, cada comando por conta propria e a linha no fim). O que o arquivo imprime vai para /dev/null.
            cat <<SQL
select coalesce((select aplicar from pg_temp.bk_plano where versao = '$versao'), false) as bk_aplicar, coalesce((select modo = 'sem_transacao' from pg_temp.bk_plano where versao = '$versao'), false) as bk_sem_transacao \\gset
\\if :bk_aplicar
\\echo 'BKMIGRAR\\x1faplicando\\x1f$versao\\x1f$nome'
RESET ALL;
\\if :bk_sem_transacao
\\o /dev/null
\\i $arquivo_psql
\\o
$insert
\\else
BEGIN;
\\o /dev/null
\\i $arquivo_psql
\\o
$insert
COMMIT;
\\endif
\\echo 'BKMIGRAR\\x1faplicada\\x1f$versao'
\\endif
SQL
        done
    fi
    printf '%s\n' "\\echo 'BKMIGRAR\\x1ffim'"
} > "$roteiro"

# 5. Roda e acompanha: o psql conta o que faz em linhas BKMIGRAR (resumo, avisos, problemas, pendentes, cada arquivo).
log "Migracoes de $pasta (${#arquivos[@]} arquivos) para $alvo."
inicio=$(date +%s)
n_pacote=0; n_historico=0; n_pendentes=0; aplicadas=0; fim=0; atual=""; atual_modo=""
declare -A modo_de=()
set +e
env "${ambiente_psql[@]}" "${psql_cmd[@]}" -X -q -v ON_ERROR_STOP=1 < "$roteiro" 2> "$tmp/erros" \
    | while IFS=$SEP read -r marca tipo a b c; do
        [ "$marca" = "BKMIGRAR" ] || continue
        case "$tipo" in
            R)
                n_pacote=$a; n_historico=$b; n_pendentes=$c
                log "Pacote: $n_pacote migracoes. No historico do banco: $n_historico. Faltam: $n_pendentes."
                ;;
            A) warn "$b" ;;
            X) printf 'ERRO: %s\n' "$c" >&2 ;;
            P)
                modo_de[$a]=$c
                if [ "$listar" = 1 ]; then
                    if [ "$c" = "sem_transacao" ]; then printf '    %s (sem transacao)\n' "$b"; else printf '    %s\n' "$b"; fi
                fi
                ;;
            aplicando)
                atual=$b; atual_modo=${modo_de[$a]:-transacao}
                if [ "$atual_modo" = "sem_transacao" ]; then log "Aplicando $b (sem transacao, comando por comando)"; else log "Aplicando $b"; fi
                ;;
            aplicada) aplicadas=$((aplicadas + 1)); atual="" ;;
            fim) fim=1 ;;
        esac
    done
rc=${PIPESTATUS[0]}
set -e
segundos=$(( $(date +%s) - inicio ))

# As mensagens do psql, com o caminho temporario do container trocado pela pasta do pacote e sem as linhas da conferencia.
erros_do_psql() {
    local linha
    while IFS= read -r linha; do
        case "$linha" in
            *bkmigrar:*) continue ;;
        esac
        [ -z "$dir_psql" ] || linha=${linha//"$dir_psql"/"$pasta"}
        printf '      %s\n' "$linha" >&2
    done < "$tmp/erros"
}
detalhe_da_trava() { sed -n 's/^DETAIL: *//p' "$tmp/erros" | head -n1; }

if [ "$rc" -eq 0 ] && [ "$fim" = 1 ]; then
    if [ "$listar" = 1 ]; then
        if [ "$n_pendentes" -eq 0 ]; then log "O banco esta em dia com o pacote: nada a aplicar."; else log "Nada foi aplicado (--listar)."; fi
    elif [ "$aplicadas" -eq 0 ]; then
        log "Nada a aplicar: o banco ja esta em dia com o pacote ($n_pacote migracoes)."
    else
        log "Pronto: $aplicadas migracoes aplicadas em ${segundos}s; o banco esta em dia com o pacote."
    fi
    exit 0
fi

conferencia=$(grep -o -m1 -E 'bkmigrar:(trava|historico|alterada|recusada)' "$tmp/erros" || true)
case "$conferencia" in
    bkmigrar:trava)
        sair 4 "Outra execucao do migrador esta aplicando migracoes neste banco agora. $(detalhe_da_trava) Espere ela terminar e rode de novo."
        ;;
    bkmigrar:historico)
        sair 5 "O historico do banco nao bate com o pacote (linhas acima). Nada foi aplicado. Confira se este pacote e o desta instalacao; um pacote mais velho que o banco nunca e aplicado."
        ;;
    bkmigrar:alterada)
        sair 6 "Uma migracao que o banco ja aplicou mudou no pacote (linhas acima). Nada foi aplicado. O pacote nao confere: baixe de novo ou fale com o suporte."
        ;;
    bkmigrar:recusada)
        sair 7 "Arquivo do pacote recusado (linhas acima). Nada foi aplicado."
        ;;
esac

if [ "$rc" -eq 2 ] && [ -z "$atual" ] && [ "$aplicadas" -eq 0 ]; then
    erros_do_psql
    sair 2 "Nao consegui conectar no banco ($alvo)."
fi
erros_do_psql
if [ -n "$atual" ]; then
    if [ "$atual_modo" = "sem_transacao" ]; then
        sair 3 "A migracao $atual falhou. Ela roda sem transacao: os comandos dela que vieram antes do erro ficaram no banco, e ela nao entrou no historico (na proxima vez roda de novo do comeco). $aplicadas antes dela ficaram aplicadas."
    fi
    sair 3 "A migracao $atual falhou e foi desfeita inteira: nada dela ficou no banco. $aplicadas antes dela ficaram aplicadas; rode de novo depois de corrigir (o migrador continua dela)."
fi
sair 3 "O migrador parou antes do fim (psql saiu com $rc); $aplicadas migracoes aplicadas."

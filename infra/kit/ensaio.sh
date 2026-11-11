#!/usr/bin/env bash
# Ensaio de restauracao (docs/32 §4 e §1.2; docs/20 §9B). Pelo comando de operacao, no terminal do servidor:
#   sudo membros restaurar --ensaio [--snapshot ID] [--chave-arquivo ARQ]
# Abre o backup mais novo com dados (ou o --snapshot) com a CHAVE DE RECUPERACAO da folha, digitada (ou num arquivo so
# do administrador), restaura o banco num Postgres temporario e isolado neste mesmo servidor, confere que a escola esta
# la dentro (contas, alunos com acesso, conteudos, aulas, acessos, a linha da licenca e os arquivos do Storage, objeto por objeto
# contra a lista do backup), diz o veredito em portugues e apaga tudo, tambem quando falha ou e interrompido.
# Isolamento: um container so, da mesma imagem do banco da escola (ja esta no servidor: nada e baixado), com nome e
# rotulo proprios (KIT_ENSAIO_PREFIXO, KIT_ENSAIO_ROTULO), SEM REDE (--network none: nem a internet, nem o Emissor, nem
# o e-mail, nem os containers da escola), sem porta publicada, sem privilegio, com teto de memoria e de processador
# (KIT_ENSAIO_MEMORIA, KIT_ENSAIO_CPUS) e com o pg_cron sem disparar tarefa. As unicas pastas montadas sao as do proprio
# ensaio (KIT_PASTA_BACKUP/ensaio/<id>): o banco temporario e o dump, so leitura. O docker inspect do container e
# conferido antes de ele ligar; nada da escola e tocado (o compose so e lido, para saber a imagem do banco).
# Do backup saem so o dump, os papeis e a chave do Vault (nem o arquivo de segredos, nem os arquivos do Storage, que
# sao conferidos pela lista). Sobras de um ensaio que parou no meio (queda de luz) sao apagadas no comeco do seguinte.
# Disco: pede cerca de 5 vezes o tamanho do dump mais 1 GB livres, e para antes (codigo 8) se nao houver.
# Codigos de saida: os de lib-kit.sh; 0 e "deu certo" (com ou sem avisos), 3 e "falhou" (o motivo vem no veredito).
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: o script usa arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "${BASH_SOURCE[0]}")/lib-kit.sh"
KIT_OPERACAO="membros restaurar --ensaio"

snapshot=""
chave_arquivo=""
while [ $# -gt 0 ]; do
    case "$1" in
        --snapshot) [ $# -ge 2 ] || sair "$SAI_USO" "--snapshot precisa do id de um backup."; snapshot=$2; shift ;;
        --snapshot=*) snapshot=${1#*=} ;;
        --chave-arquivo) [ $# -ge 2 ] || sair "$SAI_USO" "--chave-arquivo precisa de um arquivo."; chave_arquivo=$2; shift ;;
        --chave-arquivo=*) chave_arquivo=${1#*=} ;;
        --ensaio) ;;
        -h|--help) sed -n 2,19p "$0"; exit 0 ;;
        *) sair "$SAI_USO" "opcao desconhecida: $1 (veja: membros restaurar --ensaio --help)" ;;
    esac
    shift
done

exigir_segredos
destino_carregar
command -v docker >/dev/null 2>&1 || sair "$SAI_USO" "O ensaio precisa do Docker, e ele nao esta neste servidor."
[ -t 0 ] || [ -n "$chave_arquivo" ] || sair "$SAI_TERMINAL" "O ensaio pede a chave de recuperacao da folha: rode no terminal do servidor (sudo membros restaurar --ensaio) ou passe --chave-arquivo com a chave num arquivo so do administrador."
trava_backup 0

id="$(date -u +%Y%m%d%H%M%S)-$$"
nome="$KIT_ENSAIO_PREFIXO-$id"
pasta_ensaios="$KIT_PASTA_BACKUP/ensaio"
pasta="$pasta_ensaios/$id"
terminou=0
comecou=0
resultado=falhou
motivo="parou antes do fim"
snap_hora=""
snap_curto=""

limpar() {
    local rc=$?
    docker rm -f -v "$nome" >/dev/null 2>&1 || true
    rm -rf -- "$pasta"
    rmdir -- "$pasta_ensaios" 2>/dev/null || true
    chave_temporaria_apagar
    if [ "$terminou" != 1 ] && [ "$comecou" = 1 ]; then
        # Os codigos com sentido proprio ficam; o resto (um comando que falhou no meio) e "o ensaio falhou".
        case "$rc" in "$SAI_DESTINO"|"$SAI_CHAVE"|"$SAI_DISCO"|130|143) ;; *) rc=$SAI_FALHOU ;; esac
        situacao_gravar "ensaio.ultimo=$(agora_utc)" "ensaio.resultado=$resultado" "ensaio.motivo=$motivo" \
            "ensaio.backup_hora=${snap_hora:-x:}" "ensaio.snapshot=${snap_curto:-x:}" ensaio.contagens=x: >/dev/null 2>&1 || true
        printf '==> Ensaio de restauracao: %s (%s). Tudo o que o ensaio criou foi apagado; a escola nao foi tocada.\n' \
            "$([ "$resultado" = interrompido ] && echo "INTERROMPIDO" || echo "FALHOU")" "$motivo"
    fi
    exit "$rc"
}
trap limpar EXIT
trap 'resultado=interrompido; motivo="interrompido no meio"; exit 130' INT
trap 'resultado=interrompido; motivo="interrompido no meio"; exit 143' TERM HUP

# Sobras de um ensaio anterior que parou no meio: so o que tem o rotulo do ensaio e a pasta dele (a trava garante que
# nenhum outro ensaio esta rodando agora).
sobras=$(docker ps -aq --filter "label=$KIT_ENSAIO_ROTULO" 2>/dev/null || true)
if [ -n "$sobras" ]; then
    log "Apagando o que sobrou de um ensaio anterior..."
    # shellcheck disable=SC2086
    docker rm -f -v $sobras >/dev/null 2>&1 || true
fi
rm -rf -- "$pasta_ensaios"
mkdir -p "$pasta"
chmod 700 "$pasta_ensaios" "$pasta"

chave_temporaria_criar
ler_chave_de_recuperacao "$KIT_DIR_CHAVE/chave" "$chave_arquivo"
comecou=1
unset RESTIC_PASSWORD
export RESTIC_PASSWORD_FILE="$KIT_DIR_CHAVE/chave"

motivo="a chave de recuperacao nao abriu o backup"
rc=0; restic_abrir || rc=$?
case "$rc" in
    0) ;;
    12) sair "$SAI_CHAVE" "A chave de recuperacao digitada nao abre o backup. Confira a folha (letras e numeros, 8 grupos de 4); se ela se perdeu, gere outra: sudo membros kit-de-recuperacao --nova." ;;
    10) motivo="nao ha backup no destino"; sair "$SAI_DESTINO" "Nao ha backup em $RESTIC_REPOSITORY." ;;
    *) motivo="o destino do backup nao respondeu"; sair "$SAI_DESTINO" "O destino do backup nao respondeu ou recusou a chave de acesso: $RESTIC_MOTIVO" ;;
esac

motivo="nao achei o backup"
escolha=$(restic snapshots --json --host "$KIT_BACKUP_HOST" --tag "$KIT_BACKUP_TAG" | kit_py escolher-backup "$snapshot")
read -r snap_id snap_curto snap_hora snap_marcas <<< "$escolha"
log "Backup $snap_curto de $snap_hora ($snap_marcas), aberto com a chave de recuperacao"
motivo="a lista do backup nao abriu"
restic ls --json "$snap_id" > "$pasta/lista.jsonl"
motivo="o backup nao tem a exportacao do banco"
plano=$(kit_py plano-do-ensaio "$pasta/lista.jsonl")
eval "$plano"

motivo="falta espaco em disco"
livre_kb=$(df -Pk "$pasta" | awk 'NR == 2 { print $4 }')
precisa_kb=$(( PLANO_DUMP_BYTES * 5 / 1024 + 1048576 ))
if [ "${livre_kb:-0}" -lt "$precisa_kb" ]; then
    sair "$SAI_DISCO" "O ensaio precisa de cerca de $((precisa_kb / 1024)) MB livres no disco e ha $((livre_kb / 1024)) MB: a escola nao pode ficar sem disco. Libere espaco e rode de novo."
fi

log "Baixando do backup so o dump do banco, os papeis e a chave do Vault..."
motivo="o dump nao saiu do backup"
inclui=(--include "$PLANO_DUMP")
[ -z "$PLANO_ROLES" ] || inclui+=(--include "$PLANO_ROLES")
[ -z "$PLANO_CHAVE_VAULT" ] || inclui+=(--include "$PLANO_CHAVE_VAULT")
restic restore "$snap_id" --target "$pasta/restaurado" "${inclui[@]}" >/dev/null
entrada="$pasta/restaurado$PLANO_ETAPA"
[ -s "$entrada/postgres.dump" ] || sair "$SAI_FALHOU" "O dump do banco nao saiu do backup."
chmod 755 "$entrada"
chmod 644 "$entrada"/*

motivo="nao achei a imagem do banco no compose"
imagem=$(compose config --format json | kit_py imagem-do-servico "$KIT_SERVICO_BANCO")
mkdir -p "$pasta/banco"
senha=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
printf 'POSTGRES_PASSWORD=%s\nPGPASSWORD=%s\n' "$senha" "$senha" > "$pasta/ambiente"
chmod 600 "$pasta/ambiente"

log "Banco temporario do ensaio ($imagem), sem rede, com ate $KIT_ENSAIO_MEMORIA de memoria"
motivo="o banco do ensaio nao foi criado"
docker create --name "$nome" --label "$KIT_ENSAIO_ROTULO=$id" \
    --network none --restart no \
    --memory "$KIT_ENSAIO_MEMORIA" --memory-swap "$KIT_ENSAIO_MEMORIA" --cpus "$KIT_ENSAIO_CPUS" --pids-limit 512 \
    --env-file "$pasta/ambiente" \
    -v "$pasta/banco:/var/lib/postgresql/data" \
    -v "$entrada:/ensaio:ro" \
    "$imagem" postgres -c config_file=/etc/postgresql/postgresql.conf \
    -c shared_buffers=64MB -c work_mem=4MB -c maintenance_work_mem=64MB -c max_connections=20 -c max_wal_size=256MB \
    -c cron.launch_active_jobs=off -c log_min_messages=fatal >/dev/null
motivo="o container do ensaio nao ficou isolado"
if ! problemas=$(docker inspect "$nome" | kit_py isolamento "$pasta" "$nome" 2>&1); then
    printf '%s\n' "$problemas" >&2
    sair "$SAI_FALHOU" "O container do ensaio nao ficou isolado da escola (linhas acima). Ele foi apagado sem ligar."
fi
if [ -n "$PLANO_CHAVE_VAULT" ]; then
    docker cp "$pasta/restaurado$PLANO_CHAVE_VAULT" "$nome:/etc/postgresql-custom/pgsodium_root.key" >/dev/null
fi

motivo="o banco do ensaio nao subiu"
docker start "$nome" >/dev/null
pronto=""
for ((espera = 0; espera < KIT_ENSAIO_ESPERA; espera += 2)); do
    if docker exec "$nome" pg_isready -h 127.0.0.1 -U supabase_admin -d postgres >/dev/null 2>&1; then pronto=1; break; fi
    [ "$(docker inspect -f '{{.State.Running}}' "$nome" 2>/dev/null)" = true ] || break
    sleep 2
done
if [ -z "$pronto" ]; then
    if [ "$(docker inspect -f '{{.State.OOMKilled}}' "$nome" 2>/dev/null)" = true ]; then
        motivo="o banco do ensaio passou do teto de memoria ($KIT_ENSAIO_MEMORIA)"
    fi
    docker logs --tail 20 "$nome" 2>&1 | sed 's/^/    /' >&2 || true
    sair "$SAI_FALHOU" "O banco temporario do ensaio nao subiu em ${KIT_ENSAIO_ESPERA}s ($motivo)."
fi

psql_ensaio() { docker exec -i "$nome" psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }

motivo="o dump do backup nao e legivel"
docker exec "$nome" pg_restore --list /ensaio/postgres.dump >/dev/null 2>&1 \
    || sair "$SAI_FALHOU" "O postgres.dump do backup $snap_curto nao e um arquivo do pg_dump legivel."
log "Restaurando o banco no ensaio (como o restore.sh: papeis, pg_restore --clean, permissoes)..."
motivo="a restauracao do banco falhou"
if [ -n "$PLANO_ROLES" ]; then
    docker exec -i "$nome" psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=0 < "$entrada/roles.sql" >/dev/null 2>"$pasta/roles.log" || true
fi
# Os privilegios padrao da imagem dariam a anon e authenticated acesso a tudo que o pg_restore recria (o pg_dump so grava
# GRANTs): suspensos durante a restauracao, como no restore.sh, e conferidos no fim.
psql_ensaio <<'SQL'
alter default privileges for role supabase_admin in schema public revoke all on tables from postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public revoke all on sequences from postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public revoke all on functions from postgres, anon, authenticated, service_role;
SQL
docker exec "$nome" pg_restore -U supabase_admin -d postgres --clean --if-exists --no-password /ensaio/postgres.dump 2>"$pasta/pg_restore.log" || true
erros_restore=$(grep -c 'ERROR' "$pasta/pg_restore.log" || true)
if [ -n "${KIT_ENSAIO_GUARDAR_REGISTRO:-}" ]; then cp "$pasta/pg_restore.log" "$KIT_PASTA_ESTADO/ensaio-pg_restore.log"; fi
psql_ensaio <<'SQL'
alter default privileges for role supabase_admin in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on functions to postgres, anon, authenticated, service_role;
SQL

motivo="nao consegui contar o que voltou"
anon_aberto=$(psql_ensaio -At <<'SQL'
select (
  (case when to_regclass('public.job_runs') is null then false else has_table_privilege('anon', 'public.job_runs', 'select') end)
  or (case when to_regprocedure('public.enqueue_jobs_tick()') is null then false else has_function_privilege('anon', 'public.enqueue_jobs_tick()', 'execute') end)
)::text;
SQL
)
psql_ensaio -At > "$pasta/contagens.json" <<'SQL'
create function pg_temp.bk_contar(tabela text) returns bigint language plpgsql as $f$
declare n bigint;
begin
  if to_regclass(tabela) is null then return null; end if;
  execute 'select count(*) from ' || to_regclass(tabela)::text into n;
  return n;
end $f$;
create function pg_temp.bk_valor(tabela text, consulta text) returns text language plpgsql as $f$
declare v text;
begin
  if to_regclass(tabela) is null then return null; end if;
  execute consulta into v;
  return v;
end $f$;
select json_build_object(
  'contas', pg_temp.bk_contar('auth.users'),
  'alunos', pg_temp.bk_valor('public.entitlements', 'select count(distinct user_id)::text from public.entitlements')::bigint,
  'conteudos', pg_temp.bk_contar('public.content_items'),
  'aulas', pg_temp.bk_contar('public.lessons'),
  'acessos', pg_temp.bk_contar('public.entitlements'),
  'progresso', pg_temp.bk_contar('public.lesson_progress'),
  'licenca', pg_temp.bk_contar('public.license_state'),
  'licenca_ativada', pg_temp.bk_valor('public.license_state', 'select coalesce(bool_or(ever_activated), false)::text from public.license_state') = 'true',
  'objetos_storage', pg_temp.bk_contar('storage.objects'),
  'ultima_migracao', pg_temp.bk_valor('supabase_migrations.schema_migrations', 'select max(version) from supabase_migrations.schema_migrations')
)::text;
SQL
# Os objetos do Storage que o banco conhece (bucket, nome, versao), para conferir um a um contra a lista do backup.
psql_ensaio -At > "$pasta/objetos.txt" <<'SQL'
create function pg_temp.bk_objetos() returns text language plpgsql as $f$
declare t text;
begin
  if to_regclass('storage.objects') is null then return ''; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'objects' and column_name = 'version') then
    execute $q$select coalesce(string_agg(bucket_id || chr(31) || name || chr(31) || coalesce(version, ''), chr(30) order by bucket_id, name), '') from storage.objects$q$ into t;
  else
    execute $q$select coalesce(string_agg(bucket_id || chr(31) || name || chr(31), chr(30) order by bucket_id, name), '') from storage.objects$q$ into t;
  end if;
  return t;
end $f$;
select pg_temp.bk_objetos();
SQL

docker rm -f -v "$nome" >/dev/null 2>&1 || true
motivo="o veredito nao saiu"
veredito_rc=0
kit_py veredito-do-ensaio --contagens "$pasta/contagens.json" --objetos "$pasta/objetos.txt" --lista "$pasta/lista.jsonl" \
    --storage-raiz "$PLANO_STORAGE_RAIZ" --bucket-global "$(env_value GLOBAL_S3_BUCKET stub)" --tenant "$(env_value STORAGE_TENANT_ID stub)" \
    --backup-hora "$snap_hora" --anon-fechado "$([ "$anon_aberto" = false ] && echo true || echo false)" \
    --erros-restore "$erros_restore" --resumo "$pasta/resumo.json" || veredito_rc=$?
resultado=$(python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1]))["resultado"])' "$pasta/resumo.json")
motivo_final=$(python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1]))["motivo"])' "$pasta/resumo.json")
contagens=$(python3 -I -c 'import json, sys; print(json.dumps(json.load(open(sys.argv[1]))["contagens"], separators=(",", ":")))' "$pasta/resumo.json")
terminou=1
situacao_gravar "ensaio.ultimo=$(agora_utc)" "ensaio.resultado=$resultado" "ensaio.motivo=$motivo_final" \
    "ensaio.backup_hora=$snap_hora" "ensaio.snapshot=$snap_curto" "ensaio.contagens=j:$contagens"
printf '    Tudo o que o ensaio criou foi apagado (o banco temporario, o dump e a chave digitada). A escola nao foi tocada.\n'
exit "$veredito_rc"

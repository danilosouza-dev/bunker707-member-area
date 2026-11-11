#!/usr/bin/env bash
# CI, job de integracao (docs/32 §11.6; docs/20 §9A): o migrador do kit chega ao mesmo banco que a CLI do Supabase, com
# as migracoes de verdade, no Supabase local que o passo anterior subiu (node tests/support/db.mjs start --ci):
#   1. banco zerado sem nenhuma migracao (SUPABASE_DB_MIGRATIONS_ENABLED=false supabase db reset): a base que a CLI monta
#      antes das migracoes (Auth, Storage, Realtime, papeis, extensoes), sem historico e sem tabela em public;
#   2. o migrador aplica todas por dentro do container do banco (MIGRAR_CONTAINER), como no servidor do comprador; a
#      segunda rodada nao aplica nada e o --listar diz que esta em dia;
#   3. retrato: o esquema inteiro (pg_dump --schema-only, sem a linha \restrict sorteada e sem as particoes diarias do
#      Realtime), o historico (version, name, statements, byte a byte) e o que as migracoes gravam de dados (buckets,
#      tarefas do pg_cron, nomes dos segredos do Vault e quantas linhas cada tabela de public tem);
#   4. banco zerado de novo, agora com a CLI aplicando as migracoes (supabase db reset); o mesmo retrato;
#   5. os dois retratos iguais (diff); no fim a escola de teste volta (db.mjs seed) para os passos seguintes do job.
# Precisa do Docker, da CLI do Supabase (a versao pinada no CI) e do Supabase local no ar. Os retratos ficam em
# KIT_MIGRADOR_RETRATOS (padrao: uma pasta temporaria).
set -euo pipefail

raiz=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$raiz"
projeto=$(sed -n 's/^project_id *= *"\(.*\)"$/\1/p' supabase/config.toml)
container="supabase_db_$projeto"
retratos=${KIT_MIGRADOR_RETRATOS:-$(mktemp -d)}
mkdir -p "$retratos"
n_arquivos=$(find supabase/migrations -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')

passo() { printf '\n==> %s\n' "$*"; }
falha() { printf 'ERRO: %s\n' "$*" >&2; exit 1; }
# psql no banco local como postgres, pelo socket do container (o mesmo caminho do migrador).
consulta() { docker exec -i "$container" psql -X -q -v ON_ERROR_STOP=1 -At -U postgres -d postgres -c "$1"; }

retrato() {
    local nome=$1
    # Como superusuario, pelo localhost do container (com a senha local padrao da CLI): o pg_dump le todo o banco.
    docker exec -e PGPASSWORD=postgres "$container" pg_dump -h 127.0.0.1 -U supabase_admin -d postgres --schema-only \
        --exclude-table='realtime.messages_*' | grep -v -E '^\\(un)?restrict ' > "$retratos/$nome-esquema.sql"
    docker exec -i -e PGPASSWORD=postgres "$container" psql -X -q -v ON_ERROR_STOP=1 -At -h 127.0.0.1 -U supabase_admin \
        -d postgres > "$retratos/$nome-dados.txt" <<'SQL'
select '# historico (version, name, statements)';
copy (select version, name, statements from supabase_migrations.schema_migrations order by version) to stdout;
select '# buckets';
select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by id;
select '# pg_cron';
select jobname, schedule, command, database, username, active from cron.job order by jobname, command;
select '# vault (so os nomes)';
select name, description from vault.secrets order by name;
select '# linhas por tabela de public';
select format('%s %s', c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p')
 order by c.relname;
SQL
    printf '  %s: %s linhas de esquema, %s migracoes no historico\n' "$nome" "$(wc -l < "$retratos/$nome-esquema.sql" | tr -d ' ')" \
        "$(consulta 'select count(*) from supabase_migrations.schema_migrations')"
}

passo "1/5 Banco local zerado, sem nenhuma migracao (a base que a CLI monta antes delas)"
SUPABASE_DB_MIGRATIONS_ENABLED=false supabase db reset --local --no-seed
[ "$(consulta "select to_regnamespace('supabase_migrations') is null and not exists (select 1 from pg_tables where schemaname = 'public')")" = "t" ] \
    || falha "O banco zerado ainda tem historico ou tabela em public: a CLI aplicou migracoes com SUPABASE_DB_MIGRATIONS_ENABLED=false."

passo "2/5 O migrador do kit aplica as $n_arquivos migracoes por dentro do container do banco"
inicio=$(date +%s)
MIGRAR_CONTAINER="$container" bash infra/kit/migrar.sh | tee "$retratos/migrador-primeira.txt"
printf '  (migrador: %s s)\n' "$(( $(date +%s) - inicio ))"
grep -q "Pronto: $n_arquivos migracoes aplicadas" "$retratos/migrador-primeira.txt" || falha "O migrador nao aplicou as $n_arquivos migracoes."
MIGRAR_CONTAINER="$container" bash infra/kit/migrar.sh | tee "$retratos/migrador-segunda.txt"
grep -q "Nada a aplicar" "$retratos/migrador-segunda.txt" || falha "A segunda rodada do migrador quis aplicar algo."
MIGRAR_CONTAINER="$container" bash infra/kit/migrar.sh --listar
retrato migrador

passo "3/5 Banco zerado de novo; agora a CLI aplica as migracoes"
inicio=$(date +%s)
supabase db reset --local --no-seed
printf '  (CLI, com o reset: %s s)\n' "$(( $(date +%s) - inicio ))"
retrato cli

passo "4/5 O retrato do migrador contra o da CLI"
iguais=1
diff -u "$retratos/cli-esquema.sql" "$retratos/migrador-esquema.sql" > "$retratos/esquema.diff" || iguais=0
diff -u "$retratos/cli-dados.txt" "$retratos/migrador-dados.txt" > "$retratos/dados.diff" || iguais=0
if [ "$iguais" = 0 ]; then
    head -n 200 "$retratos/esquema.diff" "$retratos/dados.diff" >&2
    falha "O migrador nao chegou ao mesmo banco que a CLI (diferencas acima; os retratos estao em $retratos)."
fi
printf '  iguais: o esquema, o historico byte a byte e os dados das migracoes\n'

passo "5/5 A escola de teste de volta para os proximos passos"
node tests/support/db.mjs seed

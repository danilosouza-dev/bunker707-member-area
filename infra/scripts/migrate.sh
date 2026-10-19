#!/usr/bin/env bash
# Aplica as migracoes do repositorio (supabase/migrations) no Postgres 17 do stack, com a CLI do Supabase:
#   sh infra/scripts/migrate.sh            aplica o que falta
#   sh infra/scripts/migrate.sh --dry-run  so lista o que seria aplicado
# Conecta direto no banco (127.0.0.1:POSTGRES_DIRECT_PORT, usuario postgres), como `supabase db push`
# faz no projeto da nuvem; o historico fica em supabase_migrations.schema_migrations. Roda em qualquer
# maquina onde o stack esteja no ar (servidor ou ensaio local).
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/lib.sh"

dry_run=""
for arg in "$@"; do
    case "$arg" in
        --dry-run) dry_run="--dry-run" ;;
        -h|--help) sed -n 2,8p "$0"; exit 0 ;;
        *) die "opcao desconhecida: $arg" ;;
    esac
done

require_env_file
wait_healthy db 60
db_url=$(direct_db_url)

log "Migracoes em $REPO_ROOT/supabase/migrations ($(ls "$REPO_ROOT"/supabase/migrations/*.sql | wc -l | tr -d ' ') arquivos)."
# A senha fica so no argumento do processo filho, nunca em log; --yes evita o prompt de confirmacao.
(
    cd "$REPO_ROOT"
    supabase_cli --yes db push --db-url "$db_url" ${dry_run:+"$dry_run"}
)
log "Pronto. Conferir: docker compose -f infra/compose/docker-compose.yml exec -T db psql -U postgres -c 'select version from supabase_migrations.schema_migrations order by version desc limit 5'"

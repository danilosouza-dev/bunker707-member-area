#!/usr/bin/env bash
# Restaura um backup (backup.sh) num servidor limpo e roda o teste de fumaca:
#   export RESTIC_REPOSITORY=sftp:storagebox:/bunker707/restic RESTIC_PASSWORD=...   # ou um .env ja no lugar
#   sh infra/scripts/restore.sh --snapshot latest [--yes]
# Pre-requisitos: bootstrap.sh feito, repositorio clonado, alias SSH `storagebox` (backup.sh --init) e
# NENHUM dado em infra/compose/volumes/db/data (o script recusa sobrescrever sem --yes).
# Ordem: restic restore -> .env -> sobe so o Postgres -> devolve a chave do Vault e reinicia -> papeis ->
# pg_restore do banco inteiro -> arquivos do Storage -> stack completo -> smoke.sh.
# Um ensaio de restauracao faz parte do runbook (docs/20): backup que nunca foi restaurado nao e backup.

. "$(dirname -- "$0")/lib.sh"

snapshot="latest"
assume_yes=0
while [ $# -gt 0 ]; do
    case "$1" in
        --snapshot) snapshot="$2"; shift ;;
        --yes) assume_yes=1 ;;
        -h|--help) sed -n 2,10p "$0"; exit 0 ;;
        *) die "opcao desconhecida: $1" ;;
    esac
    shift
done

if [ -z "${RESTIC_REPOSITORY:-}" ] && [ -f "$ENV_FILE" ]; then
    RESTIC_REPOSITORY=$(env_value RESTIC_REPOSITORY)
    RESTIC_PASSWORD=$(env_value RESTIC_PASSWORD)
fi
[ -n "${RESTIC_REPOSITORY:-}" ] && [ -n "${RESTIC_PASSWORD:-}" ] || die "Exporte RESTIC_REPOSITORY e RESTIC_PASSWORD (ou tenha um .env com eles)."
export RESTIC_REPOSITORY RESTIC_PASSWORD

if [ "$(id -u)" = "0" ]; then
    restore_root="${BUNKER707_BACKUP_DIR:-/var/backups/bunker707}/restore"
else
    restore_root="${BUNKER707_BACKUP_DIR:-$HOME/.bunker707-backups}/restore"
fi
target="$restore_root/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$target"; chmod 700 "$restore_root" "$target"

restic_bin() {
    if command -v restic >/dev/null 2>&1; then
        restic "$@"
    else
        case "$RESTIC_REPOSITORY" in
            /*) docker run --rm -e RESTIC_REPOSITORY -e RESTIC_PASSWORD -v "$RESTIC_REPOSITORY:$RESTIC_REPOSITORY" -v "$restore_root:$restore_root" restic/restic:0.19.1 "$@" ;;
            *) die "restic nao encontrado (bootstrap.sh instala)." ;;
        esac
    fi
}

confirm() {
    [ "$assume_yes" = "1" ] && return 0
    printf '%s [s/N] ' "$1"
    read -r answer
    case "$answer" in s|S|y|Y) return 0 ;; *) die "Cancelado." ;; esac
}

log "Baixando o snapshot '$snapshot' para $target..."
restic_bin restore "$snapshot" --target "$target" --tag bunker707
stage=$(dirname "$(find "$target" -type f -name postgres.dump | head -n1)")
[ -n "$stage" ] && [ -f "$stage/postgres.dump" ] || die "Nao achei postgres.dump no snapshot."
restored_storage=$(find "$target" -type d -path '*/volumes/storage' | head -n1)
log "Exportacao do banco em $stage"

# .env
if [ -f "$ENV_FILE" ]; then
    if cmp -s "$ENV_FILE" "$stage/env"; then
        log ".env ja e o do backup."
    else
        confirm "Ja existe $ENV_FILE e ele difere do backup. Substituir pelo .env do backup?"
        cp "$stage/env" "$ENV_FILE"
    fi
else
    cp "$stage/env" "$ENV_FILE"
    log ".env restaurado."
fi
chmod 600 "$ENV_FILE"

# Banco vazio?
if [ -d "$COMPOSE_DIR/volumes/db/data" ] && [ -n "$(ls -A "$COMPOSE_DIR/volumes/db/data" 2>/dev/null)" ]; then
    confirm "infra/compose/volumes/db/data NAO esta vazio. Apagar o banco atual e restaurar por cima?"
    compose down --remove-orphans
    rm -rf "$COMPOSE_DIR/volumes/db/data"
    docker volume rm -f "$(project_name)_db-config" >/dev/null 2>&1 || true
fi

log "Subindo so o Postgres..."
compose up -d db
wait_healthy db 180

log "Devolvendo a chave raiz do Vault e reiniciando o Postgres..."
compose exec -T db sh -c 'cat > /etc/postgresql-custom/pgsodium_root.key && chown postgres:postgres /etc/postgresql-custom/pgsodium_root.key && chmod 600 /etc/postgresql-custom/pgsodium_root.key' < "$stage/pgsodium_root.key"
compose restart db
wait_healthy db 180

log "Papeis e senhas (erros de 'ja existe' sao esperados)..."
compose exec -T db psql -U supabase_admin -h 127.0.0.1 -d postgres -q -v ON_ERROR_STOP=0 < "$stage/roles.sql" >/dev/null 2>"$target/roles.log" || true
# Os privilegios padrao da imagem (ALTER DEFAULT PRIVILEGES ... GRANT ALL TO anon, authenticated, service_role)
# dariam a anon/authenticated acesso a TUDO que o pg_restore recria: o pg_dump so grava GRANTs, nunca os
# REVOKEs que as migracoes fizeram. Suspende-se esses padroes durante a restauracao e devolve-se depois.
psql_admin() { compose exec -T db psql -U supabase_admin -h 127.0.0.1 -d postgres -q -v ON_ERROR_STOP=1 "$@"; }
log "Suspendendo os privilegios padrao do esquema public durante a restauracao..."
psql_admin <<'SQL'
alter default privileges for role supabase_admin in schema public revoke all on tables from postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public revoke all on sequences from postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public revoke all on functions from postgres, anon, authenticated, service_role;
SQL

log "Banco inteiro (pg_restore --clean; avisos sobre objetos que o Postgres ja tinha sao normais)..."
compose cp "$stage/postgres.dump" db:/tmp/postgres.dump
if compose exec -T db pg_restore -U supabase_admin -h 127.0.0.1 -d postgres --clean --if-exists --no-password /tmp/postgres.dump 2>"$target/pg_restore.log"; then
    log "pg_restore sem avisos."
else
    warn "pg_restore terminou com $(grep -c 'ERROR' "$target/pg_restore.log" || true) erro(s); detalhes em $target/pg_restore.log. Conferindo o conteudo..."
fi
compose exec -T db rm -f /tmp/postgres.dump

log "Devolvendo os privilegios padrao da imagem (valem so para objetos criados daqui em diante)..."
psql_admin <<'SQL'
alter default privileges for role supabase_admin in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on functions to postgres, anon, authenticated, service_role;
SQL
# Prova de que as permissoes vieram do backup, nao dos padroes: job_runs e enqueue_jobs_tick sao fechados a anon.
anon_leak=$(psql_admin -tA <<'SQL'
select (has_table_privilege('anon', 'public.job_runs', 'select') or has_function_privilege('anon', 'public.enqueue_jobs_tick()', 'execute'))::text;
SQL
)
[ "$anon_leak" = "false" ] || die "Permissoes restauradas diferentes do backup: anon enxerga job_runs ou executa enqueue_jobs_tick. Nao continue; veja docs/20 §10.2."

users=$(compose exec -T db psql -U supabase_admin -h 127.0.0.1 -d postgres -tAc 'select count(*) from auth.users' | tr -d '[:space:]')
migration=$(compose exec -T db psql -U supabase_admin -h 127.0.0.1 -d postgres -tAc 'select max(version) from supabase_migrations.schema_migrations' | tr -d '[:space:]')
log "Contas no Auth: $users. Ultima migracao: ${migration:-nenhuma}."

if [ -n "$restored_storage" ]; then
    log "Arquivos do Storage..."
    mkdir -p "$COMPOSE_DIR/volumes/storage"
    cp -a "$restored_storage/." "$COMPOSE_DIR/volumes/storage/"
fi

log "Subindo o stack completo..."
compose up -d
for service in auth rest storage api-gw app; do wait_healthy "$service" 240; done

log "Teste de fumaca..."
bash "$INFRA_SCRIPTS_DIR/smoke.sh"
log "Restauracao concluida. Arquivos baixados ficam em $target (apague quando nao precisar: contem o .env)."

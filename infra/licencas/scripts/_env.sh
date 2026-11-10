# Carregado pelos scripts do servidor de licencas: aponta infra/scripts/lib.sh para o compose do Emissor (o do
# bunker-licensing, em /opt/bunker707/emissor) e para o .env do lado nosso (infra/licencas/.env).
#   . "$(dirname -- "$0")/_env.sh"
LICENCAS_INFRA_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
# O compose do Emissor fica ao lado do repositorio enviado (REMOTE_DIR/emissor), fora do que o deploy troca.
LICENCAS_EMISSOR_DIR="${LICENCAS_EMISSOR_DIR:-$(cd -- "$LICENCAS_INFRA_DIR/../.." && pwd)/emissor}"
mkdir -p "$LICENCAS_EMISSOR_DIR"
export LICENCAS_EMISSOR_DIR
export BUNKER707_COMPOSE_FILE="${BUNKER707_COMPOSE_FILE:-$LICENCAS_EMISSOR_DIR/compose.yaml}"
export BUNKER707_ENV_FILE="${BUNKER707_ENV_FILE:-$LICENCAS_INFRA_DIR/.env}"
. "$LICENCAS_INFRA_DIR/../scripts/lib.sh"
# O nome do servico do banco no compose do Emissor, do usuario e do banco (compose.yaml do bunker-licensing).
LICENCAS_PG_SERVICE="${LICENCAS_PG_SERVICE:-postgres}"
LICENCAS_PG_USER="${LICENCAS_PG_USER:-emissor}"
LICENCAS_PG_DB="${LICENCAS_PG_DB:-emissor}"
LICENCAS_BACKUP_HOST="${LICENCAS_BACKUP_HOST:-bunker707-licencas}"
LICENCAS_BACKUP_TAG="${LICENCAS_BACKUP_TAG:-bunker707-licencas}"
LICENCAS_EMISSOR_SERVICE="${LICENCAS_EMISSOR_SERVICE:-emissor}"
# psql e pg_dump de dentro do container do banco (mesma versao do Postgres, sem imagem extra). O socket local do
# Postgres oficial aceita o usuario sem senha (trust): nenhuma senha passa pela linha de comando.
pg_sql() { compose exec -T "$LICENCAS_PG_SERVICE" psql -U "$LICENCAS_PG_USER" -d "${2:-$LICENCAS_PG_DB}" -v ON_ERROR_STOP=1 -At -c "$1"; }
# A soma de Licencas e Instalacoes no banco: 0 = banco vazio (recem-criado), que o backup marca como `vazio`.
pg_total_dados() { pg_sql "select (select count(*) from licenses) + (select count(*) from installations)"; }
# Linha de conferencia: Licencas, Instalacoes, eventos da auditoria e a ultima migracao aplicada.
RESUMO_SQL="select concat_ws(' ', (select count(*) from licenses), (select count(*) from installations), (select count(*) from license_events), (select coalesce(max(version), '-') from schema_migrations))"
pg_resumo() { pg_sql "$RESUMO_SQL"; }
# emissor_saude: o /health do Emissor na porta local (EMISSOR_PORTA_NO_HOST do .env do compose dele), por ate ~1 min.
emissor_saude() {
    local porta saude="" i
    porta=$(ENV_FILE="$LICENCAS_EMISSOR_DIR/.env" env_value EMISSOR_PORTA_NO_HOST 8080)
    for ((i = 0; i < ${SAUDE_TENTATIVAS:-30}; i++)); do
        saude=$(curl -fsS --max-time 5 "http://127.0.0.1:$porta/health" 2>/dev/null || true)
        case "$saude" in *'"ok":true'*) echo "  /health ok na porta local $porta."; return 0 ;; esac
        sleep 2
    done
    compose logs --no-color --tail 80 "$LICENCAS_EMISSOR_SERVICE" || true
    die "O Emissor nao respondeu {\"ok\":true} em http://127.0.0.1:$porta/health (veio: ${saude:-nada}). O registro acima diz o motivo (configuracao, chave, certificado ou banco)."
}

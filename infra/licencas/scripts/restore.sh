#!/usr/bin/env bash
# Restaura o banco do Emissor de licencas a partir do backup no restic (docs/20 §8C.6):
#   bash infra/licencas/scripts/restore.sh --yes [--snapshot=ID]     troca o banco do Emissor pelo do backup
#   bash infra/licencas/scripts/restore.sh --ensaio [--snapshot=ID]  ensaio: restaura num Postgres descartavel, sem
#                                                                    rede, confere e apaga; o banco em uso nao e tocado
# Sem --snapshot: o backup mais novo marcado `com-dados` (ou o mais novo de todos, se nenhum tem dados): o servidor novo
# de uma recuperacao faz backups `vazio` ate a restauracao, e eles nunca passam na frente do backup bom.
# Na troca de verdade, antes de apagar qualquer coisa: um backup do banco como esta (SEM_BACKUP_ANTES=1 pula, so com
# motivo). Depois dela vale a readocao (docs/32 §11.2): a Instalacao ativada depois do backup apresenta o segredo e a
# licenca guardada na conferencia seguinte (em ate 24 h, ou na hora pelo Verificar agora) e e aceita de volta, com o
# alerta instalacao.readotada no Painel.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/_env.sh"

mode=""; want=""
for arg in "$@"; do
    case "$arg" in
        --yes) mode="${mode:-restaurar}" ;;
        --ensaio) mode="ensaio" ;;
        --snapshot=*) want="${arg#*=}" ;;
        -h|--help) sed -n 2,13p "$0"; exit 0 ;;
        *) die "opcao desconhecida: $arg" ;;
    esac
done
[ -n "$mode" ] || die "Isto troca o banco do Emissor pelo do backup: confirme com --yes (a etapa restaurar-licencas pede CONFIRMAR=restaurar), ou use --ensaio."
case "$want" in ""|latest|[0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;; *) die "--snapshot precisa ser o id de um backup (restic snapshots) ou latest." ;; esac

require_env_file
command -v restic >/dev/null 2>&1 || die "restic nao encontrado (bootstrap.sh instala no servidor)."
export RESTIC_REPOSITORY RESTIC_PASSWORD
RESTIC_REPOSITORY=$(require_env_value RESTIC_REPOSITORY)
RESTIC_PASSWORD=$(require_env_value RESTIC_PASSWORD)
if [ -n "${LICENCAS_BACKUP_DIR:-}" ]; then backup_root="$LICENCAS_BACKUP_DIR"
elif [ "$(id -u)" = "0" ] || [ -w /var/backups/bunker707-licencas ]; then backup_root=/var/backups/bunker707-licencas
else backup_root="$HOME/.bunker707-licencas-backups"; fi
mkdir -p "$backup_root"; chmod 700 "$backup_root"
ENSAIO_NOME="${ENSAIO_NOME:-bunker707-licencas-ensaio}"

# O texto claro do backup fica so numa pasta 0700, apagada em qualquer desfecho; o container do ensaio tambem sai.
tmp=$(mktemp -d "$backup_root/restaurar.XXXXXX")
trap 'rm -rf "$tmp"; [ "$mode" != "ensaio" ] || docker rm -f "$ENSAIO_NOME" >/dev/null 2>&1 || true' EXIT

# O backup escolhido: "id data tags", pela lista do restic.
escolha=$(restic snapshots --json --tag "$LICENCAS_BACKUP_TAG" --host "$LICENCAS_BACKUP_HOST" | python3 -I -c '
import json, sys
want = sys.argv[1]
snaps = sorted(json.load(sys.stdin) or [], key=lambda s: s.get("time", ""))
if want not in ("", "latest"):
    snaps = [s for s in snaps if s.get("id", "").startswith(want) or s.get("short_id", "") == want]
if not snaps:
    sys.exit("ERRO: nenhum backup do Emissor " + ("com o id " + want if want not in ("", "latest") else "neste repositorio") + ".")
com_dados = [s for s in snaps if "com-dados" in (s.get("tags") or [])]
s = (com_dados or snaps)[-1]
print(s.get("short_id") or s["id"][:8], s.get("time", "?")[:19], ",".join(s.get("tags") or []))
' "$want")
read -r snap quando marcas <<< "$escolha"
log "Backup $snap de $quando UTC ($marcas)"
restic restore "$snap" --target "$tmp" --quiet
dump=$(find "$tmp" -type f -name emissor.dump | head -n1)
[ -n "$dump" ] && [ -s "$dump" ] || die "O backup $snap nao tem emissor.dump."

if [ "$mode" = "ensaio" ]; then
    imagem_pg=$(compose config --format json | python3 -I -c 'import json, sys; print(json.load(sys.stdin)["services"][sys.argv[1]]["image"])' "$LICENCAS_PG_SERVICE")
    log "Ensaio num Postgres descartavel ($imagem_pg), sem rede; o banco do Emissor nao e tocado"
    docker rm -f "$ENSAIO_NOME" >/dev/null 2>&1 || true
    # Sem rede e sem senha (trust): o container so existe para o ensaio e e apagado no fim.
    docker run -d --rm --name "$ENSAIO_NOME" --network none -e POSTGRES_USER="$LICENCAS_PG_USER" -e POSTGRES_DB="$LICENCAS_PG_DB" \
        -e POSTGRES_HOST_AUTH_METHOD=trust "$imagem_pg" >/dev/null
    pronto=""
    # Pelo TCP do proprio container: o servidor temporario da inicializacao so ouve no socket, e ainda vai reiniciar.
    for _ in $(seq 1 60); do
        if docker exec "$ENSAIO_NOME" pg_isready -h 127.0.0.1 -U "$LICENCAS_PG_USER" -d "$LICENCAS_PG_DB" >/dev/null 2>&1; then pronto=1; break; fi
        sleep 1
    done
    [ -n "$pronto" ] || die "O Postgres do ensaio nao ficou pronto em 1 minuto."
    docker exec -i "$ENSAIO_NOME" pg_restore -U "$LICENCAS_PG_USER" -d "$LICENCAS_PG_DB" --no-owner --exit-on-error < "$dump"
    resumo=$(docker exec "$ENSAIO_NOME" psql -U "$LICENCAS_PG_USER" -d "$LICENCAS_PG_DB" -v ON_ERROR_STOP=1 -At -c "$RESUMO_SQL")
    read -r lic inst eventos migracao <<< "$resumo"
    [ -n "${migracao:-}" ] && [ "$migracao" != "-" ] || die "O banco restaurado no ensaio nao tem migracao aplicada (schema_migrations vazia): o backup $snap nao serve."
    agora=$(pg_resumo 2>/dev/null || echo "? ? ? ?")
    read -r lic_agora inst_agora _ _ <<< "$agora"
    echo "  restaurado no ensaio: $lic Licencas, $inst Instalacoes, $eventos eventos de auditoria, ultima migracao $migracao"
    echo "  no banco em uso agora: $lic_agora Licencas, $inst_agora Instalacoes"
    log "Ensaio de restauracao OK (backup $snap de $quando UTC). O container do ensaio e o arquivo restaurado saem agora."
    exit 0
fi

log "Conferindo o arquivo do backup"
compose exec -T "$LICENCAS_PG_SERVICE" pg_restore --list < "$dump" >/dev/null || die "O emissor.dump do backup $snap nao e um arquivo do pg_dump legivel; nada foi trocado."
if [ -z "${SEM_BACKUP_ANTES:-}" ]; then
    log "Backup do banco como esta, antes de trocar"
    bash "$LICENCAS_INFRA_DIR/scripts/backup.sh" || die "O backup de antes da troca falhou; nada foi trocado (SEM_BACKUP_ANTES=1 pula, so com motivo)."
else
    warn "SEM_BACKUP_ANTES=1: o banco atual vai ser trocado sem um backup novo."
fi
antes=$(pg_resumo 2>/dev/null || echo "? ? ? ?")

log "Parando o Emissor (o banco fica no ar)"
servicos=$(compose config --services | grep -vx "$LICENCAS_PG_SERVICE" | tr '\n' ' ')
# shellcheck disable=SC2086
compose stop $servicos
wait_healthy "$LICENCAS_PG_SERVICE" 60

log "Trocando o banco $LICENCAS_PG_DB pelo do backup $snap"
pg_sql "drop database if exists $LICENCAS_PG_DB with (force)" postgres
pg_sql "create database $LICENCAS_PG_DB owner $LICENCAS_PG_USER" postgres
compose exec -T "$LICENCAS_PG_SERVICE" pg_restore -U "$LICENCAS_PG_USER" -d "$LICENCAS_PG_DB" --no-owner --exit-on-error < "$dump"

log "Subindo o Emissor (as migracoes mais novas que o backup rodam antes, pelo servico migrar)"
compose up -d --no-build
wait_healthy "$LICENCAS_EMISSOR_SERVICE" 180
emissor_saude
depois=$(pg_resumo)
echo "  antes:  $antes (Licencas, Instalacoes, eventos, ultima migracao)"
echo "  agora:  $depois"
log "Restaurado do backup $snap de $quando UTC."
echo "Readocao: a Instalacao ativada ou ativada de novo depois de $quando UTC volta sozinha na conferencia seguinte (em ate"
echo "24 h, ou na hora pelo Verificar agora), com o segredo e a licenca guardados nela, e aparece no Painel com o alerta"
echo "instalacao.readotada (docs/32 §11.2). O que a equipe fez no Painel depois desse horario precisa ser refeito."

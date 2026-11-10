#!/usr/bin/env bash
# Conferencia do servidor de licencas, por dentro (etapa status-licencas com SSH=1; docs/20 §8C): o banco e o Emissor
# saudaveis, /health ok na porta local, o Caddy no ar, o timer do backup ligado e o ultimo backup com menos de 2 h.
#   bash infra/licencas/scripts/smoke.sh
# Sai com erro se o banco, o Emissor ou o /health falham; o resto vira AVISO.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/_env.sh"

[ -f "$COMPOSE_FILE" ] || die "Sem $COMPOSE_FILE: o Emissor ainda nao foi implantado (etapa deploy-licencas)."
wait_healthy "$LICENCAS_PG_SERVICE" 30
wait_healthy "$LICENCAS_EMISSOR_SERVICE" 30
SAUDE_TENTATIVAS=3 emissor_saude
echo "  imagem: $(cat "$LICENCAS_EMISSOR_DIR/.imagem" 2>/dev/null || echo '?')"
echo "  banco: $(pg_resumo 2>/dev/null || echo '?') (Licencas, Instalacoes, eventos, ultima migracao)"
if [ "$(docker inspect --format '{{.State.Running}}' bunker707-licencas-caddy 2>/dev/null)" = "true" ]; then
    echo "  Caddy: no ar."
else
    warn "o Caddy (bunker707-licencas-caddy) nao esta rodando: os dois nomes nao respondem."
fi
if systemctl is-active --quiet bunker707-licencas-backup.timer 2>/dev/null; then
    echo "  timer do backup: ligado (de hora em hora)."
else
    warn "o timer bunker707-licencas-backup nao esta ativo."
fi
ultimo=$(cat "${LICENCAS_BACKUP_DIR:-/var/backups/bunker707-licencas}/ultimo-sucesso" 2>/dev/null || true)
if [ -z "$ultimo" ]; then
    warn "nenhum backup registrado ainda."
else
    idade=$(( $(date -u +%s) - $(date -u -d "$ultimo" +%s 2>/dev/null || echo 0) ))
    if [ "$idade" -le 7200 ]; then echo "  ultimo backup: $ultimo"; else warn "o ultimo backup ($ultimo) tem mais de 2 horas."; fi
fi

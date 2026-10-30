#!/usr/bin/env bash
# Estado do gravador (Jibri) na maquina por hora (docs/20 §8B.5). Roda na propria maquina, em /opt/jibri
# (pela etapa exec-jibri, payload: bash jibri-status.sh) ou no repositorio, apontando para infra/jitsi/jibri:
#   sh infra/jitsi/scripts/jibri-status.sh
# Mostra o container, a saude pela API HTTP do Jibri (127.0.0.1:2222/jibri/api/v1.0/health: ocupado ou
# livre, saudavel ou nao), as gravacoes na maquina (MP4 e as marcas .uploaded / .failed do finalize.sh) e o
# fim do finalize.log. Sai com erro se o Jibri nao estiver HEALTHY. Nunca imprime o .env.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail

here=$(cd -- "$(dirname -- "$0")" && pwd)
compose_file="$here/docker-compose.yml"
[ -f "$compose_file" ] || compose_file="$here/../jibri/docker-compose.yml"
[ -f "$compose_file" ] || { echo "ERRO: nao achei o docker-compose.yml do Jibri ao lado deste script nem em ../jibri." >&2; exit 1; }
base=$(cd -- "$(dirname -- "$compose_file")" && pwd)
env_file="$base/.env"
port=2222
[ -f "$env_file" ] && port=$(grep -E '^JIBRI_HTTP_API_EXTERNAL_PORT=' "$env_file" | head -n1 | cut -d= -f2-)
: "${port:=2222}"
rec_dir="$base/volumes/storage/jibri/recordings"

echo "==> Container"
docker compose -f "$compose_file" ps --format '  {{.Name}}  {{.State}}  {{.Health}}  {{.Image}}' 2>/dev/null || echo "  (o compose nao respondeu)"

echo "==> Saude (http://127.0.0.1:$port/jibri/api/v1.0/health)"
health=$(curl -fsS --max-time 10 "http://127.0.0.1:$port/jibri/api/v1.0/health" 2>/dev/null || true)
busy=$(printf '%s' "$health" | sed -n 's/.*"busyStatus" *: *"\([A-Z_]*\)".*/\1/p')
state=$(printf '%s' "$health" | sed -n 's/.*"healthStatus" *: *"\([A-Z_]*\)".*/\1/p')
echo "  ocupado: ${busy:-?}   saude: ${state:-?}"

echo "==> Gravacoes em $rec_dir"
if [ -d "$rec_dir" ]; then
    find "$rec_dir" -type f \( -name '*.mp4' -o -name '*.uploaded' -o -name '*.failed' -o -name '*.notify-failed.json' \) -printf '  %TY-%Tm-%Td %TH:%TM  %12s  %P\n' 2>/dev/null | sort || ls -lR "$rec_dir"
    [ -n "$(find "$rec_dir" -type f -name '*.mp4' 2>/dev/null | head -n1)" ] || echo "  (nenhum MP4)"
else
    echo "  (a pasta ainda nao existe: nenhuma gravacao)"
fi

echo "==> Fim do finalize.log"
tail -n 20 "$rec_dir/finalize.log" 2>/dev/null || echo "  (sem finalize.log)"

if [ "$state" != "HEALTHY" ]; then
    echo "ERRO: o Jibri nao esta HEALTHY (veja: docker compose -f $compose_file logs --tail 200 jibri)." >&2
    exit 1
fi

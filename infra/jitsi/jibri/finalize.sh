#!/bin/sh
# finalize.sh: roda DENTRO do container do Jibri quando uma gravacao termina (JIBRI_FINALIZE_RECORDING_SCRIPT_PATH;
# docs/30 §5.3 e §6.7). O Jibri chama com a pasta da gravacao como primeiro argumento. O que faz:
#   1. acha o MP4 (na pasta recebida; sem ela, o mais novo em JIBRI_RECORDING_DIR);
#   2. le tamanho, sha256, duracao (ffprobe) e, do nome <sala>_<aaaa-MM-dd-HH-mm-ss>.mp4, a sala e a hora de inicio;
#   3. cria o video na biblioteca da Bunny Stream e envia o arquivo (3 tentativas, espera crescente);
#   4. avisa o app: POST WEBINAR_RECORDER_WEBHOOK_URL com { sessionId, state: uploaded | upload_failed, room,
#      fileName, startedAt, durationSeconds, sizeBytes, sha256, bunnyLibraryId, bunnyVideoId, error }, assinado com
#      HMAC-SHA256 de "<timestamp>.<corpo>" nos cabecalhos X-Bunker-Timestamp e X-Bunker-Signature (5 tentativas).
# Falhou o envio: o arquivo FICA na maquina (marca .failed ao lado), o app recebe upload_failed e o jibri-down
# recusa apagar o servidor; a Equipe busca o MP4 por exec-jibri e sobe pelo admin (docs/20 §8B.5).
# Variaveis (do .env da maquina, passadas pelo compose): SESSAO, WEBINAR_RECORDER_WEBHOOK_URL,
# WEBINAR_RECORDER_WEBHOOK_SECRET, BUNNY_LIBRARY_ID, BUNNY_API_KEY, BUNNY_COLLECTION_ID (opcional),
# JIBRI_RECORDING_DIR (/storage/recordings). Log em $JIBRI_RECORDING_DIR/finalize.log, nunca com segredos.
# POSIX sh (a imagem tem sh, curl, openssl, ffprobe e sha256sum); nunca `set -x`.
set -u

RECORDING_DIR="${JIBRI_RECORDING_DIR:-/storage/recordings}"
LOG_FILE="${FINALIZE_LOG:-$RECORDING_DIR/finalize.log}"
BUNNY_API="${BUNNY_API_BASE:-https://video.bunnycdn.com}"
TMP=$(mktemp -d 2>/dev/null || { d="/tmp/finalize.$$"; mkdir -p "$d" && printf '%s' "$d"; })
trap 'rm -rf "$TMP"' EXIT INT TERM
umask 077

log() {
    line="$(date -u +%Y-%m-%dT%H:%M:%SZ) finalize[${SESSAO:-?}]: $*"
    printf '%s\n' "$line"
    printf '%s\n' "$line" >> "$LOG_FILE" 2>/dev/null || true
}
# Espera entre tentativas (FINALIZE_FAST=1 so nos testes: sem espera).
pause() { [ "${FINALIZE_FAST:-}" = "1" ] || sleep "$1"; }
# Texto para dentro de uma string JSON (barra, aspas e quebras de linha).
json_str() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n\r\t'; }
# "valor" ou null.
json_opt() { if [ -n "$1" ]; then printf '"%s"' "$(json_str "$1")"; else printf 'null'; fi; }

# ---- 1. o arquivo ------------------------------------------------------------------------------------
dir="${1:-}"
file=""
if [ -n "$dir" ] && [ -d "$dir" ]; then
    file=$(find "$dir" -maxdepth 1 -type f -name '*.mp4' 2>/dev/null | head -n1)
fi
if [ -z "$file" ]; then
    file=$(find "$RECORDING_DIR" -type f -name '*.mp4' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -n1 | cut -d' ' -f2-)
fi
if [ -z "$file" ] || [ ! -f "$file" ]; then
    log "nenhum MP4 encontrado (argumento: '$dir', pasta: $RECORDING_DIR)"
    exit 1
fi
if [ -f "$file.uploaded" ]; then
    log "$(basename "$file") ja foi enviado (marca .uploaded); nada a fazer"
    exit 0
fi

# ---- 2. os dados do arquivo -----------------------------------------------------------------------------
name=$(basename "$file")
base="${name%.mp4}"
stamp=$(printf '%s' "$base" | sed -n 's/.*_\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}-[0-9]\{2\}-[0-9]\{2\}-[0-9]\{2\}\)$/\1/p')
if [ -n "$stamp" ]; then
    room="${base%_*}"
    # _aaaa-MM-dd-HH-mm-ss (relogio do Jibri, TZ=UTC) -> aaaa-MM-ddTHH:mm:ssZ
    started_at=$(printf '%s' "$stamp" | sed 's/^\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\)-\([0-9]\{2\}\)-\([0-9]\{2\}\)-\([0-9]\{2\}\)$/\1T\2:\3:\4Z/')
else
    room="$base"
    started_at=""
fi
size=$(wc -c < "$file" | tr -d ' ')
sha=$( (sha256sum "$file" 2>/dev/null || shasum -a 256 "$file" 2>/dev/null) | cut -d' ' -f1)
duration=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$file" 2>/dev/null | cut -d. -f1)
case "$duration" in ''|*[!0-9]*) duration=null ;; esac
log "arquivo $name: ${size} bytes, ${duration}s, sala '$room', inicio '${started_at:-?}'"

# ---- 3. Bunny Stream -----------------------------------------------------------------------------------
# A chave da Bunny vai ao curl por arquivo de configuracao (0600), nunca na linha de comando.
bunny_cfg="$TMP/bunny.cfg"
printf 'header = "AccessKey: %s"\n' "${BUNNY_API_KEY:-}" > "$bunny_cfg"
bunny_create() {  # imprime o guid do video criado
    title=$(json_str "${room} ${started_at:-$name}")
    collection=""
    [ -n "${BUNNY_COLLECTION_ID:-}" ] && collection=",\"collectionId\":\"$(json_str "$BUNNY_COLLECTION_ID")\""
    code=$(curl -sS -K "$bunny_cfg" -o "$TMP/create.out" -w '%{http_code}' --max-time 60 -X POST \
        "$BUNNY_API/library/$BUNNY_LIBRARY_ID/videos" -H 'Content-Type: application/json' -H 'Accept: application/json' \
        --data-binary "{\"title\":\"$title\"$collection}" 2>/dev/null) || code=000
    case "$code" in 2*) ;; *) log "Bunny: criar o video respondeu $code"; return 1 ;; esac
    guid=$(sed -n 's/.*"guid" *: *"\([0-9a-zA-Z-]*\)".*/\1/p' "$TMP/create.out" | head -n1)
    [ -n "$guid" ] || { log "Bunny: resposta sem guid"; return 1; }
    printf '%s' "$guid"
}
bunny_upload() {  # bunny_upload GUID: envia o arquivo inteiro (PUT); aborta se parar por 2 min
    code=$(curl -sS -K "$bunny_cfg" -o "$TMP/upload.out" -w '%{http_code}' --speed-time 120 --speed-limit 1024 \
        --upload-file "$file" -H 'Content-Type: application/octet-stream' \
        "$BUNNY_API/library/$BUNNY_LIBRARY_ID/videos/$1" 2>/dev/null) || code=000
    case "$code" in 2*) return 0 ;; *) log "Bunny: envio respondeu $code"; return 1 ;; esac
}

state=upload_failed; error=""; guid=""
if [ -z "${BUNNY_LIBRARY_ID:-}" ] || [ -z "${BUNNY_API_KEY:-}" ]; then
    error="bunny_not_configured"
    log "Bunny nao configurada (BUNNY_LIBRARY_ID/BUNNY_API_KEY): o arquivo fica na maquina"
else
    attempt=1
    for wait in 10 30 0; do
        [ -n "$guid" ] || guid=$(bunny_create) || guid=""
        if [ -n "$guid" ] && bunny_upload "$guid"; then
            state=uploaded; error=""
            log "enviado para a Bunny (biblioteca $BUNNY_LIBRARY_ID, video $guid) na tentativa $attempt"
            break
        fi
        error="bunny_upload_failed_attempt_$attempt"
        if [ "$wait" -gt 0 ]; then pause "$wait"; fi
        attempt=$((attempt + 1))
    done
fi
if [ "$state" = "uploaded" ]; then
    printf '%s\n' "$guid" > "$file.uploaded" 2>/dev/null || true
else
    printf '%s\n' "$error" > "$file.failed" 2>/dev/null || true
    log "o MP4 fica em $file (envio manual pelo admin, docs/20 §8B.5)"
fi

# ---- 4. avisar o app (docs/30 §5.3) --------------------------------------------------------------------
sign() { printf '%s.%s' "$1" "$2" | openssl dgst -sha256 -hmac "$WEBINAR_RECORDER_WEBHOOK_SECRET" -r | cut -d' ' -f1; }
body="{\"sessionId\":\"$(json_str "${SESSAO:-}")\",\"state\":\"$state\",\"room\":\"$(json_str "$room")\",\"fileName\":\"$(json_str "$name")\",\"startedAt\":$(json_opt "$started_at"),\"durationSeconds\":$duration,\"sizeBytes\":$size,\"sha256\":\"$sha\",\"bunnyLibraryId\":$(json_opt "${BUNNY_LIBRARY_ID:-}"),\"bunnyVideoId\":$(json_opt "$guid")"
[ -n "$error" ] && body="$body,\"error\":\"$(json_str "$error")\""
body="$body}"

notified=0
if [ -z "${WEBINAR_RECORDER_WEBHOOK_URL:-}" ] || [ -z "${WEBINAR_RECORDER_WEBHOOK_SECRET:-}" ]; then
    log "webhook nao configurado (WEBINAR_RECORDER_WEBHOOK_URL/SECRET): o app nao foi avisado"
else
    attempt=1
    for wait in 5 15 30 60 0; do
        ts=$(date -u +%s)
        sig=$(sign "$ts" "$body")
        code=$(curl -sS -o "$TMP/webhook.out" -w '%{http_code}' --max-time 30 -X POST "$WEBINAR_RECORDER_WEBHOOK_URL" \
            -H 'Content-Type: application/json' -H "X-Bunker-Timestamp: $ts" -H "X-Bunker-Signature: $sig" \
            --data-binary "$body" 2>/dev/null) || code=000
        case "$code" in
            2*) log "app avisado ($state, HTTP $code) na tentativa $attempt"; notified=1; break ;;
        esac
        log "webhook respondeu HTTP $code na tentativa $attempt"
        if [ "$wait" -gt 0 ]; then pause "$wait"; fi
        attempt=$((attempt + 1))
    done
fi
[ "$notified" = 1 ] || printf '%s\n' "$body" > "$file.notify-failed.json" 2>/dev/null || true

[ "$state" = "uploaded" ] && [ "$notified" = 1 ]

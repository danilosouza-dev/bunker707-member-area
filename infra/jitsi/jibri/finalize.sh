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
# A CPU da maquina durante a live (cpu-amostras.sh, docs/30 §6.7 e A26): {"nucleos":N,"amostras":[[unix,pct],...]}, a media de
# cada 30 s das ultimas 6 h. O app guarda o corpo cru e o schema ignora o campo. Sem o arquivo ou sem amostras, nada.
cpu_json() {
    [ -f "$1" ] || return 0
    awk '
        /^# nucleos/ { n = $3; next }
        $2 == "cpu" {
            tot = 0; for (i = 3; i <= 10; i++) tot += $i; idle = $6 + $7
            if (seen_prev) {
                dt = tot - ptot; di = idle - pidle
                if (dt > 0) {
                    b = int($1 / 30) * 30; s[b] += (1 - di / dt) * 100; c[b]++
                    if (!(b in got)) { got[b] = 1; ord[++k] = b }
                }
            }
            seen_prev = 1; ptot = tot; pidle = idle
        }
        END {
            if (k == 0) exit
            first = (k > 720) ? k - 719 : 1
            printf "{\"nucleos\":%d,\"amostras\":[", n + 0
            for (j = first; j <= k; j++) { b = ord[j]; printf "%s[%d,%d]", (j > first ? "," : ""), b, int(s[b] / c[b] + 0.5) }
            printf "]}"
        }' "$1" 2>/dev/null
}
# A fluidez medida pelo arquivo do modo da gravacao na pagina do gravador (bunker707-gravacao.js, docs/30 A65): as
# linhas "bunker707-fluidez ..." que o Jibri guardou do console do navegador (/storage/logs/browser.*.txt), as mais
# novas (no maximo 120 e 24 KB), como lista de textos. Cada linha comeca com t=<unix>: a da gravacao e a do horario
# dela. O app guarda o corpo cru e o schema ignora o campo. Sem o log ou sem linhas, nada.
fluidez_json() {
    command -v python3 >/dev/null 2>&1 || return 0
    python3 - "${BROWSER_LOGS:-/storage/logs}" <<'PY' 2>/dev/null || true
import glob, json, os, re, sys
lines = []
for path in sorted(glob.glob(os.path.join(sys.argv[1], "browser.*.txt")), key=os.path.getmtime):
    with open(path, errors="replace") as handle:
        for line in handle:
            found = re.search(r"bunker707-fluidez ([^\"\\]{1,600})", line)
            if found:
                lines.append(found.group(1).strip())
out, size = [], 0
for line in reversed(lines[-120:]):
    size += len(line) + 4
    if size > 24000:
        break
    out.append(line)
if out:
    print(json.dumps(list(reversed(out)), ensure_ascii=True, separators=(",", ":")))
PY
}
# O fim dos registros do Jibri e do ffmpeg desta gravacao (docs/30 A65): a maquina e apagada depois da live, e com ela o
# motivo de uma gravacao que parou sozinha (as de 25/11/2026 pararam aos 87 s com o gravador ainda na sala). Do registro
# do ffmpeg (/storage/logs/ffmpeg.*.txt), as ultimas linhas que nao sao andamento e as duas ultimas de andamento; do
# registro do Jibri (log.*.txt), as ultimas linhas que falam de parada, erro, saida ou das conferencias da chamada.
# Sem endereco, sem nome de sala, sem linha com senha; cada linha ate 240 letras e o conjunto ate 9 KB.
# {"ffmpeg":[...],"jibri":[...]}. Sem python, sem registro ou com erro, nada.
registro_json() {
    command -v python3 >/dev/null 2>&1 || return 0
    python3 - "${FFMPEG_LOGS:-/storage/logs}" <<'PY' 2>/dev/null || true
import glob, json, os, re, sys

def newest(pattern):
    paths = sorted(glob.glob(os.path.join(sys.argv[1], pattern)), key=os.path.getmtime)
    return paths[-1] if paths else None

def clean(line):
    line = re.sub(r"[a-z][a-z0-9+.-]*://\S+", "<endereco>", line.strip())
    line = re.sub(r"\bw-[0-9a-z]+(?:-[0-9a-z]+)+", "<sala>", line)
    line = re.sub(r"(?i)\b(jwt|token|key)=[^\s&]+", r"\1=<oculto>", line)
    return line[:240]

def tail(path, keep, limit):
    if not path:
        return []
    found = []
    with open(path, errors="replace") as handle:
        for line in handle:
            if line.strip() and keep(line) and not re.search(r"(?i)passw|secret|senha", line):
                found.append(clean(line))
    return found[-limit:]

progress = re.compile(r"frame=\s*\d+")
wanted = re.compile(r"(?i)stop|error|exit|quit|finaliz|status|empty|muted|media|kicked|ice|ffmpeg|leav|signal|timeout|fail")
ffmpeg_log = newest("ffmpeg.*.txt")
doc = {
    "ffmpeg": tail(ffmpeg_log, lambda l: not progress.search(l), 14) + tail(ffmpeg_log, lambda l: bool(progress.search(l)), 2),
    "jibri": tail(newest("log.*.txt"), lambda l: bool(wanted.search(l)), 24),
}
doc = {name: lines for name, lines in doc.items() if lines}
def dump():
    return json.dumps(doc, ensure_ascii=True, separators=(",", ":"))
while doc and len(dump()) > 9000:
    name = max(doc, key=lambda n: len(doc[n]))
    doc[name].pop(0)
    if not doc[name]:
        del doc[name]
if doc:
    print(dump())
PY
}
# O ffmpeg que gravou (docs/30 D138): a versao que o Jibri registrou no arranque da gravacao (os registros de
# /storage/logs); se o registro nao a traz (o aviso do teste de 25/11/2026 veio sem ela), a do binario que o
# custom-jibri.conf manda o Jibri usar. Para conferir que o gravador usou o 6.1 e nao o 7.1 da imagem.
ffmpeg_gravou() {
    v=$(grep -h -o 'ffmpeg version [^ ]*' "${FFMPEG_LOGS:-/storage/logs}"/*.txt 2>/dev/null | tail -n1 | sed 's/^ffmpeg version //')
    [ -n "$v" ] || v=$("${FFMPEG_GRAVADOR:-/usr/local/bin/ffmpeg}" -version 2>/dev/null | sed -n '1s/^ffmpeg version \([^ ]*\).*/\1/p')
    printf '%s' "$v" | tr -cd 'A-Za-z0-9.+~_-' | cut -c1-40
}
# As imagens diferentes por segundo do arquivo (docs/30 A65), a medida que vale: em tres janelas de 20 s (a 10%, 50% e
# 85% da duracao), quantos quadros o mpdecimate mantem, isto e, quantos mudaram em relacao ao anterior. [[segundo, imagens
# por segundo], ...]. Pessoa parada conta menos: e estimativa. Com o ffmpeg da imagem (/usr/bin), que le H.264 e tem o
# filtro; o da gravacao so tem o que a gravacao usa. Sem ffmpeg, sem a duracao ou com erro, nada.
imagens_json() {
    bin="${FFMPEG_CONTAGEM:-/usr/bin/ffmpeg}"
    [ -x "$bin" ] || return 0
    case "$duration" in ''|null) return 0 ;; esac
    [ "$duration" -ge 12 ] || return 0
    win=20; [ "$duration" -ge 40 ] || win=$((duration / 2))
    out=""
    for pct in 10 50 85; do
        off=$((duration * pct / 100)); [ $((off + win)) -le "$duration" ] || off=$((duration - win))
        kept=$("$bin" -nostdin -v info -ss "$off" -t "$win" -i "$file" -vf mpdecimate -an -f null - 2>&1 | tr '\r' '\n' | grep -o 'frame= *[0-9]*' | tail -n1 | grep -o '[0-9]*$')
        case "$kept" in ''|*[!0-9]*) continue ;; esac
        fps=$(awk -v k="$kept" -v w="$win" 'BEGIN { printf "%.1f", (w > 0 ? k / w : 0) }')
        out="$out${out:+,}[$off,$fps]"
    done
    [ -n "$out" ] && printf '[%s]' "$out"
    return 0
}
sign() { printf '%s.%s' "$1" "$2" | openssl dgst -sha256 -hmac "$WEBINAR_RECORDER_WEBHOOK_SECRET" -r | cut -d' ' -f1; }
body="{\"sessionId\":\"$(json_str "${SESSAO:-}")\",\"state\":\"$state\",\"room\":\"$(json_str "$room")\",\"fileName\":\"$(json_str "$name")\",\"startedAt\":$(json_opt "$started_at"),\"durationSeconds\":$duration,\"sizeBytes\":$size,\"sha256\":\"$sha\",\"bunnyLibraryId\":$(json_opt "${BUNNY_LIBRARY_ID:-}"),\"bunnyVideoId\":$(json_opt "$guid")"
[ -n "$error" ] && body="$body,\"error\":\"$(json_str "$error")\""
gravou=$(ffmpeg_gravou)
[ -n "$gravou" ] && body="$body,\"ffmpeg\":\"$(json_str "$gravou")\""
imagens=$(imagens_json 2>/dev/null || true)
[ -n "$imagens" ] && body="$body,\"imagens\":$imagens"
registro=$(registro_json)
[ -n "$registro" ] && body="$body,\"registro\":$registro"
cpu=$(cpu_json "${CPU_LOG:-/storage/cpu.log}")
[ -n "$cpu" ] && body="$body,\"cpu\":$cpu"
fluidez=$(fluidez_json)
[ -n "$fluidez" ] && body="$body,\"fluidez\":$fluidez"
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

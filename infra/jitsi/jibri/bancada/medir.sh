#!/usr/bin/env bash
# A bancada do gravador (docs/30 A65), a parte que roda DENTRO do container do Jibri, com o Xorg e o audio dele ja no ar.
# Mede a corrente inteira da gravacao sem live e sem sala: o Chrome da imagem, com os parametros que o Jibri usa, toca
# em tela cheia um video de taxa conhecida (cada quadro diferente do anterior); o ffmpeg filma a tela com o comando de
# gravacao do Jibri; e a conta que vale e feita no arquivo: quantas imagens DIFERENTES por segundo ele tem (o filtro
# mpdecimate descarta o quadro igual ao anterior; conferido com arquivos de 30, 24, 10 e 5 imagens por segundo).
# As medidas de dentro da pagina (raf, pintou) vao junto so para comparar: em 25/11/2026 a pagina dizia 24 e o arquivo
# saiu travado.
#
# Variaveis: JIBRI_RECORDING_RESOLUTION (o tamanho da tela, o mesmo do container), FONTE_TAMANHO (1920x1080) e FONTE_FPS
# (30) do video tocado, SEGUNDOS (20) de gravacao, CHROMIUM_FLAGS_EXTRA (parametros a mais do Chrome, separados por
# espaco) e BANCADA_SAIDA (/tmp/bancada). Imprime uma linha RESULTADO com os numeros. Nunca fala com a rede.
set -u

export DISPLAY="${DISPLAY:-:0}" HOME="${HOME:-/home/s6}"
here=$(cd -- "$(dirname -- "$0")" && pwd)
out="${BANCADA_SAIDA:-/tmp/bancada}"
res="${JIBRI_RECORDING_RESOLUTION:-1920x1080}"
src_size="${FONTE_TAMANHO:-1920x1080}"
src_fps="${FONTE_FPS:-30}"
seconds="${SEGUNDOS:-20}"
extra="${CHROMIUM_FLAGS_EXTRA:-}"

rm -rf "$out"; mkdir -p "$out/perfil"; cp "$here/bancada.html" "$out/bancada.html"

echo "==> Tela virtual (xorg.log)"
grep -h -o 'Modeline "[0-9]*x[0-9]*"x[0-9.]*' /storage/logs/xorg.log 2>/dev/null | sort -u | sed 's/^/  /' || true
screen_hz=$(grep -h -o "Modeline \"$res\"x[0-9.]*" /storage/logs/xorg.log 2>/dev/null | tail -n1 | sed 's/.*x//')

echo "==> Video de teste: $src_size a $src_fps quadros, VP8"
ffmpeg -v error -y -f lavfi -i "testsrc2=size=$src_size:rate=$src_fps" -t "$((seconds + 30))" \
    -c:v libvpx -b:v 6M -deadline realtime -cpu-used 8 -g 60 -an "$out/fonte.webm" \
    || { echo "ERRO: o ffmpeg da imagem nao gerou o video de teste"; exit 1; }

chrome=$(command -v google-chrome || command -v chromium) || { echo "ERRO: sem Chrome na imagem"; exit 1; }
echo "==> $("$chrome" --version 2>/dev/null) com os parametros do Jibri${extra:+ e mais: $extra}"
# Os parametros que a imagem poe no jibri.conf (jibri.chrome.flags), mais o perfil e a porta para ler o titulo.
# shellcheck disable=SC2086
"$chrome" --use-fake-ui-for-media-stream --start-maximized --kiosk --enabled --autoplay-policy=no-user-gesture-required \
    --no-sandbox --disable-infobars --user-data-dir="$out/perfil" --remote-debugging-port=9222 --no-first-run \
    --no-default-browser-check $extra "file://$out/bancada.html" > "$out/chrome.log" 2>&1 &
chrome_pid=$!
trap 'kill "$chrome_pid" 2>/dev/null; sleep 1; kill -9 "$chrome_pid" 2>/dev/null' EXIT
sleep 12

page() { curl -fsS --max-time 5 http://127.0.0.1:9222/json/list 2>/dev/null | tr ',' '\n' | sed -n 's/.*"title": *"\(bancada[^"]*\)".*/\1/p' | head -n1; }
cpu_total() { awk '$1 == "cpu" { t = 0; for (i = 2; i <= 9; i++) t += $i; print t, $5 + $6 }' /proc/stat; }
echo "  pagina antes da gravacao: $(page)"

echo "==> A tela, lida 60 vezes por segundo sem gravar (quantas imagens diferentes por segundo ela mostra)"
screen_kept=$(ffmpeg -v info -f x11grab -draw_mouse 0 -framerate 60 -video_size "$res" -i :0.0+0,0 -t 8 -vf mpdecimate -an -f null - 2>&1 \
    | tr '\r' '\n' | grep -o 'frame= *[0-9]*' | tail -n1 | grep -o '[0-9]*$')
screen_fps=$(awk -v k="${screen_kept:-0}" 'BEGIN { printf "%.1f", k / 8 }')
echo "  $screen_fps por segundo"

echo "==> Gravando $seconds s com o comando de gravacao do Jibri"
record() {  # record <entrada de audio...>
    ffmpeg -y -v info -f x11grab -draw_mouse 0 -r 30 -s "$res" -thread_queue_size 4096 -i :0.0+0,0 "$@" \
        -acodec aac -strict -2 -ar 44100 -b:a 128k -af aresample=async=1 -c:v libx264 -pix_fmt yuv420p -r 30 -crf 25 \
        -preset ultrafast -profile:v main -level 3.1 -t "$seconds" -f mp4 "$out/captura.mp4" > "$out/ffmpeg.log" 2>&1
}
read -r cpu_a idle_a <<< "$(cpu_total)"
audio="pulse"
record -f pulse -thread_queue_size 4096 -i default || { audio="silencio"; record -f lavfi -i anullsrc=r=44100:cl=stereo; } \
    || { echo "ERRO: a gravacao falhou"; tail -n 15 "$out/ffmpeg.log"; exit 1; }
read -r cpu_b idle_b <<< "$(cpu_total)"
page_during=$(page)
echo "  pagina no fim da gravacao: $page_during"
echo "  ffmpeg: $(tr '\r' '\n' < "$out/ffmpeg.log" | grep 'frame=' | tail -n1 | tr -s ' ')"
echo "  os que mais usaram CPU: $(ps -eo pcpu,comm --sort=-pcpu 2>/dev/null | sed -n '2,6p' | tr -s ' ' | tr '\n' ';')"

echo "==> Contando as imagens diferentes do arquivo"
total=$(ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames -of csv=p=0 "$out/captura.mp4" 2>/dev/null | head -n1)
duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out/captura.mp4" 2>/dev/null | head -n1)
kept=$(ffmpeg -v info -i "$out/captura.mp4" -vf mpdecimate -an -f null - 2>&1 | tr '\r' '\n' | grep -o 'frame= *[0-9]*' | tail -n1 | grep -o '[0-9]*$')
unique=$(awk -v k="${kept:-0}" -v d="${duration:-0}" 'BEGIN { printf "%.1f", d > 0 ? k / d : 0 }')
cpu=$(awk -v a="$cpu_a" -v b="$cpu_b" -v ia="$idle_a" -v ib="$idle_b" 'BEGIN { d = b - a; printf "%d", d > 0 ? (1 - (ib - ia) / d) * 100 : 0 }')

echo "RESULTADO tela=${screen_hz:-?}Hz tamanho=$res fonte=${src_size}@${src_fps} extra=[${extra}] audio=$audio arquivo_imagens_por_s=$unique tela_imagens_por_s=$screen_fps quadros_do_arquivo=${total:-?} duracao=${duration:-?}s cpu=${cpu}% nucleos=$(nproc) | $page_during"

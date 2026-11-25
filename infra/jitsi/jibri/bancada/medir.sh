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
# (30) do video tocado, SEGUNDOS (20) de cada gravacao, GRAVACOES (as variacoes do comando de gravacao, abaixo),
# CHROMIUM_FLAGS_EXTRA (parametros a mais do Chrome, separados por
# espaco), PAGINA_MODO (arquivo, ou stream: o video entregue por um MediaStream, como na sala) e BANCADA_SAIDA
# (/storage/bancada). Imprime uma linha RESULTADO por gravacao. Nunca fala com a rede.
set -u

export DISPLAY="${DISPLAY:-:0}" HOME="${HOME:-/home/s6}"
here=$(cd -- "$(dirname -- "$0")" && pwd)
# No /storage, como a gravacao de verdade: no container do gravador o /tmp e um tmpfs pequeno e sem execucao.
out="${BANCADA_SAIDA:-/storage/bancada}"
mode="${PAGINA_MODO:-arquivo}"
res="${JIBRI_RECORDING_RESOLUTION:-1920x1080}"
src_size="${FONTE_TAMANHO:-1920x1080}"
src_fps="${FONTE_FPS:-30}"
seconds="${SEGUNDOS:-20}"
extra="${CHROMIUM_FLAGS_EXTRA:-}"

# O ffmpeg e o ffprobe da imagem (/usr/bin) geram o video, leem a tela e contam o arquivo: o da gravacao
# (/usr/local/bin/ffmpeg, D138) so tem o que a gravacao usa.
FF=/usr/bin/ffmpeg; FP=/usr/bin/ffprobe
minimum="${BANCADA_MINIMO:-}"
rm -rf "$out"; mkdir -p "$out/perfil"; cp "$here/bancada.html" "$out/bancada.html"

screen_hz=$(grep -h -o "Modeline \"$res\"x[0-9.]*" /storage/logs/xorg.log 2>/dev/null | tail -n1 | sed 's/.*x//')
echo "==> Tela virtual (xorg.log): $res a ${screen_hz:-?} Hz"

if [ "$mode" = "av" ]; then
    # Com som (docs/30 A65): a cada segundo, um clarao branco na tela inteira e um bipe, os dois nos primeiros 100 ms.
    # Comprido o bastante para duas gravacoes seguidas sem o video voltar ao comeco no meio de uma delas.
    echo "==> Video de teste com som: $src_size a $src_fps quadros, um clarao e um bipe por segundo, $((seconds * 2 + 60)) s"
    "$FF" -v error -y -f lavfi -i "testsrc2=size=$src_size:rate=$src_fps,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='lt(mod(t,1),0.1)'" \
        -f lavfi -i "sine=frequency=1000:sample_rate=48000,volume=volume=0:enable='gte(mod(t,1),0.1)'" -t "$((seconds * 2 + 60))" \
        -c:v libvpx -b:v 6M -deadline realtime -cpu-used 8 -g 60 -c:a libvorbis -ac 2 "$out/fonte.webm" \
        || { echo "ERRO: o ffmpeg da imagem nao gerou o video de teste com som"; exit 1; }
else
    echo "==> Video de teste: $src_size a $src_fps quadros, VP8"
    "$FF" -v error -y -f lavfi -i "testsrc2=size=$src_size:rate=$src_fps" -t 90 \
        -c:v libvpx -b:v 6M -deadline realtime -cpu-used 8 -g 60 -an "$out/fonte.webm" \
        || { echo "ERRO: o ffmpeg da imagem nao gerou o video de teste"; exit 1; }
fi

chrome=$(command -v google-chrome || command -v chromium) || { echo "ERRO: sem Chrome na imagem"; exit 1; }
echo "==> $("$chrome" --version 2>/dev/null) com os parametros do Jibri${extra:+ e mais: $extra}"
# Os parametros que a imagem poe no jibri.conf (jibri.chrome.flags), mais o perfil e a porta para ler o titulo.
# shellcheck disable=SC2086
"$chrome" --use-fake-ui-for-media-stream --start-maximized --kiosk --enabled --autoplay-policy=no-user-gesture-required \
    --no-sandbox --disable-infobars --user-data-dir="$out/perfil" --remote-debugging-port=9222 --no-first-run \
    --no-default-browser-check $extra "file://$out/bancada.html?modo=$mode" > "$out/chrome.log" 2>&1 &
chrome_pid=$!
trap 'kill "$chrome_pid" 2>/dev/null; sleep 1; kill -9 "$chrome_pid" 2>/dev/null' EXIT
sleep 12

page() { curl -fsS --max-time 5 http://127.0.0.1:9222/json/list 2>/dev/null | tr ',' '\n' | sed -n 's/.*"title": *"\(bancada[^"]*\)".*/\1/p' | head -n1; }
cpu_total() { awk '$1 == "cpu" { t = 0; for (i = 2; i <= 9; i++) t += $i; print t, $5 + $6 }' /proc/stat; }
echo "  pagina antes da gravacao: $(page)"
# Como o Chrome desenha: os parametros do processo de GPU dizem se a pagina e montada por GL em software ou sem GPU.
echo "  processo de GPU: $(ps -eo args 2>/dev/null | grep -- '--type=gpu-process' | grep -v grep | head -n1 | grep -o -- '--use-[a-z-]*=[a-z0-9-]*\|--disable-gpu[a-z-]*\|--enable-unsafe-[a-z-]*' | tr '\n' ' ')"

echo "==> da imagem: $("$FF" -version 2>/dev/null | head -n1 | cut -d' ' -f1-3); da gravacao: $(/usr/local/bin/ffmpeg -version 2>/dev/null | head -n1 | cut -d' ' -f1-3)"
echo "==> A tela, lida 60 vezes por segundo sem gravar (quantas imagens diferentes por segundo ela mostra)"
# O -t antes do -i (limite da leitura): depois dele o limite seria da saida, e com a tela parada o mpdecimate descarta
# tudo, a saida nunca anda e o ffmpeg nao termina.
screen_kept=$("$FF" -v info -f x11grab -draw_mouse 0 -framerate 60 -video_size "$res" -t 8 -i :0.0+0,0 -vf mpdecimate -an -f null - 2>&1 \
    | tr '\r' '\n' | grep -o 'frame= *[0-9]*' | tail -n1 | grep -o '[0-9]*$')
screen_fps=$(awk -v k="${screen_kept:-0}" 'BEGIN { printf "%.1f", k / 8 }')
echo "  $screen_fps por segundo"

# O audio do gravador: de quanto em quanto tempo chega um pedaco (o ffmpeg 7 so deixa a captura da tela andar quando o
# audio anda; a rajada do audio vira a taxa de imagens do arquivo).
audio_probe() {  # audio_probe <rotulo> [VAR=valor...]
    local label="$1"; shift
    env "$@" "$FF" -nostdin -v info -f pulse -t 6 -i default -af ashowinfo -f null - 2>&1 | python3 -u -c '
import sys, time
t, n = [], []
for line in iter(sys.stdin.readline, ""):
    if "nb_samples:" in line:
        t.append(time.monotonic())
        try:
            n.append(int(line.split("nb_samples:")[1].split()[0]))
        except Exception:
            pass
if len(t) < 3:
    print("sem pedacos de audio")
    sys.exit()
d = sorted((b - a) * 1000 for a, b in zip(t, t[1:]))
span = max(0.001, t[-1] - t[0])
print("%d pedacos em %.1f s, %d amostras cada (mediana); espera entre pedacos: mediana %.0f ms, 95%% %.0f ms, maior %.0f ms; esperas acima de 20 ms: %.1f por segundo"
      % (len(t), span, sorted(n)[len(n) // 2] if n else 0, d[len(d) // 2], d[int(len(d) * 0.95)], d[-1], len([x for x in d if x > 20]) / span))
' | sed "s/^/  $label: /"
}
echo "==> O audio que o ffmpeg recebe do pulse"
audio_probe "padrao"

# As gravacoes: cada uma e "nome|opcoes da entrada da tela|entrada do audio|variaveis de ambiente|opcoes a mais da
# saida", separadas por ponto e virgula. A primeira e o comando de gravacao do Jibri como a imagem o monta (reference.conf
# do Jibri com o audio do jibri.conf da imagem); as outras mudam uma coisa so, para achar o que derruba as imagens do
# arquivo. Achado de 25/11/2026: com o ffmpeg 7.1 da imagem, a entrada de audio segura a captura da tela (4 imagens por
# segundo com o audio, 30 sem ele).
pulse="-f pulse -thread_queue_size 4096 -i default"
gravador_path="PATH=/usr/local/bin:/usr/bin:/bin"
imagem_path="PATH=/usr/bin:/bin"
# gravador: o comando do Jibri com o ffmpeg que o gravador acha primeiro (o da gravacao, se montado). imagem: o mesmo
# comando com o ffmpeg 7.1 da imagem, o defeito. sem-audio: o teto, so a tela.
recordings="${GRAVACOES:-gravador|-r 30|$pulse|$gravador_path|;imagem|-r 30|$pulse|$imagem_path|;sem-audio|-r 30||$imagem_path|}"

record() {  # record <nome> <opcoes da entrada da tela> <entrada do audio> <variaveis> <opcoes a mais da saida>
    local name="$1" vin="$2" ain="$3" vars="$4" more="$5" aenc=()
    # JIBRI: o capturador de verdade do Jibri (captura/Captura.java), com o ffmpeg de JIBRI_FF, parado por SIGINT como na live.
    if [ "$vin" = "JIBRI" ]; then
        local dir="$out/$name" bin="${vars#JIBRI_FF=}"
        mkdir -p "$dir"
        java -cp /opt/jitsi/jibri/jibri.jar:/captura -Dconfig.file=/run/jibri/config/jibri.conf \
            -Djava.util.logging.config.file=/bancada/captura/logging.properties -Djava.io.tmpdir=/run/jibri/tmp \
            "-Djibri.ffmpeg.ffmpeg-binary=$bin" Captura "$dir" "$seconds" > "$out/$name.log" 2>&1
        echo "  capturador: $(grep -h -E 'Starting ffmpeg with|transitioning|exited with|Timed out|forcibly|CAPTURA|Exception' "$out/$name.log" | cut -c1-900 | head -n 14)"
        echo "  quantas vezes o Jibri ficou 2 s sem ler nada do ffmpeg: $(grep -c "hasn't written" "$out/$name.log")"
        echo "  o que o Jibri leu do ffmpeg:"
        grep -h . "$out"/ffmpeg-jibri.*.txt 2>/dev/null | sed 's/^/    /' | cut -c1-220 | { head -n 34; echo "    ..."; tail -n 6; }
        rm -f "$out"/ffmpeg-jibri.*
        mv "$(find "$dir" -name '*.mp4' | head -n1)" "$out/$name.mp4"
        return
    fi
    [ -n "$ain" ] && aenc=(-acodec aac -strict -2 -ar 44100 -b:a 128k -af aresample=async=1)
    # -nostdin: dentro do laco o ffmpeg leria a lista das gravacoes como se fossem teclas.
    # shellcheck disable=SC2086
    env $vars ffmpeg -nostdin -y -v info -f x11grab -draw_mouse 0 $vin -s "$res" -thread_queue_size 4096 -i :0.0+0,0 $ain \
        "${aenc[@]}" -c:v libx264 -pix_fmt yuv420p -r 30 -crf 25 -preset ultrafast -profile:v main -level 3.1 $more \
        -t "$seconds" -f mp4 "$out/$name.mp4" > "$out/$name.log" 2>&1
}

# O desvio entre o audio e a imagem no arquivo (so no modo av): os instantes em que a tela fica branca e os instantes em
# que o bipe comeca vao para o desvio-av.py, que casa cada clarao com o bipe mais perto. Negativo = o audio vem antes.
av_offsets() {  # av_offsets <arquivo>
    "$FF" -nostdin -v error -i "$1" -vf "scale=64:36,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=$out/claroes.txt" -an -f null - 2>/dev/null
    "$FF" -nostdin -v info -i "$1" -vn -af "silencedetect=noise=-35dB:d=0.3" -f null - 2> "$out/bipes.txt"
    python3 "$here/desvio-av.py" "$out/claroes.txt" "$out/bipes.txt"
}

status=0
while IFS='|' read -r name vin ain vars more; do
    [ -n "$name" ] || continue
    echo "==> Gravando $seconds s: $name (tela: ${vin:-padrao}; audio: ${ain:-sem audio}${vars:+; ambiente: $vars}${more:+; saida: $more})"
    read -r cpu_a idle_a <<< "$(cpu_total)"
    if ! record "$name" "$vin" "$ain" "$vars" "$more"; then
        echo "ERRO: a gravacao $name falhou"; tail -n 8 "$out/$name.log"; status=1; continue
    fi
    read -r cpu_b idle_b <<< "$(cpu_total)"
    page_now=$(page)
    echo "  ffmpeg: $(tr '\r' '\n' < "$out/$name.log" | grep 'frame=' | tail -n1 | tr -s ' ')"
    total=$("$FP" -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames -of csv=p=0 "$out/$name.mp4" 2>/dev/null | head -n1)
    duration=$("$FP" -v error -show_entries format=duration -of csv=p=0 "$out/$name.mp4" 2>/dev/null | head -n1)
    audio_s=$("$FP" -v error -select_streams a:0 -show_entries stream=duration -of csv=p=0 "$out/$name.mp4" 2>/dev/null | head -n1)
    kept=$("$FF" -nostdin -v info -i "$out/$name.mp4" -vf mpdecimate -an -f null - 2>&1 | tr '\r' '\n' | grep -o 'frame= *[0-9]*' | tail -n1 | grep -o '[0-9]*$')
    # Os parenteses em volta da conta: no awk, um > solto depois de printf manda a saida para um arquivo.
    unique=$(awk -v k="${kept:-0}" -v d="${duration:-0}" 'BEGIN { printf "%.1f", (d > 0 ? k / d : 0) }')
    # Depois do arranque: nos primeiros segundos o ffmpeg abre o audio com a captura da tela ja contando, e recupera o
    # atraso com quadros repetidos; a taxa que vale para uma gravacao longa e a de depois disso.
    kept_late=$("$FF" -nostdin -v info -ss 4 -i "$out/$name.mp4" -vf mpdecimate -an -f null - 2>&1 | tr '\r' '\n' | grep -o 'frame= *[0-9]*' | tail -n1 | grep -o '[0-9]*$')
    late=$(awk -v k="${kept_late:-0}" -v d="${duration:-0}" 'BEGIN { printf "%.1f", (d > 4 ? k / (d - 4) : 0) }')
    cpu=$(awk -v a="$cpu_a" -v b="$cpu_b" -v ia="$idle_a" -v ib="$idle_b" 'BEGIN { d = b - a; printf "%d", (d > 0 ? (1 - (ib - ia) / d) * 100 : 0) }')
    echo "RESULTADO gravacao=$name arquivo_imagens_por_s=$unique depois_de_4s=$late tela_imagens_por_s=$screen_fps tela=${screen_hz:-?}Hz pagina=$mode tamanho=$res fonte=${src_size}@${src_fps} extra=[${extra}] quadros_do_arquivo=${total:-?} duracao=${duration:-?}s audio=${audio_s:-sem}s cpu=${cpu}% nucleos=$(nproc) | $page_now"
    # O que o ffmpeg avisou alem do andamento (filas cheias, relogio, erro): as mensagens mais repetidas.
    echo "  avisos do ffmpeg: $(tr '\r' '\n' < "$out/$name.log" | grep -v 'frame=' | grep -i -E 'queue|error|overrun|underrun|past duration|adjusted ts|backward|buffer|failed|exiting|conversion' | sed 's/0x[0-9a-f]*//g' | sort | uniq -c | sort -rn | head -n 6 | tr -s ' ' | tr '\n' ';' | cut -c1-700)"
    [ "$mode" = "av" ] && echo "RESULTADO-AV gravacao=$name pedido=${seconds}s arquivo=${duration:-?}s audio=${audio_s:-sem}s $(av_offsets "$out/$name.mp4")"
    # A regua: a gravacao "gravador" tem de passar do minimo depois do arranque (BANCADA_MINIMO, imagens por segundo).
    if [ -n "$minimum" ] && [ "$name" = "gravador" ] && ! awk -v l="$late" -v m="$minimum" 'BEGIN { exit !(l >= m) }'; then
        echo "ERRO: o gravador ficou em $late imagens por segundo depois do arranque, abaixo de $minimum"; status=1
    fi
done <<< "$(printf '%s' "$recordings" | tr ';' '\n')"
echo "  as linhas de execucao que mais usaram CPU: $(ps -eLo pcpu,comm --sort=-pcpu 2>/dev/null | sed -n '2,9p' | tr -s ' ' | tr '\n' ';')"
exit "$status"

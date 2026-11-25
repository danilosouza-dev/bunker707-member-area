#!/usr/bin/env bash
# O ffmpeg da gravacao (docs/30 D138): compila, do codigo oficial, o ffmpeg da geracao anterior a 7 so com o que o comando
# de gravacao do Jibri usa (captura da tela e do pulse, x264, aac, mp4), e deixa o binario em <pasta>/ffmpeg.
#   bash infra/jitsi/jibri/ffmpeg-gravacao.sh <pasta de saida>
# Roda no runner do jibri-up (enquanto a maquina do gravador sobe) e na bancada (infra/jitsi/jibri/bancada). A compilacao
# acontece dentro de um container debian:trixie-slim, a mesma base da imagem do Jibri: o binario usa o libx264, o libpulse
# e o libxcb do sistema, que a imagem ja tem. O binario so vai para as nossas maquinas; nada e publicado.
#
# Por que: a imagem do Jibri (stable-11248) traz o ffmpeg 7.1. A partir do 7.0 o programa ganhou um agendador que segura a
# leitura de uma entrada enquanto a outra esta atrasada, e a opcao -thread_queue_size, que o comando do Jibri usa para a
# captura da tela nunca esperar pelo audio, deixou de valer na entrada (ffmpeg trac 11184). Com a tela e o audio no mesmo
# comando, a tela mostra 30 imagens por segundo e o arquivo sai com 3 a 6 (a live de 24/11/2026 e a bancada de
# 25/11/2026); com o 6.1, o mesmo comando deixa 30 depois do arranque.
#
# O pacote do codigo e conferido pelo sha256 antes de abrir. Trocar de versao: os dois valores abaixo, e a bancada.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail

version="${FFMPEG_VERSAO:-6.1.6}"
sha256="${FFMPEG_SHA256:-d4fcb164028dd3beee5d92c0ac72e46aac6973c75ea12dc14de07bf8f407370a}"
base="debian:trixie-slim"

if [ "${FFMPEG_GRAVACAO_DENTRO:-}" != "1" ]; then
    # Fora: sobe o container da compilacao com este mesmo arquivo dentro. Tenta de novo so se o Docker falhar (rede).
    out="${1:?uso: ffmpeg-gravacao.sh <pasta de saida>}"
    mkdir -p "$out"; out=$(cd -- "$out" && pwd)
    self="$(cd -- "$(dirname -- "$0")" && pwd)/$(basename -- "$0")"
    pause="${FFMPEG_GRAVACAO_ESPERA:-10}"
    for attempt in 1 2 3; do
        rm -f "$out/ffmpeg"
        if docker run --rm -e FFMPEG_GRAVACAO_DENTRO=1 -e FFMPEG_VERSAO="$version" -e FFMPEG_SHA256="$sha256" \
            -v "$self:/ffmpeg-gravacao.sh:ro" -v "$out:/saida" "$base" bash /ffmpeg-gravacao.sh; then
            [ -x "$out/ffmpeg" ] && exit 0
            echo "ERRO: a compilacao terminou sem o binario em $out/ffmpeg" >&2; exit 1
        fi
        echo "a compilacao do ffmpeg falhou na tentativa $attempt" >&2
        [ "$attempt" = 3 ] || sleep "$((pause * attempt))"
    done
    exit 1
fi

# Dentro do container da compilacao.
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends build-essential nasm pkg-config ca-certificates curl xz-utils \
    libx264-dev libpulse-dev libxcb1-dev libxcb-shm0-dev libxcb-xfixes0-dev libxcb-shape0-dev > /dev/null

cd /tmp
curl -fsSL --retry 3 -o "ffmpeg-$version.tar.xz" "https://ffmpeg.org/releases/ffmpeg-$version.tar.xz"
echo "$sha256  ffmpeg-$version.tar.xz" | sha256sum -c -
tar -xJf "ffmpeg-$version.tar.xz"
cd "ffmpeg-$version"

./configure --disable-doc --disable-debug --disable-ffplay --disable-ffprobe --disable-autodetect --disable-network \
    --disable-everything --enable-gpl --enable-libx264 --enable-libpulse \
    --enable-libxcb --enable-libxcb-shm --enable-libxcb-xfixes --enable-libxcb-shape \
    --enable-indev=xcbgrab,pulse --enable-decoder=rawvideo,pcm_s16le --enable-encoder=libx264,aac \
    --enable-muxer=mp4,flv,null --enable-protocol=file \
    --enable-filter=aresample,scale,format,aformat,null,anull,fps > /saida/configure.log
make -j"$(nproc)" ffmpeg > /saida/make.log 2>&1
install -m 755 ffmpeg /saida/ffmpeg
/saida/ffmpeg -version | head -n1

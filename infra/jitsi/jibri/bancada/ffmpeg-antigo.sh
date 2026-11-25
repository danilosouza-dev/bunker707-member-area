#!/usr/bin/env bash
# A bancada do gravador (docs/30 A65): compila o ffmpeg da geracao anterior a 7, do codigo oficial, para comparar com o da
# imagem do Jibri. Roda DENTRO de um container debian:trixie-slim (a mesma base da imagem: o binario usa o libx264, o
# libpulse e o libxcb do sistema, que a imagem ja tem) e deixa o binario em /saida/ffmpeg.
#
# Por que: a partir do ffmpeg 7.0 o programa ganhou um agendador que segura a leitura de uma entrada quando outra esta
# atrasada, e a opcao -thread_queue_size, que o comando do Jibri usa para a captura da tela nunca esperar, deixou de
# valer na entrada (ffmpeg trac 11184). Na imagem (ffmpeg 7.1) a tela mostra 30 imagens por segundo e o arquivo sai com 4.
#
# So o que a gravacao usa (captura da tela e do pulse, x264, aac, mp4): compila em 1 a 2 minutos. O pacote do codigo e
# conferido pelo sha256 antes de abrir.
set -euo pipefail

version="${FFMPEG_VERSAO:-6.1.6}"
sha256="${FFMPEG_SHA256:-d4fcb164028dd3beee5d92c0ac72e46aac6973c75ea12dc14de07bf8f407370a}"

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
    --enable-indev=xcbgrab,pulse,lavfi --enable-decoder=rawvideo,pcm_s16le --enable-encoder=libx264,aac \
    --enable-muxer=mp4,null --enable-protocol=file \
    --enable-filter=aresample,scale,format,aformat,null,anull,fps,anullsrc > /saida/configure.log
make -j"$(nproc)" ffmpeg > /saida/make.log 2>&1
install -m 755 ffmpeg /saida/ffmpeg
/saida/ffmpeg -version | head -n1

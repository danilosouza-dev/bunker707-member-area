#!/bin/sh
# O que o Jibri chama para gravar (docs/30 D140; custom-jibri.conf). Espera 2 s e vira o ffmpeg da gravacao (o mesmo
# processo: o SIGINT com que o Jibri para a gravacao chega ao ffmpeg).
#
# Por que: o Jibri comeca a ler a saida do programa antes de ligar os canos internos dele (Tee.addBranch poe o
# PipedOutputStream na lista antes de conecta-lo). Um programa que escreve logo na partida, como o ffmpeg 6.1 enxuto,
# derruba essa leitura, e o Jibri nunca mais ouve o ffmpeg: nao confirma ao Jicofo que esta gravando, e o Jicofo manda
# parar em 90 s ("Jibri pending timeout!"; as tres gravacoes de 25/11/2026 sairam com 86 e 87 s). O 7.1 da imagem,
# que demora mais a comecar, escapava. Os 2 s saem do comeco da gravacao.
sleep "${FFMPEG_JIBRI_ESPERA:-2}"
exec "${FFMPEG_JIBRI_BIN:-/usr/local/bin/ffmpeg}" "$@"

#!/bin/sh
# O ffmpeg da gravacao com 1 s de espera antes: para saber se o Jibri perde a saida de um programa que comeca depressa.
sleep 1
exec /usr/local/bin/ffmpeg "$@"

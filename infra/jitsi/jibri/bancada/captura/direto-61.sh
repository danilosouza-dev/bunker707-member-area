#!/bin/sh
# O ffmpeg da gravacao sem a espera do ffmpeg-jibri.sh: o controle do defeito dos 90 s (docs/30 D140).
exec /usr/local/bin/ffmpeg "$@"

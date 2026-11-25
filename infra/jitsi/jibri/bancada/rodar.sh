#!/usr/bin/env bash
# A bancada do gravador (docs/30 A65), a parte de fora: sobe um container da imagem do Jibri na tag fixada, como o
# gravador de verdade sobe (2 GB de /dev/shm, o mesmo tamanho de tela), espera o Xorg e roda o medir.sh dentro dele.
# Nao precisa de sala, de live nem de servidor nosso: o Jibri do container fica tentando um XMPP que nao existe, e a
# bancada usa so o Xorg, o audio, o Chrome e o ffmpeg da imagem. Roda no workflow gravador-bancada.yml ou em qualquer
# maquina com Docker:
#   TELA=nossa JIBRI_RECORDING_RESOLUTION=1920x1080 bash infra/jitsi/jibri/bancada/rodar.sh
# Variaveis: TELA (nossa = o xorg-video-dummy.conf deste repositorio, a 60 Hz; imagem = o que vem na imagem, o controle
# do defeito de 10 Hz), JIBRI_RECORDING_RESOLUTION, e as do medir.sh (FONTE_TAMANHO, FONTE_FPS, SEGUNDOS,
# GRAVACOES, CHROMIUM_FLAGS_EXTRA, PAGINA_MODO), repassadas.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail

here=$(cd -- "$(dirname -- "$0")" && pwd)
jibri_dir=$(cd -- "$here/.." && pwd)
tag=$(grep -E '^JITSI_IMAGE_VERSION=' "$jibri_dir/.env.example" | head -n1 | cut -d= -f2-)
repo=$(grep -E '^JITSI_IMAGE_REPO=' "$jibri_dir/.env.example" | head -n1 | cut -d= -f2-)
image="${repo:-ghcr.io/jitsi}/jibri:${tag:?sem JITSI_IMAGE_VERSION no .env.example do Jibri}"
res="${JIBRI_RECORDING_RESOLUTION:-1920x1080}"
screen="${TELA:-nossa}"
name="bunker707-bancada-$$"

mounts=(-v "$here:/bancada:ro")
case "$screen" in
    nossa) mounts+=(-v "$jibri_dir/xorg-video-dummy.conf:/defaults/xorg-video-dummy.conf:ro") ;;
    imagem) ;;
    *) echo "ERRO: TELA e nossa ou imagem (recebido: $screen)" >&2; exit 1 ;;
esac

echo "==> $image, tela $screen, $res, $(nproc) nucleos"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
# As mesmas opcoes do docker-compose.yml do gravador: raiz so de leitura, /run e /tmp em memoria (o /tmp sem execucao),
# 2 GB de /dev/shm e o /storage numa pasta do disco, do usuario 1000 da imagem.
storage=$(mktemp -d)
chmod 777 "$storage"
docker run -d --name "$name" --shm-size 2g --read-only \
    --tmpfs /run:size=256M,mode=1750,exec --tmpfs /tmp:size=256M,mode=1777,noexec \
    -v "$storage:/storage" "${mounts[@]}" \
    -e DISPLAY=:0 -e TZ=UTC -e JIBRI_RECORDING_RESOLUTION="$res" \
    -e XMPP_SERVER=127.0.0.1 -e XMPP_DOMAIN=meet.jitsi -e XMPP_AUTH_DOMAIN=auth.meet.jitsi \
    -e XMPP_INTERNAL_MUC_DOMAIN=internal-muc.meet.jitsi -e XMPP_MUC_DOMAIN=muc.meet.jitsi \
    -e XMPP_HIDDEN_DOMAIN=hidden.meet.jitsi -e PUBLIC_URL=https://bancada.invalid \
    -e JIBRI_XMPP_PASSWORD=bancada -e JIBRI_RECORDER_PASSWORD=bancada \
    "$image" >/dev/null

# O Xorg do container no ar (o soquete da tela :0) e um instante para o gerenciador de janelas e o audio.
for _ in $(seq 60); do
    docker exec "$name" test -S /tmp/.X11-unix/X0 2>/dev/null && break
    sleep 1
done
docker exec "$name" test -S /tmp/.X11-unix/X0 || { echo "ERRO: o Xorg do container nao subiu"; docker logs --tail 40 "$name"; exit 1; }
sleep 5

docker exec \
    -e DISPLAY=:0 -e HOME=/home/s6 -e JIBRI_RECORDING_RESOLUTION="$res" \
    -e FONTE_TAMANHO="${FONTE_TAMANHO:-1920x1080}" -e FONTE_FPS="${FONTE_FPS:-30}" -e SEGUNDOS="${SEGUNDOS:-20}" \
    -e CHROMIUM_FLAGS_EXTRA="${CHROMIUM_FLAGS_EXTRA:-}" -e PAGINA_MODO="${PAGINA_MODO:-arquivo}" ${GRAVACOES:+-e GRAVACOES="$GRAVACOES"} \
    "$name" bash /bancada/medir.sh

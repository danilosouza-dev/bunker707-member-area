#!/usr/bin/env bash
# A bancada do gravador (docs/30 A65), a parte de fora: sobe um container da imagem do Jibri na tag fixada, como o
# gravador de verdade sobe (2 GB de /dev/shm, o mesmo tamanho de tela), espera o Xorg e roda o medir.sh dentro dele.
# Nao precisa de sala, de live nem de servidor nosso: o Jibri do container fica tentando um XMPP que nao existe, e a
# bancada usa so o Xorg, o audio e o Chrome da imagem, com o ffmpeg da gravacao montado como no gravador. Roda no workflow gravador-bancada.yml ou em qualquer
# maquina com Docker:
#   TELA=nossa JIBRI_RECORDING_RESOLUTION=1920x1080 bash infra/jitsi/jibri/bancada/rodar.sh
# Variaveis: TELA (nossa = o xorg-video-dummy.conf deste repositorio, a 60 Hz; imagem = o que vem na imagem, o controle
# do defeito de 10 Hz), JIBRI_RECORDING_RESOLUTION, e as do medir.sh (FONTE_TAMANHO, FONTE_FPS, SEGUNDOS,
# GRAVACOES, CHROMIUM_FLAGS_EXTRA, PAGINA_MODO, BANCADA_MINIMO), repassadas.
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

# O ffmpeg da gravacao (docs/30 D138), como no gravador de verdade: compilado por ffmpeg-gravacao.sh e montado a frente do
# ffmpeg da imagem, com o custom-jibri.conf que aponta o Jibri para ele.
ffdir=$(mktemp -d)
chmod 777 "$ffdir"
echo "==> Compilando o ffmpeg da gravacao do codigo oficial"
bash "$jibri_dir/ffmpeg-gravacao.sh" "$ffdir" 2>&1 | tail -n 2
[ -x "$ffdir/ffmpeg" ] || { echo "ERRO: o ffmpeg da gravacao nao compilou"; tail -n 30 "$ffdir/make.log" 2>/dev/null; exit 1; }
mounts+=(-v "$ffdir/ffmpeg:/usr/local/bin/ffmpeg:ro" -v "$jibri_dir/custom-jibri.conf:/config/custom-jibri.conf:ro" -v "$jibri_dir/ffmpeg-jibri.sh:/usr/local/bin/ffmpeg-jibri:ro")

# O capturador de verdade do Jibri (captura/Captura.java), compilado com o Java da maquina.
capdir=$(mktemp -d)
chmod 755 "$capdir"
javac --release 11 -d "$capdir" "$here/captura/Captura.java"
mounts+=(-v "$capdir:/captura:ro")

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

# As chaves do comando de gravacao no reference.conf do Jibri que a imagem traz: o que o custom-jibri.conf pode mudar.
docker exec "$name" sh -c 'unzip -p /opt/jitsi/jibri/jibri.jar reference.conf 2>/dev/null | grep -n -E "ffmpeg-binary|input-linux|audio-params|video-params|command-linux-recording|audio-source|audio-device|queue-size" | cut -c1-170 | sed "s/^/  jibri: /"' || true

# O ffmpeg que o Jibri do container acha pelo PATH dele (o da gravacao tem de vir antes do da imagem).
docker exec "$name" sh -c 'pid=$(pgrep -f jibri.jar | head -n1); [ -n "$pid" ] || exit 0; p=$(tr "\0" "\n" < "/proc/$pid/environ" | sed -n "s/^PATH=//p"); echo "  PATH do Jibri: $p"; echo "  o ffmpeg que o Jibri acha: $(PATH="$p" command -v ffmpeg) ($(PATH="$p" ffmpeg -version 2>/dev/null | head -n1 | cut -d" " -f1-3))"' || true

docker exec \
    -e DISPLAY=:0 -e HOME=/home/s6 -e JIBRI_RECORDING_RESOLUTION="$res" \
    -e FONTE_TAMANHO="${FONTE_TAMANHO:-1920x1080}" -e FONTE_FPS="${FONTE_FPS:-30}" -e SEGUNDOS="${SEGUNDOS:-20}" \
    -e CHROMIUM_FLAGS_EXTRA="${CHROMIUM_FLAGS_EXTRA:-}" -e PAGINA_MODO="${PAGINA_MODO:-arquivo}" -e BANCADA_MINIMO="${BANCADA_MINIMO:-}" ${GRAVACOES:+-e GRAVACOES="$GRAVACOES"} -e SAIDA_NO_CANO="${SAIDA_NO_CANO:-}" \
    "$name" bash /bancada/medir.sh

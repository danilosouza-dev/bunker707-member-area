#!/bin/sh
# Anota a CPU da maquina do gravador a cada 5 s (docs/30 §6.7 e A26; nasceu no teste das pecas, A62): o finalize.sh
# resume e manda junto com o aviso de fim de gravacao (o campo `cpu`, guardado cru pelo app), para saber se o gravador
# aguenta o trabalho de cada live.
# Roda no host da maquina (fora do container), iniciado pelo jibri-up depois do `up -d`. Cada linha de
# volumes/storage/jibri/cpu.log: <segundos unix> e a primeira linha de /proc/stat ("cpu user nice system idle ...").
# A primeira linha do arquivo diz quantos nucleos a maquina tem. Idempotente: com outra copia viva, sai.
set -u
dir="$(dirname -- "$0")/volumes/storage/jibri"
log="$dir/cpu.log"
pid="$dir/cpu.pid"
mkdir -p "$dir"
if [ -f "$pid" ] && kill -0 "$(cat "$pid" 2>/dev/null)" 2>/dev/null; then
    exit 0
fi
echo $$ > "$pid"
printf '# nucleos %s\n' "$(nproc 2>/dev/null || echo 0)" >> "$log"
while :; do
    printf '%s %s\n' "$(date +%s)" "$(head -n 1 /proc/stat)" >> "$log"
    sleep 5
done

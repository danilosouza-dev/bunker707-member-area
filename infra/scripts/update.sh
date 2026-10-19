#!/usr/bin/env bash
# Atualizacao do stack Supabase self-hosted a partir do compose oficial (supabase/supabase, pasta docker/):
#   sh infra/scripts/update.sh --check                 compara as imagens pinadas com o upstream
#   sh infra/scripts/update.sh --apply                 reescreve as tags em infra/compose/docker-compose.yml,
#                                                      atualiza os arquivos vendidos (Envoy, SQL de init,
#                                                      pooler, functions/main) e o UPSTREAM.md
#   ... [--ref master|self-hosted/vX.Y.Z]              padrao: master
# Roda na sua maquina, nunca direto no servidor: depois do --apply, ensaie local (docs/20), commite, abra
# PR; no servidor, o passo e backup.sh -> git pull -> compose pull -> compose up -d -> smoke.sh.
# O Postgres (db) NUNCA muda de versao maior por aqui: upgrade de major e procedimento proprio no runbook.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/lib.sh"

mode=""
ref="master"
while [ $# -gt 0 ]; do
    case "$1" in
        --check) mode="check" ;;
        --apply) mode="apply" ;;
        --ref) ref="$2"; shift ;;
        -h|--help) sed -n 2,11p "$0"; exit 0 ;;
        *) die "opcao desconhecida: $1" ;;
    esac
    shift
done
[ -n "$mode" ] || die "Informe --check ou --apply."

base="https://raw.githubusercontent.com/supabase/supabase/$ref/docker"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
log "Baixando o compose oficial ($ref)..."
curl -fsS --max-time 30 -o "$tmp/docker-compose.yml" "$base/docker-compose.yml"
curl -fsS --max-time 30 -o "$tmp/upgrades.json" "$base/upgrades.json" || echo '{}' > "$tmp/upgrades.json"

# images <arquivo>: linhas "servico imagem" (servico com 2 espacos de recuo, image com 4).
images() {
    awk '
        /^  [a-zA-Z0-9_-]+:[[:space:]]*$/ { svc=$1; sub(":", "", svc); next }
        /^    image:[[:space:]]/ && svc != "" { print svc, $2 }
    ' "$1"
}
images "$tmp/docker-compose.yml" | sort > "$tmp/upstream.txt"
images "$COMPOSE_FILE" | sort > "$tmp/ours.txt"

changed=0
printf '%-12s %-45s %s\n' "servico" "nossa imagem" "upstream"
while read -r svc ours_image; do
    up_image=$(awk -v s="$svc" '$1 == s { print $2 }' "$tmp/upstream.txt")
    [ -n "$up_image" ] || { printf '%-12s %-45s %s\n' "$svc" "$ours_image" "(so nosso)"; continue; }
    if [ "$ours_image" = "$up_image" ]; then
        printf '%-12s %-45s igual\n' "$svc" "$ours_image"
    else
        printf '%-12s %-45s -> %s\n' "$svc" "$ours_image" "$up_image"
        changed=$((changed + 1))
        if [ "$svc" = "db" ]; then
            ours_major=$(printf '%s' "$ours_image" | sed -E 's/.*:([0-9]+)\..*/\1/'); up_major=$(printf '%s' "$up_image" | sed -E 's/.*:([0-9]+)\..*/\1/')
            [ "$ours_major" = "$up_major" ] || warn "Postgres muda de versao maior ($ours_major -> $up_major): NAO aplicado automaticamente (docs/20, 'Upgrade do Postgres')."
        fi
        if [ "$mode" = "apply" ]; then
            if [ "$svc" = "db" ] && [ "${ours_major:-}" != "${up_major:-}" ]; then
                continue
            fi
            # Troca so a linha de imagem daquele servico.
            awk -v s="$svc" -v img="$up_image" '
                /^  [a-zA-Z0-9_-]+:[[:space:]]*$/ { cur=$1; sub(":", "", cur) }
                /^    image:[[:space:]]/ && cur == s { sub(/image:.*/, "image: " img) }
                { print }
            ' "$COMPOSE_FILE" > "$tmp/compose.new" && mv "$tmp/compose.new" "$COMPOSE_FILE"
        fi
    fi
done < "$tmp/ours.txt"

log "$changed imagem(ns) diferente(s) do upstream."
python3 -I - "$tmp/upgrades.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
entries = [(k, v) for k, v in data.items() if not k.startswith("_")]
if entries:
    print("==> Passos manuais que o upstream registra em upgrades.json (confira se algum vale para a sua versao):")
    for version, entry in sorted(entries):
        flag = " (BREAKING)" if entry.get("breaking") else ""
        print(f"  {version}{flag}")
        for step in entry.get("requires", []):
            print(f"    - {step}")
PY

if [ "$mode" = "apply" ]; then
    log "Atualizando os arquivos vendidos..."
    for f in volumes/api/envoy/envoy.yaml volumes/api/envoy/cds.yaml volumes/api/envoy/lds.template.yaml volumes/api/envoy/docker-entrypoint.sh \
             volumes/db/_supabase.sql volumes/db/jwt.sql volumes/db/logs.sql volumes/db/pooler.sql volumes/db/realtime.sql volumes/db/roles.sql volumes/db/webhooks.sql \
             volumes/pooler/pooler.exs volumes/functions/main/index.ts volumes/functions/deno.jsonc; do
        curl -fsS --max-time 30 -o "$COMPOSE_DIR/$f" "$base/$f" || warn "nao baixei $f"
    done
    sha=$(curl -fsS --max-time 30 "https://api.github.com/repos/supabase/supabase/commits/$ref" | python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(d["sha"][:12], d["commit"]["committer"]["date"][:10])' 2>/dev/null || echo "? ?")
    sed -i.bak -E "s|^- Referencia copiada: .*|- Referencia copiada: commit \`${sha% *}\` de ${sha#* } (ref \`$ref\`).|" "$COMPOSE_DIR/UPSTREAM.md" && rm -f "$COMPOSE_DIR/UPSTREAM.md.bak"
    log "Pronto. Revise com git diff, ensaie local (docker compose up -d + migrate.sh + smoke.sh) e abra a PR."
fi

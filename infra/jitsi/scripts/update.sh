#!/usr/bin/env bash
# Atualizacao do Jitsi proprio: a tag stable fixada em JITSI_IMAGE_VERSION (docs/30 §7.4; docs/20 §8B.6).
#   sh infra/jitsi/scripts/update.sh --check                      compara a tag fixada com a ultima stable publicada
#   sh infra/jitsi/scripts/update.sh --apply [--tag stable-NNNNN]  reescreve a tag em infra/jitsi/.env.example e em
#                                                                  infra/jitsi/jibri/.env.example (as duas sempre iguais)
#   sh infra/jitsi/scripts/update.sh --server [--tag stable-NNNNN] --sem-live
#       NO SERVIDOR (a etapa deploy-meet chama): poe no .env a tag do .env.example do commit implantado (ou --tag),
#       compose pull, up -d, espera a saude e roda o smoke; a tag anterior fica em infra/jitsi/.previous-image-version.
# Caminho: --check e --apply na sua maquina -> ensaio local -> PR -> main -> deploy-meet. Trocar a imagem recria
# os containers e derruba a sala: --server recusa sem --sem-live (ou SEM_LIVE_2H=sim no ambiente), e nunca com
# live nas proximas 2 h. Voltar atras: --server --tag <tag anterior> --sem-live.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/_env.sh"

mode=""; tag=""; sem_live="${SEM_LIVE_2H:-}"
while [ $# -gt 0 ]; do
    case "$1" in
        --check) mode="check" ;;
        --apply) mode="apply" ;;
        --server) mode="server" ;;
        --tag) tag="$2"; shift ;;
        --sem-live) sem_live="sim" ;;
        -h|--help) sed -n 2,12p "$0"; exit 0 ;;
        *) die "opcao desconhecida: $1" ;;
    esac
    shift
done
[ -n "$mode" ] || die "Informe --check, --apply ou --server."

example="$JITSI_DIR/.env.example"
jibri_example="$JITSI_DIR/jibri/.env.example"
tag_pattern='^stable-[0-9]{4,6}(-[0-9]+)?$'
pinned() { grep -E '^JITSI_IMAGE_VERSION=' "$1" | head -n1 | cut -d= -f2-; }
valid_tag() { printf '%s' "$1" | grep -qE "$tag_pattern" || die "Tag invalida: '$1' (esperado stable-NNNNN; a lista esta em https://github.com/jitsi/docker-jitsi-meet/releases)."; }
latest_stable() {
    # A release mais recente do docker-jitsi-meet e sempre uma stable-NNNNN (o CHANGELOG manda olhar as releases).
    local json
    json=$(curl -fsS --max-time 30 -H 'Accept: application/vnd.github+json' https://api.github.com/repos/jitsi/docker-jitsi-meet/releases/latest) || die "Nao consegui ler a ultima release no GitHub."
    printf '%s' "$json" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1
}

ours=$(pinned "$example"); jibri_ours=$(pinned "$jibri_example")
[ "$ours" = "$jibri_ours" ] || warn "As tags divergem: $example=$ours, $jibri_example=$jibri_ours (as duas imagens sempre na mesma linha; --apply conserta)."

case "$mode" in
    check)
        latest=$(latest_stable); valid_tag "$latest"
        printf '%-34s %s\n' "fixada (infra/jitsi/.env.example)" "$ours"
        printf '%-34s %s\n' "fixada (jibri/.env.example)" "$jibri_ours"
        [ -f "$ENV_FILE" ] && printf '%-34s %s\n' "no .env desta maquina" "$(env_value JITSI_IMAGE_VERSION '(vazio)')"
        printf '%-34s %s\n' "ultima stable publicada" "$latest"
        if [ "$ours" = "$latest" ]; then log "Em dia."; else log "Ha versao nova: sh infra/jitsi/scripts/update.sh --apply (depois ensaio local, PR, main, deploy-meet com SEM_LIVE_2H=sim)."; fi ;;
    apply)
        [ -n "$tag" ] || tag=$(latest_stable); valid_tag "$tag"
        for f in "$example" "$jibri_example"; do
            sed -i.bak -E "s|^JITSI_IMAGE_VERSION=.*|JITSI_IMAGE_VERSION=$tag|" "$f" && rm -f "$f.bak"
        done
        log "JITSI_IMAGE_VERSION=$tag nos dois .env.example (era $ours). Revise com git diff, ensaie local (docs/20 §8B.9) e abra a PR; o docs/30 §6.2 cita a tag: atualize junto." ;;
    server)
        require_env_file
        current=$(env_value JITSI_IMAGE_VERSION)
        [ -n "$tag" ] || tag="$ours"; valid_tag "$tag"
        if [ "$current" = "$tag" ]; then log "O servidor ja roda $tag; nada a fazer."; exit 0; fi
        [ "$sem_live" = "sim" ] || die "Trocar $current por $tag recria os containers e derruba a sala. Confirme que nao ha live nas proximas 2 h com --sem-live (ou SEM_LIVE_2H=sim em opcoes)."
        printf '%s\n' "$current" > "$JITSI_DIR/.previous-image-version"
        log "Trocando $current por $tag (a anterior fica em infra/jitsi/.previous-image-version)"
        sed -i.bak -E "s|^JITSI_IMAGE_VERSION=.*|JITSI_IMAGE_VERSION=$tag|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"; chmod 600 "$ENV_FILE"
        compose pull --quiet
        compose up -d
        for s in prosody jicofo jvb web; do wait_healthy "$s" 300; done
        if bash "$JITSI_DIR/scripts/smoke.sh"; then
            log "Jitsi em $tag."
        else
            die "O smoke falhou em $tag. Voltar: sh infra/jitsi/scripts/update.sh --server --tag $current --sem-live"
        fi ;;
esac

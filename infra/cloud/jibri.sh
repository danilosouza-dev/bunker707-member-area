#!/usr/bin/env bash
# O gravador por hora (docs/30 §6.7; docs/20 §8B.5): cria a maquina do Jibri antes da live e a apaga no fim.
#   CONFIRMADO=sim SESSAO=<id da sessao> bash infra/cloud/jibri.sh up        etapa jibri-up
#   CONFIRMADO=sim [SESSAO=<id>] [FORCAR=1] bash infra/cloud/jibri.sh down    etapa jibri-down (sem SESSAO: todos)
#   [SESSAO=<id>] COMANDO='...' bash infra/cloud/jibri.sh exec                 etapa exec-jibri (em /opt/jibri)
# Opcoes: JIBRI_TYPE (cpx42: 8 vCPU e 16 GB para 1080p a 30 quadros, D26), LOCATION e FALLBACK_LOCATIONS,
# JIBRI_FALLBACK_TYPES (ccx23 cpx32; o cpx32 grava em 720p), JIBRI_RECORDING_RESOLUTION (1920x1080).
# Precisa de HCLOUD_TOKEN e do segredo JIBRI_SECRETS do repositorio (linhas CHAVE=VALOR: BUNNY_LIBRARY_ID,
# BUNNY_API_KEY, WEBINAR_RECORDER_WEBHOOK_SECRET; opcionais WEBINAR_RECORDER_WEBHOOK_URL e BUNNY_COLLECTION_ID).
# up: cria bunker707-jibri-<sessao> (labels app, papel=jibri, sessao) com o cloud-init de infra/jitsi/jibri (Docker
#     e a imagem; sem segredo), grava /opt/jibri/.env por SSH (senhas e dominios lidos do .env do servidor C,
#     segredos de JIBRI_SECRETS), abre a 5222 do C so para o IP dele, sobe o container, espera o Jibri ficar
#     HEALTHY e avisa o app (state=ready). Sem estoque em tipo algum: state=unavailable.
# down: so apaga quando o app diz que a gravacao esta na Bunny (uploaded) ou que nao houve gravacao, e quando
#     nao ha MP4 sem a marca .uploaded na maquina; FORCAR=1 apaga mesmo assim. Avisa o app (state=gone).
# Nada e criado nem apagado sem CONFIRMADO=sim (o ok do produtor no chat, docs/20). Custa por hora a partir do
# minuto em que o servidor existe. Nunca imprime segredo. Idempotente: rodar de novo completa o que faltou.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/lib.sh"
action="${1:-}"
case "$action" in up|down|exec) ;; *) die "uso: jibri.sh up|down|exec" ;; esac

JIBRI_FALLBACK_TYPES="${JIBRI_FALLBACK_TYPES:-ccx23 cpx32}"
JIBRI_RECORDING_RESOLUTION="${JIBRI_RECORDING_RESOLUTION:-1920x1080}"
JITSI_DIR="$REPO_ROOT/infra/jitsi"
HEALTH_URL="http://127.0.0.1:2222/jibri/api/v1.0/health"

valid_sessao() {
    printf '%s' "$1" | grep -qE '^[a-z0-9][a-z0-9-]{3,47}$' || die "SESSAO invalida: '$1' (o id da sessao: letras minusculas, numeros e hifens, de 4 a 48 caracteres)."
}
jibri_name() { printf '%s%s' "$JIBRI_NAME_PREFIX" "$1"; }
server_json_field() { hzj server describe "$1" | jq -r "$2"; }
# print_cost TIPO LOCAL [horas]: preco por hora lido da API e a conta da live (2,5 h por padrao, docs/30 §6.7).
print_cost() {
    local p; p=$(hourly_price "$1" "$2")
    if [ -n "$p" ]; then
        awk -v p="$p" -v t="$1" -v h="${3:-2.5}" 'BEGIN { printf "  custo: EUR %.4f/h (%s, preco liquido da API hoje); %.1f h ~ EUR %.2f; a Hetzner cobra por hora ate o teto mensal\n", p, t, h, p * h }'
    else
        echo "  custo: preco de $1 nao lido pela API; referencia docs/30 §7.5: cpx42 ~ EUR 0,112/h, live de 2,5 h ~ EUR 0,28"
    fi
}
hours_since() {  # hours_since ISO8601
    python3 -I -c 'import datetime, sys; c = datetime.datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00")); print(round((datetime.datetime.now(datetime.timezone.utc) - c).total_seconds() / 3600, 2))' "$1" 2>/dev/null || echo "?"
}
ssh_alive() { ssh "${SSH_OPTS[@]}" -o ConnectTimeout=8 "$1" true 2>/dev/null; }

# ====== up ==============================================================================================
up() {
    [ "${CONFIRMADO:-}" = "sim" ] || die "jibri-up cria um servidor cobrado por hora. Confirme com CONFIRMADO=sim nas opcoes, depois do ok do produtor no chat (docs/20 §8B.5)."
    need HCLOUD_TOKEN JIBRI_SECRETS SESSAO
    valid_sessao "$SESSAO"
    local name; name=$(jibri_name "$SESSAO")
    local webhook_secret bunny_lib bunny_key webhook_url collection
    webhook_secret=$(jibri_secret WEBINAR_RECORDER_WEBHOOK_SECRET); mask "$webhook_secret"
    bunny_lib=$(jibri_secret BUNNY_LIBRARY_ID)
    bunny_key=$(jibri_secret BUNNY_API_KEY); mask "$bunny_key"
    webhook_url=$(jibri_secret_opt WEBINAR_RECORDER_WEBHOOK_URL "$RECORDER_WEBHOOK_URL")
    collection=$(jibri_secret_opt BUNNY_COLLECTION_ID "")
    install_hcloud; deploy_key
    server_exists "$MEET_NAME" || die "O servidor $MEET_NAME nao existe: rode provision-meet e deploy-meet antes."

    log "1/6 O que o gravador precisa do servidor C ($MEET_NAME)"
    local meet_ip meet_target envc; meet_ip=$(server_ip4 "$MEET_NAME"); meet_target="$DEPLOY_USER@$meet_ip"; envc="$REMOTE_DIR/infra/jitsi/.env"
    fw_open_ssh "$MEET_NAME"; wait_ssh "$meet_target" 10
    rsh "$meet_target" "test -f '$envc'" || die "O servidor C ainda nao tem infra/jitsi/.env: rode deploy-meet antes."
    local image_repo image_version public_url xmpp_user xmpp_pw rec_user rec_pw brewery d_main d_auth d_imuc d_muc d_hidden
    image_repo=$(get_env "$meet_target" "$envc" JITSI_IMAGE_REPO); image_repo="${image_repo:-ghcr.io/jitsi}"
    image_version=$(get_env "$meet_target" "$envc" JITSI_IMAGE_VERSION)
    public_url=$(get_env "$meet_target" "$envc" PUBLIC_URL)
    xmpp_user=$(get_env "$meet_target" "$envc" JIBRI_XMPP_USER); xmpp_user="${xmpp_user:-jibri}"
    xmpp_pw=$(get_env "$meet_target" "$envc" JIBRI_XMPP_PASSWORD); mask "$xmpp_pw"
    rec_user=$(get_env "$meet_target" "$envc" JIBRI_RECORDER_USER); rec_user="${rec_user:-recorder}"
    rec_pw=$(get_env "$meet_target" "$envc" JIBRI_RECORDER_PASSWORD); mask "$rec_pw"
    brewery=$(get_env "$meet_target" "$envc" JIBRI_BREWERY_MUC); brewery="${brewery:-jibribrewery}"
    d_main=$(get_env "$meet_target" "$envc" XMPP_DOMAIN); d_main="${d_main:-meet.jitsi}"
    d_auth=$(get_env "$meet_target" "$envc" XMPP_AUTH_DOMAIN); d_auth="${d_auth:-auth.meet.jitsi}"
    d_imuc=$(get_env "$meet_target" "$envc" XMPP_INTERNAL_MUC_DOMAIN); d_imuc="${d_imuc:-internal-muc.meet.jitsi}"
    d_muc=$(get_env "$meet_target" "$envc" XMPP_MUC_DOMAIN); d_muc="${d_muc:-muc.meet.jitsi}"
    d_hidden=$(get_env "$meet_target" "$envc" XMPP_HIDDEN_DOMAIN); d_hidden="${d_hidden:-hidden.meet.jitsi}"
    # As senhas so sao conferidas aqui (nunca numa linha que escreve na saida).
    env_ok=1
    [ -n "$xmpp_pw" ] || env_ok=0
    [ -n "$rec_pw" ] || env_ok=0
    [ -n "$image_version" ] && [ -n "$public_url" ] && [ "$env_ok" = 1 ] || die "O infra/jitsi/.env do servidor C esta sem JITSI_IMAGE_VERSION, PUBLIC_URL ou as senhas do Jibri."
    echo "  imagem $image_repo/jibri:$image_version; sala em $public_url; XMPP em $meet_ip:5222"
    fw_close_all

    log "2/6 Servidor $name"
    local pub ud type loc created="" resolution="$JIBRI_RECORDING_RESOLUTION" t l
    fw_ensure "$name"
    if server_exists "$name"; then
        type=$(server_json_field "$name" '.server_type.name'); loc=$(server_json_field "$name" '.location.name // .datacenter.location.name')
        echo "  ja existe: $type em $loc, $(server_json_field "$name" '.status') (idempotente: refaz o .env e confere a saude)."
    else
        pub=$(deploy_public_key); ud="$WORK_DIR/cloud-init-$name.yaml"
        sed -e "s|__DEPLOY_USER__|$DEPLOY_USER|" -e "s|__SSH_PUBLIC_KEY__|$pub|" \
            -e "s|__JITSI_IMAGE_REPO__|$image_repo|" -e "s|__JITSI_IMAGE_VERSION__|$image_version|" \
            "$JITSI_DIR/jibri/cloud-init.yaml" > "$ud"
        for t in $JIBRI_TYPE $JIBRI_FALLBACK_TYPES; do
            for l in "$LOCATION" $FALLBACK_LOCATIONS; do
                echo "  criando $name ($t) em $l..."
                if hz server create --name "$name" --type "$t" --image ubuntu-24.04 --location "$l" \
                    --ssh-key "$SSH_KEY_NAME" --firewall "$(fw_name "$name")" --user-data-from-file "$ud" \
                    --label app=bunker707 --label papel=jibri --label sessao="$SESSAO" >/dev/null 2>"$WORK_DIR/create-$name.err"; then
                    created=1; type="$t"; loc="$l"; break 2
                fi
                if grep -qiE 'unavailable|not available|resource_limit|capacity' "$WORK_DIR/create-$name.err"; then
                    warn "$t indisponivel em $l: $(tr -d '\n' < "$WORK_DIR/create-$name.err" | cut -c1-160)"
                    continue
                fi
                cat "$WORK_DIR/create-$name.err" >&2
                die "Falha ao criar $name."
            done
        done
        if [ -z "$created" ]; then
            local code; code=$(recorder_request POST "" "{\"sessionId\":\"$SESSAO\",\"state\":\"unavailable\"}")
            die "Nenhum tipo ($JIBRI_TYPE $JIBRI_FALLBACK_TYPES) disponivel em $LOCATION $FALLBACK_LOCATIONS. O app recebeu state=unavailable ($code): a live acontece, a gravacao e pelo navegador/OBS com Enviar gravacao no admin (D3)."
        fi
    fi
    if [ "$type" = "cpx32" ]; then resolution="1280x720"; warn "cpx32 (4 vCPU): gravando em 720p; o replay desta live sai em 720p."; fi
    fw_apply "$name"
    hz server poweron "$name" >/dev/null 2>&1 || true
    print_cost "$type" "$loc"

    log "3/6 .env do gravador por SSH (sem segredo no cloud-init)"
    local ip target envj; ip=$(server_ip4 "$name"); target="$DEPLOY_USER@$ip"; envj="$JIBRI_REMOTE_DIR/.env"
    fw_open_ssh "$name"; wait_ssh "$target"
    rsh "$target" "cloud-init status --wait >/dev/null 2>&1 || true; for i in \$(seq 90); do [ -f '$JIBRI_REMOTE_DIR/.cloud-init-done' ] && break; sleep 5; done; test -f '$JIBRI_REMOTE_DIR/.cloud-init-done'" \
        || die "O cloud-init do $name nao terminou (Docker e imagem do Jibri). Veja: exec-jibri com 'sudo tail -n 50 /var/log/cloud-init-output.log'."
    rcopy "$JITSI_DIR/jibri/docker-compose.yml" "$target:$JIBRI_REMOTE_DIR/docker-compose.yml"
    rcopy "$JITSI_DIR/jibri/finalize.sh" "$target:$JIBRI_REMOTE_DIR/finalize.sh"
    rcopy "$JITSI_DIR/scripts/jibri-status.sh" "$target:$JIBRI_REMOTE_DIR/jibri-status.sh"
    rsh "$target" "chmod 755 '$JIBRI_REMOTE_DIR/finalize.sh' '$JIBRI_REMOTE_DIR/jibri-status.sh'; [ -f '$envj' ] || { umask 077; cat > '$envj'; }" < "$JITSI_DIR/jibri/.env.example"
    set_env "$target" "$envj" JITSI_IMAGE_REPO "$image_repo"
    set_env "$target" "$envj" JITSI_IMAGE_VERSION "$image_version"
    set_env "$target" "$envj" TZ UTC
    set_env "$target" "$envj" XMPP_SERVER "$meet_ip"
    set_env "$target" "$envj" XMPP_PORT 5222
    set_env "$target" "$envj" XMPP_DOMAIN "$d_main"
    set_env "$target" "$envj" XMPP_AUTH_DOMAIN "$d_auth"
    set_env "$target" "$envj" XMPP_INTERNAL_MUC_DOMAIN "$d_imuc"
    set_env "$target" "$envj" XMPP_MUC_DOMAIN "$d_muc"
    set_env "$target" "$envj" XMPP_HIDDEN_DOMAIN "$d_hidden"
    set_env "$target" "$envj" PUBLIC_URL "$public_url"
    set_env "$target" "$envj" JIBRI_INSTANCE_ID "$name"
    set_env "$target" "$envj" JIBRI_XMPP_USER "$xmpp_user"
    set_env "$target" "$envj" JIBRI_XMPP_PASSWORD "$xmpp_pw"
    set_env "$target" "$envj" JIBRI_RECORDER_USER "$rec_user"
    set_env "$target" "$envj" JIBRI_RECORDER_PASSWORD "$rec_pw"
    set_env "$target" "$envj" JIBRI_BREWERY_MUC "$brewery"
    set_env "$target" "$envj" JIBRI_RECORDING_RESOLUTION "$resolution"
    set_env "$target" "$envj" SESSAO "$SESSAO"
    set_env "$target" "$envj" WEBINAR_RECORDER_WEBHOOK_URL "$webhook_url"
    set_env "$target" "$envj" WEBINAR_RECORDER_WEBHOOK_SECRET "$webhook_secret"
    set_env "$target" "$envj" BUNNY_LIBRARY_ID "$bunny_lib"
    set_env "$target" "$envj" BUNNY_API_KEY "$bunny_key"
    set_env "$target" "$envj" BUNNY_COLLECTION_ID "$collection"
    echo "  gravado $envj (0600): imagem, servidor C, contas do Jibri, sessao $SESSAO, webhook e Bunny."

    log "4/6 Firewall do servidor C: TCP 5222 aberta para $ip (regra derivada dos gravadores vivos)"
    jibri_cidrs_refresh
    fw_ensure "$MEET_NAME"

    log "5/6 Subindo o gravador e esperando a saude"
    rsh "$target" "cd '$JIBRI_REMOTE_DIR' && docker compose up -d"
    local healthy="" i out=""
    for i in $(seq 60); do
        out=$(rsh "$target" "curl -fsS --max-time 5 '$HEALTH_URL' 2>/dev/null" || true)
        case "$out" in *HEALTHY*) healthy=1; break ;; esac
        sleep 5
    done
    if [ -z "$healthy" ]; then
        rsh "$target" "cd '$JIBRI_REMOTE_DIR' && docker compose logs --no-color --tail 60 jibri" || true
        die "O Jibri nao ficou HEALTHY em 5 min. Conferir: a 5222 do $MEET_NAME aberta para $ip (firewall e ufw), as senhas do Jibri iguais as do .env do C, e 'exec-jibri' com 'bash jibri-status.sh'."
    fi
    echo "  saude: $(printf '%s' "$out" | tr -d '\n' | cut -c1-140)"

    log "6/6 Avisando o app (state=ready)"
    local code; code=$(recorder_request POST "" "{\"sessionId\":\"$SESSAO\",\"state\":\"ready\"}")
    case "$code" in
        2*) echo "  app respondeu $code: Gravacao pronta." ;;
        *) printf '::warning::O gravador esta pronto, mas o app respondeu %s ao webhook (state=ready) em %s. Confira o app (segredo, rota) e rode jibri-up de novo: e idempotente.\n' "$code" "$webhook_url" ;;
    esac
    fw_close_all
    echo
    echo "Gravador $name pronto para a sessao $SESSAO ($type em $loc, $resolution). Depois da live: etapa jibri-down com SESSAO=$SESSAO CONFIRMADO=sim."
}

# ====== down ============================================================================================
down() {
    [ "${CONFIRMADO:-}" = "sim" ] || die "jibri-down apaga o servidor do gravador. Confirme com CONFIRMADO=sim nas opcoes (docs/20 §8B.5)."
    need HCLOUD_TOKEN JIBRI_SECRETS
    install_hcloud; deploy_key
    local names forced="" name code
    if [ -n "${SESSAO:-}" ]; then valid_sessao "$SESSAO"; names=$(jibri_name "$SESSAO"); else names=$(hzj server list --selector papel=jibri | jq -r '.[].name'); fi
    [ -n "$names" ] || { echo "Nenhum gravador ligado (label papel=jibri)."; return 0; }
    case "${FORCAR:-${FORCE:-}}" in 1|sim|true) forced=1 ;; esac
    for name in $names; do
        if ! server_exists "$name"; then
            # A maquina ja foi apagada, mas o primeiro "gone" pode ter se perdido: avisa o app de novo, senao o job
            # repete o jibri-down a cada 2 h (releaseRetryMinutes) com a sessao parada em uploaded/ready (docs/30 §6.7).
            echo "  $name nao existe; nada a apagar."
            code=$(recorder_request POST "" "{\"sessionId\":\"${name#"$JIBRI_NAME_PREFIX"}\",\"state\":\"gone\"}")
            echo "  app avisado (state=gone): $code"
            continue
        fi
        local sessao="${name#"$JIBRI_NAME_PREFIX"}" created type loc hours ip target code rs ok_to_delete="" pending=""
        log "Gravador $name (sessao $sessao)"
        created=$(server_json_field "$name" '.created'); type=$(server_json_field "$name" '.server_type.name'); loc=$(server_json_field "$name" '.location.name // .datacenter.location.name')
        hours=$(hours_since "$created")
        echo "  ligado ha $hours h ($type em $loc)"
        # 1. O app confirma que a gravacao esta na Bunny? (GET assinado, docs/30 §5.3)
        code=$(recorder_request GET "/$sessao" "")
        rs=$(jq -r '.recorderStatus // empty' "$WORK_DIR/recorder-response" 2>/dev/null || true)
        echo "  app ($code): recorderStatus=${rs:-?} $(tr -d '\n' < "$WORK_DIR/recorder-response" 2>/dev/null | cut -c1-160)"
        case "$rs" in uploaded|ready|unavailable|gone) ok_to_delete=1 ;; esac   # ready/unavailable/gone = nao houve gravacao
        # 2. A maquina ainda tem MP4 sem a marca .uploaded do finalize.sh?
        ip=$(server_ip4 "$name"); target="$DEPLOY_USER@$ip"
        fw_open_ssh "$name"
        if ssh_alive "$target"; then
            pending=$(rsh "$target" "find '$JIBRI_REMOTE_DIR/volumes/storage/jibri/recordings' -type f -name '*.mp4' 2>/dev/null | while read -r f; do [ -f \"\$f.uploaded\" ] || echo \"\$f\"; done" || true)
            if [ -n "$pending" ]; then echo "  MP4 sem envio confirmado na maquina:"; printf '%s\n' "$pending" | sed 's/^/    /'; ok_to_delete=""; fi
            rsh "$target" "bash '$JIBRI_REMOTE_DIR/jibri-status.sh'" 2>/dev/null | sed 's/^/  /' || true
        else
            warn "SSH nao respondeu em $name: nao deu para conferir os arquivos."
            [ -n "$forced" ] || ok_to_delete=""
        fi
        if [ -z "$ok_to_delete" ] && [ -z "$forced" ]; then
            fw_close_all
            die "Nao apago $name: o app nao confirmou uploaded (recorderStatus=${rs:-?}) ou ha MP4 sem envio na maquina. Copie o arquivo por exec-jibri, suba pelo admin (Enviar gravacao) e rode de novo; ou FORCAR=1 para apagar mesmo assim (o arquivo some junto)."
        fi
        [ -n "$forced" ] && [ -z "$ok_to_delete" ] && warn "FORCAR=1: apagando $name sem a confirmacao do envio."
        fw_close_all
        log "Apagando $name"
        hz server delete "$name"
        hz firewall delete "$(fw_name "$name")" >/dev/null 2>&1 || warn "firewall $(fw_name "$name") nao apagado (apague no console da Hetzner)."
        jibri_cidrs_refresh
        if server_exists "$MEET_NAME"; then fw_ensure "$MEET_NAME"; echo "  regra 5222 do $MEET_NAME refeita sem $ip."; fi
        code=$(recorder_request POST "" "{\"sessionId\":\"$sessao\",\"state\":\"gone\"}")
        echo "  app avisado (state=gone): $code"
        print_cost "$type" "$loc" "$hours"
    done
}

# ====== exec ============================================================================================
exec_cmd() {
    need HCLOUD_TOKEN COMANDO
    install_hcloud; deploy_key
    local name count ip
    if [ -n "${SESSAO:-}" ]; then
        valid_sessao "$SESSAO"; name=$(jibri_name "$SESSAO")
    else
        name=$(hzj server list --selector papel=jibri | jq -r '.[].name'); count=$(printf '%s\n' "$name" | grep -c . || true)
        [ "$count" = "1" ] || die "Informe SESSAO=<id>: ha $count gravador(es) ligado(s)."
    fi
    server_exists "$name" || die "O gravador $name nao existe."
    ip=$(server_ip4 "$name"); fw_open_ssh "$name"; wait_ssh "$DEPLOY_USER@$ip"
    rsh "$DEPLOY_USER@$ip" "cd '$JIBRI_REMOTE_DIR' && $COMANDO"
}

case "$action" in
    up) up ;;
    down) down ;;
    exec) exec_cmd ;;
esac

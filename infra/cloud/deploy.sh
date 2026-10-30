#!/usr/bin/env bash
# Deploy completo de um papel (membros | marketing) no servidor da Hetzner, a partir do commit atual:
#   bash infra/cloud/deploy.sh membros      app + Supabase: imagem construida aqui e publicada no GHCR,
#                                           .env gerado no servidor, compose up, migracoes, smoke, tick de
#                                           jobs no Vault, backup (restic -> Storage Box) e timer
#   bash infra/cloud/deploy.sh marketing    Mautic: .env gerado, compose up, instalacao, smoke, backup
#   bash infra/cloud/deploy.sh meet         Jitsi proprio (servidor C, docs/20 §8B): .env gerado, volumes, ufw,
#                                           compose up com o perfil borda, smoke; a segunda rodada (stack ja no
#                                           ar) so com SEM_LIVE_2H=sim, porque recriar containers derruba a sala
# Idempotente: a segunda rodada vira atualizacao (nova imagem, migracoes novas). Precisa de HCLOUD_TOKEN
# (abre e fecha o SSH no firewall), GITHUB_TOKEN com packages:write (GHCR) e Docker (buildx) na maquina.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/lib.sh"
role="${1:-}"; [ "$role" = "membros" ] || [ "$role" = "marketing" ] || [ "$role" = "meet" ] || die "uso: deploy.sh membros|marketing|meet"
need HCLOUD_TOKEN
install_hcloud
deploy_key

case "$role" in
    membros) server="$MEMBROS_NAME" ;;
    meet) server="$MEET_NAME" ;;
    *) if [ -n "${SKIP_MARKETING:-}" ]; then server="$MEMBROS_NAME"; else server="$MARKETING_NAME"; fi ;;
esac
server_exists "$server" || die "Servidor $server nao existe: rode provision.sh antes (provision-meet para o Jitsi)."
ip=$(server_ip4 "$server"); target="$DEPLOY_USER@$ip"
box=$(storage_box_json)
sb_user=$(printf '%s' "$box" | jq -r '.username // .user // empty'); sb_host=$(printf '%s' "$box" | jq -r '.server // .host // empty')
commit=$(git -C "$REPO_ROOT" rev-parse --short HEAD)
repo_slug="${GITHUB_REPOSITORY:-danilosouza-dev/bunker707-member-area}"; repo_slug=$(printf '%s' "$repo_slug" | tr '[:upper:]' '[:lower:]')

fw_open_ssh "$server"
wait_ssh "$target"
log "Enviando o repositorio ($commit) para $server:$REMOTE_DIR"
sync_repo "$target"
remote() { rsh "$target" "cd '$REMOTE_DIR' && $*"; }
# .env gerado antes de 19/10/2026 apontava o restic para a raiz do Storage Box, que nao aceita escrita:
# o caminho passa a ser relativo a pasta pessoal do box.
fix_restic_path() {
    local repo; repo=$(get_env "$target" "$1" RESTIC_REPOSITORY)
    case "$repo" in sftp:storagebox:/bunker707/*) set_env "$target" "$1" RESTIC_REPOSITORY "sftp:storagebox:${repo#sftp:storagebox:/}" ;; esac
}

if [ "$role" = "membros" ]; then
    envf="$REMOTE_DIR/infra/compose/.env"
    if ! remote "test -f infra/compose/.env"; then
        log "Gerando segredos e enderecos no servidor (infra/compose/.env)"
        remote "sh infra/compose/generate-secrets.sh --domain '$APP_DOMAIN' --api-domain '$API_DOMAIN' --studio-domain '$STUDIO_DOMAIN' --email '$PRODUCER_EMAIL' --studio-ips '$(cidr_or_empty "${PRODUCER_IP:-127.0.0.1}")'"
    fi
    [ -n "$sb_user" ] && { set_env "$target" "$envf" STORAGE_BOX_USER "$sb_user"; set_env "$target" "$envf" STORAGE_BOX_HOST "$sb_host"; }
    fix_restic_path "$envf"
    [ -n "${SKIP_MARKETING:-}" ] && set_env "$target" "$envf" MAUTIC_SITE_ADDRESS "$MAUTIC_DOMAIN"
    # Studio so para o produtor: PRODUCER_IP nas opcoes atualiza a allowlist a qualquer momento.
    [ -n "$PRODUCER_IP" ] && set_env "$target" "$envf" STUDIO_ALLOWED_IPS "$(cidr_or_empty "$PRODUCER_IP")"

    log "Construindo a imagem do app (NEXT_PUBLIC_* do .env do servidor) e publicando no GHCR"
    supabase_url=$(get_env "$target" "$envf" SUPABASE_PUBLIC_URL); publishable=$(get_env "$target" "$envf" SUPABASE_PUBLISHABLE_KEY)
    [ -n "$supabase_url" ] && [ -n "$publishable" ] || die "SUPABASE_PUBLIC_URL/SUPABASE_PUBLISHABLE_KEY vazios no .env do servidor."
    # Prefixo proprio: o build-image.yml publica sha-<commit> no mesmo pacote com as variaveis de staging.
    image="ghcr.io/$repo_slug:hetzner-sha-$commit"
    need GITHUB_TOKEN
    printf '%s' "$GITHUB_TOKEN" | docker login ghcr.io -u "${GITHUB_ACTOR:-danilosouza-dev}" --password-stdin >/dev/null
    docker buildx build --platform linux/amd64 --push -t "$image" \
        --build-arg "APP_VERSION=sha-$commit" --build-arg "NEXT_PUBLIC_SUPABASE_URL=$supabase_url" \
        --build-arg "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$publishable" \
        --build-arg "NEXT_PUBLIC_POSTHOG_KEY=$(get_env "$target" "$envf" NEXT_PUBLIC_POSTHOG_KEY)" \
        --build-arg "NEXT_PUBLIC_POSTHOG_HOST=$(get_env "$target" "$envf" NEXT_PUBLIC_POSTHOG_HOST)" \
        --build-arg "NEXT_PUBLIC_SENTRY_DSN=$(get_env "$target" "$envf" NEXT_PUBLIC_SENTRY_DSN)" \
        "$REPO_ROOT"

    log "Servidor: login no GHCR (token efemero), imagem, stack, migracoes, smoke"
    printf '%s' "$GITHUB_TOKEN" | rsh "$target" "docker login ghcr.io -u '${GITHUB_ACTOR:-danilosouza-dev}' --password-stdin >/dev/null"
    if remote "docker compose -f infra/compose/docker-compose.yml ps -q db | grep -q ."; then
        remote "bash infra/scripts/deploy.sh --image '$image'"
    else
        set_env "$target" "$envf" APP_IMAGE "$image"
        remote "docker compose -f infra/compose/docker-compose.yml pull --quiet && docker compose -f infra/compose/docker-compose.yml up -d"
        remote "bash infra/scripts/migrate.sh"
        for s in auth rest storage realtime api-gw app; do remote "bash -c '. infra/scripts/lib.sh; wait_healthy $s 300'"; done
        remote "bash infra/scripts/smoke.sh"
    fi
    remote "docker logout ghcr.io >/dev/null 2>&1 || true"

    log "Tick de jobs no Vault (pg_cron -> POST /api/jobs/tick)"
    tick_token=$(get_env "$target" "$envf" JOBS_TICK_TOKEN); mask "$tick_token"
    remote "docker compose -f infra/compose/docker-compose.yml exec -T db psql -U postgres -v ON_ERROR_STOP=1 -q" <<SQL
select vault.create_secret('http://app:3000/api/jobs/tick', 'jobs_tick_url', 'URL do tick') where not exists (select 1 from vault.secrets where name = 'jobs_tick_url');
select vault.create_secret('$tick_token', 'jobs_tick_token', 'Token do tick') where not exists (select 1 from vault.secrets where name = 'jobs_tick_token');
SQL

    log "Backup: repositorio restic no Storage Box, timer diario e primeiro backup"
    remote "bash infra/scripts/backup.sh --init"
    backup_recovery_key "$target" membros
    remote "sudo bash infra/scripts/backup.sh --install-timer >/dev/null && sudo systemctl start bunker707-backup.service"
    remote "cat /var/backups/bunker707/ultimo-sucesso 2>/dev/null || true"
    remote "sudo journalctl -u bunker707-backup -n 5 --no-pager"
    echo
    echo "App no ar: https://$APP_DOMAIN (versao sha-$commit). Supabase: https://$API_DOMAIN. Studio: https://$STUDIO_DOMAIN (so STUDIO_ALLOWED_IPS)."
    echo "Falta: secrets-membros (chave do Resend) e equipe (contas da equipe)."
elif [ "$role" = "meet" ]; then
    envf="$REMOTE_DIR/infra/jitsi/.env"
    jitsi_compose="docker compose -f infra/jitsi/docker-compose.yml --profile borda"
    if ! remote "test -f infra/jitsi/.env"; then
        log "Gerando segredos e enderecos no servidor (infra/jitsi/.env)"
        remote "sh infra/jitsi/generate-secrets.sh --domain '$MEET_DOMAIN' --email '$PRODUCER_EMAIL' --app-origin 'https://$APP_DOMAIN'"
    fi
    # O JVB esta atras do NAT do Docker: anuncia o IPv4 publico do servidor.
    set_env "$target" "$envf" JVB_ADVERTISE_IPS "$ip"
    jvb_port=$(get_env "$target" "$envf" JVB_PORT); jvb_port="${jvb_port:-10000}"
    log "Pastas dos volumes (uid 1000) e portas no ufw: UDP $jvb_port (midia) e TCP 5222 (so o Jibri; o firewall da Hetzner limita a origem)"
    remote "bash infra/jitsi/scripts/volumes.sh"
    remote "sudo ufw route allow proto udp from any to any port $jvb_port comment 'JVB midia' >/dev/null && sudo ufw route allow proto tcp from any to any port 5222 comment 'XMPP so do Jibri' >/dev/null"
    if remote "$jitsi_compose ps -q web 2>/dev/null | grep -q ."; then
        # Stack ja no ar: recriar containers (imagem ou configuracao nova) derruba quem esta na sala.
        [ "${SEM_LIVE_2H:-}" = "sim" ] || die "O Jitsi ja esta no ar em $server. Um novo deploy-meet recria containers e derruba a sala: confirme que nao ha live nas proximas 2 h com SEM_LIVE_2H=sim nas opcoes (docs/20 §8B.6)."
        log "Atualizando o stack (tag do .env.example do commit, se mudou) e a configuracao"
        remote "SEM_LIVE_2H=sim bash infra/jitsi/scripts/update.sh --server"
        remote "$jitsi_compose up -d && bash -c '. infra/jitsi/scripts/_env.sh; reconnect_focus'"
    else
        log "Primeira subida do stack do Jitsi (imagens, compose up)"
        remote "$jitsi_compose pull --quiet && $jitsi_compose up -d"
    fi
    for s in prosody jicofo jvb web; do remote "bash -c '. infra/jitsi/scripts/_env.sh; wait_healthy $s 300'"; done
    remote "bash infra/jitsi/scripts/smoke.sh"
    echo
    echo "Jitsi no ar: https://$MEET_DOMAIN (commit $commit). Sem marca do Jitsi; ninguem entra sem o JWT do app."
    echo "Falta: secrets-meet com JWT_APP_SECRET e secrets-membros com o MESMO valor em WEBINAR_JWT_SECRET (docs/20 §8B.3); depois status-meet e o botao Testar sala."
else
    envf="$REMOTE_DIR/infra/mautic/.env"
    extra=""; [ -n "${SKIP_MARKETING:-}" ] && extra="BUNKER707_COMPOSE_OVERRIDE=$REMOTE_DIR/infra/mautic/compose.colocado.yml"
    if ! remote "test -f infra/mautic/.env"; then
        log "Gerando segredos e enderecos no servidor (infra/mautic/.env)"
        remote "sh infra/mautic/generate-secrets.sh --domain '$MAUTIC_DOMAIN' --email '$PRODUCER_EMAIL' --admin-ips '$(cidr_or_empty "${PRODUCER_IP:-127.0.0.1}")'"
    fi
    [ -n "$sb_user" ] && { set_env "$target" "$envf" STORAGE_BOX_USER "$sb_user"; set_env "$target" "$envf" STORAGE_BOX_HOST "$sb_host"; }
    fix_restic_path "$envf"
    log "Stack do Mautic: imagens, compose up, instalacao, smoke"
    if [ -n "${SKIP_MARKETING:-}" ]; then
        remote "docker compose -f infra/mautic/docker-compose.yml -f infra/mautic/compose.colocado.yml pull --quiet && docker compose -f infra/mautic/docker-compose.yml -f infra/mautic/compose.colocado.yml up -d && docker compose -f infra/compose/docker-compose.yml up -d caddy"
    else
        remote "docker compose -f infra/mautic/docker-compose.yml --profile borda pull --quiet && docker compose -f infra/mautic/docker-compose.yml --profile borda up -d"
    fi
    remote "$extra bash infra/mautic/scripts/install.sh"
    # O crontab so e instalado na partida do mautic-cron: recarregar pega mudancas em cron/mautic.
    remote "docker compose -f infra/mautic/docker-compose.yml ${SKIP_MARKETING:+-f infra/mautic/compose.colocado.yml} exec -T mautic-cron crontab -u www-data /opt/mautic/cron/mautic" || warn "crontab do Mautic nao recarregado"
    remote "$extra bash infra/mautic/scripts/smoke.sh"
    log "Backup do Mautic: repositorio restic, timer e primeiro backup"
    remote "$extra bash infra/mautic/scripts/backup.sh --init"
    backup_recovery_key "$target" marketing
    remote "sudo $extra bash infra/mautic/scripts/backup.sh --install-timer >/dev/null && sudo systemctl start bunker707-mautic-backup.service"
    remote "sudo journalctl -u bunker707-mautic-backup -n 5 --no-pager"
    echo
    echo "Mautic no ar: https://$MAUTIC_DOMAIN/s/login (usuario bunker707; senha MAUTIC_ADMIN_PASSWORD no .env do servidor)."
    echo "Falta: secrets-marketing (MAUTIC_MAILER_DSN com a chave do Resend)."
fi

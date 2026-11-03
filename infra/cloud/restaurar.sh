#!/usr/bin/env bash
# Recria a producao a partir do snapshot mais recente de cada papel (snapshot.sh) e refaz o DNS.
#   bash infra/cloud/restaurar.sh
# Papeis: membros (A), marketing (B) e meet (C, Jitsi); PAPEIS="meet" traz so os pedidos (ex.: um teste de live na
# dev). Papel sem snapshot e pulado; servidor que ja existe nao e tocado.
# Tipo: o mesmo do servidor de origem (label tipo do snapshot); MEMBROS_TYPE, MARKETING_TYPE ou MEET_TYPE nas opcoes
# forcam outro. Sem estoque do tipo em nenhum local, para e avisa: nunca sobe sozinho num tipo mais caro (e um disco
# maior nao volta mais para o tipo pequeno, porque o snapshot so cabe num disco do mesmo tamanho ou maior).
# O servidor volta com tudo (banco, .env, certificados, chave de transferencia); so o IP muda: os registros DNS do
# papel sao refeitos, os stacks sobem e o smoke roda; no C, o JVB passa a anunciar o IP novo.
# Cobrado por hora a partir da criacao. Depois: status (e status-meet); se a main andou desde o snapshot,
# deploy-membros (e deploy-meet com SEM_LIVE_2H=sim). Para guardar de novo: snapshot com CONFIRMAR=apagar.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/lib.sh"
need HCLOUD_TOKEN CLOUDFLARE_API_TOKEN
roles=$(guard_roles)
install_hcloud; deploy_key

forced_type() {  # forced_type PAPEL -> tipo pedido nas opcoes (vazio = o do snapshot)
    case "$1" in
        membros) printf '%s' "${MEMBROS_TYPE:-}" ;;
        marketing) printf '%s' "${MARKETING_TYPE:-}" ;;
        meet) printf '%s' "${MEET_TYPE_FORCED:-}" ;;
    esac
}
# Os stacks de cada papel: sobem de novo (os containers voltam sozinhos no boot; o `up -d` garante), esperam a
# saude e rodam o smoke, como no deploy. Chamada dentro de um `if`, onde o bash ignora o `set -e`: cada passo
# devolve a falha com `|| return 1`.
bring_up() {  # bring_up PAPEL user@host IP
    local role="$1" target="$2" ip="$3" s
    case "$role" in
        membros)
            on_server "$target" "docker compose -f infra/compose/docker-compose.yml up -d" || return 1
            for s in auth rest storage realtime api-gw app; do on_server "$target" "bash -c '. infra/scripts/lib.sh; wait_healthy $s 300'" || return 1; done
            on_server "$target" "bash infra/scripts/smoke.sh" || return 1 ;;
        marketing)
            on_server "$target" "docker compose -f infra/mautic/docker-compose.yml --profile borda up -d" || return 1
            on_server "$target" "bash infra/mautic/scripts/smoke.sh" || return 1 ;;
        meet)
            # O JVB esta atras do NAT do Docker e anuncia o IPv4 publico: o do servidor novo (o .env veio com o antigo).
            set_env "$target" "$REMOTE_DIR/infra/jitsi/.env" JVB_ADVERTISE_IPS "$ip" || return 1
            on_server "$target" "docker compose -f infra/jitsi/docker-compose.yml --profile borda up -d && bash -c '. infra/jitsi/scripts/_env.sh; reconnect_focus'" || return 1
            for s in prosody jicofo jvb web; do on_server "$target" "bash -c '. infra/jitsi/scripts/_env.sh; wait_healthy $s 300'" || return 1; done
            on_server "$target" "bash infra/jitsi/scripts/smoke.sh" || return 1 ;;
    esac
}
on_server() { rsh "$1" "cd '$REMOTE_DIR' && $2"; }  # on_server user@host COMANDO

head_commit=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || true)
restored=""; failed=""
for role in $roles; do
    name=$(role_server "$role")
    log "Servidor $name"
    if server_exists "$name"; then echo "  ja existe; nada a restaurar."; continue; fi
    img=$(latest_snapshot "$role")
    if [ -z "$img" ]; then echo "  nenhum snapshot do papel $role; pulando (sem snapshot, o caminho e provision + deploy)."; continue; fi
    meta=$(hzj image describe "$img")
    disk=$(printf '%s' "$meta" | jq -r '.disk_size // 0')
    type=$(forced_type "$role")
    [ -n "$type" ] || type=$(printf '%s' "$meta" | jq -r '.labels.tipo // empty')
    [ -n "$type" ] || die "O snapshot $img nao diz o tipo de origem (label tipo). Informe o tipo nas opcoes (ex.: MEMBROS_TYPE=cx23)."
    type_disk=$(hzj server-type describe "$type" | jq -r '.disk // 0')
    awk -v a="$type_disk" -v b="$disk" 'BEGIN { exit !(a + 0 >= b + 0) }' \
        || die "O $type tem disco de $type_disk GB e o snapshot $img precisa de $disk GB: escolha um tipo com disco maior."
    loc=$(printf '%s' "$meta" | jq -r '.labels.local // empty'); loc="${loc:-$LOCATION}"
    locs="$loc"; for l in $LOCATION $FALLBACK_LOCATIONS; do case " $locs " in *" $l "*) ;; *) locs="$locs $l" ;; esac; done
    echo "  snapshot $img: $(printf '%s' "$meta" | jq -r '.description'), disco de $disk GB; volta como $type"
    p=$(monthly_price "$type" "$loc"); [ -n "$p" ] && echo "  preco: EUR $p/mes sem IVA (+ IPv4), cobrado por hora enquanto o servidor existir"
    fw_ensure "$name"
    created=0
    for l in $locs; do
        echo "  criando $name ($type) em $l a partir do snapshot..."
        if hz server create --name "$name" --type "$type" --image "$img" --location "$l" --ssh-key "$SSH_KEY_NAME" \
            --firewall "$(fw_name "$name")" --label app=bunker707 --label papel="$role" >/dev/null 2>"$WORK_DIR/restore-$name.err"; then created=1; break; fi
        grep -qiE 'unavailable|not available|resource_limit|capacity' "$WORK_DIR/restore-$name.err" || { cat "$WORK_DIR/restore-$name.err" >&2; die "Falha ao criar $name."; }
        warn "$type indisponivel em $l"
    done
    [ "$created" = "1" ] || die "Sem estoque de $type em $locs. Nada mais caro foi criado: tente de novo mais tarde, ou force outro tipo (MEMBROS_TYPE, MARKETING_TYPE ou MEET_TYPE) com o ok do produtor; um disco maior nao volta mais para o $type."
    fw_apply "$name"
    ip=$(server_ip4 "$name"); target="$DEPLOY_USER@$ip"
    log "DNS de $role -> $ip"
    case "$role" in
        membros) cf_apply_dns_membros ;;
        marketing) cf_apply_dns_marketing ;;
        meet) cf_apply_dns_meet ;;
    esac
    log "Stack de $role no $name"
    fw_open_ssh "$name"; wait_ssh "$target"
    if bring_up "$role" "$target" "$ip"; then restored="$restored $role"; else failed="$failed $role"; warn "o $role voltou, mas a subida ou o smoke falhou (veja acima)."; fi
    rsh "$target" "docker ps --format '  {{.Names}}\t{{.Status}}' | head -n 25" || true
    srv_commit=$(rsh "$target" "cat '$REMOTE_DIR/.deployed-commit' 2>/dev/null" || true)
    fw_close_all
    if [ -n "$srv_commit" ]; then
        echo "  commit no servidor: ${srv_commit:0:7}"
        if [ -n "$head_commit" ] && [ "$srv_commit" != "$head_commit" ]; then
            case "$role" in
                membros) echo "  este checkout esta em ${head_commit:0:7}: se a main andou, rode deploy-membros da main." ;;
                meet) echo "  este checkout esta em ${head_commit:0:7}: se o Jitsi mudou, rode deploy-meet com SEM_LIVE_2H=sim." ;;
            esac
        fi
    fi
done

if case " $restored $failed " in *" membros "*|*" marketing "*) true ;; *) false ;; esac; then
    log "TLS da zona"
    cf_zone_tls
fi
[ -z "$failed" ] || die "Voltaram, mas com falha na subida ou no smoke:$failed. Os servidores existem (cobrados por hora): confira com status-ssh/status-meet."
log "Pronto:${restored:- nada a restaurar}. Os dados vieram no snapshot; confira com status (e status-meet)."

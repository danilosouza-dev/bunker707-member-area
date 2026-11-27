#!/usr/bin/env bash
# Provedor netcup + Vultr + Cloudflare R2 (docs/20 §8D; docs/21 §11). Carregado pelo lib.sh no fim, so com
# PROVEDOR=netcup (variavel do repositorio no GitHub ou opcao da etapa). Troca as funcoes que falavam com a API da
# Hetzner pelas destes provedores e deixa todo o resto (deploy, segredos, exec, backup, DNS, smoke) como esta:
#   - os tres servidores fixos (membros, meet, marketing) sao VPS da netcup, contratados por mes e criados no painel
#     dela; o fluxo nao cria nem apaga servidor fixo. O IP de cada um vem de NETCUP_MEMBROS_IP, NETCUP_MEET_IP e
#     NETCUP_MARKETING_IP (variaveis do repositorio). Sem firewall na nuvem: o ufw de cada servidor e o firewall, e a
#     22 fica aberta so para chave (sem senha, com fail2ban).
#   - o gravador por hora e uma maquina da Vultr criada e apagada pela API. A chave da API (VULTR_API_KEY) so aceita
#     pedidos do IP do servidor da sala (a lista de IPs da propria Vultr): cada chamada sai do runner pelo SSH do
#     servidor C, com a chave pela entrada do SSH (nunca em argv nem no disco do servidor).
#   - o backup (restic) vai para o bucket do Cloudflare R2 (R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID,
#     R2_SECRET_ACCESS_KEY), gravado no .env de cada servidor pelo deploy.
# Nunca imprime segredo.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash (este arquivo e carregado pelo lib.sh, que ja e bash).
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

NETCUP_MEMBROS_IP="${NETCUP_MEMBROS_IP:-}"
NETCUP_MEET_IP="${NETCUP_MEET_IP:-}"
NETCUP_MARKETING_IP="${NETCUP_MARKETING_IP:-}"
# Os planos do gravador, na ordem: 8 vCPU e 16 GB (o mesmo porte do cpx42 da Hetzner, 1080p a 30 quadros, docs/30 D26);
# os locais, perto do servidor C em Manassas (EUA leste). Precos lidos da API publica da Vultr na hora.
VULTR_PLANOS="${VULTR_PLANOS:-vhp-8c-16gb-amd vhp-8c-16gb-intel vc2-6c-16gb}"
VULTR_REGIOES="${VULTR_REGIOES:-ewr atl}"
# Ubuntu 24.04 LTS x64 (GET https://api.vultr.com/v2/os, conferido em 26/11/2026).
VULTR_OS_ID="${VULTR_OS_ID:-2284}"
R2_ACCOUNT_ID="${R2_ACCOUNT_ID:-}"
R2_BUCKET="${R2_BUCKET:-bunker707-backups}"

# ---- servidores fixos (IPs das variaveis) ----------------------------------------------------------
netcup_ip_do() {  # netcup_ip_do NOME -> IP da variavel (vazio se o nome nao e de um servidor fixo)
    case "$1" in
        "$MEMBROS_NAME") printf '%s' "$NETCUP_MEMBROS_IP" ;;
        "$MEET_NAME") printf '%s' "$NETCUP_MEET_IP" ;;
        "$MARKETING_NAME") printf '%s' "$NETCUP_MARKETING_IP" ;;
    esac
}
netcup_var_do() {
    case "$1" in
        "$MEMBROS_NAME") printf 'NETCUP_MEMBROS_IP' ;;
        "$MEET_NAME") printf 'NETCUP_MEET_IP' ;;
        "$MARKETING_NAME") printf 'NETCUP_MARKETING_IP' ;;
        *) printf '?' ;;
    esac
}
# So um IPv4 de verdade entra em comando remoto, regra de firewall ou DNS.
ipv4_valido() { printf '%s' "$1" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$' && [ "$1" != "0.0.0.0" ]; }
for _v in NETCUP_MEMBROS_IP NETCUP_MEET_IP NETCUP_MARKETING_IP; do
    [ -z "${!_v}" ] || ipv4_valido "${!_v}" || die "$_v nao e um IPv4: ${!_v}"
done
unset _v
e_gravador() { case "$1" in "$JIBRI_NAME_PREFIX"*) return 0 ;; *) return 1 ;; esac; }

install_hcloud() { :; }
ensure_project_ssh_key() { echo "  netcup: a chave entra pelo painel da netcup na instalacao do Ubuntu (etapa chave-ssh)."; }
storage_box_json() { :; }
latest_snapshot() { :; }
so_na_hetzner() { die "A etapa $1 e so da Hetzner (snapshot, tipos e precos da API dela). Com PROVEDOR=netcup os servidores fixos sao contratados por mes no painel da netcup (docs/20 §8D)."; }

server_exists() {
    if e_gravador "$1"; then [ -n "$(vultr_instancia "$1")" ]; return; fi
    [ -n "$(netcup_ip_do "$1")" ]
}
server_status() {
    if e_gravador "$1"; then vultr_instancia "$1" | jq -r '.status // empty'; return; fi
    [ -n "$(netcup_ip_do "$1")" ] && printf 'running'
}
server_ip4() {
    local ip
    if e_gravador "$1"; then
        ip=$(vultr_instancia "$1" | jq -r '.main_ip // empty')
        ipv4_valido "$ip" || die "O gravador $1 ainda nao tem IPv4 na Vultr."
        printf '%s' "$ip"; return
    fi
    ip=$(netcup_ip_do "$1")
    [ -n "$ip" ] || die "Sem o IP de $1: grave a variavel $(netcup_var_do "$1") no repositorio (Settings > Secrets and variables > Actions > Variables; docs/20 §8D)."
    printf '%s' "$ip"
}
# Sem IPv6 nos registros: o DNS apaga o AAAA antigo (o da Hetzner) em vez de deixar um endereco morto.
server_ip6() { :; }

# ---- firewall: o ufw de cada servidor -------------------------------------------------------------
# Nada abre nem fecha a 22 por etapa (ela fica aberta so para chave). O trap continua armado: o on_failure do jibri.sh
# (apagar o gravador que nao ficou pronto) precisa dele.
fw_ensure() {
    [ "$1" = "$MEET_NAME" ] || return 0
    netcup_meet_5222
}
fw_apply() { :; }
fw_open_ssh() {
    FW_OPENED="${FW_OPENED:-} $1"
    trap 'rc=$?; set +e; fw_close_all || rc=1; if [ "$rc" != 0 ] && declare -F on_failure >/dev/null; then on_failure; fi; exit $rc' EXIT
}
fw_close_all() { FW_OPENED=""; return 0; }
# A 5222 (XMPP) do servidor C so para os gravadores vivos: as regras do ufw com o comentario "XMPP so do Jibri" sao
# refeitas a partir da lista da Vultr (a regra "de qualquer lugar" de antes some junto).
netcup_meet_5222() {
    local ip target cidrs c lista=""
    ip=$(server_ip4 "$MEET_NAME"); target="$DEPLOY_USER@$ip"
    cidrs=$(jibri_cidrs)
    for c in $cidrs; do
        ipv4_valido "${c%/32}" && lista="$lista ${c%/32}"
    done
    wait_ssh "$target" 10
    rsh "$target" "for n in \$(sudo ufw status numbered | grep 'XMPP so do Jibri' | sed -E 's/^\\[ *([0-9]+)\\].*/\\1/' | sort -rn); do sudo ufw --force delete \"\$n\" >/dev/null; done; for c in$lista; do sudo ufw route allow proto tcp from \"\$c\" to any port 5222 comment 'XMPP so do Jibri' >/dev/null; done; echo \"  5222 do $MEET_NAME: \$(sudo ufw status | grep -c 'XMPP so do Jibri') regra(s) (gravadores:${lista:- nenhum})\""
}
# Membros e Mautic ficam atras do proxy da Cloudflare: 80 e 443 so das faixas dela (sem o firewall da Hetzner, o ufw e
# quem barra o acesso direto ao IP). O servidor C (DNS puro, WebRTC) fica com 80 e 443 de qualquer lugar.
netcup_ufw_so_cloudflare() {  # netcup_ufw_so_cloudflare root@IP
    local cf; cf=$(bash "$REPO_ROOT/infra/scripts/cloudflare-ips.sh" | tr '\n' ' ')
    [ -n "$cf" ] || die "Lista de IPs da Cloudflare vazia."
    rsh "$1" "set -e; for r in '80/tcp' '443/tcp' '443/udp'; do ufw delete allow \$r >/dev/null 2>&1 || true; done; for p in 'tcp 80' 'tcp 443' 'udp 443'; do set -- \$p; ufw delete route allow proto \$1 from any to any port \$2 >/dev/null 2>&1 || true; done; for c in $cf; do ufw allow proto tcp from \"\$c\" to any port 80,443 comment 'Cloudflare' >/dev/null; ufw allow proto udp from \"\$c\" to any port 443 comment 'Cloudflare' >/dev/null; ufw route allow proto tcp from \"\$c\" to any port 80,443 comment 'Caddy pela Cloudflare' >/dev/null; ufw route allow proto udp from \"\$c\" to any port 443 comment 'Caddy pela Cloudflare' >/dev/null; done; ufw reload >/dev/null; echo \"  ufw: 80/443 so da Cloudflare (\$(ufw status | grep -c 'Cloudflare') regras)\""
}

# ---- Vultr (gravador por hora) ---------------------------------------------------------------------
# vultr_api METODO CAMINHO [JSON]: chama https://api.vultr.com/v2<CAMINHO> a partir do servidor C (o unico IP na lista da
# chave). A chave vai pela entrada do SSH num config do curl (-K -), o corpo do pedido em base64 no comando. A resposta
# fica em $WORK_DIR/vultr-resposta; o codigo HTTP em $WORK_DIR/vultr-codigo. Volta 0 so com 2xx.
vultr_api() {
    local method="$1" path="$2" data="${3:-}" target b64="" out code
    need VULTR_API_KEY
    target="$DEPLOY_USER@$(server_ip4 "$MEET_NAME")"
    case "$path" in /*) ;; *) die "vultr_api: caminho invalido: $path" ;; esac
    printf '%s' "$path" | grep -qE "^[A-Za-z0-9/_?=&.-]+\$" || die "vultr_api: caminho invalido: $path"
    [ -z "$data" ] || b64=$(printf '%s' "$data" | base64 | tr -d '\n')
    wait_ssh "$target" 10
    out=$(printf 'header = "Authorization: Bearer %s"\n' "$VULTR_API_KEY" | rsh "$target" "c=\$(mktemp); trap 'rm -f \"\$c\"' EXIT; code=\$(curl -sS --max-time 60 -K - -X '$method' -H 'Content-Type: application/json' ${b64:+--data-binary \"\$(printf %s '$b64' | base64 -d)\"} -o \"\$c\" -w '%{http_code}' 'https://api.vultr.com/v2$path' 2>/dev/null) || code=000; cat \"\$c\"; printf '\\n%s' \"\$code\"") || out=$'\n000'
    code=$(printf '%s' "$out" | tail -n1)
    printf '%s' "$out" | sed '$d' > "$WORK_DIR/vultr-resposta"
    printf '%s' "$code" > "$WORK_DIR/vultr-codigo"
    case "$code" in 2*) return 0 ;; *) return 1 ;; esac
}
vultr_erro() { printf 'HTTP %s: %s' "$(cat "$WORK_DIR/vultr-codigo" 2>/dev/null)" "$(jq -r '.error // empty' "$WORK_DIR/vultr-resposta" 2>/dev/null | tr -d '\n' | cut -c1-200)"; }
vultr_gravadores_json() {  # as instancias cujo rotulo comeca com o prefixo do gravador (JSON, uma lista)
    vultr_api GET "/instances?per_page=500" || die "Vultr: nao li as instancias ($(vultr_erro)). A chave da API aceita o IP do servidor C ($MEET_NAME)? (docs/20 §8D)"
    jq -c --arg p "$JIBRI_NAME_PREFIX" '[.instances[]? | select((.label // "") | startswith($p))]' "$WORK_DIR/vultr-resposta"
}
vultr_instancia() {  # vultr_instancia NOME -> o objeto da instancia (vazio se nao existe)
    vultr_gravadores_json | jq -c --arg l "$1" '[.[] | select(.label == $l)][0] // empty'
}
jibri_cidrs() {
    if [ -z "${JIBRI_CIDRS_CACHE+x}" ]; then
        JIBRI_CIDRS_CACHE=$(vultr_gravadores_json | jq -r '.[] | .main_ip // empty | select(. != "0.0.0.0") | . + "/32"' | tr '\n' ' ') || JIBRI_CIDRS_CACHE=""
        export JIBRI_CIDRS_CACHE
    fi
    printf '%s' "$JIBRI_CIDRS_CACHE"
}
gravador_nomes() { vultr_gravadores_json | jq -r '.[].label'; }
gravador_campo() {  # gravador_campo NOME tipo|local|criado|status
    local q
    case "$2" in tipo) q='.plan' ;; local) q='.region' ;; criado) q='.date_created' ;; status) q='.status' ;; *) die "gravador_campo: $2" ;; esac
    vultr_instancia "$1" | jq -r "$q // empty"
}
# gravador_criar NOME USER_DATA: tenta os planos e os locais na ordem; GRAVADOR_TIPO e GRAVADOR_LOCAL com o que nasceu.
# Volta 1 sem estoque (ou limite da conta) em todos; outra recusa da API para tudo.
gravador_criar() {
    local name="$1" ud64 p r body
    ud64=$(base64 < "$2" | tr -d '\n')
    for p in $VULTR_PLANOS; do
        for r in $VULTR_REGIOES; do
            echo "  criando $name ($p) em $r na Vultr..."
            body=$(jq -nc --arg r "$r" --arg p "$p" --arg l "$name" --arg ud "$ud64" --argjson os "$VULTR_OS_ID" \
                '{region:$r, plan:$p, os_id:$os, label:$l, hostname:$l, user_data:$ud, backups:"disabled", enable_ipv6:false, tags:["bunker707","papel-jibri"]}')
            if vultr_api POST /instances "$body"; then
                GRAVADOR_TIPO="$p"; GRAVADOR_LOCAL="$r"; return 0
            fi
            if grep -qiE 'not available|unavailable|out of stock|capacity|insufficient|limit|not valid' "$WORK_DIR/vultr-resposta"; then
                warn "$p indisponivel em $r: $(vultr_erro)"
                continue
            fi
            die "Falha ao criar $name na Vultr: $(vultr_erro)"
        done
    done
    return 1
}
# gravador_ligar NOME: a Vultr liga sozinha; espera o IPv4 e o estado active (ate uns 5 min).
gravador_ligar() {
    local i inst st ip
    for i in $(seq 60); do
        inst=$(vultr_instancia "$1"); st=$(printf '%s' "$inst" | jq -r '.status // empty'); ip=$(printf '%s' "$inst" | jq -r '.main_ip // empty')
        if [ "$st" = "active" ] && ipv4_valido "$ip"; then return 0; fi
        sleep "${VULTR_ESPERA:-5}"
    done
    die "O gravador $1 nao ficou ativo na Vultr em 5 min (status ${st:-?})."
}
gravador_apagar() {
    local id; id=$(vultr_instancia "$1" | jq -r '.id // empty')
    [ -n "$id" ] || return 0
    printf '%s' "$id" | grep -qE '^[a-f0-9-]{8,64}$' || die "id da Vultr invalido: $id"
    vultr_api DELETE "/instances/$id" || return 1
}
# Preco por hora do plano (USD), da lista publica de planos da Vultr (sem chave).
hourly_price() {
    curl -fsS --max-time 20 "https://api.vultr.com/v2/plans?per_page=500" 2>/dev/null \
        | jq -r --arg p "$1" '.plans[]? | select(.id == $p) | (.hourly_cost // ((.monthly_cost // 0) / 672)) ' 2>/dev/null | head -n1
}
monthly_price() { :; }
PRECO_MOEDA="USD"

# ---- backup no Cloudflare R2 -----------------------------------------------------------------------
# netcup_backup_r2 user@host ENV_FILE PASTA: o restic do papel aponta para s3:<conta>.r2.cloudflarestorage.com/<bucket>/<PASTA>
# com as chaves do token do R2 (Leitura/gravacao para objeto, so no bucket). O restic le AWS_* do ambiente (backup.sh).
netcup_backup_r2() {
    local target="$1" envf="$2" pasta="$3"
    need R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
    printf '%s' "$R2_ACCOUNT_ID" | grep -qE '^[a-f0-9]{32}$' || die "R2_ACCOUNT_ID invalido."
    printf '%s' "$R2_BUCKET" | grep -qE '^[a-z0-9][a-z0-9-]{2,62}$' || die "R2_BUCKET invalido."
    mask "$R2_SECRET_ACCESS_KEY"
    set_env "$target" "$envf" RESTIC_REPOSITORY "s3:https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com/$R2_BUCKET/$pasta"
    set_env "$target" "$envf" AWS_ACCESS_KEY_ID "$R2_ACCESS_KEY_ID"
    set_env "$target" "$envf" AWS_SECRET_ACCESS_KEY "$R2_SECRET_ACCESS_KEY"
    echo "  backup: restic no R2 ($R2_BUCKET/$pasta)"
}

# ---- status ------------------------------------------------------------------------------------------
netcup_status() {
    local name ip
    log "Servidores fixos (netcup)"
    for name in "$MEMBROS_NAME" "$MEET_NAME" "$MARKETING_NAME"; do
        ip=$(netcup_ip_do "$name")
        if [ -z "$ip" ]; then echo "  $name: sem IP ($(netcup_var_do "$name") vazio)"; continue; fi
        if ssh "${SSH_OPTS[@]}" -o ConnectTimeout=8 "$DEPLOY_USER@$ip" true 2>/dev/null; then
            echo "  $name: $ip, SSH ok, $(rsh "$DEPLOY_USER@$ip" "uptime -p; df -h / | awk 'NR==2 {print \"disco \" \$5}'; docker ps -q | wc -l | sed 's/\$/ containers/'" 2>/dev/null | tr '\n' ' ')"
        else
            echo "  $name: $ip, SSH nao respondeu"
        fi
    done
    log "Respostas publicas"
    for u in "https://$APP_DOMAIN/api/health" "https://$MEET_DOMAIN/" "https://$MAUTIC_DOMAIN/s/login"; do
        printf '  %-48s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$u" 2>/dev/null || echo 000)"
    done
    if [ -n "${VULTR_API_KEY:-}" ] && [ -n "$NETCUP_MEET_IP" ]; then
        log "Gravadores (Vultr)"
        vultr_gravadores_json | jq -r 'if length == 0 then "  nenhum ligado." else .[] | "  \(.label): \(.plan) em \(.region), \(.main_ip), \(.status), criado \(.date_created)" end'
    fi
}

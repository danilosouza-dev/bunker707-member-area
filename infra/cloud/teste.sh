#!/usr/bin/env bash
# O ensaio de comprador real (docs/32 item 13 e §12, fase 1; docs/20 §9E): um servidor novo e vazio na Hetzner,
# bunker707-teste, separado da nossa producao, em que o Bunker Members e instalado do zero como um comprador instalaria
# (o pacote da escola, o instalador de um comando, a Licenca). Com tudo funcionando, o ensaio acaba e o servidor e
# apagado, para nao ficar pagando. Cada acao e uma etapa do workflow Infra (Hetzner), TODA so da main:
#   bash infra/cloud/teste.sh plano      teste-plano: o tipo e o local mais baratos que servem ao kit (x86, 2 vCPU, 4 GB,
#                                        40 GB) e o preco por hora e por mes. Nao cria nada
#   bash infra/cloud/teste.sh criar      teste-criar: o servidor (CONFIRMADO=sim; TESTE_PRECO_MAX para se o preco do dia
#                                        passou do aprovado): Ubuntu 24.04 vazio, sem nada nosso alem da chave de deploy
#                                        no root (como o comprador entra com a dele) e um firewall proprio
#   bash infra/cloud/teste.sh dns        teste-dns: escola-teste.<zona> e api.escola-teste.<zona> -> o servidor, so A,
#                                        sem o proxy da Cloudflare (o kit tira o certificado direto)
#   bash infra/cloud/teste.sh instalar   teste-instalar: o pacote da escola (o artefato do workflow pacote-escola) aberto
#                                        no servidor e o instalador com um arquivo de respostas montado aqui; a Chave de
#                                        ativacao vem no payload (mascarada; nunca no log); a chave do Resend, do segredo
#                                        LICENCAS_RESEND_CHAVE ou a do Emissor, servidor a servidor, pela entrada do SSH
#   bash infra/cloud/teste.sh apagar     teste-apagar: o servidor (so com a marca papel=teste), o firewall e o DNS
#                                        (CONFIRMAR=apagar)
# Nunca imprime segredo, nem o e-mail do dono. Rodou com `sh` (dash no Ubuntu)? Volta para o bash.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/lib.sh"
acao="${1:-}"
case "$acao" in plano|criar|dns|instalar|apagar) ;; *) die "uso: teste.sh plano|criar|dns|instalar|apagar" ;; esac
# A segunda trava da main (a primeira e a do workflow, passo "Ensaio so da main"), para o script chamado de outro lugar
# no Actions. Fora do Actions (terminal com os tokens), nao ha branch a conferir.
[ -z "${GITHUB_ACTIONS:-}" ] || [ "${GITHUB_REF:-}" = "refs/heads/main" ] \
    || die "As etapas do ensaio de comprador so rodam da main (recebido: ${GITHUB_REF:-sem branch})."

teste_alvo() {  # define ip e target (o root do servidor do ensaio), ou para
    server_exists "$TESTE_NAME" || die "O servidor $TESTE_NAME nao existe: rode teste-plano e, com o ok do produtor no chat, teste-criar com CONFIRMADO=sim (docs/20 §9E)."
    ip=$(server_ip4 "$TESTE_NAME"); target="root@$ip"
}

# ====== teste-plano =====================================================================================
plano() {
    need HCLOUD_TOKEN
    install_hcloud
    hzj server-type list > "$WORK_DIR/server-types.json"
    plano_barato teste TESTE "a escola do ensaio (o minimo do kit, so x86)" "$TESTE_MIN_RAM_GB" "$TESTE_MIN_DISK_GB" "$TESTE_MIN_VCPU" \
        "$TESTE_ARQUITETURAS" "${TESTE_LOCAIS:-}" "${TESTE_TYPE:-}" "${TESTE_LOCATION:-}"
    echo "IPv4: um (o kit e a conferencia da Licenca falam IPv4): cerca de EUR 0,50/mes, tambem por hora."
    echo "O ensaio e cobrado por hora enquanto o servidor existir (ate o teto do mes); teste-apagar o apaga, com o firewall e o DNS."
    echo "Nada foi criado. A criacao e a etapa teste-criar, com CONFIRMADO=sim depois do ok do produtor no chat."
}

# ====== teste-criar =====================================================================================
criar() {
    [ "${CONFIRMADO:-}" = sim ] || die "teste-criar cria o servidor do ensaio, $TESTE_NAME (cobrado por hora enquanto existir, ate o teto do mes). Rode teste-plano, mostre o preco ao produtor e, com o ok dele no chat, confirme com CONFIRMADO=sim (e TESTE_PRECO_MAX com o preco por mes aprovado) nas opcoes (docs/20 §9E)."
    need HCLOUD_TOKEN
    install_hcloud; deploy_key
    local criado="" l p h
    log "1/4 Chave SSH '$SSH_KEY_NAME' no projeto: o root do servidor novo entra com ela, como o comprador entra com a dele"
    ensure_project_ssh_key
    if server_exists "$TESTE_NAME"; then
        log "2/4 Servidor $TESTE_NAME"
        echo "  ja existe: $(hzj server describe "$TESTE_NAME" | jq -r '"\(.server_type.name) em \((.location.name // .datacenter.location.name)), \(.status)"') (nada criado)"
        fw_ensure "$TESTE_NAME"
    else
        log "2/4 Tipo e local: o mais barato que serve ao kit (teste-plano)"
        plano
        # shellcheck disable=SC1091
        . "$WORK_DIR/plan-teste.env"
        if [ -n "${TESTE_PRECO_MAX:-}" ]; then
            awk -v p="$TESTE_PRICE" -v m="$TESTE_PRECO_MAX" 'BEGIN { exit !(p + 0 <= m + 0) }' \
                || die "O mais barato hoje ($TESTE_TYPE em $TESTE_LOCATION, EUR $TESTE_PRICE/mes) passa do TESTE_PRECO_MAX=$TESTE_PRECO_MAX aprovado pelo produtor. Nada foi criado: mostre o preco novo a ele."
        fi
        log "3/4 Servidor $TESTE_NAME ($TESTE_TYPE em $TESTE_LOCATION): Ubuntu 24.04 vazio, sem cloud-init nosso"
        fw_ensure "$TESTE_NAME"
        # Sem estoque na hora: so os outros locais com o mesmo tipo e o mesmo preco que o plano achou (o preco aprovado).
        for l in "$TESTE_LOCATION" $TESTE_FALLBACK_LOCATIONS; do
            echo "  criando $TESTE_NAME ($TESTE_TYPE) em $l..."
            if hz server create --name "$TESTE_NAME" --type "$TESTE_TYPE" --image ubuntu-24.04 --location "$l" --ssh-key "$SSH_KEY_NAME" \
                --firewall "$(fw_name "$TESTE_NAME")" --label app=bunker707 --label papel=teste >/dev/null 2>"$WORK_DIR/create-teste.err"; then
                criado=1; break
            fi
            if grep -qiE 'unavailable|not available|resource_limit|capacity' "$WORK_DIR/create-teste.err"; then
                warn "$TESTE_TYPE indisponivel em $l: $(tr -d '\n' < "$WORK_DIR/create-teste.err" | cut -c1-160)"; continue
            fi
            cat "$WORK_DIR/create-teste.err" >&2
            die "Falha ao criar $TESTE_NAME."
        done
        [ -n "$criado" ] || die "Nenhum local tem $TESTE_TYPE pelo preco aprovado agora. Nada foi criado."
    fi
    fw_apply "$TESTE_NAME"
    hz server poweron "$TESTE_NAME" >/dev/null 2>&1 || true
    log "4/4 O SSH do root responde (a 22 so abre durante as etapas)"
    teste_alvo
    fw_open_ssh "$TESTE_NAME"; wait_ssh "$target"
    rsh "$target" "cloud-init status --wait >/dev/null 2>&1 || true; . /etc/os-release; echo \"  \$PRETTY_NAME, \$(nproc) vCPU, \$(free -m | awk '/^Mem:/{print \$2}') MB de memoria\""
    fw_close_all
    l=$(hzj server describe "$TESTE_NAME" | jq -r '.location.name // .datacenter.location.name')
    p=$(monthly_price "$(hzj server describe "$TESTE_NAME" | jq -r '.server_type.name')" "$l"); h=$(hourly_price "$(hzj server describe "$TESTE_NAME" | jq -r '.server_type.name')" "$l")
    echo
    echo "Servidor do ensaio no ar: $TESTE_NAME, $ip (EUR ${h:-?}/hora, teto de EUR ${p:-?}/mes, sem IVA, mais o IPv4)."
    echo "Proximo: teste-dns; o workflow Pacote da escola, da main, com o endereco $TESTE_DOMAIN; e teste-instalar."
}

# ====== teste-dns =======================================================================================
dns() {
    need HCLOUD_TOKEN CLOUDFLARE_API_TOKEN
    install_hcloud
    teste_alvo
    local nome sub
    log "DNS da escola do ensaio em $ZONE_NAME: so registro A, sem o proxy da Cloudflare (o kit tira o certificado direto)"
    for nome in "$TESTE_DOMAIN" "$TESTE_API_DOMAIN"; do
        sub=$(zona_sub "$nome")
        cf_dns_upsert "$sub" A "$ip" false
        cf_dns_delete "$sub" AAAA
    done
    echo "  $TESTE_DOMAIN e $TESTE_API_DOMAIN -> $ip, sem proxy, sem AAAA."
}

# ====== teste-instalar ==================================================================================
# chave_do_evento: a Chave de ativacao do payload do disparo, lida do arquivo do evento (nunca de uma variavel do
# workflow, que o GitHub mostraria no cabecalho do passo); fora do Actions, de TESTE_CHAVE_ATIVACAO. Quem chama a
# mascara: o ::add-mask:: sai na saida, que o $(...) engoliria.
chave_do_evento() {
    local v=""
    if [ -n "${GITHUB_EVENT_PATH:-}" ] && [ -r "$GITHUB_EVENT_PATH" ]; then
        v=$(jq -r '.inputs.payload // ""' "$GITHUB_EVENT_PATH" 2>/dev/null | tr -d '[:space:]')
    fi
    [ -n "$v" ] || v=$(printf '%s' "${TESTE_CHAVE_ATIVACAO:-}" | tr -d '[:space:]')
    printf '%s' "$v"
}
# pacote_do_artefato: o pacote mais novo da escola do ensaio entre os artefatos do repositorio (o workflow pacote-escola;
# PACOTE_VERSAO escolhe a versao), baixado e conferido pelo sha256 que vem junto. Define pacote_tgz.
pacote_do_artefato() {
    local lista achado id artefato pasta="$WORK_DIR/pacote-escola"
    need GITHUB_REPOSITORY
    lista=$(gh api -H "Accept: application/vnd.github+json" "repos/$GITHUB_REPOSITORY/actions/artifacts?per_page=100" 2>/dev/null) \
        || die "Nao consegui listar os artefatos do repositorio (o job precisa da permissao actions: read)."
    achado=$(printf '%s' "$lista" | jq -r --arg p "pacote-$TESTE_DOMAIN-" --arg v "${PACOTE_VERSAO:-}" \
        '[.artifacts[]? | select((.expired // false) | not) | select(.name | startswith($p)) | select($v == "" or .name == ($p + $v))] | sort_by(.created_at) | last | if . == null then empty else "\(.id) \(.name)" end')
    [ -n "$achado" ] || die "Nao achei o pacote de $TESTE_DOMAIN${PACOTE_VERSAO:+ na versao $PACOTE_VERSAO} entre os artefatos: rode o workflow Pacote da escola, da main, com o endereco $TESTE_DOMAIN (o artefato vale 7 dias)."
    id=${achado%% *}; artefato=${achado#* }
    rm -rf "$pasta"; mkdir -p "$pasta"
    gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$id/zip" > "$pasta.zip" || die "Nao consegui baixar o artefato $artefato."
    python3 -I -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$pasta.zip" "$pasta" \
        || die "O artefato $artefato nao abriu (zip)."
    rm -f "$pasta.zip"
    pacote_tgz="$pasta/$artefato.tgz"
    [ -f "$pacote_tgz" ] && [ -f "$pacote_tgz.sha256" ] || die "O artefato $artefato nao traz o pacote e o sha256 dele."
    (cd "$pasta" && sha256sum -c "$artefato.tgz.sha256" >/dev/null 2>&1) || die "O pacote baixado nao confere com o sha256 do artefato $artefato."
    echo "  $artefato ($(du -h "$pacote_tgz" | cut -f1)), sha256 conferido."
}
instalar() {
    need HCLOUD_TOKEN GITHUB_TOKEN
    local chave dono rc=0 lip
    chave=$(chave_do_evento)
    [ -z "$chave" ] || mask "$chave"
    if [ -n "$chave" ] && ! printf '%s' "$chave" | grep -qE '^[A-Za-z0-9_-]{8,200}$'; then
        die "O payload nao parece uma Chave de ativacao (so letras, numeros, hifen e sublinhado). O valor nao foi mostrado."
    fi
    if [ -n "${LICENCAS_RESEND_CHAVE:-}" ]; then
        printf '%s' "$LICENCAS_RESEND_CHAVE" | grep -qE '^re_[A-Za-z0-9_-]{8,200}$' || die "LICENCAS_RESEND_CHAVE fora do formato de uma chave do Resend (uma linha, re_...)."
    fi
    dono="${TESTE_EMAIL_DONO:-$PRODUCER_EMAIL}"
    install_hcloud; deploy_key
    teste_alvo
    log "1/5 O pacote da escola (o artefato do workflow Pacote da escola)"
    pacote_do_artefato

    fw_open_ssh "$TESTE_NAME"; wait_ssh "$target"
    log "2/5 O pacote no servidor, aberto em $TESTE_PASTA (a pasta da instalacao do kit)"
    rcopy "$pacote_tgz" "$target:/root/pacote-escola.tgz"
    rsh "$target" "set -e; install -d -m 755 '$TESTE_PASTA'; tar -xzf /root/pacote-escola.tgz -C '$TESTE_PASTA'; rm -f /root/pacote-escola.tgz; echo \"  \$(grep -m1 '\"versao\"' '$TESTE_PASTA/MANIFESTO.json' | tr -d ' ,')\""

    log "3/5 As respostas, so do root (0600); a chave do Resend e a Chave de ativacao so pela entrada do SSH"
    {
        printf 'ENDERECO=%s\n' "$TESTE_DOMAIN"
        printf 'ENDERECO_API=%s\n' "$TESTE_API_DOMAIN"
        printf 'EMAIL_DONO=%s\n' "$dono"
        printf 'NOME_DA_ESCOLA=%s\n' "${TESTE_NOME_DA_ESCOLA:-Escola de Ensaio}"
        printf 'EMAIL_REMETENTE=%s\n' "${TESTE_EMAIL_REMETENTE:-escola-teste@mail.$ZONE_NAME}"
        printf 'EMAIL_RESPONDER_PARA=%s\n' "$dono"
        printf 'EMAIL_TESTE_PARA=%s\n' "$dono"
        # O ensaio guarda o backup so no proprio servidor (o aceite escrito do instalador): o servidor e apagado no fim.
        printf 'BACKUP_SO_NESTE_SERVIDOR=ACEITO O BACKUP SO NESTE SERVIDOR\n'
        printf 'REINICIO_AUTOMATICO=nao\n'
    } | rsh "$target" "umask 077; cat > /root/respostas-ensaio.conf"
    if [ -n "${LICENCAS_RESEND_CHAVE:-}" ]; then
        printf '%s' "$LICENCAS_RESEND_CHAVE" | rsh "$target" "umask 077; k=\$(cat); printf 'RESEND_API_KEY=%s\\n' \"\$k\" >> /root/respostas-ensaio.conf"
        echo "  a chave do Resend: o segredo LICENCAS_RESEND_CHAVE"
    else
        # A mesma chave so de envio do Emissor (restrita ao dominio de envio ja verificado), do servidor dele para o do
        # ensaio pela entrada do SSH: nunca no disco do runner nem no log.
        server_exists "$LICENCAS_NAME" || die "Sem a chave do Resend: nem o segredo LICENCAS_RESEND_CHAVE, nem o servidor do Emissor ($LICENCAS_NAME) para emprestar a dele."
        lip=$(server_ip4 "$LICENCAS_NAME")
        fw_open_ssh "$LICENCAS_NAME"; wait_ssh "$DEPLOY_USER@$lip"
        rsh "$DEPLOY_USER@$lip" "sudo cat '$LICENCAS_EMISSOR_DIR/segredos/resend-chave'" \
            | rsh "$target" "umask 077; k=\$(cat); case \"\$k\" in re_*) printf 'RESEND_API_KEY=%s\\n' \"\$k\" >> /root/respostas-ensaio.conf ;; *) exit 3 ;; esac" \
            || die "O Emissor nao tem a chave do Resend em segredos/resend-chave (rode secrets-licencas com o envelope, docs/20 §8C.5)."
        echo "  a chave do Resend: a do Emissor (so de envio, do dominio ja verificado)"
    fi
    rsh "$target" "rm -f /root/chave-ensaio.txt"
    if [ -n "$chave" ]; then
        printf '%s' "$chave" | rsh "$target" "umask 077; cat > /root/chave-ensaio.txt"
        echo "  a Chave de ativacao: do payload (mascarada)"
    else
        warn "Sem a Chave de ativacao no payload: o instalador para no ultimo passo (codigo 52), com a escola no ar; ative pela tela Configuracoes > Licenca, ou rode teste-instalar de novo com a Chave."
    fi
    chave=""

    log "4/5 O instalador do Bunker Members, sem terminal (o link do dono nao aparece: o dono entra pelo Esqueci a senha)"
    rsh "$target" "e=\$(grep -m1 '^EMAIL_DONO=' /root/respostas-ensaio.conf | cut -d= -f2- | tr 'A-Z' 'a-z')
        tira() { awk -v e=\"\$e\" '{ l = tolower(\$0); while (e != \"\" && (i = index(l, e)) > 0) { \$0 = substr(\$0, 1, i - 1) \"<e-mail do dono>\" substr(\$0, i + length(e)); l = tolower(\$0) } print }'; }
        a=(--respostas /root/respostas-ensaio.conf); [ ! -s /root/chave-ensaio.txt ] || a+=(--ativacao-arquivo /root/chave-ensaio.txt)
        bash '$TESTE_PASTA/infra/kit/instalar' \"\${a[@]}\" </dev/null 2>&1 | tira; rc=\${PIPESTATUS[0]}
        rm -f /root/respostas-ensaio.conf /root/chave-ensaio.txt; exit \$rc" || rc=$?
    fw_close_all

    log "5/5 Resultado"
    case "$rc" in
        0) echo "A escola do ensaio esta no ar: https://$TESTE_DOMAIN (admin em /admin). O dono entra pelo Esqueci a senha da tela de entrar, com o e-mail do produtor." ;;
        52|53|54|55) echo "A escola esta instalada, mas a Licenca nao ativou (codigo $rc, acima). Gere outra Chave no Painel de licencas e rode teste-instalar de novo com ela no payload, ou ative pela tela Configuracoes > Licenca da escola." ;;
        *) echo "O instalador parou com o codigo $rc (acima). Rode teste-instalar de novo depois de corrigir: ele continua de onde parou." ;;
    esac
    return "$rc"
}

# ====== teste-apagar ====================================================================================
apagar() {
    [ "${CONFIRMAR:-}" = apagar ] || die "teste-apagar apaga o servidor do ensaio ($TESTE_NAME), com tudo o que estiver nele, o firewall e o DNS da escola do ensaio. Confirme com CONFIRMAR=apagar nas opcoes."
    need HCLOUD_TOKEN CLOUDFLARE_API_TOKEN
    install_hcloud
    local fw nome sub i
    log "1/3 Servidor $TESTE_NAME"
    if server_exists "$TESTE_NAME"; then
        [ "$(hzj server describe "$TESTE_NAME" | jq -r '.labels.papel // empty')" = teste ] \
            || die "O servidor $TESTE_NAME nao tem a marca papel=teste: nao e o do ensaio, e nada foi apagado."
        hz server delete "$TESTE_NAME"
        echo "  apagado: a cobranca por hora para aqui."
    else
        echo "  nao existe."
    fi
    log "2/3 Firewall"
    fw=$(fw_name "$TESTE_NAME")
    if hz firewall describe "$fw" >/dev/null 2>&1; then
        # Logo depois do servidor apagado, a Hetzner ainda pode ver o firewall em uso: algumas tentativas.
        for ((i = 1; i <= ${TESTE_TENTATIVAS_FIREWALL:-12}; i++)); do
            if hz firewall delete "$fw" >/dev/null 2>&1; then echo "  $fw apagado."; break; fi
            [ "$i" -lt "${TESTE_TENTATIVAS_FIREWALL:-12}" ] || die "O firewall $fw nao saiu (ainda em uso?). Rode teste-apagar de novo daqui a pouco."
            sleep 5
        done
    else
        echo "  nao existe."
    fi
    log "3/3 DNS da escola do ensaio"
    for nome in "$TESTE_DOMAIN" "$TESTE_API_DOMAIN"; do
        sub=$(zona_sub "$nome")
        cf_dns_delete "$sub" A
        cf_dns_delete "$sub" AAAA
    done
    echo "  $TESTE_DOMAIN e $TESTE_API_DOMAIN sem registro."
    echo
    echo "O ensaio foi apagado: nada dele fica cobrando. O pacote (artefato) some sozinho em 7 dias; a Licenca de ensaio fica no Painel (Revogar, se quiser)."
}

"$acao"

#!/usr/bin/env bash
# O servidor do Emissor de licencas, bunker707-licencas (docs/32 D39 e §11.2; docs/20 §8C; docs/21 §11). Cada acao e
# uma etapa do workflow Infra (Hetzner):
#   bash infra/cloud/licencas.sh plan        plan-licencas: tipos e precos em todos os locais que a API informa e o mais
#                                            barato que serve (x86 ou ARM, LICENCAS_MIN_*). Nao cria nada
#   bash infra/cloud/licencas.sh dns         dns-licencas: so registros A (nunca AAAA): o Painel com proxy da Cloudflare,
#                                            a API sem proxy (nenhum desafio de robos; so IPv4)
#   bash infra/cloud/licencas.sh cerimonia   cerimonia-licencas: as duas raizes e a chave de emissao, com o codigo do
#                                            proprio Emissor, num container sem rede (CONFIRMAR=cerimonia; ROTACIONAR=emissao
#                                            troca so a de emissao): as raizes so cifradas no Storage Box, a emissao direto
#                                            em segredos/ do servidor; o log mostra so as raizes publicas (docs/32 D41)
#   bash infra/cloud/licencas.sh segredos    secrets-licencas: a chave do Resend (do envelope no payload ou do segredo
#                                            LICENCAS_RESEND_CHAVE) e a senha do banco em segredos/ (1000:1000, 0400); a
#                                            chave de emissao e a da cerimonia, ja no servidor (os segredos LICENCAS_EMISSAO_*
#                                            de antes ainda valem, os tres juntos)
#   bash infra/cloud/licencas.sh deploy      deploy-licencas: compose e imagem do GHCR, .env (com o Painel e a conta de
#                                            envio), migracoes, /health, Caddy, o backup de hora em hora e, na primeira
#                                            vez, a conta do produtor no Painel (LICENCAS_TAG escolhe a versao; padrao
#                                            main). O Painel entra com e-mail e senha, sem lista de IPs nem Cloudflare
#                                            Access (D40); LICENCAS_SEM_PAINEL=sim sobe o Emissor sem ele
#   bash infra/cloud/licencas.sh conectar    conectar-licencas: a nossa escola ligada a API interna do Emissor
#                                            (CONFIRMAR=conectar): a credencial nova sorteada aqui, so o resumo no Emissor,
#                                            a credencial so no .env do app da escola, o Caddy do endereco interno so para
#                                            o IPv4 da escola e a conferencia de dentro do app; rodar de novo troca a
#                                            credencial (REVOGAR_ANTERIORES=sim deixa so a nova)
#   bash infra/cloud/licencas.sh backup      backup-licencas: um backup agora, com restic check
#   bash infra/cloud/licencas.sh restaurar   restaurar-licencas: troca o banco pelo de um backup (CONFIRMAR=restaurar;
#                                            SNAPSHOT=<id>, padrao o mais novo com dados)
#   bash infra/cloud/licencas.sh ensaio      ensaio-licencas: ensaio de restauracao num Postgres descartavel, sem tocar
#                                            no banco em uso
#   bash infra/cloud/licencas.sh status      status-licencas: servidor, DNS e respostas publicas; SSH=1 olha por dentro
# Criar o servidor e a etapa provision-licencas (provision.sh licencas, com CONFIRMADO=sim depois do ok do produtor).
# Toda acao que muda alguma coisa so roda da main (licencas_so_da_main, alem da trava do workflow); plan e status so
# leem. Nunca imprime segredo: os valores vao ao servidor pelo stdin do SSH, nunca em linha de comando.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/lib.sh"
acao="${1:-}"
case "$acao" in plan|dns|cerimonia|segredos|deploy|conectar|backup|restaurar|ensaio|status) ;; *) die "uso: licencas.sh plan|dns|cerimonia|segredos|deploy|conectar|backup|restaurar|ensaio|status" ;; esac
case "$acao" in plan|status) ;; *) licencas_so_da_main ;; esac

# O que vai ao servidor de licencas: so a infra dele e o que ela usa, nunca o codigo do produto.
LICENCAS_ARQUIVOS="infra/licencas infra/scripts/lib.sh infra/compose/caddy/cloudflare-trusted-proxies.caddyfile"
SEG="$LICENCAS_EMISSOR_DIR/segredos"
ENVL="$REMOTE_DIR/infra/licencas/.env"

licencas_alvo() {  # define ip e target do servidor de licencas, ou para
    server_exists "$LICENCAS_NAME" || die "O servidor $LICENCAS_NAME nao existe: rode plan-licencas e, com o ok do produtor no chat, provision-licencas com CONFIRMADO=sim (docs/20 §8C.3)."
    ip=$(server_ip4 "$LICENCAS_NAME"); target="$DEPLOY_USER@$ip"
}
remote() { rsh "$target" "cd '$REMOTE_DIR' && $*"; }
# borda: o Caddy do servidor com o infra/licencas/.env de agora. A configuracao e conferida num container de uma vez antes
# de valer; depois o Caddy sobe (ou e recriado, se o .env mudou) e recarrega o Caddyfile novo, com algumas tentativas
# enquanto ele acaba de subir.
borda() {
    local caddy="docker compose -f infra/licencas/docker-compose.yml"
    remote "$caddy pull --quiet && $caddy run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && $caddy up -d && for i in 1 2 3 4 5 6 7 8 9 10; do $caddy exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile && break; [ \$i != 10 ] || exit 1; sleep 2; done"
}
# borda_interno IPS: a API interna no infra/licencas/.env, para o Caddy: o endereco dela, a porta local que o compose do
# Emissor publica (INTERNO_PORTA_NO_HOST do .env dele, padrao 8082) e quem chega nela (IPS: o IPv4 de agora do servidor
# da nossa escola, ou 127.0.0.1/32 sem a escola no ar; licencas_interno_ips, lido antes de abrir a 22).
borda_interno() {
    local porta
    porta=$(get_env "$target" "$LICENCAS_EMISSOR_DIR/.env" INTERNO_PORTA_NO_HOST | tr -d "'\""); porta="${porta:-8082}"
    set_env "$target" "$ENVL" LICENCAS_INTERNO_DOMAIN "$LICENCAS_INTERNO_DOMAIN"
    set_env "$target" "$ENVL" INTERNO_PORTA_NO_HOST "$porta"
    set_env "$target" "$ENVL" LICENCAS_INTERNO_IPS "$1"
    if [ "$1" = "127.0.0.1/32" ]; then
        echo "  API interna -> 127.0.0.1:$porta, fechada para todos: o servidor da escola ($MEMBROS_NAME) nao existe agora (guardado?); o conectar-licencas abre para o IP dele"
    else
        echo "  API interna -> 127.0.0.1:$porta, so do servidor da escola ($MEMBROS_NAME, $1) e so /interno/v1/*; a credencial e o Emissor que confere"
    fi
}
# publico_ok: https://<API>/health responde {"ok":true} de fora (DNS, certificado e Caddy), por ate ~2 min.
publico_ok() {
    local i code
    for ((i = 0; i < ${PUBLICO_TENTATIVAS:-12}; i++)); do
        code=$(curl -sS -o "$WORK_DIR/saude-publica.json" -w '%{http_code}' --max-time 15 "https://$LICENCAS_API_DOMAIN/health" 2>/dev/null) || code=000
        if [ "$code" = "200" ] && grep -q '"ok":true' "$WORK_DIR/saude-publica.json" 2>/dev/null; then
            echo "  https://$LICENCAS_API_DOMAIN/health: 200 {\"ok\":true}"; return 0
        fi
        sleep 10
    done
    return 1
}
# config_emissor ARQUIVO: o Painel, a conta de envio, as chaves anteriores e os links do Emissor (lib.sh, LICENCAS_PAINEL_*
# e LICENCAS_EMISSOR_*), conferidos como o Emissor confere ao subir, num JSON em base64 para o implantar.sh. O Painel
# entra com e-mail e senha (D40): nada do Cloudflare Access. Sem o produtor ou o remetente (os dois tem padrao em
# lib.sh), para antes de qualquer chamada, a nao ser com LICENCAS_SEM_PAINEL=sim. Nao imprime o e-mail do produtor.
config_emissor() {
    python3 -I - "$1" "${LICENCAS_SEM_PAINEL:-}" "$LICENCAS_PAINEL_DOMAIN" "$LICENCAS_PAINEL_TETO_DIARIO" \
        "$LICENCAS_EMISSOR_EMAIL_PRODUTOR" "${LICENCAS_EMISSOR_EMAIL_REMETENTE:-}" "${LICENCAS_EMISSOR_KIDS_ANTERIORES:-}" \
        "${LICENCAS_EMISSOR_LINK_RENOVAR:-}" "${LICENCAS_EMISSOR_LINK_LOJA:-}" <<'PY'
import base64, json, re, sys
from urllib.parse import urlsplit
saida = sys.argv[1]
sem, dominio, teto, produtor, remetente, kids, renovar, loja = (a.strip() for a in sys.argv[2:10])
# O que o .env do Emissor nao aguenta (o implantar.sh grava entre aspas simples) e o e-mail como o Emissor confere.
PROIBIDO = re.compile(r"[\x00-\x1f\x7f'\"`$\\]")
EMAIL = re.compile(r'[^@\s<>"(),;:]+@[^@\s<>"(),;:]+\.[^@\s<>"(),;:]+')
email_ok = lambda texto: len(texto) <= 254 and bool(EMAIL.fullmatch(texto))
problemas = []
if sem not in ("", "sim"):
    sys.exit(f"ERRO: LICENCAS_SEM_PAINEL so aceita sim (veio {sem}).")
if not re.fullmatch(r"\d{1,4}", teto) or not 1 <= int(teto) <= 1000:
    problemas.append(f"LICENCAS_PAINEL_TETO_DIARIO precisa ser um numero de 1 a 1000 (veio {teto}).")
kids = [k.strip() for k in kids.split(",") if k.strip()]
if len(kids) > 8 or not all(re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", k) for k in kids):
    problemas.append("LICENCAS_EMISSOR_KIDS_ANTERIORES precisa ser uma lista de ate 8 kid (letras minusculas, numeros e hifen), separados por virgula, como emissao-2026-11.")
for nome, link in (("LICENCAS_EMISSOR_LINK_RENOVAR", renovar), ("LICENCAS_EMISSOR_LINK_LOJA", loja)):
    try:
        partes = urlsplit(link.replace("{licenca}", "lic_exemplo"))
        ok = partes.scheme == "https" and bool(partes.hostname)
    except ValueError:
        ok = False
    if link and (not ok or re.search(r"\s", link) or PROIBIDO.search(link)):
        problemas.append(f"{nome} precisa ser um endereco https://, sem espaco nem aspas ({{licenca}} vira o numero da Licenca; veio {link}).")
config = {"PAINEL_ENDERECO": "", "PAINEL_TETO_DIARIO": teto, "EMISSOR_EMAIL_PRODUTOR": "", "EMISSOR_EMAIL_REMETENTE": "",
          "EMISSOR_KIDS_ANTERIORES": ",".join(kids), "EMISSOR_LINK_RENOVAR": renovar, "EMISSOR_LINK_LOJA": loja}
if sem == "sim":
    resumo = "  Sem o Painel (LICENCAS_SEM_PAINEL=sim): o Emissor sobe sem ele e sem e-mail; a API das Instalacoes funciona igual."
else:
    produtor, dominio = produtor.lower(), dominio.lower()
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?", dominio):
        problemas.append(f"LICENCAS_PAINEL_DOMAIN nao e um nome (veio {dominio}).")
    faltam = [nome for nome, valor in (("LICENCAS_EMISSOR_EMAIL_REMETENTE", remetente), ("LICENCAS_EMISSOR_EMAIL_PRODUTOR", produtor)) if not valor]
    if faltam:
        sys.exit("ERRO: falta a configuracao do Painel de licencas: " + ", ".join(faltam) + ". Cadastre como variavel do repositorio no GitHub (Settings > Secrets and variables > Actions > Variables; docs/20 §8C.5) e rode de novo, ou rode o deploy-licencas com LICENCAS_SEM_PAINEL=sim para subir o Emissor sem o Painel.")
    if not email_ok(produtor) or PROIBIDO.search(produtor):
        problemas.append("LICENCAS_EMISSOR_EMAIL_PRODUTOR (sem ele, PRODUCER_EMAIL) nao e um e-mail.")
    nomeado = re.fullmatch(r"([^<>\r\n\"]{1,80}) <([^<>\s]+)>", remetente)
    if not email_ok(nomeado.group(2) if nomeado else remetente) or PROIBIDO.search(remetente):
        problemas.append(f"LICENCAS_EMISSOR_EMAIL_REMETENTE precisa ser um e-mail, ou Nome <e-mail>, de um dominio verificado no Resend, sem aspas nem $ (veio {remetente}).")
    config.update({"PAINEL_ENDERECO": "https://" + dominio, "EMISSOR_EMAIL_PRODUTOR": produtor, "EMISSOR_EMAIL_REMETENTE": remetente})
    resumo = f"  Painel em https://{dominio} (login de e-mail e senha, de qualquer internet, D40; teto de {teto} acoes sem venda por dia), com os avisos ao produtor pelo Resend."
if problemas:
    sys.exit("ERRO: " + " ".join(problemas))
print(resumo)
print("  Chaves anteriores aceitas na readocao: " + (",".join(kids) or "nenhuma (so a atual)") + "; Renovar e loja na licenca: "
      + (" e ".join(n for n, l in (("Renovar", renovar), ("loja", loja)) if l) or "nenhum") + ".")
with open(saida, "w", encoding="utf-8") as fh:
    fh.write(base64.b64encode(json.dumps(config, separators=(",", ":")).encode("utf-8")).decode("ascii"))
PY
}

# ====== plan-licencas ===================================================================================
plan() {
    need HCLOUD_TOKEN
    install_hcloud
    hzj server-type list > "$WORK_DIR/server-types.json"
    plano_barato licencas LICENCAS "o Emissor" "$LICENCAS_MIN_RAM_GB" "$LICENCAS_MIN_DISK_GB" "$LICENCAS_MIN_VCPU" \
        "$LICENCAS_ARQUITETURAS" "${LICENCAS_LOCAIS:-}" "${LICENCAS_TYPE:-}" "${LICENCAS_LOCATION:-}"
    echo "IPv4: um, obrigatorio (a API e a conferencia inicial so falam IPv4): cerca de EUR 0,50/mes; o valor do dia esta no console da Hetzner."
    echo "Backup: no Storage Box que ja existe ($STORAGE_BOX_NAME), num repositorio proprio; o preco do box nao muda."
    echo "Nada foi criado. A criacao e a etapa provision-licencas, com CONFIRMADO=sim depois do ok do produtor no chat."
}

# ====== dns-licencas ====================================================================================
dns() {
    need HCLOUD_TOKEN CLOUDFLARE_API_TOKEN
    install_hcloud
    licencas_alvo
    log "DNS do Emissor em $ZONE_NAME: so registro A, nunca AAAA"
    cf_apply_dns_licencas
    log "TLS da zona (Full strict; Always Use HTTPS desligado, para o Let's Encrypt validar por HTTP)"
    cf_zone_tls
    echo
    echo "  $LICENCAS_API_DOMAIN -> $ip sem proxy da Cloudflare: nenhum desafio de robos e so IPv4 (docs/32 §11.2)."
    echo "  $LICENCAS_PAINEL_DOMAIN -> $ip com o proxy da Cloudflare; o login e o de e-mail e senha do proprio Painel (D40)."
    echo "  $LICENCAS_INTERNO_DOMAIN -> $ip sem proxy: a API interna, que o Caddy do Emissor so abre para o IPv4 do servidor da nossa escola (docs/20 §8C.9)."
}

# ====== secrets-licencas ================================================================================
# grava_segredo ARQUIVO: o valor pela entrada, num arquivo novo de segredos/ (1000:1000, 0400) que troca o anterior de uma
# vez (nada do valor na linha de comando).
grava_segredo() {
    rsh "$target" "sudo sh -c 'umask 077; t=\$(mktemp \"$SEG/.novo.XXXXXX\") && cat > \"\$t\" && chown 1000:1000 \"\$t\" && chmod 400 \"\$t\" && mv -f \"\$t\" \"$SEG/$1\"'"
}
# segredos_pasta: a pasta do Emissor e a segredos/ (0700, dono deploy).
segredos_pasta() {
    rsh "$target" "sudo install -d -m 755 -o '$DEPLOY_USER' -g '$DEPLOY_USER' '$LICENCAS_EMISSOR_DIR' && sudo install -d -m 700 -o '$DEPLOY_USER' -g '$DEPLOY_USER' '$SEG'"
}
# recria_emissor: os servicos do Emissor ja no ar sao recriados com os arquivos novos (o container so ve o arquivo novo
# quando nasce de novo) e conferidos; nada no ar, nada a fazer.
recria_emissor() {
    rsh "$target" "cd '$LICENCAS_EMISSOR_DIR' 2>/dev/null && [ -f compose.yaml ] && [ -n \"\$(docker compose ps -q --status running 2>/dev/null)\" ] || { echo '  nada no ar ainda: o deploy-licencas usa estes arquivos.'; exit 0; }; s=\$(docker compose config --services | grep -vx -e postgres -e migrar | tr '\\n' ' '); docker compose up -d --no-build --force-recreate --no-deps \$s && cd '$REMOTE_DIR' && bash infra/licencas/scripts/smoke.sh"
}
# resend_do_envelope: a chave do Resend que chega no envelope cifrado para este servidor (PAYLOAD, como o secrets-membros:
# a IA cria a chave so de envio pelo conector do Resend e a cifra com a transfer.pub do servidor, docs/20 §4A.6). So o
# servidor abre o envelope; a chave vai direto para segredos/resend-chave, sem passar pelo disco nem pelo runner.
resend_do_envelope() {
    printf '%s' "$PAYLOAD" | tr -d '[:space:]' | rsh "$target" "umask 077 && cat > /tmp/payload-licencas.b64"
    rsh "$target" "umask 077 && cat > /tmp/envelope-licencas.sh" < "$CLOUD_DIR/envelope.sh"
    rsh "$target" "sudo bash -c 'prog=\$(cat); set -o pipefail; umask 077; bash /tmp/envelope-licencas.sh decrypt /etc/bunker707/transfer.key /tmp/payload-licencas.b64 | python3 -I -c \"\$prog\" \"\$1\"; rc=\$?; rm -f /tmp/payload-licencas.b64 /tmp/envelope-licencas.sh; exit \$rc' _ '$SEG'" <<'PY'
import os, re, sys, tempfile
pasta = sys.argv[1]
chave = ""
for linha in sys.stdin.read().splitlines():
    nome, _, valor = linha.partition("=")
    if nome in ("RESEND_API_KEY", "LICENCAS_RESEND_CHAVE") and valor.strip():
        chave = valor.strip()
        break
if not chave:
    sys.exit("ERRO: o envelope nao abriu neste servidor (transfer.pub de outro servidor?) ou nao traz a linha RESEND_API_KEY=re_...")
if not re.fullmatch(r"re_[A-Za-z0-9_-]{8,200}", chave):
    sys.exit("ERRO: a chave do Resend do envelope esta fora do formato (uma linha, re_...).")
fd, tmp = tempfile.mkstemp(dir=pasta, prefix=".novo.")
with os.fdopen(fd, "w") as fh:
    fh.write(chave)
os.chown(tmp, 1000, 1000)
os.chmod(tmp, 0o400)
os.replace(tmp, os.path.join(pasta, "resend-chave"))
print("  segredos/resend-chave (do envelope; so este servidor o abre)")
PY
}
segredos() {
    need HCLOUD_TOKEN
    local n=0 v raizes emissao=""
    # A chave de emissao: desde a cerimonia-licencas (docs/32 D41) ela nasce direto no servidor e os tres segredos do
    # GitHub nao sao mais precisos. Ainda aceitos, os tres juntos (a cerimonia feita fora, como antes).
    for v in LICENCAS_EMISSAO_CHAVE LICENCAS_EMISSAO_SENHA LICENCAS_EMISSAO_CERTIFICADO; do [ -z "${!v:-}" ] || n=$((n + 1)); done
    case "$n" in
        0) ;;
        3) emissao=segredos ;;
        *) die "LICENCAS_EMISSAO_CHAVE, LICENCAS_EMISSAO_SENHA e LICENCAS_EMISSAO_CERTIFICADO andam juntos. Com a cerimonia-licencas (docs/20 §8C.8) nenhum dos tres e preciso: apague os tres no GitHub." ;;
    esac
    if [ -n "${LICENCAS_BANCO_SENHA:-}" ]; then
        printf '%s' "$LICENCAS_BANCO_SENHA" | grep -qE '^[A-Za-z0-9._~+/=-]{16,128}$' \
            || die "LICENCAS_BANCO_SENHA precisa ter de 16 a 128 letras, numeros ou . _ ~ + / = - (sem aspas nem espaco)."
    fi
    if [ -n "${LICENCAS_RESEND_CHAVE:-}" ]; then
        # O formato que o Emissor confere ao subir com o Painel (src/config.ts do bunker-licensing).
        printf '%s' "$LICENCAS_RESEND_CHAVE" | grep -qE '^re_[A-Za-z0-9_-]{8,200}$' || die "LICENCAS_RESEND_CHAVE fora do formato de uma chave do Resend (uma linha, re_...)."
    fi
    if [ -n "${PAYLOAD:-}" ]; then
        [[ "$(printf '%s' "$PAYLOAD" | tr -d '[:space:]')" =~ ^[A-Za-z0-9+/]+=*\.[A-Za-z0-9+/]+=*$ ]] \
            || die "PAYLOAD nao e um envelope de infra/cloud/envelope.sh (base64.base64, numa linha)."
    fi
    if [ "$emissao" = segredos ]; then
        raizes=$(licencas_raizes_json)
        [ -n "$raizes" ] || die "Sem as raizes publicas (infra/licencas/raizes.json ou o segredo LICENCAS_RAIZES) nao da para conferir a chave de emissao."
        log "Conferindo a chave de emissao, o certificado e as raizes, antes de qualquer coisa sair do runner"
        LICENCAS_RAIZES="$raizes" node "$CLOUD_DIR/licencas-chave.mjs"
    fi
    install_hcloud; deploy_key
    licencas_alvo
    fw_open_ssh "$LICENCAS_NAME"; wait_ssh "$target"
    log "Segredos do Emissor em $SEG (donos 1000:1000, o usuario node do container; 0400)"
    segredos_pasta
    if [ "$emissao" = segredos ]; then
        printf '%s' "$LICENCAS_EMISSAO_CHAVE" | grava_segredo emissao.pem; echo "  segredos/emissao.pem (LICENCAS_EMISSAO_CHAVE)"
        printf '%s' "$LICENCAS_EMISSAO_SENHA" | grava_segredo emissao-senha; echo "  segredos/emissao-senha (LICENCAS_EMISSAO_SENHA)"
        printf '%s' "$LICENCAS_EMISSAO_CERTIFICADO" | grava_segredo emissao-certificado.json; echo "  segredos/emissao-certificado.json (LICENCAS_EMISSAO_CERTIFICADO)"
    else
        rsh "$target" "sudo sh -c 'for f in emissao.pem emissao-senha emissao-certificado.json; do test -s \"$SEG/\$f\" || exit 1; done'" \
            || die "Falta a chave de emissao no servidor (segredos/emissao.pem, a senha e o certificado): rode a etapa cerimonia-licencas da main, com CONFIRMAR=cerimonia (docs/20 §8C.8)."
        echo "  segredos/emissao.pem, emissao-senha e emissao-certificado.json: os da cerimonia-licencas, ja no servidor (mantidos)"
    fi
    # A chave do Resend: o envelope (a chave que a IA cria pelo conector do Resend, como a da producao); senao o segredo
    # LICENCAS_RESEND_CHAVE; senao a que ja esta no servidor (ou o arquivo vazio, que o compose do Emissor monta sempre).
    if [ -n "${PAYLOAD:-}" ]; then
        resend_do_envelope
    elif [ -n "${LICENCAS_RESEND_CHAVE:-}" ]; then
        printf '%s' "$LICENCAS_RESEND_CHAVE" | grava_segredo resend-chave; echo "  segredos/resend-chave (LICENCAS_RESEND_CHAVE)"
    else
        rsh "$target" "sudo sh -c 'test -s \"$SEG/resend-chave\" && echo \"  segredos/resend-chave (ja existia; mantida)\" || { umask 077; : > \"$SEG/resend-chave\" && chown 1000:1000 \"$SEG/resend-chave\" && chmod 400 \"$SEG/resend-chave\" && echo \"  segredos/resend-chave (vazia)\"; }'"
        warn "Sem a chave do Resend (nem o envelope no payload, nem LICENCAS_RESEND_CHAVE): sem ela o Painel nao sobe e os avisos ao produtor nao saem (docs/32 §11.2). O deploy-licencas so passa sem ela com LICENCAS_SEM_PAINEL=sim, ou com uma chave que ja estava no servidor."
    fi
    # A senha do banco: o Postgres so le o arquivo na primeira subida. Trocar o arquivo de um banco que ja existe, sem
    # trocar a senha dentro dele, deixaria o Emissor sem banco.
    if [ -n "${LICENCAS_BANCO_SENHA:-}" ]; then
        local novo atual
        novo=$(printf '%s' "$LICENCAS_BANCO_SENHA" | sha256sum | cut -c1-64)
        atual=$(rsh "$target" "sudo sh -c 'if [ -f \"$SEG/postgres-senha\" ]; then sha256sum < \"$SEG/postgres-senha\" | cut -c1-64; fi'")
        if [ -z "$atual" ]; then
            printf '%s' "$LICENCAS_BANCO_SENHA" | grava_segredo postgres-senha; echo "  segredos/postgres-senha (LICENCAS_BANCO_SENHA)"
        elif [ "$atual" = "$novo" ]; then
            echo "  segredos/postgres-senha (igual a LICENCAS_BANCO_SENHA; mantida)"
        elif ! rsh "$target" "docker volume inspect bunker-licensing_banco >/dev/null 2>&1"; then
            printf '%s' "$LICENCAS_BANCO_SENHA" | grava_segredo postgres-senha; echo "  segredos/postgres-senha (LICENCAS_BANCO_SENHA)"
        elif [ "${TROCAR_SENHA_BANCO:-}" = "sim" ]; then
            log "Trocando a senha do usuario emissor dentro do banco antes do arquivo (TROCAR_SENHA_BANCO=sim)"
            printf "alter role emissor password '%s';\n" "$LICENCAS_BANCO_SENHA" \
                | rsh "$target" "cd '$LICENCAS_EMISSOR_DIR' && docker compose exec -T postgres psql -U emissor -d emissor -v ON_ERROR_STOP=1 -q"
            printf '%s' "$LICENCAS_BANCO_SENHA" | grava_segredo postgres-senha; echo "  segredos/postgres-senha (LICENCAS_BANCO_SENHA)"
        else
            die "O banco do Emissor ja existe com outra senha (segredos/postgres-senha diferente de LICENCAS_BANCO_SENHA). O Postgres so le o arquivo na primeira subida: para trocar a senha, rode de novo com TROCAR_SENHA_BANCO=sim, que muda a senha dentro do banco antes do arquivo."
        fi
    else
        # Sem o segredo: a senha nasce no servidor, uma vez, e nunca sai dele.
        rsh "$target" "sudo sh -c 'test -s \"$SEG/postgres-senha\" && echo \"  segredos/postgres-senha (ja existia; mantida)\" || { umask 077; openssl rand -hex 24 | tr -d \"\\\\n\" > \"$SEG/postgres-senha\" && chown 1000:1000 \"$SEG/postgres-senha\" && chmod 400 \"$SEG/postgres-senha\" && echo \"  segredos/postgres-senha (gerada no servidor)\"; }'"
    fi
    rsh "$target" "sudo stat -c '  %n %U:%G %a' '$SEG'/* | sed 's#$SEG/#segredos/#'"

    log "Servicos do Emissor ja no ar: recriados com os arquivos novos (o container so ve o arquivo novo quando nasce de novo)"
    recria_emissor
    fw_close_all
    echo "Proximo: deploy-licencas (se ainda nao rodou). A chave raiz nao passou por aqui e nunca passa (docs/32 §10)."
}

# ====== cerimonia-licencas ==============================================================================
# As chaves que assinam as licencas (docs/32 §10 e D41; docs/20 §8C.8), sem passo no computador do produtor: no runner do
# GitHub, com o codigo das chaves do proprio Emissor (src/keys.ts e src/signing.ts, dentro da imagem do GHCR; a imagem
# nao leva o bin/chaves.ts), num container sem rede (infra/cloud/cerimonia-licencas.mjs). Cria a raiz, a raiz de reserva
# e a chave de emissao com o certificado. As duas raizes saem so cifradas, com a senha derivada do HCLOUD_TOKEN (como a
# chave de recuperacao do backup), e vao direto do runner para a pasta propria no Storage Box: nunca passam pelo disco do
# servidor do Emissor. A chave de emissao, a senha dela (sorteada aqui) e o certificado vao para segredos/ do servidor
# do Emissor, pelo stdin do SSH. Nada vai para o log, para artefato ou para segredo do GitHub: o log mostra so as raizes
# publicas, que vao para infra/licencas/raizes.json num commit.
#   CONFIRMAR=cerimonia                    obrigatorio; recusa se as chaves ja existem (no repositorio, no Storage Box ou
#                                          no servidor)
#   CONFIRMAR=cerimonia ROTACIONAR=emissao so a troca da chave de emissao, assinada pela raiz guardada no Storage Box
#   LICENCAS_KID, LICENCAS_DIAS            o kid da chave nova (padrao emissao-AAAA-MM, ou emissao-AAAA-MM-DD na troca) e
#                                          os dias do certificado (padrao 400; o produto recusa mais de 1100)
cerimonia() {
    need HCLOUD_TOKEN GITHUB_TOKEN
    [ "${CONFIRMAR:-}" = cerimonia ] || die "cerimonia-licencas cria as chaves que assinam as licencas (as duas raizes e a chave de emissao). Confirme com CONFIRMAR=cerimonia nas opcoes (docs/20 §8C.8). Para trocar so a chave de emissao: CONFIRMAR=cerimonia ROTACIONAR=emissao."
    local rotacao="${ROTACIONAR:-}" dias="${LICENCAS_DIAS:-400}" mes c img box_pems=0 serv rid="" reserva="" kid kid_atual f raizes
    case "$rotacao" in ""|emissao) ;; *) die "ROTACIONAR so aceita emissao. Trocar as raizes e uma versao nova do produto para todos os compradores (docs/32 §10), fora desta etapa." ;; esac
    [[ $dias =~ ^[0-9]{1,4}$ ]] && [ "$dias" -ge 1 ] && [ "$dias" -le 1100 ] || die "LICENCAS_DIAS precisa ser um numero de 1 a 1100 (o produto recusa certificado de emissao com mais de 1100 dias)."
    if [ -n "${LICENCAS_KID:-}" ]; then
        printf '%s' "$LICENCAS_KID" | grep -qE '^[a-z0-9][a-z0-9-]{0,63}$' || die "LICENCAS_KID aceita so letras minusculas, numeros e hifen (ate 64)."
    fi
    mes=$(date -u +%Y-%m)
    img="$LICENCAS_IMAGEM:$LICENCAS_TAG"
    printf '%s' "$LICENCAS_TAG" | grep -qE '^[A-Za-z0-9_][A-Za-z0-9._-]{0,100}$' || die "LICENCAS_TAG invalida: '$LICENCAS_TAG' (ex.: main ou sha-1a2b3c4)."
    # A pasta das chaves no runner (0700): global, porque a limpeza roda no trap de saida, depois que as locais somem.
    CERIMONIA_DIR="$WORK_DIR/cerimonia"; c="$CERIMONIA_DIR"
    limpar_cerimonia() {
        docker logout ghcr.io >/dev/null 2>&1 || true
        if [ -n "${CERIMONIA_DIR:-}" ] && [ -d "$CERIMONIA_DIR" ]; then
            find "$CERIMONIA_DIR" -type f -exec shred -u {} + 2>/dev/null || true
            rm -rf "$CERIMONIA_DIR"
        fi
    }
    trap 'rc=$?; limpar_cerimonia; exit $rc' EXIT
    rm -rf "$c"; (umask 077; mkdir -p "$c")
    install_hcloud; deploy_key
    licencas_alvo
    box_alvo

    log "1/6 O que ja existe: o repositorio, a pasta das raizes no Storage Box ($LICENCAS_RAIZES_PASTA) e o servidor do Emissor"
    printf 'pwd\n' | box_sftp >/dev/null || die "O Storage Box $STORAGE_BOX_NAME nao respondeu ao SFTP do runner (porta ${STORAGE_BOX_SSH_PORT:-23}, chave de backup derivada do token). Nada foi criado."
    if printf 'ls -1 %s\n' "$LICENCAS_RAIZES_PASTA" | box_sftp > "$c/box-lista" 2>/dev/null; then
        box_pems=$(grep -c '\.pem$' "$c/box-lista" || true)
    fi
    fw_open_ssh "$LICENCAS_NAME"
    # O trap do fw_open_ssh (fecha a 22) mais a limpeza da pasta da cerimonia e o logout do GHCR.
    trap 'rc=$?; set +e; limpar_cerimonia; fw_close_all || rc=1; exit $rc' EXIT
    wait_ssh "$target"
    serv=$(rsh "$target" "sudo sh -c 'test -s \"$SEG/emissao.pem\" && echo sim || echo nao'")
    echo "  infra/licencas/raizes.json: $([ -s "$LICENCAS_RAIZES_ARQUIVO" ] && echo existe || echo nao existe); Storage Box: $box_pems raiz(es) cifrada(s); servidor: chave de emissao $([ "$serv" = sim ] && echo existe || echo nao existe)"
    if [ -z "$rotacao" ]; then
        f=""
        [ ! -s "$LICENCAS_RAIZES_ARQUIVO" ] || f="$f infra/licencas/raizes.json ja traz raizes publicas;"
        [ "$box_pems" = 0 ] || f="$f o Storage Box ja guarda raizes cifradas em $LICENCAS_RAIZES_PASTA;"
        [ "$serv" != sim ] || f="$f o servidor do Emissor ja tem a chave de emissao;"
        [ -z "$f" ] || die "As chaves ja existem:$f a cerimonia nao roda de novo por cima. Trocar a chave de emissao: CONFIRMAR=cerimonia ROTACIONAR=emissao. Trocar as raizes e uma versao nova do produto para todos os compradores (docs/32 §10)."
        rid="raiz-$mes"; reserva="raiz-reserva-$mes"; kid="${LICENCAS_KID:-emissao-$mes}"
    else
        [ "$box_pems" -ge 1 ] || die "ROTACIONAR=emissao assina a chave nova com a raiz guardada no Storage Box ($LICENCAS_RAIZES_PASTA), e ela nao esta la. Nada foi criado."
        printf 'get %s/raizes.json %s\n' "$LICENCAS_RAIZES_PASTA" "$c/raizes-do-box.json" | box_sftp >/dev/null || die "Nao consegui ler $LICENCAS_RAIZES_PASTA/raizes.json no Storage Box."
        rid=$(python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1]))[0]["rid"])' "$c/raizes-do-box.json") || die "O raizes.json do Storage Box nao se le."
        kid_atual=$(rsh "$target" "sudo cat '$SEG/emissao-certificado.json' 2>/dev/null" | python3 -I -c 'import json, sys; print(json.load(sys.stdin).get("kid", ""))' 2>/dev/null || true)
        kid="${LICENCAS_KID:-emissao-$(date -u +%Y-%m-%d)}"
        [ "$kid" != "$kid_atual" ] || die "A chave de emissao de agora ja e $kid: escolha outro kid com LICENCAS_KID."
        printf 'get %s/%s.pem %s\n' "$LICENCAS_RAIZES_PASTA" "$rid" "$c/raiz-que-assina.pem" | box_sftp >/dev/null || die "Nao consegui baixar a raiz $rid do Storage Box."
    fi

    log "2/6 As senhas: a da chave de emissao sorteada aqui; a das raizes derivada do HCLOUD_TOKEN. Nenhuma vai para o log"
    (umask 077; openssl rand -hex 32 | tr -d '\n' > "$c/emissao-senha")
    node "$CLOUD_DIR/deploy-key.mjs" --secret --info bunker707-licencas-raizes-v1 --out "$c/raiz-senha" 2>/dev/null
    echo "  ok"

    log "3/6 As chaves, com o codigo do proprio Emissor ($img), num container sem rede, so leitura e sem privilegio"
    printf '%s' "$GITHUB_TOKEN" | docker login ghcr.io -u "${GITHUB_ACTOR:-danilosouza-dev}" --password-stdin >/dev/null \
        || die "O runner nao entrou no GHCR com o token do job."
    docker pull --quiet "$img" >/dev/null || die "Nao consegui puxar $img. Confira: o CI do bunker-licensing publica a imagem no GHCR (docs/20 §8C.2), e o pacote dele da leitura ao bunker707-member-area (GitHub, pacote bunker-licensing > Package settings > Manage Actions access)."
    BUNKER_SENHA_RAIZ=$(cat "$c/raiz-senha") BUNKER_SENHA_EMISSAO=$(cat "$c/emissao-senha") \
    CERIMONIA_ACAO=$([ -z "$rotacao" ] && echo completa || echo emissao) CERIMONIA_RID="$rid" CERIMONIA_RID_RESERVA="$reserva" \
    CERIMONIA_KID="$kid" CERIMONIA_DIAS="$dias" \
        docker run --rm -i --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user node \
            -e BUNKER_SENHA_RAIZ -e BUNKER_SENHA_EMISSAO -e CERIMONIA_ACAO -e CERIMONIA_RID -e CERIMONIA_RID_RESERVA -e CERIMONIA_KID -e CERIMONIA_DIAS \
            -v "$CLOUD_DIR/cerimonia-licencas.mjs:/cerimonia/cerimonia.mjs:ro" "$img" node /cerimonia/cerimonia.mjs \
            < "$([ -n "$rotacao" ] && printf '%s' "$c/raiz-que-assina.pem" || printf /dev/null)" > "$c/saida.json" \
        || die "A cerimonia parou dentro da imagem do Emissor (a mensagem acima). Nada foi gravado no Storage Box nem no servidor."
    docker logout ghcr.io >/dev/null 2>&1 || true
    # Os arquivos de cada parte (0600, so nesta pasta do runner): as raizes cifradas, a emissao cifrada, o certificado e
    # as raizes publicas. O que nao estiver cifrado para aqui.
    python3 -I - "$c" <<'PY'
import json, os, sys
c = sys.argv[1]
saida = json.load(open(os.path.join(c, "saida.json"), encoding="utf-8"))
os.umask(0o077)
def grava(nome, texto):
    with open(os.path.join(c, nome), "w", encoding="utf-8") as fh:
        fh.write(texto)
for r in saida["raizes"]:
    if "-----BEGIN ENCRYPTED PRIVATE KEY-----" not in r["pem"]:
        sys.exit(f"ERRO: a raiz {r['rid']} nao saiu cifrada.")
    grava(f"raiz-{r['rid']}.pem", r["pem"])
e = saida["emissao"]
if "-----BEGIN ENCRYPTED PRIVATE KEY-----" not in e["pem"]:
    sys.exit("ERRO: a chave de emissao nao saiu cifrada.")
grava("emissao.pem", e["pem"])
grava("emissao-certificado.json", json.dumps(e["certificado"], indent=2) + "\n")
if saida["raizes"]:
    grava("raizes.json", json.dumps([{"rid": r["rid"], "publicKey": r["publicKey"]} for r in saida["raizes"]], indent=2) + "\n")
os.remove(os.path.join(c, "saida.json"))
PY

    log "4/6 Conferencia fora da imagem, com o Node do runner: as raizes abrem com a senha derivada e batem com as publicas; a emissao esta cifrada, abre, nao e uma raiz e o certificado e de uma raiz, no prazo"
    if [ -z "$rotacao" ]; then raizes=$(python3 -I -c 'import json, sys; print(json.dumps(json.load(open(sys.argv[1])), separators=(",", ":")))' "$c/raizes.json"); else raizes=$(python3 -I -c 'import json, sys; print(json.dumps(json.load(open(sys.argv[1])), separators=(",", ":")))' "$c/raizes-do-box.json"); fi
    if [ -z "$rotacao" ]; then
        RAIZ_SENHA=$(cat "$c/raiz-senha") node -e '
const { createPrivateKey, createPublicKey } = require("node:crypto");
const { readFileSync } = require("node:fs");
const pasta = process.argv[1];
for (const r of JSON.parse(readFileSync(`${pasta}/raizes.json`, "utf8"))) {
  const pem = readFileSync(`${pasta}/raiz-${r.rid}.pem`, "utf8");
  if (!pem.includes("ENCRYPTED PRIVATE KEY")) { console.error(`ERRO: a raiz ${r.rid} nao esta cifrada.`); process.exit(1); }
  const key = createPrivateKey({ key: pem, format: "pem", passphrase: process.env.RAIZ_SENHA });
  if (key.asymmetricKeyType !== "ed25519" || createPublicKey(key).export({ format: "jwk" }).x !== r.publicKey) { console.error(`ERRO: a raiz ${r.rid} nao bate com a publica.`); process.exit(1); }
}' "$c" || die "As raizes geradas nao conferem. Nada foi gravado no Storage Box nem no servidor."
    fi
    LICENCAS_EMISSAO_CHAVE=$(cat "$c/emissao.pem") LICENCAS_EMISSAO_SENHA=$(cat "$c/emissao-senha") \
    LICENCAS_EMISSAO_CERTIFICADO=$(cat "$c/emissao-certificado.json") LICENCAS_RAIZES="$raizes" \
        node "$CLOUD_DIR/licencas-chave.mjs" >/dev/null || die "A chave de emissao gerada nao confere. Nada foi gravado no Storage Box nem no servidor."
    echo "  conferidas."

    if [ -z "$rotacao" ]; then
        log "5/6 As duas raizes, cifradas, no Storage Box ($LICENCAS_RAIZES_PASTA), direto do runner; conferidas de volta"
        printf '%s\n' "Raizes do Emissor de licencas do Bunker Members, criadas pela etapa cerimonia-licencas em $(date -u +%Y-%m-%dT%H:%M:%SZ)." \
            "Os arquivos .pem estao cifrados (PKCS#8, AES-256) com a senha derivada do HCLOUD_TOKEN, como a chave de recuperacao" \
            "do backup: node infra/cloud/deploy-key.mjs --secret --info bunker707-licencas-raizes-v1 --out <arquivo>." \
            "raizes.json: as chaves publicas, as mesmas de infra/licencas/raizes.json. Trocar o HCLOUD_TOKEN: docs/20 §8C.8." > "$c/LEIA-ME.txt"
        {
            printf -- '-mkdir %s\n' "${LICENCAS_RAIZES_PASTA%/*}"
            printf 'mkdir %s\n' "$LICENCAS_RAIZES_PASTA"
            for f in "$c"/raiz-*.pem; do f=${f##*/}; printf 'put %s %s/%s\n' "$c/$f" "$LICENCAS_RAIZES_PASTA" "${f#raiz-}"; done
            printf 'put %s %s/raizes.json\n' "$c/raizes.json" "$LICENCAS_RAIZES_PASTA"
            printf 'put %s %s/LEIA-ME.txt\n' "$c/LEIA-ME.txt" "$LICENCAS_RAIZES_PASTA"
        } | box_sftp >/dev/null || die "Nao consegui gravar as raizes no Storage Box ($LICENCAS_RAIZES_PASTA). Nada foi para o servidor do Emissor; confira a pasta no box antes de rodar de novo."
        (umask 077; mkdir -p "$c/volta")
        for f in "$c"/raiz-*.pem; do f=${f##*/}; printf 'get %s/%s %s\n' "$LICENCAS_RAIZES_PASTA" "${f#raiz-}" "$c/volta/$f"; done | box_sftp >/dev/null \
            || die "Nao consegui ler de volta as raizes do Storage Box."
        for f in "$c"/raiz-*.pem; do
            cmp -s "$f" "$c/volta/${f##*/}" || die "A raiz ${f##*/} do Storage Box nao e igual a que saiu daqui."
        done
        echo "  $(find "$c" -maxdepth 1 -name 'raiz-*.pem' | wc -l | tr -d ' ') raizes cifradas em $LICENCAS_RAIZES_PASTA, conferidas byte a byte."
    else
        log "5/6 As raizes ficam como estao no Storage Box (troca so da chave de emissao)"
    fi

    log "6/6 A chave de emissao ($kid), a senha dela e o certificado em $SEG (1000:1000, 0400), pelo stdin do SSH"
    segredos_pasta
    grava_segredo emissao.pem < "$c/emissao.pem"; echo "  segredos/emissao.pem"
    grava_segredo emissao-senha < "$c/emissao-senha"; echo "  segredos/emissao-senha"
    grava_segredo emissao-certificado.json < "$c/emissao-certificado.json"; echo "  segredos/emissao-certificado.json"
    rsh "$target" "sudo stat -c '  %n %U:%G %a' '$SEG'/emissao* | sed 's#$SEG/#segredos/#'"
    recria_emissor
    fw_close_all
    echo
    if [ -z "$rotacao" ]; then
        echo "Raizes PUBLICAS (as unicas partes das chaves que aparecem aqui). Grave exatamente isto em infra/licencas/raizes.json,"
        echo "num commit que chega a main antes do deploy-licencas e do pacote-escola (docs/20 §8C.8):"
        cat "$c/raizes.json"
    else
        echo "Chave de emissao trocada: $kid (a anterior era ${kid_atual:-desconhecida}). As licencas ja emitidas continuam valendo."
        echo "Por 30 dias, rode deploy-licencas com LICENCAS_EMISSOR_KIDS_ANTERIORES=${kid_atual:-<kid anterior>} (a readocao ainda aceita as licencas dela); depois, sem."
    fi
    limpar_cerimonia
}

# conta_do_produtor: com a 22 aberta, o Emissor no ar e a infra do commit no servidor, a conta do produtor no Painel
# (LICENCAS_EMISSOR_EMAIL_PRODUTOR), so se ainda nao existe (infra/licencas/scripts/conta-do-produtor.sh): o Emissor manda o
# link de uso unico para definir a senha ao e-mail dele, e o script confere na fila que o e-mail saiu. O link nunca aparece
# no registro; so com LICENCAS_MOSTRAR_LINK=sim e so se o e-mail nao sair, um link novo aparece, uma vez (D40).
# LICENCAS_NOVO_LINK=sim manda outro link a conta que ja existe. O e-mail vai pelo stdin do SSH, nunca na linha de comando.
conta_do_produtor() {
    local args=""
    [ "${LICENCAS_NOVO_LINK:-}" != sim ] || args="$args --novo-link"
    [ "${LICENCAS_MOSTRAR_LINK:-}" != sim ] || args="$args --mostrar-link-se-falhar"
    printf '%s' "$LICENCAS_EMISSOR_EMAIL_PRODUTOR" | rsh "$target" "cd '$REMOTE_DIR' && bash infra/licencas/scripts/conta-do-produtor.sh$args"
}

# ====== deploy-licencas =================================================================================
deploy() {
    need HCLOUD_TOKEN CLOUDFLARE_API_TOKEN GITHUB_TOKEN
    local raizes raizes_b64 config_b64 sb_user sb_host box porta_api porta_painel rec kv escola_ips
    printf '%s' "$LICENCAS_TAG" | grep -qE '^[A-Za-z0-9_][A-Za-z0-9._-]{0,100}$' || die "LICENCAS_TAG invalida: '$LICENCAS_TAG' (ex.: main ou sha-1a2b3c4)."
    # As raizes publicas: infra/licencas/raizes.json, que a cerimonia-licencas imprime (o segredo LICENCAS_RAIZES de antes
    # ainda vale sem o arquivo).
    raizes=$(licencas_raizes_json)
    [ -n "$raizes" ] || die "Sem as raizes publicas: rode a cerimonia-licencas e grave em infra/licencas/raizes.json, num commit, o que ela imprime (docs/20 §8C.8)."
    raizes_b64=$(printf '%s' "$raizes" | base64 -w0)
    log "Painel de licencas, conta de envio, chaves anteriores e links do Emissor (docs/20 §8C.5)"
    config_emissor "$WORK_DIR/config-emissor.b64"
    config_b64=$(cat "$WORK_DIR/config-emissor.b64")
    install_hcloud; deploy_key
    licencas_alvo
    log "DNS dos tres nomes (etapa dns-licencas)"
    licencas_dns_confere
    echo "  $LICENCAS_API_DOMAIN e $LICENCAS_INTERNO_DOMAIN (sem proxy) e $LICENCAS_PAINEL_DOMAIN (com proxy) -> $ip, so registro A."
    # Quem chega na API interna: o IPv4 de agora do servidor da escola, pela API da Hetzner (sem ele, ninguem).
    escola_ips=$(licencas_interno_ips)
    box=$(storage_box_json)
    sb_user=$(printf '%s' "$box" | jq -r '.username // .user // empty'); sb_host=$(printf '%s' "$box" | jq -r '.server // .host // empty')
    [ -n "$sb_user" ] && [ -n "$sb_host" ] || die "Sem o Storage Box $STORAGE_BOX_NAME (ou sem usuario e host no JSON dele): o Emissor nao sobe sem backup (docs/20 §8C.6)."

    fw_open_ssh "$LICENCAS_NAME"; wait_ssh "$target"
    log "Enviando a infra do servidor de licencas (commit $(git -C "$REPO_ROOT" rev-parse --short HEAD)), sem o codigo do produto"
    # shellcheck disable=SC2086
    sync_repo "$target" $LICENCAS_ARQUIVOS

    log "Emissor $LICENCAS_IMAGEM:$LICENCAS_TAG (GHCR; o servidor entra com o token do job, que vence com ele)"
    printf '%s' "$GITHUB_TOKEN" | rsh "$target" "docker login ghcr.io -u '${GITHUB_ACTOR:-danilosouza-dev}' --password-stdin >/dev/null"
    if ! remote "bash infra/licencas/scripts/implantar.sh --imagem='$LICENCAS_IMAGEM:$LICENCAS_TAG' --raizes-b64='$raizes_b64' --config-b64='$config_b64'"; then
        remote "docker logout ghcr.io >/dev/null 2>&1 || true"
        die "A implantacao do Emissor falhou (veja acima). O que ja estava no ar continua."
    fi
    remote "docker logout ghcr.io >/dev/null 2>&1 || true"

    log "Borda (Caddy): $LICENCAS_API_DOMAIN, $LICENCAS_PAINEL_DOMAIN e $LICENCAS_INTERNO_DOMAIN"
    porta_api=$(get_env "$target" "$LICENCAS_EMISSOR_DIR/.env" EMISSOR_PORTA_NO_HOST); porta_api="${porta_api:-8080}"
    porta_painel=$(get_env "$target" "$LICENCAS_EMISSOR_DIR/.env" PAINEL_PORTA_NO_HOST); porta_painel="${porta_painel:-8081}"
    set_env "$target" "$ENVL" LICENCAS_API_DOMAIN "$LICENCAS_API_DOMAIN"
    set_env "$target" "$ENVL" LICENCAS_PAINEL_DOMAIN "$LICENCAS_PAINEL_DOMAIN"
    set_env "$target" "$ENVL" EMISSOR_PORTA_NO_HOST "$porta_api"
    set_env "$target" "$ENVL" PAINEL_PORTA_NO_HOST "$porta_painel"
    set_env "$target" "$ENVL" ACME_EMAIL "$PRODUCER_EMAIL"
    echo "  API -> 127.0.0.1:$porta_api; Painel -> 127.0.0.1:$porta_painel (de qualquer internet, pelo proxy da Cloudflare; login do Painel, D40)"
    borda_interno "$escola_ips"
    borda

    log "Backup de hora em hora ($LICENCAS_RESTIC_REPOSITORY, no Storage Box $STORAGE_BOX_NAME)"
    set_env "$target" "$ENVL" STORAGE_BOX_USER "$sb_user"
    set_env "$target" "$ENVL" STORAGE_BOX_HOST "$sb_host"
    set_env "$target" "$ENVL" RESTIC_REPOSITORY "$LICENCAS_RESTIC_REPOSITORY"
    for kv in BACKUP_KEEP_HOURLY=48 BACKUP_KEEP_DAILY=30 BACKUP_PRUNE_HOUR=03; do
        [ -n "$(get_env "$target" "$ENVL" "${kv%%=*}")" ] || set_env "$target" "$ENVL" "${kv%%=*}" "${kv#*=}"
    done
    # A senha do repositorio nasce no servidor e nunca sai dele.
    rsh "$target" "grep -qE '^RESTIC_PASSWORD=.+' '$ENVL' || { umask 077; printf 'RESTIC_PASSWORD=%s\\n' \"\$(openssl rand -hex 32)\" >> '$ENVL'; }"
    # A de recuperacao (derivada do token) vai pelo stdin: num servidor novo, adota o repositorio do servidor anterior.
    rec="$WORK_DIR/restic-recovery"
    node "$CLOUD_DIR/deploy-key.mjs" --secret --info bunker707-restic-recovery-v1 --out "$rec" 2>/dev/null
    rsh "$target" "umask 077; k=\$(mktemp); cat > \"\$k\"; cd '$REMOTE_DIR' && bash infra/licencas/scripts/backup.sh --init --chave-recuperacao=\"\$k\"; rc=\$?; rm -f \"\$k\"; exit \$rc" < "$rec"
    rm -f "$rec"
    backup_recovery_key "$target" licencas
    remote "sudo bash infra/licencas/scripts/backup.sh --install-timer >/dev/null && sudo systemctl start bunker707-licencas-backup.service && echo \"  ultimo backup: \$(cat /var/backups/bunker707-licencas/ultimo-sucesso 2>/dev/null)\""
    if [ "${LICENCAS_SEM_PAINEL:-}" != sim ]; then
        log "A conta do produtor no Painel (uma vez; as outras pelo exec-licencas, docs/20 §8C.3)"
        # O script sai com 3 quando a conta ficou pronta e so o e-mail do link nao saiu (a fila tenta de novo sozinha).
        local rc=0
        conta_do_produtor || rc=$?
        case "$rc" in
            0) ;;
            3) warn "A conta do produtor existe no Painel, mas o e-mail com o link de senha nao saiu (acima). A fila do Emissor tenta de novo sozinha: conserte a conta de envio (secrets-licencas) e o e-mail sai na proxima tentativa; se o link vencer, deploy-licencas com LICENCAS_NOVO_LINK=sim." ;;
            *) warn "A conta do produtor no Painel nao foi criada agora (acima). O Emissor esta no ar; rode o deploy-licencas de novo, ou o exec-licencas do docs/20 §8C.3." ;;
        esac
    fi
    fw_close_all

    log "Conferencia de fora (DNS, certificado, Caddy e Emissor)"
    publico_ok || warn "https://$LICENCAS_API_DOMAIN/health ainda nao respondeu {\"ok\":true} de fora. O Emissor responde no servidor; o certificado pode levar alguns minutos depois do primeiro deploy: rode status-licencas daqui a pouco."
    echo
    if [ "${LICENCAS_SEM_PAINEL:-}" = sim ]; then
        echo "Emissor no ar: https://$LICENCAS_API_DOMAIN (API das Instalacoes), sem o Painel (LICENCAS_SEM_PAINEL=sim)."
    else
        echo "Emissor no ar: https://$LICENCAS_API_DOMAIN (API das Instalacoes) e https://$LICENCAS_PAINEL_DOMAIN (Painel, com e-mail e senha)."
        echo "O produtor define a senha pelo link de uso unico que o Emissor manda ao e-mail dele (LICENCAS_EMISSOR_EMAIL_PRODUTOR)."
    fi
    echo "Falta, se ainda nao foi feito: ensaio-licencas (o ensaio de restauracao) e o monitor externo (docs/20 §8C); e, com a escola"
    echo "no ar (restaurar e deploy-membros), conectar-licencas com CONFIRMAR=conectar: a API interna em https://$LICENCAS_INTERNO_DOMAIN (docs/20 §8C.9)."
}

# ====== conectar-licencas ===============================================================================
# A nossa escola (a producao, MEMBROS_NAME) ligada a API interna do Emissor (docs/api-interna.md do bunker-licensing;
# docs/32 §2.4, §11.2 e §11.10; docs/20 §8C.9), sem ninguem colar segredo em lugar nenhum. CONFIRMAR=conectar; so da main;
# com a escola no ar (restaurar e deploy-membros antes). Rodar de novo e trocar a credencial (a rotacao):
#   1. o DNS dos tres nomes, como o dns-licencas deixa;
#   2. antes de mudar qualquer coisa: o Emissor com a API interna e a conta de envio (credencial-interna.sh --conferir) e o
#      compose da escola levando EMISSOR_INTERNO_URL e EMISSOR_INTERNO_CREDENCIAL ao app (o deploy-membros da main);
#   3. a credencial nova, sorteada aqui no formato do Emissor (bki_ e 256 bits; credencial-interna.mjs), e o resumo dela,
#      em arquivos 0600 do runner apagados com shred no fim; nunca impressa (e mascarada no log do Actions);
#   4. no servidor do Emissor, so o RESUMO, pela entrada do SSH (INTERNO_CREDENCIAL_HASH: a nova primeiro e as anteriores,
#      ate 4, para a escola nunca ficar sem acesso no meio da troca), o Emissor recriado; e o Caddy do endereco interno
#      aberto so para o IPv4 de agora do servidor da escola (o restaurar traz IP novo);
#   5. no servidor da escola, a credencial e o endereco no .env do app, pela entrada do SSH e como o secrets-membros grava
#      (env_aplicar_kv: 0600, dono deploy), e o app recriado, com o smoke;
#   6. de dentro do app da escola, GET /interno/v1/planos com a credencial nova responde 200 (conferir-interno.mjs).
#   REVOGAR_ANTERIORES=sim: depois do 200, o Emissor fica so com a nova (as anteriores param de valer: uma vazou, ou a
#   troca acabou) e a conferencia roda de novo.
# escola_alvo: define escola_ip e escola (deploy@ do servidor da nossa escola), ou para (guardada: restaurar antes).
escola_alvo() {
    if ! server_exists "$MEMBROS_NAME"; then
        [ -z "$(latest_snapshot membros)" ] || die "A nossa escola ($MEMBROS_NAME) esta guardada em snapshot: rode restaurar (PAPEIS=membros) e deploy-membros da main antes do conectar-licencas (docs/20 §4A.7 e §9F)."
        die "O servidor da nossa escola ($MEMBROS_NAME) nao existe: nao ha onde ligar a API interna."
    fi
    escola_ip=$(server_ip4 "$MEMBROS_NAME"); escola="$DEPLOY_USER@$escola_ip"
}
# conferir_da_escola: GET /interno/v1/planos de dentro do app da escola, com algumas tentativas enquanto o certificado do
# endereco novo sai e o app acaba de subir; o X-Pedido de cada tentativa vai para a auditoria do Emissor. Deixa em
# `conferido` a ultima resposta ("<codigo> <detalhe>"). Para na certa (200) e nas que tentar de novo so pioraria: 401 (cada
# credencial errada conta para o bloqueio do IP da escola no Emissor) e 429.
conferir_da_escola() {
    local i n="${CONFERIR_TENTATIVAS:-12}" pedido resposta=""
    for ((i = 1; i <= n; i++)); do
        pedido="conectar-licencas-$(date -u +%Y%m%dT%H%M%SZ)-$i"
        resposta=$(rsh "$escola" "cd '$REMOTE_DIR' && docker compose -f infra/compose/docker-compose.yml exec -T app node - '$pedido'" < "$CLOUD_DIR/conferir-interno.mjs" | tail -n1 | tr -cd 'A-Za-z0-9_.= -') || resposta="000 exec_falhou"
        resposta="${resposta:-000 sem_resposta}"
        echo "  GET https://$LICENCAS_INTERNO_DOMAIN/interno/v1/planos de dentro do app da escola: $resposta"
        case "${resposta%% *}" in 200|401|429) break ;; esac
        [ "$i" = "$n" ] || sleep "${CONFERIR_ESPERA:-10}"
    done
    conferido="$resposta"
}
# conectar_diagnostico "<codigo> <detalhe>": 200 segue; o resto para, com o que fazer.
conectar_diagnostico() {
    case "${1%% *}" in
        200) return 0 ;;
        401) die "O Emissor recusou a credencial nova (401): o resumo dela nao esta no Emissor no ar (veja o passo 4). Rode de novo, que a credencial e trocada outra vez." ;;
        403) die "O Caddy do Emissor recusou o pedido (403): ele nao saiu do IPv4 $escola_ip do servidor da escola. Confira LICENCAS_INTERNO_IPS no infra/licencas/.env do Emissor (status-licencas com SSH=1) e rode de novo." ;;
        429) die "O Emissor respondeu limite de pedidos (429): espere 10 minutos e rode de novo." ;;
        502|503|504) die "O Caddy do Emissor nao chegou na API interna (${1%% *}): o Emissor no ar tem a API interna? Veja o registro dele (exec-licencas com COMANDO='cd emissor && docker compose logs --tail 100 emissor')." ;;
        000)
            case "$1" in
                *sem_configuracao*) die "O app da escola nao recebeu EMISSOR_INTERNO_URL e EMISSOR_INTERNO_CREDENCIAL: o compose dela no ar leva as duas? Rode deploy-membros da main e de novo o conectar-licencas." ;;
                *exec_falhou*) die "A conferencia nao rodou dentro do app da escola (docker compose exec): o app esta no ar? Veja com status-ssh e rode de novo." ;;
            esac
            die "Sem resposta de https://$LICENCAS_INTERNO_DOMAIN de dentro do app da escola (${1#* }): DNS, o certificado do Let's Encrypt (o endereco novo pode levar alguns minutos na primeira vez) ou a rede. Rode de novo daqui a pouco." ;;
        *) die "Resposta inesperada da API interna de dentro do app da escola: $1." ;;
    esac
}
conectar() {
    need HCLOUD_TOKEN CLOUDFLARE_API_TOKEN
    [ "${CONFIRMAR:-}" = conectar ] || die "conectar-licencas troca a credencial da API interna no Emissor e na nossa escola e recria o Emissor e o app da escola. Confirme com CONFIRMAR=conectar nas opcoes (REVOGAR_ANTERIORES=sim deixa so a nova; docs/20 §8C.9)."
    case "${REVOGAR_ANTERIORES:-}" in ""|sim) ;; *) die "REVOGAR_ANTERIORES so aceita sim (veio ${REVOGAR_ANTERIORES})." ;; esac
    local c escola escola_ip conferido="" ips
    install_hcloud; deploy_key
    licencas_alvo
    escola_alvo
    ips="$escola_ip/32"
    CONECTAR_DIR="$WORK_DIR/conectar"; c="$CONECTAR_DIR"
    # A pasta da credencial no runner (0700): global, porque a limpeza roda no trap de saida.
    limpar_conectar() {
        if [ -n "${CONECTAR_DIR:-}" ] && [ -d "$CONECTAR_DIR" ]; then
            find "$CONECTAR_DIR" -type f -exec shred -u {} + 2>/dev/null || true
            rm -rf "$CONECTAR_DIR"
        fi
    }
    # O trap do fw_open_ssh (fecha a 22), mais a limpeza da credencial; armado de novo depois de cada fw_open_ssh.
    armar_trap() { trap 'rc=$?; set +e; limpar_conectar; fw_close_all || rc=1; exit $rc' EXIT; }
    armar_trap

    log "1/6 DNS dos tres nomes do Emissor (dns-licencas)"
    licencas_dns_confere
    echo "  $LICENCAS_INTERNO_DOMAIN -> $ip, registro A sem proxy."

    log "2/6 Antes de mudar qualquer coisa: o Emissor ($LICENCAS_NAME) e a escola ($MEMBROS_NAME, $escola_ip)"
    fw_open_ssh "$LICENCAS_NAME"; armar_trap; wait_ssh "$target"
    # shellcheck disable=SC2086
    sync_repo "$target" $LICENCAS_ARQUIVOS
    remote "bash infra/licencas/scripts/credencial-interna.sh --conferir"
    fw_open_ssh "$MEMBROS_NAME"; armar_trap; wait_ssh "$escola"
    rsh "$escola" "grep -q 'EMISSOR_INTERNO_CREDENCIAL' '$REMOTE_DIR/infra/compose/docker-compose.yml' && test -f '$REMOTE_DIR/infra/compose/.env'" \
        || die "O compose da escola no ar ainda nao leva EMISSOR_INTERNO_URL e EMISSOR_INTERNO_CREDENCIAL ao app: rode deploy-membros da main antes do conectar-licencas. Nada mudou."
    echo "  a escola no ar leva a API interna ao app (commit $(rsh "$escola" "cut -c1-7 '$REMOTE_DIR/.deployed-commit' 2>/dev/null" || true))."

    log "3/6 A credencial nova, sorteada aqui no formato do Emissor (nunca impressa)"
    rm -rf "$c"; (umask 077; mkdir -p "$c")
    (umask 077; node "$CLOUD_DIR/credencial-interna.mjs" --credencial "$c/credencial" --resumo "$c/resumo") \
        || die "Nao consegui sortear a credencial (infra/cloud/credencial-interna.mjs). Nada mudou."
    grep -qE '^bki_[A-Za-z0-9_-]{43}$' "$c/credencial" && grep -qE '^[0-9a-f]{64}$' "$c/resumo" || die "A credencial sorteada saiu fora do formato do Emissor. Nada mudou."
    mask "$(cat "$c/credencial")"
    echo "  resumo $(cut -c1-8 "$c/resumo")...: a credencial so vai para a escola; o resumo, so para o Emissor."

    log "4/6 Emissor: so o resumo em INTERNO_CREDENCIAL_HASH (a nova e as anteriores, ate 4) e o Emissor recriado"
    remote "bash infra/licencas/scripts/credencial-interna.sh" < "$c/resumo"
    log "4/6 Emissor: o Caddy de $LICENCAS_INTERNO_DOMAIN so para o servidor da escola"
    borda_interno "$ips"
    borda

    log "5/6 Escola: EMISSOR_INTERNO_URL e EMISSOR_INTERNO_CREDENCIAL no .env do app (como o secrets-membros grava) e o app recriado"
    { printf 'EMISSOR_INTERNO_URL=https://%s\n' "$LICENCAS_INTERNO_DOMAIN"; printf 'EMISSOR_INTERNO_CREDENCIAL='; cat "$c/credencial"; printf '\n'; } \
        | rsh "$escola" "umask 077 && cat > /tmp/conectar-licencas.kv"
    env_aplicar_kv "$escola" "$REMOTE_DIR/infra/compose/.env" /tmp/conectar-licencas.kv
    rsh "$escola" "stat -c '  %n %U %a' '$REMOTE_DIR/infra/compose/.env'"
    membros_recria "$escola"

    log "6/6 De dentro do app da escola, com a credencial nova"
    conferir_da_escola
    conectar_diagnostico "$conferido"
    if [ "${REVOGAR_ANTERIORES:-}" = sim ]; then
        log "REVOGAR_ANTERIORES=sim: o Emissor fica so com a credencial nova"
        remote "bash infra/licencas/scripts/credencial-interna.sh --so-a-nova" < "$c/resumo"
        conferir_da_escola
        conectar_diagnostico "$conferido"
    fi
    fw_close_all
    limpar_conectar
    echo
    echo "A nossa escola fala com o Emissor: https://$LICENCAS_INTERNO_DOMAIN, so do IPv4 $escola_ip do servidor dela, com a credencial nova (${conferido#* } no mapa de produtos)."
    if [ "${REVOGAR_ANTERIORES:-}" = sim ]; then
        echo "O Emissor aceita so a credencial nova: as anteriores pararam de valer."
    else
        echo "O Emissor aceita a nova e as anteriores (ate 4): para deixar so a nova (uma vazou), rode de novo com REVOGAR_ANTERIORES=sim."
    fi
    echo "Proximo (docs/20 §9F): o produtor mapeia o produto no Painel (Planos) e marca o produto como Bunker Members no admin da escola."
    echo "Depois de cada restaurar da escola (o IP muda), rode o conectar-licencas de novo."
}

# ====== backup-licencas, restaurar-licencas, ensaio-licencas ===========================================
no_servidor() {  # no_servidor COMANDO: com a 22 aberta, a infra do commit no servidor e o comando em REMOTE_DIR
    need HCLOUD_TOKEN
    install_hcloud; deploy_key
    licencas_alvo
    fw_open_ssh "$LICENCAS_NAME"; wait_ssh "$target"
    # shellcheck disable=SC2086
    sync_repo "$target" $LICENCAS_ARQUIVOS
    remote "$1"
    fw_close_all
}
snapshot_opcao() {
    [ -z "${SNAPSHOT:-}" ] && return 0
    printf '%s' "$SNAPSHOT" | grep -qE '^([0-9a-f]{8,64}|latest)$' || die "SNAPSHOT precisa ser o id de um backup (8 ou mais caracteres hexadecimais) ou latest."
    printf -- '--snapshot=%s' "$SNAPSHOT"
}
backup() {
    log "Backup do Emissor agora, com restic check"
    no_servidor "bash infra/licencas/scripts/backup.sh --check"
}
restaurar() {
    [ "${CONFIRMAR:-}" = "restaurar" ] || die "restaurar-licencas troca o banco do Emissor pelo de um backup. Confirme com CONFIRMAR=restaurar nas opcoes (SNAPSHOT=<id> escolhe o backup; sem ele, o mais novo com dados). Antes, rode ensaio-licencas com o mesmo backup."
    local snap; snap=$(snapshot_opcao)
    log "Restauracao do banco do Emissor ${SNAPSHOT:+(backup $SNAPSHOT)}"
    no_servidor "${SEM_BACKUP_ANTES:+SEM_BACKUP_ANTES=1 }bash infra/licencas/scripts/restore.sh --yes $snap"
    publico_ok || warn "https://$LICENCAS_API_DOMAIN/health nao respondeu {\"ok\":true} de fora; confira com status-licencas."
}
ensaio() {
    local snap; snap=$(snapshot_opcao)
    log "Ensaio de restauracao do Emissor ${SNAPSHOT:+(backup $SNAPSHOT)}: num Postgres descartavel, sem tocar no banco em uso"
    no_servidor "bash infra/licencas/scripts/restore.sh --ensaio $snap"
}

# ====== status-licencas =================================================================================
status() {
    need HCLOUD_TOKEN
    install_hcloud
    local existe="" code
    log "Servidor $LICENCAS_NAME"
    if server_exists "$LICENCAS_NAME"; then
        existe=1
        hzj server describe "$LICENCAS_NAME" | jq -r '"  \(.name): \(.server_type.name) em \((.location.name // .datacenter.location.name)), \(.public_net.ipv4.ip), \(.status), criado \(.created[:10])"'
        local t l p
        t=$(hzj server describe "$LICENCAS_NAME" | jq -r '.server_type.name'); l=$(hzj server describe "$LICENCAS_NAME" | jq -r '.location.name // .datacenter.location.name')
        p=$(monthly_price "$t" "$l"); [ -z "$p" ] || echo "  preco: EUR $p/mes sem IVA, mais o IPv4"
    else
        echo "  nao existe (plan-licencas, e provision-licencas com CONFIRMADO=sim depois do ok do produtor)."
    fi
    if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
        log "DNS (o Painel com proxy, a API e a API interna sem; so registro A)"
        local zone fqdn registros
        zone=$(cf_zone_id)
        for fqdn in "$LICENCAS_PAINEL_DOMAIN" "$LICENCAS_API_DOMAIN" "$LICENCAS_INTERNO_DOMAIN"; do
            registros=$(cf_api GET "/zones/$zone/dns_records?name=$fqdn" | jq -r '.result[] | "  \(.name) \(.type) \(.content) proxy=\(.proxied)"')
            printf '%s\n' "${registros:-  $fqdn (nenhum registro)}"
            case "$registros" in *" AAAA "*) warn "$fqdn tem AAAA: a conferencia inicial so funciona por IPv4 (rode dns-licencas)." ;; esac
        done
    fi
    log "Respostas publicas"
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://$LICENCAS_API_DOMAIN/health" 2>/dev/null) || code=000
    printf '  %-60s %s (esperado 200)\n' "https://$LICENCAS_API_DOMAIN/health" "${code:-000}"
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -X POST -H 'Content-Type: application/json' --data '{}' "https://$LICENCAS_API_DOMAIN/v1/preflight" 2>/dev/null) || code=000
    printf '  %-60s %s (esperado 400: pedido sem Chave)\n' "POST https://$LICENCAS_API_DOMAIN/v1/preflight" "${code:-000}"
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://$LICENCAS_PAINEL_DOMAIN/" 2>/dev/null) || code=000
    printf '  %-60s %s (esperado 200 ou 302: a tela de entrar do Painel)\n' "https://$LICENCAS_PAINEL_DOMAIN/" "${code:-000}"
    # Daqui (o runner) a API interna fecha na borda: so o servidor da escola entra. Nada chega ao Emissor.
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://$LICENCAS_INTERNO_DOMAIN/interno/v1/planos" 2>/dev/null) || code=000
    printf '  %-60s %s (esperado 403: so o servidor da escola entra)\n' "https://$LICENCAS_INTERNO_DOMAIN/interno/v1/planos" "${code:-000}"
    if [ -n "${SSH:-}" ] && [ -n "$existe" ]; then
        deploy_key
        licencas_alvo
        log "$LICENCAS_NAME por dentro"
        fw_open_ssh "$LICENCAS_NAME"; wait_ssh "$target" 10
        rsh "$target" "cd '$REMOTE_DIR' 2>/dev/null && echo \"  commit da infra: \$(cat .deployed-commit 2>/dev/null)\"; docker ps --format '  {{.Names}}\t{{.Status}}'; free -h | sed 's/^/  /'; df -h / | sed 's/^/  /'; bash infra/licencas/scripts/smoke.sh" || warn "a conferencia por dentro falhou (veja acima)."
        # A chave publica de transferencia: o envelope do secrets-licencas (a chave do Resend) e cifrado para ela.
        echo "  transfer.pub (base64, para infra/cloud/envelope.sh encrypt): $(rsh "$target" "base64 -w0 /etc/bunker707/transfer.pub 2>/dev/null" || true)"
        fw_close_all
    fi
}

"$acao"

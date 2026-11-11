#!/usr/bin/env bash
# O servidor do Emissor de licencas, bunker707-licencas (docs/32 D39 e §11.2; docs/20 §8C; docs/21 §11). Cada acao e
# uma etapa do workflow Infra (Hetzner):
#   bash infra/cloud/licencas.sh plan        plan-licencas: tipos e precos em todos os locais que a API informa e o mais
#                                            barato que serve (x86 ou ARM, LICENCAS_MIN_*). Nao cria nada
#   bash infra/cloud/licencas.sh dns         dns-licencas: so registros A (nunca AAAA): o Painel com proxy da Cloudflare,
#                                            a API sem proxy (nenhum desafio de robos; so IPv4)
#   bash infra/cloud/licencas.sh segredos    secrets-licencas: a chave de emissao cifrada, a senha dela, o certificado, a
#                                            chave do Resend e a senha do banco em segredos/ (1000:1000, 0400), dos
#                                            segredos LICENCAS_* do GitHub, conferidos aqui antes de sair
#   bash infra/cloud/licencas.sh deploy      deploy-licencas: compose e imagem do GHCR, .env (com o Painel e a conta de
#                                            envio), migracoes, /health, Caddy e o backup de hora em hora (LICENCAS_TAG
#                                            escolhe a versao; padrao main). Sem a configuracao do Painel, para antes de
#                                            tudo, a nao ser com LICENCAS_SEM_PAINEL=sim
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
case "$acao" in plan|dns|segredos|deploy|backup|restaurar|ensaio|status) ;; *) die "uso: licencas.sh plan|dns|segredos|deploy|backup|restaurar|ensaio|status" ;; esac
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
# e LICENCAS_EMISSOR_*), conferidos como o Emissor confere ao subir, num JSON em base64 para o implantar.sh. Sem o Access
# ou o remetente, para (antes de qualquer chamada), a nao ser com LICENCAS_SEM_PAINEL=sim. Nao imprime o e-mail do
# produtor.
config_emissor() {
    python3 -I - "$1" "${LICENCAS_SEM_PAINEL:-}" "$LICENCAS_PAINEL_DOMAIN" "${LICENCAS_PAINEL_ACCESS_EQUIPE:-}" \
        "${LICENCAS_PAINEL_ACCESS_AUD:-}" "$LICENCAS_PAINEL_TETO_DIARIO" "$LICENCAS_EMISSOR_EMAIL_PRODUTOR" \
        "${LICENCAS_EMISSOR_EMAIL_REMETENTE:-}" "${LICENCAS_EMISSOR_KIDS_ANTERIORES:-}" "${LICENCAS_EMISSOR_LINK_RENOVAR:-}" \
        "${LICENCAS_EMISSOR_LINK_LOJA:-}" <<'PY'
import base64, json, re, sys
from urllib.parse import urlsplit
saida = sys.argv[1]
sem, dominio, equipe, aud, teto, produtor, remetente, kids, renovar, loja = (a.strip() for a in sys.argv[2:12])
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
config = {"PAINEL_ENDERECO": "", "PAINEL_ACCESS_EQUIPE": "", "PAINEL_ACCESS_AUD": "", "PAINEL_TETO_DIARIO": teto,
          "EMISSOR_EMAIL_PRODUTOR": "", "EMISSOR_EMAIL_REMETENTE": "", "EMISSOR_KIDS_ANTERIORES": ",".join(kids),
          "EMISSOR_LINK_RENOVAR": renovar, "EMISSOR_LINK_LOJA": loja}
if sem == "sim":
    resumo = "  Sem o Painel (LICENCAS_SEM_PAINEL=sim): o Emissor sobe sem ele e sem e-mail; a API das Instalacoes funciona igual."
else:
    equipe = re.sub(r"^https://", "", equipe.lower()).rstrip("/")
    produtor = produtor.lower()
    faltam = [nome for nome, valor in (("LICENCAS_PAINEL_ACCESS_EQUIPE", equipe), ("LICENCAS_PAINEL_ACCESS_AUD", aud),
                                       ("LICENCAS_EMISSOR_EMAIL_REMETENTE", remetente), ("LICENCAS_EMISSOR_EMAIL_PRODUTOR", produtor)) if not valor]
    if faltam:
        sys.exit("ERRO: falta a configuracao do Painel de licencas: " + ", ".join(faltam) + ". Cadastre como variavel do repositorio no GitHub (Settings > Secrets and variables > Actions > Variables; docs/20 §8C.5) e rode de novo, ou rode o deploy-licencas com LICENCAS_SEM_PAINEL=sim para subir o Emissor sem o Painel.")
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com", equipe):
        problemas.append(f"LICENCAS_PAINEL_ACCESS_EQUIPE precisa ser o dominio da equipe no Cloudflare Zero Trust, <equipe>.cloudflareaccess.com (veio {equipe}).")
    if not re.fullmatch(r"[0-9a-f]{64}", aud):
        problemas.append("LICENCAS_PAINEL_ACCESS_AUD precisa ser a etiqueta AUD do aplicativo do Painel no Access (Application Audience Tag): 64 caracteres, de 0 a 9 e de a a f.")
    if not email_ok(produtor) or PROIBIDO.search(produtor):
        problemas.append("LICENCAS_EMISSOR_EMAIL_PRODUTOR (sem ele, PRODUCER_EMAIL) nao e um e-mail.")
    nomeado = re.fullmatch(r"([^<>\r\n\"]{1,80}) <([^<>\s]+)>", remetente)
    if not email_ok(nomeado.group(2) if nomeado else remetente) or PROIBIDO.search(remetente):
        problemas.append(f"LICENCAS_EMISSOR_EMAIL_REMETENTE precisa ser um e-mail, ou Nome <e-mail>, de um dominio verificado no Resend, sem aspas nem $ (veio {remetente}).")
    config.update({"PAINEL_ENDERECO": "https://" + dominio, "PAINEL_ACCESS_EQUIPE": equipe, "PAINEL_ACCESS_AUD": aud,
                   "EMISSOR_EMAIL_PRODUTOR": produtor, "EMISSOR_EMAIL_REMETENTE": remetente})
    resumo = f"  Painel em https://{dominio} (Access de {equipe}; teto de {teto} acoes sem venda por dia), com os avisos ao produtor pelo Resend."
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
    python3 -I - "$WORK_DIR/server-types.json" "$WORK_DIR/plan-licencas.env" "$LOCATION" "$FALLBACK_LOCATIONS" \
        "$LICENCAS_MIN_RAM_GB" "$LICENCAS_MIN_DISK_GB" "$LICENCAS_MIN_VCPU" "$LICENCAS_ARQUITETURAS" \
        "${LICENCAS_LOCAIS:-}" "${LICENCAS_TYPE:-}" "${LICENCAS_LOCATION:-}" <<'PY'
import json, os, sys
types = json.load(open(sys.argv[1]))
out_env, preferred, fallbacks = sys.argv[2], sys.argv[3], sys.argv[4].split()
min_ram, min_disk, min_cpu = float(sys.argv[5]), float(sys.argv[6]), float(sys.argv[7])
archs = sys.argv[8].replace(",", " ").split()
only = sys.argv[9].replace(",", " ").split()
forced_type, forced_loc = sys.argv[10], sys.argv[11]
# Empate de preco: o local preferido e as reservas de sempre primeiro, depois os outros em ordem alfabetica; x86 antes.
order = [preferred] + [l for l in fallbacks if l != preferred]
def rank(loc):
    return (order.index(loc) if loc in order else len(order), loc)

def monthly(price):
    m = price.get("price_monthly") or {}
    try:
        return float(m.get("net") or m.get("gross"))
    except (TypeError, ValueError):
        return None

def available(t, loc):
    # server_types[].locations[] = {name, available, deprecation}; sem o campo, desconhecido (a criacao tenta e a API
    # recusa o que nao tem estoque).
    for entry in t.get("locations") or []:
        if isinstance(entry, dict) and entry.get("name") == loc:
            if entry.get("deprecation"):
                return False
            return entry.get("available") if isinstance(entry.get("available"), bool) else None
    return None

rows, below = [], set()
for t in types:
    if t.get("deprecated"):
        continue
    arch = t.get("architecture") or "x86"
    if arch not in archs or (t.get("memory") or 0) < min_ram or (t.get("disk") or 0) < min_disk or (t.get("cores") or 0) < min_cpu:
        below.add(t["name"])
        continue
    if forced_type and t["name"] != forced_type:
        continue
    for p in t.get("prices") or []:
        loc = p.get("location")
        if (only and loc not in only) or (forced_loc and loc != forced_loc):
            continue
        price = monthly(p)
        if price is None:
            continue
        rows.append({"name": t["name"], "loc": loc, "cores": t.get("cores"), "mem": t.get("memory"), "disk": t.get("disk"),
                     "cpu": t.get("cpu_type"), "arch": arch, "price": price, "avail": available(t, loc)})

rows.sort(key=lambda r: (r["price"], rank(r["loc"]), r["arch"] != "x86", r["name"]))
print(f"Tipos que servem para o Emissor (minimo {min_ram:g} GB de memoria, {min_disk:g} GB de disco e {min_cpu:g} vCPU; {' ou '.join(archs)}), do mais barato:")
print(f"{'tipo':8} {'local':6} {'vcpu':>4} {'ram':>5} {'disco':>6} {'cpu':10} {'arq':4} {'EUR/mes':>8} disponivel")
for r in rows:
    avail = "?" if r["avail"] is None else ("sim" if r["avail"] else "nao")
    print(f"{r['name']:8} {r['loc']:6} {r['cores']!s:>4} {r['mem']!s:>5} {r['disk']!s:>6} {str(r['cpu']):10} {r['arch']:4} {r['price']:>8.2f} {avail}")
if below:
    print("Fora (abaixo do minimo ou de outra arquitetura): " + ", ".join(sorted(below)))
cands = [r for r in rows if r["avail"] is not False]
if not cands:
    print("\nNenhum tipo disponivel serve para o Emissor" + (f" (forcado: {forced_type})" if forced_type else "") + (f" em {forced_loc}" if forced_loc else "") + ". Nada foi criado.")
    sys.exit(1)
best = cands[0]
fallback = [r["loc"] for r in cands[1:] if r["name"] == best["name"] and abs(r["price"] - best["price"]) < 0.005]
print(f"\nlicencas: {best['name']} em {best['loc']} ({best['cores']} vCPU {best['arch']}, {best['mem']} GB, {best['disk']} GB disco) por EUR {best['price']:.2f}/mes sem IVA, mais o IPv4")
if fallback:
    print("Sem estoque na hora de criar, o mesmo tipo pelo mesmo preco em: " + " ".join(fallback))
with open(out_env, "w") as fh:
    fh.write(f"LICENCAS_TYPE={best['name']}\nLICENCAS_LOCATION={best['loc']}\nLICENCAS_PRICE={best['price']:.2f}\nLICENCAS_FALLBACK_LOCATIONS=\"{' '.join(fallback)}\"\n")
gh = os.environ.get("GITHUB_OUTPUT")
if gh:
    with open(gh, "a") as fh:
        fh.write(f"licencas_type={best['name']}\nlicencas_location={best['loc']}\nlicencas_price={best['price']:.2f}\n")
PY
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
    echo "  $LICENCAS_PAINEL_DOMAIN -> $ip com proxy. Uma vez so, o produtor cria no Cloudflare Zero Trust a aplicacao do"
    echo "  Access para este nome (docs/20 §8C.4): sem ela o Caddy responde 403 a todo mundo."
}

# ====== secrets-licencas ================================================================================
segredos() {
    need HCLOUD_TOKEN LICENCAS_EMISSAO_CHAVE LICENCAS_EMISSAO_SENHA LICENCAS_EMISSAO_CERTIFICADO LICENCAS_RAIZES
    if [ -n "${LICENCAS_BANCO_SENHA:-}" ]; then
        printf '%s' "$LICENCAS_BANCO_SENHA" | grep -qE '^[A-Za-z0-9._~+/=-]{16,128}$' \
            || die "LICENCAS_BANCO_SENHA precisa ter de 16 a 128 letras, numeros ou . _ ~ + / = - (sem aspas nem espaco)."
    fi
    if [ -n "${LICENCAS_RESEND_CHAVE:-}" ]; then
        # O formato que o Emissor confere ao subir com o Painel (src/config.ts do bunker-licensing).
        printf '%s' "$LICENCAS_RESEND_CHAVE" | grep -qE '^re_[A-Za-z0-9_-]{8,200}$' || die "LICENCAS_RESEND_CHAVE fora do formato de uma chave do Resend (uma linha, re_...)."
    fi
    log "Conferindo a chave de emissao, o certificado e as raizes, antes de qualquer coisa sair do runner"
    node "$CLOUD_DIR/licencas-chave.mjs"
    install_hcloud; deploy_key
    licencas_alvo
    fw_open_ssh "$LICENCAS_NAME"; wait_ssh "$target"
    log "Segredos do Emissor em $SEG (donos 1000:1000, o usuario node do container; 0400)"
    rsh "$target" "sudo install -d -m 755 -o '$DEPLOY_USER' -g '$DEPLOY_USER' '$LICENCAS_EMISSOR_DIR' && sudo install -d -m 700 -o '$DEPLOY_USER' -g '$DEPLOY_USER' '$SEG'"
    grava() {  # grava ARQUIVO VARIAVEL: o valor, pelo stdin do SSH, num arquivo novo que troca o anterior de uma vez
        printf '%s' "${!2}" | rsh "$target" "sudo sh -c 'umask 077; t=\$(mktemp \"$SEG/.novo.XXXXXX\") && cat > \"\$t\" && chown 1000:1000 \"\$t\" && chmod 400 \"\$t\" && mv -f \"\$t\" \"$SEG/$1\"'"
        echo "  segredos/$1 ($2)"
    }
    grava emissao.pem LICENCAS_EMISSAO_CHAVE
    grava emissao-senha LICENCAS_EMISSAO_SENHA
    grava emissao-certificado.json LICENCAS_EMISSAO_CERTIFICADO
    if [ -n "${LICENCAS_RESEND_CHAVE:-}" ]; then
        grava resend-chave LICENCAS_RESEND_CHAVE
    else
        # O compose do Emissor monta o arquivo sempre: sem o segredo, fica o que ja esta no servidor ou um arquivo vazio.
        rsh "$target" "sudo sh -c 'test -s \"$SEG/resend-chave\" && echo \"  segredos/resend-chave (ja existia; mantida)\" || { umask 077; : > \"$SEG/resend-chave\" && chown 1000:1000 \"$SEG/resend-chave\" && chmod 400 \"$SEG/resend-chave\" && echo \"  segredos/resend-chave (vazia)\"; }'"
        warn "LICENCAS_RESEND_CHAVE vazio: sem a chave do Resend o Painel nao sobe e os avisos ao produtor nao saem (docs/32 §11.2). O deploy-licencas so passa sem ela com LICENCAS_SEM_PAINEL=sim, ou com uma chave que ja estava no servidor."
    fi
    # A senha do banco: o Postgres so le o arquivo na primeira subida. Trocar o arquivo de um banco que ja existe, sem
    # trocar a senha dentro dele, deixaria o Emissor sem banco.
    if [ -n "${LICENCAS_BANCO_SENHA:-}" ]; then
        local novo atual
        novo=$(printf '%s' "$LICENCAS_BANCO_SENHA" | sha256sum | cut -c1-64)
        atual=$(rsh "$target" "sudo sh -c 'if [ -f \"$SEG/postgres-senha\" ]; then sha256sum < \"$SEG/postgres-senha\" | cut -c1-64; fi'")
        if [ -z "$atual" ]; then
            grava postgres-senha LICENCAS_BANCO_SENHA
        elif [ "$atual" = "$novo" ]; then
            echo "  segredos/postgres-senha (igual a LICENCAS_BANCO_SENHA; mantida)"
        elif ! rsh "$target" "docker volume inspect bunker-licensing_banco >/dev/null 2>&1"; then
            grava postgres-senha LICENCAS_BANCO_SENHA
        elif [ "${TROCAR_SENHA_BANCO:-}" = "sim" ]; then
            log "Trocando a senha do usuario emissor dentro do banco antes do arquivo (TROCAR_SENHA_BANCO=sim)"
            printf "alter role emissor password '%s';\n" "$LICENCAS_BANCO_SENHA" \
                | rsh "$target" "cd '$LICENCAS_EMISSOR_DIR' && docker compose exec -T postgres psql -U emissor -d emissor -v ON_ERROR_STOP=1 -q"
            grava postgres-senha LICENCAS_BANCO_SENHA
        else
            die "O banco do Emissor ja existe com outra senha (segredos/postgres-senha diferente de LICENCAS_BANCO_SENHA). O Postgres so le o arquivo na primeira subida: para trocar a senha, rode de novo com TROCAR_SENHA_BANCO=sim, que muda a senha dentro do banco antes do arquivo."
        fi
    else
        # Sem o segredo: a senha nasce no servidor, uma vez, e nunca sai dele.
        rsh "$target" "sudo sh -c 'test -s \"$SEG/postgres-senha\" && echo \"  segredos/postgres-senha (ja existia; mantida)\" || { umask 077; openssl rand -hex 24 | tr -d \"\\\\n\" > \"$SEG/postgres-senha\" && chown 1000:1000 \"$SEG/postgres-senha\" && chmod 400 \"$SEG/postgres-senha\" && echo \"  segredos/postgres-senha (gerada no servidor)\"; }'"
    fi
    rsh "$target" "sudo stat -c '  %n %U:%G %a' '$SEG'/* | sed 's#$SEG/#segredos/#'"

    log "Servicos do Emissor ja no ar: recriados com os arquivos novos (o container so ve o arquivo novo quando nasce de novo)"
    rsh "$target" "cd '$LICENCAS_EMISSOR_DIR' 2>/dev/null && [ -f compose.yaml ] && [ -n \"\$(docker compose ps -q --status running 2>/dev/null)\" ] || { echo '  nada no ar ainda: o deploy-licencas usa estes arquivos.'; exit 0; }; s=\$(docker compose config --services | grep -vx -e postgres -e migrar | tr '\\n' ' '); docker compose up -d --no-build --force-recreate --no-deps \$s && cd '$REMOTE_DIR' && bash infra/licencas/scripts/smoke.sh"
    fw_close_all
    echo "Proximo: deploy-licencas (se ainda nao rodou). A chave raiz nao passou por aqui e nunca passa (docs/32 §10)."
}

# ====== deploy-licencas =================================================================================
deploy() {
    need HCLOUD_TOKEN CLOUDFLARE_API_TOKEN GITHUB_TOKEN LICENCAS_RAIZES
    local painel_ips raizes_b64 config_b64 sb_user sb_host box porta_api porta_painel caddy rec kv
    printf '%s' "$LICENCAS_TAG" | grep -qE '^[A-Za-z0-9_][A-Za-z0-9._-]{0,100}$' || die "LICENCAS_TAG invalida: '$LICENCAS_TAG' (ex.: main ou sha-1a2b3c4)."
    painel_ips=$(small_cidrs LICENCAS_PAINEL_IPS "${LICENCAS_PAINEL_IPS:-$PRODUCER_IP}")
    raizes_b64=$(printf '%s' "$LICENCAS_RAIZES" | base64 -w0)
    log "Painel de licencas, conta de envio, chaves anteriores e links do Emissor (docs/20 §8C.5)"
    config_emissor "$WORK_DIR/config-emissor.b64"
    config_b64=$(cat "$WORK_DIR/config-emissor.b64")
    install_hcloud; deploy_key
    licencas_alvo
    log "DNS dos dois nomes (etapa dns-licencas)"
    licencas_dns_confere
    echo "  $LICENCAS_API_DOMAIN (sem proxy) e $LICENCAS_PAINEL_DOMAIN (com proxy) -> $ip, so registro A."
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

    log "Borda (Caddy): $LICENCAS_API_DOMAIN e $LICENCAS_PAINEL_DOMAIN"
    porta_api=$(get_env "$target" "$LICENCAS_EMISSOR_DIR/.env" EMISSOR_PORTA_NO_HOST); porta_api="${porta_api:-8080}"
    porta_painel=$(get_env "$target" "$LICENCAS_EMISSOR_DIR/.env" PAINEL_PORTA_NO_HOST); porta_painel="${porta_painel:-8081}"
    set_env "$target" "$ENVL" LICENCAS_API_DOMAIN "$LICENCAS_API_DOMAIN"
    set_env "$target" "$ENVL" LICENCAS_PAINEL_DOMAIN "$LICENCAS_PAINEL_DOMAIN"
    set_env "$target" "$ENVL" EMISSOR_PORTA_NO_HOST "$porta_api"
    set_env "$target" "$ENVL" PAINEL_PORTA_NO_HOST "$porta_painel"
    set_env "$target" "$ENVL" ACME_EMAIL "$PRODUCER_EMAIL"
    if [ -n "$painel_ips" ]; then
        set_env "$target" "$ENVL" LICENCAS_PAINEL_IPS "$painel_ips"
    elif [ -z "$(get_env "$target" "$ENVL" LICENCAS_PAINEL_IPS)" ]; then
        set_env "$target" "$ENVL" LICENCAS_PAINEL_IPS 127.0.0.1/32
        warn "Sem LICENCAS_PAINEL_IPS nem PRODUCER_IP nas opcoes: ninguem abre o Painel ate um deploy-licencas com a lista."
    fi
    echo "  API -> 127.0.0.1:$porta_api; Painel -> 127.0.0.1:$porta_painel; Painel so para: $(get_env "$target" "$ENVL" LICENCAS_PAINEL_IPS)"
    caddy="docker compose -f infra/licencas/docker-compose.yml"
    # A configuracao e conferida num container de uma vez antes de valer; depois o Caddy sobe (ou e recriado, se o .env
    # mudou) e recarrega o Caddyfile novo, com algumas tentativas enquanto ele acaba de subir.
    remote "$caddy pull --quiet && $caddy run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && $caddy up -d && for i in 1 2 3 4 5 6 7 8 9 10; do $caddy exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile && break; [ \$i != 10 ] || exit 1; sleep 2; done"

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
    fw_close_all

    log "Conferencia de fora (DNS, certificado, Caddy e Emissor)"
    publico_ok || warn "https://$LICENCAS_API_DOMAIN/health ainda nao respondeu {\"ok\":true} de fora. O Emissor responde no servidor; o certificado pode levar alguns minutos depois do primeiro deploy: rode status-licencas daqui a pouco."
    echo
    if [ "${LICENCAS_SEM_PAINEL:-}" = sim ]; then
        echo "Emissor no ar: https://$LICENCAS_API_DOMAIN (API das Instalacoes), sem o Painel (LICENCAS_SEM_PAINEL=sim)."
    else
        echo "Emissor no ar: https://$LICENCAS_API_DOMAIN (API das Instalacoes) e https://$LICENCAS_PAINEL_DOMAIN (Painel, so com o Access e a lista de IPs)."
        echo "A primeira conta do Painel, uma vez (docs/20 §8C.3): exec-licencas com o comando"
        echo "  cd emissor && docker compose exec -T emissor node bin/painel.ts adicionar <e-mail do login do Access> --funcao produtor --motivo \"Primeira conta\""
    fi
    echo "Falta, se ainda nao foi feito: ensaio-licencas (o ensaio de restauracao) e o monitor externo (docs/20 §8C)."
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
        log "DNS (o Painel com proxy, a API sem; so registro A)"
        local zone fqdn registros
        zone=$(cf_zone_id)
        for fqdn in "$LICENCAS_PAINEL_DOMAIN" "$LICENCAS_API_DOMAIN"; do
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
    printf '  %-60s %s (esperado 302 para o login do Access, ou 403)\n' "https://$LICENCAS_PAINEL_DOMAIN/" "${code:-000}"
    if [ -n "${SSH:-}" ] && [ -n "$existe" ]; then
        deploy_key
        licencas_alvo
        log "$LICENCAS_NAME por dentro"
        fw_open_ssh "$LICENCAS_NAME"; wait_ssh "$target" 10
        rsh "$target" "cd '$REMOTE_DIR' 2>/dev/null && echo \"  commit da infra: \$(cat .deployed-commit 2>/dev/null)\"; docker ps --format '  {{.Names}}\t{{.Status}}'; free -h | sed 's/^/  /'; df -h / | sed 's/^/  /'; bash infra/licencas/scripts/smoke.sh" || warn "a conferencia por dentro falhou (veja acima)."
        fw_close_all
    fi
}

"$acao"

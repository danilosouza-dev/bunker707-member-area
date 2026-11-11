#!/usr/bin/env bash
# Implanta ou atualiza o Emissor de licencas no servidor bunker707-licencas (docs/20 §8C), a partir da imagem que o CI
# do bunker-licensing publica no GHCR. A etapa deploy-licencas (infra/cloud/licencas.sh) chama este script como deploy,
# em /opt/bunker707, logo depois do `docker login` com o token efemero do job:
#   bash infra/licencas/scripts/implantar.sh --imagem=ghcr.io/<dono>/bunker-licensing:<tag> --raizes-b64=<base64> \
#       --config-b64=<base64>
# Antes de mudar qualquer coisa: as raizes e a configuracao que o deploy-licencas montou no formato, e os segredos em
# /opt/bunker707/emissor/segredos (etapa secrets-licencas): a senha do banco, a chave de emissao, a senha dela, o
# certificado e o arquivo da chave do Resend, que o compose do Emissor monta sempre e que, com o Painel, precisa ter a
# chave. Faltou algum, para sem tocar no que esta no ar. Passos:
#   1. a imagem <tag>-implantacao (sem programa, so arquivos) traz o compose.yaml e o .env.example do mesmo commit, que
#      vao para /opt/bunker707/emissor (o compose anterior fica em compose.yaml.anterior);
#   2. o .env do compose ganha as variaveis novas do .env.example (as que ja existem ficam como estao; a que la so traz
#      um exemplo entre < e > entra vazia, nunca o exemplo) e, a cada rodada, o que o deploy decide: EMISSOR_RAIZES; o
#      Painel, a conta de envio, as chaves anteriores e os links (--config-b64: PAINEL_ENDERECO, PAINEL_ACCESS_EQUIPE,
#      PAINEL_ACCESS_AUD, PAINEL_TETO_DIARIO, EMISSOR_EMAIL_PRODUTOR, EMISSOR_EMAIL_REMETENTE, EMISSOR_KIDS_ANTERIORES,
#      EMISSOR_LINK_RENOVAR e EMISSOR_LINK_LOJA; com o endereco, o Access e os dois e-mails vazios, o Emissor sobe sem
#      o Painel); e os proxies confiaveis das duas portas, iguais ao caminho do Caddy (caddy/Caddyfile): so o gateway da
#      rede borda (EMISSOR_GATEWAY_BORDA, por onde o Caddy chega) e o X-Forwarded-For, em que o Caddy escreve um IP so;
#   3. a imagem do Emissor e puxada e ganha o nome local que o compose dele usa nos servicos com build (hoje
#      bunker-licensing-emissor:local): nada e construido no servidor;
#   4. o Postgres sobe, as migracoes rodam (o servico migrar: `npm run migrate` no container) e o resto sobe;
#   5. /health responde {"ok":true} na porta local do Emissor (EMISSOR_PORTA_NO_HOST do .env dele).
# Nada aqui imprime segredo.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/_env.sh"

imagem=""; raizes_b64=""; config_b64=""
for arg in "$@"; do
    case "$arg" in
        --imagem=*) imagem="${arg#*=}" ;;
        --raizes-b64=*) raizes_b64="${arg#*=}" ;;
        --config-b64=*) config_b64="${arg#*=}" ;;
        -h|--help) sed -n 2,25p "$0"; exit 0 ;;
        *) die "opcao desconhecida: $arg" ;;
    esac
done
printf '%s' "$imagem" | grep -qE '^[a-z0-9][a-z0-9./_-]*:[A-Za-z0-9_][A-Za-z0-9._-]{0,100}$' \
    || die "--imagem precisa ser <repositorio>:<tag> (ex.: ghcr.io/dono/bunker-licensing:main); veio '$imagem'."
[ -n "$raizes_b64" ] || die "--raizes-b64 vazio: as raizes publicas (LICENCAS_RAIZES) sao obrigatorias."
[ -n "$config_b64" ] || die "--config-b64 vazio: o Painel, a conta de envio, as chaves anteriores e os links, que o deploy-licencas monta (docs/20 §8C.5)."
MIGRAR_SERVICE="${LICENCAS_MIGRAR_SERVICE:-migrar}"
cd "$LICENCAS_EMISSOR_DIR"

# As raizes e o JSON do deploy no formato antes de tudo: o JSON traz as nove variaveis, cada uma um texto de uma linha, e
# o Painel inteiro ou nada (o deploy-licencas ja conferiu cada valor). Diz se o Painel sobe.
painel=$(python3 -I - "$raizes_b64" "$config_b64" <<'PY'
import base64, json, re, sys
GERIDAS = ["EMISSOR_EMAIL_PRODUTOR", "EMISSOR_EMAIL_REMETENTE", "EMISSOR_KIDS_ANTERIORES", "EMISSOR_LINK_LOJA",
           "EMISSOR_LINK_RENOVAR", "PAINEL_ACCESS_AUD", "PAINEL_ACCESS_EQUIPE", "PAINEL_ENDERECO", "PAINEL_TETO_DIARIO"]
def b64_json(text):
    try:
        return json.loads(base64.b64decode(text, validate=True).decode("utf-8"))
    except ValueError:
        return None
raizes = b64_json(sys.argv[1])
if not (isinstance(raizes, list) and 1 <= len(raizes) <= 4 and all(
        isinstance(r, dict) and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", str(r.get("rid", ""))) and re.fullmatch(r"[A-Za-z0-9_-]{43}", str(r.get("publicKey", "")))
        for r in raizes)):
    sys.exit('ERRO: LICENCAS_RAIZES precisa ser a lista JSON de 1 a 4 raizes da cerimonia: [{"rid":"...","publicKey":"..."}].')
config = b64_json(sys.argv[2])
if config is None:
    sys.exit("ERRO: --config-b64 nao e o JSON em base64 que o deploy-licencas monta.")
if not isinstance(config, dict) or sorted(config) != GERIDAS or not all(
        isinstance(v, str) and not re.search(r"[\x00-\x1f\x7f'\"`$\\]", v) for v in config.values()):
    sys.exit("ERRO: --config-b64 fora do formato: " + ", ".join(GERIDAS) + ", cada uma um texto de uma linha, sem aspas, $, crase nem barra invertida.")
painel = [config[k] for k in ("PAINEL_ENDERECO", "PAINEL_ACCESS_EQUIPE", "PAINEL_ACCESS_AUD", "EMISSOR_EMAIL_PRODUTOR", "EMISSOR_EMAIL_REMETENTE")]
if any(painel) and not all(painel):
    sys.exit("ERRO: o Painel precisa de PAINEL_ENDERECO, PAINEL_ACCESS_EQUIPE, PAINEL_ACCESS_AUD, EMISSOR_EMAIL_PRODUTOR e EMISSOR_EMAIL_REMETENTE juntos; sem o Painel, todos vazios.")
print("sim" if all(painel) else "nao")
PY
)

# Os segredos antes de tudo: sem eles nada muda (nem o compose, nem o .env, nem a imagem).
for f in postgres-senha emissao.pem emissao-senha emissao-certificado.json; do
    [ -s "segredos/$f" ] || die "Falta segredos/$f no servidor: rode a etapa secrets-licencas antes do deploy-licencas."
done
if [ "$painel" = sim ]; then
    [ -s segredos/resend-chave ] || die "Falta a chave do Resend em segredos/resend-chave: com o Painel, o Emissor precisa da conta de envio (o aviso ao produtor de toda acao que da valor sem venda). Cadastre o segredo LICENCAS_RESEND_CHAVE e rode secrets-licencas, ou rode o deploy-licencas com LICENCAS_SEM_PAINEL=sim."
else
    [ -e segredos/resend-chave ] || die "Falta segredos/resend-chave no servidor (o compose do Emissor monta o arquivo mesmo sem o Painel; vazio serve): rode a etapa secrets-licencas antes do deploy-licencas."
fi

cid=""; tmp=$(mktemp -d)
trap 'rm -rf "$tmp"; [ -z "$cid" ] || docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT
dica_ghcr="Confira: o CI do bunker-licensing publica a imagem e os arquivos de implantacao no GHCR (docs/20 §8C.2), e o pacote dele da leitura ao bunker707-member-area (GitHub, pacote bunker-licensing > Package settings > Manage Actions access)."

log "1/5 Arquivos de implantacao ($imagem-implantacao)"
docker pull --quiet "$imagem-implantacao" >/dev/null || die "Nao consegui puxar $imagem-implantacao. $dica_ghcr"
# Imagem sem programa: o container so e criado (nunca roda) para copiar os arquivos.
cid=$(docker create "$imagem-implantacao" /nada)
docker cp "$cid:/implantacao/." "$tmp/"
docker rm -f "$cid" >/dev/null; cid=""
for f in compose.yaml .env.example; do
    [ -s "$tmp/$f" ] || die "A imagem $imagem-implantacao nao trouxe /implantacao/$f."
done
[ ! -f compose.yaml ] || cp -p compose.yaml compose.yaml.anterior
install -m 644 "$tmp/compose.yaml" compose.yaml
install -m 644 "$tmp/.env.example" .env.example

log "2/5 .env do compose do Emissor (variaveis novas do .env.example, raizes, Painel, conta de envio e proxies)"
python3 -I - "$LICENCAS_EMISSOR_DIR/.env" "$LICENCAS_EMISSOR_DIR/.env.example" "$raizes_b64" "$config_b64" <<'PY'
import base64, ipaddress, json, os, re, sys
path, example_path, raizes_b64, config_b64 = sys.argv[1:5]
os.umask(0o077)
raizes = json.loads(base64.b64decode(raizes_b64).decode("utf-8"))
config = json.loads(base64.b64decode(config_b64).decode("utf-8"))
line_key = re.compile(r"^([A-Z][A-Z0-9_]*)=(.*)$")
lines = open(path, encoding="utf-8").read().split("\n") if os.path.exists(path) else []
while lines and lines[-1] == "":
    lines.pop()
present = {m.group(1) for m in map(line_key.match, lines) if m}
GERIDAS_AQUI = ["EMISSOR_RAIZES", "EMISSOR_PROXIES_CONFIAVEIS", "EMISSOR_CABECALHO_IP", "PAINEL_PROXIES_CONFIAVEIS", "PAINEL_CABECALHO_IP"]
geridas = set(config) | set(GERIDAS_AQUI)
added, vazias = [], []
for line in open(example_path, encoding="utf-8").read().split("\n"):
    m = line_key.match(line)
    if not m or m.group(1) in present:
        continue
    key, value = m.groups()
    # So um exemplo (<...>): entra vazia, para o Emissor nunca subir com o texto do exemplo.
    if key not in geridas and re.search(r"<[^<>]*>", value):
        line = key + "="
        vazias.append(key)
    lines.append(line); present.add(key); added.append(key)

def atual(key):
    for line in lines:
        m = line_key.match(line)
        if m and m.group(1) == key:
            text = m.group(2).strip()
            if len(text) >= 2 and text[0] == text[-1] and text[0] in "'\"":
                return text[1:-1].strip()
            return re.sub(r"\s+#.*$", "", text)
    return ""

# As duas portas recebem do Caddy (caddy/Caddyfile), que chega pelo gateway da rede borda do compose do Emissor e escreve
# um IP so no X-Forwarded-For: na API, o da conexao; no Painel, o que a Cloudflare repassa, aceito so das faixas dela.
# Por isso nenhuma das duas listas leva as faixas da Cloudflare.
gateway = atual("EMISSOR_GATEWAY_BORDA") or "172.30.70.1"
try:
    ipaddress.ip_address(gateway)
except ValueError:
    sys.exit(f"ERRO: EMISSOR_GATEWAY_BORDA no .env do Emissor nao e um IP (veio {gateway}): e o gateway da rede borda, por onde o Caddy chega ao Emissor.")
valores = {"EMISSOR_RAIZES": json.dumps([{"rid": r["rid"], "publicKey": r["publicKey"]} for r in raizes], separators=(",", ":"))}
valores.update(config)
valores.update({"EMISSOR_PROXIES_CONFIAVEIS": gateway, "EMISSOR_CABECALHO_IP": "x-forwarded-for",
                "PAINEL_PROXIES_CONFIAVEIS": gateway, "PAINEL_CABECALHO_IP": "x-forwarded-for"})
linha = lambda key: f"{key}='{valores[key]}'" if valores[key] else f"{key}="
saida, vistas = [], set()
for line in lines:
    m = line_key.match(line)
    if m and m.group(1) in valores:
        if m.group(1) in vistas:
            continue  # a mesma variavel repetida: fica so a primeira linha, com o valor do deploy
        vistas.add(m.group(1))
        line = linha(m.group(1))
    saida.append(line)
saida += [linha(key) for key in valores if key not in vistas]
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    fh.write("\n".join(saida) + "\n")
os.chmod(tmp, 0o600); os.replace(tmp, path)
print("  variaveis novas vindas do .env.example: " + (", ".join(added) if added else "nenhuma")
      + (" (entraram vazias, so com o exemplo: " + ", ".join(vazias) + ")" if vazias else ""))
print("  EMISSOR_RAIZES: " + ", ".join(r["rid"] for r in raizes))
if config["PAINEL_ENDERECO"]:
    print(f"  Painel: ligado em {config['PAINEL_ENDERECO']} (Access de {config['PAINEL_ACCESS_EQUIPE']}; teto de {config['PAINEL_TETO_DIARIO']} acoes sem venda por dia), com os avisos ao produtor pelo Resend")
else:
    print("  Painel: desligado (LICENCAS_SEM_PAINEL=sim); nenhum e-mail sai do Emissor")
print("  chaves anteriores aceitas na readocao: " + (config["EMISSOR_KIDS_ANTERIORES"] or "nenhuma (so a atual)"))
links = [nome for nome, key in (("Renovar", "EMISSOR_LINK_RENOVAR"), ("loja", "EMISSOR_LINK_LOJA")) if config[key]]
print("  enderecos na licenca: " + (" e ".join(links) if links else "nenhum (sem Renovar nem loja)"))
print(f"  proxies confiaveis da API e do Painel: {gateway}, o gateway da rede borda (o Caddy), com o X-Forwarded-For")
PY

log "3/5 Imagem do Emissor ($imagem)"
docker pull --quiet "$imagem" >/dev/null || die "Nao consegui puxar $imagem. $dica_ghcr"
digest=$(docker image inspect --format '{{index .RepoDigests 0}}' "$imagem")
# Os servicos com build no compose do Emissor (o emissor e o migrar; o Painel e o mesmo processo do emissor, noutra
# porta) usam a imagem local que o compose dele nomeia: ela passa a ser a do GHCR, e nada e construido nem puxado de
# outro lugar (o up vai com --no-build, e o run do migrar com --pull never).
locais=$(compose config --format json | python3 -I -c 'import json, sys; c = json.load(sys.stdin); print("\n".join(sorted({s["image"] for s in c["services"].values() if s.get("build") and s.get("image")})))')
[ -n "$locais" ] || die "O compose.yaml do Emissor nao tem servico com build e image (esperava bunker-licensing-emissor:local)."
for nome in $locais; do docker tag "$imagem" "$nome"; echo "  $nome -> $digest"; done
printf '%s\n' "$digest" > .imagem
printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$imagem" "$digest" >> .imagens

log "4/5 Banco, migracoes (npm run migrate no container) e o Emissor"
compose up -d --no-build "$LICENCAS_PG_SERVICE"
wait_healthy "$LICENCAS_PG_SERVICE" 120
compose run --rm --pull never "$MIGRAR_SERVICE"
compose up -d --no-build --remove-orphans
wait_healthy "$LICENCAS_EMISSOR_SERVICE" 180

log "5/5 Saude do Emissor ($digest)"
emissor_saude
compose ps --format '  {{.Service}}\t{{.State}}\t{{.Status}}'

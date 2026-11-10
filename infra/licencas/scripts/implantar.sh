#!/usr/bin/env bash
# Implanta ou atualiza o Emissor de licencas no servidor bunker707-licencas (docs/20 §8C), a partir da imagem que o CI
# do bunker-licensing publica no GHCR. A etapa deploy-licencas (infra/cloud/licencas.sh) chama este script como deploy,
# em /opt/bunker707, logo depois do `docker login` com o token efemero do job:
#   bash infra/licencas/scripts/implantar.sh --imagem=ghcr.io/<dono>/bunker-licensing:<tag> --raizes-b64=<base64>
# Passos:
#   1. a imagem <tag>-implantacao (sem programa, so arquivos) traz o compose.yaml e o .env.example do mesmo commit, que
#      vao para /opt/bunker707/emissor (o compose anterior fica em compose.yaml.anterior);
#   2. o .env do compose ganha as variaveis novas do .env.example (as que ja existem ficam como estao) e as raizes
#      publicas em EMISSOR_RAIZES;
#   3. a imagem do Emissor e puxada e ganha o nome local que o compose dele usa nos servicos com build (hoje
#      bunker-licensing-emissor:local): nada e construido no servidor;
#   4. o Postgres sobe, as migracoes rodam (o servico migrar: `npm run migrate` no container) e o resto sobe;
#   5. /health responde {"ok":true} na porta local do Emissor (EMISSOR_PORTA_NO_HOST do .env dele).
# A senha do banco, a chave de emissao, a senha dela e o certificado ja estao em /opt/bunker707/emissor/segredos (etapa
# secrets-licencas). Nada aqui imprime segredo.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/_env.sh"

imagem=""; raizes_b64=""
for arg in "$@"; do
    case "$arg" in
        --imagem=*) imagem="${arg#*=}" ;;
        --raizes-b64=*) raizes_b64="${arg#*=}" ;;
        -h|--help) sed -n 2,19p "$0"; exit 0 ;;
        *) die "opcao desconhecida: $arg" ;;
    esac
done
printf '%s' "$imagem" | grep -qE '^[a-z0-9][a-z0-9./_-]*:[A-Za-z0-9_][A-Za-z0-9._-]{0,100}$' \
    || die "--imagem precisa ser <repositorio>:<tag> (ex.: ghcr.io/dono/bunker-licensing:main); veio '$imagem'."
[ -n "$raizes_b64" ] || die "--raizes-b64 vazio: as raizes publicas (LICENCAS_RAIZES) sao obrigatorias."
MIGRAR_SERVICE="${LICENCAS_MIGRAR_SERVICE:-migrar}"
cd "$LICENCAS_EMISSOR_DIR"

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

log "2/5 .env do compose do Emissor (variaveis novas do .env.example e EMISSOR_RAIZES)"
python3 -I - "$LICENCAS_EMISSOR_DIR/.env" "$LICENCAS_EMISSOR_DIR/.env.example" "$raizes_b64" <<'PY'
import base64, json, os, re, sys
path, example_path, raizes_b64 = sys.argv[1:4]
os.umask(0o077)
raizes = json.loads(base64.b64decode(raizes_b64).decode("utf-8"))
ok = isinstance(raizes, list) and 1 <= len(raizes) <= 4 and all(
    isinstance(r, dict) and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", str(r.get("rid", ""))) and re.fullmatch(r"[A-Za-z0-9_-]{43}", str(r.get("publicKey", "")))
    for r in raizes)
if not ok:
    sys.exit('ERRO: LICENCAS_RAIZES precisa ser a lista JSON de 1 a 4 raizes da cerimonia: [{"rid":"...","publicKey":"..."}].')
line_key = re.compile(r"^([A-Z][A-Z0-9_]*)=")
lines = open(path, encoding="utf-8").read().split("\n") if os.path.exists(path) else []
while lines and lines[-1] == "":
    lines.pop()
present = {m.group(1) for m in map(line_key.match, lines) if m}
added = []
for line in open(example_path, encoding="utf-8").read().split("\n"):
    m = line_key.match(line)
    if m and m.group(1) not in present:
        lines.append(line); present.add(m.group(1)); added.append(m.group(1))
value = "EMISSOR_RAIZES='" + json.dumps([{"rid": r["rid"], "publicKey": r["publicKey"]} for r in raizes], separators=(",", ":")) + "'"
lines = [value if line.startswith("EMISSOR_RAIZES=") else line for line in lines]
if "EMISSOR_RAIZES" not in present:
    lines.append(value)
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines) + "\n")
os.chmod(tmp, 0o600); os.replace(tmp, path)
print("  variaveis novas vindas do .env.example: " + (", ".join(added) if added else "nenhuma"))
print("  EMISSOR_RAIZES: " + ", ".join(r["rid"] for r in raizes))
PY

log "3/5 Imagem do Emissor ($imagem)"
docker pull --quiet "$imagem" >/dev/null || die "Nao consegui puxar $imagem. $dica_ghcr"
digest=$(docker image inspect --format '{{index .RepoDigests 0}}' "$imagem")
# Os servicos com build no compose do Emissor (o emissor, o migrar e, quando vier, o Painel) usam a imagem local que o
# compose dele nomeia: ela passa a ser a do GHCR, e nada e construido nem puxado de outro lugar (o up vai com
# --no-build, e o run do migrar com --pull never).
locais=$(compose config --format json | python3 -I -c 'import json, sys; c = json.load(sys.stdin); print("\n".join(sorted({s["image"] for s in c["services"].values() if s.get("build") and s.get("image")})))')
[ -n "$locais" ] || die "O compose.yaml do Emissor nao tem servico com build e image (esperava bunker-licensing-emissor:local)."
for nome in $locais; do docker tag "$imagem" "$nome"; echo "  $nome -> $digest"; done
printf '%s\n' "$digest" > .imagem
printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$imagem" "$digest" >> .imagens

log "4/5 Banco, migracoes (npm run migrate no container) e o Emissor"
for f in postgres-senha emissao.pem emissao-senha emissao-certificado.json; do
    [ -s "segredos/$f" ] || die "Falta segredos/$f no servidor: rode a etapa secrets-licencas antes do deploy-licencas."
done
compose up -d --no-build "$LICENCAS_PG_SERVICE"
wait_healthy "$LICENCAS_PG_SERVICE" 120
compose run --rm --pull never "$MIGRAR_SERVICE"
compose up -d --no-build --remove-orphans
wait_healthy "$LICENCAS_EMISSOR_SERVICE" 180

log "5/5 Saude do Emissor ($digest)"
emissor_saude
compose ps --format '  {{.Service}}\t{{.State}}\t{{.Status}}'

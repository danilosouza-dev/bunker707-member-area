#!/usr/bin/env bash
# A credencial da API interna da nossa escola no Emissor (docs/api-interna.md do bunker-licensing; docs/20 §8C.9), pela
# etapa conectar-licencas (infra/cloud/licencas.sh), no servidor do Emissor, como deploy, em /opt/bunker707:
#   bash infra/licencas/scripts/credencial-interna.sh --conferir
#   printf '%s\n' <resumo> | bash infra/licencas/scripts/credencial-interna.sh [--so-a-nova]
# So o RESUMO da credencial nova chega aqui (SHA-256 em hexadecimal, pela entrada); a credencial nunca vem a este servidor.
#   --conferir   so confere, sem mudar nada: o Emissor implantado com a API interna (o compose.yaml dele le
#                INTERNO_CREDENCIAL_HASH e publica INTERNO_PORTA_NO_HOST) e a conta de envio (sem ela o Emissor nao sobe
#                com a API interna ligada). O conectar-licencas roda antes de sortear a credencial.
#   sem opcao    INTERNO_CREDENCIAL_HASH no .env do compose do Emissor: o resumo novo primeiro e os anteriores depois, ate 4
#                (o limite do Emissor; o mais velho sai), para a escola nunca ficar sem acesso no meio da troca;
#   --so-a-nova  so o resumo novo: as credenciais anteriores deixam de valer (REVOGAR_ANTERIORES=sim, depois de a escola
#                conferir a nova, ou quando uma vazou).
# Depois, o Emissor e recriado com o .env novo e conferido (/health). Sem saude, o .env de antes volta e o Emissor e
# recriado com ele. Nada aqui imprime um resumo inteiro: so os 8 primeiros caracteres de cada um, para conferir.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/_env.sh"

modo=juntar
for arg in "$@"; do
    case "$arg" in
        --conferir) modo=conferir ;;
        --so-a-nova) modo=so-a-nova ;;
        -h|--help) sed -n 2,16p "$0"; exit 0 ;;
        *) die "opcao desconhecida: $arg" ;;
    esac
done
cd "$LICENCAS_EMISSOR_DIR"
emissor_env() { ENV_FILE="$LICENCAS_EMISSOR_DIR/.env" env_value "$1" ""; }

# 1. O Emissor com a API interna e com a conta de envio (o Emissor recusa subir com a API interna e sem e-mail).
[ -f compose.yaml ] && [ -f .env ] || die "O Emissor ainda nao foi implantado neste servidor: rode deploy-licencas da main antes do conectar-licencas."
grep -q 'INTERNO_CREDENCIAL_HASH' compose.yaml && grep -q 'INTERNO_PORTA_NO_HOST' compose.yaml \
    || die "O Emissor no ar nao tem a API interna (o compose.yaml dele nao le INTERNO_CREDENCIAL_HASH nem publica a porta dela): leve o bunker-licensing com a API interna a main de la e rode deploy-licencas."
[ -n "$(emissor_env EMISSOR_EMAIL_PRODUTOR)" ] && [ -n "$(emissor_env EMISSOR_EMAIL_REMETENTE)" ] && [ -s segredos/resend-chave ] \
    || die "A API interna precisa da conta de envio do Emissor (EMISSOR_EMAIL_PRODUTOR, EMISSOR_EMAIL_REMETENTE e a chave do Resend em segredos/resend-chave): rode secrets-licencas e o deploy-licencas sem LICENCAS_SEM_PAINEL=sim."
if [ "$modo" = conferir ]; then
    aceitas=$(emissor_env INTERNO_CREDENCIAL_HASH | tr ',' '\n' | tr -d ' ' | grep -ciE '^[0-9a-f]{64}$' || true)
    echo "  Emissor com a API interna e a conta de envio; hoje aceita ${aceitas:-0} credencial(is) da escola."
    exit 0
fi

# 2. O resumo novo, pela entrada (uma linha, 64 caracteres hexadecimais).
novo=""
IFS= read -r novo || true
novo=$(printf '%s' "$novo" | tr -d '[:space:]' | tr 'A-F' 'a-f')
printf '%s' "$novo" | grep -qE '^[0-9a-f]{64}$' || die "O resumo da credencial nova (64 caracteres hexadecimais) nao chegou pela entrada. Nada mudou."

# 3. INTERNO_CREDENCIAL_HASH no .env, de uma vez (0600), com o .env de antes guardado para voltar.
log "INTERNO_CREDENCIAL_HASH no .env do Emissor ($([ "$modo" = so-a-nova ] && echo 'so a credencial nova' || echo 'a nova e as anteriores, ate 4'))"
cp -p .env .env.antes-da-credencial
python3 -I - "$LICENCAS_EMISSOR_DIR/.env" "$novo" "$modo" <<'PY'
import os, re, sys
path, novo, modo = sys.argv[1:4]
os.umask(0o077)
MAXIMO = 4  # o Emissor aceita ate 4 resumos ao mesmo tempo (src/config.ts do bunker-licensing)
line_key = re.compile(r"^([A-Z][A-Z0-9_]*)=(.*)$")
lines = open(path, encoding="utf-8").read().split("\n")
while lines and lines[-1] == "":
    lines.pop()

def valor(text):
    text = text.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "'\"":
        return text[1:-1].strip()
    return re.sub(r"\s+#.*$", "", text)

antes = []
for line in lines:
    m = line_key.match(line)
    if m and m.group(1) == "INTERNO_CREDENCIAL_HASH":
        antes = [h.strip().lower() for h in valor(m.group(2)).split(",") if h.strip()]
        break
validos, fora = [], 0
for h in antes:
    if not re.fullmatch(r"[0-9a-f]{64}", h):
        fora += 1
    elif h != novo and h not in validos:
        validos.append(h)
anteriores = [] if modo == "so-a-nova" else validos[: MAXIMO - 1]
saem = [h for h in validos if h not in anteriores]
linha = "INTERNO_CREDENCIAL_HASH='" + ",".join([novo] + anteriores) + "'"
saida, feito = [], False
for line in lines:
    m = line_key.match(line)
    if m and m.group(1) == "INTERNO_CREDENCIAL_HASH":
        if feito:
            continue  # a mesma variavel repetida: fica so uma linha
        line, feito = linha, True
    saida.append(line)
if not feito:
    saida.append(linha)
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    fh.write("\n".join(saida) + "\n")
os.chmod(tmp, 0o600)
os.replace(tmp, path)
curto = lambda h: h[:8] + "..."
print(f"  a credencial nova ({curto(novo)})" + (f" e {len(anteriores)} anterior(es) ({', '.join(map(curto, anteriores))})" if anteriores else ", so ela"))
if saem:
    print(f"  deixam de valer: {len(saem)} credencial(is) anterior(es) ({', '.join(map(curto, saem))})")
if fora:
    print(f"AVISO: {fora} valor(es) fora do formato de um resumo sairam de INTERNO_CREDENCIAL_HASH (o Emissor nao subiria com eles).", file=sys.stderr)
PY

# 4. O Emissor recriado com o .env novo e conferido; sem saude, o .env de antes volta.
saudavel() { ( wait_healthy "$LICENCAS_EMISSOR_SERVICE" 180 && emissor_saude ); }
log "O Emissor recriado com o .env novo"
if compose up -d --no-build --no-deps --force-recreate "$LICENCAS_EMISSOR_SERVICE" && saudavel; then
    rm -f .env.antes-da-credencial
    echo "  pronto: o Emissor aceita a credencial nova."
    exit 0
fi
warn "O Emissor nao voltou saudavel com o .env novo: o .env de antes volta."
mv -f .env.antes-da-credencial .env
compose up -d --no-build --no-deps --force-recreate "$LICENCAS_EMISSOR_SERVICE" && saudavel || warn "O Emissor tambem nao voltou com o .env de antes: veja o registro acima (exec-licencas, docker compose logs emissor)."
die "A credencial nova nao entrou no Emissor (o registro acima diz o motivo); o .env de antes voltou. Nada mudou na escola."

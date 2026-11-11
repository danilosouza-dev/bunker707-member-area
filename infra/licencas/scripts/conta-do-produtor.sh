#!/usr/bin/env bash
# A conta do produtor no Painel de licencas (docs/32 D40; docs/20 §8C.3, passo 11), pelo deploy-licencas, no servidor do
# Emissor, como deploy, em /opt/bunker707:
#   printf '%s' "<e-mail>" | bash infra/licencas/scripts/conta-do-produtor.sh [--novo-link] [--mostrar-link-se-falhar]
# O e-mail chega pela entrada (nunca na linha de comando do runner) e sai de tudo o que este script escreve.
#   - Sem a conta: `bin/painel.ts adicionar <e-mail> --funcao produtor`, que poe na fila do Emissor o e-mail com o link de
#     uso unico para definir a senha (vale 60 minutos). Com a conta: nada, a nao ser com --novo-link (`redefinir-senha`,
#     um link novo pelo mesmo caminho).
#   - Depois, confere na fila (email_outbox, o tipo painel.link_de_senha) que o e-mail saiu. O link nunca aparece aqui
#     quando o e-mail sai. So quando ele nao sai, e so com --mostrar-link-se-falhar, um link novo aparece aqui, uma vez
#     (`redefinir-senha --mostrar-link`): o registro da etapa fica com ele, entao a opcao e so para quando nao ha outro
#     jeito (a conta de envio quebrada e o produtor sem o Painel).
# Codigos: 0 a conta existe e o link saiu (ou apareceu aqui); 3 o e-mail nao saiu; o codigo do bin/painel.ts quando ele
# falha.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/_env.sh"

novo=""; mostrar=""
for arg in "$@"; do
    case "$arg" in
        --novo-link) novo=1 ;;
        --mostrar-link-se-falhar) mostrar=1 ;;
        -h|--help) sed -n 2,20p "$0"; exit 0 ;;
        *) die "opcao desconhecida: $arg" ;;
    esac
done
e=$(head -c 320 | tr -d '\r\n' | tr 'A-Z' 'a-z')
printf '%s' "$e" | grep -qE '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' || die "falta o e-mail do produtor, pela entrada."

# tira: o e-mail do produtor sai do que vai para o registro da etapa.
tira() { awk -v e="$e" '{ l = tolower($0); while ((i = index(l, e)) > 0) { $0 = substr($0, 1, i - 1) "<e-mail do produtor>" substr($0, i + length(e)); l = tolower($0) } print }'; }
painel() {
    compose exec -T "$LICENCAS_EMISSOR_SERVICE" node bin/painel.ts "$@" </dev/null 2>&1 | tira | sed 's/^/  /'
    return "${PIPESTATUS[0]}"
}
# A situacao do e-mail de link mais novo para o produtor: pending, sending, sent ou failed (vazio: nenhum).
ultimo_link() {
    printf '%s\n' "select status from email_outbox where kind = 'painel.link_de_senha' and lower(to_address) = lower(:'e') order by id desc limit 1;" \
        | compose exec -T "$LICENCAS_PG_SERVICE" psql -U "$LICENCAS_PG_USER" -d "$LICENCAS_PG_DB" -X -At -v ON_ERROR_STOP=1 -v e="$e" 2>/dev/null | head -n1 || true
}

# As contas que existem (a primeira coluna do listar), sem grep -q num pipe (com pipefail, o fim cedo do grep viraria erro).
contas=$(compose exec -T "$LICENCAS_EMISSOR_SERVICE" node bin/painel.ts listar </dev/null 2>/dev/null | cut -f1 | tr 'A-Z' 'a-z' || true)
if case $'\n'"$contas"$'\n' in *$'\n'"$e"$'\n'*) true ;; *) false ;; esac; then
    if [ -z "$novo" ]; then
        echo "  A conta do produtor ja existe no Painel: nada a fazer (LICENCAS_NOVO_LINK=sim manda um link novo de senha)."
        exit 0
    fi
    painel redefinir-senha "$e" --motivo "Link novo pedido pelo deploy-licencas" || exit $?
else
    painel adicionar "$e" --funcao produtor --motivo "Primeira conta (deploy-licencas)" || exit $?
fi

# O Emissor envia a fila a cada 15 segundos; um erro do Resend vira nova tentativa em 1 minuto ou desistencia.
situacao=""
for ((i = 0; i < ${ESPERA_EMAIL_TENTATIVAS:-12}; i++)); do
    situacao=$(ultimo_link)
    case "$situacao" in
        sent) echo "  O link para definir a senha saiu por e-mail para o produtor (vale 60 minutos, uma vez so)."; exit 0 ;;
        failed) break ;;
    esac
    sleep "${ESPERA_EMAIL_INTERVALO:-10}"
done
warn "o e-mail com o link de senha nao saiu (situacao na fila: ${situacao:-nenhuma}). A conta de envio do Emissor (a chave do Resend e o remetente, docs/20 §8C.5) precisa de conserto."
if [ -n "$mostrar" ]; then
    echo "  LICENCAS_MOSTRAR_LINK=sim: um link novo, so desta vez e so porque o e-mail nao saiu (abra so voce; vale 60 minutos):"
    painel redefinir-senha "$e" --motivo "O e-mail do link nao saiu (deploy-licencas)" --mostrar-link || exit $?
    exit 0
fi
echo "  Depois de consertar, rode o deploy-licencas com LICENCAS_NOVO_LINK=sim (outro link, pelo e-mail). So se nao houver outro jeito,"
echo "  LICENCAS_MOSTRAR_LINK=sim mostra um link novo no registro da etapa, uma vez, quando o e-mail nao sai."
exit 3

#!/usr/bin/env bash
# A Licenca desta Instalacao pelo terminal (docs/32 §2.1 e §3.2; docs/20 §9D):
#   sudo membros licenca estado [--json]      a situacao: modo, se ja foi ativada, o degrau, a validade
#   sudo membros licenca ativar [--chave-arquivo ARQ | --da-entrada] [--json]
#                                             ativa com a Chave de ativacao: a conferencia inicial (que confere a Chave e
#                                             a vaga sem gastar) e depois a ativacao, as mesmas da tela Licenca
# A Chave e digitada sem eco, vem de um arquivo so do administrador (--chave-arquivo, 0600) ou da entrada (--da-entrada,
# o instalador). Nunca vai para a linha de comando, para a tela ou para o registro: vai pela entrada ao app, dentro do
# container (no-app.mjs), e o app chama as operacoes da licenca (src/server/licensing/operations.ts) pela rota interna
# /api/licenca/instalador, que so responde a pedido de dentro do servidor, com o token do tick. A tela Configuracoes >
# Licenca continua sendo o outro caminho, com a mesma Chave.
# Codigos de saida: 0 ativada (ou a situacao lida); 1 uso; 7 a Chave pede uma pessoa no terminal (ou --chave-arquivo);
# 52 a Chave nao vale (mal copiada, vencida, usada, de outro endereco) ou a Licenca nao esta ativa; 53 a vaga da
# Licenca esta em uso noutro endereco; 54 o Emissor de licencas nao respondeu; 55 outro motivo (a mensagem diz).
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: o script usa BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "${BASH_SOURCE[0]}")/lib-kit.sh"

sub=${1:-}
[ $# -eq 0 ] || shift
json=0
arquivo=""
da_entrada=0
while [ $# -gt 0 ]; do
    case "$1" in
        --json) json=1 ;;
        --chave-arquivo) [ $# -ge 2 ] || sair "$SAI_USO" "--chave-arquivo precisa de um arquivo."; arquivo=$2; shift ;;
        --chave-arquivo=*) arquivo=${1#*=} ;;
        --da-entrada) da_entrada=1 ;;
        -h|--help) sed -n 2,16p "$0"; exit 0 ;;
        *) sair "$SAI_USO" "opcao desconhecida: $1 (veja: membros licenca --help)" ;;
    esac
    shift
done
case "$sub" in
    estado|ativar) ;;
    -h|--help|ajuda) sed -n 2,16p "$0"; exit 0 ;;
    *) sair "$SAI_USO" "use: membros licenca estado | membros licenca ativar (veja --help)" ;;
esac

app_no_ar || sair 55 "O app nao esta no ar neste servidor (sudo docker compose ps): a Licenca e lida e ativada por ele."

# A saida para quem chamou: o JSON do app como veio, ou a frase.
mostrar() {
    local saida=$1 frase
    if [ "$json" = 1 ]; then printf '%s\n' "$saida"; return; fi
    frase=$(printf '%s' "$saida" | inst_py json-campo mensagem)
    [ -z "$frase" ] || printf '%s\n' "$frase"
}

if [ "$sub" = estado ]; then
    saida=$(printf '{}' | no_app licenca-estado) || { mostrar "$saida"; exit 55; }
    if [ "$json" = 1 ]; then printf '%s\n' "$saida"; exit 0; fi
    printf '%s' "$saida" | python3 -I -c '
import json, sys
d = json.load(sys.stdin)
if d.get("modo") == "off":
    print("Esta imagem nao pede licenca (modo off).")
    sys.exit(0)
if not d.get("ok", True):
    print(d.get("mensagem") or "Nao consegui ler a Licenca.")
    sys.exit(0)
print("Licenca: " + ("ativada" if d.get("ativada") else "ainda nao ativada"))
for chave, rotulo in (("degrau", "Degrau"), ("tipo", "Tipo"), ("validade", "Validade"), ("endereco", "Endereco da licenca"), ("ultima_conferencia", "Ultima conferencia")):
    if d.get(chave):
        print(f"{rotulo}: {d[chave]}")
'
    exit 0
fi

# ativar: a Chave, de onde vier, so passa pela entrada (nunca pela linha de comando nem pela tela).
pasta=$(mktemp -d "${KIT_PASTA_TEMPORARIA:-/dev/shm}/kit-licenca.XXXXXX" 2>/dev/null || mktemp -d)
chmod 700 "$pasta"
trap 'find "$pasta" -type f -exec shred -u {} + 2>/dev/null || true; rm -rf -- "$pasta"' EXIT
if [ -n "$arquivo" ]; then
    [ -f "$arquivo" ] && [ -r "$arquivo" ] || sair "$SAI_USO" "Nao consigo ler $arquivo."
    case "$(stat -c %a "$arquivo")" in 600|400) ;; *) sair "$SAI_USO" "$arquivo pode ser lido por outros usuarios: deixe so o administrador ler (chmod 600) e rode de novo." ;; esac
    inst_py json-da-chave < "$arquivo" > "$pasta/pedido" || exit 52
elif [ "$da_entrada" = 1 ]; then
    inst_py json-da-chave > "$pasta/pedido" || exit 52
else
    [ -t 0 ] || sair "$SAI_TERMINAL" "A Chave de ativacao e digitada por uma pessoa no terminal (ou vem de --chave-arquivo, so do administrador)."
    IFS= read -rs -p 'Chave de ativacao (comeca com BKA-; nao aparece na tela): ' digitada || true
    printf '\n' >&2
    printf '%s' "$digitada" | inst_py json-da-chave > "$pasta/pedido" || exit 52
    digitada=""
fi

rc=0
saida=$(no_app licenca-ativar < "$pasta/pedido") || rc=$?
codigo=$(printf '%s' "$saida" | inst_py json-campo codigo)
mostrar "$saida"
[ "$rc" = 0 ] || exit 55
case "$codigo" in
    ativada) exit 0 ;;
    chave_invalida|chave_vencida|chave_usada|chave_de_outro_endereco|chave_mal_formada|licenca_indisponivel) exit 52 ;;
    vaga_em_uso|endereco_em_uso|endereco_ja_largado|limite_de_mudancas) exit 53 ;;
    sem_resposta|indisponivel|erro_interno|limite_de_pedidos|resposta_invalida) exit 54 ;;
    *) exit 55 ;;
esac

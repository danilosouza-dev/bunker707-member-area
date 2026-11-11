#!/usr/bin/env bash
# Situacao do backup, do kit de recuperacao, do ensaio e da restauracao (docs/32 §3.2; docs/20 §9B):
#   membros status          em portugues, com o que pede atencao no fim
#   membros status --json   o arquivo de situacao como esta (para o diagnostico e a IA)
# Le so o arquivo de situacao (KIT_PASTA_ESTADO/situacao.json), que nao tem segredo: roda sem sudo, sem rede e sem
# abrir o backup. Quem grava sao os comandos backup, kit-de-recuperacao, restaurar e restaurar --ensaio.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: o script usa BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "${BASH_SOURCE[0]}")/lib-kit.sh"

json=0
for arg in "$@"; do
    case "$arg" in
        --json) json=1 ;;
        -h|--help) sed -n 2,6p "$0"; exit 0 ;;
        *) sair "$SAI_USO" "opcao desconhecida: $arg (veja: membros status --help)" ;;
    esac
done
if [ "$json" = 1 ]; then kit_py situacao-mostrar "$KIT_ARQUIVO_SITUACAO" --json; else kit_py situacao-mostrar "$KIT_ARQUIVO_SITUACAO"; fi

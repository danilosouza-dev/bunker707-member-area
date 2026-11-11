#!/usr/bin/env bash
# Preparo do servidor de um comprador para o kit (docs/32 §3.2 passo 2 e §11.7; docs/20 §9C). Roda como root, antes de
# o instalador subir a escola, e pode rodar de novo quando quiser (nada se repete):
#   sudo bash preparar-servidor.sh [--simular] [--chave-ssh "ssh-ed25519 AAAA..."] [--reinicio-automatico]
#                                  [--ssh-sem-limite] [--manter-firewall]
#   sudo bash preparar-servidor.sh --fechar-login-por-senha    # numa sessao SSH que entrou com a chave
#   (tambem: sudo membros preparar-servidor ...)
# E o mesmo infra/scripts/bootstrap.sh da nossa producao, no perfil kit: os nomes e as pastas vem do kit.conf (A10).
#   --simular                 mostra o que faria, sem mudar nada
#   --chave-ssh "CHAVE"       cadastra a chave publica na conta de quem entrou (o login por senha continua)
#   --fechar-login-por-senha  fecha o login por senha; so numa sessao SSH aberta com chave, com a confirmacao digitada
#   --reinicio-automatico     deixa as atualizacoes de seguranca reiniciarem o servidor sozinhas (05:30)
#   --ssh-sem-limite          a porta do SSH sem o limite de conexoes do ufw (6 em 30 s por IP)
#   --manter-firewall         nao mexe no firewall (o dono cuida; obrigatorio com o firewalld)
# Codigos de saida: 0 ok; 1 uso; 3 um passo falhou; 7 pede uma pessoa no terminal; 10 sistema ou processador fora do
# kit; 11 outro programa cuida do firewall; 12 Docker sem o compose 2; 13 fechar a senha pede uma sessao SSH aberta com
# chave; 14 o sshd nao aceitou fechar a senha (voltou como estava).
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail

KIT_DIR=$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd)
KIT_PASTA_PACOTE=$(cd -- "$KIT_DIR/../.." && pwd)
for arg in "$@"; do
    case "$arg" in -h|--help) sed -n 2,20p "$KIT_DIR/preparar-servidor.sh"; exit 0 ;; esac
done
# shellcheck source=kit.conf
. "$KIT_DIR/kit.conf"

export PERFIL=kit
export NOME="$KIT_NOME"
export PASTA_ESTADO="$KIT_PASTA_ESTADO"
export PASTA_BACKUP="$KIT_PASTA_BACKUP"
export PASTA_CERTIFICADOS="$KIT_PASTA_CERTIFICADOS"
export PASTA_INSTALACAO="$KIT_PASTA_INSTALACAO"
export COMANDO="${COMANDO:-bash $KIT_DIR/preparar-servidor.sh}"
exec bash "$KIT_PASTA_PACOTE/infra/scripts/bootstrap.sh" "$@"

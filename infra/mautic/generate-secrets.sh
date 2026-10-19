#!/bin/sh
#
# Gera o .env do stack do Mautic (infra/mautic/.env) a partir do .env.example: senhas do MySQL, senha do
# administrador, senha do restic e os enderecos derivados do dominio. Nunca imprime segredo; chmod 600.
#
#   sh infra/mautic/generate-secrets.sh --local
#   sh infra/mautic/generate-secrets.sh --domain marketing.bunker707.com.br --email voce@bunker707.com.br \
#       [--admin-ips "203.0.113.10/32"] [--force]
#
# A conta e feita em generate-secrets.mjs com o Node >= 20 da maquina; sem Node, roda dentro de node:24-alpine.

set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

node_ok() {
    command -v node >/dev/null 2>&1 || return 1
    major=$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)
    [ -n "$major" ] && [ "$major" -ge 20 ] 2>/dev/null
}

if node_ok; then
    exec node "$here/generate-secrets.mjs" "$@"
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "Preciso do Node >= 20 ou do Docker para gerar as chaves." >&2
    exit 1
fi

echo "Node >= 20 nao encontrado: gerando dentro de node:24-alpine (Docker)."
# Com o usuario de quem chamou: o Docker e rootful, e um .env de root (0600) ficaria ilegivel para o deploy.
exec docker run --rm --user "$(id -u):$(id -g)" -v "$here:/work" -w /work node:24.11.1-alpine3.22 node generate-secrets.mjs "$@"

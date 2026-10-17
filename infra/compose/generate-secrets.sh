#!/bin/sh
#
# Gera o .env do stack (infra/compose/.env) a partir do .env.example: todos os segredos (senha do
# Postgres, JWT simetrico e par EC P-256, chaves anon/service_role legadas, chaves sb_publishable_/
# sb_secret_, SECRET_KEY_BASE, VAULT_ENC_KEY, senha do Studio, token do tick, senha do restic) e os
# enderecos derivados dos dominios. Nunca imprime segredo na tela; grava .env com chmod 600.
#
#   sh infra/compose/generate-secrets.sh --local
#   sh infra/compose/generate-secrets.sh --domain membros.bunker707.com.br --api-domain api.bunker707.com.br \
#       --studio-domain studio.bunker707.com.br --email voce@bunker707.com.br --studio-ips "203.0.113.10/32"
#   ... --force      sobrescreve um .env existente (cuidado: troca TODOS os segredos; veja docs/20)
#
# A conta pesada (chaves EC, JWTs, checksums) e feita em generate-secrets.mjs com o Node >= 20 da
# maquina; sem Node, roda o mesmo arquivo dentro de node:24-alpine via Docker (como o utilitario oficial
# do Supabase, docker/utils/add-new-auth-keys.sh).

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
exec docker run --rm -v "$here:/work" -w /work node:24.11.1-alpine3.22 node generate-secrets.mjs "$@"

#!/usr/bin/env bash
# Guarda no Cloudflare R2 (restic) o .env da sala (infra/jitsi/.env): as senhas internas que o generate-secrets.sh
# criou (JWT_APP_SECRET, Jicofo, JVB, Jibri, TURN) e os enderecos. A sala nao guarda dado de aluno, mas sem esse
# arquivo um servidor novo nasce com senhas novas e a ligacao com a area de membros e com a Vercel precisa ser refeita.
# Chamado pelo deploy-meet e pelo secrets-meet (infra/cloud/lib.sh meet_backup_r2), os unicos que mudam o arquivo;
# por isso nao ha timer. docs/20 §8E.
#   bash backup-env.sh <repositorio restic> <caminho do .env>
# Le da entrada, uma por linha: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY e a senha do repositorio (a de recuperacao,
# derivada do HCLOUD_TOKEN, a mesma que abre os outros backups). Nada disso fica no disco nem na linha de comando.
# Para restaurar: com as mesmas tres variaveis no ambiente, `restic restore latest --tag bunker707-meet --target /`.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: o script usa pipefail.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail

repo="${1:?uso: backup-env.sh <repositorio restic> <caminho do .env>}"
env_file="${2:?uso: backup-env.sh <repositorio restic> <caminho do .env>}"
IFS= read -r AWS_ACCESS_KEY_ID || true
IFS= read -r AWS_SECRET_ACCESS_KEY || true
IFS= read -r RESTIC_PASSWORD || true
[ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ] && [ -n "$RESTIC_PASSWORD" ] \
    || { echo "ERRO: faltaram as chaves do R2 ou a senha na entrada." >&2; exit 1; }
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY RESTIC_PASSWORD RESTIC_REPOSITORY="$repo"

[ -s "$env_file" ] || { echo "ERRO: $env_file nao existe ou esta vazio." >&2; exit 1; }
command -v restic >/dev/null 2>&1 || { echo "ERRO: restic nao encontrado (bootstrap.sh instala)." >&2; exit 1; }

restic cat config >/dev/null 2>&1 || restic init >/dev/null
restic backup --tag bunker707-meet --host bunker707-meet --quiet "$env_file"
restic forget --tag bunker707-meet --host bunker707-meet --group-by host --keep-last 30 --prune --quiet
echo "  configuracao da sala guardada no R2 ($(restic snapshots --tag bunker707-meet --compact | grep -c bunker707-meet) copias)"

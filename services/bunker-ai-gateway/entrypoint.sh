#!/bin/sh
set -eu

: "${BUNKER_AI_GATEWAY_API_KEY:?BUNKER_AI_GATEWAY_API_KEY is required}"
: "${MANAGEMENT_PASSWORD:?MANAGEMENT_PASSWORD is required}"

case "$BUNKER_AI_GATEWAY_API_KEY" in
  *[!A-Za-z0-9._~-]*)
    echo "BUNKER_AI_GATEWAY_API_KEY must use only URL-safe characters" >&2
    exit 1
    ;;
esac

if [ "${#BUNKER_AI_GATEWAY_API_KEY}" -lt 32 ]; then
  echo "BUNKER_AI_GATEWAY_API_KEY must contain at least 32 characters" >&2
  exit 1
fi

case "$MANAGEMENT_PASSWORD" in
  *[!A-Za-z0-9._~-]*)
    echo "MANAGEMENT_PASSWORD must use only URL-safe characters" >&2
    exit 1
    ;;
esac

if [ "${#MANAGEMENT_PASSWORD}" -lt 32 ]; then
  echo "MANAGEMENT_PASSWORD must contain at least 32 characters" >&2
  exit 1
fi

if [ "$BUNKER_AI_GATEWAY_API_KEY" = "$MANAGEMENT_PASSWORD" ]; then
  echo "BUNKER_AI_GATEWAY_API_KEY and MANAGEMENT_PASSWORD must be different" >&2
  exit 1
fi

config_dir="/tmp/bunker-ai-gateway"
config_path="$config_dir/config.yaml"

umask 077
mkdir -p "$config_dir"
{
  printf 'host: "0.0.0.0"\n'
  printf 'port: 8317\n'
  printf 'remote-management:\n'
  printf '  allow-remote: true\n'
  printf '  secret-key: "%s"\n' "$MANAGEMENT_PASSWORD"
  printf '  disable-control-panel: true\n'
  printf 'auth-dir: "/data/auth"\n'
  printf 'api-keys:\n'
  printf '  - "%s"\n' "$BUNKER_AI_GATEWAY_API_KEY"
  printf 'commercial-mode: true\n'
  printf 'usage-statistics-enabled: true\n'
  printf 'request-retry: 0\n'
  printf 'max-retry-credentials: 1\n'
  printf 'max-retry-interval: 0\n'
  printf 'save-cooldown-status: true\n'
  printf 'routing:\n'
  printf '  strategy: "round-robin"\n'
  printf '  session-affinity: false\n'
  printf 'ws-auth: true\n'
} > "$config_path"

exec /app/bunker-ai-gateway -config "$config_path"

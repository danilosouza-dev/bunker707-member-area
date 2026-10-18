#!/usr/bin/env bash
# Envelope de segredos para um servidor: so ele consegue abrir (chave RSA em /etc/bunker707/transfer.key).
#   bash infra/cloud/envelope.sh encrypt <transfer.pub ou base64 dela> <arquivo CHAVE=VALOR>   -> imprime o payload (base64)
#   bash infra/cloud/envelope.sh decrypt <transfer.key> <payload.b64>                             -> imprime CHAVE=VALOR (roda no servidor)
# Hibrido: senha aleatoria de 64 hex cifrada com RSA-OAEP + conteudo em AES-256-CBC (PBKDF2). So openssl e tar.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail
mode="${1:-}"; shift || true
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
case "$mode" in
    encrypt)
        pubsrc="${1:?transfer.pub}"; kv="${2:?arquivo CHAVE=VALOR}"
        if [ -f "$pubsrc" ]; then cp "$pubsrc" "$tmp/pub.pem"; else printf '%s' "$pubsrc" | base64 -d > "$tmp/pub.pem"; fi
        grep -q 'BEGIN PUBLIC KEY' "$tmp/pub.pem" || { echo "transfer.pub invalida" >&2; exit 1; }
        # Texto de uma linha (hex), nunca binario: `-pass file:` le so a primeira linha do arquivo.
        openssl rand -hex 32 > "$tmp/k"
        openssl pkeyutl -encrypt -pubin -inkey "$tmp/pub.pem" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in "$tmp/k" -out "$tmp/k.enc"
        openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$tmp/k" -in "$kv" -out "$tmp/env.enc"
        tar -C "$tmp" -cf - k.enc env.enc | base64 -w0; echo ;;
    decrypt)
        key="${1:?transfer.key}"; payload="${2:?payload.b64}"
        base64 -d < "$payload" | tar -C "$tmp" -xf -
        openssl pkeyutl -decrypt -inkey "$key" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in "$tmp/k.enc" -out "$tmp/k"
        openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$tmp/k" -in "$tmp/env.enc" ;;
    *) echo "uso: envelope.sh encrypt <transfer.pub> <arquivo> | decrypt <transfer.key> <payload.b64>" >&2; exit 2 ;;
esac

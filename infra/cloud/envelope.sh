#!/usr/bin/env bash
# Envelope de segredos para um servidor: so ele consegue abrir (chave RSA em /etc/bunker707/transfer.key).
#   bash infra/cloud/envelope.sh encrypt <transfer.pub ou base64 dela> <arquivo CHAVE=VALOR>   -> imprime o payload
#   bash infra/cloud/envelope.sh decrypt <transfer.key> <payload>                               -> imprime CHAVE=VALOR (roda no servidor)
# Hibrido: senha aleatoria de 64 hex cifrada com RSA-OAEP + conteudo em AES-256-CBC (PBKDF2). So openssl.
# Payload: base64(senha cifrada) "." base64(conteudo cifrado), numa linha e curto (perto de 900 caracteres
# para uma chave de API): ele e copiado para o input do workflow, entao nada de tar com blocos de zeros.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail
mode="${1:-}"; shift || true
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
invalid() { echo "envelope invalido${1:+ ($1)}" >&2; exit 1; }
case "$mode" in
    encrypt)
        pubsrc="${1:?transfer.pub}"; kv="${2:?arquivo CHAVE=VALOR}"
        if [ -f "$pubsrc" ]; then cp "$pubsrc" "$tmp/pub.pem"; else printf '%s' "$pubsrc" | base64 -d > "$tmp/pub.pem"; fi
        grep -q 'BEGIN PUBLIC KEY' "$tmp/pub.pem" || { echo "transfer.pub invalida" >&2; exit 1; }
        # Texto de uma linha (hex), nunca binario: `-pass file:` le so a primeira linha do arquivo.
        openssl rand -hex 32 > "$tmp/k"
        openssl pkeyutl -encrypt -pubin -inkey "$tmp/pub.pem" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in "$tmp/k" -out "$tmp/k.enc"
        openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$tmp/k" -in "$kv" -out "$tmp/env.enc"
        printf '%s.%s\n' "$(base64 -w0 < "$tmp/k.enc")" "$(base64 -w0 < "$tmp/env.enc")" ;;
    decrypt)
        key="${1:?transfer.key}"; payload="${2:?payload}"
        umask 077
        p=$(tr -d '[:space:]' < "$payload")
        [[ "$p" =~ ^[A-Za-z0-9+/]+=*\.[A-Za-z0-9+/]+=*$ ]] || invalid "formato"
        printf '%s' "${p%%.*}" | base64 -d > "$tmp/k.enc" 2>/dev/null || invalid "base64"
        printf '%s' "${p#*.}" | base64 -d > "$tmp/env.enc" 2>/dev/null || invalid "base64"
        # Decifra para arquivo e so imprime se tudo deu certo: o `openssl enc -d` solta o texto menos o ultimo
        # bloco antes de acusar "bad decrypt", e texto parcial nao pode chegar ao .env.
        if openssl pkeyutl -decrypt -inkey "$key" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in "$tmp/k.enc" -out "$tmp/k" 2>/dev/null &&
           openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$tmp/k" -in "$tmp/env.enc" -out "$tmp/env" 2>/dev/null; then
            cat "$tmp/env"
        else
            invalid "transfer.pub de outro servidor, ou payload truncado/alterado"
        fi ;;
    *) echo "uso: envelope.sh encrypt <transfer.pub> <arquivo> | decrypt <transfer.key> <payload>" >&2; exit 2 ;;
esac

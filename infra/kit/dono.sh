#!/usr/bin/env bash
# O link de entrada do dono (docs/32 §3.2 passo 10; docs/20 §9D), no terminal do servidor:
#   sudo membros link-do-dono [--email E]
# Gera um link novo, de uso unico, que abre a escola ja na troca de senha do dono (o mesmo caminho do "esqueci a
# senha": /auth/confirm com type=recovery, que leva a /alterar-senha). Nao depende do e-mail: o link aparece aqui. Vale
# pelo prazo do Auth (1 hora) e funciona uma vez; gerar outro invalida o anterior. Sem --email, o dono e a primeira
# conta com o papel owner. So com uma pessoa no terminal: a IA nunca recebe o link (docs/32 §3.3).
# Codigos de saida: 0 ok; 1 uso; 7 pede uma pessoa no terminal; 44 a conta do dono nao foi achada ou o Auth recusou.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: o script usa BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "${BASH_SOURCE[0]}")/lib-kit.sh"

email=""
while [ $# -gt 0 ]; do
    case "$1" in
        --email) [ $# -ge 2 ] || sair "$SAI_USO" "--email precisa do e-mail."; email=$2; shift ;;
        --email=*) email=${1#*=} ;;
        -h|--help) sed -n 2,9p "$0"; exit 0 ;;
        *) sair "$SAI_USO" "opcao desconhecida: $1 (veja: membros link-do-dono --help)" ;;
    esac
    shift
done

[ -t 0 ] && [ -t 1 ] || sair "$SAI_TERMINAL" "O link de entrada do dono e de uso unico e so aparece com uma pessoa no terminal do servidor (sudo membros link-do-dono). Pela IA, nao."
exigir_segredos
app_no_ar || sair 44 "O app nao esta no ar neste servidor (sudo docker compose ps)."

# link_do_dono EMAIL: o link novo na saida (vazio e codigo 44 se o Auth nao gerou).
if [ -z "$email" ]; then
    email=$(compose exec -T "$KIT_SERVICO_BANCO" psql -U postgres -X -At -c \
        "select u.email from auth.users u join public.admin_roles r on r.user_id = u.id where r.role = 'owner' order by u.created_at limit 1" 2>/dev/null </dev/null | tr -d '[:space:]')
    [ -n "$email" ] || sair 44 "Nao achei a conta do dono (papel owner). Diga qual: sudo membros link-do-dono --email dono@exemplo.com"
fi
[[ $email =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || sair "$SAI_USO" "E-mail invalido: $email"
saida=$(printf '{"email":"%s"}' "$email" | no_app dono-link) || sair 44 "O app nao gerou o link (o Auth esta no ar?)."
token=$(printf '%s' "$saida" | inst_py json-campo token_hash)
[ -n "$token" ] || sair 44 "$(printf '%s' "$saida" | inst_py json-campo mensagem)"
endereco=$(env_value APP_PUBLIC_URL)
printf '\nLink de entrada de %s (uso unico, vale por 1 hora; abre a escola na troca de senha):\n\n  %s/auth/confirm?token_hash=%s&type=recovery&next=%%2Fadmin\n\n' \
    "$email" "${endereco%/}" "$token"

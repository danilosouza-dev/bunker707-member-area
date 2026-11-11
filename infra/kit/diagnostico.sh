#!/usr/bin/env bash
# Diagnostico da escola (docs/32 §3.3; docs/20 §9D), primeira versao:
#   sudo membros diagnostico          em portugues, com o que pede atencao no fim
#   sudo membros diagnostico --json   para a IA e o suporte: o mesmo em JSON
# Junta: a versao e os passos da instalacao (o arquivo do instalador), a mesma conferencia do servidor que o
# `instalar --conferir` faz (sistema, maquina, disco, portas, DNS dos dois enderecos e a saida para a internet e o
# e-mail), os servicos do compose (estado e saude), o backup (a idade do ultimo, o kit de recuperacao, o ultimo ensaio),
# a situacao da Licenca (pelo app) e o disco. Sem segredo e sem dado de aluno: nada do arquivo de segredos sai, e as
# linhas de registro dos servicos ficam de fora nesta versao. Sem sudo, mostra o que der (sem os servicos e a Licenca).
# Sai com 0 sempre que conseguiu montar o relatorio: o que esta errado vai na lista "Atencao".
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: o script usa BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "${BASH_SOURCE[0]}")/lib-kit.sh"

json=0
for arg in "$@"; do
    case "$arg" in
        --json) json=1 ;;
        -h|--help) sed -n 2,11p "$0"; exit 0 ;;
        *) sair "$SAI_USO" "opcao desconhecida: $arg (veja: membros diagnostico --help)" ;;
    esac
done

pasta=$(mktemp -d)
trap 'rm -rf -- "$pasta"' EXIT
endereco=$(inst_py estado-ler "$KIT_ARQUIVO_INSTALACAO" endereco 2>/dev/null || true)
api=$(inst_py estado-ler "$KIT_ARQUIVO_INSTALACAO" endereco_api 2>/dev/null || true)
if [ -z "$endereco" ] && [ -r "$ENV_FILE" ]; then
    endereco=$(env_value APP_PUBLIC_URL); endereco=${endereco#https://}
    api=$(env_value SUPABASE_PUBLIC_URL); api=${api#https://}
fi

args=(--json)
[ -z "$endereco" ] || args+=(--endereco "$endereco" --dns-bloqueia)
[ -z "$api" ] || args+=(--endereco-api "$api")
docker_ok=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then docker_ok=1; fi
if [ "$docker_ok" = 1 ] && [ -n "$(compose ps -q --status running caddy 2>/dev/null | head -n1)" ]; then args+=(--portas-nossas); fi
inst_py conferir "${args[@]}" > "$pasta/conferencia.json" 2>/dev/null || true

partes=("instalacao=$KIT_ARQUIVO_INSTALACAO" "situacao=$KIT_ARQUIVO_SITUACAO" "conferencia=$pasta/conferencia.json"
    "containers=$pasta/containers" "disco=$pasta/disco")
if [ "$docker_ok" = 1 ]; then
    compose ps -a --format json > "$pasta/containers" 2>/dev/null || partes+=("containers_erro=nao consegui ler os servicos do compose")
    if app_no_ar && bash "$KIT_DIR/licenca.sh" estado --json > "$pasta/licenca.json" 2>/dev/null; then
        partes+=("licenca=$pasta/licenca.json")
    fi
else
    partes+=("containers_erro=sem acesso ao Docker: rode com sudo para ver os servicos e a Licenca")
fi
df -Pk / "$KIT_PASTA_COMPOSE" "$KIT_PASTA_BACKUP" 2>/dev/null | awk '!visto[$6]++' > "$pasta/disco" || true
if [ "$json" = 1 ]; then partes+=(--json); fi
inst_py diagnostico "${partes[@]}"

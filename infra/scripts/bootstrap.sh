#!/usr/bin/env bash
# Prepara um servidor para rodar a area de membros. Dois perfis, o mesmo roteiro (docs/20 §6 e §9C):
#
#   producao (o padrao): os nossos servidores, Ubuntu 24.04 recem-criado na Hetzner com a chave SSH do produtor e o
#   firewall da Hetzner na frente. Roda UMA vez, como root, logo depois do primeiro acesso (infra/cloud/provision.sh):
#     curl -fsSL https://raw.githubusercontent.com/danilosouza-dev/bunker707-member-area/main/infra/scripts/bootstrap.sh -o bootstrap.sh
#     sudo SSH_PUBLIC_KEY="ssh-ed25519 AAAA... produtor" bash bootstrap.sh
#   (ou copie o arquivo por scp; o repositorio e privado, entao o curl acima so funciona com token)
#
#   kit: o servidor de um comprador, em qualquer provedor (docs/32 §3.1 e §11.7), sempre pelo
#   infra/kit/preparar-servidor.sh, que tira os nomes do infra/kit/kit.conf. Ubuntu 22.04 ou 24.04 e Debian 12 ou 13,
#   x86-64, criado com chave ou com senha, com o firewall que ja houver.
#
# O que faz (idempotente: pode rodar de novo; --simular mostra o que faria e nao muda nada):
#   1. apt: atualizacoes, ufw, fail2ban, unattended-upgrades, restic, jq, curl (e git na producao);
#   2. acesso: producao: usuario `deploy` (sudo sem senha, grupo docker) com a chave SSH informada (ou a do root) e o
#      SSH so com chave. kit: o acesso de hoje continua como esta; --chave-ssh acrescenta uma chave a conta de quem
#      entrou, e o login por senha so fecha com --fechar-login-por-senha, rodado numa sessao SSH que entrou com chave,
#      com a confirmacao digitada (nunca tranca o dono para fora);
#   3. ufw: producao: zera e abre SSH, 80 e 443 (sem limite: o firewall da Hetzner ja restringe a 22, e o deploy abre
#      dezenas de conexoes SSH seguidas). kit: mantem as regras que ja existiam e a politica de quem ja tinha o ufw
#      ligado, abre so as portas do SSH (com limite de conexoes, ufw limit), 80 e 443; o firewalld nao e tocado.
#      Nos dois, as regras DOCKER-USER para o Docker respeitar o ufw;
#   4. fail2ban no sshd; unattended-upgrades (reinicio automatico ligado na producao e desligado no kit, salvo
#      --reinicio-automatico);
#   5. Docker CE do repositorio oficial da distribuicao (Ubuntu ou Debian), chave conferida pela impressao digital, log
#      rotation e live-restore sem apagar o que ja havia no daemon.json;
#   6. swap de 2 GB (se ainda nao ha tanto);
#   7. restic 0.16 ou mais novo (o do apt do Ubuntu 22.04 e do Debian 12 e velho: baixa o oficial, conferido pelo
#      sha256); CLI do Supabase so na producao (versao pinada, para migrate.sh);
#   8. pastas: producao /opt/bunker707 e /var/backups/bunker707; kit, as do kit.conf.
# Variaveis: SSH_PUBLIC_KEY, DEPLOY_USER (deploy), SSH_PORT (22), SWAP_GB (2), AUTO_REBOOT (true na producao, false no
#            kit), SUPABASE_CLI_VERSION (2.121.0), REPO_DIR (/opt/bunker707), SEM_SUPABASE_CLI (1 = pula a CLI; o servidor
#            do Emissor de licencas nao tem Supabase, docs/20 §8C), RESTIC_VERSAO (0.18.1).
# Codigos de saida: 0 ok; 1 uso; 3 um passo falhou; 7 o passo pede uma pessoa no terminal; 10 sistema ou processador
# fora do kit; 11 outro programa cuida do firewall; 12 Docker sem o compose 2; 13 fechar a senha pede uma sessao SSH
# aberta com chave; 14 o sshd nao aceitou fechar a senha (voltou como estava).
# Depois dele: docs/20-runbook-hetzner.md, "Primeiro deploy" (producao) ou §9C (kit).
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

set -euo pipefail

SAI_USO=1
SAI_FALHOU=3
SAI_TERMINAL=7
SAI_SISTEMA=10
SAI_FIREWALL=11
SAI_DOCKER=12
SAI_CHAVE=13
SAI_SSH=14

log()   { printf '\n==> %s\n' "$*"; }
info()  { printf '  %s\n' "$*"; }
aviso() { printf '  AVISO: %s\n' "$*" >&2; }
erro()  { local codigo=$1; shift; printf 'ERRO: %s\n' "$*" >&2; exit "$codigo"; }
ajuda() { sed -n 2,40p "${BASH_SOURCE[0]}"; }

PERFIL="${PERFIL:-producao}"
SIMULAR="${SIMULAR:-0}"
ACAO=preparar
while [ $# -gt 0 ]; do
    case "$1" in
        --simular) SIMULAR=1 ;;
        --fechar-login-por-senha) ACAO=fechar-senha ;;
        --chave-ssh) [ $# -ge 2 ] || erro "$SAI_USO" "--chave-ssh pede a chave publica entre aspas."; SSH_PUBLIC_KEY=$2; shift ;;
        --reinicio-automatico) AUTO_REBOOT=true ;;
        --ssh-sem-limite) SSH_LIMITE=0 ;;
        --manter-firewall) FIREWALL=dono ;;
        -h|--help) ajuda; exit 0 ;;
        *) erro "$SAI_USO" "opcao desconhecida: $1 (veja --help)" ;;
    esac
    shift
done

# O servidor inteiro fica em RAIZ: vazio no servidor de verdade; nos testes, uma pasta com o servidor de mentira.
RAIZ="${BOOTSTRAP_RAIZ:-}"
r() { printf '%s%s' "$RAIZ" "$1"; }
# Os processos (para achar a sessao SSH debaixo do sudo). So o teste da arvore de processos de verdade troca.
PROC="${BOOTSTRAP_PROC:-$RAIZ/proc}"

case "$PERFIL" in
    producao)
        NOME="${NOME:-bunker707}"
        DEPLOY_USER="${DEPLOY_USER:-deploy}"
        SSH_PORT="${SSH_PORT:-22}"
        AUTO_REBOOT="${AUTO_REBOOT:-true}"
        SSH_LIMITE="${SSH_LIMITE:-0}"
        FIREWALL="${FIREWALL:-zerar}"
        REPO_DIR="${REPO_DIR:-/opt/$NOME}"
        PASTA_BACKUP="${PASTA_BACKUP:-/var/backups/$NOME}"
        [ "$ACAO" = preparar ] || erro "$SAI_USO" "--fechar-login-por-senha e do kit: na producao o SSH ja nasce so com chave."
        ;;
    kit)
        # Os nomes e as pastas vem do kit.conf, pelo infra/kit/preparar-servidor.sh (A10).
        for variavel in NOME PASTA_ESTADO PASTA_BACKUP PASTA_CERTIFICADOS PASTA_INSTALACAO; do
            [ -n "${!variavel:-}" ] || erro "$SAI_USO" "Rode o perfil kit pelo infra/kit/preparar-servidor.sh (falta $variavel)."
        done
        AUTO_REBOOT="${AUTO_REBOOT:-false}"
        SSH_LIMITE="${SSH_LIMITE:-1}"
        FIREWALL="${FIREWALL:-preservar}"
        SEM_SUPABASE_CLI=1
        # Como a pessoa chama o preparo de novo (o resumo mostra o comando certo).
        COMANDO="${COMANDO:-bash ${BASH_SOURCE[0]}}"
        ;;
    *) erro "$SAI_USO" "PERFIL desconhecido: $PERFIL (producao ou kit)." ;;
esac
case "$AUTO_REBOOT" in true|false) ;; *) erro "$SAI_USO" "AUTO_REBOOT e true ou false." ;; esac
SWAP_GB="${SWAP_GB:-2}"
SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-2.121.0}"
RESTIC_VERSAO="${RESTIC_VERSAO:-0.18.1}"
# A chave do repositorio do Docker (docs.docker.com/engine/install): a impressao digital que ela tem de ter.
DOCKER_GPG_FPR="9DC858229FC7DD38854AE2D88D81803C0EBFCD88"
export DEBIAN_FRONTEND=noninteractive
# Sem perguntas do needrestart ("quais servicos reiniciar?") quando o script roda por SSH sem terminal.
export NEEDRESTART_MODE=a NEEDRESTART_SUSPEND=1
# Espera a trava do dpkg (cloud-init e unattended-upgrades do primeiro boot) em vez de falhar na hora, e mantem os
# arquivos de configuracao que ja existem quando um pacote atualizado traz outro.
apt_opts=(-o DPkg::Lock::Timeout=600 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

# fazer CMD...: todo comando que muda o servidor passa por aqui; no --simular, so aparece na tela.
fazer() {
    if [ "$SIMULAR" = 1 ]; then
        printf '  [simular]'; printf ' %q' "$@"; printf '\n'
        return 0
    fi
    "$@"
}

# escrever ARQUIVO MODO < conteudo: grava (por troca atomica) so se mudou. Devolve 0 se gravou (ou gravaria, no
# --simular) e 1 se o arquivo ja estava assim: chame com `if` ou `|| true`.
escrever() {
    local destino conteudo atual tmp
    destino=$(r "$1")
    conteudo=$(cat; printf x)
    conteudo=${conteudo%x}
    if [ -f "$destino" ]; then
        atual=$(cat "$destino"; printf x)
        if [ "${atual%x}" = "$conteudo" ]; then
            info "sem mudanca: $1"
            return 1
        fi
    fi
    if [ "$SIMULAR" = 1 ]; then
        info "[simular] gravaria $1"
        return 0
    fi
    mkdir -p "$(dirname -- "$destino")"
    tmp=$(mktemp "$destino.XXXXXX")
    printf '%s' "$conteudo" > "$tmp"
    chmod "$2" "$tmp"
    mv -f -- "$tmp" "$destino"
    info "gravado: $1"
}

# acrescentar ARQUIVO MARCA < bloco: acrescenta o bloco no fim se a MARCA ainda nao esta no arquivo (0) ou nada (1).
acrescentar() {
    local destino bloco
    destino=$(r "$1")
    bloco=$(cat)
    if [ -f "$destino" ] && grep -qF -- "$2" "$destino"; then
        info "sem mudanca: $1 ($2)"
        return 1
    fi
    if [ "$SIMULAR" = 1 ]; then
        info "[simular] acrescentaria a $1: $2"
        return 0
    fi
    mkdir -p "$(dirname -- "$destino")"
    # Arquivo que termina sem quebra de linha (editado a mao): sem ela, o bloco colaria na ultima linha (duas chaves numa).
    if [ -s "$destino" ] && [ -n "$(tail -c1 "$destino")" ]; then printf '\n' >> "$destino"; fi
    printf '%s\n' "$bloco" >> "$destino"
    info "acrescentado a $1: $2"
}

pasta() { # pasta CAMINHO MODO [DONO, no formato do chown: deploy:deploy, ou conta: para o grupo da conta]
    if [ ! -d "$(r "$1")" ]; then
        fazer install -d -m "$2" "$(r "$1")"
    elif [ "$(stat -c %a "$(r "$1")")" != "$2" ]; then
        fazer chmod "$2" "$(r "$1")"
    fi
    [ -z "${3:-}" ] || fazer chown "$3" "$(r "$1")"
}

# ---- o sistema --------------------------------------------------------------------------------------------------
ler_sistema() {
    [ "$(id -u)" = "0" ] || erro "$SAI_USO" "Rode como root (sudo)."
    [ -f "$(r /etc/os-release)" ] || erro "$SAI_SISTEMA" "Sem /etc/os-release: nao sei que sistema e este."
    eval "$(
        # shellcheck disable=SC1090
        . "$(r /etc/os-release)"
        printf 'OS_ID=%q OS_VERSAO=%q OS_CODINOME=%q OS_NOME=%q\n' "${ID:-}" "${VERSION_ID:-}" "${VERSION_CODENAME:-}" "${PRETTY_NAME:-desconhecido}"
    )"
    ARQUITETURA=$(dpkg --print-architecture)
    if [ "$PERFIL" = producao ]; then
        [ "$OS_ID" = ubuntu ] && [ "$OS_VERSAO" = 24.04 ] || echo "AVISO: pensado para Ubuntu 24.04; aqui e $OS_NOME."
        return 0
    fi
    case "$OS_ID/$OS_VERSAO" in
        ubuntu/22.04|ubuntu/24.04|debian/12|debian/13) ;;
        *) erro "$SAI_SISTEMA" "Este servidor e $OS_NOME. O kit roda em Ubuntu 22.04 ou 24.04 e em Debian 12 ou 13: crie o servidor com um deles (nada foi mudado)." ;;
    esac
    [ "$ARQUITETURA" = amd64 ] || erro "$SAI_SISTEMA" "O processador deste servidor e $ARQUITETURA; o kit roda em x86-64 (amd64). Nada foi mudado."
}

# A sessao SSH de quem roda: "IP_DO_CLIENTE PORTA_DO_CLIENTE IP_DO_SERVIDOR PORTA_DO_SERVIDOR". Do proprio ambiente
# ou, debaixo do sudo (que limpa o ambiente), do primeiro processo acima que tenha SSH_CONNECTION.
sessao_ssh() {
    if [ -n "${SSH_CONNECTION:-}" ]; then
        printf '%s' "$SSH_CONNECTION"
        return 0
    fi
    local pid=$$ pai conexao
    for _ in $(seq 40); do
        pai=$(awk '/^PPid:/ { print $2 }' "$PROC/$pid/status" 2>/dev/null || true)
        [ -n "$pai" ] && [ "$pai" -gt 1 ] || break
        conexao=$(tr '\0' '\n' < "$PROC/$pai/environ" 2>/dev/null | sed -n 's/^SSH_CONNECTION=//p' | head -n1 || true)
        if [ -n "$conexao" ]; then
            printf '%s' "$conexao"
            return 0
        fi
        pid=$pai
    done
    return 1
}

# entrada_da_sessao IP PORTA: "metodo usuario" de como a sessao entrou, pelo registro do sshd ("Accepted publickey for
# root from IP port PORTA"); vazio quando o registro nao tem.
entrada_da_sessao() {
    local ip=${1//./\\.} porta=$2 linhas
    linhas=$(journalctl -q -o cat --no-pager -t sshd -t sshd-session --since "-3 days" 2>/dev/null || true)
    [ -n "$linhas" ] || linhas=$(cat "$(r /var/log/auth.log)" 2>/dev/null || true)
    printf '%s\n' "$linhas" | sed -n "s/.*Accepted \([a-z/-]*\) for \([^ ]*\) from $ip port $porta .*/\1 \2/p" | tail -n1
}

# O valor que o sshd usa de verdade (o primeiro que ele le vale: um arquivo de sshd_config.d com numero menor ganha).
sshd_efetivo() { sshd -T "${@:2}" 2>/dev/null | awk -v chave="$1" '$1 == chave { print $2; exit }'; }

# As portas em que o SSH escuta: a do sshd_config, a do ssh.socket (Ubuntu 22.10 em diante) e a da sessao de agora.
portas_do_ssh() {
    {
        sshd -T 2>/dev/null | awk '$1 == "port" { print $2 }'
        systemctl show ssh.socket -p Listen --value 2>/dev/null | grep -o ':[0-9]*' | tr -d ':'
        [ -z "${SESSAO_PORTA_SERVIDOR:-}" ] || printf '%s\n' "$SESSAO_PORTA_SERVIDOR"
    } | grep -E '^[0-9]+$' | sort -un | tr '\n' ' ' | sed 's/ $//'
}

ufw_instalado() { ufw version >/dev/null 2>&1; }
servico_ativo() { systemctl is-active --quiet "$1" 2>/dev/null; }

# ---- passos comuns --------------------------------------------------------------------------------------------------
passo_pacotes() {
    log "$1 Pacotes"
    local pacotes=(ca-certificates curl gnupg jq fail2ban python3-systemd unattended-upgrades apt-listchanges restic rsync python3 openssh-client bzip2)
    [ "$PERFIL" != producao ] || pacotes+=(git)
    # Com --manter-firewall o firewall e do dono: o kit nem instala o ufw.
    [ "$FIREWALL" = dono ] || pacotes+=(ufw)
    fazer apt-get "${apt_opts[@]}" update -q
    fazer apt-get "${apt_opts[@]}" upgrade -y -q
    fazer apt-get "${apt_opts[@]}" install -y -q "${pacotes[@]}"
}

# Portas publicadas por containers passam pelo DOCKER-USER, nao pelo INPUT: sem este bloco o Docker ignora o ufw. Com
# ele, so o que tiver `ufw route allow` fica acessivel de fora (github.com/chaifeng/ufw-docker).
regras_docker_user() {
    acrescentar /etc/ufw/after.rules "BEGIN UFW AND DOCKER" <<'RULES'

# BEGIN UFW AND DOCKER
*filter
:ufw-user-forward - [0:0]
:ufw-docker-logging-deny - [0:0]
:DOCKER-USER - [0:0]
-A DOCKER-USER -j ufw-user-forward
-A DOCKER-USER -j RETURN -s 10.0.0.0/8
-A DOCKER-USER -j RETURN -s 172.16.0.0/12
-A DOCKER-USER -j RETURN -s 192.168.0.0/16
-A DOCKER-USER -p udp -m udp --sport 53 --dport 1024:65535 -j RETURN
-A DOCKER-USER -j ufw-docker-logging-deny -p tcp -m tcp --tcp-flags FIN,SYN,RST,ACK SYN -d 192.168.0.0/16
-A DOCKER-USER -j ufw-docker-logging-deny -p tcp -m tcp --tcp-flags FIN,SYN,RST,ACK SYN -d 10.0.0.0/8
-A DOCKER-USER -j ufw-docker-logging-deny -p tcp -m tcp --tcp-flags FIN,SYN,RST,ACK SYN -d 172.16.0.0/12
-A DOCKER-USER -j ufw-docker-logging-deny -p udp -m udp --dport 0:32767 -d 192.168.0.0/16
-A DOCKER-USER -j ufw-docker-logging-deny -p udp -m udp --dport 0:32767 -d 10.0.0.0/8
-A DOCKER-USER -j ufw-docker-logging-deny -p udp -m udp --dport 0:32767 -d 172.16.0.0/12
-A DOCKER-USER -j RETURN
-A ufw-docker-logging-deny -m limit --limit 3/min --limit-burst 10 -j LOG --log-prefix "[UFW DOCKER BLOCK] "
-A ufw-docker-logging-deny -j DROP
COMMIT
# END UFW AND DOCKER
RULES
}

passo_atualizacoes() {
    cat <<'CONF' | escrever /etc/apt/apt.conf.d/20auto-upgrades 644 || true
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
    cat <<CONF | escrever "/etc/apt/apt.conf.d/52$NOME-unattended" 644 || true
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "$AUTO_REBOOT";
Unattended-Upgrade::Automatic-Reboot-Time "05:30";
CONF
    fazer systemctl enable --now unattended-upgrades
}

passo_docker() {
    log "$1 Docker CE (repositorio oficial do $OS_ID)"
    local versao compose
    if versao=$(docker --version 2>/dev/null); then
        compose=$(docker compose version --short 2>/dev/null) \
            || erro "$SAI_DOCKER" "Este servidor ja tem o Docker ($versao), mas sem o compose (docker compose). Instale o plugin docker-compose-plugin do repositorio do Docker, ou use um servidor sem Docker, e rode de novo."
        [[ $compose =~ ^v?([0-9]+) ]] && [ "${BASH_REMATCH[1]}" -ge 2 ] \
            || erro "$SAI_DOCKER" "O compose deste servidor e o $compose; o kit pede o 2 ou mais novo (docker compose)."
        info "ja instalado: $versao, compose $compose"
        DOCKER_NOVO=0
    else
        local chave tmp
        chave=$(r /etc/apt/keyrings/docker.asc)
        pasta /etc/apt/keyrings 755
        if [ "$SIMULAR" = 1 ]; then
            info "[simular] baixaria a chave de https://download.docker.com/linux/$OS_ID/gpg e conferiria a impressao digital $DOCKER_GPG_FPR"
        else
            tmp=$(mktemp "$chave.XXXXXX")
            curl -fsSL "https://download.docker.com/linux/$OS_ID/gpg" -o "$tmp" || { rm -f "$tmp"; erro "$SAI_FALHOU" "Nao consegui baixar a chave do repositorio do Docker (download.docker.com)."; }
            if ! gpg --show-keys --with-colons "$tmp" 2>/dev/null | awk -F: '$1 == "fpr" { print $10 }' | grep -qx "$DOCKER_GPG_FPR"; then
                rm -f "$tmp"
                erro "$SAI_FALHOU" "A chave baixada do repositorio do Docker nao e a esperada ($DOCKER_GPG_FPR): nada foi instalado."
            fi
            chmod a+r "$tmp"
            mv -f -- "$tmp" "$chave"
        fi
        printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' "$ARQUITETURA" "$OS_ID" "$OS_CODINOME" \
            | escrever /etc/apt/sources.list.d/docker.list 644 || true
        fazer apt-get "${apt_opts[@]}" update -q
        fazer apt-get "${apt_opts[@]}" install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        DOCKER_NOVO=1
    fi
    # Rotacao de log e live-restore, sem apagar o que o dono ja tinha no daemon.json (o que ele definiu fica).
    local daemon atual
    daemon=$(r /etc/docker/daemon.json)
    atual=$(cat "$daemon" 2>/dev/null || true)
    local novo
    novo=$(printf '%s' "$atual" | python3 -I -c '
import json, sys
texto = sys.stdin.read().strip()
try:
    conf = json.loads(texto) if texto else {}
except ValueError:
    sys.stderr.write("o daemon.json deste servidor nao e um JSON valido\n")
    sys.exit(3)
if not isinstance(conf, dict):
    sys.exit(3)
conf.setdefault("log-driver", "json-file")
if conf["log-driver"] in ("json-file", "local"):
    conf.setdefault("log-opts", {"max-size": "20m", "max-file": "5"})
conf.setdefault("live-restore", True)
print(json.dumps(conf, indent=2))
') || erro "$SAI_FALHOU" "O /etc/docker/daemon.json deste servidor nao e um JSON valido: corrija ou apague e rode de novo."
    local mudou=0
    if printf '%s\n' "$novo" | escrever /etc/docker/daemon.json 644; then mudou=1; fi
    fazer systemctl enable --now docker
    if [ "$mudou" = 1 ] || [ "$DOCKER_NOVO" = 1 ]; then fazer systemctl restart docker; fi
    [ "$PERFIL" != producao ] || fazer usermod -aG docker "$DEPLOY_USER"
    [ "$SIMULAR" = 1 ] || { docker --version; docker compose version; } | sed 's/^/  /'
}

passo_swap() {
    log "$1 Swap de ${SWAP_GB} GB"
    [ "$SWAP_GB" != "0" ] || { info "SWAP_GB=0: sem swap."; return 0; }
    local total_kb arquivo
    arquivo=$(r /swapfile)
    total_kb=$(swapon --show=SIZE --noheadings --bytes 2>/dev/null | awk '{ s += $1 } END { printf "%d", s / 1024 }')
    if [ "${total_kb:-0}" -ge $((SWAP_GB * 1024 * 1024 * 9 / 10)) ]; then
        info "ja ha $((total_kb / 1024)) MB de swap."
    elif swapon --show=NAME --noheadings 2>/dev/null | grep -qx "$arquivo"; then
        info "o /swapfile ja esta ligado."
    else
        if [ ! -f "$arquivo" ]; then
            fazer fallocate -l "${SWAP_GB}G" "$arquivo"
            fazer chmod 600 "$arquivo"
            fazer mkswap "$arquivo"
        fi
        # Em virtualizacao por container (OpenVZ, LXC) o swap nao liga: o kit segue sem ele, com o aviso.
        if ! fazer swapon "$arquivo"; then
            aviso "este servidor nao aceitou ligar o swap (virtualizacao por container?). Seguindo sem swap."
            fazer rm -f "$arquivo"
            return 0
        fi
        printf '/swapfile none swap sw 0 0\n' | acrescentar /etc/fstab "/swapfile none swap" || true
    fi
    if printf 'vm.swappiness=10\n' | escrever "/etc/sysctl.d/90-$NOME.conf" 644; then
        fazer sysctl -q -p "$(r "/etc/sysctl.d/90-$NOME.conf")"
    fi
    [ "$SIMULAR" = 1 ] || free -h | sed 's/^/  /'
}

# O backup do kit pede o restic 0.16 ou mais novo (--retry-lock). O apt do Ubuntu 22.04 (0.12) e do Debian 12 (0.14) traz
# um mais velho, sem `self-update`: baixa o binario oficial, conferido pelo sha256, em /usr/local/bin (antes de /usr/bin).
passo_restic() {
    local versao maior menor
    versao=$(restic version 2>/dev/null | awk '{ print $2; exit }' || true)
    if [[ $versao =~ ^([0-9]+)\.([0-9]+) ]] && { [ "${BASH_REMATCH[1]}" -gt 0 ] || [ "${BASH_REMATCH[2]}" -ge 16 ]; }; then
        info "restic $versao"
        return 0
    fi
    local soma arquivo destino
    case "$RESTIC_VERSAO/$ARQUITETURA" in
        0.18.1/amd64) soma=680838f19d67151adba227e1570cdd8af12c19cf1735783ed1ba928bc41f363d ;;
        *) soma="${RESTIC_SHA256:?informe RESTIC_SHA256 para o restic $RESTIC_VERSAO ($ARQUITETURA)}" ;;
    esac
    info "o restic do apt e o ${versao:-desconhecido}; o backup pede o 0.16 ou mais novo: baixando o $RESTIC_VERSAO oficial"
    if [ "$SIMULAR" = 1 ]; then
        info "[simular] baixaria https://github.com/restic/restic/releases/download/v$RESTIC_VERSAO/restic_${RESTIC_VERSAO}_linux_$ARQUITETURA.bz2, conferiria o sha256 $soma e instalaria em /usr/local/bin/restic"
        return 0
    fi
    arquivo=$(mktemp "$(r /tmp)/restic.XXXXXX")
    destino=$(r /usr/local/bin/restic)
    curl -fsSL -o "$arquivo" "https://github.com/restic/restic/releases/download/v$RESTIC_VERSAO/restic_${RESTIC_VERSAO}_linux_$ARQUITETURA.bz2" \
        || { rm -f "$arquivo"; erro "$SAI_FALHOU" "Nao consegui baixar o restic $RESTIC_VERSAO (github.com)."; }
    echo "$soma  $arquivo" | sha256sum -c - >/dev/null 2>&1 || { rm -f "$arquivo"; erro "$SAI_FALHOU" "O sha256 do restic baixado nao bate: nada foi instalado."; }
    mkdir -p "$(dirname -- "$destino")"
    bunzip2 -c "$arquivo" > "$destino.novo"
    rm -f "$arquivo"
    chmod 0755 "$destino.novo"
    mv -f -- "$destino.novo" "$destino"
    info "$("$destino" version)"
}

passo_supabase_cli() {
    log "$1 CLI do Supabase $SUPABASE_CLI_VERSION"
    if [ -n "${SEM_SUPABASE_CLI:-}" ]; then
        echo "  pulada (SEM_SUPABASE_CLI): este servidor nao tem Supabase."
    elif ! supabase --version 2>/dev/null | grep -q "$SUPABASE_CLI_VERSION"; then
        local arch deb sum
        arch=$ARQUITETURA
        deb="$(r /tmp)/supabase_${SUPABASE_CLI_VERSION}_linux_${arch}.deb"
        # O .deb entra como root: so com o sha256 do checksums.txt do release (trocar junto com a versao).
        case "$SUPABASE_CLI_VERSION/$arch" in
            2.121.0/amd64) sum=f6e10fc4086390ca386127bb4fd1a5e578625f95e7db84255a6bb82a159f973f ;;
            2.121.0/arm64) sum=c7f58ceeac60c38a6a72d7835e1157f2bcd55b40349964f9234c324b6c4733b8 ;;
            *) sum="${SUPABASE_CLI_SHA256:?informe SUPABASE_CLI_SHA256 para a versao $SUPABASE_CLI_VERSION ($arch)}" ;;
        esac
        if [ "$SIMULAR" = 1 ]; then
            info "[simular] baixaria e instalaria a CLI do Supabase $SUPABASE_CLI_VERSION (sha256 $sum)"
        else
            curl -fsSL -o "$deb" "https://github.com/supabase/cli/releases/download/v${SUPABASE_CLI_VERSION}/supabase_${SUPABASE_CLI_VERSION}_linux_${arch}.deb"
            echo "$sum  $deb" | sha256sum -c - >/dev/null || { rm -f "$deb"; echo "Checksum da CLI do Supabase nao bate." >&2; exit 1; }
            dpkg -i "$deb" >/dev/null
            rm -f "$deb"
        fi
    fi
    [ -n "${SEM_SUPABASE_CLI:-}" ] || [ "$SIMULAR" = 1 ] || supabase --version
}

# ---- producao -----------------------------------------------------------------------------------------------------
producao_usuario() {
    log "2/9 Usuario $DEPLOY_USER"
    if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
        fazer adduser --disabled-password --gecos "$NOME deploy" "$DEPLOY_USER"
    fi
    fazer usermod -aG sudo "$DEPLOY_USER"
    printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$DEPLOY_USER" | escrever "/etc/sudoers.d/90-$DEPLOY_USER" 440 || true
    local home chaves
    home=$(getent passwd "$DEPLOY_USER" | cut -d: -f6 || true)
    [ -n "$home" ] || home="/home/$DEPLOY_USER"
    chaves=$(r "$home/.ssh/authorized_keys")
    pasta "$home/.ssh" 700
    [ "$SIMULAR" = 1 ] || touch "$chaves"
    if [ -n "${SSH_PUBLIC_KEY:-}" ]; then
        printf '%s\n' "$SSH_PUBLIC_KEY" | acrescentar "$home/.ssh/authorized_keys" "$SSH_PUBLIC_KEY" || true
    elif [ -s "$(r /root/.ssh/authorized_keys)" ] && [ "$SIMULAR" != 1 ]; then
        cat "$(r /root/.ssh/authorized_keys)" >> "$chaves"
        sort -u -o "$chaves" "$chaves"
        echo "Sem SSH_PUBLIC_KEY: copiei as chaves do root para $DEPLOY_USER."
    fi
    if [ "$SIMULAR" != 1 ]; then
        chmod 600 "$chaves"
        [ -s "$chaves" ] || { echo "Nenhuma chave SSH para $DEPLOY_USER: informe SSH_PUBLIC_KEY. Abortando antes de fechar o SSH por senha." >&2; exit 1; }
    elif [ -z "${SSH_PUBLIC_KEY:-}" ] && [ ! -s "$(r /root/.ssh/authorized_keys)" ] && [ ! -s "$chaves" ]; then
        echo "Nenhuma chave SSH para $DEPLOY_USER: informe SSH_PUBLIC_KEY. Abortando antes de fechar o SSH por senha (simulacao)." >&2
        exit 1
    fi
    fazer chown -R "$DEPLOY_USER:$DEPLOY_USER" "$(r "$home/.ssh")"
}

producao_ssh() {
    log "3/9 SSH so com chave (porta $SSH_PORT)"
    local mudou=0
    if escrever "/etc/ssh/sshd_config.d/90-$NOME.conf" 644 <<CONF
Port $SSH_PORT
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password
PermitEmptyPasswords no
X11Forwarding no
MaxAuthTries 4
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
AllowUsers root $DEPLOY_USER
CONF
    then mudou=1; fi
    # Ubuntu 24.04 usa socket activation: a porta vem do systemd, nao do sshd_config.
    if [ "$SSH_PORT" != "22" ]; then
        if printf '[Socket]\nListenStream=\nListenStream=%s\n' "$SSH_PORT" | escrever /etc/systemd/system/ssh.socket.d/listen.conf 644; then
            fazer systemctl daemon-reload
            mudou=1
        fi
    fi
    # Com socket activation, /run/sshd so existe depois que o ssh.service subiu uma vez; sem ele o `sshd -t`
    # recusa ("Missing privilege separation directory") e sai com 255.
    fazer install -d -m 0755 "$(r /run/sshd)"
    [ "$SIMULAR" = 1 ] || sshd -t
    if [ "$mudou" = 1 ]; then
        fazer systemctl restart ssh.socket 2>/dev/null || true
        fazer systemctl restart ssh
    fi
}

producao_firewall() {
    log "4/9 ufw (+ regras DOCKER-USER)"
    fazer ufw --force reset
    fazer ufw default deny incoming
    fazer ufw default allow outgoing
    # allow, nao limit: o firewall da Hetzner ja restringe quem chega na 22, e o deploy abre dezenas de
    # comandos SSH em sequencia (o limit do ufw recusaria a sexta conexao em 30 s). Senha errada e com o fail2ban.
    fazer ufw allow "$SSH_PORT/tcp" comment "SSH"
    fazer ufw allow 80/tcp comment "HTTP (Caddy)"
    fazer ufw allow 443/tcp comment "HTTPS (Caddy)"
    fazer ufw allow 443/udp comment "HTTP/3 (Caddy)"
    regras_docker_user || true
    # O Caddy e o unico container com porta publica (80/443); o resto do stack fica em 127.0.0.1.
    fazer ufw route allow proto tcp from any to any port 80 comment "Caddy"
    fazer ufw route allow proto tcp from any to any port 443 comment "Caddy"
    fazer ufw route allow proto udp from any to any port 443 comment "Caddy HTTP/3"
    fazer ufw --force enable
    [ "$SIMULAR" = 1 ] || ufw status verbose
}

producao_fail2ban() {
    log "5/9 fail2ban e unattended-upgrades"
    local mudou=0
    if escrever /etc/fail2ban/jail.d/sshd.local 644 <<CONF
[sshd]
enabled = true
port = $SSH_PORT
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
CONF
    then mudou=1; fi
    fazer systemctl enable --now fail2ban
    [ "$mudou" = 0 ] || fazer systemctl restart fail2ban
    passo_atualizacoes
}

producao_pastas() {
    log "9/9 Pasta do repositorio"
    pasta "$REPO_DIR" 755 "$DEPLOY_USER:$DEPLOY_USER"
    pasta "$PASTA_BACKUP" 700 "$DEPLOY_USER:$DEPLOY_USER"
}

preparar_producao() {
    passo_pacotes "1/9"
    producao_usuario
    producao_ssh
    producao_firewall
    producao_fail2ban
    passo_docker "6/9"
    passo_swap "7/9"
    passo_supabase_cli "8/9"
    passo_restic
    producao_pastas
    [ "$SIMULAR" != 1 ] || { printf '\nSimulacao: nada foi mudado neste servidor.\n'; return 0; }
    cat <<FIM

Servidor preparado. Proximos passos (docs/20-runbook-hetzner.md, "Primeiro deploy"):
  1. Em OUTRO terminal, confirme que entra como $DEPLOY_USER antes de fechar este: ssh -p $SSH_PORT $DEPLOY_USER@<ip>
  2. Como $DEPLOY_USER: git clone <repositorio> $REPO_DIR  (chave de deploy, repositorio privado)
  3. cd $REPO_DIR && sh infra/compose/generate-secrets.sh --domain ... --api-domain ... --studio-domain ... --email ...
  4. Preencha SMTP_PASS, STORAGE_BOX_*, STUDIO_ALLOWED_IPS e APP_IMAGE no infra/compose/.env
  5. docker login ghcr.io; docker compose -f infra/compose/docker-compose.yml up -d; sh infra/scripts/migrate.sh
  6. sh infra/scripts/backup.sh --init && sudo sh infra/scripts/backup.sh --install-timer
FIM
}

# ---- kit ------------------------------------------------------------------------------------------------------------
# A conta de quem entrou: a do sudo, a do registro do sshd para esta sessao, ou o root.
kit_conta_do_dono() {
    if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
        printf '%s' "$SUDO_USER"
    elif [ -n "${SESSAO_USUARIO:-}" ]; then
        printf '%s' "$SESSAO_USUARIO"
    else
        printf 'root'
    fi
}

kit_chave_nova() {
    local conta=$1 chave=$2 home tmp
    case "$chave" in
        *PRIVATE\ KEY*) erro "$SAI_USO" "Isso e a chave PRIVADA. Mande so a publica: o conteudo do arquivo que termina em .pub." ;;
    esac
    [[ $chave =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\ [A-Za-z0-9+/]+=*(\ [^[:cntrl:]]*)?$ ]] \
        || erro "$SAI_USO" "A chave nao parece uma chave publica do SSH (o conteudo do arquivo .pub, numa linha so, comecando por ssh-ed25519 ou ssh-rsa)."
    tmp=$(mktemp)
    printf '%s\n' "$chave" > "$tmp"
    if ! ssh-keygen -l -f "$tmp" >/dev/null 2>&1; then
        rm -f "$tmp"
        erro "$SAI_USO" "O ssh-keygen nao reconhece essa chave publica: copie de novo o arquivo .pub inteiro."
    fi
    rm -f "$tmp"
    home=$(getent passwd "$conta" | cut -d: -f6 || true)
    [ -n "$home" ] || erro "$SAI_USO" "Nao achei a conta $conta neste servidor."
    # "conta:" e o grupo de login da conta, que nem sempre tem o nome dela.
    pasta "$home/.ssh" 700 "$conta:"
    if printf '%s\n' "$chave" | acrescentar "$home/.ssh/authorized_keys" "$chave"; then
        [ "$SIMULAR" = 1 ] || chmod 600 "$(r "$home/.ssh/authorized_keys")"
        fazer chown "$conta:" "$(r "$home/.ssh/authorized_keys")"
        CHAVE_ACRESCENTADA=1
    fi
}

kit_ssh() {
    log "2/8 SSH: o acesso de hoje continua"
    local conta senha
    conta=$(kit_conta_do_dono)
    [ -z "${SSH_PUBLIC_KEY:-}" ] || kit_chave_nova "$conta" "$SSH_PUBLIC_KEY"
    senha=$(sshd_efetivo passwordauthentication)
    SENHA_LIGADA=0
    if [ "$senha" != no ] || [ "$(sshd_efetivo kbdinteractiveauthentication)" = yes ]; then SENHA_LIGADA=1; fi
    info "login por senha: $([ "$SENHA_LIGADA" = 1 ] && echo ligado || echo fechado); esta sessao: ${SESSAO_METODO:-nao e SSH ou nao achei no registro}; conta: $conta"
    info "nada no sshd muda neste passo: o login por senha so fecha com --fechar-login-por-senha (docs/20 §9C)"
}

kit_firewall() {
    log "3/8 Firewall (ufw): as portas do SSH, 80 e 443; o que ja existia fica"
    local portas p regras_antes ativo_antes=0 abertas
    portas=$(portas_do_ssh)
    [ -n "$portas" ] || portas=22
    PORTAS_SSH=$portas
    if [ "$FIREWALL" = dono ]; then
        info "--manter-firewall: o firewall deste servidor e seu e nao foi tocado. Deixe abertas de fora: $portas (SSH), 80/tcp, 443/tcp e 443/udp."
        return 0
    fi
    if ufw_instalado; then
        ufw status 2>/dev/null | grep -q '^Status: active' && ativo_antes=1
        regras_antes=$(ufw show added 2>/dev/null | grep '^ufw ' || true)
    else
        regras_antes=""
    fi
    FIREWALL_ATIVO_ANTES=$ativo_antes
    REGRAS_DO_DONO=$(printf '%s\n' "$regras_antes" | grep -v "comment '$NOME " | grep -c '^ufw ' || true)
    if [ "$ativo_antes" = 0 ]; then
        # O que deixa de responder de fora quando o ufw liga com "nega o que chega" (a politica do kit).
        abertas=$(ss -H -ltnu 2>/dev/null | awk '{ n = split($5, a, ":"); porta = a[n]; ip = substr($5, 1, length($5) - length(porta) - 1); if (ip !~ /^(127\.|\[?::1\]?$|localhost)/) print porta "/" $1 }' | sort -u \
            | grep -v -x -E "($(printf '%s' "$portas" | tr ' ' '|')|80|443)/(tcp|udp)" | tr '\n' ' ' | sed 's/ $//' || true)
        [ -z "$abertas" ] || aviso "com o firewall ligado, estas portas deixam de responder de fora: $abertas. Se precisar de alguma: sudo ufw allow PORTA/tcp."
        fazer ufw default deny incoming
        fazer ufw default allow outgoing
    else
        info "o ufw ja estava ligado: a politica e as $REGRAS_DO_DONO regra(s) que ja existiam ficam como estao."
    fi
    for p in $portas; do
        if [ "$SSH_LIMITE" = 1 ]; then
            # 6 conexoes novas em 30 s por IP; quem automatiza (a IA por SSH) usa uma conexao so (ControlMaster).
            fazer ufw limit "$p/tcp" comment "$NOME SSH"
            if printf '%s\n' "$regras_antes" | grep -v "comment '$NOME " | grep -qE "^ufw allow ($p(/tcp)?|OpenSSH|ssh)( |$)"; then
                aviso "a regra que ja existia (ufw allow $p) vem antes do limite: o limite do SSH so vale sem ela (sudo ufw delete allow $p/tcp)."
            fi
        else
            fazer ufw allow "$p/tcp" comment "$NOME SSH"
        fi
    done
    fazer ufw allow 80/tcp comment "$NOME HTTP"
    fazer ufw allow 443/tcp comment "$NOME HTTPS"
    fazer ufw allow 443/udp comment "$NOME HTTP/3"
    if printf '%s\n' "$regras_antes" | grep -qE '^ufw (deny|reject) .*\b(80|443)\b'; then
        aviso "existe uma regra que bloqueia a 80 ou a 443 antes das do kit: a area nao vai responder de fora enquanto ela existir."
    fi
    local docker_user=0
    if regras_docker_user; then docker_user=1; fi
    fazer ufw route allow proto tcp from any to any port 80 comment "$NOME Caddy"
    fazer ufw route allow proto tcp from any to any port 443 comment "$NOME Caddy"
    fazer ufw route allow proto udp from any to any port 443 comment "$NOME Caddy HTTP/3"
    if [ "$ativo_antes" = 0 ]; then
        fazer ufw --force enable
    elif [ "$docker_user" = 1 ]; then
        fazer ufw reload
    fi
}

kit_fail2ban() {
    log "4/8 fail2ban e atualizacoes automaticas"
    local do_dono mudou=0 ignorar="127.0.0.1/8 ::1"
    do_dono=$(grep -ls '^\[sshd\]' "$(r /etc/fail2ban/jail.local)" "$(r /etc/fail2ban/jail.d)"/*.conf "$(r /etc/fail2ban/jail.d)"/*.local 2>/dev/null \
        | grep -v -e "/$NOME-sshd\.local\$" -e '/defaults-debian\.conf$' || true)
    if [ -n "$do_dono" ]; then
        info "o fail2ban deste servidor ja tem regra para o SSH (${do_dono//$'\n'/, }): fica como esta."
    else
        # O IP de quem esta preparando o servidor nunca e banido por senha errada: o dono nao fica trancado do lado de fora.
        [ -z "${SESSAO_IP:-}" ] || ignorar="$ignorar $SESSAO_IP"
        if escrever "/etc/fail2ban/jail.d/$NOME-sshd.local" 644 <<CONF
[sshd]
enabled = true
port = ${PORTAS_SSH// /,}
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
ignoreip = $ignorar
CONF
        then mudou=1; fi
    fi
    fazer systemctl enable --now fail2ban
    [ "$mudou" = 0 ] || fazer systemctl restart fail2ban
    passo_atualizacoes
    info "reinicio automatico depois das atualizacoes: $([ "$AUTO_REBOOT" = true ] && echo 'ligado, as 05:30 do horario do servidor' || echo 'desligado (--reinicio-automatico liga)')"
}

kit_pastas() {
    log "8/8 Pastas do kit"
    pasta "$PASTA_ESTADO" 755
    pasta "$PASTA_BACKUP" 700
    pasta "$PASTA_CERTIFICADOS" 700
    pasta "$PASTA_INSTALACAO" 755
}

kit_resumo() {
    [ "$SIMULAR" != 1 ] || { printf '\nSimulacao: nada foi mudado neste servidor.\n'; return 0; }
    printf '\nServidor preparado para o kit (%s, %s).\n' "$OS_NOME" "$ARQUITETURA"
    if [ "$FIREWALL" = dono ]; then
        printf '  Firewall: e seu (--manter-firewall). Deixe abertas: %s (SSH), 80 e 443.\n' "$PORTAS_SSH"
    else
        printf '  Firewall: ligado; abertas %s (SSH%s), 80 e 443; %s regra(s) que ja existiam ficaram.\n' "$PORTAS_SSH" "$([ "$SSH_LIMITE" = 1 ] && echo ', com limite de conexoes')" "${REGRAS_DO_DONO:-0}"
    fi
    if [ "$SENHA_LIGADA" = 1 ]; then
        cat <<FIM
  Login por senha: LIGADO (nada no SSH foi mudado). Para fechar sem risco de ficar de fora:
    1. no seu computador, crie uma chave (ssh-keygen -t ed25519) e cadastre a parte publica:
       sudo $COMANDO --chave-ssh "ssh-ed25519 AAAA... voce"
    2. abra OUTRO terminal e entre com a chave: ssh -i ~/.ssh/id_ed25519 $(kit_conta_do_dono)@<ip do servidor>
    3. nesse terminal novo, rode: sudo $COMANDO --fechar-login-por-senha
FIM
    else
        printf '  Login por senha: fechado; so entra quem tem chave.\n'
    fi
    [ "${CHAVE_ACRESCENTADA:-0}" = 0 ] || printf '  Chave nova cadastrada na conta %s: teste a entrada com ela num outro terminal.\n' "$(kit_conta_do_dono)"
    printf '  Reinicio automatico: %s.\n' "$([ "$AUTO_REBOOT" = true ] && echo 'ligado (05:30 do horario do servidor)' || echo 'desligado')"
    [ ! -f "$(r /var/run/reboot-required)" ] || printf '  O servidor pede um reinicio para terminar as atualizacoes: sudo reboot quando puder.\n'
}

preparar_kit() {
    # Antes de mudar qualquer coisa: o firewall de outro programa (o kit nao mexe no firewalld nem soma o ufw a ele).
    if [ "$FIREWALL" != dono ] && servico_ativo firewalld; then
        erro "$SAI_FIREWALL" "Este servidor usa o firewalld. O kit nao mexe nele: abra as portas do SSH, 80/tcp, 443/tcp e 443/udp no firewalld e rode de novo com --manter-firewall (nada foi mudado)."
    fi
    passo_pacotes "1/8"
    kit_ssh
    kit_firewall
    kit_fail2ban
    passo_docker "5/8"
    passo_swap "6/8"
    log "7/8 restic"
    passo_restic
    kit_pastas
    kit_resumo
}

# ---- kit: fechar o login por senha -------------------------------------------------------------------------------
fechar_login_por_senha() {
    log "Fechar o login por senha"
    [ -n "${SESSAO_IP:-}" ] \
        || erro "$SAI_CHAVE" "Rode este passo numa sessao SSH aberta com a sua chave (nao pelo console do provedor). Nada mudou."
    case "${SESSAO_METODO:-}" in
        publickey) ;;
        "") erro "$SAI_CHAVE" "Nao achei no registro do SSH como esta sessao entrou ($SESSAO_IP, porta $SESSAO_PORTA). Por seguranca, nada mudou." ;;
        *) erro "$SAI_CHAVE" "Esta sessao entrou por senha (${SESSAO_METODO}). Abra outro terminal, entre com a sua chave e rode este passo la. Nada mudou." ;;
    esac
    local contexto=(-C "user=${SESSAO_USUARIO:-root},host=${SESSAO_IP},addr=${SESSAO_IP}")
    if [ "$(sshd_efetivo passwordauthentication "${contexto[@]}")" = no ] && [ "$(sshd_efetivo kbdinteractiveauthentication "${contexto[@]}")" = no ]; then
        info "o login por senha ja esta fechado; nada mudou."
        return 0
    fi
    [ -t 0 ] || erro "$SAI_TERMINAL" "Fechar o login por senha pede a confirmacao de uma pessoa no terminal. Nada mudou."
    local arquivo="/etc/ssh/sshd_config.d/01-$NOME-sem-senha.conf" resposta
    if [ "$SIMULAR" = 1 ]; then
        info "[simular] pediria a confirmacao, gravaria $arquivo (PasswordAuthentication no, KbdInteractiveAuthentication no), conferiria com sshd -t e sshd -T e recarregaria o ssh"
        return 0
    fi
    printf '  Esta sessao entrou com chave (conta %s, de %s). Depois disto, so entra pelo SSH quem tem uma chave cadastrada;\n' "${SESSAO_USUARIO:-root}" "$SESSAO_IP"
    printf '  as sessoes abertas continuam, e o console do provedor nao muda.\n  Digite FECHAR para fechar o login por senha: '
    IFS= read -r resposta || true
    [ "$resposta" = FECHAR ] || erro "$SAI_USO" "Confirmacao diferente de FECHAR: nada mudou."
    # 01-: o sshd usa o primeiro valor que le, e o 50-cloud-init.conf de muitos provedores liga a senha.
    escrever "$arquivo" 644 <<CONF || true
# $NOME: login por senha fechado por quem entrou com chave e confirmou (preparar-servidor --fechar-login-por-senha).
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
CONF
    install -d -m 0755 "$(r /run/sshd)"
    local erro_sshd
    if ! erro_sshd=$(sshd -t 2>&1); then
        rm -f "$(r "$arquivo")"
        erro "$SAI_SSH" "O sshd recusou a configuracao (${erro_sshd:-sem detalhe}); voltou como estava."
    fi
    if [ "$(sshd_efetivo passwordauthentication "${contexto[@]}")" != no ] || [ "$(sshd_efetivo kbdinteractiveauthentication "${contexto[@]}")" != no ]; then
        local quem
        quem=$(grep -ilE '^[[:space:]]*(PasswordAuthentication|KbdInteractiveAuthentication)[[:space:]]+yes' "$(r /etc/ssh/sshd_config)" "$(r /etc/ssh/sshd_config.d)"/*.conf 2>/dev/null | sed "s|^$RAIZ||" | tr '\n' ' ' || true)
        rm -f "$(r "$arquivo")"
        erro "$SAI_SSH" "Outro trecho da configuracao do SSH manda no login por senha (${quem:-um bloco Match}); voltou como estava. Ajuste esse arquivo e rode de novo."
    fi
    systemctl reload ssh 2>/dev/null || systemctl reload sshd
    printf '\n  Login por senha fechado. Antes de fechar este terminal, entre de novo com a chave num terceiro terminal.\n'
}

# ---- comeco -------------------------------------------------------------------------------------------------------
ler_sistema
SESSAO_IP="" SESSAO_PORTA="" SESSAO_PORTA_SERVIDOR="" SESSAO_METODO="" SESSAO_USUARIO=""
if [ "$PERFIL" = kit ]; then
    if conexao=$(sessao_ssh); then
        read -r SESSAO_IP SESSAO_PORTA _ SESSAO_PORTA_SERVIDOR <<< "$conexao"
        read -r SESSAO_METODO SESSAO_USUARIO <<< "$(entrada_da_sessao "$SESSAO_IP" "$SESSAO_PORTA")" || true
    fi
fi
[ "$SIMULAR" != 1 ] || printf 'Simulacao (--simular): nada sera mudado; os comandos aparecem com [simular].\n'
case "$PERFIL/$ACAO" in
    producao/preparar) preparar_producao ;;
    kit/preparar) preparar_kit ;;
    kit/fechar-senha) fechar_login_por_senha ;;
esac

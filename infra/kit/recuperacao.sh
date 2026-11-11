#!/usr/bin/env bash
# Kit de recuperacao (docs/32 §4 e §14; docs/20 §9B). Pelo comando de operacao, no terminal do servidor:
#   sudo membros kit-de-recuperacao            cria a chave de recuperacao do backup, mostra a folha e pede a confirmacao
#                                              (ou mostra de novo a folha que ficou pendente)
#   sudo membros kit-de-recuperacao --nova     outra chave e outra folha (perdeu a folha?); a antiga sai do backup
#                                              quando a nova for confirmada, nunca antes
#   sudo membros kit-de-recuperacao --conferir 0 se ha kit confirmado e a chave dele ainda abre o backup; 6 se nao
#                                              (o instalador so termina com 0)
# A chave de recuperacao e uma segunda senha do repositorio do restic (restic key add), sorteada aqui: 32 letras e
# numeros sem I, L, O e U, em 8 grupos de 4. A folha (texto simples, uma pagina) traz o destino, essa chave e o que fazer
# se o servidor morrer. A pessoa confirma digitando dois grupos sorteados da chave; so entao a instalacao conta como
# pronta. Depois da confirmacao a chave sai do servidor (o arquivo e apagado com shred): o servidor guarda so o
# identificador dela no repositorio. Por que: se a chave ficasse aqui, ela vazaria junto com qualquer coisa que vaze do
# servidor (um suporte, a IA lendo arquivos, uma copia do disco), e a pessoa perderia a unica senha que nao depende do
# servidor; e o servidor nao precisa dela, porque o backup diario usa a senha dele (RESTIC_PASSWORD).
# Enquanto nao e confirmada, a folha fica em KIT_FOLHA_PENDENTE (0600, so o administrador) para a pessoa ver de novo.
# A chave so aparece com uma pessoa no terminal: sem terminal (a IA rodando o comando), para com o codigo 7 sem criar
# nada. Codigos de saida: os de lib-kit.sh.
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: o script usa arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "${BASH_SOURCE[0]}")/lib-kit.sh"
KIT_OPERACAO="membros kit-de-recuperacao"

modo=criar
for arg in "$@"; do
    case "$arg" in
        --nova) modo=nova ;;
        --conferir) modo=conferir ;;
        -h|--help) sed -n 2,18p "$0"; exit 0 ;;
        *) sair "$SAI_USO" "opcao desconhecida: $arg (veja: membros kit-de-recuperacao --help)" ;;
    esac
done

exigir_segredos
destino_carregar
senha_do_servidor

ids_das_chaves() { restic key list --json | kit_py ids-das-chaves; }
# O id que o restic mostra pode ser curto (8) ou inteiro (64): compara pelo comeco.
chave_existe() {
    local procurado=$1 id
    while read -r id; do
        [ -n "$id" ] || continue
        case "$id" in "$procurado"*) return 0 ;; esac
        case "$procurado" in "$id"*) return 0 ;; esac
    done < <(ids_das_chaves)
    return 1
}

confirmada=$(situacao_ler recuperacao.chave_id || true)
pendente=$(situacao_ler recuperacao.pendente_id || true)

if [ "$modo" = conferir ]; then
    rc=0; restic_abrir || rc=$?
    [ "$rc" = 0 ] || sair "$SAI_DESTINO" "Nao consegui abrir o backup para conferir a chave de recuperacao: $RESTIC_MOTIVO"
    if [ -z "$confirmada" ]; then
        if [ -n "$pendente" ]; then sair "$SAI_PENDENTE" "O kit de recuperacao esta pendente: a pessoa precisa confirmar a folha (sudo membros kit-de-recuperacao, no terminal)."; fi
        sair "$SAI_PENDENTE" "Ainda nao ha kit de recuperacao: sudo membros kit-de-recuperacao, no terminal do servidor."
    fi
    chave_existe "$confirmada" || sair "$SAI_PENDENTE" "A chave de recuperacao confirmada ($confirmada) nao esta mais no backup: gere outra com sudo membros kit-de-recuperacao --nova."
    log "Kit de recuperacao confirmado em $(situacao_ler recuperacao.confirmada_em); a chave $confirmada continua no backup."
    exit 0
fi

[ -t 0 ] && [ -t 1 ] || sair "$SAI_TERMINAL" "O kit de recuperacao mostra uma chave que so a pessoa pode ver: rode no terminal do servidor (sudo membros kit-de-recuperacao). Pela IA, nao; nada foi criado."
if [ "$modo" = criar ] && [ -n "$confirmada" ] && [ -z "$pendente" ]; then
    log "Ja ha um kit de recuperacao confirmado em $(situacao_ler recuperacao.confirmada_em) (chave $confirmada)."
    log "Perdeu a folha? Gere outra com: sudo membros kit-de-recuperacao --nova"
    exit 0
fi

trava_backup 0
chave_temporaria_criar
trap 'chave_temporaria_apagar' EXIT
trap 'printf "\nInterrompido. A folha continua pendente: rode de novo sudo membros kit-de-recuperacao.\n" >&2; exit 130' INT
trap 'exit 143' TERM HUP

rc=0; restic_abrir || rc=$?
case "$rc" in
    0) ;;
    10) sair "$SAI_DESTINO" "Ainda nao ha backup no destino: rode antes sudo membros backup --iniciar e sudo membros backup." ;;
    12) sair "$SAI_CHAVE" "A senha deste servidor nao abre o backup do destino." ;;
    *) sair "$SAI_DESTINO" "O destino do backup nao respondeu: $RESTIC_MOTIVO" ;;
esac

chave="$KIT_DIR_CHAVE/chave"
mkdir -p "$KIT_PASTA_RECUPERACAO"; chmod 700 "$KIT_PASTA_RECUPERACAO"

# Uma folha pendente que nao serve mais (--nova, o arquivo sumiu ou a chave dela saiu do backup): a chave dela sai do
# repositorio antes de criar outra.
if [ -n "$pendente" ] && { [ "$modo" = nova ] || [ ! -s "$KIT_FOLHA_PENDENTE" ] || ! chave_existe "$pendente"; }; then
    if chave_existe "$pendente"; then restic key remove "$pendente" >/dev/null 2>&1 || warn "nao consegui tirar do backup a chave pendente $pendente."; fi
    [ ! -f "$KIT_FOLHA_PENDENTE" ] || shred -u "$KIT_FOLHA_PENDENTE"
    situacao_gravar recuperacao.pendente_id=x: recuperacao.pendente_desde=x:
    pendente=""
fi

if [ -n "$pendente" ]; then
    log "A folha de $(situacao_ler recuperacao.pendente_desde) ainda nao foi confirmada: e ela de novo."
    # A chave da folha pendente, para conferir a resposta (a linha da chave e a unica no formato dela).
    grep -m1 -E '^   [0-9A-Z]{4}(-[0-9A-Z]{4}){7}$' "$KIT_FOLHA_PENDENTE" | tr -d ' ' > "$chave"
    [ -s "$chave" ] || sair "$SAI_FALHOU" "A folha pendente esta estragada: gere outra com sudo membros kit-de-recuperacao --nova."
    KIT_ARQUIVO_CHAVE_EM_USO=$chave
else
    kit_py gerar-chave | tr -d '\n' > "$chave"
    KIT_ARQUIVO_CHAVE_EM_USO=$chave
    antes=$(ids_das_chaves | sort)
    restic key add --new-password-file "$chave" >/dev/null || sair "$SAI_FALHOU" "Nao consegui cadastrar a chave de recuperacao no backup."
    novo=$(comm -13 <(printf '%s\n' "$antes") <(ids_das_chaves | sort) | head -n1)
    [ -n "$novo" ] || sair "$SAI_FALHOU" "A chave nova nao apareceu na lista do backup."
    env -u RESTIC_PASSWORD RESTIC_PASSWORD_FILE="$chave" restic cat config >/dev/null 2>&1 \
        || { restic key remove "$novo" >/dev/null 2>&1 || true; sair "$SAI_FALHOU" "A chave nova nao abriu o backup; ela foi tirada de novo."; }
    escola=$(kit_py endereco-da-escola < "$ENV_FILE")
    acesso_id=""
    [ "$DESTINO_TIPO" != s3 ] || acesso_id=$AWS_ACCESS_KEY_ID
    FOLHA_TIPO=$DESTINO_TIPO FOLHA_DESTINO=$RESTIC_REPOSITORY FOLHA_ACESSO_ID=$acesso_id FOLHA_ESCOLA=$escola \
        FOLHA_MAQUINA=$(hostname) FOLHA_CHAVE_ID=$novo FOLHA_ARQUIVO_CHAVE=$chave FOLHA_QUANDO=$(agora_utc) \
        kit_py folha > "$KIT_FOLHA_PENDENTE"
    chmod 600 "$KIT_FOLHA_PENDENTE"
    situacao_gravar "recuperacao.pendente_id=$novo" "recuperacao.pendente_desde=$(agora_utc)"
    pendente=$novo
fi

linha=$(printf '%.0s=' {1..78})
printf '\n%s\n' "$linha"
cat "$KIT_FOLHA_PENDENTE"
printf '%s\n\n' "$linha"
printf 'Imprima esta folha ou copie para o seu cofre de senhas AGORA. Depois da confirmacao,\n'
printf 'a chave sai deste servidor e nao aparece mais.\n\n'

for tentativa in 1 2 3; do
    read -r g1 g2 <<< "$(kit_py sortear-grupos)"
    printf 'Para confirmar que guardou, digite o grupo %s e o grupo %s da chave de recuperacao\n(os 8 caracteres juntos; os hifens nao contam): ' "$g1" "$g2"
    resposta=""
    IFS= read -r resposta || { printf '\n'; break; }
    if printf '%s' "$resposta" | kit_py conferir-grupos "$chave" "$g1" "$g2"; then
        if [ -n "$confirmada" ] && [ "$confirmada" != "$pendente" ] && chave_existe "$confirmada"; then
            restic key remove "$confirmada" >/dev/null || sair "$SAI_FALHOU" "A folha nova vale, mas nao consegui tirar do backup a chave antiga ($confirmada). Rode de novo: sudo membros kit-de-recuperacao --nova."
            log "A chave da folha antiga ($confirmada) saiu do backup: aquela folha nao abre mais nada."
        fi
        shred -u "$KIT_FOLHA_PENDENTE"
        situacao_gravar "recuperacao.chave_id=$pendente" "recuperacao.confirmada_em=$(agora_utc)" recuperacao.pendente_id=x: recuperacao.pendente_desde=x:
        log "Kit de recuperacao confirmado. A chave saiu deste servidor: ela existe so na sua folha."
        log "Teste a folha uma vez por trimestre: sudo membros restaurar --ensaio"
        exit 0
    fi
    printf 'Nao confere.\n'
done
sair "$SAI_PENDENTE" "A folha nao foi confirmada e continua pendente (a chave dela ja abre o backup). Quando estiver com ela em maos, rode de novo: sudo membros kit-de-recuperacao"

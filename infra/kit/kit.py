#!/usr/bin/env python3
"""Ferramentas do comando de operacao do kit (infra/kit/membros; docs/32 §3.2, §4 e §11.7).

Os scripts do kit chamam `python3 -I infra/kit/kit.py <ferramenta> ...`. So a biblioteca padrao, nada de rede. Segredo
(senha, chave de recuperacao, chave de acesso ao destino) nunca chega aqui pela linha de comando, que qualquer usuario
do servidor ve no `ps`: vem pela entrada padrao, por variavel de ambiente ou pelo caminho de um arquivo.

Ferramentas:
  situacao-gravar ARQ chave=valor...   grava no arquivo de situacao (JSON, 0644) e recusa valor que contenha um segredo
                                        do arquivo de segredos (--segredos ARQ) ou de um arquivo dado (--segredo-arquivo)
  situacao-ler ARQ chave               imprime um valor do arquivo de situacao (vazio se nao ha)
  situacao-mostrar ARQ [--json]        a situacao em portugues, para `membros status`
  destino-analisar                     le o destino (RESTIC_REPOSITORY) da entrada: tipo, servidor e endereco (\x1f)
  gerar-chave | normalizar-chave | sortear-grupos | conferir-grupos ARQ G1 G2
  ids-das-chaves                       os ids da saida de `restic key list --json`
  escolher-backup [ID]                 da saida de `restic snapshots --json`: "id curto quando marcas"
  resumo-do-backup                     da saida de `restic backup --json`: "snapshot enviados processados arquivos"
  plano-do-ensaio LISTA                da saida de `restic ls --json`: variaveis para o shell (onde esta o dump etc.)
  isolamento PASTA NOME                confere o `docker inspect` do container do ensaio (entrada) contra as regras
  veredito-do-ensaio ...               o veredito do ensaio, a partir das contagens do banco restaurado e da lista
  imagem-do-servico SERVICO            da saida de `docker compose config --format json`: a imagem do servico
  data-brasilia DATA                   a data (ISO) em DD/MM/AAAA às HH:MM, no horario de Brasilia
  folha                                a folha de recuperacao (campos em variaveis FOLHA_*, a chave num arquivo)
  endereco-da-escola                   da entrada (um .env): o endereco da escola em APP_PUBLIC_URL
  segredos-trocar ARQ                  troca no arquivo de segredos as linhas CHAVE=valor lidas da entrada (0600)
"""

import datetime
import json
import os
import re
import secrets
import shlex
import sys
import tempfile
from urllib.parse import urlsplit

# Brasilia nao tem horario de verao desde 2019: UTC-3 fixo, sem depender do pacote de fusos do sistema.
BRASILIA = datetime.timezone(datetime.timedelta(hours=-3))
# Alfabeto de Crockford: sem I, L, O e U, que se confundem com 1, 0 e V quando a pessoa le a folha impressa.
ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
TROCAS = str.maketrans({"O": "0", "I": "1", "L": "1"})
GRUPOS = 8
TAMANHO_GRUPO = 4
# Nome de variavel que guarda segredo no arquivo de segredos (o .env do compose).
NOME_DE_SEGREDO = re.compile(r"(PASSWORD|PASS$|SECRET|TOKEN|_KEY$|_KEYS$|KEY_|JWT|ENC_KEY|PRIVATE)")
SECOES = ("backup", "recuperacao", "ensaio", "restauracao", "versao")


def falhar(mensagem, codigo=1):
    sys.stderr.write("ERRO: " + mensagem + "\n")
    sys.exit(codigo)


# ---- datas e numeros em portugues -----------------------------------------------------------------------------------


def ler_data(texto):
    """Data ISO 8601 do restic ou nossa (com nanossegundos, Z ou deslocamento) em datetime com fuso; None se nao le."""
    if not texto:
        return None
    m = re.match(r"^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(\.\d+)?\s*(Z|[+-]\d\d:?\d\d)?", str(texto))
    if not m:
        return None
    fracao = (m.group(3) or ".0")[1:7].ljust(6, "0")
    fuso = m.group(4) or "Z"
    if fuso == "Z":
        tz = datetime.timezone.utc
    else:
        sinal = -1 if fuso[0] == "-" else 1
        horas, minutos = int(fuso[1:3]), int(fuso[-2:])
        tz = datetime.timezone(sinal * datetime.timedelta(hours=horas, minutes=minutos))
    return datetime.datetime.fromisoformat(f"{m.group(1)}T{m.group(2)}.{fracao}").replace(tzinfo=tz)


def agora():
    return datetime.datetime.now(datetime.timezone.utc)


def data_brasilia(texto, com_hora=True):
    d = ler_data(texto)
    if d is None:
        return "data desconhecida"
    d = d.astimezone(BRASILIA)
    return d.strftime("%d/%m/%Y às %H:%M") if com_hora else d.strftime("%d/%m/%Y")


def ha_quanto(texto):
    d = ler_data(texto)
    if d is None:
        return ""
    segundos = max(0, int((agora() - d).total_seconds()))
    if segundos < 3600:
        minutos = max(1, segundos // 60)
        return f"há {minutos} minuto" + ("" if minutos == 1 else "s")
    if segundos < 48 * 3600:
        horas = segundos // 3600
        return f"há {horas} hora" + ("" if horas == 1 else "s")
    dias = segundos // 86400
    return f"há {dias} dias"


def inteiro(n):
    return f"{int(n):,}".replace(",", ".")


def tamanho(n):
    try:
        n = float(n)
    except (TypeError, ValueError):
        return "?"
    for unidade in ("bytes", "KB", "MB", "GB", "TB"):
        if n < 1024 or unidade == "TB":
            if unidade == "bytes":
                return f"{int(n)} bytes"
            return f"{n:.1f} {unidade}".replace(".", ",")
        n /= 1024
    return "?"


# ---- arquivo de situacao (sem segredo, lido por `membros status` e pelo diagnostico) -------------------------------


def situacao_ler(caminho):
    try:
        with open(caminho, encoding="utf-8") as f:
            dados = json.load(f)
        return dados if isinstance(dados, dict) else {}
    except (OSError, ValueError):
        return {}


def segredos_do_arquivo(caminho):
    """Os valores do arquivo de segredos cujo nome diz que sao segredo (senha, chave, token), com 8 ou mais caracteres."""
    valores = set()
    if not caminho:
        return valores
    try:
        linhas = open(caminho, encoding="utf-8").read().splitlines()
    except OSError:
        return valores
    for linha in linhas:
        m = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", linha)
        if not m or not NOME_DE_SEGREDO.search(m.group(1)):
            continue
        valor = m.group(2).strip()
        if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in "\"'":
            valor = valor[1:-1]
        if len(valor) >= 8:
            valores.add(valor)
    return valores


def situacao_gravar(argumentos):
    proibidos = set()
    pares = []
    i = 0
    caminho = argumentos[0]
    argumentos = argumentos[1:]
    while i < len(argumentos):
        a = argumentos[i]
        if a == "--segredos":
            proibidos |= segredos_do_arquivo(argumentos[i + 1])
            i += 2
            continue
        if a == "--segredo-arquivo":
            try:
                texto = open(argumentos[i + 1], encoding="utf-8").read().strip()
            except OSError:
                texto = ""
            if len(texto) >= 8:
                proibidos.add(texto)
                proibidos.add(texto.replace("-", ""))
            i += 2
            continue
        pares.append(a)
        i += 1
    dados = situacao_ler(caminho)
    for par in pares:
        chave, sep, valor = par.partition("=")
        partes = chave.split(".")
        if not sep or partes[0] not in SECOES or not all(re.fullmatch(r"[a-z_][a-z0-9_]*", p) for p in partes):
            falhar(f"chave da situacao recusada: {chave!r}")
        no = dados
        for p in partes[:-1]:
            if not isinstance(no.get(p), dict):
                no[p] = {}
            no = no[p]
        folha = partes[-1]
        tipo, _, bruto = valor.partition(":") if re.match(r"^[nbjsx]:", valor) else ("s", "", valor)
        if tipo == "x":
            no.pop(folha, None)
            continue
        if tipo == "n":
            no[folha] = int(bruto) if re.fullmatch(r"-?\d+", bruto) else None
        elif tipo == "b":
            no[folha] = bruto == "true"
        elif tipo == "j":
            no[folha] = json.loads(bruto)
        else:
            no[folha] = bruto
    texto = json.dumps(dados, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    for segredo in proibidos:
        if segredo and segredo in texto:
            falhar("a situacao do backup nao foi gravada: um valor continha um segredo (isto e um defeito do kit).", 3)
    pasta = os.path.dirname(os.path.abspath(caminho))
    os.makedirs(pasta, exist_ok=True)
    fd, temporario = tempfile.mkstemp(dir=pasta, prefix=".situacao.")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(texto)
    os.chmod(temporario, 0o644)
    os.replace(temporario, caminho)


def situacao_valor(dados, chave):
    no = dados
    for p in chave.split("."):
        if not isinstance(no, dict) or p not in no:
            return None
        no = no[p]
    return no


TIPOS_DE_DESTINO = {
    "s3": "armazenamento compatível com S3",
    "sftp": "servidor SFTP",
    "local": "pasta neste servidor",
}


def situacao_mostrar(caminho, como_json):
    dados = situacao_ler(caminho)
    if como_json:
        sys.stdout.write(json.dumps(dados, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
        return
    linhas = []
    atencao = []
    b = dados.get("backup") or {}
    linhas.append("Backup")
    if b.get("ultimo_sucesso"):
        linhas.append(f"  Último backup bom: {data_brasilia(b['ultimo_sucesso'])} (horário de Brasília), {ha_quanto(b['ultimo_sucesso'])}")
        partes = []
        if b.get("banco_bytes") is not None:
            partes.append(f"banco {tamanho(b['banco_bytes'])}")
        if b.get("storage_arquivos") is not None:
            partes.append(f"Storage {tamanho(b.get('storage_bytes'))} em {inteiro(b['storage_arquivos'])} arquivos")
        if b.get("enviado_bytes") is not None:
            partes.append(f"enviado nesta vez: {tamanho(b['enviado_bytes'])}")
        if partes:
            linhas.append("  Tamanho: " + "; ".join(partes))
        idade = ler_data(b["ultimo_sucesso"])
        if idade and (agora() - idade).total_seconds() > 36 * 3600:
            atencao.append(f"o último backup bom é de {data_brasilia(b['ultimo_sucesso'])}: o backup diário está parado? Veja: sudo membros backup")
    else:
        linhas.append("  Nenhum backup feito ainda.")
        atencao.append("nenhum backup feito ainda: sudo membros backup --iniciar e sudo membros backup")
    if b.get("destino_tipo"):
        servidor = f" ({b['destino_servidor']})" if b.get("destino_servidor") else ""
        linhas.append(f"  Destino: {TIPOS_DE_DESTINO.get(b['destino_tipo'], b['destino_tipo'])}{servidor}")
        if b["destino_tipo"] == "local":
            atencao.append("o backup fica neste servidor: se o servidor morrer, o backup morre junto.")
    ret = b.get("retencao") or {}
    if ret:
        linhas.append(f"  Retenção: {ret.get('diarios', '?')} diários, {ret.get('semanais', '?')} semanais e {ret.get('mensais', '?')} mensais")
    if b.get("ultima_conferencia"):
        resultado = "sem problemas" if b.get("ultima_conferencia_resultado") == "ok" else "COM PROBLEMA"
        linhas.append(f"  Última conferência do repositório: {data_brasilia(b['ultima_conferencia'], False)}, {resultado}")
        if b.get("ultima_conferencia_resultado") != "ok":
            atencao.append("a última conferência do repositório do backup achou problema: sudo membros backup --conferir")
    if b.get("em_andamento"):
        linhas.append(f"  Em andamento desde {data_brasilia(b.get('ultima_tentativa'))}")
    elif b.get("ultimo_resultado") and b.get("ultimo_resultado") != "ok":
        linhas.append(f"  A última tentativa ({data_brasilia(b.get('ultima_tentativa'))}) falhou: {b.get('ultimo_erro') or 'veja o registro'}")
        atencao.append("a última tentativa de backup falhou: sudo membros backup")

    r = dados.get("recuperacao") or {}
    linhas.append("Kit de recuperação")
    if r.get("pendente_id"):
        linhas.append(f"  PENDENTE desde {data_brasilia(r.get('pendente_desde'))}: falta a pessoa confirmar a folha")
        atencao.append("o kit de recuperação não foi confirmado: sudo membros kit-de-recuperacao (no terminal do servidor)")
    if r.get("chave_id"):
        linhas.append(f"  Confirmado em {data_brasilia(r.get('confirmada_em'))} (chave {r['chave_id']} no backup)")
    elif not r.get("pendente_id"):
        linhas.append("  Ainda não foi feito.")
        atencao.append("sem kit de recuperação, o backup não abre se o servidor morrer: sudo membros kit-de-recuperacao")

    e = dados.get("ensaio") or {}
    linhas.append("Ensaio de restauração")
    if e.get("ultimo"):
        resultado = {"ok": "deu certo", "avisos": "deu certo, com avisos", "falhou": "FALHOU", "interrompido": "foi interrompido"}.get(e.get("resultado"), e.get("resultado", "?"))
        do_backup = f", com o backup de {data_brasilia(e['backup_hora'])}" if e.get("backup_hora") else ""
        linhas.append(f"  {data_brasilia(e['ultimo'])}: {resultado}{do_backup}")
        if e.get("motivo") and e.get("resultado") in ("falhou", "avisos"):
            linhas.append(f"  {e['motivo']}")
        d = ler_data(e["ultimo"])
        if e.get("resultado") == "falhou":
            atencao.append("o último ensaio de restauração falhou: leia o motivo acima e rode de novo")
        elif d and (agora() - d).days > 100:
            atencao.append("o último ensaio de restauração tem mais de três meses: sudo membros restaurar --ensaio")
    else:
        linhas.append("  Nunca feito.")
        atencao.append("faça um ensaio de restauração (uma vez por trimestre): sudo membros restaurar --ensaio")

    rest = dados.get("restauracao") or {}
    if rest.get("pendente_desde"):
        linhas.append("Restauração")
        linhas.append(f"  Esta instalação espera a restauração de um backup desde {data_brasilia(rest['pendente_desde'])}: o backup diário fica parado até lá.")
        atencao.append("a restauração não terminou: sudo membros restaurar")
    elif rest.get("ultima"):
        linhas.append("Restauração")
        linhas.append(f"  {data_brasilia(rest['ultima'])}: restaurado o backup de {data_brasilia(rest.get('backup_hora'))}")

    sys.stdout.write("\n".join(linhas) + "\n")
    if atencao:
        sys.stdout.write("\nAtenção:\n" + "".join(f"  - {a}\n" for a in atencao))


# ---- destino do backup -----------------------------------------------------------------------------------------------

AJUDA_DESTINO = (
    "O kit aceita: armazenamento compatível com S3 (Backblaze B2, Wasabi, Cloudflare R2, AWS), por exemplo "
    "s3:https://s3.us-east-005.backblazeb2.com/<bucket>/escola; um servidor SFTP, por exemplo "
    "sftp:usuario@servidor.com:/backups/escola; ou uma pasta deste servidor, por exemplo /mnt/backup/escola."
)


def sem_credencial(texto):
    """O endereco para mostrar: sem usuario:senha@ embutido (o kit recusa, mas a mensagem nunca repete a senha)."""
    return re.sub(r"//[^/@\s]*@", "//", re.sub(r"^(sftp:)[^@/\s]*:[^@/\s]*@", r"\1", texto))


def destino_analisar(repo):
    repo = repo.strip()
    if not repo:
        falhar("Sem destino do backup: preencha RESTIC_REPOSITORY no arquivo de segredos. " + AJUDA_DESTINO)
    if re.search(r"\s", repo):
        falhar("O destino do backup tem espaço: " + AJUDA_DESTINO)
    if repo.startswith("s3:"):
        resto = repo[3:]
        if resto.startswith("http://"):
            falhar("O destino S3 precisa de https (o backup sai cifrado, mas a chave de acesso não pode viajar aberta).")
        url = urlsplit(resto if resto.startswith("https://") else "https://" + resto)
        if "@" in url.netloc:
            falhar("Nunca ponha a chave de acesso no endereço do destino (" + sem_credencial(repo) + "): ela vai em AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY no arquivo de segredos.")
        servidor = url.hostname or ""
        bucket = url.path.strip("/").split("/")[0] if url.path.strip("/") else ""
        if not re.fullmatch(r"[a-z0-9.-]+", servidor or "-") or "." not in servidor:
            falhar(f"O destino S3 precisa do endereço do serviço: s3:https://<servidor>/<bucket>. Veio {sem_credencial(repo)}.")
        if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket):
            falhar(f"O destino S3 precisa do nome do bucket depois do servidor: s3:https://{servidor}/<bucket>. Veio {sem_credencial(repo)}.")
        return "s3", servidor, repo
    if repo.startswith("sftp:"):
        resto = repo[5:]
        if resto.startswith("//"):
            url = urlsplit("sftp:" + resto)
            if url.password is not None:
                falhar("Nunca ponha a senha no endereço do destino SFTP: o kit entra com uma chave SSH (membros backup --iniciar).")
            servidor, caminho = url.hostname or "", url.path
        else:
            m = re.fullmatch(r"(?:([^@:/]+)@)?([^@:/]+):(.+)", resto)
            if not m:
                falhar(f"O destino SFTP é sftp:usuario@servidor:/pasta. Veio {sem_credencial(repo)}.")
            servidor, caminho = m.group(2), m.group(3)
        if not servidor or not caminho.strip("/"):
            falhar(f"O destino SFTP precisa do servidor e da pasta: sftp:usuario@servidor:/pasta. Veio {sem_credencial(repo)}.")
        return "sftp", servidor, repo
    if repo.startswith("local:"):
        repo = repo[6:]
    if repo.startswith("/"):
        if repo.rstrip("/") in ("", "/root", "/home", "/tmp", "/var", "/etc", "/opt"):
            falhar(f"Escolha uma pasta própria para o backup, por exemplo /mnt/backup/escola (veio {repo}).")
        return "local", "", repo
    prefixo = repo.split(":", 1)[0] if ":" in repo else ""
    if prefixo in ("b2", "rest", "azure", "gs", "swift", "rclone"):
        falhar(f"O kit não usa o tipo {prefixo}: do restic. " + AJUDA_DESTINO + " No Backblaze B2, use o endereço S3 do bucket.")
    falhar(f"Destino do backup que o kit não reconhece ({sem_credencial(repo)}). " + AJUDA_DESTINO)


# ---- chave de recuperacao ---------------------------------------------------------------------------------------------


def gerar_chave():
    bruto = "".join(secrets.choice(ALFABETO) for _ in range(GRUPOS * TAMANHO_GRUPO))
    return "-".join(bruto[i : i + TAMANHO_GRUPO] for i in range(0, len(bruto), TAMANHO_GRUPO))


def limpar_digitado(texto):
    return re.sub(r"[\s\-._]", "", texto.upper()).translate(TROCAS)


def normalizar_chave(texto):
    """A chave como a folha a mostra (8 grupos de 4, com hifen). Texto que nao e do formato da folha passa como veio."""
    bruto = texto.strip()
    limpo = limpar_digitado(bruto)
    if len(limpo) == GRUPOS * TAMANHO_GRUPO and all(c in ALFABETO for c in limpo):
        return "-".join(limpo[i : i + TAMANHO_GRUPO] for i in range(0, len(limpo), TAMANHO_GRUPO))
    return bruto


def sortear_grupos():
    primeiro = secrets.randbelow(GRUPOS) + 1
    segundo = secrets.randbelow(GRUPOS - 1) + 1
    if segundo >= primeiro:
        segundo += 1
    return sorted((primeiro, segundo))


def conferir_grupos(arquivo, g1, g2):
    chave = open(arquivo, encoding="utf-8").read().strip()
    grupos = chave.split("-")
    if len(grupos) != GRUPOS:
        falhar("a chave guardada nao tem o formato da folha.")
    esperado = grupos[g1 - 1] + grupos[g2 - 1]
    resposta = limpar_digitado(sys.stdin.read())
    return secrets.compare_digest(resposta.encode(), esperado.encode())


FOLHA = """\
FOLHA DE RECUPERAÇÃO DA ESCOLA {escola}
Gerada em {quando} (horário de Brasília), no servidor {servidor_maquina}.

Guarde esta folha FORA do servidor: impressa, num cofre de senhas, ou nos dois.
Ela é o único jeito de abrir o backup se o servidor morrer. Quem tiver esta
folha e o acesso ao armazenamento abre os dados dos alunos: não mande por
e-mail, por chat nem para a IA.

1. ONDE ESTÁ O BACKUP
   Tipo:     {tipo}
   Destino:  {destino}
{acesso}
2. CHAVE DE RECUPERAÇÃO DO BACKUP
   {chave}
   (no backup, esta chave tem o identificador {chave_id})

3. SE O SERVIDOR MORRER
   a. Contrate um servidor novo, do mesmo plano ou maior.
   b. Rode o instalador no modo de restauração (sem Chave de ativação) e
      informe o destino e o acesso acima.
   c. Quando ele pedir, digite a chave de recuperação, e depois o endereço
      da escola para confirmar: sudo membros restaurar
   d. Aponte {escola} para o IP do servidor novo.
   A Licença vem dentro do backup: a escola volta como estava na noite do
   último backup. O que mudou depois disso se perde.

4. TESTE ANTES DE PRECISAR
   Uma vez por trimestre, no terminal do servidor:
   sudo membros restaurar --ensaio   (pede esta chave e não toca na escola)

5. SE PERDER ESTA FOLHA
   sudo membros kit-de-recuperacao --nova
   Gera outra folha e, quando ela for confirmada, esta deixa de abrir o backup.
"""

ACESSO = {
    "s3": (
        "   Acesso:   a chave de acesso {acesso_id} do armazenamento, criada no painel\n"
        "             dele (Backblaze, Wasabi, Cloudflare...). O segredo dela não está\n"
        "             nesta folha: ele fica no seu cofre de senhas, ou crie uma chave\n"
        "             nova no painel, com acesso a este bucket.\n"
    ),
    "sftp": (
        "   Acesso:   uma chave SSH autorizada nesse servidor SFTP. O servidor novo\n"
        "             cria outra chave (sudo membros backup --iniciar), que você\n"
        "             autoriza no painel do SFTP ou com a senha da conta.\n"
    ),
    "local": (
        "   ATENÇÃO:  este backup fica no PRÓPRIO servidor. Se o servidor morrer,\n"
        "             o backup morre junto, e esta folha não recupera nada.\n"
        "             Troque o destino por um armazenamento fora dele.\n"
    ),
}


def folha():
    e = os.environ
    tipo = e.get("FOLHA_TIPO", "")
    chave = open(e["FOLHA_ARQUIVO_CHAVE"], encoding="utf-8").read().strip()
    quando = data_brasilia(e.get("FOLHA_QUANDO") or agora().isoformat())
    acesso = ACESSO.get(tipo, "").format(acesso_id=e.get("FOLHA_ACESSO_ID") or "(sem identificador)")
    texto = FOLHA.format(
        escola=e.get("FOLHA_ESCOLA") or "(endereço da escola)",
        quando=quando,
        servidor_maquina=e.get("FOLHA_MAQUINA") or "?",
        tipo=TIPOS_DE_DESTINO.get(tipo, tipo),
        destino=e.get("FOLHA_DESTINO", ""),
        acesso=acesso,
        chave=chave,
        chave_id=e.get("FOLHA_CHAVE_ID", "?"),
    )
    sys.stdout.write(texto)


# ---- restic -----------------------------------------------------------------------------------------------------------


def ids_das_chaves():
    dados = json.load(sys.stdin) or []
    for chave in dados:
        if isinstance(chave, dict) and chave.get("id"):
            print(chave["id"])


def escolher_backup(pedido):
    snaps = [s for s in (json.load(sys.stdin) or []) if isinstance(s, dict) and s.get("id")]
    snaps.sort(key=lambda s: ler_data(s.get("time")) or datetime.datetime.min.replace(tzinfo=datetime.timezone.utc))
    if pedido and pedido != "latest":
        if not re.fullmatch(r"[0-9a-f]{4,64}", pedido):
            falhar("--snapshot precisa ser o id de um backup (membros restaurar --listar mostra) ou latest.")
        snaps = [s for s in snaps if s["id"].startswith(pedido) or s.get("short_id") == pedido]
        if not snaps:
            falhar(f"Nenhum backup com o id {pedido} neste destino.", 3)
        escolhido = snaps[-1]
    else:
        if not snaps:
            falhar("Nenhum backup da escola neste destino.", 3)
        com_dados = [s for s in snaps if "com-dados" in (s.get("tags") or [])]
        escolhido = (com_dados or snaps)[-1]
    quando = ler_data(escolhido.get("time"))
    quando = quando.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if quando else "?"
    print(escolhido["id"], escolhido.get("short_id") or escolhido["id"][:8], quando, ",".join(escolhido.get("tags") or []) or "-")


def resumo_do_backup():
    resumo = None
    for linha in sys.stdin:
        linha = linha.strip()
        if not linha.startswith("{"):
            continue
        try:
            dado = json.loads(linha)
        except ValueError:
            continue
        if dado.get("message_type") == "summary":
            resumo = dado
    if not resumo or not resumo.get("snapshot_id"):
        falhar("o restic nao contou o resumo do backup (sem snapshot_id).", 3)
    print(resumo["snapshot_id"][:8], int(resumo.get("data_added") or 0), int(resumo.get("total_bytes_processed") or 0), int(resumo.get("total_files_processed") or 0))


def ler_lista(caminho):
    snapshot = None
    nos = []
    with open(caminho, encoding="utf-8") as f:
        for linha in f:
            linha = linha.strip()
            if not linha.startswith("{"):
                continue
            dado = json.loads(linha)
            if dado.get("struct_type") == "snapshot" or (snapshot is None and "paths" in dado and "tree" in dado):
                snapshot = dado
            elif dado.get("path"):
                nos.append(dado)
    return snapshot or {}, nos


def plano_do_ensaio(caminho):
    snapshot, nos = ler_lista(caminho)
    arquivos = {n["path"]: n for n in nos if n.get("type") == "file"}
    dumps = sorted(p for p in arquivos if p.endswith("/postgres.dump"))
    if not dumps:
        falhar("o backup nao tem postgres.dump: ele nao serve para restaurar a escola.", 3)
    dump = dumps[-1]
    etapa = dump.rsplit("/", 1)[0]
    caminhos = [p.rstrip("/") for p in (snapshot.get("paths") or [])]
    storage = next((p for p in caminhos if p != etapa and not etapa.startswith(p + "/")), "")
    no_storage = [n for p, n in arquivos.items() if storage and p.startswith(storage + "/")]
    saida = {
        "ETAPA": etapa,
        "DUMP": dump,
        "DUMP_BYTES": str(int(arquivos[dump].get("size") or 0)),
        "ROLES": etapa + "/roles.sql" if etapa + "/roles.sql" in arquivos else "",
        "CHAVE_VAULT": etapa + "/pgsodium_root.key" if etapa + "/pgsodium_root.key" in arquivos else "",
        "ENV_NO_BACKUP": etapa + "/env" if etapa + "/env" in arquivos else "",
        "STORAGE_RAIZ": storage,
        "STORAGE_ARQUIVOS": str(len(no_storage)),
        "STORAGE_BYTES": str(sum(int(n.get("size") or 0) for n in no_storage)),
    }
    for nome, valor in saida.items():
        print(f"PLANO_{nome}={shlex.quote(valor)}")


def isolamento(pasta, nome):
    """O container do ensaio, pelo docker inspect: sem rede, sem porta, sem privilegio, so as pastas do proprio ensaio."""
    dados = json.load(sys.stdin)
    if isinstance(dados, list):
        dados = dados[0] if dados else {}
    host = dados.get("HostConfig") or {}
    problemas = []
    if (dados.get("Name") or "").lstrip("/") != nome:
        problemas.append(f"o container nao e o do ensaio ({dados.get('Name')})")
    if host.get("NetworkMode") != "none":
        problemas.append(f"rede {host.get('NetworkMode')!r} (o ensaio roda sem rede)")
    if host.get("PortBindings") or host.get("PublishAllPorts"):
        problemas.append("porta publicada")
    if host.get("Privileged"):
        problemas.append("container privilegiado")
    if host.get("VolumesFrom"):
        problemas.append("volumes de outro container")
    for chave in ("PidMode", "IpcMode", "UTSMode", "UsernsMode"):
        if (host.get(chave) or "") == "host":
            problemas.append(f"{chave} do servidor")
    if host.get("CapAdd"):
        problemas.append("capacidades a mais")
    raiz = os.path.realpath(pasta) + "/"
    for montagem in dados.get("Mounts") or []:
        origem = montagem.get("Source") or ""
        if montagem.get("Type") != "bind" or not (os.path.realpath(origem) + "/").startswith(raiz):
            problemas.append(f"montagem fora da pasta do ensaio: {montagem.get('Type')} {origem or montagem.get('Name')}")
    for bind in host.get("Binds") or []:
        origem = bind.split(":", 1)[0]
        if not (os.path.realpath(origem) + "/").startswith(raiz):
            problemas.append(f"montagem fora da pasta do ensaio: {origem}")
    if problemas:
        sys.stderr.write("".join(f"  - {p}\n" for p in problemas))
        sys.exit(1)


def contar_storage(lista, raiz, bucket_global, tenant):
    """As pastas de objeto que tem arquivo no backup: <raiz>/<bucket global>/<tenant>/<bucket>/<nome>[/<versao>]."""
    _, nos = ler_lista(lista)
    prefixo = f"{raiz}/{bucket_global}/{tenant}/"
    pastas = set()
    arquivos = set()
    for n in nos:
        if n.get("type") != "file" or not n["path"].startswith(prefixo):
            continue
        relativo = n["path"][len(prefixo) :]
        arquivos.add(relativo)
        pastas.add(relativo.rsplit("/", 1)[0])
    return pastas, arquivos


def veredito(argv):
    opcoes = dict(zip(argv[0::2], argv[1::2]))
    contagens = json.load(open(opcoes["--contagens"], encoding="utf-8"))
    objetos = []
    texto = open(opcoes["--objetos"], encoding="utf-8", errors="replace").read().strip("\n")
    for registro in texto.split("\x1e") if texto else []:
        campos = registro.split("\x1f")
        if len(campos) >= 2 and campos[0]:
            objetos.append((campos[0], campos[1], campos[2] if len(campos) > 2 else ""))
    pastas, arquivos = contar_storage(opcoes["--lista"], opcoes["--storage-raiz"], opcoes["--bucket-global"], opcoes["--tenant"])
    # O objeto esta no backup quando a pasta dele tem arquivo (<bucket>/<nome>/<versao>, o jeito do Storage com versao)
    # ou quando o proprio nome e um arquivo (sem versao).
    faltando = [f"{b}/{n}" for b, n, _v in objetos if f"{b}/{n}" not in pastas and f"{b}/{n}" not in arquivos]
    falhas, avisos = [], []

    def num(chave):
        valor = contagens.get(chave)
        return None if valor is None else int(valor)

    if not num("contas"):
        falhas.append("o banco restaurado não tem nenhuma conta (auth.users vazio): este backup não traz a escola")
    if contagens.get("ultima_migracao") in (None, ""):
        falhas.append("o banco restaurado não tem o histórico das migrações")
    if num("licenca") is None:
        falhas.append("a tabela da licença (license_state) não está no backup")
    elif num("licenca") == 0:
        falhas.append("a licença da escola não está no backup: restaurado, o servidor pediria a Chave de ativação de novo")
    if opcoes.get("--anon-fechado") != "true":
        falhas.append("as permissões restauradas não são as do backup (a chave pública enxerga tabela interna)")
    if objetos and not (len(objetos) - len(faltando)):
        falhas.append(f"nenhum dos {inteiro(len(objetos))} arquivos do Storage está no backup")
    elif faltando:
        exemplos = ", ".join(faltando[:3]) + (" e outros" if len(faltando) > 3 else "")
        avisos.append(f"faltam {inteiro(len(faltando))} de {inteiro(len(objetos))} arquivos do Storage no backup ({exemplos}); um arquivo apagado durante o backup explica um ou dois, mais que isso não")
    hora = ler_data(opcoes.get("--backup-hora"))
    if hora and (agora() - hora).total_seconds() > 48 * 3600:
        avisos.append(f"o backup mais novo com dados é de {data_brasilia(opcoes['--backup-hora'])}: o backup diário parou?")
    erros_restore = int(opcoes.get("--erros-restore") or 0)
    if erros_restore:
        avisos.append(f"o pg_restore avisou {inteiro(erros_restore)} erro(s); o registro foi apagado com o resto (rode de novo com KIT_ENSAIO_GUARDAR_REGISTRO=1 para ver)")

    def contagem(chave, singular, plural):
        n = num(chave)
        if n is None:
            return None
        return f"{inteiro(n)} {singular if n == 1 else plural}"

    dentro = [c for c in (
        contagem("contas", "conta", "contas"),
        contagem("alunos", "aluno com acesso", "alunos com acesso"),
        contagem("conteudos", "conteúdo do catálogo", "conteúdos do catálogo"),
        contagem("aulas", "aula", "aulas"),
        contagem("acessos", "acesso", "acessos"),
        contagem("progresso", "registro de progresso", "registros de progresso"),
    ) if c]
    if num("licenca"):
        dentro.append("a licença da escola" + (" (ativada)" if contagens.get("licenca_ativada") else " (ainda não ativada)"))
    if objetos:
        dentro.append(f"{inteiro(len(objetos) - len(faltando))} de {inteiro(len(objetos))} arquivos do Storage")
    else:
        dentro.append(f"nenhum arquivo no Storage (o backup tem {inteiro(len(arquivos))} arquivo(s) na pasta dele)")

    resultado = "falhou" if falhas else ("avisos" if avisos else "ok")
    titulo = {"ok": "DEU CERTO", "avisos": "DEU CERTO, com avisos", "falhou": "FALHOU"}[resultado]
    print(f"==> Ensaio de restauração: {titulo}")
    print(f"    O backup de {data_brasilia(opcoes.get('--backup-hora'))} (horário de Brasília) abriu com a chave de recuperação.")
    print("    Dentro dele: " + "; ".join(dentro) + ".")
    for f in falhas:
        print(f"    PROBLEMA: {f}.")
    for a in avisos:
        print(f"    Aviso: {a}.")
    resumo = {
        "resultado": resultado,
        "motivo": (falhas or avisos or [""])[0],
        "contagens": {k: contagens.get(k) for k in ("contas", "alunos", "conteudos", "aulas", "acessos", "progresso", "licenca", "objetos_storage")},
        "storage_faltando": len(faltando),
    }
    with open(opcoes["--resumo"], "w", encoding="utf-8") as f:
        json.dump(resumo, f, ensure_ascii=False)
    sys.exit(3 if falhas else 0)


# ---- arquivo de segredos -----------------------------------------------------------------------------------------------


def endereco_da_escola():
    for linha in sys.stdin.read().splitlines():
        if linha.startswith("APP_PUBLIC_URL="):
            valor = linha.split("=", 1)[1].strip().strip("'\"")
            print(urlsplit(valor).hostname or valor)
            return
    print("")


def segredos_trocar(caminho):
    novos = {}
    for linha in sys.stdin.read().splitlines():
        if not linha:
            continue
        m = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", linha)
        if not m:
            falhar("linha recusada para o arquivo de segredos (precisa ser CHAVE=valor).")
        novos[m.group(1)] = m.group(2)
    linhas = open(caminho, encoding="utf-8").read().split("\n") if os.path.exists(caminho) else []
    while linhas and linhas[-1] == "":
        linhas.pop()
    vistos = set()
    for i, linha in enumerate(linhas):
        m = re.match(r"^([A-Z][A-Z0-9_]*)=", linha)
        if m and m.group(1) in novos and m.group(1) not in vistos:
            linhas[i] = f"{m.group(1)}={novos[m.group(1)]}"
            vistos.add(m.group(1))
    for chave, valor in novos.items():
        if chave not in vistos:
            linhas.append(f"{chave}={valor}")
    pasta = os.path.dirname(os.path.abspath(caminho))
    antigo = os.umask(0o077)
    try:
        fd, temporario = tempfile.mkstemp(dir=pasta, prefix=".segredos.")
    finally:
        os.umask(antigo)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(linhas) + "\n")
    os.chmod(temporario, 0o600)
    os.replace(temporario, caminho)


def main():
    if len(sys.argv) < 2:
        falhar("uso: kit.py <ferramenta> ... (veja o comeco do arquivo)")
    ferramenta, argv = sys.argv[1], sys.argv[2:]
    if ferramenta == "situacao-gravar":
        situacao_gravar(argv)
    elif ferramenta == "situacao-ler":
        valor = situacao_valor(situacao_ler(argv[0]), argv[1])
        if valor is not None:
            print(valor if not isinstance(valor, (dict, list, bool)) else json.dumps(valor))
    elif ferramenta == "situacao-mostrar":
        situacao_mostrar(argv[0], "--json" in argv[1:])
    elif ferramenta == "destino-analisar":
        # Separados por \x1f (nao por TAB: o `read` do bash junta dois TABs seguidos, e o servidor do destino local e vazio).
        print("\x1f".join(destino_analisar(sys.stdin.read())))
    elif ferramenta == "gerar-chave":
        print(gerar_chave())
    elif ferramenta == "normalizar-chave":
        sys.stdout.write(normalizar_chave(sys.stdin.read()))
    elif ferramenta == "sortear-grupos":
        print(*sortear_grupos())
    elif ferramenta == "conferir-grupos":
        sys.exit(0 if conferir_grupos(argv[0], int(argv[1]), int(argv[2])) else 1)
    elif ferramenta == "ids-das-chaves":
        ids_das_chaves()
    elif ferramenta == "escolher-backup":
        escolher_backup(argv[0] if argv else "")
    elif ferramenta == "resumo-do-backup":
        resumo_do_backup()
    elif ferramenta == "plano-do-ensaio":
        plano_do_ensaio(argv[0])
    elif ferramenta == "isolamento":
        isolamento(argv[0], argv[1])
    elif ferramenta == "veredito-do-ensaio":
        veredito(argv)
    elif ferramenta == "folha":
        folha()
    elif ferramenta == "endereco-da-escola":
        endereco_da_escola()
    elif ferramenta == "segredos-trocar":
        segredos_trocar(argv[0])
    elif ferramenta == "data-brasilia":
        print(data_brasilia(argv[0] if argv else ""))
    elif ferramenta == "imagem-do-servico":
        servico = (json.load(sys.stdin).get("services") or {}).get(argv[0]) or {}
        if not servico.get("image"):
            falhar(f"o compose nao tem o servico {argv[0]} com imagem.")
        print(servico["image"])
    else:
        falhar(f"ferramenta desconhecida: {ferramenta}")


if __name__ == "__main__":
    main()

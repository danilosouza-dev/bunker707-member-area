#!/usr/bin/env python3
"""Ferramentas do instalador do kit (infra/kit/instalar; docs/32 §3.2 e §11.7; docs/20 §9D).

O instalador chama `python3 -I infra/kit/instalador.py <ferramenta> ...`. So a biblioteca padrao. A rede so passa pelo
curl e a assinatura do pacote so pelo openssl (os testes trocam os dois por versoes de mentira no PATH). Segredo (a
Chave de ativacao, a chave do provedor de e-mail, a chave de acesso ao destino do backup) nunca chega pela linha de
comando, que qualquer usuario do servidor ve no `ps`, e nunca e impresso na tela: vem do arquivo de respostas (so do
administrador), de um arquivo, digitado sem eco ou do arquivo de segredos; sai so para o shell que chamou (a saida
padrao, capturada por ele), para o curl pela entrada (-K -) ou para o arquivo de segredos.

Ferramentas:
  codigo N [DETALHE]                    a mensagem do codigo de saida (causa, o que fazer, de quem e) na saida de erro
  codigos [--json]                      a tabela dos codigos
  respostas --modo M [...]              junta as respostas (arquivo de respostas, arquivo de segredos, perguntas) e
                                        confere; imprime atribuicoes para o shell (eval)
  manifesto-conferir PACOTE [...]       confere o Pacote da versao (sha256 de todo arquivo e a assinatura)
  imagens-do-manifesto PACOTE           uma linha por imagem: arquivo, id e tags, separados por \\x1f
  estado-iniciar | estado-passo | estado-ler | estado-mostrar     o arquivo do instalador (passos feitos)
  conferir [...]                        a conferencia do servidor (sem Licenca): sistema, maquina, portas, DNS e saida
  dns --endereco E --endereco-api A     so o DNS dos dois enderecos, bloqueando (codigo de saida)
  sql-agendador                         o SQL que registra o tick no Vault (o token chega pela entrada)
  email-dominio | email-teste           o passo do e-mail no provedor (o Resend na primeira fase)
  plano                                 o plano do --simular
  resumo                                o resumo do fim
  diagnostico                           junta as partes do `membros diagnostico`
  nome-do-passo P | json-campo CAMINHO | json-da-chave    pequenas ajudas para o shell
"""

import base64
import contextlib
import datetime
import email.message
import email.utils
import hashlib
import io
import ipaddress
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import time

# O kit.py ao lado (as ferramentas do comando de operacao: situacao, destino do backup, segredos), sem gravar
# __pycache__ dentro do pacote: a pasta do pacote so tem o que o manifesto lista.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))
FORMATO_DO_MANIFESTO = 1
FORMATO_DO_ESTADO = 1
FRASE_DO_BACKUP_LOCAL = "ACEITO O BACKUP SO NESTE SERVIDOR"
SISTEMAS = {("ubuntu", "22.04"), ("ubuntu", "24.04"), ("debian", "12"), ("debian", "13")}
# Os sufixos de dois niveis mais comuns: "meucurso.com.br" e o dominio sem subdominio, "alunos.meucurso.com.br" nao.
SUFIXOS_DE_DOIS_NIVEIS = {
    "com.br", "net.br", "org.br", "edu.br", "gov.br", "art.br", "blog.br", "eco.br", "emp.br", "eng.br", "esp.br",
    "etc.br", "ind.br", "inf.br", "med.br", "adv.br", "arq.br", "nom.br", "psi.br", "srv.br", "tur.br", "tv.br",
    "app.br", "dev.br", "log.br", "ong.br", "rec.br", "seg.br", "co.uk", "org.uk", "com.au", "com.ar", "com.mx",
    "com.pt", "com.co", "com.uy", "com.py", "co.za",
}
PASSOS = (
    "conferencia", "pacote", "preparar", "imagens", "segredos", "servicos", "migracoes", "agendador",
    "conta_do_dono", "email", "backup", "endereco", "conferencia_final", "ativacao",
)
NOMES_DOS_PASSOS = {
    "conferencia": "Conferir o servidor",
    "pacote": "Conferir o pacote (sha256 e assinatura)",
    "preparar": "Preparar o servidor (Docker, firewall, troca, atualizacoes)",
    "imagens": "Carregar as imagens do pacote",
    "segredos": "Gerar as senhas e os segredos",
    "servicos": "Subir o banco e os servicos",
    "migracoes": "Criar o banco (migracoes)",
    "agendador": "Ligar o agendador de minuto",
    "conta_do_dono": "Criar a primeira conta da equipe",
    "email": "Configurar e testar o e-mail",
    "backup": "Ligar o backup e o kit de recuperacao",
    "endereco": "Conferir o endereco e o certificado",
    "conferencia_final": "Conferencia final",
    "ativacao": "Ativar a Licenca",
}

# ---- codigos de saida -----------------------------------------------------------------------------------------------
# codigo: (nome, de quem e, o que fazer). "comprador" = o servidor, o DNS ou as contas do comprador (provedor, e-mail,
# armazenamento): hora avulsa. "produto" = defeito do pacote ou do instalador: Correcao de defeito, pelo suporte.
# 1, 7 e 10 a 14 sao os mesmos do comando de operacao e do preparo do servidor (docs/20 §9B e §9C).
CODIGOS = {
    1: ("uso", "comprador", "Confira o comando e o arquivo de respostas (sudo bash instalar --help)."),
    7: ("precisa_de_terminal", "comprador", "Rode este passo no terminal do servidor, com uma pessoa (a IA nunca ve chaves nem o link do dono)."),
    10: ("sistema", "comprador", "Use Ubuntu 22.04 ou 24.04, ou Debian 12 ou 13, num processador x86-64."),
    11: ("firewall", "comprador", "O firewalld cuida do firewall: libere a 80 e a 443 nele e rode com --manter-firewall (veja docs/20 §9C)."),
    12: ("docker_sem_compose", "comprador", "Instale o plugin do Docker Compose 2 (docker compose) e rode de novo."),
    13: ("sessao_ssh", "comprador", "Entre por SSH com a chave e rode de novo (fechar o login por senha pede uma sessao aberta com chave)."),
    14: ("sshd", "comprador", "O sshd nao aceitou fechar a senha: veja qual arquivo manda na mensagem acima."),
    20: ("pacote_fora_do_lugar", "comprador", "Abra o pacote na pasta da instalacao e rode o instalador de la."),
    21: ("virtualizacao", "comprador", "Contrate um servidor virtual de verdade (KVM): em container (OpenVZ, LXC) o Docker nao roda direito."),
    22: ("processador", "comprador", "Contrate um plano com 2 vCPU ou mais."),
    23: ("memoria", "comprador", "Contrate um plano com 4 GB de memoria ou mais (8 GB recomendados)."),
    24: ("disco", "comprador", "Libere espaco no disco, ou contrate um plano com 40 GB de disco ou mais."),
    25: ("porta_ocupada", "comprador", "Pare o programa que usa a porta (um painel como o cPanel, outro servidor web) e rode de novo."),
    26: ("endereco_nao_aponta", "comprador", "Crie (ou corrija) o registro A no painel de DNS do dominio, com o IP deste servidor, e rode de novo. A propagacao costuma levar minutos e pode levar ate 48 horas."),
    27: ("registro_aaaa", "comprador", "Apague o registro AAAA desse nome no painel de DNS (ele aponta para outro servidor) e rode de novo."),
    28: ("proxy_cloudflare", "comprador", "Desligue o proxy da Cloudflare nesse registro (nuvem cinza, Somente DNS) e rode de novo."),
    29: ("sem_internet", "comprador", "Libere a saida HTTPS (porta 443) deste servidor no firewall do provedor e rode de novo."),
    30: ("sem_saida_de_email", "comprador", "Libere a saida para o provedor de e-mail (HTTPS e uma das portas 587, 2587 ou 465) ou peca ao provedor do servidor para desbloquear."),
    31: ("sem_ipv4_publico", "comprador", "O servidor precisa de um IPv4 publico. Se ele tem e nao aparece aqui, informe em IP_DO_SERVIDOR."),
    32: ("pacote_corrompido", "produto", "Baixe ou copie o pacote de novo. Se repetir, fale com o suporte."),
    33: ("assinatura_do_pacote", "produto", "Nao instale este pacote: baixe de novo pelo canal oficial. Se repetir, fale com o suporte."),
    34: ("imagem", "produto", "Copie o pacote de novo (a imagem chegou diferente). Se repetir, fale com o suporte."),
    35: ("pacote_de_outra_instalacao", "comprador", "Use o pacote gerado para este endereco (no lote fundador, cada Instalacao tem a sua imagem)."),
    36: ("instalacao_diferente", "comprador", "Esta instalacao comecou com outros dados. Trocar o endereco e um comando a parte; para continuar, rode com as mesmas respostas."),
    37: ("falta_ferramenta", "comprador", "Instale o que falta (sudo apt-get install -y python3 curl openssl) e rode de novo."),
    38: ("relogio", "comprador", "Acerte o relogio do servidor (NTP: sudo timedatectl set-ntp true) e rode de novo."),
    39: ("preparo", "comprador", "O preparo do servidor falhou num passo (linhas acima: apt, Docker ou restic). Confira a saida do servidor para a internet e rode de novo."),
    40: ("segredos", "produto", "A geracao das senhas falhou (linhas acima). Rode de novo; se repetir, fale com o suporte."),
    41: ("servicos", "produto", "Um servico nao subiu: veja as linhas acima e sudo docker compose logs do servico. Rode de novo; se repetir, fale com o suporte."),
    42: ("migracoes", "produto", "As migracoes pararam (o codigo do migrador esta na mensagem; docs/20 §9A). Rode de novo; se repetir, fale com o suporte."),
    43: ("agendador", "produto", "O agendador de minuto nao ficou ligado. Rode de novo; se repetir, fale com o suporte."),
    44: ("conta_do_dono", "produto", "A primeira conta da equipe nao foi criada (linhas acima). Rode de novo; se repetir, fale com o suporte."),
    45: ("chave_do_email", "comprador", "Confira a chave da API do provedor de e-mail (Resend > API Keys) e rode de novo."),
    46: ("dominio_do_email", "comprador", "Crie os registros do e-mail mostrados acima no painel de DNS e rode de novo quando o provedor verificar o dominio (minutos; no pior caso, ate 72 horas)."),
    47: ("email_de_teste", "comprador", "O e-mail de teste nao saiu (motivo acima). Confira o dominio de envio no provedor e rode de novo."),
    48: ("backup", "comprador", "O backup nao ficou pronto (motivo acima, com o codigo do membros backup; docs/20 §9B). Corrija e rode de novo."),
    49: ("kit_de_recuperacao", "comprador", "Rode no terminal: sudo membros kit-de-recuperacao, guarde a folha e rode o instalador de novo."),
    50: ("certificado", "comprador", "O certificado HTTPS nao saiu: confira o DNS e as portas 80 e 443 no firewall do provedor e rode de novo."),
    51: ("conferencia_final", "produto", "A conferencia final falhou (linhas acima). Rode de novo; se repetir, fale com o suporte."),
    52: ("chave_de_ativacao", "comprador", "Confira a Chave de ativacao (copie de novo, inteira) ou peca uma Chave nova."),
    53: ("vaga_em_uso", "comprador", "A Licenca ja esta em uso noutro endereco: desative a Instalacao de la, ou compre outra Licenca."),
    54: ("emissor_fora", "produto", "O Emissor de licencas nao respondeu. Rode de novo daqui a pouco; o resto da instalacao ja esta feito."),
    55: ("ativacao", "produto", "A ativacao nao terminou (motivo acima). Rode de novo, ou ative pela tela: Configuracoes > Licenca."),
}
DE_QUEM = {
    "comprador": "do servidor ou das contas do comprador (provedor, DNS, e-mail, armazenamento)",
    "produto": "do produto (Correcao de defeito, pelo suporte)",
}


def mensagem_do_codigo(codigo, detalhe=""):
    nome, quem, fazer = CODIGOS.get(codigo, ("erro", "produto", "Rode de novo; se repetir, fale com o suporte."))
    linhas = [f"ERRO (codigo {codigo}, {nome}): {detalhe}" if detalhe else f"ERRO (codigo {codigo}, {nome})."]
    linhas.append(f"  O que fazer: {fazer}")
    linhas.append(f"  De quem e: {DE_QUEM[quem]}.")
    return "\n".join(linhas)


def falhar(mensagem, codigo=1):
    sys.stderr.write(mensagem_do_codigo(codigo, mensagem) + "\n")
    sys.exit(codigo)


def aviso(texto):
    sys.stderr.write(f"AVISO: {texto}\n")


def agora_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sh(nome, valor):
    return f"{nome}={shlex.quote(valor if valor is not None else '')}"


# ---- validacao dos valores ------------------------------------------------------------------------------------------

ROTULO = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)$")


def normalizar_host(texto):
    """O endereco como o comprador escreveu (com https://, barra, maiusculas, acentos) no formato do DNS."""
    t = (texto or "").strip()
    t = re.sub(r"^[a-zA-Z]+://", "", t).split("/")[0].strip().rstrip(".").lower()
    if not t:
        return ""
    try:
        t = t.encode("idna").decode("ascii")
    except UnicodeError:
        return t
    return t


def problema_do_host(host, campo):
    if not host:
        return f"{campo} esta vazio."
    if len(host) > 253 or ":" in host or "@" in host:
        return f"{campo} nao e um endereco valido ({host})."
    rotulos = host.split(".")
    if len(rotulos) < 2 or not all(ROTULO.match(r) for r in rotulos) or not re.match(r"^[a-z][a-z0-9-]*$", rotulos[-1]):
        return f"{campo} nao e um endereco valido ({host}). Escreva so o endereco, por exemplo alunos.meucurso.com.br."
    sufixo2 = ".".join(rotulos[-2:])
    if len(rotulos) == 2 or (len(rotulos) == 3 and sufixo2 in SUFIXOS_DE_DOIS_NIVEIS):
        return (f"{campo} precisa ser um subdominio, por exemplo alunos.{host}: o dominio sem subdominio ({host}) quase "
                "sempre ja tem o site de vendas, e aponta-lo para a escola tira esse site do ar (docs/32 §3.1).")
    return None


def problema_do_email(valor, campo):
    if not re.fullmatch(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", valor or ""):
        return f"{campo} nao e um e-mail valido ({valor})."
    return None


def dominio_base(host):
    """alunos.meucurso.com.br -> meucurso.com.br (tira o primeiro rotulo do endereco da escola)."""
    rotulos = host.split(".")
    return ".".join(rotulos[1:]) if len(rotulos) > 2 else host


def limpar_chave_de_ativacao(texto):
    return re.sub(r"\s+", "", texto or "").upper()


def problema_da_chave_de_ativacao(chave):
    if not chave:
        return "a Chave de ativacao esta vazia."
    if len(chave) > 80 or not re.fullmatch(r"BKA-[0-9A-Z-]{8,76}", chave):
        return "a Chave de ativacao nao esta inteira: ela comeca com BKA- (copie de novo, inteira)."
    return None


TEXTO_SIMPLES = re.compile(r"^[^\x00-\x1f\x7f#$\"'\\<>`]{2,80}$")


def problema_do_nome(nome):
    if not TEXTO_SIMPLES.match(nome or "") or nome != nome.strip():
        return "NOME_DA_ESCOLA precisa ter de 2 a 80 letras, sem aspas, #, $, < ou >."
    return None


SEGREDO_SIMPLES = re.compile(r"^[A-Za-z0-9/+=_.:-]{8,256}$")


# ---- respostas ------------------------------------------------------------------------------------------------------

CHAVES_DE_RESPOSTA = {
    "ENDERECO", "ENDERECO_API", "EMAIL_DONO", "NOME_DA_ESCOLA", "CHAVE_ATIVACAO", "CHAVE_ATIVACAO_ARQUIVO",
    "RESEND_API_KEY", "EMAIL_REMETENTE", "EMAIL_RESPONDER_PARA", "EMAIL_TESTE_PARA", "BACKUP_DESTINO",
    "BACKUP_AWS_ACCESS_KEY_ID", "BACKUP_AWS_SECRET_ACCESS_KEY", "BACKUP_AWS_DEFAULT_REGION", "BACKUP_SFTP_PORTA",
    "BACKUP_SO_NESTE_SERVIDOR", "CHAVE_SSH", "REINICIO_AUTOMATICO", "IP_DO_SERVIDOR",
}
CHAVES_SECRETAS = {"CHAVE_ATIVACAO", "RESEND_API_KEY", "BACKUP_AWS_SECRET_ACCESS_KEY"}


def ler_pares(caminho):
    """CHAVE=valor por linha, como o .env: nunca executado. Comentarios (#) e linhas em branco nao contam."""
    pares = {}
    with open(caminho, encoding="utf-8") as f:
        for numero, bruta in enumerate(f.read().splitlines(), 1):
            linha = bruta.strip()
            if not linha or linha.startswith("#"):
                continue
            m = re.match(r"^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$", linha)
            if not m:
                falhar(f"a linha {numero} de {caminho} nao e CHAVE=valor.", 1)
            valor = m.group(2).strip()
            if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in "\"'":
                valor = valor[1:-1]
            pares[m.group(1)] = valor
    return pares


def arquivo_so_do_dono(caminho):
    try:
        return (os.stat(caminho).st_mode & 0o077) == 0
    except OSError:
        return False


def perguntar(texto, segredo=False, padrao=""):
    rotulo = f"{texto} [{padrao}]: " if padrao else f"{texto}: "
    if segredo:
        import termios

        # O eco sai antes de a pergunta aparecer: quem responde logo (ou cola) nunca ve o segredo na tela.
        fd = sys.stdin.fileno()
        antigo = termios.tcgetattr(fd)
        novo = termios.tcgetattr(fd)
        novo[3] &= ~termios.ECHO
        try:
            termios.tcsetattr(fd, termios.TCSAFLUSH, novo)
            sys.stderr.write(rotulo)
            sys.stderr.flush()
            valor = sys.stdin.readline()
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, antigo)
        sys.stderr.write("\n")
    else:
        sys.stderr.write(rotulo)
        sys.stderr.flush()
        valor = sys.stdin.readline()
    if valor == "":
        falhar("a entrada acabou no meio das perguntas.", 1)
    valor = valor.strip()
    return valor or padrao


def destino_do_backup(repo):
    """kit.destino_analisar sem sair: (tipo, servidor, repo) ou a frase do problema."""
    erro = io.StringIO()
    try:
        with contextlib.redirect_stderr(erro):
            return kit.destino_analisar(repo), None
    except SystemExit:
        return None, erro.getvalue().replace("ERRO: ", "").strip()


def respostas(argv):
    opcoes = {"--modo": "instalacao", "--arquivo": "", "--ativacao-arquivo": "", "--segredos": "", "--estado": "",
              "--pasta-backup": "/var/backups/escola"}
    perguntar_ok = False
    permitir_faltas = False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--perguntar":
            perguntar_ok = True
        elif a == "--permitir-faltas":
            permitir_faltas = True
        elif a in opcoes:
            opcoes[a] = argv[i + 1]
            i += 1
        else:
            falhar(f"opcao desconhecida: {a}", 1)
        i += 1
    modo = opcoes["--modo"]
    if modo not in ("instalacao", "restauracao"):
        falhar("o modo e instalacao ou restauracao.", 1)

    dados = {}
    if opcoes["--arquivo"]:
        caminho = opcoes["--arquivo"]
        if not os.path.isfile(caminho):
            falhar(f"nao achei o arquivo de respostas {caminho}.", 1)
        dados = ler_pares(caminho)
        desconhecidas = sorted(set(dados) - CHAVES_DE_RESPOSTA)
        if desconhecidas:
            falhar(f"o arquivo de respostas tem chaves que o instalador nao conhece: {', '.join(desconhecidas)} "
                   f"(as que existem: {', '.join(sorted(CHAVES_DE_RESPOSTA))}).", 1)
        if any(dados.get(k) for k in CHAVES_SECRETAS) and not arquivo_so_do_dono(caminho):
            falhar(f"o arquivo de respostas {caminho} tem segredos e pode ser lido por outros usuarios: deixe so o "
                   "administrador ler (chmod 600) e rode de novo.", 1)
        if dados.get("CHAVE_ATIVACAO_ARQUIVO") and not opcoes["--ativacao-arquivo"]:
            opcoes["--ativacao-arquivo"] = dados.pop("CHAVE_ATIVACAO_ARQUIVO")
    if opcoes["--ativacao-arquivo"]:
        caminho = opcoes["--ativacao-arquivo"]
        if not os.path.isfile(caminho):
            falhar(f"nao achei o arquivo da Chave de ativacao {caminho}.", 1)
        if not arquivo_so_do_dono(caminho):
            falhar(f"{caminho} pode ser lido por outros usuarios: deixe so o administrador ler (chmod 600) e rode de novo.", 1)
        dados["CHAVE_ATIVACAO"] = open(caminho, encoding="utf-8").read().strip()

    # O que a instalacao ja tem (rodar de novo): o arquivo de segredos guarda as respostas dadas da primeira vez.
    env = {}
    if opcoes["--segredos"] and os.path.isfile(opcoes["--segredos"]):
        try:
            env = ler_pares(opcoes["--segredos"])
        except SystemExit:
            env = {}
    estado = kit.situacao_ler(opcoes["--estado"]) if opcoes["--estado"] else {}
    ja_ativada = ((estado.get("passos") or {}).get("ativacao") or {}).get("situacao") in ("ok", "pulado")

    def do_env(chave, transformar=lambda v: v):
        valor = env.get(chave, "")
        return transformar(valor) if valor else ""

    def host_da_url(v):
        return normalizar_host(v)

    vindo_do_env = {
        "ENDERECO": do_env("APP_PUBLIC_URL", host_da_url),
        "ENDERECO_API": do_env("SUPABASE_PUBLIC_URL", host_da_url),
        "EMAIL_DONO": do_env("ACME_EMAIL"),
        "NOME_DA_ESCOLA": env.get("SMTP_SENDER_NAME", "") if env.get("EMAIL_PROVIDER") == "resend" else "",
        "EMAIL_REMETENTE": env.get("SMTP_ADMIN_EMAIL", "") if env.get("EMAIL_PROVIDER") == "resend" else "",
        "EMAIL_RESPONDER_PARA": env.get("EMAIL_REPLY_TO", "") if env.get("EMAIL_PROVIDER") == "resend" else "",
        "RESEND_API_KEY": env.get("RESEND_API_KEY", ""),
        "BACKUP_DESTINO": env.get("RESTIC_REPOSITORY", "") if env.get("KIT_BACKUP_CONFIGURADO") == "sim" else "",
        "BACKUP_AWS_ACCESS_KEY_ID": env.get("AWS_ACCESS_KEY_ID", ""),
        "BACKUP_AWS_SECRET_ACCESS_KEY": env.get("AWS_SECRET_ACCESS_KEY", ""),
        "BACKUP_AWS_DEFAULT_REGION": env.get("AWS_DEFAULT_REGION", ""),
        "BACKUP_SFTP_PORTA": env.get("BACKUP_SFTP_PORTA", ""),
    }
    # Um endereco ja instalado nao muda por aqui (trocar de endereco e outro comando, docs/32 §2.3).
    for chave in ("ENDERECO", "ENDERECO_API"):
        if dados.get(chave) and vindo_do_env.get(chave) and normalizar_host(dados[chave]) != vindo_do_env[chave]:
            falhar(f"esta instalacao e de {vindo_do_env[chave]}, e as respostas dizem {normalizar_host(dados[chave])} em {chave}.", 36)
    # O que as respostas dizem do backup vale inteiro: o aceite do backup so aqui nao se mistura com o destino que ja
    # estava gravado, nem um destino novo com o aceite de antes.
    backup_nas_respostas = bool(dados.get("BACKUP_DESTINO") or dados.get("BACKUP_SO_NESTE_SERVIDOR"))
    # O mesmo destino de antes: as chaves de acesso gravadas valem (o arquivo de respostas pode nao repeti-las).
    mesmo_destino = bool(dados.get("BACKUP_DESTINO")) and dados.get("BACKUP_DESTINO") == vindo_do_env.get("BACKUP_DESTINO")
    for chave, valor in vindo_do_env.items():
        if chave.startswith("BACKUP_") and backup_nas_respostas and not mesmo_destino:
            continue
        if valor and not dados.get(chave):
            dados[chave] = valor
    if (estado.get("backup_so_neste_servidor") or {}).get("aceito_em") and not backup_nas_respostas:
        dados["BACKUP_SO_NESTE_SERVIDOR"] = FRASE_DO_BACKUP_LOCAL

    pode_perguntar = perguntar_ok and sys.stdin.isatty()
    faltando = []
    problemas = []

    def pedir(chave, texto, conferir, segredo=False, padrao="", obrigatorio=True, transformar=lambda v: v):
        valor = transformar(dados.get(chave, "")) if dados.get(chave) else ""
        if valor:
            problema = conferir(valor)
            if problema is None:
                dados[chave] = valor
                return valor
            if not pode_perguntar:
                problemas.append(problema)
                return ""
            sys.stderr.write(f"  {problema}\n")
        if not pode_perguntar:
            if padrao:
                problema = conferir(padrao)
                if problema is None:
                    dados[chave] = padrao
                    return padrao
            if obrigatorio:
                faltando.append(chave)
            return ""
        for _ in range(3):
            valor = transformar(perguntar(texto, segredo=segredo, padrao=padrao))
            if not valor and not obrigatorio:
                return ""
            problema = conferir(valor)
            if problema is None:
                dados[chave] = valor
                return valor
            sys.stderr.write(f"  {problema}\n")
        falhar(f"{chave}: tres tentativas sem um valor valido.", 1)

    if pode_perguntar:
        sys.stderr.write("\nO instalador pergunta so o que falta (Enter aceita o valor entre colchetes).\n")

    endereco = pedir("ENDERECO", "Endereco da escola (por exemplo alunos.meucurso.com.br)",
                     lambda v: problema_do_host(v, "ENDERECO"), transformar=normalizar_host)
    padrao_api = f"api.{endereco}" if endereco else ""
    dados.setdefault("ENDERECO_API", "")
    if not dados.get("ENDERECO_API") and padrao_api:
        dados["ENDERECO_API"] = padrao_api
    api = normalizar_host(dados.get("ENDERECO_API", ""))
    if api:
        problema = problema_do_host(api, "ENDERECO_API")
        if problema:
            problemas.append(problema)
        elif api == endereco:
            problemas.append("ENDERECO_API precisa ser diferente de ENDERECO (enquanto o endereco unico nao for testado, D14).")
        dados["ENDERECO_API"] = api
    pedir("EMAIL_DONO", "E-mail do dono da escola (a primeira conta da equipe e os avisos do certificado)",
          lambda v: problema_do_email(v, "EMAIL_DONO"), transformar=lambda v: v.strip())

    if modo == "instalacao":
        pedir("NOME_DA_ESCOLA", "Nome da escola (o remetente dos e-mails)", problema_do_nome, transformar=lambda v: v.strip())
        pedir("RESEND_API_KEY", "Chave da API do Resend (comeca com re_; nao aparece na tela)",
              lambda v: None if re.fullmatch(r"re_[A-Za-z0-9_]{8,200}", v) else "RESEND_API_KEY nao parece uma chave do Resend (comeca com re_).",
              segredo=True, transformar=lambda v: v.strip())
        padrao_remetente = f"escola@mail.{dominio_base(endereco)}" if endereco else ""
        pedir("EMAIL_REMETENTE", "E-mail que envia os e-mails da escola (o dominio dele e verificado no Resend)",
              lambda v: problema_do_email(v, "EMAIL_REMETENTE"), padrao=padrao_remetente, transformar=lambda v: v.strip().lower())
        for chave in ("EMAIL_RESPONDER_PARA", "EMAIL_TESTE_PARA"):
            if dados.get(chave):
                problema = problema_do_email(dados[chave], chave)
                if problema:
                    problemas.append(problema)
        dados.setdefault("EMAIL_TESTE_PARA", "")
        if not dados.get("EMAIL_TESTE_PARA"):
            dados["EMAIL_TESTE_PARA"] = dados.get("EMAIL_DONO", "")
        if not dados.get("EMAIL_RESPONDER_PARA"):
            dados["EMAIL_RESPONDER_PARA"] = dados.get("EMAIL_DONO", "")
    else:
        # A restauracao nao gasta Chave (a licenca vem no backup) e precisa de onde esta o backup.
        if dados.get("BACKUP_SO_NESTE_SERVIDOR"):
            problemas.append("no modo de restauracao o backup vem do destino da folha de recuperacao: BACKUP_SO_NESTE_SERVIDOR nao vale aqui.")
        dados.pop("CHAVE_ATIVACAO", None)

    # O backup: um destino fora do servidor, ou o aceite escrito de que ele fica so aqui (docs/32 §4).
    local_aceito = re.sub(r"\s+", " ", dados.get("BACKUP_SO_NESTE_SERVIDOR", "")).strip().upper() == FRASE_DO_BACKUP_LOCAL
    if dados.get("BACKUP_SO_NESTE_SERVIDOR") and not local_aceito:
        problemas.append(f"BACKUP_SO_NESTE_SERVIDOR precisa ser exatamente: {FRASE_DO_BACKUP_LOCAL}")
    if modo == "instalacao" and not dados.get("BACKUP_DESTINO") and not local_aceito and pode_perguntar:
        sys.stderr.write(
            "\nOnde guardar o backup diario?\n"
            "  1) armazenamento compativel com S3 (Backblaze B2, Wasabi, Cloudflare R2), fora deste servidor\n"
            "  2) servidor SFTP, fora deste servidor\n"
            "  3) so neste servidor (nao recomendado: se o servidor morrer, o backup morre junto)\n")
        escolha = ""
        for _ in range(3):
            escolha = perguntar("Escolha 1, 2 ou 3")
            if escolha in ("1", "2", "3"):
                break
        if escolha == "3":
            frase = perguntar(f"Para confirmar, digite: {FRASE_DO_BACKUP_LOCAL}")
            if re.sub(r"\s+", " ", frase).strip().upper() != FRASE_DO_BACKUP_LOCAL:
                falhar("confirmacao diferente: o backup so neste servidor nao foi aceito.", 1)
            local_aceito = True
        elif escolha == "1":
            pedir("BACKUP_DESTINO", "Endereco do bucket (s3:https://<servidor>/<bucket>)",
                  lambda v: destino_do_backup(v)[1] or (None if v.startswith("s3:") else "o endereco do S3 comeca com s3:https://"))
        elif escolha == "2":
            pedir("BACKUP_DESTINO", "Destino SFTP (sftp:usuario@servidor:/pasta)",
                  lambda v: destino_do_backup(v)[1] or (None if v.startswith("sftp:") else "o destino SFTP comeca com sftp:"))
        else:
            falhar("escolha 1, 2 ou 3 para o backup.", 1)
    if modo == "restauracao" and not dados.get("BACKUP_DESTINO"):
        pedir("BACKUP_DESTINO", "Onde esta o backup (a linha Destino da folha de recuperacao)",
              lambda v: destino_do_backup(v)[1])

    tipo = servidor = ""
    if local_aceito and modo == "instalacao":
        if not dados.get("BACKUP_DESTINO"):
            dados["BACKUP_DESTINO"] = os.path.join(opcoes["--pasta-backup"], "repositorio")
        analise, problema = destino_do_backup(dados["BACKUP_DESTINO"])
        if problema:
            problemas.append(problema)
        elif analise[0] != "local":
            problemas.append("escolha um destino fora do servidor (BACKUP_DESTINO) ou o backup so neste servidor (BACKUP_SO_NESTE_SERVIDOR), nao os dois.")
        else:
            tipo, servidor = analise[0], analise[1]
    elif dados.get("BACKUP_DESTINO"):
        analise, problema = destino_do_backup(dados["BACKUP_DESTINO"])
        if problema:
            problemas.append(problema)
        else:
            tipo, servidor = analise[0], analise[1]
            if tipo == "local" and modo == "instalacao":
                problemas.append(f"um backup numa pasta deste servidor pede o aceite escrito: BACKUP_SO_NESTE_SERVIDOR={FRASE_DO_BACKUP_LOCAL}")
    elif modo == "instalacao":
        faltando.append("BACKUP_DESTINO (ou BACKUP_SO_NESTE_SERVIDOR)")
    if tipo == "s3":
        pedir("BACKUP_AWS_ACCESS_KEY_ID", "Chave de acesso ao bucket (o ID)",
              lambda v: None if SEGREDO_SIMPLES.match(v) else "BACKUP_AWS_ACCESS_KEY_ID nao parece um ID de chave de acesso.")
        pedir("BACKUP_AWS_SECRET_ACCESS_KEY", "Chave de acesso ao bucket (o segredo; nao aparece na tela)",
              lambda v: None if SEGREDO_SIMPLES.match(v) else "BACKUP_AWS_SECRET_ACCESS_KEY nao parece o segredo de uma chave de acesso.",
              segredo=True)
        if not dados.get("BACKUP_AWS_DEFAULT_REGION") and servidor.endswith(".r2.cloudflarestorage.com"):
            dados["BACKUP_AWS_DEFAULT_REGION"] = "auto"
        regiao = dados.get("BACKUP_AWS_DEFAULT_REGION", "")
        if regiao and not re.fullmatch(r"[a-z0-9-]{2,40}", regiao):
            problemas.append("BACKUP_AWS_DEFAULT_REGION nao e uma regiao valida.")
    else:
        for chave in ("BACKUP_AWS_ACCESS_KEY_ID", "BACKUP_AWS_SECRET_ACCESS_KEY", "BACKUP_AWS_DEFAULT_REGION"):
            dados[chave] = ""
    porta = dados.get("BACKUP_SFTP_PORTA", "")
    if porta and (not porta.isdigit() or not 1 <= int(porta) <= 65535):
        problemas.append("BACKUP_SFTP_PORTA precisa ser um numero de porta.")

    if modo == "instalacao" and not ja_ativada:
        if dados.get("CHAVE_ATIVACAO"):
            dados["CHAVE_ATIVACAO"] = limpar_chave_de_ativacao(dados["CHAVE_ATIVACAO"])
        pedir("CHAVE_ATIVACAO", "Chave de ativacao (comeca com BKA-; nao aparece na tela)", problema_da_chave_de_ativacao,
              segredo=True, transformar=limpar_chave_de_ativacao)
    else:
        dados["CHAVE_ATIVACAO"] = ""

    chave_ssh = dados.get("CHAVE_SSH", "")
    if chave_ssh and not re.fullmatch(r"(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com) [A-Za-z0-9+/=]{40,}( [^\n]{0,200})?", chave_ssh):
        problemas.append("CHAVE_SSH nao parece uma chave publica SSH (ssh-ed25519 AAAA... nome).")
    reinicio = dados.get("REINICIO_AUTOMATICO", "nao").lower() or "nao"
    if reinicio not in ("sim", "nao"):
        problemas.append("REINICIO_AUTOMATICO e sim ou nao.")
    ip = dados.get("IP_DO_SERVIDOR", "")
    if ip:
        try:
            if not ipaddress.IPv4Address(ip).is_global:
                problemas.append(f"IP_DO_SERVIDOR precisa ser um IPv4 publico (veio {ip}).")
        except ValueError:
            problemas.append(f"IP_DO_SERVIDOR nao e um IPv4 ({ip}).")

    if problemas:
        falhar(" ".join(problemas), 1)
    if faltando and not permitir_faltas:
        como = "no arquivo de respostas" if opcoes["--arquivo"] else "rodando no terminal (o instalador pergunta), ou num arquivo de respostas (--respostas)"
        falhar(f"faltam: {', '.join(faltando)}. Informe {como}.", 1)

    saida = [
        sh("ENDERECO", dados.get("ENDERECO", "")),
        sh("ENDERECO_API", dados.get("ENDERECO_API", "")),
        sh("EMAIL_DONO", dados.get("EMAIL_DONO", "")),
        sh("NOME_DA_ESCOLA", dados.get("NOME_DA_ESCOLA", "")),
        sh("EMAIL_REMETENTE", dados.get("EMAIL_REMETENTE", "")),
        sh("EMAIL_DOMINIO", dados.get("EMAIL_REMETENTE", "").partition("@")[2]),
        sh("EMAIL_RESPONDER_PARA", dados.get("EMAIL_RESPONDER_PARA", "")),
        sh("EMAIL_TESTE_PARA", dados.get("EMAIL_TESTE_PARA", "")),
        sh("RESEND_API_KEY", dados.get("RESEND_API_KEY", "")),
        sh("CHAVE_ATIVACAO", dados.get("CHAVE_ATIVACAO", "")),
        sh("BACKUP_DESTINO", dados.get("BACKUP_DESTINO", "")),
        sh("BACKUP_TIPO", tipo),
        sh("BACKUP_SERVIDOR", servidor),
        sh("BACKUP_SO_NESTE_SERVIDOR", "sim" if local_aceito and modo == "instalacao" else "nao"),
        sh("BACKUP_AWS_ACCESS_KEY_ID", dados.get("BACKUP_AWS_ACCESS_KEY_ID", "")),
        sh("BACKUP_AWS_SECRET_ACCESS_KEY", dados.get("BACKUP_AWS_SECRET_ACCESS_KEY", "")),
        sh("BACKUP_AWS_DEFAULT_REGION", dados.get("BACKUP_AWS_DEFAULT_REGION", "")),
        sh("BACKUP_SFTP_PORTA", porta),
        sh("CHAVE_SSH", chave_ssh),
        sh("REINICIO_AUTOMATICO", reinicio),
        sh("IP_DO_SERVIDOR", ip),
        sh("RESPOSTAS_FALTANDO", " ".join(faltando)),
    ]
    print("\n".join(saida))


# ---- pacote da versao -----------------------------------------------------------------------------------------------

def sha256_do_arquivo(caminho):
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def caminho_seguro(base, relativo):
    if not isinstance(relativo, str) or not relativo or relativo.startswith("/") or "\\" in relativo or "\x00" in relativo:
        return None
    partes = relativo.split("/")
    if any(p in ("", ".", "..") for p in partes):
        return None
    return os.path.join(base, *partes)


def chave_publica_em_pem(chave_b64):
    try:
        der = base64.b64decode(chave_b64, validate=True)
    except ValueError:
        return None
    # SubjectPublicKeyInfo de uma chave Ed25519: 12 bytes fixos e os 32 da chave.
    if len(der) != 44 or der[:12] != bytes.fromhex("302a300506032b6570032100"):
        return None
    corpo = base64.b64encode(der).decode("ascii")
    return f"-----BEGIN PUBLIC KEY-----\n{corpo}\n-----END PUBLIC KEY-----\n"


def assinatura_confere(manifesto, assinatura, chaves):
    """A assinatura Ed25519 do manifesto confere com alguma das chaves? (openssl pkeyutl -verify -rawin)."""
    with tempfile.TemporaryDirectory(prefix="kit-pacote-") as pasta:
        sig = os.path.join(pasta, "assinatura.bin")
        with open(sig, "wb") as f:
            f.write(assinatura)
        for chave in chaves:
            pem = chave_publica_em_pem(chave)
            if pem is None:
                falhar(f"a chave do pacote no kit.conf nao e uma chave publica Ed25519 em base64 ({chave[:16]}...).", 33)
            arquivo = os.path.join(pasta, "chave.pem")
            with open(arquivo, "w", encoding="ascii") as f:
                f.write(pem)
            try:
                r = subprocess.run(["openssl", "pkeyutl", "-verify", "-pubin", "-inkey", arquivo, "-rawin", "-in", manifesto,
                                    "-sigfile", sig], capture_output=True, text=True, timeout=60)
            except FileNotFoundError:
                falhar("o openssl nao esta instalado neste servidor e o pacote precisa ser conferido.", 37)
            if r.returncode == 0 and "Verified Successfully" in r.stdout:
                return True
    return False


def ler_manifesto(pacote):
    caminho = os.path.join(pacote, "MANIFESTO.json")
    if not os.path.isfile(caminho):
        falhar(f"o pacote em {pacote} nao tem o MANIFESTO.json (o pacote esta incompleto ou nao e um Pacote da versao).", 32)
    with open(caminho, "rb") as f:
        bruto = f.read()
    try:
        manifesto = json.loads(bruto.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        falhar("o MANIFESTO.json do pacote nao e um JSON valido.", 32)
    if not isinstance(manifesto, dict) or manifesto.get("formato") != FORMATO_DO_MANIFESTO:
        falhar(f"este instalador le o manifesto no formato {FORMATO_DO_MANIFESTO}; o do pacote e outro.", 32)
    return caminho, bruto, manifesto


def manifesto_conferir(argv):
    pacote = argv[0]
    chaves_txt = ""
    gravar = ""
    sem_imagens = False
    i = 1
    while i < len(argv):
        if argv[i] == "--chaves":
            chaves_txt = argv[i + 1]
            i += 1
        elif argv[i] == "--gravar-chaves":
            gravar = argv[i + 1]
            i += 1
        elif argv[i] == "--sem-imagens":
            sem_imagens = True
        i += 1
    caminho, bruto, manifesto = ler_manifesto(pacote)
    chaves = chaves_txt.split()
    arquivo_assinatura = caminho + ".assinatura"
    assinado = os.path.isfile(arquivo_assinatura)
    if chaves:
        if not assinado:
            falhar("o pacote nao tem assinatura (MANIFESTO.json.assinatura), e este servidor exige pacote assinado.", 33)
        try:
            assinatura = base64.b64decode(open(arquivo_assinatura, encoding="ascii").read().strip(), validate=True)
        except (ValueError, UnicodeDecodeError):
            falhar("a assinatura do pacote nao esta no formato esperado (base64 de 64 bytes).", 33)
        if len(assinatura) != 64 or not assinatura_confere(caminho, assinatura, chaves):
            falhar("a assinatura do manifesto nao confere com a chave do pacote: o pacote foi alterado ou nao e nosso.", 33)
    problemas = []
    arquivos = manifesto.get("arquivos")
    imagens = manifesto.get("imagens")
    if not isinstance(arquivos, list) or not arquivos or not isinstance(imagens, list) or not imagens:
        falhar("o manifesto nao lista os arquivos e as imagens do pacote.", 32)
    vistos = set()
    conferidos = {}
    for item in arquivos + ([] if sem_imagens else [{"caminho": im.get("arquivo"), **im} for im in imagens if isinstance(im, dict)]):
        rel = item.get("caminho") if isinstance(item, dict) else None
        alvo = caminho_seguro(pacote, rel)
        if alvo is None or (rel in vistos and "id" not in item):
            falhar(f"o manifesto tem um caminho recusado ({rel!r}).", 32)
        vistos.add(rel)
        if rel in conferidos:
            continue
        if "id" in item and not os.path.exists(alvo):
            # A imagem que a equipe mandou direto (docker save | ssh ... docker load) e nao veio em arquivo: vale se ja esta
            # carregada com o mesmo id, que e o resumo da configuracao dela (e a configuracao fixa o resumo de cada camada).
            tags = [t for t in item.get("tags") or [] if isinstance(t, str)]
            rc, saida, _ = rodar(["docker", "image", "inspect", "-f", "{{.Id}}", tags[0]]) if tags else (1, "", "")
            if rc == 0 and saida.strip() == item.get("id"):
                conferidos[rel] = True
                continue
            problemas.append(f"falta {rel} (e a imagem {tags[0] if tags else '?'} nao esta carregada neste servidor)")
            continue
        if not os.path.isfile(alvo) or os.path.islink(alvo):
            problemas.append(f"falta {rel}")
            continue
        if os.path.getsize(alvo) != item.get("bytes") or sha256_do_arquivo(alvo) != item.get("sha256"):
            problemas.append(f"{rel} nao confere")
        conferidos[rel] = True
    if problemas:
        mostrar = "; ".join(problemas[:5]) + (f" e mais {len(problemas) - 5}" if len(problemas) > 5 else "")
        falhar(f"o pacote nao confere com o manifesto: {mostrar}.", 32)
    obrigatorios = ("infra/kit/instalar", "infra/kit/membros", "infra/kit/kit.conf", "infra/compose/docker-compose.kit.yml",
                    "infra/compose/generate-secrets.mjs", "infra/compose/.env.example", "infra/scripts/smoke.sh")
    nomes = {a.get("caminho") for a in arquivos}
    faltam = [o for o in obrigatorios if o not in nomes]
    if faltam:
        falhar(f"o manifesto nao traz {', '.join(faltam)}.", 32)
    apps = [im for im in imagens if isinstance(im, dict) and im.get("papel") == "app"]
    if len(apps) != 1 or not re.fullmatch(r"sha256:[0-9a-f]{64}", str(apps[0].get("id", ""))) or not apps[0].get("tags"):
        falhar("o manifesto precisa de uma imagem do app, com o id (sha256:...) e a tag.", 32)
    app = apps[0]
    versao = str(manifesto.get("versao", ""))
    if not re.fullmatch(r"\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?", versao):
        falhar("o manifesto nao tem uma versao valida.", 32)
    instalacao = manifesto.get("instalacao") or ""
    instalacao_api = manifesto.get("instalacao_api") or ""
    # A chave publicavel que a imagem da escola traz gravada (o pacote de um fundador, docs/20 §9D.6): publica; o passo dos
    # segredos a grava no arquivo de segredos, para o gateway aceitar o que o navegador manda.
    chave_publicavel = manifesto.get("chave_publicavel") or ""
    if chave_publicavel and not re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{8}", str(chave_publicavel)):
        falhar("o manifesto traz uma chave publicavel fora do formato.", 32)
    if gravar and chaves:
        # A chave que conferiu este pacote passa a ser a deste servidor (rodar de novo e atualizar conferem com ela).
        novas = [c for c in (manifesto.get("chaves_seguintes") or []) if isinstance(c, str) and chave_publica_em_pem(c)]
        conteudo = " ".join(dict.fromkeys(chaves + novas)) + "\n"
        os.makedirs(os.path.dirname(os.path.abspath(gravar)), exist_ok=True)
        with open(gravar, "w", encoding="ascii") as f:
            f.write(conteudo)
        os.chmod(gravar, 0o644)
    print("\n".join([
        sh("PACOTE_VERSAO", versao),
        sh("PACOTE_INSTALACAO", normalizar_host(instalacao) if instalacao else ""),
        sh("PACOTE_INSTALACAO_API", normalizar_host(instalacao_api) if instalacao_api else ""),
        sh("PACOTE_CHAVE_PUBLICAVEL", str(chave_publicavel)),
        sh("PACOTE_APP_IMAGEM", str(app["tags"][0])),
        sh("PACOTE_APP_ID", str(app["id"])),
        sh("PACOTE_MANIFESTO_SHA256", hashlib.sha256(bruto).hexdigest()),
        sh("PACOTE_ASSINADO", "sim" if assinado and chaves else ("sem_chave" if assinado else "nao")),
        sh("PACOTE_ARQUIVOS", str(len(arquivos))),
    ]))


def imagens_do_manifesto(argv):
    _, _, manifesto = ler_manifesto(argv[0])
    for im in manifesto.get("imagens") or []:
        tags = [t for t in im.get("tags") or [] if isinstance(t, str) and re.fullmatch(r"[A-Za-z0-9._/:@-]+", t)]
        if not tags or not re.fullmatch(r"sha256:[0-9a-f]{64}", str(im.get("id", ""))):
            falhar("o manifesto tem uma imagem sem tag ou sem id.", 32)
        print("\x1f".join([im["arquivo"], im["id"], " ".join(tags), im.get("papel", "")]))


# ---- arquivo do instalador (os passos) ------------------------------------------------------------------------------

def gravar_json(caminho, dados, modo=0o644):
    pasta = os.path.dirname(os.path.abspath(caminho))
    os.makedirs(pasta, exist_ok=True)
    fd, temporario = tempfile.mkstemp(dir=pasta, prefix=".instalacao.")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(json.dumps(dados, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    os.chmod(temporario, modo)
    os.replace(temporario, caminho)


def estado_iniciar(argv):
    caminho = argv[0]
    valores = dict(a.split("=", 1) for a in argv[1:])
    estado = kit.situacao_ler(caminho)
    modo = valores.get("modo")
    if modo and estado.get("modo") and estado["modo"] != modo:
        falhar(f"esta instalacao comecou no modo {estado['modo']}; rode o instalador no mesmo modo.", 36)
    if estado.get("endereco") and valores.get("endereco") and estado["endereco"] != valores["endereco"]:
        falhar(f"esta instalacao e de {estado['endereco']}, nao de {valores['endereco']}.", 36)
    if estado.get("manifesto_sha256") and valores.get("manifesto_sha256") and estado["manifesto_sha256"] != valores["manifesto_sha256"]:
        if estado.get("terminou_em"):
            falhar(f"esta escola ja esta instalada com a versao {estado.get('versao')}. Uma versao nova se instala pelo "
                   "comando de atualizar (ainda nao existe nesta versao do kit; fale com o suporte).", 36)
        # Outro pacote no meio da instalacao: os passos dele (e os que dependem dele) rodam de novo.
        for passo in ("pacote", "imagens", "servicos", "migracoes"):
            (estado.get("passos") or {}).pop(passo, None)
    estado.setdefault("formato", FORMATO_DO_ESTADO)
    estado.setdefault("comecou_em", agora_iso())
    estado.setdefault("passos", {})
    for chave in ("modo", "versao", "endereco", "endereco_api", "manifesto_sha256"):
        if valores.get(chave):
            estado[chave] = valores[chave]
    gravar_json(caminho, estado)


def estado_passo(argv):
    caminho, passo, situacao = argv[0], argv[1], argv[2]
    if passo not in PASSOS or situacao not in ("ok", "falhou", "pulado", "em_andamento", "interrompido"):
        falhar(f"passo ou situacao recusados: {passo} {situacao}", 1)
    estado = kit.situacao_ler(caminho)
    registro = {"situacao": situacao, "em": agora_iso()}
    if len(argv) > 3 and argv[3]:
        registro["codigo"] = int(argv[3])
        registro["nome"] = CODIGOS.get(int(argv[3]), ("erro",))[0]
    if len(argv) > 4 and argv[4]:
        # So o motivo curto: nunca valor de segredo (quem chama nao passa) e nunca mais que uma linha.
        registro["motivo"] = argv[4].splitlines()[0][:300]
    estado.setdefault("passos", {})[passo] = registro
    if passo == PASSOS[-1] and situacao in ("ok", "pulado"):
        estado["terminou_em"] = agora_iso()
    gravar_json(caminho, estado)


def estado_marcar(argv):
    caminho = argv[0]
    estado = kit.situacao_ler(caminho)
    for par in argv[1:]:
        chave, _, valor = par.partition("=")
        partes = chave.split(".")
        if not all(re.fullmatch(r"[a-z_][a-z0-9_]*", p) for p in partes):
            falhar(f"chave recusada: {chave}", 1)
        no = estado
        for p in partes[:-1]:
            no = no.setdefault(p, {})
        no[partes[-1]] = valor
    gravar_json(caminho, estado)


def estado_ler(argv):
    valor = kit.situacao_valor(kit.situacao_ler(argv[0]), argv[1])
    if valor is not None:
        print(valor if not isinstance(valor, (dict, list, bool)) else json.dumps(valor))


# ---- comandos do sistema (os testes trocam pelo PATH) ---------------------------------------------------------------

def rodar(args, entrada=None, tempo=30):
    try:
        r = subprocess.run(args, input=entrada, capture_output=True, text=True, timeout=tempo)
        return r.returncode, r.stdout, r.stderr
    except FileNotFoundError:
        return 127, "", f"{args[0]}: nao encontrado"
    except subprocess.TimeoutExpired:
        return 124, "", f"{args[0]}: tempo esgotado"


def curl_sonda(url, tempo=12, extra=()):
    """(codigo de saida do curl, codigo HTTP, cabecalhos). Nunca segue redirecionamento; nunca leva segredo."""
    rc, saida, _ = rodar(["curl", "-sS", "-o", "/dev/null", "-D", "-", "--max-time", str(tempo), "-w", "\n%{http_code}", *extra, url], tempo=tempo + 5)
    linhas = saida.rstrip("\n").split("\n")
    http = linhas[-1].strip() if linhas else "000"
    return rc, http if re.fullmatch(r"\d{3}", http) else "000", "\n".join(linhas[:-1])


def curl_json(metodo, url, chave=None, corpo=None, tempo=30):
    """Um pedido JSON pelo curl, com a chave pelo -K - (a entrada), nunca pela linha de comando."""
    config = f'header = "Authorization: Bearer {chave}"\n' if chave else ""
    with tempfile.TemporaryDirectory(prefix="kit-curl-") as pasta:
        args = ["curl", "-sS", "-K", "-", "--max-time", str(tempo), "-X", metodo, "-H", "Accept: application/json", "-w", "\n%{http_code}"]
        if corpo is not None:
            arquivo = os.path.join(pasta, "corpo.json")
            with open(arquivo, "w", encoding="utf-8") as f:
                json.dump(corpo, f, ensure_ascii=False)
            args += ["-H", "Content-Type: application/json", "--data-binary", "@" + arquivo]
        rc, saida, erro = rodar(args + [url], entrada=config, tempo=tempo + 5)
    texto, _, http = saida.rstrip("\n").rpartition("\n")
    if not re.fullmatch(r"\d{3}", http or ""):
        texto, http = saida, "000"
    try:
        dados = json.loads(texto) if texto.strip() else None
    except ValueError:
        dados = None
    return rc, int(http), dados, erro.strip()


def linhas_de(args):
    rc, saida, _ = rodar(args)
    return rc, [l for l in saida.splitlines() if l.strip()]


def ler_os_release():
    caminho = os.environ.get("KIT_ARQUIVO_OS_RELEASE", "/etc/os-release")
    dados = {}
    try:
        for linha in open(caminho, encoding="utf-8").read().splitlines():
            m = re.match(r'^([A-Z_]+)=(.*)$', linha)
            if m:
                dados[m.group(1)] = m.group(2).strip().strip('"')
    except OSError:
        pass
    return dados


def memoria_total_mb():
    caminho = os.environ.get("KIT_ARQUIVO_MEMINFO", "/proc/meminfo")
    try:
        for linha in open(caminho, encoding="utf-8").read().splitlines():
            if linha.startswith("MemTotal:"):
                return int(linha.split()[1]) // 1024
    except (OSError, ValueError, IndexError):
        pass
    return None


def ips_do_servidor(familia):
    rc, linhas = linhas_de(["ip", "-o", f"-{familia}", "addr", "show", "scope", "global"])
    ips = []
    for linha in linhas:
        m = re.search(r"\binet6?\s+([0-9a-fA-F:.]+)/", linha)
        if not m:
            continue
        try:
            ip = ipaddress.ip_address(m.group(1))
        except ValueError:
            continue
        if ip.is_global:
            ips.append(str(ip))
    return ips


def resolver(nome, familia):
    rc, linhas = linhas_de(["getent", "ahostsv4" if familia == 4 else "ahostsv6", nome])
    ips = []
    for linha in linhas:
        bruto = linha.split()[0]
        try:
            ip = ipaddress.ip_address(bruto)
        except ValueError:
            continue
        if familia == 6 and (ip.version != 6 or ip.ipv4_mapped is not None):
            continue
        if str(ip) not in ips:
            ips.append(str(ip))
    return ips


def faixas_da_cloudflare():
    arquivo = os.path.join(AQUI, "..", "compose", "caddy", "cloudflare-trusted-proxies.caddyfile")
    faixas = []
    try:
        for palavra in open(arquivo, encoding="utf-8").read().split():
            if "/" in palavra:
                try:
                    faixas.append(ipaddress.ip_network(palavra, strict=False))
                except ValueError:
                    pass
    except OSError:
        pass
    return faixas


def na_cloudflare(ip, faixas):
    endereco = ipaddress.ip_address(ip)
    return any(endereco.version == f.version and endereco in f for f in faixas)


# ---- a conferencia do servidor --------------------------------------------------------------------------------------

def conferir_dns(nome, ips4, ips6, cloudflare):
    """[(situacao, codigo, texto)] do DNS de um nome: o registro A so com o IP deste servidor, sem AAAA de outro lugar."""
    a = resolver(nome, 4)
    aaaa = resolver(nome, 6)
    if not a:
        return ("falha", 26, f"{nome} ainda nao aponta para nenhum servidor (sem registro A). Crie o registro A com o IP "
                f"{ips4[0] if ips4 else 'deste servidor'}.")
    if cloudflare and any(na_cloudflare(ip, cloudflare) for ip in a):
        return ("falha", 28, f"O proxy da Cloudflare esta ligado em {nome} (ele responde com um IP da Cloudflare). Desligue e confira de novo.")
    if ips4:
        if len(a) > 1:
            return ("falha", 26, f"{nome} tem mais de um registro A ({', '.join(a)}): deixe so o deste servidor ({ips4[0]}).")
        if a[0] not in ips4:
            return ("falha", 26, f"{nome} aponta para {a[0]}, e este servidor e {', '.join(ips4)}. Corrija o registro A.")
    outros6 = [ip for ip in aaaa if ip not in ips6]
    if outros6:
        return ("falha", 27, f"Existe um registro AAAA em {nome} apontando para outro servidor ({', '.join(outros6)}). Apague esse registro.")
    if not ips4:
        return ("aviso", 31, f"{nome} aponta para {a[0]}; nao achei o IPv4 publico deste servidor para comparar. Confira que e o IP dele no painel do provedor.")
    return ("ok", None, f"{nome} aponta para este servidor ({a[0]}).")


def conferir(argv):
    opcoes = {"--endereco": "", "--endereco-api": "", "--ip": ""}
    json_saida = dns_bloqueia = portas_nossas = sem_rede = False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in opcoes:
            opcoes[a] = argv[i + 1]
            i += 1
        elif a == "--json":
            json_saida = True
        elif a == "--dns-bloqueia":
            dns_bloqueia = True
        elif a == "--portas-nossas":
            portas_nossas = True
        elif a == "--sem-rede":
            sem_rede = True
        else:
            falhar(f"opcao desconhecida: {a}", 1)
        i += 1
    resultados = []

    def anotar(ident, situacao, codigo, texto):
        resultados.append({"id": ident, "situacao": situacao, "codigo": codigo, "texto": texto})

    sistema = ler_os_release()
    nome_sistema = sistema.get("PRETTY_NAME") or "sistema desconhecido"
    if (sistema.get("ID"), sistema.get("VERSION_ID")) in SISTEMAS:
        anotar("sistema", "ok", None, nome_sistema)
    else:
        anotar("sistema", "falha", 10, f"{nome_sistema}: o kit roda em Ubuntu 22.04 ou 24.04 e Debian 12 ou 13.")
    rc, linhas = linhas_de(["uname", "-m"])
    arquitetura = linhas[0] if linhas else "?"
    if arquitetura in ("x86_64", "amd64"):
        anotar("processador", "ok", None, f"processador {arquitetura}")
    else:
        anotar("processador", "falha", 10, f"processador {arquitetura}: o kit roda em x86-64.")
    rc, linhas = linhas_de(["systemd-detect-virt", "--container"])
    if rc == 127:
        anotar("virtualizacao", "nao_conferido", None, "nao consegui conferir a virtualizacao (sem systemd-detect-virt).")
    elif linhas and linhas[0] != "none":
        anotar("virtualizacao", "falha", 21, f"este servidor e um container ({linhas[0]}), nao uma maquina virtual: o Docker nao roda direito nele.")
    else:
        _, vm = linhas_de(["systemd-detect-virt", "--vm"])
        anotar("virtualizacao", "ok", None, f"maquina virtual ({vm[0] if vm else 'sem virtualizacao'})")
    rc, linhas = linhas_de(["nproc"])
    try:
        cpus = int(linhas[0])
    except (IndexError, ValueError):
        cpus = None
    minimo_cpus = int(os.environ.get("KIT_MINIMO_CPUS", "2"))
    if cpus is None:
        anotar("vcpu", "nao_conferido", None, "nao consegui contar os processadores.")
    elif cpus < minimo_cpus:
        anotar("vcpu", "falha", 22, f"{cpus} vCPU; o minimo e {minimo_cpus}.")
    else:
        anotar("vcpu", "ok", None, f"{cpus} vCPU")
    memoria = memoria_total_mb()
    minimo_mb = int(os.environ.get("KIT_MINIMO_MEMORIA_MB", "3500"))
    if memoria is None:
        anotar("memoria", "nao_conferido", None, "nao consegui ler a memoria.")
    elif memoria < minimo_mb:
        anotar("memoria", "falha", 23, f"{memoria / 1024:.1f} GB de memoria; o minimo e 4 GB (8 GB recomendados).".replace(".", ",", 1))
    else:
        nota = " (8 GB recomendados)" if memoria < 7000 else ""
        anotar("memoria", "ok", None, f"{memoria / 1024:.1f} GB de memoria{nota}".replace(".", ",", 1))
    rc, linhas = linhas_de(["df", "-Pk", "/"])
    try:
        campos = linhas[-1].split()
        total_gb, livre_gb = int(campos[1]) / 1048576, int(campos[3]) / 1048576
    except (IndexError, ValueError):
        total_gb = livre_gb = None
    minimo_gb = int(os.environ.get("KIT_MINIMO_DISCO_GB", "37"))
    minimo_livre = int(os.environ.get("KIT_MINIMO_DISCO_LIVRE_GB", "10"))
    if total_gb is None:
        anotar("disco", "nao_conferido", None, "nao consegui ler o disco.")
    elif total_gb < minimo_gb:
        anotar("disco", "falha", 24, f"disco de {total_gb:.0f} GB; o minimo e 40 GB.")
    elif livre_gb < minimo_livre:
        anotar("disco", "falha", 24, f"{livre_gb:.0f} GB livres no disco; o kit precisa de {minimo_livre} GB livres.")
    else:
        anotar("disco", "ok", None, f"disco de {total_gb:.0f} GB, {livre_gb:.0f} GB livres")
    rc, linhas = linhas_de(["ss", "-Hltn"])
    if rc == 127:
        anotar("portas", "nao_conferido", None, "nao consegui ver as portas (sem o comando ss).")
    else:
        # ss -Hltn: "LISTEN 0 4096 0.0.0.0:80 0.0.0.0:*"; a quarta coluna e o endereco local, com a porta no fim.
        ocupadas = []
        for linha in linhas:
            campos = linha.split()
            porta = campos[3].rsplit(":", 1)[-1] if len(campos) > 3 else ""
            if porta in ("80", "443") and porta not in ocupadas:
                ocupadas.append(porta)
        if ocupadas and not portas_nossas:
            anotar("portas", "falha", 25, f"a porta {' e a '.join(ocupadas)} ja esta em uso por outro programa neste servidor.")
        elif ocupadas:
            anotar("portas", "ok", None, "80 e 443 com a escola")
        else:
            anotar("portas", "ok", None, "80 e 443 livres (de fora, o certificado confere na instalacao)")
    ips4 = [opcoes["--ip"]] if opcoes["--ip"] else ips_do_servidor(4)
    ips6 = ips_do_servidor(6)
    if ips4:
        anotar("ipv4", "ok", None, f"IPv4 publico {', '.join(ips4)}")
    else:
        anotar("ipv4", "aviso", 31, "nao achei um IPv4 publico nas interfaces deste servidor (atras de NAT?). Informe em IP_DO_SERVIDOR se ele tem.")
    cloudflare = faixas_da_cloudflare()
    for chave, campo in (("--endereco", "dns"), ("--endereco-api", "dns_api")):
        nome = opcoes[chave]
        if not nome:
            continue
        situacao, codigo, texto = conferir_dns(nome, ips4, ips6, cloudflare)
        if situacao == "falha" and not dns_bloqueia:
            situacao = "aviso"
        anotar(campo, situacao, codigo, texto)
    if sem_rede:
        anotar("saida", "nao_conferido", None, "a saida para a internet nao foi conferida.")
    else:
        emissor = os.environ.get("KIT_EMISSOR_URL", "").rstrip("/")
        api_email = os.environ.get("KIT_EMAIL_API_URL", "https://api.resend.com").rstrip("/")
        rc_e, http_e, cab_e = curl_sonda(emissor + "/health") if emissor else (0, "200", "")
        rc_m, http_m, cab_m = curl_sonda(api_email + "/")
        alcancou_e = http_e != "000"
        alcancou_m = http_m != "000"
        if not alcancou_e and not alcancou_m:
            anotar("saida_https", "falha", 29, "este servidor nao sai para a internet por HTTPS (nem o Emissor de licencas nem o provedor de e-mail responderam).")
        else:
            if alcancou_e:
                anotar("emissor", "ok", None, "o Emissor de licencas responde")
            else:
                anotar("emissor", "aviso", 54, "o Emissor de licencas nao respondeu agora (a ativacao, no fim, precisa dele). Se o resto sai, pode ser do nosso lado: tente de novo mais tarde.")
            if alcancou_m:
                anotar("email_api", "ok", None, "o provedor de e-mail responde (HTTPS)")
            else:
                anotar("email_api", "falha", 30, "a API do provedor de e-mail nao respondeu (HTTPS).")
        host_smtp = os.environ.get("KIT_EMAIL_SMTP_HOST", "smtp.resend.com")
        abertas = []
        for porta in os.environ.get("KIT_EMAIL_SMTP_PORTAS", "587 2587 465").split():
            esquema = "smtps" if porta in ("465", "2465") else "smtp"
            rc, _, _ = rodar(["curl", "-sS", "--connect-timeout", "8", "--max-time", "12", "-o", "/dev/null",
                              *(["--ssl-reqd"] if esquema == "smtp" else []), f"{esquema}://{host_smtp}:{porta}"], tempo=20)
            if rc not in (6, 7, 28, 35, 124, 127):
                abertas.append(porta)
                break
        if abertas:
            anotar("email_smtp", "ok", None, f"o envio de e-mail sai pela porta {abertas[0]}")
        else:
            anotar("email_smtp", "falha", 30, f"nenhuma porta de envio de e-mail sai deste servidor ({', '.join(os.environ.get('KIT_EMAIL_SMTP_PORTAS', '587 2587 465').split())}).")
        data = None
        for cabecalhos in (cab_e, cab_m):
            m = re.search(r"^date:\s*(.+)$", cabecalhos or "", re.I | re.M)
            if m:
                try:
                    data = email.utils.parsedate_to_datetime(m.group(1).strip())
                    break
                except (TypeError, ValueError):
                    data = None
        if data is not None:
            diferenca = abs((datetime.datetime.now(datetime.timezone.utc) - data).total_seconds())
            if diferenca > 300:
                anotar("relogio", "falha", 38, f"o relogio deste servidor esta {int(diferenca // 60)} minutos fora da hora certa.")
            else:
                anotar("relogio", "ok", None, "relogio certo")

    falhas = [r for r in resultados if r["situacao"] == "falha"]
    codigo = falhas[0]["codigo"] if falhas else 0
    if json_saida:
        print(json.dumps({"resultado": "falhou" if falhas else "ok", "codigo": codigo, "itens": resultados}, ensure_ascii=False, indent=2))
    else:
        marca = {"ok": "ok   ", "aviso": "AVISO", "falha": "FALHA", "nao_conferido": "  -  "}
        for r in resultados:
            extra = f" (codigo {r['codigo']})" if r["codigo"] and r["situacao"] != "ok" else ""
            print(f"  {marca[r['situacao']]} {r['texto']}{extra}")
        if falhas:
            print()
            sys.stdout.flush()
            for r in falhas:
                print(mensagem_do_codigo(r["codigo"], r["texto"]), file=sys.stderr)
    sys.exit(codigo)


def dns(argv):
    opcoes = {"--endereco": "", "--endereco-api": "", "--ip": ""}
    i = 0
    while i < len(argv):
        opcoes[argv[i]] = argv[i + 1]
        i += 2
    ips4 = [opcoes["--ip"]] if opcoes["--ip"] else ips_do_servidor(4)
    ips6 = ips_do_servidor(6)
    cloudflare = faixas_da_cloudflare()
    pior = 0
    for nome in (opcoes["--endereco"], opcoes["--endereco-api"]):
        sys.stdout.flush()
        if not nome:
            continue
        situacao, codigo, texto = conferir_dns(nome, ips4, ips6, cloudflare)
        if situacao == "falha":
            print(f"  FALHA {texto}")
            pior = pior or codigo
        else:
            print(f"  {'ok   ' if situacao == 'ok' else 'AVISO'} {texto}")
    if pior:
        sys.stdout.flush()
        print(mensagem_do_codigo(pior, "o endereco ainda nao esta pronto (acima)."), file=sys.stderr)
    sys.exit(pior)


# ---- o agendador ----------------------------------------------------------------------------------------------------

def literal_sql(texto):
    return "'" + texto.replace("'", "''") + "'"


def sql_agendador(_argv):
    token = sys.stdin.read().strip()
    if not re.fullmatch(r"[A-Za-z0-9._~+/=-]{32,256}", token):
        falhar("o JOBS_TICK_TOKEN do arquivo de segredos esta vazio ou fora do formato.", 43)
    url = "http://app:3000/api/jobs/tick"
    partes = []
    for nome, valor, descricao in (("jobs_tick_url", url, "URL do tick"), ("jobs_tick_token", token, "Token do tick")):
        partes.append(f"""do $$
declare
  existente uuid;
  atual text;
begin
  select id into existente from vault.secrets where name = {literal_sql(nome)};
  if existente is null then
    perform vault.create_secret({literal_sql(valor)}, {literal_sql(nome)}, {literal_sql(descricao)});
  else
    select decrypted_secret into atual from vault.decrypted_secrets where id = existente;
    if atual is distinct from {literal_sql(valor)} then
      perform vault.update_secret(existente, {literal_sql(valor)});
    end if;
  end if;
end;
$$;""")
    sys.stdout.write("\n".join(partes) + "\n")


# ---- e-mail (Resend) ------------------------------------------------------------------------------------------------

def segredo_do_env(caminho, chave):
    for linha in open(caminho, encoding="utf-8").read().splitlines():
        if linha.startswith(chave + "="):
            valor = linha.split("=", 1)[1].strip()
            if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in "\"'":
                valor = valor[1:-1]
            return valor
    return ""


def mostrar_registros(dominio, detalhe):
    registros = (detalhe or {}).get("records") or []
    if not registros:
        return
    sys.stderr.write(f"\n    Crie estes registros no painel de DNS do dominio de {dominio} (o mesmo painel do endereco da escola):\n")
    primeiro, _, resto = dominio.partition(".")
    for r in registros:
        nome = str(r.get("name", ""))
        # O provedor pode dar o nome relativo ao dominio de envio ("send") ou a zona de cima ("send.mail"): o nome
        # completo e o mesmo nos dois casos.
        if not nome or nome.endswith(dominio):
            completo = nome or dominio
        elif resto and (nome == primeiro or nome.endswith("." + primeiro)):
            completo = f"{nome}.{resto}"
        else:
            completo = f"{nome}.{dominio}"
        prioridade = f"   Prioridade: {r.get('priority')}" if r.get("priority") not in (None, "") else ""
        sys.stderr.write(f"      Tipo: {r.get('type', '?'):<5} Nome: {completo}\n        Valor: {r.get('value', '')}{prioridade}\n")
    sys.stderr.write("    (No campo Nome, alguns paineis pedem so a parte antes do dominio.)\n\n")


def email_dominio(argv):
    env_arquivo = argv[0]
    opcoes = {"--dominio": "", "--espera": "900", "--intervalo": "20"}
    interativo = False
    i = 1
    while i < len(argv):
        if argv[i] == "--interativo":
            interativo = True
        else:
            opcoes[argv[i]] = argv[i + 1]
            i += 1
        i += 1
    dominio = opcoes["--dominio"]
    chave = segredo_do_env(env_arquivo, "RESEND_API_KEY")
    api = os.environ.get("KIT_EMAIL_API_URL", "https://api.resend.com").rstrip("/")
    if not chave:
        falhar("falta RESEND_API_KEY no arquivo de segredos.", 45)
    rc, http, dados, erro = curl_json("GET", f"{api}/domains", chave)
    if http == 0:
        falhar(f"a API do provedor de e-mail nao respondeu ({erro or 'sem resposta'}).", 30)
    nome_erro = (dados or {}).get("name") if isinstance(dados, dict) else None
    if nome_erro == "restricted_api_key":
        print("restrita")
        aviso(f"a chave do Resend so envia e-mails: nao da para conferir o dominio {dominio} por ela. Confira no painel do Resend (Domains) que ele esta verificado; o e-mail de teste confere em seguida.")
        return
    if http in (400, 401, 403):
        falhar(f"o provedor de e-mail recusou a chave ({http}: {(dados or {}).get('message', 'sem detalhe') if isinstance(dados, dict) else 'sem detalhe'}).", 45)
    if http != 200 or not isinstance(dados, dict):
        falhar(f"a API do provedor de e-mail respondeu {http} ao listar os dominios.", 45)
    lista = dados.get("data") or []
    achado = next((d for d in lista if isinstance(d, dict) and str(d.get("name", "")).lower() == dominio), None)
    if achado is None:
        sys.stderr.write(f"==> Criando o dominio de envio {dominio} no Resend...\n")
        rc, http, achado, erro = curl_json("POST", f"{api}/domains", chave, {"name": dominio})
        if http not in (200, 201) or not isinstance(achado, dict) or not achado.get("id"):
            mensagem = (achado or {}).get("message") if isinstance(achado, dict) else erro
            falhar(f"o Resend nao criou o dominio {dominio} ({http}: {mensagem or 'sem detalhe'}).", 46)
    ident = str(achado.get("id"))
    if not re.fullmatch(r"[A-Za-z0-9-]{8,64}", ident):
        falhar("o Resend devolveu um dominio sem identificador valido.", 46)
    espera = int(opcoes["--espera"])
    intervalo = max(0, int(opcoes["--intervalo"]))
    # Conta tentativas, nao o relogio: a espera e a mesma com o sleep de verdade e com o dos testes.
    tentativas = max(1, espera // intervalo if intervalo else espera)
    situacao = None
    for tentativa in range(tentativas + 1):
        rc, http, detalhe, erro = curl_json("GET", f"{api}/domains/{ident}", chave)
        situacao = (detalhe or {}).get("status") if isinstance(detalhe, dict) else None
        if situacao == "verified":
            print("verificado")
            return
        if tentativa == 0:
            mostrar_registros(dominio, detalhe)
        if tentativa == tentativas:
            break
        # Pede ao provedor para conferir de novo: na primeira vez e depois a cada uns 2 minutos.
        if tentativa == 0 or (intervalo and (tentativa * intervalo) % 120 < intervalo):
            curl_json("POST", f"{api}/domains/{ident}/verify", chave)
        if interativo:
            sys.stderr.write(f"    Esperando o Resend verificar {dominio} ({tentativa * intervalo // 60} de {espera // 60} min). "
                             "Pode parar com Ctrl+C e rodar o instalador de novo depois.\n")
        time.sleep(intervalo)
    falhar(f"o Resend ainda nao verificou o dominio {dominio} (situacao: {situacao or 'desconhecida'}).", 46)


def email_teste(argv):
    env_arquivo = argv[0]
    opcoes = {"--para": "", "--remetente": "", "--nome": "", "--endereco": "", "--portas": "587 2587 465"}
    i = 1
    while i < len(argv):
        opcoes[argv[i]] = argv[i + 1]
        i += 2
    chave = segredo_do_env(env_arquivo, "RESEND_API_KEY")
    host = os.environ.get("KIT_EMAIL_SMTP_HOST", "smtp.resend.com")
    msg = email.message.EmailMessage()
    msg["From"] = email.utils.formataddr((opcoes["--nome"], opcoes["--remetente"]))
    msg["To"] = opcoes["--para"]
    msg["Subject"] = "Teste do e-mail da escola"
    msg["Date"] = email.utils.formatdate(localtime=False)
    msg["Message-ID"] = email.utils.make_msgid(domain=opcoes["--remetente"].partition("@")[2] or None)
    msg.set_content(
        f"Este e o e-mail de teste da instalacao da escola em https://{opcoes['--endereco']}.\n\n"
        "Se ele chegou, a escola consegue mandar convites, o \"esqueci a senha\" e os avisos aos alunos.\n"
    )
    ultimo_erro = ""
    with tempfile.TemporaryDirectory(prefix="kit-email-") as pasta:
        arquivo = os.path.join(pasta, "mensagem.eml")
        with open(arquivo, "wb") as f:
            f.write(bytes(msg))
        for porta in opcoes["--portas"].split():
            esquema = "smtps" if porta in ("465", "2465") else "smtp"
            config = f'user = "resend:{chave}"\n'
            rc, _, erro = rodar(["curl", "-sS", "-K", "-", "--connect-timeout", "10", "--max-time", "60",
                                 *(["--ssl-reqd"] if esquema == "smtp" else []), "--url", f"{esquema}://{host}:{porta}",
                                 "--mail-from", opcoes["--remetente"], "--mail-rcpt", opcoes["--para"], "--upload-file", arquivo],
                                entrada=config, tempo=75)
            if rc == 0:
                print(porta)
                return
            if rc in (6, 7, 28, 35, 124):
                ultimo_erro = f"a porta {porta} nao sai deste servidor"
                continue
            if rc == 67:
                falhar("o provedor de e-mail recusou a chave no envio (usuario resend e a chave do Resend).", 45)
            detalhe = re.sub(r"\s+", " ", erro).strip()[:300]
            falhar(f"o provedor de e-mail recusou o e-mail de teste pela porta {porta}: {detalhe or 'sem detalhe'}.", 47)
    falhar(f"o e-mail de teste nao saiu por nenhuma porta ({ultimo_erro}).", 30)


# ---- o plano (--simular) e o resumo ----------------------------------------------------------------------------------

def plano(argv):
    opcoes = dict(a.split("=", 1) for a in argv)
    estado = kit.situacao_ler(opcoes.get("estado", ""))
    passos = estado.get("passos") or {}
    modo = opcoes.get("modo", "instalacao")
    pulados = {"restauracao": {"conta_do_dono", "email", "agendador", "migracoes", "conferencia_final", "ativacao"}}.get(modo, set())
    print(f"\nPlano do Bunker Members ({'modo de restauracao: instala sem Chave de ativacao, pronto para membros restaurar' if modo == 'restauracao' else 'instalacao'}):")
    print(f"  Escola: https://{opcoes.get('endereco') or '(falta o endereco)'}   API: https://{opcoes.get('endereco_api') or '?'}")
    print(f"  Pacote: versao {opcoes.get('versao') or '?'} ({opcoes.get('pacote') or '?'}), assinatura: {opcoes.get('assinado') or '?'}")
    if opcoes.get("faltando"):
        print(f"  Falta responder: {opcoes['faltando']}")
    for n, passo in enumerate(PASSOS, 1):
        feito = (passos.get(passo) or {}).get("situacao")
        if passo in pulados:
            marca = "pula neste modo"
        elif feito == "ok":
            marca = "feito"
        elif feito == "falhou":
            marca = f"parou aqui da ultima vez (codigo {(passos.get(passo) or {}).get('codigo')})"
        else:
            marca = "falta"
        print(f"  {n:2}. {NOMES_DOS_PASSOS[passo]:<58} {marca}")
    print("\nNada foi mudado (--simular).")


def resumo(argv):
    opcoes = dict(a.split("=", 1) for a in argv)
    situacao = kit.situacao_ler(opcoes.get("situacao", ""))
    if opcoes.get("modo") == "restauracao":
        print("\n==> Este servidor esta pronto para receber o backup da escola.")
        print("    Agora, no terminal, com a folha de recuperacao em maos:  sudo membros restaurar")
        print(f"    Depois aponte {opcoes.get('endereco')} (e {opcoes.get('endereco_api')}) para este servidor, se ainda nao apontou.")
        print("    O backup diario fica parado ate a restauracao terminar.")
        return
    print(f"\n==> A escola esta instalada (Bunker Members, versao {opcoes.get('versao') or '?'}).")
    print(f"    Endereco da escola:  https://{opcoes.get('endereco')}")
    print(f"    Admin:               https://{opcoes.get('endereco')}/admin")
    link = sys.stdin.read().strip() if opcoes.get("link") == "entrada" else ""
    if link:
        print("\n    Entrar como dono (link de uso unico; vale por 1 hora e nao aparece de novo):")
        print(f"      {link}")
        print("    No link, a escola pede para criar a senha do dono. Perdeu o prazo? sudo membros link-do-dono")
    else:
        print("    Para entrar como dono, rode no terminal do servidor: sudo membros link-do-dono")
    r = situacao.get("recuperacao") or {}
    print()
    if opcoes.get("backup_local") == "sim":
        print("    Backup: todo dia, so neste servidor (aceito por escrito). Se o servidor morrer, o backup morre junto:")
        print("    configure um destino fora dele assim que puder.")
    else:
        b = situacao.get("backup") or {}
        print(f"    Backup: todo dia as 03:30 (horario de Brasilia), cifrado, para {kit.TIPOS_DE_DESTINO.get(b.get('destino_tipo'), 'o destino escolhido')}"
              f"{' (' + b['destino_servidor'] + ')' if b.get('destino_servidor') else ''}.")
        if r.get("chave_id"):
            print(f"    Guarde fora do servidor a FOLHA DE RECUPERACAO (confirmada em {kit.data_brasilia(r.get('confirmada_em'))}):")
            print("    sem ela, o backup nao abre se o servidor morrer.")
    if opcoes.get("licenca"):
        print(f"    Licenca: {opcoes['licenca']}")
    if opcoes.get("email"):
        print(f"    E-mail: {opcoes['email']}")
    print("\n    Para acompanhar:  sudo membros status   e   sudo membros diagnostico")
    print("    Na area, a lista Para a escola funcionar mostra o que falta: a marca, a venda (Hotmart ou Ticto), o video")
    print("    e o primeiro curso.")


def estado_mostrar(argv):
    estado = kit.situacao_ler(argv[0])
    if "--json" in argv[1:]:
        print(json.dumps(estado, ensure_ascii=False, indent=2, sort_keys=True))
        return
    passos = estado.get("passos") or {}
    if not passos:
        print("  O instalador ainda nao rodou neste servidor.")
        return
    for passo in PASSOS:
        p = passos.get(passo)
        if not p:
            continue
        extra = f" (codigo {p['codigo']}: {p.get('motivo', '')})" if p.get("codigo") else ""
        print(f"  {NOMES_DOS_PASSOS[passo]:<58} {p['situacao']}{extra}")


# ---- diagnostico ----------------------------------------------------------------------------------------------------

def diagnostico(argv):
    opcoes = dict(a.split("=", 1) for a in argv if "=" in a)
    como_json = "--json" in argv

    def ler_json(caminho):
        try:
            with open(caminho, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError, TypeError):
            return None

    instalacao = kit.situacao_ler(opcoes.get("instalacao", ""))
    situacao = kit.situacao_ler(opcoes.get("situacao", ""))
    conferencia = ler_json(opcoes.get("conferencia", "")) or {}
    licenca = ler_json(opcoes.get("licenca", ""))
    containers = []
    try:
        for linha in open(opcoes.get("containers", ""), encoding="utf-8").read().splitlines():
            linha = linha.strip()
            if not linha:
                continue
            try:
                item = json.loads(linha)
            except ValueError:
                continue
            for c in item if isinstance(item, list) else [item]:
                containers.append({"servico": c.get("Service", ""), "estado": c.get("State", ""), "saude": c.get("Health", "")})
    except OSError:
        pass
    disco = []
    try:
        for linha in open(opcoes.get("disco", ""), encoding="utf-8").read().splitlines()[1:]:
            campos = linha.split()
            if len(campos) >= 6:
                disco.append({"montado_em": campos[5], "total_kb": int(campos[1]), "livre_kb": int(campos[3]), "uso": campos[4]})
    except (OSError, ValueError):
        pass
    b = situacao.get("backup") or {}
    idade_h = None
    d = kit.ler_data(b.get("ultimo_sucesso"))
    if d:
        idade_h = int((kit.agora() - d).total_seconds() // 3600)
    atencao = []
    for c in containers:
        if c["estado"] != "running" or c["saude"] not in ("", "healthy"):
            atencao.append(f"o servico {c['servico']} esta {c['estado']}{' (' + c['saude'] + ')' if c['saude'] else ''}")
    if opcoes.get("containers_erro"):
        atencao.append(opcoes["containers_erro"])
    for item in conferencia.get("itens", []):
        if item.get("situacao") in ("falha", "aviso"):
            atencao.append(item.get("texto", ""))
    if idade_h is None:
        atencao.append("nenhum backup feito ainda")
    elif idade_h > 36:
        atencao.append(f"o ultimo backup bom tem {idade_h} horas")
    if not (situacao.get("recuperacao") or {}).get("chave_id") and not instalacao.get("backup_so_neste_servidor"):
        atencao.append("sem kit de recuperacao confirmado")
    for dk in disco:
        if dk["total_kb"] and dk["livre_kb"] / dk["total_kb"] < 0.1:
            atencao.append(f"o disco em {dk['montado_em']} esta com menos de 10% livre")
    if licenca is None:
        atencao.append("nao consegui ler a situacao da Licenca (o app esta no ar? rode com sudo)")
    elif licenca.get("modo") == "enforce" and not licenca.get("ativada"):
        atencao.append("a Licenca ainda nao foi ativada")
    elif licenca.get("modo") == "enforce" and licenca.get("degrau") not in ("ok", None):
        atencao.append(f"a Licenca esta no degrau {licenca.get('degrau')}")
    falhou = [p for p, v in (instalacao.get("passos") or {}).items() if (v or {}).get("situacao") == "falhou"]
    if falhou:
        atencao.append(f"a instalacao parou no passo {NOMES_DOS_PASSOS.get(falhou[0], falhou[0])}: rode sudo membros instalar")
    relatorio = {
        "versao": instalacao.get("versao"),
        "endereco": instalacao.get("endereco"),
        "endereco_api": instalacao.get("endereco_api"),
        "instalacao": {"modo": instalacao.get("modo"), "terminou_em": instalacao.get("terminou_em"), "passos": instalacao.get("passos") or {}},
        "servidor": conferencia.get("itens", []),
        "servicos": containers,
        "backup": {"ultimo_sucesso": b.get("ultimo_sucesso"), "idade_horas": idade_h, "destino_tipo": b.get("destino_tipo"),
                   "ultimo_resultado": b.get("ultimo_resultado"),
                   "kit_de_recuperacao": "confirmado" if (situacao.get("recuperacao") or {}).get("chave_id") else "nao",
                   "ultimo_ensaio": (situacao.get("ensaio") or {}).get("ultimo")},
        "licenca": licenca,
        "disco": disco,
        "atencao": atencao,
    }
    if como_json:
        print(json.dumps(relatorio, ensure_ascii=False, indent=2))
        return
    print(f"Escola: https://{relatorio['endereco'] or '?'} (versao {relatorio['versao'] or '?'})")
    print("Servicos")
    for c in containers or [{"servico": "(nenhum lido)", "estado": "", "saude": ""}]:
        print(f"  {c['servico']:<10} {c['estado']}{' ' + c['saude'] if c['saude'] else ''}")
    print("Servidor")
    for item in conferencia.get("itens", []):
        print(f"  {item.get('situacao', ''):<13} {item.get('texto', '')}")
    print("Backup")
    if b.get("ultimo_sucesso"):
        print(f"  ultimo backup bom: {kit.data_brasilia(b['ultimo_sucesso'])} ({kit.ha_quanto(b['ultimo_sucesso'])})")
    else:
        print("  nenhum backup feito ainda")
    print("Licenca")
    if licenca is None:
        print("  nao foi possivel ler")
    elif licenca.get("modo") == "off":
        print("  esta imagem nao pede licenca (modo off)")
    else:
        print(f"  {'ativada' if licenca.get('ativada') else 'nao ativada'}; degrau {licenca.get('degrau')}")
    print("Disco")
    for dk in disco:
        print(f"  {dk['montado_em']}: {dk['livre_kb'] // 1048576} GB livres de {dk['total_kb'] // 1048576} GB ({dk['uso']} usado)")
    if atencao:
        print("\nAtencao:")
        for a in atencao:
            print(f"  - {a}")


def json_campo(argv):
    """Um campo do JSON da entrada (caminho com pontos); vazio quando nao ha. Booleanos saem true/false."""
    try:
        dados = json.loads(sys.stdin.read() or "null")
    except ValueError:
        return
    valor = kit.situacao_valor(dados if isinstance(dados, dict) else {}, argv[0])
    if valor is None:
        return
    if isinstance(valor, bool):
        print("true" if valor else "false")
    elif isinstance(valor, (dict, list)):
        print(json.dumps(valor, ensure_ascii=False))
    else:
        print(valor)


def json_da_chave(_argv):
    """A Chave de ativacao (da entrada) conferida, num JSON para o app: {"chave": "..."}. Nunca na tela."""
    chave = limpar_chave_de_ativacao(sys.stdin.read())
    problema = problema_da_chave_de_ativacao(chave)
    if problema:
        falhar(problema, 52)
    sys.stdout.write(json.dumps({"chave": chave}))


def codigos(argv):
    if "--json" in argv:
        print(json.dumps({str(k): {"nome": v[0], "de_quem": v[1], "o_que_fazer": v[2]} for k, v in sorted(CODIGOS.items())}, ensure_ascii=False, indent=2))
        return
    for k, (nome, quem, fazer) in sorted(CODIGOS.items()):
        print(f"{k:3}  {nome:<28} {quem:<10} {fazer}")


def main():
    if len(sys.argv) < 2:
        falhar("uso: instalador.py <ferramenta> ... (veja o comeco do arquivo)", 1)
    ferramenta, argv = sys.argv[1], sys.argv[2:]
    if ferramenta == "codigo":
        sys.stderr.write(mensagem_do_codigo(int(argv[0]), argv[1] if len(argv) > 1 else "") + "\n")
    elif ferramenta == "codigos":
        codigos(argv)
    elif ferramenta == "normalizar-host":
        print(normalizar_host(argv[0] if argv else ""))
    elif ferramenta == "nome-do-passo":
        print(NOMES_DOS_PASSOS.get(argv[0], argv[0]))
    elif ferramenta == "json-campo":
        json_campo(argv)
    elif ferramenta == "json-da-chave":
        json_da_chave(argv)
    elif ferramenta == "respostas":
        respostas(argv)
    elif ferramenta == "manifesto-conferir":
        manifesto_conferir(argv)
    elif ferramenta == "imagens-do-manifesto":
        imagens_do_manifesto(argv)
    elif ferramenta == "estado-iniciar":
        estado_iniciar(argv)
    elif ferramenta == "estado-passo":
        estado_passo(argv)
    elif ferramenta == "estado-marcar":
        estado_marcar(argv)
    elif ferramenta == "estado-ler":
        estado_ler(argv)
    elif ferramenta == "estado-mostrar":
        estado_mostrar(argv)
    elif ferramenta == "conferir":
        conferir(argv)
    elif ferramenta == "dns":
        dns(argv)
    elif ferramenta == "sql-agendador":
        sql_agendador(argv)
    elif ferramenta == "email-dominio":
        email_dominio(argv)
    elif ferramenta == "email-teste":
        email_teste(argv)
    elif ferramenta == "plano":
        plano(argv)
    elif ferramenta == "resumo":
        resumo(argv)
    elif ferramenta == "diagnostico":
        diagnostico(argv)
    else:
        falhar(f"ferramenta desconhecida: {ferramenta}", 1)


if __name__ == "__main__":
    main()

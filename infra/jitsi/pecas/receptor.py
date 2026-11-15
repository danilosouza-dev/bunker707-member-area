# O receptor das pecas da Live gravada em teste (docs/30 A62; docs/20 §8B.7). Roda no servidor C, ao lado do Jitsi
# (servico `pecas` do docker-compose.yml), atras do Caddy em https://meet.<dominio>/pecas/. Quem manda e o arquivo
# infra/jitsi/web/bunker707-pecas.js, que roda so dentro do gravador (o Jibri): a camera com o audio e a tela de quem
# apresenta, gravadas em pecas separadas do mesmo tamanho, mais a linha do tempo e as medidas do teste.
#
# Por que aqui e nao na maquina do gravador: a pagina do gravador e da internet (meet.<dominio>) e o Chrome dele (153)
# pede permissao para uma pagina da internet falar com a propria maquina (Local Network Access), e no gravador ninguem
# responderia. Pelo mesmo endereco da sala, nada e pedido.
#
#   GET  /pecas/ativo?sala=<sala>   204 quando o webinario da sala esta em ativas.txt (um id por linha); senao 404.
#   GET  /pecas/estado?sala=&estado=&detalhe=   o passo em que o gravador esta (na-sala, sem-senha, base, gravando,
#                                   parado, erro-envio, erro), anotado no log so para as salas da lista; sempre 204.
#   POST /pecas/<sala>/<arquivo>    um pedaco, na ordem: X-Pecas-Seq (0, 1, 2...), X-Pecas-Ts (ms) e X-Pecas-Assinatura,
#                                   o HMAC-SHA256 de "<sala>\n<arquivo>\n<seq>\n<ts>\n<sha256 do corpo>" com a senha do
#                                   usuario do gravador (JIBRI_RECORDER_PASSWORD: so o Jibri a tem, pelo localStorage que
#                                   ele mesmo preenche). 204 gravado; 200 repetido (seq ja gravado); 409 fora de ordem;
#                                   401 assinatura; 403 sala fora da lista; 413 grande demais; 507 sem espaco. O
#                                   corpo pode vir sem Content-Length, em pedacos (Transfer-Encoding: chunked), como o
#                                   Caddy repassa o que chega sem tamanho (HTTP/2 e HTTP/3). Cada recusa vai ao log.
#
# Nada de segredo no log. Os arquivos ficam em /dados/<sala>/ ate a equipe apagar (docs/20 §8B.7). So a biblioteca
# padrao do Python.
import hashlib
import hmac
import json
import os
import re
import shutil
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DADOS = os.environ.get("PECAS_DIR", "/dados")
SEGREDO = os.environ.get("PECAS_SEGREDO", "").encode()
PORTA = int(os.environ.get("PECAS_PORTA", "8099"))
MAX_PEDACO = int(os.environ.get("PECAS_MAX_PEDACO_MB", "16")) * 1024 * 1024
MAX_SALA = int(os.environ.get("PECAS_MAX_SALA_GB", "8")) * 1024 * 1024 * 1024
MIN_LIVRE = int(os.environ.get("PECAS_MIN_LIVRE_GB", "4")) * 1024 * 1024 * 1024
JANELA_MS = 10 * 60 * 1000

SALA = re.compile(r"^w-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[a-z0-9]{4,40}$")
ARQUIVOS = {"camera.webm", "tela.webm", "linha-do-tempo.jsonl", "metricas.jsonl"}
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

trava = threading.Lock()
proximo = {}  # (sala, arquivo) -> o seq esperado
anotados = {}  # sala ou (sala, arquivo) -> quantas linhas ja foram ao log (o teto evita encher o disco)
trava_log = threading.Lock()  # a propria: as recusas de dentro da trava das pecas tambem vao ao log
TETO_LOG = 200
TEXTO_LIVRE = re.compile(r"[^0-9A-Za-z .,:;_/()+-]")


def log(texto):
    sys.stdout.write(time.strftime("%Y-%m-%dT%H:%M:%SZ ", time.gmtime()) + "pecas: " + texto + "\n")
    sys.stdout.flush()


def ativos():
    """Os webinarios ligados para o teste: ativas.txt em /dados, um id por linha (# comenta)."""
    try:
        with open(os.path.join(DADOS, "ativas.txt"), encoding="utf-8") as f:
            linhas = [linha.split("#", 1)[0].strip().lower() for linha in f]
    except OSError:
        return set()
    return {linha for linha in linhas if UUID.match(linha)}


def sala_ativa(sala):
    m = SALA.match(sala or "")
    return bool(m) and m.group(1) in ativos()


def esperado(sala, arquivo):
    chave = (sala, arquivo)
    if chave not in proximo:
        try:
            with open(os.path.join(DADOS, sala, arquivo + ".seq"), encoding="utf-8") as f:
                proximo[chave] = int(f.read().strip() or "0")
        except (OSError, ValueError):
            proximo[chave] = 0
    return proximo[chave]


def anotar(chave, texto):
    """Uma linha de log, ate TETO_LOG por chave."""
    with trava_log:
        n = anotados.get(chave, 0)
        anotados[chave] = n + 1
    if n < TETO_LOG:
        log(texto)
    elif n == TETO_LOG:
        log(f"{chave}: mais linhas omitidas")


def limpo(texto, limite=120):
    return TEXTO_LIVRE.sub("?", str(texto or ""))[:limite]


def tamanho_sala(pasta):
    total = 0
    for nome in os.listdir(pasta):
        try:
            total += os.path.getsize(os.path.join(pasta, nome))
        except OSError:
            pass
    return total


class Receptor(BaseHTTPRequestHandler):
    server_version = "pecas"
    sys_version = ""

    def log_message(self, *args):  # o log padrao imprimiria cabecalhos
        return

    def responder(self, status, corpo=None):
        dados = json.dumps(corpo).encode() if corpo is not None else b""
        self.send_response(status)
        self.send_header("Cache-Control", "no-store")
        if dados:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        if dados:
            self.wfile.write(dados)

    def do_GET(self):
        url = urlparse(self.path)
        consulta = parse_qs(url.query)
        sala = (consulta.get("sala") or [""])[0].lower()
        if url.path == "/pecas/ativo":
            return self.responder(204 if sala_ativa(sala) else 404)
        if url.path == "/pecas/estado":
            if sala_ativa(sala):
                estado = limpo((consulta.get("estado") or [""])[0], 20)
                detalhe = limpo((consulta.get("detalhe") or [""])[0])
                anotar(sala, f"{sala}: estado {estado}" + (f" ({detalhe})" if detalhe else ""))
            return self.responder(204)
        return self.responder(404)

    def ler_corpo(self):
        """O corpo do pedido: pelo Content-Length ou em pedacos (chunked). None se passa do teto; ValueError se mal formado."""
        if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():
            partes, total = [], 0
            while True:
                linha = self.rfile.readline(1024)
                if not linha:
                    raise ValueError("corpo cortado")
                n = int(linha.split(b";", 1)[0].strip(), 16)
                if n == 0:
                    while self.rfile.readline(1024) not in (b"\r\n", b"\n", b""):
                        pass
                    return b"".join(partes)
                total += n
                if total > MAX_PEDACO:
                    return None
                partes.append(self.rfile.read(n))
                self.rfile.readline(1024)
        tamanho = int(self.headers.get("Content-Length", "-1"))
        if tamanho < 0:
            raise ValueError("sem tamanho")
        if tamanho > MAX_PEDACO:
            return None
        return self.rfile.read(tamanho)

    def recusar(self, sala, arquivo, status, motivo, corpo=None):
        anotar((sala, arquivo), f"{sala}/{arquivo}: recusado {status} ({motivo})")
        return self.responder(status, corpo)

    def do_POST(self):
        partes = urlparse(self.path).path.split("/")
        if len(partes) != 4 or partes[1] != "pecas":
            return self.responder(404)
        sala, arquivo = partes[2].lower(), partes[3]
        if arquivo not in ARQUIVOS or not SALA.match(sala):
            return self.responder(404)
        try:
            seq = int(self.headers.get("X-Pecas-Seq", "-1"))
            ts = int(self.headers.get("X-Pecas-Ts", "0"))
        except ValueError:
            return self.recusar(sala, arquivo, 400, "cabecalho")
        if seq < 0:
            return self.recusar(sala, arquivo, 400, "sem seq")
        try:
            corpo = self.ler_corpo()
        except ValueError as erro:
            return self.recusar(sala, arquivo, 400, f"corpo: {erro}")
        if corpo is None:
            return self.recusar(sala, arquivo, 413, "grande demais")
        if not SEGREDO:
            log("PECAS_SEGREDO vazio: nada e aceito")
            return self.responder(503)
        if abs(int(time.time() * 1000) - ts) > JANELA_MS:
            return self.recusar(sala, arquivo, 401, "relogio", {"erro": "relogio"})
        texto = f"{sala}\n{arquivo}\n{seq}\n{ts}\n{hashlib.sha256(corpo).hexdigest()}".encode()
        certo = hmac.new(SEGREDO, texto, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(certo, (self.headers.get("X-Pecas-Assinatura") or "").lower()):
            return self.recusar(sala, arquivo, 401, "assinatura", {"erro": "assinatura"})
        if not sala_ativa(sala):
            return self.recusar(sala, arquivo, 403, "sala fora da lista")
        pasta = os.path.join(DADOS, sala)
        with trava:
            os.makedirs(pasta, exist_ok=True)
            quer = esperado(sala, arquivo)
            if seq < quer:
                return self.responder(200, {"repetido": True})
            if seq > quer:
                anotar((sala, arquivo), f"{sala}/{arquivo}: recusado 409 (pedaco {seq}, esperado {quer})")
                return self.responder(409, {"esperado": quer})
            if shutil.disk_usage(DADOS).free - len(corpo) < MIN_LIVRE or tamanho_sala(pasta) + len(corpo) > MAX_SALA:
                anotar((sala, arquivo), f"{sala}/{arquivo}: sem espaco; pedaco {seq} recusado")
                return self.responder(507)
            with open(os.path.join(pasta, arquivo), "ab") as f:
                f.write(corpo)
            proximo[(sala, arquivo)] = seq + 1
            with open(os.path.join(pasta, arquivo + ".seq"), "w", encoding="utf-8") as f:
                f.write(str(seq + 1))
        if seq == 0:
            log(f"{sala}/{arquivo}: primeiro pedaco")
        return self.responder(204)


def main():
    os.makedirs(DADOS, exist_ok=True)
    if not SEGREDO:
        log("aviso: PECAS_SEGREDO vazio (a senha do usuario do gravador); nenhum pedaco sera aceito")
    servidor = ThreadingHTTPServer(("0.0.0.0", PORTA), Receptor)
    servidor.daemon_threads = True
    log(f"escutando na porta {PORTA}, pasta {DADOS}")
    servidor.serve_forever()


if __name__ == "__main__":
    main()

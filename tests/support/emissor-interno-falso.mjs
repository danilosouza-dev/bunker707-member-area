import { createServer } from "node:http";

// A API interna do Emissor, falsa e local, por HTTP de verdade (o contrato de fio em docs/api-interna.md do
// bunker-licensing): as rotas de /interno/v1, a credencial no Authorization: Bearer, o X-Pedido obrigatorio (e devolvido
// no cabecalho da resposta), JSON com Content-Type e os erros { erro, mensagem } com o status de cada um. O que cada rota
// faz vem do simulador do produto (src/server/licensing/interno/simulator.ts), o mesmo que a `dev` usa.
//
// O teste controla: `falso.proximas` (respostas forcadas para os proximos pedidos: status, corpo, cabecalhos, texto cru,
// atraso ou nunca responder, de qualquer rota ou so da rota em `caminho`) e le `falso.pedidos` (metodo, caminho, X-Pedido,
// se a credencial veio certa e o corpo).

export const CREDENCIAL_DE_TESTE = "bki_credencial-de-teste-0123456789abcdefghijklmnop";

const STATUS = {
  cliente_desconhecido: 404,
  credencial_invalida: 401,
  licenca_ambigua: 422,
  licenca_indisponivel: 403,
  licenca_nao_encontrada: 404,
  limite_de_pedidos: 429,
  nao_encontrado: 404,
  pedido_invalido: 400,
  produto_desconhecido: 422,
  quantidade_invalida: 422,
  sem_licenca_para_aplicar: 422,
  titular_pendente: 409,
  troca_nao_confirmada: 409,
  validade_acima_do_limite: 422,
  venda_de_outro_cliente: 409
};

function lerCorpo(pedido) {
  return new Promise((resolve) => {
    const partes = [];
    pedido.on("data", (parte) => partes.push(parte));
    pedido.on("end", () => resolve(Buffer.concat(partes).toString("utf8")));
  });
}

/** Sobe a API interna falsa numa porta livre de 127.0.0.1. `simulador`: o do produto, ja montado pelo teste. */
export async function apiInternaFalsa({ simulador, credencial = CREDENCIAL_DE_TESTE }) {
  const falso = { endereco: "", pedidos: [], proximas: [], servidor: null };

  falso.servidor = createServer(async (pedido, resposta) => {
    const url = new URL(pedido.url, "http://127.0.0.1");
    const texto = await lerCorpo(pedido);
    const xPedido = pedido.headers["x-pedido"] ?? null;
    const credencialCerta = pedido.headers.authorization === `Bearer ${credencial}`;
    let corpo = null;

    try {
      corpo = texto ? JSON.parse(texto) : null;
    } catch {
      corpo = "(invalido)";
    }

    falso.pedidos.push({ caminho: url.pathname, corpo, credencialCerta, metodo: pedido.method, tipo: pedido.headers["content-type"] ?? null, xPedido });

    const responder = (status, dados, cabecalhos = {}) => {
      resposta.writeHead(status, { "cache-control": "no-store", "content-type": "application/json", ...(xPedido ? { "x-pedido": xPedido } : {}), ...cabecalhos });
      resposta.end(typeof dados === "string" ? dados : JSON.stringify(dados));
    };

    const forcada = falso.proximas.findIndex((item) => !item.caminho || item.caminho === url.pathname);

    if (forcada >= 0) {
      const [item] = falso.proximas.splice(forcada, 1);

      if (item.nuncaResponder) {
        return;
      }

      if (item.atrasoMs) {
        await new Promise((resolve) => setTimeout(resolve, item.atrasoMs));
      }

      resposta.writeHead(item.status ?? 200, { "content-type": "application/json", ...(item.cabecalhos ?? {}) });
      resposta.end(item.texto ?? JSON.stringify(item.corpo ?? {}));
      return;
    }

    if (!credencialCerta) {
      return responder(401, { erro: "credencial_invalida", mensagem: "Credencial errada." });
    }

    if (!xPedido || !/^[A-Za-z0-9._:-]{1,100}$/.test(xPedido)) {
      return responder(400, { campos: ["X-Pedido"], erro: "pedido_invalido", mensagem: "X-Pedido obrigatorio." });
    }

    if (pedido.method !== "GET" && pedido.headers["content-type"] !== "application/json") {
      return responder(415, { erro: "tipo_de_conteudo", mensagem: "JSON." });
    }

    const chamada = { requestId: xPedido };
    const caminho = url.pathname;
    let resultado = null;
    let partes;

    if (pedido.method === "POST" && caminho === "/interno/v1/vendas") {
      resultado = await simulador.registerSale(corpo, chamada);
    } else if (pedido.method === "POST" && caminho === "/interno/v1/vendas/desfazer") {
      resultado = await simulador.undoSale(corpo, chamada);
    } else if (pedido.method === "GET" && (partes = /^\/interno\/v1\/clientes\/([^/]+)\/licencas$/.exec(caminho))) {
      resultado = await simulador.listLicenses(decodeURIComponent(partes[1]), chamada);
    } else if (pedido.method === "PUT" && (partes = /^\/interno\/v1\/clientes\/([^/]+)\/titular$/.exec(caminho))) {
      resultado = await simulador.saveHolder(decodeURIComponent(partes[1]), corpo, chamada);
    } else if (pedido.method === "POST" && (partes = /^\/interno\/v1\/licencas\/([^/]+)\/chave$/.exec(caminho))) {
      resultado = await simulador.issueKey(decodeURIComponent(partes[1]), corpo, chamada);
    } else if (pedido.method === "POST" && (partes = /^\/interno\/v1\/licencas\/([^/]+)\/revogar$/.exec(caminho))) {
      resultado = await simulador.revokeKey(decodeURIComponent(partes[1]), corpo, chamada);
    } else {
      return responder(404, { erro: "nao_encontrado", mensagem: "Rota desconhecida." });
    }

    if (resultado.ok) {
      return responder(200, resultado.data);
    }

    const extra = resultado.details ?? {};
    return responder(resultado.status ?? STATUS[resultado.error] ?? 400, { erro: resultado.error, mensagem: resultado.message ?? "", ...extra });
  });

  await new Promise((resolve) => falso.servidor.listen(0, "127.0.0.1", resolve));
  falso.endereco = `http://127.0.0.1:${falso.servidor.address().port}`;
  falso.fechar = () =>
    new Promise((resolve) => {
      falso.servidor.closeAllConnections();
      falso.servidor.close(resolve);
    });
  falso.servidor.unref();

  return falso;
}

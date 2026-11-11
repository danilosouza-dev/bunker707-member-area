import assert from "node:assert/strict";
import { createServer } from "node:http";
import test, { after, before } from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import { apiInternaFalsa, CREDENCIAL_DE_TESTE } from "./support/emissor-interno-falso.mjs";

// O cliente da API interna do Emissor (docs/32 §11.2; contrato em docs/api-interna.md do bunker-licensing), por HTTP de
// verdade contra a API falsa de tests/support/emissor-interno-falso.mjs (que responde pelo simulador do produto):
// - a configuracao: o endereco so em https (ou 127.0.0.1), com /interno/v1; a credencial; o simulador so fora da producao
//   e nunca no modo "enforce"; a pagina de vendedor so com a configuracao e, no "enforce", com a chave interna;
// - cada pedido leva a credencial no Authorization: Bearer, o X-Pedido e o corpo do contrato;
// - cada recusa chega com o codigo e o que veio a mais (o campo errado, o que falta, o que a troca corta, a espera);
// - fora do formato, redirecionamento, tempo esgotado e corpo grande demais viram codigos, nunca excecao;
// - o cliente nunca escreve log e nunca devolve a credencial nem a Chave num erro.

const { createHttpInternalEmissor } = await import("../src/server/licensing/interno/http-client.ts");
const { createInternalEmissorSimulator } = await import("../src/server/licensing/interno/simulator.ts");
const config = await import("../src/server/licensing/interno/config.ts");
const { sellerAccessOf, SELLER_PAGES_GRANT } = await import("../src/server/licensing/interno/seller-model.ts");

const COMPRADORA = "4b6f1f0e-1d7a-4c58-9a59-3f3a8c1d2e10";
const OUTRA = "5c7f2f1e-2e8b-4d69-8a6a-4f4b9d2e3f21";
const venda = (extra = {}) => ({
  comprador: { areaUserId: COMPRADORA, email: "fulana@escola.test", nome: "Fulana de Tal" },
  compradoEm: "2026-11-11T14:03:00.000Z",
  garantiaAte: "2026-11-18T14:03:00.000Z",
  plataforma: "hotmart",
  produto: "4567890",
  transacao: "HP-1",
  ...extra
});
const pedido = (id = "item-0001") => ({ requestId: id });

let simulador;
let falso;
let cliente;

before(async () => {
  simulador = createInternalEmissorSimulator({ products: { 4567890: "licenca_anual", 4567891: "licenca_vitalicia" } });
  falso = await apiInternaFalsa({ simulador });
  cliente = createHttpInternalEmissor({ baseUrl: config.parseInternalBaseUrl(falso.endereco), credential: CREDENCIAL_DE_TESTE });
});

after(async () => {
  await falso.fechar();
});

test("configuração: o endereço só em https (ou 127.0.0.1), com /interno/v1; a credencial no formato; nada mais vale", () => {
  assert.equal(config.parseInternalBaseUrl("https://licencas-interno.bunker707.com.br"), "https://licencas-interno.bunker707.com.br/interno/v1");
  assert.equal(config.parseInternalBaseUrl("https://licencas-interno.bunker707.com.br/interno/v1/"), "https://licencas-interno.bunker707.com.br/interno/v1");
  assert.equal(config.parseInternalBaseUrl("http://127.0.0.1:8082"), "http://127.0.0.1:8082/interno/v1");

  for (const recusado of ["http://licencas-interno.bunker707.com.br", "http://localhost:8082", "https://a:b@emissor.test", "https://emissor.test/?x=1", "https://emissor.test/#a", "", undefined, "nada"]) {
    assert.equal(config.parseInternalBaseUrl(recusado), null, String(recusado));
  }

  assert.equal(config.parseInternalCredential(` ${CREDENCIAL_DE_TESTE} `), CREDENCIAL_DE_TESTE);
  assert.equal(config.parseInternalCredential("curta"), null);
  assert.equal(config.parseInternalCredential("com espaco no meio 0123456789abcdefghijklmnop"), null);

  const ok = { EMISSOR_INTERNO_CREDENCIAL: CREDENCIAL_DE_TESTE, EMISSOR_INTERNO_URL: "https://licencas-interno.bunker707.com.br" };
  assert.deepEqual(config.readInternalEmissorConfig(ok, { mode: "off" }), {
    baseUrl: "https://licencas-interno.bunker707.com.br/interno/v1",
    credential: CREDENCIAL_DE_TESTE,
    mode: "http"
  });
  // Metade da configuracao, ou fora do formato: desligado (nunca fala com endereco errado nem tenta sem credencial).
  assert.deepEqual(config.readInternalEmissorConfig({ EMISSOR_INTERNO_URL: ok.EMISSOR_INTERNO_URL }, { mode: "off" }), { mode: "desligado", reason: "configuracao_invalida" });
  assert.deepEqual(config.readInternalEmissorConfig({ ...ok, EMISSOR_INTERNO_URL: "http://licencas.test" }, { mode: "off" }), { mode: "desligado", reason: "configuracao_invalida" });
  assert.deepEqual(config.readInternalEmissorConfig({}, { mode: "off" }), { mode: "desligado", reason: "sem_configuracao" });
});

test("o simulador só fora da produção (next dev, testes, prévia da Vercel), só no modo off e nunca por cima da configuração", () => {
  const ligado = { EMISSOR_INTERNO_SIMULADOR: "on" };

  assert.equal(config.simulatorAllowed({ ...ligado, NODE_ENV: "development" }), true);
  assert.equal(config.simulatorAllowed({ ...ligado }), true, "os testes");
  assert.equal(config.simulatorAllowed({ ...ligado, NODE_ENV: "production", VERCEL_ENV: "preview" }), true, "a dev na Vercel");
  assert.equal(config.simulatorAllowed({ ...ligado, NODE_ENV: "production" }), false, "a nossa producao e a copia do comprador");
  assert.equal(config.simulatorAllowed({ ...ligado, NODE_ENV: "production", VERCEL_ENV: "production" }), false);
  assert.equal(config.simulatorAllowed({ EMISSOR_INTERNO_SIMULADOR: "1", NODE_ENV: "development" }), false, "so o texto on");
  assert.equal(config.simulatorAllowed({ NODE_ENV: "development" }), false, "sem a variavel, desligado");

  assert.deepEqual(config.readInternalEmissorConfig({ ...ligado, NODE_ENV: "development" }, { mode: "off" }), { mode: "simulador" });
  assert.deepEqual(config.readInternalEmissorConfig({ ...ligado, NODE_ENV: "development" }, { mode: "enforce" }), { mode: "desligado", reason: "sem_configuracao" });
  assert.deepEqual(config.readInternalEmissorConfig({ ...ligado, NODE_ENV: "production" }, { mode: "off" }), { mode: "desligado", reason: "sem_configuracao" });
});

test("as páginas de vendedor: só com a configuração; no modo enforce, também com a chave interna seller-pages", () => {
  const http = { baseUrl: "https://x.test/interno/v1", credential: CREDENCIAL_DE_TESTE, mode: "http" };

  assert.equal(SELLER_PAGES_GRANT, "seller-pages");
  assert.deepEqual(sellerAccessOf({ config: http, grantEnabled: false, licensingMode: "off" }), { enabled: true, via: "http" });
  assert.deepEqual(sellerAccessOf({ config: { mode: "simulador" }, grantEnabled: false, licensingMode: "off" }), { enabled: true, via: "simulador" });
  assert.deepEqual(sellerAccessOf({ config: http, grantEnabled: false, licensingMode: "enforce" }), { enabled: false, reason: "sem_chave_interna" }, "a copia do comprador com a variavel copiada");
  assert.deepEqual(sellerAccessOf({ config: http, grantEnabled: true, licensingMode: "enforce" }), { enabled: true, via: "http" }, "a nossa escola como Instalacao numero 1");
  assert.deepEqual(sellerAccessOf({ config: { mode: "desligado", reason: "sem_configuracao" }, grantEnabled: true, licensingMode: "enforce" }), {
    enabled: false,
    reason: "sem_configuracao"
  });
});

test("a venda chega com a credencial, o X-Pedido e o corpo do contrato; a repetição devolve o que a primeira aplicou", async () => {
  falso.pedidos.length = 0;
  const primeira = await cliente.registerSale(venda(), pedido("item-venda-1"));

  assert.equal(primeira.ok, true);
  assert.equal(primeira.data.aplicada, true);
  assert.equal(primeira.data.licencas.length, 1);
  assert.match(primeira.data.licencas[0].id, /^lic_/);
  assert.equal(primeira.data.licencas[0].tipo, "anual");
  assert.match(primeira.data.licencas[0].prazoComecaEm, /^\d{4}-\d{2}-\d{2}$/, "a anual que ainda nao comecou diz quando comeca");

  const [chegou] = falso.pedidos;
  assert.equal(chegou.metodo, "POST");
  assert.equal(chegou.caminho, "/interno/v1/vendas");
  assert.equal(chegou.credencialCerta, true);
  assert.equal(chegou.xPedido, "item-venda-1");
  assert.equal(chegou.tipo, "application/json");
  assert.deepEqual(chegou.corpo, venda());

  const repetida = await cliente.registerSale(venda(), pedido("item-venda-1"));
  assert.equal(repetida.ok, true);
  assert.equal(repetida.data.repetida, true);
  assert.equal(repetida.data.licencas[0].id, primeira.data.licencas[0].id, "a mesma venda nunca cria outra Licenca");
  assert.equal(simulador.inspect().licenses.length, 1);
});

test("Minhas licenças por HTTP: a lista, o titular, a Chave uma vez só, a troca que pede confirmação e o revogar", async () => {
  const vazia = await cliente.listLicenses(OUTRA, pedido("lista-0"));
  assert.deepEqual(vazia, { data: { licencas: [], termosAceitos: null, titular: null }, ok: true }, "o cliente sem venda recebe tudo vazio");

  const lista = await cliente.listLicenses(COMPRADORA, pedido("lista-1"));
  assert.equal(lista.ok, true);
  const [licenca] = lista.data.licencas;
  assert.equal(licenca.chave.estado, "nenhuma");
  assert.equal(licenca.instalacao, null);
  assert.match(licenca.links.renovar, /^https:\/\//);

  const semTitular = await cliente.issueKey(licenca.id, { areaUserId: COMPRADORA }, pedido("chave-1"));
  assert.deepEqual([semTitular.ok, semTitular.error, semTitular.status, semTitular.details], [false, "titular_pendente", 409, { falta: ["titular", "termos"] }]);

  const documentoErrado = await cliente.saveHolder(COMPRADORA, { aceiteTermos: { versao: "v1" }, documento: "11111111111", email2: "financeiro@escola.test", nome: "Escola" }, pedido("tit-1"));
  assert.deepEqual([documentoErrado.error, documentoErrado.status, documentoErrado.details], ["pedido_invalido", 400, { campos: ["documento"] }]);

  const titular = await cliente.saveHolder(COMPRADORA, { aceiteTermos: { versao: "v1" }, documento: "52998224725", email2: "financeiro@escola.test", nome: "Escola da Fulana" }, pedido("tit-2"));
  assert.equal(titular.ok, true);
  assert.equal(titular.data.termosAceitos.versao, "v1");

  const primeira = await cliente.issueKey(licenca.id, { areaUserId: COMPRADORA }, pedido("chave-2"));
  assert.equal(primeira.ok, true);
  assert.match(primeira.data.chave, /^BKA-[0-9A-Z]{5}(?:-[0-9A-Z]{5}){5}$/);
  assert.equal(primeira.data.final, primeira.data.chave.slice(-4));

  const semConfirmar = await cliente.issueKey(licenca.id, { areaUserId: COMPRADORA }, pedido("chave-3"));
  assert.equal(semConfirmar.error, "troca_nao_confirmada");
  assert.deepEqual(semConfirmar.details.chaveAguardandoUso.final, primeira.data.final, "a tela mostra o que vai deixar de valer");
  assert.equal(semConfirmar.details.instalacao, null);

  const deOutra = await cliente.issueKey(licenca.id, { areaUserId: OUTRA, confirmarTroca: true }, pedido("chave-4"));
  assert.deepEqual([deOutra.error, deOutra.status], ["licenca_nao_encontrada", 404], "licenca de outro cliente responde como a que nao existe");

  const trocada = await cliente.issueKey(licenca.id, { areaUserId: COMPRADORA, confirmarTroca: true }, pedido("chave-5"));
  assert.equal(trocada.ok, true);
  assert.notEqual(trocada.data.chave, primeira.data.chave);
  assert.equal(trocada.data.chavesCanceladas, 1, "nunca duas valendo");

  assert.equal(simulador.simulateActivation(licenca.id, "alunos.escola.test"), true);
  const revogada = await cliente.revokeKey(licenca.id, { areaUserId: COMPRADORA }, pedido("rev-1"));
  assert.deepEqual(revogada, { data: { chavesCanceladas: 0, instalacaoDesligada: { endereco: "alunos.escola.test" }, trocasEm12Meses: 2 }, ok: true });
});

test("as recusas chegam com o código, o status e a espera; o que não segue o contrato vira código, nunca exceção", async () => {
  const desconhecido = await cliente.registerSale(venda({ produto: "999", transacao: "HP-X" }), pedido());
  assert.deepEqual([desconhecido.ok, desconhecido.error, desconhecido.status], [false, "produto_desconhecido", 422]);
  assert.match(desconhecido.message, /mapa de produtos/);

  const casos = [
    [{ corpo: { erro: "limite_de_pedidos", mensagem: "Espere.", tenteDeNovoEm: 42 }, status: 429 }, { error: "limite_de_pedidos", retryAfterSeconds: 42, status: 429 }],
    [{ cabecalhos: { "retry-after": "7" }, status: 429, texto: "" }, { error: "limite_de_pedidos", retryAfterSeconds: 7, status: 429 }],
    [{ status: 401, texto: "" }, { error: "credencial_invalida", status: 401 }],
    [{ status: 503, texto: "<html>fora</html>" }, { error: "indisponivel", status: 503 }],
    [{ status: 500, corpo: { erro: "erro_interno", mensagem: "Defeito." } }, { error: "erro_interno", status: 500 }],
    [{ status: 200, texto: "{nao e json" }, { error: "resposta_invalida", status: 200 }],
    [{ corpo: { licencas: [{ id: "x" }] }, status: 200 }, { error: "resposta_invalida", status: 200 }],
    [{ cabecalhos: { location: "https://outro.test/" }, status: 302, texto: "" }, { error: "sem_resposta", status: null }],
    [{ status: 418, texto: "" }, { error: "recusado", status: 418 }]
  ];

  for (const [resposta, esperado] of casos) {
    falso.proximas.push(resposta);
    const resultado = await cliente.registerSale(venda({ transacao: "HP-Y" }), pedido());
    assert.equal(resultado.ok, false, JSON.stringify(resposta));
    for (const [campo, valor] of Object.entries(esperado)) {
      assert.deepEqual(resultado[campo], valor, `${JSON.stringify(resposta)}: ${campo}`);
    }
  }
});

test("tempo esgotado, corpo grande demais e o Emissor fora do ar viram sem_resposta ou resposta_invalida", async () => {
  const rapido = createHttpInternalEmissor({ baseUrl: config.parseInternalBaseUrl(falso.endereco), credential: CREDENCIAL_DE_TESTE, timeoutMs: 150 });

  falso.proximas.push({ nuncaResponder: true });
  assert.deepEqual(await rapido.listLicenses(COMPRADORA, pedido()), { error: "sem_resposta", message: null, ok: false, status: null });

  falso.proximas.push({ status: 200, texto: JSON.stringify({ licencas: [], titular: null, x: "a".repeat(300_000) }) });
  assert.equal((await cliente.listLicenses(COMPRADORA, pedido())).error, "resposta_invalida");

  const fechado = createServer();
  await new Promise((resolve) => fechado.listen(0, "127.0.0.1", resolve));
  const porta = fechado.address().port;
  await new Promise((resolve) => fechado.close(resolve));
  const foraDoAr = createHttpInternalEmissor({ baseUrl: `http://127.0.0.1:${porta}/interno/v1`, credential: CREDENCIAL_DE_TESTE });
  assert.equal((await foraDoAr.registerSale(venda(), pedido())).error, "sem_resposta");

  // O sinal de quem chama (o orcamento do tick) tambem corta.
  const parar = new AbortController();
  falso.proximas.push({ nuncaResponder: true });
  const pendente = cliente.listLicenses(COMPRADORA, { requestId: "x", signal: parar.signal });
  parar.abort();
  assert.equal((await pendente).error, "sem_resposta");
});

test("pedido fora do formato nem sai (a conta, a Licença e o X-Pedido); o cliente nunca escreve log nem devolve a credencial", async () => {
  const antes = falso.pedidos.length;
  const logs = [];
  const originais = { error: console.error, info: console.info, log: console.log, warn: console.warn };

  for (const nivel of Object.keys(originais)) {
    console[nivel] = (...args) => logs.push(args.join(" "));
  }

  try {
    const resultados = [
      await cliente.listLicenses("../admin", pedido()),
      await cliente.issueKey("lic_../../vendas", { areaUserId: COMPRADORA }, pedido()),
      await cliente.revokeKey("lic_00000001", { areaUserId: "" }, pedido()),
      await cliente.saveHolder("com espaco", { aceiteTermos: { versao: "v1" }, documento: "1", email2: "a@b.test", nome: "x" }, pedido()),
      await cliente.registerSale(venda(), { requestId: "com espaço" })
    ];

    assert.deepEqual(
      resultados.map((resultado) => resultado.error),
      ["pedido_invalido", "pedido_invalido", "pedido_invalido", "pedido_invalido", "erro_inesperado"]
    );
    assert.equal(falso.pedidos.length, antes, "nada saiu");

    falso.proximas.push({ status: 401, texto: "" });
    const recusado = await cliente.registerSale(venda(), pedido());
    falso.proximas.push({ corpo: { chave: "BKA-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF", erro: "x" }, status: 500 });
    const comChave = await cliente.issueKey("lic_00000001", { areaUserId: COMPRADORA, confirmarTroca: true }, pedido());

    assert.doesNotMatch(JSON.stringify([recusado, comChave]), new RegExp(CREDENCIAL_DE_TESTE));
    assert.doesNotMatch(JSON.stringify(comChave), /BKA-/, "a Chave so sai na resposta boa, nunca num erro");
  } finally {
    Object.assign(console, originais);
  }

  assert.deepEqual(logs, []);
});

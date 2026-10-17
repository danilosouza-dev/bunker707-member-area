import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import {
  ESCOLA_DE_TESTE,
  PACOTE_DE_TESTE,
  apagarContaDeTeste,
  desconectarVendas,
  garantirPacoteDeTeste,
  ligarProdutoNaPlataforma,
  limparVendasDeTeste,
  seedEscolaDeTeste,
  usuarioDeTeste
} from "../fixtures/escola-de-teste.mjs";

// Vendas pela Ticto (docs/04, secao Webhooks externos; docs/17 §1.10) contra o banco LOCAL de verdade,
// pelo mesmo caminho da Hotmart: sem a Ticto conectada a rota recusa; o dono guarda o token pela Server
// Action e informa o codigo da Ticto no Acesso e venda (independente do da Hotmart); a compra aprovada
// (payload FICTICIO, token no corpo) cria a conta, libera o produto e deixa boas-vindas e compra na fila
// de e-mail, com o payload guardado sem token nem CPF; o mesmo postback de novo nao duplica; reembolso
// revoga; assinatura cancelada suspende e reativada devolve; o pacote ganha o codigo da Ticto pela acao de
// Pacotes e a venda dele libera todos os produtos; situacao que nao muda acesso e ignorada; token errado
// e 401; desconectar volta a recusar. Nenhum e-mail sai.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const route = await import("../../src/app/api/webhooks/ticto/route.ts");
const salesActions = await import("../../src/server/payments/actions.ts");
const salesQueries = await import("../../src/server/payments/queries.ts");
const productActions = await import("../../src/server/catalog/product-actions.ts");
const comboActions = await import("../../src/server/catalog/combo-actions.ts");
const catalogQueries = await import("../../src/server/catalog/queries.ts");
const combosQueries = await import("../../src/server/catalog/combos.ts");
const studentQueries = await import("../../src/server/students/queries.ts");

const { curso, cursoBloqueado, cursoLiberacao } = ESCOLA_DE_TESTE;
const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const TOKEN = "token-ticto-integracao-0123456789abcdef";
const CODIGOS = { bump: "8004", bumpSemLigacao: "8998", curso: "8001", pacote: "8002", semLigacao: "8999" };
const COMPRADOR = { email: "comprador.ticto@bunker707.test", nome: "Comprador da Ticto" };
const ASSINANTE = { email: "assinante.ticto@bunker707.test", nome: "Assinante da Ticto" };
const COMPRADOR_PACOTE = { email: "comprador.pacote.ticto@bunker707.test", nome: "Comprador do Pacote" };
const COMPRADOR_BUMP = { email: "comprador.bump.ticto@bunker707.test", nome: "Comprador do Bump" };
const PREFIXO = "teste-ticto-";

/** Payload ficticio no formato do webhook 2.0 da Ticto; a transacao leva o prefixo (vira o id do evento e a origem do acesso). */
function payload({ bumps, email = COMPRADOR.email, nome = COMPRADOR.nome, produto = CODIGOS.curso, status = "authorized", statusDate = "2026-10-17 10:00:00", transacao }) {
  return {
    ...(bumps ? { bumps } : {}),
    commission_type: "producer",
    customer: { cpf: "00000000000", email, name: nome, phone: { ddd: "11", ddi: "55", number: "999990000" }, type: "person" },
    direct_login_url: "https://exemplo.test/entrar-direto",
    item: { offer_code: "OFERTA01", offer_id: 1, product_id: Number(produto), product_name: `Produto ${produto} na Ticto`, refund_deadline: 7 },
    order: { hash: `${PREFIXO}pedido-${transacao}`, id: 1, order_date: "2026-10-17 09:59:00", paid_amount: 19700, transaction_hash: `${PREFIXO}${transacao}` },
    payment_method: "pix",
    status,
    status_date: statusDate,
    token: TOKEN,
    transaction: { cards: [], hash: `${PREFIXO}${transacao}` },
    version: "2.0"
  };
}

function post(body, token = TOKEN) {
  const data = { ...body };

  if (token) {
    data.token = token;
  } else {
    delete data.token;
  }

  return route.POST(
    new Request("http://127.0.0.1:3100/api/webhooks/ticto", {
      body: JSON.stringify(data),
      headers: { "content-type": "application/json", host: "127.0.0.1:3100" },
      method: "POST"
    })
  );
}

async function eventos() {
  return unwrap(
    await db
      .from("webhook_events")
      .select("id,provider,external_event_id,event_type,normalized_type,processing_status,outcome,outcome_detail,error_message,product_id,combo_id,user_id,buyer_email,payload")
      .like("external_event_id", `${PREFIXO}%`)
      .order("received_at"),
    "Lendo vendas recebidas"
  );
}

async function acessosDe(email) {
  const { users } = unwrap(await db.auth.admin.listUsers({ page: 1, perPage: 1000 }), "Lendo contas");
  const conta = users.find((user) => user.email === email);

  if (!conta) {
    return { conta: null, acessos: [] };
  }

  const acessos = unwrap(await db.from("entitlements").select("target_id,status,source_provider,source_event_id").eq("user_id", conta.id).order("target_id"), "Lendo acessos");

  return { acessos, conta };
}

async function filaDe(email) {
  return unwrap(await db.from("email_outbox").select("kind,status,idempotency_key,html").eq("to_email", email).order("created_at"), "Lendo a fila de e-mail");
}

async function integracao() {
  return unwrap(await db.from("integration_settings").select("status,secret_status,secret,events,last_sync_at,last_error,webhook_url").eq("provider", "ticto").single(), "Lendo a Ticto");
}

async function limpar() {
  await desconectarVendas(db);
  // "7001" e o codigo da Hotmart que o teste do Acesso e venda grava junto, para provar que um nao mexe no outro.
  await limparVendasDeTeste(db, { codigos: [...Object.values(CODIGOS), "7001"], prefixoDoEvento: PREFIXO });
  unwrap(await db.from("email_outbox").delete().in("to_email", [COMPRADOR.email, ASSINANTE.email, COMPRADOR_PACOTE.email, COMPRADOR_BUMP.email]), "Limpando a fila de e-mail de teste");

  for (const conta of [COMPRADOR, ASSINANTE, COMPRADOR_PACOTE, COMPRADOR_BUMP]) {
    await apagarContaDeTeste(db, conta.email);
  }
}

before(limpar);
after(limpar);

/* ------------------------------------------------------------ Conectar */

test("sem a Ticto conectada, o webhook responde 503 e nao grava nada", async () => {
  const response = await post(payload({ transacao: "T-sem-conexao" }));

  assert.equal(response.status, 503);
  assert.equal((await eventos()).length, 0);
});

test("so o dono guarda o token da Ticto; a tela mostra a Ticto conectavel, com os eventos dela, e so a Kiwify em configuracao", async () => {
  actAs(analista);
  const recusa = await salesActions.saveSalesSecret({ provider: "ticto", secret: TOKEN });
  assert.equal(recusa.ok, false);
  assert.equal(recusa.status, 403);

  actAs(produtor);
  const result = await salesActions.saveSalesSecret({ provider: "ticto", secret: TOKEN });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.webhookUrl, "http://127.0.0.1:3100/api/webhooks/ticto");

  const row = await integracao();
  assert.equal(row.status, "configured");
  assert.equal(row.secret_status, "set");
  assert.equal(row.secret, TOKEN, "o segredo fica no banco, so para o servidor");
  assert.deepEqual(row.events, ["authorized", "uncanceled", "refunded", "chargeback", "subscription_canceled"]);

  const data = await salesQueries.getSalesSettingsData();
  const ticto = data.providers.find((card) => card.provider === "ticto");
  assert.equal(ticto.supported, true);
  assert.equal(ticto.status, "configured");
  assert.ok(ticto.secretUpdatedAt, "a tela recebe a data em que o token foi guardado");
  assert.equal("secret" in ticto, false, "a tela nunca recebe o token");
  assert.deepEqual(data.providers.filter((card) => !card.supported).map((card) => card.provider), ["kiwify"]);
  assert.equal(data.providers.find((card) => card.provider === "hotmart").status, "not_configured", "conectar a Ticto nao mexe na Hotmart");

  const resumo = await salesQueries.getSalesProviderStatuses();
  assert.deepEqual(
    resumo.map((row) => [row.supported, row.status]),
    [[true, "not_configured"], [true, "configured"], [false, "not_configured"]]
  );
});

test("token errado ou ausente responde 401 e nao grava o evento; cabecalho nao substitui o token do corpo", async () => {
  assert.equal((await post(payload({ transacao: "T-token-errado" }), "outro-token-errado-0123456789")).status, 401);
  assert.equal((await post(payload({ transacao: "T-sem-token" }), null)).status, 401);

  const comCabecalho = await route.POST(
    new Request("http://127.0.0.1:3100/api/webhooks/ticto", {
      body: JSON.stringify({ ...payload({ transacao: "T-cabecalho" }), token: undefined }),
      headers: { "content-type": "application/json", host: "127.0.0.1:3100", "x-ticto-token": TOKEN },
      method: "POST"
    })
  );
  assert.equal(comCabecalho.status, 401);
  assert.equal((await eventos()).length, 0);
});

/* ------------------------------------------------------------ Compra aprovada */

test("dono informa o codigo da Ticto no Acesso e venda do curso, sem mexer no da Hotmart; codigo repetido em outro produto e recusado no campo da Ticto", async () => {
  actAs(produtor);
  const access = await catalogQueries.getProductAccess(curso.id);
  assert.equal(access.tictoProductId, null);

  const saved = await productActions.updateProductAccess({ expectedUpdatedAt: access.header.updatedAt, hotmartProductId: "7001", id: curso.id, tictoProductId: CODIGOS.curso });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const depois = await catalogQueries.getProductAccess(curso.id);
  assert.equal(depois.tictoProductId, CODIGOS.curso);
  assert.equal(depois.hotmartProductId, "7001", "cada plataforma guarda o proprio codigo");

  const outro = await catalogQueries.getProductAccess(cursoBloqueado.id);
  const repetido = await productActions.updateProductAccess({ expectedUpdatedAt: outro.header.updatedAt, id: cursoBloqueado.id, tictoProductId: CODIGOS.curso });
  assert.equal(repetido.ok, false);
  assert.equal(repetido.status, 400);
  assert.match(repetido.fieldErrors?.tictoProductId?.[0] ?? "", /já está ligado/);
  assert.equal(repetido.fieldErrors?.hotmartProductId, undefined, "o erro cai no campo da Ticto, nao no da Hotmart");
  assert.equal((await catalogQueries.getProductAccess(cursoBloqueado.id)).header.updatedAt, outro.header.updatedAt, "a recusa nao grava nada: a versao do produto fica igual");

  // Corrigir e salvar de novo com a mesma versao funciona (antes da conferencia previa, respondia 409).
  const mesmoCodigoNaHotmart = await productActions.updateProductAccess({ expectedUpdatedAt: outro.header.updatedAt, hotmartProductId: CODIGOS.curso, id: cursoBloqueado.id });
  assert.equal(mesmoCodigoNaHotmart.ok, true, `o mesmo numero pode existir na Hotmart e na Ticto: sao plataformas diferentes (${JSON.stringify(mesmoCodigoNaHotmart)})`);
  const limpa = await productActions.updateProductAccess({ expectedUpdatedAt: (await catalogQueries.getProductAccess(cursoBloqueado.id)).header.updatedAt, hotmartProductId: "", id: cursoBloqueado.id });
  assert.equal(limpa.ok, true, JSON.stringify(limpa));
});

test("compra aprovada cria a conta, libera o curso com origem ticto, enfileira boas-vindas e compra, e guarda o payload sem token nem CPF", async () => {
  const response = await post(payload({ transacao: "T0001" }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.outcome, "access_granted");
  assert.equal(body.type, "purchase_approved");

  const { acessos, conta } = await acessosDe(COMPRADOR.email);
  assert.ok(conta, "a conta nasceu no Auth local");
  assert.deepEqual(acessos, [{ source_event_id: `${PREFIXO}T0001`, source_provider: "ticto", status: "active", target_id: curso.id }]);

  const perfil = unwrap(await db.from("profiles").select("full_name,phone").eq("id", conta.id).single(), "Lendo o perfil");
  assert.deepEqual(perfil, { full_name: COMPRADOR.nome, phone: "+55 11999990000" });

  const fila = await filaDe(COMPRADOR.email);
  assert.deepEqual(fila.map((row) => [row.kind, row.status]), [["welcome", "queued"], ["purchase", "queued"]]);
  assert.equal(fila[1].idempotency_key, `purchase:ticto:${PREFIXO}T0001:${conta.id}`);
  assert.match(fila[1].html, new RegExp(`/conteudo/${curso.id}`));

  const [evento] = await eventos();
  assert.equal(evento.provider, "ticto");
  assert.equal(evento.external_event_id, `${PREFIXO}T0001:${CODIGOS.curso}:authorized:2026-10-17 10:00:00`);
  assert.equal(evento.event_type, "authorized");
  assert.equal(evento.normalized_type, "purchase_approved");
  assert.equal(evento.processing_status, "processed");
  assert.equal(evento.outcome, "access_granted");
  assert.equal(evento.product_id, curso.id);
  assert.equal(evento.user_id, conta.id);
  assert.equal(evento.buyer_email, COMPRADOR.email);
  assert.equal(evento.payload.token, "[oculto]", "o token nao fica no payload guardado");
  assert.equal(evento.payload.direct_login_url, "[oculto]");
  assert.equal(evento.payload.customer.cpf, "[oculto]", "o CPF nao fica no payload guardado");
  assert.equal(evento.payload.customer.email, COMPRADOR.email);
  assert.equal(evento.payload.item.product_id, Number(CODIGOS.curso));

  const row = await integracao();
  assert.ok(row.last_sync_at, "a plataforma registra a ultima venda");
  assert.equal(row.status, "configured");

  const detail = await studentQueries.getStudentDetail(conta.id);
  assert.equal(detail.accesses[0].sourceProvider, "ticto");
  assert.ok(detail.timeline.some((item) => /Conta criada pela venda \(Ticto\)/.test(item.text)), "o historico mostra a origem Ticto");

  const ignorado = await post(payload({ produto: CODIGOS.semLigacao, transacao: "T0009" }));
  assert.equal(ignorado.status, 200);
  assert.equal((await ignorado.json()).outcome, "ignored");
  const linha = (await eventos()).find((row) => row.external_event_id.startsWith(`${PREFIXO}T0009:`));
  assert.equal(linha.processing_status, "ignored");
  assert.match(linha.outcome_detail, /8999 \(Produto 8999 na Ticto\) da Ticto não está ligado/);
  assert.equal((await acessosDe(COMPRADOR.email)).acessos.length, 1, "nada foi liberado para o produto sem codigo");
});

test("o mesmo postback entregue de novo responde 200 sem reprocessar: um acesso, dois e-mails, uma linha", async () => {
  const response = await post(payload({ transacao: "T0001" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { duplicate: true, ok: true });

  assert.equal((await acessosDe(COMPRADOR.email)).acessos.length, 1);
  assert.equal((await filaDe(COMPRADOR.email)).length, 2);
  assert.equal((await eventos()).filter((row) => row.external_event_id.startsWith(`${PREFIXO}T0001:${CODIGOS.curso}:authorized`)).length, 1);
});

test("reembolso revoga o acesso ao curso e fica registrado como revogado", async () => {
  const response = await post(payload({ status: "refunded", statusDate: "2026-10-18 08:00:00", transacao: "T0001" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).outcome, "access_revoked");

  const { acessos } = await acessosDe(COMPRADOR.email);
  assert.deepEqual(acessos.map((row) => [row.target_id, row.status]), [[curso.id, "revoked"]]);
  assert.equal((await eventos()).find((row) => row.external_event_id.startsWith(`${PREFIXO}T0001:${CODIGOS.curso}:refunded`)).outcome, "access_revoked");

  const repetido = await post(payload({ status: "refunded", statusDate: "2026-10-18 09:00:00", transacao: "T0001" }));
  assert.equal((await repetido.json()).outcome, "ignored", "revogar de novo nao muda nada");
});

/* ------------------------------------------------------------ Assinatura */

test("assinatura cancelada suspende o acesso; assinatura reativada (uncanceled) devolve", async () => {
  const compra = await post(payload({ email: ASSINANTE.email, nome: ASSINANTE.nome, transacao: "T0002" }));
  assert.equal((await compra.json()).outcome, "access_granted");

  const cancelada = await post(payload({ email: ASSINANTE.email, nome: ASSINANTE.nome, status: "subscription_canceled", statusDate: "2026-11-17 10:00:00", transacao: "T0002" }));
  assert.equal((await cancelada.json()).outcome, "access_suspended");
  assert.deepEqual((await acessosDe(ASSINANTE.email)).acessos.map((row) => [row.target_id, row.status]), [[curso.id, "suspended"]]);

  const reativada = await post(payload({ email: ASSINANTE.email, nome: ASSINANTE.nome, status: "uncanceled", statusDate: "2026-11-18 10:00:00", transacao: "T0002" }));
  assert.equal((await reativada.json()).outcome, "access_granted");
  assert.deepEqual((await acessosDe(ASSINANTE.email)).acessos.map((row) => [row.target_id, row.status]), [[curso.id, "active"]]);
  assert.deepEqual(
    (await filaDe(ASSINANTE.email)).map((row) => row.kind),
    ["welcome", "purchase"],
    "a reativacao e da mesma compra: a chave de idempotencia do e-mail de compra nao manda de novo"
  );
});

/* ------------------------------------------------------------ Order bump */

function porProduto(acessos) {
  return acessos.map((row) => [row.target_id, row.status, row.source_event_id]).sort((left, right) => left[0].localeCompare(right[0]));
}

test("order bump: o produto vendido junto com codigo ligado e liberado na mesma compra (um e-mail so); o bump sem ligacao fica escrito; o reembolso do pedido revoga os dois", async () => {
  await ligarProdutoNaPlataforma(db, { codigo: CODIGOS.bump, plataforma: "ticto", produtoId: cursoBloqueado.id });
  const bumps = [
    { offer_code: "BUMP01", offer_id: 173, product_id: Number(CODIGOS.bump), product_name: "Bonus na Ticto" },
    { offer_code: "BUMP02", offer_id: 174, product_id: Number(CODIGOS.bumpSemLigacao), product_name: "Ebook na Ticto" }
  ];

  const compra = await post(payload({ bumps, email: COMPRADOR_BUMP.email, nome: COMPRADOR_BUMP.nome, transacao: "T-BUMP-0001" }));
  const body = await compra.json();
  assert.equal(compra.status, 200, JSON.stringify(body));
  assert.equal(body.outcome, "access_granted");

  const { acessos } = await acessosDe(COMPRADOR_BUMP.email);
  assert.deepEqual(
    porProduto(acessos),
    [
      [curso.id, "active", `${PREFIXO}T-BUMP-0001:${curso.id}`],
      [cursoBloqueado.id, "active", `${PREFIXO}T-BUMP-0001:${cursoBloqueado.id}`]
    ].sort((left, right) => left[0].localeCompare(right[0])),
    "o principal e o bump ligado ficam abertos, cada um com o proprio id de origem"
  );
  assert.deepEqual((await filaDe(COMPRADOR_BUMP.email)).map((row) => row.kind), ["welcome", "purchase"], "um e-mail de compra para o pedido inteiro");

  const linha = (await eventos()).find((row) => row.external_event_id.startsWith(`${PREFIXO}T-BUMP-0001:${CODIGOS.curso}:authorized`));
  assert.equal(linha.product_id, curso.id, "a linha mostra o produto principal");
  assert.match(linha.outcome_detail, /Inclui 1 produto vendido junto\./);
  assert.match(linha.outcome_detail, /8998 \(Ebook na Ticto\) da Ticto não está ligado a nenhum produto ou pacote da escola e não foi liberado/);

  const reembolso = await post(payload({ bumps, email: COMPRADOR_BUMP.email, status: "refunded", statusDate: "2026-10-19 10:00:00", transacao: "T-BUMP-0001" }));
  assert.equal((await reembolso.json()).outcome, "access_revoked");
  assert.deepEqual(
    porProduto((await acessosDe(COMPRADOR_BUMP.email)).acessos).map(([target, status]) => [target, status]),
    [[curso.id, "revoked"], [cursoBloqueado.id, "revoked"]].sort((left, right) => left[0].localeCompare(right[0])),
    "o reembolso do pedido tira o principal e o bump"
  );
});

test("order bump com o produto principal fora da escola: o bump ligado e liberado e o detalhe diz que o principal nao foi", async () => {
  const response = await post(
    payload({ bumps: [{ product_id: Number(CODIGOS.bump), product_name: "Bonus na Ticto" }], email: COMPRADOR_BUMP.email, produto: CODIGOS.semLigacao, transacao: "T-BUMP-0002" })
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.outcome, "access_granted");

  const status = Object.fromEntries((await acessosDe(COMPRADOR_BUMP.email)).acessos.map((row) => [row.target_id, row.status]));
  assert.equal(status[cursoBloqueado.id], "active", "o bump ligado volta a ser liberado pela compra nova");
  assert.equal(status[curso.id], "revoked", "o principal nao ligado nao libera nada");

  const linha = (await eventos()).find((row) => row.external_event_id.startsWith(`${PREFIXO}T-BUMP-0002:${CODIGOS.semLigacao}:authorized`));
  assert.equal(linha.processing_status, "processed");
  assert.equal(linha.product_id, cursoBloqueado.id);
  assert.match(linha.outcome_detail, /O produto principal 8999 \(Produto 8999 na Ticto\) da Ticto não está ligado a nenhum produto ou pacote da escola e não foi liberado\./);
  assert.doesNotMatch(linha.outcome_detail, /Reprocessar/, "a venda foi processada: nao manda reprocessar");
});

/* ------------------------------------------------------------ Pacote */

test("pacote: o dono informa o codigo da Ticto em Pacotes; a compra libera todos os produtos de uma vez e o chargeback revoga todos", async () => {
  await garantirPacoteDeTeste(db, "7002");

  actAs(produtor);
  const salvo = await comboActions.saveCombo({
    cohortName: "Turma A",
    description: "Pacote ficticio da escola de teste.",
    id: PACOTE_DE_TESTE.id,
    name: PACOTE_DE_TESTE.nome,
    productIds: PACOTE_DE_TESTE.produtos,
    status: "active",
    tictoProductId: CODIGOS.pacote
  });
  assert.equal(salvo.ok, true, JSON.stringify(salvo));
  assert.equal(salvo.data.tictoProductId, CODIGOS.pacote);
  assert.equal(salvo.data.hotmartProductId, "7002", "o codigo da Hotmart do pacote continua");

  const listado = (await combosQueries.listCombos()).find((combo) => combo.id === PACOTE_DE_TESTE.id);
  assert.equal(listado.tictoProductId, CODIGOS.pacote);
  assert.equal(listado.hotmartProductId, "7002");

  const compra = await post(payload({ email: COMPRADOR_PACOTE.email, nome: COMPRADOR_PACOTE.nome, produto: CODIGOS.pacote, transacao: "T-PACOTE-0001" }));
  const compraBody = await compra.json();
  assert.equal(compra.status, 200, JSON.stringify(compraBody));
  assert.equal(compraBody.outcome, "access_granted");

  const { acessos, conta } = await acessosDe(COMPRADOR_PACOTE.email);
  assert.deepEqual(
    acessos.map((row) => [row.target_id, row.status, row.source_event_id]),
    [
      [cursoBloqueado.id, "active", `${PREFIXO}T-PACOTE-0001:${cursoBloqueado.id}`],
      [cursoLiberacao.id, "active", `${PREFIXO}T-PACOTE-0001:${cursoLiberacao.id}`]
    ],
    "cada produto do pacote tem o proprio id de origem"
  );
  assert.deepEqual((await filaDe(COMPRADOR_PACOTE.email)).map((row) => row.kind), ["welcome", "purchase"], "um e-mail de compra para o pacote inteiro");

  const linha = (await eventos()).find((row) => row.external_event_id.startsWith(`${PREFIXO}T-PACOTE-0001:${CODIGOS.pacote}:authorized`));
  assert.equal(linha.combo_id, PACOTE_DE_TESTE.id);
  assert.equal(linha.user_id, conta.id);

  const chargeback = await post(payload({ email: COMPRADOR_PACOTE.email, produto: CODIGOS.pacote, status: "chargeback", statusDate: "2026-10-20 10:00:00", transacao: "T-PACOTE-0001" }));
  assert.equal((await chargeback.json()).outcome, "access_revoked");
  assert.deepEqual((await acessosDe(COMPRADOR_PACOTE.email)).acessos.map((row) => row.status), ["revoked", "revoked"], "o chargeback do pacote tira todos os produtos");
});

/* ------------------------------------------------------------ Outros eventos e desconectar */

test("situacoes que nao mudam acesso (pix gerado, boleto) ficam guardadas como ignoradas; sem status e 400; JSON invalido e 400", async () => {
  const pix = await post(payload({ status: "pix_created", transacao: "T0300" }));
  assert.equal((await pix.json()).outcome, "ignored");
  const linha = (await eventos()).find((row) => row.external_event_id.startsWith(`${PREFIXO}T0300:${CODIGOS.curso}:pix_created`));
  assert.equal(linha.event_type, "pix_created");
  assert.match(linha.outcome_detail, /pix_created não muda o acesso/);

  const semStatus = await post({ ...payload({ transacao: "T0301" }), status: undefined });
  assert.equal(semStatus.status, 400);

  const invalido = await route.POST(
    new Request("http://127.0.0.1:3100/api/webhooks/ticto", { body: "{nao-e-json", headers: { "content-type": "application/json" }, method: "POST" })
  );
  assert.equal(invalido.status, 400);
});

test("Hoje: a origem dos acessos do periodo separa Ticto de Hotmart e equipe", async () => {
  const { data, error } = await db.rpc("admin_access_origins", {
    p_content_id: null,
    p_end: new Date(Date.now() + 60_000).toISOString(),
    p_start: new Date(Date.now() - 3_600_000).toISOString()
  });
  assert.equal(error, null, error?.message);
  const ticto = data.find((row) => row.source_provider === "ticto");
  assert.ok(ticto && Number(ticto.total) >= 4, JSON.stringify(data));
});

test("desconectar a Ticto apaga o token e o webhook volta a responder 503", async () => {
  actAs(produtor);
  const result = await salesActions.disconnectSalesProvider({ provider: "ticto" });
  assert.equal(result.ok, true);

  const row = await integracao();
  assert.equal(row.status, "not_configured");
  assert.equal(row.secret, null);
  assert.equal(row.secret_status, "missing");
  assert.equal((await post(payload({ transacao: "T-depois-de-desconectar" }))).status, 503);
});

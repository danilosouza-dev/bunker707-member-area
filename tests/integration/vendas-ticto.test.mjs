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
const hotmartRoute = await import("../../src/app/api/webhooks/hotmart/route.ts");
const { hashSalesSecret } = await import("../../src/server/payments/secret.ts");
const salesActions = await import("../../src/server/payments/actions.ts");
const salesQueries = await import("../../src/server/payments/queries.ts");
const productActions = await import("../../src/server/catalog/product-actions.ts");
const comboActions = await import("../../src/server/catalog/combo-actions.ts");
const catalogQueries = await import("../../src/server/catalog/queries.ts");
const combosQueries = await import("../../src/server/catalog/combos.ts");
const studentQueries = await import("../../src/server/students/queries.ts");
const studentActions = await import("../../src/server/students/actions.ts");

const { curso, cursoBloqueado, cursoLiberacao } = ESCOLA_DE_TESTE;
const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const TOKEN = "token-ticto-integracao-0123456789abcdef";
const CODIGOS = { bump: "8004", bumpSemLigacao: "8998", curso: "8001", pacote: "8002", semLigacao: "8999" };
const COMPRADOR = { email: "comprador.ticto@bunker707.test", nome: "Comprador da Ticto" };
const ASSINANTE = { email: "assinante.ticto@bunker707.test", nome: "Assinante da Ticto" };
const COMPRADOR_PACOTE = { email: "comprador.pacote.ticto@bunker707.test", nome: "Comprador do Pacote" };
const COMPRADOR_BUMP = { email: "comprador.bump.ticto@bunker707.test", nome: "Comprador do Bump" };
const COMPRADOR_MISTO = { email: "comprador.misto.ticto@bunker707.test", nome: "Comprador das Duas Plataformas" };
const COMPRADOR_REATIVA = { email: "comprador.reativa.ticto@bunker707.test", nome: "Comprador que Reativou" };
const COMPRADOR_EQUIPE = { email: "comprador.equipe.ticto@bunker707.test", nome: "Comprador Revogado pela Equipe" };
const COMPRADOR_ASSINA_BUMP = { email: "comprador.assina.bump.ticto@bunker707.test", nome: "Assinante com Bump" };
const TOKEN_HOTMART = "hottok-integracao-ticto-0123456789abcdef";
const PREFIXO = "teste-ticto-";

/** Payload ficticio no formato do webhook 2.0 da Ticto; a transacao leva o prefixo (vira o id do evento e a origem do acesso). */
function payload({ assinatura, bumps, email = COMPRADOR.email, nome = COMPRADOR.nome, produto = CODIGOS.curso, status = "authorized", statusDate = "2026-10-17 10:00:00", transacao }) {
  return {
    ...(assinatura ? { subscriptions: [{ canceled_at: status === "subscription_canceled" ? statusDate : null, id: Number(assinatura), interval: 1 }] } : {}),
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

/** Vinculos venda -> acesso (sale_grants) das vendas de teste da Ticto, por transacao. */
async function vinculosDe(transacoes) {
  return unwrap(
    await db
      .from("sale_grants")
      .select("transaction_id,product_id,opened,subscription_code,closed_by")
      .eq("provider", "ticto")
      .in("transaction_id", transacoes.map((transacao) => `${PREFIXO}${transacao}`))
      .order("created_at"),
    "Lendo os vinculos das vendas"
  );
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
  unwrap(await db.from("email_outbox").delete().in("to_email", [COMPRADOR.email, ASSINANTE.email, COMPRADOR_PACOTE.email, COMPRADOR_BUMP.email, COMPRADOR_MISTO.email, COMPRADOR_REATIVA.email, COMPRADOR_EQUIPE.email, COMPRADOR_ASSINA_BUMP.email]), "Limpando a fila de e-mail de teste");

  for (const conta of [COMPRADOR, ASSINANTE, COMPRADOR_PACOTE, COMPRADOR_BUMP, COMPRADOR_MISTO, COMPRADOR_REATIVA, COMPRADOR_EQUIPE, COMPRADOR_ASSINA_BUMP]) {
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
  assert.equal(row.secret, hashSalesSecret(TOKEN), "no banco fica so o SHA-256 do token, como na Hotmart");
  assert.notEqual(row.secret, TOKEN, "o token em texto puro nunca e gravado");
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
  assert.equal("token" in evento.payload, false, "o token nao fica no payload guardado");
  assert.equal("direct_login_url" in evento.payload, false, "o link de login direto nao fica");
  assert.equal("cpf" in evento.payload.customer, false, "o CPF nao fica no payload guardado");
  assert.equal(JSON.stringify(evento.payload).includes(TOKEN), false);
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

test("assinatura: renovacao vira outro vinculo da mesma assinatura; o cancelamento fecha a assinatura inteira e suspende; a reativacao reabre o vinculo e um reembolso depois revoga", async () => {
  const comum = { assinatura: "5001", email: ASSINANTE.email, nome: ASSINANTE.nome };

  const compra = await post(payload({ ...comum, transacao: "T0002" }));
  assert.equal((await compra.json()).outcome, "access_granted");
  // Cobranca do mes seguinte: outra transacao da mesma assinatura (o acesso ja estava aberto).
  const renovacao = await post(payload({ ...comum, statusDate: "2026-11-17 09:00:00", transacao: "T0003" }));
  assert.equal((await renovacao.json()).outcome, "access_granted");
  assert.deepEqual(
    (await vinculosDe(["T0002", "T0003"])).map((row) => [row.transaction_id, row.opened, row.subscription_code, row.closed_by]),
    [
      [`${PREFIXO}T0002`, true, "5001", null],
      [`${PREFIXO}T0003`, false, "5001", null]
    ],
    "a compra abriu o acesso; a renovacao so o manteve"
  );

  // O cancelamento da Ticto traz a transacao da ultima cobranca, mas fecha a assinatura inteira.
  const cancelada = await post(payload({ ...comum, status: "subscription_canceled", statusDate: "2026-11-20 10:00:00", transacao: "T0003" }));
  assert.equal((await cancelada.json()).outcome, "access_suspended");
  assert.deepEqual((await acessosDe(ASSINANTE.email)).acessos.map((row) => [row.target_id, row.status]), [[curso.id, "suspended"]]);
  assert.deepEqual((await vinculosDe(["T0002", "T0003"])).map((row) => row.closed_by), ["subscription_canceled", "subscription_canceled"]);

  const reativada = await post(payload({ ...comum, status: "uncanceled", statusDate: "2026-11-21 10:00:00", transacao: "T0003" }));
  assert.equal((await reativada.json()).outcome, "access_granted");
  assert.deepEqual((await acessosDe(ASSINANTE.email)).acessos.map((row) => [row.target_id, row.status]), [[curso.id, "active"]]);
  assert.deepEqual(
    (await vinculosDe(["T0003"])).map((row) => [row.opened, row.closed_by]),
    [[true, null]],
    "a reativacao reabre o vinculo da cobranca, agora como quem abriu o acesso"
  );

  const fila = await filaDe(ASSINANTE.email);
  assert.deepEqual(fila.slice(0, 2).map((row) => row.kind), ["welcome", "purchase"]);
  assert.equal(new Set(fila.map((row) => row.idempotency_key)).size, fila.length, "nenhum e-mail repetido");

  // Reembolso da cobranca reativada: o vinculo reaberto e achado e o acesso sai.
  const reembolso = await post(payload({ ...comum, status: "refunded", statusDate: "2026-11-25 10:00:00", transacao: "T0003" }));
  const reembolsoBody = await reembolso.json();
  assert.equal(reembolsoBody.outcome, "access_revoked", JSON.stringify(reembolsoBody));
  assert.deepEqual((await acessosDe(ASSINANTE.email)).acessos.map((row) => [row.target_id, row.status]), [[curso.id, "revoked"]]);
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

  assert.deepEqual(
    (await vinculosDe(["T-BUMP-0001"])).map((row) => [row.product_id, row.opened, row.closed_by]).sort((left, right) => left[0].localeCompare(right[0])),
    [
      [curso.id, true, null],
      [cursoBloqueado.id, true, null]
    ].sort((left, right) => left[0].localeCompare(right[0])),
    "o principal e o bump viram vinculos da mesma venda"
  );

  const reembolso = await post(payload({ bumps, email: COMPRADOR_BUMP.email, status: "refunded", statusDate: "2026-10-19 10:00:00", transacao: "T-BUMP-0001" }));
  assert.equal((await reembolso.json()).outcome, "access_revoked");
  assert.deepEqual(
    porProduto((await acessosDe(COMPRADOR_BUMP.email)).acessos).map(([target, status]) => [target, status]),
    [[curso.id, "revoked"], [cursoBloqueado.id, "revoked"]].sort((left, right) => left[0].localeCompare(right[0])),
    "o reembolso do pedido tira o principal e o bump"
  );
  assert.deepEqual((await vinculosDe(["T-BUMP-0001"])).map((row) => row.closed_by), ["refund", "refund"], "os dois vinculos da venda fecham pelo reembolso");
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
  assert.match(linha.outcome_detail, /libere o principal à mão em Alunos/, "o detalhe diz o que fazer com o principal");
});

test("reativacao depois de a equipe revogar nao reabre o acesso: fica ignorada com o motivo, e o reembolso depois nao mexe em nada", async () => {
  const comum = { assinatura: "7101", email: COMPRADOR_EQUIPE.email, nome: COMPRADOR_EQUIPE.nome, transacao: "T-EQUIPE-0001" };
  const statusDoCurso = async () => Object.fromEntries((await acessosDe(COMPRADOR_EQUIPE.email)).acessos.map((row) => [row.target_id, row.status]))[curso.id];

  assert.equal((await (await post(payload(comum))).json()).outcome, "access_granted");
  assert.equal((await (await post(payload({ ...comum, status: "subscription_canceled", statusDate: "2026-11-20 10:00:00" }))).json()).outcome, "access_suspended");

  // A equipe revoga o curso em Alunos: os vinculos da venda passam a ser da equipe (admin).
  actAs(produtor);
  const { conta } = await acessosDe(COMPRADOR_EQUIPE.email);
  const acesso = unwrap(await db.from("entitlements").select("id").eq("user_id", conta.id).eq("target_id", curso.id).single(), "Lendo o acesso do curso");
  const revogado = await studentActions.updateStudentAccess({ action: "revoke", entitlementId: acesso.id, userId: conta.id });
  assert.equal(revogado.ok, true, JSON.stringify(revogado));
  assert.deepEqual((await vinculosDe(["T-EQUIPE-0001"])).map((row) => row.closed_by), ["admin"]);

  // Reativacao na Ticto: nao e compra nova; a decisao da equipe vale.
  const reativada = await (await post(payload({ ...comum, status: "uncanceled", statusDate: "2026-11-21 10:00:00" }))).json();
  assert.equal(reativada.outcome, "ignored", JSON.stringify(reativada));
  assert.equal(await statusDoCurso(), "revoked", "a reativacao nao desfaz a revogacao da equipe");
  const linha = (await eventos()).find((row) => row.external_event_id.startsWith(`${PREFIXO}T-EQUIPE-0001:${CODIGOS.curso}:uncanceled`));
  assert.match(linha.outcome_detail, /a equipe já decidiu sobre esse acesso depois do cancelamento/);
  assert.deepEqual((await vinculosDe(["T-EQUIPE-0001"])).map((row) => row.closed_by), ["admin"], "o vinculo continua da equipe");

  // Reembolso depois: nada a desfazer, a equipe ja decidiu.
  const reembolso = await (await post(payload({ ...comum, status: "refunded", statusDate: "2026-11-25 10:00:00" }))).json();
  assert.equal(reembolso.outcome, "ignored", JSON.stringify(reembolso));
  assert.equal(await statusDoCurso(), "revoked");
});

test("order bump numa compra de assinatura e cobranca unica: o cancelamento suspende o principal e mantem o bump; o reembolso da compra tira os dois", async () => {
  const comum = { assinatura: "7201", bumps: [{ product_id: Number(CODIGOS.bump), product_name: "Bonus na Ticto" }], email: COMPRADOR_ASSINA_BUMP.email, nome: COMPRADOR_ASSINA_BUMP.nome, transacao: "T-ASSBUMP-0001" };
  const status = async () => Object.fromEntries((await acessosDe(COMPRADOR_ASSINA_BUMP.email)).acessos.map((row) => [row.target_id, row.status]));

  assert.equal((await (await post(payload(comum))).json()).outcome, "access_granted");
  assert.deepEqual(
    Object.fromEntries((await vinculosDe(["T-ASSBUMP-0001"])).map((row) => [row.product_id, row.subscription_code])),
    { [curso.id]: "7201", [cursoBloqueado.id]: null },
    "so o item principal leva o codigo da assinatura"
  );

  const cancelada = await (await post(payload({ ...comum, status: "subscription_canceled", statusDate: "2026-11-20 10:00:00" }))).json();
  assert.equal(cancelada.outcome, "access_suspended", JSON.stringify(cancelada));
  assert.deepEqual(await status(), { [curso.id]: "suspended", [cursoBloqueado.id]: "active" }, "o bump pago uma vez continua aberto");

  const reembolso = await (await post(payload({ ...comum, status: "refunded", statusDate: "2026-11-25 10:00:00" }))).json();
  assert.equal(reembolso.outcome, "access_revoked", JSON.stringify(reembolso));
  assert.deepEqual(await status(), { [curso.id]: "revoked", [cursoBloqueado.id]: "revoked" }, "o reembolso da compra tira o principal e o bump");
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

/* ------------------------------------------------------------ Duas plataformas */

test("reembolso da Ticto so tira o que nasceu da compra na Ticto: o curso pago antes na Hotmart continua aberto", async () => {
  actAs(produtor);
  const conectada = await salesActions.saveSalesSecret({ provider: "hotmart", secret: TOKEN_HOTMART });
  assert.equal(conectada.ok, true, JSON.stringify(conectada));

  // 1) Compra avulsa do curso na Hotmart (codigo 7001, gravado no teste do Acesso e venda).
  const naHotmart = await hotmartRoute.POST(
    new Request("http://127.0.0.1:3100/api/webhooks/hotmart", {
      body: JSON.stringify({
        creation_date: Date.now(),
        data: {
          buyer: { email: COMPRADOR_MISTO.email, name: COMPRADOR_MISTO.nome },
          product: { id: 7001, name: "Curso na Hotmart" },
          purchase: { approved_date: Date.now(), status: "APPROVED", transaction: `${PREFIXO}HP-MISTO-0001` }
        },
        event: "PURCHASE_APPROVED",
        id: `${PREFIXO}hotmart-misto-1`,
        version: "2.0.0"
      }),
      headers: { "content-type": "application/json", host: "127.0.0.1:3100", "x-hotmart-hottok": TOKEN_HOTMART },
      method: "POST"
    })
  );
  const naHotmartBody = await naHotmart.json();
  assert.equal(naHotmart.status, 200, JSON.stringify(naHotmartBody));
  assert.equal(naHotmartBody.outcome, "access_granted");

  // 2) Pedido na Ticto com o mesmo curso como principal e o curso bloqueado como bump.
  const bumps = [{ product_id: Number(CODIGOS.bump), product_name: "Bonus na Ticto" }];
  const naTicto = await post(payload({ bumps, email: COMPRADOR_MISTO.email, nome: COMPRADOR_MISTO.nome, transacao: "T-MISTO-0001" }));
  assert.equal((await naTicto.json()).outcome, "access_granted");

  const antes = Object.fromEntries((await acessosDe(COMPRADOR_MISTO.email)).acessos.map((row) => [row.target_id, row]));
  assert.equal(antes[curso.id].source_provider, "hotmart", "o curso que ja estava aberto continua com a origem da Hotmart");
  assert.equal(antes[cursoBloqueado.id].source_provider, "ticto");

  // 3) Reembolso do pedido na Ticto.
  const reembolso = await post(payload({ bumps, email: COMPRADOR_MISTO.email, status: "refunded", statusDate: "2026-10-20 10:00:00", transacao: "T-MISTO-0001" }));
  const reembolsoBody = await reembolso.json();
  assert.equal(reembolsoBody.outcome, "access_revoked", JSON.stringify(reembolsoBody));

  const depois = Object.fromEntries((await acessosDe(COMPRADOR_MISTO.email)).acessos.map((row) => [row.target_id, row.status]));
  assert.equal(depois[curso.id], "active", "o curso pago na Hotmart nao e revogado pelo reembolso da Ticto");
  assert.equal(depois[cursoBloqueado.id], "revoked", "o que nasceu da compra na Ticto sai");

  // 4) Chargeback repetido na Ticto tambem nao alcanca o acesso da Hotmart.
  const chargeback = await post(payload({ bumps, email: COMPRADOR_MISTO.email, status: "chargeback", statusDate: "2026-10-21 10:00:00", transacao: "T-MISTO-0001" }));
  assert.equal((await chargeback.json()).outcome, "ignored");
  assert.equal(Object.fromEntries((await acessosDe(COMPRADOR_MISTO.email)).acessos.map((row) => [row.target_id, row.status]))[curso.id], "active");
});

/** Evento ficticio da Hotmart (webhook 2.0) para o comprador informado, pela rota de verdade. */
async function postHotmart({ email, event, id, nome, transaction }) {
  const response = await hotmartRoute.POST(
    new Request("http://127.0.0.1:3100/api/webhooks/hotmart", {
      body: JSON.stringify({
        creation_date: Date.now(),
        data: {
          buyer: { email, name: nome },
          product: { id: 7001, name: "Curso na Hotmart" },
          purchase: { approved_date: Date.now(), status: event === "PURCHASE_APPROVED" ? "APPROVED" : "REFUNDED", transaction }
        },
        event,
        id,
        version: "2.0.0"
      }),
      headers: { "content-type": "application/json", host: "127.0.0.1:3100", "x-hotmart-hottok": TOKEN_HOTMART },
      method: "POST"
    })
  );

  return { body: await response.json(), status: response.status };
}

test("assinatura da Ticto reativada volta a sustentar o acesso: o reembolso da compra da Hotmart depois nao tira o curso", async () => {
  // A Hotmart ja foi conectada no teste das duas plataformas; o curso tem o codigo 7001 na Hotmart e 8001 na Ticto.
  const transacaoHotmart = `${PREFIXO}HP-REATIVA-0001`;
  const comum = { assinatura: "6001", email: COMPRADOR_REATIVA.email, nome: COMPRADOR_REATIVA.nome, transacao: "T-REATIVA-0001" };
  const statusDoCurso = async () => Object.fromEntries((await acessosDe(COMPRADOR_REATIVA.email)).acessos.map((row) => [row.target_id, row.status]))[curso.id];

  // 1) Compra avulsa na Hotmart abre o curso.
  const compraHotmart = await postHotmart({ email: COMPRADOR_REATIVA.email, event: "PURCHASE_APPROVED", id: `${PREFIXO}hotmart-reativa-1`, nome: COMPRADOR_REATIVA.nome, transaction: transacaoHotmart });
  assert.equal(compraHotmart.body.outcome, "access_granted", JSON.stringify(compraHotmart.body));

  // 2) Assinatura do mesmo curso na Ticto: o acesso ja estava aberto, a assinatura passa a sustenta-lo tambem.
  assert.equal((await (await post(payload(comum))).json()).outcome, "access_granted");

  // 3) Cancelamento da assinatura: a compra da Hotmart sustenta, o curso fica.
  const cancelada = await (await post(payload({ ...comum, status: "subscription_canceled", statusDate: "2026-11-20 10:00:00" }))).json();
  assert.equal(cancelada.outcome, "ignored", JSON.stringify(cancelada));
  assert.equal(await statusDoCurso(), "active");
  assert.deepEqual((await vinculosDe(["T-REATIVA-0001"])).map((row) => row.closed_by), ["subscription_canceled"]);

  // 4) Reativacao: o vinculo da assinatura volta a valer.
  assert.equal((await (await post(payload({ ...comum, status: "uncanceled", statusDate: "2026-11-21 10:00:00" }))).json()).outcome, "access_granted");
  assert.deepEqual((await vinculosDe(["T-REATIVA-0001"])).map((row) => [row.opened, row.closed_by]), [[false, null]], "reaberto, como venda que so manteve um acesso ja aberto");

  // 5) Reembolso da compra da Hotmart: a assinatura reativada da Ticto sustenta o curso.
  const reembolsoHotmart = await postHotmart({ email: COMPRADOR_REATIVA.email, event: "PURCHASE_REFUNDED", id: `${PREFIXO}hotmart-reativa-2`, nome: COMPRADOR_REATIVA.nome, transaction: transacaoHotmart });
  assert.equal(reembolsoHotmart.status, 200, JSON.stringify(reembolsoHotmart.body));
  assert.equal(reembolsoHotmart.body.outcome, "ignored", JSON.stringify(reembolsoHotmart.body));
  assert.equal(await statusDoCurso(), "active", "sem reabrir o vinculo na reativacao, este reembolso revogaria o curso que a assinatura paga");
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

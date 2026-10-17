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
  limparVendasDeTeste,
  seedEscolaDeTeste,
  usuarioDeTeste
} from "../fixtures/escola-de-teste.mjs";

// Vendas pela Hotmart (docs/04, secao Webhooks externos; docs/17 §1.10) contra o banco LOCAL de verdade:
// sem plataforma conectada a rota recusa; o dono guarda o token pela Server Action e informa o codigo
// do produto no Acesso e venda; a compra aprovada (payload FICTICIO) cria a conta, libera o produto e
// deixa boas-vindas e compra na fila de e-mail; o mesmo evento de novo nao duplica; reembolso revoga;
// pacote libera e revoga todos os produtos; produto sem codigo e ignorado e reprocessa depois de ligado;
// evento sem e-mail falha e fica guardado; desconectar volta a recusar. Nenhum e-mail sai.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const route = await import("../../src/app/api/webhooks/hotmart/route.ts");
const salesActions = await import("../../src/server/payments/actions.ts");
const salesQueries = await import("../../src/server/payments/queries.ts");
const productActions = await import("../../src/server/catalog/product-actions.ts");
const catalogQueries = await import("../../src/server/catalog/queries.ts");
const permissions = await import("../../src/server/auth/permissions.ts");
const studentQueries = await import("../../src/server/students/queries.ts");

const { curso, cursoBloqueado, cursoLiberacao } = ESCOLA_DE_TESTE;
const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const TOKEN = "hottok-integracao-0123456789abcdef";
const CODIGOS = { curso: "7001", pacote: "7002", semLigacao: "7999" };
const COMPRADOR = { email: "comprador.hotmart@bunker707.test", nome: "Comprador da Hotmart" };
const COMPRADOR_PACOTE = { email: "comprador.pacote@bunker707.test", nome: "Comprador do Pacote" };
const PREFIXO = "teste-hotmart-";

/** Payload ficticio no formato do webhook 2.0 da Hotmart. */
function payload({ email = COMPRADOR.email, event = "PURCHASE_APPROVED", id, nome = COMPRADOR.nome, produto = CODIGOS.curso, transaction = "HP-TESTE-0001" }) {
  return {
    creation_date: Date.now(),
    data: {
      buyer: { checkout_phone: "11999990000", checkout_phone_code: "55", email, name: nome },
      product: { id: Number(produto), name: `Produto ${produto} na Hotmart` },
      purchase: { approved_date: Date.now(), order_date: Date.now(), status: event === "PURCHASE_APPROVED" ? "APPROVED" : "REFUNDED", transaction }
    },
    event,
    id: `${PREFIXO}${id}`,
    version: "2.0.0"
  };
}

function post(body, token = TOKEN) {
  const headers = { "content-type": "application/json", host: "127.0.0.1:3100" };

  if (token) {
    headers["x-hotmart-hottok"] = token;
  }

  return route.POST(new Request("http://127.0.0.1:3100/api/webhooks/hotmart", { body: JSON.stringify(body), headers, method: "POST" }));
}

async function eventos() {
  return unwrap(
    await db.from("webhook_events").select("id,external_event_id,event_type,processing_status,outcome,outcome_detail,error_message,product_id,combo_id,user_id,buyer_email").like("external_event_id", `${PREFIXO}%`).order("received_at"),
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
  return unwrap(await db.from("integration_settings").select("status,secret_status,secret,last_sync_at,last_error,webhook_url").eq("provider", "hotmart").single(), "Lendo a Hotmart");
}

async function limpar() {
  await desconectarVendas(db);
  await limparVendasDeTeste(db, { codigos: Object.values(CODIGOS), prefixoDoEvento: PREFIXO });
  unwrap(await db.from("email_outbox").delete().in("to_email", [COMPRADOR.email, COMPRADOR_PACOTE.email]), "Limpando a fila de e-mail de teste");

  for (const conta of [COMPRADOR, COMPRADOR_PACOTE]) {
    await apagarContaDeTeste(db, conta.email);
  }
}

before(limpar);
after(limpar);

/* ------------------------------------------------------------ Conectar */

test("sem a Hotmart conectada, o webhook responde 503 e nao grava nada", async () => {
  const response = await post(payload({ id: "sem-conexao" }));

  assert.equal(response.status, 503);
  assert.equal((await eventos()).length, 0);
});

test("so o dono guarda o token: analista recebe 403; o token nao volta para a tela, so a data", async () => {
  actAs(analista);
  const recusa = await salesActions.saveSalesSecret({ provider: "hotmart", secret: TOKEN });
  assert.equal(recusa.ok, false);
  assert.equal(recusa.status, 403);
  await assert.rejects(permissions.requirePageRole("settings.sales", "/admin/configuracoes"), /redirect:\/admin\/configuracoes/);

  actAs(produtor);
  const curto = await salesActions.saveSalesSecret({ provider: "hotmart", secret: "curto" });
  assert.equal(curto.status, 400);
  assert.ok(curto.fieldErrors?.secret, "token curto aponta o campo");

  const result = await salesActions.saveSalesSecret({ provider: "hotmart", secret: TOKEN });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.webhookUrl, "http://127.0.0.1:3100/api/webhooks/hotmart");

  const row = await integracao();
  assert.equal(row.status, "configured");
  assert.equal(row.secret_status, "set");
  assert.equal(row.secret, TOKEN, "o segredo fica no banco, so para o servidor");

  const data = await salesQueries.getSalesSettingsData();
  const hotmart = data.providers.find((card) => card.provider === "hotmart");
  assert.equal(hotmart.status, "configured");
  assert.ok(hotmart.secretUpdatedAt, "a tela recebe a data em que o token foi guardado");
  assert.equal("secret" in hotmart, false, "a tela nunca recebe o token");
  assert.deepEqual(data.providers.filter((card) => !card.supported).map((card) => card.provider), ["ticto", "kiwify"]);
});

test("token errado ou ausente responde 401 e nao grava o evento", async () => {
  assert.equal((await post(payload({ id: "token-errado" }), "outro-token-errado-0123456789")).status, 401);
  assert.equal((await post(payload({ id: "sem-token" }), null)).status, 401);
  assert.equal((await eventos()).length, 0);
});

/* ------------------------------------------------------------ Compra aprovada */

test("dono informa o codigo da Hotmart no Acesso e venda do curso; codigo repetido em outro produto e recusado no campo", async () => {
  actAs(produtor);
  const access = await catalogQueries.getProductAccess(curso.id);
  assert.equal(access.hotmartProductId, null);

  const saved = await productActions.updateProductAccess({ expectedUpdatedAt: access.header.updatedAt, hotmartProductId: CODIGOS.curso, id: curso.id });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal((await catalogQueries.getProductAccess(curso.id)).hotmartProductId, CODIGOS.curso);

  const outro = await catalogQueries.getProductAccess(cursoBloqueado.id);
  const repetido = await productActions.updateProductAccess({ expectedUpdatedAt: outro.header.updatedAt, hotmartProductId: CODIGOS.curso, id: cursoBloqueado.id });
  assert.equal(repetido.ok, false);
  assert.equal(repetido.status, 400);
  assert.match(repetido.fieldErrors?.hotmartProductId?.[0] ?? "", /já está ligado/);
});

test("compra aprovada cria a conta, libera o curso e deixa boas-vindas e compra na fila; o produto sem codigo e ignorado com o motivo", async () => {
  const response = await post(payload({ id: "compra-1" }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.outcome, "access_granted");

  const { acessos, conta } = await acessosDe(COMPRADOR.email);
  assert.ok(conta, "a conta nasceu no Auth local");
  assert.deepEqual(acessos, [{ source_event_id: "HP-TESTE-0001", source_provider: "hotmart", status: "active", target_id: curso.id }]);

  const perfil = unwrap(await db.from("profiles").select("full_name,phone").eq("id", conta.id).single(), "Lendo o perfil");
  assert.deepEqual(perfil, { full_name: COMPRADOR.nome, phone: "+55 11999990000" });

  const fila = await filaDe(COMPRADOR.email);
  assert.deepEqual(fila.map((row) => [row.kind, row.status]), [["welcome", "queued"], ["purchase", "queued"]]);
  assert.equal(fila[1].idempotency_key, `purchase:hotmart:HP-TESTE-0001:${conta.id}`);
  assert.match(fila[1].html, new RegExp(`/conteudo/${curso.id}`));

  const [evento] = await eventos();
  assert.equal(evento.processing_status, "processed");
  assert.equal(evento.outcome, "access_granted");
  assert.equal(evento.product_id, curso.id);
  assert.equal(evento.user_id, conta.id);
  assert.equal(evento.buyer_email, COMPRADOR.email);

  const row = await integracao();
  assert.ok(row.last_sync_at, "a plataforma registra a ultima venda");
  assert.equal(row.status, "configured");

  const detail = await studentQueries.getStudentDetail(conta.id);
  assert.equal(detail.accesses[0].sourceProvider, "hotmart");
  assert.ok(detail.timeline.some((item) => /Conta criada pela venda \(Hotmart\)/.test(item.text)), "o historico mostra a origem Hotmart");
  assert.ok(detail.timeline.some((item) => /Acesso liberado: .* \(Hotmart\)/.test(item.text)));

  const ignorado = await post(payload({ id: "sem-ligacao", produto: CODIGOS.semLigacao, transaction: "HP-TESTE-0009" }));
  assert.equal(ignorado.status, 200);
  assert.equal((await ignorado.json()).outcome, "ignored");
  const linha = (await eventos()).find((row) => row.external_event_id === `${PREFIXO}sem-ligacao`);
  assert.equal(linha.processing_status, "ignored");
  assert.match(linha.outcome_detail, /7999 \(Produto 7999 na Hotmart\) da Hotmart não está ligado/);
  assert.equal((await acessosDe(COMPRADOR.email)).acessos.length, 1, "nada foi liberado para o produto sem codigo");
});

test("o mesmo evento entregue de novo responde 200 sem reprocessar: um acesso, dois e-mails, uma linha", async () => {
  const response = await post(payload({ id: "compra-1" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { duplicate: true, ok: true });

  assert.equal((await acessosDe(COMPRADOR.email)).acessos.length, 1);
  assert.equal((await filaDe(COMPRADOR.email)).length, 2);
  assert.equal((await eventos()).filter((row) => row.external_event_id === `${PREFIXO}compra-1`).length, 1);
});

test("reembolso revoga o acesso ao curso e fica registrado como revogado", async () => {
  const response = await post(payload({ event: "PURCHASE_REFUNDED", id: "reembolso-1" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).outcome, "access_revoked");

  const { acessos } = await acessosDe(COMPRADOR.email);
  assert.deepEqual(acessos.map((row) => [row.target_id, row.status]), [[curso.id, "revoked"]]);
  assert.equal((await eventos()).find((row) => row.external_event_id === `${PREFIXO}reembolso-1`).outcome, "access_revoked");

  const repetido = await post(payload({ event: "PURCHASE_REFUNDED", id: "reembolso-2", transaction: "HP-TESTE-0001" }));
  assert.equal((await repetido.json()).outcome, "ignored", "revogar de novo nao muda nada");
});

/* ------------------------------------------------------------ Pacote */

test("pacote: a compra libera todos os produtos de uma vez (um e-mail so) e o chargeback revoga todos", async () => {
  await garantirPacoteDeTeste(db, CODIGOS.pacote);

  const compra = await post(payload({ email: COMPRADOR_PACOTE.email, id: "pacote-compra", nome: COMPRADOR_PACOTE.nome, produto: CODIGOS.pacote, transaction: "HP-PACOTE-0001" }));
  const compraBody = await compra.json();
  assert.equal(compra.status, 200, JSON.stringify(compraBody));
  assert.equal(compraBody.outcome, "access_granted");

  const { acessos, conta } = await acessosDe(COMPRADOR_PACOTE.email);
  assert.deepEqual(
    acessos.map((row) => [row.target_id, row.status, row.source_event_id]),
    [
      [cursoBloqueado.id, "active", `HP-PACOTE-0001:${cursoBloqueado.id}`],
      [cursoLiberacao.id, "active", `HP-PACOTE-0001:${cursoLiberacao.id}`]
    ],
    "cada produto do pacote tem o proprio id de origem"
  );

  const fila = await filaDe(COMPRADOR_PACOTE.email);
  assert.deepEqual(fila.map((row) => row.kind), ["welcome", "purchase"], "um e-mail de compra para o pacote inteiro");
  assert.match(fila[1].html, new RegExp(cursoLiberacao.titulo));
  assert.match(fila[1].html, new RegExp(cursoBloqueado.titulo));

  const linha = (await eventos()).find((row) => row.external_event_id === `${PREFIXO}pacote-compra`);
  assert.equal(linha.combo_id, PACOTE_DE_TESTE.id);
  assert.equal(linha.user_id, conta.id);
  assert.match(linha.outcome_detail, /2 produtos/);

  const chargeback = await post(payload({ email: COMPRADOR_PACOTE.email, event: "PURCHASE_CHARGEBACK", id: "pacote-chargeback", produto: CODIGOS.pacote, transaction: "HP-PACOTE-0001" }));
  assert.equal((await chargeback.json()).outcome, "access_revoked");
  assert.deepEqual(
    (await acessosDe(COMPRADOR_PACOTE.email)).acessos.map((row) => row.status),
    ["revoked", "revoked"],
    "o chargeback do pacote tira todos os produtos"
  );
});

test("pacote pausado: a venda chega, fica ignorada com o motivo e nao libera nada", async () => {
  unwrap(await db.from("product_combos").update({ status: "paused" }).eq("id", PACOTE_DE_TESTE.id), "Pausando o pacote de teste");

  const response = await post(payload({ email: COMPRADOR_PACOTE.email, id: "pacote-pausado", produto: CODIGOS.pacote, transaction: "HP-PACOTE-0002" }));
  assert.equal((await response.json()).outcome, "ignored");
  const linha = (await eventos()).find((row) => row.external_event_id === `${PREFIXO}pacote-pausado`);
  assert.match(linha.outcome_detail, /está pausado/);
  assert.deepEqual((await acessosDe(COMPRADOR_PACOTE.email)).acessos.map((row) => row.status), ["revoked", "revoked"]);
});

/* ------------------------------------------------------------ Reprocessar e falhas */

test("depois de ligar o codigo ao produto, Reprocessar libera a venda que estava ignorada", async () => {
  actAs(produtor);
  const ignorada = (await eventos()).find((row) => row.external_event_id === `${PREFIXO}sem-ligacao`);
  const access = await catalogQueries.getProductAccess(cursoBloqueado.id);
  const ligado = await productActions.updateProductAccess({ expectedUpdatedAt: access.header.updatedAt, hotmartProductId: CODIGOS.semLigacao, id: cursoBloqueado.id });
  assert.equal(ligado.ok, true, JSON.stringify(ligado));

  const result = await salesActions.reprocessSalesEvent({ id: ignorada.id });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.ok, true);
  assert.equal(result.data.outcome, "access_granted");

  const { acessos } = await acessosDe(COMPRADOR.email);
  assert.deepEqual(
    acessos.map((row) => [row.target_id, row.status]),
    [[curso.id, "revoked"], [cursoBloqueado.id, "active"]]
  );
  const linha = (await eventos()).find((row) => row.external_event_id === `${PREFIXO}sem-ligacao`);
  assert.equal(linha.processing_status, "processed");
  assert.equal(linha.product_id, cursoBloqueado.id);

  const deNovo = await salesActions.reprocessSalesEvent({ id: ignorada.id });
  assert.equal(deNovo.status, 409, "venda ja processada nao reprocessa");
});

test("evento sem e-mail valido falha: 500, linha guardada com o motivo, plataforma precisa de atencao; Reprocessar conta a falha de novo", async () => {
  const response = await post(payload({ email: "nao-e-um-email", id: "sem-email", transaction: "HP-TESTE-0100" }));
  assert.equal(response.status, 500);

  const linha = (await eventos()).find((row) => row.external_event_id === `${PREFIXO}sem-email`);
  assert.equal(linha.processing_status, "failed");
  assert.equal(linha.outcome, "failed");
  assert.match(linha.error_message, /sem um e-mail válido/);

  const row = await integracao();
  assert.equal(row.status, "needs_attention");
  assert.match(row.last_error, /sem um e-mail válido/);

  actAs(produtor);
  const result = await salesActions.reprocessSalesEvent({ id: linha.id });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.ok, false);
  assert.equal(result.data.processingStatus, "failed");

  const data = await salesQueries.getSalesSettingsData();
  const item = data.events.find((event) => event.id === linha.id);
  assert.equal(item.canReprocess, true);
  assert.equal(item.productTitle, curso.titulo, "a lista mostra o produto da escola ligado ao codigo");
  const sucesso = (await post(payload({ id: "compra-de-volta", transaction: "HP-TESTE-0200" }))).status;
  assert.equal(sucesso, 200);
  assert.equal((await integracao()).status, "configured", "um evento certo depois do erro volta a situacao para conectada");
});

test("eventos que nao mudam acesso ficam guardados como ignorados; JSON invalido e 400", async () => {
  const boleto = await post(payload({ event: "PURCHASE_BILLET_PRINTED", id: "boleto", transaction: "HP-TESTE-0300" }));
  assert.equal((await boleto.json()).outcome, "ignored");
  assert.match((await eventos()).find((row) => row.external_event_id === `${PREFIXO}boleto`).outcome_detail, /não muda o acesso/);

  const invalido = await route.POST(
    new Request("http://127.0.0.1:3100/api/webhooks/hotmart", { body: "{nao-e-json", headers: { "content-type": "application/json", "x-hotmart-hottok": TOKEN }, method: "POST" })
  );
  assert.equal(invalido.status, 400);
});

test("Hoje: a origem dos acessos do periodo separa Hotmart de equipe", async () => {
  const { data, error } = await db.rpc("admin_access_origins", {
    p_content_id: null,
    p_end: new Date(Date.now() + 60_000).toISOString(),
    p_start: new Date(Date.now() - 3_600_000).toISOString()
  });
  assert.equal(error, null, error?.message);
  const hotmart = data.find((row) => row.source_provider === "hotmart");
  assert.ok(hotmart && Number(hotmart.total) >= 3, JSON.stringify(data));
});

test("desconectar apaga o token e o webhook volta a responder 503", async () => {
  actAs(produtor);
  const result = await salesActions.disconnectSalesProvider({ provider: "hotmart" });
  assert.equal(result.ok, true);

  const row = await integracao();
  assert.equal(row.status, "not_configured");
  assert.equal(row.secret, null);
  assert.equal(row.secret_status, "missing");
  assert.equal((await post(payload({ id: "depois-de-desconectar" }))).status, 503);
});

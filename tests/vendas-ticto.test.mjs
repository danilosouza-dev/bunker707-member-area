import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Vendas pela Ticto (docs/04, secao Webhooks externos; docs/17 §1.10), regras puras: o adaptador le o
// webhook 2.0 (payloads FICTICIOS, nenhum dado real), monta a chave de idempotencia sem id de evento,
// confere o token do corpo em tempo constante, esconde o que e segredo ou dado pessoal demais no payload
// guardado, e o modelo da tela rotula as situacoes da Ticto.

const ticto = await import("../src/server/payments/ticto.ts");
const model = await import("../src/server/payments/model.ts");
const adapters = await import("../src/server/payments/adapters.ts");

const TOKEN = "token-ticto-de-teste-0123456789abcdef";

/** Payload ficticio no formato do webhook 2.0 da Ticto (datas "AAAA-MM-DD HH:MM:SS" no horario de Brasilia). */
function compraAprovada(overrides = {}) {
  return {
    commission_type: "producer",
    customer: {
      cnpj: null,
      code: "UE-TESTE",
      cpf: "00000000000",
      email: "  Comprador.Teste@Bunker707.test ",
      name: "Comprador de Teste",
      phone: { ddd: "11", ddi: "55", number: "999990000" },
      type: "person"
    },
    direct_login_url: "https://exemplo.test/entrar-direto",
    item: { amount: 19700, offer_code: "OFERTA01", offer_id: 262, offer_name: "Oferta 1", product_id: 268, product_name: "Curso Ficticio", quantity: 1, refund_deadline: 7 },
    order: { hash: "TOC-TESTE-0001", id: 710, installments: 1, order_date: "2026-10-17 09:00:06", paid_amount: 19700, transaction_hash: "TPC-TESTE-0001" },
    payment_method: "pix",
    status: "authorized",
    status_date: "2026-10-17 09:00:14",
    token: TOKEN,
    transaction: { cards: [], hash: "TPC-TESTE-0001" },
    version: "2.0",
    ...overrides
  };
}

test("compra aprovada: evento normalizado com comprador, produto, transacao e datas de Brasilia em UTC", () => {
  const event = ticto.normalizeTictoEvent(compraAprovada());

  assert.deepEqual(event, {
    buyer: { email: "comprador.teste@bunker707.test", name: "Comprador de Teste", phone: "+55 11999990000" },
    eventId: "TPC-TESTE-0001:authorized:2026-10-17 09:00:14",
    externalProductId: "268",
    externalProductName: "Curso Ficticio",
    occurredAt: "2026-10-17T12:00:14.000Z",
    provider: "ticto",
    purchasedAt: "2026-10-17T12:00:06.000Z",
    rawType: "authorized",
    transactionId: "TPC-TESTE-0001",
    type: "purchase_approved",
    warrantyEndsAt: "2026-10-24T12:00:06.000Z"
  });
});

test("cada situacao da Ticto vira o que ela significa para o acesso; o resto e 'other'", () => {
  const typeOf = (status) => ticto.normalizeTictoEvent(compraAprovada({ status })).type;

  assert.equal(typeOf("authorized"), "purchase_approved");
  assert.equal(typeOf("AUTHORIZED"), "purchase_approved", "caixa nao importa");
  assert.equal(typeOf("uncanceled"), "purchase_approved", "assinatura reativada devolve o acesso");
  assert.equal(typeOf("refunded"), "refund");
  assert.equal(typeOf("chargeback"), "chargeback");
  assert.equal(typeOf("subscription_canceled"), "subscription_canceled");

  for (const other of ["pix_created", "bank_slip_created", "waiting_payment", "refused", "claimed", "subscription_delayed", "trial_started", "all_charges_paid", "abandoned_cart", "evento_novo"]) {
    assert.equal(typeOf(other), "other", other);
  }

  assert.equal(ticto.normalizeTictoEvent(compraAprovada({ status: "Refunded" })).rawType, "refunded", "o nome guardado e em minusculas, como a Ticto manda");
  assert.deepEqual([...ticto.TICTO_HANDLED_EVENTS], ["authorized", "uncanceled", "refunded", "chargeback", "subscription_canceled"]);
});

test("sem id de evento, a transacao (ou o pedido) + situacao + data identificam a entrega; sem nada disso nao vira evento", () => {
  assert.equal(ticto.normalizeTictoEvent(null), null);
  assert.equal(ticto.normalizeTictoEvent({ order: {} }), null, "sem status nao da para saber o que aconteceu");
  assert.equal(ticto.normalizeTictoEvent({ status: "authorized", item: { product_id: 1 } }), null, "sem transacao nem pedido nao da para deduplicar");

  const soPedido = ticto.normalizeTictoEvent(compraAprovada({ order: { hash: "TOC-TESTE-0002" }, transaction: null }));
  assert.equal(soPedido.eventId, "TOC-TESTE-0002:authorized:2026-10-17 09:00:14");
  assert.equal(soPedido.transactionId, null);
  assert.equal(soPedido.purchasedAt, "2026-10-17T12:00:14.000Z", "sem data do pedido, vale a data da situacao");

  const pelaOrdem = ticto.normalizeTictoEvent(compraAprovada({ transaction: {} }));
  assert.equal(pelaOrdem.transactionId, "TPC-TESTE-0001", "order.transaction_hash cobre a falta de transaction.hash");

  const semData = ticto.normalizeTictoEvent(compraAprovada({ status_date: undefined }));
  assert.equal(semData.eventId, "TPC-TESTE-0001:authorized");
  assert.equal(semData.occurredAt, null);
  assert.equal(semData.warrantyEndsAt, "2026-10-24T12:00:06.000Z", "a garantia e refund_deadline dias depois do pedido");

  const reenvio = ticto.normalizeTictoEvent(compraAprovada());
  assert.equal(reenvio.eventId, ticto.normalizeTictoEvent(compraAprovada()).eventId, "o mesmo postback de novo tem a mesma chave");
  assert.notEqual(reenvio.eventId, ticto.normalizeTictoEvent(compraAprovada({ status: "refunded" })).eventId, "outra situacao da mesma compra e outro evento");
});

test("comprador: e-mail invalido vira null; telefone em objeto, em texto, nos campos soltos ou ausente", () => {
  const semEmail = ticto.normalizeTictoEvent(compraAprovada({ customer: { email: "nao-e-email", name: "X" } }));
  assert.deepEqual(semEmail.buyer, { email: null, name: "X", phone: null }, "e-mail invalido vira null (a regra de acesso recusa)");

  const texto = ticto.normalizeTictoEvent(compraAprovada({ customer: { email: "a@b.co", name: "A", phone: "+55 (11) 99999-0000 ramal" } }));
  assert.equal(texto.buyer.phone, "+55 (11) 99999-0000");

  const soltos = ticto.normalizeTictoEvent(compraAprovada({ customer: { email: "a@b.co", name: "A" }, phone_local_code_customer: "21", phone_number_customer: "988887777" }));
  assert.equal(soltos.buyer.phone, "21988887777");

  const semDdi = ticto.normalizeTictoEvent(compraAprovada({ customer: { email: "a@b.co", name: "A", phone: { ddd: "11", number: "999990000" } } }));
  assert.equal(semDdi.buyer.phone, "11999990000");

  const semCliente = ticto.normalizeTictoEvent(compraAprovada({ customer: undefined }));
  assert.deepEqual(semCliente.buyer, { email: null, name: null, phone: null });
});

test("datas: 'AAAA-MM-DD HH:MM[:SS]' vale em Brasilia (-03:00); ISO com fuso e aceito; lixo vira null", () => {
  assert.equal(ticto.tictoDateToIso("2026-10-17 09:00:14"), "2026-10-17T12:00:14.000Z");
  assert.equal(ticto.tictoDateToIso("2026-10-17 09:00"), "2026-10-17T12:00:00.000Z");
  assert.equal(ticto.tictoDateToIso("2026-10-17T09:00:14Z"), "2026-10-17T09:00:14.000Z");
  assert.equal(ticto.tictoDateToIso("ontem"), null);
  assert.equal(ticto.tictoDateToIso(1760702400000), null, "a Ticto nao manda epoch");
  assert.equal(ticto.tictoDateToIso(""), null);
});

test("token: so o `token` do corpo, conferido contra o segredo salvo; errado, ausente ou sem segredo recusam; cabecalho nao vale", () => {
  const payload = compraAprovada();
  const semCabecalho = new Headers();

  assert.deepEqual(ticto.verifyTictoRequest({ headers: semCabecalho, payload, secret: TOKEN }), { ok: true });
  assert.deepEqual(ticto.verifyTictoRequest({ headers: semCabecalho, payload: compraAprovada({ token: ` ${TOKEN} ` }), secret: TOKEN }), { ok: true }, "espaco nas pontas nao atrapalha");
  assert.deepEqual(ticto.verifyTictoRequest({ headers: semCabecalho, payload: compraAprovada({ token: "outro-token-errado-0123456789" }), secret: TOKEN }), { ok: false, reason: "mismatch" });
  assert.deepEqual(ticto.verifyTictoRequest({ headers: semCabecalho, payload: compraAprovada({ token: `${TOKEN}x` }), secret: TOKEN }), { ok: false, reason: "mismatch" }, "tamanho diferente nao lanca erro");
  assert.deepEqual(ticto.verifyTictoRequest({ headers: semCabecalho, payload: compraAprovada({ token: undefined }), secret: TOKEN }), { ok: false, reason: "missing_token" });
  assert.deepEqual(
    ticto.verifyTictoRequest({ headers: new Headers({ "x-ticto-token": TOKEN }), payload: compraAprovada({ token: undefined }), secret: TOKEN }),
    { ok: false, reason: "missing_token" },
    "a Ticto nao autentica por cabecalho"
  );
  assert.deepEqual(ticto.verifyTictoRequest({ headers: semCabecalho, payload, secret: null }), { ok: false, reason: "missing_secret" });
  assert.deepEqual(ticto.verifyTictoRequest({ headers: semCabecalho, payload: compraAprovada({ token: "curto" }), secret: "curto" }), { ok: false, reason: "missing_secret" }, "segredo curto e configuracao ausente");
  assert.equal(ticto.readTictoToken({ token: 123 }), null);
});

test("o payload guardado perde o token, o link de login direto e o CPF/CNPJ; o resto fica", () => {
  const guardado = ticto.redactTictoPayload(compraAprovada());

  assert.equal(guardado.token, "[oculto]");
  assert.equal(guardado.direct_login_url, "[oculto]");
  assert.equal(guardado.customer.cpf, "[oculto]");
  assert.equal(guardado.customer.cnpj, null, "o que e nulo continua nulo");
  assert.equal(guardado.customer.email, "  Comprador.Teste@Bunker707.test ");
  assert.equal(guardado.customer.name, "Comprador de Teste");
  assert.equal(guardado.item.product_id, 268);
  assert.equal(guardado.transaction.hash, "TPC-TESTE-0001");

  const original = compraAprovada();
  ticto.redactTictoPayload(original);
  assert.equal(original.token, TOKEN, "o payload original nao e alterado");

  assert.deepEqual(ticto.redactTictoPayload({ status: "authorized" }), { status: "authorized" });
  assert.equal(ticto.redactTictoPayload("texto"), "texto");
});

test("a Ticto esta registrada como plataforma com adaptador; a Kiwify ainda nao; a tela rotula as situacoes da Ticto", () => {
  assert.equal(adapters.getPaymentAdapter("ticto")?.provider, "ticto");
  assert.equal(adapters.isSalesProviderSupported("ticto"), true);
  assert.equal(adapters.isSalesProviderSupported("kiwify"), false);
  assert.equal(adapters.getPaymentAdapter("ticto").maxPayloadBytes, 256 * 1024);

  assert.equal(model.saleEventLabel("authorized"), "Compra aprovada");
  assert.equal(model.saleEventLabel("refunded"), "Reembolso");
  assert.equal(model.saleEventLabel("chargeback"), "Chargeback");
  assert.equal(model.saleEventLabel("subscription_canceled"), "Assinatura cancelada");
  assert.equal(model.saleEventLabel("uncanceled"), "Assinatura reativada");
  assert.equal(model.saleEventLabel("pix_created"), "Pix gerado");
  assert.equal(model.saleEventLabel("waiting_payment"), "Aguardando pagamento");
  assert.equal(model.saleEventLabel("PURCHASE_APPROVED"), "Compra aprovada", "os rotulos da Hotmart continuam");

  assert.equal(model.buildSalesWebhookUrl("https://app.exemplo.test", "ticto"), "https://app.exemplo.test/api/webhooks/ticto");
  assert.deepEqual(model.SALES_CODE_FIELDS, { hotmart: "hotmartProductId", kiwify: "kiwifyProductId", ticto: "tictoProductId" });
  assert.equal(model.summarizeSalesSetup([{ status: "configured", supported: true }, { status: "configured", supported: true }, { status: "not_configured", supported: false }]).label, "2 plataformas conectadas");
});

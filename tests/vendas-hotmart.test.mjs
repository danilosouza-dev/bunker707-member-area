import assert from "node:assert/strict";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Vendas pela Hotmart (docs/04, secao Webhooks externos; docs/17 §1.10), regras puras: o adaptador le
// o webhook 2.0 (payloads FICTICIOS, nenhum dado real), confere o token em tempo constante, o modelo da
// tela rotula e mascara, e o rodape de "Novos acessos" diz de onde vieram os acessos.
//
// Webinarios v4b (docs/30 M8): o valor da venda. sale-amount.ts converte numero ou texto decimal em centavos sem conta
// de ponto flutuante e a moeda em ISO 4217; a Hotmart le data.purchase.price (ou full_price) com a moeda do bloco; o
// acesso nao muda com o valor; o store grava amount_cents/currency na linha e, no banco sem as colunas (sem a
// 202610290005), grava a venda sem elas (dublê do banco, sem rede).

const hotmart = await import("../src/server/payments/hotmart.ts");
const model = await import("../src/server/payments/model.ts");
const schemas = await import("../src/server/payments/schemas.ts");
const adapters = await import("../src/server/payments/adapters.ts");
const todayModel = await import("../src/components/admin/v2/today/today-model.ts");
const { requestOriginOf } = await import("../src/server/http/request-origin.ts");
const amounts = await import("../src/server/payments/sale-amount.ts");
const store = await import("../src/server/payments/store.ts");

const TOKEN = "hottok-de-teste-0123456789abcdef";
/** O banco guarda so o SHA-256 do token (src/server/payments/secret.ts). */
const TOKEN_HASH = hotmart.hashSalesSecret(TOKEN);

/** Payload ficticio no formato do webhook 2.0 da Hotmart (datas em epoch de milissegundos). */
function compraAprovada(overrides = {}) {
  return {
    creation_date: 1760702400000,
    data: {
      buyer: { checkout_phone: "11999990000", checkout_phone_code: "55", email: "  Comprador.Teste@Bunker707.test ", name: "Comprador de Teste" },
      product: { id: 7001, name: "Curso Ficticio", ucode: "abc-123" },
      purchase: {
        approved_date: 1760702460000,
        full_price: { currency_value: "BRL", value: 1597.9 },
        order_date: 1760702400000,
        price: { currency_value: "BRL", value: 1500 },
        status: "APPROVED",
        transaction: "HP-TESTE-0001",
        warranty_expire_date: 1761307200000
      }
    },
    event: "PURCHASE_APPROVED",
    hottok: TOKEN,
    id: "evento-teste-1",
    version: "2.0.0",
    ...overrides
  };
}

test("compra aprovada: evento normalizado com comprador, produto, compra e datas em ISO", () => {
  const event = hotmart.normalizeHotmartEvent(compraAprovada());

  assert.deepEqual(event, {
    amount: { cents: 150_000, currency: "BRL" },
    buyer: { email: "comprador.teste@bunker707.test", name: "Comprador de Teste", phone: "+55 11999990000" },
    eventId: "evento-teste-1",
    externalProductId: "7001",
    externalProductName: "Curso Ficticio",
    occurredAt: "2025-10-17T12:00:00.000Z",
    provider: "hotmart",
    purchasedAt: "2025-10-17T12:01:00.000Z",
    rawType: "PURCHASE_APPROVED",
    reopenClosedAccess: true,
    subscriptionCode: null,
    transactionId: "HP-TESTE-0001",
    type: "purchase_approved",
    warrantyEndsAt: "2025-10-24T12:00:00.000Z"
  });
});

test("cada evento da Hotmart vira o que ele significa para o acesso; o resto e 'other'", () => {
  const typeOf = (event) => hotmart.normalizeHotmartEvent(compraAprovada({ event })).type;

  assert.equal(typeOf("PURCHASE_APPROVED"), "purchase_approved");
  assert.equal(typeOf("purchase_complete"), "purchase_approved", "fim da garantia conta como aprovada (caixa nao importa)");
  assert.equal(hotmart.normalizeHotmartEvent(compraAprovada({ event: "PURCHASE_COMPLETE" })).reopenClosedAccess, false, "fim da garantia nao reabre acesso fechado");
  assert.equal(hotmart.normalizeHotmartEvent(compraAprovada()).reopenClosedAccess, true);
  assert.equal(typeOf("PURCHASE_REFUNDED"), "refund");
  assert.equal(typeOf("PURCHASE_CHARGEBACK"), "chargeback");
  assert.equal(typeOf("SUBSCRIPTION_CANCELLATION"), "subscription_canceled");

  for (const other of ["PURCHASE_CANCELED", "PURCHASE_BILLET_PRINTED", "PURCHASE_PROTEST", "PURCHASE_EXPIRED", "SWITCH_PLAN", "CLUB_FIRST_ACCESS", "EVENTO_NOVO"]) {
    assert.equal(typeOf(other), "other", other);
  }

  assert.deepEqual([...hotmart.HOTMART_HANDLED_EVENTS], ["PURCHASE_APPROVED", "PURCHASE_COMPLETE", "PURCHASE_REFUNDED", "PURCHASE_CHARGEBACK", "SUBSCRIPTION_CANCELLATION"]);
});

test("assinatura cancelada: o comprador vem de data.subscriber e nao ha compra", () => {
  const event = hotmart.normalizeHotmartEvent({
    creation_date: 1760702400000,
    data: {
      cancellation_date: 1760702400000,
      product: { id: 7001, name: "Curso Ficticio" },
      subscriber: { code: "SUB-1", email: "assinante@bunker707.test", name: "Assinante" },
      subscription: { plan: { name: "Mensal" }, status: "CANCELLED_BY_CUSTOMER" }
    },
    event: "SUBSCRIPTION_CANCELLATION",
    id: "evento-teste-2",
    version: "2.0.0"
  });

  assert.equal(event.type, "subscription_canceled");
  assert.deepEqual(event.buyer, { email: "assinante@bunker707.test", name: "Assinante", phone: null });
  assert.equal(event.transactionId, null);
  assert.equal(event.subscriptionCode, "SUB-1", "o codigo da assinatura liga o cancelamento as cobrancas");
  assert.equal(event.externalProductId, "7001");

  const cobranca = hotmart.normalizeHotmartEvent(compraAprovada({ data: { ...compraAprovada().data, subscription: { plan: { name: "Mensal" }, status: "ACTIVE", subscriber: { code: "SUB-1" } } } }));
  assert.equal(cobranca.subscriptionCode, "SUB-1", "a cobranca da assinatura traz o mesmo codigo");
});

test("payload sem nome de evento ou sem identificador nao vira evento; sem `id`, a compra identifica", () => {
  assert.equal(hotmart.normalizeHotmartEvent(null), null);
  assert.equal(hotmart.normalizeHotmartEvent({ data: {} }), null);
  assert.equal(hotmart.normalizeHotmartEvent({ event: "PURCHASE_APPROVED", data: {} }), null, "sem id nem transaction nao da para deduplicar");

  const semId = hotmart.normalizeHotmartEvent(compraAprovada({ id: undefined }));
  assert.equal(semId.eventId, "HP-TESTE-0001:PURCHASE_APPROVED");

  const semEmail = hotmart.normalizeHotmartEvent(compraAprovada({ data: { buyer: { email: "nao-e-email", name: "X" }, product: { id: 1 }, purchase: { transaction: "T" } } }));
  assert.equal(semEmail.buyer.email, null, "e-mail invalido vira null (a regra de acesso recusa)");
  assert.equal(semEmail.purchasedAt, "2025-10-17T12:00:00.000Z", "sem data da compra, vale a data do evento");
});

test("token: cabecalho X-HOTMART-HOTTOK ou `hottok` do corpo, conferido contra o HASH salvo; errado, ausente ou sem hash recusam", () => {
  const payload = compraAprovada();
  const headers = (token) => new Headers(token ? { "x-hotmart-hottok": token } : {});

  assert.match(TOKEN_HASH, /^[0-9a-f]{64}$/, "o que vai para o banco e o SHA-256 em hexadecimal");
  assert.notEqual(TOKEN_HASH, TOKEN);
  assert.deepEqual(hotmart.verifyHotmartRequest({ headers: headers(TOKEN), payload: {}, secretHash: TOKEN_HASH }), { ok: true });
  assert.deepEqual(hotmart.verifyHotmartRequest({ headers: headers(null), payload, secretHash: TOKEN_HASH }), { ok: true }, "token so no corpo tambem vale");
  assert.deepEqual(hotmart.verifyHotmartRequest({ headers: headers("outro-token-errado-0123456789"), payload: {}, secretHash: TOKEN_HASH }), { ok: false, reason: "mismatch" });
  assert.deepEqual(hotmart.verifyHotmartRequest({ headers: headers(`${TOKEN}x`), payload: {}, secretHash: TOKEN_HASH }), { ok: false, reason: "mismatch" }, "tamanho diferente nao lanca erro");
  assert.deepEqual(hotmart.verifyHotmartRequest({ headers: headers(TOKEN_HASH), payload: {}, secretHash: TOKEN_HASH }), { ok: false, reason: "mismatch" }, "mandar o proprio hash nao vale");
  assert.deepEqual(hotmart.verifyHotmartRequest({ headers: headers(null), payload: {}, secretHash: TOKEN_HASH }), { ok: false, reason: "missing_token" });
  assert.deepEqual(hotmart.verifyHotmartRequest({ headers: headers(TOKEN), payload, secretHash: null }), { ok: false, reason: "missing_secret" });
  assert.deepEqual(hotmart.verifyHotmartRequest({ headers: headers(TOKEN), payload, secretHash: TOKEN }), { ok: false, reason: "missing_secret" }, "token em texto puro no banco nao e um hash: configuracao invalida");

  assert.equal(hotmart.isValidSalesToken("", TOKEN_HASH), false);
  assert.equal(hotmart.isValidSalesToken(` ${TOKEN} `, TOKEN_HASH), true, "espaco nas pontas nao atrapalha");
});

test("o payload guardado fica so com os campos permitidos (sem token, documento, endereco e comissoes); Hotmart e Ticto tem adaptador, a Kiwify ainda nao", () => {
  const completo = compraAprovada({
    data: {
      affiliates: [{ name: "Afiliado" }],
      buyer: { address: { city: "Cidade", zipcode: "00000000" }, checkout_phone: "11999990000", checkout_phone_code: "55", document: "00000000000", email: "comprador@bunker707.test", name: "Comprador" },
      commissions: [{ value: 10 }],
      producer: { name: "Produtor" },
      product: { id: 7001, name: "Curso", ucode: "abc" },
      purchase: {
        approved_date: 1,
        full_price: { currency_value: "BRL", value: 100 },
        order_date: 1,
        payment: { installments_number: 12, type: "CREDIT_CARD" },
        price: { currency_value: "BRL", tax: 9, value: 97.9 },
        status: "APPROVED",
        transaction: "HP-1",
        warranty_expire_date: 2
      },
      subscription: { plan: { name: "Mensal" }, status: "ACTIVE", subscriber: { code: "SUB-1" } }
    }
  });
  const guardado = hotmart.redactHotmartPayload(completo);

  assert.deepEqual(guardado, {
    creation_date: 1760702400000,
    data: {
      buyer: { checkout_phone: "11999990000", checkout_phone_code: "55", email: "comprador@bunker707.test", name: "Comprador" },
      product: { id: 7001, name: "Curso" },
      purchase: {
        approved_date: 1,
        full_price: { currency_value: "BRL", value: 100 },
        order_date: 1,
        price: { currency_value: "BRL", value: 97.9 },
        status: "APPROVED",
        transaction: "HP-1",
        warranty_expire_date: 2
      },
      subscription: { status: "ACTIVE", subscriber: { code: "SUB-1" } }
    },
    event: "PURCHASE_APPROVED",
    id: "evento-teste-1",
    version: "2.0.0"
  });
  assert.equal(JSON.stringify(guardado).includes("00000000000"), false, "documento nunca e gravado");
  assert.equal(hotmart.normalizeHotmartEvent(guardado).buyer.email, "comprador@bunker707.test", "o que fica guardado ainda da para reprocessar");
  assert.deepEqual(hotmart.normalizeHotmartEvent(guardado).amount, { cents: 9790, currency: "BRL" }, "o preco guardado da o mesmo valor no reprocesso");
  assert.deepEqual(hotmart.normalizeHotmartEvent(guardado).amount, hotmart.normalizeHotmartEvent(completo).amount);
  assert.deepEqual(hotmart.redactHotmartPayload({ event: "X", hottok: TOKEN }), { event: "X" });
  assert.equal(adapters.getPaymentAdapter("hotmart")?.provider, "hotmart");
  assert.equal(adapters.getPaymentAdapter("ticto")?.provider, "ticto");
  assert.equal(adapters.getPaymentAdapter("kiwify"), null);
  assert.equal(adapters.isSalesProviderSupported("kiwify"), false);
});

test("schemas: token sem espacos entre 16 e 200 caracteres; codigo do produto so com letras, numeros, ponto, hifen e sublinhado", () => {
  assert.equal(schemas.salesSecretSchema.safeParse(TOKEN).success, true);
  assert.equal(schemas.salesSecretSchema.safeParse("curto").success, false);
  assert.equal(schemas.salesSecretSchema.safeParse("com espaco dentro 0123456789").success, false);
  assert.equal(schemas.saveSalesSecretSchema.safeParse({ provider: "stripe", secret: TOKEN }).success, false);

  assert.equal(schemas.externalProductIdSchema.parse(" 7001 "), "7001");
  assert.equal(schemas.externalProductIdSchema.parse(""), null);
  assert.equal(schemas.externalProductIdSchema.parse(undefined), null);
  assert.equal(schemas.externalProductIdSchema.safeParse("70 01").success, false);
  assert.equal(schemas.externalProductIdSchema.safeParse("x".repeat(121)).success, false);
});

test("modelo da tela: situacao por plataforma, resumo do hub, mascara do e-mail e rotulos", () => {
  assert.deepEqual(model.salesProviderChip({ status: "configured", supported: true }), { label: "Conectada", tone: "success" });
  assert.deepEqual(model.salesProviderChip({ status: "needs_attention", supported: true }), { label: "Precisa de atenção", tone: "warning" });
  assert.deepEqual(model.salesProviderChip({ status: "not_configured", supported: true }), { label: "Não conectada", tone: "neutral" });
  assert.deepEqual(model.salesProviderChip({ status: "configured", supported: false }), { label: "Em configuração", tone: "muted" }, "sem adaptador nunca aparece como conectada");

  assert.equal(model.summarizeSalesSetup([{ status: "not_configured", supported: true }, { status: "not_configured", supported: false }]).label, "Em configuração");
  assert.equal(model.summarizeSalesSetup([{ status: "configured", supported: true }, { status: "configured", supported: false }]).label, "1 plataforma conectada");
  assert.equal(model.summarizeSalesSetup([{ status: "needs_attention", supported: true }]).tone, "warning");

  assert.equal(model.maskEmail("Comprador@Exemplo.com"), "c***@exemplo.com");
  assert.equal(model.maskEmail(null), "—");
  assert.equal(model.buildSalesWebhookUrl("https://app.exemplo.test/", "hotmart"), "https://app.exemplo.test/api/webhooks/hotmart");

  assert.equal(model.saleEventLabel("PURCHASE_APPROVED"), "Compra aprovada");
  assert.equal(model.saleEventLabel("purchase_refunded"), "Reembolso");
  assert.equal(model.saleEventLabel("EVENTO_NOVO", "other"), "evento novo");
  assert.equal(model.saleOutcomeChip({ outcome: "access_granted", status: "processed" }).label, "Acesso liberado");
  assert.equal(model.saleOutcomeChip({ outcome: "access_restored", status: "processed" }).label, "Prazo devolvido");
  assert.equal(model.saleOutcomeChip({ outcome: null, status: "received" }).label, "Recebido");
  assert.equal(model.saleOutcomeChip({ outcome: "failed", status: "failed" }).label, "Erro");
  assert.equal(model.canReprocessSaleEvent("failed"), true);
  assert.equal(model.canReprocessSaleEvent("ignored"), true);
  assert.equal(model.canReprocessSaleEvent("processed"), false);
  const agora = Date.parse("2026-10-17T12:10:00.000Z");
  assert.equal(model.canReprocessSaleEvent("received", "2026-10-17T12:09:00.000Z", agora), false, "recem-recebido ainda esta rodando");
  assert.equal(model.canReprocessSaleEvent("received", "2026-10-17T12:04:00.000Z", agora), true, "preso ha mais de 5 minutos reprocessa");
  assert.equal(model.canReprocessSaleEvent("received"), false);
  assert.equal(model.webhookOriginWarning({ configuredOrigin: null, requestOrigin: "https://x.vercel.app" }), "O endereço acima é o desta página, porque NEXT_PUBLIC_SITE_URL não está definida. Conecte a plataforma só pelo endereço de produção.");
  assert.match(model.webhookOriginWarning({ configuredOrigin: "https://app.exemplo.test", requestOrigin: "https://previa.vercel.app" }), /aberto por https:\/\/previa\.vercel\.app/);
  assert.equal(model.webhookOriginWarning({ configuredOrigin: "https://app.exemplo.test", requestOrigin: "https://app.exemplo.test" }), null);
  assert.equal(model.buyerLabel({ anonymizedAt: null, buyerEmail: "Comprador@Exemplo.com" }), "c***@exemplo.com");
  assert.equal(model.buyerLabel({ anonymizedAt: "2025-10-17T06:23:00.000Z", buyerEmail: null }), "Dados apagados (12 meses)");
  assert.equal(model.describeSecretState({ secretUpdatedAt: null, status: "configured" }, () => "x"), "Nenhum token guardado.");
  assert.equal(model.describeSecretState({ secretUpdatedAt: "2026-10-17T12:00:00.000Z", status: "configured" }, () => "17/10/2026 09:00"), "Token guardado em 17/10/2026 09:00.");
});

test("vinculo venda -> acesso: a decisao olha o historico inteiro do acesso, e a ordem dos reembolsos nao muda o resultado", () => {
  let seq = 0;
  const grant = (overrides) => ({
    closed_at: null,
    closed_by: null,
    created_at: `2026-10-${String(10 + seq++).padStart(2, "0")}T00:00:00Z`,
    opened: true,
    previous_ends_at: null,
    subscription_code: null,
    transaction_id: "T2",
    ...overrides
  });
  const decide = (grants, { subscriptions = [], transactions = ["T2"], provider = "hotmart", rowProvider = "hotmart" } = {}) =>
    model.decideEntitlementAfterSale({
      closingSubscriptionCodes: new Set(subscriptions),
      closingTransactionIds: new Set(transactions),
      eventProvider: provider,
      grants,
      rowSourceProvider: rowProvider
    });

  // A compra que abriu o acesso e a unica: fecha.
  assert.deepEqual(decide([grant({})]), { kind: "close" });
  // Produto comprado sozinho (T1) e depois num pacote (T2), em qualquer ordem de reembolso: o que sobra sustenta; o ultimo fecha.
  const t1 = grant({ transaction_id: "T1" });
  const t2 = grant({ opened: false });
  assert.deepEqual(decide([t1, t2]), { kind: "keep_sustained" }, "reembolso do pacote: a compra avulsa sustenta");
  assert.deepEqual(decide([t1, t2], { transactions: ["T1"] }), { kind: "keep_sustained" }, "reembolso da avulsa: o pacote sustenta");
  assert.deepEqual(decide([{ ...t1, closed_at: "2026-10-17T00:00:00Z", closed_by: "refund" }, t2]), { kind: "close" }, "T1 ja reembolsada nao sustenta; T1 abriu -> fecha");
  assert.deepEqual(decide([t1, { ...t2, closed_at: "2026-10-17T00:00:00Z", closed_by: "refund" }], { transactions: ["T1"] }), { kind: "close" }, "ordem inversa: mesmo resultado");
  // Venda que so estendeu um acesso da equipe com prazo: o prazo volta; sem prazo: nada a desfazer.
  assert.deepEqual(decide([grant({ opened: false, previous_ends_at: "2099-06-30T12:00:00Z" })]), { endsAt: "2099-06-30T12:00:00Z", kind: "restore_deadline" });
  assert.deepEqual(decide([grant({ opened: false })]), { kind: "keep_other_origin" });
  // Duas compras sobre um acesso da equipe com prazo D: a primeira guardou D, a segunda ja achou o acesso sem prazo. Qualquer ordem devolve D no fim.
  const d1 = grant({ opened: false, previous_ends_at: "2099-06-30T12:00:00Z", transaction_id: "T1" });
  const d2 = grant({ opened: false });
  assert.deepEqual(decide([d1, d2], { transactions: ["T1"] }), { kind: "keep_sustained" });
  assert.deepEqual(decide([{ ...d1, closed_at: "2026-10-17T00:00:00Z", closed_by: "refund" }, d2]), { endsAt: "2099-06-30T12:00:00Z", kind: "restore_deadline" });
  assert.deepEqual(decide([d1, { ...d2, closed_at: "2026-10-17T00:00:00Z", closed_by: "refund" }], { transactions: ["T1"] }), { endsAt: "2099-06-30T12:00:00Z", kind: "restore_deadline" });
  // Assinatura S: cobrancas nao se sustentam entre si. A renovacao (T2) reembolsada fecha o acesso que a primeira cobranca abriu...
  const s1 = grant({ subscription_code: "S", transaction_id: "T1" });
  const s2 = grant({ opened: false, subscription_code: "S" });
  assert.deepEqual(decide([s1, s2]), { kind: "close" });
  assert.deepEqual(decide([s1, s2], { subscriptions: ["S"], transactions: ["T1", "T2"] }), { kind: "close" }, "cancelamento da assinatura");
  // ...mas NUNCA o que a equipe deu: assinatura que so estendeu um acesso da equipe (nenhuma cobranca abriu) mantem ou devolve o prazo.
  const e1 = grant({ opened: false, subscription_code: "S", transaction_id: "T1" });
  const e2 = grant({ opened: false, subscription_code: "S" });
  assert.deepEqual(decide([e1, e2]), { kind: "keep_other_origin" }, "reembolso da renovacao sobre acesso vitalicio da equipe");
  assert.deepEqual(decide([e1, e2], { subscriptions: ["S"], transactions: ["T1", "T2"] }), { kind: "keep_other_origin" }, "cancelamento");
  assert.deepEqual(decide([{ ...e1, previous_ends_at: "2099-06-30T12:00:00Z" }, e2], { subscriptions: ["S"], transactions: ["T1", "T2"] }), { endsAt: "2099-06-30T12:00:00Z", kind: "restore_deadline" }, "a equipe tinha dado prazo: volta");
  // Outra assinatura (S2) ou compra avulsa sustentam.
  assert.deepEqual(decide([grant({ subscription_code: "S2", transaction_id: "T0" }), s1, s2]), { kind: "keep_sustained" });
  // A equipe revogou e fechou os vinculos (admin); uma compra nova (T3) reabriu: o reembolso dela fecha, o vinculo antigo nao sustenta.
  const a0 = grant({ closed_at: "2026-10-17T00:00:00Z", closed_by: "admin", transaction_id: "T0" });
  assert.deepEqual(decide([a0, grant({ transaction_id: "T3" })], { transactions: ["T3"] }), { kind: "close" });
  // Reembolso de uma venda cujos vinculos a equipe ja fechou (reabriu, revogou ou suspendeu): fica com a equipe.
  assert.deepEqual(decide([a0], { transactions: ["T0"] }), { kind: "keep_team" });
  // Acesso que a venda abriu, mas cuja origem hoje e outra (a equipe o reabriu antes de os vinculos serem fechados por admin): fica com a equipe.
  assert.deepEqual(decide([grant({})], { rowProvider: "manual" }), { kind: "keep_team" });
  // Sem vinculo nenhum, nao ha o que decidir pela venda.
  assert.deepEqual(decide([]), { kind: "keep_other_origin" });
  assert.equal(model.pendingAttentionMessage(0), null);
  assert.equal(model.pendingAttentionMessage(2), "2 vendas com erro ou presa aguardando reprocesso.");
});

test("Hoje > Novos acessos: o rodape diz de onde vieram os acessos, maiores primeiro", () => {
  assert.deepEqual(todayModel.describeAccessOrigins([]), { definition: "acessos liberados no período", definitionShort: "liberados no período" });
  assert.deepEqual(todayModel.describeAccessOrigins([{ provider: "manual", total: 2 }, { provider: "hotmart", total: 3 }]), {
    definition: "3 pela Hotmart · 2 pela equipe",
    definitionShort: "3 Hotmart · 2 equipe"
  });
  assert.equal(todayModel.describeAccessOrigins([{ provider: "outra", total: 1 }, { provider: "ticto", total: 0 }]).definition, "1 por outra");
});

test("origem do site para os links dos e-mails: variavel, cabecalhos do proxy ou a URL do pedido", () => {
  const request = (headers, url = "http://127.0.0.1:3100/api/webhooks/hotmart") => new Request(url, { headers });

  assert.equal(requestOriginOf(request({}), { NEXT_PUBLIC_SITE_URL: "https://app.exemplo.test/x" }), "https://app.exemplo.test");
  assert.equal(requestOriginOf(request({ host: "escola.exemplo.test", "x-forwarded-proto": "https" }), {}), "https://escola.exemplo.test");
  assert.equal(requestOriginOf(request({ host: "127.0.0.1:3100" }), {}), "http://127.0.0.1:3100");
  assert.equal(requestOriginOf(request({ "x-forwarded-host": "app.exemplo.test, proxy" }), {}), "https://app.exemplo.test");
});

/* ------------------------------------------------------------------------------------------------
 * Webinarios v4b (docs/30 M8): o valor da venda
 * ---------------------------------------------------------------------------------------------- */

test("valor: numero do JSON vira centavos pelo texto (sem erro de ponto flutuante), na unidade da moeda", () => {
  assert.equal(amounts.saleAmountCents(1500), 150_000);
  assert.equal(amounts.saleAmountCents(97.9), 9790);
  assert.equal(amounts.saleAmountCents(19.99), 1999, "19.99 * 100 daria 1998.9999999999998");
  assert.equal(amounts.saleAmountCents(1.005), 101, "a terceira casa arredonda para cima");
  assert.equal(amounts.saleAmountCents(0.1 + 0.2), 30, "0.30000000000000004");
  assert.equal(amounts.saleAmountCents(0), 0);
  assert.equal(amounts.saleAmountCents(1e-7), 0, "fracao minuscula em notacao cientifica");
  assert.equal(amounts.saleAmountCents(1_000_000_000), amounts.MAX_SALE_AMOUNT_CENTS, "o teto do check da migracao");
  assert.equal(amounts.saleAmountCents(1_000_000_000.01), null, "acima do teto");
  assert.equal(amounts.saleAmountCents(1e21), null);
  assert.equal(amounts.saleAmountCents(-10), null, "negativo");
  assert.equal(amounts.saleAmountCents(Number.NaN), null);
  assert.equal(amounts.saleAmountCents(Number.POSITIVE_INFINITY), null);
  assert.equal(amounts.saleAmountCents(null), null);
  assert.equal(amounts.saleAmountCents({ value: 10 }), null);
  assert.equal(amounts.saleAmountCents(true), null);
});

test("valor: texto com virgula ou ponto; os dois separadores (o ultimo e o decimal); milhar so com grupos de 3; ambiguo e null", () => {
  assert.equal(amounts.saleAmountCents("1500"), 150_000);
  assert.equal(amounts.saleAmountCents(" 1500.5 "), 150_050);
  assert.equal(amounts.saleAmountCents("1500,50"), 150_050);
  assert.equal(amounts.saleAmountCents("1.500,50"), 150_050, "formato brasileiro");
  assert.equal(amounts.saleAmountCents("1,500.50"), 150_050, "formato americano");
  assert.equal(amounts.saleAmountCents("1.234.567,89"), 123_456_789);
  assert.equal(amounts.saleAmountCents("1.234.567"), 123_456_700, "um separador repetido e o de milhar");
  assert.equal(amounts.saleAmountCents("47.00"), 4700);
  assert.equal(amounts.saleAmountCents("0,5"), 50);
  assert.equal(amounts.saleAmountCents("+10"), 1000);
  assert.equal(amounts.saleAmountCents("19.999"), null, "um separador com 3 casas: mil ou dezenove? nunca um chute");
  assert.equal(amounts.saleAmountCents("1.500"), null);
  assert.equal(amounts.saleAmountCents("12.34.56"), null, "grupo de milhar fora do formato");
  assert.equal(amounts.saleAmountCents("1,23.45"), null);
  assert.equal(amounts.saleAmountCents("1.234,5.6"), null);
  assert.equal(amounts.saleAmountCents("10."), null);
  assert.equal(amounts.saleAmountCents("-10"), null);
  assert.equal(amounts.saleAmountCents("R$ 10,00"), null, "moeda no texto");
  assert.equal(amounts.saleAmountCents("dez"), null);
  assert.equal(amounts.saleAmountCents(""), null);
  assert.equal(amounts.saleAmountCents("9999999999999"), null, "parte inteira longa demais");
});

test("moeda: ISO 4217 de 3 letras em maiusculas; ausente usa o padrao (quando ha); invalida e null", () => {
  assert.equal(amounts.saleCurrencyCode("brl"), "BRL");
  assert.equal(amounts.saleCurrencyCode(" usd "), "USD");
  for (const invalida of ["R$", "REAL", "US", "", null, 840, "B R"]) {
    assert.equal(amounts.saleCurrencyCode(invalida), null, String(invalida));
  }

  assert.deepEqual(amounts.saleAmountOf({ cents: 100, currency: "eur" }), { cents: 100, currency: "EUR" });
  assert.equal(amounts.saleAmountOf({ cents: 100, currency: undefined }), null, "sem moeda e sem padrao");
  assert.deepEqual(amounts.saleAmountOf({ cents: 100, currency: null, defaultCurrency: "BRL" }), { cents: 100, currency: "BRL" });
  assert.deepEqual(amounts.saleAmountOf({ cents: 100, currency: " ", defaultCurrency: "BRL" }), { cents: 100, currency: "BRL" });
  assert.equal(amounts.saleAmountOf({ cents: 100, currency: "R$", defaultCurrency: "BRL" }), null, "moeda presente e invalida nao cai no padrao");
  assert.equal(amounts.saleAmountOf({ cents: null, currency: "BRL" }), null);
  assert.equal(amounts.saleAmountOf({ cents: 1.5, currency: "BRL" }), null);
  assert.equal(amounts.saleAmountOf({ cents: amounts.MAX_SALE_AMOUNT_CENTS + 1, currency: "BRL" }), null);

  assert.deepEqual(amounts.saleAmountColumns({ cents: 150_000, currency: "BRL" }), { amount_cents: 150_000, currency: "BRL" });
  assert.equal(amounts.saleAmountColumns({ cents: -1, currency: "BRL" }), null);
  assert.equal(amounts.saleAmountColumns({ cents: 1, currency: "real" }), null);
  assert.equal(amounts.saleAmountColumns(null), null);
  assert.equal(amounts.saleAmountColumns(undefined), null);
});

test("Hotmart: o valor vem de purchase.price com a moeda do bloco; sem price, full_price; sem moeda ou ilegivel, null", () => {
  const comPreco = (purchase) => hotmart.normalizeHotmartEvent(compraAprovada({ data: { ...compraAprovada().data, purchase: { transaction: "HP-TESTE-0001", ...purchase } } }));

  assert.deepEqual(comPreco({ price: { currency_value: "BRL", value: 97.9 } }).amount, { cents: 9790, currency: "BRL" });
  assert.deepEqual(comPreco({ price: { currency_value: "usd", value: "49.90" } }).amount, { cents: 4990, currency: "USD" }, "moeda em minusculas e valor em texto");
  assert.deepEqual(comPreco({ full_price: { currency_value: "EUR", value: 120 } }).amount, { cents: 12_000, currency: "EUR" }, "sem price, o preco cheio");
  assert.deepEqual(comPreco({ price: { currency_code: "BRL", value: 10 } }).amount, { cents: 1000, currency: "BRL" }, "payload antigo com currency_code");
  assert.deepEqual(comPreco({ price: { currency_value: "BRL", value: 0 } }).amount, { cents: 0, currency: "BRL" }, "compra gratuita vale 0");
  assert.equal(comPreco({ price: { value: 97.9 } }).amount, null, "sem moeda");
  assert.equal(comPreco({ price: { currency_value: "R$", value: 97.9 } }).amount, null, "moeda invalida");
  assert.equal(comPreco({ price: { currency_value: "BRL", value: "noventa" } }).amount, null, "valor ilegivel");
  assert.equal(comPreco({ price: { currency_value: "BRL", value: -5 } }).amount, null, "valor negativo");
  assert.equal(comPreco({}).amount, null, "sem preco nenhum");
  assert.equal(hotmart.normalizeHotmartEvent({ data: { product: { id: 1 }, subscriber: { code: "S" } }, event: "SUBSCRIPTION_CANCELLATION", id: "x" }).amount, null, "cancelamento sem compra");
});

test("Hotmart: o valor nunca muda o que o evento significa para o acesso", () => {
  const semPreco = compraAprovada();
  delete semPreco.data.purchase.price;
  delete semPreco.data.purchase.full_price;
  const comPreco = hotmart.normalizeHotmartEvent(compraAprovada());
  const sem = hotmart.normalizeHotmartEvent(semPreco);
  const outroPreco = hotmart.normalizeHotmartEvent(compraAprovada({ data: { ...compraAprovada().data, purchase: { ...compraAprovada().data.purchase, price: { currency_value: "USD", value: 1 } } } }));

  assert.equal(sem.amount, null);
  const semValor = (event) => Object.fromEntries(Object.entries(event).filter(([key]) => key !== "amount"));
  assert.deepEqual(semValor(comPreco), semValor(sem));
  assert.deepEqual(semValor(comPreco), semValor(outroPreco));
});

/** Dublê do banco para o insert de webhook_events: cada chamada anotada; `respostas` na ordem. */
function bancoDeVendas(respostas) {
  const inserts = [];
  let chamada = 0;

  return {
    inserts,
    from(table) {
      assert.equal(table, "webhook_events");
      const chain = {
        insert(row) {
          inserts.push(row);
          return chain;
        },
        select() {
          return chain;
        },
        async single() {
          const resposta = respostas[Math.min(chamada, respostas.length - 1)];
          chamada += 1;
          return resposta;
        }
      };

      return chain;
    }
  };
}

const EVENTO = {
  buyerEmail: "comprador@bunker707.test",
  eventType: "PURCHASE_APPROVED",
  externalEventId: "evento-1",
  externalProductId: "7001",
  externalProductName: "Curso",
  normalizedType: "purchase_approved",
  payload: { event: "PURCHASE_APPROVED" },
  provider: "hotmart",
  signatureValid: true,
  transactionId: "HP-1"
};

test("store: o valor vai para amount_cents/currency na mesma linha; sem valor (ou fora dos checks), a linha sai sem as colunas", async () => {
  const db = bancoDeVendas([{ data: { id: "linha-1" }, error: null }]);
  assert.deepEqual(await store.insertWebhookEvent(db, { ...EVENTO, amount: { cents: 150_000, currency: "BRL" } }), { duplicate: false, id: "linha-1" });
  assert.equal(db.inserts.length, 1);
  assert.equal(db.inserts[0].amount_cents, 150_000);
  assert.equal(db.inserts[0].currency, "BRL");
  assert.equal(db.inserts[0].processing_status, "received");

  for (const amount of [null, undefined, { cents: -1, currency: "BRL" }, { cents: 10, currency: "R$" }]) {
    const semValor = bancoDeVendas([{ data: { id: "linha-2" }, error: null }]);
    await store.insertWebhookEvent(semValor, { ...EVENTO, amount });
    assert.equal("amount_cents" in semValor.inserts[0], false, JSON.stringify(amount));
    assert.equal("currency" in semValor.inserts[0], false);
  }
});

test("store: banco sem as colunas do valor (migracao 202610290005 pendente) grava a venda sem elas, e o repetido continua repetido", async () => {
  const avisos = [];
  const original = console.warn;
  console.warn = (...args) => avisos.push(args.join(" "));

  try {
    for (const erro of [
      { code: "PGRST204", message: "Could not find the 'amount_cents' column of 'webhook_events' in the schema cache" },
      { code: "42703", message: 'column "amount_cents" of relation "webhook_events" does not exist' }
    ]) {
      const db = bancoDeVendas([{ data: null, error: erro }, { data: { id: "linha-3" }, error: null }]);
      assert.deepEqual(await store.insertWebhookEvent(db, { ...EVENTO, amount: { cents: 100, currency: "BRL" } }), { duplicate: false, id: "linha-3" });
      assert.equal(db.inserts.length, 2, erro.code);
      assert.equal(db.inserts[0].amount_cents, 100);
      assert.equal("amount_cents" in db.inserts[1], false, "a segunda tentativa vai sem o valor");
      const semValor = Object.fromEntries(Object.entries(db.inserts[0]).filter(([key]) => key !== "amount_cents" && key !== "currency"));
      assert.deepEqual(db.inserts[1], semValor, "a mesma linha, sem as duas colunas");
    }

    const repetido = bancoDeVendas([{ data: null, error: { code: "PGRST204", message: "Could not find the 'currency' column" } }, { data: null, error: { code: "23505", message: "duplicate key" } }]);
    assert.deepEqual(await store.insertWebhookEvent(repetido, { ...EVENTO, amount: { cents: 100, currency: "BRL" } }), { duplicate: true, id: null });
  } finally {
    console.warn = original;
  }

  assert.ok(avisos.every((linha) => /migracao 202610290005 pendente/.test(linha)), "o log diz a migracao");
  assert.equal(avisos.length, 3);

  const duplicado = bancoDeVendas([{ data: null, error: { code: "23505", message: "duplicate key" } }]);
  assert.deepEqual(await store.insertWebhookEvent(duplicado, { ...EVENTO, amount: { cents: 100, currency: "BRL" } }), { duplicate: true, id: null });
  assert.equal(duplicado.inserts.length, 1, "repetido com as colunas: uma tentativa so");

  const outroErro = bancoDeVendas([{ data: null, error: { code: "23514", message: "violates check constraint" } }]);
  await assert.rejects(store.insertWebhookEvent(outroErro, { ...EVENTO, amount: { cents: 100, currency: "BRL" } }), /Registrar a venda recebida/);
  assert.equal(outroErro.inserts.length, 1, "outro erro nao tenta de novo sem o valor");

  const semColunasSemValor = bancoDeVendas([{ data: null, error: { code: "PGRST204", message: "Could not find the 'payload' column" } }]);
  await assert.rejects(store.insertWebhookEvent(semColunasSemValor, { ...EVENTO, amount: null }));
  assert.equal(semColunasSemValor.inserts.length, 1, "sem valor nao ha o que tirar: o erro sobe");
});

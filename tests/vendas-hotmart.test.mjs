import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Vendas pela Hotmart (docs/04, secao Webhooks externos; docs/17 §1.10), regras puras: o adaptador le
// o webhook 2.0 (payloads FICTICIOS, nenhum dado real), confere o token em tempo constante, o modelo da
// tela rotula e mascara, e o rodape de "Novos acessos" diz de onde vieram os acessos.

const hotmart = await import("../src/server/payments/hotmart.ts");
const model = await import("../src/server/payments/model.ts");
const schemas = await import("../src/server/payments/schemas.ts");
const adapters = await import("../src/server/payments/adapters.ts");
const todayModel = await import("../src/components/admin/v2/today/today-model.ts");
const { requestOriginOf } = await import("../src/server/http/request-origin.ts");

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
        order_date: 1760702400000,
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
    buyer: { email: "comprador.teste@bunker707.test", name: "Comprador de Teste", phone: "+55 11999990000" },
    eventId: "evento-teste-1",
    externalProductId: "7001",
    externalProductName: "Curso Ficticio",
    occurredAt: "2025-10-17T12:00:00.000Z",
    provider: "hotmart",
    purchasedAt: "2025-10-17T12:01:00.000Z",
    rawType: "PURCHASE_APPROVED",
    reopenClosedAccess: true,
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
  assert.equal(event.externalProductId, "7001");
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
      purchase: { approved_date: 1, full_price: { value: 100 }, order_date: 1, status: "APPROVED", transaction: "HP-1", warranty_expire_date: 2 },
      subscription: { plan: { name: "Mensal" }, status: "ACTIVE", subscriber: { code: "SUB-1" } }
    }
  });
  const guardado = hotmart.redactHotmartPayload(completo);

  assert.deepEqual(guardado, {
    creation_date: 1760702400000,
    data: {
      buyer: { checkout_phone: "11999990000", checkout_phone_code: "55", email: "comprador@bunker707.test", name: "Comprador" },
      product: { id: 7001, name: "Curso" },
      purchase: { approved_date: 1, order_date: 1, status: "APPROVED", transaction: "HP-1", warranty_expire_date: 2 },
      subscription: { status: "ACTIVE", subscriber: { code: "SUB-1" } }
    },
    event: "PURCHASE_APPROVED",
    id: "evento-teste-1",
    version: "2.0.0"
  });
  assert.equal(JSON.stringify(guardado).includes("00000000000"), false, "documento nunca e gravado");
  assert.equal(hotmart.normalizeHotmartEvent(guardado).buyer.email, "comprador@bunker707.test", "o que fica guardado ainda da para reprocessar");
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
  assert.equal(model.describeSecretState({ secretUpdatedAt: null, status: "configured" }, () => "x"), "Nenhum token guardado.");
  assert.equal(model.describeSecretState({ secretUpdatedAt: "2026-10-17T12:00:00.000Z", status: "configured" }, () => "17/10/2026 09:00"), "Token guardado em 17/10/2026 09:00.");
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

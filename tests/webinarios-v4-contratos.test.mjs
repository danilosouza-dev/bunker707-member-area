import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Os contratos da fase 4 dos webinarios (docs/30 §3, §4.2, §4.3, §5.1, §6.6, §1.6 e §11) que as frentes usam juntas:
// as linhas e os leitores de rows.ts (sem confiar no formato do banco), a variante e o link da Oferta (offer-model.ts),
// o ambiente (v4-env.ts), o nome do CSV, os schemas zod (offer/simulation/assistant/jit/translation/export) e as frases
// novas em WEBINAR_COPY. Os stores sao "server-only" (as frentes os testam com o banco falso).

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const model = await import("../src/server/webinars/model.ts");
const rows = await import("../src/server/webinars/rows.ts");
const offerModel = await import("../src/server/webinars/offer-model.ts");
const env = await import("../src/server/webinars/v4-env.ts");
const offerSchemas = await import("../src/server/webinars/offer-schemas.ts");
const simulationSchemas = await import("../src/server/webinars/simulation-schemas.ts");
const assistantSchemas = await import("../src/server/webinars/assistant-schemas.ts");
const jitSchemas = await import("../src/server/webinars/jit-schemas.ts");
const translationSchemas = await import("../src/server/webinars/translation-schemas.ts");
const exportSchemas = await import("../src/server/webinars/export-schemas.ts");
const { PROIBIDAS_WEBINARIO, WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const SESSION = "7a0c1c8e-9a2b-4d7e-8f0a-1b2c3d4e5f60";
const WEBINAR = "10000000-0000-4000-8000-000000000001";

test("a sessao le jit (202610300005) e os dubles antigos sem a coluna continuam false", () => {
  const base = { chat_mode: "open", chat_slow_mode_seconds: null, created_at: "2026-11-05T12:00:00Z", ended_at: null, id: SESSION, kind: "simulated", late_join_minutes: null, pinned_message_id: null, presence_curve: null, recording_anchor_at: null, recording_id: null, scheduled_at: "2026-11-05T23:00:00Z", script_fired_at: null, show_live_badge: false, simulation_ack_text: null, simulation_decided_at: null, simulation_decided_by: null, source_session_id: null, started_at: null, status: "scheduled", updated_at: "2026-11-05T12:00:00Z", webinar_id: WEBINAR };
  assert.equal(rows.sessionFromRow(base).jit, false);
  assert.equal(rows.sessionFromRow({ ...base, jit: true }).jit, true);
  assert.ok(rows.SESSION_COLUMNS.split(", ").includes("jit"));
  assert.ok(!/simulated_|simulation_summary|simulation_seed/.test(rows.SESSION_COLUMNS), "as colunas de Simulacao da fase 4 nunca entram na leitura comum (D6, M6)");
});

test("readPanelRows: bigint em texto vira numero, session_id nulo e o periodo, linha sem metrica fica de fora", () => {
  assert.deepEqual(
    rows.readPanelRows([
      { item: "", metric: "present", session_id: SESSION, students: "2", total: "2" },
      { item: "", metric: "unique_present", session_id: null, students: 3, total: 3 },
      { item: 5, metric: "retention", session_id: SESSION, students: 2, total: "1" },
      { total: 9 },
      null
    ]),
    [
      { item: "", metric: "present", sessionId: SESSION, students: 2, total: 2 },
      { item: "", metric: "unique_present", sessionId: null, students: 3, total: 3 },
      { item: "5", metric: "retention", sessionId: SESSION, students: 2, total: 1 }
    ]
  );
});

test("a Oferta: as variantes na ordem A-D, limites aplicados e a foto da sessao lida sem confiar", () => {
  const offer = rows.offerFromRows(
    { attribution_days: 99, created_at: "x", created_by: null, deadline_minutes: null, id: "o1", product_id: "formacao", show_at_offset_ms: 240000, status: "active", title: "", trigger_kind: "at_offset", updated_at: "x", visible_minutes: null, webinar_id: WEBINAR },
    [
      { badge: null, checkout_url: "https://pay.example.com/b", coupon: null, created_at: "x", enabled: true, headline: "B", id: "vb", image_url: null, label: "B", offer_id: "o1", price_from_label: null, price_label: "R$ 997", updated_at: "x", weight: 1 },
      { badge: "Hoje", checkout_url: "https://pay.example.com/a", coupon: "B7", created_at: "x", enabled: false, headline: "A", id: "va", image_url: null, label: "A", offer_id: "o1", price_from_label: null, price_label: null, updated_at: "x", weight: 500 },
      { badge: null, checkout_url: "https://x", coupon: null, created_at: "x", enabled: true, headline: "outra", id: "vx", image_url: null, label: "C", offer_id: "outra", price_from_label: null, price_label: null, updated_at: "x", weight: 1 }
    ]
  );
  assert.deepEqual(offer.variants.map((variant) => [variant.label, variant.enabled, variant.weight]), [["A", false, 100], ["B", true, 1]]);
  assert.equal(offer.attributionDays, model.OFFER_LIMITS.attributionDaysMax);
  assert.equal(rows.offerDisplaySnapshotOf("lixo"), null);
  assert.deepEqual(rows.offerDisplaySnapshotOf({ capturedAt: "2026-11-05T23:04:00.000Z", deadlineAt: null, variants: [{ headline: "A", label: "A" }, { headline: "Z", label: "Z" }] })?.variants.map((variant) => variant.label), ["A"]);
});

test("offer-model: a variante so entre as ligadas, o token no formato do banco e o link com ?b7= (so https)", () => {
  const offerId = "50000000-0000-4000-8000-000000000001";
  const userId = "00000000-0000-4000-8000-0000000000a1";
  assert.equal(offerModel.offerVariantFor({ offerId, userId, variants: [{ enabled: false, label: "A", weight: 1 }] }), null);
  assert.equal(offerModel.offerVariantFor({ offerId, userId, variants: [{ enabled: false, label: "A", weight: 1 }, { enabled: true, label: "D", weight: 1 }] })?.label, "D");
  assert.equal(offerModel.offerHashNumber(userId.toUpperCase(), offerId), offerModel.offerHashNumber(userId, offerId), "o uuid em minusculas, como o Postgres escreve");
  const token = offerModel.newClickToken();
  assert.ok(offerModel.isClickToken(token) && token.length === 24);
  assert.equal(offerModel.checkoutUrlWithToken("https://pay.hotmart.com/X123?off=abc&b7=velho", "tok_123456789012345"), "https://pay.hotmart.com/X123?off=abc&b7=tok_123456789012345");
  assert.equal(offerModel.checkoutUrlWithToken("http://pay.example.com/a", "tok"), null);
  assert.equal(offerModel.checkoutUrlWithToken("javascript:alert(1)", "tok"), null);
});

test("a Simulacao: leitura tolerante, 'off' e desligado gravam nulo, ida e volta pelas colunas de §4.3", () => {
  const rules = {
    countRule: { base: 50, jitter: 10, mode: "curve", peak: 120 },
    joins: { enabled: true, everySeconds: 45, max: 20, names: "generic" },
    saleNotices: { enabled: true, items: [{ offsetMs: 900000, text: "Carlos garantiu a vaga" }] }
  };
  const row = rows.simulationRulesToRow(rules);
  assert.deepEqual(row.simulated_joins, { enabled: true, every_seconds: 45, max: 20, names: "generic" });
  assert.deepEqual(row.simulated_sale_notices, { enabled: true, items: [{ offset_ms: 900000, text: "Carlos garantiu a vaga" }] });
  const back = rows.sessionSimulationFromRow({ id: SESSION, kind: "simulated", simulated_count_rule: row.simulated_count_rule, simulated_joins: row.simulated_joins, simulated_sale_notices: row.simulated_sale_notices, simulation_seed: "42", simulation_summary: { counter_max: 140, joins_shown: 12, sale_notices_shown: 1 } });
  assert.deepEqual({ countRule: back.countRule, joins: back.joins, saleNotices: back.saleNotices }, rules);
  assert.equal(back.seed, 42);
  assert.deepEqual(back.summary, { counterMax: 140, joinsShown: 12, saleNoticesShown: 1 });
  const off = rows.simulationRulesToRow({ countRule: model.defaultSimulatedCountRule(), joins: model.defaultSimulatedJoins(), saleNotices: model.defaultSimulatedSaleNotices() });
  assert.deepEqual(off, { simulated_count_rule: null, simulated_joins: null, simulated_sale_notices: null });
  assert.deepEqual(rows.simulatedCountRuleOfRow({ base: 80, mode: "curve", peak: 10 }).peak, 80, "o maximo nunca fica abaixo do minimo");
  assert.equal(rows.simulationTotalsOfRow({}), null);
});

test("o Assistente, o just-in-time e o idioma: leitura tolerante e ida e volta", () => {
  assert.deepEqual(rows.assistantSettingsOfRow(null), model.defaultAssistantSettings());
  assert.deepEqual(rows.assistantSettingsOfRow({ enabled: true, replyAllDefault: "sim" }), { enabled: true, replyAllDefault: false });
  const jit = {
    enabled: true,
    endHour: 22,
    everyMinutes: 30,
    lateJoinMinutes: 10,
    simulation: { ackText: "Decisão", countRule: { base: 30, jitter: 0, mode: "fixed", peak: 30 }, decidedAt: "2026-11-05T12:00:00.000Z", decidedBy: WEBINAR, joins: model.defaultSimulatedJoins(), saleNotices: model.defaultSimulatedSaleNotices(), showLiveBadge: true },
    startHour: 8
  };
  assert.deepEqual(rows.jitSettingsOfRow(rows.jitSettingsToRow(jit)), jit);
  assert.equal(rows.jitSettingsOfRow({ enabled: true, endHour: 8, everyMinutes: 15, startHour: 8 }).enabled, false, "janela vazia nao liga");
  assert.equal(rows.jitSettingsOfRow({ everyMinutes: 20 }).everyMinutes, 15);
  assert.deepEqual(rows.viewerPrefsFromRow({ chat_language: "fr", created_at: "x", updated_at: "x", user_id: "u" }), { chatLanguage: null, userId: "u" });
  assert.deepEqual(rows.viewerPrefsFromRow({ chat_language: "es", created_at: "x", updated_at: "x", user_id: "u" }), { chatLanguage: "es", userId: "u" });
});

test("v4-env: o Assistente e a traducao so com 'on'; nada em NEXT_PUBLIC_", () => {
  assert.equal(env.webinarAssistantEnabled({}), false);
  assert.equal(env.webinarAssistantEnabled({ WEBINAR_ASSISTANT_ENABLED: " ON " }), true);
  assert.equal(env.webinarTranslationEnabled({ WEBINAR_TRANSLATION_ENABLED: "1" }), false);
  assert.equal(env.webinarTranslationEnabled({ WEBINAR_TRANSLATION_ENABLED: "on" }), true);
  const example = read(".env.example");
  assert.match(example, /^WEBINAR_ASSISTANT_ENABLED=$/m);
  assert.match(example, /^WEBINAR_TRANSLATION_ENABLED=$/m);
  assert.doesNotMatch(example, /NEXT_PUBLIC_WEBINAR/);
});

test("o nome do CSV: webinario-{slug}-{sessao}-{relatorio}.csv, so letras minusculas, numeros e hifens", () => {
  assert.equal(model.webinarExportFileName({ report: "qa", sessionKey: "2026-11-05 20:00", slug: "Live de Agentes" }), "webinario-live-de-agentes-2026-11-05-20-00-qa.csv");
  assert.equal(model.webinarExportFileName({ report: "simulacao", sessionKey: "período", slug: "" }), "webinario-live-periodo-simulacao.csv");
  assert.deepEqual([...model.WEBINAR_EXPORT_REPORTS], ["registration", "attendee", "performance", "qa", "poll", "survey", "simulacao"]);
});

test("os schemas zod da fase 4 aceitam o certo e recusam o errado com a frase certa", () => {
  const variant = { checkoutUrl: "https://pay.example.com/a", headline: "Entre agora", label: "A" };
  assert.ok(offerSchemas.offerDraftSchema.safeParse({ productId: "formacao", status: "active", triggerKind: "manual", variants: [variant] }).success);
  const duplicated = offerSchemas.offerDraftSchema.safeParse({ productId: "formacao", status: "active", triggerKind: "manual", variants: [variant, variant] });
  assert.ok(duplicated.error.issues.some((issue) => issue.message === offerSchemas.OFFER_MESSAGES.labelsUnique));
  const simulation = simulationSchemas.saveSessionSimulationSchema.safeParse({ joins: { enabled: true }, sessionId: SESSION });
  assert.ok(simulation.error.issues.some((issue) => issue.message === simulationSchemas.SIMULATION_MESSAGES.ack), "entradas simuladas pedem a caixa de §8.6");
  assert.ok(simulationSchemas.saveSessionSimulationSchema.safeParse({ ackText: "Decisão do produtor", acknowledged: true, joins: { enabled: true }, sessionId: SESSION }).success);
  assert.ok(simulationSchemas.saveSessionSimulationSchema.safeParse({ sessionId: SESSION }).success, "tudo desligado salva sem caixa");
  assert.ok(!simulationSchemas.simulationFeedQuerySchema.safeParse({ from: "0", sessao: SESSION, to: String(model.SIMULATION_LIMITS.feedWindowSeconds * 1000 + 1) }).success);
  assert.ok(!assistantSchemas.saveAssistantSchema.safeParse({ items: Array.from({ length: model.ASSISTANT_LIMITS.knowledgeMax + 1 }, () => ({ answer: "a", question: "qq" })), settings: {}, webinarId: WEBINAR }).success);
  assert.ok(jitSchemas.jitSettingsSchema.safeParse({ endHour: 22, everyMinutes: 60, startHour: 8 }).success);
  assert.ok(!jitSchemas.jitSettingsSchema.safeParse({ endHour: 8, everyMinutes: 15, startHour: 8 }).success);
  assert.ok(!jitSchemas.jitSettingsSchema.safeParse({ endHour: 22, everyMinutes: 15, simulation: { showLiveBadge: true }, startHour: 8 }).success, "o selo copiado tambem pede a caixa");
  assert.ok(!translationSchemas.translationsQuerySchema.safeParse({ ids: "", lang: "en", sessao: SESSION }).success);
  assert.ok(!exportSchemas.webinarExportSchema.safeParse({ kind: "live", period: { end: "2026-01-01T00:00:00Z", start: "2027-06-01T00:00:00Z" }, report: "performance", scope: "panel" }).success);
  assert.ok(!exportSchemas.webinarExportSchema.safeParse({ kind: "live", period: { end: "2026-11-01T00:00:00Z", start: "2026-10-01T00:00:00Z" }, report: "qa", scope: "panel" }).success, "Q&A so de uma sessao");
});

test("as frases novas (WEBINAR_COPY da fase 4 e as mensagens dos schemas) passam pela lista propria", () => {
  for (const key of ["paineis", "exportar", "oferta", "simulacao", "seguimento", "assistente", "vertical", "jit", "traducao"]) {
    assert.ok(WEBINAR_COPY[key], key);
  }
  const messages = [
    ...Object.values(offerSchemas.OFFER_MESSAGES).map((value) => (typeof value === "function" ? value(40) : value)),
    ...Object.values(simulationSchemas.SIMULATION_MESSAGES),
    ...Object.values(assistantSchemas.ASSISTANT_MESSAGES),
    ...Object.values(jitSchemas.JIT_MESSAGES),
    ...Object.values(translationSchemas.TRANSLATION_MESSAGES),
    ...Object.values(exportSchemas.EXPORT_MESSAGES)
  ];
  for (const text of messages) {
    for (const palavra of PROIBIDAS_WEBINARIO) {
      assert.ok(!text.toLocaleLowerCase("pt-BR").includes(palavra), `"${text}" usa "${palavra}"`);
    }
  }
  assert.equal(WEBINAR_COPY.exportar.cabecalhoPerformance, "Estes números são reais; a simulação não entra em nenhum deles.");
  assert.equal(WEBINAR_COPY.exportar.cabecalhoSimulacao, "Estes números são da simulação e não entram em nenhum outro número.");
  assert.equal(WEBINAR_COPY.paineis.simulacao.aviso, WEBINAR_COPY.relatorio.avisoSimulacao);
  assert.ok(!Object.values(WEBINAR_COPY.seguimento).some((text) => /oferta/i.test(text)), "as frases do follow-up da Comunicacao nao usam 'oferta' (FORBIDDEN_COPY)");
});

test("os stores da fase 4 sao server-only; os modulos que os testes importam sao puros", () => {
  for (const file of ["panel-store", "offer-store", "simulation-store", "assistant-store", "jit-store", "translation-store"]) {
    assert.match(read(`src/server/webinars/${file}.ts`), /^import "server-only";$/m, file);
  }
  for (const file of ["offer-model", "simulation-ack", "export-links", "v4-env", "text-hash", "offer-schemas", "simulation-schemas", "assistant-schemas", "jit-schemas", "translation-schemas", "export-schemas"]) {
    assert.doesNotMatch(read(`src/server/webinars/${file}.ts`), /^import "server-only"|from "@\//m, file);
  }
});

test("a frase da decisao da fase 4 (docs/30 §8.6) cobre o selo, os numeros e os avisos de venda", async () => {
  const ack = await import("../src/server/webinars/simulation-ack.ts");
  const sentence = ack.simulationAckSentenceV4({ badgeOn: true, countSimulated: false, date: "05/11/2026", joinsSimulated: true, responsible: " Carla ", saleNoticesSimulated: false });
  assert.equal(
    sentence,
    'Decisão do produtor em 05/11/2026: nesta sessão gravada, dentro da área de membros, o selo "Ao vivo" fica ligado, os números de plateia são simulados e os avisos de venda não aparecem. Fora da área de membros, esta sessão nunca é anunciada como ao vivo. Responsável: Carla.'
  );
  assert.equal(ack.simulationIsOn({ badgeOn: false, countSimulated: false, joinsSimulated: false, saleNoticesSimulated: false }), false);
  assert.equal(ack.simulationIsOn({ badgeOn: false, countSimulated: false, joinsSimulated: false, saleNoticesSimulated: true }), true);
  for (const palavra of PROIBIDAS_WEBINARIO) {
    assert.ok(!sentence.toLocaleLowerCase("pt-BR").includes(palavra), palavra);
  }
});

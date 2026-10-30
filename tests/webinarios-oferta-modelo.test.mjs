import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// A Oferta, a parte pura (docs/30 §1.6, §2.2, §2.4, §5.1, §8.6 e M7; docs/18 §2.1): a janela no relogio do video por
// gatilho (Num minuto do video, Pelo botao da equipe, Nunca), o prazo real por sessao (a hora marcada + o minuto + os
// minutos de prazo; nunca no replay), quando a sessao grava a linha do que mostrou, a recusa do clique fora da janela,
// a foto das variantes ligadas, o "Mostrar agora" e o "Esconder" do console, o card do aluno sem o link do checkout,
// quem ja tem o produto, as contagens do console, a variante por md5 com os valores conferidos no Postgres (os mesmos
// de tests/webinarios-v4b.guard.test.mjs) e o formulario do editor (Divisao igual = pesos 1, minutos em ms).

const room = await import("../src/server/webinars/offer-room-model.ts");
const offerModel = await import("../src/server/webinars/offer-model.ts");
const { offerDraftSchema } = await import("../src/server/webinars/offer-schemas.ts");
const editor = await import("../src/components/admin/v2/communication/webinars/offer/offer-editor-model.ts");

const MIN = 60_000;
const T0 = Date.parse("2026-11-05T23:00:00.000Z");
const OFFER = "50000000-0000-4000-8000-000000000001";
const SESSION = "60000000-0000-4000-8000-000000000001";
const ALUNO = "00000000-0000-4000-8000-0000000000a1";

const simulated = { id: SESSION, kind: "simulated", recordingAnchorAt: null, scheduledAt: new Date(T0).toISOString(), startedAt: null, status: "live" };
const replay = { ...simulated, kind: "replay", status: "ended" };
const live = { ...simulated, kind: "live" };

function variant(label, extra = {}) {
  return {
    badge: `Selo ${label}`,
    checkoutUrl: `https://pay.hotmart.com/${label}?off=1`,
    coupon: label === "A" ? "B707" : null,
    enabled: true,
    headline: `Formação ${label}`,
    id: `70000000-0000-4000-8000-00000000000${"ABCD".indexOf(label) + 1}`,
    imageUrl: null,
    label,
    offerId: OFFER,
    priceFromLabel: "R$ 997",
    priceLabel: "R$ 497",
    weight: 1,
    ...extra
  };
}

function offer(extra = {}) {
  return {
    attributionDays: 7,
    createdAt: "2026-11-01T12:00:00.000Z",
    createdBy: null,
    deadlineMinutes: null,
    id: OFFER,
    productId: "formacao-ia",
    showAtOffsetMs: 45 * MIN,
    status: "active",
    title: "Oferta da live",
    triggerKind: "at_offset",
    updatedAt: "2026-11-01T12:00:00.000Z",
    variants: [variant("A"), variant("B")],
    visibleMinutes: 10,
    webinarId: "10000000-0000-4000-8000-000000000001",
    ...extra
  };
}

const display = (extra = {}) => ({
  deadlineAt: null,
  hiddenAt: null,
  hiddenBy: null,
  hideOffsetMs: null,
  id: "80000000-0000-4000-8000-000000000001",
  offerId: OFFER,
  sessionId: SESSION,
  showOffsetMs: 30 * MIN,
  shownAt: new Date(T0 + 30 * MIN).toISOString(),
  shownBy: "eeeeeeee-5555-4555-8555-555555555555",
  snapshot: null,
  ...extra
});

test("janela por gatilho: Num minuto do video (com Some em ou ate o fim), Pelo botao e Nunca sem janela, a live nunca", () => {
  assert.deepEqual(room.plannedOfferWindow(offer(), simulated), { deadlineAt: null, hidden: false, hideAtMs: 55 * MIN, showAtMs: 45 * MIN, source: "planned" });
  assert.equal(room.plannedOfferWindow(offer({ visibleMinutes: null }), simulated).hideAtMs, null, "sem Some em: ate o fim");
  assert.equal(room.plannedOfferWindow(offer({ triggerKind: "manual" }), simulated), null);
  assert.equal(room.plannedOfferWindow(offer({ triggerKind: "never" }), simulated), null);
  assert.equal(room.plannedOfferWindow(offer(), live), null, "a sala ao vivo nunca tem card");
  assert.equal(room.offerWindowFor({ display: null, offer: offer({ triggerKind: "manual" }), session: simulated }), null, "pelo botao: so com a linha do console");
  assert.equal(room.offerWindowFor({ display: display(), offer: offer({ triggerKind: "never" }), session: simulated }), null, "Nunca: nada, nem com linha antiga");
  assert.deepEqual(room.offerWindowFor({ display: display({ hideOffsetMs: 40 * MIN }), offer: offer(), session: simulated }), {
    deadlineAt: null,
    hidden: false,
    hideAtMs: 40 * MIN,
    showAtMs: 30 * MIN,
    source: "display"
  }, "a linha gravada manda, mesmo com a oferta editada depois");
});

test("prazo real por sessao (CDC §8.6): hora marcada + minuto + prazo na gravada; nunca no replay", () => {
  const window = room.plannedOfferWindow(offer({ deadlineMinutes: 15 }), simulated);
  assert.equal(window.deadlineAt, new Date(T0 + 60 * MIN).toISOString());
  assert.equal(room.plannedOfferWindow(offer({ deadlineMinutes: 15 }), replay).deadlineAt, null, "no replay cada aluno assiste numa hora: sem prazo");
  assert.equal(room.offerDeadlineAt({ deadlineMinutes: null, session: simulated, showAtMs: 0 }), null);
  assert.equal(room.offerDeadlinePassed(new Date(T0).toISOString(), T0), true);
  assert.equal(room.offerDeadlinePassed(new Date(T0 + 1).toISOString(), T0), false);
  assert.equal(room.offerDeadlinePassed(null, T0), false);
});

test("Comeca quando voce entra (jit): a sessao de cada horario nunca ganha prazo, nem pela linha gravada nem pelo Mostrar agora (§8.6)", () => {
  const jit = { ...simulated, jit: true };
  assert.equal(room.offerDeadlineAt({ deadlineMinutes: 15, session: jit, showAtMs: 0 }), null);
  assert.equal(room.plannedOfferWindow(offer({ deadlineMinutes: 15 }), jit).deadlineAt, null, "o horario das 20:15 nao recomeca a contagem");
  assert.equal(room.offerWithoutDeadline(jit), true);
  assert.equal(room.offerWithoutDeadline(simulated), false);
  // Dois horarios seguidos para a mesma aluna: nenhum dos dois mostra "Termina em".
  for (const hour of [0, 15]) {
    const slot = { ...jit, scheduledAt: new Date(T0 + hour * MIN).toISOString() };
    assert.equal(room.offerWindowFor({ display: null, offer: offer({ deadlineMinutes: 10 }), session: slot }).deadlineAt, null);
  }
  // Uma linha gravada antes da regra (com prazo) tambem sai sem prazo na sessao jit.
  const antiga = { deadlineAt: new Date(T0 + 60 * MIN).toISOString(), hiddenAt: null, hideOffsetMs: null, showOffsetMs: 45 * MIN };
  assert.equal(room.offerWindowFor({ display: antiga, offer: offer({ deadlineMinutes: 15 }), session: jit }).deadlineAt, null);
  assert.equal(room.offerWindowFor({ display: antiga, offer: offer({ deadlineMinutes: 15 }), session: simulated }).deadlineAt, antiga.deadlineAt, "na marcada a linha manda");
  const manual = room.manualOfferDisplay({ existing: null, jit: true, nowMs: T0 + 20 * MIN, offer: offer({ deadlineMinutes: 30, triggerKind: "manual" }), offsetMs: 20 * MIN, sessionId: SESSION, userId: "eeee" });
  assert.equal(manual.deadline_at, null);
  assert.equal(manual.snapshot.deadlineAt, null);
});

test("janela: comeca no minuto (inclusive) e acaba no Some em (exclusive); offset invalido nunca esta dentro", () => {
  const window = { hideAtMs: 55 * MIN, showAtMs: 45 * MIN };
  assert.equal(room.isInOfferWindow(window, 45 * MIN - 1), false);
  assert.equal(room.isInOfferWindow(window, 45 * MIN), true);
  assert.equal(room.isInOfferWindow(window, 55 * MIN - 1), true);
  assert.equal(room.isInOfferWindow(window, 55 * MIN), false);
  assert.equal(room.isInOfferWindow({ hideAtMs: null, showAtMs: 0 }, 10 * 3600_000), true, "ate o fim");
  assert.equal(room.isInOfferWindow(window, Number.NaN), false);
  assert.equal(room.isInOfferWindow(null, 50 * MIN), false);
});

test("offset do clique: a gravada usa o relogio do servidor (o do corpo e ignorado); o replay usa o do corpo; a live nao tem", () => {
  assert.equal(room.offerOffsetMs(simulated, T0 + 50 * MIN, 1), 50 * MIN);
  assert.equal(room.offerOffsetMs(replay, T0, 12_345.4), 12_345);
  assert.ok(Number.isNaN(room.offerOffsetMs(replay, T0)));
  assert.ok(Number.isNaN(room.offerOffsetMs(live, T0, 1000)));
});

test("recusa do clique: antes, depois, escondida ou com o prazo vencido = offer_hidden; dentro = nada", () => {
  const window = room.plannedOfferWindow(offer({ deadlineMinutes: 5 }), simulated);
  assert.equal(room.offerClickRefusal({ nowMs: T0 + 44 * MIN, offsetMs: 44 * MIN, window }), "offer_hidden");
  assert.equal(room.offerClickRefusal({ nowMs: T0 + 46 * MIN, offsetMs: 46 * MIN, window }), null);
  assert.equal(room.offerClickRefusal({ nowMs: T0 + 50 * MIN, offsetMs: 50 * MIN, window }), "offer_hidden", "o prazo de 5 min venceu");
  assert.equal(room.offerClickRefusal({ nowMs: T0 + 56 * MIN, offsetMs: 56 * MIN, window: room.plannedOfferWindow(offer(), simulated) }), "offer_hidden");
  const hidden = room.displayOfferWindow(display({ hiddenAt: new Date(T0 + 35 * MIN).toISOString(), hideOffsetMs: 35 * MIN }));
  assert.equal(room.offerClickRefusal({ nowMs: T0 + 36 * MIN, offsetMs: 36 * MIN, window: hidden }), "offer_hidden");
  assert.equal(room.offerClickRefusal({ nowMs: T0, offsetMs: 0, window: null }), "offer_hidden");
});

test("a sessao grava o que mostrou uma vez: na gravada a partir do minuto e antes do fim do video; no replay na primeira leitura", () => {
  const planned = room.plannedOfferWindow(offer(), simulated);
  const base = { durationMs: 60 * MIN, session: simulated, window: planned };
  assert.equal(room.shouldRecordOfferDisplay({ ...base, offsetMs: 44 * MIN }), false, "antes do minuto nada e gravado");
  assert.equal(room.shouldRecordOfferDisplay({ ...base, offsetMs: 45 * MIN }), true);
  assert.equal(room.shouldRecordOfferDisplay({ ...base, offsetMs: 56 * MIN }), false, "a janela ja fechou");
  assert.equal(room.shouldRecordOfferDisplay({ ...base, durationMs: 50 * MIN, offsetMs: 51 * MIN, window: room.plannedOfferWindow(offer({ visibleMinutes: null }), simulated) }), false, "depois do fim do video");
  assert.equal(room.shouldRecordOfferDisplay({ ...base, offsetMs: 45 * MIN, session: { ...simulated, status: "ended" } }), false);
  assert.equal(room.shouldRecordOfferDisplay({ ...base, offsetMs: Number.NaN, session: replay }), true);
  assert.equal(room.shouldRecordOfferDisplay({ ...base, offsetMs: 46 * MIN, window: room.displayOfferWindow(display()) }), false, "com a linha, nada de novo");
  assert.equal(room.replayDisplayOutdated(display({ shownBy: null, showOffsetMs: 40 * MIN, hideOffsetMs: 50 * MIN }), planned), true, "o replay acompanha o minuto editado");
  assert.equal(room.replayDisplayOutdated(display({ shownBy: null, showOffsetMs: 45 * MIN, hideOffsetMs: 55 * MIN }), planned), false);
  assert.equal(room.replayDisplayOutdated(display({ showOffsetMs: 40 * MIN }), planned), false, "a equipe mexeu: fica");
});

test("a foto do que foi mostrado: so as variantes ligadas, sem link nem imagem; a linha do minuto marcado sem quem mostrou", () => {
  const source = offer({ deadlineMinutes: 15, variants: [variant("A"), variant("B", { enabled: false }), variant("C")] });
  const window = room.plannedOfferWindow(source, simulated);
  const draft = room.plannedOfferDisplayDraft({ nowMs: T0 + 45 * MIN, offer: source, sessionId: SESSION, window });
  assert.deepEqual(draft, {
    deadline_at: new Date(T0 + 60 * MIN).toISOString(),
    hide_offset_ms: 55 * MIN,
    offer_id: OFFER,
    session_id: SESSION,
    show_offset_ms: 45 * MIN,
    shown_by: null,
    snapshot: {
      capturedAt: new Date(T0 + 45 * MIN).toISOString(),
      deadlineAt: new Date(T0 + 60 * MIN).toISOString(),
      variants: [
        { badge: "Selo A", coupon: "B707", headline: "Formação A", label: "A", priceFromLabel: "R$ 997", priceLabel: "R$ 497" },
        { badge: "Selo C", coupon: null, headline: "Formação C", label: "C", priceFromLabel: "R$ 997", priceLabel: "R$ 497" }
      ]
    }
  });
  assert.doesNotMatch(JSON.stringify(draft.snapshot), /hotmart|checkout/i);
});

test("Mostrar agora: aparece no segundo de agora e some no Some em; mostrar de novo guarda o comeco e o prazo da primeira vez; Esconder fecha agora", () => {
  const source = offer({ deadlineMinutes: 30, triggerKind: "manual", visibleMinutes: 10 });
  const first = room.manualOfferDisplay({ existing: null, nowMs: T0 + 20 * MIN, offer: source, offsetMs: 20 * MIN, sessionId: SESSION, userId: "eeee" });
  assert.equal(first.show_offset_ms, 20 * MIN);
  assert.equal(first.hide_offset_ms, 30 * MIN);
  assert.equal(first.deadline_at, new Date(T0 + 50 * MIN).toISOString(), "o prazo conta da hora em que apareceu");
  assert.equal(first.shown_by, "eeee");
  assert.equal(first.hidden_at, null);

  const again = room.manualOfferDisplay({
    existing: { deadlineAt: first.deadline_at, showOffsetMs: first.show_offset_ms },
    nowMs: T0 + 40 * MIN,
    offer: source,
    offsetMs: 40 * MIN,
    sessionId: SESSION,
    userId: "ffff"
  });
  assert.equal(again.show_offset_ms, 20 * MIN, "o comeco mais cedo da sessao fica");
  assert.equal(again.hide_offset_ms, 50 * MIN);
  assert.equal(again.deadline_at, first.deadline_at, "o prazo real nao recomeca a cada clique");

  const forever = room.manualOfferDisplay({ existing: null, nowMs: T0, offer: offer({ deadlineMinutes: null, visibleMinutes: null }), offsetMs: 5 * MIN, sessionId: SESSION, userId: "eeee" });
  assert.equal(forever.hide_offset_ms, null);
  assert.equal(forever.deadline_at, null);

  const hide = room.hideOfferDisplayPatch({ display: { hideOffsetMs: 50 * MIN, showOffsetMs: 20 * MIN }, nowMs: T0 + 33 * MIN, offsetMs: 33 * MIN, userId: "gggg" });
  assert.deepEqual(hide, { hidden_at: new Date(T0 + 33 * MIN).toISOString(), hidden_by: "gggg", hide_offset_ms: 33 * MIN });
  assert.equal(room.offerOnScreen(room.displayOfferWindow({ deadlineAt: null, hiddenAt: hide.hidden_at, hideOffsetMs: hide.hide_offset_ms, showOffsetMs: 20 * MIN }), 34 * MIN), false);
});

test("o card do aluno: a variante dele e a janela, nunca o link do checkout nem o peso; aparece pela janela; Fechar vale ate a proxima", () => {
  const window = room.plannedOfferWindow(offer({ deadlineMinutes: 15 }), simulated);
  const view = room.studentOfferView({ offer: offer(), variant: variant("A", { imageUrl: "https://cdn.exemplo.test/a.png" }), visible: true, window });
  assert.deepEqual(Object.keys(view).sort(), ["badge", "coupon", "deadlineAt", "headline", "hideAtMs", "imageUrl", "offerId", "priceFromLabel", "priceLabel", "showAtMs", "variant", "visible"]);
  assert.equal(view.variant, "A");
  assert.doesNotMatch(JSON.stringify(view), /hotmart|weight/);
  assert.equal(room.shouldShowOffer(view, 45 * MIN), true);
  assert.equal(room.shouldShowOffer(view, 44 * MIN), false);
  assert.equal(room.shouldShowOffer({ ...view, showAtMs: null }, 45 * MIN), false);
  assert.equal(room.shouldShowOffer(null, 45 * MIN), false);
  assert.notEqual(room.offerWindowKey(view), room.offerWindowKey({ ...view, hideAtMs: 70 * MIN }), "uma janela nova traz o card de volta");
  assert.equal(room.offerCountdownText(65_000), "01:05");
  assert.equal(room.offerCountdownText(3_723_000), "1:02:03");
  assert.equal(room.offerCountdownText(-5), "00:00");
  assert.equal(room.offerCountdownText(1), "00:01", "arredonda para cima: nunca mostra 00:00 antes do fim");
});

test("quem ja tem o produto nao ve o card: acesso ativo e na janela, pelo alvo, pela venda ou o coringa; o provedor nunca decide", () => {
  const now = T0;
  const row = (extra) => ({ ends_at: null, product_id: null, starts_at: null, status: "active", target_id: "formacao-ia", target_type: "formation", ...extra });
  assert.equal(room.ownsOfferProduct([row()], "formacao-ia", now), true);
  assert.equal(room.ownsOfferProduct([row({ product_id: "formacao-ia", target_id: "outro" })], "formacao-ia", now), true);
  assert.equal(room.ownsOfferProduct([row({ target_id: "*", target_type: "platform" })], "formacao-ia", now), true);
  assert.equal(room.ownsOfferProduct([row({ status: "revoked" })], "formacao-ia", now), false);
  assert.equal(room.ownsOfferProduct([row({ ends_at: new Date(now - 1).toISOString() })], "formacao-ia", now), false, "vencido");
  assert.equal(room.ownsOfferProduct([row({ starts_at: new Date(now + MIN).toISOString() })], "formacao-ia", now), false, "ainda nao comecou");
  assert.equal(room.ownsOfferProduct([row({ target_id: "outro-curso" })], "formacao-ia", now), false);
  assert.equal(room.ownsOfferProduct([], "formacao-ia", now), false);
});

test("o console: cliques e alunos por variante na ordem A..D (as letras da oferta mesmo sem clique) e o total", () => {
  const clicks = [
    { userId: "u1", variantLabel: "B" },
    { userId: "u1", variantLabel: "B" },
    { userId: "u2", variantLabel: "A" },
    { userId: "u3", variantLabel: "B" }
  ];
  assert.deepEqual(room.offerClickCounts(clicks, ["A", "B", "C"]), {
    byVariant: [
      { clicks: 1, label: "A", students: 1 },
      { clicks: 3, label: "B", students: 2 },
      { clicks: 0, label: "C", students: 0 }
    ],
    clicks: 4,
    students: 3
  });
  assert.equal(room.offerMinute(45 * MIN + 59_000), 45);
  assert.equal(room.studentOfferPollMs({ session: simulated, teamMayChange: true }), room.OFFER_MANUAL_POLL_MS);
  assert.equal(room.studentOfferPollMs({ session: simulated, teamMayChange: false }), room.OFFER_POLL_MS);
  assert.equal(room.studentOfferPollMs({ session: replay, teamMayChange: true }), room.OFFER_POLL_MS, "no replay a equipe nao mostra nem esconde");
});

test("M7: a variante por md5 e a mesma do Postgres (B, B, C, D com pesos 1, 2, 1, 3), estavel, e a desligada nunca cai", () => {
  const weighted = [["A", 1], ["B", 2], ["C", 1], ["D", 3]].map(([label, weight]) => ({ enabled: true, label, weight }));
  const expected = {
    "00000000-0000-4000-8000-0000000000a1": "B",
    "00000000-0000-4000-8000-0000000000b2": "B",
    "00000000-0000-4000-8000-0000000000c3": "C",
    "9d2f6a3e-1b7c-4e8a-9f00-5c4d3b2a1e0f": "D"
  };
  for (const [userId, label] of Object.entries(expected)) {
    assert.equal(offerModel.offerVariantFor({ offerId: OFFER, userId, variants: weighted })?.label, label, userId);
    assert.equal(offerModel.offerVariantFor({ offerId: OFFER, userId: userId.toUpperCase(), variants: [...weighted].reverse() })?.label, label, "a ordem e o caso nao mudam a variante");
  }
  const withoutB = weighted.map((item) => (item.label === "B" ? { ...item, enabled: false } : item));
  for (const userId of Object.keys(expected)) {
    assert.notEqual(offerModel.offerVariantFor({ offerId: OFFER, userId, variants: withoutB })?.label, "B");
  }
  assert.equal(offerModel.offerVariantFor({ offerId: OFFER, userId: ALUNO, variants: [] }), null);
});

test("o link do clique: o checkout da variante com ?b7=<token> (troca um b7 antigo); so https; o token e base64url de 24", () => {
  const token = offerModel.newClickToken();
  assert.equal(offerModel.isClickToken(token), true);
  assert.equal(token.length, 24);
  assert.equal(offerModel.checkoutUrlWithToken("https://pay.hotmart.com/X?off=1&b7=velho", token), `https://pay.hotmart.com/X?off=1&b7=${token}`);
  assert.equal(offerModel.checkoutUrlWithToken("http://pay.hotmart.com/X", token), null);
  assert.equal(offerModel.checkoutUrlWithToken("javascript:alert(1)", token), null);
});

test("o formulario do editor: oferta nova com a variante A; ate quatro letras; Divisao igual = pesos 1; minutos viram ms; volta pelo zod", () => {
  const empty = editor.emptyOfferForm();
  assert.equal(empty.status, "draft");
  assert.equal(empty.triggerKind, "at_offset");
  assert.equal(empty.attributionDays, "7");
  assert.deepEqual(empty.variants.map((item) => item.label), ["A"]);

  let form = empty;
  for (let index = 0; index < 5; index += 1) {
    form = editor.addVariant(form);
  }
  assert.deepEqual(form.variants.map((item) => item.label), ["A", "B", "C", "D"], "no maximo A, B, C e D");
  assert.equal(editor.nextVariantLabel(form.variants), null);
  form = editor.removeVariant(form, "B");
  assert.equal(editor.nextVariantLabel(form.variants), "B", "a letra que saiu volta a ficar livre");
  assert.deepEqual(editor.addVariant(form).variants.map((item) => item.label), ["A", "B", "C", "D"]);
  assert.equal(editor.removeVariant({ ...empty }, "A").variants.length, 1, "sempre fica uma variante");

  const filled = {
    ...empty,
    deadline: "minutes",
    deadlineMinutes: "15",
    productId: "formacao-ia",
    showAtMinutes: "45",
    status: "active",
    variants: [
      { ...editor.emptyVariant("A"), checkoutUrl: " https://pay.hotmart.com/A ", headline: "Formação", priceLabel: "R$ 497" },
      { ...editor.emptyVariant("B"), checkoutUrl: "https://pay.hotmart.com/B", enabled: false, headline: "Formação B" }
    ],
    visible: "minutes",
    visibleMinutes: "10"
  };
  const draft = editor.offerDraftOfForm(filled);
  assert.equal(draft.showAtOffsetMs, 45 * MIN);
  assert.equal(draft.visibleMinutes, 10);
  assert.equal(draft.deadlineMinutes, 15);
  assert.deepEqual(draft.variants.map((item) => item.weight), [1, 1], "Divisao igual");
  assert.equal(draft.variants[0].checkoutUrl, "https://pay.hotmart.com/A");
  assert.equal(draft.variants[0].badge, null, "vazio vira nulo");
  const parsed = offerDraftSchema.safeParse(draft);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  assert.equal(editor.offerDraftOfForm({ ...filled, deadline: "none", triggerKind: "manual", visible: "end" }).showAtOffsetMs, null);

  const roundTrip = editor.offerFormOf({ ...offer(), deadlineMinutes: 15, showAtOffsetMs: 45 * MIN });
  assert.equal(roundTrip.showAtMinutes, "45");
  assert.equal(roundTrip.deadline, "minutes");
  assert.equal(roundTrip.visible, "minutes");
  assert.deepEqual(roundTrip.variants.map((item) => item.label), ["A", "B"]);

  const broken = offerDraftSchema.safeParse(editor.offerDraftOfForm({ ...filled, variants: [{ ...filled.variants[0], checkoutUrl: "http://pay.hotmart.com/A" }] }));
  assert.equal(broken.success, false);
  const errors = editor.offerFieldErrors({ "draft.variants.0.checkoutUrl": [broken.error.issues[0].message], "draft.productId": ["Escolha o produto que a compra libera."] });
  assert.equal(errors["variants.0.checkoutUrl"], "Cole o link de checkout completo, começando com https://.");
  assert.equal(errors.productId, "Escolha o produto que a compra libera.");
});

test("o console: Mostrar agora / Esconder que rejeitam na rede viram a frase de erro e nunca deixam o botao ocupado", async () => {
  const caiu = await editor.settleConsoleOfferAction(() => Promise.reject(new TypeError("Failed to fetch")), "Não deu.");
  assert.deepEqual(caiu, { error: "Não deu.", ok: false }, "a rejeicao vira erro (antes, setBusy(null) nunca rodava)");
  const lancou = await editor.settleConsoleOfferAction(() => {
    throw new Error("action nao encontrada");
  }, "Não deu.");
  assert.deepEqual(lancou, { error: "Não deu.", ok: false });
  assert.deepEqual(await editor.settleConsoleOfferAction(async () => ({ error: "Sessão encerrada.", ok: false, status: 409 }), "Não deu."), { error: "Sessão encerrada.", ok: false });
  assert.deepEqual(await editor.settleConsoleOfferAction(async () => ({ error: "", ok: false, status: 500 }), "Não deu."), { error: "Não deu.", ok: false });
  assert.deepEqual(await editor.settleConsoleOfferAction(async () => ({ data: { x: 1 }, ok: true }), "Não deu."), { data: { x: 1 }, ok: true });
});

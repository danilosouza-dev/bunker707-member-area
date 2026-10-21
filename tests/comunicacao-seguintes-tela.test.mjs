import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// "Depois desta notificação" no editor de avisos (Comunicacao v2, docs/23 §2.2): as regras puras do cartao
// das notificacoes seguintes (src/components/admin/v2/communication/follow-ups-view-model.ts) e a frase do
// "Retirar do sino" com seguintes (notices-view-model.ts).

const model = await import("../src/components/admin/v2/communication/follow-ups-view-model.ts");
const notices = await import("../src/components/admin/v2/communication/notices-view-model.ts");
const audience = await import("../src/server/communications/audience-model.ts");
const flow = await import("../src/server/communications/flow-model.ts");
const { saveNoticeFollowUpsSchema } = await import("../src/server/communications/flow-schemas.ts");

const ENTRADA = "11111111-1111-4111-8111-111111111111";
const S1 = "22222222-2222-4222-8222-222222222222";
const S2 = "33333333-3333-4333-8333-333333333333";
const S11 = "44444444-4444-4444-8444-444444444444";
const PRODUTO = "formacao-ia";
const NOW = Date.parse("2026-10-21T15:00:00.000Z");
const DIA = 1_440;
const FORBIDDEN_COPY = /campanha|público|audiência|evento|oferta|gatilho|automação|lembrete/i;

const conteudo = (extra = {}) => ({ audio: null, body: "", cta: null, icon: null, image: null, response: null, sender: null, title: "Aula nova", validity: { mode: "default" }, ...extra });
const audio = { durationSeconds: 30, mimeType: "audio/webm", peaks: [10, 20], url: "https://exemplo.test/a.webm" };
const botaoProduto = { href: `/conteudo/${PRODUTO}`, label: "Ver agora", target: "same_tab" };
const principal = (extra = {}) => model.followUpParentOf(ENTRADA, "main", conteudo(extra));

function aluno(extra = {}) {
  return {
    accesses: [],
    cohortIds: [],
    comments: { d7: 0, d30: 0, d90: 0, total: 0 },
    completedByContent: {},
    completedLessons: 0,
    lastSignInAt: null,
    lastStudiedAt: null,
    pace: "never_started",
    totalLessons: 0,
    userId: "aluno-1",
    ...extra
  };
}

function linha(extra = {}) {
  return { audioCompletedAt: null, audioStartedAt: null, clickedAt: null, expiresAt: NOW + 80 * 86_400_000, openedAt: null, response: null, seenAt: null, visibleAt: NOW - 86_400_000, ...extra };
}

/** O mesmo objeto com as chaves na ordem inversa (como o jsonb pode devolver). */
function reverseKeys(value) {
  if (Array.isArray(value)) {
    return value.map(reverseKeys);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverseKeys(value[key])]));
  }

  return value;
}

const contexto = { commentRanks: audience.buildCommentRanks([]), lessonTotals: {}, messageKeys: new Set([`node:${ENTRADA}`]), now: NOW };

/* ------------------------------------------------------------------------------------------------
 * Escolhas rapidas conforme o que a notificacao de cima tem
 * ---------------------------------------------------------------------------------------------- */

test("aviso curto so de texto: só 'nem viu no sino' e 'viu no sino', nunca 'não abriu' (com a nota)", () => {
  const curto = principal({ body: "Aula nova no ar." });

  assert.equal(model.hasSomethingToOpen(curto), false);
  assert.deepEqual(model.quickChoicesFor(curto), ["not_seen", "seen", "everyone", "rules"]);
  assert.equal(model.defaultQuickChoice(curto), "not_seen");
  assert.equal(model.QUICK_CHOICE_COPY.seen.hint, model.NOTHING_TO_OPEN_NOTE);
  assert.match(model.NOTHING_TO_OPEN_NOTE, /só dá para saber se ele viu/);
});

test("'Ver mais', áudio, botão ou resposta liberam 'viu no sino, mas não abriu' (primeira e padrão) e 'não abriu'", () => {
  const longo = principal({ body: "x".repeat(181) });
  const comAudio = principal({ audio });
  const comBotao = principal({ cta: { href: "https://exemplo.test", label: "Ver", target: "new_tab" } });
  const comResposta = principal({ response: { acceptLabel: "Vou", declineLabel: "Não vou" } });

  for (const parent of [longo, comAudio, comBotao, comResposta]) {
    const choices = model.quickChoicesFor(parent);

    assert.equal(model.hasSomethingToOpen(parent), true);
    assert.equal(choices[0], "seen_not_opened");
    assert.ok(choices.includes("not_opened"));
    assert.ok(choices.includes("not_seen"));
    assert.ok(!choices.includes("seen"), "'viu no sino' so quando nao ha o que abrir");
  }

  assert.equal(model.defaultQuickChoice(longo), "seen_not_opened");
  assert.equal(model.QUICK_CHOICE_COPY.seen_not_opened.hint, "Abrir é tocar no cartão, em “Ver mais”, no áudio, no botão ou responder. “Marcar todas como lidas” não conta.");
  assert.equal(model.QUICK_CHOICE_COPY.not_opened.hint, "Inclui quem ainda nem abriu o sino: essa pessoa vai ver as duas juntas.");
  assert.equal(model.QUICK_CHOICE_COPY.not_seen.hint, "Quem ainda não abriu o sino vai ver as duas juntas quando abrir.");
});

test("botão, página acompanhada, áudio e resposta: cada um traz as suas escolhas; botão externo não tem 'visitou'", () => {
  const externo = model.quickChoicesFor(principal({ cta: { href: "https://exemplo.test", label: "Ver", target: "new_tab" } }));
  assert.ok(externo.includes("opened_not_clicked") && externo.includes("not_clicked") && externo.includes("clicked_no_access"));
  assert.ok(!externo.includes("visited_no_access") && !externo.includes("not_visited"));

  const naArea = model.quickChoicesFor(principal({ cta: botaoProduto }));
  assert.deepEqual(naArea, [
    "seen_not_opened",
    "not_seen",
    "not_opened",
    "opened_not_clicked",
    "not_clicked",
    "clicked_no_access",
    "visited_no_access",
    "not_visited",
    "everyone",
    "rules"
  ]);

  const paginaDesconhecida = model.quickChoicesFor(principal({ cta: { href: "/algo-novo", label: "Ver", target: "same_tab" } }));
  assert.ok(!paginaDesconhecida.includes("not_visited"), "pagina interna nao acompanhada: so 'clicou'");

  assert.deepEqual(
    model.quickChoicesFor(principal({ audio })).filter((id) => id.startsWith("audio")),
    ["audio_not_started", "audio_not_completed", "audio_completed"]
  );
  assert.deepEqual(
    model.quickChoicesFor(principal({ response: { acceptLabel: "Vou", declineLabel: "Não vou" } })).slice(3, 6),
    ["not_responded", "accepted", "declined"]
  );

  const rotulos = model.QUICK_CHOICE_IDS.map((id) => model.QUICK_CHOICE_COPY[id].label);
  assert.ok(rotulos.includes("não visitou a página do botão"));
  assert.ok(rotulos.includes("visitou a página do botão, mas ainda não tem acesso a"));
  for (const rotulo of rotulos) {
    assert.doesNotMatch(rotulo, FORBIDDEN_COPY);
  }
});

test("cada escolha vira regras sobre a notificação de cima; negar implica 'recebeu'", () => {
  const parent = principal({ cta: botaoProduto });
  const ref = { kind: "node", nodeId: ENTRADA };

  assert.deepEqual(model.quickChoiceRules("seen_not_opened", parent), {
    kind: "rules",
    root: { items: [{ action: "seen", negate: false, ref, type: "message" }, { action: "opened", negate: true, ref, type: "message" }], match: "all" }
  });
  assert.deepEqual(model.quickChoiceRules("not_visited", parent).root.items, [
    { negate: true, page: { kind: "message_cta", nodeId: ENTRADA }, since: { kind: "message", nodeId: ENTRADA }, type: "page_visit" }
  ]);
  assert.deepEqual(model.quickChoiceRules("everyone", parent), { kind: "everyone" });
  assert.equal(model.quickChoiceRules("rules", parent), null);

  // "nem viu no sino": quem nao recebeu nunca combina, quem recebeu e nao viu combina.
  const naoViu = model.quickChoiceRules("not_seen", parent);
  assert.equal(audience.evaluateAudience(naoViu, aluno({ messages: { [`node:${ENTRADA}`]: linha() } }), contexto), true);
  assert.equal(audience.evaluateAudience(naoViu, aluno({ messages: { [`node:${ENTRADA}`]: linha({ seenAt: NOW }) } }), contexto), false);
  assert.equal(audience.evaluateAudience(naoViu, aluno({ messages: {} }), contexto), false, "nao recebeu");

  // "viu no sino, mas não abriu" pula quem nunca abriu o sino.
  const viuNaoAbriu = model.quickChoiceRules("seen_not_opened", parent);
  assert.equal(audience.evaluateAudience(viuNaoAbriu, aluno({ messages: { [`node:${ENTRADA}`]: linha() } }), contexto), false);
  assert.equal(audience.evaluateAudience(viuNaoAbriu, aluno({ messages: { [`node:${ENTRADA}`]: linha({ seenAt: NOW }) } }), contexto), true);
});

test("'clicou no botão, mas ainda não tem acesso a Y' = clicou E não tem Y: quem já é dono de Y e clicou não recebe", () => {
  const parent = principal({ cta: botaoProduto });
  const item = model.changeQuickChoice(model.newFollowUpItem(S1, parent), "clicked_no_access", parent);

  assert.equal(item.productId, PRODUTO, "comeca no produto do botao");

  const regras = model.whoOfItem(item, parent);
  assert.deepEqual(regras.root.items[1], { op: "has_not", productIds: [PRODUTO], type: "product" });

  const clicou = { [`node:${ENTRADA}`]: linha({ clickedAt: NOW, openedAt: NOW, seenAt: NOW }) };
  assert.equal(audience.evaluateAudience(regras, aluno({ messages: clicou }), contexto), true, "clicou e nao tem");
  assert.equal(
    audience.evaluateAudience(regras, aluno({ accesses: [{ endsAt: null, productId: PRODUTO, startsAt: NOW - 1000 }], messages: clicou }), contexto),
    false,
    "dono de Y que clicou"
  );
  assert.equal(audience.evaluateAudience(regras, aluno({ messages: { [`node:${ENTRADA}`]: linha({ seenAt: NOW }) } }), contexto), false, "nao clicou");
});

test("'escolher por regras' abre com as regras da escolha marcada; quickChoiceOfRules reabre na escolha (ou no construtor)", () => {
  const parent = principal({ audio, cta: botaoProduto });
  const item = model.newFollowUpItem(S1, parent);

  assert.equal(item.choice, "seen_not_opened");

  const naoAbriu = model.changeQuickChoice(item, "not_opened", parent);
  const regras = model.changeQuickChoice(naoAbriu, "rules", parent);
  assert.equal(regras.choice, "rules");
  assert.deepEqual(regras.rules, model.quickChoiceRules("not_opened", parent), "comeca de 'não abriu'");

  for (const choice of model.quickChoicesFor(parent).filter((id) => id !== "rules")) {
    const productId = model.quickChoiceNeedsProduct(choice) ? "outro-produto" : null;
    const saved = model.quickChoiceRules(choice, parent, productId);
    // Volta do jsonb com as chaves em outra ordem.
    const reordered = reverseKeys(saved);

    assert.deepEqual(model.quickChoiceOfRules(audience.normalizeAudience(saved), parent), { choice, productId }, choice);
    assert.equal(model.quickChoiceOfRules(reordered, parent).choice, choice, `${choice} com outra ordem de chaves`);
  }

  // "não abriu E tem acesso a X" nao e escolha rapida.
  const mistura = {
    kind: "rules",
    root: { items: [...model.quickChoiceRules("not_opened", parent).root.items, { op: "has", productIds: [PRODUTO], type: "product" }], match: "all" }
  };
  assert.equal(model.quickChoiceOfRules(mistura, parent).choice, "rules");

  // Regra que so vale com botao, numa notificacao sem botao: construtor.
  assert.equal(model.quickChoiceOfRules(model.quickChoiceRules("not_clicked", parent), principal()).choice, "rules");
});

/* ------------------------------------------------------------------------------------------------
 * Linha "Parar ... para quem tiver acesso a"
 * ---------------------------------------------------------------------------------------------- */

test("linha de parar: marcada com o produto do botão, vira o objetivo do fluxo e volta", () => {
  assert.deepEqual(model.initialStopLine(`/conteudo/${PRODUTO}`), { enabled: true, kind: "product", productId: PRODUTO });
  assert.deepEqual(model.initialStopLine(`/conteudo/${PRODUTO}/aulas/aula-1`), { enabled: true, kind: "product", productId: PRODUTO });
  assert.deepEqual(model.initialStopLine("/minhas-compras"), { enabled: false, kind: "product", productId: null });
  assert.deepEqual(model.initialStopLine(null), { enabled: false, kind: "product", productId: null });

  assert.deepEqual(model.goalOfStopLine({ enabled: true, kind: "product", productId: PRODUTO }), { productId: PRODUTO });
  assert.equal(model.goalOfStopLine({ enabled: false, kind: "product", productId: PRODUTO }), null);
  assert.deepEqual(model.goalOfStopLine({ enabled: true, kind: "product", productId: null }), { productId: "" }, "o zod diz 'Escolha o produto.'");

  const goal = model.stopGoalDefinition(PRODUTO);
  assert.deepEqual(goal, { kind: "rules", root: { items: [{ op: "has", productIds: [PRODUTO], type: "product" }], match: "all" } });
  assert.deepEqual(model.stopLineOfGoal(goal), { enabled: true, kind: "product", productId: PRODUTO });
  assert.deepEqual(model.stopLineOfGoal(null), { enabled: false, kind: "product", productId: null });

  const doConstrutor = { kind: "rules", root: { items: [{ days: 7, op: "within", type: "last_study" }], match: "all" } };
  assert.equal(model.stopLineOfGoal(doConstrutor).kind, "other");
  assert.equal(model.goalOfStopLine(model.stopLineOfGoal(doConstrutor)), null, "o servidor guarda o objetivo do construtor");

  assert.equal(model.stopLineHint("Formação IA"), "Quem já tem ou ganhar acesso a Formação IA não recebe as notificações seguintes.");
  assert.equal(model.FOLLOW_UPS_COPY.stopLabel, "Parar as notificações seguintes para quem tiver acesso a");

  const parsed = saveNoticeFollowUpsSchema.safeParse({ expectedNoticeUpdatedAt: new Date(NOW).toISOString(), followUps: [], goal: { productId: "" }, noticeId: ENTRADA });
  assert.equal(parsed.success, false);
  assert.equal(parsed.error.issues[0].message, "Escolha o produto.");
});

/* ------------------------------------------------------------------------------------------------
 * "Quando sai" e o tempo no sino
 * ---------------------------------------------------------------------------------------------- */

test("'antes de vencer' com o tempo no sino ainda no padrão vira 'Até a notificação principal sumir'; escolhido, fica", () => {
  const parent = principal();
  const nova = model.newFollowUpItem(S1, parent);

  assert.deepEqual(nova.when, { anchor: "sent", minutes: DIA });
  assert.deepEqual(model.changeFollowUpAnchor(nova, "expires").content.validity, { mode: "with_anchor" });
  assert.equal(model.changeFollowUpAnchor(nova, "expires").when.anchor, "expires");

  const tresDias = { ...nova, content: { ...nova.content, validity: { minutes: 3 * DIA, mode: "duration" } } };
  assert.deepEqual(model.changeFollowUpAnchor(tresDias, "expires").content.validity, { minutes: 3 * DIA, mode: "duration" });

  assert.equal(model.followUpValidityAnchorLabel("main"), "Até a notificação principal sumir");
  assert.equal(model.followUpValidityAnchorLabel("previous"), "Até a notificação anterior sumir");
  assert.equal(model.followUpValidityLine({ mode: "with_anchor" }, "main"), "Fica no sino até a principal sumir");
  assert.equal(model.followUpValidityLine({ minutes: 3 * DIA, mode: "duration" }, "main"), "Fica 3 dias no sino");
});

test("frases de 'Quando sai': depois do envio, antes de vencer (com a hora), depois que a de cima sumiu e o erro", () => {
  const umDia = principal({ validity: { minutes: DIA, mode: "duration" } });

  assert.deepEqual(model.whenSentence({ anchor: "sent", minutes: DIA }, principal()), { text: "Sai 1 dia depois que a notificação principal chega ao aluno.", tone: "neutral" });
  assert.deepEqual(model.whenSentence({ anchor: "expires", minutes: 180 }, umDia), {
    text: "Sai 3 horas antes de a notificação principal sumir do sino (21 horas depois do envio).",
    tone: "neutral"
  });
  assert.deepEqual(model.whenSentence({ anchor: "sent", minutes: 2 * DIA }, umDia), { text: "Sai depois que a notificação principal já sumiu do sino.", tone: "neutral" });
  assert.deepEqual(model.whenSentence({ anchor: "expires", minutes: DIA }, { ...umDia, title: "Oferta" }), {
    text: "A notificação “Oferta” fica só 1 dia no sino. Escolha menos de 1 dia antes de vencer.",
    tone: "error"
  });

  const anterior = model.followUpParentOf(S1, "previous", conteudo({ validity: { mode: "with_anchor" } }));
  assert.equal(anterior.validityMinutes, null);
  assert.equal(model.whenSentence({ anchor: "sent", minutes: 60 }, anterior).text, "Sai 1 hora depois que a notificação anterior chega ao aluno.");
  assert.equal(model.whenSentence({ anchor: "expires", minutes: 60 }, anterior).text, "Sai 1 hora antes de a notificação anterior sumir do sino.");
  assert.equal(model.whenSentence({ anchor: "sent", minutes: Number.NaN }, anterior), null);

  // "Até uma data": conta da hora de envio, quando conhecida.
  const ate = { endsAt: new Date(NOW + 2 * 86_400_000).toISOString(), mode: "until" };
  assert.equal(model.validityMinutesOf(ate, NOW), 2 * DIA);
  assert.equal(model.validityMinutesOf(ate), null);

  assert.deepEqual(model.whenAnchorOptions("main").map((option) => option.label), ["depois do envio", "antes de vencer"]);
  assert.deepEqual(model.whenAnchorOptions("previous").map((option) => option.label), ["depois do envio da anterior", "antes de a anterior vencer"]);
  assert.deepEqual(model.WHEN_UNIT_OPTIONS.map((option) => option.label), ["minutos", "horas", "dias"]);
  assert.deepEqual(model.whenParts(DIA), { amount: 1, unit: "days" });
  assert.deepEqual(model.whenParts(180), { amount: 3, unit: "hours" });
  assert.deepEqual(model.whenParts(45), { amount: 45, unit: "minutes" });
  assert.equal(model.whenMinutes(2, "days"), 2 * DIA);
  assert.ok(Number.isNaN(model.whenMinutes(Number.NaN, "hours")));
});

test("a conferência da árvore no cartão: 'antes de vencer' maior que o tempo no sino da principal e espera fora do limite", () => {
  const notice = conteudo({ validity: { minutes: DIA, mode: "duration" } });
  const drafts = [
    { children: [], content: conteudo({ title: "Faltam 3 horas" }), id: S1, when: { anchor: "expires", minutes: 2 * DIA }, who: { kind: "everyone" } },
    { children: [], content: conteudo({ title: "Outra" }), id: S2, when: { anchor: "sent", minutes: 3 }, who: { kind: "everyone" } }
  ];
  const errors = model.followUpTreeErrors({ drafts, entryId: ENTRADA, notice });

  assert.equal(errors["followUps.0.when.minutes"], "A notificação “Aula nova” fica só 1 dia no sino. Escolha menos de 1 dia antes de vencer.");
  assert.equal(errors["followUps.1.when.minutes"], "Escolha de 5 minutos a 60 dias.");
  assert.deepEqual(model.followUpTreeErrors({ drafts: [{ ...drafts[0], when: { anchor: "expires", minutes: 180 } }], entryId: ENTRADA, notice }), {});
});

/* ------------------------------------------------------------------------------------------------
 * Rotulos, resumo, contagem e o caminho ate a Server Action
 * ---------------------------------------------------------------------------------------------- */

test("pílulas da prévia e números por nível: 'Esta notificação' · 'Seguinte 1' · 'Seguinte 1.1' · 'Seguinte 2'", () => {
  const items = [
    { children: [{ children: [], id: S11 }], id: S1 },
    { children: [], id: S2 }
  ];

  assert.deepEqual(model.followUpPreviewOptions(items), [
    { id: "main", label: "Esta notificação" },
    { id: S1, label: "Seguinte 1" },
    { id: S11, label: "Seguinte 1.1" },
    { id: S2, label: "Seguinte 2" }
  ]);
  assert.equal(model.followUpTitle(model.followUpNumbers(items).get(S11)), "Notificação seguinte 1.1");
  assert.equal(model.followUpPaths(items).get(S11), "followUps.0.children.0");
});

test("resumo do cartão: quando e para quem, com o nome do produto e as regras em frase", () => {
  const parent = principal({ cta: botaoProduto });
  const names = { cohorts: {}, messages: { [`node:${ENTRADA}`]: "Aula nova" }, products: { [PRODUTO]: "Formação IA" } };
  const item = model.newFollowUpItem(S1, parent);

  assert.equal(model.followUpSummary(item, parent, names), "1 dia depois do envio · para quem viu no sino, mas não abriu");
  assert.equal(
    model.followUpSummary(model.changeFollowUpAnchor({ ...model.changeQuickChoice(item, "not_clicked", parent), when: { anchor: "sent", minutes: 180 } }, "expires"), parent, names),
    "3 horas antes de vencer · para quem não clicou no botão"
  );
  assert.equal(
    model.followUpSummary(model.changeQuickChoice(item, "clicked_no_access", parent), parent, names),
    "1 dia depois do envio · para quem clicou no botão, mas ainda não tem acesso a Formação IA"
  );
  assert.equal(model.followUpSummary(model.changeQuickChoice(item, "everyone", parent), parent, names), "1 dia depois do envio · para todos que receberam");

  const regras = model.changeQuickChoice(model.changeQuickChoice(item, "not_opened", parent), "rules", parent);
  assert.equal(model.followUpSummary(regras, parent, names), "1 dia depois do envio · para alunos que não abriram a notificação “Aula nova”");

  const anterior = model.followUpParentOf(S1, "previous", conteudo());
  assert.equal(model.followUpWhenLabel({ anchor: "sent", minutes: 60 }, anterior.level), "1 hora depois do envio da anterior");
  assert.equal(model.followUpAudienceHeading("main"), "Quem recebeu a notificação principal e…");
  assert.equal(model.followUpAudienceHeading("previous"), "Quem recebeu a notificação anterior e…");
});

test("contagem ao vivo: depois do envio, antes do envio e falha", () => {
  assert.equal(model.followUpCountCopy({ qualified: 120, recipients: 318, status: "ready" }), "Agora, 120 dos 318 que receberam se encaixam.");
  assert.equal(model.followUpCountCopy({ qualified: 1_240, recipients: 20_000, status: "ready" }), "Agora, 1.240 dos 20.000 que receberam se encaixam.");
  assert.equal(model.followUpCountCopy({ qualified: null, recipients: 0, status: "ready" }), "A contagem aparece depois do envio.");
  assert.equal(model.followUpCountCopy({ status: "waiting" }), "A contagem aparece depois do envio.");
  assert.equal(model.followUpCountCopy({ status: "error" }), "Não foi possível contar agora.");
  assert.equal(model.followUpCountCopy({ status: "loading" }), null);
});

test("ida e volta: cartão -> rascunho da ação -> árvore -> cartão (com 'Até a principal sumir' e a seguinte da seguinte)", () => {
  const parent = principal({ audio, cta: botaoProduto, validity: { minutes: 3 * DIA, mode: "duration" } });
  const primeira = model.changeFollowUpAnchor({ ...model.newFollowUpItem(S1, parent), when: { anchor: "sent", minutes: 180 } }, "expires");
  const filha = model.newFollowUpItem(S11, model.followUpParentOf(S1, "previous", primeira.content));
  const segunda = model.changeQuickChoice(model.newFollowUpItem(S2, parent), "clicked_no_access", parent);
  const items = [{ ...primeira, children: [{ ...filha, content: { ...filha.content, title: "Lembra?" } }] }, segunda];

  const drafts = model.followUpDraftsOf(items, parent);
  assert.equal(drafts[0].children[0].who.root.items[0].ref.nodeId, S1, "a filha olha para a seguinte de cima");
  assert.equal(drafts[1].who.root.items[1].productIds[0], PRODUTO);

  const parsed = saveNoticeFollowUpsSchema.safeParse({
    expectedNoticeUpdatedAt: new Date(NOW).toISOString(),
    followUps: drafts.map((draft) => ({ ...draft, children: draft.children.map((child) => ({ ...child, content: { ...child.content } })), content: { ...draft.content, title: draft.content.title || "Título" } })),
    goal: null,
    noticeId: ENTRADA
  });
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));

  const nodes = flow.treeFromFollowUps(ENTRADA, model.followUpsOfDrafts(drafts));
  assert.equal(nodes.find((node) => node.id === S1).expireWithAnchor, true);

  const back = flow.followUpsFromTree({ nodes, origin: "notice" });
  const saved = back.map(function toSaved(followUp) {
    const draft = [drafts[0], drafts[1], drafts[0].children[0]].find((item) => item.id === followUp.id);
    return { campaignId: "versao", children: followUp.children.map(toSaved), content: draft.content, id: followUp.id, when: followUp.when, who: followUp.who };
  });
  const reopened = model.followUpFormItemsOf(saved, parent);

  assert.deepEqual(reopened.map((item) => item.choice), ["seen_not_opened", "clicked_no_access"]);
  assert.equal(reopened[0].children[0].choice, "not_seen", "a anterior e curta: a primeira escolha dela");
  assert.equal(reopened[1].productId, PRODUTO);
  assert.equal(model.followUpsStateKey(reopened, { enabled: false, kind: "product", productId: null }, parent), model.followUpsStateKey(items, { enabled: false, kind: "product", productId: null }, parent));
});

test("mudar para pop-up com seguintes pergunta antes e grava 'followUps: []'; voltar traz as seguintes", () => {
  const parent = principal();
  const items = [model.newFollowUpItem(S1, parent), model.newFollowUpItem(S2, parent)];

  assert.deepEqual(model.popupSwitchConfirm(2), { confirmLabel: "Mudar", description: "Mudar para pop-up remove as 2 notificações seguintes.", title: "Mudar para pop-up?" });
  assert.equal(model.popupSwitchConfirm(1).description, "Mudar para pop-up remove a notificação seguinte.");
  assert.deepEqual(model.followUpsToSave("popup", items, parent), []);
  assert.equal(model.followUpsToSave("inbox", items, parent).length, 2);
});

test("a árvore do construtor que o cartão não desenha (condição) fica só para ler, com 'Editar no fluxo'", () => {
  const nodes = flow.treeFromFollowUps(ENTRADA, [{ campaignId: "", children: [], expireWithAnchor: false, id: S1, when: { anchor: "sent", minutes: DIA }, who: { kind: "everyone" } }]);
  const condicao = { ...nodes[1], anchor: "previous", anchorNodeId: null, condition: { kind: "rules", root: { items: [], match: "all" } }, kind: "condition" };

  assert.equal(flow.followUpsFromTree({ nodes: [nodes[0], condicao], origin: "notice" }), null);
  assert.deepEqual(
    model.followUpsModeOf({ canPublish: true, canPublishLarge: true, drawable: false, flowEndedReason: null, flowStatus: "draft", noticeStatus: "draft", recipients: null }),
    { kind: "readonly", note: "Esta notificação tem passos que só aparecem no fluxo.", reason: "builder" }
  );
  assert.equal(model.FOLLOW_UPS_COPY.editInFlow, "Editar no fluxo");
  assert.equal(model.noticeFlowHref("f-1"), "/admin/comunicacao/fluxos/f-1");
  assert.equal(model.noticeFlowHref("f-1", { edit: true }), "/admin/comunicacao/fluxos/f-1?editar=1");
});

test("situação da seção: editor antes do envio; no ar (com o aviso) depois; só leitura quando retirada, concluída ou sem permissão", () => {
  const base = { canPublish: true, canPublishLarge: false, drawable: true, flowEndedReason: null, flowStatus: "active", recipients: 318 };

  for (const noticeStatus of ["draft", "pending_approval", "scheduled"]) {
    assert.deepEqual(model.followUpsModeOf({ ...base, noticeStatus }), { kind: "edit" });
  }

  assert.deepEqual(model.followUpsModeOf({ ...base, noticeStatus: "sent" }), { kind: "live" });
  assert.match(model.FOLLOW_UPS_COPY.liveBanner, /^Esta notificação já saiu\. As mudanças valem a partir de agora/);
  assert.deepEqual(model.followUpsModeOf({ ...base, flowEndedReason: "finished", flowStatus: "ended", noticeStatus: "sent" }), {
    kind: "readonly",
    note: "Esta notificação já saiu do sino de todos: não dá para adicionar notificações seguintes.",
    reason: "finished"
  });
  assert.deepEqual(model.followUpsModeOf({ ...base, noticeStatus: "canceled" }), { kind: "readonly", note: null, reason: "withdrawn" });
  assert.deepEqual(model.followUpsModeOf({ ...base, flowEndedReason: "source_withdrawn", flowStatus: "ended", noticeStatus: "sent" }).reason, "withdrawn");
  assert.equal(model.followUpsModeOf({ ...base, canPublish: false, noticeStatus: "sent" }).reason, "permission");
  assert.equal(model.followUpsModeOf({ ...base, noticeStatus: "sent", recipients: 501 }).reason, "large");
  assert.deepEqual(model.followUpsModeOf({ ...base, canPublishLarge: true, noticeStatus: "sent", recipients: 501 }), { kind: "live" });
  assert.deepEqual(model.followUpsModeOf({ ...base, flowStatus: null, noticeStatus: "sent" }), { kind: "live" }, "a primeira seguinte depois do envio");
});

/* ------------------------------------------------------------------------------------------------
 * Lista: limites, duplicar, remover e as confirmacoes
 * ---------------------------------------------------------------------------------------------- */

test("limites: 5 por notificação, 3 níveis contando a principal, 20 no total", () => {
  const parent = principal();
  const cinco = [1, 2, 3, 4, 5].map((index) => model.newFollowUpItem(`s-${index}`, parent));

  assert.equal(model.addFollowUpProblem(cinco.slice(0, 4), null), null);
  assert.equal(model.addFollowUpProblem(cinco, null), "Use no máximo 5 notificações seguintes por notificação.");

  const comFilha = [{ ...cinco[0], children: [model.newFollowUpItem("filha", parent)] }];
  assert.equal(model.addFollowUpProblem(comFilha, "s-1"), null, "a seguinte da principal pode ter as dela");
  assert.equal(model.addFollowUpProblem(comFilha, "filha"), "As notificações seguintes vão até 3 níveis, contando a notificação principal.");
  assert.equal(model.canNestFollowUp(1), true);
  assert.equal(model.canNestFollowUp(2), false);

  const vinte = cinco.map((item, index) => ({ ...item, children: [1, 2, 3].map((child) => model.newFollowUpItem(`f-${index}-${child}`, parent)) }));
  assert.equal(model.countFollowUps(vinte), 20);
  assert.equal(model.addFollowUpProblem(vinte, "s-1"), "Use no máximo 20 notificações seguintes.");
  assert.match(model.FOLLOW_UPS_COPY.limits, /no máximo 3 notificações de fluxos e notificações seguintes por dia/);
  assert.match(model.FOLLOW_UPS_COPY.limits, /Até 5 notificações seguintes por notificação, em até 3 níveis\./);
});

test("duplicar copia a seguinte e as dela com ids novos (as regras da filha apontam para a cópia); remover leva as de baixo", () => {
  const parent = principal({ body: "x".repeat(200) });
  const filha = model.changeQuickChoice(model.newFollowUpItem(S11, model.followUpParentOf(S1, "previous", conteudo({ body: "x".repeat(200) }))), "rules", model.followUpParentOf(S1, "previous", conteudo({ body: "x".repeat(200) })));
  const items = [{ ...model.newFollowUpItem(S1, parent), campaignId: "versao-1", children: [filha] }];
  let next = 0;
  const { copyId, items: duplicated } = model.duplicateFollowUp(items, S1, () => `novo-${++next}`);

  assert.equal(copyId, "novo-1");
  assert.equal(duplicated.length, 2);
  assert.equal(duplicated[1].campaignId, "", "a copia e conteudo novo");
  assert.equal(duplicated[1].children[0].id, "novo-2");
  assert.equal(duplicated[1].children[0].rules.root.items[0].ref.nodeId, "novo-1");
  assert.equal(duplicated[0].children[0].rules.root.items[0].ref.nodeId, S1, "o original nao muda");

  assert.deepEqual(model.removeFollowUp(duplicated, S1).map((item) => item.id), ["novo-1"]);
  assert.equal(model.findFollowUp(duplicated, "novo-2").depth, 2);
  assert.equal(model.findFollowUp(duplicated, "novo-2").parentItem.id, "novo-1");
});

test("referências à entrada que o navegador ainda não conhecia passam para a entrada gravada", () => {
  const provisoria = "99999999-9999-4999-8999-999999999999";
  const drafts = model.followUpDraftsOf([model.newFollowUpItem(S1, model.followUpParentOf(provisoria, "main", conteudo({ body: "x".repeat(200) })))], model.followUpParentOf(provisoria, "main", conteudo({ body: "x".repeat(200) })));
  const remapped = model.remapEntryRefs(drafts, ENTRADA);

  assert.deepEqual(remapped[0].who.root.items.map((rule) => rule.ref.nodeId), [ENTRADA, ENTRADA]);
  assert.equal(model.remapEntryRefs(remapped, ENTRADA)[0].who.root.items[0].ref.nodeId, ENTRADA);
});

test("confirmações: remover no rascunho, remover no ar com gente esperando e o 'Retirar do sino' com seguintes", () => {
  assert.deepEqual(model.removeFollowUpConfirm({ live: false, title: "Faltam 3 horas", waiting: 0 }), {
    confirmLabel: "Remover",
    description: "As notificações seguintes que dependem dela saem junto.",
    title: "Remover esta notificação seguinte?"
  });
  assert.deepEqual(model.removeFollowUpConfirm({ live: true, title: "Faltam 3 horas", waiting: 40 }), {
    confirmLabel: "Remover",
    description: "40 alunos estão esperando por ela e não recebem mais. Quem já recebeu continua com ela no sino.",
    title: "Remover “Faltam 3 horas”?"
  });

  assert.equal(model.withdrawFollowUpsLabel(120), "Retirar também as notificações seguintes que já saíram (120)");
  const comSeguintes = notices.noticeActionConfirm("withdraw", { audienceCount: 318, followUps: { count: 2, sent: 120 }, kind: "inbox", recipients: 318, title: "Oferta" });
  assert.equal(comSeguintes.description, "A notificação some do sino dos 318 alunos que receberam. Os números continuam no relatório. As notificações seguintes deixam de sair.");
  const semSeguintes = notices.noticeActionConfirm("withdraw", { audienceCount: 318, kind: "inbox", recipients: 318, title: "Oferta" });
  assert.equal(semSeguintes.description, "A notificação some do sino dos 318 alunos que receberam. Os números continuam no relatório.");

  assert.equal(model.FOLLOW_UPS_COPY.partialSaveTitle, "O rascunho foi salvo, mas as notificações seguintes não");
  assert.equal(model.FOLLOW_UPS_COPY.partialSaveText, "Salve de novo. O que você escreveu continua aqui.");
});

test("números de cada seguinte no relatório: o que a notificação tem e o porquê de quem não recebeu", () => {
  const stats = { accepted: 0, audio_completed: 3, audio_started: 5, cap: 2, clicked: 4, declined: 0, expired: 4, filtered: 12, goal: 6, opened: 9, reached: 40, received: 12, removed: 0, seen: 10, waiting: 12 };
  const rows = model.followUpNumberRows(stats, conteudo({ audio, cta: botaoProduto }));

  assert.deepEqual(rows.map((row) => row.label), ["Chegaram", "Esperando", "Receberam", "Viram no sino", "Abriram", "Começaram o áudio", "Ouviram até o fim", "Clicaram no botão", "Não receberam"]);
  assert.equal(rows.at(-1).value, "24 (fora do filtro 12 · atingiram o objetivo antes 6 · venceu o prazo 4 · limite do dia 2)");
  assert.deepEqual(model.followUpNumberRows(null, conteudo()).map((row) => row.value), ["—", "—", "—", "—", "—"]);
});

test("apoio do cartão: erro pelo caminho (ou o primeiro de dentro), chip da lista, fim da principal na prévia e a entrada provisória", () => {
  const errors = { "followUps.0.content.title": "Escreva um título.", "followUps.0.who.root.items.1.productIds": "Escolha pelo menos um produto." };

  assert.equal(model.followUpErrorAt(errors, "followUps.0.who"), "Escolha pelo menos um produto.");
  assert.equal(model.followUpErrorAt(errors, "followUps.0.content"), "Escreva um título.");
  assert.equal(model.followUpErrorAt(errors, "followUps.0.when.minutes"), undefined);
  assert.equal(model.followUpErrorAt(errors, "followUps.0.c"), undefined, "so caminho inteiro");

  assert.equal(model.followUpsChip(1), "+1 seguinte");
  assert.equal(model.followUpsChip(2), "+2 seguintes");

  assert.equal(model.followUpPreviewAnchorExpiry({ anchor: "expires", minutes: 180 }, { validityMinutes: DIA }, NOW), NOW + 3 * 3_600_000, "Faltam 3 horas: a principal some em 3 h");
  assert.equal(model.followUpPreviewAnchorExpiry({ anchor: "sent", minutes: 60 }, { validityMinutes: DIA }, NOW), NOW + 23 * 3_600_000);
  assert.equal(model.followUpPreviewAnchorExpiry({ anchor: "sent", minutes: 60 }, { validityMinutes: null }, NOW), null);

  const provisoria = "99999999-9999-4999-8999-999999999999";
  const parent = model.followUpParentOf(provisoria, "main", conteudo({ body: "x".repeat(200) }));
  const drafts = model.followUpDraftsOf([{ ...model.newFollowUpItem(S1, parent), children: [model.newFollowUpItem(S11, model.followUpParentOf(S1, "previous", conteudo({ body: "x".repeat(200) })))] }], parent);
  assert.deepEqual(model.foreignNodeRefs(drafts), [provisoria], "a filha cita a seguinte, que nao e de fora");
});

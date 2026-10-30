import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { consultas, escolaMinima, fatoDoWebinario, memoryDb, PG_TETO } from "./support/webinarios-v4-seguimento-banco.mjs";

// Follow-up por segmento (docs/30 §1.6 "Follow-up por segmento", §4.7 e D52): as acoes do follow-up da regra
// "Participação em lives" do segmento da Comunicacao (viu o replay, viu o card de compra, saiu antes dele, clicou e nao
// comprou, comprou pelo card; a fase 4 nasceu com uma regra "Webinário" so para elas, unida a "Participação em lives" na
// integracao de 30/10/2026). Avaliacao de cada acao, a negacao como NOT (quem tinha vaga e nao veio = duas regras), a
// live nao lida ou removida que nunca combina, a acao sem live, o pedido ao carregador (so as lives citadas por essas
// acoes), a frase, a normalizacao, o zod (vale no segmento comum; dentro de um fluxo e no Quem pode da live, nao), as
// pecas e a tela do construtor, as frases pelas guardas da Comunicacao e a leitura: o follow-up pela RPC
// webinar_follow_up_facts em paginas de 1000, so das lives que existem, uma vez por tick, junto das vagas e presencas
// (communication_webinar_facts) no mesmo facts.webinars (a equipe fica fora; banco sem a 202610300003 nao derruba
// nada). Sem rede: dublê do banco em tests/support/webinarios-v4-seguimento-banco.mjs.

const model = await import("../src/server/communications/audience-model.ts");
const { audienceDefinitionSchema, accessAudienceDefinitionSchema, flowRuleDefinitionSchema, SEGMENT_ONLY_RULE_MESSAGE, WEBINAR_RULE_ERRORS } = await import(
  "../src/server/communications/schemas.ts"
);
const builder = await import("../src/components/admin/v2/communication/notices-view-model.ts");
const facts = await import("../src/server/communications/audience-facts.ts");
const { createFactsLoader } = await import("../src/server/communications/facts-loader.ts");
const followUp = await import("../src/server/webinars/follow-up-queries.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { AudienceBuilder } = await import("../src/components/admin/v2/communication/audience-builder.tsx");

const WEBINAR = "aaaaaaaa-1111-4111-8111-111111111111";
const OUTRO_WEBINAR = "aaaaaaaa-2222-4222-8222-222222222222";
const APAGADO = "aaaaaaaa-3333-4333-8333-333333333333";
const AVISO = "7b2e8d1c-3b1a-4c55-9d7e-2a6b8c9d0e1f";
const NOW = Date.parse("2026-11-06T15:00:00.000Z");
const { WEBINAR_FOLLOW_UP_ACTIONS } = model;

const regra = (action, negate = false, webinarId = WEBINAR) => ({ action, negate, type: "webinar", webinarId });
const todas = (...items) => ({ kind: "rules", root: { items, match: "all" } });
const qualquer = (...items) => ({ kind: "rules", root: { items, match: "any" } });
/** O contexto com o follow-up destas lives lido (e, com `presenca`, as vagas e presencas). */
const lidos = (ids, presenca = false) => ({
  commentRanks: model.buildCommentRanks([]),
  lessonTotals: {},
  now: NOW,
  webinarFollowUpsLoaded: new Set(ids),
  ...(presenca ? { webinarFactsLoaded: true } : {})
});
const SEM_NADA = { clicked: false, leftBeforeOffer: false, offerSeen: false, purchased: false, watchedReplay: false };

function aluno(webinars, userId = "aluno-1") {
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
    userId,
    ...(webinars === undefined ? {} : { webinars })
  };
}

/** O aluno com o follow-up de WEBINAR (e as vagas e presencas dadas). */
const no = (fato, { attended = [], registered = [] } = {}) => aluno({ attended, followUps: { [WEBINAR]: { ...SEM_NADA, ...fato } }, registered });
const avalia = (definition, facts, context = lidos([WEBINAR])) => model.evaluateAudience(definition, facts, context);

/* ------------------------------------------------------------------------------------------------
 * Avaliacao
 * ---------------------------------------------------------------------------------------------- */

test("cada acao do follow-up conta pelo fato da live; 'clicou e não comprou' e clicou sem compra ligada ao clique", () => {
  const casos = {
    left_before_offer: { leftBeforeOffer: true },
    offer_seen: { offerSeen: true },
    purchased: { clicked: true, purchased: true },
    watched_replay: { watchedReplay: true }
  };

  for (const [action, fato] of Object.entries(casos)) {
    assert.equal(avalia(todas(regra(action)), no(fato)), true, action);
    assert.equal(avalia(todas(regra(action)), no({})), false, `${action}: linha sem o fato`);
  }

  assert.equal(avalia(todas(regra("clicked_no_purchase")), no({ clicked: true })), true, "clicou e nao comprou");
  assert.equal(avalia(todas(regra("clicked_no_purchase")), no({ clicked: true, purchased: true })), false, "clicou e comprou");
  assert.equal(avalia(todas(regra("clicked_no_purchase")), no({})), false, "nem clicou");
  assert.deepEqual([...WEBINAR_FOLLOW_UP_ACTIONS].sort(), [...Object.keys(casos), "clicked_no_purchase"].sort(), "toda acao do follow-up coberta");
  assert.deepEqual([...model.WEBINAR_RULE_ACTIONS].sort(), [...model.WEBINAR_PRESENCE_ACTIONS, ...WEBINAR_FOLLOW_UP_ACTIONS].sort(), "uma regra: presenca + follow-up");
});

test("negada (D52, a regra da 4b): a acao do follow-up so alcanca quem garantiu vaga ou passou pela live, nunca a escola inteira; quem tinha vaga e nao veio sao duas regras", () => {
  const semLinha = aluno({ attended: [], followUps: {}, registered: [] });

  assert.equal(avalia(todas(regra("watched_replay", true)), no({ registered: true })), true, "garantiu vaga e nao viu o replay");
  assert.equal(avalia(todas(regra("watched_replay", true)), semLinha), false, "nem passou pela live: fora");
  assert.equal(avalia(todas(regra("watched_replay", true)), aluno(undefined)), false, "sem linha nenhuma: fora");
  assert.equal(avalia(todas(regra("offer_seen", true)), no({ offerSeen: true })), false);
  assert.equal(avalia(todas(regra("purchased", true)), no({ clicked: true })), true, "clicou e nao comprou = não comprou");
  assert.equal(avalia(todas(regra("clicked_no_purchase", true)), no({ clicked: true, purchased: true })), true, "comprou");
  assert.equal(avalia(todas(regra("clicked_no_purchase", true)), no({ attended: true })), true, "entrou e nem clicou");
  assert.equal(avalia(todas(regra("clicked_no_purchase", true)), semLinha), false, "nunca passou pela live: fora");

  // O pop-up de venda "esteve na live X e não comprou": so quem passou por ela, menos quem comprou.
  for (const action of WEBINAR_FOLLOW_UP_ACTIONS) {
    assert.equal(avalia(todas(regra(action, true)), semLinha), false, `${action} negada nao alcanca quem nunca passou pela live`);
  }

  // Participou e garantiu vaga continuam o NOT puro (a outra leitura).
  assert.equal(avalia(todas(regra("attended", true)), aluno({ attended: [], registered: [] }), lidos([], true)), true, "não participou: quem nem garantiu vaga tambem");

  // "Garantiu vaga E não participou" (o "Avisar quem não veio"): as vagas e presencas vem da outra leitura.
  const faltou = todas(regra("registered"), regra("attended", true));
  const ctx = lidos([], true);
  assert.equal(avalia(faltou, aluno({ attended: [], registered: [WEBINAR] }), ctx), true, "vaga sem presenca");
  assert.equal(avalia(faltou, aluno({ attended: [WEBINAR], registered: [WEBINAR] }), ctx), false, "veio");
  assert.equal(avalia(faltou, aluno(undefined), ctx), false, "nunca passou pela live");
  assert.equal(avalia(faltou, aluno({ attended: [], registered: [WEBINAR] }), lidos([WEBINAR])), false, "sem as vagas e presencas lidas, nada");
});

test("live nao lida (apagada, fora do carregador, banco sem a migracao) ou acao sem live nunca combina, negada ou nao", () => {
  const fato = no({ clicked: true, offerSeen: true, purchased: true, watchedReplay: true });

  for (const action of WEBINAR_FOLLOW_UP_ACTIONS) {
    for (const negate of [false, true]) {
      assert.equal(avalia(todas(regra(action, negate)), fato, lidos([OUTRO_WEBINAR])), false, `${action} ${negate}`);
      assert.equal(avalia(todas(regra(action, negate)), fato, { ...lidos([]), webinarFollowUpsLoaded: undefined }), false);
      assert.equal(avalia(todas(regra(action, negate, null)), fato), false, `${action} ${negate} sem live`);
    }
  }

  assert.equal(avalia(todas(regra("purchased", false)), fato, lidos([], true)), false, "as vagas e presencas lidas nao bastam para o follow-up");
  assert.equal(avalia(qualquer(regra("purchased", true, APAGADO), regra("purchased")), fato, lidos([WEBINAR])), true, "a outra regra do grupo continua valendo");
});

test("duas lives e as outras regras no mesmo segmento", () => {
  const ambos = aluno({ attended: [], followUps: { [OUTRO_WEBINAR]: { ...SEM_NADA, clicked: true }, [WEBINAR]: { ...SEM_NADA, purchased: true } }, registered: [] });
  const contexto = lidos([WEBINAR, OUTRO_WEBINAR]);

  assert.equal(avalia(todas(regra("purchased"), regra("clicked_no_purchase", false, OUTRO_WEBINAR)), ambos, contexto), true, "comprou numa e so clicou na outra");
  assert.equal(avalia(todas(regra("purchased"), { op: "has", productIds: ["curso-a"], type: "product" }), ambos, contexto), false, "sem acesso ao produto");
  assert.equal(avalia(todas(regra("purchased"), { op: "has_not", productIds: ["curso-a"], type: "product" }), ambos, contexto), true);
});

/* ------------------------------------------------------------------------------------------------
 * Pedido ao carregador, normalizacao e frase
 * ---------------------------------------------------------------------------------------------- */

test("o pedido: o follow-up so das lives citadas pelas acoes dele; as de presenca pedem as vagas e presencas; nada viaja com os avisos", () => {
  const mensagem = { action: "opened", negate: false, ref: { campaignId: AVISO, kind: "campaign" }, type: "message" };
  const definicao = todas(regra("purchased"), { items: [regra("watched_replay", true), regra("registered", false, OUTRO_WEBINAR), mensagem], match: "any" });

  assert.deepEqual(model.collectWebinarFollowUpIds(definicao), [WEBINAR]);
  assert.deepEqual(model.collectWebinarFollowUpIds([definicao, todas(regra("offer_seen", false, OUTRO_WEBINAR)), null]), [WEBINAR, OUTRO_WEBINAR].sort());
  assert.deepEqual(model.collectWebinarFollowUpIds(todas(regra("purchased", false, null), regra("attended"))), [], "acao sem live e presenca nao pedem follow-up");
  assert.deepEqual(model.collectMessageCampaignIds(definicao), [AVISO], "so os avisos");
  assert.deepEqual(model.audienceFactsRequest(definicao), { messageCampaignIds: [AVISO], webinarFollowUpIds: [WEBINAR], webinars: true });
  assert.deepEqual(model.audienceFactsRequest(todas(regra("purchased"))), { messageCampaignIds: [], webinarFollowUpIds: [WEBINAR], webinars: false }, "so o follow-up: nada das vagas");
  assert.equal(model.audienceFactNeeds(todas(regra("purchased"))).webinars, false);
  assert.deepEqual(facts.validIdsOf([WEBINAR, "nao-e-uuid", WEBINAR, OUTRO_WEBINAR]), [WEBINAR, OUTRO_WEBINAR].sort());
});

test("normalizar: negate booleano e o id aparado; acao desconhecida sai; live vazia fica null (a regra nunca combina, o rascunho nao vira todos)", () => {
  assert.deepEqual(model.normalizeAudience(todas({ action: "purchased", negate: "sim", type: "webinar", webinarId: ` ${WEBINAR} ` })), todas(regra("purchased")));
  assert.deepEqual(model.normalizeAudience(todas(regra("watched_replay", true))), todas(regra("watched_replay", true)));
  assert.deepEqual(model.normalizeAudience(todas({ action: "clicked", negate: false, type: "webinar", webinarId: WEBINAR })), model.EVERYONE, "'clicked' sozinho nao e acao da regra");
  assert.deepEqual(model.normalizeAudience(todas({ action: "offer_seen", negate: false, type: "webinar", webinarId: "  " })), todas(regra("offer_seen", false, null)));
  assert.equal(model.countAudienceRules(todas(regra("purchased"), regra("registered"))), 2, "conta no limite de 20 como as outras");
});

test("frase do segmento: cada acao no plural, com e sem 'não', a live removida e a ainda nao escolhida", () => {
  const nomes = { cohorts: {}, products: {}, webinars: { [WEBINAR]: "Live de agentes" } };
  const frase = (rule) => model.describeAudience(todas(rule), nomes);

  assert.equal(frase(regra("watched_replay")), "Alunos que viram o replay da live “Live de agentes”");
  assert.equal(frase(regra("watched_replay", true)), "Alunos que não viram o replay da live “Live de agentes”");
  assert.equal(frase(regra("offer_seen")), "Alunos que viram o card de compra na live “Live de agentes”");
  assert.equal(frase(regra("left_before_offer")), "Alunos que saíram antes do card de compra na live “Live de agentes”");
  assert.equal(frase(regra("clicked_no_purchase")), "Alunos que clicaram para comprar e não compraram na live “Live de agentes”");
  // A negada diz o que conta (quem comprou e quem nem clicou), sem a dupla negacao de "não clicaram sem comprar".
  assert.equal(frase(regra("clicked_no_purchase", true)), "Alunos que compraram ou não clicaram para comprar na live “Live de agentes”");
  assert.equal(frase(regra("purchased", true)), "Alunos que não compraram pelo card na live “Live de agentes”");
  assert.equal(frase(regra("purchased", false, OUTRO_WEBINAR)), "Alunos que compraram pelo card em uma live removida");
  assert.equal(frase(regra("watched_replay", false, OUTRO_WEBINAR)), "Alunos que viram o replay de uma live removida");
  assert.equal(frase(regra("purchased", false, null)), "Alunos que compraram pelo card em uma live ainda não escolhida");
  assert.equal(
    model.describeAudience(todas(regra("registered"), regra("attended", true)), nomes),
    "Alunos que garantiram vaga na live “Live de agentes” e não participaram da live “Live de agentes”",
    "o 'Avisar quem não veio'"
  );
});

/* ------------------------------------------------------------------------------------------------
 * Schemas: vale no segmento comum; dentro de um fluxo e no Quem pode, nao
 * ---------------------------------------------------------------------------------------------- */

test("schema: o segmento aceita as acoes do follow-up; sem live, o erro na live; no fluxo e no Quem pode, recusadas no lugar certo", () => {
  for (const action of WEBINAR_FOLLOW_UP_ACTIONS) {
    assert.equal(audienceDefinitionSchema.safeParse(todas(regra(action, true))).success, true, action);
  }

  const mensagens = (issues) => issues.flatMap((issue) => [issue.message, ...(issue.errors ?? []).flatMap((inner) => mensagens(inner))]);
  const acaoErrada = audienceDefinitionSchema.safeParse(todas({ action: "clicked", negate: false, type: "webinar", webinarId: WEBINAR }));
  assert.equal(acaoErrada.success, false);
  assert.ok(mensagens(acaoErrada.error.issues).includes(WEBINAR_RULE_ERRORS.action), JSON.stringify(acaoErrada.error.issues));

  const semLive = audienceDefinitionSchema.safeParse(todas(regra("purchased", false, null)));
  assert.equal(semLive.success, false);
  assert.ok(mensagens(semLive.error.issues).includes(WEBINAR_RULE_ERRORS.webinar), "a live e obrigatoria nas acoes do follow-up");
  assert.equal(audienceDefinitionSchema.safeParse(todas(regra("attended", true, null))).success, true, "'qualquer live' continua nas de presenca");

  for (const [nome, schema] of [
    ["fluxo", flowRuleDefinitionSchema],
    ["Quem pode", accessAudienceDefinitionSchema]
  ]) {
    const recusado = schema.safeParse(todas({ paces: ["inactive"], type: "pace" }, { items: [regra("purchased")], match: "any" }));
    assert.equal(recusado.success, false, nome);
    assert.deepEqual(
      recusado.error.issues.map((issue) => [issue.message, issue.path.join(".")]),
      [[SEGMENT_ONLY_RULE_MESSAGE, "root.items.1.items.0"]],
      nome
    );
    assert.equal(schema.safeParse(todas(regra("attended", true), regra("registered", false, null))).success, true, `${nome}: as de presenca valem`);
  }

  assert.equal(SEGMENT_ONLY_RULE_MESSAGE, WEBINAR_COPY.seguimento.soNoSegmento);
  assert.equal(
    accessAudienceDefinitionSchema.safeParse(todas({ negate: false, page: { key: "home", kind: "fixed" }, since: { kind: "entered" }, type: "page_visit" })).success,
    false,
    "o Quem pode continua sem as regras so de fluxo"
  );
});

/* ------------------------------------------------------------------------------------------------
 * Construtor
 * ---------------------------------------------------------------------------------------------- */

test("construtor: um tipo so, 'Participação em lives'; as acoes do follow-up so com `followUps`; a escolhida fica visivel", () => {
  assert.equal(model.AUDIENCE_RULE_TYPES.includes("webinar_follow_up"), false, "o tipo da fase 4 nao existe mais");
  assert.equal(builder.AUDIENCE_RULE_LABELS.webinar, "Participação em lives");

  for (const mode of ["segment", "flow"]) {
    assert.deepEqual(
      builder.audienceRuleTypesFor(mode).filter((type) => type.startsWith("webinar")),
      ["webinar"],
      mode
    );
  }

  const valores = (rule, followUps) => builder.webinarRuleChoicesFor(rule, followUps).map((choice) => choice.value);
  assert.equal(valores(regra("attended"), true).length, 14, "segmento comum: as sete acoes em pares com o 'não'");
  assert.deepEqual(valores(regra("attended"), false), ["attended", "not_attended", "registered", "not_registered"], "fluxo e Quem pode: so as de presenca");
  assert.deepEqual(valores(regra("purchased", true), false), ["attended", "not_attended", "registered", "not_registered", "not_purchased"], "a salva continua na lista");
  assert.deepEqual(builder.defaultAudienceRule("webinar"), regra("attended", false, null));
});

test("construtor: trocar a escolha muda acao e negacao e mantem a live; valor estranho nao muda nada", () => {
  assert.deepEqual(builder.WEBINAR_RULE_CHOICES.slice(4, 6), [
    { label: "Viu o replay", value: "watched_replay" },
    { label: "Não viu o replay", value: "not_watched_replay" }
  ]);
  assert.equal(builder.webinarRuleChoiceOf(regra("purchased", true)), "not_purchased");
  assert.equal(builder.webinarRuleChoiceOf(regra("offer_seen")), "offer_seen");
  assert.deepEqual(builder.webinarRuleWithChoice(regra("attended"), "not_clicked_no_purchase"), regra("clicked_no_purchase", true));
  assert.deepEqual(builder.webinarRuleWithChoice(regra("attended", true, null), "watched_replay"), regra("watched_replay", false, null), "sem live: fica para escolher");
  const original = regra("attended");
  assert.equal(builder.webinarRuleWithChoice(original, "not_clicked"), original);
});

test("construtor: o seletor da live nas acoes do follow-up nao tem 'qualquer live'; sem live, 'Escolha a live'", () => {
  const lista = [
    { id: WEBINAR, startsAt: "2026-11-05T23:00:00.000Z", title: "Live de agentes" },
    { id: OUTRO_WEBINAR, startsAt: null, title: "  " }
  ];

  assert.deepEqual(builder.audienceWebinarOptions(lista, null, null, false), [
    { label: "Escolha a live", value: null },
    { label: "Live de agentes · 05/11", value: WEBINAR },
    { label: "Sem título", value: OUTRO_WEBINAR }
  ]);
  assert.deepEqual(
    builder.audienceWebinarOptions(lista, WEBINAR, null, false).map((option) => option.value),
    [WEBINAR, OUTRO_WEBINAR]
  );
  assert.deepEqual(builder.audienceWebinarOptions(lista, APAGADO, null, false)[0], { label: "Live fora da lista", value: APAGADO });
  assert.deepEqual(builder.audienceWebinarOptions([], null, null, false), [{ label: "Escolha a live", value: null }]);
  assert.equal(builder.audienceWebinarOptions(lista, null)[0].label, "qualquer live", "nas de presenca continua");
});

test("construtor: as notas da regra (o que conta como participou; quando a compra entra)", () => {
  assert.deepEqual(builder.webinarRuleNotes(regra("watched_replay")), [builder.WEBINAR_RULE_HINT]);
  assert.deepEqual(builder.webinarRuleNotes(regra("purchased")), [builder.WEBINAR_RULE_HINT, WEBINAR_COPY.seguimento.atraso]);
  assert.deepEqual(builder.webinarRuleNotes(regra("clicked_no_purchase", true)), [builder.WEBINAR_RULE_HINT, WEBINAR_COPY.seguimento.notaNegada, WEBINAR_COPY.seguimento.atraso]);
  assert.deepEqual(builder.webinarRuleNotes(regra("watched_replay", true)), [builder.WEBINAR_RULE_HINT, WEBINAR_COPY.seguimento.notaNegada], "negada: quem ela alcanca");
  assert.deepEqual(builder.webinarRuleNotes(regra("attended", true)), [builder.WEBINAR_RULE_HINT], "não participou e o NOT puro: sem a nota");
  assert.deepEqual(builder.webinarRuleNotes(regra("registered", true)), [builder.WEBINAR_RULE_HINT]);
});

/** O construtor desenhado no servidor (o seletor mostra o valor escolhido), so o texto. */
function desenha(props) {
  const html = renderToStaticMarkup(
    createElement(AudienceBuilder, { cohorts: [], disabled: false, errors: {}, onChange() {}, products: [], productsLoaded: true, segments: [], ...props })
  );

  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

test("tela do construtor: a acao com o 'não', a live com o dia e a nota da compra; sem 'qualquer live'", () => {
  const lista = [{ id: WEBINAR, startsAt: "2026-11-05T23:00:00.000Z", title: "Live de agentes" }];
  const texto = desenha({ value: todas(regra("purchased", true)), webinars: lista });

  assert.match(texto, /Participação em lives ▼ Não comprou pelo card ▼ Live de agentes · 05\/11 ▼/);
  assert.ok(texto.includes(WEBINAR_COPY.seguimento.atraso), texto);
  assert.ok(texto.includes(WEBINAR_COPY.seguimento.notaNegada), "negada: a nota diz quem a regra alcanca");
  assert.doesNotMatch(texto, /qualquer live/);

  assert.match(desenha({ value: todas(regra("purchased", false, APAGADO)), webinars: lista }), /Live fora da lista/, "a salva que saiu da lista continua visivel");
  const semLive = desenha({ value: todas(regra("watched_replay", false, null)), webinars: [] });
  assert.match(semLive, /Viu o replay ▼ Escolha a live ▼/);
  assert.match(semLive, /Nenhuma live publicada ainda\./);
});

test("frases: o que a Comunicacao mostra da regra passa pelas guardas dela (FORBIDDEN_COPY e o vocabulario fechado)", () => {
  const FORBIDDEN_COPY = /campanha|público|audiência|evento|oferta/i;
  const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "automação", "lembrete", "layout", "template", "home"];
  const nomes = { cohorts: {}, products: {}, webinars: { [WEBINAR]: "Live" } };
  const textos = [
    builder.AUDIENCE_RULE_LABELS.webinar,
    ...builder.WEBINAR_RULE_CHOICES.map((choice) => choice.label),
    ...builder.audienceWebinarOptions([], null, null, false).map((option) => option.label),
    ...builder.webinarRuleNotes(regra("purchased", true)),
    builder.PICK_WEBINAR_LABEL,
    SEGMENT_ONLY_RULE_MESSAGE,
    WEBINAR_RULE_ERRORS.action,
    WEBINAR_RULE_ERRORS.webinar,
    WEBINAR_COPY.seguimento.inicioDoAviso,
    ...model.WEBINAR_RULE_ACTIONS.flatMap((action) => [false, true].map((negate) => model.describeAudience(todas(regra(action, negate)), nomes))),
    model.describeAudience(todas(regra("purchased", false, APAGADO)), nomes),
    model.describeAudience(todas(regra("purchased", false, null)), nomes)
  ];

  assert.ok(textos.length > 30);
  for (const texto of textos) {
    assert.doesNotMatch(texto, FORBIDDEN_COPY, texto);
    for (const palavra of PROIBIDAS) {
      assert.ok(!texto.toLocaleLowerCase("pt-BR").includes(palavra), `"${texto}" usa "${palavra}"`);
    }
  }
});

/* ------------------------------------------------------------------------------------------------
 * Leitura do follow-up
 * ---------------------------------------------------------------------------------------------- */

const webinarRow = (id, extra = {}) => ({ deleted_at: null, id, scheduled_at: "2026-11-05T23:00:00.000Z", status: "published", title: `Webinário ${id.slice(9, 13)}`, ...extra });
const FATO = (fato) => ({ ...SEM_NADA, ...fato });

test("follow-up: so das lives que existem, em paginas de 1000 na ordem (webinar_id, user_id), por aluno, sem vaga e presenca", async () => {
  const linhas = Array.from({ length: PG_TETO + 5 }, (_, index) =>
    fatoDoWebinario(WEBINAR, `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, { registered: true, watched_replay: index % 2 === 0 })
  );
  linhas.push(fatoDoWebinario(OUTRO_WEBINAR, "00000000-0000-4000-8000-000000000001", { clicked: true }));
  const db = memoryDb(
    { webinars: [webinarRow(WEBINAR), webinarRow(OUTRO_WEBINAR), webinarRow(APAGADO, { deleted_at: "2026-11-01T00:00:00.000Z" })] },
    { webinar_follow_up_facts: linhas }
  );

  const lido = await followUp.loadWebinarFollowUpFacts(db, [OUTRO_WEBINAR, WEBINAR, APAGADO, WEBINAR, "nao-e-uuid"]);

  assert.deepEqual(lido.loadedIds, [WEBINAR, OUTRO_WEBINAR].sort(), "o apagado fica de fora");
  const chamadas = consultas(db, "rpc:webinar_follow_up_facts");
  assert.equal(chamadas.length, 2, "mais de 1000 linhas: duas paginas");
  assert.deepEqual(chamadas[0].args, { p_webinar_ids: [WEBINAR, OUTRO_WEBINAR].sort() });
  assert.deepEqual(
    chamadas.map((chamada) => chamada.range),
    [
      [0, 999],
      [1000, 1999]
    ]
  );
  assert.deepEqual(chamadas[0].order, [
    ["webinar_id", true],
    ["user_id", true]
  ]);
  assert.equal(lido.byUser.size, PG_TETO + 5, "nenhum aluno cortado pelo teto");
  assert.deepEqual(
    lido.byUser.get("00000000-0000-4000-8000-000000000001"),
    { [OUTRO_WEBINAR]: FATO({ clicked: true }), [WEBINAR]: FATO({ watchedReplay: true }) },
    "a vaga e a presenca vem de communication_webinar_facts, nunca daqui"
  );

  const soAlguns = await followUp.loadWebinarFollowUpFacts(db, [WEBINAR], { userIds: ["00000000-0000-4000-8000-000000000002"] });
  assert.deepEqual([...soAlguns.byUser.keys()], ["00000000-0000-4000-8000-000000000002"]);
  assert.deepEqual(soAlguns.loadedIds, [WEBINAR]);

  const nada = memoryDb({ webinars: [webinarRow(APAGADO, { deleted_at: "2026-11-01T00:00:00.000Z" })] });
  assert.deepEqual(await followUp.loadWebinarFollowUpFacts(nada, [APAGADO]), { byUser: new Map(), loadedIds: [] });
  assert.equal(consultas(nada, "rpc:webinar_follow_up_facts").length, 0, "so apagados: a RPC nem roda");
  assert.deepEqual(await followUp.loadWebinarFollowUpFacts(nada, []), { byUser: new Map(), loadedIds: [] });
});

test("follow-up: banco sem a 202610300003 (RPC ausente) le nada, com um log; outro erro sobe", async () => {
  const semRpc = memoryDb(
    { webinars: [webinarRow(WEBINAR)] },
    { webinar_follow_up_facts: { error: { code: "PGRST202", message: "Could not find the function public.webinar_follow_up_facts" } } }
  );
  const erros = [];
  const original = console.error;
  console.error = (...args) => erros.push(args.join(" "));

  try {
    assert.deepEqual(await followUp.loadWebinarFollowUpFacts(semRpc, [WEBINAR]), { byUser: new Map(), loadedIds: [] });
  } finally {
    console.error = original;
  }

  assert.ok(
    erros.some((linha) => linha.includes("migracao 202610300003 pendente")),
    erros.join("\n")
  );

  const caiu = memoryDb({ webinars: [webinarRow(WEBINAR)] }, { webinar_follow_up_facts: { error: { code: "57014", message: "canceling statement due to statement timeout" } } });
  await assert.rejects(followUp.loadWebinarFollowUpFacts(caiu, [WEBINAR]), /statement timeout/);
});

/* ------------------------------------------------------------------------------------------------
 * O carregador de fatos da Comunicacao: um carregador e um juntar para as lives
 * ---------------------------------------------------------------------------------------------- */

test("loadAudienceFacts: o follow-up das lives pedidas e as vagas e presencas no mesmo facts.webinars (a equipe fica fora)", async () => {
  const { tables, uid } = escolaMinima({ equipe: [2], total: 4 });
  const db = memoryDb(
    { ...tables, webinars: [webinarRow(WEBINAR), webinarRow(APAGADO, { deleted_at: "2026-11-01T00:00:00.000Z" })] },
    {
      communication_webinar_facts: [
        { attended: [WEBINAR], registered: [WEBINAR], user_id: uid(1) },
        { attended: null, registered: [WEBINAR], user_id: uid(3) }
      ],
      webinar_follow_up_facts: [fatoDoWebinario(WEBINAR, uid(1), { clicked: true }), fatoDoWebinario(WEBINAR, uid(3), { watched_replay: true })]
    }
  );

  const loaded = await facts.loadAudienceFacts(db, NOW, { webinarFollowUpIds: [WEBINAR, APAGADO], webinars: true });
  const ids = (definition) => loaded.facts.filter((fact) => model.evaluateAudience(definition, fact, loaded.context)).map((fact) => fact.userId);

  assert.deepEqual([...loaded.context.webinarFollowUpsLoaded], [WEBINAR], "a apagada nao e marcada como lida");
  assert.equal(loaded.context.webinarFactsLoaded, true);
  assert.deepEqual(loaded.facts.find((fact) => fact.userId === uid(1)).webinars, {
    attended: [WEBINAR],
    followUps: { [WEBINAR]: FATO({ clicked: true }) },
    registered: [WEBINAR]
  });
  assert.deepEqual(ids(todas(regra("attended"), regra("clicked_no_purchase"))), [uid(1)], "presenca e follow-up na mesma regra");
  assert.deepEqual(ids(todas(regra("registered"), regra("attended", true))), [uid(3)], "tinha vaga e nao veio; a equipe (2) fica fora");
  assert.deepEqual(ids(todas(regra("watched_replay", true))), [uid(1)], "negada: so quem passou pela live (o 4 nunca passou; o 3 viu o replay)");
  assert.deepEqual(ids(todas(regra("watched_replay", true, APAGADO))), [], "live apagada nao combina");
  assert.equal(loaded.facts.find((fact) => fact.userId === uid(4)).webinars, undefined, "sem linha: os mesmos fatos de antes");
  assert.equal(consultas(db, "notifications").length, 0, "nenhuma linha do sino lida pelas lives");

  const soFollowUp = await facts.loadAudienceFacts(db, NOW, { webinarFollowUpIds: [WEBINAR] });
  assert.equal(soFollowUp.context.webinarFactsLoaded, undefined, "sem 'participou' no segmento, as vagas nem sao lidas");
  assert.deepEqual(soFollowUp.facts.find((fact) => fact.userId === uid(3)).webinars, {
    attended: [],
    followUps: { [WEBINAR]: FATO({ watchedReplay: true }) },
    registered: []
  });

  const semRegra = await facts.loadAudienceFacts(memoryDb(tables), NOW);
  assert.equal(semRegra.context.webinarFollowUpsLoaded, undefined);
});

test("loadAudienceFactsFor: o follow-up so destes alunos, junto com as linhas do aviso; attachWebinarFacts sem leitura devolve o mesmo", async () => {
  const { tables, uid } = escolaMinima({ total: 3 });
  const db = memoryDb(
    {
      ...tables,
      campaigns: [{ deleted_at: null, id: AVISO, sent_at: "2026-11-01T12:00:00.000Z", status: "sent" }],
      notifications: [{ campaign_id: AVISO, created_at: "2026-11-01T12:00:00.000Z", expires_at: "2027-01-01T00:00:00.000Z", id: "n1", is_test: false, user_id: uid(1) }],
      webinars: [webinarRow(WEBINAR)]
    },
    { webinar_follow_up_facts: [fatoDoWebinario(WEBINAR, uid(1), { offer_seen: true }), fatoDoWebinario(WEBINAR, uid(3), { purchased: true })] }
  );

  const loaded = await facts.loadAudienceFactsFor(db, [uid(1), uid(2)], NOW, { comments: "none", messageCampaignIds: [AVISO], webinarFollowUpIds: [WEBINAR] });

  assert.deepEqual([...loaded.context.messageKeys], [`campaign:${AVISO}`]);
  assert.deepEqual([...loaded.context.webinarFollowUpsLoaded], [WEBINAR]);
  assert.deepEqual(loaded.facts.find((fact) => fact.userId === uid(1)).webinars.followUps, { [WEBINAR]: FATO({ offerSeen: true }) });
  assert.equal(loaded.facts.find((fact) => fact.userId === uid(2)).webinars, undefined);
  assert.equal(
    loaded.facts.some((fact) => fact.userId === uid(3)),
    false,
    "so os alunos pedidos"
  );
  assert.ok(loaded.facts.find((fact) => fact.userId === uid(1)).messages[`campaign:${AVISO}`], "as linhas do aviso continuam vindo");

  assert.equal(facts.attachWebinarFacts(loaded, facts.NO_WEBINAR_FACTS), loaded, "nada lido, o mesmo objeto");
});

test("carregador do tick: cada live e lida uma vez por tick, mesmo pedida por varios segmentos; a apagada nunca e marcada", async () => {
  const { tables, uid } = escolaMinima({ total: 2 });
  const db = memoryDb(
    { ...tables, campaigns: [{ deleted_at: null, id: AVISO, sent_at: "2026-11-01T12:00:00.000Z", status: "sent" }], webinars: [webinarRow(WEBINAR), webinarRow(OUTRO_WEBINAR)] },
    { webinar_follow_up_facts: [fatoDoWebinario(WEBINAR, uid(1), { purchased: true, clicked: true }), fatoDoWebinario(OUTRO_WEBINAR, uid(2), { watched_replay: true })] }
  );
  const loader = createFactsLoader(db, NOW);

  const base = await loader.load([]);
  const primeiro = await loader.load([], { webinarFollowUpIds: [WEBINAR] });
  const repetido = await loader.load([AVISO], { webinarFollowUpIds: [WEBINAR] });
  const comOsDois = await loader.load([], { webinarFollowUpIds: [OUTRO_WEBINAR, WEBINAR, APAGADO] });

  assert.equal(consultas(db, "profiles").length, 1, "alunos uma vez por tick");
  assert.deepEqual(
    consultas(db, "rpc:webinar_follow_up_facts").map((chamada) => chamada.args.p_webinar_ids),
    [[WEBINAR], [OUTRO_WEBINAR]],
    "cada live uma vez (a apagada nem chega na RPC)"
  );
  assert.equal(base.context.webinarFollowUpsLoaded, undefined);
  assert.deepEqual([...primeiro.context.webinarFollowUpsLoaded], [WEBINAR]);
  assert.deepEqual([...repetido.context.messageKeys], [`campaign:${AVISO}`]);
  assert.deepEqual([...comOsDois.context.webinarFollowUpsLoaded].sort(), [WEBINAR, OUTRO_WEBINAR].sort());
  assert.equal(base.facts.find((fact) => fact.userId === uid(1)).webinars, undefined, "o pedido sem live nao muda os fatos base");
  assert.deepEqual(comOsDois.facts.find((fact) => fact.userId === uid(1)).webinars.followUps, { [WEBINAR]: FATO({ clicked: true, purchased: true }) });
  assert.deepEqual(comOsDois.facts.find((fact) => fact.userId === uid(2)).webinars.followUps, { [OUTRO_WEBINAR]: FATO({ watchedReplay: true }) });

  const compraram = comOsDois.facts.filter((fact) => model.evaluateAudience(todas(regra("purchased")), fact, comOsDois.context));
  assert.deepEqual(
    compraram.map((fact) => fact.userId),
    [uid(1)]
  );
});

test("carregador do tick: banco sem a migracao da oferta nao derruba o tick; as acoes do follow-up so nao combinam", async () => {
  const { tables } = escolaMinima({ total: 2 });
  const db = memoryDb(
    { ...tables, webinars: [webinarRow(WEBINAR)] },
    { webinar_follow_up_facts: { error: { code: "42883", message: "function public.webinar_follow_up_facts(uuid[]) does not exist" } } }
  );
  const original = console.error;
  console.error = () => undefined;

  try {
    const loaded = await createFactsLoader(db, NOW).load([], { webinarFollowUpIds: [WEBINAR] });
    assert.equal(loaded.context.webinarFollowUpsLoaded, undefined);
    assert.equal(loaded.facts.filter((fact) => model.evaluateAudience(todas(regra("purchased", true)), fact, loaded.context)).length, 0, "nem 'não comprou' vira a escola inteira");
  } finally {
    console.error = original;
  }
});

test("fluxos e Quem pode: as acoes do follow-up no 'Quem entra' (modo segment), nunca no Objetivo nem no Quem pode da live", async () => {
  const { readFile } = await import("node:fs/promises");
  const inspector = await readFile(new URL("../src/components/admin/v2/communication/flows/flow-inspector.tsx", import.meta.url), "utf8");
  const quemEntra = inspector.slice(inspector.indexOf('idPrefix="fluxo-quem-entra"'), inspector.indexOf("</RulesForm>", inspector.indexOf('idPrefix="fluxo-quem-entra"')));
  const objetivo = inspector.slice(inspector.indexOf('idPrefix="fluxo-objetivo"'), inspector.indexOf("</RulesForm>", inspector.indexOf('idPrefix="fluxo-objetivo"')));
  assert.doesNotMatch(quemEntra, /mode="flow"/, "o 'Quem entra' e segmento comum");
  assert.match(objetivo, /mode="flow"/, "o Objetivo e dentro do fluxo");
  const cards = await readFile(new URL("../src/components/admin/v2/communication/webinars/webinar-editor-cards.tsx", import.meta.url), "utf8");
  assert.match(cards, /webinarFollowUps=\{false\}/, "o Quem pode desliga as acoes do follow-up");
  assert.match(WEBINAR_COPY.seguimento.soNoSegmento, /“Quem entra” de um fluxo/);

  // O seletor da acao vem de webinarRuleChoicesFor (as opcoes so abrem no navegador): segment com a prop, sim; flow, nao.
  const fonte = await readFile(new URL("../src/components/admin/v2/communication/audience-builder.tsx", import.meta.url), "utf8");
  assert.match(fonte, /webinarFollowUps: mode === "segment" && webinarFollowUps,/);
  assert.match(fonte, /options=\{webinarRuleChoicesFor\(rule, context\.webinarFollowUps\)\}/);
  assert.match(fonte, /webinarFollowUps = true,/, "padrao: o segmento comum oferece todas");
});

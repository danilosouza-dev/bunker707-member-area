import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { consultas, escolaMinima, fatoDoWebinario, memoryDb, PG_TETO } from "./support/webinarios-v4-seguimento-banco.mjs";

// Follow-up por segmento (docs/30 §1.6 "Follow-up por segmento", §4.7; fase 4b): a regra "Webinário" do segmento da
// Comunicacao. Avaliacao de cada acao (garantiu vaga, compareceu, viu o replay, viu o card de compra, saiu antes dele,
// clicou e nao comprou, comprou pelo card), a negacao que so conta quem garantiu vaga ou passou pelo webinario (menos
// "não garantiu vaga"), o webinario nao lido ou removido que nunca combina, a frase no plural, a normalizacao, o zod
// (vale no segmento, nunca dentro de um fluxo), as pecas do construtor, as frases pelas guardas da Comunicacao e o
// carregador: os fatos pela RPC webinar_follow_up_facts em paginas de 1000, so dos webinarios que existem, uma vez por
// tick, juntados aos fatos dos alunos (a equipe fica fora; banco sem a 202610290005 nao derruba nada). Sem rede: dublê
// do banco em tests/support/webinarios-v4-seguimento-banco.mjs.

const model = await import("../src/server/communications/audience-model.ts");
const { audienceDefinitionSchema, flowRuleDefinitionSchema, SEGMENT_ONLY_RULE_MESSAGE } = await import("../src/server/communications/schemas.ts");
const builder = await import("../src/components/admin/v2/communication/notices-view-model.ts");
const facts = await import("../src/server/communications/audience-facts.ts");
const { createFactsLoader } = await import("../src/server/communications/facts-loader.ts");
const followUp = await import("../src/server/webinars/follow-up-queries.ts");
const { WEBINAR_FOLLOW_UP_ACTIONS } = await import("../src/server/webinars/model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { AudienceBuilder } = await import("../src/components/admin/v2/communication/audience-builder.tsx");

const WEBINAR = "aaaaaaaa-1111-4111-8111-111111111111";
const OUTRO_WEBINAR = "aaaaaaaa-2222-4222-8222-222222222222";
const APAGADO = "aaaaaaaa-3333-4333-8333-333333333333";
const AVISO = "7b2e8d1c-3b1a-4c55-9d7e-2a6b8c9d0e1f";
const NOW = Date.parse("2026-11-06T15:00:00.000Z");

const regra = (action, negate = false, webinarId = WEBINAR) => ({ action, negate, type: "webinar_follow_up", webinarId });
const todas = (...items) => ({ kind: "rules", root: { items, match: "all" } });
const qualquer = (...items) => ({ kind: "rules", root: { items, match: "any" } });
const lidos = (...ids) => ({ commentRanks: model.buildCommentRanks([]), lessonTotals: {}, messageKeys: new Set(ids.map(model.webinarRuleKey)), now: NOW });
const SEM_NADA = { attended: false, clicked: false, leftBeforeOffer: false, offerSeen: false, purchased: false, registered: false, watchedReplay: false };

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
    ...(webinars === undefined ? {} : { webinarFollowUps: webinars })
  };
}

const no = (fato) => aluno({ [WEBINAR]: { ...SEM_NADA, ...fato } });
const avalia = (definition, facts, context = lidos(WEBINAR)) => model.evaluateAudience(definition, facts, context);

/* ------------------------------------------------------------------------------------------------
 * Avaliacao
 * ---------------------------------------------------------------------------------------------- */

test("cada acao conta pelo fato do webinario; 'clicou e não comprou' e clicou sem compra ligada ao clique", () => {
  const casos = {
    attended: { attended: true },
    left_before_offer: { attended: true, leftBeforeOffer: true },
    offer_seen: { attended: true, offerSeen: true },
    purchased: { clicked: true, purchased: true },
    registered: { registered: true },
    watched_replay: { watchedReplay: true }
  };

  for (const [action, fato] of Object.entries(casos)) {
    assert.equal(avalia(todas(regra(action)), no(fato)), true, action);
    assert.equal(avalia(todas(regra(action)), no({})), false, `${action}: linha sem o fato`);
  }

  assert.equal(avalia(todas(regra("clicked_no_purchase")), no({ clicked: true })), true, "clicou e nao comprou");
  assert.equal(avalia(todas(regra("clicked_no_purchase")), no({ clicked: true, purchased: true })), false, "clicou e comprou");
  assert.equal(avalia(todas(regra("clicked_no_purchase")), no({})), false, "nem clicou");
  assert.deepEqual([...WEBINAR_FOLLOW_UP_ACTIONS].sort(), [...Object.keys(casos), "clicked_no_purchase"].sort(), "toda acao do contrato coberta");
});

test("negada: so quem garantiu vaga ou passou pelo webinario; 'não garantiu vaga' vale para todos sem vaga", () => {
  const semLinha = aluno({});
  const vagaSemPresenca = no({ registered: true });
  const veio = no({ attended: true, registered: true });

  assert.equal(avalia(todas(regra("attended", true)), vagaSemPresenca), true, "tinha vaga e nao veio");
  assert.equal(avalia(todas(regra("attended", true)), veio), false);
  assert.equal(avalia(todas(regra("attended", true)), semLinha), false, "quem nem passou pelo webinario nao vira 'não compareceu'");
  assert.equal(avalia(todas(regra("attended", true)), aluno(undefined)), false, "sem fatos de webinario");
  assert.equal(avalia(todas(regra("offer_seen", true)), veio), true, "veio e nao viu o card");
  assert.equal(avalia(todas(regra("purchased", true)), no({ clicked: true })), true, "clicou e nao comprou = não comprou");
  assert.equal(avalia(todas(regra("clicked_no_purchase", true)), no({ clicked: true, purchased: true })), true);
  assert.equal(avalia(todas(regra("watched_replay", true)), semLinha), false);

  assert.equal(avalia(todas(regra("registered", true)), semLinha), true, "não garantiu vaga: a escola inteira sem vaga");
  assert.equal(avalia(todas(regra("registered", true)), aluno(undefined)), true);
  assert.equal(avalia(todas(regra("registered", true)), no({ attended: true })), true, "veio sem vaga (webinario sem inscricao)");
  assert.equal(avalia(todas(regra("registered", true)), vagaSemPresenca), false);
});

test("webinario nao lido (apagado, fora do carregador, banco sem a migracao) nunca combina, negada ou nao", () => {
  const fato = no({ attended: true, registered: true });

  for (const action of WEBINAR_FOLLOW_UP_ACTIONS) {
    for (const negate of [false, true]) {
      assert.equal(avalia(todas(regra(action, negate)), fato, lidos(OUTRO_WEBINAR)), false, `${action} ${negate}`);
      assert.equal(avalia(todas(regra(action, negate)), fato, { ...lidos(), messageKeys: undefined }), false);
    }
  }

  assert.equal(avalia(qualquer(regra("registered", true, APAGADO), regra("attended")), fato, lidos(WEBINAR)), true, "a outra regra do grupo continua valendo");
});

test("dois webinarios e as outras regras no mesmo segmento", () => {
  const ambos = aluno({ [OUTRO_WEBINAR]: { ...SEM_NADA, registered: true }, [WEBINAR]: { ...SEM_NADA, attended: true, registered: true } });
  const contexto = lidos(WEBINAR, OUTRO_WEBINAR);

  assert.equal(avalia(todas(regra("attended"), regra("attended", true, OUTRO_WEBINAR)), ambos, contexto), true, "veio a um e faltou ao outro");
  assert.equal(avalia(todas(regra("attended"), { op: "has", productIds: ["curso-a"], type: "product" }), ambos, contexto), false, "sem acesso ao produto");
  assert.equal(avalia(todas(regra("attended"), { op: "has_not", productIds: ["curso-a"], type: "product" }), ambos, contexto), true);
});

/* ------------------------------------------------------------------------------------------------
 * Chaves, normalizacao e frase
 * ---------------------------------------------------------------------------------------------- */

test("as chaves: 'webinar:<id>' viaja com os avisos em collectMessageCampaignIds (depois deles), sem repeticao", () => {
  const mensagem = { action: "opened", negate: false, ref: { campaignId: AVISO, kind: "campaign" }, type: "message" };
  const definicao = todas(regra("attended"), { items: [regra("purchased", true), regra("registered", false, OUTRO_WEBINAR), mensagem], match: "any" });

  assert.deepEqual(model.collectMessageCampaignIds(definicao), [AVISO, `webinar:${WEBINAR}`, `webinar:${OUTRO_WEBINAR}`]);
  assert.deepEqual(model.collectAudienceWebinarIds([definicao, todas(regra("attended")), null]), [WEBINAR, OUTRO_WEBINAR]);
  assert.deepEqual(model.collectAudienceWebinarIds(todas(mensagem)), []);
  assert.deepEqual(model.collectMessageCampaignIds(todas(regra("attended", false, ""))), [], "regra ainda sem webinario nao pede leitura");
  assert.equal(model.webinarIdOfKey(`webinar:${WEBINAR}`), WEBINAR);
  assert.equal(model.webinarIdOfKey(`campaign:${AVISO}`), null);
  assert.equal(model.webinarIdOfKey("webinar:"), null);
  assert.deepEqual(facts.webinarIdsOfKeys([`webinar:${WEBINAR}`, AVISO, "webinar:nao-e-uuid", `webinar:${WEBINAR}`, `webinar:${OUTRO_WEBINAR}`]), [WEBINAR, OUTRO_WEBINAR].sort());
});

test("normalizar: negate booleano e o id aparado; acao desconhecida ou sem id sai; o segmento so com ela vira todos", () => {
  assert.deepEqual(model.normalizeAudience(todas({ action: "attended", negate: "sim", type: "webinar_follow_up", webinarId: ` ${WEBINAR} ` })), todas(regra("attended")));
  assert.deepEqual(model.normalizeAudience(todas(regra("purchased", true))), todas(regra("purchased", true)));
  assert.deepEqual(model.normalizeAudience(todas({ action: "clicked", negate: false, type: "webinar_follow_up", webinarId: WEBINAR })), model.EVERYONE, "'clicked' sozinho nao e acao da regra");
  assert.deepEqual(model.normalizeAudience(todas({ action: "attended", negate: false, type: "webinar_follow_up" })), model.EVERYONE);
  assert.equal(model.countAudienceRules(todas(regra("attended"), regra("registered"))), 2, "conta no limite de 20 como as outras");
});

test("frase do segmento: cada acao no plural, com e sem 'não', e o webinario removido", () => {
  const nomes = { cohorts: {}, products: {}, webinars: { [WEBINAR]: "Live de agentes" } };
  const frase = (rule) => model.describeAudience(todas(rule), nomes);

  assert.equal(frase(regra("registered")), "Alunos que garantiram vaga em “Live de agentes”");
  assert.equal(frase(regra("attended")), "Alunos que compareceram em “Live de agentes”");
  assert.equal(frase(regra("attended", true)), "Alunos que não compareceram em “Live de agentes”");
  assert.equal(frase(regra("watched_replay")), "Alunos que viram o replay em “Live de agentes”");
  assert.equal(frase(regra("offer_seen")), "Alunos que viram o card de compra em “Live de agentes”");
  assert.equal(frase(regra("left_before_offer")), "Alunos que saíram antes do card de compra em “Live de agentes”");
  assert.equal(frase(regra("clicked_no_purchase")), "Alunos que clicaram para comprar e não compraram em “Live de agentes”");
  // A negada diz o que conta (quem comprou e quem nem clicou), sem a dupla negacao de "não clicaram sem comprar".
  assert.equal(frase(regra("clicked_no_purchase", true)), "Alunos que compraram ou não clicaram para comprar em “Live de agentes”");
  assert.equal(WEBINAR_COPY.seguimento.negadas.clicked_no_purchase, "comprou ou não clicou para comprar");
  assert.equal(frase(regra("purchased", true)), "Alunos que não compraram pelo card em “Live de agentes”");
  assert.equal(frase(regra("attended", false, OUTRO_WEBINAR)), "Alunos que compareceram em um webinário removido");
  assert.equal(
    model.describeAudience(todas({ op: "has", productIds: ["p"], type: "product" }, regra("registered", true)), { ...nomes, products: { p: "Formação" } }),
    "Alunos que têm acesso a Formação e não garantiram vaga em “Live de agentes”"
  );
});

/* ------------------------------------------------------------------------------------------------
 * Schemas: vale no segmento comum, nunca dentro de um fluxo
 * ---------------------------------------------------------------------------------------------- */

test("schema: o segmento aceita a regra do webinario; dentro de um fluxo ela e recusada no lugar certo", () => {
  for (const action of WEBINAR_FOLLOW_UP_ACTIONS) {
    assert.equal(audienceDefinitionSchema.safeParse(todas(regra(action, true))).success, true, action);
  }

  // A acao fora da lista para no tipo (a uniao regra|grupo devolve o erro aninhado); o id do webinario chega direto.
  const mensagens = (issues) => issues.flatMap((issue) => [issue.message, ...(issue.errors ?? []).flatMap((inner) => mensagens(inner))]);
  const acaoErrada = audienceDefinitionSchema.safeParse(todas({ action: "clicked", negate: false, type: "webinar_follow_up", webinarId: WEBINAR }));
  assert.equal(acaoErrada.success, false);
  assert.ok(mensagens(acaoErrada.error.issues).includes(WEBINAR_COPY.seguimento.erroAcao), JSON.stringify(acaoErrada.error.issues));

  const semWebinario = audienceDefinitionSchema.safeParse(todas(regra("attended", false, "")));
  assert.ok(semWebinario.error.issues.some((issue) => issue.message === WEBINAR_COPY.seguimento.erroWebinario), "o erro aparece junto da regra");

  const noFluxo = flowRuleDefinitionSchema.safeParse(todas({ paces: ["inactive"], type: "pace" }, { items: [regra("attended")], match: "any" }));
  assert.equal(noFluxo.success, false);
  assert.deepEqual(
    noFluxo.error.issues.map((issue) => [issue.message, issue.path.join(".")]),
    [[SEGMENT_ONLY_RULE_MESSAGE, "root.items.1.items.0"]]
  );
  assert.equal(SEGMENT_ONLY_RULE_MESSAGE, WEBINAR_COPY.seguimento.soNoSegmento);
  assert.equal(flowRuleDefinitionSchema.safeParse(todas({ paces: ["inactive"], type: "pace" })).success, true, "o resto do fluxo segue igual");
});

/* ------------------------------------------------------------------------------------------------
 * Construtor
 * ---------------------------------------------------------------------------------------------- */

test("construtor: 'Webinário' so no segmento e so quando a tela manda a lista; uma regra salva continua valida no segmento", () => {
  assert.deepEqual(builder.audienceRuleTypesFor("segment"), [...builder.AUDIENCE_RULE_ORDER, "message"]);
  assert.deepEqual(builder.audienceRuleTypesFor("segment", { webinarFollowUps: true }), [...builder.AUDIENCE_RULE_ORDER, "message", "webinar_follow_up"]);
  assert.deepEqual(builder.audienceRuleTypesFor("flow", { webinarFollowUps: true }), [...builder.AUDIENCE_RULE_ORDER, "message", "page_visit", "access_gained"]);
  assert.equal(builder.isAudienceRuleTypeAllowed("webinar_follow_up", "segment"), true);
  assert.equal(builder.isAudienceRuleTypeAllowed("webinar_follow_up", "flow"), false);
  assert.equal(builder.AUDIENCE_RULE_LABELS.webinar_follow_up, "Webinário");
  assert.equal(builder.removeAudienceRuleLabel("webinar_follow_up"), "Remover regra: Webinário");

  assert.deepEqual(builder.defaultAudienceRule("webinar_follow_up", { webinarId: WEBINAR }), regra("attended"));
  assert.deepEqual(builder.defaultAudienceRule("webinar_follow_up"), regra("attended", false, ""), "sem webinario na lista, fica para escolher");
  assert.equal(audienceDefinitionSchema.safeParse(todas(builder.defaultAudienceRule("webinar_follow_up", { webinarId: WEBINAR }))).success, true, "ja nasce valida");
});

test("construtor: o seletor da acao em pares com o 'não'; trocar a escolha muda acao e negacao; valor estranho nao muda nada", () => {
  assert.deepEqual(builder.WEBINAR_FOLLOW_UP_RULE_CHOICES.slice(0, 4), [
    { label: "garantiu vaga", value: "registered" },
    { label: "não garantiu vaga", value: "not:registered" },
    { label: "compareceu", value: "attended" },
    { label: "não compareceu", value: "not:attended" }
  ]);
  assert.equal(builder.WEBINAR_FOLLOW_UP_RULE_CHOICES.length, WEBINAR_FOLLOW_UP_ACTIONS.length * 2);
  assert.equal(builder.webinarFollowUpRuleChoiceOf(regra("purchased", true)), "not:purchased");
  assert.equal(builder.webinarFollowUpRuleChoiceOf(regra("offer_seen")), "offer_seen");
  assert.deepEqual(builder.webinarFollowUpRuleWithChoice(regra("attended"), "not:clicked_no_purchase"), regra("clicked_no_purchase", true));
  assert.deepEqual(builder.webinarFollowUpRuleWithChoice(regra("attended", true), "watched_replay"), regra("watched_replay"));
  const original = regra("attended");
  assert.equal(builder.webinarFollowUpRuleWithChoice(original, "not:clicked"), original);
});

test("construtor: o seletor do webinario com o dia; vazio avisa; o escolhido que saiu da lista continua visivel", () => {
  const lista = [
    { id: WEBINAR, scheduledAt: "2026-11-05T23:00:00.000Z", title: "Live de agentes" },
    { id: OUTRO_WEBINAR, scheduledAt: null, title: "  " }
  ];

  assert.equal(builder.webinarFollowUpChoiceLabel(lista[0]), "Live de agentes · 05/11", "dia em Sao Paulo (20h do dia 5)");
  assert.equal(builder.webinarFollowUpChoiceLabel(lista[1]), "Sem título");
  assert.deepEqual(builder.webinarFollowUpRuleOptions([], ""), [{ label: "Nenhum webinário publicado ainda.", value: null }]);
  assert.deepEqual(builder.webinarFollowUpRuleOptions(lista, ""), [
    { label: "Escolha o webinário", value: null },
    { label: "Live de agentes · 05/11", value: WEBINAR },
    { label: "Sem título", value: OUTRO_WEBINAR }
  ]);
  assert.deepEqual(builder.webinarFollowUpRuleOptions(lista, WEBINAR).map((option) => option.value), [WEBINAR, OUTRO_WEBINAR]);
  assert.deepEqual(builder.webinarFollowUpRuleOptions(lista, APAGADO)[0], { label: "Webinário fora da lista", value: APAGADO });

  const nomes = builder.audienceNamesWithWebinarFollowUps({ cohorts: {}, products: {}, webinars: { [APAGADO]: "Antiga" } }, lista);
  assert.deepEqual(nomes.webinars, { [APAGADO]: "Antiga", [WEBINAR]: "Live de agentes" }, "titulo vazio nao entra");
  const semLista = { cohorts: {}, products: {} };
  assert.equal(builder.audienceNamesWithWebinarFollowUps(semLista, null), semLista);
});

test("construtor: as notas da regra (quem conta com 'não'; quando a compra entra)", () => {
  assert.deepEqual(builder.webinarFollowUpRuleNotes(regra("attended")), []);
  assert.deepEqual(builder.webinarFollowUpRuleNotes(regra("attended", true)), [WEBINAR_COPY.seguimento.notaNegada]);
  assert.deepEqual(builder.webinarFollowUpRuleNotes(regra("registered", true)), [], "'não garantiu vaga' vale para todos");
  assert.deepEqual(builder.webinarFollowUpRuleNotes(regra("purchased")), [WEBINAR_COPY.seguimento.atraso]);
  assert.deepEqual(builder.webinarFollowUpRuleNotes(regra("clicked_no_purchase", true)), [WEBINAR_COPY.seguimento.notaNegada, WEBINAR_COPY.seguimento.atraso]);
});

/** O construtor desenhado no servidor (o seletor mostra o valor escolhido), so o texto. */
function desenha(props) {
  const html = renderToStaticMarkup(
    createElement(AudienceBuilder, { cohorts: [], disabled: false, errors: {}, onChange() {}, products: [], productsLoaded: true, segments: [], ...props })
  );

  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

test("tela do construtor: a regra mostra a acao com o 'não', o webinario com o dia e as notas", () => {
  const lista = [{ id: WEBINAR, scheduledAt: "2026-11-05T23:00:00.000Z", title: "Live de agentes" }];
  const texto = desenha({ value: todas(regra("purchased", true)), webinarFollowUps: lista });

  assert.match(texto, /Webinário ▼ não comprou pelo card ▼ em Live de agentes · 05\/11 ▼/);
  assert.ok(texto.includes(WEBINAR_COPY.seguimento.notaNegada), texto);
  assert.ok(texto.includes(WEBINAR_COPY.seguimento.atraso), texto);

  const veio = desenha({ value: todas(regra("attended")), webinarFollowUps: lista });
  assert.match(veio, /compareceu ▼ em Live de agentes · 05\/11/);
  assert.ok(!veio.includes(WEBINAR_COPY.seguimento.notaNegada), "sem 'não', sem a nota");

  assert.match(desenha({ value: todas(regra("attended", false, APAGADO)), webinarFollowUps: lista }), /Webinário fora da lista/, "o salvo que saiu da lista continua visivel");
  assert.match(desenha({ value: todas(regra("attended", false, "")), webinarFollowUps: [] }), /Nenhum webinário publicado ainda\./);
  assert.match(desenha({ value: todas(regra("attended", false, "")) }), /Nenhum webinário publicado ainda\./, "sem a lista (a tela nao mandou), a regra salva ainda aparece");
});

test("frases: o que a Comunicacao mostra da regra passa pelas guardas dela (FORBIDDEN_COPY e o vocabulario fechado)", () => {
  const FORBIDDEN_COPY = /campanha|público|audiência|evento|oferta/i;
  const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "automação", "lembrete", "layout", "template", "home"];
  const nomes = { cohorts: {}, products: {}, webinars: { [WEBINAR]: "Live" } };
  const textos = [
    builder.AUDIENCE_RULE_LABELS.webinar_follow_up,
    ...builder.WEBINAR_FOLLOW_UP_RULE_CHOICES.map((choice) => choice.label),
    ...builder.webinarFollowUpRuleOptions([], ""),
    ...builder.webinarFollowUpRuleOptions([], APAGADO),
    ...builder.webinarFollowUpRuleNotes(regra("purchased", true)),
    builder.WEBINAR_FOLLOW_UP_RULE_ACTION_LABEL,
    builder.WEBINAR_FOLLOW_UP_RULE_PICKER_LABEL,
    SEGMENT_ONLY_RULE_MESSAGE,
    WEBINAR_COPY.seguimento.erroAcao,
    WEBINAR_COPY.seguimento.erroWebinario,
    WEBINAR_COPY.seguimento.regraDescricao,
    ...WEBINAR_FOLLOW_UP_ACTIONS.flatMap((action) => [false, true].map((negate) => model.describeAudience(todas(regra(action, negate)), nomes))),
    model.describeAudience(todas(regra("attended", false, APAGADO)), nomes)
  ].map((item) => (typeof item === "string" ? item : item.label));

  assert.ok(textos.length > 30);
  for (const texto of textos) {
    assert.doesNotMatch(texto, FORBIDDEN_COPY, texto);
    for (const palavra of PROIBIDAS) {
      assert.ok(!texto.toLocaleLowerCase("pt-BR").includes(palavra), `"${texto}" usa "${palavra}"`);
    }
  }
});

/* ------------------------------------------------------------------------------------------------
 * Leitura: os webinarios do seletor, os titulos e os fatos
 * ---------------------------------------------------------------------------------------------- */

const webinarRow = (id, extra = {}) => ({ deleted_at: null, id, scheduled_at: "2026-11-05T23:00:00.000Z", status: "published", title: `Webinário ${id.slice(9, 13)}`, ...extra });

test("seletor: publicados e encerrados, nunca rascunho nem apagado, do mais recente para o mais antigo (sem hora por ultimo)", async () => {
  const db = memoryDb({
    webinars: [
      webinarRow(WEBINAR, { scheduled_at: "2026-11-05T23:00:00.000Z", title: " Live de agentes " }),
      webinarRow(OUTRO_WEBINAR, { scheduled_at: "2026-11-20T23:00:00.000Z", status: "archived" }),
      webinarRow(APAGADO, { deleted_at: "2026-11-01T00:00:00.000Z" }),
      webinarRow("aaaaaaaa-4444-4444-8444-444444444444", { status: "draft" }),
      webinarRow("aaaaaaaa-5555-4555-8555-555555555555", { scheduled_at: null })
    ]
  });

  const lista = await followUp.listWebinarFollowUpChoices(db);
  assert.deepEqual(lista.map((item) => item.id), [OUTRO_WEBINAR, WEBINAR, "aaaaaaaa-5555-4555-8555-555555555555"]);
  assert.equal(lista[1].title, "Live de agentes");
  assert.deepEqual(Object.keys(lista[0]).sort(), ["id", "scheduledAt", "title"]);
  assert.equal(followUp.FOLLOW_UP_CHOICES_LIMIT, 200);
});

test("titulos da frase: so os webinarios que existem; nada pedido, nada lido; banco sem webinarios nao derruba", async () => {
  const db = memoryDb({ webinars: [webinarRow(WEBINAR, { title: "Live de agentes" }), webinarRow(APAGADO, { deleted_at: "2026-11-01T00:00:00.000Z" })] });

  assert.deepEqual(await followUp.loadWebinarFollowUpNames(db, [WEBINAR, APAGADO, "nao-e-uuid"]), { [WEBINAR]: "Live de agentes" });
  const vazio = memoryDb({});
  assert.deepEqual(await followUp.loadWebinarFollowUpNames(vazio, []), {});
  assert.equal(vazio.log.length, 0);

  const semTabela = memoryDb({});
  semTabela.from = () => ({
    select: () => ({ in: () => ({ is: async () => ({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.webinars'" } }) }) })
  });
  assert.deepEqual(await followUp.loadWebinarFollowUpNames(semTabela, [WEBINAR]), {});
});

test("fatos: so dos webinarios que existem, em paginas de 1000 na ordem (webinar_id, user_id), por aluno", async () => {
  const linhas = Array.from({ length: PG_TETO + 5 }, (_, index) =>
    fatoDoWebinario(WEBINAR, `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, { registered: true, attended: index % 2 === 0 })
  );
  linhas.push(fatoDoWebinario(OUTRO_WEBINAR, "00000000-0000-4000-8000-000000000001", { clicked: true }));
  const db = memoryDb({ webinars: [webinarRow(WEBINAR), webinarRow(OUTRO_WEBINAR), webinarRow(APAGADO, { deleted_at: "2026-11-01T00:00:00.000Z" })] }, { webinar_follow_up_facts: linhas });

  const lido = await followUp.loadWebinarFollowUpFacts(db, [OUTRO_WEBINAR, WEBINAR, APAGADO, WEBINAR, "nao-e-uuid"]);

  assert.deepEqual(lido.loadedIds, [WEBINAR, OUTRO_WEBINAR].sort(), "o apagado fica de fora");
  const chamadas = consultas(db, "rpc:webinar_follow_up_facts");
  assert.equal(chamadas.length, 2, "mais de 1000 linhas: duas paginas");
  assert.deepEqual(chamadas[0].args, { p_webinar_ids: [WEBINAR, OUTRO_WEBINAR].sort() });
  assert.deepEqual(chamadas.map((chamada) => chamada.range), [[0, 999], [1000, 1999]]);
  assert.deepEqual(chamadas[0].order, [["webinar_id", true], ["user_id", true]]);
  assert.equal(lido.byUser.size, PG_TETO + 5, "nenhum aluno cortado pelo teto");
  assert.deepEqual(lido.byUser.get("00000000-0000-4000-8000-000000000001"), {
    [OUTRO_WEBINAR]: { ...SEM_NADA, clicked: true },
    [WEBINAR]: { ...SEM_NADA, attended: true, registered: true }
  });

  const soAlguns = await followUp.loadWebinarFollowUpFacts(db, [WEBINAR], { userIds: ["00000000-0000-4000-8000-000000000002"] });
  assert.deepEqual([...soAlguns.byUser.keys()], ["00000000-0000-4000-8000-000000000002"]);
  assert.deepEqual(soAlguns.loadedIds, [WEBINAR]);

  const nada = memoryDb({ webinars: [webinarRow(APAGADO, { deleted_at: "2026-11-01T00:00:00.000Z" })] });
  assert.deepEqual(await followUp.loadWebinarFollowUpFacts(nada, [APAGADO]), { byUser: new Map(), loadedIds: [] });
  assert.equal(consultas(nada, "rpc:webinar_follow_up_facts").length, 0, "so apagados: a RPC nem roda");
  assert.deepEqual(await followUp.loadWebinarFollowUpFacts(nada, []), { byUser: new Map(), loadedIds: [] });
});

test("fatos: banco sem a 202610290005 (RPC ausente) le nada, com um log; outro erro sobe", async () => {
  const semRpc = memoryDb({ webinars: [webinarRow(WEBINAR)] }, { webinar_follow_up_facts: { error: { code: "PGRST202", message: "Could not find the function public.webinar_follow_up_facts" } } });
  const erros = [];
  const original = console.error;
  console.error = (...args) => erros.push(args.join(" "));

  try {
    assert.deepEqual(await followUp.loadWebinarFollowUpFacts(semRpc, [WEBINAR]), { byUser: new Map(), loadedIds: [] });
  } finally {
    console.error = original;
  }

  assert.ok(erros.some((linha) => linha.includes("migracao 202610290005 pendente")), erros.join("\n"));

  const caiu = memoryDb({ webinars: [webinarRow(WEBINAR)] }, { webinar_follow_up_facts: { error: { code: "57014", message: "canceling statement due to statement timeout" } } });
  await assert.rejects(followUp.loadWebinarFollowUpFacts(caiu, [WEBINAR]), /statement timeout/);
});

/* ------------------------------------------------------------------------------------------------
 * O carregador de fatos da Comunicacao
 * ---------------------------------------------------------------------------------------------- */

test("loadAudienceFacts: a chave 'webinar:<id>' traz os fatos (a equipe fica fora) e marca so os webinarios lidos", async () => {
  const { tables, uid } = escolaMinima({ equipe: [2], total: 4 });
  const db = memoryDb(
    { ...tables, webinars: [webinarRow(WEBINAR), webinarRow(APAGADO, { deleted_at: "2026-11-01T00:00:00.000Z" })] },
    { webinar_follow_up_facts: [fatoDoWebinario(WEBINAR, uid(1), { attended: true, registered: true }), fatoDoWebinario(WEBINAR, uid(3), { registered: true })] }
  );

  const loaded = await facts.loadAudienceFacts(db, NOW, { messageCampaignIds: [`webinar:${WEBINAR}`, `webinar:${APAGADO}`] });
  const ids = (definition) => loaded.facts.filter((fact) => model.evaluateAudience(definition, fact, loaded.context)).map((fact) => fact.userId);

  assert.deepEqual([...loaded.context.messageKeys], [`webinar:${WEBINAR}`], "o apagado nao e marcado como lido");
  assert.deepEqual(ids(todas(regra("attended"))), [uid(1)]);
  assert.deepEqual(ids(todas(regra("attended", true))), [uid(3)], "tinha vaga e nao veio; a equipe (2) e quem nem passou (4) ficam fora");
  assert.deepEqual(ids(todas(regra("registered", true))).sort(), [uid(4)], "sem vaga: so quem nao e da equipe");
  assert.deepEqual(ids(todas(regra("registered", true, APAGADO))), [], "webinario apagado nao combina");
  assert.equal(loaded.facts.find((fact) => fact.userId === uid(4)).webinarFollowUps, undefined, "sem linha: os mesmos fatos de antes");
  assert.equal(consultas(db, "notifications").length, 0, "nenhuma linha do sino lida por uma chave de webinario");

  const semRegra = await facts.loadAudienceFacts(memoryDb(tables), NOW);
  assert.equal(semRegra.context.messageKeys.size, 0);
});

test("loadAudienceFactsFor: os fatos do webinario so destes alunos, junto com as linhas do aviso", async () => {
  const { tables, uid } = escolaMinima({ total: 3 });
  const db = memoryDb(
    {
      ...tables,
      campaigns: [{ deleted_at: null, id: AVISO, sent_at: "2026-11-01T12:00:00.000Z", status: "sent" }],
      notifications: [{ campaign_id: AVISO, created_at: "2026-11-01T12:00:00.000Z", expires_at: "2027-01-01T00:00:00.000Z", id: "n1", is_test: false, user_id: uid(1) }],
      webinars: [webinarRow(WEBINAR)]
    },
    { webinar_follow_up_facts: [fatoDoWebinario(WEBINAR, uid(1), { offer_seen: true }), fatoDoWebinario(WEBINAR, uid(3), { registered: true })] }
  );

  const loaded = await facts.loadAudienceFactsFor(db, [uid(1), uid(2)], NOW, { comments: "none", messageCampaignIds: [AVISO, `webinar:${WEBINAR}`] });

  assert.deepEqual([...loaded.context.messageKeys].sort(), [`campaign:${AVISO}`, `webinar:${WEBINAR}`]);
  assert.deepEqual(loaded.facts.find((fact) => fact.userId === uid(1)).webinarFollowUps, { [WEBINAR]: { ...SEM_NADA, offerSeen: true } });
  assert.equal(loaded.facts.find((fact) => fact.userId === uid(2)).webinarFollowUps, undefined);
  assert.equal(loaded.facts.some((fact) => fact.userId === uid(3)), false, "so os alunos pedidos");
  assert.ok(loaded.facts.find((fact) => fact.userId === uid(1)).messages[`campaign:${AVISO}`], "as linhas do aviso continuam vindo");
});

test("carregador do tick: cada webinario e lido uma vez por tick, mesmo pedido por varios segmentos; o apagado nunca e marcado", async () => {
  const { tables, uid } = escolaMinima({ total: 2 });
  const db = memoryDb(
    { ...tables, campaigns: [{ deleted_at: null, id: AVISO, sent_at: "2026-11-01T12:00:00.000Z", status: "sent" }], webinars: [webinarRow(WEBINAR), webinarRow(OUTRO_WEBINAR)] },
    { webinar_follow_up_facts: [fatoDoWebinario(WEBINAR, uid(1), { purchased: true, clicked: true }), fatoDoWebinario(OUTRO_WEBINAR, uid(2), { registered: true })] }
  );
  const loader = createFactsLoader(db, NOW);

  const base = await loader.load([]);
  const primeiro = await loader.load([`webinar:${WEBINAR}`]);
  const repetido = await loader.load([`webinar:${WEBINAR}`, AVISO]);
  const comOsDois = await loader.load([`webinar:${OUTRO_WEBINAR}`, `webinar:${WEBINAR}`, `webinar:${APAGADO}`]);

  assert.equal(consultas(db, "profiles").length, 1, "alunos uma vez por tick");
  assert.deepEqual(
    consultas(db, "rpc:webinar_follow_up_facts").map((chamada) => chamada.args.p_webinar_ids),
    [[WEBINAR], [OUTRO_WEBINAR]],
    "cada webinario uma vez (o apagado nem chega na RPC)"
  );
  assert.deepEqual([...base.context.messageKeys], []);
  assert.deepEqual([...primeiro.context.messageKeys], [`webinar:${WEBINAR}`]);
  assert.deepEqual([...repetido.context.messageKeys].sort(), [`campaign:${AVISO}`, `webinar:${WEBINAR}`]);
  assert.deepEqual([...comOsDois.context.messageKeys].sort(), [`webinar:${WEBINAR}`, `webinar:${OUTRO_WEBINAR}`].sort());
  assert.equal(base.facts.find((fact) => fact.userId === uid(1)).webinarFollowUps, undefined, "o pedido sem webinario nao muda os fatos base");
  assert.deepEqual(comOsDois.facts.find((fact) => fact.userId === uid(1)).webinarFollowUps, { [WEBINAR]: { ...SEM_NADA, clicked: true, purchased: true } });
  assert.deepEqual(comOsDois.facts.find((fact) => fact.userId === uid(2)).webinarFollowUps, { [OUTRO_WEBINAR]: { ...SEM_NADA, registered: true } });

  const compraram = comOsDois.facts.filter((fact) => model.evaluateAudience(todas(regra("purchased")), fact, comOsDois.context));
  assert.deepEqual(compraram.map((fact) => fact.userId), [uid(1)]);
});

test("carregador do tick: banco sem a migracao da oferta nao derruba o tick; a regra so nao combina", async () => {
  const { tables } = escolaMinima({ total: 2 });
  const db = memoryDb({ ...tables, webinars: [webinarRow(WEBINAR)] }, { webinar_follow_up_facts: { error: { code: "42883", message: "function public.webinar_follow_up_facts(uuid[]) does not exist" } } });
  const original = console.error;
  console.error = () => undefined;

  try {
    const loaded = await createFactsLoader(db, NOW).load([`webinar:${WEBINAR}`]);
    assert.deepEqual([...loaded.context.messageKeys], []);
    assert.equal(loaded.facts.filter((fact) => model.evaluateAudience(todas(regra("registered", true)), fact, loaded.context)).length, 0, "nem 'não garantiu vaga' vira a escola inteira");
  } finally {
    console.error = original;
  }
});

test("fluxos: a regra 'Webinário' aparece no 'Quem entra' (a frase de erro e o D49 mandam la) e nunca no Objetivo", async () => {
  const { readFile } = await import("node:fs/promises");
  const inspector = await readFile(new URL("../src/components/admin/v2/communication/flows/flow-inspector.tsx", import.meta.url), "utf8");
  const quemEntra = inspector.slice(inspector.indexOf('idPrefix="fluxo-quem-entra"'), inspector.indexOf("</RulesForm>", inspector.indexOf('idPrefix="fluxo-quem-entra"')));
  const objetivo = inspector.slice(inspector.indexOf('idPrefix="fluxo-objetivo"'), inspector.indexOf("</RulesForm>", inspector.indexOf('idPrefix="fluxo-objetivo"')));
  assert.match(quemEntra, /webinarFollowUps=\{options\.webinarFollowUps \?\? null\}/, "o 'Quem entra' recebe a lista");
  assert.doesNotMatch(objetivo, /webinarFollowUps=/, "o Objetivo continua sem a regra");
  assert.match(WEBINAR_COPY.seguimento.soNoSegmento, /“Quem entra” de um fluxo/);

  // O construtor no modo do "Quem entra" (segment) com a lista oferece a regra; sem a lista, nao.
  const lista = [{ id: WEBINAR, scheduledAt: "2026-11-05T23:00:00.000Z", title: "Live de agentes" }];
  const opcoes = (webinars) => renderToStaticMarkup(createElement(AudienceBuilder, { cohorts: [], disabled: false, errors: {}, onChange() {}, products: [], productsLoaded: true, segments: [], value: todas(regra("attended")), webinarFollowUps: webinars }));
  assert.match(opcoes(lista), /Live de agentes/);
  const builderSemLista = await readFile(new URL("../src/components/admin/v2/communication/audience-builder.tsx", import.meta.url), "utf8");
  assert.match(builderSemLista, /audienceRuleTypesFor\(context\.mode, \{ webinarFollowUps: context\.webinarFollowUps !== null \}\)/);
  const flowBuilder = await readFile(new URL("../src/components/admin/v2/communication/flows/flow-builder.tsx", import.meta.url), "utf8");
  assert.match(flowBuilder, /audienceNamesWithWebinarFollowUps\(/, "a frase do 'Quem entra' resolve o nome do webinario");
});

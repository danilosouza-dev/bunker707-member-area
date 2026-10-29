import assert from "node:assert/strict";
import test from "node:test";
import "./support/admin-action-stubs.mjs";
import "./support/transpile-tsx.mjs";
import { scriptedDb } from "./support/webinarios-banco-falso.mjs";

// Avisar › Aviso no sino e Pop-up do editor do webinario (docs/30 §2.2; docs/28 D5; docs/18 §2.2), sem banco:
// - o "Quem pode" traduzido para o "Para quem" do aviso nos cinco modos (Todos, Quem tem o produto, Segmento, Produto
//   ou segmento, Quem tem o produto e está no segmento), com a mesma resposta das regras originais em toda combinacao
//   de verdadeiro e falso, e dentro de AUDIENCE_LIMITS (um grupo dentro do principal, 20 regras): passou, o motivo;
// - o rascunho do aviso no sino e do pop-up (titulo e texto com o nome e a data da live, o botao Ver a live ou Entrar
//   na live para /webinarios/<slug>?origem=, a janela do pop-up na hora da live), que o zod do aviso aceita e que nao
//   tem problema de publicar; o webinario rascunho, cancelado ou encerrado nao abre;
// - a leitura do servidor por tras de /admin/comunicacao/avisos/novo?webinario=&tipo= (so le o webinario e as sessoes),
//   o endereco do atalho e a nota de inicio no editor do aviso;
// - o card Avisar desenhado: atalhos ligados com o endereco, desligados com o motivo uma vez so, Fluxo "em breve";
// - as frases passam por PROIBIDAS_WEBINARIO e pelas listas da Comunicacao (sem "sessão" e "lembrete").

const shortcut = await import("../src/server/webinars/notice-shortcut-model.ts");
const { prepareWebinarNoticeStart } = await import("../src/server/webinars/notice-shortcut.ts");
const vm = await import("../src/server/webinars/editor-model.ts");
const audienceModel = await import("../src/server/communications/audience-model.ts");
const { audienceDefinitionSchema, noticeDraftSchema, publishProblems } = await import("../src/server/communications/schemas.ts");
const { NEW_NOTICE_HREF, parseNoticeKindParam } = await import("../src/components/admin/v2/communication/notices-view-model.ts");
const templateEditor = await import("../src/components/admin/v2/communication/template-editor-model.ts");
const { normalizeSource } = await import("../src/server/webinars/student-model.ts");
const { formatWebinarWhen } = await import("../src/lib/webinar-time.ts");
const { PROIBIDAS_WEBINARIO } = await import("../src/lib/webinar-copy.ts");
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { NotifyCard } = await import("../src/components/admin/v2/communication/webinars/webinar-editor-cards.tsx");

const MINUTO = 60_000;
// Quinta, 5/11/2026, 12:00 em Sao Paulo (15:00 UTC); a live as 20:00 (23:00 UTC), 60 min.
const AGORA = Date.parse("2026-11-05T15:00:00.000Z");
const INICIO = "2026-11-05T23:00:00.000Z";
const WEBINAR = "aaaaaaaa-1111-4111-8111-111111111111";
const PRODUTO = "curso-x";
const PROIBIDAS_COMUNICACAO = /campanha|público|audiência|evento|oferta|automação|gatilho|lembrete|sessão|impressão|home|layout|template/i;

const regra = (dias) => ({ days: dias, op: "within", type: "sign_in" });
const A = regra(1);
const B = regra(2);
const C = regra(3);
const D = regra(4);
const E = regra(5);
const segmento = (root) => ({ kind: "rules", root });
const produto = { op: "has", productIds: [PRODUTO], type: "product" };

/* ------------------------------------------------------------------------------------------------
 * Equivalencia: cada regra e um atomo; as duas arvores dao a mesma resposta em toda combinacao
 * ---------------------------------------------------------------------------------------------- */

const chave = (rule) => JSON.stringify(rule);

function avaliar(node, verdade) {
  if (audienceModel.isAudienceGroup(node)) {
    return node.match === "all" ? node.items.every((item) => avaliar(item, verdade)) : node.items.some((item) => avaliar(item, verdade));
  }

  return verdade.get(chave(node)) === true;
}

function atomos(node, into = new Map()) {
  if (audienceModel.isAudienceGroup(node)) {
    node.items.forEach((item) => atomos(item, into));
  } else {
    into.set(chave(node), node);
  }

  return into;
}

/** A traducao responde igual a "produto (e|ou) segmento" em todas as 2^n combinacoes. */
function assertEquivalente(traduzida, esperada, segmentoRoot, rotulo) {
  const todos = [...atomos(segmentoRoot, new Map([[chave(produto), produto]])).keys()];

  for (let mask = 0; mask < 2 ** todos.length; mask += 1) {
    const verdade = new Map(todos.map((key, index) => [key, Boolean(mask & (1 << index))]));
    const temProduto = verdade.get(chave(produto));
    const noSegmento = avaliar(segmentoRoot, verdade);
    const quer = esperada === "both" ? temProduto && noSegmento : temProduto || noSegmento;

    assert.equal(avaliar(traduzida.root, verdade), quer, `${rotulo}: combinacao ${mask}`);
  }
}

function assertNosLimites(audience) {
  assert.ok(audienceModel.countAudienceRules(audience) <= audienceModel.AUDIENCE_LIMITS.maxRules, "ate 20 regras");
  assert.ok(audienceModel.audienceDepth(audience) <= audienceModel.AUDIENCE_LIMITS.maxDepth, "um grupo dentro do principal");
  assert.equal(audienceDefinitionSchema.safeParse(audience).success, true, "o zod do segmento aceita");
}

function traduzir(accessMode, audience = segmento({ items: [A], match: "all" }), productId = PRODUTO) {
  return shortcut.webinarNoticeAudience({ accessMode, audience, productId });
}

test("Quem pode -> Para quem: Todos, Quem tem o produto e Segmento", () => {
  assert.deepEqual(traduzir("everyone"), { audience: { kind: "everyone" }, ok: true });
  assert.deepEqual(traduzir("product"), { audience: segmento({ items: [produto], match: "all" }), ok: true });

  const seg = segmento({ items: [A, { items: [B, C], match: "any" }], match: "all" });
  const audience = traduzir("audience", seg);
  assert.equal(audience.ok, true);
  assert.deepEqual(audience.audience, audienceModel.normalizeAudience(seg), "o segmento como esta");

  assert.deepEqual(traduzir("product", seg, null), { ok: false, reason: shortcut.WEBINAR_NOTICE_COPY.blocked.product }, "sem produto nao abre");
  assert.deepEqual(traduzir("both", seg, "  "), { ok: false, reason: shortcut.WEBINAR_NOTICE_COPY.blocked.product });
  assert.deepEqual(traduzir("desconhecido", seg), { ok: false, reason: shortcut.WEBINAR_NOTICE_COPY.blocked.audience }, "modo novo: nunca abre para todos");
});

test("Produto ou segmento -> grupo 'qualquer' (produto, segmento), com os caminhos quando o segmento e 'todas' com grupos", () => {
  const casos = [
    ["qualquer", { items: [A, B], match: "any" }, segmento({ items: [produto, A, B], match: "any" })],
    ["qualquer com grupo", { items: [A, { items: [B, C], match: "all" }], match: "any" }, null],
    ["todas sem grupo", { items: [A, B], match: "all" }, segmento({ items: [produto, { items: [A, B], match: "all" }], match: "any" })],
    ["todas com uma regra", { items: [A], match: "all" }, segmento({ items: [produto, A], match: "any" })],
    // P ou (A e (B ou C)) = P ou (A e B) ou (A e C)
    ["todas com grupo qualquer", { items: [A, { items: [B, C], match: "any" }], match: "all" }, segmento({ items: [produto, { items: [A, B], match: "all" }, { items: [A, C], match: "all" }], match: "any" })],
    ["todas com dois grupos", { items: [A, { items: [B, C], match: "any" }, { items: [D, E], match: "all" }], match: "all" }, null],
    ["todas com dois grupos qualquer", { items: [{ items: [A, B], match: "any" }, { items: [C, D], match: "any" }], match: "all" }, null]
  ];

  for (const [rotulo, root, esperado] of casos) {
    const result = traduzir("either", segmento(root));
    assert.equal(result.ok, true, rotulo);

    if (esperado) {
      assert.deepEqual(result.audience, esperado, rotulo);
    }

    assertNosLimites(result.audience);
    assertEquivalente(result.audience, "either", root, rotulo);
  }

  assert.deepEqual(traduzir("either", { kind: "everyone" }), { audience: { kind: "everyone" }, ok: true }, "segmento = todos: todos");
});

test("Quem tem o produto e está no segmento -> grupo 'todas' (produto, segmento), a mesma montagem da contagem do editor", () => {
  const casos = [
    ["todas", { items: [A, { items: [B, C], match: "any" }], match: "all" }, segmento({ items: [produto, A, { items: [B, C], match: "any" }], match: "all" })],
    ["qualquer sem grupo", { items: [A, B], match: "any" }, segmento({ items: [produto, { items: [A, B], match: "any" }], match: "all" })],
    // P e (A ou (B e C) ou (D ou E)) = (P e A) ou (P e B e C) ou (P e D) ou (P e E)
    [
      "qualquer com grupos",
      { items: [A, { items: [B, C], match: "all" }, { items: [D, E], match: "any" }], match: "any" },
      segmento({
        items: [
          { items: [produto, A], match: "all" },
          { items: [produto, B, C], match: "all" },
          { items: [produto, D], match: "all" },
          { items: [produto, E], match: "all" }
        ],
        match: "any"
      })
    ]
  ];

  for (const [rotulo, root, esperado] of casos) {
    const result = traduzir("both", segmento(root));
    assert.deepEqual(result, { audience: esperado, ok: true }, rotulo);
    assertNosLimites(result.audience);
    assertEquivalente(result.audience, "both", root, rotulo);
    assert.deepEqual(vm.webinarCountAudience({ accessMode: "both", audience: segmento(root), productId: PRODUTO }), esperado, `${rotulo}: a contagem do editor conta o mesmo`);
  }

  assert.deepEqual(traduzir("both", { kind: "everyone" }), { audience: segmento({ items: [produto], match: "all" }), ok: true });
});

test("limites: passou de 20 regras ou de um grupo dentro do principal, o motivo e o atalho nao abre", () => {
  const vinte = Array.from({ length: 20 }, (_, index) => regra(index + 1));
  const motivo = { ok: false, reason: shortcut.WEBINAR_NOTICE_COPY.blocked.audience };

  // O segmento sozinho ja tem 20: o produto seria a 21a regra.
  assert.equal(traduzir("audience", segmento({ items: vinte, match: "all" })).ok, true, "Segmento com 20 regras cabe");
  assert.deepEqual(traduzir("both", segmento({ items: vinte, match: "all" })), motivo, "both com 20 + produto");
  assert.deepEqual(traduzir("either", segmento({ items: vinte, match: "any" })), motivo, "either com 20 + produto");
  assert.equal(traduzir("both", segmento({ items: vinte.slice(0, 19), match: "all" })).ok, true, "19 + produto = 20 cabe");

  // P ou (A e (B|C|D) e (E|F|G) e (H|I|J)): 27 caminhos de 4 regras.
  const grupos = [0, 1, 2].map((index) => ({ items: vinte.slice(1 + index * 3, 4 + index * 3), match: "any" }));
  assert.deepEqual(traduzir("either", segmento({ items: [vinte[0], ...grupos], match: "all" })), motivo, "os caminhos passam de 20 regras");
  // P e (A ou (B e C) ou ... ): o produto repetido em cada caminho tambem conta.
  const pares = Array.from({ length: 7 }, (_, index) => ({ items: [vinte[index * 2], vinte[index * 2 + 1]], match: "all" }));
  assert.deepEqual(traduzir("both", segmento({ items: pares, match: "any" })), motivo, "7 caminhos de 3 regras = 21");
});

/* ------------------------------------------------------------------------------------------------
 * O rascunho do aviso
 * ---------------------------------------------------------------------------------------------- */

function fonte(extra = {}) {
  return {
    accessMode: "product",
    audience: { kind: "everyone" },
    durationMinutes: 60,
    id: WEBINAR,
    productId: PRODUTO,
    registrationRequired: true,
    sessions: [{ endedAt: null, kind: "live", scheduledAt: INICIO, status: "scheduled" }],
    situation: "scheduled",
    slug: "aula-de-ia",
    status: "published",
    title: "Aula de IA",
    ...extra
  };
}

function assertGravavel(draft, agora) {
  const parsed = noticeDraftSchema.safeParse(draft);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
  assert.deepEqual(publishProblems(parsed.data, agora), [], "nada impede publicar");
}

test("Aviso no sino: titulo e texto com o nome e a data, o botao Ver a live com ?origem=sino, envio agora e nada gravado", () => {
  const result = shortcut.webinarNoticeStart(fonte(), "inbox", AGORA);
  assert.equal(result.ok, true);
  const { draft, followUps, notes, templateId, templateName } = result.start;

  assert.equal(draft.kind, "inbox");
  assert.equal(draft.title, "Live: Aula de IA");
  assert.equal(formatWebinarWhen(INICIO), "Quinta, 5/11 às 20:00");
  assert.equal(draft.body, "Quinta, 5/11 às 20:00. Garanta sua vaga na página da live.");
  assert.deepEqual(draft.cta, { display: "button", href: "/webinarios/aula-de-ia?origem=sino", label: "Ver a live", target: "same_tab" });
  assert.deepEqual(draft.audience, segmento({ items: [produto], match: "all" }));
  assert.deepEqual(draft.schedule, { mode: "now" }, "a equipe escolhe a hora no editor");
  assert.deepEqual(draft.icon, { color: "red", id: "live" });
  assert.equal(draft.popup, undefined, "a notificacao nunca leva a chave do pop-up");
  assert.deepEqual(notes, ["Você começou pelo webinário “Aula de IA”. Nada foi salvo ainda."]);
  assert.equal(followUps, null);
  assert.equal(templateId, null, "sem modelo: nada vai em fromTemplates");
  assert.equal(templateName, null);
  assertGravavel(draft, AGORA);
  assert.equal(normalizeSource("sino"), "sino", "a pagina do webinario guarda a origem na vaga");

  const semVaga = shortcut.webinarNoticeStart(fonte({ registrationRequired: false }), "inbox", AGORA);
  assert.equal(semVaga.start.draft.body, "Quinta, 5/11 às 20:00. Na hora, é só entrar pela página da live.");

  const noAr = shortcut.webinarNoticeStart(fonte({ sessions: [{ endedAt: null, kind: "live", scheduledAt: INICIO, status: "live" }], situation: "in_progress" }), "inbox", Date.parse(INICIO) + 10 * MINUTO);
  assert.equal(noAr.start.draft.body, "Estamos ao vivo agora. Entre pela página da live.");

  const longo = "Uma live muito longa sobre inteligência artificial aplicada ao dia a dia de quem estuda com a gente";
  const cortado = shortcut.webinarNoticeStart(fonte({ title: longo }), "inbox", AGORA).start.draft;
  assert.ok(cortado.title.length <= 80 && cortado.title.length >= 78, `cabe em 80 (${cortado.title.length})`);
  assert.ok(cortado.title.startsWith("Live: Uma live muito longa") && cortado.title.endsWith("…"));
  assertGravavel(cortado, AGORA);
});

test("Pop-up: na hora da live (Começa e Termina), em qualquer página, uma vez, com o botao Entrar na live e ?origem=pop-up", () => {
  const result = shortcut.webinarNoticeStart(fonte({ accessMode: "both", audience: segmento({ items: [A], match: "all" }) }), "popup", AGORA);
  assert.equal(result.ok, true);
  const { draft, notes } = result.start;

  assert.equal(draft.kind, "popup");
  assert.equal(draft.title, "Ao vivo agora: Aula de IA");
  assert.equal(draft.body, "A live começou. Clique para entrar.");
  assert.deepEqual(draft.cta, { display: "button", href: "/webinarios/aula-de-ia?origem=pop-up", label: "Entrar na live", target: "same_tab" });
  assert.deepEqual(draft.window, { endsAt: "2026-11-06T00:00:00.000Z", startsAt: INICIO });
  assert.deepEqual(draft.popup.pages, ["any"]);
  assert.equal(draft.popup.trigger, "page_load");
  assert.deepEqual(draft.popup.frequency, { mode: "once" });
  assert.equal(draft.design, null, "Padrão");
  assert.equal(draft.freeDesign, null);
  assert.deepEqual(draft.audience, segmento({ items: [produto, A], match: "all" }));
  assert.deepEqual(notes, ["Você começou pelo webinário “Aula de IA”. Nada foi salvo ainda.", "Começa e Termina seguem a hora da live. Mude se quiser avisar antes."]);
  assertGravavel(draft, AGORA);
  assert.equal(normalizeSource("pop-up"), "pop-up");

  // A live ja comecou: Começa ao publicar, Termina no fim previsto.
  const noAr = Date.parse(INICIO) + 10 * MINUTO;
  const comecou = shortcut.webinarNoticeStart(fonte({ sessions: [{ endedAt: null, kind: "live", scheduledAt: INICIO, status: "live" }], situation: "in_progress" }), "popup", noAr);
  assert.deepEqual(comecou.start.draft.window, { endsAt: "2026-11-06T00:00:00.000Z", startsAt: null });
  assertGravavel(comecou.start.draft, noAr);

  // Passou da duracao prevista e segue no ar: Termina 1 h depois de agora (no minuto cheio).
  const passou = Date.parse(INICIO) + 70 * MINUTO + 30_000;
  const atrasada = shortcut.webinarNoticeStart(fonte({ sessions: [{ endedAt: null, kind: "live", scheduledAt: INICIO, status: "live" }], situation: "in_progress" }), "popup", passou);
  assert.deepEqual(atrasada.start.draft.window, { endsAt: new Date(Date.parse(INICIO) + 131 * MINUTO).toISOString(), startsAt: null });
  assertGravavel(atrasada.start.draft, passou);

  // Sem live por acontecer (so o replay): sem janela, "Ver a live" e o titulo de aviso.
  const semHora = shortcut.webinarNoticeStart(fonte({ sessions: [{ endedAt: null, kind: "replay", scheduledAt: INICIO, status: "live" }] }), "popup", AGORA);
  assert.deepEqual(semHora.start.draft.window, { endsAt: null, startsAt: null });
  assert.equal(semHora.start.draft.cta.label, "Ver a live");
  assert.equal(semHora.start.draft.title, "Live: Aula de IA");
  assert.equal(semHora.start.notes.length, 1);
  assertGravavel(semHora.start.draft, AGORA);

  const longo = shortcut.webinarNoticeStart(fonte({ title: "Uma live muito longa sobre inteligência artificial aplicada" }), "popup", AGORA).start.draft;
  assert.ok(longo.title.length <= 60 && longo.title.endsWith("…"), `cabe em 60 (${longo.title.length})`);
  assertGravavel(longo, AGORA);
});

test("rascunho, cancelado, encerrado ou Quem pode fora dos limites: o motivo, sem rascunho", () => {
  const blocked = shortcut.WEBINAR_NOTICE_COPY.blocked;

  assert.deepEqual(shortcut.webinarNoticeStart(fonte({ situation: "draft", status: "draft" }), "inbox", AGORA), { ok: false, reason: blocked.draft });
  assert.deepEqual(shortcut.webinarNoticeStart(fonte({ situation: "cancelled" }), "popup", AGORA), { ok: false, reason: blocked.cancelled });
  assert.deepEqual(shortcut.webinarNoticeStart(fonte({ situation: "ended" }), "inbox", AGORA), { ok: false, reason: blocked.ended });
  assert.deepEqual(shortcut.webinarNoticeStart(fonte({ situation: "ended", status: "archived" }), "inbox", AGORA), { ok: false, reason: blocked.ended });
  const vinte = Array.from({ length: 20 }, (_, index) => regra(index + 1));
  assert.deepEqual(shortcut.webinarNoticeStart(fonte({ accessMode: "both", audience: segmento({ items: vinte, match: "all" }) }), "inbox", AGORA), { ok: false, reason: blocked.audience });

  assert.equal(shortcut.webinarNoticeStatusBlock(null), blocked.draft, "nunca salvo");
  assert.equal(shortcut.webinarNoticeStatusBlock({ situation: "scheduled", status: "published" }), null);
  assert.equal(shortcut.webinarNoticeStatusBlock({ situation: "in_progress", status: "published" }), null, "no ar: o pop-up chama para entrar");
});

/* ------------------------------------------------------------------------------------------------
 * "Nunca ... em nenhuma live": a propria live nao conta (como no Quem pode)
 * ---------------------------------------------------------------------------------------------- */

const OUTRA_LIVE = "aaaaaaaa-1111-4111-8111-222222222222";
const NUNCA_VAGA = { action: "registered", negate: true, type: "webinar", webinarId: null };
const NUNCA_PARTICIPOU = { action: "attended", negate: true, type: "webinar", webinarId: null };
const VAGA_NESTA = { action: "registered", negate: false, type: "webinar", webinarId: WEBINAR };
const ENTROU_NESTA = { action: "attended", negate: false, type: "webinar", webinarId: WEBINAR };

/** A aluna com estas lives (garantiu vaga / entrou), avaliada pelo motor da Comunicacao com as lives lidas. */
function alunaCom({ attended = [], registered = [] } = {}) {
  return {
    accesses: [],
    cohortIds: [],
    comments: { d7: 0, d30: 0, d90: 0, total: 0 },
    completedByContent: {},
    completedLessons: 0,
    lastSignInAt: AGORA - 60 * MINUTO,
    lastStudiedAt: null,
    pace: "never_started",
    totalLessons: 0,
    userId: "cccccccc-3333-4333-8333-333333333333",
    webinars: { attended, registered }
  };
}
const CONTEXTO = { commentRanks: audienceModel.buildCommentRanks([]), lessonTotals: {}, messageKeys: new Set(), now: AGORA, webinarFactsLoaded: true };

test("o atalho do segmento 'nunca garantiram vaga em nenhuma live' nao tira do aviso quem garantiu vaga ou entrou nesta live", async () => {
  const access = await import("../src/server/webinars/access.ts");
  const seg = segmento({ items: [NUNCA_VAGA], match: "all" });
  const result = shortcut.webinarNoticeAudience({ accessMode: "audience", audience: seg, id: WEBINAR, productId: null });
  assert.equal(result.ok, true);
  assert.deepEqual(result.audience, segmento({ items: [{ items: [NUNCA_VAGA, VAGA_NESTA, ENTROU_NESTA], match: "any" }], match: "all" }));
  assertNosLimites(result.audience);

  // O aviso vai para quem ve a live: a aluna so com a vaga nesta live (o Quem pode nao conta a propria live), a que
  // tambem garantiu vaga em outra (a ancora segura) e a que nunca garantiu nada; nao a que so tem vaga em outra.
  const ve = (lives) =>
    access.hasWebinarAccess(
      {
        anchoredWebinarIds: new Set([...(lives.registered ?? []), ...(lives.attended ?? [])]),
        entitlements: [],
        isStaff: false,
        loaded: { context: CONTEXTO, facts: [alunaCom(lives)], people: new Map() },
        now: AGORA,
        userId: "cccccccc-3333-4333-8333-333333333333"
      },
      { accessMode: "audience", audience: seg, id: WEBINAR, productId: null }
    );
  for (const lives of [{}, { registered: [WEBINAR] }, { attended: [WEBINAR] }, { registered: [OUTRA_LIVE, WEBINAR] }, { registered: [OUTRA_LIVE] }]) {
    const noAviso = audienceModel.evaluateAudience(result.audience, alunaCom(lives), CONTEXTO);
    assert.equal(noAviso, ve(lives), JSON.stringify(lives));
  }
  assert.equal(audienceModel.evaluateAudience(result.audience, alunaCom({ registered: [WEBINAR] }), CONTEXTO), true, "a inscrita desta live recebe o pop-up de entrar");
  assert.equal(audienceModel.evaluateAudience(result.audience, alunaCom({ registered: [OUTRA_LIVE] }), CONTEXTO), false);

  // Sem o id (webinario nunca salvo) ou sem a regra negada, nada muda; a positiva ("alguma live") fica como esta.
  assert.deepEqual(shortcut.withOwnWebinar(seg, null), seg);
  const positiva = segmento({ items: [{ ...NUNCA_VAGA, negate: false }], match: "all" });
  assert.deepEqual(shortcut.withOwnWebinar(positiva, WEBINAR), positiva);
});

test("a propria live fora da regra em toda forma do segmento e em todo modo, nos limites e com o mesmo resultado", () => {
  const formas = [
    ["solta no todas", { items: [A, NUNCA_VAGA], match: "all" }],
    ["solta no qualquer", { items: [A, NUNCA_PARTICIPOU], match: "any" }],
    ["num qualquer dentro do todas", { items: [A, { items: [B, NUNCA_VAGA], match: "any" }], match: "all" }],
    ["num todas dentro do qualquer", { items: [A, { items: [B, NUNCA_VAGA], match: "all" }], match: "any" }],
    ["num todas dentro do todas", { items: [A, { items: [B, NUNCA_PARTICIPOU], match: "all" }], match: "all" }]
  ];
  // O que se espera: a regra negada vira (ela ou garantiu vaga nesta ou entrou nesta).
  const esperado = (node, verdade) => {
    if (audienceModel.isAudienceGroup(node)) {
      return node.match === "all" ? node.items.every((item) => esperado(item, verdade)) : node.items.some((item) => esperado(item, verdade));
    }
    const valor = (rule) => verdade.get(chave(rule)) === true;
    return node.type === "webinar" && node.webinarId === null && node.negate ? valor(node) || valor(VAGA_NESTA) || valor(ENTROU_NESTA) : valor(node);
  };

  for (const [rotulo, root] of formas) {
    const trocado = shortcut.withOwnWebinar(segmento(root), WEBINAR);
    assertNosLimites(trocado);
    const todos = [...atomos(trocado.root, atomos(root)).keys()];
    for (let mask = 0; mask < 2 ** todos.length; mask += 1) {
      const verdade = new Map(todos.map((key, index) => [key, Boolean(mask & (1 << index))]));
      assert.equal(avaliar(trocado.root, verdade), esperado(root, verdade), `${rotulo}: combinacao ${mask}`);
    }

    for (const accessMode of ["audience", "either", "both"]) {
      const result = shortcut.webinarNoticeAudience({ accessMode, audience: segmento(root), id: WEBINAR, productId: PRODUTO });
      assert.equal(result.ok, true, `${rotulo} em ${accessMode}`);
      assert.ok(atomos(result.audience.root).has(chave(VAGA_NESTA)), `${rotulo} em ${accessMode}: a vaga nesta live entra`);
      assertNosLimites(result.audience);
    }
  }

  // O atalho do editor e o rascunho usam o id salvo; a contagem do editor tambem (e sem id, o segmento como esta).
  const seg = segmento({ items: [NUNCA_VAGA], match: "all" });
  const start = shortcut.webinarNoticeStart(fonte({ accessMode: "audience", audience: seg, productId: null }), "popup", AGORA);
  assert.ok(atomos(start.start.draft.audience.root).has(chave(VAGA_NESTA)), "o pop-up de entrar chega a quem garantiu vaga");
  const draft = { accessMode: "audience", audience: seg, productId: null };
  assert.ok(atomos(vm.webinarCountAudience(draft, WEBINAR).root).has(chave(ENTROU_NESTA)), "a contagem nao cai a cada vaga nesta live");
  assert.deepEqual(vm.webinarCountAudience(draft), seg);
});

/* ------------------------------------------------------------------------------------------------
 * A leitura do servidor (/avisos/novo?webinario=): o webinario salvo, num banco falso
 * ---------------------------------------------------------------------------------------------- */

function linhaDoWebinario(extra = {}) {
  return {
    access_mode: "either",
    audience: segmento({ items: [A], match: "all" }),
    cancelled_at: null,
    deleted_at: null,
    duration_minutes: 60,
    id: WEBINAR,
    kind: "live",
    product_id: PRODUTO,
    registration_required: true,
    scheduled_at: INICIO,
    slug: "aula-de-ia",
    status: "published",
    title: "Aula de IA",
    ...extra
  };
}

const SESSAO_MARCADA = { ended_at: null, id: "bbbbbbbb-1111-4111-8111-111111111111", kind: "live", scheduled_at: INICIO, status: "scheduled", webinar_id: WEBINAR };

function bancoDoWebinario(linha, sessoes = [SESSAO_MARCADA]) {
  return scriptedDb((query) => {
    if (query.table === "webinars") {
      return { data: linha, error: null };
    }

    if (query.table === "webinar_sessions") {
      return { data: sessoes, error: null };
    }

    return { data: [], error: null };
  });
}

/** Uma sessao do "Começa quando você entra" (jit), de um aluno so. */
function sessaoJit(n, scheduledAt, status, extra = {}) {
  return { ended_at: status === "ended" ? scheduledAt : null, id: `cccccccc-1111-4111-8111-00000000000${n}`, jit: true, kind: "simulated", scheduled_at: scheduledAt, status, webinar_id: WEBINAR, ...extra };
}

test("prepareWebinarNoticeStart: le o webinario salvo e as sessoes, so le e nunca grava; id invalido, inexistente ou que nao vale", async () => {
  const db = bancoDoWebinario(linhaDoWebinario());
  const lido = await prepareWebinarNoticeStart(WEBINAR, "popup", AGORA, db);

  assert.equal(lido.ok, true);
  assert.deepEqual(lido.audiences, [segmento({ items: [produto, A], match: "any" })], "o Produto ou segmento traduzido, para dar nome as regras");
  assert.deepEqual(lido.start.draft.audience, lido.audiences[0]);
  assert.deepEqual(lido.start.draft.window, { endsAt: "2026-11-06T00:00:00.000Z", startsAt: INICIO });
  assert.deepEqual([...new Set(db.queries.map((query) => query.table))].sort(), ["webinar_sessions", "webinars"]);
  assert.ok(db.queries.every((query) => query.op === "select"), "nada gravado");

  const naoAbre = bancoDoWebinario(linhaDoWebinario());
  assert.deepEqual(await prepareWebinarNoticeStart("nao-e-uuid", "inbox", AGORA, naoAbre), { ok: false, reason: "missing" });
  assert.equal(naoAbre.queries.length, 0, "id invalido nem vai ao banco");
  assert.deepEqual(await prepareWebinarNoticeStart(WEBINAR, "inbox", AGORA, bancoDoWebinario(null)), { ok: false, reason: "missing" });
  assert.deepEqual(await prepareWebinarNoticeStart(WEBINAR, "inbox", AGORA, bancoDoWebinario(linhaDoWebinario({ status: "draft" }))), { ok: false, reason: "blocked" });
  assert.deepEqual(await prepareWebinarNoticeStart(WEBINAR, "inbox", AGORA, bancoDoWebinario(linhaDoWebinario({ cancelled_at: "2026-11-04T12:00:00.000Z" }))), { ok: false, reason: "blocked" });
});

test("prepareWebinarNoticeStart: as sessoes do 'Começa quando você entra' ficam fora, como no editor (a situacao e a proxima live batem com o card Avisar)", async () => {
  const gravada = linhaDoWebinario({ access_mode: "everyone", jit_settings: { enabled: true }, kind: "simulated", product_id: null, scheduled_at: null });
  const ontem = (hora) => `2026-11-04T${hora}:00.000Z`;

  // (a) So "Começa quando você entra", sem hora marcada: tres alunos entraram ontem e as tres sessoes encerraram. O
  // editor (sem as jit) ve "scheduled" e liga o Avisar; o atalho abre, sem data no texto.
  const soJit = [sessaoJit(1, ontem("13:15"), "ended"), sessaoJit(2, ontem("14:30"), "ended"), sessaoJit(3, ontem("20:45"), "ended")];
  const sino = await prepareWebinarNoticeStart(WEBINAR, "inbox", AGORA, bancoDoWebinario(gravada, soJit));
  assert.equal(sino.ok, true, "nao volta para o editor com o Avisar ligado");
  assert.equal(sino.start.draft.body, shortcut.WEBINAR_NOTICE_COPY.inbox.bodyNoDate);
  const popup = await prepareWebinarNoticeStart(WEBINAR, "popup", AGORA, bancoDoWebinario(gravada, soJit));
  assert.equal(popup.ok, true);
  assert.deepEqual(popup.start.draft.window, { endsAt: null, startsAt: null }, "sem live marcada, sem janela");

  // (b) Com hora marcada amanha as 20:00 e um aluno no ar agora (jit das 11:45) e outro as 12:15: o aviso fala da
  // live de amanha, nunca da sessao de um aluno so.
  const amanha = "2026-11-06T23:00:00.000Z";
  const comMarcada = [
    sessaoJit(4, "2026-11-05T14:45:00.000Z", "live"),
    sessaoJit(5, "2026-11-05T15:15:00.000Z", "scheduled"),
    { ended_at: null, id: "bbbbbbbb-2222-4222-8222-222222222222", jit: false, kind: "simulated", scheduled_at: amanha, status: "scheduled", webinar_id: WEBINAR }
  ];
  const marcadaSino = await prepareWebinarNoticeStart(WEBINAR, "inbox", AGORA, bancoDoWebinario({ ...gravada, scheduled_at: amanha }, comMarcada));
  assert.equal(marcadaSino.ok, true);
  assert.equal(marcadaSino.start.draft.body, shortcut.WEBINAR_NOTICE_COPY.inbox.bodySeat(formatWebinarWhen(amanha)));
  assert.doesNotMatch(marcadaSino.start.draft.body, /ao vivo agora/i);
  const marcadaPopup = await prepareWebinarNoticeStart(WEBINAR, "popup", AGORA, bancoDoWebinario({ ...gravada, scheduled_at: amanha }, comMarcada));
  assert.equal(marcadaPopup.ok, true);
  assert.deepEqual(marcadaPopup.start.draft.window, { endsAt: "2026-11-07T00:00:00.000Z", startsAt: amanha }, "Começa e Termina da live de amanha");
  assert.equal(marcadaPopup.start.draft.title, shortcut.WEBINAR_NOTICE_COPY.popup.title("Aula de IA"));
});

/* ------------------------------------------------------------------------------------------------
 * Endereco do atalho e o editor do aviso
 * ---------------------------------------------------------------------------------------------- */

test("o atalho abre o Novo aviso da Comunicacao com ?webinario= e o ?tipo= que o editor le", () => {
  assert.equal(shortcut.WEBINAR_NOTICE_NEW_HREF, NEW_NOTICE_HREF);
  assert.equal(shortcut.webinarNoticeHref(WEBINAR, "inbox"), `/admin/comunicacao/avisos/novo?webinario=${WEBINAR}&tipo=notificacao`);
  assert.equal(shortcut.webinarNoticeHref(WEBINAR, "popup"), `/admin/comunicacao/avisos/novo?webinario=${WEBINAR}&tipo=popup`);

  for (const kind of ["inbox", "popup"]) {
    const params = new URL(shortcut.webinarNoticeHref(WEBINAR, kind), "https://area.test").searchParams;
    assert.equal(params.get(shortcut.WEBINAR_NOTICE_PARAM), WEBINAR);
    assert.equal(parseNoticeKindParam(params.get("tipo")), kind);
  }
});

test("editor do aviso: o start do webinario (sem modelo) mostra so a propria nota, e some no primeiro salvar", () => {
  const nota = shortcut.WEBINAR_NOTICE_COPY.notes.startFrom("Aula de IA");
  const base = { notes: [nota], problem: null, templateName: null };

  assert.deepEqual(templateEditor.noticeStartNotes({ ...base, mode: "start", saved: false }), [nota], "sem 'Você começou do modelo'");
  assert.deepEqual(templateEditor.noticeStartNotes({ ...base, mode: "start", saved: true }), []);
  assert.equal(templateEditor.noticeEditorModeOf({ initial: null, start: shortcut.webinarNoticeStart(fonte(), "inbox", AGORA).start }), "start");
});

/* ------------------------------------------------------------------------------------------------
 * O card Avisar
 * ---------------------------------------------------------------------------------------------- */

const SALVO = { id: WEBINAR, situation: "scheduled", status: "published" };
const ESCREVE = { canPublish: false, canWrite: true };

function atalhos(extra = {}) {
  return vm.webinarNotifyShortcuts({ dirty: false, draft: fonte(), permissions: ESCREVE, saved: SALVO, ...extra });
}

test("webinarNotifyShortcuts: ligados com o endereco; desligados com o motivo, na ordem", () => {
  const blocked = shortcut.WEBINAR_NOTICE_COPY.blocked;
  const ligados = atalhos();

  assert.deepEqual(ligados, {
    blocked: null,
    inbox: { blocked: null, href: shortcut.webinarNoticeHref(WEBINAR, "inbox"), label: "Aviso no sino" },
    popup: { blocked: null, href: shortcut.webinarNoticeHref(WEBINAR, "popup"), label: "Pop-up" },
    popupHint: vm.WEBINAR_ADMIN_COPY.fields.notifyPopupHint.plain
  });
  assert.equal(atalhos({ saved: { ...SALVO, situation: "in_progress" } }).blocked, null, "no ar continua ligado");

  const vinte = Array.from({ length: 20 }, (_, index) => regra(index + 1));
  const casos = [
    [{ permissions: { canPublish: false, canWrite: false }, saved: null }, blocked.write],
    [{ saved: null }, blocked.draft],
    [{ dirty: true, saved: { ...SALVO, situation: "draft", status: "draft" } }, blocked.draft],
    [{ dirty: true, saved: { ...SALVO, situation: "cancelled" } }, blocked.cancelled],
    [{ saved: { ...SALVO, situation: "ended" } }, blocked.ended],
    [{ dirty: true }, blocked.dirty],
    [{ draft: fonte({ accessMode: "both", audience: segmento({ items: vinte, match: "all" }) }) }, blocked.audience]
  ];

  for (const [extra, motivo] of casos) {
    const view = atalhos(extra);
    assert.equal(view.blocked, motivo, motivo);
    assert.equal(view.inbox.href, null);
    assert.equal(view.popup.href, null);
  }
});

const texto = (markup) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

function card(shortcuts, disabled = false) {
  return renderToStaticMarkup(
    createElement(NotifyCard, {
      disabled,
      draft: { ...fonte(), replayDaysOnHome: 7, showBanner: true, showOnHome: true },
      errorFor: () => undefined,
      now: AGORA,
      onBlur: () => undefined,
      onChange: () => undefined,
      shortcuts
    })
  );
}

test("card Avisar: Aviso no sino e Pop-up como links para o editor preenchido; desligados com o motivo uma vez; Fluxo em breve", () => {
  const ligado = card(atalhos(), true);
  const inbox = shortcut.webinarNoticeHref(WEBINAR, "inbox").replace(/&/g, "&amp;");
  const popup = shortcut.webinarNoticeHref(WEBINAR, "popup").replace(/&/g, "&amp;");

  assert.match(ligado, new RegExp(`<a [^>]*href="${inbox.replace(/[?]/g, "\\?")}"[^>]*>.*?Aviso no sino</a>`), "Aviso no sino leva ao aviso preenchido");
  assert.match(ligado, new RegExp(`<a [^>]*href="${popup.replace(/[?]/g, "\\?")}"[^>]*>.*?Pop-up</a>`), "Pop-up leva ao pop-up preenchido");
  assert.match(texto(ligado), /Avisar pela Comunicação/);
  assert.match(texto(ligado), /para quem está no Quem pode agora, com o nome, a data e o botão Ver a live\. Nada é enviado até você publicar\./);
  // Quem tem o produto (o fonte()): nao ha segmento, entao a dica do Pop-up nao fala dele.
  assert.match(texto(ligado), /para a hora da live, com o botão Entrar na live, para quem está no Quem pode agora\. Nada é salvo até você salvar\./);
  assert.doesNotMatch(texto(ligado), /segmento/, "Quem tem o produto: nenhuma frase de um segmento que nao existe");
  assert.doesNotMatch(texto(ligado), /para quem pode ver a live/);
  assert.match(texto(ligado), /Fluxo · em breve/, "Fluxo continua em breve");
  assert.doesNotMatch(texto(ligado), /Pop-up · em breve/);
  assert.doesNotMatch(ligado, /data-webinar-notify-blocked/);
  assert.match(ligado, /aria-describedby="webinar-notify-inbox-hint"/);

  const desligado = card(atalhos({ saved: null }));
  assert.doesNotMatch(desligado, /avisos\/novo/, "nenhum link");
  assert.equal((desligado.match(/aria-disabled="true"/g) ?? []).length, 2, "os dois rotulos desligados");
  assert.equal((texto(desligado).match(/Publique o webinário para avisar\./g) ?? []).length, 1, "o motivo uma vez so");
  assert.match(desligado, /data-webinar-notify-blocked="" role="note"/);
});

test("card Avisar: a dica do Pop-up segue o modo do Quem pode salvo (a ancora so no Segmento e no 'e'; no Produto ou segmento, quem sai sem o produto perde a live)", () => {
  const dica = (accessMode, audience = segmento({ items: [A], match: "all" })) => {
    const shortcuts = atalhos({ draft: fonte({ accessMode, audience: accessMode === "everyone" || accessMode === "product" ? { kind: "everyone" } : audience }) });
    return { markup: texto(card(shortcuts)), shortcuts };
  };
  const comVaga = /Quem garantiu vaga e já saiu do segmento não vê o pop-up: recebe o Começou agora pelo sino\./;
  const semProduto = /Quem saiu do segmento sem o produto não vê a live nem recebe os avisos dela\./;

  // Segmento e "e": a vaga e a ancora da live, mas o aviso vai para quem esta no segmento agora (D42).
  for (const mode of ["audience", "both"]) {
    const { markup, shortcuts } = dica(mode);
    assert.equal(shortcuts.popupHint, vm.webinarNotifyPopupHint(mode));
    assert.equal(shortcuts.popup.href, shortcut.webinarNoticeHref(WEBINAR, "popup"), mode);
    assert.match(markup, comVaga, mode);
    assert.doesNotMatch(markup, semProduto, mode);
  }

  // Produto ou segmento, com "Curso P ou ganhou acesso hoje": sem ancora, a aluna que garantiu vaga pelo "hoje" e saiu
  // do segmento sem o P nao ve a live nem recebe o Comecou agora (keepRegistrantsWithAccess); a dica nao promete o sino.
  const ganhouHoje = segmento({ items: [{ negate: false, period: { kind: "today" }, productIds: [], type: "access_recent" }], match: "all" });
  const either = dica("either", ganhouHoje);
  assert.equal(either.shortcuts.popup.href, shortcut.webinarNoticeHref(WEBINAR, "popup"), "ligado");
  assert.match(either.markup, /para quem está no Quem pode agora\. Quem saiu do segmento sem o produto não vê a live nem recebe os avisos dela\. Nada é salvo até você salvar\./);
  assert.doesNotMatch(either.markup, comVaga);
  assert.doesNotMatch(either.markup, /recebe o Começou agora/);

  // Todos e Quem tem o produto: sem segmento, sem frase dele.
  for (const mode of ["everyone", "product"]) {
    const { markup } = dica(mode);
    assert.equal(vm.webinarNotifyPopupHint(mode), vm.WEBINAR_ADMIN_COPY.fields.notifyPopupHint.plain);
    assert.doesNotMatch(markup, /segmento/, mode);
  }

  // A dica segue o webinario SALVO (o mesmo que o aviso usa), nao a pilula ainda sem salvar.
  const sujo = atalhos({ dirty: true, draft: fonte({ accessMode: "either", audience: ganhouHoje }) });
  assert.equal(sujo.popupHint, vm.WEBINAR_ADMIN_COPY.fields.notifyPopupHint.either);
});

/* ------------------------------------------------------------------------------------------------
 * Frases
 * ---------------------------------------------------------------------------------------------- */

function textos(value, into = []) {
  if (typeof value === "string") {
    into.push(value);
  } else if (typeof value === "function") {
    textos(value("Aula de IA"), into);
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => textos(item, into));
  }

  return into;
}

test("frases do atalho e do aviso: sem as palavras proibidas do Webinario e da Comunicacao", () => {
  const todas = [
    ...textos(shortcut.WEBINAR_NOTICE_COPY),
    vm.WEBINAR_ADMIN_COPY.fields.notifyInbox,
    vm.WEBINAR_ADMIN_COPY.fields.notifyInboxHint,
    vm.WEBINAR_ADMIN_COPY.fields.notifyLinksTitle,
    ...textos(vm.WEBINAR_ADMIN_COPY.fields.notifyPopupHint),
    vm.WEBINAR_ADMIN_COPY.fields.popupLink
  ];
  assert.ok(todas.length > 15);

  for (const frase of todas) {
    const lower = frase.toLocaleLowerCase("pt-BR");
    assert.doesNotMatch(frase, PROIBIDAS_COMUNICACAO, frase);
    assert.ok(!/\bwebinario\b/i.test(frase), `"${frase}": webinário com acento`);

    for (const palavra of PROIBIDAS_WEBINARIO) {
      assert.ok(!lower.includes(palavra), `"${frase}" usa "${palavra}"`);
    }
  }
});

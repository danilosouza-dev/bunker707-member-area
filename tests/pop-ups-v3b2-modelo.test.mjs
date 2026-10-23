import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Regras puras da v3b-2 dos pop-ups (docs/29 §3.2 a §4.4): os quatro momentos, os produtos do "No primeiro
// acesso" nas colunas e no schema (somem fora de first_login), o plano e o mapa com os pop-ups que comecam nas
// proximas 24 h (startsAt e notBefore), o not_started do show, quem conta como aluno novo e o recalculo com a
// marca (a linha de um app antigo sai), o comeco do pop-up, o curso concluido e a leitura da resposta do
// progresso, e o vocabulario dos textos novos do servidor.

const model = await import("../src/server/communications/popup-display-model.ts");
const firstAccess = await import("../src/server/communications/popup-first-access.ts");
const course = await import("../src/lib/course-completion.ts");
const schemas = await import("../src/server/communications/schemas.ts");

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const now = Date.parse("2026-10-23T15:00:00.000Z"); // 12:00 em Sao Paulo
const iso = (time) => new Date(time).toISOString();

const estado = (extra = {}) => ({
  campaignId: "a",
  clickedAt: null,
  dayImpressions: 0,
  dismissedAt: null,
  eligible: true,
  impressions: 0,
  impressionsBeforeReshow: 0,
  lastSeenAt: null,
  reshownAt: null,
  snoozeCount: 0,
  snoozedUntil: null,
  snoozesBeforeReshow: 0,
  ...extra
});
const regras = (id, extra = {}, settings = {}) => ({
  allowSnooze: true,
  endsAt: null,
  id,
  rank: 0,
  startsAt: null,
  ...extra,
  settings: { ...model.POPUP_SETTINGS_DEFAULT, ...settings }
});
const repetir = (extra = {}) => ({ everyMinutes: null, maxPerDay: null, maxTotal: null, mode: "repeat", stopOn: "click", ...extra });

/** Colunas de um pop-up como o banco guarda (padrao: so no Inicio, 3 s, Uma vez). */
const colunas = (extra = {}) => ({ ...model.popupSettingsToColumns(model.POPUP_SETTINGS_DEFAULT), ...extra });

/* ------------------------------------------------------------------------------------------------
 * 1. Momentos
 * ---------------------------------------------------------------------------------------------- */

test("os quatro momentos: dois de pagina e dois de conclusao (so em paginas de aula)", () => {
  assert.deepEqual([...model.POPUP_TRIGGERS], ["page_load", "lesson_completed", "first_login", "course_completed"]);
  assert.deepEqual([...model.POPUP_PAGE_TRIGGERS], ["page_load", "first_login"]);
  assert.deepEqual([...model.POPUP_LESSON_TRIGGERS], ["lesson_completed", "course_completed"]);

  for (const trigger of model.POPUP_TRIGGERS) {
    assert.notEqual(model.isPageTrigger(trigger), model.isLessonTrigger(trigger), `${trigger}: de pagina ou de aula, nunca os dois`);
  }

  assert.equal(model.isPageTrigger("first_login"), true);
  assert.equal(model.isLessonTrigger("course_completed"), true);
  assert.equal(model.isPageTrigger("at_start"), false, "at_start continua sem uso");
  assert.equal(model.isLessonTrigger("at_start"), false);
  assert.equal(model.isPageTrigger(""), false);
});

/* ------------------------------------------------------------------------------------------------
 * 2 e 3. Colunas <-> configuracao
 * ---------------------------------------------------------------------------------------------- */

test("linha -> configuracao: produtos so em first_login, validos e canonicos; lixo vira 'a primeira vez na area'", () => {
  const primeiro = model.popupSettingsOfRow(colunas({ popup_access_products: ["curso-b", " curso-a ", "curso-b"], popup_trigger: "first_login" }));
  assert.equal(primeiro.trigger, "first_login");
  assert.deepEqual(primeiro.accessProducts, ["curso-a", "curso-b"], "aparados, sem repeticao, em ordem");

  assert.deepEqual(
    model.popupSettingsOfRow(colunas({ popup_access_products: ["bom_1", "bad id", "", "a,b", 7, null, "x".repeat(241)], popup_trigger: "first_login" })).accessProducts,
    ["bom_1"],
    "os invalidos saem, os validos ficam"
  );
  assert.deepEqual(model.popupSettingsOfRow(colunas({ popup_access_products: "curso-a", popup_trigger: "first_login" })).accessProducts, [], "coluna que nao e lista");
  assert.deepEqual(model.popupSettingsOfRow({ popup_trigger: "first_login" }).accessProducts, [], "linha lida sem a coluna");
  assert.equal(
    model.popupSettingsOfRow(colunas({ popup_access_products: Array.from({ length: 25 }, (_, index) => `p${String(index).padStart(2, "0")}`), popup_trigger: "first_login" }))
      .accessProducts.length,
    20,
    "no maximo 20"
  );

  const pagina = model.popupSettingsOfRow(colunas({ popup_access_products: ["curso-a"], popup_trigger: "page_load" }));
  assert.equal("accessProducts" in pagina, false, "fora de first_login a chave nao existe");

  const curso = model.popupSettingsOfRow(colunas({ popup_pages: ["lesson:*"], popup_trigger: "course_completed" }));
  assert.equal(curso.trigger, "course_completed");
  assert.equal("accessProducts" in curso, false);

  assert.equal(model.popupSettingsOfRow(colunas({ popup_trigger: "at_start" })).trigger, "page_load", "at_start continua page_load");
  assert.equal(model.popupSettingsOfRow(colunas({ popup_trigger: "exit_intent" })).trigger, "page_load", "momento desconhecido");
});

test("configuracao -> colunas: produtos so em first_login; forma canonica ordenada; configuracao de antes byte a byte igual", () => {
  const primeiro = { ...model.POPUP_SETTINGS_DEFAULT, accessProducts: ["curso-a"], trigger: "first_login" };
  assert.deepEqual(model.popupSettingsToColumns(primeiro).popup_access_products, ["curso-a"]);
  assert.deepEqual(model.popupSettingsOfRow(model.popupSettingsToColumns(primeiro)), primeiro, "ida e volta");
  assert.deepEqual(model.popupSettingsToColumns({ ...primeiro, accessProducts: undefined }).popup_access_products, []);

  const colunasDoPrimeiro = model.popupSettingsToColumns(primeiro);
  colunasDoPrimeiro.popup_access_products.push("outro");
  assert.deepEqual(primeiro.accessProducts, ["curso-a"], "a lista e copiada");

  assert.deepEqual(model.popupSettingsToColumns({ ...model.POPUP_SETTINGS_DEFAULT, accessProducts: ["curso-a"], trigger: "page_load" }).popup_access_products, [], "fora de first_login");
  assert.deepEqual(model.POPUP_COLUMNS_FOR_INBOX.popup_access_products, [], "notificacao: sempre vazio");

  assert.deepEqual(model.canonicalPopupSettings({ ...primeiro, accessProducts: ["z", "a", "z", " m "] }).accessProducts, ["a", "m", "z"]);
  assert.deepEqual(model.canonicalPopupSettings({ ...model.POPUP_SETTINGS_DEFAULT, trigger: "first_login" }).accessProducts, [], "first_login sem a chave ganha []");
  assert.equal("accessProducts" in model.canonicalPopupSettings({ ...primeiro, trigger: "page_load" }), false, "saiu de first_login: apagada");
  assert.equal("accessProducts" in model.canonicalPopupSettings({ ...primeiro, pages: ["lesson:*"], trigger: "course_completed" }), false);

  const antes = { ...model.POPUP_SETTINGS_DEFAULT, exclude: ["profile"], pages: ["any"] };
  assert.equal(JSON.stringify(model.canonicalPopupSettings(antes)), JSON.stringify({ ...antes, exclude: ["profile"], pages: ["any"] }), "sem a chave nova");
  assert.equal(JSON.stringify(model.popupSettingsOfRow(model.popupSettingsToColumns(antes))), JSON.stringify(antes));
});

/* ------------------------------------------------------------------------------------------------
 * 4. Schema
 * ---------------------------------------------------------------------------------------------- */

test("schema do pop-up: curso so em aula; produtos validos e ate 20; produtos fora do primeiro acesso somem", () => {
  const problema = (settings) => {
    const parsed = schemas.popupSettingsSchema.safeParse(settings);
    return parsed.success ? null : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  };

  assert.deepEqual(problema({ pages: ["home"], trigger: "course_completed" }), ["pages: Ao concluir um curso vale só para páginas de aula."]);
  assert.deepEqual(problema({ pages: ["home"], trigger: "lesson_completed" }), ["pages: Ao concluir uma aula vale só para páginas de aula."]);
  assert.equal(problema({ pages: ["lesson:*"], trigger: "course_completed" }), null);
  assert.deepEqual(problema({ accessProducts: ["curso a"], trigger: "first_login" }), ["accessProducts.0: Escolha produtos da lista."]);
  assert.deepEqual(problema({ accessProducts: [7], trigger: "first_login" }), ["accessProducts.0: Escolha produtos da lista."]);
  assert.deepEqual(
    problema({ accessProducts: Array.from({ length: 21 }, (_, index) => `p${index}`), trigger: "first_login" }),
    ["accessProducts: Use até 20 produtos."]
  );
  assert.deepEqual(problema({ trigger: "at_start" }), ["trigger: Escolha quando o pop-up aparece."], "at_start nao e momento da tela");

  const primeiro = schemas.popupSettingsSchema.parse({ accessProducts: ["b", "a", "b"], trigger: "first_login" });
  assert.deepEqual(primeiro.accessProducts, ["a", "b"], "canonico");
  assert.deepEqual(schemas.popupSettingsSchema.parse({ trigger: "first_login" }).accessProducts, [], "a primeira vez na area");

  const pagina = schemas.popupSettingsSchema.parse({ accessProducts: ["curso-a"], trigger: "page_load" });
  assert.equal("accessProducts" in pagina, false, "aceita e some");
  assert.equal("accessProducts" in schemas.popupSettingsSchema.parse({}), false, "o padrao continua sem a chave");
});

/* ------------------------------------------------------------------------------------------------
 * 5 e 6. Plano e mapa com os agendados
 * ---------------------------------------------------------------------------------------------- */

test("plano: o que comeca em ate 24 h entra com startsAt e notBefore = Comeca; o comecado ha menos de 24 h leva startsAt", () => {
  const plano = (live, deliveries = live.map((popup) => estado({ campaignId: popup.id }))) => model.planPopups({ deliveries, live, now });

  const [emUmaHora] = plano([regras("live", { startsAt: now + HOUR })]);
  assert.equal(emUmaHora.startsAt, iso(now + HOUR));
  assert.equal(emUmaHora.notBefore, iso(now + HOUR), "o navegador antigo nao arma nada antes da hora");

  assert.deepEqual(plano([regras("longe", { startsAt: now + 25 * HOUR })]), [], "em 25 h: fora");
  assert.equal(plano([regras("limite", { startsAt: now + DAY })]).length, 1, "exatamente 24 h: dentro");
  assert.deepEqual(model.planPopups({ deliveries: [estado({ campaignId: "x" })], horizonMs: HOUR, live: [regras("x", { startsAt: now + 2 * HOUR })], now }), [], "horizonte injetado");

  const [lembrar] = plano(
    [regras("lembrar", { startsAt: now + HOUR }, { frequency: repetir() })],
    [estado({ campaignId: "lembrar", impressions: 1, lastSeenAt: now - DAY, snoozeCount: 1, snoozedUntil: now + 2 * HOUR })]
  );
  assert.equal(lembrar.notBefore, iso(now + 2 * HOUR), "o maior entre o Lembrar depois e o Comeca");
  assert.equal(lembrar.startsAt, iso(now + HOUR));

  const [comecou] = plano([regras("comecou", { startsAt: now - HOUR })]);
  assert.equal(comecou.startsAt, iso(now - HOUR), "ja comecou ha menos de 24 h: com startsAt");
  assert.equal(comecou.notBefore, null, "e sem notBefore por isso");

  const [antigo] = plano([regras("antigo", { startsAt: now - 25 * HOUR })]);
  assert.equal("startsAt" in antigo, false, "comecou ha mais de 24 h");
  const [semComeca] = plano([regras("sem")]);
  assert.equal("startsAt" in semComeca, false, "sem Comeca");

  assert.deepEqual(plano([regras("vista", { startsAt: now + HOUR })], [estado({ campaignId: "vista", impressions: 1, lastSeenAt: now - DAY })]), [], "'Uma vez' visto: fora");
  assert.deepEqual(plano([regras("fora", { startsAt: now + HOUR })], [estado({ campaignId: "fora", eligible: false })]), [], "fora do segmento: fora");
  assert.deepEqual(plano([regras("fim", { endsAt: now, startsAt: now - HOUR })]), [], "janela terminou");

  const [primeiro] = plano([regras("p", {}, { accessProducts: [], trigger: "first_login" })]);
  assert.equal(primeiro.trigger, "first_login", "o momento novo vai no plano");
  assert.equal("accessProducts" in primeiro, false, "os produtos nunca vao para o navegador");
});

test("mapa das paginas: cobre as paginas de um agendado em ate 24 h, nao em 25 h", () => {
  assert.deepEqual(model.pagesCovering([regras("a", { startsAt: now + 23 * HOUR }, { pages: ["saved", "lesson:curso-a"] })], now), ["saved", "lesson:*"]);
  assert.deepEqual(model.pagesCovering([regras("a", { startsAt: now + 25 * HOUR }, { pages: ["saved"] })], now), []);
  assert.deepEqual(model.pagesCovering([regras("a", { startsAt: now + 2 * HOUR }, { pages: ["saved"] })], now, HOUR), [], "horizonte injetado");
  assert.equal(model.popupWindowSoon({ endsAt: null, startsAt: now + DAY }, now), true);
  assert.equal(model.popupWindowSoon({ endsAt: null, startsAt: now + DAY + 1 }, now), false);
  assert.equal(model.popupWindowSoon({ endsAt: now, startsAt: null }, now), false, "fim agora: fechou");
  assert.equal(model.popupWindowSoon({ endsAt: null, startsAt: null }, now), true);
});

/* ------------------------------------------------------------------------------------------------
 * 7. Show
 * ---------------------------------------------------------------------------------------------- */

test("show: agendado no segmento = not_started com o Comeca; fora do segmento = not_eligible; encerrado = not_live; o resto intacto", () => {
  const popup = regras("a", { startsAt: now + MIN }, { pages: ["saved"] });
  const decide = (extra) => model.decideShow({ delivery: estado(), now, pageKey: "saved", popup, trigger: "page_load", ...extra });

  assert.deepEqual(decide({}), { nextAt: now + MIN, ok: false, reason: "not_started" });
  assert.deepEqual(decide({ pageKey: "home" }), { nextAt: now + MIN, ok: false, reason: "not_started" }, "o Comeca vem antes da pagina");
  assert.deepEqual(decide({ delivery: null }), { nextAt: null, ok: false, reason: "not_eligible" });
  assert.deepEqual(decide({ delivery: estado({ eligible: false }) }), { nextAt: null, ok: false, reason: "not_eligible" }, "nada vaza para quem nao esta no segmento");
  assert.deepEqual(decide({ popup: { ...popup, endsAt: now } }), { nextAt: null, ok: false, reason: "not_live" });
  assert.deepEqual(decide({ now: now + MIN }), { ok: true }, "na hora");

  const noAr = { ...popup, startsAt: now - MIN };
  assert.deepEqual(decide({ pageKey: "home", popup: noAr }), { nextAt: null, ok: false, reason: "page" });
  assert.deepEqual(decide({ popup: noAr, trigger: "first_login" }), { nextAt: null, ok: false, reason: "trigger" });
  assert.deepEqual(decide({ delivery: estado({ impressions: 1, lastSeenAt: now - DAY }), popup: noAr }), { nextAt: null, ok: false, reason: "frequency" });

  const primeiro = regras("p", {}, { trigger: "first_login" });
  assert.deepEqual(model.decideShow({ delivery: estado(), now, pageKey: "home", popup: primeiro, trigger: "first_login" }), { ok: true });
  assert.deepEqual(model.decideShow({ delivery: estado(), now, pageKey: "home", popup: primeiro, trigger: "page_load" }), { nextAt: null, ok: false, reason: "trigger" });
});

/* ------------------------------------------------------------------------------------------------
 * 8 a 10. Primeiro acesso
 * ---------------------------------------------------------------------------------------------- */

const since = Date.parse("2026-10-20T12:00:00.000Z");
const fatos = (extra = {}) => ({ accesses: [], createdAt: since - 30 * DAY, lastSignInAt: since - DAY, userId: "u", ...extra });
const acesso = (productId, gainedAt) => ({ endsAt: null, gainedAt, productId, startsAt: gainedAt });

test("aluno novo, 'A primeira vez na área': nunca entrou ou conta criada depois do comeco; quem ja usava nao", () => {
  const novo = (extra) => firstAccess.isFirstAccessCandidate(fatos(extra), [], since);

  assert.equal(novo({ lastSignInAt: null }), true, "nunca entrou (conta antiga)");
  assert.equal(novo({ createdAt: since + HOUR, lastSignInAt: since + 2 * HOUR }), true, "conta nova que ja entrou");
  assert.equal(novo({ createdAt: since, lastSignInAt: since }), true, "since exatamente igual conta");
  assert.equal(novo({}), false, "conta antiga que ja entrou");
  assert.equal(novo({ createdAt: undefined }), false, "sem a data da conta, so 'nunca entrou' conta");
  assert.equal(novo({ accesses: [acesso("curso-a", since + HOUR)] }), false, "acesso novo nao importa na area");
});

test("aluno novo, 'A primeira vez com estes produtos': acesso aberto a um deles ganho depois, ou nunca entrou", () => {
  const novo = (extra) => firstAccess.isFirstAccessCandidate(fatos(extra), ["curso-a", "curso-b"], since);

  assert.equal(novo({ accesses: [acesso("curso-a", since + HOUR)] }), true, "acesso novo, mesmo que ja usasse a area");
  assert.equal(novo({ accesses: [acesso("curso-b", since)] }), true, "since exatamente igual conta");
  assert.equal(novo({ accesses: [acesso("curso-a", since - DAY)], lastSignInAt: null }), true, "acesso antigo e nunca entrou");
  assert.equal(novo({ accesses: [acesso("curso-a", since - DAY)] }), false, "acesso antigo e ja entrou");
  assert.equal(novo({ accesses: [acesso("platform", since + HOUR)] }), true, "a plataforma inteira vale para qualquer lista");
  assert.equal(novo({ accesses: [acesso("platform", since - DAY)] }), false, "plataforma antiga e ja entrou");
  assert.equal(novo({ accesses: [acesso("outro", since + HOUR)] }), false, "sem acesso ao produto");
  assert.equal(novo({ accesses: [], lastSignInAt: null }), false, "nunca entrou mas sem acesso a nenhum deles");
  assert.equal(novo({ accesses: [{ endsAt: null, productId: "curso-a", startsAt: since + HOUR }] }), true, "sem gainedAt usa startsAt");
  assert.equal(novo({ accesses: [acesso("outro", since + HOUR), acesso("curso-a", since - DAY)] }), false, "o acesso novo e de outro produto");

  assert.equal(firstAccess.hasOpenAccessToAny(fatos({ accesses: [acesso("curso-b", 0)] }), ["curso-a", "curso-b"]), true);
  assert.equal(firstAccess.hasOpenAccessToAny(fatos({ accesses: [acesso("platform", 0)] }), ["curso-a"]), true);
  assert.equal(firstAccess.hasOpenAccessToAny(fatos({ accesses: [acesso("outro", 0)] }), ["curso-a"]), false);
  assert.equal(firstAccess.hasOpenAccessToAny(fatos(), ["curso-a"]), false);
});

test("recalculo do primeiro acesso: marca os candidatos; o marcado fica; o elegivel sem marca e sem ser candidato sai", () => {
  const mudar = ({ audience, candidates, current, withAccess = null }) =>
    firstAccess.firstAccessDeliveryChanges({
      audience: new Set(audience),
      candidates: new Set(candidates),
      current: new Map(Object.entries(current)),
      withAccess: withAccess === null ? null : new Set(withAccess)
    });
  const linha = (eligible, marked) => ({ eligible, marked });

  assert.deepEqual(mudar({ audience: ["novo"], candidates: ["novo"], current: {} }), { audienceCount: 1, toDisable: [], toMark: ["novo"] }, "candidato sem linha");
  assert.deepEqual(
    mudar({ audience: ["novo"], candidates: ["novo"], current: { novo: linha(true, false) } }),
    { audienceCount: 1, toDisable: [], toMark: ["novo"] },
    "candidato com linha de um app antigo (elegivel sem marca): so marca"
  );
  assert.deepEqual(mudar({ audience: ["novo"], candidates: ["novo"], current: { novo: linha(true, true) } }), { audienceCount: 1, toDisable: [], toMark: [] }, "ja marcado: nada");
  assert.deepEqual(mudar({ audience: ["novo"], candidates: ["novo"], current: { novo: linha(false, true) } }), { audienceCount: 1, toDisable: [], toMark: ["novo"] }, "volta a ficar elegivel");
  assert.deepEqual(
    mudar({ audience: ["entrou"], candidates: [], current: { entrou: linha(true, true) } }),
    { audienceCount: 1, toDisable: [], toMark: [] },
    "marcado que entrou na area (nao e mais candidato) continua"
  );
  assert.deepEqual(mudar({ audience: [], candidates: [], current: { saiu: linha(true, true) } }), { audienceCount: 0, toDisable: ["saiu"], toMark: [] }, "marcado que saiu do segmento sai");
  assert.deepEqual(
    mudar({ audience: ["velho", "outro"], candidates: [], current: { outro: linha(true, false), velho: linha(true, false) } }),
    { audienceCount: 0, toDisable: ["outro", "velho"], toMark: [] },
    "elegivel sem marca e sem ser candidato sai (a linha de um app sem esta regra)"
  );
  assert.deepEqual(mudar({ audience: ["parado"], candidates: [], current: { parado: linha(false, false) } }), { audienceCount: 0, toDisable: [], toMark: [] }, "nao elegivel fica como esta");

  assert.deepEqual(
    mudar({ audience: ["reembolso"], candidates: [], current: { reembolso: linha(true, true) }, withAccess: [] }),
    { audienceCount: 0, toDisable: ["reembolso"], toMark: [] },
    "estes produtos: marcado que perdeu o acesso a todos sai"
  );
  assert.deepEqual(
    mudar({ audience: ["plataforma"], candidates: [], current: { plataforma: linha(true, true) }, withAccess: ["plataforma"] }),
    { audienceCount: 1, toDisable: [], toMark: [] },
    "com a plataforma (ou outro dos produtos) fica"
  );

  assert.deepEqual(
    mudar({
      audience: ["a", "b", "c", "d", "e"],
      candidates: ["a", "b"],
      current: { a: linha(true, true), c: linha(true, true), d: linha(true, false), e: linha(false, true) }
    }),
    { audienceCount: 3, toDisable: ["d"], toMark: ["b"] },
    "contagem = candidatos e quem fica"
  );
});

test("comeco do pop-up para o primeiro acesso: Comeca, senao a publicacao, senao a criacao", () => {
  const criado = "2026-10-01T00:00:00.000Z";
  const enviado = "2026-10-02T00:00:00.000Z";
  const comeca = "2026-10-03T00:00:00.000Z";

  assert.equal(firstAccess.firstAccessSince({ created_at: criado, sent_at: enviado, starts_at: comeca }), Date.parse(comeca));
  assert.equal(firstAccess.firstAccessSince({ created_at: criado, sent_at: enviado, starts_at: null }), Date.parse(enviado));
  assert.equal(firstAccess.firstAccessSince({ created_at: criado, sent_at: null, starts_at: null }), Date.parse(criado));
  assert.equal(firstAccess.firstAccessSince({ created_at: criado, sent_at: "quebrado", starts_at: "" }), Date.parse(criado));

  assert.equal(firstAccess.switchesFirstAccess("page_load", "first_login"), true);
  assert.equal(firstAccess.switchesFirstAccess("first_login", "course_completed"), true);
  assert.equal(firstAccess.switchesFirstAccess("first_login", "first_login"), false);
  assert.equal(firstAccess.switchesFirstAccess("page_load", "lesson_completed"), false, "entre os outros momentos troca a vontade");
});

/* ------------------------------------------------------------------------------------------------
 * 11. Curso concluido
 * ---------------------------------------------------------------------------------------------- */

test("curso concluido: todas as publicadas (e pelo menos uma); a virada; ja completo antes; desmarcar e concluir de novo", () => {
  const publicadas = ["a1", "a2"];

  assert.equal(course.isCourseComplete([], ["a1"]), false, "sem aula publicada nunca completo");
  assert.equal(course.isCourseComplete(publicadas, ["a1"]), false);
  assert.equal(course.isCourseComplete(publicadas, new Set(["a2", "a1", "rascunho"])), true);

  assert.equal(course.courseJustCompleted({ after: ["a1", "a2"], before: ["a1"], published: publicadas }), true, "virada");
  assert.equal(course.courseJustCompleted({ after: ["a1", "a2"], before: ["a1", "a2"], published: publicadas }), false, "ja completo antes");
  assert.equal(course.courseJustCompleted({ after: ["a1", "rascunho"], before: ["a1"], published: publicadas }), false, "concluida que nao e publicada nao conta");
  assert.equal(course.courseJustCompleted({ after: ["a1"], before: ["a1", "a2"], published: publicadas }), false, "desmarcar");
  assert.equal(course.courseJustCompleted({ after: ["a1", "a2"], before: ["a1"], published: publicadas }), true, "e concluir de novo vira de novo");
  assert.equal(course.courseJustCompleted({ after: [], before: [], published: [] }), false);

  assert.equal(course.courseCompletedOf({ courseCompleted: true, data: {} }), true);
  for (const corpo of [{ courseCompleted: "true" }, { courseCompleted: 1 }, { data: {} }, null, "courseCompleted", [true], undefined, 7]) {
    assert.equal(course.courseCompletedOf(corpo), false, JSON.stringify(corpo));
  }
});

/* ------------------------------------------------------------------------------------------------
 * 12. Vocabulario
 * ---------------------------------------------------------------------------------------------- */

test("vocabulario dos textos novos do servidor (a mesma lista das frases e do editor)", () => {
  const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "automação", "lembrete", "layout", "template", "home"];
  const mensagens = [
    firstAccess.FIRST_ACCESS_SWITCH_MESSAGE,
    ...schemas.popupSettingsSchema.safeParse({ pages: ["home"], trigger: "course_completed" }).error.issues.map((issue) => issue.message),
    ...schemas.popupSettingsSchema.safeParse({ accessProducts: ["x y"], trigger: "first_login" }).error.issues.map((issue) => issue.message),
    ...schemas.popupSettingsSchema.safeParse({ accessProducts: Array.from({ length: 21 }, (_, index) => `p${index}`), trigger: "first_login" }).error.issues.map((issue) => issue.message)
  ];

  assert.deepEqual(mensagens, [
    "Num pop-up que já foi ao ar, não dá para trocar de ou para “No primeiro acesso”. Duplique o pop-up.",
    "Ao concluir um curso vale só para páginas de aula.",
    "Escolha produtos da lista.",
    "Use até 20 produtos."
  ]);

  for (const mensagem of mensagens) {
    for (const palavra of PROIBIDAS) {
      assert.doesNotMatch(mensagem.toLocaleLowerCase("pt-BR"), new RegExp(`\\b${palavra}\\b`, "u"), `${palavra} em "${mensagem}"`);
    }

    assert.doesNotMatch(mensagem, /first_login|course_completed|message_impressed/, "nome interno em texto");
  }
});

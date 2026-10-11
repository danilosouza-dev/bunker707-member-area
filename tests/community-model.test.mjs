import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

const model = await import("../src/server/community/model.ts");
const schemas = await import("../src/server/community/schemas.ts");

const clean = (value) => JSON.parse(JSON.stringify(value));
const now = new Date("2026-10-10T12:00:00Z");

test("pergunta passa a ser alerta depois de 24 h", () => {
  assert.equal(model.isOverdueQuestion("2026-10-09T11:59:00Z", now), true);
  assert.equal(model.isOverdueQuestion("2026-10-09T12:30:00Z", now), false);
  assert.equal(model.isOverdueQuestion("data ruim", now), false);
});

test("tempo de espera e de resposta em texto curto, sem inventar numero", () => {
  assert.equal(model.formatWaitingTime("2026-10-10T11:58:00Z", now), "há 2 min");
  assert.equal(model.formatWaitingTime("2026-10-10T11:59:59Z", now), "há 1 min");
  assert.equal(model.formatWaitingTime("2026-10-10T07:00:00Z", now), "há 5 h");
  assert.equal(model.formatWaitingTime("2026-10-07T12:00:00Z", now), "há 3 d");
  assert.equal(model.formatResponseHours(9.4), "9 h");
  assert.equal(model.formatResponseHours(60), "2,5 d");
  assert.equal(model.formatResponseHours(null), "—");
  assert.equal(model.formatResponseHours(Number.NaN), "—");
});

test("resposta rapida preenche {nome} e {aula} e mantem o resto", () => {
  assert.equal(
    model.renderQuickReply("Oi, {nome}! Na aula {aula}, veja o minuto 3. {Nome} {curso}", {
      lessonTitle: " Primeiro prompt ",
      studentName: "  Ana   Souza "
    }),
    "Oi, Ana! Na aula Primeiro prompt, veja o minuto 3. Ana {curso}"
  );
  assert.equal(model.renderQuickReply("Oi, {nome}", { lessonTitle: "", studentName: "   " }), "Oi, aluno");
});

test("saldo da avaliacao da aula", () => {
  assert.equal(model.ratingBalance({ liked: 0, loved: 0, notForMe: 0 }), null);
  assert.equal(model.ratingBalance({ liked: 2, loved: 6, notForMe: 2 }), 0.4);
  assert.equal(model.ratingBalance({ liked: 0, loved: 0, notForMe: 4 }), -1);
  assert.equal(model.RATING_MIN_RESPONSES_FOR_ACTION, 20);
});

// Periodo padrao (ultimos 30 dias) lido as 9h de 10/10/2026 em Sao Paulo: comeca 00:00 de 11/09.
const DEFAULT_PERIOD = {
  explicit: false,
  inlineLabel: "nos últimos 30 dias",
  label: "Últimos 30 dias",
  param: "30d",
  since: "2026-09-11T03:00:00.000Z"
};

test("filtros da Comunidade vem do endereco e lixo vira padrao", () => {
  assert.deepEqual(clean(schemas.parseCommunitySearchParams({}, now)), { page: 1, period: DEFAULT_PERIOD });
  assert.deepEqual(
    clean(schemas.parseCommunitySearchParams({ aula: "lesson-a", pagina: "2", periodo: "7", produto: "course-a" }, now)),
    {
      lesson: "lesson-a",
      page: 2,
      period: {
        explicit: true,
        inlineLabel: "nos últimos 7 dias",
        label: "Últimos 7 dias",
        param: "7d",
        since: "2026-10-04T03:00:00.000Z"
      },
      product: "course-a"
    }
  );
  assert.deepEqual(
    clean(schemas.parseCommunitySearchParams({ aula: "<x>", pagina: "abc", periodo: "15", produto: "../a" }, now)),
    { page: 1, period: DEFAULT_PERIOD }
  );
  assert.deepEqual(
    clean(schemas.parseCommentListSearchParams({ busca: " prompt ", respondido: "nao", situacao: "spam" }, now)),
    { answered: "nao", page: 1, period: DEFAULT_PERIOD, q: "prompt", status: "spam" }
  );
  assert.deepEqual(clean(schemas.parseCommentListSearchParams({ situacao: "apagado" }, now)), { page: 1, period: DEFAULT_PERIOD });
});

test("periodo da Comunidade: presets novos, links antigos e intervalo so quando termina hoje", () => {
  const period = (value) => clean(model.resolveCommunityPeriod(value, now));

  assert.deepEqual(period(undefined), DEFAULT_PERIOD);
  assert.deepEqual(period("hoje"), {
    explicit: true,
    inlineLabel: "hoje",
    label: "Hoje",
    param: "hoje",
    since: "2026-10-10T03:00:00.000Z"
  });
  assert.deepEqual(period("1d"), {
    explicit: true,
    inlineLabel: "nas últimas 24 horas",
    label: "Últimas 24 horas",
    param: "1d",
    since: "2026-10-09T12:00:00.000Z"
  });
  assert.equal(period("3d").since, "2026-10-08T03:00:00.000Z");
  assert.equal(period("7d").param, "7d");
  assert.deepEqual(period("30d"), { ...DEFAULT_PERIOD, explicit: true }, "30d escolhido de proposito tira a fila do 'Tudo'");
  assert.equal(period(["7", "90"]).param, "7d", "valor repetido no endereco: vale o primeiro");

  // Links antigos 7 · 30 · 90 continuam valendo.
  assert.equal(period("7").param, "7d");
  assert.equal(period("30").param, "30d");
  assert.deepEqual(period("90"), {
    explicit: true,
    inlineLabel: "de 13 de jul. a 10 de out. de 2026",
    label: "13 de jul. a 10 de out. de 2026",
    param: "2026-07-13..2026-10-10",
    since: "2026-07-13T03:00:00.000Z"
  });

  // As consultas so recebem "desde": intervalo terminando hoje vale; intervalo ja fechado cai no padrao.
  assert.equal(period("2026-10-01..2026-10-10").since, "2026-10-01T03:00:00.000Z");
  assert.equal(period("2026-10-01..2026-10-10").explicit, true);
  assert.deepEqual(period("2026-09-01..2026-09-30"), DEFAULT_PERIOD);
  assert.deepEqual(period("2026-10-09"), DEFAULT_PERIOD, "um dia so, ontem: fechado");

  for (const invalid of ["", "  ", "15", "abc", "0d", "90d", "2026-13-01..2026-10-10", "2026-10-11..2026-10-12"]) {
    assert.deepEqual(period(invalid), DEFAULT_PERIOD, `periodo invalido: ${JSON.stringify(invalid)}`);
  }
});

test("periodo da Comunidade usa o dia de Sao Paulo", () => {
  // 23:30 de sabado (10/10) em Sao Paulo ja e domingo em UTC.
  const lateNight = new Date("2026-10-11T02:30:00Z");

  assert.equal(model.resolveCommunityPeriod("hoje", lateNight).since, "2026-10-10T03:00:00.000Z");
  assert.equal(model.resolveCommunityPeriod("2026-10-01..2026-10-10", lateNight).explicit, true, "hoje ainda e 10/10");
});

test("responder exige texto e id de comentario valido", () => {
  const id = "4b9e8f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";

  assert.deepEqual(schemas.replyToCommentSchema.parse({ body: "  Oi!  ", commentId: id }), { body: "Oi!", commentId: id, resolve: true });
  assert.equal(schemas.replyToCommentSchema.safeParse({ body: "   ", commentId: id }).success, false);
  assert.equal(schemas.replyToCommentSchema.safeParse({ body: "x".repeat(2_001), commentId: id }).success, false);
  assert.equal(schemas.replyToCommentSchema.safeParse({ body: "Oi", commentId: "123" }).success, false);
  assert.equal(schemas.moderateCommentSchema.safeParse({ commentId: id, status: "pending" }).success, false);
  assert.equal(schemas.quickReplySchema.safeParse({ body: "Oi {nome}", title: "x".repeat(61) }).success, false);
});

/* Acrescimos da frente D (fase 1) */

test("numeros do topo e saldo em texto, sem inventar valor", () => {
  assert.equal(model.formatAgeFromHours(52.7), "há 52 h");
  assert.equal(model.formatAgeFromHours(0.2), "há 12 min");
  assert.equal(model.formatAgeFromHours(80), "há 3 d");
  assert.equal(model.formatAgeFromHours(null), "—");
  assert.equal(model.formatRatingBalance(0.4), "+40%");
  assert.equal(model.formatRatingBalance(-0.25), "-25%");
  assert.equal(model.formatRatingBalance(0), "0%");
  assert.equal(model.formatRatingBalance(null), "—");
  assert.equal(model.isRatingActionable(19), false);
  assert.equal(model.isRatingActionable(20), true);
  assert.equal(model.communitySince(28, now), "2026-09-12T12:00:00.000Z");
  assert.equal(model.commentStatusTone("approved"), "success");
  assert.equal(model.commentStatusTone("pending"), "warning");
  assert.equal(model.commentStatusTone("spam"), "error");
  assert.equal(model.commentStatusTone("hidden"), "muted");
});

test("periodo explicito e ordem da aba Aulas vem do endereco", () => {
  assert.equal(schemas.hasExplicitPeriod({}, now), false);
  assert.equal(schemas.hasExplicitPeriod({ periodo: "7" }, now), true);
  assert.equal(schemas.hasExplicitPeriod({ periodo: "hoje" }, now), true);
  assert.equal(schemas.hasExplicitPeriod({ periodo: "15" }, now), false);
  assert.equal(schemas.hasExplicitPeriod({ periodo: "2026-09-01..2026-09-30" }, now), false);
  assert.deepEqual(clean(schemas.parseLessonRowsSearchParams({}, now)), { page: 1, period: DEFAULT_PERIOD, sort: "doubts" });
  assert.deepEqual(
    clean(schemas.parseLessonRowsSearchParams({ ordem: "piores", periodo: "3d", produto: "course-a" }, now)),
    {
      page: 1,
      period: {
        explicit: true,
        inlineLabel: "nos últimos 3 dias",
        label: "Últimos 3 dias",
        param: "3d",
        since: "2026-10-08T03:00:00.000Z"
      },
      product: "course-a",
      sort: "worst"
    }
  );
  assert.equal(schemas.parseLessonRowsSearchParams({ ordem: "melhores" }, now).sort, "best");
  assert.equal(schemas.parseLessonRowsSearchParams({ ordem: "worst" }, now).sort, "doubts", "so as palavras do produtor valem");
});

test("moderacao em massa: sem repetidos, ate 50 e so visivel, oculto ou spam", () => {
  const ids = Array.from({ length: 51 }, (_, index) => `4b9e8f2a-1c3d-4e5f-8a9b-${String(index).padStart(12, "0")}`);

  assert.deepEqual(schemas.moderateCommentsSchema.parse({ commentIds: [ids[0], ids[0], ids[1]], status: "hidden" }).commentIds, [ids[0], ids[1]]);
  assert.equal(schemas.moderateCommentsSchema.safeParse({ commentIds: [], status: "hidden" }).success, false);
  assert.equal(schemas.moderateCommentsSchema.safeParse({ commentIds: ids, status: "hidden" }).success, false);
  assert.equal(schemas.moderateCommentsSchema.safeParse({ commentIds: ids.slice(0, 50), status: "spam" }).success, true);
  assert.equal(schemas.moderateCommentsSchema.safeParse({ commentIds: [ids[0]], status: "pending" }).success, false);
  assert.equal(schemas.blockedWordSchema.safeParse({ word: "   " }).success, false);
  assert.equal(schemas.blockedWordSchema.safeParse({ word: "link na bio" }).success, true);
});

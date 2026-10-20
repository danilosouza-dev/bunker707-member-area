import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Segmento dos avisos ("Para quem", docs/22 §3): regras combinaveis em grupos E/OU avaliadas sobre os
// fatos de cada aluno, a frase que o produtor le, a conversao dos segmentos salvos de Alunos e os
// limites do schema. Modulos puros (src/server/communications/audience-model.ts e schemas.ts).

const model = await import("../src/server/communications/audience-model.ts");
const { audienceDefinitionSchema } = await import("../src/server/communications/schemas.ts");

const DAY = 86_400_000;
// 20/10/2026 12:00 em Sao Paulo.
const now = Date.parse("2026-10-20T15:00:00.000Z");
const daysAgo = (days) => now - days * DAY;
const inDays = (days) => now + days * DAY;

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

function contexto(extra = {}) {
  return { commentRanks: model.buildCommentRanks([]), lessonTotals: {}, now, ...extra };
}

const regras = (match, ...items) => ({ kind: "rules", root: { items, match } });
const todas = (...items) => regras("all", ...items);
const avalia = (definition, facts, context = contexto()) => model.evaluateAudience(definition, facts, context);
const acesso = (productId, startsAt = daysAgo(100), endsAt = null) => ({ endsAt, productId, startsAt });

/* ------------------------------------------------------------------------------------------------
 * Avaliacao
 * ---------------------------------------------------------------------------------------------- */

test("todos os alunos sempre entra; grupo 'todas' vazio entra e grupo 'qualquer' vazio nao entra", () => {
  assert.equal(avalia(model.EVERYONE, aluno()), true);
  assert.equal(avalia(regras("all"), aluno()), true);
  assert.equal(avalia(regras("any"), aluno()), false);
});

test("produto: tem acesso a qualquer um dos escolhidos; acesso a plataforma vale para todo produto; 'não têm' e o contrario", () => {
  const tem = { op: "has", productIds: ["curso-a", "curso-b"], type: "product" };
  const naoTem = { ...tem, op: "has_not" };

  assert.equal(avalia(todas(tem), aluno({ accesses: [acesso("curso-b")] })), true);
  assert.equal(avalia(todas(tem), aluno({ accesses: [acesso("curso-c")] })), false);
  assert.equal(avalia(todas(tem), aluno({ accesses: [acesso("platform")] })), true);
  assert.equal(avalia(todas(naoTem), aluno({ accesses: [acesso("curso-c")] })), true);
  assert.equal(avalia(todas(naoTem), aluno({ accesses: [acesso("platform")] })), false);
  assert.equal(avalia(todas(naoTem), aluno()), true);
});

test("progresso num produto: precisa do acesso (ao produto ou a plataforma) e de aulas publicadas; arredonda para baixo", () => {
  const context = contexto({ lessonTotals: { "curso-a": 3, "curso-vazio": 0 } });
  const pelomenos = (percent, productId = "curso-a") => todas({ op: "gte", percent, productId, type: "progress" });
  const nomaximo = (percent, productId = "curso-a") => todas({ op: "lte", percent, productId, type: "progress" });
  const comAcesso = aluno({ accesses: [acesso("curso-a")], completedByContent: { "curso-a": 2 } });

  // 2 de 3 = 66,6% -> 66%.
  assert.equal(avalia(pelomenos(66), comAcesso, context), true);
  assert.equal(avalia(pelomenos(67), comAcesso, context), false);
  assert.equal(avalia(nomaximo(66), comAcesso, context), true);
  assert.equal(avalia(nomaximo(65), comAcesso, context), false);

  assert.equal(avalia(pelomenos(0), aluno({ completedByContent: { "curso-a": 3 } }), context), false, "sem acesso ao produto");
  assert.equal(avalia(pelomenos(50), aluno({ accesses: [acesso("platform")], completedByContent: { "curso-a": 2 } }), context), true, "plataforma");
  assert.equal(avalia(nomaximo(100, "curso-vazio"), aluno({ accesses: [acesso("curso-vazio")] }), context), false, "sem aulas nao ha o que medir");
  assert.equal(avalia(nomaximo(100, "curso-sumido"), aluno({ accesses: [acesso("curso-sumido")] }), context), false);
});

test("progresso geral usa o total do que o aluno pode estudar; total zero nunca entra", () => {
  const regra = (op, percent) => todas({ op, percent, productId: null, type: "progress" });

  assert.equal(avalia(regra("gte", 25), aluno({ completedLessons: 1, totalLessons: 4 })), true);
  assert.equal(avalia(regra("gte", 26), aluno({ completedLessons: 1, totalLessons: 4 })), false);
  assert.equal(avalia(regra("lte", 0), aluno({ completedLessons: 0, totalLessons: 4 })), true);
  assert.equal(avalia(regra("lte", 100), aluno({ completedLessons: 0, totalLessons: 0 })), false);
  assert.equal(avalia(regra("gte", 0), aluno({ completedLessons: 0, totalLessons: 0 })), false);
});

test("comentarios: pelo menos, no maximo e nenhum em cada janela (7, 30, 90 dias e desde sempre)", () => {
  const comments = { d7: 1, d30: 3, d90: 5, total: 9 };
  const regra = (op, count, days) => todas({ count, days, op, type: "comments" });
  const ana = aluno({ comments });

  assert.equal(avalia(regra("gte", 1, 7), ana), true);
  assert.equal(avalia(regra("gte", 2, 7), ana), false);
  assert.equal(avalia(regra("gte", 3, 30), ana), true);
  assert.equal(avalia(regra("lte", 5, 90), ana), true);
  assert.equal(avalia(regra("lte", 4, 90), ana), false);
  assert.equal(avalia(regra("gte", 9, null), ana), true);
  assert.equal(avalia(regra("none", 0, 7), ana), false);
  assert.equal(avalia(regra("none", 0, 7), aluno({ comments: { d7: 0, d30: 2, d90: 2, total: 2 } })), true);
  assert.equal(avalia(regra("none", 0, null), aluno({ comments: { d7: 0, d30: 2, d90: 2, total: 2 } })), false);
});

test("quem mais comentou: posicao entre quem comentou na janela, empate decidido pelo id; quem nao comentou nunca entra", () => {
  const entries = [
    { comments: { d7: 2, d30: 2, d90: 2, total: 2 }, userId: "c" },
    { comments: { d7: 5, d30: 5, d90: 5, total: 5 }, userId: "a" },
    { comments: { d7: 2, d30: 9, d90: 9, total: 9 }, userId: "b" },
    { comments: { d7: 0, d30: 0, d90: 0, total: 1 }, userId: "d" }
  ];
  const ranks = model.buildCommentRanks(entries);

  assert.deepEqual([...ranks["7"]], [["a", 1], ["b", 2], ["c", 3]], "empate entre b e c: b antes");
  assert.deepEqual([...ranks["30"]], [["b", 1], ["a", 2], ["c", 3]]);
  assert.deepEqual([...ranks.all], [["b", 1], ["a", 2], ["c", 3], ["d", 4]]);
  assert.equal(ranks["90"].has("d"), false);

  const top = (count, days) => todas({ count, days, op: "top", type: "comments" });
  const context = contexto({ commentRanks: ranks });
  const pessoa = (userId) => aluno({ comments: entries.find((entry) => entry.userId === userId)?.comments, userId });

  assert.equal(avalia(top(2, 7), pessoa("b"), context), true);
  assert.equal(avalia(top(2, 7), pessoa("c"), context), false);
  assert.equal(avalia(top(1, 30), pessoa("b"), context), true);
  assert.equal(avalia(top(100, 7), pessoa("d"), context), false, "nao comentou em 7 dias");
  assert.equal(avalia(top(100, null), pessoa("d"), context), true);
});

test("tempo de acesso: com produto usa o acesso dele (ou o da plataforma); sem produto, qualquer acesso aberto", () => {
  const menosDe = (days, productId = null) => todas({ days, op: "lt", productId, type: "access_age" });
  const maisDe = (days, productId = null) => todas({ days, op: "gt", productId, type: "access_age" });
  const novato = aluno({ accesses: [acesso("curso-a", daysAgo(3)), acesso("curso-b", daysAgo(200))] });

  assert.equal(avalia(menosDe(7, "curso-a"), novato), true);
  assert.equal(avalia(menosDe(7, "curso-b"), novato), false);
  assert.equal(avalia(maisDe(30, "curso-b"), novato), true);
  assert.equal(avalia(maisDe(2, "curso-a"), novato), true);
  assert.equal(avalia(menosDe(7, "curso-c"), novato), false, "sem acesso ao produto");
  assert.equal(avalia(menosDe(7, "curso-c"), aluno({ accesses: [acesso("platform", daysAgo(1))] })), true, "a plataforma abre o produto");

  assert.equal(avalia(menosDe(7), novato), true, "algum acesso recente");
  assert.equal(avalia(maisDe(100), novato), true, "algum acesso antigo");
  assert.equal(avalia(maisDe(300), novato), false);
  assert.equal(avalia(menosDe(7), aluno()), false, "sem acesso nenhum");
  assert.equal(avalia(maisDe(1), aluno()), false);
});

test("acesso terminando: so acesso com fim entre agora e os proximos dias; vencido ou sem fim nao entra", () => {
  const terminando = (days, productId = null) => todas({ days, productId, type: "access_ending" });

  assert.equal(avalia(terminando(30), aluno({ accesses: [acesso("curso-a", daysAgo(10), inDays(20))] })), true);
  assert.equal(avalia(terminando(10), aluno({ accesses: [acesso("curso-a", daysAgo(10), inDays(20))] })), false);
  assert.equal(avalia(terminando(30), aluno({ accesses: [acesso("curso-a", daysAgo(10), null)] })), false);
  assert.equal(avalia(terminando(30), aluno({ accesses: [acesso("curso-a", daysAgo(10), daysAgo(1))] })), false);
  assert.equal(avalia(terminando(30, "curso-b"), aluno({ accesses: [acesso("curso-a", daysAgo(10), inDays(5))] })), false);
  assert.equal(avalia(terminando(30, "curso-a"), aluno({ accesses: [acesso("curso-a", daysAgo(10), inDays(5))] })), true);
});

test("ultimo estudo e entrada na plataforma: dentro da janela, fora dela e nunca", () => {
  const estudou = (op, days) => todas({ days, op, type: "last_study" });
  const entrou = (op, days) => todas({ days, op, type: "sign_in" });

  assert.equal(avalia(estudou("within", 7), aluno({ lastStudiedAt: daysAgo(2) })), true);
  assert.equal(avalia(estudou("within", 7), aluno({ lastStudiedAt: daysAgo(9) })), false);
  assert.equal(avalia(estudou("not_within", 7), aluno({ lastStudiedAt: daysAgo(9) })), true);
  assert.equal(avalia(estudou("not_within", 7), aluno()), true, "nunca estudou");
  assert.equal(avalia(estudou("within", 7), aluno()), false);

  assert.equal(avalia(entrou("never", 1), aluno()), true);
  assert.equal(avalia(entrou("never", 1), aluno({ lastSignInAt: daysAgo(400) })), false);
  assert.equal(avalia(entrou("within", 30), aluno({ lastSignInAt: daysAgo(3) })), true);
  assert.equal(avalia(entrou("within", 30), aluno()), false);
  assert.equal(avalia(entrou("not_within", 30), aluno({ lastSignInAt: daysAgo(31) })), true);
  assert.equal(avalia(entrou("not_within", 30), aluno()), true);
  assert.equal(avalia(entrou("not_within", 30), aluno({ lastSignInAt: daysAgo(3) })), false);
});

test("ritmo e turma: basta um dos escolhidos", () => {
  assert.equal(avalia(todas({ paces: ["at_risk", "inactive"], type: "pace" }), aluno({ pace: "inactive" })), true);
  assert.equal(avalia(todas({ paces: ["at_risk", "inactive"], type: "pace" }), aluno({ pace: "studying" })), false);
  assert.equal(avalia(todas({ cohortIds: ["t1", "t2"], type: "cohort" }), aluno({ cohortIds: ["t2"] })), true);
  assert.equal(avalia(todas({ cohortIds: ["t1"], type: "cohort" }), aluno({ cohortIds: [] })), false);
});

test("grupos E/OU com um grupo dentro do principal", () => {
  const definition = todas(
    { op: "has", productIds: ["curso-a"], type: "product" },
    { items: [{ count: 0, days: 30, op: "none", type: "comments" }, { paces: ["inactive"], type: "pace" }], match: "any" }
  );
  const comCurso = { accesses: [acesso("curso-a")] };

  assert.equal(avalia(definition, aluno({ ...comCurso, pace: "studying" })), true, "nao comentou em 30 dias");
  assert.equal(avalia(definition, aluno({ ...comCurso, comments: { d7: 1, d30: 1, d90: 1, total: 1 }, pace: "inactive" })), true, "inativo");
  assert.equal(avalia(definition, aluno({ ...comCurso, comments: { d7: 1, d30: 1, d90: 1, total: 1 }, pace: "studying" })), false);
  assert.equal(avalia(definition, aluno({ pace: "inactive" })), false, "sem o curso");

  const qualquer = regras("any", { paces: ["completed"], type: "pace" }, { items: [], match: "any" });
  assert.equal(avalia(qualquer, aluno({ pace: "completed" })), true);
  assert.equal(avalia(qualquer, aluno({ pace: "studying" })), false);
});

/* ------------------------------------------------------------------------------------------------
 * Tamanho e normalizacao
 * ---------------------------------------------------------------------------------------------- */

test("conta regras e profundidade dos grupos", () => {
  const definition = todas({ paces: ["studying"], type: "pace" }, { items: [{ cohortIds: ["t"], type: "cohort" }, { days: 7, op: "within", type: "last_study" }], match: "any" });

  assert.equal(model.countAudienceRules(model.EVERYONE), 0);
  assert.equal(model.countAudienceRules(definition), 3);
  assert.equal(model.audienceDepth(model.EVERYONE), 0);
  assert.equal(model.audienceDepth(todas({ paces: ["studying"], type: "pace" })), 1);
  assert.equal(model.audienceDepth(definition), 2);
});

test("normalizar: ids sem repeticao e em ordem, numeros inteiros nos limites, grupos vazios fora; sem regra vira todos os alunos", () => {
  const normalized = model.normalizeAudience(
    todas(
      { op: "has", productIds: ["b", "a", "b", " a "], type: "product" },
      { op: "gte", percent: 140.4, productId: "  ", type: "progress" },
      { count: 0, days: 7, op: "top", type: "comments" },
      { count: 7, days: 30, op: "none", type: "comments" },
      { days: 0, op: "lt", productId: null, type: "access_age" },
      { days: 99_999, productId: null, type: "access_ending" },
      { days: 2.6, op: "within", type: "last_study" },
      { paces: ["inactive", "studying", "inactive"], type: "pace" },
      { items: [], match: "any" },
      { items: [{ cohortIds: ["t2", "t1", "t2"], type: "cohort" }], match: "any" }
    )
  );

  assert.deepEqual(normalized, {
    kind: "rules",
    root: {
      items: [
        { op: "has", productIds: ["a", "b"], type: "product" },
        { op: "gte", percent: 100, productId: null, type: "progress" },
        { count: 1, days: 7, op: "top", type: "comments" },
        { count: 0, days: 30, op: "none", type: "comments" },
        { days: 1, op: "lt", productId: null, type: "access_age" },
        { days: 3650, productId: null, type: "access_ending" },
        { days: 3, op: "within", type: "last_study" },
        { paces: ["studying", "inactive"], type: "pace" },
        { items: [{ cohortIds: ["t1", "t2"], type: "cohort" }], match: "any" }
      ],
      match: "all"
    }
  });

  assert.deepEqual(model.normalizeAudience(todas({ items: [], match: "any" })), model.EVERYONE);
  assert.deepEqual(model.normalizeAudience(model.EVERYONE), model.EVERYONE);
});

/* ------------------------------------------------------------------------------------------------
 * Frase do segmento
 * ---------------------------------------------------------------------------------------------- */

const nomes = { cohorts: { t1: "Turma Março", t2: "Turma Abril" }, products: { a: "Formação IA", b: "Curso Agentes", c: "Mentoria", d: "Bootcamp" } };
const frase = (...items) => model.describeAudience(todas(...items), nomes);

test("frase do segmento: todos os alunos, produtos (ate 3 por nome) e produto removido", () => {
  assert.equal(model.describeAudience(model.EVERYONE, nomes), "Todos os alunos");
  assert.equal(frase({ op: "has", productIds: ["a"], type: "product" }), "Alunos que têm acesso a Formação IA");
  assert.equal(frase({ op: "has", productIds: ["a", "b"], type: "product" }), "Alunos que têm acesso a Formação IA ou Curso Agentes");
  assert.equal(frase({ op: "has", productIds: ["a", "b", "c"], type: "product" }), "Alunos que têm acesso a Formação IA, Curso Agentes ou Mentoria");
  assert.equal(frase({ op: "has", productIds: ["a", "b", "c", "d"], type: "product" }), "Alunos que têm acesso a Formação IA, Curso Agentes ou mais 2 produtos");
  assert.equal(frase({ op: "has_not", productIds: ["zzz"], type: "product" }), "Alunos que não têm acesso a um produto removido");
});

test("frase do segmento: progresso, comentarios, tempo de acesso e acesso terminando", () => {
  assert.equal(frase({ op: "gte", percent: 50, productId: "a", type: "progress" }), "Alunos que concluíram pelo menos 50% das aulas de Formação IA");
  assert.equal(frase({ op: "lte", percent: 10, productId: null, type: "progress" }), "Alunos que concluíram no máximo 10% das aulas");
  assert.equal(frase({ count: 3, days: 30, op: "gte", type: "comments" }), "Alunos que comentaram pelo menos 3 vezes nos últimos 30 dias");
  assert.equal(frase({ count: 1, days: null, op: "lte", type: "comments" }), "Alunos que comentaram no máximo 1 vez");
  assert.equal(frase({ count: 0, days: 90, op: "none", type: "comments" }), "Alunos que não comentaram nos últimos 90 dias");
  assert.equal(frase({ count: 0, days: null, op: "none", type: "comments" }), "Alunos que não comentaram");
  assert.equal(frase({ count: 100, days: 7, op: "top", type: "comments" }), "Alunos que estão entre os 100 que mais comentaram nos últimos 7 dias");
  assert.equal(frase({ days: 7, op: "lt", productId: "b", type: "access_age" }), "Alunos que ganharam acesso a Curso Agentes há menos de 7 dias");
  assert.equal(frase({ days: 1, op: "gt", productId: null, type: "access_age" }), "Alunos que ganharam acesso há mais de 1 dia");
  assert.equal(frase({ days: 30, productId: null, type: "access_ending" }), "Alunos que têm acesso terminando em até 30 dias");
  assert.equal(frase({ days: 15, productId: "c", type: "access_ending" }), "Alunos que têm acesso a Mentoria terminando em até 15 dias");
});

test("frase do segmento: estudo, entrada, ritmo, turma e grupos com E/OU entre parenteses", () => {
  assert.equal(frase({ days: 14, op: "within", type: "last_study" }), "Alunos que estudaram nos últimos 14 dias");
  assert.equal(frase({ days: 30, op: "not_within", type: "last_study" }), "Alunos que não estudam há 30 dias ou nunca estudaram");
  assert.equal(frase({ days: 1, op: "never", type: "sign_in" }), "Alunos que nunca entraram na plataforma");
  assert.equal(frase({ days: 7, op: "within", type: "sign_in" }), "Alunos que entraram nos últimos 7 dias");
  assert.equal(frase({ days: 60, op: "not_within", type: "sign_in" }), "Alunos que não entram há 60 dias");
  assert.equal(frase({ paces: ["at_risk", "inactive"], type: "pace" }), "Alunos que estão com ritmo em risco ou inativo");
  assert.equal(frase({ cohortIds: ["t1"], type: "cohort" }), "Alunos que estão na turma Turma Março");
  assert.equal(frase({ cohortIds: ["t1", "sumiu"], type: "cohort" }), "Alunos que estão nas turmas Turma Março ou uma turma removida");

  assert.equal(
    frase(
      { op: "has", productIds: ["a"], type: "product" },
      { items: [{ count: 0, days: 30, op: "none", type: "comments" }, { op: "gte", percent: 50, productId: null, type: "progress" }], match: "any" }
    ),
    "Alunos que têm acesso a Formação IA e (não comentaram nos últimos 30 dias ou concluíram pelo menos 50% das aulas)"
  );
  assert.equal(
    model.describeAudience(regras("any", { paces: ["completed"], type: "pace" }, { days: 7, op: "within", type: "sign_in" }), nomes),
    "Alunos que estão com ritmo concluiu ou entraram nos últimos 7 dias"
  );
  assert.equal(
    frase({ items: [{ paces: ["studying"], type: "pace" }], match: "any" }),
    "Alunos que estão com ritmo estudando",
    "grupo de uma regra so nao ganha parenteses"
  );
});

/* ------------------------------------------------------------------------------------------------
 * Segmentos de Alunos -> regras
 * ---------------------------------------------------------------------------------------------- */

test("segmentos salvos de Alunos viram regras (todas); busca por nome e semana do ciclo de vida ficam de fora com aviso", () => {
  assert.deepEqual(model.studentListParamsToAudience({}), { definition: model.EVERYONE, unsupported: [] });
  assert.deepEqual(model.studentListParamsToAudience({ pace: "at_risk" }).definition, todas({ paces: ["at_risk"], type: "pace" }));

  assert.deepEqual(model.studentListParamsToAudience({ cohortId: "t1", expiring: true, productId: "a" }), {
    definition: todas(
      { op: "has", productIds: ["a"], type: "product" },
      { cohortIds: ["t1"], type: "cohort" },
      { days: 30, productId: "a", type: "access_ending" }
    ),
    unsupported: []
  });

  assert.deepEqual(model.studentListParamsToAudience({ account: "never" }).definition, todas({ days: 1, op: "never", type: "sign_in" }));
  assert.deepEqual(
    model.studentListParamsToAudience({ notStarted: true }).definition,
    todas(
      { days: 2, op: "gt", productId: null, type: "access_age" },
      { days: 7, op: "lt", productId: null, type: "access_age" },
      { days: 3650, op: "not_within", type: "last_study" }
    )
  );
  assert.deepEqual(model.studentListParamsToAudience({ commenters: "top" }).definition, todas({ count: 100, days: 30, op: "top", type: "comments" }));

  const parcial = model.studentListParamsToAudience({ group: "new", pace: "studying", q: "ana", week: "2026-10-12" });
  assert.deepEqual(parcial.unsupported, ["busca por nome", "semana do ciclo de vida"]);
  assert.deepEqual(parcial.definition, todas({ paces: ["studying"], type: "pace" }));
  assert.deepEqual(model.studentListParamsToAudience({ q: "ana" }), { definition: model.EVERYONE, unsupported: ["busca por nome"] });
});

/* ------------------------------------------------------------------------------------------------
 * Schema do segmento
 * ---------------------------------------------------------------------------------------------- */

function mensagens(value) {
  const result = audienceDefinitionSchema.safeParse(value);

  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

test("schema do segmento: aceita todos os alunos e regras validas com um grupo dentro do principal", () => {
  assert.deepEqual(mensagens({ kind: "everyone" }), []);
  assert.deepEqual(
    mensagens(
      todas(
        { op: "has", productIds: ["teste-curso-agentes"], type: "product" },
        { items: [{ count: 0, days: null, op: "none", type: "comments" }, { paces: ["inactive"], type: "pace" }], match: "any" }
      )
    ),
    []
  );
});

test("schema do segmento: grupo dentro de grupo dentro de grupo, mais de 20 regras e segmento sem regra sao recusados", () => {
  const regra = { paces: ["studying"], type: "pace" };

  assert.ok(mensagens(todas({ items: [{ items: [regra], match: "all" }], match: "any" })).includes("Grupos dentro de grupos vão só até um nível."));
  assert.ok(mensagens(todas(...Array.from({ length: 21 }, () => regra))).includes("Use no máximo 20 regras."));
  assert.ok(
    mensagens(todas(...Array.from({ length: 11 }, () => regra), { items: Array.from({ length: 10 }, () => regra), match: "any" })).includes("Use no máximo 20 regras."),
    "regras dentro do grupo contam"
  );
  assert.deepEqual(mensagens(todas()), ["Adicione pelo menos uma regra ou escolha todos os alunos."]);
  assert.deepEqual(mensagens(todas({ items: [], match: "any" })), ["Adicione pelo menos uma regra ou escolha todos os alunos."]);
});

test("schema do segmento: cada regra confere os proprios campos", () => {
  assert.ok(mensagens(todas({ op: "has", productIds: [], type: "product" })).includes("Escolha pelo menos um produto."));
  assert.ok(mensagens(todas({ days: 0, op: "within", type: "last_study" })).includes("Use pelo menos 1 dia."));
  assert.ok(mensagens(todas({ days: 4000, op: "within", type: "last_study" })).includes("Use no máximo 3.650 dias."));
  assert.ok(mensagens(todas({ op: "gte", percent: 101, productId: null, type: "progress" })).includes("Use de 0 a 100."));
  assert.ok(mensagens(todas({ cohortIds: ["nao-e-uuid"], type: "cohort" })).includes("Turma inválida."));
  assert.ok(mensagens(todas({ paces: [], type: "pace" })).includes("Escolha pelo menos um ritmo."));
  assert.ok(mensagens(todas({ count: 1, days: 15, op: "gte", type: "comments" })).length > 0, "janela fora de 7, 30, 90 ou desde sempre");
  assert.ok(mensagens(todas({ type: "desconhecida" })).length > 0);
  assert.ok(mensagens({ kind: "algum" }).includes("Escolha para quem vai o aviso."));
});

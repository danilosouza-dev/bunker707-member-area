import assert from "node:assert/strict";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Segmento dos avisos ("Para quem", docs/22 §3): regras combinaveis em grupos E/OU avaliadas sobre os
// fatos de cada aluno, a frase que o produtor le, a conversao dos segmentos salvos de Alunos e os
// limites do schema. Modulos puros (src/server/communications/audience-model.ts e schemas.ts).
//
// v2 (docs/23 §7): as regras "o que fez com a notificacao", "visitou uma pagina" e "ganhou acesso"
// (avaliacao, negacao que exige ter recebido, chaves nao lidas, frases e normalizacao), as pecas do
// construtor (notices-view-model.ts) e o carregador de fatos (audience-facts.ts) sobre um banco em
// memoria: so as linhas dos avisos citados, pedacos de 150 alunos e a mesma conta para todos e para alguns.

const model = await import("../src/server/communications/audience-model.ts");
const { audienceDefinitionSchema, flowRuleDefinitionSchema } = await import("../src/server/communications/schemas.ts");
const builder = await import("../src/components/admin/v2/communication/notices-view-model.ts");
const facts = await import("../src/server/communications/audience-facts.ts");

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

/* ------------------------------------------------------------------------------------------------
 * v2: "O que fez com uma notificação"
 * ---------------------------------------------------------------------------------------------- */

const AVISO = "11111111-1111-4111-8111-111111111111";
const OUTRO_AVISO = "22222222-2222-4222-8222-222222222222";
const PASSO = "33333333-3333-4333-8333-333333333333";
const PASSO_BOTAO = "44444444-4444-4444-8444-444444444444";
const chaveAviso = `campaign:${AVISO}`;

function linha(extra = {}) {
  return {
    audioCompletedAt: null,
    audioStartedAt: null,
    clickedAt: null,
    expiresAt: inDays(80),
    openedAt: null,
    response: null,
    seenAt: null,
    visibleAt: daysAgo(10),
    ...extra
  };
}

const mensagem = (action, negate = false, ref = { campaignId: AVISO, kind: "campaign" }) => ({ action, negate, ref, type: "message" });
const lidas = (...keys) => contexto({ messageKeys: new Set(keys) });
const recebeu = (extra = {}) => aluno({ messages: { [chaveAviso]: linha(extra) } });

test("mensagem: cada acao conta pelo que a linha do sino tem; recebeu = a linha existe", () => {
  const ctx = lidas(chaveAviso);
  const tudo = recebeu({
    audioCompletedAt: daysAgo(8),
    audioStartedAt: daysAgo(9),
    clickedAt: daysAgo(9),
    openedAt: daysAgo(9),
    response: "accepted",
    seenAt: daysAgo(9)
  });
  const nada = recebeu();

  for (const action of model.MESSAGE_ACTIONS) {
    assert.equal(avalia(todas(mensagem(action)), action === "declined" ? recebeu({ response: "declined", seenAt: daysAgo(9) }) : tudo, ctx), true, action);
    assert.equal(avalia(todas(mensagem(action)), nada, ctx), action === "received", `${action} sem nada feito`);
  }

  assert.equal(avalia(todas(mensagem("accepted")), recebeu({ response: "declined" }), ctx), false, "recusou nao e aceitou");
  assert.equal(avalia(todas(mensagem("responded")), recebeu({ response: "declined" }), ctx), true);
  assert.equal(avalia(todas(mensagem("interacted")), recebeu({ audioStartedAt: daysAgo(1) }), ctx), true, "comecar o audio e interagir");
  assert.equal(avalia(todas(mensagem("interacted")), recebeu({ seenAt: daysAgo(1) }), ctx), false, "so ver no sino nao e interagir");
});

test("mensagem negada so vale para quem recebeu: 'não abriram X' nunca inclui quem nem recebeu X", () => {
  const ctx = lidas(chaveAviso);
  const naoAbriu = todas(mensagem("opened", true));

  assert.equal(avalia(naoAbriu, recebeu({ seenAt: daysAgo(2) }), ctx), true, "recebeu e nao abriu");
  assert.equal(avalia(naoAbriu, recebeu({ openedAt: daysAgo(2), seenAt: daysAgo(2) }), ctx), false, "abriu");
  assert.equal(avalia(naoAbriu, aluno(), ctx), false, "nem recebeu");
  assert.equal(avalia(naoAbriu, aluno({ messages: { [`campaign:${OUTRO_AVISO}`]: linha() } }), lidas(chaveAviso, `campaign:${OUTRO_AVISO}`)), false);

  const naoOuviu = todas(mensagem("audio_completed", true));
  assert.equal(avalia(naoOuviu, recebeu({ audioStartedAt: daysAgo(1) }), ctx), true, "comecou e nao terminou");
  assert.equal(avalia(naoOuviu, recebeu({ audioCompletedAt: daysAgo(1), audioStartedAt: daysAgo(1) }), ctx), false);

  // "nao recebeu" e o unico que vale sem a linha.
  assert.equal(avalia(todas(mensagem("received", true)), aluno(), ctx), true);
  assert.equal(avalia(todas(mensagem("received", true)), recebeu(), ctx), false);
});

test("mensagem com chave que nao foi lida nunca combina, negada ou nao; chave lida sem linha = não recebeu", () => {
  for (const negate of [false, true]) {
    for (const action of ["received", "opened", "audio_completed"]) {
      assert.equal(avalia(todas(mensagem(action, negate)), recebeu({ openedAt: daysAgo(1) }), contexto()), false, `${action} ${negate} sem messageKeys`);
      assert.equal(avalia(todas(mensagem(action, negate)), aluno(), lidas(`campaign:${OUTRO_AVISO}`)), false, `${action} ${negate} outra chave`);
    }
  }

  assert.equal(avalia(todas(mensagem("received", true)), aluno(), lidas(chaveAviso)), true, "lida e sem linha: nao recebeu");
  assert.equal(avalia(todas(mensagem("received")), aluno(), lidas(chaveAviso)), false);
});

test("mensagem de um passo do fluxo usa a chave node:<id> (o motor carrega pelo lote)", () => {
  const ref = { kind: "node", nodeId: PASSO };
  const naNotificacao = aluno({ messages: { [`node:${PASSO}`]: linha({ clickedAt: daysAgo(1), openedAt: daysAgo(1), seenAt: daysAgo(1) }) } });

  assert.equal(model.messageRefKey(ref), `node:${PASSO}`);
  assert.equal(avalia(todas(mensagem("clicked", false, ref)), naNotificacao, lidas(`node:${PASSO}`)), true);
  assert.equal(avalia(todas(mensagem("clicked", true, ref)), naNotificacao, lidas(`node:${PASSO}`)), false);
  assert.equal(avalia(todas(mensagem("clicked", false, ref)), naNotificacao, lidas(chaveAviso)), false, "fora de um fluxo a chave do passo nao e lida");
});

test("avisos que o carregador precisa ler: so os das regras com aviso, sem repeticao, em ordem, tambem dentro de grupos", () => {
  const definicao = todas(
    mensagem("opened", true, { campaignId: OUTRO_AVISO, kind: "campaign" }),
    { items: [mensagem("received"), mensagem("clicked", false, { kind: "node", nodeId: PASSO }), mensagem("seen")], match: "any" },
    { op: "has", productIds: ["a"], type: "product" }
  );

  assert.deepEqual(model.collectMessageCampaignIds(definicao), [AVISO, OUTRO_AVISO]);
  assert.deepEqual(model.collectMessageCampaignIds([definicao, todas(mensagem("received")), null, model.EVERYONE]), [AVISO, OUTRO_AVISO]);
  assert.deepEqual(model.collectMessageCampaignIds(todas({ paces: ["inactive"], type: "pace" })), []);
  assert.deepEqual(model.collectMessageCampaignIds(model.EVERYONE), []);
  assert.deepEqual(model.collectMessageCampaignIds(undefined), []);
});

/* ------------------------------------------------------------------------------------------------
 * v2: "Visitou uma página" e "Ganhou acesso a um produto" (so dentro de um fluxo)
 * ---------------------------------------------------------------------------------------------- */

const entrou = daysAgo(5);
const noFluxo = (extra = {}, pageVisits = {}) => aluno({ flow: { enteredAt: entrou, pageVisits }, ...extra });
const visitou = (page, negate = false, since = { kind: "entered" }) => ({ negate, page, since, type: "page_visit" });
const ganhou = (productIds, negate = false, since = { kind: "entered" }) => ({ negate, productIds, since, type: "access_gained" });
const ctxFluxo = (extra = {}) => contexto({ flow: { ctaPageKeys: { [PASSO_BOTAO]: "content:curso-a", [PASSO]: null } }, messageKeys: new Set([`node:${PASSO}`]), ...extra });

test("visitou uma pagina desde que entrou no fluxo usa facts.flow.enteredAt", () => {
  const pagina = { kind: "content", productId: "curso-a" };

  assert.equal(avalia(todas(visitou(pagina)), noFluxo({}, { "content:curso-a": daysAgo(1) }), ctxFluxo()), true);
  assert.equal(avalia(todas(visitou(pagina)), noFluxo({}, { "content:curso-a": daysAgo(6) }), ctxFluxo()), false, "visita antes de entrar");
  assert.equal(avalia(todas(visitou(pagina)), noFluxo({}, { "content:curso-a": entrou }), ctxFluxo()), true, "no mesmo instante conta");
  assert.equal(avalia(todas(visitou(pagina, true)), noFluxo({}, { "content:curso-a": daysAgo(6) }), ctxFluxo()), true, "nao visitou depois de entrar");
  assert.equal(avalia(todas(visitou({ kind: "checkout", productId: "curso-a" })), noFluxo({}, { "checkout:curso-a": daysAgo(1) }), ctxFluxo()), true);
  assert.equal(avalia(todas(visitou({ kind: "checkout", productId: "curso-a" })), noFluxo({}, { "content:curso-a": daysAgo(1) }), ctxFluxo()), false, "ver a pagina nao e clicar em Comprar");
  assert.equal(avalia(todas(visitou({ key: "purchases", kind: "fixed" })), noFluxo({}, { purchases: daysAgo(1) }), ctxFluxo()), true);
});

test("visitou depois de receber uma notificacao: o marco e quando ela apareceu no sino; sem ela, nao combina nem negada", () => {
  const depois = { kind: "message", nodeId: PASSO };
  const pagina = { key: "home", kind: "fixed" };
  const comNotificacao = (visitas) => noFluxo({ messages: { [`node:${PASSO}`]: linha({ visibleAt: daysAgo(2) }) } }, visitas);

  assert.equal(avalia(todas(visitou(pagina, false, depois)), comNotificacao({ home: daysAgo(1) }), ctxFluxo()), true);
  assert.equal(avalia(todas(visitou(pagina, false, depois)), comNotificacao({ home: daysAgo(3) }), ctxFluxo()), false);
  assert.equal(avalia(todas(visitou(pagina, true, depois)), comNotificacao({ home: daysAgo(3) }), ctxFluxo()), true);
  assert.equal(avalia(todas(visitou(pagina, false, depois)), noFluxo({}, { home: daysAgo(1) }), ctxFluxo()), false, "nao recebeu a notificacao");
  assert.equal(avalia(todas(visitou(pagina, true, depois)), noFluxo({}, {}), ctxFluxo()), false, "nao recebeu: negada tambem nao");
});

test("pagina do botao: a chave vem do passo; botao externo ou nao acompanhado conta como nunca visitado", () => {
  const doBotao = (nodeId) => ({ kind: "message_cta", nodeId });

  assert.equal(avalia(todas(visitou(doBotao(PASSO_BOTAO))), noFluxo({}, { "content:curso-a": daysAgo(1) }), ctxFluxo()), true);
  assert.equal(avalia(todas(visitou(doBotao(PASSO))), noFluxo({}, { "content:curso-a": daysAgo(1) }), ctxFluxo()), false, "botao externo");
  assert.equal(avalia(todas(visitou(doBotao(PASSO), true)), noFluxo({}, {}), ctxFluxo()), true, "externo: nunca visitou");
  assert.equal(avalia(todas(visitou(doBotao(PASSO_BOTAO))), noFluxo({}, { "content:curso-a": daysAgo(1) }), contexto()), false, "sem o contexto do fluxo");
});

test("ganhou acesso desde que entrou: acesso aberto ao produto (ou a plataforma) com gainedAt depois do marco", () => {
  const regra = todas(ganhou(["curso-a", "curso-b"]));
  const comAcesso = (productId, gainedAt) => noFluxo({ accesses: [{ ...acesso(productId, daysAgo(30)), gainedAt }] });

  assert.equal(avalia(regra, comAcesso("curso-b", daysAgo(1)), ctxFluxo()), true);
  assert.equal(avalia(regra, comAcesso("curso-b", daysAgo(10)), ctxFluxo()), false, "ja tinha antes de entrar");
  assert.equal(avalia(regra, comAcesso("platform", daysAgo(1)), ctxFluxo()), true, "a plataforma abre o produto");
  assert.equal(avalia(regra, comAcesso("curso-c", daysAgo(1)), ctxFluxo()), false);
  assert.equal(avalia(todas(ganhou(["curso-a"], true)), comAcesso("curso-a", daysAgo(10)), ctxFluxo()), true, "nao ganhou depois de entrar");
  assert.equal(avalia(todas(ganhou(["curso-a"])), noFluxo({ accesses: [acesso("curso-a", daysAgo(1))] }), ctxFluxo()), true, "sem gainedAt usa o inicio");

  const depois = { kind: "message", nodeId: PASSO };
  const recebeuEGanhou = noFluxo({ accesses: [{ ...acesso("curso-a"), gainedAt: daysAgo(1) }], messages: { [`node:${PASSO}`]: linha({ visibleAt: daysAgo(2) }) } });
  assert.equal(avalia(todas(ganhou(["curso-a"], false, depois)), recebeuEGanhou, ctxFluxo()), true);
  assert.equal(avalia(todas(ganhou(["curso-a"], true, depois)), noFluxo({}), ctxFluxo()), false, "sem a notificacao, nem negada");
});

test("regras de fluxo sem facts.flow nunca combinam, negadas ou nao", () => {
  const foraDoFluxo = aluno({ accesses: [{ ...acesso("curso-a"), gainedAt: daysAgo(1) }] });

  for (const negate of [false, true]) {
    assert.equal(avalia(todas(visitou({ key: "home", kind: "fixed" }, negate)), foraDoFluxo, ctxFluxo()), false, `visita ${negate}`);
    assert.equal(avalia(todas(ganhou(["curso-a"], negate)), foraDoFluxo, ctxFluxo()), false, `acesso ${negate}`);
  }
});

test("gainedAt = greatest(created_at, starts_at): importacao com inicio no passado conta de quando foi criada", () => {
  const rows = [
    { created_at: "2026-10-19T12:00:00.000Z", ends_at: null, starts_at: "2026-01-01T00:00:00.000Z", status: "active", target_id: "curso-a", target_type: "content", user_id: "u" },
    { created_at: "2026-09-01T00:00:00.000Z", ends_at: null, starts_at: "2026-10-01T00:00:00.000Z", status: "active", target_id: "x", target_type: "platform", user_id: "u" }
  ];

  assert.deepEqual(facts.accessFactsOf(rows), [
    { endsAt: null, gainedAt: Date.parse("2026-10-19T12:00:00.000Z"), productId: "curso-a", startsAt: Date.parse("2026-01-01T00:00:00.000Z") },
    { endsAt: null, gainedAt: Date.parse("2026-10-01T00:00:00.000Z"), productId: "platform", startsAt: Date.parse("2026-10-01T00:00:00.000Z") }
  ]);
  assert.equal(facts.openAccessRows([...rows, { ...rows[0], status: "revoked" }, { ...rows[0], starts_at: "2026-12-01T00:00:00.000Z" }], now).length, 2, "so os abertos agora");
});

/* ------------------------------------------------------------------------------------------------
 * v2: normalizacao, contagem, frases e schema
 * ---------------------------------------------------------------------------------------------- */

test("normalizar as regras v2: ids sem repeticao e em ordem, negate booleano e acao, pagina ou marco desconhecido fora", () => {
  const normalized = model.normalizeAudience(
    todas(
      { action: "opened", negate: 1, ref: { campaignId: ` ${AVISO} `, kind: "campaign" }, type: "message" },
      { action: "ignorou", negate: true, ref: { campaignId: AVISO, kind: "campaign" }, type: "message" },
      { action: "clicked", ref: { kind: "node", nodeId: PASSO }, type: "message" },
      { negate: false, page: { kind: "checkout", productId: " curso-a " }, since: { kind: "entered" }, type: "page_visit" },
      { negate: false, page: { key: "cozinha", kind: "fixed" }, since: { kind: "entered" }, type: "page_visit" },
      { negate: true, productIds: ["b", "a", "b"], since: { kind: "message", nodeId: PASSO }, type: "access_gained" },
      { negate: true, productIds: ["a"], since: { kind: "ontem" }, type: "access_gained" }
    )
  );

  assert.deepEqual(normalized.root.items, [
    { action: "opened", negate: false, ref: { campaignId: AVISO, kind: "campaign" }, type: "message" },
    { action: "clicked", negate: false, ref: { kind: "node", nodeId: PASSO }, type: "message" },
    { negate: false, page: { kind: "checkout", productId: "curso-a" }, since: { kind: "entered" }, type: "page_visit" },
    { negate: true, productIds: ["a", "b"], since: { kind: "message", nodeId: PASSO }, type: "access_gained" }
  ]);
  assert.deepEqual(model.normalizeAudience(todas({ action: "ignorou", negate: false, ref: { campaignId: AVISO, kind: "campaign" }, type: "message" })), model.EVERYONE);
});

test("as regras v2 contam no limite de 20 e na profundidade como as outras", () => {
  const definicao = todas(mensagem("opened"), { items: [visitou({ key: "home", kind: "fixed" }), ganhou(["a"])], match: "any" });

  assert.equal(model.countAudienceRules(definicao), 3);
  assert.equal(model.audienceDepth(definicao), 2);
  assert.ok(model.AUDIENCE_RULE_TYPES.includes("message") && model.AUDIENCE_RULE_TYPES.includes("page_visit") && model.AUDIENCE_RULE_TYPES.includes("access_gained"));
});

const nomesV2 = {
  ...nomes,
  messages: { [chaveAviso]: "Oferta especial!", [`node:${PASSO}`]: "Boas-vindas!", [`node:${PASSO_BOTAO}`]: "Veja a condição" }
};
const fraseV2 = (...items) => model.describeAudience(todas(...items), nomesV2);

test("frase da regra de notificacao: cada acao, no plural, com e sem 'não'", () => {
  const esperado = {
    accepted: "aceitaram a notificação “Oferta especial!”",
    audio_completed: "ouviram até o fim o áudio da notificação “Oferta especial!”",
    audio_started: "começaram a ouvir o áudio da notificação “Oferta especial!”",
    clicked: "clicaram no botão da notificação “Oferta especial!”",
    declined: "recusaram a notificação “Oferta especial!”",
    interacted: "interagiram com a notificação “Oferta especial!”",
    opened: "abriram a notificação “Oferta especial!”",
    received: "receberam a notificação “Oferta especial!”",
    responded: "responderam a notificação “Oferta especial!”",
    seen: "viram a notificação “Oferta especial!” no sino"
  };

  for (const action of model.MESSAGE_ACTIONS) {
    assert.equal(fraseV2(mensagem(action)), `Alunos que ${esperado[action]}`, action);
    assert.equal(fraseV2(mensagem(action, true)), `Alunos que não ${esperado[action]}`, `${action} negada`);
  }

  assert.equal(fraseV2(mensagem("opened", true, { kind: "node", nodeId: PASSO })), "Alunos que não abriram a notificação “Boas-vindas!”");
  assert.equal(model.describeAudience(todas(mensagem("received")), nomes), "Alunos que receberam uma notificação removida", "sem o titulo");
  assert.equal(model.describeAudience(todas(mensagem("audio_completed", true)), nomes), "Alunos que não ouviram até o fim o áudio de uma notificação removida");
  assert.equal(model.describeAudience(todas(mensagem("interacted")), nomes), "Alunos que interagiram com uma notificação removida");
});

test("frase de pagina visitada e de acesso ganho: o marco, Comprar e as paginas fixas com o artigo", () => {
  const depois = { kind: "message", nodeId: PASSO };

  assert.equal(fraseV2(visitou({ kind: "content", productId: "a" })), "Alunos que visitaram a página de Formação IA desde que entraram no fluxo");
  assert.equal(fraseV2(visitou({ kind: "content", productId: "a" }, true, depois)), "Alunos que não visitaram a página de Formação IA depois de receber a notificação “Boas-vindas!”");
  assert.equal(fraseV2(visitou({ kind: "checkout", productId: "a" })), "Alunos que clicaram em Comprar de Formação IA desde que entraram no fluxo");
  assert.equal(fraseV2(visitou({ kind: "checkout", productId: "a" }, true)), "Alunos que não clicaram em Comprar de Formação IA desde que entraram no fluxo");
  assert.equal(fraseV2(visitou({ kind: "message_cta", nodeId: PASSO_BOTAO })), "Alunos que visitaram a página do botão da notificação “Veja a condição” desde que entraram no fluxo");

  const fixas = {
    continue: "Continue assistindo",
    home: "o Início",
    journey: "Minha jornada",
    materials: "Materiais",
    profile: "o Perfil",
    purchases: "Minhas compras",
    saved: "Favoritos",
    support: "o Suporte"
  };

  for (const [key, texto] of Object.entries(fixas)) {
    assert.equal(fraseV2(visitou({ key, kind: "fixed" })), `Alunos que visitaram ${texto} desde que entraram no fluxo`);
  }

  assert.equal(fraseV2(ganhou(["a"])), "Alunos que ganharam acesso a Formação IA desde que entraram no fluxo");
  assert.equal(fraseV2(ganhou(["a", "b"], true, depois)), "Alunos que não ganharam acesso a Formação IA ou Curso Agentes depois de receber a notificação “Boas-vindas!”");
  assert.equal(model.describeAudience(todas(ganhou(["a"], false, { kind: "message", nodeId: "sumiu" })), nomes), "Alunos que ganharam acesso a Formação IA depois de receber uma notificação removida");
});

test("schema do segmento aceita a regra de notificacao com aviso e recusa as que so valem num fluxo", () => {
  assert.deepEqual(mensagens(todas(mensagem("audio_completed", true))), []);
  assert.equal(audienceDefinitionSchema.parse(todas({ action: "opened", ref: { campaignId: AVISO, kind: "campaign" }, type: "message" })).root.items[0].negate, false);

  const soNoFluxo = [
    mensagem("opened", false, { kind: "node", nodeId: PASSO }),
    visitou({ key: "home", kind: "fixed" }),
    ganhou(["teste-curso"])
  ];

  for (const regra of soNoFluxo) {
    assert.deepEqual(mensagens(todas(regra)), ["Esta regra só vale dentro de um fluxo."], regra.type);
    assert.equal(flowRuleDefinitionSchema.safeParse(todas(regra)).success, true, `${regra.type} vale no fluxo`);
  }

  assert.deepEqual(mensagens(todas({ items: [visitou({ key: "home", kind: "fixed" })], match: "any" })), ["Esta regra só vale dentro de um fluxo."], "tambem dentro de um grupo");
  assert.ok(mensagens(todas(mensagem("opened", false, { campaignId: "", kind: "campaign" }))).includes("Escolha a notificação."), "notificacao por escolher");
  assert.ok(mensagens(todas({ action: "ignorou", negate: false, ref: { campaignId: AVISO, kind: "campaign" }, type: "message" })).length > 0);
});

/* ------------------------------------------------------------------------------------------------
 * v2: pecas do construtor (notices-view-model.ts, bloco do segmento)
 * ---------------------------------------------------------------------------------------------- */

test("construtor: o seletor do segmento ganha so a regra de notificacao; o do fluxo, as tres", () => {
  assert.deepEqual(builder.audienceRuleTypesFor("segment"), [...builder.AUDIENCE_RULE_ORDER, "message"]);
  assert.deepEqual(builder.audienceRuleTypesFor("flow"), [...builder.AUDIENCE_RULE_ORDER, "message", "page_visit", "access_gained"]);
  assert.equal(builder.isAudienceRuleTypeAllowed("page_visit", "segment"), false);
  assert.equal(builder.isAudienceRuleTypeAllowed("page_visit", "flow"), true);
  assert.equal(builder.AUDIENCE_RULE_LABELS.message, "O que fez com uma notificação");
  assert.equal(builder.AUDIENCE_RULE_LABELS.page_visit, "Visitou uma página");
  assert.equal(builder.AUDIENCE_RULE_LABELS.access_gained, "Ganhou acesso a um produto");
  assert.equal(builder.removeAudienceRuleLabel("message"), "Remover regra: O que fez com uma notificação");
  assert.equal(builder.removeAudienceRuleLabel("access_gained"), "Remover regra: Ganhou acesso a um produto");
});

test("construtor: regra nova de cada tipo v2 (a notificacao dada ja vem escolhida; sem ela, fica para escolher)", () => {
  const ref = { campaignId: AVISO, kind: "campaign" };

  assert.deepEqual(builder.defaultAudienceRule("message", { messageRef: ref }), { action: "opened", negate: false, ref, type: "message" });
  assert.deepEqual(builder.defaultAudienceRule("message").ref, { campaignId: "", kind: "campaign" });
  assert.deepEqual(builder.defaultAudienceRule("message", { mode: "flow" }).ref, { kind: "node", nodeId: "" });
  assert.equal(audienceDefinitionSchema.safeParse(todas(builder.defaultAudienceRule("message", { messageRef: ref }))).success, true);
  assert.equal(audienceDefinitionSchema.safeParse(todas(builder.defaultAudienceRule("message"))).success, false, "falta escolher a notificacao");
  assert.equal(flowRuleDefinitionSchema.safeParse(todas(builder.defaultAudienceRule("page_visit"))).success, true, "visita ja nasce valida");
  assert.deepEqual(builder.defaultAudienceRule("access_gained"), { negate: false, productIds: [], since: { kind: "entered" }, type: "access_gained" });
});

test("construtor: acoes oferecidas conforme a notificacao (audio, botao, resposta); a escolhida continua na lista", () => {
  const simples = { hasAudio: false, hasCta: false, hasResponse: false };

  assert.deepEqual(builder.messageActionsFor(simples), ["received", "seen", "opened", "interacted"]);
  assert.deepEqual(builder.messageActionsFor({ ...simples, hasAudio: true }), ["received", "seen", "opened", "audio_started", "audio_completed", "interacted"]);
  assert.deepEqual(builder.messageActionsFor({ ...simples, hasCta: true }), ["received", "seen", "opened", "clicked", "interacted"]);
  assert.deepEqual(builder.messageActionsFor({ ...simples, hasResponse: true }), ["received", "seen", "opened", "accepted", "declined", "responded", "interacted"]);
  assert.deepEqual(builder.messageActionsFor(simples, "clicked"), ["received", "seen", "opened", "clicked", "interacted"], "acao ja salva");
  assert.deepEqual(builder.messageActionsFor(null), ["received", "seen", "opened", "interacted"]);
  assert.deepEqual(builder.messageActionsFor({ ...simples, canOpen: false }), ["received", "seen"], "aviso curto so de texto: nada a abrir");
  assert.deepEqual(builder.messageActionsFor({ ...simples, canOpen: false }, "opened"), ["received", "seen", "opened"]);
  assert.equal(builder.MESSAGE_ACTION_LABELS.audio_completed, "ouviu o áudio até o fim");
  assert.equal(builder.MESSAGE_ACTION_LABELS.seen, "viu no sino");
});

test("construtor: seletor de notificacao com titulo e dia do envio; no fluxo, os passos acima e depois os avisos", () => {
  const avisos = [{ hasAudio: true, hasCta: false, hasResponse: false, id: AVISO, sentAt: "2026-10-21T02:30:00.000Z", title: "Oferta especial!" }];
  const segmento = builder.audienceMessageOptions("segment", { notices: avisos });

  // 02:30 UTC de 21/10 = 23:30 de 20/10 em Sao Paulo.
  assert.equal(builder.noticeChoiceLabel(avisos[0]), "Oferta especial! · 20/10");
  assert.deepEqual(segmento, [
    { canOpen: true, ctaPageKey: null, hasAudio: true, hasCta: false, hasResponse: false, key: chaveAviso, label: "Oferta especial! · 20/10", ref: { campaignId: AVISO, kind: "campaign" }, title: "Oferta especial!" }
  ]);
  assert.deepEqual(builder.audienceMessageOptions("segment", { flowContext: { messages: [{ ctaPageKey: null, hasAudio: false, hasCta: false, hasResponse: false, nodeId: PASSO, title: "x" }] } }), [], "no segmento nao ha passos");

  const fluxo = builder.audienceMessageOptions("flow", {
    flowContext: {
      messages: [
        { ctaPageKey: null, hasAudio: false, hasCta: false, hasResponse: false, nodeId: PASSO, title: "Boas-vindas!" },
        { ctaPageKey: "content:curso-a", hasAudio: false, hasCta: true, hasResponse: false, nodeId: PASSO_BOTAO, title: "Veja a condição" }
      ]
    },
    notices: avisos
  });

  assert.deepEqual(fluxo.map((option) => option.key), [`node:${PASSO}`, `node:${PASSO_BOTAO}`, chaveAviso]);
  assert.equal(builder.audienceMessageOptions("segment", { notices: [{ ...avisos[0], canOpen: false }] })[0].canOpen, false);
  assert.deepEqual(builder.pageButtonOptions(fluxo).map((option) => option.key), [`node:${PASSO_BOTAO}`], "so botao com pagina acompanhada");
  assert.equal(builder.NO_SENT_NOTICES_MESSAGE, "Nenhuma notificação enviada nos últimos 90 dias.");
  assert.equal(builder.MESSAGE_RULE_SEGMENT_HINT, "Só conta quem recebeu a notificação.");

  const comTitulos = builder.audienceNamesWithMessages(nomes, fluxo);
  assert.equal(model.describeAudience(todas(mensagem("opened", true)), comTitulos), "Alunos que não abriram a notificação “Oferta especial!”");
  assert.equal(builder.audienceNamesWithMessages(nomes, []), nomes);
});

test("construtor: trocar a pagina da visita mantem o produto e escolhe o primeiro botao acompanhado", () => {
  const opcoes = builder.audienceMessageOptions("flow", {
    flowContext: { messages: [{ ctaPageKey: "content:curso-a", hasAudio: false, hasCta: true, hasResponse: false, nodeId: PASSO_BOTAO, title: "Veja" }] }
  });
  const conteudo = { kind: "content", productId: "curso-a" };

  assert.equal(builder.pageTargetChoiceOf(conteudo), "content");
  assert.equal(builder.pageTargetChoiceOf({ key: "saved", kind: "fixed" }), "fixed:saved");
  assert.deepEqual(builder.pageTargetOfChoice("checkout", conteudo, opcoes), { kind: "checkout", productId: "curso-a" });
  assert.deepEqual(builder.pageTargetOfChoice("fixed:support", conteudo, opcoes), { key: "support", kind: "fixed" });
  assert.deepEqual(builder.pageTargetOfChoice("message_cta", conteudo, opcoes), { kind: "message_cta", nodeId: PASSO_BOTAO });
  assert.deepEqual(builder.pageTargetOfChoice("content", { key: "home", kind: "fixed" }, opcoes), { kind: "content", productId: "" });
  assert.deepEqual(builder.PAGE_TARGET_CHOICES.map((choice) => choice.label), [
    "a página do botão da notificação…",
    "a página de um produto",
    "Comprar de um produto",
    "Início",
    "Minhas compras",
    "Favoritos",
    "Materiais",
    "Minha jornada",
    "Continue assistindo",
    "Perfil",
    "Suporte"
  ]);
});

/* ------------------------------------------------------------------------------------------------
 * v2: carregador de fatos (audience-facts.ts) sobre um banco em memoria
 * ---------------------------------------------------------------------------------------------- */

/**
 * Banco em memoria com o que o carregador usa: select, eq, in, is, gt, gte, order, range, limit e
 * maybeSingle filtram e ordenam de verdade; `count: "exact"` devolve o total. Anota cada consulta (tabela
 * e o tamanho de cada lista do `in`) para conferir os pedacos.
 */
function memoryDb(tables, rpcs = {}) {
  const log = [];

  function query(source, rows) {
    const state = { count: false, filters: [], ins: [], limit: Infinity, order: [], range: null };
    const run = () => {
      let result = rows.filter((row) => state.filters.every((keep) => keep(row)));

      for (const [column, ascending] of [...state.order].reverse()) {
        result = [...result].sort((left, right) => (left[column] < right[column] ? -1 : left[column] > right[column] ? 1 : 0) * (ascending ? 1 : -1));
      }

      const total = result.length;

      if (state.range) {
        result = result.slice(state.range[0], state.range[1] + 1);
      }

      result = result.slice(0, Math.min(state.limit, 1000));
      log.push({ ins: state.ins, source });

      return { count: state.count ? total : null, data: result, error: null };
    };
    const api = {
      eq: (column, value) => (state.filters.push((row) => row[column] === value), api),
      gt: (column, value) => (state.filters.push((row) => row[column] > value), api),
      gte: (column, value) => (state.filters.push((row) => row[column] >= value), api),
      in: (column, values) => (state.ins.push({ column, size: values.length }), state.filters.push((row) => values.includes(row[column])), api),
      is: (column, value) => (state.filters.push((row) => (row[column] ?? null) === value), api),
      limit: (value) => ((state.limit = value), api),
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      order: (column, options) => (state.order.push([column, options?.ascending !== false]), api),
      range: (from, to) => ((state.range = [from, to]), api),
      select: (_columns, options) => ((state.count = options?.count === "exact"), api),
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject)
    };

    return api;
  }

  return { from: (table) => query(table, tables[table] ?? []), log, rpc: (name) => query(`rpc:${name}`, rpcs[name] ?? []) };
}

const iso = (ms) => new Date(ms).toISOString();
const uid = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

function escola(total) {
  const profiles = [];
  const entitlements = [];
  const progress = [];

  for (let index = 1; index <= total; index += 1) {
    profiles.push({ avatar_url: null, created_at: iso(daysAgo(200)), email: null, full_name: `Aluno ${index}`, id: uid(index), last_sign_in_at: iso(daysAgo(index % 30)), phone: null });
    entitlements.push({
      created_at: iso(daysAgo(index % 2 ? 1 : 40)),
      ends_at: null,
      id: `e${index}`,
      starts_at: iso(daysAgo(40)),
      status: "active",
      target_id: "curso-a",
      target_type: "content",
      user_id: uid(index)
    });

    if (index % 3 === 0) {
      progress.push({ completed_lesson_ids: ["l1"], content_id: "curso-a", id: `p${index}`, updated_at: iso(daysAgo(2)), user_id: uid(index) });
    }
  }

  return {
    admin_roles: [{ user_id: uid(2) }],
    cohort_memberships: [{ cohort_id: "t1", id: "m1", product_id: "curso-a", user_id: uid(3) }],
    course_modules: [{ id: "mod-1", owner_id: "curso-a", status: "published" }],
    entitlements,
    lesson_progress: progress,
    lessons: [
      { id: "l1", module_id: "mod-1", status: "published" },
      { id: "l2", module_id: "mod-1", status: "published" }
    ],
    profiles
  };
}

function linhaDoSino(index, userIndex, campaignId, extra = {}) {
  return {
    audio_completed_at: null,
    audio_started_at: null,
    campaign_id: campaignId,
    clicked_at: null,
    created_at: iso(daysAgo(3)),
    expires_at: iso(inDays(87)),
    id: `aaaaaaaa-0000-4000-8000-${String(index).padStart(12, "0")}`,
    is_test: false,
    opened_at: null,
    response: null,
    seen_at: null,
    user_id: uid(userIndex),
    ...extra
  };
}

test("carregador: le so as linhas dos avisos pedidos (enviados, fora os testes), em paginas por id, e marca as chaves lidas", async () => {
  const tables = escola(3);
  const rows = Array.from({ length: 1_205 }, (_, index) => linhaDoSino(index + 10, 1, AVISO));

  rows.push(linhaDoSino(1, 3, AVISO, { audio_completed_at: iso(daysAgo(1)), audio_started_at: iso(daysAgo(2)), opened_at: iso(daysAgo(2)), seen_at: iso(daysAgo(2)) }));
  rows.push(linhaDoSino(2, 3, AVISO, { is_test: true }));
  rows.push(linhaDoSino(3, 1, OUTRO_AVISO));
  const db = memoryDb({
    ...tables,
    campaigns: [
      { deleted_at: null, id: AVISO, sent_at: iso(daysAgo(2)), status: "sent" },
      { deleted_at: null, id: OUTRO_AVISO, sent_at: null, status: "canceled" }
    ],
    notifications: rows
  });

  const loaded = await facts.loadAudienceFacts(db, now, { messageCampaignIds: [OUTRO_AVISO, AVISO, AVISO, "nao-e-uuid"] });
  const porAluno = new Map(loaded.facts.map((fact) => [fact.userId, fact]));

  assert.deepEqual([...loaded.context.messageKeys].sort(), [chaveAviso, `campaign:${OUTRO_AVISO}`].sort(), "as duas chaves foram lidas");
  assert.equal(porAluno.has(uid(2)), false, "a equipe fica de fora");
  assert.deepEqual(porAluno.get(uid(3)).messages[chaveAviso], {
    audioCompletedAt: daysAgo(1),
    audioStartedAt: daysAgo(2),
    clickedAt: null,
    expiresAt: inDays(87),
    openedAt: daysAgo(2),
    response: null,
    seenAt: daysAgo(2),
    visibleAt: daysAgo(2)
  }, "visibleAt = greatest(created_at, sent_at)");
  assert.equal(porAluno.get(uid(1)).messages[chaveAviso].visibleAt, daysAgo(2));
  assert.equal(porAluno.get(uid(1)).messages[`campaign:${OUTRO_AVISO}`], undefined, "aviso cancelado nao conta");
  assert.ok(db.log.filter((entry) => entry.source === "notifications").length >= 2, "mais de 1.000 linhas: mais de uma pagina");

  const naoOuviram = todas(mensagem("audio_completed", true));
  const ids = loaded.facts.filter((fact) => model.evaluateAudience(naoOuviram, fact, loaded.context)).map((fact) => fact.userId);
  assert.deepEqual(ids, [uid(1)], "so quem recebeu e nao ouviu ate o fim");

  const semRegra = await facts.loadAudienceFacts(memoryDb({ ...tables, notifications: rows }), now);
  assert.equal(semRegra.context.messageKeys.size, 0);
  assert.equal(semRegra.facts.some((fact) => fact.messages), false, "sem aviso pedido, nada extra");
});

test("carregador por alunos: pedacos de 150, a mesma conta de loadAudienceFacts, sem a equipe e com o ranking entre todos", async () => {
  const tables = escola(320);
  const comments = [
    { author_id: uid(2), comments_7d: 50, comments_30d: 50, comments_90d: 50, comments_total: 50 },
    { author_id: uid(300), comments_7d: 9, comments_30d: 9, comments_90d: 9, comments_total: 9 },
    { author_id: uid(5), comments_7d: 1, comments_30d: 1, comments_90d: 1, comments_total: 1 }
  ];
  const db = memoryDb(tables, { communication_comment_counts: comments });
  const userIds = Array.from({ length: 320 }, (_, index) => uid(index + 1));
  const todos = await facts.loadAudienceFacts(memoryDb(tables, { communication_comment_counts: comments }), now);
  const alguns = await facts.loadAudienceFactsFor(db, [...userIds, uid(999), uid(1)], now);

  for (const entry of db.log) {
    for (const filter of entry.ins) {
      assert.ok(filter.size <= 150, `${entry.source}.${filter.column} com ${filter.size} ids`);
    }
  }

  assert.ok(db.log.some((entry) => entry.source === "profiles" && entry.ins.some((filter) => filter.column === "id")), "perfis pelos ids");
  assert.ok(db.log.some((entry) => entry.source === "lesson_progress" && entry.ins.some((filter) => filter.column === "user_id")), "progresso pelos ids");
  assert.equal(alguns.facts.length, 319, "sem a equipe e sem quem nao tem perfil");
  assert.deepEqual(
    [...alguns.facts].sort((left, right) => (left.userId < right.userId ? -1 : 1)),
    [...todos.facts].sort((left, right) => (left.userId < right.userId ? -1 : 1)),
    "mesmos fatos"
  );
  assert.equal(alguns.facts.find((fact) => fact.userId === uid(1)).accesses[0].gainedAt, daysAgo(1), "gainedAt pelo created_at");
  assert.deepEqual([...alguns.context.commentRanks["7"]], [[uid(300), 1], [uid(5), 2]], "ranking sem a equipe");
  assert.deepEqual(alguns.context.lessonTotals, { "curso-a": 2 });

  const poucos = await facts.loadAudienceFactsFor(memoryDb(tables, { communication_comment_counts: comments }), [uid(5)], now, { comments: "none" });
  assert.deepEqual(poucos.facts[0].comments, { d7: 0, d30: 0, d90: 0, total: 0 }, "sem comentarios pedidos");
  assert.equal(poucos.context.commentRanks["7"].size, 0);
});

test("carregador por alunos: acessos do lote, indice do tick e equipe dados nao sao relidos; linhas dos avisos so destes alunos", async () => {
  const tables = escola(4);
  const db = memoryDb({
    ...tables,
    campaigns: [{ deleted_at: null, id: AVISO, sent_at: iso(daysAgo(3)), status: "sent" }],
    notifications: [linhaDoSino(1, 1, AVISO), linhaDoSino(2, 4, AVISO, { clicked_at: iso(daysAgo(1)), opened_at: iso(daysAgo(1)), seen_at: iso(daysAgo(1)) })]
  });
  const loaded = await facts.loadAudienceFactsFor(db, [uid(4), uid(3)], now, {
    comments: "none",
    entitlements: [{ created_at: iso(daysAgo(1)), ends_at: null, starts_at: iso(daysAgo(1)), status: "active", target_id: "curso-b", target_type: "content", user_id: uid(4) }],
    lessonIndex: new Map([["curso-b", new Set(["x"])]]),
    messageCampaignIds: [AVISO],
    staff: new Set()
  });
  const lidas = new Set(db.log.map((entry) => entry.source));

  for (const table of ["entitlements", "admin_roles", "course_modules", "lessons", "rpc:communication_comment_counts"]) {
    assert.equal(lidas.has(table), false, `${table} nao foi lido`);
  }

  const quatro = loaded.facts.find((fact) => fact.userId === uid(4));
  assert.deepEqual(quatro.accesses.map((access) => access.productId), ["curso-b"]);
  assert.equal(quatro.totalLessons, 1);
  assert.equal(quatro.messages[chaveAviso].clickedAt, daysAgo(1));
  assert.equal(loaded.facts.find((fact) => fact.userId === uid(3)).messages, undefined, "sem linha: nao recebeu");
  assert.deepEqual([...loaded.context.messageKeys], [chaveAviso]);
  assert.ok(db.log.some((entry) => entry.source === "notifications" && entry.ins.some((filter) => filter.column === "user_id" && filter.size === 2)), "linhas pelos ids");

  const vazio = await facts.loadAudienceFactsFor(memoryDb(tables), [], now);
  assert.deepEqual(vazio.facts, []);
});

test("juntar as linhas dos avisos aos fatos ja montados acrescenta as chaves sem perder as anteriores", () => {
  const base = { context: contexto({ messageKeys: new Set(["node:x"]) }), facts: [aluno({ messages: { "node:x": linha() } }), aluno({ userId: "aluno-2" })], people: new Map() };
  const merged = facts.attachMessageFacts(base, [AVISO], new Map([["aluno-1", { [chaveAviso]: linha({ openedAt: daysAgo(1) }) }]]));

  assert.deepEqual([...merged.context.messageKeys].sort(), [chaveAviso, "node:x"]);
  assert.deepEqual(Object.keys(merged.facts[0].messages).sort(), [chaveAviso, "node:x"]);
  assert.equal(merged.facts[1], base.facts[1], "quem nao tem linha fica igual");
  assert.equal(base.context.messageKeys.size, 1, "o original nao muda");
});

test("linha do sino como fato: visibleAt = greatest(created_at, sent_at), ou o visible_at que o lote do motor ja traz", () => {
  const base = {
    audio_completed_at: null,
    audio_started_at: null,
    clicked_at: null,
    expires_at: iso(inDays(1)),
    opened_at: null,
    response: "talvez",
    seen_at: iso(daysAgo(1))
  };

  assert.equal(facts.messageFactOf({ ...base, created_at: iso(daysAgo(3)), sent_at: iso(daysAgo(2)) }).visibleAt, daysAgo(2), "gravada antes do fim do envio");
  assert.equal(facts.messageFactOf({ ...base, created_at: iso(daysAgo(3)), sent_at: iso(daysAgo(4)) }).visibleAt, daysAgo(3));
  assert.equal(facts.messageFactOf({ ...base, created_at: iso(daysAgo(3)), sent_at: null }).visibleAt, daysAgo(3), "aviso ainda sem sent_at");
  assert.equal(facts.messageFactOf({ ...base, visible_at: iso(daysAgo(5)) }).visibleAt, daysAgo(5));
  assert.deepEqual(facts.messageFactOf({ ...base, created_at: iso(daysAgo(3)) }), {
    audioCompletedAt: null,
    audioStartedAt: null,
    clickedAt: null,
    expiresAt: inDays(1),
    openedAt: null,
    response: null,
    seenAt: daysAgo(1),
    visibleAt: daysAgo(3)
  }, "resposta fora de aceitar/recusar vira null");
});

test("o que as regras pedem dos fatos: progresso, estudo, entrada, ritmo, turma ou comentarios; ranking so para 'top N'", () => {
  assert.deepEqual(model.audienceFactNeeds(todas(mensagem("opened"), ganhou(["a"]), { op: "has", productIds: ["a"], type: "product" })), { comments: "none", students: false });
  assert.deepEqual(model.audienceFactNeeds(todas({ days: 7, op: "within", type: "last_study" })), { comments: "none", students: true });
  assert.deepEqual(model.audienceFactNeeds(todas({ count: 1, days: 30, op: "gte", type: "comments" })), { comments: "counts", students: true });
  assert.deepEqual(
    model.audienceFactNeeds([todas({ count: 10, days: 7, op: "top", type: "comments" }), todas({ count: 0, days: null, op: "none", type: "comments" })]),
    { comments: "ranked", students: true },
    "o ranking vence a contagem"
  );
  assert.deepEqual(model.audienceFactNeeds([null, model.EVERYONE, todas({ items: [{ paces: ["inactive"], type: "pace" }], match: "any" })]), { comments: "none", students: true });
});

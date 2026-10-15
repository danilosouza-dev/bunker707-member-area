import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Pagina do produto na moldura do prototipo aprovado (rodada "Layout do prototipo", 11/10/2026):
// regras puras da aba Desempenho (linhas do funil, tabela por aula, textos) e as garantias de
// honestidade das abas Desempenho e Alunos (nenhum numero de estudo inventado, nenhuma linha de aluno
// desenhada). Nada aqui depende de React nem do banco.

const model = await import("../src/components/admin/v2/products/performance-model.ts");
const period = await import("../src/components/admin/v2/period.ts");

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

function lesson(id, moduleId, position, status = "published", title = `Aula ${id}`) {
  return {
    durationLabel: null,
    id,
    moduleId,
    position,
    release: { mode: "immediate" },
    releaseLabel: "Libera na hora",
    status,
    title,
    updatedAt: "2026-10-10T12:00:00.000Z",
    video: null
  };
}

function module(id, position, title, lessons) {
  return {
    coverUrl: null,
    id,
    lessons,
    position,
    release: { mode: "immediate" },
    releaseLabel: "Libera na hora",
    title,
    updatedAt: "2026-10-10T12:00:00.000Z"
  };
}

const MODULES = [
  // Fora de ordem de proposito: a tela segue a posicao, nao a ordem de chegada.
  module("m2", 2, "Ferramentas e integrações", [lesson("b2", "m2", 2, "draft", "Exercício"), lesson("b1", "m2", 1, "published", "Ferramentas")]),
  module("m1", 1, "Comece por aqui", [lesson("a1", "m1", 1), lesson("a2", "m1", 2)]),
  module("m3", 3, "Só rascunhos", [lesson("c1", "m3", 1, "draft")]),
  module("m4", 4, "Vazio", [])
];

test("funil: uma linha por modulo, na ordem da arvore, sem numero inventado", () => {
  const rows = model.buildModuleFunnelRows(MODULES);

  assert.deepEqual(
    rows.map((row) => row.label),
    ["Módulo 1 · Comece por aqui", "Módulo 2 · Ferramentas e integrações", "Módulo 3 · Só rascunhos", "Módulo 4 · Vazio"]
  );
  assert.deepEqual(
    rows.map((row) => row.note),
    [null, null, "sem aulas publicadas", "sem aulas"]
  );

  for (const row of rows) {
    assert.equal(row.started, null, row.label);
    assert.equal(row.completed, null, row.label);
  }

  assert.equal(model.describeFunnelValue(rows[0]), "Iniciaram — · Concluíram —");
  assert.equal(model.describeFunnelValue(rows[2]), "sem aulas publicadas");
  assert.deepEqual(model.buildModuleFunnelRows([]), []);
});

test("funil da Formação passa pelos cursos dela", () => {
  const rows = model.buildCourseFunnelRows([
    { accent: "lima", coverUrl: null, id: "k2", lessonsPublished: 0, lessonsTotal: 3, position: 2, situation: "draft", situationLabel: "Rascunho", title: "Avançado" },
    { accent: "roxo", coverUrl: null, id: "k1", lessonsPublished: 4, lessonsTotal: 4, position: 1, situation: "published", situationLabel: "Publicado", title: "Fundamentos" }
  ]);

  assert.deepEqual(
    rows.map((row) => [row.label, row.note, row.started, row.completed]),
    [
      ["Curso 1 · Fundamentos", null, null, null],
      ["Curso 2 · Avançado", "sem aulas publicadas", null, null]
    ]
  );
});

test("por aula: todas as aulas, numeradas modulo.aula, rascunho apagado com chip", () => {
  const rows = model.buildLessonPerformanceRows(MODULES);

  assert.deepEqual(
    rows.map((row) => [row.number, row.title, row.off, row.statusLabel]),
    [
      ["1.1", "Aula a1", false, null],
      ["1.2", "Aula a2", false, null],
      ["2.1", "Ferramentas", false, null],
      ["2.2", "Exercício", true, "Rascunho"],
      ["3.1", "Aula c1", true, "Rascunho"]
    ]
  );

  const metricIds = model.LESSON_METRIC_COLUMNS.map((column) => column.id);

  for (const row of rows) {
    assert.deepEqual(Object.keys(row.metrics).sort(), [...metricIds].sort(), row.number);
    assert.ok(
      Object.values(row.metrics).every((value) => value === null),
      `${row.number}: nenhum numero de estudo antes do registro de aulas assistidas`
    );
  }
});

test("colunas e faixas na ordem do prototipo", () => {
  assert.deepEqual(
    model.LESSON_METRIC_COLUMNS.map((column) => column.label),
    ["Iniciaram", "Concluíram", "% concl.", "Queda", "Avaliação", "Comentários", "Perguntas / 100 visualizações"]
  );
  // No celular ficam as tres do prototipo (Iniciaram, % concl., Queda).
  assert.deepEqual(
    model.LESSON_METRIC_COLUMNS.filter((column) => column.mobile).map((column) => column.label),
    ["Iniciaram", "% concl.", "Queda"]
  );
  assert.deepEqual(
    model.PROGRESS_BANDS.map((band) => band.label),
    ["0–25 % do curso", "26–50 % do curso", "51–75 % do curso", "76–100 % do curso"]
  );
});

test("base dos percentuais: numero real de acessos ou aberto para todos", () => {
  assert.equal(model.describePerformanceBase("with_access", 312), "de 312 com acesso");
  assert.equal(model.describePerformanceBase("with_access", 1312), "de 1.312 com acesso");
  assert.equal(model.describePerformanceBase("hidden", 0), "de 0 com acesso");
  assert.equal(model.describePerformanceBase("with_access", -3), "de 0 com acesso");
  assert.equal(model.describePerformanceBase("all_students", 40), "aberto para todos os alunos");
});

test("titulo da tabela por aula segue o periodo da barra superior", () => {
  const now = new Date("2026-10-11T15:00:00.000Z");
  const label = (param) => model.describeLessonTableMeta(period.readAdminPeriod({ periodo: param }, now).label);

  assert.equal(label(undefined), "últimos 30 dias · queda contra a aula anterior");
  assert.equal(label("hoje"), "hoje · queda contra a aula anterior");
  assert.equal(label("1d"), "últimas 24 horas · queda contra a aula anterior");
  assert.equal(label("3d"), "últimos 3 dias · queda contra a aula anterior");
  assert.equal(label("7d"), "últimos 7 dias · queda contra a aula anterior");
  assert.match(label("2026-10-01..2026-10-10"), /^1 a 10 de out\. de 2026 · queda contra a aula anterior$/);
  assert.equal(model.describeLessonTableMeta("  "), "queda contra a aula anterior");
});

test("abas Desempenho e Alunos: so dado real, sem linha nem numero de exemplo", async () => {
  const performancePage = await read("../src/app/admin/(v2)/produtos/[id]/desempenho/page.tsx");
  const performanceView = await read("../src/components/admin/v2/products/product-performance-view.tsx");
  const studentsView = await read("../src/components/admin/v2/products/product-students-view.tsx");

  assert.match(performancePage, /getProductContent\(id\)/);
  assert.match(performancePage, /getProductAccess\(id\)/);
  assert.match(performancePage, /readAdminPeriod\(/);
  assert.match(performanceView, /PERFORMANCE_NOTICE/);
  assert.match(model.PERFORMANCE_NOTICE, /Nada aqui é simulado\./);
  assert.doesNotMatch(performanceView, /Math\.random|onClick|href=/, "nada clicavel nem sorteado sem dado");

  assert.match(studentsView, /rows=\{openToAll \? \[\] : list\.items\}/, "a tabela de alunos mostra so a lista real do banco");
  assert.match(studentsView, /<ProductStudentsActions /, "liberar acesso e adicionar aluno ficam na propria aba");
  assert.doesNotMatch(studentsView, /admin antigo|legacy/i);
});

test("abas do produto levam o periodo e o cabecalho fica preso ao rolar", async () => {
  const header = await read("../src/components/admin/v2/products/product-header.tsx");

  assert.match(header, /PRESERVED_TAB_PARAMS = \["periodo"\]/);
  assert.match(header, /preserveParams=\{PRESERVED_TAB_PARAMS\}/);
  assert.match(header, /md:sticky md:top-14/);
  assert.match(header, /useAdminTopbarTitle\(header\.title\)/);
  assert.doesNotMatch(header, /size-10|h-10/, "gatilhos do cabecalho em 32/36 px");
});

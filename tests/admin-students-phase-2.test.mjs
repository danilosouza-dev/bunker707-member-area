import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Entrega 2 de Alunos: filtros/segmentos, "liberar nunca encurta", delta de atividade do player,
// importacao (prévia) e exportacao (colunas). Tudo puro.

const model = await import("../src/server/students/model.ts");
const schemas = await import("../src/server/students/schemas.ts");
const hrefs = await import("../src/components/admin/v2/students/hrefs.ts");
const activity = await import("../src/server/progress/activity-delta.ts");
const importModel = await import("../src/server/students/import-model.ts");
const exportModel = await import("../src/server/students/export-model.ts");

const DAY = 86_400_000;
const now = Date.parse("2026-10-15T15:00:00.000Z");
const daysAgo = (days) => new Date(now - days * DAY).toISOString();

test("filtros canonicos vao e voltam do endereco; valor estranho e ignorado", () => {
  const params = { account: "never", cohortId: "8d1f0c9e-1111-4222-8333-444455556666", commenters: "top", expiring: true, group: "retained", notStarted: true, pace: "at_risk", productId: "curso-x", q: "ana", week: "2026-10-12" };
  const search = model.studentListParamsToSearch(params, 3).toString();
  assert.equal(search, "produto=curso-x&ritmo=at_risk&turma=8d1f0c9e-1111-4222-8333-444455556666&expira=30&conta=nunca&comecou=nao&comentadores=top&semana=2026-10-12&grupo=retained&busca=ana&pagina=3");

  const parsed = schemas.parseStudentListSearchParams(Object.fromEntries(new URLSearchParams(search)));
  assert.deepEqual(parsed, { page: 3, pageSize: 25, ...params });

  const weird = schemas.parseStudentListSearchParams({ comecou: "sim", conta: "x", expira: "31", grupo: "retained", semana: "2026-13-99", turma: "abc" });
  assert.deepEqual(weird, { page: 1, pageSize: 25 }, "semana invalida apaga semana e grupo; turma precisa ser uuid");

  assert.equal(hrefs.studentListHref({ page: 2, pace: "studying" }, { expiring: true }), "/admin/alunos?ritmo=studying&expira=30", "mudar filtro volta a pagina 1");
  assert.equal(hrefs.segmentHref({ commenters: "top" }), "/admin/alunos?comentadores=top");
  assert.equal(model.hasStudentListFilters({}), false);
  assert.equal(model.hasStudentListFilters({ week: "2026-10-12" }), false, "semana sem grupo nao e filtro");
});

test("segmentos prontos: 9, com formula, ids unicos e params validos", () => {
  const presets = model.STUDENT_SEGMENT_PRESETS;
  assert.equal(presets.length, 9);
  assert.equal(new Set(presets.map((preset) => preset.id)).size, 9);

  for (const preset of presets) {
    assert.ok(preset.formula.length > 10, preset.id);
    assert.equal(schemas.studentListParamsSchema.safeParse(preset.params).success, true, preset.id);
  }

  assert.deepEqual(presets.find((preset) => preset.id === "nunca-entraram").params, { account: "never" });
  assert.equal(schemas.saveSegmentSchema.safeParse({ name: "A", params: {} }).success, false, "nome curto");
  assert.equal(schemas.saveSegmentSchema.safeParse({ name: "Em risco", params: { pace: "at_risk", extra: 1 } }).success, false, "params so com chaves conhecidas");
});

test("liberar acesso nunca encurta quem ja tem acesso aberto", () => {
  const far = "2027-01-01T00:00:00.000Z";
  const near = "2026-12-01T00:00:00.000Z";
  assert.equal(model.nextAccessEndOnGrant({ existingEndsAt: null, requestedEndsAt: near, wasOpen: true }), null, "vitalicio continua vitalicio");
  assert.equal(model.nextAccessEndOnGrant({ existingEndsAt: far, requestedEndsAt: null, wasOpen: true }), null, "sem prazo vence data");
  assert.equal(model.nextAccessEndOnGrant({ existingEndsAt: far, requestedEndsAt: near, wasOpen: true }), far);
  assert.equal(model.nextAccessEndOnGrant({ existingEndsAt: near, requestedEndsAt: far, wasOpen: true }), far);
  assert.equal(model.nextAccessEndOnGrant({ existingEndsAt: far, requestedEndsAt: near, wasOpen: false }), near, "revogado volta com o prazo pedido");
});

test("delta de atividade: avanco entre gravacoes, tetos por gravacao e por relogio, aulas novas", () => {
  const base = { nextCompletedLessonIds: [], previousCompletedLessonIds: [], now };
  assert.deepEqual(activity.activityDeltaOf({ ...base, nextProgressSeconds: 40, previousLastWatchedAt: new Date(now - 15_000).toISOString(), previousProgressSeconds: 25 }), { completed: 0, seconds: 15 });
  assert.deepEqual(activity.activityDeltaOf({ ...base, nextProgressSeconds: 300, previousLastWatchedAt: new Date(now - 15_000).toISOString(), previousProgressSeconds: 25 }), { completed: 0, seconds: 0 }, "salto de 275 s = pulou no video");
  assert.deepEqual(activity.activityDeltaOf({ ...base, nextProgressSeconds: 45, previousLastWatchedAt: new Date(now - 200).toISOString(), previousProgressSeconds: 25 }), { completed: 0, seconds: 0 }, "20 s em 0,2 s de relogio: no maximo 0,4 s -> 0");
  assert.deepEqual(activity.activityDeltaOf({ ...base, nextProgressSeconds: 45, previousLastWatchedAt: new Date(now - 8_000).toISOString(), previousProgressSeconds: 25 }), { completed: 0, seconds: 16 }, "2x o relogio");
  assert.deepEqual(activity.activityDeltaOf({ ...base, nextProgressSeconds: 10, previousLastWatchedAt: new Date(now - 15_000).toISOString(), previousProgressSeconds: 25 }), { completed: 0, seconds: 0 }, "voltar nao conta");
  assert.deepEqual(activity.activityDeltaOf({ ...base, nextProgressSeconds: 28, previousLastWatchedAt: null, previousProgressSeconds: null }), { completed: 0, seconds: 15 }, "primeira gravacao vale ate 15 s");
  assert.deepEqual(activity.activityDeltaOf({ ...base, nextCompletedLessonIds: ["a", "b", "b"], nextProgressSeconds: 0, previousCompletedLessonIds: ["a"], previousLastWatchedAt: null, previousProgressSeconds: null }), { completed: 1, seconds: 0 });
  assert.equal(activity.hasActivity({ completed: 0, seconds: 0 }), false);
});

test("acoes em massa e importacao: schemas com teto por lote e campos por acao", () => {
  const user = "8d1f0c9e-1111-4222-8333-444455556666";
  const batch = "0f0f0f0f-2222-4333-8444-555566667777";
  assert.equal(schemas.bulkActionSchema.safeParse({ action: "grant", batchId: batch, userIds: [user] }).success, false, "grant precisa de produto");
  assert.equal(schemas.bulkActionSchema.safeParse({ action: "grant", batchId: batch, productId: "curso-x", userIds: [user] }).success, true);
  assert.equal(schemas.bulkActionSchema.safeParse({ action: "resend_access_email", batchId: batch, userIds: [user] }).success, true);
  assert.equal(schemas.bulkActionSchema.safeParse({ action: "set_cohort", batchId: batch, productId: "curso-x", userIds: [user] }).success, false, "set_cohort precisa de turma (ou null)");
  assert.equal(schemas.bulkActionSchema.safeParse({ action: "set_cohort", batchId: batch, cohortId: null, productId: "curso-x", userIds: [user] }).success, true);
  assert.equal(schemas.bulkActionSchema.safeParse({ action: "revoke", batchId: batch, productId: "curso-x", userIds: Array.from({ length: 26 }, () => user) }).success, false, "26 > lote de 25");
  assert.equal(model.BULK_MAX_TOTAL, 200);

  const row = { email: "ANA@exemplo.com", fullName: "Ana", index: 1, productIds: ["curso-x"] };
  assert.equal(schemas.importBatchSchema.safeParse({ batchId: batch, delivery: "invite", rows: [row] }).success, true);
  assert.equal(schemas.importBatchSchema.safeParse({ batchId: batch, delivery: "temporary_password", rows: [row] }).success, false, "senha temporaria nao cabe em lote");
  assert.equal(schemas.importBatchSchema.safeParse({ batchId: batch, delivery: "none", rows: Array.from({ length: 26 }, (_, index) => ({ ...row, index: index + 1 })) }).success, false);
  assert.equal(schemas.exportQuerySchema.parse({}).params !== undefined, true);
  assert.equal(schemas.exportQuerySchema.safeParse({ ids: Array.from({ length: 201 }, () => user) }).success, false);
});

test("importacao: deteccao de colunas, produtos por titulo (ambiguo = erro), prévia com erros por linha", () => {
  const mapping = importModel.detectImportMapping(["Nome completo", "E-MAIL", "WhatsApp", "Cursos", "Turma"]);
  assert.deepEqual(mapping, { cohort: 4, email: 1, fullName: 0, phone: 2, products: 3 });
  assert.deepEqual(importModel.missingRequiredFields({ phone: 2 }), ["fullName", "email"]);

  const products = [{ id: "curso-a", title: "Prompts do Zero" }, { id: "curso-b", title: "Formação Agentes" }, { id: "curso-c", title: "Formação Agentes" }];
  const resolved = importModel.resolveProductsCell("prompts do zero | Formação Agentes ; curso-a ; Outro", products);
  assert.deepEqual(resolved.ids, ["curso-a"]);
  assert.equal(resolved.errors.length, 2);
  assert.match(resolved.errors[0], /mais de um produto/);
  assert.match(resolved.errors[1], /não encontrado/);

  const preview = importModel.buildImportPreview({
    cohorts: [{ id: "8d1f0c9e-1111-4222-8333-444455556666", name: "Turma 1" }],
    mapping: { cohort: 3, email: 1, fullName: 0, products: 2 },
    products,
    rows: [
      ["Ana Souza", "ana@exemplo.com", "Prompts do Zero", "turma 1"],
      ["B", "nao-e-email", "", ""],
      ["Carla", "ana@exemplo.com", "", "Turma 9"],
      ["", "", "", ""]
    ]
  });
  assert.equal(preview.length, 4);
  assert.equal(preview[0].ok, true);
  assert.deepEqual(preview[0].row.productIds, ["curso-a"]);
  assert.equal(preview[0].row.cohortId, "8d1f0c9e-1111-4222-8333-444455556666");
  assert.equal(preview[1].ok, false);
  assert.ok(preview[1].errors.some((error) => /E-mail inválido|pelo menos 2/.test(error)));
  assert.equal(preview[2].ok, false);
  assert.ok(preview[2].errors.some((error) => /repetido na linha 1/.test(error)));
  assert.ok(preview[2].errors.some((error) => /turma “Turma 9” não existe/.test(error)));
  assert.equal(preview[3].ok, false);
  assert.match(importModel.importTemplateCsv(), /^﻿Nome;E-mail;Telefone;Produtos;Turma\r\n/);
});

test("exportacao: colunas da §1.7.4 e celulas na mesma ordem", () => {
  assert.deepEqual([...exportModel.STUDENT_EXPORT_HEADERS], ["Nome", "E-mail", "Telefone", "Produtos", "Turmas", "Ritmo", "Entrou em", "Último estudo", "Progresso por produto", "Aulas concluídas", "Aulas publicadas", "Comentários (28 dias)"]);
  const cells = exportModel.studentExportRowToCells({
    avatarUrl: null, cohorts: [{ cohortId: "c1", cohortName: "Turma 1", productId: "curso-a" }], comments28d: 2, completedLessons: 3, createdAt: "2026-10-01T12:00:00.000Z", email: "ana@exemplo.com", fullName: "Ana", id: "u1", isStaff: false, lastSignInAt: null, lastStudiedAt: daysAgo(2), pace: "studying", phone: "+55 11 9", products: [{ accent: "lima", coverUrl: null, format: "curso", id: "curso-a", title: "Prompts do Zero" }], progressByProduct: ["Prompts do Zero: 3 de 12"], totalLessons: 12
  });
  assert.equal(cells.length, exportModel.STUDENT_EXPORT_HEADERS.length);
  assert.equal(cells[3], "Prompts do Zero");
  assert.equal(cells[4], "Turma 1 (Prompts do Zero)");
  assert.equal(cells[5], "Estudando");
  assert.equal(cells[6], "01/10/2026");
  assert.equal(cells[9], 3);
});

import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

const schemas = await import("../src/server/catalog/schemas.ts");

/** Campos opcionais ausentes podem vir como undefined; compara so o que tem valor. */
const clean = (value) => JSON.parse(JSON.stringify(value));
const supabaseTimestamp = "2026-10-10T18:42:07.123456+00:00";

test("criar produto: so o nome e obrigatorio; padroes Curso e Só quem tem acesso", () => {
  const parsed = schemas.createProductSchema.parse({ title: "  Formação IA para Negócios  " });

  assert.deepEqual(parsed, {
    audience: "with_access",
    format: "curso",
    purchaseUrl: null,
    shortDescription: "",
    title: "Formação IA para Negócios"
  });
});

test("criar produto: nome de 3 a 80, link https, formato criavel e capa WebP", () => {
  const short = schemas.createProductSchema.safeParse({ title: "IA" });
  assert.equal(short.success, false);
  assert.equal(short.error.issues[0].message, "Use pelo menos 3 caracteres.");

  assert.equal(schemas.createProductSchema.safeParse({ title: "x".repeat(81) }).success, false);
  assert.equal(schemas.createProductSchema.safeParse({ format: "gravacao_live", title: "Live antiga" }).success, false);
  assert.equal(schemas.createProductSchema.safeParse({ purchaseUrl: "http://pay.hotmart.com/x", title: "Curso" }).success, false);
  assert.equal(schemas.createProductSchema.parse({ purchaseUrl: "", title: "Curso" }).purchaseUrl, null);
  assert.equal(
    schemas.createProductSchema.parse({ purchaseUrl: " https://pay.hotmart.com/x ", title: "Curso" }).purchaseUrl,
    "https://pay.hotmart.com/x"
  );
  assert.equal(schemas.createProductSchema.safeParse({ cover: "data:image/png;base64,AAAA", title: "Curso" }).success, false);
  assert.equal(schemas.createProductSchema.safeParse({ cover: "data:image/webp;base64,UklGRg==", title: "Curso" }).success, true);
  assert.equal(schemas.createProductSchema.safeParse({ cover: "https://cdn.exemplo.com/capa.webp", title: "Curso" }).success, true);
  assert.equal(
    schemas.createProductSchema.safeParse({ cover: `data:image/webp;base64,${"A".repeat(300_001)}`, title: "Curso" }).success,
    false,
    "capa grande demais"
  );
});

test("curso criado dentro de formacao precisa ser Curso", () => {
  const wrong = schemas.createProductSchema.safeParse({ format: "material", parentFormationId: "formation-ia-1", title: "Kit" });
  assert.equal(wrong.success, false);
  assert.deepEqual(wrong.error.issues[0].path, ["format"]);
  assert.equal(schemas.createProductSchema.safeParse({ parentFormationId: "formation-ia-1", title: "Curso interno" }).success, true);
});

test("updated_at no formato do banco e aceito; texto qualquer nao", () => {
  assert.equal(
    schemas.renameProductSchema.safeParse({ expectedUpdatedAt: supabaseTimestamp, id: "course-a-1", title: "Novo nome" }).success,
    true
  );
  assert.equal(
    schemas.renameProductSchema.safeParse({ expectedUpdatedAt: "2026-10-10T18:42:07Z", id: "course-a-1", title: "Novo nome" }).success,
    true
  );
  assert.equal(
    schemas.renameProductSchema.safeParse({ expectedUpdatedAt: "ontem", id: "course-a-1", title: "Novo nome" }).success,
    false
  );
  assert.equal(
    schemas.renameProductSchema.safeParse({ expectedUpdatedAt: supabaseTimestamp, id: "../segredo", title: "Novo nome" }).success,
    false
  );
});

test("lista de produtos: parametros do endereco viram consulta valida e lixo vira padrao", () => {
  assert.deepEqual(clean(schemas.parseProductListSearchParams({})), { page: 1 });
  assert.deepEqual(
    schemas.parseProductListSearchParams({ busca: "  agentes ", formato: "formacao", pagina: "3", situacao: "draft" }),
    { format: "formacao", page: 3, q: "agentes", situation: "draft" }
  );
  assert.deepEqual(
    clean(schemas.parseProductListSearchParams({ busca: "   ", formato: "<script>", pagina: "-2", situacao: "apagado" })),
    { page: 1 }
  );
  assert.deepEqual(clean(schemas.parseProductListSearchParams({ formato: ["curso", "material"], pagina: ["2"] })), { format: "curso", page: 2 });
  assert.equal(schemas.PRODUCT_LIST_PAGE_SIZE, 25);
});

test("liberacao em frase valida cada modo", () => {
  const parse = (value) => schemas.releasePhraseSchema.safeParse(value);

  assert.deepEqual(parse({ amount: 7, mode: "after_access" }).data, { amount: 7, mode: "after_access", unit: "dias" });
  assert.equal(parse({ amount: 0, mode: "after_access" }).success, false);
  assert.equal(parse({ amount: 1.5, mode: "after_access" }).success, false);
  assert.equal(parse({ date: "2026-11-14T03:00:00.000Z", mode: "fixed_date" }).success, true);
  assert.equal(parse({ date: "14/11/2026", mode: "fixed_date" }).success, false);
  assert.equal(parse({ mode: "activity_required" }).success, false);
});

test("aulas: colar ate 100 por vez; atualizar aceita remover o video", () => {
  const items = Array.from({ length: 101 }, (_, index) => ({ title: `Aula ${index + 1}` }));
  const tooMany = schemas.createLessonsSchema.safeParse({ items, moduleId: "module-a-1" });
  assert.equal(tooMany.success, false);
  assert.equal(tooMany.error.issues[0].message, "Cole no máximo 100 aulas de uma vez.");

  const parsed = schemas.createLessonsSchema.parse({ items: [{ videoInput: "https://youtu.be/dQw4w9WgXcQ" }], moduleId: "module-a-1" });
  assert.deepEqual(parsed.items, [{ title: "", videoInput: "https://youtu.be/dQw4w9WgXcQ" }]);

  const update = schemas.updateLessonSchema.parse({ expectedUpdatedAt: supabaseTimestamp, id: "lesson-a-1", videoInput: null });
  assert.equal(update.videoInput, null);
  assert.equal(update.allowEmbedCode, false);
  assert.equal(schemas.updateLessonSchema.safeParse({ expectedUpdatedAt: supabaseTimestamp, id: "lesson-a-1", status: "deleted" }).success, false);
});

test("excluir com desfazer e reordenar em lote", () => {
  assert.equal(schemas.softDeleteStructureSchema.safeParse({ ids: [], kind: "lesson" }).success, false);
  assert.equal(
    schemas.restoreStructureSchema.safeParse({ items: [{ id: "lesson-a", previousStatus: "deleted" }], kind: "lesson" }).success,
    false,
    "nao restaura para excluido"
  );

  const order = schemas.reorderContentSchema.parse({
    modules: [{ id: "module-b", lessonIds: ["lesson-2", "lesson-1"] }, { id: "module-a", lessonIds: [] }],
    productId: "course-a-1"
  });
  assert.deepEqual(order.modules.map((module) => module.id), ["module-b", "module-a"]);
  assert.equal(
    schemas.reorderContentSchema.safeParse({
      modules: [{ id: "module-a", lessonIds: Array.from({ length: 150 }, (_, index) => `lesson-${index}`) }],
      productId: "course-a-1"
    }).success,
    true,
    "modulo importado com 150 aulas continua reordenavel"
  );
  assert.equal(
    schemas.reorderContentSchema.safeParse({
      modules: Array.from({ length: 101 }, (_, index) => ({ id: `module-${index}`, lessonIds: [] })),
      productId: "course-a-1"
    }).success,
    false
  );
});

test("pacote precisa de nome e de pelo menos um produto", () => {
  assert.equal(schemas.comboSchema.safeParse({ name: "Pacote IA", productIds: [] }).success, false);
  assert.deepEqual(schemas.comboSchema.parse({ name: " Pacote IA ", productIds: ["course-a-1"] }), {
    cohortName: "",
    description: "",
    name: "Pacote IA",
    productIds: ["course-a-1"],
    status: "draft"
  });
});

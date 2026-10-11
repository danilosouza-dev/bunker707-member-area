import assert from "node:assert/strict";
import test from "node:test";
import { actionStubs, createFakeDb } from "./support/admin-action-stubs.mjs";

// Server Actions de Produtos chamadas de verdade (papel, zod, regras e RPC), com banco falso.

const { reorderContent } = await import("../src/server/catalog/content-actions.ts");

const NOW = "2026-10-10T12:00:00.000Z";

function moduleRow(id, sortOrder) {
  return { id, image: null, owner_id: "yt-course-big", release_rule: null, sort_order: sortOrder, status: "published", title: id, updated_at: NOW };
}

function lessonRow(id, moduleId, sortOrder) {
  return {
    description: null,
    duration: null,
    id,
    image: null,
    module_id: moduleId,
    release_rule: null,
    sort_order: sortOrder,
    status: "published",
    title: id,
    updated_at: NOW,
    video_config: null
  };
}

test("reordenar um curso importado com um modulo de 150 aulas funciona, inclusive tirando aulas dele", async () => {
  const lessonIds = Array.from({ length: 150 }, (_, index) => `yt-lesson-PLbig-${String(index).padStart(3, "0")}`);
  // Separando o modulo grande: as 50 ultimas aulas vao para um modulo novo. O modulo de origem ainda
  // tem 100 aulas, e antes de salvar tinha 150.
  const modules = [
    { id: "yt-module-PLbig-001", lessonIds: lessonIds.slice(0, 100) },
    { id: "module-parte-2", lessonIds: lessonIds.slice(100) }
  ];
  const db = createFakeDb({
    tables: {
      content_items: [{ id: "yt-course-big", kind: "Curso", title: "Curso grande" }],
      course_modules: [moduleRow("yt-module-PLbig-001", 0), moduleRow("module-parte-2", 1)],
      lessons: modules.flatMap((module) => module.lessonIds.map((id, index) => lessonRow(id, module.id, index)))
    }
  });
  actionStubs.db = db;
  actionStubs.invalidations = [];

  const result = await reorderContent({ modules, productId: "yt-course-big" });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(db.calls.rpc.map((call) => call.name), ["admin_reorder_product_content"]);
  assert.equal(db.calls.rpc[0].args.p_modules[0].lessonIds.length, 100);
  assert.equal(db.calls.rpc[0].args.p_modules[1].lessonIds.length, 50);
  assert.equal(actionStubs.invalidations.length, 1, "invalida o cache do catalogo");
  assert.deepEqual(result.data.modules.map((module) => module.lessons.length), [100, 50]);

  // Mover uma aula dentro do modulo de 150 (antes de separar) tambem passa.
  const whole = [{ id: "yt-module-PLbig-001", lessonIds: [lessonIds[149], ...lessonIds.slice(0, 149)] }];
  actionStubs.db = createFakeDb({
    tables: {
      content_items: [{ id: "yt-course-big", kind: "Curso", title: "Curso grande" }],
      course_modules: [moduleRow("yt-module-PLbig-001", 0)],
      lessons: whole[0].lessonIds.map((id, index) => lessonRow(id, "yt-module-PLbig-001", index))
    }
  });

  const moved = await reorderContent({ modules: whole, productId: "yt-course-big" });
  assert.equal(moved.ok, true, JSON.stringify(moved));
  assert.equal(moved.data.modules[0].lessons.length, 150);
});

test("reordenar recusa so o que passa do tamanho aceito pela importacao (500 aulas, 100 modulos)", async () => {
  const db = createFakeDb({ tables: { content_items: [{ id: "yt-course-big", kind: "Curso", title: "Curso grande" }] } });
  actionStubs.db = db;

  const tooManyLessons = await reorderContent({
    modules: [{ id: "m1", lessonIds: Array.from({ length: 501 }, (_, index) => `l${index}`) }],
    productId: "yt-course-big"
  });
  assert.equal(tooManyLessons.ok, false);
  assert.equal(tooManyLessons.status, 400);

  const tooManyModules = await reorderContent({
    modules: Array.from({ length: 101 }, (_, index) => ({ id: `m${index}`, lessonIds: [] })),
    productId: "yt-course-big"
  });
  assert.equal(tooManyModules.ok, false);
  assert.equal(db.calls.rpc.length, 0, "nada chega ao banco");
});

test("ordem desatualizada (outra aba mexeu) vira 409 com a frase do produtor", async () => {
  actionStubs.db = createFakeDb({
    rpcResults: { admin_reorder_product_content: { data: null, error: { code: "P0001", message: "stale_structure" } } },
    tables: { content_items: [{ id: "yt-course-big", kind: "Curso", title: "Curso grande" }] }
  });

  const result = await reorderContent({ modules: [{ id: "m1", lessonIds: ["l1"] }], productId: "yt-course-big" });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.error, /Recarregue/);
});

/* ------------------------------------------------------------------------------------------------
 * Escritas atomicas (202610110012): uma RPC por operacao, nada de varias escritas soltas
 * ---------------------------------------------------------------------------------------------- */

const { addCourseToFormation, removeCourseFromFormation, reorderFormationCourses } = await import(
  "../src/server/catalog/formation-actions.ts"
);
const { saveCombo } = await import("../src/server/catalog/combo-actions.ts");
const { updateProductDetails } = await import("../src/server/catalog/product-actions.ts");

const FORMATION = { commerce_scope: "sellable_product", id: "formacao-ia", kind: "Formacao", title: "Formação IA" };
const COURSE = { commerce_scope: "sellable_product", id: "curso-prompts", kind: "Curso", title: "Prompts" };

function writesOutsideRpc(db) {
  return db.calls.writes.filter((write) => ["content_items", "content_page_settings", "product_combo_items"].includes(write.table));
}

test("incluir curso na formacao e uma RPC so: escopo e formacao do curso mudam juntos", async () => {
  const db = createFakeDb({
    rpcResults: { admin_product_students_with_access: { data: 0, error: null } },
    tables: { content_items: [FORMATION, COURSE], content_page_settings: [] }
  });
  actionStubs.db = db;

  const result = await addCourseToFormation({ courseId: COURSE.id, formationId: FORMATION.id });

  assert.equal(result.ok, true, JSON.stringify(result));
  const call = db.calls.rpc.find((entry) => entry.name === "admin_add_course_to_formation");
  assert.deepEqual(call?.args, { p_bucket: "formation_internal_courses", p_course_id: COURSE.id, p_formation_id: FORMATION.id });
  assert.deepEqual(writesOutsideRpc(db), [], "nenhuma escrita fora da transacao");
});

test("curso que entrou em outra formacao no meio do caminho vira 409, sem meia escrita", async () => {
  actionStubs.db = createFakeDb({
    rpcResults: {
      admin_add_course_to_formation: { data: null, error: { code: "P0001", message: "stale_structure" } },
      admin_product_students_with_access: { data: 0, error: null }
    },
    tables: { content_items: [FORMATION, COURSE], content_page_settings: [] }
  });

  const result = await addCourseToFormation({ courseId: COURSE.id, formationId: FORMATION.id });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test("tirar da formacao e reordenar cursos tambem sao uma RPC cada", async () => {
  const included = { ...COURSE, commerce_scope: "included_content", sort_order: 0 };
  const other = { ...COURSE, commerce_scope: "included_content", id: "curso-agentes", sort_order: 1 };
  const settings = [
    { content_id: included.id, settings: { parentFormationId: FORMATION.id } },
    { content_id: other.id, settings: { parentFormationId: FORMATION.id } }
  ];

  const removeDb = createFakeDb({ tables: { content_items: [FORMATION, included], content_page_settings: settings } });
  actionStubs.db = removeDb;
  const removed = await removeCourseFromFormation({ courseId: included.id, formationId: FORMATION.id });
  assert.equal(removed.ok, true, JSON.stringify(removed));
  assert.deepEqual(removeDb.calls.rpc.map((entry) => entry.name).filter((name) => name.startsWith("admin_")), [
    "admin_remove_course_from_formation"
  ]);
  assert.deepEqual(writesOutsideRpc(removeDb), []);

  const reorderDb = createFakeDb({ tables: { content_items: [FORMATION, included, other], content_page_settings: settings } });
  actionStubs.db = reorderDb;
  const reordered = await reorderFormationCourses({ formationId: FORMATION.id, orderedCourseIds: [other.id, included.id] });
  assert.equal(reordered.ok, true, JSON.stringify(reordered));
  const call = reorderDb.calls.rpc.find((entry) => entry.name === "admin_reorder_formation_courses");
  assert.deepEqual(call?.args, { p_course_ids: [other.id, included.id], p_formation_id: FORMATION.id });
  assert.deepEqual(writesOutsideRpc(reorderDb), [], "sem N updates soltos");
});

test("salvar pacote troca os produtos numa transacao; pacote sumido vira 404", async () => {
  const product = { bucket: "courses", commerce_scope: "sellable_product", id: "curso-prompts" };
  const db = createFakeDb({
    rpcResults: { admin_save_combo: { data: null, error: { code: "P0001", message: "combo_not_found" } } },
    tables: { content_items: [product] }
  });
  actionStubs.db = db;

  const result = await saveCombo({ id: "combo-ia", name: "Pacote IA", productIds: [product.id, product.id] });

  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  const call = db.calls.rpc.find((entry) => entry.name === "admin_save_combo");
  assert.equal(call?.args.p_create, false);
  assert.deepEqual(call?.args.p_product_ids, [product.id], "sem produto repetido");
  assert.deepEqual(writesOutsideRpc(db), [], "nao apaga os itens antes de gravar os novos");
});

test("cor em Detalhes muda so a chave accent, sem regravar o JSON inteiro", async () => {
  const row = {
    access_label: "Curso",
    commerce_scope: "sellable_product",
    eyebrow: "Curso",
    id: COURSE.id,
    kind: "Curso",
    publication_status: "draft",
    title: "Prompts",
    updated_at: NOW
  };
  const db = createFakeDb({
    rpcResults: { admin_patch_product_settings: { data: { accent: "roxo", hero: { mediaSrc: "x" } }, error: null } },
    tables: { content_items: [row], content_page_settings: [{ content_id: COURSE.id, settings: { hero: { mediaSrc: "x" } } }] }
  });
  actionStubs.db = db;

  const result = await updateProductDetails({ accent: "roxo", expectedUpdatedAt: NOW, id: COURSE.id });

  assert.equal(result.ok, true, JSON.stringify(result));
  const call = db.calls.rpc.find((entry) => entry.name === "admin_patch_product_settings");
  assert.deepEqual(call?.args, { p_content_id: COURSE.id, p_set: { accent: "roxo" }, p_unset: [] });
  assert.equal(db.calls.writes.some((write) => write.table === "content_page_settings"), false);
});

/* ------------------------------------------------------------------------------------------------
 * Importar playlist que ja virou curso
 * ---------------------------------------------------------------------------------------------- */

const { importPlaylist } = await import("../src/server/catalog/import-actions.ts");
const { playlistAlreadyImportedMessage } = await import("../src/server/catalog/model.ts");

test("importar de novo uma playlist que ja virou curso e recusado com 409, sem tocar no curso", async () => {
  const playlistId = "PLabcdefghij123456";
  const db = createFakeDb({
    tables: {
      content_items: [{ id: `yt-course-${playlistId}`, title: "Curso de Agentes" }],
      youtube_course_imports: [{ course_id: `yt-course-${playlistId}`, playlist_id: playlistId }]
    }
  });
  actionStubs.db = db;

  const result = await importPlaylist({
    playlistUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
    title: "Outro nome"
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.error, "Esta playlist já virou o curso “Curso de Agentes”. Abra o curso para editar.");
  assert.equal(db.calls.rpc.length, 0, "import_youtube_course nao roda");
  assert.deepEqual(db.calls.writes, []);
});

test("mensagem de playlist ja importada sem nome do curso", () => {
  assert.equal(playlistAlreadyImportedMessage("  "), "Esta playlist já virou um curso. Abra o curso para editar.");
});

/* ------------------------------------------------------------------------------------------------
 * Migracao 202610110012 (sem banco local: confere o contrato das funcoes no SQL)
 * ---------------------------------------------------------------------------------------------- */

const { readFile } = await import("node:fs/promises");
const atomicSql = await readFile(new URL("../supabase/migrations/202610110012_catalog_v2_atomic_writes.sql", import.meta.url), "utf8");

test("funcoes novas: security invoker, fora do alcance do navegador e so para a chave de servico", () => {
  for (const signature of [
    "admin_patch_product_settings(text, jsonb, text[])",
    "admin_add_course_to_formation(text, text, text)",
    "admin_remove_course_from_formation(text, text, text)",
    "admin_reorder_formation_courses(text, text[])",
    "admin_save_combo(text, boolean, text, text, text, text, text[])"
  ]) {
    const name = signature.slice(0, signature.indexOf("("));
    const body = atomicSql.slice(atomicSql.indexOf(`function public.${name}(`));
    assert.match(body.slice(0, body.indexOf("$$")), /security invoker/, name);
    assert.ok(atomicSql.includes(`revoke all on function public.${signature} from public, anon, authenticated;`), name);
    assert.ok(atomicSql.includes(`grant execute on function public.${signature} to service_role;`), name);
  }

  // Patch de chaves no banco, sem ler e regravar o JSON inteiro.
  assert.match(atomicSql, /settings = \(s\.settings - removed\) \|\| patch/);
});

test("reimportar a playlist preserva situacao, capa e o que o produtor excluiu ou deixou em rascunho", () => {
  const importBody = atomicSql.slice(atomicSql.indexOf("function public.import_youtube_course("));
  const courseUpsert = importBody.slice(importBody.indexOf("insert into public.content_items"), importBody.indexOf("insert into public.content_page_settings"));

  assert.doesNotMatch(courseUpsert.slice(courseUpsert.indexOf("on conflict")), /publication_status/, "nao volta para rascunho");
  assert.match(courseUpsert, /image = case when excluded\.image = '' then c\.image else excluded\.image end/);
  assert.doesNotMatch(importBody, /publication_status = 'draft'/);
  assert.match(importBody, /when l\.status = 'deleted' and l\.deleted_by is not null then 'deleted'/);
  assert.match(importBody, /when l\.status = 'draft' then 'draft'/);
  assert.match(importBody, /left\(l\.id, length\(lesson_prefix\)\) = lesson_prefix/, "so exclui aulas da propria playlist");
  assert.match(importBody, /security definer\s+set search_path = public/);
});

test("salvar pacote antes da migracao 202610110012 ainda funciona, em passos", async () => {
  const product = { bucket: "courses", commerce_scope: "sellable_product", id: "curso-prompts" };
  const db = createFakeDb({
    rpcResults: { admin_save_combo: { data: null, error: { code: "PGRST202", message: "Could not find the function public.admin_save_combo" } } },
    tables: {
      content_items: [product],
      product_combo_items: [],
      product_combos: [{ id: "combo-ia" }]
    }
  });
  actionStubs.db = db;

  await saveCombo({ id: "combo-ia", name: "Pacote IA", productIds: [product.id] });

  assert.deepEqual(
    db.calls.writes.map((write) => `${write.op}:${write.table}`),
    ["update:product_combos", "delete:product_combo_items", "insert:product_combo_items"]
  );
});

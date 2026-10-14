import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Regras do servidor de Produtos v2 (frente A, fase 1) provadas sem banco: validacao das imagens,
// traducao de erros, regras de formato, formacao, exclusao e ordem, planejamento de aulas novas,
// mapeadores de linha -> DTO e a leitura de sugestoes do provedor de video.

const webp = await import("../src/server/catalog/webp.ts");
const rules = await import("../src/server/catalog/rules.ts");
const errors = await import("../src/server/catalog/errors.ts");
const mappers = await import("../src/server/catalog/mappers.ts");
const videoMeta = await import("../src/server/catalog/video-meta.ts");
const schemas = await import("../src/server/catalog/schemas.ts");
const { toActionError } = await import("../src/lib/action-result.ts");

// Primeiros 32 bytes de arquivos WebP reais (gerados com libwebp): o leitor so precisa do cabecalho.
const VP8_LOSSY_720x1080 = "524946464806000057454250565038203c060000d0a2009d012ad00238043ed1";
/** Medida antiga da capa (9:13): fora da proporcao 2:3, o servidor recusa. */
const VP8_LOSSY_720x1040 = "524946464806000057454250565038203c060000d0a2009d012ad00210043ed1";
/** Capa pequena na proporcao 2:3: o cliente nao amplia, o servidor aceita. */
const VP8_LOSSY_284x426 = "524946464806000057454250565038203c060000d0a2009d012a1c01aa013ed1";
const VP8_LOSSY_200x300 = "524946464806000057454250565038203c060000d0a2009d012ac8002c013ed1";
const VP8L_LOSSLESS_5x7 = "524946461e000000574542505650384c110000002f0480010007508f2217a5ff";
const VP8X_EXTENDED_1920x720 = "52494646380a000057454250565038580a000000100000007f0700cf0200414c";

function bytesFromHex(hex) {
  return Uint8Array.from(hex.match(/../g).map((pair) => Number.parseInt(pair, 16)));
}

function dataUrlFromHex(hex) {
  return `data:image/webp;base64,${Buffer.from(bytesFromHex(hex)).toString("base64")}`;
}

/* ------------------------------------------------------------------------------------------------
 * Imagens
 * ---------------------------------------------------------------------------------------------- */

test("readWebpDimensions le os tres formatos do container WebP", () => {
  assert.deepEqual(webp.readWebpDimensions(bytesFromHex(VP8_LOSSY_720x1080)), { height: 1080, width: 720 });
  assert.deepEqual(webp.readWebpDimensions(bytesFromHex(VP8_LOSSY_284x426)), { height: 426, width: 284 });
  assert.deepEqual(webp.readWebpDimensions(bytesFromHex(VP8L_LOSSLESS_5x7)), { height: 7, width: 5 });
  assert.deepEqual(webp.readWebpDimensions(bytesFromHex(VP8X_EXTENDED_1920x720)), { height: 720, width: 1920 });
});

test("readWebpDimensions devolve null para lixo, PNG e arquivo cortado", () => {
  const png = bytesFromHex("89504e470d0a1a0a0000000d49484452000002d0000004100806000000000000");
  const unknownChunk = bytesFromHex(VP8_LOSSY_720x1040.replace("56503820", "41424344"));
  const brokenStartCode = bytesFromHex(VP8_LOSSY_720x1040.replace("9d012a", "000000"));

  assert.equal(webp.readWebpDimensions(png), null);
  assert.equal(webp.readWebpDimensions(bytesFromHex(VP8_LOSSY_720x1040).slice(0, 20)), null);
  assert.equal(webp.readWebpDimensions(brokenStartCode), null);
  assert.equal(webp.readWebpDimensions(new Uint8Array(64)), null);
  assert.equal(webp.readWebpDimensions("RIFF"), null);
  assert.equal(webp.readWebpDimensions(bytesFromHex(VP8_LOSSY_720x1040.replace("57454250", "41564920"))), null);
  assert.equal(webp.readWebpDimensions(unknownChunk), null);
});

test("capa e hero exigem a medida exata do recorte e WebP de verdade", () => {
  const cover = webp.checkProductImage("cover", webp.decodeWebpDataUrl(dataUrlFromHex(VP8_LOSSY_720x1080)));
  assert.deepEqual(cover, { height: 1080, ok: true, width: 720 });
  // Menor que a saida, na mesma proporcao: aceita (o cliente nao amplia). Fora da proporcao ou abaixo do minimo: nao.
  assert.deepEqual(webp.checkProductImage("cover", webp.decodeWebpDataUrl(dataUrlFromHex(VP8_LOSSY_284x426))), { height: 426, ok: true, width: 284 });
  const oldRatio = webp.checkProductImage("cover", webp.decodeWebpDataUrl(dataUrlFromHex(VP8_LOSSY_720x1040)));
  assert.equal(oldRatio.ok, false);
  assert.match(oldRatio.message, /até 720×1080 px, na proporção/);
  assert.equal(webp.checkProductImage("cover", webp.decodeWebpDataUrl(dataUrlFromHex(VP8_LOSSY_200x300))).ok, false);

  const hero = webp.checkProductImage("hero", webp.decodeWebpDataUrl(dataUrlFromHex(VP8X_EXTENDED_1920x720)));
  assert.equal(hero.ok, true);

  const wrongSlot = webp.checkProductImage("hero", webp.decodeWebpDataUrl(dataUrlFromHex(VP8_LOSSY_720x1080)));
  assert.equal(wrongSlot.ok, false);
  assert.match(wrongSlot.message, /1920×720/);

  assert.equal(webp.decodeWebpDataUrl("data:image/png;base64,iVBORw0KGgo="), null);
  assert.equal(webp.checkProductImage("cover", null).ok, false);

  const oversized = new Uint8Array(webp.MAX_PRODUCT_IMAGE_BYTES + 1);
  oversized.set(bytesFromHex(VP8_LOSSY_720x1080));
  const tooBig = webp.checkProductImage("cover", oversized);
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.message, /grande demais/);
});

test("erro de imagem cai embaixo do campo (400 com fieldErrors), sem vazar detalhe tecnico", () => {
  const failure = toActionError(new errors.CatalogFieldError("cover", "A capa precisa ter 720×1040 px. Recorte de novo."));

  assert.equal(failure.status, 400);
  assert.deepEqual(failure.fieldErrors, { cover: ["A capa precisa ter 720×1040 px. Recorte de novo."] });
});

/* ------------------------------------------------------------------------------------------------
 * Erros de dominio
 * ---------------------------------------------------------------------------------------------- */

test("stale_structure da RPC de reordenar vira 409 com frase do produtor", () => {
  const translated = rules.translateReorderError({ code: "P0001", message: "stale_structure" });

  assert.ok(translated instanceof errors.CatalogConflictError);
  assert.equal(translated.status, 409);

  const failure = toActionError(translated);
  assert.equal(failure.status, 409);
  assert.equal(failure.error, rules.STALE_STRUCTURE_MESSAGE);

  const other = { message: "connection reset" };
  assert.equal(rules.translateReorderError(other), other);
  assert.equal(toActionError(other).status, 500);
});

test("erros de dominio carregam o status certo e a mensagem do produtor", () => {
  assert.equal(new errors.CatalogNotFoundError().status, 404);
  assert.equal(new errors.CatalogConflictError().message, errors.CONFLICT_MESSAGE);
  assert.equal(toActionError(new errors.CatalogRuleError("Use no máximo 50 módulos.")).status, 422);
  assert.equal(toActionError(new errors.CatalogConflictError()).error, errors.CONFLICT_MESSAGE);
});

/* ------------------------------------------------------------------------------------------------
 * Formato, exclusao e formacao
 * ---------------------------------------------------------------------------------------------- */

test("troca de formato: so sem alunos e nunca de/para Formacao ou em curso incluido", () => {
  const base = { activeAccessCount: 0, current: "curso", isIncludedCourse: false, next: "curso" };

  assert.equal(rules.assertFormatChange(base), false);
  assert.equal(rules.assertFormatChange({ ...base, next: "mentoria" }), true);

  assert.throws(
    () => rules.assertFormatChange({ ...base, activeAccessCount: 3, next: "mentoria" }),
    (error) => error.status === 409 && error.message === rules.FORMAT_LOCKED_BY_STUDENTS
  );
  assert.throws(() => rules.assertFormatChange({ ...base, next: "formacao" }), (error) => error.status === 409);
  assert.throws(() => rules.assertFormatChange({ ...base, current: "formacao", next: "curso" }), (error) => error.status === 409);
  assert.throws(
    () => rules.assertFormatChange({ ...base, isIncludedCourse: true, next: "bootcamp" }),
    (error) => error.status === 409 && error.message === rules.FORMAT_LOCKED_INCLUDED
  );
});

test("rotulos que eram so o nome do formato acompanham a troca; texto proprio fica", () => {
  assert.equal(rules.relabelForFormat("Curso", "curso", "Curso", "mentoria"), "Mentoria");
  assert.equal(rules.relabelForFormat("", "curso", "Curso", "bootcamp"), "Bootcamp");
  assert.equal(rules.relabelForFormat("Produto", "material", "Produto", "curso"), "Curso");
  assert.equal(rules.relabelForFormat("Imersão ao vivo", "curso", "Curso", "mentoria"), "Imersão ao vivo");
});

test("excluir produto exige o nome digitado e formacao vazia", () => {
  assert.doesNotThrow(() =>
    rules.assertCanDeleteProduct({ confirmTitle: "  ia   para NEGÓCIOS ", format: "curso", includedCourses: 0, title: "IA para negócios" })
  );
  assert.throws(
    () => rules.assertCanDeleteProduct({ confirmTitle: "IA", format: "curso", includedCourses: 0, title: "IA para negócios" }),
    (error) => error.status === 422 && error.message === rules.DELETE_CONFIRMATION_MISMATCH
  );
  assert.throws(
    () => rules.assertCanDeleteProduct({ confirmTitle: "Formação X", format: "formacao", includedCourses: 2, title: "Formação X" }),
    (error) => error.status === 409 && error.message === rules.DELETE_FORMATION_WITH_COURSES
  );
});

test("adicionar curso existente a formacao segue a decisao 15", () => {
  const formation = { format: "formacao", id: "formation-ia" };
  const course = { format: "curso", id: "course-prompt", parentFormationId: null };

  assert.equal(rules.assertCourseCanJoinFormation({ activeAccessCount: 0, course, formation }), "ok");
  assert.equal(
    rules.assertCourseCanJoinFormation({ activeAccessCount: 5, course: { ...course, parentFormationId: formation.id }, formation }),
    "already"
  );
  assert.throws(
    () => rules.assertCourseCanJoinFormation({ activeAccessCount: 0, course: { ...course, format: "mentoria" }, formation }),
    (error) => error.status === 422 && error.message === rules.FORMATION_ONLY_COURSES
  );
  assert.throws(
    () => rules.assertCourseCanJoinFormation({ activeAccessCount: 0, course: { ...course, parentFormationId: "formation-outra" }, formation }),
    (error) => error.status === 409 && error.message === rules.COURSE_IN_OTHER_FORMATION
  );
  assert.throws(
    () => rules.assertCourseCanJoinFormation({ activeAccessCount: 1, course, formation }),
    (error) => error.status === 409 && error.message === rules.COURSE_HAS_OWN_STUDENTS
  );
  assert.throws(
    () => rules.assertCourseCanJoinFormation({ activeAccessCount: 0, course, formation: { format: "curso", id: "course-x" } }),
    (error) => error.status === 422 && error.message === rules.FORMATION_INVALID
  );
  assert.throws(
    () => rules.assertCourseCanJoinFormation({ activeAccessCount: 0, course: { ...course, id: formation.id }, formation }),
    (error) => error.status === 422
  );
});

/* ------------------------------------------------------------------------------------------------
 * Ordem
 * ---------------------------------------------------------------------------------------------- */

test("reordenar cursos da formacao exige o mesmo conjunto de ids", () => {
  assert.deepEqual(rules.planFormationOrder(["a", "b", "c"], ["c", "a", "b"]), [
    { id: "c", sort_order: 0 },
    { id: "a", sort_order: 1 },
    { id: "b", sort_order: 2 }
  ]);
  assert.throws(() => rules.planFormationOrder(["a", "b"], ["a"]), (error) => error.status === 409);
  assert.throws(() => rules.planFormationOrder(["a", "b"], ["a", "a"]), (error) => error.status === 409);
  assert.throws(() => rules.planFormationOrder(["a", "b"], ["a", "x"]), (error) => error.status === 409);
});

test("ordem completa da aba Conteudo recusa ids repetidos e passa dos limites", () => {
  assert.doesNotThrow(() => rules.assertReorderPayload([{ id: "m1", lessonIds: ["l1", "l2"] }, { id: "m2", lessonIds: [] }]));
  assert.throws(() => rules.assertReorderPayload([{ id: "m1", lessonIds: ["l1"] }, { id: "m2", lessonIds: ["l1"] }]), (error) => error.status === 409);
  assert.throws(() => rules.assertReorderPayload([{ id: "m1", lessonIds: [] }, { id: "m1", lessonIds: [] }]), (error) => error.status === 409);

  // O limite e o da estrutura que ja existe (importacao aceita 500 aulas por modulo), nao o de criacao.
  const importedModule = [{ id: "m1", lessonIds: Array.from({ length: 150 }, (_, index) => `l${index}`) }];
  assert.doesNotThrow(() => rules.assertReorderPayload(importedModule));

  const tooManyLessons = [{ id: "m1", lessonIds: Array.from({ length: 501 }, (_, index) => `l${index}`) }];
  assert.throws(() => rules.assertReorderPayload(tooManyLessons), (error) => error.status === 422);
});

test("modulo novo entra no fim ou logo depois do modulo escolhido, regravando so o que muda", () => {
  const existing = [
    { id: "m1", sort_order: 0 },
    { id: "m2", sort_order: 1 },
    { id: "m3", sort_order: 2 }
  ];

  assert.deepEqual(rules.planModuleInsertion(existing, "novo"), { position: 4, updates: [{ id: "novo", sort_order: 3 }] });
  assert.deepEqual(rules.planModuleInsertion(existing, "novo", "m1"), {
    position: 2,
    updates: [
      { id: "novo", sort_order: 1 },
      { id: "m2", sort_order: 2 },
      { id: "m3", sort_order: 3 }
    ]
  });
  assert.deepEqual(rules.planModuleInsertion([], "novo", "inexistente"), { position: 1, updates: [{ id: "novo", sort_order: 0 }] });
});

test("produto novo entra no topo do grupo; curso novo da formacao entra no fim", () => {
  assert.equal(rules.sortOrderAtTop(0), -1);
  assert.equal(rules.sortOrderAtTop(null), 0);
  assert.equal(rules.sortOrderAtEnd(4), 5);
  assert.equal(rules.sortOrderAtEnd(undefined), 0);
});

/* ------------------------------------------------------------------------------------------------
 * Aulas novas e limites
 * ---------------------------------------------------------------------------------------------- */

test("aulas novas: link colado no nome vira video; linha vazia e pulada; provedor reconhecido no servidor", () => {
  const plan = rules.planLessonCreation([
    { title: "https://youtu.be/dQw4w9WgXcQ" },
    { title: "Boas-vindas" },
    { title: "", videoInput: "" },
    { title: "Aula com Vimeo", videoInput: "https://vimeo.com/123456789" },
    { title: "Link quebrado", videoInput: "https://exemplo.com/pagina" },
    { title: "  ", videoInput: "nao e link" }
  ]);

  assert.equal(plan.skipped, 2);
  assert.equal(plan.lessons.length, 4);

  const [fromLink, plain, vimeo, broken] = plan.lessons;
  assert.equal(fromLink.needsTitle, true);
  assert.equal(fromLink.title, "");
  assert.equal(fromLink.video.provider, "youtube");
  assert.equal(fromLink.video.assetId, "dQw4w9WgXcQ");

  assert.deepEqual(plain, { needsTitle: false, title: "Boas-vindas", video: null });
  assert.equal(vimeo.video.provider, "vimeo");
  assert.equal(broken.video, null);
  assert.equal(broken.title, "Link quebrado");
});

test("titulos do provedor cabem no limite e o padrao e 'Aula N'", () => {
  assert.equal(rules.clampTitle("  Uma   aula   longa  "), "Uma aula longa");
  assert.equal(rules.clampTitle("x".repeat(200)).length, 120);
  assert.ok(rules.clampTitle("x".repeat(200)).endsWith("…"));
  assert.equal(rules.fallbackLessonTitle(3), "Aula 3");
  assert.equal(rules.moduleEyebrow(3), "Módulo 03");
  assert.equal(rules.lessonCountLabel(1), "1 aula");
  assert.equal(rules.lessonCountLabel(0), "0 aulas");
});

test("limites de aulas por modulo e de modulos por produto viram 422 com frase util", () => {
  assert.doesNotThrow(() => rules.assertModuleCapacity(98, 2));
  assert.throws(() => rules.assertModuleCapacity(99, 2), (error) => error.status === 422 && /mais 1 aula/.test(error.message));
  assert.throws(() => rules.assertModuleCapacity(100, 1), (error) => error.status === 422 && /limite/.test(error.message));
  assert.doesNotThrow(() => rules.assertProductModuleCapacity(49));
  assert.throws(() => rules.assertProductModuleCapacity(50), (error) => error.status === 422);
  assert.equal(rules.restorableStatus("draft"), "draft");
  assert.equal(rules.restorableStatus("published"), "published");
  assert.equal(rules.restorableStatus(null), "published");
});

/* ------------------------------------------------------------------------------------------------
 * Quem pode ver -> colunas legadas
 * ---------------------------------------------------------------------------------------------- */

test("quem pode ver grava access_model + listing e deriva os campos legados sem 'Em breve'", () => {
  assert.deepEqual(rules.accessColumnsFor({ audience: "with_access", purchaseUrl: "https://pay.hotmart.com/x" }), {
    access_model: "closed",
    is_locked: true,
    listing: "listed",
    purchase_label: "Comprar",
    status: "Bloqueado"
  });
  assert.deepEqual(rules.accessColumnsFor({ audience: "all_students", purchaseUrl: "https://pay.hotmart.com/x" }), {
    access_model: "free",
    is_locked: false,
    listing: "listed",
    purchase_label: null,
    status: "Liberado"
  });
  assert.deepEqual(rules.accessColumnsFor({ audience: "hidden", purchaseLabel: "Quero entrar" }), {
    access_model: "closed",
    is_locked: true,
    listing: "hidden",
    purchase_label: "Quero entrar",
    status: "Bloqueado"
  });
  assert.equal(rules.accessColumnsFor({ audience: "with_access" }).purchase_label, null);
});

/* ------------------------------------------------------------------------------------------------
 * Mapeadores
 * ---------------------------------------------------------------------------------------------- */

function moduleRow(overrides) {
  return {
    id: "m1",
    image: null,
    owner_id: "course-ia",
    release_rule: null,
    sort_order: 0,
    status: "published",
    title: "Comece por aqui",
    updated_at: "2026-10-10T12:00:00.123456+00:00",
    ...overrides
  };
}

function lessonRow(overrides) {
  return {
    description: "",
    duration: "",
    id: "l1",
    image: null,
    module_id: "m1",
    release_rule: null,
    sort_order: 0,
    status: "published",
    title: "Aula",
    updated_at: "2026-10-10T12:00:00.123456+00:00",
    video_config: null,
    ...overrides
  };
}

test("arvore de conteudo: so nao excluidos, na ordem gravada, com posicoes e rotulos", () => {
  const modules = [
    moduleRow({ id: "m2", sort_order: 1, title: "Prática" }),
    moduleRow({ id: "m1", sort_order: 0 }),
    moduleRow({ id: "m-gone", sort_order: 2, status: "deleted" })
  ];
  const lessons = [
    lessonRow({ id: "l2", sort_order: 1, status: "draft", title: "Segunda" }),
    lessonRow({ id: "l1", sort_order: 0, title: "Primeira", video_config: { assetId: "dQw4w9WgXcQ", provider: "youtube" } }),
    lessonRow({ id: "l-gone", sort_order: 2, status: "deleted" }),
    lessonRow({ id: "l3", module_id: "m2", release_rule: { delayUnit: "dias", delayValue: "7", mode: "after_enrollment" } })
  ];

  const tree = mappers.buildModuleTree(modules, lessons);

  assert.deepEqual(tree.map((module) => [module.id, module.position]), [["m1", 1], ["m2", 2]]);
  assert.deepEqual(tree[0].lessons.map((lesson) => [lesson.id, lesson.position, lesson.status]), [
    ["l1", 1, "published"],
    ["l2", 2, "draft"]
  ]);
  assert.deepEqual(tree[0].lessons[0].video, { label: "YouTube", provider: "youtube" });
  assert.equal(tree[0].lessons[1].video, null);
  assert.equal(tree[0].updatedAt, "2026-10-10T12:00:00.123456+00:00", "updated_at volta igual para a checagem de concorrencia");
  assert.deepEqual(tree[1].lessons[0].release, { amount: 7, mode: "after_access", unit: "dias" });
  assert.equal(tree[1].lessons[0].releaseLabel, "Libera 7 dias depois do acesso");
  assert.deepEqual(mappers.countTree(tree), { lessons: 3, modules: 2, publishedLessons: 2 });
  assert.deepEqual(mappers.neighborLessonIds(tree, "l2"), { nextLessonId: "l3", previousLessonId: "l1" });
  assert.deepEqual(mappers.neighborLessonIds(tree, "l1"), { nextLessonId: "l2", previousLessonId: null });
  assert.equal(mappers.lessonPositionLabel(tree[0], 1, 2), "Módulo 1, aula 1 de 2");
});

test("contagem por dono soma so aula e modulo publicados como 'publicadas'", () => {
  const counts = mappers.countLessonsByOwner(
    [
      { id: "m1", owner_id: "a", status: "published" },
      { id: "m2", owner_id: "a", status: "draft" },
      { id: "m3", owner_id: "b", status: "deleted" },
      { id: "m4", owner_id: null, status: "published" }
    ],
    [
      { module_id: "m1", status: "published" },
      { module_id: "m1", status: "draft" },
      { module_id: "m1", status: "deleted" },
      { module_id: "m2", status: "published" },
      { module_id: "m3", status: "published" }
    ]
  );

  assert.deepEqual(counts.get("a"), { lessonsPublished: 1, lessonsTotal: 3, modules: 2 });
  assert.equal(counts.has("b"), false);

  const published = mappers.publishedLessonRows(
    [moduleRow({ id: "m1" }), moduleRow({ id: "m2", status: "draft" })],
    [lessonRow({ id: "x" }), lessonRow({ id: "y", status: "draft" }), lessonRow({ id: "z", module_id: "m2" })]
  );
  assert.deepEqual(published.map((lesson) => lesson.id), ["x"]);
});

test("linha da lista de produtos vira DTO com rotulos, 'Em breve' calculado e Estudando sem dado", () => {
  const item = mappers.mapProductListRow({
    access_model: "closed",
    accent: "roxo",
    id: "course-ia",
    image: "  ",
    kind: "Curso",
    lessons_published: 3,
    lessons_total: 5,
    listing: "listed",
    publication_status: "published",
    purchase_url: null,
    students_with_access: 12,
    title: "IA na prática",
    total_count: 40,
    updated_at: "2026-10-10T12:00:00+00:00"
  });

  assert.equal(item.format, "curso");
  assert.equal(item.formatLabel, "Curso");
  assert.equal(item.situationLabel, "Publicado");
  assert.equal(item.audience, "with_access");
  assert.equal(item.comingSoon, true);
  assert.equal(item.coverUrl, null);
  assert.equal(item.accent, "roxo");
  assert.equal(item.studentsWithAccess, 12);
  assert.equal(item.studyingLast7d, null);
  assert.equal(mappers.mapProductListRow({ ...item, kind: "Aula" }), null);

  const hidden = mappers.mapProductListRow({ access_model: "closed", id: "x", kind: "Produto", listing: "hidden", publication_status: "draft", title: "Apostila", updated_at: "" });
  assert.equal(hidden.format, "material");
  assert.equal(hidden.audience, "hidden");
  assert.equal(hidden.comingSoon, false);
  assert.equal(hidden.lessonsTotal, 0);
});

test("cabecalho do produto: formacao pai, link de 'Ver como aluno' e linha que nao e produto", () => {
  const row = {
    access_label: "Curso",
    access_model: "free",
    bucket: "courses",
    commerce_scope: "included_content",
    description: null,
    eyebrow: "Curso",
    id: "course-1",
    image: "https://cdn.exemplo.com/capa.webp",
    instructor: null,
    kind: "Curso",
    level_label: null,
    listing: "listed",
    max_students: null,
    publication_status: "draft",
    purchase_label: null,
    purchase_target: "same_tab",
    purchase_url: null,
    release_rule: null,
    sort_order: 0,
    title: "Curso 1",
    updated_at: "2026-10-10T12:00:00+00:00"
  };
  const header = mappers.buildProductHeader(row, { accent: "ciano" }, { id: "formation-1", title: "Formação" });

  assert.equal(header.audience, "all_students");
  assert.equal(header.accent, "ciano");
  assert.equal(header.situationLabel, "Rascunho");
  assert.deepEqual(header.parentFormation, { id: "formation-1", title: "Formação" });
  assert.equal(header.studentPreviewHref, "/conteudo/course-1?accessPreview=producer");
  assert.equal(header.coverUrl, "https://cdn.exemplo.com/capa.webp");
  assert.equal(mappers.buildProductHeader({ ...row, kind: "Aula" }, {}, null), null);
  assert.equal(mappers.productHrefFor("course 1"), "/admin/produtos/course%201");
});

test("pequenos tradutores de configuracao e de compra", () => {
  assert.equal(mappers.heroUrlOf({ hero: { mediaSrc: " https://cdn/hero.webp ", mediaType: "image" } }), "https://cdn/hero.webp");
  assert.equal(mappers.heroUrlOf({ hero: { mediaSrc: "https://cdn/hero.mp4", mediaType: "video" } }), null);
  assert.equal(mappers.heroUrlOf({ hero: [] }), null);
  // Cantos do banner por produto: so "rounded" e "soft" valem; o resto segue a area.
  assert.equal(mappers.heroCornersOf({ hero: { corners: "rounded", mediaSrc: "https://cdn/hero.webp" } }), "rounded");
  assert.equal(mappers.heroCornersOf({ hero: { corners: "soft" } }), "soft");
  assert.equal(mappers.heroCornersOf({ hero: { corners: "inherit" } }), "inherit");
  assert.equal(mappers.heroCornersOf({ hero: { corners: "oval" } }), "inherit");
  assert.equal(mappers.heroCornersOf({}), "inherit");
  assert.equal(mappers.heroCornersOf(null), "inherit");
  assert.equal(mappers.parentFormationIdOf({ parentFormationId: " formation-1 " }), "formation-1");
  assert.equal(mappers.parentFormationIdOf({ parentFormationId: 3 }), null);
  assert.equal(mappers.customPurchaseLabelOf("Comprar"), null, "'Comprar' e o padrao derivado, nao texto proprio");
  assert.equal(mappers.customPurchaseLabelOf(" Garantir vaga "), "Garantir vaga");
  assert.equal(mappers.instructorNameOf({ name: "  " }), null);
  assert.equal(mappers.lessonStatusOf("deleted"), "draft");
});

test("duracao: le formatos gravados, soma so o que conhece e nunca inventa", () => {
  assert.equal(mappers.parseDurationSeconds("6:12"), 372);
  assert.equal(mappers.parseDurationSeconds("1:02:03"), 3_723);
  assert.equal(mappers.parseDurationSeconds("15 min"), 900);
  assert.equal(mappers.parseDurationSeconds("1 h 20 min"), 4_800);
  assert.equal(mappers.parseDurationSeconds("2h"), 7_200);
  assert.equal(mappers.parseDurationSeconds("Duracao nao informada"), null);
  assert.equal(mappers.parseDurationSeconds("Duração não informada"), null);
  assert.equal(mappers.parseDurationSeconds("ao vivo"), null);
  assert.equal(mappers.parseDurationSeconds("1:75"), null);

  assert.equal(mappers.formatDurationTotal(["1:00:00", "2:20:00", "", null, "ao vivo"]), "3 h 20 min");
  assert.equal(mappers.formatDurationTotal(["45 min"]), "45 min");
  assert.equal(mappers.formatDurationTotal(["2h"]), "2 h");
  assert.equal(mappers.formatDurationTotal(["", "Duracao nao informada"]), null);

  assert.equal(mappers.formatClockDuration(372), "6:12");
  assert.equal(mappers.formatClockDuration(3_723), "1:02:03");
  assert.equal(mappers.formatClockDuration(0), null);
  assert.equal(mappers.durationLabelOf(" 12:00 "), "12:00");
});

test("campo de video e miniatura a partir do que esta gravado", () => {
  assert.equal(mappers.videoInputOf({ assetId: "dQw4w9WgXcQ", provider: "youtube" }), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(mappers.videoInputOf({ assetId: "123456", provider: "vimeo" }), "https://vimeo.com/123456");
  assert.equal(mappers.videoInputOf(null), "");
  assert.equal(
    mappers.lessonThumbnailOf(null, { assetId: "dQw4w9WgXcQ", provider: "youtube" }),
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
  );
  assert.equal(mappers.lessonThumbnailOf("https://cdn/thumb.jpg", null), "https://cdn/thumb.jpg");
  assert.equal(mappers.lessonThumbnailOf("data:image/png;base64,AAAA", null), null, "data URL nunca vira miniatura");

  assert.equal(mappers.shouldRefreshLessonThumbnail(null), true);
  assert.equal(mappers.shouldRefreshLessonThumbnail("https://i.ytimg.com/vi/abc/hqdefault.jpg"), true);
  assert.equal(mappers.shouldRefreshLessonThumbnail("https://i.vimeocdn.com/video/1.jpg"), true);
  assert.equal(mappers.shouldRefreshLessonThumbnail("https://cdn.exemplo.com/lessons/l1/thumb.webp"), false, "imagem propria fica");
});

/* ------------------------------------------------------------------------------------------------
 * Sugestoes do provedor (oEmbed)
 * ---------------------------------------------------------------------------------------------- */

test("oEmbed so para YouTube e Vimeo, pelos enderecos oficiais", () => {
  assert.equal(
    videoMeta.oEmbedUrlFor({ assetId: "dQw4w9WgXcQ", provider: "youtube" }),
    "https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ"
  );
  assert.equal(
    videoMeta.oEmbedUrlFor({ assetId: "123", provider: "vimeo", url: "https://vimeo.com/123" }),
    "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F123"
  );
  assert.equal(videoMeta.oEmbedUrlFor({ provider: "bunny", url: "https://iframe.mediadelivery.net/embed/1/2" }), null);
  assert.equal(videoMeta.oEmbedUrlFor(null), null);
});

test("resposta oEmbed vira sugestoes seguras; campos ruins viram null", () => {
  assert.deepEqual(
    videoMeta.parseOEmbedPayload({ duration: 372.4, thumbnail_url: "https://i.vimeocdn.com/x.jpg", title: "  Aula   1  " }),
    { durationLabel: "6:12", durationSeconds: 372, suggestedTitle: "Aula 1", thumbnailUrl: "https://i.vimeocdn.com/x.jpg" }
  );
  assert.deepEqual(
    videoMeta.parseOEmbedPayload({ duration: "10", thumbnail_url: "http://inseguro/x.jpg", title: 3 }),
    videoMeta.EMPTY_VIDEO_METADATA
  );
  assert.deepEqual(videoMeta.parseOEmbedPayload(null), videoMeta.EMPTY_VIDEO_METADATA);
});

test("busca de sugestoes nunca lanca: falha de rede, status ruim ou JSON invalido viram nulls", async () => {
  const youtube = { assetId: "dQw4w9WgXcQ", provider: "youtube" };
  const okFetch = async () => new Response(JSON.stringify({ thumbnail_url: "https://i.ytimg.com/vi/x/hq.jpg", title: "Título" }), { status: 200 });
  const notFound = async () => new Response("nope", { status: 404 });
  const broken = async () => new Response("{", { status: 200 });
  const offline = async () => {
    throw new TypeError("fetch failed");
  };
  const huge = async () => new Response("x".repeat(70 * 1024), { status: 200 });

  assert.equal((await videoMeta.fetchVideoMetadata(youtube, okFetch)).suggestedTitle, "Título");
  assert.deepEqual(await videoMeta.fetchVideoMetadata(youtube, notFound), videoMeta.EMPTY_VIDEO_METADATA);
  assert.deepEqual(await videoMeta.fetchVideoMetadata(youtube, broken), videoMeta.EMPTY_VIDEO_METADATA);
  assert.deepEqual(await videoMeta.fetchVideoMetadata(youtube, offline), videoMeta.EMPTY_VIDEO_METADATA);
  assert.deepEqual(await videoMeta.fetchVideoMetadata(youtube, huge), videoMeta.EMPTY_VIDEO_METADATA);

  let calls = 0;
  const counting = async () => {
    calls += 1;
    return new Response(JSON.stringify({ title: `Aula ${calls}` }), { status: 200 });
  };
  const batch = await videoMeta.fetchVideoMetadataBatch([youtube, null, youtube], 2, counting);
  assert.equal(calls, 2, "sem video nao busca nada");
  assert.equal(batch[1].suggestedTitle, null);
  assert.ok(batch[0].suggestedTitle && batch[2].suggestedTitle);
});

/* ------------------------------------------------------------------------------------------------
 * Schemas acrescentados pela frente A
 * ---------------------------------------------------------------------------------------------- */

test("importar playlist aceita o contrato legado mais 'Quem pode ver' e recusa imagem que nao e WebP", () => {
  const base = {
    accessModel: "closed",
    coursePresentationMode: "lesson_playlist",
    description: "",
    image: "",
    moduleRanges: [],
    organizationMode: "automatic",
    playlistUrl: "https://www.youtube.com/playlist?list=PL1234567890abcdef",
    title: "Curso importado"
  };

  assert.equal(schemas.importPlaylistSchema.parse(base).audience, undefined);
  assert.equal(schemas.importPlaylistSchema.parse({ ...base, audience: "hidden" }).audience, "hidden");
  assert.equal(schemas.importPlaylistSchema.safeParse({ ...base, image: "data:image/png;base64,AAAA" }).success, false);
  assert.equal(schemas.importPlaylistSchema.safeParse({ ...base, image: dataUrlFromHex(VP8_LOSSY_720x1040) }).success, true);
  assert.equal(schemas.importPlaylistSchema.safeParse({ ...base, playlistUrl: "https://exemplo.com" }).success, false);
  assert.equal(schemas.previewPlaylistSchema.safeParse({ playlistUrl: "" }).success, false);
  assert.equal(schemas.productIdInputSchema.safeParse({ id: "course-ia" }).success, true);
  assert.equal(schemas.productIdInputSchema.safeParse({ id: "../etc" }).success, false);
});

test("destaque em video: heroUrlOf devolve a capa, heroVideoUrlOf o link e o schema so aceita arquivo direto", () => {
  const video = { hero: { mediaSrc: "https://cdn/hero.mp4", mediaType: "video", poster: " https://cdn/capa.webp " } };
  assert.equal(mappers.heroUrlOf(video), "https://cdn/capa.webp");
  assert.equal(mappers.heroVideoUrlOf(video), "https://cdn/hero.mp4");
  assert.equal(mappers.heroVideoUrlOf({ hero: { mediaSrc: "https://cdn/hero.webp", mediaType: "image" } }), null);
  assert.equal(mappers.heroVideoUrlOf(null), null);
  assert.equal(schemas.setProductHeroVideoSchema.safeParse({ id: "curso-1", videoUrl: "https://vz-1.b-cdn.net/abc/play_720p.mp4?x=1" }).success, true);
  assert.equal(schemas.setProductHeroVideoSchema.safeParse({ id: "curso-1", videoUrl: null }).success, true);
  const youtube = schemas.setProductHeroVideoSchema.safeParse({ id: "curso-1", videoUrl: "https://www.youtube.com/watch?v=abc" });
  assert.equal(youtube.success, false);
  assert.equal(schemas.setProductHeroVideoSchema.safeParse({ id: "curso-1", videoUrl: "http://cdn/hero.mp4" }).success, false);
});

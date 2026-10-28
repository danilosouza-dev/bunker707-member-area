import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Vitrine: produto que saiu de venda (excluido ou fora de venda) nunca trava a publicacao. A regra e
// uma so (pruneHomeSectionRefs em src/server/storefront/model.ts), a mesma que a home do aluno ja
// aplica: sai da escolha manual, a fileira de modulos dele sai inteira e a escolha manual que fica
// vazia por causa disso sai tambem. Usada na Vitrine, em publishHomeSections e ao excluir um produto.

const model = await import("../src/server/storefront/model.ts");
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

function product(id, overrides = {}) {
  return {
    accent: "vermelho",
    coverUrl: null,
    formatLabel: "Curso",
    id,
    kind: "Curso",
    listed: true,
    modulesCount: 2,
    sellable: true,
    situation: "published",
    title: id,
    upcoming: false,
    ...overrides
  };
}

const products = [
  product("curso-a"),
  product("curso-b"),
  product("curso-c"),
  product("curso-interno", { sellable: false }),
  product("breve-1", { sellable: false, upcoming: true })
];
const productsById = new Map(products.map((item) => [item.id, item]));

function section(overrides) {
  return {
    contentSource: "sellable_products",
    id: "showcase",
    isActive: true,
    itemIds: [],
    layout: "vertical",
    order: 0,
    sectionType: "content_carousel",
    title: "Produtos à venda",
    visibility: "all",
    ...overrides
  };
}

function manual(id, itemIds, overrides = {}) {
  return section({ contentSource: "manual", id, itemIds, title: id, ...overrides });
}

function moduleRow(id, sourceContentId, overrides = {}) {
  return section({
    contentSource: "selected_content_structure",
    id,
    layout: "compact",
    sectionType: "content_structure",
    sourceContentId,
    title: id,
    ...overrides
  });
}

test("produto excluido sai da escolha manual; o resto da fileira fica na mesma ordem", () => {
  const result = model.pruneUnavailableSectionRefs(
    [section({ order: 0 }), manual("Para você", ["curso-a", "excluido", "curso-b", "curso-c"], { order: 1 })],
    productsById
  );

  assert.deepEqual(result.sections.map((item) => [item.id, item.order, item.itemIds]), [
    ["showcase", 0, []],
    ["Para você", 1, ["curso-a", "curso-b", "curso-c"]]
  ]);
  assert.deepEqual(result.removed, [{ productIds: ["excluido"], sectionId: "Para você", sectionRemoved: false, title: "Para você" }]);
});

test("produto que saiu de venda (existe, mas nao esta a venda) sai do mesmo jeito", () => {
  const result = model.pruneUnavailableSectionRefs(
    [manual("Novidades", ["breve-1", "curso-a", "curso-interno", "breve-1"])],
    productsById
  );

  assert.deepEqual(result.sections[0].itemIds, ["curso-a"]);
  assert.deepEqual(result.removed[0].productIds, ["breve-1", "curso-interno"], "cada produto conta uma vez");
});

test("fileira de modulos de produto excluido ou fora de venda sai inteira", () => {
  const result = model.pruneUnavailableSectionRefs(
    [
      moduleRow("modulos-a", "curso-a", { order: 0 }),
      moduleRow("modulos-excluido", "excluido", { order: 1 }),
      moduleRow("modulos-interno", "curso-interno", { order: 2 }),
      moduleRow("modulos-sem-produto", undefined, { order: 3 }),
      section({ order: 4 })
    ],
    productsById
  );

  assert.deepEqual(result.sections.map((item) => [item.id, item.order]), [
    ["modulos-a", 0],
    ["showcase", 1]
  ]);
  assert.deepEqual(
    result.removed.map((item) => [item.sectionId, item.productIds, item.sectionRemoved]),
    [
      ["modulos-excluido", ["excluido"], true],
      ["modulos-interno", ["curso-interno"], true],
      ["modulos-sem-produto", [], true]
    ]
  );
});

test("escolha manual que esvazia pela limpeza sai; a que o produtor deixou vazia fica", () => {
  const result = model.pruneUnavailableSectionRefs(
    [manual("so-mortos", ["excluido", "breve-1"], { order: 0 }), manual("vazia", [], { order: 1 })],
    productsById
  );

  assert.deepEqual(result.sections.map((item) => item.id), ["vazia"]);
  assert.deepEqual(result.removed, [{ productIds: ["excluido", "breve-1"], sectionId: "so-mortos", sectionRemoved: true, title: "so-mortos" }]);
  assert.deepEqual(
    model.findSectionProblems(result.sections, productsById).map((problem) => problem.message),
    ["“vazia” não tem nenhum produto escolhido."],
    "fileira manual vazia continua sendo problema do produtor"
  );
});

test("tudo a venda: nada muda e nada sai", () => {
  const sections = [
    section({ id: "b", order: 1 }),
    manual("a", ["curso-c", "curso-a"], { order: 0 }),
    moduleRow("modulos", "curso-b", { order: 2 }),
    section({ contentSource: "recent_lessons", id: "continue", layout: "continue", order: 3, sectionType: "continue_watching" })
  ];
  const result = model.pruneUnavailableSectionRefs(sections, productsById);

  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.sections, model.normalizeSectionOrder(sections));
  assert.equal(model.describeSectionCleanup(result.removed), null);
});

test("aviso neutro e curto dizendo o que saiu", () => {
  const one = model.pruneUnavailableSectionRefs([manual("x", ["curso-a", "excluido"], { title: "Para você" })], productsById);
  assert.equal(model.describeSectionCleanup(one.removed), "1 produto que não está mais à venda saiu de “Para você”. Publique para salvar.");

  const many = model.pruneUnavailableSectionRefs(
    [
      manual("x", ["curso-a", "excluido", "breve-1"], { order: 0, title: "Para você" }),
      manual("y", ["curso-b", "excluido"], { order: 1, title: "Destaques" }),
      moduleRow("z", "excluido", { order: 2, title: "Prompts" })
    ],
    productsById
  );
  assert.equal(
    model.describeSectionCleanup(many.removed),
    "2 produtos que não estão mais à venda saíram de “Para você” e “Destaques”. A fileira “Prompts” saiu: nenhum produto dela está mais à venda. Publique para salvar."
  );
});

test("aviso conta cada produto uma vez, mesmo se ele estava em varias fileiras", () => {
  const result = model.pruneUnavailableSectionRefs(
    [
      manual("x", ["curso-a", "excluido"], { order: 0, title: "Para você" }),
      manual("y", ["curso-b", "excluido"], { order: 1, title: "Destaques" })
    ],
    productsById
  );

  assert.equal(
    model.describeSectionCleanup(result.removed),
    "1 produto que não está mais à venda saiu de “Para você” e “Destaques”. Publique para salvar."
  );
});

test("aviso com muitas fileiras removidas diz so a quantidade, sem repetir “fileiras”", () => {
  const rows = (count) =>
    Array.from({ length: count }, (_, index) => moduleRow(`m${index}`, "excluido", { order: index, title: `Módulos ${index + 1}` }));

  assert.equal(
    model.describeSectionCleanup(model.pruneUnavailableSectionRefs(rows(4), productsById).removed),
    "4 fileiras saíram: nenhum produto delas está mais à venda. Publique para salvar."
  );
  assert.equal(
    model.describeSectionCleanup(model.pruneUnavailableSectionRefs(rows(3), productsById).removed),
    "As fileiras “Módulos 1”, “Módulos 2” e “Módulos 3” saíram: nenhum produto delas está mais à venda. Publique para salvar."
  );
  assert.equal(
    model.describeSectionCleanup(model.pruneUnavailableSectionRefs(rows(2), productsById).removed),
    "As fileiras “Módulos 1” e “Módulos 2” saíram: nenhum produto delas está mais à venda. Publique para salvar."
  );
});

test("bug do produtor: excluir outra fileira publica mesmo com produto excluido em “Para você”", () => {
  const stored = [
    section({ order: 0 }),
    manual("para-voce", ["curso-a", "curso-b", "curso-c", "excluido"], { order: 1, title: "Para você" }),
    manual("outra", ["curso-a"], { order: 2, title: "Outra" })
  ];
  // Editor: o rascunho nasce limpo; o produtor exclui "Outra"; publicar nao acusa nada.
  const drafts = model.pruneUnavailableSectionRefs(stored, productsById).sections.filter((item) => item.id !== "outra");

  assert.deepEqual(model.findSectionProblems(drafts, productsById), []);
  assert.deepEqual(model.findSectionProblems(stored, productsById), [], "nem o dado velho sem limpar trava");
  assert.equal(model.describeSection(drafts[1], productsById), "Escolha manual · 3 produtos", "a lista diz o mesmo que a previa");
});

test("ao excluir um produto: so ele sai (a regra recebe quem continua a venda)", () => {
  const result = model.pruneHomeSectionRefs(
    [
      manual("para-voce", ["curso-a", "excluido"], { order: 0 }),
      manual("so-ele", ["excluido"], { order: 1 }),
      moduleRow("modulos", "excluido", { order: 2 }),
      manual("outro-morto", ["fora-de-venda-antigo"], { order: 3 })
    ],
    (id) => id !== "excluido"
  );

  assert.deepEqual(result.sections.map((item) => [item.id, item.itemIds]), [
    ["para-voce", ["curso-a"]],
    ["outro-morto", ["fora-de-venda-antigo"]]
  ]);
  assert.deepEqual(result.removed.map((item) => item.sectionId), ["para-voce", "so-ele", "modulos"]);
});

test("servidor: publishHomeSections limpa produto fora de venda em vez de recusar", async () => {
  const store = await read("../src/server/db/platform-store.ts");
  const validate = store.slice(
    store.indexOf("function validateHomeSectionConfigs"),
    store.indexOf("export type PublishHomeSectionsOptions")
  );

  // A mesma limpeza da Vitrine, importada do modelo (o import pode trazer outras regras do modelo junto).
  assert.match(store, /import \{[^}]*\bpruneHomeSectionRefs\b[^}]*\} from "@\/server\/storefront\/model";/);
  assert.match(validate, /const \{ sections \} = pruneHomeSectionRefs\(configs, \(itemId\) => sellableIds\.has\(itemId\)\);/);
  assert.match(validate, /for \(const section of sections\)/);
  assert.match(validate, /return normalizeHomeSectionOrder\(sections\.map/);
  assert.doesNotMatch(validate, /A selecao manual contem um produto invalido/);
  assert.doesNotMatch(validate, /Escolha um curso ou formacao valido/);
  // Erros estruturais continuam.
  assert.match(validate, /Cada secao precisa ter um identificador unico\./);
  assert.match(validate, /O titulo da secao e obrigatorio\./);
  assert.match(validate, /nao e valido para esta secao/);
  assert.match(validate, /Selecao manual so pode ser usada em carrosseis de conteudo\./);
  assert.match(validate, /Cada fonte automatica pode aparecer apenas uma vez\./);
});

test("servidor: excluir produto tira ele da vitrine sem desfazer a exclusao se a limpeza falhar", async () => {
  const store = await read("../src/server/db/platform-store.ts");
  const helper = store.slice(
    store.indexOf("async function removeProductFromHomeSections"),
    store.indexOf("export async function deleteContentItem")
  );
  const remove = store.slice(
    store.indexOf("export async function deleteContentItem"),
    store.indexOf("export async function reorderContentItems")
  );

  assert.match(helper, /const current = await readPlatformSetting\("homeSections"\);/);
  assert.match(helper, /if \(!current\.exists\) \{\s*return null;\s*\}/, "vitrine nunca publicada: nao cria a chave");
  assert.match(helper, /pruneHomeSectionRefs\(normalizeHomeSectionConfigs\(current\.value\), \(itemId\) => itemId !== productId\)/);
  assert.match(helper, /if \(pruned\.removed\.length === 0\) \{\s*return null;\s*\}/, "nada a tirar: nao grava");
  assert.match(helper, /writePlatformSettingGuarded\("homeSections", pruned\.sections, current\.updatedAt\)/, "grava com a versao lida");
  assert.match(helper, /error instanceof MemberAreaConflictError\) \|\| attempt >= 1/, "outra tela gravou no meio: rele e tenta uma vez");

  const contentDeleted = remove.indexOf('throwIfSupabaseError(deleteContentResult.error, "Erro removendo conteudo")');
  const cleanup = remove.indexOf("await removeProductFromHomeSections(itemId)");
  assert.ok(contentDeleted > 0 && cleanup > contentDeleted, "limpa a vitrine depois que o produto saiu do banco");
  assert.match(
    remove,
    /try \{\s*const homeSections = await removeProductFromHomeSections\(itemId\);[\s\S]*?\} catch \(error\) \{\s*console\.error\("\[vitrine\] limpeza das fileiras ao excluir produto", error\);\s*\}/
  );
});

test("Vitrine: rascunho nasce limpo, publicar limpa antes de conferir e o aviso nao e erro", async () => {
  const editor = await read("../src/components/admin/v2/storefront/vitrine-editor.tsx");
  const publishStart = editor.indexOf("async function publish()");
  const publish = editor.slice(publishStart, editor.indexOf("router.refresh();", publishStart));

  assert.match(editor, /useState\(\(\) => pruneUnavailableSectionRefs\(published, productsById\)\.sections\)/);
  assert.match(editor, /function discard\(\) \{\s*setDrafts\(cleaned\.sections\);/);
  assert.match(publish, /const sections = pruneUnavailableSectionRefs\(drafts, productsById\)\.sections;\s*const found = findSectionProblems\(sections, productsById\);/);
  assert.match(publish, /expectedUpdatedAt: configured \? version : null, sections \}/);
  assert.match(editor, /describeSectionCleanup\(cleaned\.removed\)/);

  const notice = editor.slice(editor.indexOf("{cleanupNotice ? ("), editor.indexOf("{error?.conflict ? ("));
  assert.match(notice, /role="status"/);
  assert.doesNotMatch(notice, /ErrorBanner|error/i, "aviso neutro, nao vermelho");
});

test("Vitrine: so a limpeza pendente nao parece mudanca do produtor nem oferece Descartar", async () => {
  const editor = await read("../src/components/admin/v2/storefront/vitrine-editor.tsx");
  const saveBar = await read("../src/components/admin/v2/save-bar.tsx");
  const bar = editor.slice(editor.indexOf("<SaveBar"), editor.indexOf("/>", editor.indexOf("<SaveBar")));

  assert.match(bar, /open=\{dirty\}/, "a limpeza ainda precisa ser publicada");
  assert.match(bar, /message=\{ownChanges \? "Alterações não publicadas" : cleanupMessage\}/);
  assert.match(bar, /onDiscard=\{ownChanges \? discard : undefined\}/, "sem mudanca do produtor, nada para descartar");
  assert.match(editor, /"Produto fora de venda removido · publique para salvar"/);
  assert.match(editor, /"Produtos fora de venda removidos · publique para salvar"/);

  assert.match(saveBar, /onDiscard\?: \(\) => void;/);
  assert.match(saveBar, /\{onDiscard \? \(\s*<Button/, "sem onDiscard a barra esconde o Descartar");
});

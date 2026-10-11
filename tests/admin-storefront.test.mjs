import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Area de membros (Vitrine e Marca): mapeador do carregador e regras puras dos editores
// (src/server/storefront/model.ts). Sem banco: as linhas abaixo tem o formato das consultas de queries.ts.

const model = await import("../src/server/storefront/model.ts");

const contentRows = [
  { bucket: "formations", commerce_scope: "sellable_product", id: "form-ia", image: "https://cdn.exemplo.com/f.webp", kind: "Formacao", listing: "listed", publication_status: "published", sort_order: 2, title: "Formação IA" },
  { bucket: "courses", commerce_scope: "sellable_product", id: "curso-prompts", image: "", kind: "Curso", listing: "listed", publication_status: "published", sort_order: 1, title: "Prompts do Zero" },
  { bucket: "courses", commerce_scope: "sellable_product", id: "curso-oculto", image: null, kind: "Curso", listing: "hidden", publication_status: "published", sort_order: 3, title: "Curso Oculto" },
  { bucket: "courses", commerce_scope: "sellable_product", id: "curso-rascunho", image: null, kind: "Curso", publication_status: "draft", sort_order: 4, title: "Curso Rascunho" },
  { bucket: "upcoming_products", commerce_scope: "sellable_product", id: "breve-1", image: null, kind: "Produto", listing: null, publication_status: "published", sort_order: 0, title: "Kit em breve" },
  { bucket: "courses", commerce_scope: "learning_content", id: "curso-interno", image: null, kind: "Curso", listing: "listed", publication_status: "published", sort_order: 5, title: "Curso interno" },
  { bucket: "recent_lessons", commerce_scope: null, id: "aula-solta", image: null, kind: "Aula", listing: "listed", publication_status: "published", sort_order: 0, title: "Aula" }
];

const settingsRows = [
  { accent: "roxo", content_id: "curso-prompts", home_module_section: { enabled: true } },
  { accent: "nao-existe", content_id: "form-ia", home_module_section: { enabled: true } },
  { accent: null, content_id: "curso-oculto", home_module_section: { enabled: true } }
];

const moduleRows = [{ owner_id: "curso-prompts" }, { owner_id: "curso-prompts" }, { owner_id: "curso-oculto" }, { owner_id: null }];

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

function editorData(platformRows = []) {
  return model.mapStorefrontEditorData({ contentRows, moduleRows, platformRows, settingsRows });
}

test("produtos da vitrine: so formacao, bootcamp, curso e em breve, com cor, capa, oculto e situacao", () => {
  const { products } = editorData();
  const byId = new Map(products.map((product) => [product.id, product]));

  assert.deepEqual(
    products.map((product) => product.id),
    ["breve-1", "curso-prompts", "form-ia", "curso-oculto", "curso-rascunho", "curso-interno"],
    "ordem de sort_order; aula solta fica de fora"
  );

  const prompts = byId.get("curso-prompts");
  assert.equal(prompts.accent, "roxo");
  assert.equal(prompts.coverUrl, null, "capa vazia vira null");
  assert.equal(prompts.modulesCount, 2);
  assert.equal(prompts.sellable, true);
  assert.equal(prompts.formatLabel, "Curso");

  assert.equal(byId.get("form-ia").coverUrl, "https://cdn.exemplo.com/f.webp");
  assert.equal(byId.get("form-ia").accent, model.mapStorefrontEditorData({ contentRows, moduleRows, platformRows: [], settingsRows }).products.find((p) => p.id === "form-ia").accent, "cor estavel");
  assert.equal(byId.get("curso-oculto").listed, false);
  assert.equal(byId.get("curso-rascunho").listed, true, "sem a coluna listing = listado");
  assert.equal(byId.get("curso-rascunho").situation, "draft");
  assert.equal(byId.get("breve-1").upcoming, true);
  assert.equal(byId.get("breve-1").sellable, false, "em breve nao entra em escolha manual");
  assert.equal(byId.get("breve-1").formatLabel, "Material");
  assert.equal(byId.get("curso-interno").sellable, false, "curso interno nao e vendido sozinho");
});

test("vitrine nunca publicada: ordem padrao com os destaques ligados nos produtos", () => {
  const data = editorData();

  assert.equal(data.sectionsConfigured, false);
  assert.equal(data.sectionsUpdatedAt, null, "nunca publicada: sem versao");
  assert.deepEqual(
    data.sections.map((item) => [item.id, item.contentSource, item.order]),
    [
      ["continue-watching", "recent_lessons", 0],
      ["my-purchases", "entitlement_products", 1],
      ["course-modules-curso-prompts", "selected_content_structure", 2],
      ["showcase", "sellable_products", 3],
      ["upcoming", "upcoming_products", 4]
    ],
    "formacao nao tem destaque padrao; oculto e sem modulos tambem ficam de fora"
  );

  const structure = data.sections[2];
  assert.equal(structure.sourceContentId, "curso-prompts");
  assert.equal(structure.layout, "compact");
  assert.equal(structure.subtitle, "Cursos Online");
  assert.equal(data.sections[0].visibility, "students");
  assert.equal(data.sections[4].title, "Em breve na Bunker707");
});

test("vitrine publicada: le as fileiras gravadas, descarta as invalidas e normaliza a ordem", () => {
  const data = editorData([
    {
      key: "homeSections",
      updated_at: "2026-10-11T09:00:00.123456+00:00",
      value: [
        section({ id: "b", order: 5, title: "Segunda" }),
        { id: "quebrada", title: "Sem tipo" },
        section({ contentSource: "manual", id: "a", itemIds: ["curso-prompts", 3], order: 1, title: "Primeira" }),
        section({ id: "c", isActive: false, layout: "diagonal", order: 2 })
      ]
    }
  ]);

  assert.equal(data.sectionsConfigured, true);
  assert.equal(data.sectionsUpdatedAt, "2026-10-11T09:00:00.123456+00:00", "versao volta igual para a checagem ao publicar");
  assert.deepEqual(
    data.sections.map((item) => [item.id, item.order, item.itemIds]),
    [
      ["a", 0, ["curso-prompts"]],
      ["b", 1, []]
    ]
  );
});

test("marca: banner e logo seguem os padroes do servidor", () => {
  assert.deepEqual(model.mapStorefrontBrand([]), {
    hero: { enabled: true, image: model.DEFAULT_HERO_IMAGE, mediaType: "image" },
    logoImage: model.DEFAULT_LOGO_IMAGE
  });

  const brand = model.mapStorefrontBrand([
    { key: "hero", value: { enabled: false, image: "https://cdn.exemplo.com/h.webp", mediaType: "image" } },
    { key: "branding", value: { logoImage: null } }
  ]);
  assert.equal(brand.hero.enabled, false);
  assert.equal(brand.hero.image, "https://cdn.exemplo.com/h.webp");
  assert.equal(brand.logoImage, null, "logo tirada continua tirada");

  assert.equal(model.normalizeHero({ enabled: true, image: "  " }).enabled, false, "banner sem imagem nao aparece");
  assert.equal(model.normalizeHero({ image: "/v.mp4", mediaType: "video" }).mediaType, "video");
  assert.equal(model.normalizeLogo({ logoImage: "   " }, true), model.DEFAULT_LOGO_IMAGE);
});

test("mover fileiras: Alt+setas, arrastar e limites", () => {
  const sections = [section({ id: "a", order: 0 }), section({ id: "b", order: 1 }), section({ id: "c", order: 2 })];
  const ids = (list) => list.map((item) => `${item.id}${item.order}`).join(",");

  assert.equal(ids(model.moveSection(sections, "c", -1)), "a0,c1,b2");
  assert.equal(ids(model.moveSection(sections, "a", -1)), "a0,b1,c2", "primeira nao sobe");
  assert.equal(ids(model.moveSection(sections, "c", 1)), "a0,b1,c2", "ultima nao desce");
  assert.equal(ids(model.moveSectionTo(sections, "a", 2)), "b0,c1,a2");
  assert.equal(ids(model.moveSectionTo(sections, "x", 0)), "a0,b1,c2", "id desconhecido");
});

test("criar e editar fileira: validacao igual a do servidor e textos padrao", () => {
  const data = editorData();
  const productsById = new Map(data.products.map((product) => [product.id, product]));
  const sections = data.sections;
  const context = { productsById, sections };

  const automaticDuplicate = { ...model.emptySectionDraft(sections), kind: "automatic", source: "sellable_products" };
  assert.equal(model.validateSectionDraft(automaticDuplicate, context).source, "Esta fileira automática já está na vitrine.");
  assert.deepEqual(model.availableAutomaticSources(sections), [], "as quatro automaticas ja estao na ordem padrao");
  assert.equal(model.emptySectionDraft(sections).kind, "manual", "sem automatica livre, comeca em escolha manual");

  const manual = { ...model.emptySectionDraft(sections), kind: "manual", title: "" };
  assert.deepEqual(model.validateSectionDraft(manual, context), {
    itemIds: "Escolha pelo menos um produto.",
    title: "Dê um título à fileira."
  });
  assert.equal(
    model.validateSectionDraft({ ...manual, itemIds: ["breve-1"], title: "Novidades" }, context).itemIds,
    "Um dos produtos escolhidos não está mais à venda. Tire-o da lista."
  );

  const structure = { ...manual, kind: "structure", sourceContentId: "curso-prompts" };
  assert.deepEqual(model.validateSectionDraft(structure, context), {}, "destaque usa o nome do produto quando sem titulo");
  assert.equal(model.draftToSection(structure, { id: "s1", isActive: true, order: 9 }, productsById).title, "Prompts do Zero");

  const created = model.draftToSection(
    { ...manual, itemIds: ["curso-prompts", "form-ia", "curso-prompts"], title: "  Comece aqui " },
    { id: "s2", isActive: true, order: 3 },
    productsById
  );
  assert.deepEqual(created, {
    contentSource: "manual",
    id: "s2",
    isActive: true,
    itemIds: ["curso-prompts", "form-ia"],
    layout: "vertical",
    order: 3,
    sectionType: "content_carousel",
    subtitle: undefined,
    title: "Comece aqui",
    visibility: "all"
  });

  const automatic = model.draftToSection(
    { ...model.emptySectionDraft([]), kind: "automatic", source: "recent_lessons", visibility: "students" },
    { id: "s3", isActive: true, order: 0 },
    productsById
  );
  assert.equal(automatic.title, "Continue assistindo");
  assert.equal(automatic.layout, "continue");
  assert.equal(automatic.sectionType, "continue_watching");
  assert.equal(automatic.subtitle, "Retome exatamente de onde parou.");

  assert.equal(model.validateSectionDraft({ ...manual, itemIds: ["curso-prompts"], title: "x".repeat(81) }, context).title, "Use no máximo 80 caracteres.");
});

test("duplicar so escolha manual e destaque, com id novo logo abaixo", () => {
  const sections = [
    section({ id: "showcase", order: 0 }),
    section({ contentSource: "manual", id: "manual-1", itemIds: ["curso-prompts"], order: 1, title: "Favoritos" })
  ];

  assert.deepEqual(model.duplicateSection(sections, "showcase", 1000).newId, null);

  const result = model.duplicateSection(sections, "manual-1", 1000);
  assert.equal(result.newId, `section-${(1000).toString(36)}`);
  assert.deepEqual(
    result.sections.map((item) => [item.id, item.title, item.order]),
    [
      ["showcase", "Produtos à venda", 0],
      ["manual-1", "Favoritos", 1],
      [result.newId, "Favoritos (cópia)", 2]
    ]
  );

  const taken = [section({ id: `section-${(5).toString(36)}` })];
  assert.equal(model.makeSectionId(taken, 5), `section-${(6).toString(36)}`, "id nunca repete");
});

test("antes de publicar: aponta as fileiras que o servidor recusaria", () => {
  const { products } = editorData();
  const productsById = new Map(products.map((product) => [product.id, product]));
  const problems = model.findSectionProblems(
    [
      section({ id: "a", order: 0 }),
      section({ id: "b", order: 1, title: "Outra vitrine" }),
      section({ contentSource: "manual", id: "c", itemIds: [], order: 2, title: "Vazia" }),
      section({ contentSource: "selected_content_structure", id: "d", layout: "compact", order: 3, sectionType: "content_structure", sourceContentId: "sumiu", title: "Destaque" }),
      section({ contentSource: "manual", id: "e", itemIds: ["curso-prompts", "sumiu"], order: 4, title: "Para você" })
    ],
    productsById
  );

  assert.deepEqual(
    problems.map((problem) => problem.sectionId),
    ["b", "c"],
    "produto fora de venda nao trava: a limpeza tira antes (d sai inteira, e fica sem o produto)"
  );
  assert.match(problems[0].message, /repete uma fileira automática/);
  assert.equal(model.findSectionProblems(editorData().sections, productsById).length, 0, "ordem padrao e publicavel");
});

test("previa: so produtos publicados e listados; fileiras do aluno nao inventam itens", () => {
  const { products } = editorData();

  assert.deepEqual(model.resolveSectionPreview(section({ contentSource: "recent_lessons", sectionType: "continue_watching" }), products), {
    kind: "per_student",
    note: "Muda para cada aluno: as aulas que ele começou."
  });
  assert.deepEqual(model.resolveSectionPreview(section({ isActive: false }), products), { kind: "off" });

  const showcase = model.resolveSectionPreview(section({}), products);
  assert.equal(showcase.kind, "products");
  assert.deepEqual(
    showcase.products.map((product) => product.id),
    ["curso-prompts", "form-ia"],
    "sem rascunho, sem oculto, sem em breve e sem curso interno"
  );
  assert.equal(showcase.hiddenCount, 1);

  const upcoming = model.resolveSectionPreview(section({ contentSource: "upcoming_products" }), products);
  assert.deepEqual(upcoming.products.map((product) => product.id), ["breve-1"]);

  const manual = model.resolveSectionPreview(
    section({ contentSource: "manual", itemIds: ["form-ia", "curso-rascunho", "curso-oculto", "curso-prompts"] }),
    products
  );
  assert.deepEqual(manual.products.map((product) => product.id), ["form-ia", "curso-prompts"], "mantem a ordem escolhida");
  assert.equal(manual.hiddenCount, 1);

  const structure = model.resolveSectionPreview(
    section({ contentSource: "selected_content_structure", sectionType: "content_structure", sourceContentId: "curso-rascunho" }),
    products
  );
  assert.deepEqual(structure, { kind: "structure", product: null }, "destaque em rascunho nao aparece");
});

test("descricao da fileira na lista fala a lingua do produtor", () => {
  const { products } = editorData();
  const productsById = new Map(products.map((product) => [product.id, product]));

  assert.equal(model.describeSection(section({}), productsById), "Automática · Produtos à venda");
  assert.equal(model.describeSection(section({ contentSource: "manual", itemIds: ["a"] }), productsById), "Escolha manual · 1 produto");
  assert.equal(
    model.describeSection(section({ contentSource: "selected_content_structure", sourceContentId: "form-ia" }), productsById),
    "Fileira de módulos · Formação IA"
  );
  assert.equal(model.SECTION_KIND_LABELS.structure, "Fileira de módulos", "um destaque so: o banner do topo; a fileira e de modulos");
  assert.equal(model.VISIBILITY_LABELS.non_students, "Só quem ainda não comprou");
});

test("rascunho igual ao publicado nao conta como alteracao", () => {
  const published = [section({ id: "a", order: 0, subtitle: "Oi" }), section({ id: "b", order: 1 })];

  assert.equal(model.areSectionsEqual(published, [{ ...published[0], subtitle: "Oi " }, published[1]]), true);
  assert.equal(model.areSectionsEqual(published, model.moveSection(published, "b", -1)), false);
  assert.equal(model.areSectionsEqual(published, [published[0], { ...published[1], isActive: false }]), false);
});

test("marca: o PUT so leva o que mudou, como no admin antigo", () => {
  const published = { heroEnabled: true, heroImage: "/hero.png", logoImage: "/logo.svg" };

  assert.deepEqual(model.buildAppearancePayload(published, published), {});
  assert.equal(model.isBrandDirty(published, { ...published }), false);
  assert.deepEqual(model.buildAppearancePayload(published, { ...published, heroEnabled: false }), { hero: { enabled: false } });
  assert.deepEqual(model.buildAppearancePayload(published, { ...published, heroImage: "data:image/webp;base64,AAAA" }), {
    hero: { enabled: true, image: "data:image/webp;base64,AAAA" }
  });
  assert.deepEqual(model.buildAppearancePayload({ ...published, heroEnabled: false }, { ...published, heroEnabled: true }), {
    hero: { enabled: true }
  });
  assert.deepEqual(model.buildAppearancePayload(published, { ...published, logoImage: null }), { logo: { image: null } });
  assert.equal(
    model.isBrandDirty({ ...published, heroEnabled: false }, { ...published, heroEnabled: false, heroImage: "/outra.png" }),
    false,
    "trocar a imagem com o banner desligado nao muda nada para o aluno"
  );
});

test("link de imagem colado: https ou caminho do proprio site", () => {
  assert.equal(model.validateImageLink("https://cdn.exemplo.com/banner.webp"), null);
  assert.equal(model.validateImageLink("/hero/bunker.png"), null);
  assert.equal(model.validateImageLink(""), "Cole o link da imagem.");
  assert.equal(model.validateImageLink("http://exemplo.com/a.png"), "Use um link que comece com https://.");
  assert.equal(model.validateImageLink("//exemplo.com/a.png"), "Este link não parece de uma imagem. Confira e cole de novo.");
  assert.equal(model.validateImageLink("https://exemplo.com/a b.png"), "Este link não parece de uma imagem. Confira e cole de novo.");
  assert.equal(model.validateImageLink("ftp://exemplo.com/a.png"), "Use um link que comece com https://.");
  assert.equal(model.validateImageLink("javascript:alert(1)"), "Este link não parece de uma imagem. Confira e cole de novo.");
});

test("fileira automatica nova: subtitulo e publico acompanham a fonte ate o produtor mudar", () => {
  const draft = model.emptySectionDraft([]);

  assert.equal(draft.kind, "automatic");
  assert.equal(draft.source, "recent_lessons");
  assert.equal(draft.subtitle, "Retome exatamente de onde parou.");
  assert.equal(draft.visibility, "students");

  const switched = model.changeDraftSource(draft, "sellable_products");
  assert.equal(switched.subtitle, "Produtos disponíveis e destaques da Bunker707.");
  assert.equal(switched.visibility, "all");

  const custom = model.changeDraftSource({ ...draft, subtitle: "Meu texto", visibility: "non_students" }, "upcoming_products");
  assert.equal(custom.subtitle, "Meu texto", "texto do produtor fica");
  assert.equal(custom.visibility, "non_students");

  const productsById = new Map();
  const saved = model.draftToSection({ ...switched, subtitle: "" }, { id: "x", isActive: true, order: 0 }, productsById);
  assert.equal(saved.subtitle, undefined, "subtitulo apagado fica vazio na home, sem texto escondido");
});

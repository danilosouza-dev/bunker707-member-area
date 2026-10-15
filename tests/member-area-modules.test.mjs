import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";

// Area de membros › Modulos: fileira de modulos na home (a Vitrine e a fonte da verdade), "Como abre",
// capa do modulo e a trava de versao da Vitrine. Regras puras carregadas direto pelo Node e Server
// Actions de verdade (papel, zod, regras, gravacao) com banco em memoria.

// Papel de verdade (canRole) em vez do dublê que deixa tudo passar, e a rota da Vitrine sem o
// platform-store inteiro: estes ganchos rodam antes dos de admin-action-stubs.mjs.
const rolesUrl = new URL("../src/server/auth/roles.ts", import.meta.url).href;
const PERMISSIONS_STUB = `
import { canRole } from ${JSON.stringify(rolesUrl)};
export class AdminPermissionError extends Error {
  constructor(message, status) { super(message); this.name = "AdminPermissionError"; this.status = status; }
}
export async function requireRole(action) {
  const stubs = globalThis.__adminActionStubs;
  if (!canRole(stubs.role.role, action)) throw new AdminPermissionError("Seu papel não permite esta ação.", 403);
  return stubs.role;
}
export async function requireScope() {}
export async function requireApiRole(action) {
  const stubs = globalThis.__adminActionStubs;
  if (!canRole(stubs.role.role, action)) return { response: Response.json({ error: "Seu papel não permite esta ação." }, { status: 403 }) };
  return { response: null, ...stubs.role };
}`;
// Mesmo contrato do publishHomeSections de verdade (src/server/db/platform-store.ts, conferido por
// leitura de codigo em tests/member-area-integration.test.mjs): com versao, a gravacao e condicional no
// proprio UPDATE (writePlatformSettingGuarded de verdade, sobre o banco em memoria); a resposta traz a
// versao exata desta gravacao.
const settingsStoreUrl = new URL("../src/server/member-area/settings-store.ts", import.meta.url).href;
const PLATFORM_STORE_STUB = `
import { writePlatformSettingGuarded } from ${JSON.stringify(settingsStoreUrl)};
export async function publishHomeSections(sections, options = {}) {
  const stubs = globalThis.__adminActionStubs;
  let homeSectionsUpdatedAt = stubs.publishStamp;
  if (options.expectedUpdatedAt !== undefined) {
    homeSectionsUpdatedAt = (await writePlatformSettingGuarded("homeSections", sections, options.expectedUpdatedAt, new Date(stubs.publishStamp))).updatedAt;
  }
  stubs.published.push({ expectedUpdatedAt: options.expectedUpdatedAt, sections });
  return { homeSectionConfigs: sections, homeSectionsUpdatedAt };
}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/server/auth/permissions") {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(PERMISSIONS_STUB)}` };
    }

    if (specifier === "@/server/db/platform-store") {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(PLATFORM_STORE_STUB)}` };
    }

    return nextResolve(specifier, context);
  }
});

actionStubs.published = [];
actionStubs.publishStamp = "2026-10-11T12:00:00.000Z";

const model = await import("../src/server/member-area/modules-model.ts");
const storefront = await import("../src/server/storefront/model.ts");
const catalogSchemas = await import("../src/server/catalog/schemas.ts");
const mappers = await import("../src/server/catalog/mappers.ts");
const { canRole } = await import("../src/server/auth/roles.ts");
const { setHomeModuleRow, setProductOpensAs } = await import("../src/server/member-area/modules-actions.ts");
const { setModuleCover } = await import("../src/server/catalog/module-cover-actions.ts");
const route = await import("../src/app/api/admin/home-sections/route.ts");

const OLD = "2026-10-11T09:00:00.123456+00:00";
const NEWER = "2026-10-11T10:30:00.000Z";
const OWNER = { role: "owner", user: { id: "00000000-0000-4000-8000-000000000001" } };

/* ------------------------------------------------------------------------------------------------
 * Dados de exemplo
 * ---------------------------------------------------------------------------------------------- */

function product(overrides = {}) {
  return {
    accent: "lima",
    coverUrl: null,
    formatLabel: "Curso",
    id: "curso-ia",
    kind: "Curso",
    listed: true,
    modulesCount: 3,
    sellable: true,
    situation: "published",
    title: "Curso de IA",
    upcoming: false,
    ...overrides
  };
}

function automatic(source, id, order, overrides = {}) {
  const option = storefront.getAutomaticSource(source);

  return {
    contentSource: option.source,
    id,
    isActive: true,
    itemIds: [],
    layout: option.layout,
    order,
    sectionType: option.sectionType,
    title: option.label,
    visibility: option.visibility,
    ...overrides
  };
}

function moduleRow(productId, id, order, overrides = {}) {
  return {
    contentSource: "selected_content_structure",
    id,
    isActive: true,
    itemIds: [],
    layout: "compact",
    order,
    sectionType: "content_structure",
    sourceContentId: productId,
    title: "Módulos do curso",
    visibility: "all",
    ...overrides
  };
}

const vitrine = [
  automatic("recent_lessons", "continue-watching", 0),
  automatic("entitlement_products", "my-purchases", 1),
  automatic("sellable_products", "showcase", 2),
  automatic("upcoming_products", "upcoming", 3)
];

const ids = (sections) => sections.map((section) => `${section.id}${section.isActive ? "" : "(off)"}`);

/* ------------------------------------------------------------------------------------------------
 * applyHomeModuleRow
 * ---------------------------------------------------------------------------------------------- */

test("ligar cria a fileira antes de “Produtos à venda”, compacta e para todos os alunos", () => {
  const result = model.applyHomeModuleRow(vitrine, product(), { enabled: true }, 1000);
  const created = result.sections.find((section) => section.id === result.sectionId);

  assert.equal(result.changed, true);
  assert.deepEqual(ids(result.sections), ["continue-watching", "my-purchases", result.sectionId, "showcase", "upcoming"]);
  assert.deepEqual(result.sections.map((section) => section.order), [0, 1, 2, 3, 4]);
  assert.equal(result.sectionId, `section-${(1000).toString(36)}`);
  assert.deepEqual(
    { ...created, id: "x" },
    {
      contentSource: "selected_content_structure",
      id: "x",
      isActive: true,
      itemIds: [],
      layout: "compact",
      order: 2,
      sectionType: "content_structure",
      sourceContentId: "curso-ia",
      title: "Curso de IA",
      visibility: "all"
    }
  );
});

test("sem “Produtos à venda”, entra depois de “Minhas compras”; sem as duas, no fim", () => {
  const withoutShowcase = vitrine.filter((section) => section.id !== "showcase");
  const afterPurchases = model.applyHomeModuleRow(withoutShowcase, product(), { enabled: true }, 1);
  assert.deepEqual(ids(afterPurchases.sections), ["continue-watching", "my-purchases", afterPurchases.sectionId, "upcoming"]);

  const onlyUpcoming = [automatic("upcoming_products", "upcoming", 0)];
  const atEnd = model.applyHomeModuleRow(onlyUpcoming, product(), { enabled: true }, 1);
  assert.deepEqual(ids(atEnd.sections), ["upcoming", atEnd.sectionId]);

  const empty = model.applyHomeModuleRow([], product(), { enabled: true, title: "  Comece pelos módulos  " }, 1);
  assert.equal(empty.sections.length, 1);
  assert.equal(empty.sections[0].title, "Comece pelos módulos", "titulo aparado");
});

test("ligar de novo reativa a fileira que ja existe, sem duplicar e no mesmo lugar", () => {
  const sections = [...vitrine.slice(0, 2), moduleRow("curso-ia", "m-ia", 2, { isActive: false, title: "Meu título" }), ...vitrine.slice(2)];
  const result = model.applyHomeModuleRow(sections, product(), { enabled: true }, 5);

  assert.equal(result.changed, true);
  assert.equal(result.sectionId, "m-ia");
  assert.deepEqual(ids(result.sections), ["continue-watching", "my-purchases", "m-ia", "showcase", "upcoming"]);
  assert.equal(result.sections[2].title, "Meu título", "titulo guardado volta");

  const again = model.applyHomeModuleRow(result.sections, product(), { enabled: true }, 6);
  assert.equal(again.changed, false, "ja ligada: nada a gravar");
  assert.equal(again.sections.filter((section) => section.sourceContentId === "curso-ia").length, 1);
});

test("desligar guarda titulo e posicao (e desliga copias); titulo novo vale no maximo 80", () => {
  const sections = [
    ...vitrine.slice(0, 2),
    moduleRow("curso-ia", "m-ia", 2, { title: "Trilha de IA" }),
    moduleRow("curso-ia", "m-ia-copia", 3, { title: "Trilha de IA (cópia)" }),
    { ...vitrine[2], order: 4 },
    { ...vitrine[3], order: 5 }
  ];
  const off = model.applyHomeModuleRow(sections, product(), { enabled: false }, 1);

  assert.deepEqual(ids(off.sections), ["continue-watching", "my-purchases", "m-ia(off)", "m-ia-copia(off)", "showcase", "upcoming"]);
  assert.equal(off.sections[2].title, "Trilha de IA");
  assert.equal(off.sectionId, "m-ia");

  const neverOn = model.applyHomeModuleRow(vitrine, product(), { enabled: false }, 1);
  assert.equal(neverOn.changed, false, "desligar o que nunca foi ligado nao grava nada");
  assert.equal(neverOn.sectionId, null);

  const renamed = model.applyHomeModuleRow(off.sections, product(), { enabled: false, title: `  ${"x".repeat(90)}  ` }, 1);
  assert.equal(renamed.sections[2].title.length, 80, "corta em 80");
  assert.equal(renamed.sections[2].isActive, false);
  assert.equal(renamed.sections[3].title, "Trilha de IA (cópia)", "so a fileira principal muda de titulo");
});

test("ids da fileira nova nunca repetem", () => {
  const taken = [...vitrine, automatic("manual", `section-${(7).toString(36)}`, 4, { contentSource: "manual", itemIds: ["x"], title: "Manual" })];
  const result = model.applyHomeModuleRow(taken, product(), { enabled: true }, 7);

  assert.equal(result.sectionId, `section-${(8).toString(36)}`);
  assert.equal(new Set(result.sections.map((section) => section.id)).size, result.sections.length);
});

test("produto que nao pode ter fileira: erro 422 com o motivo", () => {
  const cases = [
    [product({ sellable: false }), model.HOME_ROW_NOTES.included],
    [product({ sellable: false, upcoming: true }), model.HOME_ROW_NOTES.upcoming],
    [product({ kind: "Formacao" }), model.HOME_ROW_NOTES.formation]
  ];

  for (const [item, message] of cases) {
    assert.throws(
      () => model.applyHomeModuleRow(vitrine, item, { enabled: true }),
      (error) => error instanceof model.HomeModuleRowRuleError && error.status === 422 && error.message === message
    );
  }
});

/* ------------------------------------------------------------------------------------------------
 * computeHomeModuleRowState
 * ---------------------------------------------------------------------------------------------- */

test("estado: ligada mostra a posicao entre as visiveis e a fileira de antes", () => {
  const sections = [
    automatic("recent_lessons", "continue-watching", 0),
    automatic("entitlement_products", "my-purchases", 1, { isActive: false }),
    moduleRow("curso-ia", "m-ia", 2, { title: "Trilha" }),
    automatic("sellable_products", "showcase", 3)
  ];

  assert.deepEqual(model.computeHomeModuleRowState(product(), sections, true), {
    afterTitle: "Continue assistindo",
    note: null,
    position: 2,
    sectionId: "m-ia",
    status: "on",
    title: "Trilha",
    vitrineConfigured: true
  });

  const first = model.computeHomeModuleRowState(product(), [moduleRow("curso-ia", "m-ia", 0)], true);
  assert.equal(first.afterTitle, null);
  assert.equal(first.position, 1);

  const off = model.computeHomeModuleRowState(product(), [moduleRow("curso-ia", "m-ia", 0, { isActive: false, title: "Guardado" })], true);
  assert.equal(off.status, "off");
  assert.equal(off.title, "Guardado", "titulo guardado aparece mesmo desligada");
  assert.equal(off.sectionId, "m-ia");
  assert.equal(off.position, null);

  const never = model.computeHomeModuleRowState(product(), vitrine, true);
  assert.deepEqual([never.status, never.title, never.sectionId], ["off", "Curso de IA", null]);
});

test("estado: vitrine nunca publicada usa a ordem padrao (com homeModuleSection ligado)", () => {
  const data = storefront.mapStorefrontEditorData({
    contentRows: [
      { bucket: "courses", commerce_scope: "sellable_product", id: "curso-ia", image: null, kind: "Curso", listing: "listed", publication_status: "published", sort_order: 0, title: "Curso de IA" },
      { bucket: "courses", commerce_scope: "sellable_product", id: "curso-b", image: null, kind: "Curso", listing: "listed", publication_status: "published", sort_order: 1, title: "Curso B" }
    ],
    moduleRows: [{ owner_id: "curso-ia" }, { owner_id: "curso-b" }],
    platformRows: [],
    settingsRows: [{ content_id: "curso-ia", home_module_section: { enabled: true } }]
  });
  const byId = new Map(data.products.map((item) => [item.id, item]));

  const on = model.computeHomeModuleRowState(byId.get("curso-ia"), data.sections, data.sectionsConfigured);
  assert.deepEqual([on.status, on.sectionId, on.afterTitle, on.vitrineConfigured], ["on", "course-modules-curso-ia", "Minhas compras", false]);

  const off = model.computeHomeModuleRowState(byId.get("curso-b"), data.sections, data.sectionsConfigured);
  assert.equal(off.status, "off");
});

test("estado: notas de rascunho, arquivado, oculto, sem modulos, curso de formacao e em breve", () => {
  const note = (item) => model.computeHomeModuleRowState(item, vitrine, true);

  assert.equal(note(product({ situation: "draft" })).note, "Aparece depois de publicar.");
  assert.equal(note(product({ situation: "archived" })).note, "Produto arquivado: a fileira não aparece.");
  assert.equal(note(product({ listed: false })).note, "Produto oculto: a fileira só aparece para quem já tem acesso.");
  assert.equal(note(product({ modulesCount: 0 })).note, "Sem módulos publicados: a fileira aparece quando houver.");
  assert.equal(note(product({ modulesCount: 0 })).status, "off", "sem modulos ainda da para ligar");

  const included = model.computeHomeModuleRowState(undefined, vitrine, true);
  assert.deepEqual([included.status, included.note], ["unavailable", "Curso dentro de uma formação aparece pela formação."]);
  assert.equal(note(product({ sellable: false, upcoming: true })).status, "unavailable");
  assert.equal(note(product({ kind: "Formacao" })).status, "unavailable");
});

test("toast: ligar diz onde aparece; desligar e titulo tem texto proprio", () => {
  const on = { ...model.computeHomeModuleRowState(product(), [...vitrine.slice(0, 2), moduleRow("curso-ia", "m", 2)], true) };

  assert.equal(model.describeHomeRowChange({ status: "off", title: "x" }, on), "Fileira ligada: aparece na home depois de “Minhas compras”");
  assert.equal(model.describeHomeRowChange({ status: "off", title: "x" }, { ...on, afterTitle: null }), "Fileira ligada: aparece no topo da home");
  assert.equal(model.describeHomeRowChange({ status: "on", title: "x" }, { ...on, status: "off" }), "Fileira desligada");
  assert.equal(model.describeHomeRowChange({ status: "on", title: "Velho" }, { ...on, title: "Novo" }), "Título da fileira salvo");
});

/* ------------------------------------------------------------------------------------------------
 * Capas, busca e schemas
 * ---------------------------------------------------------------------------------------------- */

test("capas: propria = nao vazia e diferente da capa do produto", () => {
  const cover = "https://cdn.exemplo.com/capa.webp";
  const modules = [{ image: cover }, { image: ` ${cover} ` }, { image: "" }, { image: null }, { image: "https://cdn.exemplo.com/m1.webp" }];

  assert.equal(model.countOwnModuleCovers(modules, cover), 1);
  assert.equal(model.countOwnModuleCovers(modules, null), 3, "sem capa do produto, toda imagem preenchida e propria");
  assert.equal(model.describeModuleCovers(3, 5), "3 de 5 com capa própria");
  assert.equal(model.describeModuleCovers(0, 0), "Nenhum módulo ainda");
  assert.equal(model.describeModuleCovers(9, 2), "2 de 2 com capa própria");
  assert.equal(model.moduleUsesProductCover("", cover), true);
  assert.equal(model.moduleUsesProductCover("https://cdn.exemplo.com/m1.webp", cover), false);
  assert.equal(model.productCoverForModule(null), "", "a coluna e not null");
  assert.equal(model.productCoverForModule(` ${cover} `), cover);
});

test("busca e pagina no endereco; lixo vira o padrao", () => {
  assert.deepEqual(model.parseModuleSettingsSearchParams({}), { page: 1 });
  assert.deepEqual(model.parseModuleSettingsSearchParams({ busca: "  ia ", pagina: "3" }), { page: 3, q: "ia" });
  assert.deepEqual(model.parseModuleSettingsSearchParams({ busca: ["ia", "x"], pagina: "abc" }), { page: 1, q: "ia" });
  assert.deepEqual(model.parseModuleSettingsSearchParams({ pagina: "-2" }), { page: 1 });

  assert.equal(model.buildModuleSettingsHref({}, {}), "/admin/area-de-membros/modulos");
  assert.equal(model.buildModuleSettingsHref({ page: 2, q: "ia" }, { page: 3 }), "/admin/area-de-membros/modulos?busca=ia&pagina=3");
  assert.equal(model.buildModuleSettingsHref({ page: 4, q: "ia" }, { q: "prompts" }), "/admin/area-de-membros/modulos?busca=prompts", "busca nova volta para a pagina 1");
  assert.equal(model.buildModuleSettingsHref({}, { q: "Curso de IA" }), "/admin/area-de-membros/modulos?busca=Curso+de+IA");
});

test("schemas: titulo da fileira, como abre e capa do modulo", () => {
  assert.equal(model.setHomeModuleRowSchema.parse({ enabled: true, productId: "curso-ia", title: "  Trilha  " }).title, "Trilha");
  assert.equal(model.setHomeModuleRowSchema.safeParse({ enabled: true, productId: "curso-ia", title: "   " }).error.issues[0].message, "Dê um título à fileira.");
  assert.equal(model.setHomeModuleRowSchema.safeParse({ enabled: true, productId: "curso-ia", title: "x".repeat(81) }).error.issues[0].message, "Use no máximo 80 caracteres.");
  assert.equal(model.setHomeModuleRowSchema.safeParse({ enabled: "sim", productId: "curso-ia" }).success, false);
  assert.equal(model.setProductOpensAsSchema.safeParse({ mode: "grade", productId: "curso-ia" }).success, false);
  assert.equal(model.setProductOpensAsSchema.safeParse({ mode: "lesson_playlist", productId: "../x" }).success, false);

  const cover = catalogSchemas.setModuleCoverSchema;
  assert.equal(cover.safeParse({ image: null, moduleId: "module-a" }).success, true);
  assert.equal(cover.safeParse({ image: "https://cdn.exemplo.com/m.webp", moduleId: "module-a" }).success, true);
  assert.equal(cover.safeParse({ image: "data:image/webp;base64,AAAA", moduleId: "module-a" }).success, true);
  assert.equal(cover.safeParse({ image: "http://cdn.exemplo.com/m.webp", moduleId: "module-a" }).success, false);
  assert.equal(cover.safeParse({ image: "javascript:alert(1)", moduleId: "module-a" }).success, false);
  assert.equal(cover.safeParse({ image: "data:image/png;base64,AAAA", moduleId: "module-a" }).success, false);
});

const CSS_INJECTION = "https://a.com/x.png);position:fixed;inset:0;z-index:9999;background:red";

test("capa colada com ), aspas ou espaço é recusada com a frase do produtor (protege capa de módulo e de produto)", () => {
  for (const image of [CSS_INJECTION, 'https://a.com/x".png', "https://a.com/x'.png", "https://a.com/x y.png", "https://a.com/x\\y.png", "https://a.com/<x>.png"]) {
    const result = catalogSchemas.setModuleCoverSchema.safeParse({ image, moduleId: "module-a" });
    assert.equal(result.success, false, image);
    assert.match(result.error.issues[0].message, /sem espaços, aspas nem parênteses/, image);
    assert.equal(catalogSchemas.imageInputSchema.safeParse(image).success, false, `capa de produto: ${image}`);
  }

  assert.equal(catalogSchemas.imageInputSchema.parse(" https://cdn.exemplo.com/capa.webp "), "https://cdn.exemplo.com/capa.webp");
  assert.match(catalogSchemas.imageInputSchema.safeParse("data:image/png;base64,AAAA").error.issues[0].message, /WebP/);
  // O link de compra continua aceitando parenteses (nao vira CSS).
  assert.equal(catalogSchemas.purchaseUrlSchema.safeParse("https://pay.exemplo.com/oferta_(black)").success, true);
});

test("o aluno desenha a capa entre aspas: um endereço estranho não vira CSS na home", async () => {
  const { cssImageUrl } = await import("../src/lib/css-url.ts");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");

  assert.equal(cssImageUrl(CSS_INJECTION), `url("${CSS_INJECTION}")`);
  assert.equal(cssImageUrl('https://a.com/x".png'), 'url("https://a.com/x%22.png")');
  assert.equal(cssImageUrl("https://a.com/x\\y\n.png"), 'url("https://a.com/x%5Cy%0A.png")');
  assert.equal(cssImageUrl(""), "none");
  assert.equal(cssImageUrl(undefined), "none");

  const html = renderToStaticMarkup(createElement("div", { style: { backgroundImage: cssImageUrl(CSS_INJECTION) } }));
  assert.equal(html, `<div style="background-image:url(&quot;${CSS_INJECTION}&quot;)"></div>`, "uma declaracao so, com o endereco inteiro entre aspas");

  for (const file of [
    "../src/components/content-row.tsx",
    "../src/components/featured-structure-home-section.tsx",
    "../src/components/content-structure-section.tsx",
    "../src/components/content-card.tsx"
  ]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /backgroundImage: cssImageUrl\(/, file);
    assert.doesNotMatch(source, /backgroundImage: `url\(\$\{/, `${file}: url() sem aspas`);
  }
});

test("o modulo da arvore traz a capa (course_modules.image) para a miniatura", () => {
  const row = { id: "m1", image: " https://cdn.exemplo.com/m1.webp ", owner_id: "curso-ia", release_rule: null, sort_order: 0, status: "published", title: "M1", updated_at: OLD };

  assert.equal(mappers.mapModuleNode(row, 1, []).coverUrl, "https://cdn.exemplo.com/m1.webp");
  assert.equal(mappers.mapModuleNode({ ...row, image: "" }, 1, []).coverUrl, null);
});

/* ------------------------------------------------------------------------------------------------
 * Banco em memoria
 * ---------------------------------------------------------------------------------------------- */

/**
 * Tabelas em memoria com a superficie que as actions usam (eq/neq/in filtram de verdade; update e
 * insert gravam), mais rpc e Storage. `beforeWrite(table, op, tables)` roda quando a escrita e
 * montada, antes do filtro: simula alguem gravando no meio.
 */
function createDb({ beforeWrite, rpc = {}, tables = {} } = {}) {
  const data = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  const calls = { rpc: [], uploads: [], writes: [] };

  function query(table) {
    const filters = [];
    let op = "select";
    let payload = null;
    let returning = false;
    const rows = () => (data[table] ??= []);
    const matches = (row) => filters.every((filter) => filter(row));
    const run = () => {
      if (op === "insert") {
        const items = Array.isArray(payload) ? payload : [payload];

        if (table === "platform_settings" && items.some((item) => rows().some((row) => row.key === item.key))) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }

        rows().push(...items.map((item) => ({ ...item })));
        return { data: returning ? items.map((item) => ({ ...item })) : null, error: null };
      }

      if (op === "update") {
        const hit = rows().filter(matches);
        hit.forEach((row) => Object.assign(row, payload));
        return { data: returning ? hit.map((row) => ({ ...row })) : null, error: null };
      }

      return { data: rows().filter(matches).map((row) => ({ ...row })), error: null };
    };
    const write = (kind, value) => {
      op = kind;
      payload = value;
      beforeWrite?.(table, kind, data);
      calls.writes.push({ op: kind, table, value });
      return chain;
    };
    const chain = {
      eq(column, value) {
        filters.push((row) => row[column] === value);
        return chain;
      },
      in(column, values) {
        filters.push((row) => values.includes(row[column]));
        return chain;
      },
      insert: (value) => write("insert", value),
      limit: () => chain,
      async maybeSingle() {
        const result = run();
        return { data: result.data?.[0] ?? null, error: result.error };
      },
      neq(column, value) {
        filters.push((row) => row[column] !== value);
        return chain;
      },
      order: () => chain,
      select() {
        if (op !== "select") {
          returning = true;
        }
        return chain;
      },
      async single() {
        const result = run();
        return { data: result.data?.[0] ?? null, error: result.error };
      },
      then(resolve, reject) {
        return Promise.resolve(run()).then(resolve, reject);
      },
      update: (value) => write("update", value)
    };

    return chain;
  }

  return {
    calls,
    data,
    from: (table) => query(table),
    async rpc(name, args) {
      calls.rpc.push({ args, name });
      return rpc[name] ? rpc[name](args) : { data: {}, error: null };
    },
    storage: {
      from(bucket) {
        return {
          getPublicUrl: (path) => ({ data: { publicUrl: `https://projeto.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
          async upload(path, bytes, options) {
            calls.uploads.push({ bucket, options, path, size: bytes.length });
            return { error: null };
          }
        };
      }
    }
  };
}

function contentRow(id, overrides = {}) {
  return {
    access_label: null,
    access_model: "closed",
    bucket: "courses",
    commerce_scope: "sellable_product",
    description: null,
    eyebrow: "",
    id,
    image: null,
    instructor: null,
    kind: "Curso",
    level_label: null,
    listing: "listed",
    max_students: null,
    publication_status: "published",
    purchase_label: null,
    purchase_target: null,
    purchase_url: null,
    release_rule: null,
    sort_order: 0,
    title: id,
    updated_at: OLD,
    ...overrides
  };
}

function storefrontTables(platformSettings) {
  return {
    content_items: [
      contentRow("curso-ia", { image: "https://cdn.exemplo.com/capa-ia.webp", title: "Curso de IA" }),
      contentRow("form-ia", { bucket: "formations", kind: "Formacao", title: "Formação IA" }),
      contentRow("curso-interno", { bucket: "formation_internal_courses", commerce_scope: "included_content", title: "Curso interno" })
    ],
    content_page_settings: [],
    course_modules: [
      { id: "mod-1", image: "https://cdn.exemplo.com/capa-ia.webp", owner_id: "curso-ia", release_rule: null, sort_order: 0, status: "published", title: "Comece aqui", updated_at: OLD },
      { id: "mod-2", image: "", owner_id: "curso-ia", release_rule: null, sort_order: 1, status: "published", title: "Prática", updated_at: OLD }
    ],
    platform_settings: platformSettings
  };
}

function homeSectionsRow(db) {
  return db.data.platform_settings.find((row) => row.key === "homeSections");
}

function reset(role = OWNER) {
  actionStubs.role = role;
  actionStubs.invalidations = [];
  actionStubs.published = [];
}

/* ------------------------------------------------------------------------------------------------
 * setHomeModuleRow
 * ---------------------------------------------------------------------------------------------- */

test("ligar com a vitrine publicada: grava so homeSections, com a versao lida, e espelha o legado", async () => {
  reset();
  const db = createDb({ tables: storefrontTables([{ key: "homeSections", updated_at: OLD, value: vitrine }]) });
  actionStubs.db = db;

  const result = await setHomeModuleRow({ enabled: true, productId: "curso-ia", title: "  Trilha de IA " });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.status, "on");
  assert.equal(result.data.title, "Trilha de IA");
  assert.equal(result.data.afterTitle, "Minhas compras");
  assert.equal(result.data.position, 3);

  const writes = db.calls.writes.map((write) => `${write.op}:${write.table}`);
  assert.deepEqual(writes, ["update:platform_settings"], "uma escrita, so na chave da vitrine");
  const saved = homeSectionsRow(db);
  assert.notEqual(saved.updated_at, OLD, "versao nova carimbada");
  assert.deepEqual(saved.value.map((section) => section.sourceContentId ?? section.id), ["continue-watching", "my-purchases", "curso-ia", "showcase", "upcoming"]);

  assert.deepEqual(db.calls.rpc, [
    { args: { p_content_id: "curso-ia", p_set: { homeModuleSection: { enabled: true } }, p_unset: [] }, name: "admin_patch_product_settings" }
  ]);
  assert.deepEqual(actionStubs.invalidations, [{ from: "action", target: "home" }]);
});

test("vitrine nunca publicada: a primeira gravacao cria a chave com a ordem padrao mais a fileira", async () => {
  reset();
  const db = createDb({ tables: storefrontTables([]) });
  actionStubs.db = db;

  const result = await setHomeModuleRow({ enabled: true, productId: "curso-ia" });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.vitrineConfigured, true);
  assert.deepEqual(db.calls.writes.map((write) => `${write.op}:${write.table}`), ["insert:platform_settings"]);
  assert.deepEqual(
    homeSectionsRow(db).value.map((section) => section.sourceContentId ?? section.id),
    ["continue-watching", "my-purchases", "curso-ia", "showcase", "upcoming"],
    "o aluno continua vendo as mesmas fileiras, mais a nova"
  );
});

test("alguem gravou a vitrine no meio: rele e grava de novo, sem apagar a mudanca do outro", async () => {
  reset();
  let interruptions = 0;
  const db = createDb({
    beforeWrite(table, op, tables) {
      if (table !== "platform_settings" || interruptions > 0) {
        return;
      }

      interruptions += 1;
      const row = tables.platform_settings.find((item) => item.key === "homeSections");
      row.updated_at = NEWER;
      row.value = [...row.value, automatic("manual", "manual-nova", 9, { contentSource: "manual", itemIds: ["curso-ia"], title: "Escolha da semana" })];
    },
    tables: storefrontTables([{ key: "homeSections", updated_at: OLD, value: vitrine }])
  });
  actionStubs.db = db;

  const result = await setHomeModuleRow({ enabled: true, productId: "curso-ia" });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(interruptions, 1);
  assert.deepEqual(db.calls.writes.map((write) => write.op), ["update", "update"], "tentou duas vezes");
  const saved = homeSectionsRow(db).value.map((section) => section.sourceContentId ?? section.id);
  assert.ok(saved.includes("manual-nova"), "a fileira do outro ficou");
  assert.ok(saved.includes("curso-ia"), "a nossa entrou");
});

test("vitrine nunca publicada, mas alguem publicou no meio: a segunda tentativa atualiza a chave nova", async () => {
  reset();
  let created = false;
  const db = createDb({
    beforeWrite(table, op, tables) {
      if (table === "platform_settings" && op === "insert" && !created) {
        created = true;
        tables.platform_settings.push({ key: "homeSections", updated_at: NEWER, value: vitrine.slice(1) });
      }
    },
    tables: storefrontTables([])
  });
  actionStubs.db = db;

  const result = await setHomeModuleRow({ enabled: true, productId: "curso-ia" });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(db.calls.writes.map((write) => write.op), ["insert", "update"]);
  assert.deepEqual(
    homeSectionsRow(db).value.map((section) => section.sourceContentId ?? section.id),
    ["my-purchases", "curso-ia", "showcase", "upcoming"],
    "parte da vitrine que o outro publicou (sem Continue assistindo) e a nossa fileira"
  );
});

test("conflito duas vezes seguidas: 409 e nada nosso gravado", async () => {
  reset();
  let stamp = 0;
  const db = createDb({
    beforeWrite(table, op, tables) {
      if (table === "platform_settings") {
        stamp += 1;
        tables.platform_settings.find((item) => item.key === "homeSections").updated_at = `2026-10-11T11:00:0${stamp}.000Z`;
      }
    },
    tables: storefrontTables([{ key: "homeSections", updated_at: OLD, value: vitrine }])
  });
  actionStubs.db = db;

  const result = await setHomeModuleRow({ enabled: true, productId: "curso-ia" });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.error, /Recarregue/);
  assert.deepEqual(homeSectionsRow(db).value, vitrine, "vitrine intacta");
  assert.equal(db.calls.rpc.length, 0, "sem espelho");
  assert.deepEqual(actionStubs.invalidations, []);
});

test("desligar: fileira fica guardada (oculta) e o espelho do legado sai", async () => {
  reset();
  const sections = [...vitrine.slice(0, 2), moduleRow("curso-ia", "m-ia", 2, { title: "Trilha" }), { ...vitrine[2], order: 3 }, { ...vitrine[3], order: 4 }];
  const db = createDb({ tables: storefrontTables([{ key: "homeSections", updated_at: OLD, value: sections }]) });
  actionStubs.db = db;

  const result = await setHomeModuleRow({ enabled: false, productId: "curso-ia" });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual([result.data.status, result.data.title, result.data.sectionId], ["off", "Trilha", "m-ia"]);
  assert.equal(homeSectionsRow(db).value[2].isActive, false);
  assert.deepEqual(db.calls.rpc[0].args, { p_content_id: "curso-ia", p_set: {}, p_unset: ["homeModuleSection"] });
});

test("curso de formacao e formacao: 422 sem gravar; analista: 403", async () => {
  reset();
  const db = createDb({ tables: storefrontTables([{ key: "homeSections", updated_at: OLD, value: vitrine }]) });
  actionStubs.db = db;

  const included = await setHomeModuleRow({ enabled: true, productId: "curso-interno" });
  assert.deepEqual([included.ok, included.status, included.error], [false, 422, "Curso dentro de uma formação aparece pela formação."]);

  const formation = await setHomeModuleRow({ enabled: true, productId: "form-ia" });
  assert.equal(formation.status, 422);

  reset({ ...OWNER, role: "analyst" });
  const analyst = await setHomeModuleRow({ enabled: true, productId: "curso-ia" });
  assert.deepEqual([analyst.ok, analyst.status], [false, 403]);
  assert.equal(db.calls.writes.length, 0);
  assert.equal(canRole("editor", "storefront.write"), true, "editor pode ligar a fileira");
});

/* ------------------------------------------------------------------------------------------------
 * setProductOpensAs
 * ---------------------------------------------------------------------------------------------- */

test("como abre: muda so coursePresentationMode pela RPC atomica e invalida o catalogo", async () => {
  reset();
  const db = createDb({ tables: storefrontTables([]) });
  actionStubs.db = db;

  const result = await setProductOpensAs({ mode: "lesson_playlist", productId: "curso-ia" });

  assert.deepEqual(result, { data: { mode: "lesson_playlist", productId: "curso-ia" }, ok: true });
  assert.deepEqual(db.calls.rpc, [
    { args: { p_content_id: "curso-ia", p_set: { coursePresentationMode: "lesson_playlist" }, p_unset: [] }, name: "admin_patch_product_settings" }
  ]);
  assert.equal(db.calls.writes.length, 0, "nada regrava a linha do produto");
  assert.deepEqual(actionStubs.invalidations, [{ from: "action" }]);
});

test("como abre: formacao 422, produto inexistente 404, suporte 403", async () => {
  reset();
  actionStubs.db = createDb({ tables: storefrontTables([]) });

  const formation = await setProductOpensAs({ mode: "module_cards", productId: "form-ia" });
  assert.deepEqual([formation.ok, formation.status, formation.error], [false, 422, "Uma formação abre nos cursos dela."]);

  const missing = await setProductOpensAs({ mode: "module_cards", productId: "sumiu" });
  assert.equal(missing.status, 404);

  reset({ ...OWNER, role: "support" });
  const support = await setProductOpensAs({ mode: "module_cards", productId: "curso-ia" });
  assert.equal(support.status, 403);
  assert.equal(actionStubs.db.calls.rpc.length, 0);
});

/* ------------------------------------------------------------------------------------------------
 * setModuleCover
 * ---------------------------------------------------------------------------------------------- */

/** Cabecalho WebP VP8X (32 bytes) com o canvas pedido: o servidor so le o cabecalho. */
function webpDataUrl(width, height) {
  const bytes = new Uint8Array(32);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x38, 0x0a, 0x00, 0x00], 4);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  bytes.set([0x0a, 0x00, 0x00, 0x00], 16);
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  return `data:image/webp;base64,${Buffer.from(bytes).toString("base64")}`;
}

test("capa do modulo: WebP 720×1080 vai ao Storage e so a URL e gravada em course_modules.image", async () => {
  reset();
  const db = createDb({ tables: storefrontTables([]) });
  actionStubs.db = db;

  const result = await setModuleCover({ image: webpDataUrl(720, 1080), moduleId: "mod-2" });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.data.coverUrl, /^https:\/\/projeto\.supabase\.co\/storage\/v1\/object\/public\/content-assets\/content\/curso-ia\/modules\/mod-2\/[a-f0-9]{24}\.webp$/);
  assert.equal(result.data.usesProductCover, false);
  assert.equal(db.calls.uploads.length, 1);
  assert.deepEqual(db.calls.writes.map((write) => [write.op, write.table, Object.keys(write.value).sort().join(",")]), [
    ["update", "course_modules", "image,updated_at"]
  ]);
  assert.equal(db.data.course_modules.find((row) => row.id === "mod-2").image, result.data.coverUrl);
  assert.equal(db.data.course_modules.find((row) => row.id === "mod-1").image, "https://cdn.exemplo.com/capa-ia.webp", "outro modulo intacto");
  assert.deepEqual(actionStubs.invalidations, [{ from: "action" }]);
});

test("capa do modulo: medida errada vira erro no campo, sem enviar nem gravar", async () => {
  reset();
  const db = createDb({ tables: storefrontTables([]) });
  actionStubs.db = db;

  const result = await setModuleCover({ image: webpDataUrl(1920, 720), moduleId: "mod-2" });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.fieldErrors.image[0], /720×1080/);
  assert.equal(db.calls.uploads.length, 0);
  assert.equal(db.calls.writes.length, 0);
});

test("capa do modulo: link com caracteres de CSS vira erro no campo, sem gravar", async () => {
  reset();
  const db = createDb({ tables: storefrontTables([]) });
  actionStubs.db = db;

  const result = await setModuleCover({ image: CSS_INJECTION, moduleId: "mod-2" });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.fieldErrors.image[0], /sem espaços, aspas nem parênteses/);
  assert.equal(db.calls.writes.length, 0);
});

test("capa do modulo: null volta para a capa do produto; link https fica como esta", async () => {
  reset();
  const db = createDb({ tables: storefrontTables([]) });
  actionStubs.db = db;

  const own = await setModuleCover({ image: "https://cdn.exemplo.com/propria.webp", moduleId: "mod-1" });
  assert.deepEqual([own.data.coverUrl, own.data.usesProductCover], ["https://cdn.exemplo.com/propria.webp", false]);

  const back = await setModuleCover({ image: null, moduleId: "mod-1" });
  assert.equal(back.ok, true, JSON.stringify(back));
  assert.deepEqual([back.data.coverUrl, back.data.usesProductCover], ["https://cdn.exemplo.com/capa-ia.webp", true]);
  assert.equal(db.calls.uploads.length, 0);

  const gone = await setModuleCover({ image: null, moduleId: "nao-existe" });
  assert.equal(gone.status, 404);

  reset({ ...OWNER, role: "analyst" });
  const analyst = await setModuleCover({ image: null, moduleId: "mod-1" });
  assert.equal(analyst.status, 403);
});

/* ------------------------------------------------------------------------------------------------
 * Rota da Vitrine: versao
 * ---------------------------------------------------------------------------------------------- */

function putRequest(body) {
  return new Request("http://localhost/api/admin/home-sections", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "PUT"
  });
}

test("publicar a vitrine com a versao velha: 409 sem gravar nem invalidar", async () => {
  reset();
  const db = createDb({ tables: { platform_settings: [{ key: "homeSections", updated_at: NEWER, value: vitrine }] } });
  actionStubs.db = db;

  const stale = await route.PUT(putRequest({ expectedUpdatedAt: OLD, sections: [] }));
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /mudou em outra tela/);
  assert.equal(actionStubs.published.length, 0);
  assert.deepEqual(actionStubs.invalidations, []);
  assert.deepEqual(homeSectionsRow(db), { key: "homeSections", updated_at: NEWER, value: vitrine }, "nada foi apagado");

  const neverPublished = await route.PUT(putRequest({ expectedUpdatedAt: null, sections: [] }));
  assert.equal(neverPublished.status, 409, "a tela achava que a vitrine nunca tinha sido publicada");
  assert.deepEqual(homeSectionsRow(db).value, vitrine);
});

test("Modulos liga a fileira enquanto a Vitrine esta aberta: o Publicar da Vitrine da 409 e a fileira fica", async () => {
  reset();
  const db = createDb({ tables: storefrontTables([{ key: "homeSections", updated_at: OLD, value: vitrine }]) });
  actionStubs.db = db;

  // A Vitrine abriu com a versao OLD. Antes do Publicar, a tela Modulos liga a fileira (OLD -> nova).
  const row = await setHomeModuleRow({ enabled: true, productId: "curso-ia" });
  assert.equal(row.ok, true, JSON.stringify(row));

  const stale = await route.PUT(putRequest({ expectedUpdatedAt: OLD, sections: vitrine }));
  assert.equal(stale.status, 409, "ninguem apaga a fileira em silencio");
  assert.ok(homeSectionsRow(db).value.some((section) => section.sourceContentId === "curso-ia"), "a fileira ligada em Modulos continua");
});

test("alguem grava enquanto a Vitrine publica: a gravacao condicional da 409 em vez de apagar", async () => {
  reset();
  let interruptions = 0;
  const db = createDb({
    beforeWrite(table, op, tables) {
      if (table !== "platform_settings" || interruptions > 0) {
        return;
      }

      // Entre a tela abrir (OLD) e o UPDATE, a tela Modulos grava a fileira dela.
      interruptions += 1;
      const current = tables.platform_settings.find((item) => item.key === "homeSections");
      current.updated_at = NEWER;
      current.value = [...current.value, moduleRow("curso-ia", "fileira-ia", 9)];
    },
    tables: { platform_settings: [{ key: "homeSections", updated_at: OLD, value: vitrine }] }
  });
  actionStubs.db = db;

  const response = await route.PUT(putRequest({ expectedUpdatedAt: OLD, sections: vitrine }));
  assert.equal(response.status, 409);
  assert.equal(interruptions, 1);
  assert.ok(homeSectionsRow(db).value.some((section) => section.id === "fileira-ia"), "a fileira do outro ficou");
  assert.equal(homeSectionsRow(db).updated_at, NEWER);
});

test("publicar com a versao certa grava e devolve a versao DESTA gravacao; sem versao (admin antigo) continua igual", async () => {
  reset();
  const db = createDb({ tables: { platform_settings: [{ key: "homeSections", updated_at: OLD, value: vitrine }] } });
  actionStubs.db = db;
  actionStubs.publishStamp = "2026-10-11T12:00:00.000Z";

  const ok = await route.PUT(putRequest({ expectedUpdatedAt: OLD, sections: vitrine.slice(0, 2) }));
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.sectionsUpdatedAt, "2026-10-11T12:00:00.000Z", "a versao gravada agora, nunca uma releitura");
  assert.equal(homeSectionsRow(db).updated_at, body.sectionsUpdatedAt);
  assert.deepEqual(homeSectionsRow(db).value, vitrine.slice(0, 2));
  assert.deepEqual(actionStubs.published.map((call) => call.expectedUpdatedAt), [OLD], "a rota repassa a versao para a gravacao");
  assert.deepEqual(actionStubs.invalidations, [{ from: "route" }]);

  // Outra tela grava depois; a resposta acima continua sendo a versao velha: o proximo Publicar da 409.
  homeSectionsRow(db).updated_at = NEWER;
  const next = await route.PUT(putRequest({ expectedUpdatedAt: body.sectionsUpdatedAt, sections: vitrine }));
  assert.equal(next.status, 409);

  const legacy = await route.PUT(putRequest({ sections: vitrine }));
  assert.equal(legacy.status, 200);
  assert.deepEqual(actionStubs.published.map((call) => call.expectedUpdatedAt), [OLD, undefined]);

  const garbage = await route.PUT(putRequest({ expectedUpdatedAt: "ontem", sections: vitrine }));
  assert.equal(garbage.status, 400);

  reset({ ...OWNER, role: "analyst" });
  const analyst = await route.PUT(putRequest({ expectedUpdatedAt: OLD, sections: vitrine }));
  assert.equal(analyst.status, 403);
  assert.equal(actionStubs.published.length, 0);
});

/* ------------------------------------------------------------------------------------------------
 * Telas: contratos lidos do codigo
 * ---------------------------------------------------------------------------------------------- */

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("a Vitrine manda a versao, avisa o conflito com Recarregar e aponta o banner para Destaque", async () => {
  const editor = await read("../src/components/admin/v2/storefront/vitrine-editor.tsx");

  assert.match(editor, /expectedUpdatedAt: configured \? version : null/);
  assert.match(editor, /response\.status === 409/);
  assert.match(editor, /A vitrine mudou em outra tela \(por exemplo, em Módulos\)/);
  assert.match(editor, /Recarregar/);
  assert.match(editor, /href="\/admin\/area-de-membros\/destaque"/);
  assert.match(editor, />\s*Editar em Destaque\s*</);
  assert.doesNotMatch(editor, /Trocar em Marca/);
});

test("Detalhes le a fileira da home sem quebrar a aba; Conteudo tem a capa do modulo no menu", async () => {
  const page = await read("../src/app/admin/(v2)/produtos/[id]/detalhes/page.tsx");
  const form = await read("../src/components/admin/v2/products/details-form.tsx");
  const block = await read("../src/components/admin/v2/content/module-block.tsx");
  const sheet = await read("../src/components/admin/v2/content/module-cover-sheet.tsx");

  assert.match(page, /getHomeModuleRowState\(/);
  assert.match(page, /return null;/, "falha vira null");
  assert.match(form, /<HomeRowControl/);
  assert.match(block, /Trocar capa do módulo…/);
  assert.match(sheet, /slot="cover"/);
  assert.match(sheet, /Usar a capa do produto/);
  assert.match(sheet, /Aparece no card do módulo na página do curso e na fileira de módulos da home\./);
});

test("textos da tela sem jargao (template, hero, slug, upload, CTA)", async () => {
  const files = [
    "../src/components/admin/v2/member-area/modules/modules-screen.tsx",
    "../src/components/admin/v2/member-area/modules/modules-table.tsx",
    "../src/components/admin/v2/member-area/modules/home-row-control.tsx",
    "../src/components/admin/v2/member-area/modules/opens-as-control.tsx",
    "../src/components/admin/v2/content/module-cover-sheet.tsx"
  ];

  for (const file of files) {
    const source = await read(file);
    // So texto entre aspas ou entre tags (nomes de codigo podem ter as palavras).
    const visible = [...source.matchAll(/"([^"\n]*[A-Za-zÀ-ú][^"\n]*)"|>([^<>{}\n]+)</g)].map((match) => match[1] ?? match[2]);
    assert.ok(visible.length > 5, `${file}: a varredura achou os textos`);

    for (const text of visible) {
      assert.doesNotMatch(text, /\b(template|hero|slug|upload|CTA|entitlement)\b/i, `${file}: "${text}"`);
    }
  }
});

test("controles que salvam na hora não usam disabled enquanto salvam (o foco do teclado fica onde está)", async () => {
  const pills = await read("../src/components/admin/v2/member-area/modules/opens-as-control.tsx");
  const control = await read("../src/components/admin/v2/member-area/modules/home-row-control.tsx");
  const table = await read("../src/components/admin/v2/member-area/modules/modules-table.tsx");
  const kit = await read("../src/components/admin/v2/settings/kit.tsx");
  const sheet = await read("../src/components/admin/v2/content/module-cover-sheet.tsx");

  assert.doesNotMatch(pills, /disabled=\{disabled \|\| pending\}/);
  assert.match(pills, /if \(!pending\) \{\s*onChange\(option\.value\);/);
  assert.match(table, /<HomeRowTitleInput\s+busy=\{state\.homeRowPending\}\s+disabled=\{!canWriteStorefront\}/);
  assert.match(control, /readOnly=\{busy\}/);
  assert.match(control, /disabled=\{!canWrite\}\s+id="detalhes-fileira-home"[\s\S]*?pending=\{saving\}/);
  assert.match(kit, /onClick=\{\(\) => \{\s*if \(!pending\) \{\s*onCheckedChange\(!checked\);/);
  assert.match(kit, /aria-busy=\{pending \|\| undefined\}/);

  // "Usar a capa do produto" some depois de gravar: o foco vai para o campo da capa própria.
  assert.doesNotMatch(sheet, /disabled=\{busy\}/);
  assert.match(sheet, /imageSection\.current\?\.querySelector<HTMLElement>\("button:not\(\[disabled\]\)"\)\?\.focus\(\)/);
});

test("tabela de Módulos atualiza o roteador depois de cada gravação (voltar à tela mostra o gravado)", async () => {
  const table = await read("../src/components/admin/v2/member-area/modules/modules-table.tsx");
  const opensAs = table.slice(table.indexOf("async function changeOpensAs"), table.indexOf("async function changeHomeRow"));
  const homeRow = table.slice(table.indexOf("async function changeHomeRow"), table.indexOf("function renderError"));

  assert.match(opensAs, /patch\(productId, \{ opensAsPending: false \}\);\s*\/\/[^\n]*\n\s*router\.refresh\(\);/);
  assert.match(homeRow, /patch\(productId, \{ homeRow: result\.state, homeRowPending: false \}\);\s*router\.refresh\(\);/);
});

test("prévia da capa do módulo mostra o card como o aluno vê (nome e aulas, 2:3), sem rótulo inventado", async () => {
  const sheet = await read("../src/components/admin/v2/content/module-cover-sheet.tsx");

  assert.match(sheet, /<AdminSheetSection title="Capa no card do módulo">/);
  assert.doesNotMatch(sheet, /Como o aluno vê"/);
  assert.match(sheet, /aspect-\[2\/3\]/);
  assert.doesNotMatch(sheet, /uppercase">Módulo \{module\.position\}/);
  assert.match(sheet, /lessonCountLabel\(module\.lessons\.length\)/);
});

test("Vitrine: a linha do banner quebra no celular em vez de cortar o atalho para o Destaque", async () => {
  const editor = await read("../src/components/admin/v2/storefront/vitrine-editor.tsx");
  const bannerRow = editor.slice(editor.indexOf(">Banner<"), editor.indexOf("Editar em Destaque") + 40);

  assert.doesNotMatch(bannerRow, /truncate text-xs/, "a frase com o link não é cortada com reticências");
  assert.match(bannerRow, /whitespace-nowrap underline/);
});

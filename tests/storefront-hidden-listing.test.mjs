import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// "Oculto por enquanto" (content_items.listing = 'hidden') na area do aluno: fora da vitrine e da lista
// "disponivel para comprar", presente em Minhas compras e na pagina do produto para quem tem acesso.

const listing = await import("../src/server/catalog/storefront-listing.ts");

const catalog = [
  { id: "course-aberto", listing: undefined },
  { id: "course-listado", listing: "listed" },
  { id: "course-oculto", listing: "hidden" },
  { id: "course-oculto-comprado", listing: "hidden" },
  { id: "course-comprado", listing: "listed" }
];
const owned = new Set(["course-oculto-comprado", "course-comprado"]);
const hasAccess = (item) => owned.has(item.id);
const ids = (items) => items.map((item) => item.id);

test("vitrine aberta (Produtos a venda, Em breve, secoes padrao) nunca mostra oculto", () => {
  assert.deepEqual(ids(listing.onlyListedItems(catalog)), ["course-aberto", "course-listado", "course-comprado"]);
});

test("'disponivel para comprar' = sem acesso e listado", () => {
  assert.deepEqual(ids(listing.itemsAvailableForSale(catalog, hasAccess)), ["course-aberto", "course-listado"]);
});

test("Minhas compras mostra tudo o que o aluno tem, inclusive o oculto", () => {
  assert.deepEqual(ids(listing.purchasedItems(catalog, hasAccess)), ["course-oculto-comprado", "course-comprado"]);
});

test("secao manual, estrutura e cursos da formacao: oculto so para quem tem acesso", () => {
  assert.deepEqual(ids(listing.itemsVisibleTo(catalog, hasAccess)), [
    "course-aberto",
    "course-listado",
    "course-oculto-comprado",
    "course-comprado"
  ]);
  assert.deepEqual(ids(listing.itemsVisibleTo(catalog, () => false)), ["course-aberto", "course-listado", "course-comprado"]);
});

test("pagina do produto oculto responde como inexistente para quem nao tem acesso", () => {
  assert.equal(listing.canOpenProductPage({ listing: "hidden" }, false), false);
  assert.equal(listing.canOpenProductPage({ listing: "hidden" }, true), true);
  assert.equal(listing.canOpenProductPage({ listing: "listed" }, false), true);
  assert.equal(listing.canOpenProductPage({}, false), true, "item antigo sem a coluna continua listado");
});

test("a area do aluno usa estas regras nos pontos certos", () => {
  const store = readFileSync(new URL("../src/server/db/platform-store.ts", import.meta.url), "utf8");
  const block = (start, end) => {
    const from = store.indexOf(start);
    assert.ok(from >= 0, `${start} existe`);
    return store.slice(from, store.indexOf(end, from + start.length));
  };

  assert.match(block("function getProductsAvailableForSale", "function getOnlineCourseSectionLabel"), /onlyListedItems\(getSellableItems\(database\)\)/);
  assert.match(block("function getHomeCourseModuleRows", "function getDefaultHomeSectionConfigs"), /onlyListedItems\(getSellableItems\(database\)\)/);

  const resolver = block("function resolveConfiguredHomeRows", "function getHomeModalStructures");
  assert.match(resolver, /onlyListedItems\(database\.upcomingProducts\)/);
  assert.match(resolver, /itemsVisibleTo\(/);
  assert.match(resolver, /items = getPurchasedProducts\(database, accessPreviewMode, userAccessKeys\);/);

  assert.match(block("export async function getContentPageData", "export async function"), /canOpenProductPage\(item, hasPurchaseAccess\(item, accessPreviewMode, userAccessKeys\)\)/);
  assert.match(store, /\.\.\.\(row\.listing === "hidden" \? \{ listing: "hidden" as const \} : \{\}\)/);
  assert.doesNotMatch(store, /listing: (?:item|input)\.listing/, "o platform-store nunca grava listing: so o catalogo v2 (coluna propria)");
});

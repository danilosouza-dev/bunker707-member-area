import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8").catch(() => "");
}

const typesSource = await readSource("../src/lib/platform-types.ts");
const storeSource = await readSource("../src/server/db/platform-store.ts");
const routeSource = await readSource("../src/app/api/admin/home-sections/route.ts");
const migrationSource = await readSource("../supabase/migrations/202607100003_home_sections.sql");
const editorSource = await readSource("../src/components/admin/personalization/home-showcase-editor.tsx");
const dashboardSource = await readSource("../src/components/admin-dashboard.tsx");
const featuredSource = await readSource("../src/components/featured-structure-home-section.tsx");
const homePageSource = await readSource("../src/app/page.tsx");

test("home sections have one canonical persisted configuration contract", () => {
  assert.match(typesSource, /export type HomeSectionType/);
  assert.match(typesSource, /export type HomeSectionContentSource/);
  assert.match(typesSource, /export type HomeSectionLayout/);
  assert.match(typesSource, /export type HomeSectionConfig/);
  assert.match(typesSource, /sectionType: HomeSectionType/);
  assert.match(typesSource, /contentSource: HomeSectionContentSource/);
  assert.match(typesSource, /layout: HomeSectionLayout/);
  assert.match(typesSource, /homeSectionConfigs: HomeSectionConfig\[\]/);
});

test("structural sections share compact and immersive rendering between preview and home", () => {
  assert.match(featuredSource, /layout === "immersive"/);
  assert.match(featuredSource, /backgroundImage/);
  assert.match(featuredSource, /Immersiva/);
  assert.match(featuredSource, /structureItems/);
  assert.match(homePageSource, /FeaturedStructureHomeSection/);
  assert.match(editorSource, /FeaturedStructureHomeSection/);
});

test("personalization exposes a functional three-panel home editor", () => {
  for (const contract of [
    "Estrutura da Home",
    "Arraste para ordenar",
    "Criar secao",
    "Alteracoes nao publicadas",
    "Salvar alteracoes",
    "Selecao manual",
    "Layout imersivo"
  ]) {
    assert.match(editorSource, new RegExp(contract));
  }

  assert.match(editorSource, /onDragStart/);
  assert.match(editorSource, /onDrop/);
  assert.match(editorSource, /moveSection/);
  assert.match(editorSource, /return next\.map\(\(section, order\) => \(\{ \.\.\.section, order \}\)\);/);
  assert.match(editorSource, /\/api\/admin\/home-sections/);
  assert.match(dashboardSource, /HomeShowcaseEditor/);
  assert.match(dashboardSource, /onPublished=\{updateDashboardData\}/);
});

test("section menus act on their own section and close after completing an action", () => {
  const discardBlock = editorSource.slice(
    editorSource.indexOf("function discardChanges"),
    editorSource.indexOf("async function publishChanges")
  );
  const publishBlock = editorSource.slice(
    editorSource.indexOf("async function publishChanges"),
    editorSource.indexOf("const canCreate")
  );

  assert.match(editorSource, /updateSection\(section\.id, \{ isActive: !section\.isActive \}\)/);
  assert.match(discardBlock, /setOpenMenuId\(null\)/);
  assert.match(publishBlock, /setOpenMenuId\(null\)/);
});

test("automatic sources cannot be duplicated into an invalid published configuration", () => {
  assert.match(editorSource, /function canDuplicateSection/);
  assert.match(editorSource, /if \(!source \|\| !canDuplicateSection\(source\)\) return;/);
  assert.match(editorSource, /disabled=\{!canDuplicateSection\(section\)\}/);
  assert.match(editorSource, /disabled=\{!canDuplicateSection\(selected\)\}/);
});

test("home sections are resolved and published through an authenticated API", () => {
  assert.match(storeSource, /function getDefaultHomeSectionConfigs/);
  assert.match(storeSource, /function resolveConfiguredHomeRows/);
  assert.match(storeSource, /export async function publishHomeSections/);
  assert.match(storeSource, /key: "homeSections"/);
  assert.match(routeSource, /requireApiRole\("storefront\.write"\)/);
  assert.match(routeSource, /publishHomeSections/);
  assert.match(routeSource, /export async function PUT/);
  assert.match(migrationSource, /create table if not exists public\.home_sections/);
  assert.match(migrationSource, /create table if not exists public\.home_section_items/);
});

test("products for sale exclude items the current student can already access", () => {
  const availableProductsBlock = storeSource.slice(
    storeSource.indexOf("function getProductsAvailableForSale"),
    storeSource.indexOf("function getOnlineCourseSectionLabel")
  );
  const resolverBlock = storeSource.slice(
    storeSource.indexOf("function resolveConfiguredHomeRows"),
    storeSource.indexOf("function getHomeModalStructures")
  );

  assert.match(availableProductsBlock, /getSellableItems\(database\)/);
  assert.match(availableProductsBlock, /\.filter\(\(item\) => !hasPurchaseAccess\(item, accessPreviewMode, userAccessKeys\)\)/);
  assert.match(
    resolverBlock,
    /items = getProductsAvailableForSale\(database, accessPreviewMode, userAccessKeys\);/
  );
});

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

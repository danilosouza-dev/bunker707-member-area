import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminPageSource = await readFile(new URL("../src/app/admin/page.tsx", import.meta.url), "utf8");
const adminDashboardSource = await readFile(new URL("../src/components/admin-dashboard.tsx", import.meta.url), "utf8");
const adminDataSource = await readFile(new URL("../src/lib/admin-mock-data.ts", import.meta.url), "utf8");

test("admin route renders the CMS dashboard", () => {
  assert.match(adminPageSource, /import \{ AdminDashboard \} from "@\/components\/admin-dashboard";/);
  assert.match(adminPageSource, /return <AdminDashboard \/>;/);
});

test("admin dashboard exposes the core CMS views", () => {
  for (const label of ["Visao geral", "Catalogo", "Estrutura", "Liberacao", "Acessos"]) {
    assert.match(adminDashboardSource, new RegExp(label));
  }
});

test("admin CMS models release rules by time, activity, entitlements and webhooks", () => {
  assert.match(adminDashboardSource, /Depois da compra/);
  assert.match(adminDashboardSource, /horas/);
  assert.match(adminDashboardSource, /dias/);
  assert.match(adminDataSource, /adminReleaseRules/);
  assert.match(adminDataSource, /activity_required/);
  assert.match(adminDataSource, /adminEntitlements/);
  assert.match(adminDataSource, /adminWebhookEvents/);
});

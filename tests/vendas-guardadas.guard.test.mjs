import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// Guarda da venda guardada (docs/32 §2.2 e §11.3; docs/18 §1.2): o que se le na migracao 202611110002 e no codigo.
// - a migracao: duas secoes MCP, idempotente; o unico drop e o do check de webhook_events.outcome, trocado pelo mesmo com
//   'held'; held_sales so do service_role (RLS ligada, revoke de anon e authenticated, grant ao service_role), os checks
//   nomeados, os indices e o gatilho com a funcao que ja existe dentro de "if not exists"; nada de delete, funcao nova,
//   politica, Storage, truncate ou security definer;
// - as migracoes ate a 202611110001 continuam byte a byte;
// - o adaptador le so colunas que a tabela tem, e o check do resultado tem todos os resultados do app;
// - quem toca na tabela: so o store e a leitura das telas; as regras puras ficam puras; o que le o banco e "server-only";
// - a tarefa `vendas-guardadas` vem logo depois da conferencia da licenca.

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const sqlCodeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");
const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

const MIGRATION = "supabase/migrations/202611110002_held_sales.sql";

function sourceFiles(directory) {
  return readdirSync(new URL(directory, root), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx|mts|js|mjs)$/.test(entry.name))
    .map((entry) => `${entry.parentPath.replace(new URL(root).pathname, "").replace(/\/?$/, "/")}${entry.name}`);
}

test("a 202611110002: duas seções MCP, idempotente, e o único drop é o do check do resultado", () => {
  const migration = read(MIGRATION);
  const code = sqlCodeOf(migration);

  assert.equal((migration.match(/^ \* \d\. .+ MCP\.$/gm) ?? []).length, 2, "duas secoes, marcadas MCP");
  assert.match(migration, /^-- Idempotente: pode ser executada mais de uma vez sem efeito colateral\.$/m);
  assert.doesNotMatch(migration, /popup_design/, "a guarda do Livre proibe migracao nova que cite a coluna do design");
  assert.doesNotMatch(code, /\bpublic\.webinars?\b|\bpublic\.webinar_\w+/);
  assert.deepEqual(code.match(/\bdrop\b[^;]*;/gi), ["drop constraint if exists webhook_events_outcome_check;"]);

  for (const proibido of [
    /\bdelete\s+from\b/i,
    /\bcreate\s+(?:or\s+replace\s+)?function\b/i,
    /\bcreate\s+policy\b|\balter\s+policy\b/i,
    /storage\.objects/i,
    /\btruncate\b/i,
    /\bconcurrently\b/i,
    /security\s+definer/i
  ]) {
    assert.doesNotMatch(code, proibido);
  }

  assert.equal((code.match(/\bcreate table\b/gi) ?? []).length, 1);
  assert.equal((code.match(/\bcreate table if not exists public\.held_sales \(/g) ?? []).length, 1);
  assert.equal((code.match(/\bcreate (?:unique )?index\b/gi) ?? []).length, (code.match(/\bcreate (?:unique )?index if not exists\b/gi) ?? []).length);
});

test("a 202611110002: o check do resultado tem todos os resultados do app, e held_sales é só do service_role", async () => {
  const code = sqlCodeOf(read(MIGRATION));
  const { SALE_OUTCOMES } = await import("../src/server/payments/model.ts");
  const check = code.match(/add constraint webhook_events_outcome_check\s*check \(outcome is null or outcome in \(([^)]*)\)\);/);

  assert.ok(check, "o check novo do resultado");
  assert.deepEqual(
    [...check[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort(),
    [...SALE_OUTCOMES].sort(),
    "o banco aceita exatamente os resultados que o app grava"
  );

  for (const constraint of [
    /constraint held_sales_provider_known check \(provider in \('hotmart', 'ticto', 'kiwify'\)\)/,
    /constraint held_sales_transaction_size check \(char_length\(transaction_id\) between 1 and 200\)/,
    /constraint held_sales_products_size check \(cardinality\(product_ids\) between 1 and 64 and array_position\(product_ids, null\) is null\)/,
    /constraint held_sales_reason_format check \(reason ~ '\^\[a-z_\]\{1,40\}\$'\)/,
    /constraint held_sales_status_known check \(status in \('held', 'granted', 'discarded'\)\)/,
    /constraint held_sales_resolved_pair check \(\(status = 'held'\) = \(resolved_at is null\)\)/
  ]) {
    assert.match(code, constraint);
  }

  assert.equal((code.match(/\bconstraint held_sales_\w+ check \(/g) ?? []).length, 10, "os checks nomeados");
  assert.match(code, /webhook_event_id uuid not null references public\.webhook_events\(id\) on delete cascade/);
  assert.match(code, /create unique index if not exists held_sales_webhook_event_idx on public\.held_sales \(webhook_event_id\);/);
  assert.match(code, /create index if not exists held_sales_pending_idx on public\.held_sales \(held_at, id\) where status = 'held';/);
  assert.match(
    code,
    /do \$\$\s*begin\s*if not exists \(\s*select 1 from pg_trigger\s*where tgname = 'set_held_sales_updated_at' and tgrelid = 'public\.held_sales'::regclass\s*\) then\s*create trigger set_held_sales_updated_at\s*before update on public\.held_sales\s*for each row execute function public\.set_updated_at\(\);\s*end if;\s*end;\s*\$\$;/
  );
  assert.match(code, /alter table public\.held_sales enable row level security;/);
  assert.match(code, /revoke all on public\.held_sales from anon, authenticated;/);
  assert.match(code, /grant select, insert, update, delete on public\.held_sales to service_role;/);
  assert.doesNotMatch(code, /\bgrant\b[^;]*\b(?:anon|authenticated)\b/i);
});

test("as migrações até a 202611110001 continuam byte a byte (a 202611110002 só acrescenta)", () => {
  const dir = new URL("supabase/migrations/", root);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const before = files.filter((name) => name <= "202611110001_license_state_request_host.sql");
  const hash = createHash("sha256");

  for (const name of before) {
    hash.update(`${name}\n`);
    hash.update(readFileSync(new URL(name, dir)));
  }

  assert.equal(before.length, 66);
  assert.equal(hash.digest("hex"), "bfe1d3915d7b402a4f9c6d68d0626a2edebcf411a7f66c51aa0817d4dd90bcba", "uma migracao ja aplicada mudou");
  assert.ok(files.includes("202611110002_held_sales.sql"));
});

test("o adaptador lê só colunas que a tabela tem", () => {
  const code = sqlCodeOf(read(MIGRATION));
  const body = code.slice(code.indexOf("create table if not exists public.held_sales ("), code.indexOf("constraint held_sales_provider_known"));
  const tableColumns = [...body.matchAll(/^\s+([a-z_]+) (?:uuid|text|text\[\]|integer|timestamptz)\b/gm)].map((match) => match[1]).sort();
  const store = read("src/server/payments/held-sales-store.ts");
  const adapterColumns = store.match(/export const HELD_SALE_COLUMNS =\s*"([^"]+)";/)[1].split(",").sort();

  assert.deepEqual(tableColumns, [...adapterColumns, "created_at", "updated_at"].sort());
});

test("quem toca em held_sales: o store e a leitura das telas; as regras ficam puras; o resto é server-only", () => {
  const sources = sourceFiles("src/");
  const citing = sources.filter((file) => /\.from\(\s*["'`]held_sales["'`]/.test(codeOf(read(file)))).sort();

  assert.deepEqual(citing, ["src/server/payments/held-sales-queries.ts", "src/server/payments/held-sales-store.ts"]);

  for (const path of ["src/server/payments/held-sales-model.ts", "src/server/email/templates/held-sales.ts"]) {
    const source = read(path);
    assert.doesNotMatch(source, /^import "server-only";/m, `${path} carrega pelo Node`);
    assert.doesNotMatch(source, /from "@\//, `${path} sem o alias "@/"`);
  }

  for (const path of [
    "src/server/payments/held-sales-store.ts",
    "src/server/payments/held-sales-queries.ts",
    "src/server/payments/held-sales-release.ts",
    "src/server/payments/held-sales-notice.ts",
    "src/server/jobs/held-sales-job.ts"
  ]) {
    assert.match(read(path), /^import "server-only";/m, path);
  }

  // A lista Vendas recebidas e do navegador: so o modelo puro de sempre, nunca o da venda guardada (que puxa a Licenca).
  assert.doesNotMatch(read("src/components/admin/v2/settings/sales/sales-events-table.tsx"), /held-sales/);
  // A lista das vendas guardadas e montada no servidor: nenhum JavaScript novo.
  assert.doesNotMatch(read("src/components/admin/v2/settings/sales/held-sales-card.tsx"), /^["']use client["'];/m);
});

test("a tarefa vendas-guardadas está no registro logo depois da conferência da licença e no comentário dos jobs", () => {
  const registry = read("src/server/jobs/registry.ts");

  assert.match(registry, /, licenseCheckInJob, heldSalesJob, communicationMediaJob\];/);
  assert.match(registry, /- `vendas-guardadas` \(/);
  assert.match(read("src/server/jobs/held-sales-job.ts"), /export const HELD_SALES_JOB_NAME = "vendas-guardadas";/);
});

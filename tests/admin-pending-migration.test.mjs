import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Deploy antes da migracao (202610110010-202610170008): as telas novas do admin mostram o aviso em vez de
// quebrar, e a area do aluno e o admin legado nao dependem do que a migracao cria.

const pending = await import("../src/server/db/pending-migration.ts");

test("reconhece os erros de objeto inexistente do Postgres e do PostgREST", () => {
  for (const code of ["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"]) {
    assert.equal(pending.isMissingSchemaObjectError({ code, message: "x" }), true, code);
  }

  assert.equal(pending.isMissingSchemaObjectError({ message: "column content_items.listing does not exist" }), true);
  assert.equal(
    pending.isMissingSchemaObjectError({ message: "Could not find the function public.community_stats(p_content_id) in the schema cache" }),
    true
  );
});

test("erros comuns do banco nao viram aviso de migracao", () => {
  assert.equal(pending.isMissingSchemaObjectError(null), false);
  assert.equal(pending.isMissingSchemaObjectError({ code: "23505", message: "duplicate key value" }), false);
  assert.equal(pending.isMissingSchemaObjectError({ code: "57014", message: "canceling statement due to statement timeout" }), false);
  assert.equal(pending.isMissingSchemaObjectError({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }), false);
});

test("toDbError separa migracao pendente de falha comum", () => {
  const missing = pending.toDbError({ code: "42703", message: "column content_items.listing does not exist" }, "Produto");
  assert.equal(pending.isPendingMigrationError(missing), true);
  assert.match(missing.message, /^Produto: /);

  const other = pending.toDbError({ code: "23505", message: "duplicate key value" }, "Produto");
  assert.equal(pending.isPendingMigrationError(other), false);
  assert.equal(other.message, "Produto: duplicate key value");
});

test("loadUnlessPendingMigration devolve o aviso so para migracao pendente", async () => {
  assert.deepEqual(await pending.loadUnlessPendingMigration(async () => 42), { data: 42, ok: true });

  const originalError = console.error;
  console.error = () => {};

  try {
    const result = await pending.loadUnlessPendingMigration(async () => {
      throw pending.toDbError({ code: "PGRST202", message: "Could not find the function" }, "Comunidade");
    });
    assert.deepEqual(result, { ok: false, pendingMigration: true });
  } finally {
    console.error = originalError;
  }

  // notFound()/redirect() e falhas comuns seguem adiante.
  const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  await assert.rejects(pending.loadUnlessPendingMigration(async () => { throw notFound; }), notFound);
  await assert.rejects(pending.loadUnlessPendingMigration(async () => { throw new Error("rede"); }), /rede/);
});

test("o aviso cita as migracoes no vocabulario do produtor", () => {
  assert.equal(pending.PENDING_MIGRATION_MESSAGE, "Esta tela precisa da atualização do banco (migrações 202610110010-202610170008).");
});

async function listFiles(dir) {
  const root = new URL(dir, import.meta.url);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => `${entry.parentPath}/${entry.name}`);
}

test("area do aluno, admin legado e rotas REST nao usam funcoes, tabelas ou colunas das migracoes novas", async () => {
  // Criados por 202610110011, 202610110012, 202610110020, 202610120001 e 202610120002
  // (content_items.listing e lido so como opcional).
  const newObjects =
    /admin_today_alerts|admin_access_buckets|get_ai_usage_summary_between|admin_product_list|admin_reorder_product_content|admin_patch_product_settings|admin_(?:add|remove)_course_(?:to|from)_formation|admin_reorder_formation_courses|admin_save_combo|admin_product_cohorts|admin_product_students_with_access|community_(?:lesson_scope|unanswered|stats|comment_list|reported_comments|top_commenters|lesson_rows|filter_options|overdue_count|quick_replies|open_questions|report_state)|resolved_at|resolved_by/;
  const outsideAdminV2 = (file) =>
    !file.includes("/src/app/admin/(v2)/") && !file.includes("/src/components/admin/v2/");
  const files = [
    ...(await listFiles("../src/app/")).filter(outsideAdminV2),
    ...(await listFiles("../src/components/")).filter(outsideAdminV2),
    ...(await listFiles("../src/lib/")),
    new URL("../src/server/db/platform-store.ts", import.meta.url).pathname,
    new URL("../src/server/comments/comment-store.ts", import.meta.url).pathname
  ];

  assert.ok(files.length > 50);

  for (const file of files) {
    assert.doesNotMatch(await readFile(file, "utf8"), newObjects, file);
  }
});

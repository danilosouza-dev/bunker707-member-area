import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Guarda da v3b-2 dos pop-ups (docs/29 §3.1 e §8.2; docs/18 §1.2): o que se le na migracao 202610260001.
// - as migracoes ate a 202610250001 continuam byte a byte, e a 0026 e o texto exato da spec;
// - cinco secoes pelo MCP (a 5 sozinha), idempotente, sem drop, delete, gatilho, create policy nem concurrently,
//   exatamente um alter policy (o insert do aluno em student_events recusa as linhas dos avisos) e sem a coluna do
//   design (a guarda do Livre proibe);
// - a funcao do relatorio confere pagina, momento e jeito de fechar com as mesmas listas do app (uma linha de
//   numeros por item) sem a repeticao {1,240} da expressao e sem juntar tabelas grandes, e o check dos produtos
//   confere id por id com o mesmo id do app e o mesmo teto;
// - as duas funcoes sao so do service_role.

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const sqlCodeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");

const MIGRATION = "supabase/migrations/202610260001_communication_v3b2.sql";
const model = await import("../src/server/communications/popup-display-model.ts");

/** O corpo de uma funcao criada na migracao (entre os dois $$). */
function functionBody(code, name) {
  const start = code.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} existe`);
  const open = code.indexOf("$$", start);
  const close = code.indexOf("$$", open + 2);

  return { body: code.slice(open + 2, close), header: code.slice(start, open) };
}

test("as migracoes ate a 202610250001 continuam byte a byte; a 0026 e o texto exato da spec (§3.1, com o relatorio do integrador)", () => {
  const dir = new URL("supabase/migrations/", root);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const before = files.filter((name) => name <= "202610250001_communication_templates.sql");
  const hash = createHash("sha256");

  for (const name of before) {
    hash.update(`${name}\n`);
    hash.update(readFileSync(new URL(name, dir)));
  }

  assert.equal(before.length, 51);
  assert.equal(hash.digest("hex"), "7b19197f33725ba6ec0f1d0f1210eaadf3cf5c962504ccc4eda183f453a793d8", "uma migracao ja aplicada mudou");
  assert.ok(files.includes("202610260001_communication_v3b2.sql"));
  assert.equal(
    createHash("sha256").update(read(MIGRATION)).digest("hex"),
    "44566be50ca166161f25b222e01944236470e3a515b6bca7320d61d9f3b76ae8",
    "a 202610260001 e o texto exato da spec (§3.1): mudou? atualize a spec e este hash juntos"
  );
});

test("a 0026: cinco secoes MCP (a 5 sozinha), idempotente, sem drop, delete, gatilho, create policy, concurrently nem a coluna do design", () => {
  const migration = read(MIGRATION);
  const code = sqlCodeOf(migration);
  const sections = migration.match(/^ \* \d\. .+$/gm) ?? [];

  assert.equal(sections.length, 5, "cinco secoes");
  sections.forEach((line, index) => {
    assert.ok(line.startsWith(` * ${index + 1}. `), line);
    assert.match(line, /\bMCP\b/, `secao ${index + 1} marcada MCP`);
  });
  assert.match(sections[4], /sozinha/, "a 5 vai sozinha");
  assert.match(migration, /^-- Idempotente: pode ser executada mais de uma vez sem efeito colateral\.$/m);
  assert.doesNotMatch(migration, /popup_design/, "a guarda do Livre proibe migracao nova que cite a coluna do design");

  assert.doesNotMatch(code, /\bdrop\b/i);
  assert.doesNotMatch(code, /\bdelete\b/i);
  assert.doesNotMatch(code, /\bcreate\s+trigger\b/i);
  assert.doesNotMatch(code, /\bcreate\s+policy\b/i);
  assert.doesNotMatch(code, /\bconcurrently\b/i);
  assert.doesNotMatch(code, /\btruncate\b/i);
  assert.doesNotMatch(code, /storage\.objects/i);

  // Colunas e indice com if not exists; o check dentro de "if not exists" no pg_constraint.
  assert.match(code, /alter table public\.campaigns\s+add column if not exists popup_access_products text\[\] not null default array\[\]::text\[\];/);
  assert.match(code, /alter table public\.campaign_deliveries\s+add column if not exists first_access_at timestamptz;/);
  assert.match(code, /create index if not exists student_events_campaign_idx\s+on public\.student_events \(entity_id, event_type\)\s+where entity_type = 'campaign';/);
  assert.match(
    code,
    /do \$\$\s*begin\s*if not exists \(select 1 from pg_constraint where conname = 'campaigns_popup_access_v3b2'\) then\s*alter table public\.campaigns add constraint campaigns_popup_access_v3b2 check \(/
  );
  assert.equal((code.match(/\badd constraint\b/gi) ?? []).length, 1);
  assert.equal((code.match(/\badd column\b/gi) ?? []).length, 2);
  assert.equal((code.match(/\bcreate index\b/gi) ?? []).length, 1);
});

test("a 0026: exatamente um alter policy, o insert do aluno em student_events, que passa a recusar as linhas dos avisos", () => {
  const code = sqlCodeOf(read(MIGRATION));
  const policies = code.match(/alter\s+policy[\s\S]*?;/gi) ?? [];

  assert.equal(policies.length, 1);
  assert.match(policies[0], /^alter policy "Students can create own events" on public\.student_events\s+with check \(/);
  assert.match(policies[0], /with check \(auth\.uid\(\) = user_id and coalesce\(entity_type, ''\) <> 'campaign'\);$/);
  assert.doesNotMatch(policies[0], /\busing\b/i, "so a condicao do insert muda");
  assert.doesNotMatch(policies[0], /\bto\b/i, "mesmo papel");
  assert.doesNotMatch(code, /enable row level security|disable row level security/i, "o RLS das tabelas fica como estava");
});

test("o relatorio confere pagina, momento e jeito de fechar com as mesmas listas do app", () => {
  const { body } = functionBody(sqlCodeOf(read(MIGRATION)), "communication_popup_report");
  // A pagina: as mesmas paginas fixas e o mesmo id de POPUP_PAGE_KEY, sem a repeticao {1,240} da expressao (o
  // integrador mediu ~10 us por linha): as fixas por igualdade, o id pelo mesmo conjunto e o teto pelo tamanho.
  const pageKey = /^\^\(((?:[a-z]+\|)+)\(\?:content\|lesson\):(\[[^\]]+\])\{1,(\d+)\}\)\$$/.exec(model.POPUP_PAGE_KEY.source);
  assert.ok(pageKey, "POPUP_PAGE_KEY no formato conhecido (paginas fixas | content/lesson:id{1,N})");
  const fixedPages = pageKey[1].slice(0, -1).split("|");
  const idClass = pageKey[2];
  const idMax = Number(pageKey[3]);
  const quoted = (list) => list.map((value) => `'${value}'`).join(", ");

  assert.equal(`^${idClass}{1,${idMax}}$`, model.POPUP_PRODUCT_ID.source, "o id da pagina e o id de produto");
  assert.ok(body.includes(`when r.page in (${quoted(fixedPages)}) then r.page`), "as paginas fixas de POPUP_PAGE_KEY");
  assert.ok(
    body.includes(`when r.page ~ '^(?:content|lesson):${idClass}+$' and char_length(r.page) - position(':' in r.page) <= ${idMax} then r.page`),
    "o id de POPUP_PAGE_KEY, com o mesmo teto"
  );
  assert.doesNotMatch(body, /\{1,\d+\}/, "sem repeticao limitada na expressao (custa caro por linha)");
  assert.ok(body.includes(`in (${quoted(model.POPUP_TRIGGERS)})`), "POPUP_TRIGGERS igual ao da funcao");
  assert.ok(body.includes(`in (${quoted(model.POPUP_CLOSE_VIAS)})`), "POPUP_CLOSE_VIAS igual ao da funcao");
  assert.match(body, /when r\.page is null then 'home'/, "sem pagina = Inicio");
  assert.match(body, /when r\.moment is null then 'page_load'/, "sem momento = Ao abrir a pagina");
  assert.match(body, /else 'unknown'/, "sem jeito = closed_unknown");
  assert.match(body, /e\.metadata ->> 'page' as page, e\.metadata ->> 'trigger' as moment, e\.metadata ->> 'via' as via/);
  assert.match(body, /offset 0\s*\) r/, "cada chave do jsonb lida uma vez por linha");

  // Uma linha de numeros por item das listas do app: tipos de pagina (as fixas, content, lesson e other),
  // momentos (POPUP_TRIGGERS e other) e resultados (clique, Nao mostrar de novo, Lembrar depois e cada jeito).
  const items = [
    ["opened", "", "opened"],
    ...[...fixedPages, "content", "lesson", "other"].map((kind) => ["opened_kind", kind, `kind_${kind}`]),
    ...[...model.POPUP_TRIGGERS, "other"].map((moment) => ["opened_trigger", moment, `moment_${moment}`]),
    ...["clicked", "dismissed", "snoozed", ...[...model.POPUP_CLOSE_VIAS, "unknown"].map((via) => `closed_${via}`)].map((outcome) => [
      "outcome",
      outcome,
      `outcome_${outcome}`
    ]),
    ["outcomes", "", "outcomes"]
  ];

  for (const [metric, item, column] of items) {
    assert.ok(body.includes(`('${metric}', '${item}', t.${column}_total, t.${column}_students)`), `${metric}/${item}`);
    assert.ok(
      body.includes(`sum(least(p.${column}, p.impressions)) as ${column}_total, count(*) filter (where p.${column} > 0) as ${column}_students`),
      `${metric}/${item}: nunca mais vezes do que a linha diz`
    );
  }

  assert.equal((body.match(/sum\(least\(p\.\w+, p\.impressions\)\)/g) ?? []).length, items.length, "nenhum item a mais");
  assert.match(body, /sum\(least\(q\.n, q\.impressions\)\)/, "produtos: nunca mais vezes do que a linha diz");
  assert.match(body, /where p\.impressions is not null/, "so quem tem linha vista");
  assert.match(body, /d\.impressions > 0/, "so quem viu");
  assert.match(body, /not exists \(select 1 from public\.admin_roles a where a\.user_id = d\.user_id\)/, "nunca a equipe");
  assert.match(body, /e\.entity_type = 'campaign'\s+and e\.entity_id = p_campaign_id::text/, "pelo indice parcial");
  assert.doesNotMatch(
    body,
    /\bjoin\s+(?!lateral\b)/i,
    "sem juntar tabelas grandes (a funcao planeja sem o id e erra o tamanho: um laco aninhado custava 27 s)"
  );
});

test("assinatura e privilegios do relatorio: security invoker, so o service_role executa", () => {
  const code = sqlCodeOf(read(MIGRATION));
  const { header } = functionBody(code, "communication_popup_report");

  assert.match(
    header,
    /^create or replace function public\.communication_popup_report\(p_campaign_id uuid\)\s+returns table \(metric text, item text, total bigint, students bigint\)\s+language sql\s+stable\s+security invoker\s+set search_path = pg_catalog, public\s+as $/
  );
  assert.match(code, /revoke all on function public\.communication_popup_report\(uuid\) from public, anon, authenticated;/);
  assert.match(code, /grant execute on function public\.communication_popup_report\(uuid\) to service_role;/);
  assert.doesNotMatch(code, /security definer/i);
});

test("o check dos produtos confere id por id (unnest, nunca array_to_string), com o id e o teto do app; so o service_role executa", () => {
  const code = sqlCodeOf(read(MIGRATION));
  const { body, header } = functionBody(code, "communication_popup_products_ok");

  assert.match(header, /^create or replace function public\.communication_popup_products_ok\(p_products text\[\]\)\s+returns boolean\s+language sql\s+immutable\s+set search_path = pg_catalog\s+as $/);
  assert.match(body, /unnest\(coalesce\(p_products, array\[\]::text\[\]\)\) as p\(id\)/);
  assert.match(body, /p\.id is null/);
  assert.ok(body.includes(`p.id !~ '${model.POPUP_PRODUCT_ID.source}'`), "POPUP_PRODUCT_ID igual ao da funcao");
  assert.match(body, new RegExp(`coalesce\\(cardinality\\(p_products\\), 0\\) <= ${model.POPUP_V3B2_RULES.accessProductsMax}\\b`), "o teto do app");
  assert.doesNotMatch(code, /array_to_string/i);

  const check = /add constraint campaigns_popup_access_v3b2 check \(([\s\S]*?)\n\s*\);/.exec(code)?.[1] ?? "";
  assert.match(check, /public\.communication_popup_products_ok\(popup_access_products\)/);
  assert.match(check, /cardinality\(popup_access_products\) = 0 or \(kind = 'popup' and popup_trigger = 'first_login'\)/, "so no primeiro acesso");
  assert.match(code, /revoke all on function public\.communication_popup_products_ok\(text\[\]\) from public, anon, authenticated;/);
  assert.match(code, /grant execute on function public\.communication_popup_products_ok\(text\[\]\) to service_role;/);
});

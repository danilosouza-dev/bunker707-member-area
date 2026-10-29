import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Guarda da migracao 202610300001 "Quem pode por regras" (docs/30 §1.6 e D41; docs/22 §3; docs/18 §1.2):
// - as migracoes ate a 202610290003 (aplicadas) continuam byte a byte; a 0028 continua com o check antigo do access_mode;
// - duas secoes MCP, idempotente, sem delete, truncate, create/alter policy, concurrently nem tabela nova; nenhum valor
//   novo no access_mode (o "both" do app grava 'product' + a coluna nova audience_restricts: o app de antes, num
//   rollback, le 'product' e continua exigindo o produto); o unico drop e o da versao anterior da propria funcao,
//   dentro da guarda pelo retorno;
// - communication_webinar_facts: create or replace, plpgsql, security invoker, search_path fixo, so service_role
//   (revoke de public, anon e authenticated), uma linha por aluno (as lives da vaga e da presenca em listas), a vaga
//   'registered', a presenca das sessoes ao vivo e gravadas (nunca o replay), as amostras depois do inicio (balde >= 0)
//   so das sessoes em 'waiting'/'live' (resolvidas antes numa variavel: as amostras pela chave, nunca a tabela inteira),
//   sem a equipe e sem a live excluida; todos os alunos por chave (p_after + p_limit, cada fonte pelo indice por user_id
//   com os mesmos filtros e o proprio limite; nunca OFFSET), a leitura sempre por `user_id = any` (nada de
//   `p_user_ids is null or`).

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const sqlCodeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");

const MIGRATION = "supabase/migrations/202610300001_webinars_quem_pode_regras.sql";
const model = await import("../src/server/webinars/model.ts");

function functionBody(code, name) {
  const start = code.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} existe`);
  const open = code.indexOf("$$", start);
  const close = code.indexOf("$$", open + 2);

  return { body: code.slice(open + 2, close), header: code.slice(start, open) };
}

test("as migracoes ate a 202610290003 continuam byte a byte; a 0028 continua com o check antigo do access_mode", () => {
  const dir = new URL("supabase/migrations/", root);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const before = files.filter((name) => name <= "202610290003_webinars_v3_ajustes.sql");
  const hash = createHash("sha256");

  for (const name of before) {
    hash.update(`${name}\n`);
    hash.update(readFileSync(new URL(name, dir)));
  }

  assert.equal(before.length, 56);
  assert.equal(hash.digest("hex"), "bc05a69924908f0ea3da37eb1a6315e6d662371709a82a4b1351e47a857d4273", "uma migracao ja aplicada mudou");
  assert.ok(files.includes("202610300001_webinars_quem_pode_regras.sql"));
  assert.match(
    sqlCodeOf(read("supabase/migrations/202610280001_webinars_v1.sql")),
    /access_mode text not null default 'everyone' check \(access_mode in \('everyone', 'product', 'audience', 'either'\)\)/,
    "o check em linha da 0028 (nome dado pelo Postgres: webinars_access_mode_check) nao muda"
  );
});

test("a 0030: duas secoes MCP, idempotente, so acrescenta; nenhum valor novo no access_mode; o unico drop e o da funcao antiga, dentro da guarda", () => {
  const migration = read(MIGRATION);
  const code = sqlCodeOf(migration);
  const sections = migration.match(/^ \* \d{1,2}\. .+$/gm) ?? [];

  assert.equal(sections.length, 2, "duas secoes");
  sections.forEach((line, index) => assert.ok(line.startsWith(` * ${index + 1}. `) && /\bMCP\b/.test(line), line));
  assert.match(migration, /^-- Idempotente: pode rodar de novo sem efeito\.$/m);
  assert.match(migration, /^-- Verificacao manual depois de aplicar:$/m, "o cabecalho traz as consultas de conferencia");
  assert.match(migration, /^-- {3}select pg_get_constraintdef\(oid\) from pg_constraint where conname = 'webinars_access_mode_check';$/m);
  assert.match(migration, /has_function_privilege\('authenticated', 'public\.communication_webinar_facts\(uuid\[\], uuid, integer\)', 'execute'\); -- false/);
  assert.match(migration, /^-- {3}explain \(analyze, buffers\) select \* from public\.communication_webinar_facts\($/m, "a conferencia do plano com 1 aluno");
  assert.doesNotMatch(migration, /popup_design/, "a guarda do Livre proibe migracao nova que cite a coluna do design");
  // O cabecalho diz o que o app de antes faz de verdade (rows.ts le um access_mode desconhecido como 'everyone').
  assert.match(migration, /le um access_mode que nao conhece como 'everyone'/);
  assert.doesNotMatch(migration, /a live fica fechada para o aluno/);

  const statements = code.replace(/'[^']*'/g, "''");
  assert.doesNotMatch(statements, /^\s*delete\b|\bdelete\s+from\b/im);
  assert.doesNotMatch(statements, /\btruncate\b|\bcreate\s+policy\b|\balter\s+policy\b|\bconcurrently\b|\bcreate\s+table\b|\bcreate\s+function\b/i);
  const drops = statements.match(/\bdrop\s+\w+(?:\s+if\s+exists)?\s+[\w.]+/gi) ?? [];
  assert.deepEqual(
    drops.map((drop) => drop.replace(/\s+/g, " ").toLowerCase()),
    ["drop function public.communication_webinar_facts"],
    "so a versao anterior da propria funcao"
  );
  assert.match(
    code,
    /if to_regprocedure\('public\.communication_webinar_facts\(uuid\[\]\)'\) is not null then\s+drop function public\.communication_webinar_facts\(uuid\[\]\);/,
    "o drop so da assinatura antiga, so p_user_ids (rodar de novo nao faz nada)"
  );
  assert.match(code, /alter table public\.webinars\s+add column if not exists audience_restricts boolean not null default false;/);
  assert.match(code, /comment on column public\.webinars\.audience_restricts is\s+'/);
  assert.doesNotMatch(code, /webinars_access_mode_check|\bboth\b|alter column access_mode/, "o check e os valores do access_mode nao mudam");
  assert.match(code, /create or replace function public\.communication_webinar_facts\(p_user_ids uuid\[\] default null, p_after uuid default null, p_limit integer default 1000\)/);
});

test("o 'both' do app cabe na coluna como 'product' + audience_restricts; os outros modos, como estao", () => {
  assert.deepEqual([...model.ACCESS_MODE_COLUMN_VALUES], ["everyone", "product", "audience", "either"]);
  assert.deepEqual(
    model.ACCESS_MODES.filter((mode) => !model.ACCESS_MODE_COLUMN_VALUES.includes(mode)),
    ["both"],
    "so o both fica fora da coluna"
  );
});

test("communication_webinar_facts: so service_role, security invoker; uma linha por aluno; vaga, presenca (nunca o replay), amostras so das sessoes em andamento, sem equipe; todos por chave, nunca OFFSET", () => {
  const code = sqlCodeOf(read(MIGRATION));
  const facts = functionBody(code, "communication_webinar_facts");
  const body = facts.body.replace(/\s+/g, " ");
  const [antes, leitura] = body.split(/ end if; return query /);
  const [abertas, escolha] = antes.split(/ if p_user_ids is null then /);

  assert.match(facts.header, /returns table \(user_id uuid, registered uuid\[\], attended uuid\[\]\)/, "uma linha por aluno");
  assert.match(facts.header, /language plpgsql\s+stable\s+security invoker/);
  assert.match(facts.header, /set search_path = pg_catalog, public/);
  assert.match(code, /revoke all on function public\.communication_webinar_facts\(uuid\[\], uuid, integer\) from public, anon, authenticated;/);
  assert.match(code, /grant execute on function public\.communication_webinar_facts\(uuid\[\], uuid, integer\) to service_role;/);
  assert.doesNotMatch(code, /grant[^;]*to (?:anon|authenticated|public)\b/i, "nada para anon, authenticated ou public");
  assert.doesNotMatch(code, /security definer/i);
  assert.doesNotMatch(body, /p_user_ids is null or|\boffset\b/i, "nunca o filtro com 'or' (sem indice) nem OFFSET");
  assert.ok(escolha && leitura, "as sessoes em andamento, a escolha dos alunos e a leitura");

  // As sessoes em andamento numa variavel: as amostras so delas, pela chave (session_id, user_id, bucket).
  assert.match(abertas, /v_limit integer := least\(greatest\(coalesce\(p_limit, 1000\), 1\), 1000\);/, "no maximo 1000 por pagina (o teto do PostgREST)");
  assert.match(
    abertas,
    /select coalesce\(array_agg\(s\.id\), '\{\}'\) into v_open from public\.webinar_sessions s where s\.kind in \('live', 'simulated'\) and s\.status in \('waiting', 'live'\);$/
  );

  // Todos, por chave: cada fonte depois de p_after, com os filtros da leitura e o proprio limite.
  const [todos, porIds] = escolha.split(/ else /);
  assert.match(porIds, /^v_ids := p_user_ids;/);
  assert.equal((todos.match(/\.user_id > v_after/g) ?? []).length, 3, "as tres fontes depois da chave");
  assert.equal((todos.match(/order by 1 limit v_limit \)/g) ?? []).length, 3, "cada fonte com o proprio limite");
  assert.equal((todos.match(/join public\.webinars w on w\.id = \w+\.webinar_id and w\.deleted_at is null/g) ?? []).length, 3, "a live excluida fora");
  assert.equal((todos.match(/not exists \(select 1 from public\.admin_roles x where x\.user_id = \w+\.user_id\)/g) ?? []).length, 3, "a equipe fora antes do limite");
  assert.match(todos, /r\.status = 'registered'/);
  assert.match(todos, /a\.user_id > v_after and s\.kind in \('live', 'simulated'\)/);
  assert.match(todos, /where ps\.session_id = any \(v_open\) and ps\.user_id > v_after and ps\.bucket >= 0/);
  assert.match(todos, /\) u order by u\.uid limit v_limit \) c;$/);

  // A leitura: sempre por user_id = any (v_ids), as tres fontes.
  assert.equal((leitura.match(/\w+\.user_id = any \(v_ids\)/g) ?? []).length, 3, "o filtro de alunos nas tres fontes");
  assert.match(leitura, /from public\.webinar_registrations r where r\.user_id = any \(v_ids\) and r\.status = 'registered'/, "so a vaga garantida");
  assert.match(leitura, /from public\.webinar_attendance a join public\.webinar_sessions s on s\.id = a\.session_id where a\.user_id = any \(v_ids\) and s\.kind in \('live', 'simulated'\)/, "presenca encerrada, ao vivo ou gravada");
  assert.match(
    leitura,
    /from public\.webinar_presence_samples ps join public\.webinar_sessions s on s\.id = ps\.session_id where ps\.session_id = any \(v_open\) and ps\.user_id = any \(v_ids\) and ps\.bucket >= 0/,
    "a sessao em andamento pelas amostras depois do inicio, so as dela"
  );
  assert.doesNotMatch(body, /'replay'/, "o replay nunca entra");
  assert.match(leitura, /join public\.webinars w on w\.id = f\.wid and w\.deleted_at is null/, "a live excluida nao conta");
  assert.match(leitura, /where not exists \(select 1 from public\.admin_roles x where x\.user_id = f\.uid\)/, "a equipe fica de fora");
  assert.match(leitura, /array_agg\(distinct f\.wid\) filter \(where f\.is_registered\), array_agg\(distinct f\.wid\) filter \(where f\.is_attended\)/);
  assert.match(leitura, /group by f\.uid order by f\.uid; end;/, "uma linha por aluno, na ordem do id (a chave da proxima pagina)");
});

test("o aviso de migracao pendente dos webinarios aponta a migracao mais nova que mexe nas tabelas webinar*", () => {
  // WEBINAR_COLUMNS le webinars.audience_restricts (desta migracao): num banco sem ela toda leitura de webinario da 42703,
  // e o aviso da tela e o log dos ticks precisam mandar aplicar a que falta, nunca uma ja aplicada.
  const dir = new URL("supabase/migrations/", root);
  const newest = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .filter((name) => /\bpublic\.webinars?\b|\bpublic\.webinar_\w+/.test(sqlCodeOf(readFileSync(new URL(name, dir), "utf8"))))
    .at(-1);
  const appMigration = read("src/server/webinars/db.ts").match(/WEBINARS_MIGRATION = "(\d+)"/)?.[1];

  assert.equal(newest, "202610300001_webinars_quem_pode_regras.sql");
  assert.equal(appMigration, newest.slice(0, 12), "WEBINARS_MIGRATION = o prefixo da migracao mais nova dos webinarios");
  assert.match(read("src/server/webinars/rows.ts"), /\baudience_restricts\b/, "a coluna desta migracao e lida pelo app");
});

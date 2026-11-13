import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import { assertOnlyAdds, assertSections, cumulativeHash, fileHash, migrationFiles, read, sqlCodeOf, statementsOf } from "./support/webinarios-migracao-guarda.mjs";

// Guarda da migracao da lista de pessoas que comentam da escola (pedido do produtor de 13/11/2026; docs/30 D115, §4.2;
// docs/21 §9.21; docs/18 §1.2): a 202611180001_webinars_pessoas_da_escola.sql.
// - as 76 migracoes ate a 202611170001 continuam byte a byte (hash acumulado); a 202611180001 vem depois dela e e o
//   texto exato (hash);
// - duas secoes MCP, idempotente; os unicos `drop` sao o `drop not null` da origem e o da chave estrangeira trocada
//   (atras da guarda do pg_constraint da nova); o unico `delete` e o das repetidas, depois de os itens e as perguntas
//   passarem para a que fica e antes do indice unico do nome; nada de grant, revoke, politica ou truncate;
// - a regra de quem fica e a mesma em todas as consultas (a mudada por ultimo); a lista parada (lock) na secao 2,
//   dentro de um bloco `do $$` (o CLI do Supabase aplica cada comando fora de uma transacao, e o lock table fora de uma
//   falha: o CI de 13/11/2026 pegou isso na primeira versao);
// - o app le a lista da escola (nenhum filtro pelo webinario), o Duplicar nao copia mais a lista, e o aviso de migracao
//   pendente aponta esta (WEBINARS_PERSONAS_SCHOOL_MIGRATION e WEBINARS_MIGRATION). O comportamento contra o banco de
//   verdade (o indice, a origem nula e a secao 2 numa transacao desfeita) esta em tests/integration/webinarios-pessoas.

const MIGRATION = "supabase/migrations/202611180001_webinars_pessoas_da_escola.sql";
const migration = read(MIGRATION);
const code = sqlCodeOf(migration);
const DROP_NOT_NULL = "alter table public.webinar_personas alter column webinar_id drop not null;";
const SURVIVOR = "first_value(p.id) over (partition by p.name_key order by p.updated_at desc, p.created_at desc, p.id) as survivor_id";
const dbSource = read("src/server/webinars/db.ts");
const store = read("src/server/webinars/persona-store.ts");

/** O `delete` das repetidas, como esta no arquivo (de "with ranked" ate o ponto e virgula). */
function deleteStatement() {
  const end = code.indexOf(";", code.indexOf("delete from public.webinar_personas p"));
  const start = code.lastIndexOf("with ranked as (", end);
  return code.slice(start, end + 1);
}

test("as 76 migracoes ate a 202611170001 continuam byte a byte; a 202611180001 vem depois e e o texto exato", () => {
  const applied = cumulativeHash("202611170001_webinars_v11.sql");
  assert.equal(applied.count, 76);
  assert.equal(applied.hash, "1525515791c86dd6d280e6c08877f4c4b5e6c1500ad20c3fc86c483e3f8059d5", "uma migracao ja aplicada mudou: a correcao vai numa migracao nova");
  const files = migrationFiles();
  assert.ok(files.indexOf("202611180001_webinars_pessoas_da_escola.sql") > files.indexOf("202611170001_webinars_v11.sql"), "depois da rodada v11");
  assert.equal(
    fileHash(MIGRATION),
    "9a48282a7cf6ee12636b5f230aa3fb78a4273a86e1e75fcda51870d05978741b",
    "a 202611180001 mudou: depois de aplicada na nuvem de teste (docs/21 §9.21), a correcao vai numa migracao nova; antes, aplique de novo e atualize este hash junto"
  );
});

test("duas secoes MCP, idempotente; so os dois drop (o not null da origem e a chave trocada) e o delete das repetidas; nada de grant, revoke nem politica", () => {
  assertSections(migration, 2);
  assert.equal(migration.split(DROP_NOT_NULL).length, 2, "o drop not null uma vez so");
  const del = deleteStatement();
  assert.equal(code.split(del).length, 2, "o delete uma vez so");
  assertOnlyAdds(migration.replace(DROP_NOT_NULL, "").replace(del, ""), { replaces: { webinar_personas_webinar_school: "webinar_personas_webinar_id_fkey" } });
  assert.equal((statementsOf(migration).match(/\bdrop\b/gi) ?? []).length, 2, "nenhum outro drop");
  assert.equal((statementsOf(migration).match(/\bdelete\s+from\b/gi) ?? []).length, 1, "nenhum outro delete");
  assert.doesNotMatch(statementsOf(migration), /\b(grant|revoke)\b/i, "a tabela continua so do service_role, como na 202611140001");
  // As duas secoes comecam com o lock_timeout (o MCP roda uma por chamada).
  assert.equal((code.match(/^set lock_timeout = '5s';$/gm) ?? []).length, 2);
});

test("a origem: aceita nulo e fica nula quando o webinario sai (on delete set null no lugar do cascade)", () => {
  assert.match(
    code,
    /alter table public\.webinar_personas drop constraint if exists webinar_personas_webinar_id_fkey;\s*alter table public\.webinar_personas add constraint webinar_personas_webinar_school\s+foreign key \(webinar_id\) references public\.webinars\(id\) on delete set null;/
  );
  assert.doesNotMatch(code, /on delete cascade/, "nenhuma pessoa some com o webinario");
});

test("juntar as repetidas: a mesma regra de quem fica em todas as consultas; a foto, os itens, as perguntas e a copia antes do delete; o indice unico do nome por ultimo, com a lista parada", () => {
  assert.equal(code.split(SURVIVOR).length - 1, 4, "a foto, os itens, as perguntas e o delete escolhem a mesma pessoa");
  const flat = code.replace(/\s+/g, " ");
  const order = [
    "lock table public.webinar_personas in share row exclusive mode;",
    "update public.webinar_personas s set avatar_path = photo.avatar_path",
    "update public.webinar_chat_script_items i set persona_id = r.survivor_id",
    "update public.webinar_questions q set persona_id = r.survivor_id",
    "update public.webinar_chat_script_items i set persona_name = p.name, persona_role = p.role, persona_avatar_path = p.avatar_path",
    "delete from public.webinar_personas p",
    "create unique index if not exists webinar_personas_school_name_idx on public.webinar_personas (name_key);"
  ].map((fragment) => {
    const at = flat.indexOf(fragment);
    assert.notEqual(at, -1, fragment);
    return at;
  });
  assert.deepEqual([...order].sort((a, b) => a - b), order, "na ordem: parar a lista, a foto, os itens, as perguntas, a copia, o delete e o indice");
  // A secao 2 inteira e um bloco so (o lock table pede uma transacao, e o CLI do Supabase aplica cada comando fora de
  // uma): do lock ao indice, dentro do mesmo `do $$ ... end; $$;`, e nenhum lock fora dele.
  const opens = flat.indexOf("do $$ begin lock table public.webinar_personas in share row exclusive mode;");
  assert.notEqual(opens, -1, "o bloco da secao 2 comeca pelo lock");
  const block = flat.slice(opens, flat.indexOf("end; $$;", opens));
  assert.match(block, /create unique index if not exists webinar_personas_school_name_idx on public\.webinar_personas \(name_key\);\s*$/, "o indice fecha o bloco");
  assert.equal((flat.match(/lock table/g) ?? []).length, 1, "nenhum lock fora do bloco");
  // A foto so entra na que fica sem foto; a pergunta so muda a ligacao (a copia gravada nela e o que a turma viu).
  assert.match(code, /where s\.id = photo\.survivor_id\s+and s\.avatar_path is null;/);
  const questions = code.slice(code.indexOf("update public.webinar_questions q"), code.indexOf(";", code.indexOf("update public.webinar_questions q")));
  assert.doesNotMatch(questions, /persona_name|persona_avatar_path|display_name/);
  // O delete so leva as que nao ficam.
  assert.match(deleteStatement(), /where p\.id = r\.id\s+and r\.id <> r\.survivor_id;$/);
  // A conferencia que o produtor roda depois de aplicar (docs/21 §9.21) esta no cabecalho, com o resultado.
  assert.match(migration, /^--\s+and column_name = 'webinar_id' and is_nullable = 'YES'\) as total; -- 3$/m);
  assert.match(migration, /having count\(\*\) > 1\) as repetidas; -- 0$/m);
});

test("o app le a lista da escola, o Duplicar nao copia a lista, e o aviso de migracao pendente aponta esta", () => {
  const list = store.slice(store.indexOf("export async function listPersonas("), store.indexOf("export async function fetchPersonaRow("));
  assert.doesNotMatch(list, /webinar_id/, "listPersonas e fetchPersonasByIds sem filtro pelo webinario");
  // So o nome no comentario de historia: nenhuma funcao com ele, nem chamada no Duplicar.
  const jsCode = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(jsCode(store), /copyPersonasToWebinar/);
  assert.doesNotMatch(jsCode(read("src/server/webinars/actions.ts")), /copyPersonasToWebinar/);
  assert.match(dbSource, /export const WEBINARS_PERSONAS_SCHOOL_MIGRATION = "202611180001";/);
  assert.match(dbSource, /export const WEBINARS_MIGRATION = "202611180001";/);
  const webinarFiles = migrationFiles().filter((name) => /webinar/.test(name));
  assert.equal(webinarFiles.at(-1), "202611180001_webinars_pessoas_da_escola.sql", "nenhuma migracao de webinario mais nova sem o aviso atualizado");
});

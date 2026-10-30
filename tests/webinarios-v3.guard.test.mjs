import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Guarda da fase 3 dos webinarios (docs/30 §4.1, §4.2, §5.3, §6.5, §6.7 e §11; docs/18 §1.2): o que se le na migracao
// 202610290002.
// - as migracoes ate a 202610290001 (aplicadas) continuam byte a byte, e a 0002 e o texto exato (hash);
// - seis secoes MCP, idempotente, sem create policy, alter policy, concurrently, truncate, delete nem drop;
// - as tres tabelas novas so do service_role (RLS, revoke de anon e authenticated, grant), sem politica;
// - os checks do banco batem com as listas do app (recorder-model.ts, live-schemas.ts, jitsi-token.ts, model.ts);
// - a ancora: webinar_mark_recording_anchor so do service_role, security invoker, uma vez, e recalcula o offset das
//   cinco tabelas da sessao no mesmo intervalo dos checks da 202610290001;
// - compativel com o rascunho ja aplicado num banco de ensaio: o que nao estava nele entra por if not exists ou por
//   constraint com nome (nenhuma tabela do rascunho muda de definicao).

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const sqlCodeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");

const MIGRATION = "supabase/migrations/202610290002_webinars_v3_live.sql";
const model = await import("../src/server/webinars/model.ts");
const recorder = await import("../src/server/webinars/recorder-model.ts");
const schemas = await import("../src/server/webinars/live-schemas.ts");
const token = await import("../src/server/webinars/jitsi-token.ts");
// db.ts tem "server-only": a constante e lida do texto.
const appMigration = read("src/server/webinars/db.ts").match(/WEBINARS_MIGRATION = "(\d+)"/)?.[1];

const sqlList = (values) => values.map((value) => `'${value}'`).join(", ");

function functionBody(code, name) {
  const start = code.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} existe`);
  const open = code.indexOf("$$", start);
  const close = code.indexOf("$$", open + 2);
  return { body: code.slice(open + 2, close), header: code.slice(start, open) };
}

const NEW_TABLES = ["webinar_session_bans", "webinar_user_bans", "webinar_recording_events"];

test("as migracoes ate a 202610290001 continuam byte a byte; a 0002 e o texto exato (ja aplicada); o app exige a mais nova (a 202610300007)", () => {
  const dir = new URL("supabase/migrations/", root);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const before = files.filter((name) => name <= "202610290001_webinars_v2_chat.sql");
  const hash = createHash("sha256");
  for (const name of before) {
    hash.update(`${name}\n`);
    hash.update(readFileSync(new URL(name, dir)));
  }
  assert.equal(before.length, 54);
  assert.equal(hash.digest("hex"), "4683178c895fd07d34ce7abf43a440a3cec9ffaf171fb85c3c396554ca37825e", "uma migracao ja aplicada mudou");
  assert.ok(files.includes("202610290002_webinars_v3_live.sql"));
  assert.equal(
    createHash("sha256").update(read(MIGRATION)).digest("hex"),
    "b48d8504a243ba8f7e860cb20e5b3342acd06cdf2571c3b9a3ec1d2795463fbd",
    "a 202610290002 mudou: aplique de novo na nuvem de teste (docs/21) e atualize este hash junto"
  );
  // O aviso aponta a mais nova pela ordem dos arquivos, a 202610300007 (os ajustes da fase 4, depois da 202610300001 do
  // Quem pode por regras); a fase 4 le webinar_sessions.jit (202610300005) em toda leitura de sessao, e as guardas
  // tests/webinarios-v4*.guard.test.mjs fixam as migracoes dela.
  assert.equal(appMigration, "202610300007", "o aviso de migracao pendente aponta a mais nova (a dos ajustes da fase 4; a guarda dela confere o arquivo)");
});

test("a 0002: seis secoes MCP, idempotente, sem create/alter policy, concurrently, truncate, delete nem drop", () => {
  const migration = read(MIGRATION);
  const code = sqlCodeOf(migration);
  const sections = migration.match(/^ \* \d{1,2}\. .+$/gm) ?? [];
  assert.equal(sections.length, 6, "seis secoes");
  sections.forEach((line, index) => assert.ok(line.startsWith(` * ${index + 1}. `), line));
  const blocks = migration.match(/^ \* \d{1,2}\. [\s\S]*?\*\//gm) ?? [];
  assert.equal(blocks.length, 6);
  blocks.forEach((block, index) => assert.match(block, /\bMCP\b/, `secao ${index + 1} marcada MCP`));
  assert.match(migration, /^-- Idempotente: pode rodar de novo sem efeito\.$/m);

  const statements = code.replace(/'[^']*'/g, "''");
  assert.doesNotMatch(statements, /\bdrop\b/i, "nenhum drop");
  assert.doesNotMatch(statements, /^\s*delete\b|\bdelete\s+from\b/im, "nenhum delete (so os `on delete` das chaves e o grant)");
  assert.doesNotMatch(statements, /\btruncate\b/i);
  assert.doesNotMatch(statements, /\bcreate\s+policy\b/i);
  assert.doesNotMatch(statements, /\balter\s+policy\b/i);
  assert.doesNotMatch(statements, /\bconcurrently\b/i);
  assert.doesNotMatch(statements, /storage\.objects/i);
  assert.doesNotMatch(statements, /\bcreate\s+trigger\b/i);

  assert.equal((code.match(/\bcreate table\b/gi) ?? []).length, 3);
  assert.equal((code.match(/create table if not exists public\.webinar_\w+/g) ?? []).length, 3);
  assert.equal((code.match(/\bcreate (?:unique )?index\b/gi) ?? []).length, (code.match(/\bcreate (?:unique )?index if not exists\b/gi) ?? []).length);
  assert.equal((code.match(/add column if not exists/g) ?? []).length, 9, "sete colunas na sessao e duas na gravacao");
  assert.equal((code.match(/\balter table public\.\w+ add column\b/g) ?? []).length, (code.match(/add column if not exists/g) ?? []).length);
  // Toda constraint nova tem nome e entra atras da guarda do pg_constraint (o rascunho pode ja ter as tabelas).
  const constraints = code.match(/add constraint (\w+)/g) ?? [];
  assert.equal(constraints.length, 4);
  for (const entry of constraints) {
    const name = entry.replace("add constraint ", "");
    assert.match(code, new RegExp(`if not exists \\(select 1 from pg_constraint where conname = '${name}'\\) then\\s*alter table public\\.\\w+ add constraint ${name}`), name);
  }
});

test("as tres tabelas novas sao so do service_role; nenhuma politica para authenticated", () => {
  const code = sqlCodeOf(read(MIGRATION));
  for (const table of NEW_TABLES) {
    assert.match(code, new RegExp(`create table if not exists public\\.${table} \\(`), table);
    assert.match(code, new RegExp(`alter table public\\.${table} enable row level security;`), table);
    assert.match(code, new RegExp(`revoke all on public\\.${table} from anon, authenticated;`), table);
    assert.match(code, new RegExp(`grant select, insert, update, delete on public\\.${table} to service_role;`), table);
  }
  assert.doesNotMatch(code, /grant[^;]*to (?:anon|authenticated|public)\b/i);
  assert.match(code, /primary key \(session_id, user_id, kind\)/, "uma linha por sessao, aluno e tipo");
  assert.match(code, /user_id uuid primary key references auth\.users\(id\) on delete cascade/, "banir: uma linha por aluno");
  assert.match(code, /on public\.webinar_recording_events \(session_id, state, coalesce\(file_name, ''\)\)\s*where session_id is not null/, "idempotencia do webhook (D17)");
  assert.match(code, /pg_column_size\(payload\) <= 65536/, "corpo bruto ate 64 KB");
});

test("os checks do banco batem com as listas do app", () => {
  const code = sqlCodeOf(read(MIGRATION));
  assert.match(code, new RegExp(`check \\(recorder_status in \\(${sqlList(recorder.RECORDER_STATUSES)}\\)\\)`));
  assert.match(code, new RegExp(`state text not null check \\(state in \\(${sqlList(schemas.RECORDER_STATES)}\\)\\)`));
  assert.match(code, new RegExp(`kind text not null check \\(kind in \\(${sqlList(schemas.BAN_KINDS)}\\)\\)`));
  assert.match(code, /check \(kind = 'muted' or until_at is null\)/, "remover nao tem prazo");
  assert.equal((code.match(/char_length\(reason\) <= 200/g) ?? []).length, 2, "o motivo nas duas tabelas de banimento");
  // O nome da sala: o mesmo desenho da conferencia do app (w-<uuid>-<16 letras sem ambiguidade>).
  const pattern = code.match(/room_name ~ '([^']+)'/)?.[1];
  assert.ok(pattern, "o check do nome da sala");
  const sample = token.newRoomName("bbbbbbbb-0000-4000-8000-000000000001");
  assert.ok(new RegExp(pattern).test(sample) && token.isRoomName(sample));
  assert.ok(!new RegExp(pattern).test("w-qualquer-coisa"));
  assert.match(code, /check \(kind = 'live' or \(room_name is null and recorder_status = 'none' and recording_requested_at is null and not room_locked\)\)/, "so a Live ao vivo tem sala e gravador");
});

test("a ancora: uma vez, so service_role, security invoker, e o offset das cinco tabelas no intervalo da 0029", () => {
  const code = sqlCodeOf(read(MIGRATION));
  const signature = "webinar_mark_recording_anchor(uuid, timestamptz)";
  const escaped = signature.replace(/[()]/g, "\\$&");
  assert.match(code, new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated;`));
  assert.match(code, new RegExp(`grant execute on function public\\.${escaped} to service_role;`));
  const anchor = functionBody(code, "webinar_mark_recording_anchor");
  assert.match(anchor.header, /security invoker/);
  assert.match(anchor.header, /set search_path = pg_catalog, public/);
  assert.match(anchor.body, /for update/, "trava a linha: dois cliques juntos gravam uma ancora so");
  assert.match(anchor.body, /if v_session\.recording_anchor_at is not null then[\s\S]*?'reason', 'already'/, "a ancora nunca e reescrita");
  assert.match(anchor.body, /v_session\.kind <> 'live' or v_session\.status not in \('waiting', 'live'\)/);
  assert.match(anchor.body, /recording_anchor_at = p_now/, "a hora do servidor, nunca a do navegador");
  assert.match(anchor.body, /recording_requested_at = null/, "o Gravar sai da fila");
  assert.match(anchor.body, /when v_session\.recorder_status in \('preparing', 'ready'\) then 'recording'/);
  for (const table of ["webinar_chat_messages", "webinar_reactions", "webinar_questions", "webinar_poll_answers", "webinar_polls"]) {
    assert.match(anchor.body, new RegExp(`update public\\.${table} \\w`), table);
  }
  const limits = model.CHAT_LIMITS;
  assert.equal((anchor.body.match(new RegExp(`greatest\\(${limits.offsetMinMs}, least\\(${limits.offsetMaxMs}, round\\(extract\\(epoch from \\(\\w\\.(?:created_at|opened_at) - p_now\\)\\) \\* 1000\\)\\)\\)::integer`, "g")) ?? []).length, 5);
  assert.doesNotMatch(anchor.body, /webinar_presence_samples/, "a presenca conta desde o inicio da live, nunca pela ancora");
});

/* ------------------------------------------------------------------------------------------------
 * 202610290003: os ajustes da revisao (a 0002 ja aplicada nao muda)
 * ---------------------------------------------------------------------------------------------- */

const AJUSTES = "supabase/migrations/202610290003_webinars_v3_ajustes.sql";

test("a 0003: tres secoes MCP, idempotente, so acrescenta; o unico drop e o do indice unico velho, depois do novo", () => {
  const migration = read(AJUSTES);
  const code = sqlCodeOf(migration);
  const sections = migration.match(/^ \* \d{1,2}\. .+$/gm) ?? [];
  assert.equal(sections.length, 3);
  sections.forEach((line, index) => assert.ok(line.startsWith(` * ${index + 1}. `) && /\bMCP\b/.test(line), line));
  assert.match(migration, /^-- Idempotente: pode rodar de novo sem efeito\.$/m);
  const statements = code.replace(/'[^']*'/g, "''");
  assert.doesNotMatch(statements, /^\s*delete\b|\bdelete\s+from\b/im);
  assert.doesNotMatch(statements, /\btruncate\b|\bcreate\s+policy\b|\balter\s+policy\b|\bconcurrently\b/i);
  const drops = statements.match(/\bdrop\s+\w+(?:\s+if\s+exists)?\s+[\w.]+/gi) ?? [];
  assert.deepEqual(
    drops.map((drop) => drop.replace(/\s+/g, " ").toLowerCase()),
    [
      "drop index if exists public.webinar_recording_events_unique_idx",
      "drop trigger if exists webinar_chat_messages_offset_from_anchor",
      "drop trigger if exists webinar_reactions_offset_from_anchor",
      "drop trigger if exists webinar_questions_offset_from_anchor",
      "drop trigger if exists webinar_poll_answers_offset_from_anchor"
    ],
    "so o indice velho e a recriacao idempotente dos triggers"
  );
  assert.ok(code.indexOf("create unique index if not exists webinar_recording_events_machine_unique_idx") < code.indexOf("drop index if exists public.webinar_recording_events_unique_idx"), "o indice novo antes de o velho sair");
  assert.match(code, /\(session_id, state, coalesce\(file_name, ''\), coalesce\(machine_requested_at, '1970-01-01 00:00:00\+00'::timestamptz\)\)\s*where session_id is not null/, "a maquina na chave do webhook");
  assert.match(code, /add column if not exists machine_requested_at timestamptz/);
  assert.match(code, /add column if not exists browser_recording_at timestamptz/);
  assert.match(code, /if not exists \(select 1 from pg_constraint where conname = 'webinar_sessions_browser_recording_live_v3'\) then\s*alter table public\.webinar_sessions add constraint webinar_sessions_browser_recording_live_v3\s*check \(kind = 'live' or browser_recording_at is null\)/);
});

test("a 0003: o trigger do offset pela ancora nas quatro tabelas, FOR KEY SHARE, so na live com ancora, no intervalo dos checks", () => {
  const code = sqlCodeOf(read(AJUSTES));
  const trigger = functionBody(code, "webinar_live_offset_from_anchor");
  assert.match(trigger.header, /returns trigger/);
  assert.match(trigger.header, /security invoker/);
  assert.match(trigger.header, /set search_path = pg_catalog, public/);
  assert.match(trigger.body, /from public\.webinar_sessions s\s*where s\.id = new\.session_id\s*for key share;/, "espera a RPC da ancora e le a versao nova");
  assert.match(trigger.body, /if v_kind = 'live' and v_anchor is not null then/);
  const limits = model.CHAT_LIMITS;
  assert.match(trigger.body, new RegExp(`new\\.offset_ms := greatest\\(${limits.offsetMinMs}, least\\(${limits.offsetMaxMs}, round\\(extract\\(epoch from \\(coalesce\\(new\\.created_at, now\\(\\)\\) - v_anchor\\)\\) \\* 1000\\)\\)\\)::integer`));
  assert.match(code, /revoke all on function public\.webinar_live_offset_from_anchor\(\) from public, anon, authenticated;/);
  for (const table of ["webinar_chat_messages", "webinar_reactions", "webinar_questions", "webinar_poll_answers"]) {
    assert.match(code, new RegExp(`create trigger ${table}_offset_from_anchor\\s*before insert on public\\.${table}\\s*for each row execute function public\\.webinar_live_offset_from_anchor\\(\\);`), table);
  }
});

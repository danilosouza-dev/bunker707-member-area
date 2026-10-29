import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Guarda da fase 1 dos webinarios (docs/30 §4.1 e §11; docs/18 §1.2): o que se le na migracao 202610280001.
// - as migracoes ate a 202610260001 continuam byte a byte, e a 0028 e o texto exato aplicado na nuvem de teste
//   (docs/21 §9.6): mudou? aplicar de novo la, atualizar o docs/21 e este hash juntos;
// - oito secoes pelo MCP, idempotente, sem delete, truncate, create policy, concurrently, drop table nem drop
//   trigger; a unica remocao e o check antigo do kind de notifications, dentro do `do $$ ... if not exists`;
// - os quatro gatilhos sao os set_updated_at das tabelas novas, cada um atras de uma guarda no pg_trigger;
// - as cinco tabelas sao so do service_role (RLS ligada, revoke de anon e authenticated, grant ao service_role);
// - os checks do banco batem com as listas do app (model.ts): kind, status, acesso, chat, slow mode, papeis,
//   os limites de titulo, descricao, duracao, vaga e retencao;
// - a funcao do sino e a da 202610220001 com uma linha a mais (o kind 'webinar'); a politica do historico recusa
//   'campaign' e 'webinar'; webinar_report e so do service_role.

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const sqlCodeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");

const MIGRATION = "supabase/migrations/202610280001_webinars_v1.sql";
const model = await import("../src/server/webinars/model.ts");

/** O corpo de uma funcao criada na migracao (entre os dois $$). */
function functionBody(code, name) {
  const start = code.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} existe`);
  const open = code.indexOf("$$", start);
  const close = code.indexOf("$$", open + 2);

  return { body: code.slice(open + 2, close), header: code.slice(start, open) };
}

const sqlList = (values) => values.map((value) => (typeof value === "number" ? String(value) : `'${value}'`)).join(", ");

test("as migracoes ate a 202610260001 continuam byte a byte; a 0028 e o texto exato aplicado na nuvem de teste", () => {
  const dir = new URL("supabase/migrations/", root);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const before = files.filter((name) => name <= "202610260001_communication_v3b2.sql");
  const hash = createHash("sha256");

  for (const name of before) {
    hash.update(`${name}\n`);
    hash.update(readFileSync(new URL(name, dir)));
  }

  assert.equal(before.length, 52);
  assert.equal(hash.digest("hex"), "155576bece50896712ef8654c519fce8829f52b81c0c49f3001606acde3f2bce", "uma migracao ja aplicada mudou");
  assert.ok(files.includes("202610280001_webinars_v1.sql"));
  assert.equal(
    createHash("sha256").update(read(MIGRATION)).digest("hex"),
    "bc02054257c809fcf0e18e9fe3f9640677c72fa6ea45e3dfcbb9e0d0beabca48",
    "a 202610280001 e o texto aplicado na nuvem de teste (docs/21 §9.6): mudou? aplique de novo la e atualize o docs/21 e este hash juntos"
  );
});

test("a 0028: oito secoes MCP, idempotente, sem delete, truncate, create policy, concurrently, drop table nem drop trigger", () => {
  const migration = read(MIGRATION);
  const code = sqlCodeOf(migration);
  const sections = migration.match(/^ \* \d\. .+$/gm) ?? [];

  assert.equal(sections.length, 8, "oito secoes");
  sections.forEach((line, index) => {
    assert.ok(line.startsWith(` * ${index + 1}. `), line);
  });
  const sectionBlocks = migration.match(/^ \* \d\. [\s\S]*?\*\//gm) ?? [];
  assert.equal(sectionBlocks.length, 8);
  sectionBlocks.forEach((block, index) => assert.match(block, /\bMCP\b/, `secao ${index + 1} marcada MCP`));
  assert.match(sectionBlocks[6], /sozinha/, "a 7 (indice sem concurrently) vai sozinha");
  assert.match(migration, /^-- Idempotente: pode rodar de novo sem efeito\.$/m);
  assert.doesNotMatch(migration, /popup_design/, "a guarda do Livre proibe migracao nova que cite a coluna do design");

  assert.doesNotMatch(code, /^\s*delete\b|\bdelete\s+from\b/im, "nenhum delete (so as regras on delete e o grant)");
  assert.doesNotMatch(code, /\btruncate\b/i);
  assert.doesNotMatch(code, /\bcreate\s+policy\b/i);
  assert.doesNotMatch(code, /\bconcurrently\b/i);
  assert.doesNotMatch(code, /\bdrop\s+(?:table|trigger|function|index|policy)\b/i);
  assert.doesNotMatch(code, /storage\.objects/i);

  // A unica remocao: o check antigo do kind, so quando o novo ainda nao existe.
  const drops = code.match(/\bdrop\b/gi) ?? [];
  assert.equal(drops.length, 1, "um drop so (o check antigo do kind)");
  assert.match(
    code,
    /if not exists \(select 1 from pg_constraint where conname = 'notifications_kind_v4'\) then[\s\S]*?execute format\('alter table public\.notifications drop constraint %I', v_name\);[\s\S]*?add constraint notifications_kind_v4\s+check \(kind in \('notice', 'comment_reply', 'comment_mention', 'webinar'\)\);/
  );

  // Gatilhos: os quatro set_updated_at, cada um atras da guarda no pg_trigger.
  const triggers = code.match(/create trigger (\w+)/g) ?? [];
  assert.deepEqual(triggers, [
    "create trigger set_webinars_updated_at",
    "create trigger set_webinar_sessions_updated_at",
    "create trigger set_webinar_recordings_updated_at",
    "create trigger set_webinar_registrations_updated_at"
  ]);
  for (const trigger of triggers) {
    const name = trigger.replace("create trigger ", "");
    assert.match(code, new RegExp(`where tgname = '${name}' and tgrelid = 'public\\.\\w+'::regclass\\s*\\) then\\s*${trigger}`));
  }

  // Tudo com if not exists (tabelas, indices) ou create or replace (funcoes).
  assert.equal((code.match(/create table if not exists public\.webinar\w*/g) ?? []).length, 5);
  assert.equal((code.match(/\bcreate table\b/gi) ?? []).length, 5);
  assert.equal((code.match(/\bcreate (?:unique )?index\b/gi) ?? []).length, (code.match(/\bcreate (?:unique )?index if not exists\b/gi) ?? []).length);
  assert.equal((code.match(/\bcreate function\b/gi) ?? []).length, 0);
});

test("o access_mode da 0028 continua o mesmo: o 'both' do app grava 'product' + audience_restricts (202610300001), nunca um valor novo", () => {
  const code = sqlCodeOf(read("supabase/migrations/202610300001_webinars_quem_pode_regras.sql"));

  assert.deepEqual([...model.ACCESS_MODES], ["everyone", "product", "audience", "either", "both"], "o modo novo do app entra no fim");
  assert.deepEqual([...model.ACCESS_MODE_COLUMN_VALUES], ["everyone", "product", "audience", "either"], "a coluna fica com os quatro da 0028");
  assert.doesNotMatch(code, /webinars_access_mode_check|\bboth\b/, "a 0030 nao mexe no check nem grava 'both'");
  assert.match(code, /alter table public\.webinars\s+add column if not exists audience_restricts boolean not null default false;/);
});

test("as cinco tabelas sao so do service_role: RLS ligada, revoke de anon e authenticated, grant ao service_role", () => {
  const code = sqlCodeOf(read(MIGRATION));
  const tables = ["webinars", "webinar_sessions", "webinar_presenters", "webinar_recordings", "webinar_registrations"];

  for (const table of tables) {
    assert.match(code, new RegExp(`alter table public\\.${table} enable row level security;`), table);
    assert.match(code, new RegExp(`revoke all on public\\.${table} from anon, authenticated;`), table);
    assert.match(code, new RegExp(`grant select, insert, update, delete on public\\.${table} to service_role;`), table);
    assert.match(code, new RegExp(`comment on table public\\.${table} is '`), `${table} descrita`);
  }
  assert.doesNotMatch(code, /grant[^;]*to (?:anon|authenticated|public)\b/i, "nada para anon, authenticated ou public");
});

test("os checks do banco batem com as listas e os limites do app (model.ts)", () => {
  const code = sqlCodeOf(read(MIGRATION));

  assert.match(code, new RegExp(`kind text not null check \\(kind in \\(${sqlList(model.WEBINAR_KINDS)}\\)\\)`));
  assert.match(code, new RegExp(`status text not null default 'draft' check \\(status in \\(${sqlList(model.WEBINAR_STATUSES)}\\)\\)`));
  assert.match(code, new RegExp(`kind text not null check \\(kind in \\(${sqlList(model.SESSION_KINDS)}\\)\\)`));
  assert.match(code, new RegExp(`status text not null default 'scheduled' check \\(status in \\(${sqlList(model.SESSION_STATUSES)}\\)\\)`));
  // O "both" do app grava 'product' + audience_restricts (202610300001): a coluna fica com os valores da 0028.
  assert.match(code, new RegExp(`access_mode text not null default 'everyone' check \\(access_mode in \\(${sqlList(model.ACCESS_MODE_COLUMN_VALUES)}\\)\\)`));
  assert.match(code, new RegExp(`chat_mode text not null default 'open' check \\(chat_mode in \\(${sqlList(model.CHAT_MODES)}\\)\\)`));
  assert.match(code, new RegExp(`chat_slow_mode_seconds in \\(${sqlList(model.SLOW_MODE_SECONDS)}\\)`));
  assert.match(code, new RegExp(`role text not null check \\(role in \\(${sqlList(model.PRESENTER_ROLES)}\\)\\)`));
  assert.match(code, new RegExp(`status text not null default 'registered' check \\(status in \\(${sqlList(model.REGISTRATION_STATUSES)}\\)\\)`));

  const limits = model.WEBINAR_LIMITS;
  assert.match(code, new RegExp(`char_length\\(title\\) between 1 and ${limits.title}\\)`));
  assert.match(code, new RegExp(`char_length\\(description\\) <= ${limits.description}\\)`));
  assert.match(code, new RegExp(`char_length\\(cover_url\\) <= ${limits.coverUrl}\\)`));
  assert.match(code, new RegExp(`duration_minutes between ${limits.durationMin} and ${limits.durationMax}\\)`));
  assert.match(code, new RegExp(`capacity between 1 and ${limits.capacityMax}\\)`));
  assert.match(code, new RegExp(`char_length\\(cancel_reason\\) <= ${limits.cancelReason}\\)`));
  assert.match(code, new RegExp(`replay_days_on_home between 0 and ${limits.replayDaysMax}\\)`));
  assert.match(code, new RegExp(`char_length\\(source\\) <= ${limits.source}\\)`));
  assert.match(code, new RegExp(`chat_retention_days between ${limits.retentionMin} and ${limits.retentionMax}\\)`));
  assert.match(code, new RegExp(`recording_retention_days between ${limits.retentionMin} and ${limits.retentionMax}\\)`));
  assert.match(code, new RegExp(`slug ~ '\\^\\[a-z0-9\\]\\[a-z0-9-\\]\\{2,${limits.slugMax - 1}\\}\\$'`), "slug de 3 a 64");

  // A qualidade padrao (D26) e a mesma do app.
  const quality = model.defaultQuality();
  assert.match(code, new RegExp(`quality jsonb not null default '\\{"stage":${quality.stage},"screenFps":${quality.screenFps}\\}'::jsonb`));
  assert.equal(quality.stage, model.STAGE_QUALITIES[0]);
  assert.equal(quality.screenFps, model.SCREEN_FPS_OPTIONS[0]);
  const remindersDefault = code.match(/reminders jsonb not null default '(\{[^']*\})'::jsonb/);
  assert.ok(remindersDefault, "lembretes com padrao");
  assert.deepEqual(JSON.parse(remindersDefault[1]), model.defaultReminders(), "os lembretes ligados por padrao sao os do app");

  // Uma vaga por aluno e sessao (ou por webinario quando a sessao e nula); um replay por webinario.
  assert.match(
    code,
    /create unique index if not exists webinar_registrations_unique_idx\s+on public\.webinar_registrations \(webinar_id, user_id, coalesce\(session_id, '00000000-0000-0000-0000-000000000000'::uuid\)\);/
  );
  assert.match(code, /create unique index if not exists webinar_sessions_one_replay_idx on public\.webinar_sessions \(webinar_id\) where kind = 'replay';/);
  assert.match(code, /calendar_token text not null unique default replace\(gen_random_uuid\(\)::text, '-', ''\)/);
});

test("o sino: a funcao e a da 202610220001 com uma linha a mais; o historico recusa 'campaign' e 'webinar'; o relatorio e so do service_role", () => {
  const code = sqlCodeOf(read(MIGRATION));
  const v3a = sqlCodeOf(read("supabase/migrations/202610220001_communication_v3a.sql"));
  const name = "communication_visible_notifications";
  const now = functionBody(code, name);
  const before = functionBody(v3a, name);

  assert.equal(now.header.replace(/\s+/g, " "), before.header.replace(/\s+/g, " "), "mesma assinatura e mesmos atributos");
  const added = now.body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !before.body.split("\n").map((other) => other.trim()).includes(line));
  assert.deepEqual(added, ["when n.kind = 'webinar' then true"], "so o ramo do kind 'webinar' entra");
  const removed = before.body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !now.body.split("\n").map((other) => other.trim()).includes(line));
  assert.deepEqual(removed, [], "nada da v3a sai");

  assert.match(
    code,
    /alter policy "Students can create own events" on public\.student_events\s+with check \(auth\.uid\(\) = user_id and coalesce\(entity_type, ''\) not in \('campaign', 'webinar'\)\);/
  );
  assert.match(code, /create index if not exists student_events_webinar_idx\s+on public\.student_events \(entity_id, event_type\)\s+where entity_type = 'webinar';/);

  const report = functionBody(code, "webinar_report");
  assert.match(report.header, /returns table \(metric text, item text, total bigint, students bigint\)/);
  assert.match(report.header, /security invoker/);
  assert.match(report.header, /set search_path = pg_catalog, public/);
  assert.match(report.body, /not exists \(select 1 from public\.admin_roles a where a\.user_id = r\.user_id\)/, "a equipe fica fora dos numeros");
  assert.match(code, /revoke all on function public\.webinar_report\(uuid\) from public, anon, authenticated;/);
  assert.match(code, /grant execute on function public\.webinar_report\(uuid\) to service_role;/);
});

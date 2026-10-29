import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Guarda da fase 2 dos webinarios (docs/30 §4.1 a §4.6 e §11; docs/18 §1.2): o que se le na migracao 202610290001.
// - as migracoes ate a 202610280001 (aplicadas) continuam byte a byte, e a 0029 e o texto exato (hash);
// - catorze secoes MCP, idempotente, sem create policy, alter policy, concurrently nem drop; os unicos deletes ficam
//   dentro de prune_webinar_history (secao 13, sozinha); os cinco gatilhos atras da guarda do pg_trigger;
// - as doze tabelas novas so do service_role (RLS, revoke de anon e authenticated, grant);
// - os checks do banco batem com as listas e os limites do app (model.ts), e os numeros das contas de presenca e dos
//   "mais quentes" (ROOM_RULES) aparecem no SQL exatamente;
// - as funcoes tem a assinatura combinada e sao so do service_role; webinar_report mantem a assinatura da 0028;
// - o agendamento do pg_cron e um so, depois da limpeza da Comunicacao.

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const sqlCodeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");

const MIGRATION = "supabase/migrations/202610290001_webinars_v2_chat.sql";
const model = await import("../src/server/webinars/model.ts");

const sqlList = (values) => values.map((value) => (typeof value === "number" ? String(value) : `'${value}'`)).join(", ");

function functionBody(code, name) {
  const start = code.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} existe`);
  const open = code.indexOf("$$", start);
  const close = code.indexOf("$$", open + 2);
  return { body: code.slice(open + 2, close), header: code.slice(start, open) };
}

const NEW_TABLES = [
  "webinar_chat_consents",
  "webinar_recording_transcripts",
  "webinar_chat_script_items",
  "webinar_chat_messages",
  "webinar_reactions",
  "webinar_polls",
  "webinar_poll_options",
  "webinar_poll_answers",
  "webinar_questions",
  "webinar_question_votes",
  "webinar_presence_samples",
  "webinar_attendance"
];

test("as migracoes ate a 202610280001 continuam byte a byte; a 0029 e o texto exato", () => {
  const dir = new URL("supabase/migrations/", root);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const before = files.filter((name) => name <= "202610280001_webinars_v1.sql");
  const hash = createHash("sha256");
  for (const name of before) {
    hash.update(`${name}\n`);
    hash.update(readFileSync(new URL(name, dir)));
  }
  assert.equal(before.length, 53);
  assert.equal(hash.digest("hex"), "9476f45a763b987fd1fd50a087a0046aecbc96bc689605684f457153aaf61efc", "uma migracao ja aplicada mudou");
  assert.ok(files.includes("202610290001_webinars_v2_chat.sql"));
  assert.equal(
    createHash("sha256").update(read(MIGRATION)).digest("hex"),
    "c37ba6772cc0b27ed384fb0cdaa1537383efbb448e39331457a99cc158d18568",
    "a 202610290001 mudou: aplique de novo na nuvem de teste (docs/21) e atualize este hash junto"
  );
});

test("a 0029: catorze secoes MCP, idempotente, sem create/alter policy, concurrently nem drop; deletes so na retencao; gatilhos guardados", () => {
  const migration = read(MIGRATION);
  const code = sqlCodeOf(migration);
  const sections = migration.match(/^ \* \d{1,2}\. .+$/gm) ?? [];
  assert.equal(sections.length, 14, "catorze secoes");
  sections.forEach((line, index) => assert.ok(line.startsWith(` * ${index + 1}. `), line));
  const blocks = migration.match(/^ \* \d{1,2}\. [\s\S]*?\*\//gm) ?? [];
  assert.equal(blocks.length, 14);
  blocks.forEach((block, index) => assert.match(block, /\bMCP\b/, `secao ${index + 1} marcada MCP`));
  assert.match(blocks[12], /sozinha/, "a 13 (retencao, com delete) vai sozinha");
  assert.match(migration, /^-- Idempotente: pode rodar de novo sem efeito\.$/m);
  assert.doesNotMatch(migration, /popup_design/);

  // Fora dos textos entre aspas (o relatorio tem a metrica 'drop').
  const statements = code.replace(/'[^']*'/g, "''");
  assert.doesNotMatch(statements, /\bdrop\b/i, "nenhum drop");
  assert.doesNotMatch(statements, /\btruncate\b/i);
  assert.doesNotMatch(statements, /\bcreate\s+policy\b/i);
  assert.doesNotMatch(statements, /\balter\s+policy\b/i);
  assert.doesNotMatch(statements, /\bconcurrently\b/i);
  assert.doesNotMatch(statements, /storage\.objects/i);

  // delete so dentro do corpo de prune_webinar_history.
  const prune = functionBody(code, "prune_webinar_history");
  const outside = code.replace(prune.body, "");
  assert.doesNotMatch(outside, /^\s*delete\b|\bdelete\s+from\b/im, "delete so na retencao");
  assert.equal((prune.body.match(/\bdelete from public\.webinar_/g) ?? []).length, 6, "amostras, chat (duas vezes), reacoes, perguntas, respostas");
  assert.match(prune.body, /interval '90 days'/);
  assert.match(prune.body, /make_interval\(days => w\.chat_retention_days\)/);
  assert.match(prune.body, /make_interval\(days => w\.recording_retention_days\)/);
  assert.match(prune.body, /and not m\.master/, "a linha mestre nao sai pela retencao da sessao");
  assert.match(prune.body, /\(w\.status = 'archived' or w\.deleted_at is not null\)/, "a linha mestre so sai de webinario arquivado ou excluido");

  const triggers = code.match(/create trigger (\w+)/g) ?? [];
  assert.deepEqual(triggers, [
    "create trigger set_webinar_chat_consents_updated_at",
    "create trigger set_webinar_recording_transcripts_updated_at",
    "create trigger set_webinar_chat_script_items_updated_at",
    "create trigger set_webinar_polls_updated_at",
    "create trigger set_webinar_questions_updated_at"
  ]);
  for (const trigger of triggers) {
    const name = trigger.replace("create trigger ", "");
    assert.match(code, new RegExp(`where tgname = '${name}' and tgrelid = 'public\\.\\w+'::regclass\\s*\\) then\\s*${trigger}`));
  }

  assert.equal((code.match(/\bcreate table\b/gi) ?? []).length, 12);
  assert.equal((code.match(/create table if not exists public\.webinar_\w+/g) ?? []).length, 12);
  assert.equal((code.match(/\bcreate (?:unique )?index\b/gi) ?? []).length, (code.match(/\bcreate (?:unique )?index if not exists\b/gi) ?? []).length);
  assert.equal((code.match(/add column if not exists/g) ?? []).length, 8, "sete colunas na sessao e purge_due_at na gravacao");
  assert.equal((code.match(/\balter table public\.\w+ add column\b/g) ?? []).length, (code.match(/add column if not exists/g) ?? []).length);
});

test("as doze tabelas novas sao so do service_role; nenhuma politica para authenticated", () => {
  const code = sqlCodeOf(read(MIGRATION));
  for (const table of NEW_TABLES) {
    assert.match(code, new RegExp(`create table if not exists public\\.${table} \\(`), table);
    assert.match(code, new RegExp(`alter table public\\.${table} enable row level security;`), table);
    assert.match(code, new RegExp(`revoke all on public\\.${table} from anon, authenticated;`), table);
    assert.match(code, new RegExp(`grant select, insert, update, delete on public\\.${table} to service_role;`), table);
  }
  assert.doesNotMatch(code, /grant[^;]*to (?:anon|authenticated|public)\b/i);
  // Linha enxuta: a presenca nao tem id nem updated_at.
  const presence = code.slice(code.indexOf("create table if not exists public.webinar_presence_samples"), code.indexOf("comment on table public.webinar_presence_samples"));
  assert.doesNotMatch(presence, /\bid uuid\b|updated_at/);
  assert.match(presence, /primary key \(session_id, user_id, bucket\)/);
});

test("os checks do banco batem com as listas, os limites e os ritmos do app (model.ts)", () => {
  const code = sqlCodeOf(read(MIGRATION));
  assert.match(code, new RegExp(`role text not null check \\(role in \\(${sqlList(model.CHAT_ROLES)}\\)\\)`));
  assert.match(code, new RegExp(`source text not null check \\(source in \\(${sqlList(model.CHAT_SOURCES)}\\)\\)`));
  assert.match(code, new RegExp(`kind text not null default 'message' check \\(kind in \\(${sqlList(model.MESSAGE_KINDS)}\\)\\)`));
  assert.match(code, new RegExp(`reaction text not null check \\(reaction in \\(${sqlList(model.REACTIONS)}\\)\\)`));
  assert.match(code, new RegExp(`kind text not null default 'single' check \\(kind in \\(${sqlList(model.POLL_KINDS)}\\)\\)`));
  assert.match(code, new RegExp(`status text not null default 'draft' check \\(status in \\(${sqlList(model.POLL_STATUSES)}\\)\\)`));
  assert.match(code, new RegExp(`status text not null default 'open' check \\(status in \\(${sqlList(model.QUESTION_STATUSES)}\\)\\)`));
  assert.match(code, new RegExp(`state text not null check \\(state in \\(${sqlList(model.PRESENCE_STATES)}\\)\\)`));
  assert.match(code, new RegExp(`trigger_kind text not null check \\(trigger_kind in \\(${sqlList(model.SCRIPT_TRIGGERS)}\\)\\)`));
  assert.match(code, new RegExp(`status text not null default 'draft' check \\(status in \\(${sqlList(model.SCRIPT_STATUSES)}\\)\\)`));
  assert.match(code, new RegExp(`persona_role text not null default 'student' check \\(persona_role in \\(${sqlList(model.PERSONA_ROLES)}\\)\\)`));
  assert.match(code, new RegExp(`display_mode text not null default 'first_name_initial' check \\(display_mode in \\(${sqlList(model.DISPLAY_NAME_MODES)}\\)\\)`));
  assert.match(code, new RegExp(`source_format text not null check \\(source_format in \\(${sqlList(model.TRANSCRIPT_FORMATS)}\\)\\)`));
  assert.equal((code.match(new RegExp(`deleted_reason in \\(${sqlList(model.DELETE_REASONS)}\\)`, "g")) ?? []).length, 2, "mensagens e perguntas");

  const limits = model.CHAT_LIMITS;
  assert.match(code, new RegExp(`body text not null check \\(char_length\\(body\\) between 1 and ${limits.body}\\)`));
  assert.match(code, new RegExp(`body text not null check \\(char_length\\(body\\) between 1 and ${limits.question}\\)`));
  assert.match(code, new RegExp(`char_length\\(answer_text\\) <= ${limits.answer}`));
  assert.match(code, new RegExp(`display_name text not null check \\(char_length\\(display_name\\) between 1 and ${limits.displayName}\\)`));
  assert.match(code, new RegExp(`char_length\\(nickname\\) between ${limits.nicknameMin} and ${limits.nicknameMax}`));
  assert.match(code, new RegExp(`persona_name text not null check \\(char_length\\(persona_name\\) between 1 and ${limits.personaName}\\)`));
  assert.match(code, new RegExp(`char_length\\(phrase\\) between ${limits.phraseMin} and ${limits.phraseMax}`));
  assert.match(code, new RegExp(`phrase_delay_ms between ${limits.phraseDelayMinMs} and ${limits.phraseDelayMaxMs}`));
  assert.match(code, new RegExp(`question text not null check \\(char_length\\(question\\) between 1 and ${limits.pollQuestion}\\)`));
  assert.match(code, new RegExp(`label text not null check \\(char_length\\(label\\) between 1 and ${limits.pollOption}\\)`));
  assert.match(code, new RegExp(`cardinality\\(option_ids\\) between 1 and ${limits.pollOptionsMax}`));
  assert.match(code, new RegExp(`char_length\\(full_text\\) between 1 and ${limits.transcriptBytes}`));
  assert.match(code, new RegExp(`char_length\\(simulation_ack_text\\) <= ${limits.simulationAck}`));
  assert.equal((code.match(new RegExp(`offset_ms between ${limits.offsetMinMs} and ${limits.offsetMaxMs}`, "g")) ?? []).length, 7, "o mesmo intervalo de offset em todas as tabelas");
  assert.equal(model.CHAT_CONSENT_VERSION, 1);
  assert.match(code, /consent_version smallint not null check \(consent_version between 1 and 100\)/);

  // Os ritmos (M1 a M4) no SQL: balde de 30 s, saida depois de 3 baldes, 95 % ate o fim, os pesos dos mais quentes.
  const rules = model.ROOM_RULES;
  assert.equal(rules.bucketSeconds, 30);
  assert.ok(code.includes(`/ ${rules.bucketSeconds * 1000}.0`), "baldes de 30 s na duracao");
  assert.match(code, new RegExp(`p\\.bucket - p\\.prev_bucket > ${rules.leaveAfterBuckets}`));
  assert.ok(code.includes(`* ${rules.reachedEndRatio}`), "95 % ate o fim");
  assert.match(code, new RegExp(`least\\(\\(select count\\(\\*\\) from msgs m where m\\.user_id = u\\.user_id\\), ${rules.hotWeights.messageCap}\\) \\* ${rules.hotWeights.message}\\.0`));
  assert.match(code, new RegExp(`\\* ${rules.hotWeights.question}\\.0`));
  assert.match(code, new RegExp(`\\* ${rules.hotWeights.reaction}`));
  assert.match(code, /\/ 600\.0/, "cada 10 min presente");
  assert.match(code, new RegExp(`limit ${rules.dropPoints}\\)`));
  assert.equal((code.match(new RegExp(`limit ${rules.topPeople}\\)`, "g")) ?? []).length, 3, "top 10 do chat, dos mais quentes e das perguntas");
  assert.match(code, /sum\(least\(p\.samples, 2\)\) \* 15/, "cada balde vale no maximo 30 s (dois sinais de 15 s)");
});

test("as funcoes: assinaturas combinadas, so service_role; webinar_report mantem a assinatura da 0028", () => {
  const code = sqlCodeOf(read(MIGRATION));
  const previous = sqlCodeOf(read("supabase/migrations/202610280001_webinars_v1.sql"));
  const signatures = [
    "webinar_chat_window(uuid, integer, integer, uuid)",
    "webinar_open_session(uuid, timestamptz)",
    "webinar_close_session(uuid, timestamptz)",
    "webinar_report(uuid)",
    "webinar_attendees(uuid)",
    "prune_webinar_history()"
  ];
  for (const signature of signatures) {
    assert.match(code, new RegExp(`revoke all on function public\\.${signature.replace(/[()]/g, "\\$&")} from public, anon, authenticated;`), signature);
    assert.match(code, new RegExp(`grant execute on function public\\.${signature.replace(/[()]/g, "\\$&")} to service_role;`), signature);
  }
  const report = functionBody(code, "webinar_report");
  const before = functionBody(previous, "webinar_report");
  assert.equal(report.header.replace(/\s+/g, " ").trim(), before.header.replace(/\s+/g, " ").trim(), "mesma assinatura e atributos do relatorio");
  assert.match(report.body, /where exists \(select 1 from s\)/, "sessao inexistente: nenhuma linha");
  assert.match(report.body, /m\.source in \('audience', 'original'\)/, "so chat de aluno nas metricas");
  for (const name of ["webinar_chat_window", "webinar_open_session", "webinar_close_session", "webinar_attendees"]) {
    assert.match(functionBody(code, name).header, /security invoker/, name);
    assert.match(functionBody(code, name).header, /set search_path = pg_catalog, public/, name);
  }
  assert.match(functionBody(code, "prune_webinar_history").header, /security definer/);
  const window = functionBody(code, "webinar_chat_window");
  assert.match(window.body, /m\.offset_ms - s\.anchor_ms/, "a linha mestre da live e deslocada pela ancora");
  assert.match(window.body, /m\.session_id <> s\.id/, "a propria sessao nao repete na linha mestre");
  const open = functionBody(code, "webinar_open_session");
  assert.match(open.body, /on conflict \(session_id, script_item_id\) where script_item_id is not null do nothing/, "o roteiro entra uma vez");
  assert.match(open.body, /i\.status = 'ready'/);
  assert.match(open.body, /i\.trigger_kind in \('at_offset', 'on_phrase'\)/, "o manual espera o botao");

  assert.equal((code.match(/cron\.schedule\(/g) ?? []).length, 1);
  assert.match(code, /'bunker707-webinar-prune',\s*'47 6 \* \* \*',\s*'select public\.prune_webinar_history\(\);'/);
});

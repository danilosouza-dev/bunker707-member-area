import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [migrationSource, tutorListMigrationSource, tutorSource, guideSource] = await Promise.all([
  readSource("../supabase/migrations/202607170002_ai_message_order.sql"),
  readSource("../supabase/migrations/202607180001_tutor_conversation_list.sql"),
  readSource("../src/server/ai/tutor.ts"),
  readSource("../src/server/ai/platform-guide.ts")
]);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("ai_messages assigns a stable per-conversation sequence even when created_at timestamps tie", () => {
  assert.match(
    migrationSource,
    /alter table public\.ai_messages\s+add column if not exists message_sequence bigint/i
  );
  assert.match(
    migrationSource,
    /row_number\(\)\s+over\s*\([\s\S]*?partition by [\w.]*conversation_id[\s\S]*?order by [\w.]*created_at asc[\s\S]*?case [\w.]*role[\s\S]*?[\w.]*id asc[\s\S]*?\)/i
  );
  const rolePriority = migrationSource.match(
    /case [\w.]*role[\s\S]*?when 'system' then (\d+)[\s\S]*?when 'user' then (\d+)[\s\S]*?when 'assistant' then (\d+)/i
  );
  assert.ok(rolePriority, "the timestamp-tie backfill must define an explicit role priority");
  assert.ok(Number(rolePriority[1]) < Number(rolePriority[2]));
  assert.ok(Number(rolePriority[2]) < Number(rolePriority[3]));
  assert.match(migrationSource, /alter column message_sequence set not null/i);
  assert.match(migrationSource, /check\s*\(message_sequence > 0\)/i);
  assert.match(
    migrationSource,
    /(?:create unique index[^;]*on public\.ai_messages\s*\(conversation_id, message_sequence\)|add constraint [\w]+ unique\s*\(conversation_id, message_sequence\))/i
  );
  assert.match(
    migrationSource,
    /pg_advisory_xact_lock\([\s\S]*?conversation_id[\s\S]*?max\([\w.]*message_sequence\)[\s\S]*?new\.message_sequence/iu
  );
  assert.match(
    migrationSource,
    /coalesce\([\s\S]*?max\([\w.]*message_sequence\)[\s\S]*?,\s*0\s*\)\s*\+\s*1/iu
  );
  assert.match(
    migrationSource,
    /create trigger [^\n]+[\s\S]*?before insert on public\.ai_messages[\s\S]*?execute (?:function|procedure) public\.[\w]+\(\)/i
  );
});

test("Tutor IA displays, previews and sends history in message_sequence order", () => {
  const listConversation = sourceBetween(
    tutorSource,
    "export async function listTutorConversations",
    "export async function getTutorAvailability"
  );
  const getConversation = sourceBetween(
    tutorSource,
    "export async function getTutorConversation",
    "export async function hideTutorConversation"
  );
  const submitQuestion = tutorSource.slice(tutorSource.indexOf("export async function submitTutorQuestion"));
  const listConversationRpc = sourceBetween(
    tutorListMigrationSource,
    "create or replace function public.list_tutor_conversations(",
    "revoke all on function public.list_tutor_conversations"
  );

  assert.match(listConversation, /\.rpc\("list_tutor_conversations"/);
  assert.match(listConversationRpc, /order by message\.message_sequence desc/);
  assert.match(getConversation, /\.order\("message_sequence"(?:,\s*\{\s*ascending:\s*true\s*\})?\)/);
  assert.match(submitQuestion, /\.order\("message_sequence",\s*\{\s*ascending:\s*false\s*\}\)/);

  assert.doesNotMatch(listConversation, /\.from\("ai_messages"\)|Promise\.all\(conversations\.map/);
  assert.doesNotMatch(listConversationRpc, /order by message\.created_at/);
  assert.doesNotMatch(getConversation, /\.order\("created_at"/);
  assert.doesNotMatch(submitQuestion, /\.order\("created_at"/);
});

test("Tutor IA conversation summaries are aggregated securely without N+1 queries", () => {
  const listConversationRpc = sourceBetween(
    tutorListMigrationSource,
    "create or replace function public.list_tutor_conversations(",
    "revoke all on function public.list_tutor_conversations"
  );

  assert.match(listConversationRpc, /stable[\s\S]*security definer[\s\S]*set search_path = pg_catalog, public/);
  assert.match(listConversationRpc, /conversation\.user_id = p_user_id/);
  assert.match(listConversationRpc, /conversation\.lesson_id = p_lesson_id/);
  assert.match(listConversationRpc, /conversation\.agent_type = 'lesson_tutor'/);
  assert.match(listConversationRpc, /conversation\.student_deleted_at is null/);
  assert.match(listConversationRpc, /message\.user_id = p_user_id[\s\S]*message\.status = 'completed'/);
  assert.match(listConversationRpc, /count\(\*\) as message_count/);
  assert.match(tutorListMigrationSource, /revoke all on function public\.list_tutor_conversations\(text, uuid\)[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(tutorListMigrationSource, /grant execute on function public\.list_tutor_conversations\(text, uuid\)[\s\S]*to service_role/);
});

test("IA Diretor displays, previews and sends history in message_sequence order", () => {
  const getConversation = sourceBetween(
    guideSource,
    "export async function getPlatformGuideConversation",
    "export async function hidePlatformGuideConversation"
  );
  const submitQuestion = guideSource.slice(guideSource.indexOf("export async function submitPlatformGuideQuestion"));
  const listConversation = sourceBetween(
    migrationSource,
    "create or replace function public.list_platform_guide_conversations(",
    "revoke all on function public.list_platform_guide_conversations"
  );

  assert.match(getConversation, /\.order\("message_sequence"(?:,\s*\{\s*ascending:\s*true\s*\})?\)/);
  assert.match(submitQuestion, /\.order\("message_sequence",\s*\{\s*ascending:\s*false\s*\}\)/);
  assert.match(listConversation, /order by message\.message_sequence desc/);

  assert.doesNotMatch(getConversation, /\.order\("created_at"/);
  assert.doesNotMatch(submitQuestion, /\.order\("created_at"/);
  assert.doesNotMatch(listConversation, /order by message\.created_at/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationSource = await readFile(
  new URL("../supabase/migrations/202607160002_harden_internal_trigger_functions.sql", import.meta.url),
  "utf8"
);

test("internal SECURITY DEFINER trigger functions cannot be executed by API roles", () => {
  for (const functionName of [
    "record_lesson_comment_created_event",
    "record_lesson_comment_reaction_event",
    "record_lesson_comment_report_event",
    "record_ai_message_event",
    "record_ai_conversation_student_deleted_event",
    "record_tv_session_event"
  ]) {
    assert.match(
      migrationSource,
      new RegExp(`revoke all on function public\\.${functionName}\\(\\)\\s+from public, anon, authenticated, service_role;`)
    );
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { actionStubs, createFakeDb } from "./support/admin-action-stubs.mjs";

// Gravacao do progresso da aula no servidor (replaceCompletedLessons em platform-store), executada
// com banco falso: a lista completed_lesson_ids e a verdade. Heartbeat e flush ao sair da pagina
// (PUT e POST levam o mesmo payload) nao rebaixam aula concluida; desmarcar volta a "em andamento".

const store = await import("../src/server/db/platform-store.ts");

const USER_ID = "00000000-0000-4000-8000-000000000042";
const CONTENT_ID = "curso-ia";
const SAVED_AT = "2026-10-16T11:00:00.000Z";

function completedRow() {
  return {
    completed_lesson_ids: ["a1"],
    content_id: CONTENT_ID,
    lesson_reactions: {},
    lesson_watch_states: {
      a1: {
        durationSeconds: 300,
        lastWatchedAt: SAVED_AT,
        maxProgressPercent: 100,
        progressPercent: 100,
        progressSeconds: 300,
        status: "completed"
      }
    },
    updated_at: SAVED_AT,
    user_id: USER_ID
  };
}

function useDb(rows) {
  const db = createFakeDb({ tables: { lesson_progress: rows } });
  actionStubs.db = db;
  return db;
}

test("heartbeat em aula concluida (aluno rebobinou para 40%): continua concluida, so a posicao muda", async () => {
  const db = useDb([completedRow()]);

  const record = await store.replaceCompletedLessons({
    contentId: CONTENT_ID,
    lessonId: "a1",
    progressPercent: 40,
    progressSeconds: 120,
    status: "in_progress",
    userId: USER_ID
  });

  assert.deepEqual(record.completedLessonIds, ["a1"]);
  assert.equal(record.lessonWatchStates.a1.status, "completed");
  assert.equal(record.lessonWatchStates.a1.progressPercent, 100);
  assert.equal(record.lessonWatchStates.a1.maxProgressPercent, 100);
  assert.equal(record.lessonWatchStates.a1.progressSeconds, 120, "a posicao de retomada acompanha o aluno");
  assert.notEqual(record.lessonWatchStates.a1.lastWatchedAt, SAVED_AT);

  const write = db.calls.writes.find((entry) => entry.table === "lesson_progress");
  assert.equal(write.op, "update");
  assert.deepEqual(write.payload.completed_lesson_ids, ["a1"]);
  assert.equal(write.payload.lesson_watch_states.a1.status, "completed", "o que vai para o banco e o mesmo");
});

test("desmarcar Concluída: a lista chega sem a aula e ela volta a 'em andamento' de verdade", async () => {
  useDb([completedRow()]);

  const record = await store.replaceCompletedLessons({
    completedLessonIds: [],
    contentId: CONTENT_ID,
    lessonId: "a1",
    progressPercent: 40,
    progressSeconds: 120,
    status: "in_progress",
    userId: USER_ID
  });

  assert.deepEqual(record.completedLessonIds, []);
  assert.equal(record.lessonWatchStates.a1.status, "in_progress");
  assert.equal(record.lessonWatchStates.a1.progressPercent, 40);
  assert.equal(record.lessonWatchStates.a1.maxProgressPercent, 100, "o maximo assistido fica");
});

test("fim do video em aula nova: entra na lista de concluidas com 100% (primeira gravacao = insert)", async () => {
  const db = useDb([]);

  const record = await store.replaceCompletedLessons({
    contentId: CONTENT_ID,
    durationSeconds: 300,
    lessonId: "a1",
    progressPercent: 100,
    progressSeconds: 300,
    status: "completed",
    userId: USER_ID
  });

  assert.deepEqual(record.completedLessonIds, ["a1"]);
  assert.equal(record.lessonWatchStates.a1.status, "completed");
  assert.equal(record.lessonWatchStates.a1.progressPercent, 100);
  assert.equal(db.calls.writes.find((entry) => entry.table === "lesson_progress").op, "insert");
});

test("fileira 'Continue assistindo' da home ignora aula da lista de concluidas (mesma regra da pagina)", async () => {
  // getContinueWatchingFromProgress nao e exportada; a regra esta em src/lib/lesson-progress
  // (isLessonResumable, testada em lesson-progress-rules) e aqui so se confere que a home a usa.
  const source = await readFile(new URL("../src/server/db/platform-store.ts", import.meta.url), "utf8");

  assert.match(source, /const completedLessonIds = new Set\(Array\.isArray\(record\.completedLessonIds\) \? record\.completedLessonIds : \[\]\);/);
  assert.match(source, /if \(!isLessonResumable\(lessonId, watchState, completedLessonIds\)\) \{/);
  assert.doesNotMatch(source, /watchState\.status === "completed" \|\| watchState\.progressPercent <= 0/, "a conta antiga, so pelo watch state, saiu");
});

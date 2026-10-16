import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Guarda dos comentarios da aula (regra de seguranca que se le na migracao; docs/18 §1.2). O
// comportamento (publicar, responder, reagir, moderar, etiquetas de funcao) esta em
// tests/integration/comentarios-aula.test.mjs e tests/e2e/aluno-comenta-na-aula.spec.ts.

const migration = await readFile(new URL("../supabase/migrations/202607100001_lesson_comments.sql", import.meta.url), "utf8");

test("guarda: comentarios com RLS, moderacao por funcao do banco e evento gravado na publicacao", () => {
  assert.match(migration, /alter table public\.lesson_comments enable row level security/);
  assert.match(migration, /create or replace function public\.moderate_lesson_comment/);
  assert.match(migration, /record_lesson_comment_created_event/);
  assert.match(migration, /analysis_status text not null default 'pending'/, "todo comentario nasce pendente de analise (insights)");
});

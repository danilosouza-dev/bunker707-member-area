import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  containsBlockedTerm,
  normalizeCommentForModeration,
  sanitizeLessonCommentBody,
  validateLessonCommentBody
} from "../src/server/comments/comment-validation.ts";

const migrationPath = new URL("../supabase/migrations/202607100001_lesson_comments.sql", import.meta.url);
const lessonExperiencePath = new URL("../src/components/lesson-experience.tsx", import.meta.url);

test("normaliza acentos, caixa e pontuacao para moderacao", () => {
  assert.equal(
    normalizeCommentForModeration("  DÚVIDA: sobre IA!!!  "),
    "duvida sobre ia"
  );
});

test("bloqueia termos inteiros e frases sem falsos positivos por substring", () => {
  assert.equal(containsBlockedTerm("Esse termo proibido apareceu aqui", "termo proibido"), true);
  assert.equal(containsBlockedTerm("A classificacao ficou clara", "ass"), false);
  assert.equal(containsBlockedTerm("Uma DÚVIDA importante", "duvida"), true);
});

test("sanitiza controles e valida o limite de tamanho do comentario", () => {
  assert.equal(sanitizeLessonCommentBody("  linha 1\r\nlinha\u0000 2  "), "linha 1\nlinha 2");
  assert.equal(validateLessonCommentBody("   ").error, "Escreva um comentario antes de enviar.");
  assert.match(validateLessonCommentBody("x".repeat(2001)).error ?? "", /2000/);
  assert.equal(validateLessonCommentBody("Comentario valido").error, null);
});

test("migration protege persistencia, auditoria e dados para insights", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /create table if not exists public\.lesson_comments/);
  assert.match(migration, /analysis_status text not null default 'pending'/);
  assert.match(migration, /analysis_result jsonb not null default '\{\}'::jsonb/);
  assert.match(migration, /primary key \(comment_id, user_id\)/);
  assert.match(migration, /alter table public\.lesson_comments enable row level security/);
  assert.match(migration, /create or replace function public\.moderate_lesson_comment/);
  assert.match(migration, /record_lesson_comment_created_event/);
});

test("frontend da aula nao usa mais a lista mockada de comentarios", async () => {
  const source = await readFile(lessonExperiencePath, "utf8");

  assert.doesNotMatch(source, /const initialComments/);
  assert.match(source, /\/api\/comments\/lessons\//);
  assert.match(source, /\/api\/comments\/\$\{encodeURIComponent\(commentId\)\}\/reaction/);
  assert.match(source, /\/api\/comments\/\$\{encodeURIComponent\(commentId\)\}\/report/);
});

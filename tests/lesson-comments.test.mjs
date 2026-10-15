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

test("etiqueta de funcao: quem monta conteudo e Professor; o resto da equipe e Moderador", async () => {
  const store = await readFile(new URL("../src/server/comments/comment-store.ts", import.meta.url), "utf8");
  const helper = store.slice(store.indexOf("export function getCommentAuthorRole"), store.indexOf("export async function listLessonComments"));

  assert.match(helper, /if \(!isAdmin\) \{\s*return "student";\s*\}/);
  assert.match(helper, /return !staffAccess \|\| can\(staffAccess, "catalog\.content"\) \? "producer" : "moderator";/);
  assert.match(store, /const authorRole = getCommentAuthorRole\(access\.isAdmin, access\.isAdmin \? await getAdminAccessForUser\(user\.id\) : null\);/);
  assert.match(store, /author_role: authorRole,/);
  assert.doesNotMatch(store, /access\.isAdmin \? "producer" : "student"/);
});

test("comentarios e respostas mostram a funcao de cada pessoa", async () => {
  const source = await readFile(lessonExperiencePath, "utf8");

  assert.match(source, /role: record\.authorRole === "producer" \|\| record\.authorRole === "moderator" \? record\.authorRole : "student"/);
  assert.match(source, /<MemberRoleBadge role=\{comment\.role\} \/>/);
  assert.match(source, /<MemberRoleBadge role=\{reply\.role\} \/>/);
  assert.doesNotMatch(source, /comment\.role === "Professor"|reply\.role === "Professor"/);
});

test("caixa de escrever: cartao proprio, contador perto do limite, Ctrl/Cmd + Enter e motivo quando bloqueada", async () => {
  const source = await readFile(lessonExperiencePath, "utf8");
  const composer = await readFile(new URL("../src/components/lesson/lesson-comment-composer.tsx", import.meta.url), "utf8");

  assert.match(source, /<LessonCommentComposer[\s\S]*?inputRef=\{commentInputRef\}[\s\S]*?onSubmit=\{handleCommentSubmit\}/);
  assert.match(source, /disabledReason=\{isActiveLessonLocked \? "Comentários liberados junto com a aula" : undefined\}/);
  assert.match(composer, /id="lesson-comment"/);
  assert.match(composer, /maxLength=\{LESSON_COMMENT_MAX_LENGTH\}/);
  assert.match(composer, /export const LESSON_COMMENT_MAX_LENGTH = 2000;/);
  assert.match(composer, /const COUNTER_THRESHOLD = 1800;/);
  assert.match(composer, /event\.key === "Enter" && \(event\.ctrlKey \|\| event\.metaKey\)/);
  assert.match(composer, /requestSubmit\(\)/);
  assert.match(composer, /Compartilhe uma dúvida ou insight sobre a aula/);
  assert.match(composer, /Respondendo a <span className="font-bold text-white">@\{replyTarget\.username\}<\/span>/);
  assert.match(composer, /aria-label="Cancelar resposta"/);
  assert.match(composer, /submitting \? "Enviando\.\.\." : submitLabel/);
  assert.match(composer, /const submitLabel = replyTarget \? "Responder" : "Publicar";/);
});

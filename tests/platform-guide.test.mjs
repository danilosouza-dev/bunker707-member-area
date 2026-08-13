import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const {
  buildPlatformGuideEvidence,
  resolvePlatformGuideReferences,
  sanitizePlatformGuideStoredBody
} = await import("../src/lib/platform-guide-references.ts");
const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [
  guideSource,
  tutorSource,
  listRouteSource,
  conversationRouteSource,
  messagesRouteSource,
  migrationSource,
  tutorListMigrationSource
] = await Promise.all([
  readSource("../src/server/ai/platform-guide.ts"),
  readSource("../src/server/ai/tutor.ts"),
  readSource("../src/app/api/guide/conversations/route.ts"),
  readSource("../src/app/api/guide/conversations/[conversationId]/route.ts"),
  readSource("../src/app/api/guide/conversations/[conversationId]/messages/route.ts"),
  readSource("../supabase/migrations/202607170001_platform_guide.sql"),
  readSource("../supabase/migrations/202607180001_tutor_conversation_list.sql")
]);

test("IA Diretor resolves only server-authorized internal references", () => {
  const evidence = buildPlatformGuideEvidence([{
    breadcrumb: "Formacao Agentes > Fundamentos > Primeiros passos",
    contentId: "formacao/agentes",
    context: "A aula apresenta os fundamentos de agentes.",
    kind: "lesson",
    lessonId: "lesson?unsafe=true",
    moduleId: "module one",
    title: "Primeiros [passos]"
  }], 10_000);
  const resolved = resolvePlatformGuideReferences(
    "Veja [um link externo](https://evil.example/a) e depois esta aula [R1]. Nao use [R999].",
    evidence
  );

  assert.equal(resolved.references.length, 1);
  assert.equal(resolved.references[0].verified, true);
  assert.equal(resolved.references[0].contentId, "formacao/agentes");
  assert.equal(
    resolved.references[0].href,
    "/conteudo/formacao%2Fagentes/aulas/module%20one?lessonId=lesson%3Funsafe%3Dtrue"
  );
  assert.ok(resolved.body.includes(
    "[Aula: Primeiros \\[passos\\]](/conteudo/formacao%2Fagentes/aulas/module%20one?lessonId=lesson%3Funsafe%3Dtrue)"
  ));
  assert.doesNotMatch(resolved.body, /evil\.example|R999/);
});

test("stored Director links are regenerated from currently authorized references", () => {
  const authorizedReference = {
    breadcrumb: "Curso > Modulo > Aula",
    contentId: "course-1",
    href: "/conteudo/course-1/aulas/module-1?lessonId=lesson-1",
    id: "R1",
    kind: "lesson",
    label: "Aula: Aula segura",
    lessonId: "lesson-1",
    moduleId: "module-1",
    title: "Aula segura",
    verified: true
  };
  const storedBody = "[rotulo adulterado](/conteudo/course-1/aulas/module-1?lessonId=lesson-1) e [externo](https://example.com)";

  assert.equal(
    sanitizePlatformGuideStoredBody(storedBody, [authorizedReference]),
    "[Aula: Aula segura](/conteudo/course-1/aulas/module-1?lessonId=lesson-1) e externo"
  );
  assert.equal(sanitizePlatformGuideStoredBody(storedBody, []), "rotulo adulterado e externo");
});

test("IA Diretor backend is authenticated, persistent, isolated and uses bounded authorized retrieval", () => {
  assert.match(listRouteSource, /requireApiUser/);
  assert.match(conversationRouteSource, /requireApiUser/);
  assert.match(messagesRouteSource, /requireApiUser/);
  assert.match(migrationSource, /agent_type = 'platform_guide'/);
  assert.match(guideSource, /\.eq\("agent_type", platformGuideAgentType\)/);
  assert.match(guideSource, /rpc\("start_platform_guide_question_atomic"/);
  assert.match(guideSource, /rpc\("search_platform_guide_chunks"/);
  assert.doesNotMatch(guideSource, /\.from\("content_chunks"\)/);
  assert.doesNotMatch(guideSource, /\.from\("lesson_ai_profiles"\)/);
  assert.match(guideSource, /resolveAuthorizedLearningCatalog/);
  assert.match(guideSource, /p_limit: 48/);
  assert.match(guideSource, /p_query: tokens\.join\(" OR "\)/);
  assert.match(guideSource, /Progresso do aluno: em andamento/);
  assert.match(guideSource, /provider_attempts: generated\.attempts/);
  assert.match(guideSource, /gateway_request_id: generated\.generation\.gatewayRequestId/);
  assert.match(guideSource, /student_deleted_at/);
  assert.match(guideSource, /authorizationScope: evidence\.map/);
  assert.match(guideSource, /authorizedScopes\.length !== authorizationScopes\.length/);
  assert.match(guideSource, /citations: buildStoredPlatformGuideEvidence\(evidence, resolved\.references\)/);
  assert.match(guideSource, /Nao escreva URLs nem links Markdown/);
  assert.match(guideSource, /Nunca mencione, suponha ou recomende um conteudo que nao esteja nele/);
  assert.match(messagesRouteSource, /uuidPattern/);
  assert.match(messagesRouteSource, /export const maxDuration = 60/);
});

test("IA Diretor reserves limits atomically and bounds conversation history work", () => {
  assert.match(migrationSource, /pg_advisory_xact_lock\([\s\S]*?platform-guide-user:/);
  assert.match(migrationSource, /reserve_platform_guide_provider_attempt/);
  assert.match(migrationSource, /message\.status in \('pending', 'completed'\)/);
  assert.match(migrationSource, /create_platform_guide_conversation_atomic/);
  assert.match(migrationSource, /list_platform_guide_conversations/);
  assert.match(migrationSource, /p_limit is null or p_limit < 1 or p_limit > 100/);
  assert.match(guideSource, /beforeAttempt: \(candidate\) => reservePlatformGuideProviderAttempt/);
  assert.match(guideSource, /supabase\.rpc\("list_platform_guide_conversations"/);
  assert.doesNotMatch(guideSource, /Promise\.all\(\(result\.data \?\? \[\]\)\.map\(async \(conversation\)/);
});

test("progress used by release rules is server-only", () => {
  assert.match(migrationSource, /drop policy if exists "Students manage own lesson progress"/);
  assert.match(migrationSource, /revoke all on public\.lesson_progress from anon, authenticated/);
});

test("new catalog content starts as draft while existing rows are safely backfilled", () => {
  assert.match(migrationSource, /add column if not exists publication_status text not null default 'published'/);
  assert.match(migrationSource, /alter column publication_status set default 'draft'/);
});

test("IA Diretor retrieves active transcript chunks even when the AI profile is not ready", () => {
  assert.match(
    guideSource,
    /const activeTranscriptByLessonId = new Map\(catalog\.lessons\.flatMap\(\(lesson\) => \([\s\S]*?lesson\.activeTranscriptId/
  );
  assert.match(
    guideSource,
    /initialCandidates\.lessonCandidates\s*\.filter\(\(candidate\) => Boolean\(candidate\.lessonId && activeTranscriptByLessonId\.has\(candidate\.lessonId\)\)\)/
  );
  assert.match(
    guideSource,
    /activeTranscriptByLessonId\.get\(chunk\.lesson_id\) !== chunk\.transcript_id/
  );
  assert.doesNotMatch(
    guideSource,
    /initialCandidates\.lessonCandidates\s*\.filter\(\(candidate\) => Boolean\(candidate\.lessonId && profileByLessonId\.has\(candidate\.lessonId\)\)\)/
  );
});

test("Tutor operations cannot select, rename or hide Director conversations", () => {
  const isolationFilters = tutorSource.match(/\.eq\("agent_type", "lesson_tutor"\)/g) ?? [];

  assert.ok(isolationFilters.length >= 4, `expected at least 4 Tutor runtime agent filters, found ${isolationFilters.length}`);
  assert.match(tutorListMigrationSource, /conversation\.agent_type = 'lesson_tutor'/);
});

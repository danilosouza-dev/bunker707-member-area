import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const {
  buildTutorEvidence,
  formatTutorEvidenceContext,
  resolveTutorEvidenceCitations,
  TUTOR_CITATION_SEEK_MARGIN_SECONDS
} = await import("../src/lib/tutor-citations.ts");
const {
  consumePendingTutorSeek,
  queuePendingTutorSeek
} = await import("../src/lib/tutor-seek-intent.ts");
const migrationSource = await readFile(new URL("../supabase/migrations/202607150001_lesson_ai_tutor.sql", import.meta.url), "utf8");
const softDeleteMigrationSource = await readFile(
  new URL("../supabase/migrations/202607150002_tutor_conversation_soft_delete.sql", import.meta.url),
  "utf8"
);
const providerConfigSource = await readFile(new URL("../src/server/ai/provider-config.ts", import.meta.url), "utf8");
const providerAdapterSource = await readFile(new URL("../src/server/ai/provider-adapter.ts", import.meta.url), "utf8");
const transcriptSource = await readFile(new URL("../src/server/ai/transcripts.ts", import.meta.url), "utf8");
const tutorSource = await readFile(new URL("../src/server/ai/tutor.ts", import.meta.url), "utf8");
const transcriptRoutesSource = (
  await Promise.all(
    [
      "../src/app/api/admin/lessons/[lessonId]/transcript/route.ts",
      "../src/app/api/admin/lessons/[lessonId]/transcript/import-youtube/route.ts",
      "../src/app/api/admin/lessons/[lessonId]/tutor/process/route.ts"
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8"))
  )
).join("\n");
const tutorConversationsRouteSource = await readFile(
  new URL("../src/app/api/tutor/lessons/[lessonId]/conversations/route.ts", import.meta.url),
  "utf8"
);
const tutorMessagesRouteSource = await readFile(
  new URL("../src/app/api/tutor/conversations/[conversationId]/messages/route.ts", import.meta.url),
  "utf8"
);
const tutorConversationRouteSource = await readFile(
  new URL("../src/app/api/tutor/conversations/[conversationId]/route.ts", import.meta.url),
  "utf8"
);
const tutorUiSource = await readFile(new URL("../src/components/lesson-ai-tutor.tsx", import.meta.url), "utf8");
const lessonExperienceSource = await readFile(new URL("../src/components/lesson-experience.tsx", import.meta.url), "utf8");
const lessonPageSource = await readFile(new URL("../src/app/conteudo/[id]/aulas/[moduleId]/page.tsx", import.meta.url), "utf8");
const packageSource = await readFile(new URL("../package.json", import.meta.url), "utf8");
const transcriptUiSource = await readFile(new URL("../src/components/admin/v2/content/lesson-transcript.tsx", import.meta.url), "utf8");

test("Tutor IA schema stores protected provider config, versioned context and permanent chat history", () => {
  for (const table of [
    "ai_provider_configs",
    "ai_provider_config_events",
    "lesson_transcripts",
    "content_chunks",
    "lesson_ai_profiles",
    "ai_conversations",
    "ai_messages"
  ]) {
    assert.match(migrationSource, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migrationSource, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migrationSource, new RegExp(`revoke all on public\\.${table} from anon, authenticated`));
  }

  assert.match(migrationSource, /create extension if not exists "supabase_vault"/);
  assert.match(migrationSource, /save_ai_provider_secret/);
  assert.match(migrationSource, /read_ai_provider_secret/);
  assert.match(migrationSource, /delete_ai_provider_secret/);
  assert.match(migrationSource, /lesson_id text references public\.lessons\(id\) on delete set null/);
  assert.match(migrationSource, /unique \(lesson_id, version\)/);
  assert.match(migrationSource, /ai_messages_conversation_request_idx/);
  assert.match(migrationSource, /ai_messages_one_pending_assistant_idx/);
});

test("provider policies stay server-side and use fixed Gemini, OpenAI and Claude endpoints", () => {
  assert.match(providerConfigSource, /from\("ai_provider_configs"\)/);
  assert.match(providerConfigSource, /enabled: enabled === undefined \? true : Boolean\(enabled\)/);
  assert.match(providerConfigSource, /priority: validateInteger\(priority, 0, -1000, 1000/);
  assert.doesNotMatch(providerConfigSource, /save_ai_provider_secret|read_ai_provider_secret|delete_ai_provider_secret/);
  assert.match(providerAdapterSource, /generativelanguage\.googleapis\.com\/v1beta\/models/);
  assert.match(providerAdapterSource, /O modelo configurado no \$\{displayName\} nao esta disponivel/);
  assert.match(providerAdapterSource, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(providerAdapterSource, /https:\/\/api\.anthropic\.com\/v1\/messages/);
  assert.match(providerAdapterSource, /provider_network_error/);
});

test("lesson registration imports YouTube captions or requires a producer transcript", () => {
  assert.match(transcriptRoutesSource, /prepareYouTubeTranscript/);
  assert.match(transcriptRoutesSource, /normalizeManualTranscript/);
  assert.match(transcriptRoutesSource, /saveLessonTranscript/);
  assert.match(transcriptRoutesSource, /processLessonAIProfile/);
  assert.match(transcriptSource, /Este video nao possui uma legenda publica utilizavel\. Envie um arquivo SRT, VTT ou TXT, ou cole a transcricao\./);
  assert.match(transcriptSource, /source: "youtube"/);
  assert.match(transcriptSource, /createHash\("sha256"\)/);
  assert.match(transcriptSource, /rpc\("save_lesson_transcript_atomic"/);
  assert.match(transcriptSource, /p_chunks: chunks/);
  assert.match(transcriptUiSource, /accept="\.srt,\.vtt,\.txt/);
});

test("Tutor IA isolates students, validates entitlement and persists independent conversations", () => {
  assert.match(tutorConversationsRouteSource, /requireApiUser/);
  assert.match(tutorConversationsRouteSource, /requireLessonAccess/);
  assert.match(tutorMessagesRouteSource, /getTutorConversationAccess/);
  assert.match(tutorMessagesRouteSource, /requireLessonAccess/);
  assert.match(tutorSource, /\.eq\("user_id", userId\)/);
  assert.match(tutorSource, /content_id_snapshot: contentId/);
  assert.match(tutorSource, /title: "Novo chat"/);
  assert.match(tutorSource, /client_request_id: clientRequestId/);
  assert.match(tutorSource, /dailyQuestionLimit/);
  assert.match(tutorSource, /monthlyQuestionLimit/);
  assert.match(tutorSource, /\.in\("provider", configuredProviders\)/);
  assert.match(tutorSource, /rpc\("start_tutor_question_atomic"/);
  assert.match(tutorSource, /profileResult\.data\?\.transcript_id === transcript\.id/);
  assert.match(tutorSource, /buildBoundedHistory\(historyRows, historyBudget\)/);
  assert.match(tutorSource, /generationDeadlineAt = Date\.now\(\) \+ tutorGenerationBudgetMs/);
  assert.match(tutorSource, /deadlineAt: generationDeadlineAt/);
  assert.doesNotMatch(tutorSource, /Math\.max\(5_000, sharedContextLimit - 12_000\)/);
  assert.match(tutorSource, /Use exclusivamente a transcricao e o historico desta conversa/);
  assert.match(tutorSource, /Se a resposta nao estiver no material/);
  assert.match(tutorSource, /Nunca escreva ou calcule horarios/);
  assert.equal(TUTOR_CITATION_SEEK_MARGIN_SECONDS, 3);
  assert.match(tutorSource, /resolveTutorEvidenceCitations\([\s\S]*?TUTOR_CITATION_SEEK_MARGIN_SECONDS[\s\S]*?\)/);
});

test("student Tutor UI supports saved history, multiple chats and clickable lesson timestamps", () => {
  assert.match(tutorUiSource, /Seus chats/);
  assert.match(tutorUiSource, /Novo chat/);
  assert.match(tutorUiSource, /As conversas ficam salvas no seu histórico desta aula\./);
  assert.match(tutorUiSource, /crypto\.randomUUID\(\)/);
  assert.match(tutorUiSource, /Pensando sobre a aula/);
  assert.match(tutorUiSource, /from "react-markdown"/);
  assert.match(tutorUiSource, /from "remark-gfm"/);
  assert.match(tutorUiSource, /<MarkdownMessage body=\{message\.body\} citations=\{message\.citations\} onSeek=\{onSeek\} \/>/);
  assert.match(tutorUiSource, /remarkPlugins=\{\[remarkGfm\]\} skipHtml/);
  assert.match(tutorUiSource, /citation\.verified === true/);
  assert.match(tutorUiSource, /onSeek\(citation\.startSeconds\)/);
  assert.doesNotMatch(tutorUiSource, /timestampExactPattern|renderTimestampText/);
  assert.match(lessonExperienceSource, /function handleTutorTimestampSeek\(seconds: number\)/);
  assert.match(lessonExperienceSource, /queuePendingTutorSeek\(pendingTutorSeekRef, activeLessonKey, seconds\)/);
  assert.match(lessonExperienceSource, /consumePendingTutorSeekForYouTube\(readyPlayer\.player, activeLessonKey\)/);
  assert.match(lessonExperienceSource, /consumePendingTutorSeekForNativeVideo\(videoRef\.current, activeLessonKey\)/);
  assert.doesNotMatch(tutorUiSource, /setTimeout\([^)]*resposta|mock|fixture|fake/i);
});

test("Tutor timestamp seek waits for the active player and is consumed exactly once", () => {
  const store = { current: null };
  const appliedSeconds = [];

  assert.equal(queuePendingTutorSeek(store, "lesson-a", Number.NaN), null);
  queuePendingTutorSeek(store, "lesson-a", 12);
  queuePendingTutorSeek(store, "lesson-a", 42);
  assert.equal(consumePendingTutorSeek(store, "lesson-b", (seconds) => appliedSeconds.push(seconds)), null);
  assert.deepEqual(store.current, { lessonId: "lesson-a", seconds: 42 });
  assert.equal(consumePendingTutorSeek(store, "lesson-a", (seconds) => appliedSeconds.push(seconds)), 42);
  assert.deepEqual(appliedSeconds, [42]);
  assert.equal(store.current, null);
  assert.equal(consumePendingTutorSeek(store, "lesson-a", (seconds) => appliedSeconds.push(seconds)), null);

  queuePendingTutorSeek(store, "lesson-a", -5);
  assert.throws(() => consumePendingTutorSeek(store, "lesson-a", () => {
    throw new Error("player not ready");
  }));
  assert.deepEqual(store.current, { lessonId: "lesson-a", seconds: 0 });
});

test("Tutor timestamp seek is drained by automatic, manual and native players after readiness", () => {
  const timestampHandlerStart = lessonExperienceSource.indexOf("function handleTutorTimestampSeek");
  const timestampHandlerEnd = lessonExperienceSource.indexOf("function handleLessonCompletionToggle", timestampHandlerStart);
  const timestampHandlerSource = lessonExperienceSource.slice(timestampHandlerStart, timestampHandlerEnd);
  const automaticReadyStart = lessonExperienceSource.indexOf("onReady: (event) => {");
  const automaticReadyEnd = lessonExperienceSource.indexOf("onStateChange: (event) => {", automaticReadyStart);
  const automaticReadySource = lessonExperienceSource.slice(automaticReadyStart, automaticReadyEnd);
  const manualReadyStart = lessonExperienceSource.indexOf("function handleManualYouTubeControllerReady");
  const manualReadyEnd = lessonExperienceSource.indexOf("function handleManualYouTubePlaybackStateChange", manualReadyStart);
  const manualReadySource = lessonExperienceSource.slice(manualReadyStart, manualReadyEnd);
  const nativePlayerStart = lessonExperienceSource.indexOf('activePlayerRenderConfig.kind === "video"');
  const nativePlayerEnd = lessonExperienceSource.indexOf(") : canRenderEmbeddedPlayer ? (", nativePlayerStart);
  const nativePlayerSource = lessonExperienceSource.slice(nativePlayerStart, nativePlayerEnd);
  const lessonSelectStart = lessonExperienceSource.indexOf("function handleLessonSelect");
  const lessonSelectEnd = lessonExperienceSource.indexOf("function handleLessonRowKeyDown", lessonSelectStart);
  const lessonSelectSource = lessonExperienceSource.slice(lessonSelectStart, lessonSelectEnd);

  assert.ok(timestampHandlerSource.indexOf("queuePendingTutorSeek") < timestampHandlerSource.indexOf("handlePlayerStart()"));
  assert.match(timestampHandlerSource, /readyPlayer\?\.lessonId === activeLessonKey/);
  assert.ok(automaticReadySource.indexOf("consumePendingTutorSeekForYouTube") < automaticReadySource.indexOf("playVideo?.()"));
  assert.match(manualReadySource, /consumePendingTutorSeekForYouTube\(controller, activeLessonKey\)/);
  assert.ok(manualReadySource.indexOf("consumePendingTutorSeekForYouTube") < manualReadySource.indexOf("controller.playVideo()"));
  assert.match(nativePlayerSource, /onLoadedMetadata=[\s\S]*consumePendingTutorSeekForNativeVideo[\s\S]*initialResumeSecondsRef/);
  assert.ok(lessonSelectSource.indexOf("pendingTutorSeekRef.current = null") < lessonSelectSource.indexOf("setActiveLessonId(lesson.id)"));
});

test("Tutor IA is lazy-mounted, preserves tab state and uses a private in-memory SWR cache", () => {
  assert.match(packageSource, /"swr": "\^2\.4\.2"/);
  assert.doesNotMatch(lessonExperienceSource, /Activity as ReactActivity/);
  assert.match(lessonExperienceSource, /const \[mountedTutorLessonId, setMountedTutorLessonId\] = useState\(""\)/);
  assert.match(lessonExperienceSource, /function selectLessonTab\(nextTab: LessonTab\)/);
  assert.match(lessonExperienceSource, /activeTab === "aiTutor" \|\| nextTab === "aiTutor"/);
  assert.match(lessonExperienceSource, /activeTab === "aiTutor" \|\| mountedTutorLessonId === activeLessonKey/);
  assert.match(lessonExperienceSource, /hidden=\{activeTab !== "aiTutor"\}/);
  assert.match(lessonExperienceSource, /key=\{`\$\{currentUserId\}:\$\{item\.id\}:\$\{activeLessonKey\}`\}/);
  assert.doesNotMatch(lessonExperienceSource, /\{activeTab === "aiTutor" \? \(\s*<div/);
  assert.match(lessonExperienceSource, /userId=\{currentUserId\}/);
  assert.match(lessonPageSource, /currentUserId=\{user\.id\}/);

  assert.match(tutorUiSource, /<SWRConfig value=\{tutorCacheConfiguration\}>/);
  assert.match(tutorUiSource, /provider: \(\) => new Map\(\)/);
  assert.match(tutorUiSource, /dedupingInterval: 60_000/);
  assert.match(tutorUiSource, /refreshInterval: 0/);
  assert.match(tutorUiSource, /revalidateIfStale: false/);
  assert.match(tutorUiSource, /revalidateOnFocus: true/);
  assert.match(tutorUiSource, /revalidateOnReconnect: true/);
  assert.match(tutorUiSource, /getTutorOverviewCacheKey\(userId, contentId, lessonId\)/);
  assert.match(tutorUiSource, /getTutorConversationCacheKey\(userId, contentId, lessonId, activeConversationId\)/);
  assert.match(tutorUiSource, /const loading = !accessDenied && overviewQuery\.isLoading && !overviewQuery\.data/);
  assert.match(tutorUiSource, /const displayedError = error \|\|/);
  assert.match(tutorUiSource, /mutateTutorCache\(\(\) => true, undefined, \{ revalidate: false \}\)/);
  assert.match(tutorUiSource, /error\.status === 401 \|\| error\.status === 403/);
});

test("Tutor IA mutations update only the captured conversation cache", () => {
  assert.match(tutorUiSource, /const \[sendingConversationId, setSendingConversationId\] = React\.useState\(""\)/);
  assert.match(tutorUiSource, /const requestConversationCacheKey = getTutorConversationCacheKey\([\s\S]*?conversationId[\s\S]*?\)/);
  assert.match(tutorUiSource, /mutateTutorCache\(requestConversationCacheKey, result, \{ revalidate: false \}\)/);
  assert.match(tutorUiSource, /sendingConversationId === conversation\.id/);
  assert.match(tutorUiSource, /current\?\.conversation \?\? conversationForCache/);
  assert.doesNotMatch(tutorUiSource, /setMessages\(|setConversations\(/);
});

test("all Tutor routes prevent private history from entering HTTP caches", () => {
  for (const routeSource of [
    tutorConversationsRouteSource,
    tutorConversationRouteSource,
    tutorMessagesRouteSource
  ]) {
    assert.match(routeSource, /Cache-Control", "private, no-store, max-age=0"/);
    assert.match(routeSource, /Pragma", "no-cache"/);
    assert.match(routeSource, /Vary", "Cookie"/);
    assert.match(routeSource, /noStore\(auth\.response!\)/);
    assert.match(routeSource, /noStore\(jsonRouteError\(/);
    assert.doesNotMatch(routeSource, /return\s+NextResponse\.json/);
    assert.doesNotMatch(routeSource, /return\s+jsonRouteError/);
    assert.doesNotMatch(routeSource, /return\s+auth\.response/);
  }
});

test("student can hide an owned Tutor chat while its messages remain stored for analysis", () => {
  assert.match(softDeleteMigrationSource, /add column if not exists student_deleted_at timestamptz/);
  assert.match(softDeleteMigrationSource, /where student_deleted_at is null/);
  assert.match(softDeleteMigrationSource, /lesson_tutor_conversation_deleted_by_student/);
  assert.doesNotMatch(softDeleteMigrationSource, /delete from public\.ai_(?:conversations|messages)/);
  assert.match(tutorConversationRouteSource, /export async function DELETE/);
  assert.match(tutorConversationRouteSource, /hideTutorConversation\(conversationId, auth\.user\.id\)/);
  assert.match(tutorSource, /\.update\(\{ student_deleted_at: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(tutorSource, /\.eq\("user_id", userId\)[\s\S]*?\.is\("student_deleted_at", null\)/);
  assert.match(tutorUiSource, /Excluir chat/);
  assert.match(tutorUiSource, /method: "DELETE"/);
  assert.match(tutorUiSource, /Este chat será removido do seu histórico/);
});

test("student can rename an owned Tutor chat from a compact non-wrapping action menu", () => {
  assert.match(tutorConversationRouteSource, /export async function PATCH/);
  assert.match(tutorConversationRouteSource, /renameTutorConversation\(conversationId, auth\.user\.id, body\.title\)/);
  assert.match(tutorSource, /function normalizeConversationTitle/);
  assert.match(tutorSource, /export async function renameTutorConversation/);
  assert.match(tutorSource, /\.update\(\{ title \}\)[\s\S]*?\.eq\("user_id", userId\)[\s\S]*?\.is\("student_deleted_at", null\)/);
  assert.match(tutorUiSource, /Renomear chat/);
  assert.match(tutorUiSource, /Editar nome do chat/);
  assert.match(tutorUiSource, /method: "PATCH"/);
  assert.match(tutorUiSource, /w-40[^"]*rounded-\[8px\]/);
  assert.match(tutorUiSource, /whitespace-nowrap/);
});

test("Tutor timestamps come from matching caption cues with a three-second seek margin", () => {
  const cues = [
    {
      endSeconds: 362.84,
      startSeconds: 358.96,
      text: "E aí depois você vai fazer a sincronização facial."
    },
    {
      endSeconds: 367.76,
      startSeconds: 362.84,
      text: "Você tem que saber fazer a sincronização facial e corrigir a identidade."
    },
    {
      endSeconds: 394.4,
      startSeconds: 389.64,
      text: "Esse vídeo é para te mostrar o que você vai conseguir nesse treinamento."
    }
  ];
  const evidence = buildTutorEvidence({
    chunks: [{ endSeconds: 435.32, id: "chunk-wide", startSeconds: 347.36 }],
    cues,
    maximumCharacters: 10_000,
    transcriptId: "transcript-1"
  });

  assert.equal(formatTutorEvidenceContext(evidence).includes("05:59"), false);
  assert.match(formatTutorEvidenceContext(evidence), /\[F1\] E aí depois você vai fazer a sincronização facial\./);
  const resolved = resolveTutorEvidenceCitations(
    "**Sincronização Facial:** correção da identidade e sincronização facial. [F1]",
    evidence,
    3
  );

  assert.equal(resolved.body, "**Sincronização Facial:** correção da identidade e sincronização facial. [05:56]");
  assert.deepEqual(resolved.citations, [{
    chunkId: "chunk-wide:F1",
    endSeconds: 362.84,
    label: "05:56",
    quote: "E aí depois você vai fazer a sincronização facial.",
    startSeconds: 356,
    verified: true
  }]);
});

test("Tutor three-second seek margin never produces a negative timestamp", () => {
  const evidence = buildTutorEvidence({
    chunks: [{ endSeconds: 12, id: "chunk-intro", startSeconds: 0 }],
    cues: [{
      endSeconds: 4.5,
      startSeconds: 1.6,
      text: "A introdução apresenta o primeiro agente inteligente."
    }],
    maximumCharacters: 10_000,
    transcriptId: "transcript-intro"
  });
  const resolved = resolveTutorEvidenceCitations(
    "A introdução apresenta o primeiro agente inteligente. [F1]",
    evidence
  );

  assert.equal(resolved.body, "A introdução apresenta o primeiro agente inteligente. [00:00]");
  assert.equal(resolved.citations[0]?.startSeconds, 0);
});

test("Tutor rejects a source marker when the caption does not support the nearby claim", () => {
  const evidence = buildTutorEvidence({
    chunks: [{ endSeconds: 435.32, id: "chunk-wide", startSeconds: 347.36 }],
    cues: [{
      endSeconds: 394.4,
      startSeconds: 389.64,
      text: "Esse vídeo é para te mostrar o que você vai conseguir nesse treinamento."
    }],
    maximumCharacters: 10_000,
    transcriptId: "transcript-1"
  });
  const resolved = resolveTutorEvidenceCitations(
    "**Sincronização Facial:** correção da identidade e das características físicas. [F1]",
    evidence,
    3
  );

  assert.equal(resolved.body.includes("F1"), false);
  assert.deepEqual(resolved.citations, []);
});

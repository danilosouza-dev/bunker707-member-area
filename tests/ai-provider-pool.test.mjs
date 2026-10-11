import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  envExampleSource,
  migrationSource,
  accountGatewaySource,
  accountLinkSource,
  connectionSource,
  poolSource,
  tutorSource,
  usageSource,
  usageRouteSource,
  usageUiSource,
  gatewayDockerSource,
  gatewayEntrypointSource,
  gatewayComposeSource,
  gatewaySmokeSource,
  gitignoreSource,
  connectionsRouteSource,
  connectionsUiSource,
  modelsRouteSource,
  providerSettingsSource
] = await Promise.all([
  readSource("../.env.example"),
  readSource("../supabase/migrations/202607160001_ai_provider_connection_pools.sql"),
  readSource("../src/server/ai/account-gateway.ts"),
  readSource("../src/server/ai/account-link.ts"),
  readSource("../src/server/ai/provider-connections.ts"),
  readSource("../src/server/ai/provider-pool.ts"),
  readSource("../src/server/ai/tutor.ts"),
  readSource("../src/server/ai/usage-analytics.ts"),
  readSource("../src/app/api/admin/ai-usage/route.ts"),
  readSource("../src/components/admin/settings/ai-usage-dashboard.tsx"),
  readSource("../services/bunker-ai-gateway/Dockerfile"),
  readSource("../services/bunker-ai-gateway/entrypoint.sh"),
  readSource("../services/bunker-ai-gateway/compose.yml"),
  readSource("../scripts/smoke-ai-gateway.mjs"),
  readSource("../.gitignore"),
  readSource("../src/app/api/admin/ai-connections/route.ts"),
  readSource("../src/components/admin/settings/ai-connections-manager.tsx"),
  readSource("../src/app/api/admin/ai-connections/models/route.ts"),
  readSource("../src/components/admin/settings/ai-provider-settings.tsx")
]);

test("Bunker AI Gateway uses explicit server-only runtime and management credentials", () => {
  const accountStartHandler = connectionsUiSource.match(
    /async function startAccountLink[\s\S]*?(?=\n  async function copyAccountLoginLink)/
  )?.[0] ?? "";

  for (const variable of [
    "BUNKER_AI_GATEWAY_URL",
    "BUNKER_AI_GATEWAY_API_KEY",
    "BUNKER_AI_GATEWAY_MANAGEMENT_KEY"
  ]) {
    assert.match(envExampleSource, new RegExp(`^${variable}=$`, "m"));
    assert.doesNotMatch(envExampleSource, new RegExp(`^NEXT_PUBLIC_${variable}=`, "m"));
  }

  assert.match(accountGatewaySource, /getGatewaySecret\("BUNKER_AI_GATEWAY_API_KEY"\)/);
  assert.match(accountGatewaySource, /getGatewaySecret\("BUNKER_AI_GATEWAY_MANAGEMENT_KEY"\)/);
  assert.match(accountGatewaySource, /url\.protocol !== "https:"[^\n]+local && url\.protocol === "http:"/);
  assert.match(accountGatewaySource, /url\.username \|\| url\.password \|\| url\.search \|\| url\.hash/);
  assert.match(accountGatewaySource, /cache: "no-store"/);
  assert.match(accountGatewaySource, /redirect: "error"/);
  assert.match(accountGatewaySource, /export async function getAccountGatewayStatus/);
  assert.match(accountGatewaySource, /export async function listAccountGatewayModels/);
  assert.match(accountGatewaySource, /isTutorTextModel/);
  assert.match(accountGatewaySource, /reachable: true/);
  assert.match(connectionsRouteSource, /getAccountGatewayStatus\(\)/);
  assert.match(connectionsRouteSource, /Promise\.all/);
  assert.match(connectionsUiSource, /gateway\.reachable/);
  assert.match(connectionsUiSource, /!gateway\.configured \|\| !gateway\.reachable/);
  assert.match(connectionsUiSource, /ERR_EMPTY_RESPONSE/);
  assert.match(connectionsUiSource, /\n\s+Continuar\n/);
  assert.match(connectionsUiSource, /<ExternalLink[^>]*\/> Abrir login/);
  assert.doesNotMatch(accountStartHandler, /window\.open/);
  assert.match(connectionsUiSource, /Copiar link de login/);
  assert.match(connectionsUiSource, /navigator\.clipboard\.writeText\(accountLink\.url\)/);
  assert.match(connectionsUiSource, /Copiei a URL, concluir conexão/);
  assert.match(connectionsUiSource, /Configure o modelo antes de testar/);
  assert.match(modelsRouteSource, /requireApiRole\("admin\.read"\)/);
  assert.match(modelsRouteSource, /listAccountGatewayModels\(provider\)/);
  assert.match(providerSettingsSource, /\/api\/admin\/ai-connections\/models\?provider=/);
  assert.match(providerSettingsSource, /Detectados no gateway/);
});

test("Bunker AI Gateway has a persistent loopback-only operational runtime", () => {
  assert.match(gatewayDockerSource, /CLIPROXY_COMMIT=09da52ad509e2c18e7b9540db3b98c2214c280aa/);
  assert.match(gatewayDockerSource, /HEALTHCHECK[\s\S]*?\/v1\/models/);
  assert.match(gatewayEntrypointSource, /#BUNKER_AI_GATEWAY_API_KEY\}" -lt 32/);
  assert.match(gatewayEntrypointSource, /#MANAGEMENT_PASSWORD\}" -lt 32/);
  assert.match(gatewayEntrypointSource, /BUNKER_AI_GATEWAY_API_KEY" = "\$MANAGEMENT_PASSWORD/);
  assert.match(gatewayEntrypointSource, /config_dir="\/tmp\/bunker-ai-gateway"/);

  assert.match(gatewayComposeSource, /127\.0\.0\.1:8317:8317/);
  assert.match(gatewayComposeSource, /bunker-ai-gateway-auth:\/data\/auth/);
  assert.match(gatewayComposeSource, /restart: unless-stopped/);
  assert.match(gatewayComposeSource, /read_only: true/);
  assert.match(gatewayComposeSource, /cap_drop:\s+- ALL/);
  assert.match(gatewayComposeSource, /no-new-privileges:true/);
  assert.match(gatewayComposeSource, /pids_limit: 128/);
  assert.match(gatewayComposeSource, /mem_limit: 512m/);
  assert.match(gatewayComposeSource, /max-size: "10m"/);
  assert.match(gatewayComposeSource, /max-file: "3"/);
  assert.match(gitignoreSource, /^\.env\.\*\.local$/m);

  assert.match(gatewaySmokeSource, /request\("\/v1\/models"/);
  assert.match(gatewaySmokeSource, /request\("\/v0\/management\/auth-files"/);
  assert.match(gatewaySmokeSource, /Gestao sem credencial/);
  assert.match(gatewaySmokeSource, /Runtime sem credencial/);
  assert.match(gatewaySmokeSource, /Runtime com chave de gestao/);
  assert.match(gatewaySmokeSource, /Gestao com chave de runtime/);
  assert.match(gatewaySmokeSource, /redirect: "error"/);
  assert.match(gatewaySmokeSource, /\[401, 403\]/);
});

test("connection pool schema separates API secrets from connected accounts and is server-only", () => {
  for (const table of [
    "ai_provider_connections",
    "ai_provider_connection_events",
    "ai_account_link_sessions"
  ]) {
    assert.match(migrationSource, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migrationSource, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migrationSource, new RegExp(`revoke all on public\\.${table} from anon, authenticated`));
  }

  assert.match(migrationSource, /auth_mode text not null check \(auth_mode in \('api_key', 'account_gateway'\)\)/);
  assert.match(migrationSource, /auth_mode = 'api_key'[\s\S]*?gateway_auth_id is null[\s\S]*?vault_secret_id is not null or deleted_at is not null/);
  assert.match(migrationSource, /auth_mode = 'account_gateway' and vault_secret_id is null and gateway_auth_id is not null/);
  assert.match(migrationSource, /read_ai_provider_connection_secret/);
  assert.match(migrationSource, /grant execute on function public\.read_ai_provider_connection_secret\(uuid\)[\s\S]*?to service_role/);
  assert.match(migrationSource, /revoke all on function public\.record_ai_message_event\(\)\s+from public, anon, authenticated/);
  assert.match(migrationSource, /if connection_found is not true then[\s\S]*?raise exception 'Conexao de IA nao encontrada\.'/);
  assert.match(migrationSource, /status = case\s+when normalized_secret = '' then public\.ai_provider_connections\.status\s+else 'active'/);
  assert.match(migrationSource, /consecutive_failures = case\s+when normalized_secret = '' then public\.ai_provider_connections\.consecutive_failures\s+else 0/);
  assert.match(migrationSource, /health_tier = case\s+when normalized_secret = '' then public\.ai_provider_connections\.health_tier\s+else 'healthy'/);
  assert.match(migrationSource, /cooldown_until = case\s+when normalized_secret = '' then public\.ai_provider_connections\.cooldown_until\s+else null/);
  assert.doesNotMatch(migrationSource, /returns uuid\s+returns uuid/);
  assert.doesNotMatch(migrationSource, /insert into public\.student_events\s*\(\s*user_id,\s*event_type,\s*event_type,/s);
});

test("Tutor context relations enforce transcript, lesson, conversation and student ownership", () => {
  for (const constraint of [
    "lesson_transcripts_id_lesson_unique",
    "content_chunks_transcript_lesson_fk",
    "lesson_ai_profiles_transcript_lesson_fk",
    "ai_conversations_id_user_unique",
    "ai_messages_conversation_user_fk"
  ]) {
    assert.match(migrationSource, new RegExp(`conname = '${constraint}'`));
  }

  assert.match(migrationSource, /foreign key \(transcript_id, lesson_id\)\s+references public\.lesson_transcripts \(id, lesson_id\)/);
  assert.match(migrationSource, /foreign key \(conversation_id, user_id\)\s+references public\.ai_conversations \(id, user_id\)/);
  assert.match(migrationSource, /validate constraint content_chunks_transcript_lesson_fk/);
  assert.match(migrationSource, /validate constraint lesson_ai_profiles_transcript_lesson_fk/);
  assert.match(migrationSource, /validate constraint ai_messages_conversation_user_fk/);
});

test("transcript persistence is serialized, versioned and self-repairing in one RPC", () => {
  assert.match(migrationSource, /create or replace function public\.save_lesson_transcript_atomic\([\s\S]*?p_created_by uuid,[\s\S]*?p_lesson_id text,[\s\S]*?p_chunks jsonb/);
  assert.match(migrationSource, /from public\.lessons lesson[\s\S]*?where lesson\.id = p_lesson_id[\s\S]*?for update/);
  assert.match(migrationSource, /active_checksum = p_checksum[\s\S]*?active_cues is not distinct from p_cues[\s\S]*?active_full_text is not distinct from p_full_text[\s\S]*?active_chunks = normalized_chunks/);
  assert.match(migrationSource, /from public\.content_chunks chunk\s+where chunk\.transcript_id = active_transcript_id/);
  assert.match(migrationSource, /coalesce\(max\(transcript\.version\), 0\) \+ 1/);
  assert.match(migrationSource, /delete from public\.content_chunks\s+where transcript_id = saved_transcript_id/);
  assert.match(migrationSource, /jsonb_to_recordset\(p_chunks\)/);
  assert.match(migrationSource, /on conflict \(lesson_id\) do update set[\s\S]*?transcript_id = excluded\.transcript_id/);
  assert.match(migrationSource, /where public\.lesson_ai_profiles\.transcript_id is distinct from excluded\.transcript_id\s+or context_changed/);
  assert.match(migrationSource, /grant execute on function public\.save_lesson_transcript_atomic\([\s\S]*?to service_role/);
});

test("question start is owned, idempotent and recovers abandoned pending answers atomically", () => {
  assert.match(migrationSource, /create or replace function public\.start_tutor_question_atomic\([\s\S]*?p_client_request_id uuid,[\s\S]*?p_connection_id uuid,[\s\S]*?p_conversation_id uuid,[\s\S]*?p_user_id uuid/);
  assert.match(migrationSource, /conversation\.id = p_conversation_id[\s\S]*?conversation\.user_id = p_user_id[\s\S]*?conversation\.agent_type = 'lesson_tutor'[\s\S]*?conversation\.student_deleted_at is null[\s\S]*?for update/);
  assert.match(migrationSource, /created_at <= clock_timestamp\(\) - interval '90 seconds'/);
  assert.match(migrationSource, /client_request_id = p_client_request_id[\s\S]*?jsonb_build_object\('state', 'duplicate'\)/);
  assert.match(migrationSource, /jsonb_build_object\(\s*'state', 'pending',[\s\S]*?'assistantMessageId', pending_message_id/);
  assert.match(migrationSource, /insert into public\.ai_messages \([\s\S]*?client_request_id[\s\S]*?insert into public\.ai_messages \([\s\S]*?'assistant'/);
  assert.match(migrationSource, /connection\.status = 'active'[\s\S]*?connection\.cooldown_until <= clock_timestamp\(\)/);
  assert.match(migrationSource, /jsonb_build_object\(\s*'state', 'created',[\s\S]*?'assistantMessageId', assistant_message_id/);
  assert.match(migrationSource, /grant execute on function public\.start_tutor_question_atomic\([\s\S]*?to service_role/);
});

test("pool selection implements priority, health, least-recently-used rotation and cooldown", () => {
  assert.match(poolSource, /\.in\("status", allowNeedsAttention \? \["active", "needs_attention"\] : \["active"\]\)/);
  assert.match(poolSource, /\.filter\(\(connection\) => allowNeedsAttention \|\| !isCoolingDown\(connection\)\)/);
  assert.match(poolSource, /right\.priority - left\.priority/);
  assert.match(poolSource, /healthTierRank\(left\.health_tier\) - healthTierRank\(right\.health_tier\)/);
  assert.match(poolSource, /compareNullableDates\(left\.last_used_at, right\.last_used_at\)/);
  assert.match(poolSource, /rpc\("claim_ai_provider_connection"/);
  assert.match(migrationSource, /create or replace function public\.claim_ai_provider_connection/);
  assert.match(migrationSource, /for update skip locked/);
  assert.match(migrationSource, /set last_used_at = clock_timestamp\(\)/);
  assert.match(poolSource, /attempts\.push\([\s\S]*?success: false/);
  assert.match(poolSource, /safeDeadlineAt[\s\S]*?provider_deadline_exceeded/);
  assert.match(poolSource, /timeoutMs: Math\.min\(20_000/);
  assert.match(poolSource, /return \{ attempts, config, generation \}/);
  assert.match(poolSource, /throw new AIProviderPoolError\(message, code, attempts\)/);
});

test("connection health applies quota cooldown, transient backoff and proof-based recovery", () => {
  assert.match(connectionSource, /code === "provider_http_401"[\s\S]*?code === "provider_http_402"[\s\S]*?code === "provider_http_403"/);
  assert.match(connectionSource, /status: "needs_attention" as const/);
  assert.match(connectionSource, /code === "provider_http_429"[\s\S]*?120 \* 1000/);
  assert.match(connectionSource, /provider_timeout[\s\S]*?provider_network_error[\s\S]*?code\.startsWith\("provider_http_5"\)/);
  assert.match(connectionSource, /Math\.min\(15 \* 60 \* 1000, 15 \* 1000 \* \(2 \*\* Math\.max\(0, failureCount - 1\)\)\)/);
  assert.match(connectionSource, /nextProbeStreak >= 3/);
  assert.match(connectionSource, /health_tier: recovered \? "healthy" : "probing"/);
  assert.match(connectionSource, /health_tier: failureState\.permanent \|\| nextFailureCount >= 2 \? "draining" : row\.health_tier/);
});

test("connected-account OAuth is owned, short-lived and validates the localhost callback", () => {
  assert.match(accountLinkSource, /\.eq\("actor_id", actorId\)/);
  assert.match(accountLinkSource, /Date\.now\(\) \+ 5 \* 60 \* 1000/);
  assert.match(accountLinkSource, /url\.hostname === "localhost" \|\| url\.hostname === "127\.0\.0\.1" \|\| url\.hostname === "::1"/);
  assert.match(accountLinkSource, /url\.protocol !== "http:" \|\| \(url\.username \|\| url\.password\)/);
  assert.match(accountLinkSource, /returnedState !== expectedState/);
  assert.match(accountLinkSource, /!url\.searchParams\.get\("code"\) && !url\.searchParams\.get\("error"\)/);
  assert.match(accountLinkSource, /gateway_auth_ids_before: before\.map\(\(auth\) => auth\.id\)/);
  assert.match(accountLinkSource, /!beforeIds\.has\(account\.id\)/);
  assert.match(accountLinkSource, /upsertAccountGatewayConnection/);
});

test("Tutor and future Director keep distinct agent contracts and usage attribution", () => {
  assert.match(migrationSource, /agent_type text not null default 'lesson_tutor'/);
  assert.match(migrationSource, /agent_type in \('lesson_tutor', 'platform_guide'\)/);
  assert.match(tutorSource, /agent_type: "lesson_tutor"/);
  assert.match(tutorSource, /connection_id: generated\.config\.connectionId/);
  assert.match(tutorSource, /provider_attempts: generated\.attempts/);
  assert.match(tutorSource, /gateway_request_id: generated\.generation\.gatewayRequestId/);
  assert.match(migrationSource, /add column if not exists connection_id uuid/);
  assert.match(migrationSource, /add column if not exists provider_attempts jsonb not null default '\[\]'::jsonb/);
  assert.match(migrationSource, /add column if not exists gateway_request_id text/);
});

test("producer usage contract includes tutor per lesson, Director, students and ranking", () => {
  assert.match(migrationSource, /create or replace function public\.get_ai_usage_summary/);
  assert.match(migrationSource, /p_agent_type is not null and p_agent_type not in \('lesson_tutor', 'platform_guide'\)/);
  assert.match(migrationSource, /by_lesson as/);
  assert.match(migrationSource, /where agent_type = 'lesson_tutor'/);
  assert.match(migrationSource, /array_agg\(lesson_title_snapshot order by created_at desc, id desc\)/);
  assert.match(migrationSource, /group by lesson_id\s+order by total_tokens desc/);
  assert.doesNotMatch(migrationSource, /group by lesson_id, lesson_title_snapshot/);
  assert.match(migrationSource, /by_student as/);
  assert.match(migrationSource, /left join public\.profiles profile on profile\.id = usage\.user_id/);
  assert.match(migrationSource, /jsonb_agg\(item order by total_tokens desc, answers desc/);
  assert.match(migrationSource, /'lessonTutorAnswers', usage\.lesson_tutor_answers/);
  assert.match(migrationSource, /'platformGuideAnswers', usage\.platform_guide_answers/);
  assert.match(migrationSource, /'byAgent', by_agent\.value/);
  assert.match(migrationSource, /'byLesson', by_lesson\.value/);
  assert.match(migrationSource, /'byStudent', by_student\.value/);

  assert.match(usageSource, /export type AIAgentType = "lesson_tutor" \| "platform_guide"/);
  assert.match(usageSource, /byStudent: Array<\{/);
  for (const field of [
    "activeDays",
    "answers",
    "conversations",
    "email",
    "fullName",
    "lessonTutorAnswers",
    "platformGuideAnswers",
    "totalTokens",
    "userId"
  ]) {
    assert.match(usageSource, new RegExp(`${field}:`));
  }

  assert.match(usageRouteSource, /requireApiRole\("admin\.read"\)/);
  assert.match(usageRouteSource, /Cache-Control", "private, no-store, max-age=0"/);
  assert.match(usageUiSource, /Consumo por aula \/ tutor/);
  assert.match(usageUiSource, /Ranking de (?:alunos|uso por aluno)/);
  assert.match(usageUiSource, /Tutor(?: IA|es das aulas)/);
  assert.match(usageUiSource, /Diretor/);
});

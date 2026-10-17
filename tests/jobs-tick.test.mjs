import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  authorizeJobsTickRequest,
  isJobsTickTokenConfigured,
  isValidJobsTickToken,
  MIN_JOBS_TICK_TOKEN_LENGTH,
  readBearerToken
} from "../src/server/jobs/tick-auth.ts";
import {
  MAX_TICK_PAYLOAD_BYTES,
  parseTickMetadata,
  shouldReadTickBody
} from "../src/server/jobs/tick-metadata.ts";

const configuredToken = "a".repeat(32) + "0123456789abcdef0123456789abcdef";

const tickAuthSource = await readFile(new URL("../src/server/jobs/tick-auth.ts", import.meta.url), "utf8");
const tickMetadataSource = await readFile(new URL("../src/server/jobs/tick-metadata.ts", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../src/app/api/jobs/tick/route.ts", import.meta.url), "utf8");
const registrySource = await readFile(new URL("../src/server/jobs/registry.ts", import.meta.url), "utf8");
const jobRunsSource = await readFile(new URL("../src/server/jobs/job-runs.ts", import.meta.url), "utf8");
const migrationSource = await readFile(
  new URL("../supabase/migrations/202610100001_jobs_cron.sql", import.meta.url),
  "utf8"
);
const envExampleSource = await readFile(new URL("../.env.example", import.meta.url), "utf8");

test("readBearerToken extracts only well-formed Bearer credentials", () => {
  assert.equal(readBearerToken(`Bearer ${configuredToken}`), configuredToken);
  assert.equal(readBearerToken(`bearer ${configuredToken}`), configuredToken);
  assert.equal(readBearerToken(`  Bearer   ${configuredToken}  `), configuredToken);
  assert.equal(readBearerToken(null), null);
  assert.equal(readBearerToken(undefined), null);
  assert.equal(readBearerToken(""), null);
  assert.equal(readBearerToken("Bearer"), null);
  assert.equal(readBearerToken("Bearer "), null);
  assert.equal(readBearerToken(`Basic ${configuredToken}`), null);
  assert.equal(readBearerToken(`Bearer ${configuredToken} extra`), null);
  assert.equal(readBearerToken(configuredToken), null);
});

test("token configuration requires a non-trivial secret", () => {
  assert.equal(MIN_JOBS_TICK_TOKEN_LENGTH >= 32, true);
  assert.equal(isJobsTickTokenConfigured(undefined), false);
  assert.equal(isJobsTickTokenConfigured(null), false);
  assert.equal(isJobsTickTokenConfigured(""), false);
  assert.equal(isJobsTickTokenConfigured("   "), false);
  assert.equal(isJobsTickTokenConfigured("short-token"), false);
  assert.equal(isJobsTickTokenConfigured("x".repeat(MIN_JOBS_TICK_TOKEN_LENGTH - 1)), false);
  assert.equal(isJobsTickTokenConfigured("x".repeat(MIN_JOBS_TICK_TOKEN_LENGTH)), true);
  assert.equal(isJobsTickTokenConfigured(configuredToken), true);
});

test("isValidJobsTickToken accepts only the exact configured token", () => {
  assert.equal(isValidJobsTickToken(configuredToken, configuredToken), true);
  assert.equal(isValidJobsTickToken(configuredToken, `  ${configuredToken}\n`), true);

  const sameLengthDifferent = `${configuredToken.slice(0, -1)}${configuredToken.endsWith("f") ? "e" : "f"}`;
  assert.equal(sameLengthDifferent.length, configuredToken.length);
  assert.equal(isValidJobsTickToken(sameLengthDifferent, configuredToken), false);

  assert.equal(isValidJobsTickToken(configuredToken.slice(0, -1), configuredToken), false);
  assert.equal(isValidJobsTickToken(`${configuredToken}0`, configuredToken), false);
  assert.equal(isValidJobsTickToken(configuredToken.toUpperCase(), configuredToken), false);
  assert.equal(isValidJobsTickToken("", configuredToken), false);
  assert.equal(isValidJobsTickToken(null, configuredToken), false);
  assert.equal(isValidJobsTickToken(undefined, configuredToken), false);
});

test("isValidJobsTickToken never matches when the server token is missing or too short", () => {
  assert.equal(isValidJobsTickToken("", ""), false);
  assert.equal(isValidJobsTickToken("short", "short"), false);
  assert.equal(isValidJobsTickToken(undefined, undefined), false);
  assert.equal(isValidJobsTickToken(configuredToken, undefined), false);
});

test("isValidJobsTickToken handles tokens of any length without throwing", () => {
  for (const candidate of ["a", "a".repeat(10_000), "ç".repeat(64), "\u0000".repeat(64)]) {
    assert.doesNotThrow(() => isValidJobsTickToken(candidate, configuredToken));
    assert.equal(isValidJobsTickToken(candidate, configuredToken), false);
  }
});

test("authorizeJobsTickRequest returns 503 without server token, 401 on bad credentials, ok on match", () => {
  for (const missing of [undefined, null, "", "short-token"]) {
    const result = authorizeJobsTickRequest(`Bearer ${configuredToken}`, missing);
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
  }

  for (const header of [null, "", `Basic ${configuredToken}`, "Bearer wrong-token", `Bearer ${configuredToken}x`]) {
    const result = authorizeJobsTickRequest(header, configuredToken);
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  }

  assert.deepEqual(authorizeJobsTickRequest(`Bearer ${configuredToken}`, configuredToken), { ok: true });
});

test("token comparison uses crypto.timingSafeEqual over fixed-size digests", () => {
  assert.match(tickAuthSource, /import \{[^}]*timingSafeEqual[^}]*\} from "node:crypto"/);
  assert.match(tickAuthSource, /timingSafeEqual\(digest\(provided\), digest\(/);
  assert.match(tickAuthSource, /createHash\("sha256"\)/);
  assert.doesNotMatch(tickAuthSource, /provided(Token)? === configured(Token)?/);
  assert.doesNotMatch(tickAuthSource, /import "server-only"/);
  assert.doesNotMatch(tickMetadataSource, /import "server-only"/);
});

function tickRequest({ body, contentLength, contentType = "application/json" } = {}) {
  const headers = new Headers();

  if (contentType) {
    headers.set("content-type", contentType);
  }

  if (contentLength !== undefined) {
    headers.set("content-length", contentLength);
  }

  return new Request("https://bunker707.test/api/jobs/tick", { body, headers, method: "POST" });
}

test("tick body is read only when a JSON body was sent", () => {
  assert.equal(shouldReadTickBody(tickRequest({ body: "{}" })), true);
  assert.equal(shouldReadTickBody(tickRequest({ body: "{}", contentType: "application/json; charset=utf-8" })), true);
  assert.equal(shouldReadTickBody(tickRequest()), false);
  assert.equal(shouldReadTickBody(tickRequest({ body: "{}", contentLength: "0" })), false);
  assert.equal(shouldReadTickBody(tickRequest({ body: "{}", contentType: "text/plain" })), false);
  assert.equal(shouldReadTickBody(tickRequest({ body: "{}", contentType: "" })), false);
  assert.equal(MAX_TICK_PAYLOAD_BYTES > 0 && MAX_TICK_PAYLOAD_BYTES <= 16_384, true);
});

test("tick metadata keeps only short source and scheduled_at strings", () => {
  const scheduledAt = "2026-10-10T12:00:00.000Z";

  assert.deepEqual(parseTickMetadata({ scheduled_at: scheduledAt, source: "pg_cron" }), {
    scheduled_at: scheduledAt,
    source: "pg_cron"
  });
  assert.deepEqual(parseTickMetadata({ source: "pg_cron", token: configuredToken, extra: { nested: true } }), {
    source: "pg_cron"
  });
  assert.deepEqual(parseTickMetadata({ scheduled_at: 1_700_000_000, source: ["pg_cron"] }), {});
  assert.deepEqual(parseTickMetadata({ scheduled_at: "", source: "" }), {});
  assert.deepEqual(parseTickMetadata({ source: "s".repeat(40) }), { source: "s".repeat(40) });
  assert.deepEqual(parseTickMetadata({ source: "s".repeat(41), scheduled_at: "t".repeat(65) }), {});

  for (const payload of [null, undefined, "pg_cron", 42, true, [], [{ source: "pg_cron" }]]) {
    assert.deepEqual(parseTickMetadata(payload), {}, `payload ${JSON.stringify(payload)}`);
  }
});

test("tick route authenticates first, bounds the body and records job_runs", () => {
  assert.match(routeSource, /export const runtime = "nodejs";/);
  assert.match(routeSource, /export const maxDuration = 60;/);
  assert.match(routeSource, /export async function POST\(request: Request\)/);
  assert.doesNotMatch(routeSource, /export async function GET/);
  assert.match(routeSource, /authorizeJobsTickRequest\(\s*request\.headers\.get\("authorization"\),\s*process\.env\.JOBS_TICK_TOKEN/);
  assert.match(routeSource, /readBoundedJson<[^>]+>\(request, MAX_TICK_PAYLOAD_BYTES\)/);
  assert.match(routeSource, /shouldReadTickBody\(request\)/);
  assert.match(routeSource, /parseTickMetadata\(/);
  assert.match(routeSource, /getSupabaseAdminClient\(\)/);
  assert.ok(
    routeSource.indexOf("authorizeJobsTickRequest(") < routeSource.indexOf("readTickMetadata(request)"),
    "token must be checked before reading the body"
  );
  const jobTypeBody = registrySource.match(/export type Job = \{([^}]*)\}/)?.[1] ?? "";
  assert.match(jobTypeBody, /\bname: string;/);
  assert.match(jobTypeBody, /\brun\(ctx: JobContext\): Promise<void>;/);
  assert.match(registrySource, /export const jobRegistry: readonly Job\[\] = \[emailOutboxJob\];/);
  assert.match(jobRunsSource, /\.from\("job_runs"\)/);
});

test("jobs migration enables cron/net, locks job_runs and schedules the tick idempotently", () => {
  assert.match(migrationSource, /create extension if not exists "pg_cron" with schema pg_catalog;/);
  assert.match(migrationSource, /create extension if not exists "pg_net" with schema extensions;/);
  assert.match(migrationSource, /create table if not exists public\.job_runs \(/);
  assert.match(migrationSource, /status in \('running', 'succeeded', 'failed'\)/);
  assert.match(migrationSource, /create index if not exists job_runs_job_started_at_idx\s+on public\.job_runs \(job, started_at desc\);/);
  assert.match(migrationSource, /alter table public\.job_runs enable row level security;/);
  assert.match(migrationSource, /revoke all on public\.job_runs from anon, authenticated;/);
  assert.match(
    migrationSource,
    /create or replace function public\.enqueue_jobs_tick\(\)[\s\S]*?security definer\s+set search_path = pg_catalog, public/
  );
  assert.match(migrationSource, /where decrypted\.name = 'jobs_tick_url'/);
  assert.match(migrationSource, /where decrypted\.name = 'jobs_tick_token'/);
  assert.match(migrationSource, /'Authorization', 'Bearer ' \|\| tick_token/);
  assert.match(migrationSource, /revoke all on function public\.enqueue_jobs_tick\(\)\s+from public, anon, authenticated, service_role;/);
  assert.match(
    migrationSource,
    /if not exists \(select 1 from cron\.job where jobname = 'bunker707-jobs-tick'\) then\s+perform cron\.schedule\(\s+'bunker707-jobs-tick',\s+'\* \* \* \* \*'/
  );
  assert.match(migrationSource, /vault\.create_secret\(/);
  assert.doesNotMatch(
    migrationSource,
    /vault\.create_secret\(\s*(?:--\s*)*'(?!<|https:\/\/<)/,
    "only placeholders may appear in vault.create_secret examples; secret values must never be committed"
  );
});

test("env example documents JOBS_TICK_TOKEN without a value", () => {
  assert.match(envExampleSource, /^JOBS_TICK_TOKEN=$/m);
});

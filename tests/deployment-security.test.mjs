import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const middlewareSource = await readFile(new URL("../middleware.ts", import.meta.url), "utf8");
const nextConfigSource = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
const supabaseConfigSource = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
const lessonExperienceSource = await readFile(new URL("../src/components/lesson-experience.tsx", import.meta.url), "utf8");
const lessonRouteSource = await readFile(new URL("../src/app/api/admin/lessons/route.ts", import.meta.url), "utf8");
const videoEmbedSource = await readFile(new URL("../src/lib/video-embed.ts", import.meta.url), "utf8");

test("application responses include baseline browser security headers", () => {
  for (const header of [
    "Cross-Origin-Opener-Policy",
    "Cross-Origin-Resource-Policy",
    "Permissions-Policy",
    "Referrer-Policy",
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "X-Frame-Options"
  ]) {
    assert.match(nextConfigSource, new RegExp(header));
  }
});

test("middleware issues a per-request nonce and an enforced CSP", () => {
  assert.match(middlewareSource, /const nonce = btoa\(crypto\.randomUUID\(\)\)/);
  assert.match(middlewareSource, /requestHeaders\.set\("x-nonce", nonce\)/);
  assert.match(middlewareSource, /Content-Security-Policy/);
  assert.match(middlewareSource, /frame-ancestors 'none'/);
  assert.match(middlewareSource, /object-src 'none'/);
  assert.match(middlewareSource, /script-src-attr 'none'/);
  assert.match(middlewareSource, /'strict-dynamic'/);
  assert.doesNotMatch(middlewareSource, /script-src[^\n]*'unsafe-inline'/);
});

test("closed member platform disables public signup by default", () => {
  const disabledSignupSettings = supabaseConfigSource.match(/enable_signup = false/g) ?? [];

  assert.ok(disabledSignupSettings.length >= 2);
  assert.match(supabaseConfigSource, /minimum_password_length = 8/);
  assert.match(supabaseConfigSource, /enable_anonymous_sign_ins = false/);
});

test("lesson embeds never execute producer HTML through srcDoc", () => {
  assert.doesNotMatch(lessonExperienceSource, /srcDoc=/);
  assert.match(lessonExperienceSource, /getSafeEmbedUrl/);
  assert.match(videoEmbedSource, /url\.protocol !== "https:"/);
  assert.match(videoEmbedSource, /url\.username \|\| url\.password/);
  assert.match(lessonRouteSource, /normalizeLessonVideoConfig\(payload\.video\)/);
  assert.match(lessonRouteSource, /Configuracao de video invalida/);
});

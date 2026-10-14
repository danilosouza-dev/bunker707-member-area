import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { sanitizeUrl, stripSensitiveUrlData } from "../src/components/analytics/posthog-privacy.ts";

const proxySource = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
const nextConfigSource = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
const supabaseConfigSource = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
const lessonExperienceSource = await readFile(new URL("../src/components/lesson-experience.tsx", import.meta.url), "utf8");
const contentActionsSource = await readFile(new URL("../src/server/catalog/content-actions.ts", import.meta.url), "utf8");
const videoEmbedSource = await readFile(new URL("../src/lib/video-embed.ts", import.meta.url), "utf8");
const postHogAnalyticsSource = await readFile(
  new URL("../src/components/analytics/posthog-analytics.tsx", import.meta.url),
  "utf8"
);

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

test("proxy issues a per-request nonce and an enforced CSP", () => {
  assert.match(proxySource, /const nonce = btoa\(crypto\.randomUUID\(\)\)/);
  assert.match(proxySource, /requestHeaders\.set\("x-nonce", nonce\)/);
  assert.match(proxySource, /Content-Security-Policy/);
  assert.match(proxySource, /frame-ancestors 'none'/);
  assert.match(proxySource, /object-src 'none'/);
  assert.match(proxySource, /script-src-attr 'none'/);
  assert.match(proxySource, /'strict-dynamic'/);
  assert.doesNotMatch(proxySource, /script-src[^\n]*'unsafe-inline'/);
});

test("proxy uses the Next 16 file convention and keeps protected pages behind login", async () => {
  await assert.rejects(access(new URL("../middleware.ts", import.meta.url)));
  assert.match(proxySource, /export async function proxy\(request: NextRequest\)/);
  assert.doesNotMatch(proxySource, /export (async )?function middleware/);
  assert.doesNotMatch(proxySource, /export const runtime/);
  const protectedPrefixes = proxySource.match(/const protectedPagePrefixes = \[([^\]]*)\]/)?.[1] ?? "";
  for (const prefix of [
    "/",
    "/admin",
    "/alterar-senha",
    "/conteudo",
    "/favoritos",
    "/minhas-compras",
    // Paginas da barra lateral do aluno (aluno v2).
    "/minha-jornada",
    "/continue-assistindo",
    "/materiais",
    "/suporte",
    "/perfil"
  ]) {
    assert.ok(protectedPrefixes.includes(`"${prefix}"`), `${prefix} must stay behind login`);
  }
  assert.match(proxySource, /if \(needsUser && !user\)[^}]*?return redirectToLogin\(request, contentSecurityPolicy\);/);
  assert.match(proxySource, /loginUrl\.pathname = "\/login"/);
  assert.match(proxySource, /export const config = \{[^}]*?matcher:/);
});

test("proxy validates the session with getUser by default and getClaims behind AUTH_SESSION_STRATEGY", () => {
  assert.match(proxySource, /getAuthSessionStrategy\(\) !== "claims"/);
  assert.match(proxySource, /supabase\.auth\.getUser\(\)/);
  assert.match(proxySource, /supabase\.auth\.getClaims\(\)/);
  assert.match(proxySource, /if \(userMustChangePassword\(claims\.user_metadata\)\)[^}]*?return getVerifiedUser\(supabase\);/);
  assert.doesNotMatch(proxySource, /auth\.getSession\(/);
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
  assert.match(contentActionsSource, /normalizeLessonVideoConfig\(detection\.config\)/);
});

test("PostHog autocapture never sends element text or attributes", () => {
  assert.match(postHogAnalyticsSource, /mask_all_text: true/);
  assert.match(postHogAnalyticsSource, /mask_all_element_attributes: true/);
  assert.match(postHogAnalyticsSource, /disable_session_recording: true/);
  assert.match(postHogAnalyticsSource, /before_send: stripSensitiveUrlData/);
});

test("PostHog URLs keep only origin, path and UTM parameters", () => {
  assert.equal(
    sanitizeUrl("https://aluno:senha@app.test/auth/callback?code=abc&next=%2Fadmin&utm_source=news#access_token=xyz"),
    "https://app.test/auth/callback?utm_source=news"
  );
  assert.equal(sanitizeUrl("/conteudo/curso?code=abc#access_token=xyz"), "/conteudo/curso");
  assert.equal(sanitizeUrl("mailto:aluna@example.com"), "mailto:");
  assert.equal(sanitizeUrl("tel:+5511999999999"), "tel:");
});

test("PostHog events drop secrets from page URLs, clicked links and heatmaps", () => {
  const secretUrl = "https://app.test/login?code=abc#access_token=xyz";
  const event = stripSensitiveUrlData({
    event: "$autocapture",
    properties: {
      $current_url: secretUrl,
      $elements: [
        { attr__href: "/conteudo/aula?code=abc#access_token=xyz", tag_name: "a" },
        { tag_name: "li" }
      ],
      $elements_chain:
        'a.link:attr__href="/conteudo/aula?code=abc"href="https://app.test/x?code=abc&utm_campaign=c"nth-child="1";li:nth-child="2"',
      $external_click_url: "https://externo.test/?email=aluna%40example.com",
      $heatmap_data: {
        "https://app.test/aula?code=1": [{ x: 1 }],
        "https://app.test/aula?code=2": [{ x: 2 }]
      }
    },
    $set: { $current_url: secretUrl },
    $set_once: { $initial_current_url: secretUrl, $initial_referrer: "$direct" },
    uuid: "00000000-0000-0000-0000-000000000000"
  });

  assert.equal(event.properties.$current_url, "https://app.test/login");
  assert.equal(event.properties.$elements[0].attr__href, "/conteudo/aula");
  assert.equal(event.properties.$elements[1].attr__href, undefined);
  assert.equal(
    event.properties.$elements_chain,
    'a.link:attr__href="/conteudo/aula"href="https://app.test/x?utm_campaign=c"nth-child="1";li:nth-child="2"'
  );
  assert.equal(event.properties.$external_click_url, "https://externo.test/");
  assert.deepEqual(event.properties.$heatmap_data, { "https://app.test/aula": [{ x: 1 }, { x: 2 }] });
  assert.equal(event.$set.$current_url, "https://app.test/login");
  assert.equal(event.$set_once.$initial_current_url, "https://app.test/login");
  assert.equal(event.$set_once.$initial_referrer, "$direct");
  assert.equal(stripSensitiveUrlData(null), null);
});

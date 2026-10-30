import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { sanitizeUrl, stripSensitiveUrlData } from "../src/components/analytics/posthog-privacy.ts";

// O app fica em src/app, e o Next 16 so compila o proxy que esta em src/ (rootDir = pai do app). O
// comportamento (307 de `/` anonima e CSP com nonce) e provado em tests/e2e/visitante-barrado-na-borda.spec.ts.
const proxySource = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
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

test("uma Permissions-Policy so para o app inteiro: camera, microfone e tela para a propria origem e o Jitsi proprio em toda pagina (de onde se chega a sala sem recarregar), geolocalizacao e pagamento bloqueados, nenhum terceiro", async () => {
  // next.config.ts importa ./src/lib/image-hosts sem extensao (como o Next resolve); aqui o Node precisa do ".ts".
  const { registerHooks } = await import("node:module");
  const configUrl = new URL("../next.config.ts", import.meta.url).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === configUrl && /^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }

      return nextResolve(specifier, context);
    }
  });
  const { createRequire } = await import("node:module");
  const { getPathMatch } = createRequire(import.meta.url)("next/dist/shared/lib/router/utils/path-match.js");
  const { default: nextConfig } = await import(configUrl);
  const rules = await nextConfig.headers();

  // Mesma regra do Next: todas as regras que casam com o caminho valem, e a ultima que define a chave vence.
  function effective(pathname, key) {
    let value;

    for (const rule of rules) {
      if (getPathMatch(rule.source)(pathname)) {
        value = rule.headers.find((header) => header.key === key)?.value ?? value;
      }
    }

    return value;
  }

  // O Chrome fixa a politica no carregamento do documento e a navegacao interna do Next nao carrega outro: a sala
  // aberta pelo Entrar da pagina da live, pela faixa "Ao vivo agora" de qualquer pagina, pelo sino ou pelo console a
  // partir do editor fica com a politica da pagina de onde a pessoa veio (docs/30 I10). Por isso a mesma politica vale
  // em toda pagina: na area do aluno, no login e no admin, inclusive nas salas.
  const { DEFAULT_MEET_DOMAIN, meetDomainOf } = await import("../src/lib/jitsi-room-config.ts");
  const meet = `https://${meetDomainOf(process.env.WEBINAR_MEET_DOMAIN) ?? DEFAULT_MEET_DOMAIN}`;
  const mediaList = `(self "${meet}")`;
  const paths = [
    "/",
    "/perfil",
    "/login",
    "/conteudo/teste-curso-agentes",
    "/administrar",
    "/webinario",
    "/webinarios",
    "/webinarios/aula-aberta",
    "/webinarios/aula-aberta/sala",
    "/admin",
    "/admin/comunicacao/avisos/novo",
    "/admin/comunicacao/avisos/0f8f7c2e-3b1a-4c55-9d7e-2a6b8c9d0e1f",
    "/admin/comunicacao/webinarios",
    "/admin/comunicacao/webinarios/0f8f7c2e-3b1a-4c55-9d7e-2a6b8c9d0e1f",
    "/admin/comunicacao/webinarios/0f8f7c2e-3b1a-4c55-9d7e-2a6b8c9d0e1f/sala"
  ];
  const first = effective(paths[0], "Permissions-Policy");
  for (const pathname of paths) {
    const policy = effective(pathname, "Permissions-Policy");
    assert.equal(policy, first, `${pathname}: a mesma politica em toda pagina`);
    const directives = Object.fromEntries(policy.split(", ").map((directive) => directive.split("=")));
    for (const feature of ["camera", "microphone", "display-capture"]) {
      assert.equal(directives[feature], mediaList, `${pathname}: ${feature} so para a propria origem e o Jitsi proprio`);
    }
    assert.equal(directives.geolocation, "()", pathname);
    assert.equal(directives.payment, "()", pathname);
    assert.ok(directives.fullscreen.includes(`"${meet}"`), `${pathname}: tela cheia do Jitsi`);
    assert.ok(!/jit\.si|youtube|vimeo|mediadelivery|bunny/.test([directives.camera, directives.microphone, directives["display-capture"]].join(" ")), `${pathname}: nenhum terceiro com camera ou microfone`);
    assert.equal(effective(pathname, "X-Frame-Options"), "DENY", pathname);
  }
  assert.equal(rules.filter((rule) => rule.headers.some((header) => header.key === "Permissions-Policy")).length, 1, "uma regra so: nenhuma pagina sobrescreve a politica");
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

test("proxy lives in src/ (the only place Next 16 compiles it with the app in src/app), uses the Next 16 file convention and keeps protected pages behind login", async () => {
  // Fora de src/ o Next ignora o arquivo em silencio: o resumo do build sai sem a linha "Proxy" e nem a
  // CSP nem o redirecionamento na borda existem (achado de 17/10/2026).
  for (const strayFile of ["../proxy.ts", "../middleware.ts", "../src/middleware.ts"]) {
    await assert.rejects(access(new URL(strayFile, import.meta.url)), `${strayFile} must not exist`);
  }
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
    "/perfil",
    // Webinarios (docs/30 §1.1).
    "/webinarios"
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

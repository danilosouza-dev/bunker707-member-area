import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { getAuthSessionStrategy } from "@/lib/auth/session-strategy";
import { cleanEnvValue } from "@/lib/env-value";
import { getSentryCspReportUri } from "@/lib/sentry-csp-report-uri";

const supabaseUrl = cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL) ?? cleanEnvValue(process.env.SUPABASE_URL);
const supabasePublicKey =
  cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ?? cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

const protectedPagePrefixes = [
  "/",
  "/admin",
  "/alterar-senha",
  "/conteudo",
  "/continue-assistindo",
  "/favoritos",
  "/materiais",
  "/minha-jornada",
  "/minhas-compras",
  "/perfil",
  "/suporte"
];
const publicPagePrefixes = ["/login", "/auth/callback"];

function getSupabaseConnectionSources() {
  if (!supabaseUrl) {
    return [];
  }

  try {
    const url = new URL(supabaseUrl);
    const websocketProtocol = url.protocol === "https:" ? "wss:" : "ws:";

    return [url.origin, `${websocketProtocol}//${url.host}`];
  } catch {
    return [];
  }
}

const defaultPostHogHost = "https://us.i.posthog.com";

function getHttpOrigin(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

// PostHog so entra na CSP com NEXT_PUBLIC_POSTHOG_KEY. O api_host recebe eventos e flags; nas regioes
// gerenciadas (us/eu) o host "-assets" entrega a configuracao remota e as extensoes do SDK.
function getPostHogSources() {
  const apiOrigin = process.env.NEXT_PUBLIC_POSTHOG_KEY
    ? getHttpOrigin(process.env.NEXT_PUBLIC_POSTHOG_HOST || defaultPostHogHost)
    : null;

  if (!apiOrigin) {
    return { connect: [], script: [] };
  }

  const region = /^https:\/\/(us|eu)\.i\.posthog\.com$/.exec(apiOrigin)?.[1];
  const assetsOrigin = region ? `https://${region}-assets.i.posthog.com` : apiOrigin;

  return { connect: [...new Set([apiOrigin, assetsOrigin])], script: [assetsOrigin] };
}

// Sentry so entra na CSP com NEXT_PUBLIC_SENTRY_DSN: o navegador envia eventos ao host de ingestao do DSN
// (ex.: https://o123.ingest.us.sentry.io); a chave publica do DSN nao faz parte da origem.
function getSentryConnectionSources() {
  const origin = getHttpOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN);

  return origin ? [origin] : [];
}

const postHogSources = getPostHogSources();
const observabilityConnectionSources = [...postHogSources.connect, ...getSentryConnectionSources()];
const observabilityScriptSources = postHogSources.script;
// Violacao de CSP so aparece no console do aluno; com o DSN do Sentry o navegador tambem a envia ao
// endpoint de seguranca do Sentry (`report-uri`), que a mostra como evento "CSP".
const sentryCspReportUri = getSentryCspReportUri(process.env.NEXT_PUBLIC_SENTRY_DSN);

// `upgrade-insecure-requests` so faz sentido numa pagina servida em https. Numa pagina http (next start
// na propria maquina, testes de ponta a ponta) o WebKit/Safari aplica a diretiva ate em 127.0.0.1 e busca
// scripts, CSS e fontes por https, o que deixa a pagina sem hidratar; o Chromium isenta a propria maquina.
function isHttpsRequest(request: NextRequest) {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();

  return forwardedProtocol ? forwardedProtocol === "https" : request.nextUrl.protocol === "https:";
}

function createContentSecurityPolicy(nonce: string, upgradeInsecureRequests: boolean) {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src 'self' ${[...getSupabaseConnectionSources(), ...observabilityConnectionSources].join(" ")}`.trim(),
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'self' https:",
    // https cobre o Storage da nuvem; a origem http entra so quando o Supabase e a propria maquina (testes).
    `img-src 'self' data: blob: https: ${getSupabaseConnectionSources().filter((source) => source.startsWith("http://")).join(" ")}`.trim(),
    "manifest-src 'self'",
    "media-src 'self' blob: https:",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${["https://www.youtube.com", ...observabilityScriptSources].join(" ")}${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:"
  ];

  if (upgradeInsecureRequests) {
    directives.push("upgrade-insecure-requests");
  }

  if (sentryCspReportUri) {
    directives.push(`report-uri ${sentryCspReportUri}`);
  }

  return directives.join("; ");
}

function secureResponse(response: NextResponse, contentSecurityPolicy: string, noStore = false) {
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);

  if (noStore) {
    response.headers.set("Cache-Control", "private, no-store");
  }

  return response;
}

function hasAuthConfig() {
  return Boolean(supabaseUrl && supabasePublicKey);
}

function isProtectedPage(pathname: string) {
  if (pathname.startsWith("/api")) {
    return false;
  }

  return protectedPagePrefixes.some((prefix) => (
    prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`)
  ));
}

function isPublicPage(pathname: string) {
  return publicPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function redirectToLogin(request: NextRequest, contentSecurityPolicy: string) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);

  if (!hasAuthConfig()) {
    loginUrl.searchParams.set("setup", "missing-auth");
  }

  return secureResponse(NextResponse.redirect(loginUrl), contentSecurityPolicy, true);
}

function userMustChangePassword(userMetadata: unknown) {
  const metadata = userMetadata as { must_change_password?: unknown } | null;

  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      metadata.must_change_password === true
  );
}

function redirectToPasswordChange(request: NextRequest, contentSecurityPolicy: string) {
  const passwordChangeUrl = request.nextUrl.clone();
  passwordChangeUrl.pathname = "/alterar-senha";
  passwordChangeUrl.search = "";
  passwordChangeUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return secureResponse(NextResponse.redirect(passwordChangeUrl), contentSecurityPolicy, true);
}

type ProxySessionUser = {
  id: string;
  user_metadata: unknown;
};

type ProxySupabaseClient = {
  auth: Pick<SupabaseClient["auth"], "getClaims" | "getUser">;
};

async function getVerifiedUser(supabase: ProxySupabaseClient): Promise<ProxySessionUser | null> {
  const { data, error } = await supabase.auth.getUser().catch(() => ({
    data: { user: null },
    error: new Error("Auth fetch failed")
  }));

  return error ? null : data.user;
}

// AUTH_SESSION_STRATEGY=claims troca getUser() por getClaims(): com signing keys assimetricas o JWT e
// validado localmente (JWKS em cache); sem elas o getClaims ainda consulta o Auth. Nunca use getSession() aqui.
async function getProxySessionUser(supabase: ProxySupabaseClient): Promise<ProxySessionUser | null> {
  if (getAuthSessionStrategy() !== "claims") {
    return getVerifiedUser(supabase);
  }

  const { data, error } = await supabase.auth.getClaims().catch(() => ({
    data: null,
    error: new Error("Auth claims failed")
  }));
  const claims = error ? null : data?.claims;

  if (!claims?.sub) {
    return null;
  }

  // O user_metadata do JWT so muda quando o token e renovado: confirma no Auth antes de exigir troca de senha.
  if (userMustChangePassword(claims.user_metadata)) {
    return getVerifiedUser(supabase);
  }

  return { id: claims.sub, user_metadata: claims.user_metadata ?? null };
}

export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const contentSecurityPolicy = createContentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "production" && isHttpsRequest(request)
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  requestHeaders.set("x-nonce", nonce);
  const pathname = request.nextUrl.pathname;
  const needsUser = isProtectedPage(pathname);
  const publicPage = isPublicPage(pathname);
  const authConfigured = hasAuthConfig();

  if (!authConfigured) {
    return needsUser
      ? redirectToLogin(request, contentSecurityPolicy)
      : secureResponse(NextResponse.next({ request: { headers: requestHeaders } }), contentSecurityPolicy);
  }

  let response = NextResponse.next({
    request: { headers: requestHeaders }
  });

  const supabase = createServerClient(supabaseUrl as string, supabasePublicKey as string, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, options, value }) => {
          response.cookies.set(name, value, options);
        });
      }
    }
  });

  const user = await getProxySessionUser(supabase);

  if (needsUser && !user) {
    return redirectToLogin(request, contentSecurityPolicy);
  }

  // Link com ?code= (convite, recuperacao de senha, magic link, OAuth) passa mesmo com sessao aberta:
  // /login e /auth/callback trocam o codigo pela sessao nova, em vez de o proxy mandar para a home.
  if (publicPage && user && !request.nextUrl.searchParams.has("code")) {
    const safeRedirectPath = getSafeRedirectPath(request.nextUrl.searchParams.get("next"));

    if (userMustChangePassword(user.user_metadata)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/alterar-senha";
      redirectUrl.search = "";
      redirectUrl.searchParams.set("next", safeRedirectPath);
      return secureResponse(NextResponse.redirect(redirectUrl), contentSecurityPolicy, true);
    }

    let adminRoleResult: { data: { role?: unknown } | null } = { data: null };

    if (safeRedirectPath !== "/alterar-senha") {
      try {
        adminRoleResult = await supabase
          .from("admin_roles")
          .select("role")
          .eq("user_id", user.id)
          .maybeSingle();
      } catch {
        adminRoleResult = { data: null };
      }
    }

    // Pelo parser de URL, nunca por `pathname =`: o destino pode ter query (?lessonId=), e o setter de
    // pathname codificaria o "?" como %3F, quebrando o link. getSafeRedirectPath ja garante que e um
    // caminho interno (uma barra so, sem barra invertida), entao a origem continua a do proprio site.
    const redirectTarget = adminRoleResult.data?.role ? "/admin" : safeRedirectPath;
    return secureResponse(
      NextResponse.redirect(new URL(redirectTarget, request.nextUrl.origin)),
      contentSecurityPolicy,
      true
    );
  }

  if (needsUser && user && pathname !== "/alterar-senha" && userMustChangePassword(user.user_metadata)) {
    return redirectToPasswordChange(request, contentSecurityPolicy);
  }

  return secureResponse(response, contentSecurityPolicy, needsUser || publicPage);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml)$).*)"
  ]
};

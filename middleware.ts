import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSafeRedirectPath } from "@/lib/auth/redirect";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const supabasePublicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const protectedPagePrefixes = ["/", "/admin", "/alterar-senha", "/conteudo", "/favoritos", "/minhas-compras"];
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

function createContentSecurityPolicy(nonce: string) {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src 'self' ${getSupabaseConnectionSources().join(" ")}`.trim(),
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'self' https:",
    "img-src 'self' data: blob: https:",
    "manifest-src 'self'",
    "media-src 'self' blob: https:",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://www.youtube.com${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:"
  ];

  if (process.env.NODE_ENV === "production") {
    directives.push("upgrade-insecure-requests");
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

export async function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const contentSecurityPolicy = createContentSecurityPolicy(nonce);
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

  const { data, error } = await supabase.auth.getUser().catch(() => ({
    data: { user: null },
    error: new Error("Auth fetch failed")
  }));
  const user = error ? null : data.user;

  if (needsUser && !user) {
    return redirectToLogin(request, contentSecurityPolicy);
  }

  if (publicPage && user) {
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

    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = adminRoleResult.data?.role ? "/admin" : safeRedirectPath;
    redirectUrl.search = "";
    return secureResponse(NextResponse.redirect(redirectUrl), contentSecurityPolicy, true);
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

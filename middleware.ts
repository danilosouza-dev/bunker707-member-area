import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  isLocalAuthEnabled,
  localAuthCookieName,
  localAuthCookieValue
} from "@/lib/auth/local";
import { getSafeRedirectPath } from "@/lib/auth/redirect";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const supabasePublicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const protectedPagePrefixes = ["/", "/admin", "/alterar-senha", "/conteudo", "/favoritos", "/minhas-compras"];
const publicPagePrefixes = ["/login", "/auth/callback"];

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

function redirectToLogin(request: NextRequest) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);

  if (!hasAuthConfig()) {
    loginUrl.searchParams.set("setup", "missing-auth");
  }

  return NextResponse.redirect(loginUrl);
}

function userMustChangePassword(userMetadata: unknown) {
  const metadata = userMetadata as { must_change_password?: unknown } | null;

  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      metadata.must_change_password === true
  );
}

function redirectToPasswordChange(request: NextRequest) {
  const passwordChangeUrl = request.nextUrl.clone();
  passwordChangeUrl.pathname = "/alterar-senha";
  passwordChangeUrl.search = "";
  passwordChangeUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(passwordChangeUrl);
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const needsUser = isProtectedPage(pathname);
  const publicPage = isPublicPage(pathname);

  if (!hasAuthConfig()) {
    const localAuthEnabled = isLocalAuthEnabled(false, request.nextUrl.hostname);
    const hasLocalSession = localAuthEnabled &&
      request.cookies.get(localAuthCookieName)?.value === localAuthCookieValue;

    if (publicPage && hasLocalSession) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = getSafeRedirectPath(request.nextUrl.searchParams.get("next"));
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }

    if (needsUser && hasLocalSession) {
      return NextResponse.next();
    }

    return needsUser ? redirectToLogin(request) : NextResponse.next();
  }

  let response = NextResponse.next({
    request
  });

  const supabase = createServerClient(supabaseUrl as string, supabasePublicKey as string, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, options, value }) => {
          response.cookies.set(name, value, options);
        });
      }
    }
  });

  const { data, error } = await supabase.auth.getUser();
  const user = error ? null : data.user;

  if (needsUser && !user) {
    return redirectToLogin(request);
  }

  if (publicPage && user) {
    const safeRedirectPath = getSafeRedirectPath(request.nextUrl.searchParams.get("next"));

    if (userMustChangePassword(user.user_metadata)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/alterar-senha";
      redirectUrl.search = "";
      redirectUrl.searchParams.set("next", safeRedirectPath);
      return NextResponse.redirect(redirectUrl);
    }

    const adminRoleResult = safeRedirectPath === "/alterar-senha"
      ? { data: null }
      : await supabase
        .from("admin_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = adminRoleResult.data?.role ? "/admin" : safeRedirectPath;
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  if (needsUser && user && pathname !== "/alterar-senha" && userMustChangePassword(user.user_metadata)) {
    return redirectToPasswordChange(request);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml)$).*)"
  ]
};

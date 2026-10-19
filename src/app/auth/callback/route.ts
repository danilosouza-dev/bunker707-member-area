import { NextResponse, type NextRequest } from "next/server";
import { AUTH_LINK_ERROR_PARAM, authCallbackErrorValue } from "@/lib/auth/password-reset";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { getPostAuthRedirectPath } from "@/server/auth/redirect";
import { getHeadersOrigin } from "@/server/auth/site-origin";
import { createSupabaseServerClient } from "@/server/auth/supabase";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const provider = requestUrl.searchParams.get("provider") ?? "oauth";
  const redirectPath = getSafeRedirectPath(requestUrl.searchParams.get("next"));
  // Origem pelos cabecalhos (Host/X-Forwarded-Host): no servidor proprio o request.url do Next vem com o
  // endereco interno do container (0.0.0.0:3000), e o redirecionamento sairia do site.
  const origin = await getHeadersOrigin();
  const redirectUrl = new URL(redirectPath, origin);
  // O Supabase volta com ?error=&error_code= (ex.: otp_expired) quando o link do e-mail ja expirou.
  const linkRejected = requestUrl.searchParams.has("error") || requestUrl.searchParams.has("error_code");

  if (!code) {
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", redirectPath);

    if (linkRejected) {
      redirectUrl.searchParams.set(AUTH_LINK_ERROR_PARAM, authCallbackErrorValue(provider));
    }

    return NextResponse.redirect(redirectUrl);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Link de e-mail ja usado, expirado ou aberto em outro navegador (o codigo de verificacao fica no
    // navegador que pediu o link), ou login social que nao concluiu: o login explica o que fazer.
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", redirectPath);
    redirectUrl.searchParams.set(AUTH_LINK_ERROR_PARAM, authCallbackErrorValue(provider));
    return NextResponse.redirect(redirectUrl);
  }

  const { data } = await supabase.auth.getUser();

  if (data.user) {
    await supabase.from("student_events").insert({
      entity_type: "auth",
      event_type: "user_signed_in",
      metadata: {
        method: provider,
        source: "oauth_callback"
      },
      user_id: data.user.id
    });

    return NextResponse.redirect(new URL(await getPostAuthRedirectPath(data.user, redirectPath), origin));
  }

  return NextResponse.redirect(redirectUrl);
}

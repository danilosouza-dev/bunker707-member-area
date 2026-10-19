import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_LINK_ERROR_PARAM, AUTH_LINK_ERROR_VALUE } from "@/lib/auth/password-reset";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { getPostAuthRedirectPath } from "@/server/auth/redirect";
import { getHeadersOrigin } from "@/server/auth/site-origin";
import { createSupabaseServerClient } from "@/server/auth/supabase";

// Links de e-mail do Auth com ?token_hash= (modelos de infra/compose/volumes/auth-templates): o servidor
// confirma com verifyOtp e grava a sessao nos cookies. Nao depende do navegador que pediu o link (o codigo
// PKCE do /auth/callback fica la) nem do #access_token do fluxo implicito, que o servidor nao ve e o cliente
// PKCE recusa: era assim que o convite caia no login sem sessao (docs/06).
const emailOtpTypes: ReadonlySet<string> = new Set<EmailOtpType>(["invite", "recovery", "magiclink", "email", "signup", "email_change"]);
// Convite e recuperacao terminam em definir a senha.
const setPasswordTypes: ReadonlySet<string> = new Set<EmailOtpType>(["invite", "recovery"]);

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const redirectPath = getSafeRedirectPath(requestUrl.searchParams.get("next"));
  // Origem pelos cabecalhos: no servidor proprio o request.url vem com o endereco interno (0.0.0.0:3000).
  const origin = await getHeadersOrigin();

  if (tokenHash && type && emailOtpTypes.has(type)) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });

    if (!error && data.user) {
      await supabase.from("student_events").insert({
        entity_type: "auth",
        event_type: "user_signed_in",
        metadata: {
          method: "email",
          source: `email_link_${type}`
        },
        user_id: data.user.id
      });

      if (setPasswordTypes.has(type)) {
        const passwordUrl = new URL("/alterar-senha", origin);
        passwordUrl.searchParams.set("next", redirectPath);
        return NextResponse.redirect(passwordUrl);
      }

      return NextResponse.redirect(new URL(await getPostAuthRedirectPath(data.user, redirectPath), origin));
    }
  }

  // Link expirado, ja usado ou incompleto: o login explica e oferece "Esqueci minha senha".
  const loginUrl = new URL("/login", origin);
  loginUrl.searchParams.set("next", redirectPath);
  loginUrl.searchParams.set(AUTH_LINK_ERROR_PARAM, AUTH_LINK_ERROR_VALUE);
  return NextResponse.redirect(loginUrl);
}

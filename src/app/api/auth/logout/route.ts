import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasSupabaseAuthConfig } from "@/server/auth/config";
import { createSupabaseServerClient } from "@/server/auth/supabase";

const legacyLocalAuthCookieName = "bunker707_local_session";
// Cookies de sessao do @supabase/ssr: sb-<ref>-auth-token, fatiados em .0, .1...
// quando grandes, e o verificador PKCE do fluxo OAuth.
const supabaseAuthCookiePattern = /^sb-.+-auth-token(?:-code-verifier)?(?:\.\d+)?$/;

export async function POST() {
  if (hasSupabaseAuthConfig()) {
    try {
      // signOut no servidor revoga o refresh token e remove os cookies de sessao
      // pelo adaptador de cookies do @supabase/ssr; o navegador nao precisa do supabase-js.
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut();
    } catch {
      // Mesmo com o Auth indisponivel, os cookies sao expirados abaixo.
    }
  }

  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === "production";
  const response = NextResponse.json({ ok: true }, {
    headers: {
      "Cache-Control": "no-store"
    }
  });

  response.cookies.set(legacyLocalAuthCookieName, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure
  });

  // Rede de seguranca: se o signOut falhar antes de limpar a sessao local
  // (rede, Auth fora do ar), os cookies de sessao expiram mesmo assim.
  for (const { name } of cookieStore.getAll()) {
    if (supabaseAuthCookiePattern.test(name)) {
      response.cookies.set(name, "", {
        maxAge: 0,
        path: "/",
        sameSite: "lax",
        secure
      });
    }
  }

  return response;
}

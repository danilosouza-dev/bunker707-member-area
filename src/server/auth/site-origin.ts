import "server-only";

import { headers } from "next/headers";

// Origem publica do site para links que saem em e-mail (convite, redefinir senha). Preferimos a
// variavel NEXT_PUBLIC_SITE_URL; sem ela, os cabecalhos do pedido (Vercel/Coolify atras de proxy).
// O Supabase so redireciona para URLs da lista permitida, entao um Host forjado nao leva a lugar algum.

export async function getRequestOrigin() {
  return getConfiguredSiteOrigin() ?? getHeadersOrigin();
}

/** NEXT_PUBLIC_SITE_URL sem a barra final, ou null quando nao esta definida. */
export function getConfiguredSiteOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  return configured ? configured.replace(/\/+$/, "") : null;
}

/** Origem do pedido atual pelos cabecalhos (ignora NEXT_PUBLIC_SITE_URL): a pagina que o navegador abriu. */
export async function getHeadersOrigin() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  if (!host) {
    return "http://localhost:3000";
  }

  const protocol = requestHeaders.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https");

  return `${protocol}://${host}`;
}

/** Para onde o e-mail de acesso traz o aluno: callback de login e, em seguida, criar a senha. */
export async function getAccessEmailRedirectTo() {
  const url = new URL("/auth/callback", await getRequestOrigin());
  url.searchParams.set("next", "/alterar-senha");
  url.searchParams.set("provider", "email");

  return url.toString();
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginExperience } from "@/components/login-experience";
import { readAuthLinkError } from "@/lib/auth/password-reset";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { hasSupabaseAuthConfig } from "@/server/auth/config";
import { getPostAuthRedirectPath } from "@/server/auth/redirect";
import { getAuthenticatedUser } from "@/server/auth/session";
import { getLoginPageConfigForRequest } from "@/server/member-area/login-queries";

export const metadata: Metadata = {
  title: "Entrar | Bunker707",
  description: "Login da área de membros Bunker707"
};

// O visual vem do que o produtor publicou em Área de membros > Login (platform_settings.loginPage,
// em cache). A escolha de modelo pelo endereco (?template=) deixou de valer: a previa fica no admin.
type LoginPageProps = {
  searchParams?: Promise<{
    code?: string | string[];
    erro?: string | string[];
    next?: string | string[];
    provider?: string | string[];
    setup?: string | string[];
    type?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = await searchParams;
  const nextParam = Array.isArray(resolvedSearchParams?.next)
    ? resolvedSearchParams.next[0]
    : resolvedSearchParams?.next;
  const codeParam = Array.isArray(resolvedSearchParams?.code)
    ? resolvedSearchParams.code[0]
    : resolvedSearchParams?.code;
  const providerParam = Array.isArray(resolvedSearchParams?.provider)
    ? resolvedSearchParams.provider[0]
    : resolvedSearchParams?.provider;
  const typeParam = Array.isArray(resolvedSearchParams?.type)
    ? resolvedSearchParams.type[0]
    : resolvedSearchParams?.type;
  const redirectTo = getSafeRedirectPath(nextParam ?? (typeParam ? "/alterar-senha" : undefined));

  if (codeParam) {
    const callbackSearchParams = new URLSearchParams({
      code: codeParam,
      next: redirectTo,
      provider: providerParam ?? "email"
    });

    redirect(`/auth/callback?${callbackSearchParams.toString()}`);
  }

  const authConfigured = hasSupabaseAuthConfig();
  const user = await getAuthenticatedUser();

  if (user) {
    redirect(await getPostAuthRedirectPath(user, redirectTo));
  }

  const config = await getLoginPageConfigForRequest();

  return (
    <LoginExperience
      authConfigured={authConfigured}
      config={config}
      initialErrorMessage={readAuthLinkError(resolvedSearchParams?.erro)}
      redirectTo={redirectTo}
    />
  );
}

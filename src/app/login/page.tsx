import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginExperience } from "@/components/login-experience";
import { isLocalAuthEnabled } from "@/lib/auth/local";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { getLoginPageConfig } from "@/lib/login-config";
import { hasSupabaseAuthConfig } from "@/server/auth/config";
import { getPostAuthRedirectPath } from "@/server/auth/redirect";
import { getAuthenticatedUser } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Entrar | Bunker707",
  description: "Login da area de membros Bunker707"
};

type LoginPageProps = {
  searchParams?: Promise<{
    code?: string | string[];
    next?: string | string[];
    provider?: string | string[];
    setup?: string | string[];
    template?: string | string[];
    type?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = await searchParams;
  const templateParam = Array.isArray(resolvedSearchParams?.template)
    ? resolvedSearchParams.template[0]
    : resolvedSearchParams?.template;
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
  const headerStore = await headers();
  const hostname = headerStore.get("host")?.split(":")[0] ?? null;
  const localAuthEnabled = isLocalAuthEnabled(authConfigured, hostname);
  const user = await getAuthenticatedUser();

  if (user) {
    redirect(await getPostAuthRedirectPath(user, redirectTo));
  }

  const config = getLoginPageConfig(templateParam);

  return (
    <LoginExperience
      authConfigured={authConfigured}
      config={config}
      localAuthEnabled={localAuthEnabled}
      redirectTo={redirectTo}
    />
  );
}

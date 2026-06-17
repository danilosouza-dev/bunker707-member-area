import type { Metadata } from "next";
import { PasswordChangeExperience } from "@/components/password-change-experience";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { hasSupabaseAuthConfig } from "@/server/auth/config";
import { requirePageUser } from "@/server/auth/guards";

export const metadata: Metadata = {
  title: "Definir senha | Bunker707",
  description: "Definicao de senha da area de membros Bunker707"
};

type PasswordChangePageProps = {
  searchParams?: Promise<{
    next?: string | string[];
  }>;
};

export default async function PasswordChangePage({ searchParams }: PasswordChangePageProps) {
  const resolvedSearchParams = await searchParams;
  const nextParam = Array.isArray(resolvedSearchParams?.next)
    ? resolvedSearchParams.next[0]
    : resolvedSearchParams?.next;
  const nextPath = getSafeRedirectPath(nextParam);
  const user = await requirePageUser("/alterar-senha");
  const mustChangePassword = user.user_metadata?.must_change_password === true;

  return (
    <PasswordChangeExperience
      authConfigured={hasSupabaseAuthConfig()}
      email={user.email}
      nextPath={nextPath}
      requiresPasswordChange={mustChangePassword}
    />
  );
}

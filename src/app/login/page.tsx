import type { Metadata } from "next";
import { LoginExperience } from "@/components/login-experience";
import { getLoginPageConfig } from "@/lib/login-config";

export const metadata: Metadata = {
  title: "Entrar | Bunker707",
  description: "Login da area de membros Bunker707"
};

type LoginPageProps = {
  searchParams?: Promise<{
    template?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = await searchParams;
  const templateParam = Array.isArray(resolvedSearchParams?.template)
    ? resolvedSearchParams.template[0]
    : resolvedSearchParams?.template;
  const config = getLoginPageConfig(templateParam);

  return <LoginExperience config={config} />;
}

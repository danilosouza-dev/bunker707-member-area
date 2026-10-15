import type { Metadata } from "next";
import { ErrorBanner } from "@/components/admin/v2/error-banner";
import { LoginEditor } from "@/components/admin/v2/member-area/login/login-editor";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { getLoginEditorData } from "@/server/member-area/login-queries";

export const metadata: Metadata = {
  title: "Login"
};

async function loadLoginPage() {
  try {
    return { data: await getLoginEditorData(), ok: true as const };
  } catch (error) {
    console.error("[admin/area-de-membros/login]", error);
    return { ok: false as const };
  }
}

export default async function AdminLoginPage() {
  const { access } = await requirePageArea("membros");
  const result = await loadLoginPage();

  if (!result.ok) {
    return (
      <ErrorBanner title="Não foi possível carregar a página de login">
        Recarregue a página em instantes. Se continuar, confira a conexão com o banco de dados.
      </ErrorBanner>
    );
  }

  return <LoginEditor canEdit={can(access, "storefront.write")} data={result.data} />;
}

import type { Metadata } from "next";
import { ErrorBanner } from "@/components/admin/v2/error-banner";
import { LoginEditor } from "@/components/admin/v2/member-area/login/login-editor";
import { requirePageAdmin } from "@/server/auth/guards";
import { canRole } from "@/server/auth/roles";
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
  const { role } = await requirePageAdmin();
  const result = await loadLoginPage();

  if (!result.ok) {
    return (
      <ErrorBanner title="Não foi possível carregar a página de login">
        Recarregue a página em instantes. Se continuar, confira a conexão com o banco de dados.
      </ErrorBanner>
    );
  }

  return <LoginEditor canEdit={canRole(role, "storefront.write")} data={result.data} />;
}

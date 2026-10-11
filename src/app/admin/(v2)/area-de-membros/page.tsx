import type { Metadata } from "next";
import { ErrorBanner } from "@/components/admin/v2/error-banner";
import { VitrineEditor } from "@/components/admin/v2/storefront/vitrine-editor";
import { requirePageAdmin } from "@/server/auth/guards";
import { canRole } from "@/server/auth/roles";
import { getStorefrontEditorData } from "@/server/storefront/queries";

export const metadata: Metadata = {
  title: "Vitrine"
};

async function loadStorefront() {
  try {
    return { data: await getStorefrontEditorData(), ok: true as const };
  } catch (error) {
    console.error("[admin/area-de-membros] vitrine", error);
    return { ok: false as const };
  }
}

export default async function AdminStorefrontPage() {
  const { role } = await requirePageAdmin();
  const result = await loadStorefront();

  if (!result.ok) {
    return (
      <ErrorBanner title="Não foi possível carregar a vitrine">
        Recarregue a página em instantes. Se continuar, confira a conexão com o banco de dados.
      </ErrorBanner>
    );
  }

  return <VitrineEditor canEdit={canRole(role, "storefront.write")} data={result.data} />;
}

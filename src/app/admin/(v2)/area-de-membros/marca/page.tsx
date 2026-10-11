import type { Metadata } from "next";
import { ErrorBanner } from "@/components/admin/v2/error-banner";
import { BrandEditor } from "@/components/admin/v2/storefront/brand-editor";
import { requirePageAdmin } from "@/server/auth/guards";
import { canRole } from "@/server/auth/roles";
import { getStorefrontBrand } from "@/server/storefront/queries";

export const metadata: Metadata = {
  title: "Marca"
};

async function loadBrand() {
  try {
    return { brand: await getStorefrontBrand(), ok: true as const };
  } catch (error) {
    console.error("[admin/area-de-membros/marca]", error);
    return { ok: false as const };
  }
}

export default async function AdminBrandPage() {
  const { role } = await requirePageAdmin();
  const result = await loadBrand();

  if (!result.ok) {
    return (
      <ErrorBanner title="Não foi possível carregar a marca">
        Recarregue a página em instantes. Se continuar, confira a conexão com o banco de dados.
      </ErrorBanner>
    );
  }

  return <BrandEditor brand={result.brand} canEdit={canRole(role, "storefront.write")} />;
}

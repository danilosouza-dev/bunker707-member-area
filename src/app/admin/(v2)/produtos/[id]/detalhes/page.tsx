import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductDetailsForm } from "@/components/admin/v2/products/details-form";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { requirePageAdmin } from "@/server/auth/guards";
import { canRole } from "@/server/auth/roles";
import { getProductDetails } from "@/server/catalog/queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import type { HomeModuleRowState } from "@/server/member-area/modules-model";
import { getHomeModuleRowState } from "@/server/member-area/modules-queries";

export const metadata: Metadata = {
  title: "Detalhes do produto"
};

type ProductDetailsPageProps = {
  params: Promise<{ id: string }>;
};

/** Fileira de modulos na home (Vitrine). Falhou: a secao some, a aba continua. */
async function loadHomeModuleRow(productId: string): Promise<HomeModuleRowState | null> {
  try {
    return await getHomeModuleRowState(productId);
  } catch (error) {
    console.error("[admin/produtos/detalhes] fileira de modulos na home", error);
    return null;
  }
}

// Aba Detalhes (docs/17 §1.6.5). O cabecalho e as permissoes vem do layout do produto.
export default async function ProductDetailsPage({ params }: ProductDetailsPageProps) {
  const { role } = await requirePageAdmin();
  const { id } = await params;
  const [loaded, homeModuleRow] = await Promise.all([
    loadUnlessPendingMigration(() => getProductDetails(id)),
    loadHomeModuleRow(id)
  ]);

  if (!loaded.ok) {
    return <PendingMigrationNotice />;
  }

  const details = loaded.data;

  if (!details) {
    notFound();
  }

  return (
    <ProductDetailsForm
      canWriteStorefront={canRole(role, "storefront.write")}
      details={details}
      homeModuleRow={homeModuleRow}
    />
  );
}

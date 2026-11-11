import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ProductAccessForm } from "@/components/admin/v2/products/access-form";
import { LicenseProductCard } from "@/components/admin/v2/products/license-product-card";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { requireProductPage } from "@/server/auth/permissions";
import { canSeeProductAccess } from "@/server/auth/roles";
import { getProductAccess } from "@/server/catalog/queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { readLicenseProductCard } from "@/server/licensing/interno/admin-queries";

export const metadata: Metadata = {
  title: "Acesso e venda"
};

type ProductAccessPageProps = {
  params: Promise<{ id: string }>;
};

// Aba Acesso e venda (docs/17 §1.6.5). O cabecalho e as permissoes vem do layout do produto. Na nossa escola, com a API
// interna do Emissor configurada, o dono ve tambem o cartao "Bunker Members" (docs/32 §11.10): a marca do produto cuja
// venda vira Licenca. Sem a configuracao (o produto vendido, a dev), nada muda nesta aba.
export default async function ProductAccessPage({ params }: ProductAccessPageProps) {
  const { id } = await params;
  const session = await requireProductPage(id);

  if (!canSeeProductAccess(session.access)) {
    redirect(`/admin/produtos/${encodeURIComponent(id)}`);
  }

  const [loaded, licenseCard] = await Promise.all([loadUnlessPendingMigration(() => getProductAccess(id)), readLicenseProductCard(id, session.access)]);

  if (!loaded.ok) {
    return <PendingMigrationNotice />;
  }

  const access = loaded.data;

  if (!access) {
    notFound();
  }

  if (!licenseCard) {
    return <ProductAccessForm access={access} />;
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <ProductAccessForm access={access} />
      <LicenseProductCard {...licenseCard} />
    </div>
  );
}

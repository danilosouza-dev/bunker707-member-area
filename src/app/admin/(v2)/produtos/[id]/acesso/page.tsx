import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductAccessForm } from "@/components/admin/v2/products/access-form";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { requirePageAdmin } from "@/server/auth/guards";
import { getProductAccess } from "@/server/catalog/queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

export const metadata: Metadata = {
  title: "Acesso e venda"
};

type ProductAccessPageProps = {
  params: Promise<{ id: string }>;
};

// Aba Acesso e venda (docs/17 §1.6.5). O cabecalho e as permissoes vem do layout do produto.
export default async function ProductAccessPage({ params }: ProductAccessPageProps) {
  await requirePageAdmin();
  const { id } = await params;
  const loaded = await loadUnlessPendingMigration(() => getProductAccess(id));

  if (!loaded.ok) {
    return <PendingMigrationNotice />;
  }

  const access = loaded.data;

  if (!access) {
    notFound();
  }

  return (
    <ProductAccessForm access={access} />
  );
}

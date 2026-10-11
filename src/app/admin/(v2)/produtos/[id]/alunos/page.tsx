import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { ProductStudentsView } from "@/components/admin/v2/products/product-students-view";
import { requirePageAdmin } from "@/server/auth/guards";
import { getProductAccess } from "@/server/catalog/queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

export const metadata: Metadata = {
  title: "Alunos do produto"
};

type ProductStudentsPageProps = {
  params: Promise<{ id: string }>;
};

// Aba Alunos (docs/17 §1.6.5). A lista por produto chega com a nova tela de Alunos; ate la mostramos
// o numero real de acessos ativos, a tabela vazia com as colunas da tela futura e o caminho para o
// admin antigo, que ainda libera acessos.
export default async function ProductStudentsPage({ params }: ProductStudentsPageProps) {
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
    <ProductStudentsView audience={access.audience} productId={id} studentsWithAccess={access.studentsWithAccess} />
  );
}

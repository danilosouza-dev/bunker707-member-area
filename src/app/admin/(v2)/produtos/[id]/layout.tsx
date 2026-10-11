import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { ProductHeaderBar } from "@/components/admin/v2/products/product-header";
import { ProductNotFound } from "@/components/admin/v2/products/product-not-found";
import { ProductWorkspaceProvider } from "@/components/admin/v2/products/product-workspace";
import { ProductWorkspaceSkeleton } from "@/components/admin/v2/products/skeletons";
import { requirePageAdmin } from "@/server/auth/guards";
import { canRole, type AdminRole } from "@/server/auth/roles";
import { getProductHeader } from "@/server/catalog/queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

type ProductLayoutProps = {
  children: ReactNode;
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  await requirePageAdmin();
  const { id } = await params;
  const loaded = await loadUnlessPendingMigration(() => getProductHeader(id));

  if (!loaded.ok) {
    return { title: "Produto" };
  }

  return { title: loaded.data ? loaded.data.title : "Produto não encontrado" };
}

async function ProductWorkspace({ children, id, role }: { children: ReactNode; id: string; role: AdminRole }) {
  const loaded = await loadUnlessPendingMigration(() => getProductHeader(id));

  // Banco sem as migracoes da fase 1: o aviso substitui cabecalho e abas (as abas nao sao renderizadas).
  if (!loaded.ok) {
    return <PendingMigrationNotice />;
  }

  const header = loaded.data;

  if (!header) {
    return <ProductNotFound />;
  }

  return (
    <ProductWorkspaceProvider
      capabilities={{
        canDelete: canRole(role, "catalog.delete"),
        canPublish: canRole(role, "catalog.publish"),
        canWrite: canRole(role, "catalog.write")
      }}
      header={header}
    >
      <ProductHeaderBar />
      <div className="min-w-0">{children}</div>
    </ProductWorkspaceProvider>
  );
}

// Pagina do produto (docs/17 §1.6.3): cabecalho fixo + abas com endereco proprio. O layout so
// renderiza {children} (sem slots paralelos). O cabecalho carrega dentro de um Suspense proprio,
// para a troca de aba nunca mostrar o skeleton da lista de produtos. O corpo de cada aba fica a 20 px
// das abas, como no prototipo aprovado.
export default async function ProductLayout({ children, params }: ProductLayoutProps) {
  const { role } = await requirePageAdmin();
  const { id } = await params;

  return (
    <AdminPage className="gap-5">
      <Suspense fallback={<ProductWorkspaceSkeleton />}>
        <ProductWorkspace id={id} role={role}>
          {children}
        </ProductWorkspace>
      </Suspense>
    </AdminPage>
  );
}

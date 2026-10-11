import type { Metadata } from "next";
import { buildProductListDemo } from "@/components/admin/v2/today/today-demo";
import { isAdminDemoEnabled } from "@/server/admin/demo";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { ProductListView } from "@/components/admin/v2/products/product-list-view";
import { requirePageAdmin } from "@/server/auth/guards";
import { canRole } from "@/server/auth/roles";
import { listProducts } from "@/server/catalog/queries";
import { parseProductListSearchParams } from "@/server/catalog/schemas";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

export const metadata: Metadata = {
  title: "Produtos"
};

type AdminProductsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Hora da leitura, para o "Atualizado há..." (renderizado no servidor). */
function readTime() {
  return new Date();
}

// Lista de produtos (docs/17 §1.6.1): filtros no endereco, 25 por pagina, linha inteira abre o produto.
// Esta pagina so le; a disposicao fica em ProductListView.
export default async function AdminProductsPage({ searchParams }: AdminProductsPageProps) {
  const { role } = await requirePageAdmin();
  const query = parseProductListSearchParams(await searchParams);
  const loaded = await loadUnlessPendingMigration(() => listProducts(query));

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader title="Produtos" />
        <PendingMigrationNotice />
      </AdminPage>
    );
  }

  // So no localhost com ADMIN_DEMO_DATA=on: numeros simulados nas colunas que dependem de alunos.
  const list = isAdminDemoEnabled()
    ? {
        ...loaded.data,
        items: loaded.data.items.map((item) =>
          item.situation === "draft" ? item : { ...item, ...buildProductListDemo(item.id) }
        )
      }
    : loaded.data;

  return (
    <AdminPage className="gap-6">
      <ProductListView canWrite={canRole(role, "catalog.write")} list={list} now={readTime()} />
    </AdminPage>
  );
}

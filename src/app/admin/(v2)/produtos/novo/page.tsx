import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { NewProductView } from "@/components/admin/v2/products/new-product-view";
import { requirePageAdmin } from "@/server/auth/guards";
import { canRole } from "@/server/auth/roles";
import { assertCatalogSchemaReady, getProductHeader } from "@/server/catalog/queries";
import { catalogIdSchema } from "@/server/catalog/schemas";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

export const metadata: Metadata = {
  title: "Novo produto"
};

type NewProductPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** ?formacao=<id> ("Criar curso aqui"): so vale se o id for de uma Formação existente. */
async function readParentFormation(raw: string | undefined) {
  const parsed = catalogIdSchema.safeParse(raw ?? "");

  if (!parsed.success) {
    return null;
  }

  const header = await getProductHeader(parsed.data);

  return header?.format === "formacao" ? { id: header.id, title: header.title } : null;
}

// Novo produto em uma pagina (docs/17 §1.6.2). Sem permissao de editar o catalogo, volta para a lista.
export default async function NewProductPage({ searchParams }: NewProductPageProps) {
  const { role } = await requirePageAdmin();

  if (!canRole(role, "catalog.write")) {
    redirect("/admin/produtos");
  }

  const formationParam = firstParam((await searchParams).formacao);
  const loaded = await loadUnlessPendingMigration(async () => {
    await assertCatalogSchemaReady();
    return readParentFormation(formationParam);
  });

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader breadcrumb={[{ href: "/admin/produtos", label: "Produtos" }, { label: "Novo produto" }]} title="Novo produto" />
        <PendingMigrationNotice />
      </AdminPage>
    );
  }

  return (
    <AdminPage className="gap-6">
      <NewProductView parentFormation={loaded.data} />
    </AdminPage>
  );
}

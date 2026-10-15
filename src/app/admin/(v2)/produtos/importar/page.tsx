import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { PlaylistImport } from "@/components/admin/v2/products/playlist-import";
import { requirePageAdmin } from "@/server/auth/guards";
import { can } from "@/server/auth/roles";
import { assertCatalogSchemaReady } from "@/server/catalog/queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

export const metadata: Metadata = {
  title: "Importar do YouTube"
};

const IMPORT_BREADCRUMB = [{ href: "/admin/produtos", label: "Produtos" }, { label: "Importar" }];

// Importar (docs/17 §1.6.7), aba Playlist do YouTube. Sem permissao de editar o catalogo, volta para a lista.
export default async function ImportProductsPage() {
  const { access } = await requirePageAdmin();

  if (!can(access, "catalog.write")) {
    redirect("/admin/produtos");
  }

  const ready = await loadUnlessPendingMigration(() => assertCatalogSchemaReady());

  if (!ready.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader breadcrumb={IMPORT_BREADCRUMB} title="Importar do YouTube" />
        <PendingMigrationNotice />
      </AdminPage>
    );
  }

  return (
    <AdminPage className="gap-6">
      <PageHeader
        breadcrumb={IMPORT_BREADCRUMB}
        description="Cole o link de uma playlist. Cada vídeo vira uma aula e o produto nasce em rascunho."
        title="Importar do YouTube"
      />
      <PlaylistImport />
    </AdminPage>
  );
}

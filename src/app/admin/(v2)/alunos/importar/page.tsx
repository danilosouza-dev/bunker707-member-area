import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { todayInputValue } from "@/components/admin/v2/students/format";
import { studentListHref } from "@/components/admin/v2/students/hrefs";
import { ImportStudentsView } from "@/components/admin/v2/students/import-students-view";
import { requirePageAdmin } from "@/server/auth/guards";
import { can } from "@/server/auth/roles";
import { listProductOptions } from "@/server/catalog/queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { listCohorts } from "@/server/students/queries";

// Lotes de importacao e de acoes em massa com e-mail rodam dentro das Server Actions desta rota.
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Importar alunos"
};

/** Hora da leitura (renderizado no servidor): minimo do campo de data. */
function readNow() {
  return Date.now();
}

// Importar CSV (docs/17 §1.7.2). Sem permissao de liberar acesso, volta para a lista.
export default async function ImportStudentsPage() {
  const { access } = await requirePageAdmin();

  if (!can(access, "students.access")) {
    redirect(studentListHref());
  }

  const loaded = await loadUnlessPendingMigration(async () => {
    const [products, cohorts] = await Promise.all([listProductOptions(), listCohorts()]);

    return { cohorts, products };
  });

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader title="Importar alunos" />
        <PendingMigrationNotice />
      </AdminPage>
    );
  }

  return (
    <AdminPage className="gap-6">
      <PageHeader
        breadcrumb={[{ href: studentListHref(), label: "Alunos" }, { label: "Importar CSV" }]}
        description="Suba a planilha, confira as colunas e a prévia, escolha como entregar o acesso e importe em lotes."
        title="Importar alunos"
      />
      <ImportStudentsView
        cohorts={loaded.data.cohorts}
        products={loaded.data.products.map((product) => ({ id: product.id, title: product.title }))}
        today={todayInputValue(readNow())}
      />
    </AdminPage>
  );
}

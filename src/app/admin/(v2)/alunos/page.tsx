import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { StudentListView } from "@/components/admin/v2/students/student-list-view";
import { requirePageAdmin } from "@/server/auth/guards";
import { canRole } from "@/server/auth/roles";
import { listProductOptions } from "@/server/catalog/queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { listStudents } from "@/server/students/queries";
import { parseStudentListSearchParams } from "@/server/students/schemas";

export const metadata: Metadata = {
  title: "Alunos"
};

type AdminStudentsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Lista de alunos (docs/17 §1.7.1): filtros no endereco, 25 por pagina, linha inteira abre o perfil.
// Esta pagina so le; a disposicao fica em StudentListView.
/** Hora da leitura (renderizado no servidor): ritmo, "há 3 dias" e minimo das datas. */
function readNow() {
  return Date.now();
}

export default async function AdminStudentsPage({ searchParams }: AdminStudentsPageProps) {
  const { role } = await requirePageAdmin();
  const query = parseStudentListSearchParams(await searchParams);
  const loaded = await loadUnlessPendingMigration(async () => {
    const [list, products] = await Promise.all([listStudents(query), listProductOptions()]);

    return { list, products };
  });

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader title="Alunos" />
        <PendingMigrationNotice />
      </AdminPage>
    );
  }

  return (
    <AdminPage className="gap-6">
      <StudentListView
        canAdd={canRole(role, "students.access")}
        filters={{ page: query.page, pace: query.pace, productId: query.productId, q: query.q }}
        list={loaded.data.list}
        now={readNow()}
        products={loaded.data.products.map((product) => ({ id: product.id, title: product.title }))}
      />
    </AdminPage>
  );
}

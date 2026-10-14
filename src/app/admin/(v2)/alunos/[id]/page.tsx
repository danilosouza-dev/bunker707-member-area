import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { studentListHref, type StudentProfileTab } from "@/components/admin/v2/students/hrefs";
import { StudentProfileView } from "@/components/admin/v2/students/student-profile-view";
import { requirePageRole } from "@/server/auth/permissions";
import { canRole } from "@/server/auth/roles";
import { listProductOptions } from "@/server/catalog/queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { getStudentDetail, listCohorts } from "@/server/students/queries";
import { userIdSchema } from "@/server/students/schemas";

export const metadata: Metadata = {
  title: "Aluno"
};

type StudentPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readTab(value: string | string[] | undefined): StudentProfileTab {
  const tab = Array.isArray(value) ? value[0] : value;

  return tab === "progresso" || tab === "historico" ? tab : "acessos";
}

// Perfil do aluno (docs/17 §1.7.3). Id invalido ou aluno inexistente = 404.
/** Hora da leitura (renderizado no servidor): ritmo, "há 3 dias" e minimo das datas. */
function readNow() {
  return Date.now();
}

export default async function StudentPage({ params, searchParams }: StudentPageProps) {
  const { role } = await requirePageRole("students.read_basic", "/admin");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const idCheck = userIdSchema.safeParse(id);

  if (!idCheck.success) {
    notFound();
  }

  const loaded = await loadUnlessPendingMigration(async () => {
    const [detail, products, cohorts] = await Promise.all([getStudentDetail(idCheck.data), listProductOptions(), listCohorts()]);

    return { cohorts, detail, products };
  });

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader breadcrumb={[{ href: studentListHref(), label: "Alunos" }, { label: "Aluno" }]} title="Aluno" />
        <PendingMigrationNotice />
      </AdminPage>
    );
  }

  if (!loaded.data.detail) {
    notFound();
  }

  return (
    <AdminPage className="gap-6">
      <StudentProfileView
        cohorts={loaded.data.cohorts}
        detail={loaded.data.detail}
        now={readNow()}
        permissions={{
          canAccess: canRole(role, "students.access"),
          canDelete: canRole(role, "students.delete"),
          canSeePersonal: canRole(role, "students.read_personal")
        }}
        products={loaded.data.products}
        tab={readTab(query.aba)}
      />
    </AdminPage>
  );
}

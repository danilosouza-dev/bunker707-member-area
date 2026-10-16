import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { StudentListView } from "@/components/admin/v2/students/student-list-view";
import { requirePageRole } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { listProductOptions } from "@/server/catalog/queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { STUDENT_SEGMENT_PRESETS, pickStudentListParams, splitStudentListParams } from "@/server/students/model";
import { countStudentSegments, getLifecycleSummary, listCohorts, listSavedSegments, listStudents } from "@/server/students/queries";
import { parseStudentListSearchParams } from "@/server/students/schemas";

// Lotes de importacao e de acoes em massa com e-mail rodam dentro das Server Actions desta rota.
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Alunos"
};

type AdminStudentsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Hora da leitura (renderizado no servidor): ritmo, "há 3 dias" e minimo das datas. */
function readNow() {
  return Date.now();
}

// Lista de alunos (docs/17 §1.7.1): filtros e segmentos no endereco, 25 por pagina, linha abre o
// perfil. So quem le dados basicos de alunos entra (analista volta para o Hoje). Esta pagina so le; a
// disposicao fica em StudentListView.
export default async function AdminStudentsPage({ searchParams }: AdminStudentsPageProps) {
  const { access } = await requirePageRole("students.read_basic", "/admin");
  const query = parseStudentListSearchParams(await searchParams);
  const params = pickStudentListParams(query);
  const { base } = splitStudentListParams(params);
  const loaded = await loadUnlessPendingMigration(async () => {
    const [list, products, savedSegments, cohorts, lifecycle] = await Promise.all([
      listStudents(query),
      listProductOptions(),
      listSavedSegments(),
      listCohorts(),
      getLifecycleSummary().catch((error: unknown) => {
        console.error("[alunos] ciclo de vida indisponivel:", error instanceof Error ? error.message : String(error));
        return null;
      })
    ]);
    // Pilulas contam dentro do produto, da turma e da busca atuais; salvos contam os proprios filtros.
    const segmentCounts = await countStudentSegments([
      ...STUDENT_SEGMENT_PRESETS.map((preset) => ({ id: preset.id, params: { ...base, ...preset.params } })),
      ...savedSegments.map((saved) => ({ id: saved.id, params: saved.params }))
    ]);

    return { cohorts, lifecycle, list, products, savedSegments, segmentCounts };
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
    <AdminPage className="gap-6 pb-24">
      <StudentListView
        canAccess={can(access, "students.access")}
        canAdd={can(access, "students.access")}
        canExport={can(access, "students.export")}
        cohorts={loaded.data.cohorts}
        filters={{ ...params, page: query.page }}
        lifecycle={loaded.data.lifecycle}
        list={loaded.data.list}
        now={readNow()}
        pickerProducts={loaded.data.products}
        products={loaded.data.products.map((product) => ({ id: product.id, title: product.title }))}
        savedSegments={loaded.data.savedSegments}
        segmentCounts={loaded.data.segmentCounts}
      />
    </AdminPage>
  );
}

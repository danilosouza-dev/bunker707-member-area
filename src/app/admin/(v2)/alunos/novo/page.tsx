import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { studentListHref } from "@/components/admin/v2/students/hrefs";
import { todayInputValue } from "@/components/admin/v2/students/format";
import { NewStudentForm } from "@/components/admin/v2/students/new-student-form";
import { requirePageAdmin } from "@/server/auth/guards";
import { canRole } from "@/server/auth/roles";
import { listProductOptions } from "@/server/catalog/queries";
import { catalogIdSchema } from "@/server/catalog/schemas";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

export const metadata: Metadata = {
  title: "Adicionar aluno"
};

type NewStudentPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// Adicionar aluno (docs/17 §1.7.2). Sem permissao de liberar acesso, volta para a lista.
/** Hora da leitura (renderizado no servidor): ritmo, "há 3 dias" e minimo das datas. */
function readNow() {
  return Date.now();
}

export default async function NewStudentPage({ searchParams }: NewStudentPageProps) {
  const { role } = await requirePageAdmin();

  if (!canRole(role, "students.access")) {
    redirect(studentListHref());
  }

  const productParam = catalogIdSchema.safeParse(firstParam((await searchParams).produto) ?? "");
  const loaded = await loadUnlessPendingMigration(() => listProductOptions());

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader title="Adicionar aluno" />
        <PendingMigrationNotice />
      </AdminPage>
    );
  }

  const products = loaded.data;
  const preselected = productParam.success && products.some((product) => product.id === productParam.data) ? productParam.data : null;

  return (
    <AdminPage className="gap-6">
      <PageHeader
        breadcrumb={[{ href: studentListHref(), label: "Alunos" }, { label: "Adicionar aluno" }]}
        description="Nome e e-mail bastam. Marque os produtos e escolha como o aluno recebe o acesso."
        title="Adicionar aluno"
      />
      <NewStudentForm preselectedProductId={preselected} products={products} today={todayInputValue(readNow())} />
    </AdminPage>
  );
}

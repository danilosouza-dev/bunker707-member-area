import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { ProductStudentsView } from "@/components/admin/v2/products/product-students-view";
import { requirePageRole } from "@/server/auth/permissions";
import { canRole } from "@/server/auth/roles";
import { getProductAccess } from "@/server/catalog/queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { listStudents } from "@/server/students/queries";
import { STUDENT_LIST_PAGE_SIZE } from "@/server/students/schemas";

export const metadata: Metadata = {
  title: "Alunos do produto"
};

type ProductStudentsPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readPage(value: string | string[] | undefined) {
  const parsed = Number.parseInt((Array.isArray(value) ? value[0] : value) ?? "1", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

// Aba Alunos (docs/17 §1.6.5): quem ve este produto agora, com progresso nele; liberar e adicionar.
/** Hora da leitura (renderizado no servidor): ritmo, "há 3 dias" e minimo das datas. */
function readNow() {
  return Date.now();
}

export default async function ProductStudentsPage({ params, searchParams }: ProductStudentsPageProps) {
  const { role } = await requirePageRole("students.read_basic", "/admin");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const loaded = await loadUnlessPendingMigration(async () => {
    const access = await getProductAccess(id);

    if (!access) {
      return null;
    }

    const list = await listStudents({ page: readPage(query.pagina), pageSize: STUDENT_LIST_PAGE_SIZE, productId: id });

    return { access, list };
  });

  if (!loaded.ok) {
    return <PendingMigrationNotice />;
  }

  if (!loaded.data) {
    notFound();
  }

  return (
    <ProductStudentsView
      audience={loaded.data.access.audience}
      canAccess={canRole(role, "students.access")}
      list={loaded.data.list}
      now={readNow()}
      productId={id}
      productTitle={loaded.data.access.header.title}
    />
  );
}

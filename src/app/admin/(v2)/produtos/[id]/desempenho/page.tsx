import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readAdminPeriod } from "@/components/admin/v2/period";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import {
  buildCourseFunnelRows,
  buildLessonPerformanceRows,
  buildModuleFunnelRows,
  describeLessonTableMeta,
  describePerformanceBase
} from "@/components/admin/v2/products/performance-model";
import { ProductPerformanceView } from "@/components/admin/v2/products/product-performance-view";
import { requirePageAdmin } from "@/server/auth/guards";
import { getProductAccess, getProductContent } from "@/server/catalog/queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

export const metadata: Metadata = {
  title: "Desempenho do produto"
};

type ProductPerformancePageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Aba Desempenho (docs/17 §1.6.5) na moldura do prototipo aprovado. Le so o que existe: modulos e
// aulas do produto (com a situacao de cada aula) e quantos alunos tem acesso. Sem registro de aulas
// assistidas ainda, os numeros de estudo ficam em "—" (nenhum numero de exemplo). O periodo da barra
// superior (?periodo=) aparece no titulo da tabela por aula.
export default async function ProductPerformancePage({ params, searchParams }: ProductPerformancePageProps) {
  await requirePageAdmin();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const period = readAdminPeriod(query, new Date());
  const loaded = await loadUnlessPendingMigration(() => Promise.all([getProductContent(id), getProductAccess(id)]));

  if (!loaded.ok) {
    return <PendingMigrationNotice />;
  }

  const [content, access] = loaded.data;

  if (!content || !access) {
    notFound();
  }

  const formation = content.formationCourses !== null;

  return (
    <ProductPerformanceView
      accent={content.header.accent}
      baseLabel={describePerformanceBase(access.audience, access.studentsWithAccess)}
      formation={formation}
      funnel={formation ? buildCourseFunnelRows(content.formationCourses ?? []) : buildModuleFunnelRows(content.modules)}
      lessonTableMeta={describeLessonTableMeta(period.label)}
      lessons={formation ? [] : buildLessonPerformanceRows(content.modules)}
    />
  );
}

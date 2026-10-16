import { notFound } from "next/navigation";
import { ContentTab } from "@/components/admin/v2/content/content-tab";
import { FormationCourses } from "@/components/admin/v2/content/formation-courses";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { requireProductPage } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { getLessonEditorData, getProductContent, listProductOptions } from "@/server/catalog/queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

type ProductContentPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Aba Conteudo do produto (docs/17 §1.6.3, §1.6.4 e §1.6.9). O cabecalho e as abas vem do layout.
// Painel da aula = ?aula=<lessonId> (endereco proprio; voltar fecha). Formação mostra a lista de
// cursos no lugar da arvore de modulos.
export default async function ProductContentPage({ params, searchParams }: ProductContentPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { access } = await requireProductPage(id);
  const lessonId = readLessonParam(query.aula);
  // Modulos e aulas: catalog.content (o Professor tambem, nos cursos dele). Cursos da formacao: catalog.access.
  const canEditContent = can(access, "catalog.content");
  const canWrite = can(access, "catalog.access");
  const loaded = await loadUnlessPendingMigration(() =>
    Promise.all([getProductContent(id), lessonId ? getLessonEditorData(id, lessonId) : Promise.resolve(null)])
  );

  if (!loaded.ok) {
    return <PendingMigrationNotice />;
  }

  const [content, editor] = loaded.data;

  if (!content) {
    notFound();
  }

  if (content.formationCourses) {
    const options = canWrite ? await listProductOptions({ formats: ["curso"] }) : [];

    return (
      <FormationCourses
        canWrite={canWrite}
        courses={content.formationCourses}
        formationId={content.header.id}
        options={options.filter((option) => option.id !== content.header.id)}
      />
    );
  }

  return (
    <ContentTab
      canWrite={canEditContent}
      editor={editor}
      initialModules={content.modules}
      productId={content.header.id}
      productTitle={content.header.title}
      requestedLessonId={lessonId}
      situation={content.header.situation}
      studentPreviewHref={content.header.studentPreviewHref}
    />
  );
}

/** ?aula= aceita so um identificador simples; lixo e ignorado (o painel nao abre). */
function readLessonParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;

  return raw && /^[A-Za-z0-9_-]{1,240}$/.test(raw) ? raw : null;
}

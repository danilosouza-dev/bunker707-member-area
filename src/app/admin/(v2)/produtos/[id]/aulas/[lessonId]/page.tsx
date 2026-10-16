import { redirect } from "next/navigation";
import { requireProductPage } from "@/server/auth/permissions";

type LessonAddressProps = {
  params: Promise<{ id: string; lessonId: string }>;
};

// Endereco antigo/compartilhavel de uma aula: o painel vive na aba Conteudo, em ?aula=<id>
// (plano da fase 1, decisao 11). So redireciona, depois de conferir o acesso ao admin.
export default async function ProductLessonAddressPage({ params }: LessonAddressProps) {
  const { id, lessonId } = await params;
  await requireProductPage(id);

  redirect(`/admin/produtos/${encodeURIComponent(id)}?aula=${encodeURIComponent(lessonId)}`);
}

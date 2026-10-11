import { redirect } from "next/navigation";
import { requirePageAdmin } from "@/server/auth/guards";

type LessonAddressProps = {
  params: Promise<{ id: string; lessonId: string }>;
};

// Endereco antigo/compartilhavel de uma aula: o painel vive na aba Conteudo, em ?aula=<id>
// (plano da fase 1, decisao 11). So redireciona, depois de conferir o acesso ao admin.
export default async function ProductLessonAddressPage({ params }: LessonAddressProps) {
  await requirePageAdmin();
  const { id, lessonId } = await params;

  redirect(`/admin/produtos/${encodeURIComponent(id)}?aula=${encodeURIComponent(lessonId)}`);
}

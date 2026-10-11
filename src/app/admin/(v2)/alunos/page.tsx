import type { Metadata } from "next";
import { StudentsFrame } from "@/components/admin/v2/frames/students-frame";
import { legacyStudentSearchHref } from "@/lib/admin-legacy-links";
import { requirePageAdmin } from "@/server/auth/guards";

export const metadata: Metadata = {
  title: "Alunos"
};

type AdminStudentsPageProps = {
  searchParams?: Promise<{ busca?: string | string[] }>;
};

// Alunos (docs/17 §1.7): a nova lista ainda esta sendo construida. A moldura segue o prototipo
// aprovado (cabecalho, ciclo de vida e numeros da semana vazios) e leva ao admin antigo.
export default async function AdminStudentsPage({ searchParams }: AdminStudentsPageProps) {
  await requirePageAdmin();
  const params = await searchParams;
  const search = Array.isArray(params?.busca) ? params.busca[0] : params?.busca;

  // Lista de alunos do admin antigo; com ?busca= (links da Comunidade e salvos), ja filtrada.
  return (
    <StudentsFrame data-phase={2} legacyHref={legacyStudentSearchHref(search ?? "")} />
  );
}

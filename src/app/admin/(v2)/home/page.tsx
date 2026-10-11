import { redirect } from "next/navigation";
import { requirePageAdmin } from "@/server/auth/guards";

// "Home do aluno" (fase 0) virou a area "Área de membros". O endereco antigo continua valendo
// para links salvos e cai na Vitrine.
export default async function AdminStudentHomeRedirect() {
  await requirePageAdmin();
  redirect("/admin/area-de-membros");
}

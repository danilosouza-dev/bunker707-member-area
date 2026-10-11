import { AdminDashboard } from "@/components/admin-dashboard";
import { readLegacyAdminParams } from "@/lib/admin-legacy-links";
import { getAdminDashboardData } from "@/server/db/platform-store";
import { requirePageAdmin } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

type AdminLegacyPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminPage({ searchParams }: AdminLegacyPageProps) {
  await requirePageAdmin();
  const [data, params] = await Promise.all([getAdminDashboardData(), searchParams]);
  // ?tela=alunos&busca=Nome: "Ver aluno" do admin novo abre a lista de alunos ja filtrada.
  const { initialStudentQuery, initialView } = readLegacyAdminParams(params);

  return <AdminDashboard initialData={data} initialStudentQuery={initialStudentQuery} initialView={initialView} />;
}

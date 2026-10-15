import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { TEAM_PATH } from "@/components/admin/v2/team/hrefs";
import { TeamMemberForm } from "@/components/admin/v2/team/team-member-form";
import { requirePageRole } from "@/server/auth/permissions";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { listTeamCourseOptions } from "@/server/team/queries";

export const metadata: Metadata = {
  title: "Adicionar pessoa"
};

const breadcrumb = [
  { href: "/admin/configuracoes", label: "Configurações" },
  { href: TEAM_PATH, label: "Equipe" },
  { label: "Adicionar pessoa" }
];

// Adicionar alguem a equipe (docs/17 §2.3): e-mail e funcao. Professor pede os cursos; Personalizado,
// as permissoes. So o dono.
export default async function NewTeamMemberPage() {
  await requirePageRole("settings.team", "/admin/configuracoes");
  const loaded = await loadUnlessPendingMigration(() => listTeamCourseOptions());

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader breadcrumb={breadcrumb} title="Adicionar pessoa" />
        <PendingMigrationNotice />
      </AdminPage>
    );
  }

  return (
    <AdminPage className="gap-6">
      <PageHeader
        breadcrumb={breadcrumb}
        description="E-mail e função bastam. Professor pede os cursos; Personalizado, o que a pessoa pode fazer."
        title="Adicionar pessoa"
      />
      <TeamMemberForm courses={loaded.data} />
    </AdminPage>
  );
}

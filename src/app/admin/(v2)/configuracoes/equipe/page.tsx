import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { AdminLinkButton } from "@/components/admin/v2/link-button";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { NEW_TEAM_MEMBER_PATH } from "@/components/admin/v2/team/hrefs";
import { RolesOverview } from "@/components/admin/v2/team/roles-overview";
import { TeamMemberList } from "@/components/admin/v2/team/team-member-list";
import { requirePageRole } from "@/server/auth/permissions";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { listTeamCourseOptions, listTeamMembers } from "@/server/team/queries";

export const metadata: Metadata = {
  title: "Equipe"
};

/** Hora da leitura (renderizado no servidor), para o "Último acesso". */
function readNow() {
  return Date.now();
}

// Configuracoes > Equipe (docs/17 §2.3): so o dono ve e muda. Lista de quem entra no admin, com a
// funcao de cada pessoa, e o resumo do que cada funcao faz.
export default async function TeamPage() {
  const { user } = await requirePageRole("settings.team", "/admin/configuracoes");
  const loaded = await loadUnlessPendingMigration(() => Promise.all([listTeamMembers(), listTeamCourseOptions()]));
  const header = (
    <PageHeader
      actions={
        <AdminLinkButton className="gap-1.5" href={NEW_TEAM_MEMBER_PATH}>
          <Plus aria-hidden="true" className="size-4" />
          Adicionar pessoa
        </AdminLinkButton>
      }
      breadcrumb={[{ href: "/admin/configuracoes", label: "Configurações" }, { label: "Equipe" }]}
      description="Quem entra no admin e o que cada pessoa pode fazer. Cada uma usa a própria conta."
      title="Equipe"
    />
  );

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        {header}
        <PendingMigrationNotice />
      </AdminPage>
    );
  }

  const [members, courses] = loaded.data;
  const courseTitles = Object.fromEntries(courses.map((course) => [course.id, course.title]));

  return (
    <AdminPage>
      <div className="flex min-w-0 flex-col gap-6">
        {header}
        <TeamMemberList courseTitles={courseTitles} currentUserId={user.id} members={members} now={readNow()} />
      </div>
      <RolesOverview />
    </AdminPage>
  );
}

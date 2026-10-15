import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { AdminLinkButton } from "@/components/admin/v2/link-button";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { NEW_TEAM_MEMBER_PATH } from "@/components/admin/v2/team/hrefs";
import { TeamMemberList } from "@/components/admin/v2/team/team-member-list";
import { TeamTabs } from "@/components/admin/v2/team/team-tabs";
import { requirePageRole } from "@/server/auth/permissions";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { functionDefinitions, memberGrantsOf } from "@/server/team/model";
import { listTeamFunctions, listTeamMembers } from "@/server/team/queries";

export const metadata: Metadata = {
  title: "Equipe"
};

/** Hora da leitura (renderizado no servidor), para o "Último acesso". */
function readNow() {
  return Date.now();
}

// Configuracoes > Equipe > Pessoas (docs/17 §2.3): so o dono ve e muda. Quem entra no admin, as
// funcoes de cada pessoa e o que ela alcanca.
export default async function TeamPage() {
  const { user } = await requirePageRole("settings.team", "/admin/configuracoes");
  const loaded = await loadUnlessPendingMigration(() => Promise.all([listTeamMembers(), listTeamFunctions()]));
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

  const [members, { functions }] = loaded.data;
  const definitions = functionDefinitions(functions);
  const rows = members.map((member) => ({ ...member, grants: memberGrantsOf(member, definitions) }));

  return (
    <AdminPage className="gap-6">
      {header}
      <TeamTabs functionCount={functions.length} memberCount={members.length} />
      <TeamMemberList currentUserId={user.id} customFunctions={functions} members={rows} now={readNow()} />
    </AdminPage>
  );
}

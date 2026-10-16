import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { AdminLinkButton } from "@/components/admin/v2/link-button";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { NEW_TEAM_FUNCTION_PATH, TEAM_PATH } from "@/components/admin/v2/team/hrefs";
import { TeamFunctionsList } from "@/components/admin/v2/team/team-functions-list";
import { TeamTabs } from "@/components/admin/v2/team/team-tabs";
import { requirePageRole } from "@/server/auth/permissions";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { TEAM_FUNCTIONS_MIGRATION, listTeamFunctions, listTeamMembers } from "@/server/team/queries";

export const metadata: Metadata = {
  title: "Funções da equipe"
};

// Configuracoes > Equipe > Funcoes (docs/17 §2.3): as funcoes personalizadas do dono (pacotes de
// permissoes com nome) e as prontas, que podem ser duplicadas e ajustadas. So o dono.
export default async function TeamFunctionsPage() {
  await requirePageRole("settings.team", "/admin/configuracoes");
  const loaded = await loadUnlessPendingMigration(() => Promise.all([listTeamFunctions(), listTeamMembers()]));
  const ready = loaded.ok && loaded.data[0].ready;
  const header = (
    <PageHeader
      actions={
        ready ? (
          <AdminLinkButton className="gap-1.5" href={NEW_TEAM_FUNCTION_PATH}>
            <Plus aria-hidden="true" className="size-4" />
            Nova função
          </AdminLinkButton>
        ) : null
      }
      breadcrumb={[
        { href: "/admin/configuracoes", label: "Configurações" },
        { href: TEAM_PATH, label: "Equipe" },
        { label: "Funções" }
      ]}
      description="Pacotes de permissões com nome. Cada pessoa pode ter uma ou mais funções."
      title="Equipe"
    />
  );

  // Sem a tabela admin_functions (loaded.ok, ready false), o aviso cita so a migracao dela; sem as
  // migracoes da equipe inteira (loaded.ok false), o aviso geral.
  if (!loaded.ok || !ready) {
    return (
      <AdminPage className="gap-6">
        {header}
        <TeamTabs />
        <PendingMigrationNotice migration={loaded.ok ? TEAM_FUNCTIONS_MIGRATION : undefined} />
      </AdminPage>
    );
  }

  const [{ functions }, members] = loaded.data;

  return (
    <AdminPage className="gap-6">
      {header}
      <TeamTabs functionCount={functions.length} memberCount={members.length} />
      <TeamFunctionsList customFunctions={functions} />
    </AdminPage>
  );
}

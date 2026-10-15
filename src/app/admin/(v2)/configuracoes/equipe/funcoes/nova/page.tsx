import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { TEAM_FUNCTIONS_PATH, TEAM_PATH } from "@/components/admin/v2/team/hrefs";
import { TeamFunctionForm } from "@/components/admin/v2/team/team-function-form";
import { requirePageRole } from "@/server/auth/permissions";
import { ADMIN_ROLE_LABELS, isCombinablePreset } from "@/server/auth/roles";
import { presetSelection } from "@/server/team/model";

export const metadata: Metadata = {
  title: "Nova função"
};

type NewTeamFunctionPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const breadcrumb = [
  { href: "/admin/configuracoes", label: "Configurações" },
  { href: TEAM_PATH, label: "Equipe" },
  { href: TEAM_FUNCTIONS_PATH, label: "Funções" },
  { label: "Nova função" }
];

// Nova funcao personalizada (docs/17 §2.3). ?a_partir_de=<funcao pronta> comeca com as permissoes dela
// ("Duplicar e ajustar"). So o dono.
export default async function NewTeamFunctionPage({ searchParams }: NewTeamFunctionPageProps) {
  await requirePageRole("settings.team", "/admin/configuracoes");
  const source = (await searchParams).a_partir_de;
  const preset = typeof source === "string" && isCombinablePreset(source) ? source : null;
  const initial = preset ? { grants: [...presetSelection(preset)], name: `${ADMIN_ROLE_LABELS[preset]} (cópia)` } : undefined;

  return (
    <AdminPage className="gap-6">
      <PageHeader
        breadcrumb={breadcrumb}
        description="Dê um nome, junte funções prontas e marque o que mais quiser. Depois é só escolher a função na pessoa."
        title="Nova função"
      />
      <TeamFunctionForm initial={initial} />
    </AdminPage>
  );
}

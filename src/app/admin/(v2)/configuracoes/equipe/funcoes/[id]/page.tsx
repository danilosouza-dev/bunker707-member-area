import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import { z } from "zod";
import { EmptyState } from "@/components/admin/v2/empty-state";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { TEAM_FUNCTIONS_PATH, TEAM_PATH } from "@/components/admin/v2/team/hrefs";
import { TeamFunctionForm } from "@/components/admin/v2/team/team-function-form";
import { requirePageRole } from "@/server/auth/permissions";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { TEAM_FUNCTIONS_MIGRATION, listTeamFunctions } from "@/server/team/queries";

export const metadata: Metadata = {
  title: "Função da equipe"
};

type TeamFunctionPageProps = {
  params: Promise<{ id: string }>;
};

const functionIdSchema = z.uuid();

function breadcrumbFor(label: string) {
  return [
    { href: "/admin/configuracoes", label: "Configurações" },
    { href: TEAM_PATH, label: "Equipe" },
    { href: TEAM_FUNCTIONS_PATH, label: "Funções" },
    { label }
  ];
}

// Uma funcao personalizada (docs/17 §2.3): nome, descricao, permissoes, quantas pessoas a tem e
// excluir (so quando ninguem tem). So o dono.
export default async function TeamFunctionPage({ params }: TeamFunctionPageProps) {
  await requirePageRole("settings.team", "/admin/configuracoes");
  const { id } = await params;
  const valid = functionIdSchema.safeParse(id).success;
  const loaded = valid ? await loadUnlessPendingMigration(() => listTeamFunctions()) : null;

  if (loaded && (!loaded.ok || !loaded.data.ready)) {
    return (
      <AdminPage className="gap-6">
        <PageHeader breadcrumb={breadcrumbFor("Função")} title="Função da equipe" />
        <PendingMigrationNotice migration={loaded.ok ? TEAM_FUNCTIONS_MIGRATION : undefined} />
      </AdminPage>
    );
  }

  const fn = loaded?.ok ? loaded.data.functions.find((item) => item.id === id) : undefined;

  if (!fn) {
    return (
      <AdminPage className="gap-6">
        <PageHeader breadcrumb={breadcrumbFor("Função")} title="Função da equipe" />
        <EmptyState
          action={{ href: TEAM_FUNCTIONS_PATH, label: "Voltar para as funções" }}
          description="Ela pode ter sido excluída agora há pouco."
          icon={SearchX}
          title="Essa função não existe mais"
        />
      </AdminPage>
    );
  }

  return (
    <AdminPage className="gap-6">
      <PageHeader breadcrumb={breadcrumbFor(fn.name)} description={fn.description || undefined} title={fn.name} />
      <TeamFunctionForm
        fn={{
          actions: fn.actions,
          description: fn.description,
          id: fn.id,
          memberCount: fn.memberCount ?? 0,
          name: fn.name,
          scopedActions: fn.scopedActions,
          updatedAt: fn.updatedAt
        }}
      />
    </AdminPage>
  );
}

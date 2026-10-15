import { UserX } from "lucide-react";
import type { Metadata } from "next";
import { z } from "zod";
import { AdminPage } from "@/components/admin/v2/page-container";
import { EmptyState } from "@/components/admin/v2/empty-state";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { formatRelativeDate, formatShortDate } from "@/components/admin/v2/students/format";
import { TEAM_PATH } from "@/components/admin/v2/team/hrefs";
import { RemoveTeamMemberButton, ResendTeamInviteButton } from "@/components/admin/v2/team/member-actions";
import { PermissionSummary } from "@/components/admin/v2/team/permission-checklist";
import { TeamMemberForm } from "@/components/admin/v2/team/team-member-form";
import { requirePageRole } from "@/server/auth/permissions";
import { ADMIN_ROLE_LABELS } from "@/server/auth/roles";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { actionsOfRole } from "@/server/team/model";
import { getTeamMember, listTeamCourseOptions } from "@/server/team/queries";

export const metadata: Metadata = {
  title: "Pessoa da equipe"
};

type TeamMemberPageProps = {
  params: Promise<{ userId: string }>;
};

/** Hora da leitura (renderizado no servidor), para o "Último acesso". */
function readNow() {
  return Date.now();
}

const userIdSchema = z.uuid();

function breadcrumbFor(label: string) {
  return [{ href: "/admin/configuracoes", label: "Configurações" }, { href: TEAM_PATH, label: "Equipe" }, { label }];
}

// Uma pessoa da equipe (docs/17 §2.3): funcao, cursos ou permissoes, reenviar convite e tirar da
// equipe. A propria conta so le (ninguem muda a propria funcao). So o dono.
export default async function TeamMemberPage({ params }: TeamMemberPageProps) {
  const { user } = await requirePageRole("settings.team", "/admin/configuracoes");
  const { userId } = await params;
  const valid = userIdSchema.safeParse(userId).success;
  const loaded = valid ? await loadUnlessPendingMigration(() => Promise.all([getTeamMember(userId), listTeamCourseOptions()])) : null;

  if (loaded && !loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader breadcrumb={breadcrumbFor("Pessoa")} title="Pessoa da equipe" />
        <PendingMigrationNotice />
      </AdminPage>
    );
  }

  const [member, courses] = loaded?.ok ? loaded.data : [null, []];

  if (!member) {
    return (
      <AdminPage className="gap-6">
        <PageHeader breadcrumb={breadcrumbFor("Pessoa")} title="Pessoa da equipe" />
        <EmptyState
          action={{ href: TEAM_PATH, label: "Voltar para a equipe" }}
          description="Ela pode ter sido tirada da equipe agora há pouco."
          icon={UserX}
          title="Essa pessoa não está na equipe"
        />
      </AdminPage>
    );
  }

  const isSelf = member.userId === user.id;
  const lastAccess = member.lastSignInAt ? `Último acesso ${formatRelativeDate(member.lastSignInAt, readNow()).toLocaleLowerCase("pt-BR")}` : "Nunca entrou";
  const sectionTitle = "text-[15px] leading-5 font-semibold text-[var(--text-primary)]";

  return (
    <AdminPage className="gap-8">
      <PageHeader
        breadcrumb={breadcrumbFor(member.fullName)}
        description={`${member.email || "Sem e-mail"} · ${ADMIN_ROLE_LABELS[member.role]} · ${lastAccess} · Na equipe desde ${formatShortDate(member.createdAt)}`}
        title={member.fullName}
      />

      {isSelf ? (
        <section className="flex max-w-[720px] flex-col gap-4">
          <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 text-sm leading-5 text-[var(--text-secondary)]">
            Esta é a sua conta. Ninguém muda a própria função: se precisar, peça a outro dono.
          </p>
          <h2 className={sectionTitle}>O que a sua função permite</h2>
          <PermissionSummary
            actions={actionsOfRole(member.role, member.actions)}
            extra={member.role === "owner" ? ["Mudar a equipe", "Chaves das plataformas de venda"] : []}
          />
        </section>
      ) : (
        <>
          <TeamMemberForm
            courses={courses}
            member={{ actions: member.actions, productIds: member.productIds, role: member.role, updatedAt: member.updatedAt, userId: member.userId }}
          />
          <section aria-labelledby="acesso-titulo" className="flex max-w-[720px] flex-col gap-3 border-t border-[var(--border-subtle)] pt-6">
            <h2 className={sectionTitle} id="acesso-titulo">
              Acesso
            </h2>
            {member.lastSignInAt ? null : (
              <div className="flex flex-col gap-2">
                <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
                  Ainda não entrou. O e-mail traz o link para criar a senha; se ele se perdeu, mande de novo.
                </p>
                <ResendTeamInviteButton userId={member.userId} />
              </div>
            )}
            <RemoveTeamMemberButton name={member.fullName} userId={member.userId} />
          </section>
        </>
      )}
    </AdminPage>
  );
}

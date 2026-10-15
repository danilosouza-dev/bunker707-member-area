import { History, TrendingUp } from "lucide-react";
import type { ProductOption } from "@/server/catalog/types";
import {
  ACCESS_STATE_LABELS,
  STUDENT_PACE_LABELS,
  isAccessOpen,
  sourceProviderLabel,
  type StudentAccessItem,
  type StudentCohort,
  type StudentDetail,
  type StudentProgressItem,
  type StudentTimelineEvent
} from "@/server/students/model";
import { DataTable, type DataTableColumn } from "../data-table";
import { EmptyState } from "../empty-state";
import { PageHeader } from "../page-header";
import { ProductThumb } from "../product-thumb";
import { SectionTabs } from "../section-tabs";
import { StatusChip } from "../status-chip";
import { adminCard } from "../styles";
import { accessStateTone, describeAccessEnd, formatDateTime, formatRelativeDate, formatShortDate, paceTone, todayInputValue } from "./format";
import { studentHref, studentListHref, type StudentProfileTab } from "./hrefs";
import { CohortCell } from "./cohort-cell";
import { AccessRowActions, StudentHeaderActions } from "./student-actions";
import { StudentAvatar } from "./student-avatar";
import { ProgressBar } from "./student-list-table";

// Perfil do aluno (docs/17 §1.7.3): cabecalho com foto, dados e acoes; resumo (conta, ritmo, ultimo
// estudo, acessos); abas Acessos, Progresso e Histórico no endereco (?aba=). Apresentacao pura; a
// pagina le o banco e confere permissoes.

export type StudentProfilePermissions = {
  canAccess: boolean;
  canDelete: boolean;
  /** Dono (settings.team): unico que muda os dados de quem e da equipe. */
  canManageTeam: boolean;
  canSeePersonal: boolean;
};

type StudentProfileViewProps = {
  cohorts: readonly StudentCohort[];
  detail: StudentDetail;
  now: number;
  permissions: StudentProfilePermissions;
  products: readonly ProductOption[];
  tab: StudentProfileTab;
};

function accountLabel(detail: StudentDetail, now: number) {
  if (!detail.account) {
    return { tone: "error" as const, value: "Sem conta de acesso" };
  }

  if (detail.account.lastSignInAt) {
    return { tone: "success" as const, value: `Último login ${formatRelativeDate(detail.account.lastSignInAt, now)}` };
  }

  return { tone: "warning" as const, value: detail.account.mustChangePassword ? "Convite pendente" : "Nunca entrou" };
}

function Fact({ label, children }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
      <dt className="text-xs font-medium text-[var(--text-tertiary)]">{label}</dt>
      <dd className="min-w-0 text-sm text-[var(--text-primary)]">{children}</dd>
    </div>
  );
}

function AccessesTab({ accesses, canAccess, cohorts, now, userId }: { accesses: readonly StudentAccessItem[]; canAccess: boolean; cohorts: readonly StudentCohort[]; now: number; userId: string }) {
  const today = todayInputValue(now);
  const columns: DataTableColumn<StudentAccessItem>[] = [
    {
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-3">
          {row.product ? <ProductThumb accent={row.product.accent} coverUrl={row.product.coverUrl} size="xs" title={row.product.title} /> : null}
          <span className="truncate font-medium text-[var(--text-primary)]">{row.product?.title ?? "Produto removido do catálogo"}</span>
        </span>
      ),
      className: "min-w-[220px]",
      emphasis: true,
      header: "Produto",
      id: "produto"
    },
    { cell: (row) => sourceProviderLabel(row.sourceProvider), header: "Origem", hideOnMobile: true, id: "origem" },
    {
      cell: (row) => (
        <CohortCell
          canEdit={canAccess && isAccessOpen(row.state) && row.targetType !== "platform"}
          cohort={row.cohort}
          cohorts={cohorts}
          productId={row.targetId}
          productTitle={row.product?.title ?? "produto"}
          userId={userId}
        />
      ),
      className: "max-w-[160px]",
      header: "Turma",
      id: "turma",
      mobileLabel: "Turma"
    },
    { cell: (row) => formatShortDate(row.startsAt), header: "Desde", id: "desde", mobileLabel: "Desde" },
    { cell: (row) => describeAccessEnd(row.endsAt, now), header: "Até", id: "ate", mobileLabel: "Até" },
    {
      cell: (row) => <StatusChip tone={accessStateTone(row.state)}>{ACCESS_STATE_LABELS[row.state]}</StatusChip>,
      header: "Situação",
      id: "situacao",
      mobileLabel: "Situação"
    },
    ...(canAccess
      ? [{
          align: "right" as const,
          cell: (row: StudentAccessItem) => <AccessRowActions access={row} today={today} userId={userId} />,
          header: <span className="sr-only">Ações</span>,
          id: "acoes"
        }]
      : [])
  ];

  return (
    <DataTable
      caption="Acessos do aluno"
      columns={columns}
      emptyDescription={canAccess ? "Use “Liberar acesso” para dar um produto a este aluno." : "Este aluno ainda não recebeu nenhum produto."}
      emptyTitle="Nenhum acesso"
      getRowKey={(row) => row.id}
      mobile="cards"
      rows={accesses}
    />
  );
}

function ProgressTab({ now, progress }: { now: number; progress: readonly StudentProgressItem[] }) {
  if (progress.length === 0) {
    return (
      <EmptyState
        description="O progresso aparece quando o aluno tiver acesso a um produto com aulas publicadas."
        icon={TrendingUp}
        title="Nada para medir ainda"
      />
    );
  }

  return (
    <ul className={`${adminCard} divide-y divide-[var(--border-subtle)]`}>
      {progress.map((item) => (
        <li className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" key={item.product.id}>
          <ProductThumb accent={item.product.accent} coverUrl={item.product.coverUrl} size="xs" title={item.product.title} />
          <span className="min-w-0 flex-1 basis-40">
            <span className="block truncate text-sm font-medium text-[var(--text-primary)]">{item.product.title}</span>
            <span className="block text-xs text-[var(--text-tertiary)]">
              Último estudo: {formatRelativeDate(item.lastStudiedAt, now)}
            </span>
          </span>
          <span className="text-sm text-[var(--text-secondary)]">
            <ProgressBar completed={item.completedLessons} total={item.totalLessons} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function TimelineTab({ timeline }: { timeline: readonly StudentTimelineEvent[] }) {
  if (timeline.length === 0) {
    return <EmptyState description="Acessos, convites e logins aparecem aqui, do mais recente ao mais antigo." icon={History} title="Sem eventos ainda" />;
  }

  return (
    <ol className={`${adminCard} divide-y divide-[var(--border-subtle)]`}>
      {timeline.map((event) => (
        <li className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3" key={event.id}>
          <time className="w-[128px] shrink-0 text-xs text-[var(--text-tertiary)] tabular-nums" dateTime={event.at}>
            {formatDateTime(event.at)}
          </time>
          <span className="min-w-0 flex-1 text-sm text-[var(--text-primary)]">{event.text}</span>
        </li>
      ))}
    </ol>
  );
}

export function StudentProfileView({ cohorts, detail, now, permissions, products, tab }: StudentProfileViewProps) {
  const openAccesses = detail.accesses.filter((access) => isAccessOpen(access.state));
  const account = accountLabel(detail, now);
  const descriptionParts = [detail.email, permissions.canSeePersonal ? detail.phone : null, `Entrou em ${formatShortDate(detail.createdAt)}`].filter(Boolean);

  return (
    <>
      <PageHeader
        actions={
          <StudentHeaderActions
            alreadyGranted={openAccesses.map((access) => access.targetId)}
            canAccess={permissions.canAccess}
            canDelete={permissions.canDelete && !detail.isStaff}
            // Conta da equipe: convite e senha nao mudam por Alunos; dados, so o dono muda.
            canEditProfile={permissions.canAccess && (!detail.isStaff || permissions.canManageTeam)}
            canEditPhone={permissions.canSeePersonal}
            canSendAccessEmail={permissions.canAccess && !detail.isStaff}
            products={products}
            student={{ email: detail.email, fullName: detail.fullName, hasAccount: Boolean(detail.account), id: detail.id, phone: detail.phone }}
            today={todayInputValue(now)}
          />
        }
        breadcrumb={[{ href: studentListHref(), label: "Alunos" }, { label: detail.fullName }]}
        description={descriptionParts.join(" · ")}
        title={
          <span className="flex min-w-0 items-center gap-3">
            <StudentAvatar avatarUrl={detail.avatarUrl} name={detail.fullName} size="lg" />
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate">{detail.fullName}</span>
              {detail.isStaff ? <StatusChip tone="neutral">Equipe</StatusChip> : null}
            </span>
          </span>
        }
      />

      <dl className={`${adminCard} grid grid-cols-2 divide-x divide-[var(--border-subtle)] md:grid-cols-4`}>
        <Fact label="Conta">
          <StatusChip tone={account.tone}>{account.value}</StatusChip>
        </Fact>
        <Fact label="Ritmo">
          <StatusChip tone={paceTone(detail.pace)}>{STUDENT_PACE_LABELS[detail.pace]}</StatusChip>
        </Fact>
        <Fact label="Último estudo">{formatRelativeDate(detail.lastStudiedAt, now)}</Fact>
        <Fact label="Acessos ativos">{openAccesses.length}</Fact>
      </dl>

      <SectionTabs
        ariaLabel="Seções do perfil"
        items={[
          { count: openAccesses.length, href: studentHref(detail.id), label: "Acessos" },
          { href: studentHref(detail.id, "progresso"), label: "Progresso" },
          ...(permissions.canSeePersonal ? [{ href: studentHref(detail.id, "historico"), label: "Histórico" }] : [])
        ]}
      />

      {tab === "acessos" ? <AccessesTab accesses={detail.accesses} canAccess={permissions.canAccess} cohorts={cohorts} now={now} userId={detail.id} /> : null}
      {tab === "progresso" ? <ProgressTab now={now} progress={detail.progress} /> : null}
      {tab === "historico" && permissions.canSeePersonal ? <TimelineTab timeline={detail.timeline} /> : null}
    </>
  );
}


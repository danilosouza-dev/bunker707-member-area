import { cn } from "@/lib/utils";
import { ChartCardSkeleton } from "../chart-card";
import { AdminPage } from "../page-container";
import { PageHeader } from "../page-header";
import { EmptyStateSkeleton, KpiTileSkeleton } from "../skeletons";
import { adminCard } from "../styles";
import { CommunicationTabs } from "./communication-frame";
import { COMMUNICATION_TAB_META, COMMUNICATION_TITLE, type CommunicationTab } from "./communication-model";
import { STUDENTS_DESCRIPTION, STUDENTS_TITLE } from "./students-frame";

// Skeletons das molduras de Alunos e Comunicacao, com a forma final (docs/17 §2.7). O cabecalho e as
// abas sao estaticos e aparecem na hora; so os blocos de conteudo pulsam.

function LoadingStatus({ label }: { label: string }) {
  return (
    <span aria-live="polite" className="sr-only" role="status">
      {label}
    </span>
  );
}

export function StudentsFrameSkeleton() {
  return (
    <AdminPage className="gap-6">
      <LoadingStatus label="Carregando Alunos" />
      <PageHeader description={STUDENTS_DESCRIPTION} title={STUDENTS_TITLE} />
      <div aria-hidden="true" className="@container flex min-w-0 flex-col gap-4">
        <div className="grid min-w-0 gap-4 @min-[900px]:grid-cols-[minmax(0,1fr)_248px] @min-[1300px]:grid-cols-[minmax(0,1fr)_280px]">
          <ChartCardSkeleton height={256} />
          <div className={cn(adminCard, "min-h-[104px]")} />
        </div>
        <EmptyStateSkeleton />
      </div>
    </AdminPage>
  );
}

export function CommunicationFrameSkeleton({ tab }: { tab: CommunicationTab }) {
  const meta = COMMUNICATION_TAB_META[tab];

  return (
    <AdminPage className="gap-6">
      <LoadingStatus label={`Carregando ${meta.label}`} />
      <div className="flex min-w-0 flex-col gap-4">
        <PageHeader description={meta.description} title={COMMUNICATION_TITLE} />
        <CommunicationTabs />
      </div>
      <div aria-hidden="true" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTileSkeleton />
        <KpiTileSkeleton />
        <KpiTileSkeleton />
        <KpiTileSkeleton />
      </div>
      <EmptyStateSkeleton />
    </AdminPage>
  );
}

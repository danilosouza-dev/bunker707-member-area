import { AdminPage } from "../page-container";
import { PageHeader } from "../page-header";
import { EmptyStateSkeleton, KpiTileSkeleton } from "../skeletons";
import { CommunicationTabs } from "./communication-frame";
import { COMMUNICATION_TAB_META, COMMUNICATION_TITLE, type CommunicationTab } from "./communication-model";

// Skeleton da moldura de Comunicacao, com a forma final (docs/17 §2.7). O cabecalho e as
// abas sao estaticos e aparecem na hora; so os blocos de conteudo pulsam.

function LoadingStatus({ label }: { label: string }) {
  return (
    <span aria-live="polite" className="sr-only" role="status">
      {label}
    </span>
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

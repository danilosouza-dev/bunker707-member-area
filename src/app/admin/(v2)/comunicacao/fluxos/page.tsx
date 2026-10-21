import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FlowsListView } from "@/components/admin/v2/communication/flows/flows-list-view";
import { flowsPageFallbackHref, parseFlowFilterParam, parseFlowsPage } from "@/components/admin/v2/communication/flows/flows-view-model";
import { CommunicationTabs } from "@/components/admin/v2/frames/communication-frame";
import { COMMUNICATION_TAB_META, COMMUNICATION_TITLE } from "@/components/admin/v2/frames/communication-model";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { readAdminPeriod } from "@/components/admin/v2/period";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { flowsOverview, listFlows } from "@/server/communications/flow-queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

// Ativar, pausar e retomar pela lista rodam Server Actions desta rota (ativar conta quem entra agora).
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Fluxos · Comunicação"
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Comunicação › Fluxos (docs/23 §2.4): os quatro numeros (enviadas e objetivo seguem o periodo da barra
// superior), pilulas por situacao (?situacao=ativos|rascunhos|encerrados) e a lista paginada (?pagina=),
// com as acoes de cada fluxo. Pagina depois da ultima volta para a ultima que tem fluxos (ou a primeira).
export default async function AdminFlowsPage({ searchParams }: PageProps) {
  const [{ access }, params] = await Promise.all([requirePageArea("comunicacao"), searchParams]);
  const period = readAdminPeriod(params, new Date());
  const filter = parseFlowFilterParam(params.situacao);
  const pageNumber = parseFlowsPage(params.pagina);
  const permissions = {
    canPublish: can(access, "messaging.publish"),
    canPublishLarge: can(access, "messaging.publish_large"),
    canWrite: can(access, "messaging.write")
  };
  const loaded = await loadUnlessPendingMigration(async () => {
    const [page, overview] = await Promise.all([
      listFlows({ filter, page: pageNumber, permissions }),
      flowsOverview({ end: period.end, start: period.start })
    ]);

    return { overview, page };
  });

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          <PageHeader description={COMMUNICATION_TAB_META.fluxos.description} title={COMMUNICATION_TITLE} />
          <CommunicationTabs />
        </div>
        <PendingMigrationNotice migration="202610200002" />
      </AdminPage>
    );
  }

  const fallback = flowsPageFallbackHref({
    itemCount: loaded.data.page.items.length,
    page: pageNumber,
    pageSize: loaded.data.page.pageSize,
    searchParams: params,
    total: loaded.data.page.total
  });

  if (fallback) {
    redirect(fallback);
  }

  return (
    <FlowsListView
      canWrite={permissions.canWrite}
      filter={filter}
      overview={loaded.data.overview}
      page={loaded.data.page}
      period={period}
      searchParams={params}
    />
  );
}

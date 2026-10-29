import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WebinarsListView } from "@/components/admin/v2/communication/webinars/webinars-list-view";
import { CommunicationTabs } from "@/components/admin/v2/frames/communication-frame";
import { COMMUNICATION_TAB_META, COMMUNICATION_TITLE } from "@/components/admin/v2/frames/communication-model";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { readAdminPeriod } from "@/components/admin/v2/period";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { WEBINARS_MIGRATION } from "@/server/webinars/db";
import { webinarsPageFallbackHref, webinarsStateOf } from "@/server/webinars/editor-model";
import { listWebinarsForAdmin } from "@/server/webinars/queries";

// Cancelar e excluir pela lista rodam Server Actions desta rota (cancelar enfileira os avisos de quem tinha vaga).
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Webinários · Comunicação"
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Comunicação › Webinários (docs/30 §2.1): os cinco numeros do periodo da barra superior, as abas da pagina
// (?aba=), os filtros (?situacao=, ?tipo=, ?busca=) e a lista paginada (?pagina=) com as acoes de cada webinario.
// Pagina depois da ultima volta para a ultima que tem webinarios (ou para a primeira). Banco sem a migracao
// 202610280001: o aviso no lugar da lista, nunca a tela quebrada.
export default async function AdminWebinarsPage({ searchParams }: PageProps) {
  const [{ access }, params] = await Promise.all([requirePageArea("comunicacao"), searchParams]);
  const period = readAdminPeriod(params, new Date());
  const state = webinarsStateOf(params);
  const permissions = {
    canPublish: can(access, "messaging.publish"),
    canWrite: can(access, "messaging.write")
  };
  const loaded = await loadUnlessPendingMigration(() =>
    listWebinarsForAdmin({
      filters: { kind: state.kind, q: state.search, situation: state.situation },
      page: state.page,
      period: { end: period.end, start: period.start }
    })
  );

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          <PageHeader description={COMMUNICATION_TAB_META.webinarios.description} title={COMMUNICATION_TITLE} />
          <CommunicationTabs />
        </div>
        <PendingMigrationNotice migration={WEBINARS_MIGRATION} />
      </AdminPage>
    );
  }

  const fallback = webinarsPageFallbackHref({
    itemCount: loaded.data.items.length,
    page: state.page,
    pageSize: loaded.data.pageSize,
    searchParams: params,
    total: loaded.data.total
  });

  if (fallback) {
    redirect(fallback);
  }

  return <WebinarsListView page={loaded.data} period={period} permissions={permissions} searchParams={params} state={state} />;
}

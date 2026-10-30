import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WebinarPanelTab } from "@/components/admin/v2/communication/webinars/panels/webinar-panel";
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
import { getWebinarListNumbers } from "@/server/webinars/panel-queries";
import { listWebinarsForAdmin } from "@/server/webinars/queries";

// Cancelar e excluir pela lista rodam Server Actions desta rota (cancelar enfileira os avisos de quem tinha vaga).
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Webinários · Comunicação"
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Hora da leitura (renderizado no servidor): o periodo, a chave do cache dos paineis e o "agora" da lista. */
function readNow() {
  return Date.now();
}

// Comunicação › Webinários (docs/30 §2.1 e §3): os cinco numeros do periodo da barra superior (Compareceram e
// Assistiram o replay pela RPC webinar_panel, em "—" sem a migracao 202610300002), as abas da pagina (?aba=), os
// filtros (?situacao=, ?tipo=, ?busca=) e a lista paginada (?pagina=) com as acoes de cada webinario; nas abas Lives
// ao vivo e Lives gravadas, os paineis de §3.2 e §3.3 (WebinarPanelTab: filtros da aba no endereco, um Suspense por
// bloco). Pagina depois da ultima volta para a ultima que tem webinarios (ou para a primeira). Banco sem a migracao
// das sessoes: o aviso no lugar da lista, nunca a tela quebrada.
export default async function AdminWebinarsPage({ searchParams }: PageProps) {
  const [{ access }, params] = await Promise.all([requirePageArea("comunicacao"), searchParams]);
  const now = readNow();
  const period = readAdminPeriod(params, new Date(now));
  const state = webinarsStateOf(params);
  const permissions = {
    canPublish: can(access, "messaging.publish"),
    canWrite: can(access, "messaging.write")
  };
  const [loaded, listNumbers] = await Promise.all([
    loadUnlessPendingMigration(() =>
      listWebinarsForAdmin({
        filters: { kind: state.kind, q: state.search, situation: state.situation },
        page: state.page,
        period: { end: period.end, start: period.start }
      })
    ),
    getWebinarListNumbers(period, { now })
  ]);

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

  const fallback =
    state.tab === "webinarios"
      ? webinarsPageFallbackHref({
          itemCount: loaded.data.items.length,
          page: state.page,
          pageSize: loaded.data.pageSize,
          searchParams: params,
          total: loaded.data.total
        })
      : null;

  if (fallback) {
    redirect(fallback);
  }

  const panel =
    state.tab === "webinarios" ? null : <WebinarPanelTab kind={state.tab === "ao-vivo" ? "live" : "simulated"} now={now} period={period} searchParams={params} />;

  return (
    <WebinarsListView
      listNumbers={listNumbers}
      page={loaded.data}
      panel={panel}
      period={period}
      permissions={permissions}
      searchParams={params}
      state={state}
    />
  );
}

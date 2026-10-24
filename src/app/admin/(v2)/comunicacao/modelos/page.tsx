import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TemplatesListView } from "@/components/admin/v2/communication/templates/templates-list-view";
import { templatesPageFallbackHref, templatesStateOf } from "@/components/admin/v2/communication/templates/templates-view-model";
import { CommunicationTabs } from "@/components/admin/v2/frames/communication-frame";
import { COMMUNICATION_HOME_HREF, COMMUNICATION_TAB_META, COMMUNICATION_TITLE } from "@/components/admin/v2/frames/communication-model";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { listTemplates } from "@/server/communications/template-queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

export const metadata: Metadata = {
  title: "Modelos · Comunicação"
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Comunicação › Modelos (docs/28 §5.2): as configuracoes prontas de notificacao, de pop-up e de design, com a busca
// pelo nome (?busca=), as pilulas do tipo (?tipo=) e a lista paginada (?pagina=). Sem numeros no topo nem Periodo na
// barra (D22). Toda a area pede messaging.write (D20): quem nao cria avisos volta para a Comunicacao (a analista nem
// ve a area e o requirePageArea ja a leva para outra pagina). Pagina depois da ultima volta para a ultima com modelos.
export default async function AdminTemplatesPage({ searchParams }: PageProps) {
  const [{ access }, params] = await Promise.all([requirePageArea("comunicacao"), searchParams]);

  if (!can(access, "messaging.write")) {
    redirect(COMMUNICATION_HOME_HREF);
  }

  const state = templatesStateOf(params);
  const loaded = await loadUnlessPendingMigration(() => listTemplates({ filter: state.filter, page: state.page, search: state.search }));

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          <PageHeader description={COMMUNICATION_TAB_META.modelos.description} title={COMMUNICATION_TITLE} />
          <CommunicationTabs />
        </div>
        <PendingMigrationNotice migration="202610250001" />
      </AdminPage>
    );
  }

  const fallback = templatesPageFallbackHref({
    itemCount: loaded.data.items.length,
    page: state.page,
    pageSize: loaded.data.pageSize,
    searchParams: params,
    total: loaded.data.total
  });

  if (fallback) {
    redirect(fallback);
  }

  return <TemplatesListView canWrite filter={state.filter} page={loaded.data} search={state.search} searchParams={params} />;
}

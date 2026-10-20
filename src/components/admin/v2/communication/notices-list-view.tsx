import { BellRing, Plus } from "lucide-react";
import type { CampaignKind } from "@/server/communications/campaign-model";
import type { CommunicationOverview, NoticesPage } from "@/server/communications/queries";
import { CommunityPagination } from "../community/pagination";
import { EmptyState } from "../empty-state";
import { CommunicationTabs } from "../frames/communication-frame";
import { COMMUNICATION_TAB_META, COMMUNICATION_TITLE, getCommunicationKpis } from "../frames/communication-model";
import { KpiTile } from "../kpi-tile";
import { AdminLinkButton } from "../link-button";
import { AdminPage } from "../page-container";
import { PageHeader } from "../page-header";
import type { ResolvedAdminPeriod } from "../period";
import { NoticeKindFilters } from "./notice-kind-filters";
import { NoticesTable } from "./notices-table";
import { NEW_NOTICE_HREF, NOTICES_HREF, newNoticeHref } from "./notices-view-model";

// Comunicacao > Avisos e pop-ups (docs/22 §2.1; docs/17 §1.8): cabecalho com "Novo aviso", as abas de
// Comunicacao, os quatro numeros do periodo da barra superior (communication_overview; sem dado, "—"),
// filtro Todos · Notificações · Pop-ups no endereco (?tipo=) e a tabela paginada (?pagina=).

type NoticesListViewProps = {
  canWrite: boolean;
  kind: CampaignKind | undefined;
  overview: CommunicationOverview;
  page: NoticesPage;
  period: ResolvedAdminPeriod;
  searchParams: Record<string, string | string[] | undefined>;
};

const EMPTY_COPY: Record<"all" | CampaignKind, { description: string; title: string }> = {
  all: { description: "Crie uma notificação para o sino ou um pop-up para a home.", title: "Nenhum aviso ainda" },
  inbox: { description: "Crie uma notificação para o sino dos alunos.", title: "Nenhuma notificação ainda" },
  popup: { description: "Crie um pop-up para a home dos alunos.", title: "Nenhum pop-up ainda" }
};

export function NoticesListView({ canWrite, kind, overview, page, period, searchParams }: NoticesListViewProps) {
  const meta = COMMUNICATION_TAB_META.avisos;
  const periodLabel = period.label.toLocaleLowerCase("pt-BR");
  const values = [overview.activeNow, overview.seen, overview.clickRate, overview.studied7d];
  const empty = EMPTY_COPY[kind ?? "all"];

  return (
    <AdminPage className="gap-6">
      <div className="flex min-w-0 flex-col gap-4">
        <PageHeader
          actions={
            canWrite ? (
              <AdminLinkButton href={NEW_NOTICE_HREF}>
                <Plus aria-hidden="true" className="size-4" />
                Novo aviso
              </AdminLinkButton>
            ) : null
          }
          description={meta.description}
          title={COMMUNICATION_TITLE}
        />
        <CommunicationTabs />
      </div>

      <section aria-label="Números de avisos e pop-ups" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {getCommunicationKpis("avisos", period).map((kpi, index) => (
          <KpiTile
            definition={kpi.definition}
            definitionShort={kpi.definitionShort}
            format={kpi.format}
            key={kpi.label}
            label={kpi.label}
            periodLabel={periodLabel}
            value={values[index]}
          />
        ))}
      </section>

      <section aria-labelledby="avisos-lista-titulo" className="flex min-w-0 flex-col gap-3">
        <h2 className="sr-only" id="avisos-lista-titulo">
          Avisos
        </h2>
        <NoticeKindFilters kind={kind} searchParams={searchParams} />

        {page.total === 0 ? (
          <EmptyState
            action={canWrite ? { href: newNoticeHref(kind), label: "Novo aviso" } : undefined}
            description={empty.description}
            icon={BellRing}
            title={empty.title}
          />
        ) : (
          <NoticesTable items={page.items} />
        )}

        <CommunityPagination
          itemLabel="avisos"
          page={page.page}
          pageSize={page.pageSize}
          pathname={NOTICES_HREF}
          searchParams={searchParams}
          total={page.total}
        />
      </section>
    </AdminPage>
  );
}

import { Plus, Workflow } from "lucide-react";
import type { FlowsOverview, FlowsPage } from "@/server/communications/flow-queries";
import { CommunityPagination } from "../../community/pagination";
import { EmptyState } from "../../empty-state";
import { CommunicationTabs } from "../../frames/communication-frame";
import { COMMUNICATION_TAB_META, COMMUNICATION_TITLE, getCommunicationKpis } from "../../frames/communication-model";
import { KpiTile } from "../../kpi-tile";
import { AdminLinkButton } from "../../link-button";
import { AdminPage } from "../../page-container";
import { PageHeader } from "../../page-header";
import type { ResolvedAdminPeriod } from "../../period";
import { FlowFilters, FlowsTable } from "./flows-table";
import { FLOW_EMPTY_COPY, FLOWS_HREF, NEW_FLOW_HREF, type FlowFilter } from "./flows-view-model";

// Comunicacao > Fluxos (docs/23 §2.4): cabecalho com "Novo fluxo", as abas de Comunicacao, os quatro
// numeros (Fluxos ativos e No fluxo agora sao de agora; enviadas e objetivo seguem o periodo da barra; sem
// dado, "—"), as pilulas Todos · Ativos · Rascunhos · Encerrados no endereco (?situacao=) e a tabela
// paginada (?pagina=). Mesma forma de Avisos e pop-ups (notices-list-view.tsx).

type FlowsListViewProps = {
  canWrite: boolean;
  filter: FlowFilter | undefined;
  overview: FlowsOverview;
  page: FlowsPage;
  period: ResolvedAdminPeriod;
  searchParams: Record<string, string | string[] | undefined>;
};

export function FlowsListView({ canWrite, filter, overview, page, period, searchParams }: FlowsListViewProps) {
  const meta = COMMUNICATION_TAB_META.fluxos;
  const periodLabel = period.label.toLocaleLowerCase("pt-BR");
  const values = [overview.activeFlows, overview.inFlowNow, overview.sent, overview.reachedGoal];
  const empty = FLOW_EMPTY_COPY[filter ?? "all"];

  return (
    <AdminPage className="gap-6">
      <div className="flex min-w-0 flex-col gap-4">
        <PageHeader
          actions={
            canWrite ? (
              <AdminLinkButton href={NEW_FLOW_HREF}>
                <Plus aria-hidden="true" className="size-4" />
                Novo fluxo
              </AdminLinkButton>
            ) : null
          }
          description={meta.description}
          title={COMMUNICATION_TITLE}
        />
        <CommunicationTabs />
      </div>

      <section aria-label="Números dos fluxos" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {getCommunicationKpis("fluxos", period).map((kpi, index) => (
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

      <section aria-labelledby="fluxos-lista-titulo" className="flex min-w-0 flex-col gap-3">
        <h2 className="sr-only" id="fluxos-lista-titulo">
          Fluxos
        </h2>
        <FlowFilters filter={filter} searchParams={searchParams} />

        {page.total === 0 ? (
          <EmptyState
            action={canWrite ? { href: NEW_FLOW_HREF, label: "Novo fluxo" } : undefined}
            description={empty.description}
            icon={Workflow}
            title={empty.title}
          />
        ) : (
          <FlowsTable items={page.items} />
        )}

        <CommunityPagination itemLabel="fluxos" page={page.page} pageSize={page.pageSize} pathname={FLOWS_HREF} searchParams={searchParams} total={page.total} />
      </section>
    </AdminPage>
  );
}

import { CalendarClock, Film, Plus, Radio } from "lucide-react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import {
  NEW_WEBINAR_HREF,
  WEBINARS_HREF,
  WEBINAR_ADMIN_COPY,
  hasWebinarFilters,
  webinarsHref,
  type ParamsRecord,
  type WebinarPermissions,
  type WebinarsListState
} from "@/server/webinars/editor-model";
import type { WebinarsAdminPage } from "@/server/webinars/queries";
import { CommunityPagination } from "../../community/pagination";
import { EmptyState } from "../../empty-state";
import { CommunicationTabs } from "../../frames/communication-frame";
import { COMMUNICATION_TAB_META, COMMUNICATION_TITLE, getCommunicationKpis } from "../../frames/communication-model";
import { KpiTile } from "../../kpi-tile";
import { AdminLinkButton } from "../../link-button";
import { AdminPage } from "../../page-container";
import { PageHeader } from "../../page-header";
import type { ResolvedAdminPeriod } from "../../period";
import { WebinarFilters } from "./webinar-filters";
import { WebinarListTabs } from "./webinar-list-tabs";
import { WebinarsTable } from "./webinars-table";

// Comunicacao > Webinários (docs/30 §2.1): cabecalho com "Novo webinário", as abas de Comunicacao, os cinco
// numeros do periodo da barra superior (sem dado, "—" e "Sem dados no período"), as abas da pagina (Webinários ·
// Lives ao vivo · Lives gravadas; as duas ultimas so com o estado vazio ate a fase 4), as pilulas de filtro, a
// busca pelo titulo e a tabela paginada (?pagina=) com o menu "…" por linha.

type WebinarsListViewProps = {
  page: WebinarsAdminPage;
  period: ResolvedAdminPeriod;
  permissions: WebinarPermissions;
  searchParams: ParamsRecord;
  state: WebinarsListState;
};

export function WebinarsListView({ page, period, permissions, searchParams, state }: WebinarsListViewProps) {
  const meta = COMMUNICATION_TAB_META.webinarios;
  const periodLabel = period.label.toLocaleLowerCase("pt-BR");
  const values = [page.numbers.webinars, page.numbers.registered, page.numbers.attended, page.numbers.replayViewers, page.numbers.liveNow];
  const periodo = typeof searchParams.periodo === "string" && searchParams.periodo ? searchParams.periodo : null;
  const filtered = hasWebinarFilters(state);

  return (
    <AdminPage className="gap-6">
      <div className="flex min-w-0 flex-col gap-4">
        <PageHeader
          actions={
            permissions.canWrite ? (
              <AdminLinkButton href={NEW_WEBINAR_HREF}>
                <Plus aria-hidden="true" className="size-4" />
                {WEBINAR_COPY.admin.novo}
              </AdminLinkButton>
            ) : null
          }
          description={meta.description}
          title={COMMUNICATION_TITLE}
        />
        <CommunicationTabs />
      </div>

      <section aria-label="Números de webinários" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {getCommunicationKpis("webinarios", period).map((kpi, index) => (
          <KpiTile
            definition={kpi.definition}
            definitionShort={kpi.definitionShort}
            emptyLabel={WEBINAR_COPY.admin.semDados}
            format={kpi.format}
            key={kpi.label}
            label={kpi.label}
            periodLabel={periodLabel}
            value={values[index]}
          />
        ))}
      </section>

      <section aria-labelledby="webinarios-lista-titulo" className="flex min-w-0 flex-col gap-3">
        <h2 className="sr-only" id="webinarios-lista-titulo">
          {WEBINAR_ADMIN_COPY.list.listHeading}
        </h2>
        <WebinarListTabs active={state.tab} searchParams={searchParams} />

        {state.tab === "ao-vivo" ? (
          <EmptyState description={WEBINAR_ADMIN_COPY.list.empty.liveTabDescription} icon={Radio} title={WEBINAR_COPY.admin.semLivesAoVivo} />
        ) : state.tab === "gravadas" ? (
          <EmptyState description={WEBINAR_ADMIN_COPY.list.empty.recordedTabDescription} icon={Film} title={WEBINAR_COPY.admin.semDados} />
        ) : (
          <>
            <WebinarFilters searchParams={searchParams} state={state} />

            {page.total === 0 ? (
              page.totalAll === 0 || !filtered ? (
                <EmptyState
                  action={permissions.canWrite ? { href: NEW_WEBINAR_HREF, label: WEBINAR_COPY.admin.novo } : undefined}
                  description={WEBINAR_ADMIN_COPY.list.empty.allDescription}
                  icon={CalendarClock}
                  title={WEBINAR_ADMIN_COPY.list.empty.allTitle}
                />
              ) : (
                <EmptyState
                  description={WEBINAR_ADMIN_COPY.list.empty.filteredDescription}
                  icon={CalendarClock}
                  secondaryAction={{ href: webinarsHref({ periodo }), label: WEBINAR_ADMIN_COPY.list.clearFilters }}
                  title={WEBINAR_ADMIN_COPY.list.empty.filteredTitle}
                />
              )
            ) : (
              <WebinarsTable items={page.items} permissions={permissions} />
            )}

            <CommunityPagination
              itemLabel={WEBINAR_ADMIN_COPY.list.itemLabel}
              page={page.page}
              pageSize={page.pageSize}
              pathname={WEBINARS_HREF}
              searchParams={searchParams}
              total={page.total}
            />
          </>
        )}
      </section>
    </AdminPage>
  );
}

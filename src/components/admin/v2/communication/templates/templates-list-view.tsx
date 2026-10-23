import { Plus } from "lucide-react";
import type { TemplateFilter, TemplatesPage } from "@/server/communications/template-queries";
import { TEMPLATES_HREF } from "@/server/communications/template-model";
import { CommunityPagination } from "../../community/pagination";
import { CommunicationTabs } from "../../frames/communication-frame";
import { COMMUNICATION_TAB_META, COMMUNICATION_TITLE } from "../../frames/communication-model";
import { AdminLinkButton } from "../../link-button";
import { AdminPage } from "../../page-container";
import { PageHeader } from "../../page-header";
import { TemplateFilters } from "./template-filters";
import { TemplatesTable } from "./templates-table";
import { NEW_TEMPLATE_HREF, TEMPLATE_COPY, emptyCopy, templatesCountLine } from "./templates-view-model";

// Comunicacao > Modelos (docs/28; spec §5.2), no molde de Fluxos: cabecalho com "Novo modelo", as abas de
// Comunicacao, sem numeros (D22), a busca pelo nome e as pilulas do tipo no endereco, a tabela paginada (20 por
// pagina) e, a partir de 150, a contagem "{n} de 200 modelos". Os modelos de fluxo ficam em "Novo fluxo" (D25).

type TemplatesListViewProps = {
  canWrite: boolean;
  filter: TemplateFilter;
  page: TemplatesPage;
  search: string;
  searchParams: Record<string, string | string[] | undefined>;
};

export function TemplatesListView({ canWrite, filter, page, search, searchParams }: TemplatesListViewProps) {
  const meta = COMMUNICATION_TAB_META.modelos;
  const empty = emptyCopy(filter, search);
  const countLine = templatesCountLine(page.totalAll);

  return (
    <AdminPage className="gap-6">
      <div className="flex min-w-0 flex-col gap-4">
        <PageHeader
          actions={
            canWrite ? (
              <AdminLinkButton href={NEW_TEMPLATE_HREF}>
                <Plus aria-hidden="true" className="size-4" />
                {TEMPLATE_COPY.list.newTemplate}
              </AdminLinkButton>
            ) : null
          }
          description={meta.description}
          title={COMMUNICATION_TITLE}
        />
        <CommunicationTabs />
      </div>

      <section aria-labelledby="modelos-lista-titulo" className="flex min-w-0 flex-col gap-3">
        <h2 className="sr-only" id="modelos-lista-titulo">
          {TEMPLATE_COPY.list.listHeading}
        </h2>
        <TemplateFilters filter={filter} search={search} searchParams={searchParams} />

        <TemplatesTable empty={canWrite ? empty : { ...empty, action: undefined }} fonts={page.fonts} items={page.items} />

        <CommunityPagination
          itemLabel={TEMPLATE_COPY.list.itemLabel}
          page={page.page}
          pageSize={page.pageSize}
          pathname={TEMPLATES_HREF}
          searchParams={searchParams}
          total={page.total}
        />
        {countLine ? <p className="text-xs leading-5 text-[var(--text-secondary)] tabular-nums">{countLine}</p> : null}
      </section>
    </AdminPage>
  );
}

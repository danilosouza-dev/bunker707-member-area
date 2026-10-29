import { Film, Radio, SearchX, TriangleAlert } from "lucide-react";
import { Suspense } from "react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { WEBINARS_OFFERS_MIGRATION } from "@/server/webinars/db";
import { panelHref, readPanelFilters, readPanelSessionParam, type PanelPresenceResult, type PanelTabKind, type PanelView } from "@/server/webinars/panel-model";
import { getPanelPresence, getWebinarPanel, type PanelLoad } from "@/server/webinars/panel-queries";
import { getWebinarReport } from "@/server/webinars/report-queries";
import { EmptyState } from "../../../empty-state";
import { PendingMigrationNotice } from "../../../pending-migration-notice";
import type { ResolvedAdminPeriod } from "../../../period";
import { WebinarExportMenu } from "../export-menu";
import { PanelChartsSkeleton, PanelPresenceSkeleton, PanelTableSkeleton, PanelTopSkeleton } from "../webinars-skeletons";
import { HourOfDayCard, OverTimeChartCard, PresenceChartCard, RetentionChartCard, TripleBarsChartCard, VariantsCard } from "./panel-charts";
import { PanelFiltersBar } from "./panel-filters";
import { PanelKpiGrid } from "./panel-kpis";
import { PanelSimulationBlock } from "./panel-simulation";
import { PanelSessionsTable } from "./panel-table";

// As abas "Lives ao vivo" e "Lives gravadas" da pagina de Webinarios (docs/30 §2.1, §3.1 a §3.3 e §3.5): o titulo e
// a frase da aba, os filtros com o botao Exportar, os dez cartoes, a curva minuto a minuto da sessao escolhida, os
// graficos, a tabela de sessoes e, so na gravada, o bloco Simulacao por ultimo. Cada bloco no seu Suspense, com o
// skeleton na forma final; todos esperam a mesma leitura (getWebinarPanel, a RPC em cache de 60 s), e a curva espera
// a segunda (getWebinarReport da sessao escolhida). Banco sem a 202610300002: o aviso no lugar do painel; qualquer
// falha: a frase de erro, nunca a tela quebrada. WebinarPanelContent desenha os mesmos blocos sem esperar nada (os
// testes e quem ja tem os dados).

const COPY = WEBINAR_COPY.paineis;

type ParamsRecord = Record<string, string | string[] | undefined>;

export type PanelContext = {
  comparisonLabel: string;
  kind: PanelTabKind;
  periodLabel: string;
  /** O ?periodo= do endereco (vai junto em todo link da aba). */
  periodo: string | null;
  /** O endereco desta aba com os mesmos filtros (o "Tentar de novo" do erro); sem ele, a aba sem filtros. */
  retryHref?: string;
};

function titleOf(kind: PanelTabKind) {
  return kind === "live" ? COPY.titulo.aoVivo : COPY.titulo.gravadas;
}

function readyView(result: PanelLoad) {
  return result.status === "ok" && result.view.empty === null ? result.view : null;
}

type PanelEmptyState = { action?: { href: string; label: string }; description: string; icon: typeof Radio; title: string };

/** O vazio da aba: os filtros tiraram tudo (com "Limpar filtros"), nunca houve live ao vivo, ou nada no periodo. */
function emptyStateOf(view: PanelView, periodo: string | null): PanelEmptyState | null {
  if (view.empty === null) {
    return null;
  }

  if (view.empty === "filtered") {
    return {
      action: { href: panelHref({ filters: {}, kind: view.kind, periodo }), label: COPY.filtros.limpar },
      description: COPY.vazioDescricao.filtrado,
      icon: SearchX,
      title: COPY.vazio.periodo
    };
  }

  if (view.kind === "simulated") {
    return { description: COPY.vazioDescricao.gravadas, icon: Film, title: COPY.vazio.gravadas };
  }

  return view.empty === "never"
    ? { description: COPY.vazioDescricao.aoVivo, icon: Radio, title: COPY.vazio.aoVivo }
    : { description: COPY.vazioDescricao.periodo, icon: Radio, title: COPY.vazio.periodo };
}

/* ------------------------------------------------------------------------------------------------
 * Os blocos, ja com os dados
 * ---------------------------------------------------------------------------------------------- */

/** Filtros, Exportar e os cartoes (ou o aviso da migracao, o erro e os vazios). */
export function PanelTop({ context, result }: { context: PanelContext; result: PanelLoad }) {
  if (result.status === "pending_migration") {
    return <PendingMigrationNotice migration={result.migration} />;
  }

  if (result.status === "error") {
    // A leitura falhou: nunca "Sem dados no período" (o produtor leria que ninguem veio); o mesmo endereco de novo.
    const retry = context.retryHref ?? panelHref({ filters: {}, kind: context.kind, periodo: context.periodo });
    return <EmptyState description={COPY.erro} headingLevel="h3" icon={TriangleAlert} secondaryAction={{ href: retry, label: COPY.tentarDeNovo }} title={COPY.erroTitulo} />;
  }

  const view = result.view;
  const empty = emptyStateOf(view, context.periodo);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {view.empty === "never" ? null : (
        <PanelFiltersBar
          actions={<WebinarExportMenu end={view.exportWindow.end} filters={view.filters} kind={view.kind} scope="panel" searchParams={view.filterParams} start={view.exportWindow.start} />}
          filters={view.filters}
          hasFilters={view.hasFilters}
          kind={view.kind}
          options={view.filterOptions}
          periodo={context.periodo}
        />
      )}
      {!view.offersAvailable && view.kind === "simulated" && view.empty === null ? <PendingMigrationNotice migration={WEBINARS_OFFERS_MIGRATION} size="compact" /> : null}
      {empty ? (
        <EmptyState description={empty.description} headingLevel="h3" icon={empty.icon} secondaryAction={empty.action} title={empty.title} />
      ) : (
        <PanelKpiGrid comparisonLabel={context.comparisonLabel} kpis={view.kpis} periodLabel={context.periodLabel} title={titleOf(view.kind)} />
      )}
    </div>
  );
}

/** A curva minuto a minuto da sessao escolhida (seletor Live/Sessao, a mais recente por padrao). */
export function PanelPresence({ context, presence, result }: { context: PanelContext; presence: PanelPresenceResult; result: PanelLoad }) {
  const view = readyView(result);

  if (!view) {
    return null;
  }

  return (
    <PresenceChartCard
      filters={view.filters}
      kind={view.kind}
      options={view.presence.options}
      periodo={context.periodo}
      result={presence}
      selectedId={view.presence.selectedId}
    />
  );
}

/** Os graficos: retencao e, na live, Vagas × Presentes × Replay e Lives ao longo do tempo; na gravada, horario e variante. */
export function PanelCharts({ result }: { result: PanelLoad }) {
  const view = readyView(result);

  if (!view) {
    return null;
  }

  return (
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2" data-panel-charts="">
      <RetentionChartCard chart={view.retention} kind={view.kind} />
      {view.kind === "live" ? (
        <>
          <TripleBarsChartCard bars={view.tripleBars} />
          <OverTimeChartCard points={view.overTime} />
        </>
      ) : (
        <>
          <HourOfDayCard offersAvailable={view.offersAvailable} rows={view.byHour} />
          <VariantsCard rows={view.variants} />
        </>
      )}
    </div>
  );
}

export function PanelTable({ result }: { result: PanelLoad }) {
  const view = readyView(result);
  return view ? <PanelSessionsTable kind={view.kind} rows={view.table.rows} total={view.table.total} /> : null;
}

/** O bloco Simulacao: so na gravada, sempre o ultimo da aba. */
export function PanelSimulation({ result }: { result: PanelLoad }) {
  const view = readyView(result);
  return view?.simulation ? <PanelSimulationBlock simulation={view.simulation} /> : null;
}

function PanelHeader({ kind }: { kind: PanelTabKind }) {
  return (
    <header className="flex min-w-0 flex-col gap-0.5">
      <h3 className="text-base leading-6 font-semibold text-[var(--text-primary)]">{titleOf(kind)}</h3>
      <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{kind === "live" ? COPY.descricao.aoVivo : COPY.descricao.gravadas}</p>
    </header>
  );
}

/** A aba inteira sem esperar nada (a mesma ordem dos blocos com Suspense). */
export function WebinarPanelContent({ context, presence, result }: { context: PanelContext; presence: PanelPresenceResult; result: PanelLoad }) {
  return (
    <div className="flex min-w-0 flex-col gap-6" data-panel={context.kind}>
      <PanelHeader kind={context.kind} />
      <PanelTop context={context} result={result} />
      <PanelPresence context={context} presence={presence} result={result} />
      <PanelCharts result={result} />
      <PanelTable result={result} />
      <PanelSimulation result={result} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * A aba na pagina: um Suspense por bloco
 * ---------------------------------------------------------------------------------------------- */

async function TopBlock({ context, panel }: { context: PanelContext; panel: Promise<PanelLoad> }) {
  return <PanelTop context={context} result={await panel} />;
}

async function PresenceBlock({ context, panel, presence }: { context: PanelContext; panel: Promise<PanelLoad>; presence: Promise<PanelPresenceResult> }) {
  const [result, curve] = await Promise.all([panel, presence]);
  return <PanelPresence context={context} presence={curve} result={result} />;
}

async function ChartsBlock({ panel }: { panel: Promise<PanelLoad> }) {
  return <PanelCharts result={await panel} />;
}

async function TableBlock({ panel }: { panel: Promise<PanelLoad> }) {
  return <PanelTable result={await panel} />;
}

async function SimulationBlock({ panel }: { panel: Promise<PanelLoad> }) {
  return <PanelSimulation result={await panel} />;
}

type WebinarPanelTabProps = {
  kind: PanelTabKind;
  now: number;
  period: ResolvedAdminPeriod;
  searchParams: ParamsRecord;
};

export function WebinarPanelTab({ kind, now, period, searchParams }: WebinarPanelTabProps) {
  const filters = readPanelFilters(kind, searchParams);
  const periodo = typeof searchParams.periodo === "string" && searchParams.periodo ? searchParams.periodo : null;
  const sessionParam = readPanelSessionParam(searchParams);
  const context: PanelContext = {
    comparisonLabel: period.comparisonLabel,
    kind,
    periodLabel: period.label.toLocaleLowerCase("pt-BR"),
    periodo,
    retryHref: panelHref({ filters, kind, periodo, sessionId: sessionParam })
  };
  const panel = getWebinarPanel({
    filters,
    kind,
    now,
    period: { end: period.end, previous: period.previous, start: period.start },
    sessionId: sessionParam
  });
  const presence: Promise<PanelPresenceResult> = panel
    .then((result) => {
      const view = readyView(result);
      return view
        ? getPanelPresence({ durationMs: view.presence.durationMs, offerWindow: view.presence.offerWindow, sessionId: view.presence.selectedId }, { now, report: getWebinarReport })
        : ({ status: "empty" } as const);
    })
    .catch(() => ({ status: "error" }) as const);

  return (
    <div className="flex min-w-0 flex-col gap-6" data-panel={kind}>
      <PanelHeader kind={kind} />
      <Suspense fallback={<PanelTopSkeleton />}>
        <TopBlock context={context} panel={panel} />
      </Suspense>
      <Suspense fallback={<PanelPresenceSkeleton />}>
        <PresenceBlock context={context} panel={panel} presence={presence} />
      </Suspense>
      <Suspense fallback={<PanelChartsSkeleton />}>
        <ChartsBlock panel={panel} />
      </Suspense>
      <Suspense fallback={<PanelTableSkeleton />}>
        <TableBlock panel={panel} />
      </Suspense>
      {kind === "simulated" ? (
        <Suspense fallback={null}>
          <SimulationBlock panel={panel} />
        </Suspense>
      ) : null}
    </div>
  );
}

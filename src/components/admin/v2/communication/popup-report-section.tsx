"use client";

import { ChartColumn, Info, Table2 } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  POPUP_REPORT_COPY,
  popupReportCount,
  popupReportPercentText,
  type PopupReportBar,
  type PopupReportProduct,
  type PopupReportView
} from "@/server/communications/popup-report-model";
import type { PopupReportResult } from "@/server/communications/queries";
import { KpiTile } from "../kpi-tile";
import { adminCard } from "../styles";

// Relatorio do pop-up (v3b-2, docs/29 §6.5): "Como o pop-up foi visto", desde a publicacao, com os quatro
// numeros (KpiTile, 4 por linha e 2 colunas abaixo de 768 px) e os quatro blocos de barras horizontais simples
// como as da enquete (o numero escrito ao lado; a barra fora do leitor de tela), nada de pizza ou rosca. "Ver
// como tabela" troca os quatro blocos de uma vez por <table> com <caption> e <th scope="col">; abaixo de 768 px
// cada linha vira um cartao (<dl>), sem rolagem lateral a 375 px. A escolha fica so na tela (sem
// localStorage). "Por produto" e sempre uma tabela (o nome, as vezes e os alunos). Os numeros chegam prontos de
// popup-report-model.ts (getPopupReport, cache de 60 s): aqui so o desenho.

type PopupReportSectionProps = { result: PopupReportResult };

const COPY = POPUP_REPORT_COPY;
type BarsBlockId = keyof typeof COPY.percentOf;

const headerClass = "h-9 border-b border-[var(--border-subtle)] px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-[var(--text-tertiary)]";
const cellClass = "h-11 border-b border-[var(--border-subtle)] px-3 align-middle";

function Header({ action }: { action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id="aviso-relatorio-popup">
          {COPY.title}
        </h2>
        <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">{COPY.description}</p>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 text-sm leading-5 text-[var(--text-secondary)]">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Uma barra: o nome, as vezes e os alunos escritos e a porcentagem; a barra repete a porcentagem (aria-hidden). */
function BarRow({ bar, of }: { bar: PopupReportBar; of: string }) {
  const percent = popupReportPercentText(bar.percent, of);

  return (
    <li className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm leading-5">
        <span className="min-w-0 text-[var(--text-primary)] [overflow-wrap:anywhere]">{bar.label}</span>
        <span className="text-[13px] text-[var(--text-secondary)] tabular-nums">
          {bar.summary}
          {percent ? ` · ${percent}` : ""}
        </span>
      </div>
      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div className="h-full rounded-full bg-[var(--text-primary)]/25" style={{ width: `${Math.min(100, bar.percent ?? 0)}%` }} />
      </div>
    </li>
  );
}

type Column<Row> = { align?: "right"; cell: (row: Row) => string; header: string; id: string };

/** Tabela no computador; abaixo de 768 px, cada linha vira um cartao (<dl>) com o nome por cima. */
function ReportTable<Row extends { id: string; label: string }>({ caption, columns, rows }: { caption: string; columns: readonly Column<Row>[]; rows: readonly Row[] }) {
  const [first, ...rest] = columns;

  return (
    <div className="min-w-0">
      <table className="hidden w-full border-collapse text-sm text-[var(--text-secondary)] tabular-nums md:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th className={cn(headerClass, column.align === "right" && "text-right")} key={column.id} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="last:[&>*]:border-b-0" key={row.id}>
              {columns.map((column) => (
                <td className={cn(cellClass, column.align === "right" && "text-right", column === first && "text-[var(--text-primary)]")} key={column.id}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul aria-label={caption} className="flex min-w-0 flex-col divide-y divide-[var(--border-subtle)] md:hidden">
        {rows.map((row) => (
          <li className="min-w-0 py-2.5 first:pt-0 last:pb-0" key={row.id}>
            <dl className="flex min-w-0 flex-col gap-1 text-[13px] leading-5">
              <div className="flex min-w-0 flex-col">
                <dt className="sr-only">{first.header}</dt>
                <dd className="text-sm text-[var(--text-primary)] [overflow-wrap:anywhere]">{first.cell(row)}</dd>
              </div>
              {rest.map((column) => (
                <div className="flex min-w-0 justify-between gap-3" key={column.id}>
                  <dt className="text-[var(--text-tertiary)]">{column.header}</dt>
                  <dd className="text-[var(--text-secondary)] tabular-nums">{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

function barColumns(block: BarsBlockId): Column<PopupReportBar>[] {
  const table = COPY.table;
  const labels: Record<BarsBlockId, { label: string; percent: string }> = {
    outcomes: { label: table.outcomes, percent: table.outcomesPercent },
    pages: { label: table.pages, percent: table.pagesPercent },
    times: { label: table.times, percent: table.timesPercent },
    triggers: { label: table.triggers, percent: table.triggersPercent }
  };

  return [
    { cell: (row) => row.label, header: labels[block].label, id: "label" },
    { align: "right", cell: (row) => popupReportCount(row.total), header: table.total, id: "total" },
    { align: "right", cell: (row) => popupReportPercentText(row.percent, "").trim() || "—", header: labels[block].percent, id: "percent" },
    // "Sem registro" nao tem alunos (o navegador nao avisou de ninguem).
    { align: "right", cell: (row) => (row.id === "none" ? "—" : popupReportCount(row.students)), header: table.students, id: "students" }
  ];
}

const PRODUCT_COLUMNS: Column<PopupReportProduct>[] = [
  { cell: (row) => row.label, header: COPY.table.product, id: "label" },
  { align: "right", cell: (row) => popupReportCount(row.total), header: COPY.table.total, id: "total" },
  { align: "right", cell: (row) => popupReportCount(row.students), header: COPY.table.students, id: "students" }
];

function BarsBlock({ bars, block, children, table }: { bars: readonly PopupReportBar[]; block: BarsBlockId; children?: ReactNode; table: boolean }) {
  const titleId = useId();
  const title = COPY.sections[block];

  return (
    <section aria-labelledby={titleId} className={cn(adminCard, "flex min-w-0 flex-col gap-4 p-4")}>
      <h3 className="text-sm leading-5 font-semibold text-[var(--text-primary)]" id={titleId}>
        {title}
      </h3>
      {bars.length === 0 ? (
        <p className="text-[13px] leading-5 text-[var(--text-tertiary)]">—</p>
      ) : table ? (
        <ReportTable caption={title} columns={barColumns(block)} rows={bars} />
      ) : (
        <ul className="flex min-w-0 flex-col gap-3">
          {bars.map((bar) => (
            <BarRow bar={bar} key={bar.id} of={COPY.percentOf[block]} />
          ))}
        </ul>
      )}
      {children}
    </section>
  );
}

/** Os quatro numeros, os quatro blocos (barras ou tabelas) e o rodape. */
export function PopupReportBlocks({ table, view }: { table: boolean; view: PopupReportView }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {view.kpis.map((kpi) => (
          <KpiTile
            // "No máximo" leva a media e a metade na definicao: ela quebra a linha (ate 3 no celular) em vez de cortar.
            className={kpi.id === "max" ? "[&_[title]]:whitespace-normal [&_[title]]:[-webkit-line-clamp:3]" : undefined}
            definition={kpi.definition}
            key={kpi.id}
            label={kpi.label}
            value={kpi.value}
          />
        ))}
      </div>
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <BarsBlock bars={view.pages} block="pages" table={table}>
          {view.products.length > 0 ? (
            <div className="flex min-w-0 flex-col gap-2 border-t border-[var(--border-subtle)] pt-4">
              <h4 className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{COPY.sections.products}</h4>
              <ReportTable caption={COPY.sections.products} columns={PRODUCT_COLUMNS} rows={view.products} />
            </div>
          ) : null}
        </BarsBlock>
        <BarsBlock bars={view.triggers} block="triggers" table={table} />
        <BarsBlock bars={view.outcomes} block="outcomes" table={table} />
        <BarsBlock bars={view.times} block="times" table={table} />
      </div>
      <p className="text-xs leading-5 text-[var(--text-tertiary)]">{view.footnote}</p>
    </>
  );
}

export function PopupReportSection({ result }: PopupReportSectionProps) {
  const [table, setTable] = useState(false);
  const view = result.status === "ok" ? result.view : null;
  const showsNumbers = view !== null && !view.empty;

  return (
    <section aria-labelledby="aviso-relatorio-popup" className="flex min-w-0 flex-col gap-4">
      <Header
        action={
          showsNumbers ? (
            <Button aria-pressed={table} className="gap-1.5 px-3" onClick={() => setTable((value) => !value)} type="button" variant="ghost">
              {table ? <ChartColumn aria-hidden="true" className="size-4" /> : <Table2 aria-hidden="true" className="size-4" />}
              {table ? COPY.toggle.chart : COPY.toggle.table}
            </Button>
          ) : null
        }
      />
      {result.status === "pending_migration" ? <Message>{COPY.pendingMigration}</Message> : null}
      {result.status === "error" ? <Message>{COPY.failure}</Message> : null}
      {view?.empty ? <Message>{COPY.empty}</Message> : null}
      {showsNumbers ? <PopupReportBlocks table={table} view={view} /> : null}
    </section>
  );
}

/** Enquanto os numeros chegam (Suspense): os quatro numeros vazios e um bloco cinza. O funil nao espera. */
export function PopupReportSkeleton() {
  return (
    <section aria-labelledby="aviso-relatorio-popup" className="flex min-w-0 flex-col gap-4">
      <Header />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(["times", "viewers", "repeat", "max"] as const).map((id) => (
          <KpiTile emptyLabel="" key={id} label={COPY.kpis[id]} value={null} />
        ))}
      </div>
      <div aria-busy="true" aria-label={COPY.loadingAria} className="h-48 animate-pulse rounded-lg bg-[var(--surface-2)] motion-reduce:animate-none" role="status" />
    </section>
  );
}

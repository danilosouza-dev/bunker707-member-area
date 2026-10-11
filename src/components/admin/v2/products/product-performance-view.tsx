import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PRODUCT_ACCENTS, type ProductAccent } from "@/server/catalog/model";
import { EMPTY_VALUE } from "../format";
import { StatusChip } from "../status-chip";
import { adminCard } from "../styles";
import {
  LESSON_DROP_NOTE,
  LESSON_METRIC_COLUMNS,
  PERFORMANCE_NOTICE,
  PROGRESS_BANDS,
  describeFunnelValue,
  type FunnelRow,
  type LessonPerformanceRow
} from "./performance-model";

// Aba Desempenho (docs/17 §1.6.5) na disposicao do prototipo aprovado: a faixa honesta no topo e os
// tres cartoes empilhados (Funil por modulo, Progresso de quem tem acesso, Por aula). So o que existe
// de verdade aparece (modulos, aulas, situacao das aulas e quantos tem acesso); os numeros de estudo
// ficam em "—" e as barras vazias ate existir o registro de aulas assistidas. Nada e clicavel sem dado.
// Apresentacao pura (sem estado): a pagina le o banco e o periodo e passa tudo pronto.

export type ProductPerformanceViewProps = {
  accent: ProductAccent;
  /** "de 312 com acesso" ou "aberto para todos os alunos". */
  baseLabel: string;
  /** Formação: o funil passa pelos cursos e a tabela por aula fica em cada curso. */
  formation: boolean;
  funnel: readonly FunnelRow[];
  lessonTableMeta: string;
  lessons: readonly LessonPerformanceRow[];
};

function CardHead({ id, meta, title }: { id: string; meta?: ReactNode; title: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 pt-4">
      <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id={id}>
        {title}
      </h2>
      {meta ? <span className="text-xs leading-4 font-medium text-[var(--text-tertiary)]">{meta}</span> : null}
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return <i aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />;
}

/** Trilho vazio da barra (8 px), na largura em que a barra vai aparecer quando houver dado. */
function EmptyTrack({ label }: { label: string }) {
  return <span aria-label={`${label}: sem dados ainda`} className="block h-2 rounded-[4px] bg-[var(--surface-3)] [grid-area:track]" role="img" />;
}

/**
 * Linhas de barra horizontal do prototipo (`gx-hbars`): em cartao largo, rotulo (256 px) | trilho |
 * valor (288 px) numa linha; em cartao estreito, rotulo e valor em cima e o trilho embaixo.
 */
function BarRows({ children, dense = false, label }: { children: ReactNode; dense?: boolean; label: string }) {
  return (
    <div className="@container">
      <ul aria-label={label} className={cn("flex flex-col p-4", dense ? "gap-4 @min-[720px]:gap-2" : "gap-4")}>
        {children}
      </ul>
    </div>
  );
}

function BarRow({ label, stacked = false, value }: { label: string; stacked?: boolean; value: ReactNode }) {
  return (
    <li
      className={cn(
        "grid min-w-0 items-baseline gap-x-4 gap-y-2 [grid-template-areas:'label_val'_'track_track'] grid-cols-[minmax(0,1fr)_auto]",
        stacked && "@max-[519px]:grid-cols-1 @max-[519px]:gap-y-1 @max-[519px]:[grid-template-areas:'label'_'val'_'track']",
        "@min-[720px]:min-h-8 @min-[720px]:grid-cols-[256px_minmax(0,1fr)_288px] @min-[720px]:items-center @min-[720px]:[grid-template-areas:'label_track_val']"
      )}
    >
      <span className="min-w-0 text-[13px] leading-5 font-medium break-words text-[var(--text-primary)] [grid-area:label]">{label}</span>
      <EmptyTrack label={label} />
      <span className="flex min-w-0 items-baseline gap-1.5 text-[13px] leading-5 whitespace-nowrap text-[var(--text-secondary)] tabular-nums [grid-area:val]">
        {value}
      </span>
    </li>
  );
}

function FunnelValue({ row }: { row: FunnelRow }) {
  if (row.note) {
    return <span className="font-medium text-[var(--text-tertiary)]">{describeFunnelValue(row, EMPTY_VALUE)}</span>;
  }

  return (
    <>
      <span className="font-medium text-[var(--text-tertiary)]">Iniciaram</span>
      <b className="min-w-7 text-right font-semibold text-[var(--text-primary)]">{EMPTY_VALUE}</b>
      <span aria-hidden="true" className="mx-0.5 text-[var(--text-disabled)]">
        ·
      </span>
      <span className="font-medium text-[var(--text-tertiary)]">Concluíram</span>
      <b className="min-w-7 text-right font-semibold text-[var(--text-primary)]">{EMPTY_VALUE}</b>
    </>
  );
}

function LessonName({ row }: { row: LessonPerformanceRow }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 leading-5">
      <span className="min-w-6 text-[var(--text-tertiary)] tabular-nums">{row.number}</span>
      <span className={cn("min-w-0 break-words", row.off ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]")}>{row.title}</span>
      {row.statusLabel ? (
        <StatusChip className="h-5 px-1.5" tone="neutral">
          {row.statusLabel}
        </StatusChip>
      ) : null}
    </span>
  );
}

function LessonTable({ formation, lessons }: { formation: boolean; lessons: readonly LessonPerformanceRow[] }) {
  if (lessons.length === 0) {
    return (
      <p className="px-4 pt-3 pb-4 text-sm leading-5 text-[var(--text-secondary)]">
        {formation ? "As aulas ficam em cada curso desta formação; o Desempenho de cada curso mostra a tabela por aula." : "Este produto ainda não tem aulas."}
      </p>
    );
  }

  const headCell = "h-12 px-2 pb-2.5 align-bottom text-xs leading-4 font-medium text-[var(--text-tertiary)]";

  return (
    <div className="@container mt-2 min-w-0">
      <div className="hidden @min-[640px]:block">
        <table className="w-full border-collapse text-sm text-[var(--text-secondary)] tabular-nums">
          <caption className="sr-only">Desempenho por aula</caption>
          <thead>
            <tr className="border-b border-[var(--border-subtle)]">
              <th className={cn(headCell, "pl-4 text-left")} scope="col">
                Aula
              </th>
              {LESSON_METRIC_COLUMNS.map((column) => (
                <th
                  className={cn(
                    headCell,
                    "text-right",
                    column.id === "questionsPer100Views" ? "w-36 pr-4 whitespace-normal" : "whitespace-nowrap",
                    !column.mobile && column.id !== "questionsPer100Views" && "hidden @min-[860px]:table-cell",
                    column.id === "questionsPer100Views" && "hidden @min-[960px]:table-cell"
                  )}
                  key={column.id}
                  scope="col"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lessons.map((row) => (
              <tr className="border-b border-[var(--border-subtle)] last:border-b-0" key={row.id}>
                <td className="min-w-60 py-3 pr-2 pl-4 align-middle">
                  <LessonName row={row} />
                </td>
                {LESSON_METRIC_COLUMNS.map((column) => (
                  <td
                    className={cn(
                      "h-12 px-2 text-right align-middle",
                      row.off && "text-[var(--text-disabled)]",
                      column.id === "questionsPer100Views" && "pr-4",
                      !column.mobile && column.id !== "questionsPer100Views" && "hidden @min-[860px]:table-cell",
                      column.id === "questionsPer100Views" && "hidden @min-[960px]:table-cell"
                    )}
                    key={column.id}
                  >
                    {row.metrics[column.id] === null ? EMPTY_VALUE : row.metrics[column.id]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label="Desempenho por aula" className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)] @min-[640px]:hidden">
        {lessons.map((row) => (
          <li className="grid grid-cols-3 gap-x-3 gap-y-2.5 px-4 py-3.5" key={row.id}>
            <span className="col-span-3 min-w-0 text-sm">
              <LessonName row={row} />
            </span>
            {LESSON_METRIC_COLUMNS.filter((column) => column.mobile).map((column) => (
              <span className="flex min-w-0 flex-col gap-0.5" key={column.id}>
                <span className="text-xs leading-4 font-medium text-[var(--text-tertiary)]">{column.label}</span>
                <span className={cn("text-sm leading-5 tabular-nums", row.off ? "text-[var(--text-disabled)]" : "text-[var(--text-secondary)]")}>
                  {row.metrics[column.id] === null ? EMPTY_VALUE : row.metrics[column.id]}
                </span>
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProductPerformanceView({ accent, baseLabel, formation, funnel, lessonTableMeta, lessons }: ProductPerformanceViewProps) {
  const funnelTitle = formation ? "Funil por curso" : "Funil por módulo";

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className={cn(adminCard, "flex items-start gap-2.5 px-3.5 py-2.5 text-[13px] leading-5 text-[var(--text-secondary)]")}>
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--text-tertiary)]" />
        {PERFORMANCE_NOTICE}
      </p>

      <section aria-labelledby="desempenho-funil" className={cn(adminCard, "min-w-0")}>
        <CardHead id="desempenho-funil" meta={baseLabel} title={funnelTitle} />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 pt-3 text-xs leading-5 font-medium text-[var(--text-secondary)]">
          <span className="inline-flex items-center gap-2">
            <Swatch color={PRODUCT_ACCENTS[accent]} />
            {formation ? "Concluíram o curso" : "Concluíram o módulo"}
          </span>
          <span className="inline-flex items-center gap-2">
            <Swatch color="var(--text-tertiary)" />
            Iniciaram
          </span>
        </div>
        {funnel.length > 0 ? (
          <BarRows label={funnelTitle}>
            {funnel.map((row) => (
              <BarRow key={row.id} label={row.label} stacked value={<FunnelValue row={row} />} />
            ))}
          </BarRows>
        ) : (
          <p className="px-4 pt-3 pb-4 text-sm leading-5 text-[var(--text-secondary)]">
            {formation ? "Esta formação ainda não tem cursos." : "Este produto ainda não tem módulos."}
          </p>
        )}
      </section>

      <section aria-labelledby="desempenho-progresso" className={cn(adminCard, "min-w-0")}>
        <CardHead id="desempenho-progresso" meta={baseLabel} title="Progresso de quem tem acesso" />
        <BarRows dense label="Progresso de quem tem acesso">
          {PROGRESS_BANDS.map((band) => (
            <BarRow
              key={band.id}
              label={band.label}
              value={
                <>
                  <b className="min-w-7 text-right font-semibold text-[var(--text-primary)]">{EMPTY_VALUE}</b>
                  <span className="font-medium text-[var(--text-tertiary)]">alunos</span>
                </>
              }
            />
          ))}
        </BarRows>
      </section>

      <section aria-labelledby="desempenho-por-aula" className={cn(adminCard, "min-w-0 overflow-hidden")}>
        <CardHead id="desempenho-por-aula" meta={lessonTableMeta} title="Por aula" />
        <LessonTable formation={formation} lessons={lessons} />
        {lessons.length > 0 ? (
          <p className="border-t border-[var(--border-subtle)] px-4 py-2.5 text-xs leading-4 text-[var(--text-tertiary)]">{LESSON_DROP_NOTE}</p>
        ) : null}
      </section>
    </div>
  );
}

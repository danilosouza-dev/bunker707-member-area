import Link from "next/link";
import { cn } from "@/lib/utils";
import { ErrorBanner } from "../error-banner";
import { EMPTY_VALUE, formatKpiValue } from "../format";
import { AdminLinkButton } from "../link-button";
import { PendingMigrationNotice } from "../pending-migration-notice";
import { ProductThumb } from "../product-thumb";
import { adminCard, adminTransition } from "../styles";
import type { TodayDemoProduct } from "./today-demo";
import type { TodayByProductRow, TodayByProductState } from "./today-model";

type TodayByProductProps = {
  /** Numeros simulados por produto (ADMIN_DEMO_DATA=on, so localhost). */
  demo?: Record<string, TodayDemoProduct>;
  /** Periodo em minusculas, ao lado do titulo: "últimos 30 dias". */
  meta: string;
  retryHref: string;
  state: TodayByProductState;
};

// Colunas de estudo (Estudando, Conclusao, Tendencia, Ativos por semana) dependem do registro de aulas
// assistidas: "—" ate la. "Com acesso" e real (acessos ativos agora).
const studyColumns = ["Estudando", "Conclusão", "Tendência", "Ativos por semana"] as const;

// Em telas estreitas (barra lateral de 240 px ao lado) as duas ultimas colunas saem antes de o nome do produto
// virar reticencias: "Tendência" abaixo de 1024 px e "Ativos por semana" abaixo de 1280 px. No celular a
// tabela vira cartoes com tres numeros, como no prototipo.
const columnVisibility: Record<(typeof studyColumns)[number], string> = {
  "Ativos por semana": "hidden pr-4 xl:table-cell",
  Conclusão: "max-lg:pr-4",
  Estudando: "",
  Tendência: "hidden lg:table-cell max-xl:pr-4"
};

const rowEmphasis: Record<TodayByProductRow["emphasis"], string> = {
  dim: "[&>td]:opacity-45",
  highlight: "bg-[var(--surface-2)]",
  none: ""
};

function ProductCell({ row, linked }: { linked: boolean; row: TodayByProductRow }) {
  const name = (
    <span className="block truncate text-sm leading-5 font-medium text-[var(--text-primary)]" title={row.title}>
      {row.title}
    </span>
  );

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <ProductThumb accent={row.accent} className="size-7 rounded-md text-[11px]" coverUrl={row.coverUrl} title={row.title} />
      <div className="flex min-w-0 flex-col">
        {linked ? (
          <Link
            aria-label={`${row.title}: abrir Desempenho`}
            className="min-w-0 after:absolute after:inset-0 after:content-['']"
            data-navigation-feedback="false"
            href={row.href}
          >
            {name}
          </Link>
        ) : (
          name
        )}
        <span className="truncate text-xs leading-4 text-[var(--text-tertiary)]">{row.formatLabel}</span>
      </div>
    </div>
  );
}

const percentFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

function demoCell(column: (typeof studyColumns)[number], demo: TodayDemoProduct | undefined) {
  if (!demo) {
    return EMPTY_VALUE;
  }

  if (column === "Estudando") {
    return formatKpiValue(demo.studying);
  }

  if (column === "Conclusão") {
    return `${percentFormat.format(demo.completion)} %`;
  }

  if (column === "Tendência") {
    const arrow = demo.trend > 0 ? "↑" : demo.trend < 0 ? "↓" : "→";
    return (
      <span className={demo.trend > 0 ? "text-[var(--success)]" : demo.trend < 0 ? "text-[var(--error)]" : ""}>
        {arrow} {percentFormat.format(Math.abs(demo.trend))} %
      </span>
    );
  }

  const max = Math.max(...demo.weekly, 1);

  return (
    <span aria-label={`Ativos por semana: ${demo.weekly.join(", ")}`} className="inline-flex h-5 items-end gap-[3px]" role="img">
      {demo.weekly.map((value, index) => (
        <span className="w-[5px] rounded-[1px] bg-[var(--series-2)]" key={index} style={{ height: `${Math.max(12, (value / max) * 100)}%` }} />
      ))}
    </span>
  );
}

function ByProductTable({ demo, rows }: { demo?: Record<string, TodayDemoProduct>; rows: readonly TodayByProductRow[] }) {
  return (
    <table className="mt-2 hidden w-full table-fixed border-collapse text-sm text-[var(--text-secondary)] tabular-nums md:table">
      <caption className="sr-only">Produtos publicados com aulas: alunos com acesso e números de estudo</caption>
      <thead>
        <tr className="h-9 border-b border-[var(--border-subtle)] text-left text-xs font-medium text-[var(--text-tertiary)]">
          <th className="pr-3 pl-4 font-medium" scope="col">
            Produto
          </th>
          <th className="w-[104px] px-3 text-right font-medium xl:w-[120px]" scope="col">
            Com acesso
          </th>
          {studyColumns.map((column) => (
            <th
              className={cn(
                "px-3 text-right font-medium",
                column === "Ativos por semana" ? "w-[176px]" : "w-[104px] xl:w-[120px]",
                columnVisibility[column]
              )}
              key={column}
              scope="col"
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            className={cn(
              "relative h-12 border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--hover-overlay)]",
              adminTransition,
              rowEmphasis[row.emphasis]
            )}
            key={row.id}
          >
            <td className="min-w-0 pr-3 pl-4">
              <ProductCell linked row={row} />
            </td>
            <td className="px-3 text-right">{formatKpiValue(demo?.[row.id]?.studentsWithAccess ?? row.studentsWithAccess)}</td>
            {studyColumns.map((column) => (
              <td
                className={cn("px-3 text-right", demo?.[row.id] ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]", columnVisibility[column])}
                key={column}
              >
                {demoCell(column, demo?.[row.id])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Celular (< 768 px): cada produto vira um cartao com tres numeros rotulados. */
function ByProductList({ demo, rows }: { demo?: Record<string, TodayDemoProduct>; rows: readonly TodayByProductRow[] }) {
  return (
    <ul className="mt-2 md:hidden">
      {rows.map((row) => (
        <li
          className={cn(
            "relative grid grid-cols-3 gap-x-3 gap-y-2.5 border-b border-[var(--border-subtle)] px-4 py-3.5 last:border-b-0 hover:bg-[var(--hover-overlay)]",
            adminTransition,
            row.emphasis === "highlight" && "bg-[var(--surface-2)]",
            row.emphasis === "dim" && "[&>*]:opacity-45"
          )}
          key={row.id}
        >
          <div className="col-span-3 min-w-0">
            <ProductCell linked row={row} />
          </div>
          {[
            ["Com acesso", formatKpiValue(demo?.[row.id]?.studentsWithAccess ?? row.studentsWithAccess)],
            ["Estudando", demo?.[row.id] ? formatKpiValue(demo[row.id].studying) : EMPTY_VALUE],
            ["Conclusão", demo?.[row.id] ? `${percentFormat.format(demo[row.id].completion)} %` : EMPTY_VALUE]
          ].map(([label, value]) => (
            <div className="min-w-0" key={label}>
              <p className="text-xs leading-4 font-medium text-[var(--text-tertiary)]">{label}</p>
              <p className="mt-0.5 text-sm leading-5 text-[var(--text-secondary)] tabular-nums">{value}</p>
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}

/**
 * Linha 3 do Hoje, segundo card: os produtos publicados com aulas, os de mais alunos com acesso primeiro (ate 6).
 * A linha abre o Desempenho do produto; com um produto escolhido na barra superior, a linha dele fica
 * destacada e as outras apagadas.
 */
export function TodayByProduct({ demo, meta, retryHref, state }: TodayByProductProps) {
  return (
    <section aria-labelledby="hoje-por-produto" className={cn(adminCard, "min-w-0 overflow-hidden")}>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 pt-4">
        <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id="hoje-por-produto">
          Por produto
        </h2>
        <p className="text-xs leading-4 font-medium text-[var(--text-tertiary)]">{meta}</p>
      </div>

      {state.status === "ready" && state.rows.length > 0 ? (
        <>
          <ByProductTable demo={demo} rows={state.rows} />
          <ByProductList demo={demo} rows={state.rows} />
        </>
      ) : state.status === "ready" ? (
        <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
          <h3 className="text-sm leading-5 font-medium text-[var(--text-secondary)]">Nenhum produto publicado com aulas.</h3>
          <p className="max-w-[52ch] text-xs leading-4 font-medium text-[var(--text-tertiary)]">
            Um produto aparece aqui quando está publicado e tem pelo menos uma aula publicada.
          </p>
        </div>
      ) : state.status === "pending-migration" ? (
        <div className="px-4 pt-2 pb-4">
          <PendingMigrationNotice className="border-0 bg-transparent px-0" size="compact" />
        </div>
      ) : (
        <div className="p-4">
          <ErrorBanner
            action={
              <AdminLinkButton className="h-7 px-2.5 text-[13px]" href={retryHref} variant="secondary">
                Tentar de novo
              </AdminLinkButton>
            }
          >
            Não foi possível carregar os produtos agora.
          </ErrorBanner>
        </div>
      )}
    </section>
  );
}

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { adminCard } from "../../../styles";

// Pecas dos paineis de Webinarios (docs/30 §3.1) sem estado, desenhadas no servidor: a tabela com <caption> e
// <th scope="col"> no computador que vira cartoes <dl> abaixo de 768 px (sem rolagem lateral a 375 px; a primeira
// coluna vira o titulo do cartao), o cartao de numero em texto (a Receita, em moedas, que o KpiTile nao escreve) e o
// selo da sessao "Comeca quando voce entra". O mesmo desenho do relatorio do pop-up (popup-report-section.tsx).

export type PanelColumn<Row> = {
  align?: "right";
  cell: (row: Row) => ReactNode;
  header: string;
  id: string;
  /** Some no celular e no cartao (colunas extras do grafico, como as linhas finas por sessao). */
  wideOnly?: boolean;
};

const headerClass = "h-9 border-b border-[var(--border-subtle)] px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-[var(--text-tertiary)]";
const cellClass = "h-11 border-b border-[var(--border-subtle)] px-3 align-middle";

/** Tabela no computador; abaixo de 768 px, cada linha vira um cartao (<dl>) com a primeira coluna por cima. */
export function PanelDataTable<Row>({
  caption,
  captionVisible = false,
  className,
  columns,
  rowKey,
  rows
}: {
  caption: string;
  captionVisible?: boolean;
  className?: string;
  columns: readonly PanelColumn<Row>[];
  rowKey: (row: Row) => string;
  rows: readonly Row[];
}) {
  const [first, ...rest] = columns;
  const narrow = rest.filter((column) => !column.wideOnly);

  return (
    <div className={cn("min-w-0", className)} data-panel-table="">
      <div className="hidden min-w-0 overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm text-[var(--text-secondary)] tabular-nums">
          <caption className={captionVisible ? "pb-3 text-left text-base leading-6 font-semibold text-[var(--text-primary)]" : "sr-only"}>{caption}</caption>
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
              <tr className="last:[&>*]:border-b-0" key={rowKey(row)}>
                {columns.map((column) => (
                  <td className={cn(cellClass, column.align === "right" && "text-right whitespace-nowrap", column === first && "text-[var(--text-primary)]")} key={column.id}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={caption} className="flex min-w-0 flex-col divide-y divide-[var(--border-subtle)] md:hidden">
        {rows.map((row) => (
          <li className="min-w-0 py-2.5 first:pt-0 last:pb-0" key={rowKey(row)}>
            <dl className="flex min-w-0 flex-col gap-1 text-[13px] leading-5">
              <div className="flex min-w-0 flex-col">
                <dt className="sr-only">{first.header}</dt>
                <dd className="text-sm text-[var(--text-primary)] [overflow-wrap:anywhere]">{first.cell(row)}</dd>
              </div>
              {narrow.map((column) => (
                <div className="flex min-w-0 justify-between gap-3" key={column.id}>
                  <dt className="text-[var(--text-tertiary)]">{column.header}</dt>
                  <dd className="min-w-0 text-right text-[var(--text-secondary)] tabular-nums [overflow-wrap:anywhere]">{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Cartao de numero com o valor em texto (Receita: "R$ 1.234,56 · US$ 20,00"); mesmo desenho do KpiTile, sem delta. */
export function PanelTextTile({ definition, label, text }: { definition: string | null; label: string; text: string }) {
  const empty = text === "—";

  return (
    <div aria-label={[label, text, definition].filter(Boolean).join(", ")} className={cn(adminCard, "@container flex min-w-0 flex-col p-4")} role="group">
      <span className="min-w-0 truncate text-[13px] leading-5 font-medium text-[var(--text-secondary)] @max-[196px]:line-clamp-2 @max-[196px]:whitespace-normal">{label}</span>
      <span
        className={cn(
          "mt-3 min-w-0 text-[32px] leading-10 font-semibold tracking-[-0.02em] tabular-nums [overflow-wrap:anywhere] max-[479px]:text-[22px] max-[479px]:leading-8",
          empty ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]"
        )}
      >
        {text}
      </span>
      {definition ? <span className="mt-2 min-w-0 text-xs leading-4 font-medium text-[var(--text-tertiary)] @max-[196px]:line-clamp-2">{definition}</span> : null}
    </div>
  );
}

/** O selo da sessao que nasceu no "Comeca quando voce entra" (fase 4e). */
export function PanelJitBadge({ label }: { label: string }) {
  return (
    <span className="ml-2 inline-flex h-[22px] shrink-0 items-center rounded-md border border-[var(--border-strong)] px-1.5 align-middle text-[11px] leading-4 font-medium whitespace-nowrap text-[var(--text-secondary)]" data-jit="">
      {label}
    </span>
  );
}

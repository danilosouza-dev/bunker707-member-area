import Link from "next/link";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import { isAdminV2Href } from "./nav";
import { adminCard, adminTransition } from "./styles";

export type DataTableColumn<Row> = {
  /** Numeros alinham a direita, com digitos tabulares. */
  align?: "left" | "right";
  cell: (row: Row) => ReactNode;
  className?: string;
  /** Celula principal (nome legivel) em --text-primary; as demais ficam em --text-secondary. */
  emphasis?: boolean;
  header: ReactNode;
  headerClassName?: string;
  /** Some no cartao do celular (mobile="cards"). */
  hideOnMobile?: boolean;
  id: string;
  /** Rotulo da celula no cartao do celular (mobile="cards"). Sem rotulo, a celula ocupa a linha inteira. */
  mobileLabel?: string;
};

type DataTableProps<Row> = {
  /** Descricao da tabela para leitores de tela. */
  caption: string;
  className?: string;
  columns: readonly DataTableColumn<Row>[];
  emptyAction?: { href: string; label: string };
  emptyDescription?: string;
  emptyTitle?: string;
  /** Linha inteira clicavel: a primeira celula vira o link e cobre a linha (acoes da linha ficam por cima). */
  getRowHref?: (row: Row) => string;
  getRowKey: (row: Row) => string;
  loading?: boolean;
  loadingRowCount?: number;
  /**
   * Abaixo de 768 px: "scroll" (padrao) rola de lado; "cards" vira um cartao por linha, com a celula
   * principal em cima e as demais em 3 colunas rotuladas (`mobileLabel`).
   */
  mobile?: "scroll" | "cards";
  rows: readonly Row[];
};

// Medidas do prototipo aprovado: cabecalho de 36 px (12/500, --text-tertiary), linhas de 48 px,
// 12 px entre colunas e 16 px nas pontas; corpo 14 px em --text-secondary.
const cellPadding = "px-3 first:pl-4 last:pr-4";

const cardsTable = cn(
  "max-md:block max-md:[&_tbody]:block max-md:[&_thead]:hidden",
  "max-md:[&_tbody_tr]:grid max-md:[&_tbody_tr]:h-auto max-md:[&_tbody_tr]:grid-cols-3 max-md:[&_tbody_tr]:gap-x-3 max-md:[&_tbody_tr]:gap-y-2.5 max-md:[&_tbody_tr]:px-4 max-md:[&_tbody_tr]:py-3.5",
  "max-md:[&_tbody_td]:block max-md:[&_tbody_td]:h-auto max-md:[&_tbody_td]:p-0! max-md:[&_tbody_td]:text-left! max-md:[&_tbody_td]:whitespace-normal"
);

/**
 * Tabela densa do admin, com estados vazio e carregando. Paginacao e filtros ficam no servidor e no
 * endereco da pagina; aqui so a apresentacao.
 */
export function DataTable<Row>({
  caption,
  className,
  columns,
  emptyAction,
  emptyDescription,
  emptyTitle = "Nada por aqui ainda",
  getRowHref,
  getRowKey,
  loading = false,
  loadingRowCount = 5,
  mobile = "scroll",
  rows
}: DataTableProps<Row>) {
  const isEmpty = !loading && rows.length === 0;
  const asCards = mobile === "cards";

  return (
    <div aria-busy={loading || undefined} className={cn(adminCard, "min-w-0 overflow-hidden", className)}>
      <div className="relative w-full overflow-x-auto">
        <table className={cn("w-full border-collapse text-sm text-[var(--text-secondary)] tabular-nums", asCards && cardsTable)}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  className={cn(
                    "h-9 border-b border-[var(--border-subtle)] bg-[var(--surface-1)] text-left align-middle text-xs font-medium whitespace-nowrap text-[var(--text-tertiary)]",
                    cellPadding,
                    column.align === "right" && "text-right",
                    column.headerClassName
                  )}
                  key={column.id}
                  scope="col"
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: loadingRowCount }, (_, rowIndex) => (
                  <tr className="h-12 border-b border-[var(--border-subtle)] last:border-b-0" key={`loading-${rowIndex}`}>
                    {columns.map((column) => (
                      <td className={cn("align-middle", cellPadding)} key={column.id}>
                        <Skeleton
                          className={cn(
                            "h-4 bg-[var(--surface-2)] motion-reduce:animate-none",
                            column.align === "right" ? "ml-auto w-12" : "w-3/4 max-w-48"
                          )}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              : null}

            {isEmpty ? (
              <tr>
                <td className="p-0 whitespace-normal" colSpan={columns.length}>
                  <EmptyState
                    action={emptyAction}
                    description={emptyDescription}
                    headingLevel="h3"
                    size="compact"
                    title={emptyTitle}
                    variant="plain"
                  />
                </td>
              </tr>
            ) : null}

            {!loading
              ? rows.map((row) => {
                  const href = getRowHref?.(row);

                  return (
                    <tr
                      className={cn(
                        "h-12 border-b border-[var(--border-subtle)] last:border-b-0",
                        adminTransition,
                        href ? "relative cursor-pointer hover:bg-[var(--hover-overlay)]" : "hover:bg-[var(--hover-overlay)]"
                      )}
                      key={getRowKey(row)}
                    >
                      {columns.map((column, columnIndex) => {
                        const content = column.cell(row);
                        const cardFullWidth = asCards && (column.emphasis || !column.mobileLabel);

                        return (
                          <td
                            className={cn(
                              "align-middle whitespace-nowrap",
                              cellPadding,
                              column.align === "right" && "text-right tabular-nums",
                              column.emphasis && "text-[var(--text-primary)]",
                              asCards && column.hideOnMobile && "max-md:hidden!",
                              cardFullWidth && "max-md:col-span-full",
                              asCards &&
                                column.mobileLabel &&
                                "max-md:before:mb-0.5 max-md:before:block max-md:before:text-xs max-md:before:font-medium max-md:before:text-[var(--text-tertiary)] max-md:before:content-[attr(data-label)]",
                              column.className
                            )}
                            data-label={asCards ? column.mobileLabel : undefined}
                            key={column.id}
                          >
                            {href && columnIndex === 0 ? (
                              <Link
                                className="rounded-[4px] outline-offset-[-2px] after:absolute after:inset-0 after:content-['']"
                                data-navigation-feedback={isAdminV2Href(href) ? "false" : undefined}
                                href={href}
                              >
                                {content}
                              </Link>
                            ) : (
                              content
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              : null}
          </tbody>
        </table>
      </div>
      {loading ? <span className="sr-only">Carregando {caption.toLocaleLowerCase("pt-BR")}</span> : null}
    </div>
  );
}

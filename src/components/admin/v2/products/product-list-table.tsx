import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProductListItem } from "@/server/catalog/types";
import { EMPTY_VALUE } from "../format";
import { ProductThumb } from "../product-thumb";
import { situationTone, StatusChip } from "../status-chip";
import { adminCard, adminTransition } from "../styles";
import {
  buildProductListHref,
  describePageRange,
  formatFullDateTime,
  formatRelativeUpdated,
  pageCount,
  type ProductListFilters
} from "./list-filters";

// Tabela da lista de produtos na forma do prototipo aprovado: cabecalho de 36 px (12/500, cor
// terciaria), linhas de 48 px, 16 px de respiro nas pontas, corpo 14 em cor secundaria e o nome em
// cor primaria. Colunas: Produto · Situação · Quem pode ver · Com acesso · Aulas · Estudando (7 d) ·
// Atualizado. Cabe sem rolar: `table-fixed`, a partir de 900 px de cartao as larguras
// proporcionais do prototipo (abaixo, larguras fixas) e colunas que somem conforme a largura do proprio cartao (consulta de container). Abaixo de 560 px de cartao vira a lista de cartoes do
// prototipo (nome em cima e tres numeros rotulados: Situação, Com acesso, Aulas). A linha inteira
// abre o produto (link esticado sobre a linha).
//
// "Em breve" (produto so para quem tem acesso e sem link de compra) veio depois do prototipo: fica
// na coluna Quem pode ver, numa segunda linha em amarelo, porque e o que o visitante ve.

const COMING_SOON_TITLE = "Quem não tem acesso vê “Em breve”, porque o produto não tem link de compra.";
const headCell = "h-9 px-3 text-left text-xs leading-4 font-medium text-[var(--text-tertiary)] whitespace-nowrap";
const bodyCell = "px-3 align-middle";
const numberFormat = new Intl.NumberFormat("pt-BR");

function lessonsLabel(item: ProductListItem) {
  return `${item.lessonsPublished}/${item.lessonsTotal}`;
}

function AudienceCell({ item }: { item: ProductListItem }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate leading-5" title={item.audienceLabel}>
        {item.audienceLabel}
      </span>
      {item.comingSoon ? (
        <span className="truncate text-xs leading-4 font-medium text-[var(--warning)]" title={COMING_SOON_TITLE}>
          Mostra “Em breve”
        </span>
      ) : null}
    </span>
  );
}

export function ProductListTable({ items, now }: { items: readonly ProductListItem[]; now: Date }) {
  return (
    <div className="@container min-w-0">
      <div className={cn(adminCard, "hidden overflow-hidden @min-[560px]:block")}>
        <table className="w-full table-fixed border-collapse text-sm text-[var(--text-secondary)] tabular-nums">
          <caption className="sr-only">Produtos</caption>
          <thead>
            <tr className="border-b border-[var(--border-subtle)]">
              <th className={cn(headCell, "pl-4")} scope="col">
                Produto
              </th>
              <th className={cn(headCell, "w-[120px] @min-[900px]:w-[12%]")} scope="col">
                Situação
              </th>
              <th className={cn(headCell, "hidden w-[176px] @min-[900px]:w-[18%] @min-[780px]:table-cell")} scope="col">
                Quem pode ver
              </th>
              <th className={cn(headCell, "w-[100px] @min-[900px]:w-[9%] text-right")} scope="col" title="Alunos com acesso ativo agora.">
                Com acesso
              </th>
              <th className={cn(headCell, "w-[68px] @min-[900px]:w-[7%] text-right")} scope="col" title="Aulas publicadas / total de aulas.">
                Aulas
              </th>
              <th
                className={cn(headCell, "hidden w-[12%] text-right @min-[900px]:table-cell")}
                scope="col"
                title="Alunos que assistiram aulas deste produto nos últimos 7 dias. Aparece quando o registro de aulas assistidas estiver ativo."
              >
                Estudando (7 d)
              </th>
              <th className={cn(headCell, "hidden w-[124px] @min-[900px]:w-[13%] pr-4 @min-[680px]:table-cell")} scope="col">
                Atualizado
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                className={cn(
                  "relative h-12 border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--hover-overlay)] has-[a:focus-visible]:bg-[var(--hover-overlay)]",
                  adminTransition
                )}
                key={item.id}
              >
                <td className={cn(bodyCell, "pl-4")}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <ProductThumb accent={item.accent} coverUrl={item.coverUrl} size="xs" title={item.title} />
                    <div className="min-w-0">
                      <Link
                        className="block truncate rounded-sm leading-5 font-medium text-[var(--text-primary)] after:absolute after:inset-0 after:content-['']"
                        data-navigation-feedback="false"
                        href={`/admin/produtos/${item.id}`}
                        title={item.title}
                      >
                        {item.title}
                      </Link>
                      <span className="block truncate text-xs leading-4 text-[var(--text-tertiary)]">{item.formatLabel}</span>
                    </div>
                  </div>
                </td>
                <td className={bodyCell}>
                  <StatusChip tone={situationTone(item.situation)}>{item.situationLabel}</StatusChip>
                </td>
                <td className={cn(bodyCell, "hidden @min-[780px]:table-cell")}>
                  <AudienceCell item={item} />
                </td>
                <td className={cn(bodyCell, "text-right")}>{numberFormat.format(item.studentsWithAccess)}</td>
                <td className={cn(bodyCell, "text-right")} title={`${item.lessonsPublished} publicadas de ${item.lessonsTotal}`}>
                  {lessonsLabel(item)}
                </td>
                <td className={cn(bodyCell, "hidden text-right @min-[900px]:table-cell")}>
                  {item.studyingLast7d === null ? EMPTY_VALUE : numberFormat.format(item.studyingLast7d)}
                </td>
                <td className={cn(bodyCell, "hidden truncate pr-4 @min-[680px]:table-cell")} title={formatFullDateTime(item.updatedAt)}>
                  {formatRelativeUpdated(item.updatedAt, now)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label="Produtos" className={cn(adminCard, "divide-y divide-[var(--border-subtle)] overflow-hidden @min-[560px]:hidden")}>
        {items.map((item) => (
          <li className="relative" key={item.id}>
            <Link
              className={cn("grid grid-cols-3 gap-x-3 gap-y-2.5 px-4 py-3.5 hover:bg-[var(--hover-overlay)]", adminTransition)}
              data-navigation-feedback="false"
              href={`/admin/produtos/${item.id}`}
            >
              <span className="col-span-3 flex min-w-0 items-center gap-2.5">
                <ProductThumb accent={item.accent} coverUrl={item.coverUrl} size="xs" title={item.title} />
                <span className="min-w-0">
                  <span className="block truncate text-sm leading-5 font-medium text-[var(--text-primary)]">{item.title}</span>
                  <span className="block truncate text-xs leading-4 text-[var(--text-tertiary)]">
                    {item.formatLabel}
                    {item.comingSoon ? <span className="font-medium text-[var(--warning)]"> · Mostra “Em breve”</span> : null}
                  </span>
                </span>
              </span>
              <span className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="text-xs leading-4 font-medium text-[var(--text-tertiary)]">Situação</span>
                <StatusChip tone={situationTone(item.situation)}>{item.situationLabel}</StatusChip>
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs leading-4 font-medium text-[var(--text-tertiary)]">Com acesso</span>
                <span className="text-sm leading-6 text-[var(--text-secondary)] tabular-nums">{numberFormat.format(item.studentsWithAccess)}</span>
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs leading-4 font-medium text-[var(--text-tertiary)]">Aulas</span>
                <span className="text-sm leading-6 text-[var(--text-secondary)] tabular-nums">{lessonsLabel(item)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const pagerButton = cn(buttonVariants({ variant: "secondary" }), "gap-1 border-[var(--border-strong)] px-3");

type ProductListPaginationProps = {
  filters: ProductListFilters;
  page: number;
  pageSize: number;
  total: number;
};

export function ProductListPagination({ filters, page, pageSize, total }: ProductListPaginationProps) {
  const pages = pageCount(total, pageSize);

  return (
    <nav aria-label="Páginas de produtos" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[13px] text-[var(--text-secondary)] tabular-nums">{describePageRange(page, pageSize, total)}</p>
      {pages > 1 ? (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link className={pagerButton} data-navigation-feedback="false" data-slot="button" href={buildProductListHref(filters, { page: page - 1 })}>
              <ChevronLeft aria-hidden="true" className="size-4" />
              Anterior
            </Link>
          ) : (
            <span aria-disabled="true" className={cn(pagerButton, "pointer-events-none opacity-50")} data-slot="button">
              <ChevronLeft aria-hidden="true" className="size-4" />
              Anterior
            </span>
          )}
          {page < pages ? (
            <Link className={pagerButton} data-navigation-feedback="false" data-slot="button" href={buildProductListHref(filters, { page: page + 1 })}>
              Próxima
              <ChevronRight aria-hidden="true" className="size-4" />
            </Link>
          ) : (
            <span aria-disabled="true" className={cn(pagerButton, "pointer-events-none opacity-50")} data-slot="button">
              Próxima
              <ChevronRight aria-hidden="true" className="size-4" />
            </span>
          )}
        </div>
      ) : null}
    </nav>
  );
}

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { STUDENT_PACE_LABELS, lessonsProgressLabel, progressPercentOf, type StudentListItem } from "@/server/students/model";
import { DataTable, type DataTableColumn, type DataTableLeading } from "../data-table";
import { describePageRange, pageCount } from "../products/list-filters";
import { StatusChip } from "../status-chip";
import { formatRelativeDate, formatShortDate, paceTone } from "./format";
import { newStudentHref, studentHref, studentListHref, type StudentListFilters } from "./hrefs";
import { ProductChips } from "./product-chips";
import { StudentAvatar } from "./student-avatar";
import { RowSelectCheckbox, SelectAllCheckbox } from "./student-selection";

// Tabela de alunos (docs/17 §1.7.1): linha inteira abre o perfil. Colunas na ordem do prototipo:
// Aluno, Produtos, Ultimo estudo, Progresso, Ritmo, Entrou em. Apresentacao pura.

type StudentListTableProps = {
  canAdd: boolean;
  filtered: boolean;
  filters: StudentListFilters;
  now: number;
  rows: readonly StudentListItem[];
  /** Caixas de selecao para as acoes em massa (so para quem pode liberar acesso). */
  selectable?: boolean;
};

function cohortsLabel(row: StudentListItem, productId?: string) {
  const names = Array.from(new Set(row.cohorts.filter((membership) => !productId || membership.productId === productId).map((membership) => membership.cohortName)));

  if (names.length === 0) {
    return <span className="text-[var(--text-tertiary)]">—</span>;
  }

  return (
    <span className="truncate" title={names.join(", ")}>
      {names[0]}
      {names.length > 1 ? <span className="text-[var(--text-tertiary)]"> +{names.length - 1}</span> : null}
    </span>
  );
}

/** Barra curta e "7/24"; o texto completo ("7 de 24 aulas") fica no title e no leitor de tela. */
export function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const percent = progressPercentOf(completed, total);
  const label = lessonsProgressLabel(completed, total);

  return (
    <span className="flex min-w-0 items-center gap-2" title={label}>
      <span aria-hidden="true" className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <span className="block h-full rounded-full bg-[var(--text-primary)]" style={{ width: `${percent}%` }} />
      </span>
      <span aria-hidden="true" className="text-[13px] whitespace-nowrap tabular-nums">
        {total > 0 ? `${completed}/${total}` : "—"}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function buildColumns(now: number, productId?: string): DataTableColumn<StudentListItem>[] {
  return [
    {
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-3 max-md:pr-10">
          <StudentAvatar avatarUrl={row.avatarUrl} name={row.fullName} />
          <span className="block min-w-0 max-w-[240px]">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-[var(--text-primary)]">{row.fullName}</span>
              {row.isStaff ? <StatusChip tone="neutral">Equipe</StatusChip> : null}
            </span>
            <span className="block truncate text-xs text-[var(--text-tertiary)]">{row.email}</span>
          </span>
        </span>
      ),
      className: "min-w-[200px]",
      emphasis: true,
      header: "Aluno",
      id: "aluno"
    },
    {
      cell: (row) => <ProductChips max={1} products={row.products} />,
      header: "Produtos",
      id: "produtos",
      mobileLabel: "Produtos"
    },
    {
      cell: (row) => (
        <span className={cn(!row.lastStudiedAt && "text-[var(--warning)]")}>{formatRelativeDate(row.lastStudiedAt, now)}</span>
      ),
      header: (
        <span title="Data do último progresso gravado em uma aula (aproximado)">Último estudo</span>
      ),
      id: "ultimo-estudo",
      mobileLabel: "Último estudo"
    },
    {
      cell: (row) => <ProgressBar completed={row.completedLessons} total={row.totalLessons} />,
      header: "Progresso",
      id: "progresso",
      mobileLabel: "Progresso"
    },
    {
      cell: (row) => <StatusChip tone={paceTone(row.pace)}>{STUDENT_PACE_LABELS[row.pace]}</StatusChip>,
      header: "Ritmo",
      id: "ritmo",
      mobileLabel: "Ritmo"
    },
    {
      cell: (row) => cohortsLabel(row, productId),
      className: "max-w-[160px] max-2xl:hidden",
      header: "Turma",
      headerClassName: "max-2xl:hidden",
      hideOnMobile: true,
      id: "turma"
    },
    {
      cell: (row) => formatShortDate(row.createdAt),
      className: "max-2xl:hidden",
      header: "Entrou em",
      headerClassName: "max-2xl:hidden",
      hideOnMobile: true,
      id: "entrou-em"
    }
  ];
}

export function StudentListTable({ canAdd, filtered, filters, now, rows, selectable = false }: StudentListTableProps) {
  // A equipe nunca entra nas acoes em massa (o servidor tambem recusa): a linha fica sem caixa e o
  // "selecionar todos" conta so os alunos.
  const selectableIds = rows.filter((row) => !row.isStaff).map((row) => row.id);
  const leading: DataTableLeading<StudentListItem> | undefined = selectable
    ? {
        cell: (row) => (row.isStaff ? null : <RowSelectCheckbox id={row.id} label={row.fullName} />),
        header: selectableIds.length > 0 ? <SelectAllCheckbox ids={selectableIds} /> : null
      }
    : undefined;

  return (
    <>
      {selectable && selectableIds.length > 0 ? (
        <label className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)] md:hidden">
          <SelectAllCheckbox ids={selectableIds} />
          {selectableIds.length === 1 ? "Selecionar o aluno desta página" : `Selecionar os ${selectableIds.length} desta página`}
        </label>
      ) : null}
    <DataTable
      caption="Alunos"
      className={cn(selectable ? "max-md:[&_tbody_td:nth-child(2)]:col-span-full" : "max-md:[&_tbody_td:first-child]:col-span-full")}
      columns={buildColumns(now, filters.productId)}
      leading={leading}
      emptyAction={
        filtered
          ? { href: studentListHref(), label: "Limpar filtros" }
          : canAdd
            ? { href: newStudentHref(), label: "Adicionar aluno" }
            : undefined
      }
      emptyDescription={
        filtered
          ? "Nenhum aluno combina com esses filtros."
          : "Quando um aluno for adicionado por aqui ou por uma venda, ele aparece nesta lista."
      }
      emptyTitle={filtered ? `Nada encontrado${filters.q ? ` para “${filters.q}”` : ""}` : "Nenhum aluno ainda"}
      getRowHref={(row) => studentHref(row.id)}
      getRowKey={(row) => row.id}
      mobile="cards"
      rows={rows}
    />
    </>
  );
}

const pagerButton = cn(buttonVariants({ variant: "secondary" }), "gap-1 border-[var(--border-strong)] px-3");

type StudentListPaginationProps = {
  /** Endereco de cada pagina (a lista usa studentListHref; a aba do produto, o proprio endereco). */
  hrefFor: (page: number) => string;
  page: number;
  pageSize: number;
  total: number;
};

export function StudentListPagination({ hrefFor, page, pageSize, total }: StudentListPaginationProps) {
  const pages = pageCount(total, pageSize);

  return (
    <nav aria-label="Páginas de alunos" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[13px] text-[var(--text-secondary)] tabular-nums">{describePageRange(page, pageSize, total)}</p>
      {pages > 1 ? (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link className={pagerButton} data-navigation-feedback="false" data-slot="button" href={hrefFor(page - 1)}>
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
            <Link className={pagerButton} data-navigation-feedback="false" data-slot="button" href={hrefFor(page + 1)}>
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

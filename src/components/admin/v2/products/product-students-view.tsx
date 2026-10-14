import type { ProductAudience } from "@/server/catalog/model";
import { STUDENT_PACE_LABELS, type StudentListItem, type StudentListPage } from "@/server/students/model";
import { DataTable, type DataTableColumn } from "../data-table";
import { StatusChip } from "../status-chip";
import { formatRelativeDate, formatShortDate, paceTone, todayInputValue } from "../students/format";
import { studentHref } from "../students/hrefs";
import { ProductStudentsActions } from "../students/product-students-actions";
import { StudentAvatar } from "../students/student-avatar";
import { ProgressBar, StudentListPagination } from "../students/student-list-table";
import { describeStudentsWithAccess } from "./product-forms";

// Aba Alunos do produto (docs/17 §1.6.5): "N alunos com acesso" com as acoes a direita e a tabela
// dos alunos que veem este produto agora (progresso neste produto, ritmo, entrou em). Linha abre o
// perfil do aluno. Apresentacao pura; a pagina le o banco.

type ProductStudentsViewProps = {
  audience: ProductAudience;
  canAccess: boolean;
  list: StudentListPage;
  now: number;
  productId: string;
  productTitle: string;
};

function buildColumns(now: number): DataTableColumn<StudentListItem>[] {
  return [
    {
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-3">
          <StudentAvatar avatarUrl={row.avatarUrl} name={row.fullName} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-[var(--text-primary)]">{row.fullName}</span>
            <span className="block truncate text-xs text-[var(--text-tertiary)]">{row.email}</span>
          </span>
        </span>
      ),
      className: "min-w-[220px]",
      emphasis: true,
      header: "Aluno",
      id: "aluno"
    },
    { cell: (row) => formatRelativeDate(row.lastStudiedAt, now), header: "Último estudo", id: "ultimo-estudo", mobileLabel: "Último estudo" },
    { cell: (row) => <ProgressBar completed={row.completedLessons} total={row.totalLessons} />, className: "min-w-[170px]", header: "Progresso", id: "progresso", mobileLabel: "Progresso" },
    { cell: (row) => <StatusChip tone={paceTone(row.pace)}>{STUDENT_PACE_LABELS[row.pace]}</StatusChip>, header: "Ritmo", id: "ritmo", mobileLabel: "Ritmo" },
    { cell: (row) => formatShortDate(row.createdAt), header: "Entrou em", hideOnMobile: true, id: "entrou-em" }
  ];
}

export function ProductStudentsView({ audience, canAccess, list, now, productId, productTitle }: ProductStudentsViewProps) {
  const openToAll = audience === "all_students";
  const basePath = `/admin/produtos/${productId}/alunos`;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-h-9 flex-wrap items-center gap-3">
        <p className="text-sm leading-5 text-[var(--text-secondary)] tabular-nums">
          {openToAll ? "Aberto para todos os alunos" : describeStudentsWithAccess(list.total)}
        </p>
        {!openToAll && canAccess ? <ProductStudentsActions productId={productId} productTitle={productTitle} today={todayInputValue(now)} /> : null}
      </div>

      <DataTable
        caption="Alunos com acesso a este produto"
        className="max-md:[&_tbody_td:first-child]:col-span-full"
        columns={buildColumns(now)}
        emptyAction={openToAll ? { href: `/admin/produtos/${productId}/acesso`, label: "Mudar quem pode ver" } : undefined}
        emptyDescription={
          openToAll
            ? "Qualquer aluno da escola assiste a este produto, então não há lista de acesso."
            : canAccess
              ? "Use “Liberar acesso” para alunos que já existem ou “Adicionar aluno” para um novo."
              : "Ninguém recebeu este produto ainda."
        }
        emptyTitle={openToAll ? "Qualquer aluno da escola assiste a este produto" : "Ninguém com acesso ainda"}
        getRowHref={(row) => studentHref(row.id)}
        getRowKey={(row) => row.id}
        mobile="cards"
        rows={openToAll ? [] : list.items}
      />

      {!openToAll && list.total > list.pageSize ? (
        <StudentListPagination hrefFor={(page) => (page > 1 ? `${basePath}?pagina=${page}` : basePath)} page={list.page} pageSize={list.pageSize} total={list.total} />
      ) : null}
    </div>
  );
}

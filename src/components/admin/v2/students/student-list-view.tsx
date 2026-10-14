import { Plus } from "lucide-react";
import { describeStudentCount, type StudentListPage } from "@/server/students/model";
import { AdminLinkButton } from "../link-button";
import { PageHeader } from "../page-header";
import { hasActiveStudentFilters, newStudentHref, studentListHref, type StudentListFilters } from "./hrefs";
import { StudentListFiltersBar, type StudentFilterProduct } from "./student-list-filters";
import { StudentListPagination, StudentListTable } from "./student-list-table";

// Lista de alunos (docs/17 §1.7.1): cabecalho com o total e "Adicionar aluno", filtros, tabela e
// paginacao de 25. A pagina (src/app/admin/(v2)/alunos/page.tsx) le o banco e passa a lista.

type StudentListViewProps = {
  canAdd: boolean;
  filters: StudentListFilters;
  list: StudentListPage;
  now: number;
  products: readonly StudentFilterProduct[];
};

export function StudentListView({ canAdd, filters, list, now, products }: StudentListViewProps) {
  const filtered = hasActiveStudentFilters(filters);

  return (
    <>
      <PageHeader
        actions={
          canAdd ? (
            <AdminLinkButton className="gap-1.5" href={newStudentHref()}>
              <Plus aria-hidden="true" className="size-4" />
              Adicionar aluno
            </AdminLinkButton>
          ) : null
        }
        description={
          filtered
            ? `${describeStudentCount(list.total)} com esses filtros. O ritmo usa o último progresso gravado em aula.`
            : `${describeStudentCount(list.total)}. O ritmo usa o último progresso gravado em aula (aproximado).`
        }
        title="Alunos"
      />

      <div className="flex min-w-0 flex-col gap-4">
        <StudentListFiltersBar filters={filters} products={products} />
        <StudentListTable canAdd={canAdd} filtered={filtered} filters={filters} now={now} rows={list.items} />
        {list.total > list.pageSize || filtered ? (
          <StudentListPagination hrefFor={(page) => studentListHref(filters, { page })} page={list.page} pageSize={list.pageSize} total={list.total} />
        ) : null}
      </div>
    </>
  );
}

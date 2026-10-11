import { DataTable } from "../data-table";
import { AdminPage } from "../page-container";
import { PageHeaderSkeleton } from "../skeletons";

// Forma final de Pacotes: cabecalho e a tabela (as mesmas colunas, linhas carregando).

const columns = [
  { cell: () => null, header: "Pacote", id: "name" },
  { cell: () => null, header: "Produtos", headerClassName: "w-[248px]", id: "products" },
  { cell: () => null, header: "Turma", headerClassName: "w-[132px]", id: "cohort" },
  { cell: () => null, header: "Situação", headerClassName: "w-[120px]", id: "status" },
  { cell: () => null, header: "Atualizado", headerClassName: "w-[132px]", id: "updated" },
  { cell: () => null, header: "", headerClassName: "w-14", id: "actions" }
];

export function CombosSkeleton() {
  return (
    <AdminPage>
      <span aria-live="polite" className="sr-only" role="status">
        Carregando os pacotes
      </span>
      <PageHeaderSkeleton />
      <DataTable caption="Pacotes" className="[&_table]:table-fixed" columns={columns} getRowKey={() => ""} loading loadingRowCount={6} rows={[]} />
    </AdminPage>
  );
}

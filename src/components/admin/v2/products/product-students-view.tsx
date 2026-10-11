import { legacyStudentSearchHref } from "@/lib/admin-legacy-links";
import type { ProductAudience } from "@/server/catalog/model";
import { DataTable, type DataTableColumn } from "../data-table";
import { AdminLinkButton } from "../link-button";
import { describeStudentsWithAccess } from "./product-forms";

// Aba Alunos do produto (docs/17 §1.6.5) na disposicao do prototipo aprovado: a linha "N alunos com
// acesso" com a acao a direita e, embaixo, a tabela com as colunas da futura lista de alunos. A lista
// por produto chega com a nova tela de Alunos; ate la a tabela mostra o vazio honesto (nenhuma linha
// inventada) e liberar acesso continua no admin antigo. Apresentacao pura.

type ProductStudentsViewProps = {
  audience: ProductAudience;
  productId: string;
  studentsWithAccess: number;
};

type NoRow = never;

// Colunas do prototipo. Nenhuma linha e desenhada (rows = []); a ordem ja e a da tela futura.
const columns: DataTableColumn<NoRow>[] = [
  { cell: () => null, emphasis: true, header: "Aluno", id: "aluno" },
  { cell: () => null, header: "Produtos", hideOnMobile: true, id: "produtos" },
  { cell: () => null, header: "Último estudo", id: "ultimo-estudo", mobileLabel: "Último estudo" },
  { cell: () => null, header: "Progresso", id: "progresso", mobileLabel: "Progresso" },
  { cell: () => null, header: "Ritmo", id: "ritmo", mobileLabel: "Ritmo" },
  { cell: () => null, header: "Turma", hideOnMobile: true, id: "turma" },
  { cell: () => null, header: "Entrou em", hideOnMobile: true, id: "entrou-em" }
];

export function ProductStudentsView({ audience, productId, studentsWithAccess }: ProductStudentsViewProps) {
  const openToAll = audience === "all_students";

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-h-9 flex-wrap items-center gap-3">
        <p className="text-sm leading-5 text-[var(--text-secondary)] tabular-nums">
          {openToAll ? "Aberto para todos os alunos" : describeStudentsWithAccess(studentsWithAccess)}
        </p>
        {openToAll ? null : (
          <AdminLinkButton className="ml-auto" href={legacyStudentSearchHref("")} variant="secondary">
            Liberar acesso no admin antigo
          </AdminLinkButton>
        )}
      </div>

      <DataTable
        caption="Alunos com acesso a este produto"
        // No celular (cartoes) a celula do vazio ocupa a linha inteira.
        className="max-md:[&_tbody_td]:col-span-full"
        columns={columns}
        emptyAction={openToAll ? { href: `/admin/produtos/${productId}/acesso`, label: "Mudar quem pode ver" } : undefined}
        emptyDescription={
          openToAll
            ? "Qualquer aluno da escola assiste a este produto, então não há lista de acesso."
            : "A lista com nome, progresso e turma chega com a nova tela de Alunos. Por enquanto, ver e liberar acessos continua no admin antigo, em Alunos."
        }
        emptyTitle={openToAll ? "Qualquer aluno da escola assiste a este produto" : "A lista de alunos do produto está a caminho"}
        getRowKey={() => ""}
        mobile="cards"
        rows={[]}
      />
    </div>
  );
}

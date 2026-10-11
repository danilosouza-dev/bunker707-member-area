import { Package, Plus, SearchX } from "lucide-react";
import type { ProductListPage } from "@/server/catalog/types";
import { EmptyState } from "../empty-state";
import { AdminLinkButton } from "../link-button";
import { PageHeader } from "../page-header";
import { buildProductListHref, describeProductCount, hasActiveProductFilters, pageCount, type ProductListFilters } from "./list-filters";
import { ProductListFiltersBar } from "./product-list-filters";
import { ProductListPagination, ProductListTable } from "./product-list-table";

// Lista de produtos (docs/17 §1.6.1) na disposicao do prototipo aprovado: cabecalho com "N produtos"
// e as acoes Importar do YouTube + Novo produto; filtros a 24 px do cabecalho e a 12 px da tabela.
// Apresentacao pura: a pagina (src/app/admin/(v2)/produtos/page.tsx) le o banco e passa a lista.

type ProductListViewProps = {
  canWrite: boolean;
  list: ProductListPage;
  /** Hora da leitura, para o "Atualizado há..." (vem do servidor). */
  now: Date;
};

export function ProductListView({ canWrite, list, now }: ProductListViewProps) {
  const filters: ProductListFilters = { format: list.query.format, page: list.page, q: list.query.q, situation: list.query.situation };
  const filtered = hasActiveProductFilters(filters);

  return (
    <>
      <PageHeader
        actions={
          canWrite ? (
            <>
              <AdminLinkButton href="/admin/produtos/importar" variant="secondary">
                Importar do YouTube
              </AdminLinkButton>
              <AdminLinkButton href="/admin/produtos/novo">
                <Plus aria-hidden="true" className="size-4" />
                Novo produto
              </AdminLinkButton>
            </>
          ) : null
        }
        description={
          list.totalUnfiltered > 0 ? describeProductCount(list.totalUnfiltered) : "Cursos, formações, mentorias, bootcamps e materiais."
        }
        title="Produtos"
      />

      {list.totalUnfiltered === 0 ? (
        <EmptyState
          action={canWrite ? { href: "/admin/produtos/novo", label: "Novo produto" } : undefined}
          description={
            canWrite ? "Crie o primeiro ou importe uma playlist do YouTube." : "Quando a equipe criar produtos, eles aparecem aqui."
          }
          icon={Package}
          secondaryAction={canWrite ? { href: "/admin/produtos/importar", label: "Importar do YouTube" } : undefined}
          title="Você ainda não tem produtos."
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <ProductListFiltersBar filters={filters} />

          {list.total === 0 ? (
            <EmptyState
              action={{ href: "/admin/produtos", label: "Limpar filtros" }}
              description={filtered ? "Troque a situação, o formato ou a busca." : undefined}
              icon={SearchX}
              size="compact"
              title="Nenhum produto com esses filtros"
            />
          ) : list.items.length === 0 ? (
            <EmptyState
              action={{ href: buildProductListHref(filters, { page: 1 }), label: "Voltar para a primeira página" }}
              icon={SearchX}
              size="compact"
              title="Esta página não tem produtos"
            />
          ) : (
            <>
              <ProductListTable items={list.items} now={now} />
              {/* "1–25 de 80" so quando ajuda: mais de uma pagina ou lista filtrada (sem filtro, o total ja esta no cabecalho). */}
              {filtered || pageCount(list.total, list.pageSize) > 1 ? (
                <ProductListPagination filters={filters} page={list.page} pageSize={list.pageSize} total={list.total} />
              ) : null}
            </>
          )}
        </div>
      )}
    </>
  );
}

import { MessagesSquare, SearchX } from "lucide-react";
import type { Metadata } from "next";
import { CommentsTable } from "@/components/admin/v2/community/comments-table";
import { CommunityFilters } from "@/components/admin/v2/community/community-filters";
import { CommunityFrame, CommunityPendingMigration } from "@/components/admin/v2/community/community-frame";
import { clearFiltersHref, COMMUNITY_TAB_HREFS, hasActiveFilters } from "@/components/admin/v2/community/hrefs";
import { CommunityPagination } from "@/components/admin/v2/community/pagination";
import { EmptyState } from "@/components/admin/v2/empty-state";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { getCommunityFilterOptions, getCommunityStats, listComments } from "@/server/community/queries";
import { parseCommentListSearchParams } from "@/server/community/schemas";
import { communityFilterKeys, lessonPathFor, scopeCommunityFilterOptions, scopeCommunityParams } from "@/server/community/scope";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

export const metadata: Metadata = {
  title: "Comentários · Comunidade"
};

type CommunityCommentsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readNow() {
  return new Date().toISOString();
}

// Comunidade › Comentarios (docs/17 §1.9): todos os comentarios do periodo, mais novos primeiro, com
// filtros de produto, aula, situacao, resposta, periodo e busca; moderacao na linha e em massa.
export default async function CommunityCommentsPage({ searchParams }: CommunityCommentsPageProps) {
  const { access } = await requirePageArea("comunidade");
  const params = scopeCommunityParams(access, COMMUNITY_TAB_HREFS.comentarios, await searchParams);
  const query = parseCommentListSearchParams(params);
  const loaded = await loadUnlessPendingMigration(() =>
    Promise.all([
      getCommunityStats({ product: query.product }),
      listComments(query),
      getCommunityFilterOptions().then((options) => scopeCommunityFilterOptions(access, options))
    ])
  );

  if (!loaded.ok) {
    return <CommunityPendingMigration />;
  }

  const [stats, list, options] = loaded.data;
  const filtered = hasActiveFilters(params, communityFilterKeys(access, ["produto", "aula", "situacao", "respondido", "busca"]));

  return (
    <CommunityFrame
      stats={stats}
      toolbar={<CommunityFilters allowAllProducts={access.productIds === null} options={options} showAnswered showSearch showStatus />}
    >
      {list.total === 0 ? (
        filtered ? (
          <EmptyState
            action={{ href: clearFiltersHref(COMMUNITY_TAB_HREFS.comentarios, params), label: "Limpar filtros" }}
            description="Troque o produto, a aula, a situação ou o texto buscado."
            icon={SearchX}
            title="Nenhum comentário com esses filtros"
          />
        ) : (
          <EmptyState
            description={`Nenhum comentário de aluno ${query.period.inlineLabel}. Eles aparecem aqui assim que alguém comentar uma aula.`}
            icon={MessagesSquare}
            title="Nenhum comentário no período"
          />
        )
      ) : (
        <>
          <CommentsTable
            canModerate={can(access, "community.moderate")}
            items={list.items.map((item) => ({ ...item, path: lessonPathFor(access, item.path) }))}
            nowIso={readNow()}
          />
          <CommunityPagination
            itemLabel="comentários"
            page={list.page}
            pageSize={list.pageSize}
            pathname={COMMUNITY_TAB_HREFS.comentarios}
            searchParams={params}
            total={list.total}
          />
        </>
      )}
    </CommunityFrame>
  );
}

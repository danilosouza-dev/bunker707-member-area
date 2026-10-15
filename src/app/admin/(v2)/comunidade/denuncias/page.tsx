import { Flag, SearchX } from "lucide-react";
import type { Metadata } from "next";
import { CommunityFilters } from "@/components/admin/v2/community/community-filters";
import { CommunityFrame, CommunityPendingMigration } from "@/components/admin/v2/community/community-frame";
import { clearFiltersHref, COMMUNITY_TAB_HREFS, hasActiveFilters } from "@/components/admin/v2/community/hrefs";
import { CommunityPagination } from "@/components/admin/v2/community/pagination";
import { ReportList } from "@/components/admin/v2/community/report-list";
import { EmptyState } from "@/components/admin/v2/empty-state";
import { requirePageArea } from "@/server/auth/permissions";
import { can, communityScope } from "@/server/auth/roles";
import { getCommunityFilterOptions, getCommunityStats, listReportsPage } from "@/server/community/queries";
import { parseCommunitySearchParams } from "@/server/community/schemas";
import { communityFilterKeys, lessonPathFor, scopeCommunityFilterOptions, scopeCommunityParams } from "@/server/community/scope";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

export const metadata: Metadata = {
  title: "Denúncias · Comunidade"
};

type CommunityReportsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readNow() {
  return new Date().toISOString();
}

// Comunidade › Denuncias (docs/17 §1.9): comentarios denunciados, abertos primeiro, com motivo,
// contagem e historico. Sem ?periodo=, mostra todas; com ele, so as denunciadas no periodo.
export default async function CommunityReportsPage({ searchParams }: CommunityReportsPageProps) {
  const { access } = await requirePageArea("comunidade");
  const params = scopeCommunityParams(access, COMMUNITY_TAB_HREFS.denuncias, await searchParams);
  const query = parseCommunitySearchParams(params);
  const loaded = await loadUnlessPendingMigration(() =>
    Promise.all([
      getCommunityStats({ product: query.product }),
      listReportsPage(query),
      getCommunityFilterOptions().then((options) => scopeCommunityFilterOptions(access, options))
    ])
  );

  if (!loaded.ok) {
    return <CommunityPendingMigration />;
  }

  const [stats, reports, options] = loaded.data;
  const filtered = hasActiveFilters(params, communityFilterKeys(access, ["produto", "aula", "periodo"]));

  return (
    <CommunityFrame stats={stats} toolbar={<CommunityFilters allowAllProducts={communityScope(access) === null} options={options} periodMode="all-or-window" />}>
      {reports.total === 0 ? (
        filtered ? (
          <EmptyState
            action={{ href: clearFiltersHref(COMMUNITY_TAB_HREFS.denuncias, {}), label: "Limpar filtros" }}
            description="Nenhum comentário denunciado neste produto, aula ou período."
            icon={SearchX}
            title="Nenhuma denúncia com esses filtros"
          />
        ) : (
          <EmptyState
            description="Quando um aluno denunciar um comentário, ele aparece aqui com o motivo."
            icon={Flag}
            title="Nenhuma denúncia"
          />
        )
      ) : (
        <>
          <ReportList
            canModerate={can(access, "community.moderate")}
            items={reports.items.map((report) => ({ ...report, comment: { ...report.comment, path: lessonPathFor(access, report.comment.path) } }))}
            nowIso={readNow()}
          />
          <CommunityPagination
            itemLabel="denúncias"
            page={reports.page}
            pageSize={reports.pageSize}
            pathname={COMMUNITY_TAB_HREFS.denuncias}
            searchParams={params}
            total={reports.total}
          />
        </>
      )}
    </CommunityFrame>
  );
}

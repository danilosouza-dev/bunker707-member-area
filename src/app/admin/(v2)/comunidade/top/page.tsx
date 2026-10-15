import { Trophy } from "lucide-react";
import type { Metadata } from "next";
import { CommunityFilters } from "@/components/admin/v2/community/community-filters";
import { CommunityFrame, CommunityPendingMigration } from "@/components/admin/v2/community/community-frame";
import { COMMUNITY_TAB_HREFS } from "@/components/admin/v2/community/hrefs";
import { TopTable } from "@/components/admin/v2/community/top-table";
import { EmptyState } from "@/components/admin/v2/empty-state";
import { requirePageArea } from "@/server/auth/permissions";
import { COMMUNITY_STATS_WINDOW_DAYS } from "@/server/community/model";
import { getCommunityFilterOptions, getCommunityStats, listTopCommenters } from "@/server/community/queries";
import { parseCommunitySearchParams } from "@/server/community/schemas";
import { scopeCommunityFilterOptions, scopeCommunityParams } from "@/server/community/scope";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

export const metadata: Metadata = {
  title: "Top alunos · Comunidade"
};

type CommunityTopPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Comunidade › Top alunos (docs/17 §1.9): os 20 alunos que mais participam nos ultimos 28 dias
// (janela fixa, escrita no rotulo), filtravel por produto. "Enviar aviso" e "Marcar como embaixador"
// ficam para as fases de Comunicacao e Alunos.
export default async function CommunityTopPage({ searchParams }: CommunityTopPageProps) {
  const { access } = await requirePageArea("comunidade");
  const query = parseCommunitySearchParams(scopeCommunityParams(access, COMMUNITY_TAB_HREFS.top, await searchParams));
  const loaded = await loadUnlessPendingMigration(() =>
    Promise.all([
      getCommunityStats({ product: query.product }),
      listTopCommenters(query),
      getCommunityFilterOptions().then((options) => scopeCommunityFilterOptions(access, options))
    ])
  );

  if (!loaded.ok) {
    return <CommunityPendingMigration />;
  }

  const [stats, top, options] = loaded.data;

  return (
    <CommunityFrame
      stats={stats}
      toolbar={<CommunityFilters allowAllProducts={access.productIds === null} options={options} periodMode="none" showLesson={false} />}
    >
      {top.length === 0 ? (
        <EmptyState
          description={
            query.product
              ? `Nenhum aluno comentou as aulas deste produto nos últimos ${COMMUNITY_STATS_WINDOW_DAYS} dias.`
              : `O ranking aparece quando os alunos comentarem, responderem colegas ou receberem reações nos últimos ${COMMUNITY_STATS_WINDOW_DAYS} dias.`
          }
          icon={Trophy}
          title="Sem participação no período"
        />
      ) : (
        <TopTable items={top} windowDays={COMMUNITY_STATS_WINDOW_DAYS} />
      )}
    </CommunityFrame>
  );
}

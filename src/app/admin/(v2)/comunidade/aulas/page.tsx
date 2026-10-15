import { GraduationCap, SearchX } from "lucide-react";
import type { Metadata } from "next";
import { CommunityFilters } from "@/components/admin/v2/community/community-filters";
import { CommunityFrame, CommunityPendingMigration } from "@/components/admin/v2/community/community-frame";
import { clearFiltersHref, COMMUNITY_TAB_HREFS, hasActiveFilters } from "@/components/admin/v2/community/hrefs";
import { LessonRowsTable, LessonSortBar } from "@/components/admin/v2/community/lesson-rows-table";
import { CommunityPagination } from "@/components/admin/v2/community/pagination";
import { EmptyState } from "@/components/admin/v2/empty-state";
import { requirePageArea } from "@/server/auth/permissions";
import { communityScope } from "@/server/auth/roles";
import { getCommunityFilterOptions, getCommunityStats, listLessonCommunityRowsPage } from "@/server/community/queries";
import { parseLessonRowsSearchParams } from "@/server/community/schemas";
import { communityFilterKeys, lessonPathFor, scopeCommunityFilterOptions, scopeCommunityParams } from "@/server/community/scope";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

export const metadata: Metadata = {
  title: "Aulas · Comunidade"
};

type CommunityLessonsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Comunidade › Aulas (docs/17 §1.9 e §1.11): "Aulas com mais duvidas" e a avaliacao por aula na
// mesma tabela (sao a mesma linha por aula). Ordem no servidor: mais duvidas, piores ou melhores
// avaliacoes (estas so com avaliacoes; 20 respostas ou mais primeiro).
export default async function CommunityLessonsPage({ searchParams }: CommunityLessonsPageProps) {
  const { access } = await requirePageArea("comunidade");
  const params = scopeCommunityParams(access, COMMUNITY_TAB_HREFS.aulas, await searchParams);
  const query = parseLessonRowsSearchParams(params);
  const loaded = await loadUnlessPendingMigration(() =>
    Promise.all([
      getCommunityStats({ product: query.product }),
      listLessonCommunityRowsPage(query),
      getCommunityFilterOptions().then((options) => scopeCommunityFilterOptions(access, options))
    ])
  );

  if (!loaded.ok) {
    return <CommunityPendingMigration />;
  }

  const [stats, rows, options] = loaded.data;
  const filtered = hasActiveFilters(params, communityFilterKeys(access, ["produto"]));
  const byRating = query.sort !== "doubts";

  return (
    <CommunityFrame stats={stats} toolbar={<CommunityFilters allowAllProducts={communityScope(access) === null} options={options} showLesson={false} />}>
      <LessonSortBar active={query.sort} pathname={COMMUNITY_TAB_HREFS.aulas} searchParams={params} />
      {rows.total === 0 ? (
        filtered ? (
          <EmptyState
            action={{ href: clearFiltersHref(COMMUNITY_TAB_HREFS.aulas, params), label: "Ver todos os produtos" }}
            description={
              byRating
                ? "Nenhuma aula deste produto foi avaliada pelos alunos ainda."
                : `Nenhuma aula deste produto tem comentários, perguntas ao Tutor IA ou avaliações ${query.period.inlineLabel}.`
            }
            icon={SearchX}
            title={byRating ? "Nenhuma avaliação neste produto" : "Nenhuma dúvida neste produto"}
          />
        ) : (
          <EmptyState
            description={
              byRating
                ? "As aulas aparecem aqui quando os alunos escolherem Não gostei, Gostei ou Amei."
                : "As aulas aparecem aqui quando os alunos comentarem, perguntarem ao Tutor IA ou avaliarem."
            }
            icon={GraduationCap}
            title={byRating ? "Nenhuma aula avaliada ainda" : "Nenhuma dúvida no período"}
          />
        )
      ) : (
        <>
          <LessonRowsTable items={rows.items.map((row) => ({ ...row, path: lessonPathFor(access, row.path) }))} periodLabel={query.period.inlineLabel} />
          <CommunityPagination
            itemLabel="aulas"
            page={rows.page}
            pageSize={rows.pageSize}
            pathname={COMMUNITY_TAB_HREFS.aulas}
            searchParams={params}
            total={rows.total}
          />
        </>
      )}
    </CommunityFrame>
  );
}

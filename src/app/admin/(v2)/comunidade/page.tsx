import { CheckCircle2, SearchX } from "lucide-react";
import type { Metadata } from "next";
import { CommunityFilters } from "@/components/admin/v2/community/community-filters";
import { CommunityFrame, CommunityPendingMigration } from "@/components/admin/v2/community/community-frame";
import { clearFiltersHref, COMMUNITY_TAB_HREFS, hasActiveFilters } from "@/components/admin/v2/community/hrefs";
import { QueueKeyboardHint } from "@/components/admin/v2/community/keyboard-hint";
import { CommunityPagination } from "@/components/admin/v2/community/pagination";
import { QueueList } from "@/components/admin/v2/community/queue-list";
import { EmptyState } from "@/components/admin/v2/empty-state";
import { requirePageAdmin } from "@/server/auth/guards";
import { canRole } from "@/server/auth/roles";
import { getCommunityFilterOptions, getCommunityStats, listQuickReplies, listUnansweredQueue } from "@/server/community/queries";
import { parseCommunitySearchParams } from "@/server/community/schemas";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

export const metadata: Metadata = {
  title: "Comunidade"
};

type CommunityPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Hora da leitura, para o "há N h" sair igual no servidor e na hidratacao. */
function readNow() {
  return new Date().toISOString();
}

// Comunidade › Precisam de resposta (docs/17 §1.9): perguntas de alunos sem resposta do professor,
// mais antigas primeiro, 20 por pagina. Sem ?periodo=, mostra tudo o que esta aberto.
export default async function CommunityQueuePage({ searchParams }: CommunityPageProps) {
  const { role } = await requirePageAdmin();
  const params = await searchParams;
  const query = parseCommunitySearchParams(params);
  const canReply = canRole(role, "community.reply");
  const loaded = await loadUnlessPendingMigration(() =>
    Promise.all([
      getCommunityStats({ product: query.product }),
      listUnansweredQueue(query),
      getCommunityFilterOptions(),
      canReply ? listQuickReplies() : Promise.resolve([])
    ])
  );

  if (!loaded.ok) {
    return <CommunityPendingMigration />;
  }

  const [stats, queue, options, quickReplies] = loaded.data;
  const filtered = hasActiveFilters(params, ["produto", "aula", "periodo"]);

  return (
    <CommunityFrame
      stats={stats}
      toolbar={
        <CommunityFilters aside={<QueueKeyboardHint />} options={options} periodMode="all-or-window" />
      }
    >
      {queue.total === 0 ? (
        filtered ? (
          <EmptyState
            action={{ href: clearFiltersHref(COMMUNITY_TAB_HREFS.fila, {}), label: "Limpar filtros" }}
            description="Nenhuma pergunta sem resposta neste produto, aula ou período."
            icon={SearchX}
            title="Nada esperando com esses filtros"
          />
        ) : (
          <EmptyState
            description="Nenhuma pergunta esperando. Quando um aluno comentar uma aula, a pergunta aparece aqui, a mais antiga primeiro."
            icon={CheckCircle2}
            title="Tudo respondido"
          />
        )
      ) : (
        <>
          <QueueList
            canModerate={canRole(role, "community.moderate")}
            canReply={canReply}
            items={queue.items}
            nowIso={readNow()}
            quickReplies={quickReplies}
          />
          <CommunityPagination
            itemLabel="perguntas"
            page={queue.page}
            pageSize={queue.pageSize}
            pathname={COMMUNITY_TAB_HREFS.fila}
            searchParams={params}
            total={queue.total}
          />
        </>
      )}
    </CommunityFrame>
  );
}

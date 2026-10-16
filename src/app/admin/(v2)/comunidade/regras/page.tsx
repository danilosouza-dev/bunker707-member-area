import type { Metadata } from "next";
import { BlockedWordsSection } from "@/components/admin/v2/community/blocked-words-section";
import { CommunityFrame, CommunityPendingMigration } from "@/components/admin/v2/community/community-frame";
import { COMMUNITY_TAB_HREFS } from "@/components/admin/v2/community/hrefs";
import { QuickRepliesSection } from "@/components/admin/v2/community/quick-replies-section";
import { requirePageArea } from "@/server/auth/permissions";
import { can, communityScope } from "@/server/auth/roles";
import { getCommunityRules, getCommunityStats } from "@/server/community/queries";
import { parseCommunitySearchParams } from "@/server/community/schemas";
import { scopeCommunityParams } from "@/server/community/scope";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

export const metadata: Metadata = {
  title: "Regras · Comunidade"
};

type CommunityRulesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Comunidade › Regras (docs/17 §1.9): respostas rapidas da fila e palavras bloqueadas. Aprovacao
// automatica e resumo diario por e-mail ficam para depois (docs/17 §1.14 e plano da fase 1, secao 7).
export default async function CommunityRulesPage({ searchParams }: CommunityRulesPageProps) {
  const { access } = await requirePageArea("comunidade");
  const query = parseCommunitySearchParams(scopeCommunityParams(access, COMMUNITY_TAB_HREFS.regras, await searchParams));
  // Respostas prontas e palavras bloqueadas valem para a escola toda: quem tem acesso so a alguns cursos so le.
  const schoolWide = communityScope(access) === null;
  const loaded = await loadUnlessPendingMigration(() =>
    Promise.all([getCommunityStats({ product: query.product }), getCommunityRules()])
  );

  if (!loaded.ok) {
    return <CommunityPendingMigration />;
  }

  const [stats, rules] = loaded.data;

  return (
    <CommunityFrame stats={stats}>
      <div className="flex min-w-0 flex-col gap-4">
        <QuickRepliesSection canEdit={schoolWide && can(access, "community.reply")} items={rules.quickReplies} />
        <BlockedWordsSection canEdit={schoolWide && can(access, "community.moderate")} items={rules.blockedWords} />
      </div>
    </CommunityFrame>
  );
}

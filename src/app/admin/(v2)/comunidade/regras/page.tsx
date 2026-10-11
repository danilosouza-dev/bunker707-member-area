import type { Metadata } from "next";
import { BlockedWordsSection } from "@/components/admin/v2/community/blocked-words-section";
import { CommunityFrame, CommunityPendingMigration } from "@/components/admin/v2/community/community-frame";
import { QuickRepliesSection } from "@/components/admin/v2/community/quick-replies-section";
import { requirePageAdmin } from "@/server/auth/guards";
import { canRole } from "@/server/auth/roles";
import { getCommunityRules, getCommunityStats } from "@/server/community/queries";
import { parseCommunitySearchParams } from "@/server/community/schemas";
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
  const { role } = await requirePageAdmin();
  const query = parseCommunitySearchParams(await searchParams);
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
        <QuickRepliesSection canEdit={canRole(role, "community.reply")} items={rules.quickReplies} />
        <BlockedWordsSection canEdit={canRole(role, "community.moderate")} items={rules.blockedWords} />
      </div>
    </CommunityFrame>
  );
}

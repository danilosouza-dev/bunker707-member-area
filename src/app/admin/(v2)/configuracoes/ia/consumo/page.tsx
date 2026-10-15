import type { Metadata } from "next";
import { ErrorBanner } from "@/components/admin/v2/error-banner";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { readAdminPeriod, type ResolvedAdminPeriod } from "@/components/admin/v2/period";
import { AiUsageView } from "@/components/admin/v2/settings/ai-usage-view";
import { AI_USAGE_BETWEEN_MIGRATION, getAIUsageSummaryBetween } from "@/server/ai/usage-analytics";
import { requirePageRole } from "@/server/auth/permissions";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

export const metadata: Metadata = {
  title: "Tutor IA · Consumo"
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function loadUsage(period: ResolvedAdminPeriod) {
  // "Hoje" lido exatamente a meia-noite teria inicio = fim; o banco exige um intervalo nao vazio.
  const end = period.end.getTime() > period.start.getTime() ? period.end : new Date(period.start.getTime() + 1_000);

  try {
    return {
      loaded: await loadUnlessPendingMigration(() =>
        getAIUsageSummaryBetween({ end, granularity: period.granularity, start: period.start })
      ),
      ok: true as const
    };
  } catch (error) {
    console.error("[admin/configuracoes/ia/consumo]", error);
    return { ok: false as const };
  }
}

// O periodo vem do menu "Período" da barra superior (?periodo=hoje|1d|3d|7d|30d ou um intervalo do
// calendario; links antigos 7|30|90 continuam valendo), lido com a mesma hora que vai para a tela.
export default async function AdminAiUsagePage({ searchParams }: PageProps) {
  const [, params] = await Promise.all([requirePageRole("settings.ai", "/admin/configuracoes"), searchParams]);
  const now = new Date();
  const period = readAdminPeriod(params, now);
  const data = await loadUsage(period);

  if (!data.ok) {
    return (
      <ErrorBanner title="Não foi possível carregar o consumo">
        Recarregue a página em instantes. Se continuar, confira a conexão com o banco de dados.
      </ErrorBanner>
    );
  }

  if (!data.loaded.ok) {
    return <PendingMigrationNotice migration={AI_USAGE_BETWEEN_MIGRATION} size="compact" />;
  }

  return <AiUsageView key={period.param} nowIso={now.toISOString()} param={period.param} summary={data.loaded.data} />;
}

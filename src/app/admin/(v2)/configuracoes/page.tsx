import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { summarizeAiSetup } from "@/components/admin/v2/settings/ai-settings-model";
import { SettingsHub, type SettingsHubStatus } from "@/components/admin/v2/settings/settings-hub";
import { listAIProviderConfigs } from "@/server/ai/provider-config";
import { listAIProviderConnections } from "@/server/ai/provider-connections";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { summarizeSalesSetup } from "@/server/payments/model";
import { getSalesProviderStatuses } from "@/server/payments/queries";
import { listTeamMembers } from "@/server/team/queries";

export const metadata: Metadata = {
  title: "Configurações"
};

/** Estado do Tutor IA para a linha do hub. Sem leitura, a linha fica sem estado (nunca um palpite). */
async function loadAiStatus(): Promise<SettingsHubStatus | null> {
  try {
    const [configs, connections] = await Promise.all([listAIProviderConfigs(), listAIProviderConnections()]);

    return summarizeAiSetup(configs, connections);
  } catch (error) {
    console.error("[admin/configuracoes] estado do Tutor IA", error);
    return null;
  }
}

/** Quantas pessoas ha na equipe (linha da Equipe). Sem leitura, a linha fica sem contagem. */
async function loadTeamCount(): Promise<number | null> {
  try {
    const members = await listTeamMembers();

    return members.length;
  } catch (error) {
    console.error("[admin/configuracoes] contagem da equipe", error);
    return null;
  }
}

/** Situacao das plataformas de venda (linha Vendas). Sem leitura, a linha fica sem estado (nunca um palpite). */
async function loadSalesStatus(): Promise<SettingsHubStatus | null> {
  try {
    return summarizeSalesSetup(await getSalesProviderStatuses());
  } catch (error) {
    console.error("[admin/configuracoes] estado das vendas", error);
    return null;
  }
}

export default async function AdminSettingsPage() {
  const { access } = await requirePageArea("configuracoes");
  const canAi = can(access, "settings.ai");
  const canSales = can(access, "settings.sales");
  const canTeam = can(access, "settings.team");
  const [aiStatus, teamCount, salesStatus] = await Promise.all([
    canAi ? loadAiStatus() : Promise.resolve(null),
    canTeam ? loadTeamCount() : Promise.resolve(null),
    canSales ? loadSalesStatus() : Promise.resolve(null)
  ]);

  return (
    <AdminPage className="gap-6">
      <PageHeader description="Equipe, vídeo, Tutor IA, vendas, canais de envio e dados da escola." title="Configurações" />
      <SettingsHub access={{ canAi, canSales, canTeam, teamCount }} aiStatus={aiStatus} salesStatus={salesStatus} />
    </AdminPage>
  );
}

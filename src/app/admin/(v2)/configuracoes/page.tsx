import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { summarizeAiSetup } from "@/components/admin/v2/settings/ai-settings-model";
import { SettingsHub, type SettingsHubStatus } from "@/components/admin/v2/settings/settings-hub";
import { listAIProviderConfigs } from "@/server/ai/provider-config";
import { listAIProviderConnections } from "@/server/ai/provider-connections";
import { requirePageAdmin } from "@/server/auth/guards";

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

export default async function AdminSettingsPage() {
  await requirePageAdmin();
  const aiStatus = await loadAiStatus();

  return (
    <AdminPage className="gap-6">
      <PageHeader description="Equipe, vídeo, Tutor IA, vendas, canais de envio e dados da escola." title="Configurações" />
      <SettingsHub aiStatus={aiStatus} />
    </AdminPage>
  );
}

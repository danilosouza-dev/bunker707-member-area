import type { Metadata } from "next";
import { ErrorBanner } from "@/components/admin/v2/error-banner";
import { AiConnectionsManager } from "@/components/admin/v2/settings/ai-connections-manager";
import { parseAiProviderParam } from "@/components/admin/v2/settings/ai-settings-model";
import { getAccountGatewayConfigurationStatus } from "@/server/ai/account-gateway";
import { listAIProviderConfigs } from "@/server/ai/provider-config";
import { listAIProviderConnections } from "@/server/ai/provider-connections";
import { requirePageRole } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";

export const metadata: Metadata = {
  title: "Tutor IA · Conexões"
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function loadConnectionsData() {
  try {
    const [configs, connections] = await Promise.all([listAIProviderConfigs(), listAIProviderConnections()]);

    return {
      configs,
      connections: connections.map((connection) => ({
        authMode: connection.authMode,
        cooldownUntil: connection.cooldownUntil,
        credentialHint: connection.credentialHint,
        healthTier: connection.healthTier,
        id: connection.id,
        label: connection.label,
        lastErrorMessage: connection.lastErrorMessage,
        lastTestedAt: connection.lastTestedAt,
        lastUsedAt: connection.lastUsedAt,
        priority: connection.priority,
        provider: connection.provider,
        status: connection.status
      })),
      ok: true as const
    };
  } catch (error) {
    console.error("[admin/configuracoes/ia/conexoes]", error);
    return { ok: false as const };
  }
}

export default async function AdminAiConnectionsPage({ searchParams }: PageProps) {
  const [{ access }, params] = await Promise.all([requirePageRole("settings.ai", "/admin/configuracoes"), searchParams]);
  const provider = parseAiProviderParam(params.provedor);
  const data = await loadConnectionsData();

  if (!data.ok) {
    return (
      <ErrorBanner title="Não foi possível carregar as conexões">
        Recarregue a página em instantes. Se continuar, confira a conexão com o banco de dados.
      </ErrorBanner>
    );
  }

  // So a configuracao (sem rede): se o servico de contas responde, a tela pergunta depois de aparecer.
  const gateway = getAccountGatewayConfigurationStatus();

  return (
    <AiConnectionsManager
      canEdit={can(access, "settings.ai")}
      configs={data.configs}
      connections={data.connections}
      gatewayConfigured={gateway.configured}
      key={provider}
      provider={provider}
    />
  );
}

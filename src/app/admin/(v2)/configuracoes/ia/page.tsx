import type { Metadata } from "next";
import { ErrorBanner } from "@/components/admin/v2/error-banner";
import { AiPolicyEditor } from "@/components/admin/v2/settings/ai-policy-editor";
import { parseAiProviderParam } from "@/components/admin/v2/settings/ai-settings-model";
import { listAIProviderConfigs } from "@/server/ai/provider-config";
import { listAIProviderConnections } from "@/server/ai/provider-connections";
import { requirePageAdmin } from "@/server/auth/guards";
import { canRole } from "@/server/auth/roles";

export const metadata: Metadata = {
  title: "Tutor IA · Modelos e limites"
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function loadPolicyData() {
  try {
    const [configs, connections] = await Promise.all([listAIProviderConfigs(), listAIProviderConnections()]);

    return {
      configs,
      connections: connections.map(({ authMode, provider, status }) => ({ authMode, provider, status })),
      ok: true as const
    };
  } catch (error) {
    console.error("[admin/configuracoes/ia] modelos", error);
    return { ok: false as const };
  }
}

export default async function AdminAiModelsPage({ searchParams }: PageProps) {
  const [{ role }, params] = await Promise.all([requirePageAdmin(), searchParams]);
  const provider = parseAiProviderParam(params.provedor);
  const data = await loadPolicyData();

  if (!data.ok) {
    return (
      <ErrorBanner title="Não foi possível carregar o Tutor IA">
        Recarregue a página em instantes. Se continuar, confira a conexão com o banco de dados.
      </ErrorBanner>
    );
  }

  return (
    <AiPolicyEditor
      canEdit={canRole(role, "settings.ai")}
      configs={data.configs}
      connections={data.connections}
      key={provider}
      provider={provider}
    />
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { AiSettingsTabs } from "@/components/admin/v2/settings/ai-settings-tabs";

export const metadata: Metadata = {
  title: "Tutor IA"
};

const BREADCRUMB = [{ href: "/admin/configuracoes", label: "Configurações" }, { label: "Tutor IA" }] as const;

// Moldura de Configurações › Tutor IA: migalha (tela interna de Configurações), cabecalho e abas. Nao
// le dados (cada page.tsx chama o guard e carrega o seu), entao o cabecalho aparece na hora e so o
// conteudo da aba mostra o skeleton.
export default function AdminAiSettingsLayout({ children }: { children: ReactNode }) {
  return (
    <AdminPage className="gap-6">
      <div className="flex flex-col gap-4">
        <PageHeader
          breadcrumb={BREADCRUMB}
          description="Provedores, limites, conexões e consumo do Tutor IA das aulas e do Diretor."
          title="Tutor IA"
        />
        <AiSettingsTabs />
      </div>
      {children}
    </AdminPage>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { StorefrontTabs } from "@/components/admin/v2/storefront/storefront-tabs";

export const metadata: Metadata = {
  title: "Área de membros"
};

// Moldura da Área de membros: cabecalho e abas (Vitrine, Destaque, Modulos, Login, Marca). Nao le
// dados; cada page.tsx chama o guard e carrega o seu, entao o cabecalho aparece na hora e so o
// conteudo da aba carrega.
export default function AdminStorefrontLayout({ children }: { children: ReactNode }) {
  return (
    <AdminPage className="gap-6">
      <div className="flex flex-col gap-4">
        <PageHeader
          description="O que o aluno vê: a página de entrar, o topo e as fileiras da home, os módulos dos cursos e a logo da escola."
          title="Área de membros"
        />
        <StorefrontTabs />
      </div>
      {children}
    </AdminPage>
  );
}

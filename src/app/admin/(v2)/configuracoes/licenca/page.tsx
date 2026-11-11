import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ErrorBanner } from "@/components/admin/v2/error-banner";
import { LicenseScreen } from "@/components/admin/v2/license/license-screen";
import { HeldSalesCard } from "@/components/admin/v2/settings/sales/held-sales-card";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { requirePageArea } from "@/server/auth/permissions";
import { getConfiguredSiteOrigin } from "@/server/auth/site-origin";
import { activateLicense, checkLicenseNow, deactivateLicense, uploadLicenseFile } from "@/server/licensing/actions";
import { isLicenseManager } from "@/server/licensing/admin-access";
import { licensingMode } from "@/server/licensing/build-config";
import { readLicenseOverview } from "@/server/licensing/current-state";
import { parseLicenseScreenNotice } from "@/server/licensing/screen-result";
import { licenseScreenView } from "@/server/licensing/screen-view";
import { getHeldSalesOverview, type HeldSalesOverview } from "@/server/payments/held-sales-queries";

export const metadata: Metadata = {
  title: "Licença"
};

// A ativacao fala com o Emissor duas vezes (ate 15 s cada): as Server Actions desta tela rodam com folga.
export const maxDuration = 60;

const BREADCRUMB = [{ href: "/admin/configuracoes", label: "Configurações" }, { label: "Licença" }] as const;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** As vendas guardadas (docs/32 §2.2), para o dono e os administradores. A leitura que falha so tira a lista. */
async function readHeldSales(): Promise<HeldSalesOverview | null> {
  try {
    return await getHeldSalesOverview();
  } catch (error) {
    console.error("[licenca] vendas guardadas:", error instanceof Error ? error.message : error);
    return null;
  }
}

// Configuracoes > Licenca (docs/32 §2.4): so no produto vendido (modo "enforce"; no "off", a tela nao existe e nenhum
// menu a mostra) e so para o dono e os administradores. Fica aberta em todo degrau, inclusive na Instalacao nunca
// ativada: a pagina nao passa pela classe de acao, e as acoes dela sao dever legal (src/server/licensing/actions.ts).
// Embaixo, a lista das vendas guardadas (docs/32 §2.2), quando ha alguma: o e-mail da equipe e a faixa levam para ela.
export default async function LicenseSettingsPage({ searchParams }: PageProps) {
  if (licensingMode() !== "enforce") {
    notFound();
  }

  const [{ access }, query] = await Promise.all([requirePageArea("configuracoes"), searchParams]);

  if (!isLicenseManager(access)) {
    redirect("/admin/configuracoes");
  }

  const header = (
    <PageHeader
      breadcrumb={BREADCRUMB}
      description="A Licença do Bunker Members nesta área de membros: a situação, o que ela liga e a conferência com o Emissor de licenças."
      title="Licença"
    />
  );
  // A leitura que falha (a migracao pendente, o banco com erro) nao derruba a tela: ela diz o que houve.
  const heldSalesRead = readHeldSales();
  const overview = await readLicenseOverview();
  const heldSales = await heldSalesRead;

  if (!overview) {
    return (
      <AdminPage className="gap-6">
        {header}
        <ErrorBanner title="Não foi possível ler a Licença agora">
          Enquanto isso, os módulos ficam escondidos e só funciona o que a lei e a segurança pedem. Quem já é aluno continua com o acesso que tem.
          Recarregue a página em alguns minutos; se continuar assim, fale com o suporte.
        </ErrorBanner>
        {heldSales ? <HeldSalesCard overview={heldSales} /> : null}
      </AdminPage>
    );
  }

  const view = licenseScreenView({ ...overview, configuredHost: getConfiguredSiteOrigin(), version: process.env.APP_VERSION ?? null });

  if (!view) {
    notFound();
  }

  return (
    <AdminPage className="gap-6">
      {header}
      <LicenseScreen
        actions={{ activate: activateLicense, checkNow: checkLicenseNow, deactivate: deactivateLicense, uploadFile: uploadLicenseFile }}
        notice={parseLicenseScreenNotice(query)}
        view={view}
      />
      {heldSales ? <HeldSalesCard overview={heldSales} /> : null}
    </AdminPage>
  );
}

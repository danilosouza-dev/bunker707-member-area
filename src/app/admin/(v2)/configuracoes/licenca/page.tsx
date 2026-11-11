import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LicenseScreen } from "@/components/admin/v2/license/license-screen";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { requirePageArea } from "@/server/auth/permissions";
import { getConfiguredSiteOrigin } from "@/server/auth/site-origin";
import { activateLicense, checkLicenseNow, deactivateLicense, uploadLicenseFile } from "@/server/licensing/actions";
import { isLicenseManager } from "@/server/licensing/admin-access";
import { licensingMode } from "@/server/licensing/build-config";
import { getLicenseOverview } from "@/server/licensing/current-state";
import { parseLicenseScreenNotice } from "@/server/licensing/screen-result";
import { licenseScreenView } from "@/server/licensing/screen-view";

export const metadata: Metadata = {
  title: "Licença"
};

// A ativacao fala com o Emissor duas vezes (ate 15 s cada): as Server Actions desta tela rodam com folga.
export const maxDuration = 60;

const BREADCRUMB = [{ href: "/admin/configuracoes", label: "Configurações" }, { label: "Licença" }] as const;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Configuracoes > Licenca (docs/32 §2.4): so no produto vendido (modo "enforce"; no "off", a tela nao existe e nenhum
// menu a mostra) e so para o dono e os administradores. Fica aberta em todo degrau, inclusive na Instalacao nunca
// ativada: a pagina nao passa pela classe de acao, e as acoes dela sao dever legal (src/server/licensing/actions.ts).
export default async function LicenseSettingsPage({ searchParams }: PageProps) {
  if (licensingMode() !== "enforce") {
    notFound();
  }

  const [{ access }, query] = await Promise.all([requirePageArea("configuracoes"), searchParams]);

  if (!isLicenseManager(access)) {
    redirect("/admin/configuracoes");
  }

  const overview = await getLicenseOverview();
  const view = licenseScreenView({ ...overview, configuredHost: getConfiguredSiteOrigin(), version: process.env.APP_VERSION ?? null });

  if (!view) {
    notFound();
  }

  return (
    <AdminPage className="gap-6">
      <PageHeader
        breadcrumb={BREADCRUMB}
        description="A Licença desta área de membros: a situação, o que ela liga e a conferência com o Emissor de licenças."
        title="Licença"
      />
      <LicenseScreen
        actions={{ activate: activateLicense, checkNow: checkLicenseNow, deactivate: deactivateLicense, uploadFile: uploadLicenseFile }}
        notice={parseLicenseScreenNotice(query)}
        view={view}
      />
    </AdminPage>
  );
}

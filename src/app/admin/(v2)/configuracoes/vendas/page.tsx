import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { SalesEventsTable } from "@/components/admin/v2/settings/sales/sales-events-table";
import { SalesProviderCards } from "@/components/admin/v2/settings/sales/sales-provider-cards";
import { requirePageRole } from "@/server/auth/permissions";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { getSalesSettingsData } from "@/server/payments/queries";

export const metadata: Metadata = {
  title: "Vendas"
};

const BREADCRUMB = [{ href: "/admin/configuracoes", label: "Configurações" }, { label: "Vendas" }] as const;

/** Hora da leitura (renderizado no servidor), para o "ha 2 h" da ultima venda. */
function readNow() {
  return Date.now();
}

// Configuracoes > Vendas (docs/17 §1.10): so o dono (settings.sales). Conectar a Hotmart e a Ticto
// (endereco, eventos e token), Kiwify em configuracao, e a lista das vendas recebidas com o resultado.
export default async function SalesSettingsPage() {
  await requirePageRole("settings.sales", "/admin/configuracoes");
  const loaded = await loadUnlessPendingMigration(getSalesSettingsData);
  const header = (
    <PageHeader
      breadcrumb={BREADCRUMB}
      description="Conecte as plataformas de venda para o acesso do aluno ser liberado sozinho quando a compra chegar."
      title="Vendas"
    />
  );

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        {header}
        <PendingMigrationNotice />
      </AdminPage>
    );
  }

  return (
    <AdminPage className="gap-6">
      {header}
      <SalesProviderCards now={readNow()} providers={loaded.data.providers} />
      <SalesEventsTable events={loaded.data.events} />
    </AdminPage>
  );
}

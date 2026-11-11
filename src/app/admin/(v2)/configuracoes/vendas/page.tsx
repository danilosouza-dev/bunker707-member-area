import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { HeldSalesCard } from "@/components/admin/v2/settings/sales/held-sales-card";
import { SalesEventsTable } from "@/components/admin/v2/settings/sales/sales-events-table";
import { SalesProviderCards } from "@/components/admin/v2/settings/sales/sales-provider-cards";
import { requirePageRole } from "@/server/auth/permissions";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { getHeldSalesOverview, type HeldSalesOverview } from "@/server/payments/held-sales-queries";
import { getSalesSettingsData } from "@/server/payments/queries";

export const metadata: Metadata = {
  title: "Vendas"
};

const BREADCRUMB = [{ href: "/admin/configuracoes", label: "Configurações" }, { label: "Vendas" }] as const;

/** Hora da leitura (renderizado no servidor), para o "ha 2 h" da ultima venda. */
function readNow() {
  return Date.now();
}

/**
 * As vendas guardadas (docs/32 §2.2): so no produto vendido (modo "enforce"; no "off", null sem ler nada). A leitura que
 * falha nao derruba a tela: a lista some e o motivo vai para o log.
 */
async function readHeldSales(): Promise<HeldSalesOverview | null> {
  try {
    return await getHeldSalesOverview();
  } catch (error) {
    console.error("[vendas] vendas guardadas:", error instanceof Error ? error.message : error);
    return null;
  }
}

// Configuracoes > Vendas (docs/17 §1.10): so o dono (settings.sales). Conectar a Hotmart e a Ticto
// (endereco, eventos e token), Kiwify em configuracao, e a lista das vendas recebidas com o resultado. No produto
// vendido, a lista das vendas guardadas (docs/32 §2.2) vem antes, quando ha alguma.
export default async function SalesSettingsPage() {
  await requirePageRole("settings.sales", "/admin/configuracoes");
  const [loaded, heldSales] = await Promise.all([loadUnlessPendingMigration(getSalesSettingsData), readHeldSales()]);
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
      {heldSales ? <HeldSalesCard overview={heldSales} /> : null}
      <SalesEventsTable events={loaded.data.events} />
    </AdminPage>
  );
}

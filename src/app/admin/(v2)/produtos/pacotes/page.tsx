import type { Metadata } from "next";
import { CombosManager } from "@/components/admin/v2/combos/combos-manager";
import { ErrorBanner } from "@/components/admin/v2/error-banner";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { requirePageRole } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { listCohortNames, listComboProductOptions, listCombos } from "@/server/catalog/combos";

export const metadata: Metadata = {
  title: "Pacotes"
};

async function loadCombos() {
  try {
    const [combos, products, cohorts] = await Promise.all([listCombos(), listComboProductOptions(), listCohortNames()]);

    return { cohorts, combos, ok: true as const, products };
  } catch (error) {
    console.error("[admin/produtos/pacotes]", error);
    return { ok: false as const };
  }
}

export default async function AdminCombosPage() {
  // Pacotes juntam produtos da escola toda: so quem edita produtos (o menu tambem so mostra para eles).
  const { access } = await requirePageRole("catalog.write", "/admin/produtos");
  const data = await loadCombos();

  if (!data.ok) {
    return (
      <AdminPage>
        <PageHeader title="Pacotes" />
        <ErrorBanner title="Não foi possível carregar os pacotes">
          Recarregue a página em instantes. Se continuar, confira a conexão com o banco de dados.
        </ErrorBanner>
      </AdminPage>
    );
  }

  return (
    <AdminPage>
      <CombosManager canEdit={can(access, "catalog.write")} cohorts={data.cohorts} combos={data.combos} products={data.products} />
    </AdminPage>
  );
}

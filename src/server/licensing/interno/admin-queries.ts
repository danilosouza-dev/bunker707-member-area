import "server-only";

// O que as telas do dono leem da venda que vira Licenca (docs/32 §11.10): a marca Bunker Members de um produto (Produtos
// > Acesso e venda) e a fila dos pedidos ao Emissor (Configuracoes > Vendas). Sem a API interna configurada (seller.ts),
// ou para quem nao e o dono (settings.sales), null: o cartao nem aparece. A leitura que falha nunca derruba a tela.

import { can, type AdminAccess } from "@/server/auth/roles";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { requestListItemOf, type LicenseRequestListItem } from "./requests-view";
import { isLicenseProduct, isLicenseSalesSchemaMissing, listLicenseRequestsForTeam } from "./requests-store";
import { getSellerFeatures } from "./seller";

export type LicenseProductCardData = { enabled: boolean; missingMigration: boolean; productId: string; simulator: boolean };

/** O cartao "Bunker Members" do produto: so para o dono e so com as paginas de vendedor ligadas. */
export async function readLicenseProductCard(productId: string, access: AdminAccess | null): Promise<LicenseProductCardData | null> {
  if (!can(access, "settings.sales")) {
    return null;
  }

  const seller = await getSellerFeatures();

  if (!seller.enabled) {
    return null;
  }

  try {
    return { enabled: await isLicenseProduct(getSupabaseAdminClient(), productId), missingMigration: false, productId, simulator: seller.via === "simulador" };
  } catch (error) {
    if (isLicenseSalesSchemaMissing(error)) {
      return { enabled: false, missingMigration: true, productId, simulator: seller.via === "simulador" };
    }

    console.error("[licencas-vendas] marca do produto:", error instanceof Error ? error.message : error);
    return null;
  }
}

export type LicenseRequestsOverview = {
  missingMigration: boolean;
  open: LicenseRequestListItem[];
  recent: LicenseRequestListItem[];
  simulator: boolean;
};

/** A fila dos pedidos ao Emissor para Configuracoes > Vendas (a pagina ja e so do dono). */
export async function readLicenseRequestsOverview(): Promise<LicenseRequestsOverview | null> {
  const seller = await getSellerFeatures();

  if (!seller.enabled) {
    return null;
  }

  const simulator = seller.via === "simulador";

  try {
    const { open, recent } = await listLicenseRequestsForTeam(getSupabaseAdminClient(), { recent: 10 });
    const now = Date.now();

    return { missingMigration: false, open: open.map((row) => requestListItemOf(row, now)), recent: recent.map((row) => requestListItemOf(row, now)), simulator };
  } catch (error) {
    if (isLicenseSalesSchemaMissing(error)) {
      return { missingMigration: true, open: [], recent: [], simulator };
    }

    console.error("[licencas-vendas] fila:", error instanceof Error ? error.message : error);
    return null;
  }
}

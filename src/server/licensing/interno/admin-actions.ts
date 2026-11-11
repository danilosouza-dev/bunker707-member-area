"use server";

// As Server Actions do dono para a venda que vira Licenca do Bunker Members (docs/32 §11.10): marcar e desmarcar um
// produto como Bunker Members (Produtos > Acesso e venda) e, na fila de Configuracoes > Vendas, "Tentar agora" e
// "Dispensar" um pedido ao Emissor. So o dono (settings.sales, a mesma permissao de Vendas), e so com a API interna do
// Emissor configurada (seller.ts): sem ela, toda acao daqui responde como se nao existisse. Toda mudanca vai para
// admin_audit_log, so com ids.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { actionClassOfLicenseProductChange } from "@/server/actions/action-classes";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { dismissLicenseRequestByTeam, productExists, retryLicenseRequestNow, setLicenseProduct } from "./requests-store";
import { getSellerFeatures } from "./seller";
import { forgetLicenseProductsMemory } from "./student";

const SALES_PATH = "/admin/configuracoes/vendas";

class LicenseSalesActionError extends Error {
  readonly status: 404 | 409;

  constructor(status: 404 | 409, message: string) {
    super(message);
    this.name = "LicenseSalesActionError";
    this.status = status;
  }
}

/** Sem a API interna, as acoes de vendedor nao existem (a copia do comprador nunca as tem). */
async function requireSellerFeatures() {
  if (!(await getSellerFeatures()).enabled) {
    throw new LicenseSalesActionError(404, "Não encontrado.");
  }
}

const productIdSchema = z.string().trim().min(1).max(200);
const licenseProductSchema = z.object({ enabled: z.boolean(), productId: productIdSchema });
const requestIdSchema = z.object({ id: z.uuid() });

/** [settings.sales] Marca ou desmarca o produto como Bunker Members: a venda paga dele passa a virar Licenca. */
export async function setProductLicenseSale(raw: unknown): Promise<ActionResult<{ enabled: boolean; productId: string }>> {
  return runAdminAction("settings.sales", actionClassOfLicenseProductChange, licenseProductSchema, raw, async ({ input, user }) => {
    await requireSellerFeatures();
    const db = getSupabaseAdminClient();

    if (!(await productExists(db, input.productId))) {
      throw new LicenseSalesActionError(404, "Não encontramos este produto. Ele pode ter sido excluído.");
    }

    await setLicenseProduct(db, { enabled: input.enabled, productId: input.productId, userId: user.id });
    forgetLicenseProductsMemory();
    await recordAudit(db, {
      action: input.enabled ? "licencas.produto_marcado" : "licencas.produto_desmarcado",
      actorId: user.id,
      entityId: input.productId,
      entityType: "product"
    });
    revalidatePath(`/admin/produtos/${encodeURIComponent(input.productId)}/acesso`);

    return { enabled: input.enabled, productId: input.productId };
  });
}

/** [settings.sales] "Tentar agora": o pedido na fila ou parado volta a ficar na vez da proxima rodada do tick. */
export async function retryLicenseRequest(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return runAdminAction("settings.sales", "dever_legal", requestIdSchema, raw, async ({ input, user }) => {
    await requireSellerFeatures();
    const db = getSupabaseAdminClient();

    if (!(await retryLicenseRequestNow(db, { id: input.id, now: new Date() }))) {
      throw new LicenseSalesActionError(409, "Este pedido já saiu da fila. Recarregue a página.");
    }

    await recordAudit(db, { action: "licencas.pedido_reenviado", actorId: user.id, entityId: input.id, entityType: "license_request" });
    revalidatePath(SALES_PATH);

    return { id: input.id };
  });
}

/** [settings.sales] "Dispensar": a equipe resolveu de outro jeito; o pedido sai da fila sem ir ao Emissor. */
export async function dismissLicenseRequest(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return runAdminAction("settings.sales", "dever_legal", requestIdSchema, raw, async ({ input, user }) => {
    await requireSellerFeatures();
    const db = getSupabaseAdminClient();

    if (!(await dismissLicenseRequestByTeam(db, { id: input.id }))) {
      throw new LicenseSalesActionError(409, "Este pedido já saiu da fila. Recarregue a página.");
    }

    await recordAudit(db, { action: "licencas.pedido_dispensado", actorId: user.id, entityId: input.id, entityType: "license_request" });
    revalidatePath(SALES_PATH);

    return { id: input.id };
  });
}

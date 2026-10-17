"use server";

// Server Actions de Configuracoes > Vendas (docs/17 §1.10): so o dono (settings.sales).
// Guardar o token da plataforma (nunca devolvido depois), desconectar e reprocessar uma venda que
// falhou ou foi ignorada. Toda mudanca vai para admin_audit_log, sem o token.

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { getRequestOrigin } from "@/server/auth/site-origin";
import { getPaymentAdapter } from "./adapters";
import { buildSalesWebhookUrl, SALES_PROVIDER_LABELS } from "./model";
import { hashSalesSecret } from "./secret";
import { reprocessSalesEventSchema, salesProviderInputSchema, saveSalesSecretSchema } from "./schemas";
import { clearIntegration, saveIntegrationSecret, salesDb } from "./store";
import { reprocessWebhookEvent, type ReprocessOutcome } from "./webhook-handler";

const SALES_PATH = "/admin/configuracoes/vendas";

function revalidateSales() {
  revalidatePath(SALES_PATH);
  revalidatePath("/admin/configuracoes");
}

class SalesRuleError extends Error {
  readonly status = 422 as const;

  constructor(message: string) {
    super(message);
    this.name = "SalesRuleError";
  }
}

/** [settings.sales] Guarda (ou troca) o token que a plataforma manda em cada venda. */
export async function saveSalesSecret(raw: unknown): Promise<ActionResult<{ secretUpdatedAt: string; webhookUrl: string }>> {
  return runAdminAction("settings.sales", saveSalesSecretSchema, raw, async ({ input, user }) => {
    const adapter = getPaymentAdapter(input.provider);

    if (!adapter) {
      throw new SalesRuleError(`A integração com a ${SALES_PROVIDER_LABELS[input.provider]} ainda está em configuração.`);
    }

    const db = salesDb();
    const webhookUrl = buildSalesWebhookUrl(await getRequestOrigin(), input.provider);

    // So o SHA-256 vai para o banco: um dump nao entrega o token.
    await saveIntegrationSecret(db, { events: adapter.handledEvents, provider: input.provider, secretHash: hashSalesSecret(input.secret), webhookUrl });
    await recordAudit(db, {
      action: "sales.secret_saved",
      actorId: user.id,
      entityId: input.provider,
      entityType: "sales_provider",
      metadata: { webhookUrl }
    });
    revalidateSales();

    return { secretUpdatedAt: new Date().toISOString(), webhookUrl };
  });
}

/** [settings.sales] Desconecta a plataforma: apaga o token; vendas novas passam a responder 503. */
export async function disconnectSalesProvider(raw: unknown): Promise<ActionResult<{ provider: string }>> {
  return runAdminAction("settings.sales", salesProviderInputSchema, raw, async ({ input, user }) => {
    const db = salesDb();

    await clearIntegration(db, input.provider);
    await recordAudit(db, { action: "sales.disconnected", actorId: user.id, entityId: input.provider, entityType: "sales_provider" });
    revalidateSales();

    return { provider: input.provider };
  });
}

/** [settings.sales] Roda de novo a regra de acesso de uma venda que falhou ou foi ignorada. */
export async function reprocessSalesEvent(raw: unknown): Promise<ActionResult<ReprocessOutcome>> {
  return runAdminAction("settings.sales", reprocessSalesEventSchema, raw, async ({ input, user }) => {
    const db = salesDb();
    const outcome = await reprocessWebhookEvent(db, { id: input.id, siteOrigin: await getRequestOrigin() });

    await recordAudit(db, {
      action: "sales.event_reprocessed",
      actorId: user.id,
      entityId: input.id,
      entityType: "webhook_event",
      metadata: { ok: outcome.ok, processingStatus: outcome.processingStatus }
    });
    revalidateSales();

    return outcome;
  });
}

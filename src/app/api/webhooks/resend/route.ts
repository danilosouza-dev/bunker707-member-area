import { NextResponse } from "next/server";
import { getSupabaseAdminClient, hasSupabaseConfig } from "@/server/db/supabase/client";
import { readEmailConfig } from "@/server/email/config";
import { applyEmailWebhookEvent, markEmailWebhookEventProcessed, recordEmailWebhookEvent } from "@/server/email/outbox";
import { MAX_WEBHOOK_PAYLOAD_BYTES, parseResendWebhookEvent } from "@/server/email/webhook-events";
import { isWebhookSecretConfigured, verifySvixSignature } from "@/server/email/webhook-signature";
import { readBoundedText } from "@/server/http/bounded-text";
import { jsonRouteError } from "@/server/http/route-errors";

// Webhook do Resend (entregue, bounce, reclamacao, falha), assinado no padrao Svix com
// RESEND_WEBHOOK_SECRET. Ordem: segredo configurado (senao 503) -> assinatura sobre o corpo bruto
// (senao 401, nada e gravado) -> payload bruto guardado em email_webhook_events (mesmo svix-id duas
// vezes = 200 sem reaplicar) -> linha de email_outbox marcada. Ver docs/06, secao E-mail transacional.
export const runtime = "nodejs";
export const maxDuration = 30;

const PROVIDER = "resend";
const noStoreHeaders = { "Cache-Control": "no-store" };

function reply(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { headers: noStoreHeaders, status });
}

export async function POST(request: Request) {
  const { webhookSecret } = readEmailConfig(process.env);

  if (!isWebhookSecretConfigured(webhookSecret)) {
    console.error("RESEND_WEBHOOK_SECRET ausente ou inválido; webhook do Resend recusado.");

    return reply({ error: "Webhook indisponível: segredo do servidor não configurado.", ok: false }, 503);
  }

  let body: string;

  try {
    body = await readBoundedText(request, MAX_WEBHOOK_PAYLOAD_BYTES);
  } catch (error) {
    return jsonRouteError(error, "Não foi possível ler o corpo do webhook.", 400);
  }

  const verification = verifySvixSignature({
    body,
    id: request.headers.get("svix-id"),
    now: Date.now(),
    secret: webhookSecret,
    signature: request.headers.get("svix-signature"),
    timestamp: request.headers.get("svix-timestamp")
  });

  if (!verification.ok) {
    console.warn(`[e-mail] webhook do Resend recusado: ${verification.reason}.`);

    return reply({ error: "Assinatura inválida.", ok: false }, 401);
  }

  let payload: unknown;

  try {
    payload = JSON.parse(body);
  } catch {
    return reply({ error: "JSON inválido.", ok: false }, 400);
  }

  const event = parseResendWebhookEvent(payload);

  if (!event) {
    return reply({ error: "Evento sem tipo.", ok: false }, 400);
  }

  if (!hasSupabaseConfig()) {
    console.error("Banco de dados não configurado; webhook do Resend recusado.");

    return reply({ error: "Webhook indisponível: banco de dados não configurado.", ok: false }, 503);
  }

  const eventId = request.headers.get("svix-id") as string;

  try {
    const db = getSupabaseAdminClient();
    const stored = await recordEmailWebhookEvent(db, {
      eventId,
      eventType: event.type,
      payload,
      provider: PROVIDER,
      providerMessageId: event.emailId
    });

    if (stored.duplicate || !stored.id) {
      return reply({ duplicate: true, ok: true }, 200);
    }

    let outboxId: string | null = null;
    let applied = false;

    try {
      const outcome = await applyEmailWebhookEvent(db, event);
      outboxId = outcome.outboxId;
      applied = outcome.applied;
      await markEmailWebhookEventProcessed(db, stored.id, { outboxId });
    } catch (error) {
      await markEmailWebhookEventProcessed(db, stored.id, { error: error instanceof Error ? error.message : String(error), outboxId }).catch(() => undefined);
      throw error;
    }

    return reply({ applied, ok: true, type: event.type }, 200);
  } catch (error) {
    return jsonRouteError(error, "Não foi possível processar o webhook do Resend.");
  }
}

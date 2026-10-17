import "server-only";

// Fluxo comum do webhook de venda (docs/04, secao Webhooks externos; docs/06, secao Webhooks), usado
// por POST /api/webhooks/<plataforma>:
//   plataforma conectada? (senao 503) -> corpo limitado (413) -> JSON (400) -> token conferido em tempo
//   constante contra o segredo salvo (senao 401, nada gravado) -> evento normalizado (400 sem nome)
//   -> payload bruto gravado, unico por (provider, external_event_id) (repetido = 200 sem reprocessar)
//   -> regra de acesso (process-sale.ts) -> resultado na linha e na situacao da plataforma.
// Erro na regra de acesso: a linha fica `failed` com o motivo e a resposta e 500; a tela do produtor
// mostra o motivo e oferece Reprocessar.

import { NextResponse } from "next/server";
import { hasSupabaseConfig } from "@/server/db/supabase/client";
import { isPendingMigrationError } from "@/server/db/pending-migration";
import { readBoundedText } from "@/server/http/bounded-text";
import { requestOriginOf } from "@/server/http/request-origin";
import { getPaymentAdapter } from "./adapters";
import { SALES_PROVIDER_LABELS, canReprocessSaleEvent } from "./model";
import { SaleProcessingError, processSaleEvent, type SaleProcessingResult } from "./process-sale";
import {
  fetchIntegrationSecret,
  fetchWebhookEvent,
  insertWebhookEvent,
  markIntegrationSync,
  salesDb,
  updateWebhookEventResult,
  type SalesDb
} from "./store";
import type { NormalizedSaleEvent, SalesProvider } from "./types";

const noStoreHeaders = { "Cache-Control": "no-store" };

function reply(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { headers: noStoreHeaders, status });
}

function errorMessageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Processa (ou reprocessa) um evento ja gravado e registra o resultado na linha e na plataforma. */
async function runSaleProcessing(
  db: SalesDb,
  input: { event: NormalizedSaleEvent; eventRowId: string; siteOrigin: string | null }
): Promise<{ ok: true; result: SaleProcessingResult } | { ok: false; error: string }> {
  try {
    const result = await processSaleEvent(db, { event: input.event, siteOrigin: input.siteOrigin });

    await updateWebhookEventResult(db, input.eventRowId, {
      comboId: result.comboId,
      outcome: result.outcome,
      outcomeDetail: result.detail,
      processingStatus: result.outcome === "ignored" ? "ignored" : "processed",
      productId: result.productId,
      userId: result.userId
    });
    await markIntegrationSync(db, input.event.provider, { error: null });

    return { ok: true, result };
  } catch (error) {
    const message = errorMessageOf(error);

    console.error(`[vendas] evento ${input.event.rawType} da ${input.event.provider} falhou: ${message}`);
    const target = error instanceof SaleProcessingError ? error.target : null;

    await updateWebhookEventResult(db, input.eventRowId, {
      comboId: target?.comboId ?? null,
      errorMessage: message,
      outcome: "failed",
      outcomeDetail: null,
      processingStatus: "failed",
      productId: target?.productId ?? null
    }).catch((updateError) => console.error(`[vendas] falha nao registrada: ${errorMessageOf(updateError)}`));
    await markIntegrationSync(db, input.event.provider, { error: message });

    return { error: message, ok: false };
  }
}

export async function receiveSaleWebhook(provider: SalesProvider, request: Request) {
  const adapter = getPaymentAdapter(provider);
  const label = SALES_PROVIDER_LABELS[provider];

  if (!adapter) {
    return reply({ error: `A integração com a ${label} ainda não existe.`, ok: false }, 404);
  }

  if (!hasSupabaseConfig()) {
    console.error(`Banco de dados não configurado; webhook da ${label} recusado.`);

    return reply({ error: "Webhook indisponível: banco de dados não configurado.", ok: false }, 503);
  }

  const db = salesDb();
  let secret: string | null;

  try {
    secret = await fetchIntegrationSecret(db, provider);
  } catch (error) {
    if (isPendingMigrationError(error)) {
      console.error(`[vendas] webhook da ${label} recusado: ${error.message}`);

      return reply({ error: "Webhook indisponível: banco sem a atualização de Vendas.", ok: false }, 503);
    }

    throw error;
  }

  if (!secret) {
    return reply({ error: `Webhook indisponível: a ${label} ainda não foi conectada em Configurações › Vendas.`, ok: false }, 503);
  }

  let body: string;

  try {
    body = await readBoundedText(request, adapter.maxPayloadBytes);
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 400;

    return reply({ error: status === 413 ? "Corpo grande demais." : "Não foi possível ler o corpo do webhook.", ok: false }, status);
  }

  let payload: unknown;

  try {
    payload = JSON.parse(body);
  } catch {
    return reply({ error: "JSON inválido.", ok: false }, 400);
  }

  const verification = adapter.verify({ headers: request.headers, payload, secret });

  if (!verification.ok) {
    console.warn(`[vendas] webhook da ${label} recusado: ${verification.reason}.`);

    return reply({ error: "Token inválido.", ok: false }, 401);
  }

  const event = adapter.normalize(payload);

  if (!event) {
    return reply({ error: "Evento sem nome ou sem identificador.", ok: false }, 400);
  }

  let stored: Awaited<ReturnType<typeof insertWebhookEvent>>;

  try {
    stored = await insertWebhookEvent(db, {
      buyerEmail: event.buyer.email,
      eventType: event.rawType,
      externalEventId: event.eventId,
      externalProductId: event.externalProductId,
      externalProductName: event.externalProductName,
      normalizedType: event.type,
      payload: adapter.redact(payload),
      provider,
      signatureValid: true
    });
  } catch (error) {
    // Sem a linha gravada nao ha o que reprocessar: 500 para a plataforma reenviar.
    console.error(`[vendas] evento da ${label} nao gravado: ${errorMessageOf(error)}`);

    return reply({ error: "Não foi possível registrar a venda. Tente de novo.", ok: false }, 500);
  }

  if (stored.duplicate || !stored.id) {
    return reply({ duplicate: true, ok: true }, 200);
  }

  const processed = await runSaleProcessing(db, { event, eventRowId: stored.id, siteOrigin: requestOriginOf(request) });

  if (!processed.ok) {
    return reply({ error: "Não foi possível processar a venda. O evento ficou guardado para reprocesso.", ok: false }, 500);
  }

  return reply({ eventId: stored.id, ok: true, outcome: processed.result.outcome, type: event.type }, 200);
}

export class WebhookEventNotReprocessableError extends Error {
  readonly status: 404 | 409;

  constructor(status: 404 | 409, message: string) {
    super(message);
    this.name = "WebhookEventNotReprocessableError";
    this.status = status;
  }
}

export type ReprocessOutcome =
  | { detail: string; outcome: SaleProcessingResult["outcome"]; processingStatus: "processed" | "ignored"; ok: true }
  | { error: string; ok: false; processingStatus: "failed" };

/**
 * Reprocessa um evento guardado (falhou ou foi ignorado) a partir do payload bruto, com o mesmo
 * adaptador; o token nao e conferido de novo (ja foi, na chegada).
 */
export async function reprocessWebhookEvent(db: SalesDb, input: { id: string; siteOrigin: string | null }): Promise<ReprocessOutcome> {
  const row = await fetchWebhookEvent(db, input.id);

  if (!row) {
    throw new WebhookEventNotReprocessableError(404, "Essa venda não está mais na lista.");
  }

  if (row.anonymized_at) {
    throw new WebhookEventNotReprocessableError(409, "Essa venda passou de 12 meses: os dados do comprador já foram apagados e ela não pode ser reprocessada.");
  }

  if (!canReprocessSaleEvent(row.processing_status)) {
    throw new WebhookEventNotReprocessableError(409, "Essa venda já foi processada; não há o que reprocessar.");
  }

  const adapter = getPaymentAdapter(row.provider);
  const event = adapter?.normalize(row.payload) ?? null;

  if (!adapter || !event) {
    throw new WebhookEventNotReprocessableError(409, "Não foi possível ler o evento guardado.");
  }

  const processed = await runSaleProcessing(db, { event, eventRowId: row.id, siteOrigin: input.siteOrigin });

  if (!processed.ok) {
    return { error: processed.error, ok: false, processingStatus: "failed" };
  }

  return {
    detail: processed.result.detail,
    ok: true,
    outcome: processed.result.outcome,
    processingStatus: processed.result.outcome === "ignored" ? "ignored" : "processed"
  };
}

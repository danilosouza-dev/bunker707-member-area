import { NextResponse } from "next/server";
import { noStore } from "@/server/communications/route-support";
import { hasSupabaseConfig } from "@/server/db/supabase/client";
import { readBoundedText } from "@/server/http/bounded-text";
import { webinarsDb } from "@/server/webinars/db";
import { RECORDER_SIGNATURE_HEADER, RECORDER_TIMESTAMP_HEADER } from "@/server/webinars/recorder-signature";
import { RECORDER_WEBHOOK_ERRORS, RECORDER_WEBHOOK_MAX_BYTES, handleRecorderWebhook } from "@/server/webinars/recorder-webhook";

// Webhook do gravador por hora (docs/30 §5.3 e §8.2, D17): quem chama sao as etapas jibri-up / jibri-down do workflow
// (ready, unavailable, gone) e o finalize.sh da maquina do Jibri (uploaded, upload_failed), sem sessao de usuario. O
// corpo e lido cru (ate 64 KB: 413 acima; sem corpo, 400) porque a assinatura X-Bunker-Signature e o HMAC-SHA256 de
// "<X-Bunker-Timestamp>.<corpo>" com WEBINAR_RECORDER_WEBHOOK_SECRET, sobre os bytes exatos. Sem banco configurado: 503.
// O resto (assinatura 401, schema 400, sessao desconhecida 202, repetido 200, processado 200, falha 500) e
// src/server/webinars/recorder-webhook.ts. O proxy (src/proxy.ts) deixa /api passar so com a CSP: a rota se defende
// sozinha pela assinatura.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function json(body: Record<string, unknown>, status: number) {
  return noStore(NextResponse.json(body, { status }));
}

export async function POST(request: Request) {
  let rawBody: string;

  try {
    rawBody = await readBoundedText(request, RECORDER_WEBHOOK_MAX_BYTES);
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && error.status === 413 ? 413 : 400;

    return json({ error: status === 413 ? "Corpo grande demais." : RECORDER_WEBHOOK_ERRORS.invalid }, status);
  }

  if (!hasSupabaseConfig()) {
    console.error("[webinarios] banco nao configurado: webhook do gravador recusado.");

    return json({ error: "Webhook indisponível: banco de dados não configurado." }, 503);
  }

  const result = await handleRecorderWebhook({
    db: webinarsDb(),
    now: new Date(),
    rawBody,
    secret: process.env.WEBINAR_RECORDER_WEBHOOK_SECRET,
    signature: request.headers.get(RECORDER_SIGNATURE_HEADER),
    timestamp: request.headers.get(RECORDER_TIMESTAMP_HEADER)
  });

  return json(result.body, result.status);
}

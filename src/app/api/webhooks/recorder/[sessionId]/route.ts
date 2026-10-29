import { NextResponse } from "next/server";
import { noStore } from "@/server/communications/route-support";
import { hasSupabaseConfig } from "@/server/db/supabase/client";
import { webinarsDb } from "@/server/webinars/db";
import { RECORDER_SIGNATURE_HEADER, RECORDER_TIMESTAMP_HEADER } from "@/server/webinars/recorder-signature";
import { handleRecorderStatusRequest } from "@/server/webinars/recorder-webhook";

// A consulta do jibri-down antes de apagar a maquina (docs/30 §5.3 e §6.7): GET assinado como o POST do webhook, com
// o HMAC-SHA256 de "<X-Bunker-Timestamp>." (corpo vazio) em X-Bunker-Signature e WEBINAR_RECORDER_WEBHOOK_SECRET.
// Devolve { recorderStatus, recordingStatus } (a situacao da maquina na sessao e a da gravacao mais nova dela, ou
// null). 401 sem assinatura valida, 400 com id invalido, 404 sessao inexistente, 503 sem banco.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  if (!hasSupabaseConfig()) {
    console.error("[webinarios] banco nao configurado: consulta do gravador recusada.");

    return noStore(NextResponse.json({ error: "Webhook indisponível: banco de dados não configurado." }, { status: 503 }));
  }

  const result = await handleRecorderStatusRequest({
    db: webinarsDb(),
    now: new Date(),
    secret: process.env.WEBINAR_RECORDER_WEBHOOK_SECRET,
    sessionId,
    signature: request.headers.get(RECORDER_SIGNATURE_HEADER),
    timestamp: request.headers.get(RECORDER_TIMESTAMP_HEADER)
  });

  return noStore(NextResponse.json(result.body, { status: result.status }));
}

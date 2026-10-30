import { NextResponse } from "next/server";
import { noStore } from "@/server/communications/route-support";
import { hasSupabaseConfig } from "@/server/db/supabase/client";
import { webinarsDb } from "@/server/webinars/db";
import { RECORDER_SIGNATURE_HEADER, RECORDER_TIMESTAMP_HEADER } from "@/server/webinars/recorder-signature";
import { handleRoomGuardRequest } from "@/server/webinars/room-guard";

// A lista de barrados da sala ao vivo para o Prosody do Jitsi proprio (docs/30 §1.4 e §8.1): quem chama e o
// mod_bunker_room_guard.lua a cada poucos segundos, sem sessao de usuario, com o GET assinado (HMAC-SHA256 de
// "<X-Bunker-Timestamp>." com a chave derivada de WEBINAR_JWT_SECRET). Devolve as contas removidas de cada sala aberta e
// as banidas de todos os webinarios; o Prosody recusa a entrada delas mesmo com o token antigo. 401 sem assinatura
// valida, 503 sem banco ou sem a sala ao vivo neste ambiente. O resto e src/server/webinars/room-guard.ts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  if (!hasSupabaseConfig()) {
    console.error("[webinarios] banco nao configurado: lista da sala recusada.");

    return noStore(NextResponse.json({ error: "Indisponível: banco de dados não configurado." }, { status: 503 }));
  }

  const result = await handleRoomGuardRequest({
    db: webinarsDb(),
    now: new Date(),
    signature: request.headers.get(RECORDER_SIGNATURE_HEADER),
    timestamp: request.headers.get(RECORDER_TIMESTAMP_HEADER)
  });

  return noStore(NextResponse.json(result.body, { status: result.status }));
}

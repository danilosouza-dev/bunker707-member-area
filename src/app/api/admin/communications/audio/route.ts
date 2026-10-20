import { NextResponse } from "next/server";
import { requireApiRole } from "@/server/auth/permissions";
import { AUDIO_LIMITS } from "@/server/communications/campaign-model";
import { CommunicationError } from "@/server/communications/db";
import { NOTICE_AUDIO_SIZE_MESSAGE, persistNoticeAudio } from "@/server/communications/media";
import { jsonRouteError } from "@/server/http/route-errors";

// Audio do aviso (Comunicacao > Avisos e pop-ups, docs/22 §4.5): arquivo enviado ou gravado no navegador,
// em multipart (campo "file"). Rota, e nao Server Action, porque o audio passa do 1 MB das acoes. O
// servidor confere o tipo pelos primeiros bytes e o tamanho (ate 10 MB) e devolve o endereco publico;
// duracao e forma de onda chegam depois, com o rascunho.

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const revalidate = 0;

/** Arquivo de ate 10 MB mais a moldura do multipart. */
const MAX_REQUEST_BYTES = 11 * 1024 * 1024;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function POST(request: Request) {
  const auth = await requireApiRole("messaging.write");

  if (auth.response) {
    return noStore(auth.response);
  }

  if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) {
    return noStore(NextResponse.json({ error: NOTICE_AUDIO_SIZE_MESSAGE }, { status: 413 }));
  }

  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("multipart/form-data")) {
    return noStore(NextResponse.json({ error: "Envie o áudio como arquivo." }, { status: 400 }));
  }

  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      throw new CommunicationError("Escolha um arquivo de áudio.", 400);
    }

    if (file.size > AUDIO_LIMITS.maxBytes) {
      throw new CommunicationError(NOTICE_AUDIO_SIZE_MESSAGE, 413);
    }

    const data = await persistNoticeAudio({ bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type || null });

    return noStore(NextResponse.json({ data }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Não foi possível enviar o áudio. Tente de novo em instantes."));
  }
}

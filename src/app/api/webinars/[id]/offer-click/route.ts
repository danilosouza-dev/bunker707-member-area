import { NextResponse } from "next/server";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { noStore } from "@/server/communications/route-support";
import { webinarsDb } from "@/server/webinars/db";
import { OfferHiddenError, clickStudentOffer } from "@/server/webinars/offer-queries";
import { offerClickBodySchema } from "@/server/webinars/offer-schemas";
import { guardRoomRequest, loadRoomContextFor, ok, parseRoomBody, recordAfterReply, roomErrorResponse, type RouteContext } from "@/server/webinars/room-route";

// "Quero participar" (docs/30 §5.1 e M7): POST { sessionId, offerId, offsetMs? } devolve { url } = o checkout da
// variante do aluno com ?b7=<click_token>; o navegador abre em outra aba (noopener). Na sessao gravada o offset e o do
// relogio do servidor; no replay, o do corpo (a posicao do player). Fora da janela, escondida pela equipe ou com o
// prazo vencido: 409 { reason: "offer_hidden" }; banido de todos os webinarios: 409 banned. O mesmo aluno, oferta e
// sessao em ate 10 s recebe o mesmo link (sem outro clique); o clique novo grava webinar_offer_clicks e, depois da
// resposta, webinar_offer_clicked { offer_id, variant, offset_ms }. Sessao obrigatoria (401), teto global de escritas
// do aluno (429 com Retry-After), corpo ate 4 KB, fora do acesso ou sessao de outro webinario (404).

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** 409 { reason: "offer_hidden" } (com a hora do servidor, como os outros 409 da sala); o resto como as rotas da sala. */
function clickErrorResponse(error: unknown) {
  if (error instanceof OfferHiddenError) {
    return noStore(NextResponse.json({ asOf: new Date().toISOString(), error: error.message, reason: error.reason }, { status: 409 }));
  }
  return roomErrorResponse(error, WEBINAR_COPY.oferta.aluno.erro);
}

export async function POST(request: Request, context: RouteContext) {
  const guarded = await guardRoomRequest(context, { write: true });
  if ("response" in guarded) {
    return guarded.response;
  }

  const body = await parseRoomBody(request, offerClickBodySchema);
  if ("response" in body) {
    return body.response;
  }

  try {
    const room = await loadRoomContextFor(guarded.userId, guarded.webinarId, body.data.sessionId.toLowerCase());
    const result = await clickStudentOffer({
      bodyOffsetMs: body.data.offsetMs ?? null,
      context: room,
      db: webinarsDb(),
      offerId: body.data.offerId.toLowerCase(),
      userId: guarded.userId
    });
    await recordAfterReply(result.events);
    return ok({ url: result.url }, result.created ? 201 : 200);
  } catch (error) {
    return clickErrorResponse(error);
  }
}

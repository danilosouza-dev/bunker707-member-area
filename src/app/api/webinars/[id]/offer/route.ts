import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { webinarsDb } from "@/server/webinars/db";
import { loadStudentOffer } from "@/server/webinars/offer-queries";
import { guardRoomRequest, loadRoomContextFor, ok, roomErrorResponse, sessionIdOf, type RouteContext } from "@/server/webinars/room-route";

// O card da Oferta na sala (docs/30 §1.6, §5.1, §8.6 e M7): GET ?sessao= devolve { offer, serverTime, pollMs } com a
// variante do aluno e a janela no relogio do video, nunca o link do checkout (sai so no POST .../offer-click). So na
// sessao gravada e no replay (a live responde { offer: null }); quem ja tem o produto ou ja comprou pela oferta tambem
// recebe null; a primeira leitura dentro da janela grava a linha da sessao (o que o relatorio conta como "Viram a
// oferta"). Sessao obrigatoria (401), fora do acesso ou sessao de outro webinario (404), sem a vaga obrigatoria (403).
// Leitura: fora do teto de escritas do aluno.

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, context: RouteContext) {
  const guarded = await guardRoomRequest(context);
  if ("response" in guarded) {
    return guarded.response;
  }

  const session = sessionIdOf(request);
  if ("response" in session) {
    return session.response;
  }

  try {
    const room = await loadRoomContextFor(guarded.userId, guarded.webinarId, session.sessionId);
    return ok(await loadStudentOffer({ context: room, db: webinarsDb(), userId: guarded.userId }));
  } catch (error) {
    return roomErrorResponse(error, WEBINAR_COPY.oferta.aluno.naoEncontrada);
  }
}

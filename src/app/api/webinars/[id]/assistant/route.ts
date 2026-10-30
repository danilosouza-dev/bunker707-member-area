import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { loadStudentAssistantState } from "@/server/webinars/assistant-queries";
import { webinarsDb } from "@/server/webinars/db";
import { guardRoomRequest, loadRoomContextFor, ok, roomErrorResponse, sessionIdOf, type RouteContext } from "@/server/webinars/room-route";

// O Assistente na sala do aluno (docs/30 §1.6, §6.6 e D24): GET ?sessao= devolve { enabled, replyAll, attendantsOnline }
// para a dica "@assistente" (so com o Assistente ligado no ambiente, no webinario e com conexao de IA), o "Responder
// tudo" da sessao e "A equipe responde depois pelo sino" quando ninguem da equipe esta atendendo. Banco sem a
// 202610300004 ou ambiente desligado: tudo desligado (nada quebra). Sessao obrigatoria (401), fora do acesso ou sessao
// de outro webinario (404), sem a vaga obrigatoria (403). Leitura: fora do teto de escritas do aluno; a sala pergunta
// a cada minuto.

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
    return ok(await loadStudentAssistantState(webinarsDb(), { sessionId: room.session.id, webinarId: room.webinar.id }));
  } catch (error) {
    return roomErrorResponse(error, WEBINAR_COPY.sala.erroCarregarChat);
  }
}

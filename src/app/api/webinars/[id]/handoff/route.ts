import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { requestStudentHandoff } from "@/server/webinars/assistant";
import { handoffBodySchema } from "@/server/webinars/assistant-schemas";
import { webinarsDb } from "@/server/webinars/db";
import { guardRoomRequest, loadRoomContextFor, ok, parseRoomBody, roomErrorResponse, type RouteContext } from "@/server/webinars/room-route";

// "Falar com a equipe" (docs/30 §1.6, Agente de IA e Atendentes; D24): POST { sessionId, target: "chat" | "question",
// id } marca o pedido na propria mensagem ou pergunta do aluno nesta sessao (a pergunta aberta por uma mensagem do chat
// ganha a marca junto) e o Assistente cala nela dali em diante; o console mostra "Pediu a equipe" e a resposta da
// equipe chega tambem pelo sino. 200 { requested } (false quando ja estava pedido). O que nao e do aluno, de outra
// sessao ou apagado: 404 sem dizer se existe. Banco sem a 202610300004: 503 com a frase. Sessao obrigatoria (401);
// conta no teto de 30 escritas por minuto (429); corpo de ate 4 KB; fora do acesso ou sessao de outro webinario: 404.

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, context: RouteContext) {
  const guarded = await guardRoomRequest(context, { write: true });
  if ("response" in guarded) {
    return guarded.response;
  }

  const body = await parseRoomBody(request, handoffBodySchema);
  if ("response" in body) {
    return body.response;
  }

  try {
    const room = await loadRoomContextFor(guarded.userId, guarded.webinarId, body.data.sessionId.toLowerCase());
    const result = await requestStudentHandoff({ context: room, db: webinarsDb(), id: body.data.id.toLowerCase(), target: body.data.target, userId: guarded.userId });
    return ok(result);
  } catch (error) {
    return roomErrorResponse(error, WEBINAR_COPY.assistente.aluno.indisponivel);
  }
}

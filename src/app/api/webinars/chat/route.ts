import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/guards";
import { noStore } from "@/server/communications/route-support";
import { STUDENT_WRITE_LIMIT_MESSAGE, STUDENT_WRITE_RETRY_AFTER_SECONDS, takeStudentWrite } from "@/server/communications/student-write-limit";
import { chatDeleteBodySchema } from "@/server/webinars/chat-schemas";
import { webinarsDb } from "@/server/webinars/room-queries";
import { parseRoomBody, recordAfterReply, roomErrorResponse } from "@/server/webinars/room-route";
import { removeStudentChat } from "@/server/webinars/room-writes";

// "Remover minhas mensagens" fora de uma live (Perfil › Privacidade, docs/30 §8.5): DELETE { all: true } apaga o
// que o aluno escreveu (mensagens, perguntas e respostas de enquete) em todas as sessoes de todos os webinarios,
// retira o aceite do chat e grava webinar_chat_consented { revoked: true }. 200 { removed }. Sessao obrigatoria;
// o mesmo teto de 30 escritas por minuto das outras rotas do webinario.

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function DELETE(request: Request) {
  const auth = await requireApiUser();
  if (auth.response || !auth.user) {
    return noStore(auth.response!);
  }
  if (!takeStudentWrite(`webinar:${auth.user.id}`)) {
    return noStore(NextResponse.json({ error: STUDENT_WRITE_LIMIT_MESSAGE }, { headers: { "Retry-After": String(STUDENT_WRITE_RETRY_AFTER_SECONDS) }, status: 429 }));
  }

  const body = await parseRoomBody(request, chatDeleteBodySchema);
  if ("response" in body) {
    return body.response;
  }

  try {
    const result = await removeStudentChat({ db: webinarsDb(), userId: auth.user.id });
    await recordAfterReply(result.events);
    return noStore(NextResponse.json({ data: { removed: result.removed } }));
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível remover as mensagens.");
  }
}

import { NextResponse } from "next/server";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { noStore } from "@/server/communications/route-support";
import { webinarsDb } from "@/server/webinars/db";
import { jitEnterBodySchema } from "@/server/webinars/jit-schemas";
import { JitRefusedError, enterJitSession } from "@/server/webinars/jit-queries";
import { guardRoomRequest, ok, parseRoomBody, recordAfterReply, roomErrorResponse, type RouteContext } from "@/server/webinars/room-route";

// "Comeca quando voce entra" (docs/30 §1.2, §1.6, A14 e D25): POST {} pede a sessao do horario de agora para quem
// acabou de chegar e responde { data: { roomHref, scheduledAt, sessionId } }; a pagina leva o aluno para a sala, que
// abre na espera 15 min antes do horario, como as outras sessoes gravadas. O horario e o atual quando ainda aceita
// entrada (Entrada atrasada) e, senao, o proximo; dois alunos no mesmo horario recebem a mesma sessao (o indice unico
// do banco). Nunca pede vaga. Sessao obrigatoria (401), o teto de escritas do aluno (429), id do webinario (400), corpo
// diferente de {} ou maior que 4 KB (400/413), fora do acesso (404, sem dizer se existe), 409 { reason } para banido
// de todos os webinarios (banned), sem o just-in-time ou sem o video (off) e fora do horario (closed, com a hora do
// proximo em `scheduledAt`). O historico (webinar_jit_entered) e gravado depois da resposta. Resposta sem cache.

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, context: RouteContext) {
  const guarded = await guardRoomRequest(context, { write: true });
  if ("response" in guarded) {
    return guarded.response;
  }

  const body = await parseRoomBody(request, jitEnterBodySchema);
  if ("response" in body) {
    return body.response;
  }

  try {
    const entered = await enterJitSession({ db: webinarsDb(), now: new Date(), userId: guarded.userId, webinarId: guarded.webinarId });
    await recordAfterReply(entered.events);
    return ok({ roomHref: entered.roomHref, scheduledAt: entered.scheduledAt, sessionId: entered.sessionId });
  } catch (error) {
    if (error instanceof JitRefusedError) {
      return noStore(NextResponse.json({ error: error.message, reason: error.reason, scheduledAt: error.scheduledAt }, { status: 409 }));
    }
    return roomErrorResponse(error, WEBINAR_COPY.jit.aluno.erro);
  }
}

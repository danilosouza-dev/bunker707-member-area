import { chatDeleteBodySchema, chatPostBodySchema, chatWindowQuerySchema } from "@/server/webinars/chat-schemas";
import { readChatWindow, readRecentChat, webinarsDb } from "@/server/webinars/room-queries";
import { badRequest, guardRoomRequest, loadRoomContextFor, offsetMsFieldSchema, ok, parseRoomBody, recordAfterReply, roomErrorResponse, type RouteContext } from "@/server/webinars/room-route";
import { postStudentChat, removeStudentChat } from "@/server/webinars/room-writes";

// O chat da Sala (docs/30 §5.1, §6.6 e §8.5). GET ?sessao=&from=&to= devolve a janela por offset (a linha mestre ja
// deslocada pela ancora + as linhas da sessao, as pendentes so do proprio aluno); GET ?sessao=&since=&after= devolve as
// mensagens novas da sessao depois do cursor (a consulta de 5 s) e o proximo cursor. POST { sessionId, body, kind,
// anonymous, consent, consentVersion, displayMode, nickname, replyToId, offsetMs? } grava a mensagem com o offset do
// relogio do servidor (no replay, a posicao do player que veio no corpo): 201 { message, pending }; a primeira exige o
// aceite (409 consent_required); fora da hora ou do modo 409 { reason }; rajada e modo lento 429 com Retry-After;
// palavra bloqueada 422; na live, removido ou banido 409 banned e silenciado 409 muted (fase 3). DELETE { all: true } e
// "Remover minhas mensagens": apaga o que o aluno escreveu em todas as sessoes e retira o aceite, 200 { removed }.
// Sessao obrigatoria (401); ate 30 escritas por minuto por aluno; corpo de ate 4 KB; fora do acesso ou sessao de outro
// webinario: 404 sem dizer se existe.

export const dynamic = "force-dynamic";
export const revalidate = 0;

const postSchema = chatPostBodySchema.extend({ offsetMs: offsetMsFieldSchema });

export async function GET(request: Request, context: RouteContext) {
  const guarded = await guardRoomRequest(context);
  if ("response" in guarded) {
    return guarded.response;
  }

  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = chatWindowQuerySchema.safeParse(params);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message);
  }
  const query = parsed.data;
  const windowMode = query.from !== undefined && query.to !== undefined;
  if (!windowMode && query.since === undefined) {
    return badRequest();
  }

  try {
    const room = await loadRoomContextFor(guarded.userId, guarded.webinarId, query.sessao.toLowerCase());
    const data = windowMode
      ? await readChatWindow(webinarsDb(), room, guarded.userId, { fromMs: query.from as number, toMs: query.to as number })
      : await readRecentChat(webinarsDb(), room, guarded.userId, { after: query.after ?? null, since: query.since as string });
    return ok(data);
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível ler o chat.");
  }
}

export async function POST(request: Request, context: RouteContext) {
  const guarded = await guardRoomRequest(context, { write: true });
  if ("response" in guarded) {
    return guarded.response;
  }

  const body = await parseRoomBody(request, postSchema);
  if ("response" in body) {
    return body.response;
  }

  try {
    const room = await loadRoomContextFor(guarded.userId, guarded.webinarId, body.data.sessionId.toLowerCase());
    const result = await postStudentChat({ body: body.data, context: room, db: webinarsDb(), userId: guarded.userId });
    await recordAfterReply(result.events);
    return ok({ message: result.message, pending: result.pending }, 201);
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível enviar a mensagem.");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const guarded = await guardRoomRequest(context, { write: true });
  if ("response" in guarded) {
    return guarded.response;
  }

  const body = await parseRoomBody(request, chatDeleteBodySchema);
  if ("response" in body) {
    return body.response;
  }

  try {
    const result = await removeStudentChat({ db: webinarsDb(), userId: guarded.userId });
    await recordAfterReply(result.events);
    return ok({ removed: result.removed });
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível remover as mensagens.");
  }
}

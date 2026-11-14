import { scheduleAssistant } from "@/server/webinars/assistant";
import { chatAssistantTrigger } from "@/server/webinars/assistant-model";
import { chatDeleteBodySchema, chatPostBodySchema, chatWindowQuerySchema } from "@/server/webinars/chat-schemas";
import { readChatBacklog, readChatWindow, readRecentChat, webinarsDb } from "@/server/webinars/room-queries";
import { badRequest, guardRoomRequest, loadRoomContextFor, offsetMsFieldSchema, ok, parseRoomBody, recordAfterReply, roomErrorResponse, type RouteContext } from "@/server/webinars/room-route";
import { postStudentChat, removeStudentChat } from "@/server/webinars/room-writes";
import { webinarAssistantEnabled } from "@/server/webinars/v4-env";
import { WEBINARS_FEATURE } from "@/server/licensing/features";
import { licenseRouteRefusal } from "@/server/licensing/guards";

// O chat da Sala (docs/30 §5.1, §6.6 e §8.5). GET ?sessao=&from=&to= devolve a janela por offset (a linha mestre ja
// deslocada pela ancora + as linhas da sessao, as pendentes so do proprio aluno); GET ?sessao=&before= devolve o
// historico de quem entra na Live ao vivo (as 200 ultimas mensagens da sessao antes daquele offset, nunca alem de
// agora; vazio na gravada e no replay: teste do produtor de 13/11/2026); GET ?sessao=&since=&after= devolve as
// mensagens novas da sessao depois do cursor (a consulta de 5 s) e o proximo cursor; com &tela=<carimbo>, leva tambem
// `screen`, o estado da Na tela, so quando o carimbo da sessao mudou (nulo quando e igual, sem `tela` e no Replay; o
// estado vem da memoria do processo, screen-queries.ts). POST { sessionId, body, kind,
// consent, consentVersion, replyToId, offsetMs? } grava a mensagem com o offset do relogio do servidor (no replay, a
// posicao do player que veio no corpo) e o nome do aluno, sempre o primeiro nome com a inicial do sobrenome (D64):
// 201 { message, pending }; a primeira exige o aceite (409 consent_required); a pagina aberta com o codigo de antes de
// 10/11/2026 que ainda manda `anonymous: true`, `displayMode` "anonymous" ou "nickname", ou um `nickname`, recebe 400
// com a frase "atualize a pagina" e nada e gravado (`anonymous: false` e `displayMode` "first_name_initial" passam);
// fora da hora ou do modo 409 { reason }; rajada e modo lento 429 com Retry-After; palavra bloqueada 422; na live, removido ou banido 409 banned e silenciado 409 muted (fase 3). DELETE { all: true } e
// "Remover minhas mensagens": apaga o que o aluno escreveu em todas as sessoes e retira o aceite, 200 { removed }.
// Sessao obrigatoria (401); ate 30 escritas por minuto por aluno; corpo de ate 4 KB; fora do acesso ou sessao de outro
// webinario: 404 sem dizer se existe. Fase 4c (docs/30 §6.6 e D24): a mensagem que chama o Assistente ("@assistente",
// ou pergunta da turma com o "Responder tudo") agenda a resposta dele para depois desta resposta (after(), com teto de
// tempo; assistant.ts) e o 201 traz `assistant: "scheduled"`; a resposta chega pela consulta de 5 s com role "ai"
// (o GET nunca troca `ai` por `team`: o selo Assistente).

export const dynamic = "force-dynamic";
export const revalidate = 0;

const postSchema = chatPostBodySchema.extend({ offsetMs: offsetMsFieldSchema });

export async function GET(request: Request, context: RouteContext) {
  const licenseRefusal = await licenseRouteRefusal({ feature: WEBINARS_FEATURE });
  if (licenseRefusal) return licenseRefusal;

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
  // O historico de quem entra na Live ao vivo: so `before`, sem janela nem cursor.
  const backlogMode = !windowMode && query.since === undefined && query.before !== undefined;
  if (!windowMode && !backlogMode && query.since === undefined) {
    return badRequest();
  }

  try {
    const room = await loadRoomContextFor(guarded.userId, guarded.webinarId, query.sessao.toLowerCase());
    const data = windowMode
      ? await readChatWindow(webinarsDb(), room, guarded.userId, { fromMs: query.from as number, toMs: query.to as number })
      : backlogMode
        ? await readChatBacklog(webinarsDb(), room, guarded.userId, { beforeMs: query.before as number })
        : await readRecentChat(webinarsDb(), room, guarded.userId, { after: query.after ?? null, since: query.since as string }, Date.now(), { stamp: query.tela });
    return ok(data);
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível ler o chat.");
  }
}

export async function POST(request: Request, context: RouteContext) {
  const licenseRefusal = await licenseRouteRefusal({ actionClass: "atendimento", feature: WEBINARS_FEATURE });
  if (licenseRefusal) return licenseRefusal;

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
    const scheduled = await scheduleAssistant(
      chatAssistantTrigger({
        approved: !result.pending,
        body: result.message.body,
        envEnabled: webinarAssistantEnabled(),
        kind: result.message.kind,
        messageId: result.message.id,
        offsetMs: result.offsetMs,
        questionId: result.questionId,
        recordingId: room.recording?.id ?? null,
        sessionId: room.session.id,
        userId: guarded.userId,
        webinarId: room.webinar.id
      })
    );
    return ok({ assistant: scheduled ? "scheduled" : null, message: result.message, pending: result.pending }, 201);
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível enviar a mensagem.");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const licenseRefusal = await licenseRouteRefusal({ actionClass: "dever_legal", feature: WEBINARS_FEATURE });
  if (licenseRefusal) return licenseRefusal;

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

import { scheduleAssistant } from "@/server/webinars/assistant";
import { questionAssistantTrigger } from "@/server/webinars/assistant-model";
import { studentQuestionMarks } from "@/server/webinars/assistant-queries";
import { questionBodySchema, questionsQuerySchema } from "@/server/webinars/chat-schemas";
import { listStudentQuestions, webinarsDb } from "@/server/webinars/room-queries";
import { badRequest, guardRoomRequest, loadRoomContextFor, offsetMsFieldSchema, ok, parseRoomBody, recordAfterReply, roomErrorResponse, type RouteContext } from "@/server/webinars/room-route";
import { askStudentQuestion } from "@/server/webinars/room-writes";
import { webinarAssistantEnabled } from "@/server/webinars/v4-env";

// A aba Perguntas (docs/30 §1.3, §5.1 e D22): GET ?sessao=&ordem=votadas|recentes lista as abertas e as respondidas (a
// dispensada so para o autor) com `mine` e `voted`; POST { sessionId, body, anonymous, offsetMs? } faz a pergunta (sem
// o aceite do chat, o corpo traz consent + consentVersion + displayMode, ou 409 consent_required; anonima com a opcao
// desligada 400; 2 por minuto por aluno e sessao: 429 com Retry-After; palavra bloqueada 422; na live, removido ou
// banido 409 banned e silenciado no chat 409 muted) e responde 201. Sessao obrigatoria; o teto global de 30 escritas
// por minuto; fora do acesso ou sessao de outro webinario: 404. Fase 4c (docs/30 §1.6, §6.6 e D24): a pergunta da aba
// chama o Assistente (agendado para depois desta resposta, assistant.ts; 201 com `assistant: "scheduled"`), e o GET
// leva em cada pergunta de quem e a resposta (`answerSource`: "ai" mostra o selo Assistente) e, nas do proprio aluno,
// se ele ja pediu a equipe (`handoffRequested`).

export const dynamic = "force-dynamic";
export const revalidate = 0;

const postSchema = questionBodySchema.extend({ offsetMs: offsetMsFieldSchema });

export async function GET(request: Request, context: RouteContext) {
  const guarded = await guardRoomRequest(context);
  if ("response" in guarded) {
    return guarded.response;
  }

  const parsed = questionsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message);
  }

  try {
    const room = await loadRoomContextFor(guarded.userId, guarded.webinarId, parsed.data.sessao.toLowerCase());
    const questions = await listStudentQuestions(webinarsDb(), room.session, guarded.userId, parsed.data.ordem === "recentes" ? "recent" : "votes");
    const marks = await studentQuestionMarks(webinarsDb(), { ids: questions.map((question) => question.id) });
    return ok({
      questions: questions.map((question) => {
        const mark = marks.get(question.id);
        return { ...question, answerSource: mark?.answerSource ?? null, handoffRequested: question.mine && Boolean(mark?.handoffRequestedAt) };
      }),
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível ler as perguntas.");
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
    const result = await askStudentQuestion({ body: body.data, context: room, db: webinarsDb(), offsetMs: body.data.offsetMs, userId: guarded.userId });
    await recordAfterReply(result.events);
    const scheduled = await scheduleAssistant(
      questionAssistantTrigger({
        body: result.question.body,
        envEnabled: webinarAssistantEnabled(),
        offsetMs: result.offsetMs,
        questionId: result.question.id,
        recordingId: room.recording?.id ?? null,
        sessionId: room.session.id,
        userId: guarded.userId,
        webinarId: room.webinar.id
      })
    );
    return ok({ assistant: scheduled ? "scheduled" : null, question: { ...result.question, answerSource: null, handoffRequested: false } }, 201);
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível enviar a pergunta.");
  }
}

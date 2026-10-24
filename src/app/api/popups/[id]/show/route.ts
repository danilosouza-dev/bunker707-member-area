import { after, NextResponse } from "next/server";
import { requireApiSessionUser } from "@/server/auth/guards";
import { isPopupPageKey, POPUP_TRIGGERS, POPUP_V3B1_RULES } from "@/server/communications/popup-display-model";
import { PopupRefusedError, showPopup } from "@/server/communications/popups";
import { isUuid, noStore, recordCommunicationEvents } from "@/server/communications/route-support";
import { STUDENT_WRITE_LIMIT_MESSAGE, STUDENT_WRITE_RETRY_AFTER_SECONDS, takeStudentWrite } from "@/server/communications/student-write-limit";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

// Abrir o pop-up agora (Comunicacao v3b-1, docs/25 §4.5; v3b-2, docs/29 §4.1 item 2, §4.3 e §6.1): { page: chave da pagina,
// trigger: "page_load" | "lesson_completed" | "first_login" | "course_completed" }. O navegador chama logo antes
// de desenhar, com o codigo do pop-up ja carregado; o servidor confere no ar, segmento, pagina, momento e
// quantas vezes, grava a abertura de forma atomica e so entao devolve o conteudo e quando o pop-up pode voltar
// ({ next: { notBefore } | null }). Fora da vez: 409 { error, reason, nextAt, asOf } (asOf = a hora do servidor
// na recusa, para o navegador acertar o relogio da segunda tentativa); antes do Comeca, para quem esta
// no segmento, 409 com reason "not_started" e nextAt = o Comeca (o navegador arma de novo uma vez); "Ao concluir
// um curso" com o curso incompleto no banco: 409 "trigger" sem nextAt. Fora do ar, de outro aluno ou fora do
// segmento: 404 sem dizer se existe.
// Ate 30 chamadas de pop-up por minuto por aluno (show e eventos, chave "popup:"); o historico
// (message_impressed com a pagina e o momento) grava depois da resposta e so ate 100 aberturas por pop-up,
// aluno e dia (a linha guarda a conta exata). Sessao pelas claims do JWT.

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

const INVALID_REQUEST = "Pedido invalido.";

/** Depois da resposta (after() do Next); fora de um pedido do Next (testes, scripts), na hora. */
async function afterReply(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
    await task();
  }
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiSessionUser();

  if (auth.response || !auth.user) {
    return noStore(auth.response!);
  }

  if (!takeStudentWrite(`popup:${auth.user.id}`)) {
    return noStore(
      NextResponse.json({ error: STUDENT_WRITE_LIMIT_MESSAGE }, { headers: { "Retry-After": String(STUDENT_WRITE_RETRY_AFTER_SECONDS) }, status: 429 })
    );
  }

  const { id } = await context.params;

  if (!isUuid(id)) {
    return noStore(NextResponse.json({ error: "Pop-up invalido." }, { status: 400 }));
  }

  let payload: unknown;

  try {
    payload = await readBoundedJson<unknown>(request, 1_000);
  } catch (error) {
    // Corpo grande demais continua 413; sem corpo ou JSON quebrado e so um pedido invalido.
    const tooLarge = typeof error === "object" && error !== null && "status" in error && error.status === 413;

    return noStore(tooLarge ? jsonRouteError(error, INVALID_REQUEST, 400) : NextResponse.json({ error: INVALID_REQUEST }, { status: 400 }));
  }

  const body = payload && typeof payload === "object" ? (payload as { page?: unknown; trigger?: unknown }) : {};
  const { page, trigger } = body;

  if (!isPopupPageKey(page) || typeof trigger !== "string" || !(POPUP_TRIGGERS as readonly string[]).includes(trigger)) {
    return noStore(NextResponse.json({ error: INVALID_REQUEST }, { status: 400 }));
  }

  try {
    const userId = auth.user.id;
    const campaignId = id.toLowerCase();
    const shown = await showPopup(userId, campaignId, { page, trigger });

    if (shown.dayImpressions <= POPUP_V3B1_RULES.eventsPerDayMax) {
      await afterReply(() =>
        recordCommunicationEvents([
          {
            entity_id: campaignId,
            entity_type: "campaign",
            event_type: "message_impressed",
            metadata: { campaign_id: campaignId, page, trigger },
            user_id: userId
          }
        ])
      );
    }

    return noStore(NextResponse.json({ data: { next: shown.next, popup: shown.popup } }));
  } catch (error) {
    if (error instanceof PopupRefusedError) {
      return noStore(
        NextResponse.json({ asOf: new Date().toISOString(), error: error.message, nextAt: error.nextAt, reason: error.reason }, { status: 409 })
      );
    }

    return noStore(jsonRouteError(error, "Nao foi possivel abrir o pop-up."));
  }
}

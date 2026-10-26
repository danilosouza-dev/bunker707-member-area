import { NextResponse } from "next/server";
import { requireApiSessionUser } from "@/server/auth/guards";
import { POPUP_EVENTS, type PopupEvent } from "@/server/communications/campaign-model";
import { resolvePopupClickedButton } from "@/server/communications/popup-clicked-button";
import { POPUP_CLOSE_VIAS, POPUP_V3B1_RULES, type PopupCloseVia } from "@/server/communications/popup-display-model";
import { recordPopupEvent } from "@/server/communications/popups";
import { isUuid, noStore, recordCommunicationEvents } from "@/server/communications/route-support";
import { STUDENT_WRITE_LIMIT_MESSAGE, STUDENT_WRITE_RETRY_AFTER_SECONDS, takeStudentWrite } from "@/server/communications/student-write-limit";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

// Evento do aluno no pop-up: { event: "clicked" | "closed" | "dismissed" | "snoozed", via?, button? } (`via` so no
// "closed": "x" | "outside" | "esc" | "page", padrao "x"; vai so para o historico). `button` so no "clicked" do Livre
// (docs/27 L47): "cta" ou "link:<id>", gravado em metadata.button so quando a forma e o design do pop-up no ar conferem
// (popup-clicked-button.ts); fora disso e ignorado, nunca 400. Aceita o corpo em
// text/plain (sendBeacon na hora de sair da pagina manda assim). Sessao pelas claims do JWT (v3a, docs/24):
// so mexe na linha do proprio aluno. v3b-1 (docs/25 §5.1): ate 30 chamadas de pop-up por minuto por aluno
// (show e eventos, chave propria "popup:", separada das escritas do sino), 429 alem disso. O "impressed" da
// v1 (aba aberta antes do deploy) grava a abertura pelo mesmo caminho do show; o historico guarda ate 100
// aberturas por pop-up, aluno e dia.

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

const EVENT_TYPES: Record<PopupEvent, string> = {
  clicked: "message_clicked",
  closed: "message_closed",
  dismissed: "message_dismissed",
  impressed: "message_impressed",
  snoozed: "message_snoozed"
};

function isPopupEvent(value: unknown): value is PopupEvent {
  return typeof value === "string" && (POPUP_EVENTS as readonly string[]).includes(value);
}

function isCloseVia(value: unknown): value is PopupCloseVia {
  return typeof value === "string" && (POPUP_CLOSE_VIAS as readonly string[]).includes(value);
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

  let payload: { button?: unknown; event?: unknown; via?: unknown };

  try {
    payload = await readBoundedJson<{ button?: unknown; event?: unknown; via?: unknown }>(request, 8_000);
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel ler o evento.", 400));
  }

  const event = payload && typeof payload === "object" ? payload.event : undefined;
  const via = payload && typeof payload === "object" ? payload.via : undefined;
  const sentButton = payload && typeof payload === "object" ? payload.button : undefined;

  // `via` desconhecido e evento invalido; um `via` valido fora do "closed" nao conta.
  if (!isPopupEvent(event) || (via !== undefined && !isCloseVia(via))) {
    return noStore(NextResponse.json({ error: "Evento invalido." }, { status: 400 }));
  }

  try {
    const userId = auth.user.id;
    const campaignId = id.toLowerCase();
    const result = await recordPopupEvent(userId, campaignId, event);
    // Depois do evento valido: o botao do Livre so com a forma e o design conferidos (senao o clique grava sem a chave).
    const button = event === "clicked" ? await resolvePopupClickedButton(campaignId, sentButton) : null;
    const metadata =
      event === "closed"
        ? { campaign_id: campaignId, via: via ?? "x" }
        : event === "impressed"
          ? { campaign_id: campaignId, page: "home", trigger: "page_load" }
          : button
            ? { button, campaign_id: campaignId }
            : { campaign_id: campaignId };

    if (event !== "impressed" || (result.dayImpressions ?? 0) <= POPUP_V3B1_RULES.eventsPerDayMax) {
      await recordCommunicationEvents([{ entity_id: campaignId, entity_type: "campaign", event_type: EVENT_TYPES[event], metadata, user_id: userId }]);
    }

    return noStore(NextResponse.json({ data: { ok: true } }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel registrar o evento do pop-up."));
  }
}

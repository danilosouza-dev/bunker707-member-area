import { NextResponse } from "next/server";
import { isUuid, noStore } from "@/server/communications/route-support";
import { jsonRouteError } from "@/server/http/route-errors";
import { buildIcs, calendarFileName } from "@/server/webinars/calendar";
import { webinarsDb } from "@/server/webinars/db";
import { nextSession } from "@/server/webinars/model";
import { sessionFromRow, webinarFromRow } from "@/server/webinars/rows";
import { fetchRegistrationRowByToken, fetchWebinarRow, listSessionRows } from "@/server/webinars/store";
import { webinarPublicUrl } from "@/server/webinars/student-queries";

// O arquivo .ics da vaga (docs/30 §1.2 e §5.1): GET ?token= com o calendar_token da vaga. Nao pede sessao: o
// token (32 caracteres aleatorios, um por vaga) basta, para o aluno abrir o link no app de calendario do
// aparelho. Vaga cancelada, webinario fora do ar ou token desconhecido: 404. Servido pela nossa rota, sem
// servico de fora; o compromisso leva o endereco da pagina do Webinario e "Entre pela area de membros".

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const NOT_FOUND = "Calendário não encontrado.";

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const token = new URL(request.url).searchParams.get("token") ?? "";

  if (!isUuid(id) || !TOKEN.test(token)) {
    return noStore(NextResponse.json({ error: NOT_FOUND }, { status: 404 }));
  }

  try {
    const db = webinarsDb();
    const registration = await fetchRegistrationRowByToken(db, token);

    if (!registration || registration.status !== "registered" || registration.webinar_id !== id.toLowerCase()) {
      return noStore(NextResponse.json({ error: NOT_FOUND }, { status: 404 }));
    }

    const row = await fetchWebinarRow(db, registration.webinar_id);

    if (!row || row.status !== "published" || row.cancelled_at) {
      return noStore(NextResponse.json({ error: NOT_FOUND }, { status: 404 }));
    }

    const webinar = webinarFromRow(row);
    const sessions = (await listSessionRows(db, [webinar.id])).map(sessionFromRow).filter((session) => session.kind !== "replay");
    const session = registration.session_id
      ? sessions.find((item) => item.id === registration.session_id)
      : (sessions.find((item) => item.kind === "live") ?? nextSession(sessions, webinar.durationMinutes, Date.now()));

    if (!session) {
      return noStore(NextResponse.json({ error: NOT_FOUND }, { status: 404 }));
    }

    const ics = buildIcs({
      description: webinar.description,
      durationMinutes: webinar.durationMinutes,
      startsAt: session.scheduledAt,
      title: webinar.title,
      uid: `webinar-${webinar.id}-${session.id}@bunker707`,
      url: webinarPublicUrl(webinar.slug, new URL(request.url).origin)
    });

    return noStore(
      new NextResponse(ics, {
        headers: {
          "Content-Disposition": `attachment; filename="${calendarFileName(webinar.slug)}"`,
          "Content-Type": "text/calendar; charset=utf-8"
        },
        status: 200
      })
    );
  } catch (error) {
    return noStore(jsonRouteError(error, "Não foi possível gerar o calendário."));
  }
}

import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/guards";
import { isUuid, noStore } from "@/server/communications/route-support";
import { STUDENT_WRITE_LIMIT_MESSAGE, STUDENT_WRITE_RETRY_AFTER_SECONDS, takeStudentWrite } from "@/server/communications/student-write-limit";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";
import { googleCalendarUrl, outlookCalendarUrl } from "@/server/webinars/calendar";
import type { Webinar, WebinarRegistration, WebinarSession } from "@/server/webinars/model";
import { RegistrationRefusedError, registerStudent, unregisterStudent } from "@/server/webinars/registrations";
import { registerBodySchema, unregisterBodySchema } from "@/server/webinars/schemas";
import { calendarPath } from "@/server/webinars/student-model";
import { webinarPublicUrl } from "@/server/webinars/student-queries";

// Garantir vaga (docs/30 §1.2 e §5.1): POST { sessionId?, source? } grava a vaga do aluno na sessao (na Live
// ao vivo o corpo pode vir vazio: vale a sessao live) e devolve 201 { registration, calendarUrl, googleUrl,
// outlookUrl } (200 quando a vaga ja existia: repetir nao duplica). DELETE { sessionId? } cancela (200).
// Sessao obrigatoria (401); ate 30 escritas por minuto por aluno (429 com Retry-After); corpo de ate 4 KB
// (413); fora do acesso, nao publicado ou inexistente: 404 sem dizer se existe; a vaga nao cabe mais:
// 409 { error, reason: 'ended' | 'sold_out' | 'cancelled' }. O registro webinar_registered sai so do servidor.

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

const INVALID_REQUEST = "Pedido inválido.";
const INVALID_WEBINAR = "Webinário inválido.";

/** O corpo em JSON (ate 4 KB); sem corpo, um objeto vazio (a Live ao vivo nao precisa de sessao). */
async function readBody(request: Request): Promise<unknown> {
  if (!request.body || request.headers.get("content-length") === "0") {
    return {};
  }

  return readBoundedJson<unknown>(request, 4_000);
}

function registrationJson(registration: WebinarRegistration) {
  return {
    id: registration.id,
    registeredAt: registration.registeredAt,
    sessionId: registration.sessionId,
    status: registration.status,
    webinarId: registration.webinarId
  };
}

function calendarJson(request: Request, webinar: Webinar, session: WebinarSession, registration: WebinarRegistration) {
  const event = {
    description: webinar.description,
    durationMinutes: webinar.durationMinutes,
    startsAt: session.scheduledAt,
    title: webinar.title,
    url: webinarPublicUrl(webinar.slug, new URL(request.url).origin)
  };

  return {
    calendarUrl: calendarPath(webinar.id, registration.calendarToken),
    googleUrl: googleCalendarUrl(event),
    outlookUrl: outlookCalendarUrl(event)
  };
}

async function guard(context: RouteContext) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) {
    return { response: noStore(auth.response!) };
  }

  if (!takeStudentWrite(`webinar:${auth.user.id}`)) {
    return {
      response: noStore(
        NextResponse.json({ error: STUDENT_WRITE_LIMIT_MESSAGE }, { headers: { "Retry-After": String(STUDENT_WRITE_RETRY_AFTER_SECONDS) }, status: 429 })
      )
    };
  }

  const { id } = await context.params;

  if (!isUuid(id)) {
    return { response: noStore(NextResponse.json({ error: INVALID_WEBINAR }, { status: 400 })) };
  }

  return { userId: auth.user.id, webinarId: id.toLowerCase() };
}

export async function POST(request: Request, context: RouteContext) {
  const guarded = await guard(context);

  if ("response" in guarded) {
    return guarded.response;
  }

  let payload: unknown;

  try {
    payload = await readBody(request);
  } catch (error) {
    return noStore(jsonRouteError(error, INVALID_REQUEST, 400));
  }

  const parsed = registerBodySchema.safeParse(payload);

  if (!parsed.success) {
    return noStore(NextResponse.json({ error: parsed.error.issues[0]?.message ?? INVALID_REQUEST }, { status: 400 }));
  }

  try {
    const result = await registerStudent({
      sessionId: parsed.data.sessionId ?? null,
      source: parsed.data.source?.trim() || null,
      userId: guarded.userId,
      webinarId: guarded.webinarId
    });
    const data = { registration: registrationJson(result.registration), ...calendarJson(request, result.webinar, result.session, result.registration) };

    return noStore(NextResponse.json({ data }, { status: result.created ? 201 : 200 }));
  } catch (error) {
    if (error instanceof RegistrationRefusedError) {
      return noStore(NextResponse.json({ error: error.message, reason: error.reason }, { status: 409 }));
    }

    return noStore(jsonRouteError(error, "Não foi possível garantir a vaga."));
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const guarded = await guard(context);

  if ("response" in guarded) {
    return guarded.response;
  }

  let payload: unknown;

  try {
    payload = await readBody(request);
  } catch (error) {
    return noStore(jsonRouteError(error, INVALID_REQUEST, 400));
  }

  const parsed = unregisterBodySchema.safeParse(payload);

  if (!parsed.success) {
    return noStore(NextResponse.json({ error: parsed.error.issues[0]?.message ?? INVALID_REQUEST }, { status: 400 }));
  }

  try {
    const result = await unregisterStudent({ sessionId: parsed.data.sessionId ?? null, userId: guarded.userId, webinarId: guarded.webinarId });

    return noStore(
      NextResponse.json({ data: { cancelled: result.cancelled, registration: result.registration ? registrationJson(result.registration) : null } })
    );
  } catch (error) {
    return noStore(jsonRouteError(error, "Não foi possível cancelar a vaga."));
  }
}

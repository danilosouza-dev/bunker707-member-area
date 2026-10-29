import "server-only";

// Avisos de webinario para o aluno fora do tick (docs/30 §2.3 e §2.7, D27): live cancelada (sino e, com o e-mail
// ligado no webinario, e-mail para quem tinha vaga nas sessoes ainda abertas; uma vez por vaga pela marca
// cancelled_notice_sent_at), hora marcada que mudou (sino; as marcas dos lembretes das vagas da sessao sao zeradas
// antes, e os lembretes recomecam na hora nova) e "Comecou agora" (sino, uma vez por vaga pela marca
// started_notice_sent_at; a fase 3 chama ao abrir a sala). Os lembretes de 24 h e 1 h ficam no job do tick
// (src/server/jobs/webinar-reminders-job.ts, reminders.ts). Este arquivo e o ponto que as Server Actions do admin
// chamam: nenhuma funcao lanca (a falha vira console.error) e todas devolvem contagens. A equipe nunca recebe; o
// dedupe_key (webinar:<sessao>:<tipo>:<hora marcada>) segura a repeticao mesmo onde nao ha marca. So recebe quem ainda
// passa pelo "Quem pode" (listStudentRegistrations), com a vaga como ancora do segmento no Segmento e no "both" e, no
// "Produto ou segmento", o produto ou o segmento de agora: o reembolsado fica de fora. Fase 4c: a resposta da equipe
// que chega depois (o aluno pediu a equipe, a sessao acabou ou ele saiu da sala) vira aviso no sino com o texto da
// resposta, uma vez por pergunta (dedupe_key webinar:<sessao>:answer:<pergunta ou mensagem>).

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { formatWebinarWhen } from "../../lib/webinar-time";
import { describeError } from "../communications/db";
import { insertNotificationRows } from "../communications/store";
import { renderWebinarCancelledEmail } from "../email/templates/webinar-cancelled";
import { fetchStaffUserIds } from "../students/store";
import { assertNoDbError, type WebinarsDb } from "./db";
import { REMINDER_RULES, toTime, webinarHref, type Webinar } from "./model";
import {
  createWebinarNoticeContext,
  listStudentRegistrations,
  queueWebinarEmail,
  webinarNoticeExpiresAt,
  webinarNoticeRow,
  type WebinarNoticeContext
} from "./reminders";
import { webinarFromRow, type RegistrationRow, type SessionRow } from "./rows";
import { fetchSessionRow, fetchWebinarRow, listSessionRows, markRegistrationSent } from "./store";

export type NotifyResult = { emails: number; notifications: number };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** O aviso de cancelamento fica no sino pelo menos uma semana (a live pode ter sido cancelada em cima da hora). */
const CANCELLED_MIN_MS = 7 * 24 * HOUR_MS;

/** A sessao ainda vale um aviso: nao e replay, nao encerrou e nao passou do fim previsto + 2 h. */
function isOpenSession(session: SessionRow, durationMinutes: number, nowMs: number) {
  return (
    session.kind !== "replay" &&
    session.status !== "ended" &&
    toTime(session.scheduled_at) + (durationMinutes + REMINDER_RULES.autoEndMinutesAfter) * MINUTE_MS >= nowMs
  );
}

/** O webinario publicado e nao cancelado (as vagas so existem nele); null fora disso. */
async function loadLiveWebinar(db: WebinarsDb, webinarId: string): Promise<Webinar | null> {
  const row = await fetchWebinarRow(db, webinarId);

  if (!row) {
    return null;
  }

  const webinar = webinarFromRow(row);

  return webinar.status === "published" && !webinar.cancelledAt ? webinar : null;
}

/** Vaga a vaga: so quem marcou agora (a coluna estava nula) recebe. */
async function markOnce(ctx: WebinarNoticeContext, registrations: readonly RegistrationRow[], column: "cancelled_notice_sent_at" | "started_notice_sent_at") {
  const marked: RegistrationRow[] = [];

  for (const registration of registrations) {
    if (await markRegistrationSent(ctx.db, registration.id, column, ctx.nowIso)) {
      marked.push(registration);
    }
  }

  return marked;
}

async function emailCancelled(ctx: WebinarNoticeContext, webinar: Webinar, session: SessionRow, registrations: readonly RegistrationRow[]) {
  const contacts = await ctx.emails(registrations.map((registration) => registration.user_id));
  let queued = 0;

  for (const registration of registrations) {
    const contact = contacts.get(registration.user_id);
    const email = contact?.email ?? null;

    if (!email) {
      console.warn(`[webinarios] ${registration.user_id} sem e-mail no perfil: aviso de live cancelada so pelo sino.`);
      continue;
    }

    const rendered = renderWebinarCancelledEmail({ fullName: contact?.fullName ?? null, reason: webinar.cancelReason, title: webinar.title });
    const sent = await queueWebinarEmail(ctx, {
      kind: "cancelled",
      rendered,
      scheduledAt: session.scheduled_at,
      sessionId: session.id,
      to: email,
      userId: registration.user_id,
      webinarId: webinar.id
    });

    if (sent) {
      queued += 1;
    }
  }

  return queued;
}

/** Live cancelada: sino (e e-mail) para quem tinha vaga nas sessoes abertas; uma vez por vaga. */
export async function queueWebinarCancelledNotices(db: WebinarsDb, webinarId: string, now: Date): Promise<NotifyResult> {
  const result: NotifyResult = { emails: 0, notifications: 0 };

  try {
    const row = await fetchWebinarRow(db, webinarId);

    if (!row) {
      return result;
    }

    const webinar = webinarFromRow(row);
    const ctx = createWebinarNoticeContext(db, now);
    const sessions = (await listSessionRows(db, [webinarId])).filter((session) => isOpenSession(session, webinar.durationMinutes, ctx.nowMs));

    for (const session of sessions) {
      const marked = await markOnce(ctx, await listStudentRegistrations(ctx, session, webinar), "cancelled_notice_sent_at");

      if (marked.length === 0) {
        continue;
      }

      const expiresAt = webinarNoticeExpiresAt({ durationMinutes: webinar.durationMinutes, floorMs: ctx.nowMs + CANCELLED_MIN_MS, scheduledAt: session.scheduled_at });

      result.notifications += await insertNotificationRows(
        db,
        marked.map((registration) =>
          webinarNoticeRow({
            body: WEBINAR_COPY.sino.cancelada(webinar.title),
            expiresAt,
            kind: "cancelled",
            scheduledAt: session.scheduled_at,
            sessionId: session.id,
            title: WEBINAR_COPY.sino.tituloCancelada,
            userId: registration.user_id,
            webinar
          })
        )
      );

      if (webinar.reminders.email) {
        result.emails += await emailCancelled(ctx, webinar, session, marked);
      }
    }
  } catch (error) {
    console.error(`[webinarios] aviso de live cancelada (${webinarId}) nao enviado por inteiro: ${describeError(error)}`);
  }

  return result;
}

/** Zera as marcas dos lembretes das vagas da sessao (e das vagas gerais do webinario), direto na tabela. */
async function resetReminderMarks(db: WebinarsDb, session: Pick<SessionRow, "id" | "webinar_id">) {
  const { error } = await db
    .from("webinar_registrations")
    .update({ reminder_1h_sent_at: null, reminder_24h_sent_at: null })
    .eq("webinar_id", session.webinar_id)
    .eq("status", "registered")
    .or(`session_id.eq.${session.id},session_id.is.null`);
  assertNoDbError(error, "Webinarios: zerar os lembretes da sessao");
}

/** Hora marcada mudou: sino para quem tinha vaga naquela sessao; os lembretes recomecam (marcas zeradas). */
export async function queueWebinarRescheduledNotices(db: WebinarsDb, sessionId: string, now: Date): Promise<NotifyResult> {
  const result: NotifyResult = { emails: 0, notifications: 0 };

  try {
    const session = await fetchSessionRow(db, sessionId);

    if (!session || session.kind === "replay" || (session.status !== "scheduled" && session.status !== "waiting")) {
      return result;
    }

    const webinar = await loadLiveWebinar(db, session.webinar_id);

    if (!webinar) {
      return result;
    }

    // Primeiro as marcas: os lembretes recomecam na hora nova mesmo que o aviso abaixo falhe.
    await resetReminderMarks(db, session);

    const ctx = createWebinarNoticeContext(db, now);
    const registrations = await listStudentRegistrations(ctx, session, webinar);

    if (registrations.length === 0) {
      return result;
    }

    const expiresAt = webinarNoticeExpiresAt({ durationMinutes: webinar.durationMinutes, floorMs: ctx.nowMs + HOUR_MS, scheduledAt: session.scheduled_at });
    const body = WEBINAR_COPY.sino.remarcada(webinar.title, formatWebinarWhen(session.scheduled_at));

    result.notifications += await insertNotificationRows(
      db,
      registrations.map((registration) =>
        webinarNoticeRow({
          body,
          expiresAt,
          kind: "rescheduled",
          scheduledAt: session.scheduled_at,
          sessionId: session.id,
          title: WEBINAR_COPY.sino.tituloRemarcada,
          userId: registration.user_id,
          webinar
        })
      )
    );
  } catch (error) {
    console.error(`[webinarios] aviso de hora nova da sessao ${sessionId} nao enviado por inteiro: ${describeError(error)}`);
  }

  return result;
}

/** A resposta da equipe fica no sino por duas semanas (a sessao pode ter acabado ha tempo). */
const ANSWER_NOTICE_MS = 14 * 24 * HOUR_MS;
const NOTICE_TITLE_MAX = 200;
const NOTICE_BODY_MAX = 600;

/** `webinar:<sessao>:answer:<pergunta ou mensagem>`: a mesma resposta nunca entra duas vezes no sino. */
export function webinarAnswerDedupeKey(sessionId: string, targetId: string) {
  return `webinar:${sessionId}:answer:${targetId}`;
}

/**
 * Fase 4c (docs/30 §1.6, Atendentes): a equipe respondeu depois a pergunta do aluno (ele pediu a equipe, a sessao
 * acabou ou ele saiu da sala). Sino kind 'webinar' com o titulo do webinario, o texto da resposta e o link da pagina
 * da live, uma vez por pergunta (ou mensagem do chat). Nunca para a equipe; nunca lanca.
 */
export async function queueWebinarAnswerNotice(
  db: WebinarsDb,
  input: { answerText: string; now: Date; sessionId: string; targetId: string; userId: string; webinarId: string }
): Promise<NotifyResult> {
  const result: NotifyResult = { emails: 0, notifications: 0 };

  try {
    const text = input.answerText.trim();
    const row = text ? await fetchWebinarRow(db, input.webinarId) : null;

    if (!row) {
      return result;
    }

    const staff = await fetchStaffUserIds(db);

    if (staff.has(input.userId)) {
      return result;
    }

    const webinar = webinarFromRow(row);

    result.notifications += await insertNotificationRows(db, [
      {
        body: WEBINAR_COPY.assistente.sino.corpo(text).slice(0, NOTICE_BODY_MAX),
        dedupe_key: webinarAnswerDedupeKey(input.sessionId, input.targetId),
        expires_at: new Date(input.now.getTime() + ANSWER_NOTICE_MS).toISOString(),
        href: webinarHref(webinar.slug),
        kind: "webinar",
        payload: { kind: "answer", sessionId: input.sessionId, targetId: input.targetId, webinarId: webinar.id },
        title: WEBINAR_COPY.assistente.sino.titulo(webinar.title).slice(0, NOTICE_TITLE_MAX),
        user_id: input.userId
      }
    ]);
  } catch (error) {
    console.error(`[webinarios] aviso da resposta da equipe (${input.targetId}) nao enviado: ${describeError(error)}`);
  }

  return result;
}

/** "Comecou agora": sino para quem tinha vaga (uma vez por vaga; a fase 3 chama ao abrir a sala). */
export async function queueWebinarStartedNotices(db: WebinarsDb, sessionId: string, now: Date): Promise<NotifyResult> {
  const result: NotifyResult = { emails: 0, notifications: 0 };

  try {
    const session = await fetchSessionRow(db, sessionId);

    // A sessao jit nunca manda "Começou agora" (nem pelo botao Começar do console): seria um aviso por horario.
    if (!session || session.kind === "replay" || session.jit === true || session.status === "ended" || session.status === "cancelled") {
      return result;
    }

    const webinar = await loadLiveWebinar(db, session.webinar_id);

    if (!webinar) {
      return result;
    }

    const ctx = createWebinarNoticeContext(db, now);
    const marked = await markOnce(ctx, await listStudentRegistrations(ctx, session, webinar), "started_notice_sent_at");

    if (marked.length === 0) {
      return result;
    }

    // Fica no sino enquanto a live pode estar no ar, mesmo num comeco atrasado.
    const expiresAt = webinarNoticeExpiresAt({
      durationMinutes: webinar.durationMinutes,
      floorMs: ctx.nowMs + (webinar.durationMinutes + REMINDER_RULES.autoEndMinutesAfter) * MINUTE_MS,
      scheduledAt: session.scheduled_at
    });
    const body = webinar.reminderTexts.started ?? WEBINAR_COPY.sino.comecou(webinar.title);

    result.notifications += await insertNotificationRows(
      db,
      marked.map((registration) =>
        webinarNoticeRow({
          body,
          expiresAt,
          kind: "started",
          scheduledAt: session.scheduled_at,
          sessionId: session.id,
          title: WEBINAR_COPY.sino.tituloComecou,
          userId: registration.user_id,
          webinar
        })
      )
    );
  } catch (error) {
    console.error(`[webinarios] aviso "Comecou agora" da sessao ${sessionId} nao enviado por inteiro: ${describeError(error)}`);
  }

  return result;
}

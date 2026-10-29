import "server-only";

// Lembretes da live no tick de minuto (docs/30 §2.7 e §6.4, passo 2): 24 h e 1 h antes da hora marcada, pelo sino
// (notifications.kind = 'webinar', D27) e por e-mail (fila email_outbox), so para quem clicou Garantir vaga e nunca
// para a equipe (admin_roles). Qual lembrete sai (o de 1 h que espera o de 24 h, o "Hoje as" quando o de 24 h
// atrasou, os dois marcados de uma vez abaixo de 50 min) e reminderDecision, em model.ts. Idempotente em tres
// camadas: a marca na vaga (markRegistrationSent: so quem marcou envia), o dedupe_key do sino
// (webinar:<sessao>:<tipo>:<hora marcada>) e a chave de idempotencia do e-mail, as duas com a hora marcada para a
// sessao remarcada mandar de novo. O mesmo passo encerra sozinho a sessao que ninguem abriu ate 2 h depois do fim
// previsto (docs/30 §2.3). Sem trabalho: uma consulta de sessoes e nada mais. Banco sem a migracao 202610280001:
// registra e devolve zeros (o tick continua verde). Fora de um pedido do Next: a origem dos links dos e-mails e
// resolveEmailSiteOrigin(null). O job e src/server/jobs/webinar-reminders-job.ts; notify.ts (cancelada, remarcada
// e "Comecou agora") divide os ajudantes exportados daqui.

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { saoPauloDate, saoPauloTime } from "../../lib/webinar-time";
import { chunksOf } from "../communications/db";
import { insertNotificationRows, type NotificationInsert } from "../communications/store";
import { isPendingMigrationError } from "../db/pending-migration";
import { enqueueEmail } from "../email/outbox";
import { webinarIdempotencyKey, type EmailKind, type WebinarEmailKey } from "../email/outbox-rules";
import { renderWebinarReminderEmail } from "../email/templates/webinar-reminder";
import { resolveEmailSiteOrigin } from "../email/transactional";
import { fetchProfilesByIds, fetchStaffUserIds } from "../students/store";
import { isMissingWebinarSchema, WEBINARS_MIGRATION, type WebinarsDb } from "./db";
import { REMINDER_RULES, reminderDecision, toTime, webinarHref, type ReminderDecision, type Webinar } from "./model";
import { webinarFromRow, type RegistrationRow, type SessionRow } from "./rows";
import { fetchWebinarRow, listSessionRegistrationRows, listSessionRowsBetween, markRegistrationSent, updateSessionRow } from "./store";

/** Tipos de aviso de live no sino: o payload.kind da linha e a parte do meio do dedupe_key. */
export const WEBINAR_NOTICE_KINDS = ["h24", "h1", "started", "cancelled", "rescheduled"] as const;
export type WebinarNoticeKind = (typeof WEBINAR_NOTICE_KINDS)[number];

const MINUTE_MS = 60_000;
/** Limites de notifications (202610200001). */
const NOTICE_TITLE_MAX = 200;
const NOTICE_BODY_MAX = 600;
/** Lote do `in` de profiles (a URL do PostgREST). */
const PROFILE_CHUNK = 150;
/** Sessoes 'scheduled'/'waiting' esquecidas ate 60 dias atras ainda encerram sozinhas. */
const AUTO_END_LOOKBACK_MS = 60 * 24 * 60 * MINUTE_MS;
const EMAIL_KIND_OF: Record<WebinarEmailKey, EmailKind> = { cancelled: "webinar_cancelled", h1: "webinar_reminder_1h", h24: "webinar_reminder_24h" };

export type StudentContact = { email: string | null; fullName: string | null };

/** O que um tick (ou uma acao do admin) divide entre os avisos: a hora, a equipe e os e-mails, lidos uma vez. */
export type WebinarNoticeContext = {
  db: WebinarsDb;
  /** E-mail e nome dos alunos pedidos (profiles), em lotes de 150. */
  emails(userIds: readonly string[]): Promise<Map<string, StudentContact>>;
  nowIso: string;
  nowMs: number;
  /** Origem publica dos links dos e-mails (NEXT_PUBLIC_SITE_URL; o tick nao tem pedido do Next). */
  origin: string;
  signal?: AbortSignal;
  /** Quem e da equipe (admin_roles), lido uma vez: a equipe nunca recebe aviso de live. */
  staff(): Promise<ReadonlySet<string>>;
};

export function createWebinarNoticeContext(db: WebinarsDb, now: Date, signal?: AbortSignal): WebinarNoticeContext {
  let staff: Promise<ReadonlySet<string>> | null = null;

  return {
    db,
    async emails(userIds) {
      const contacts = new Map<string, StudentContact>();

      for (const part of chunksOf([...new Set(userIds)], PROFILE_CHUNK)) {
        for (const profile of await fetchProfilesByIds(db, part)) {
          contacts.set(profile.id, { email: profile.email?.trim() || null, fullName: profile.full_name });
        }
      }

      return contacts;
    },
    nowIso: now.toISOString(),
    nowMs: now.getTime(),
    origin: resolveEmailSiteOrigin(null),
    signal,
    staff() {
      staff ??= fetchStaffUserIds(db);

      return staff;
    }
  };
}

/** Hora marcada em AAAAMMDDHHMM (UTC): entra no dedupe_key do sino e na chave do e-mail. */
export function scheduledStamp(scheduledAt: string | number): string {
  const time = toTime(scheduledAt);

  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 16).replace(/\D/g, "") : "0";
}

/** `webinar:<sessao>:<tipo>:<hora marcada>` (docs/30 §4.2): o mesmo aviso nunca entra duas vezes; a sessao remarcada e outro aviso. */
export function webinarDedupeKey(sessionId: string, kind: WebinarNoticeKind, scheduledAt: string | number) {
  return `webinar:${sessionId}:${kind}:${scheduledStamp(scheduledAt)}`;
}

/**
 * Fim no sino: hora marcada + duracao + 2 h (docs/30 §4.2), nunca antes de `floorMs` (o check do banco exige
 * expires_at > created_at, e um aviso de cancelamento ou de comeco atrasado precisa ficar algum tempo).
 */
export function webinarNoticeExpiresAt(input: { durationMinutes: number; floorMs: number; scheduledAt: string | number }) {
  const end = toTime(input.scheduledAt) + (input.durationMinutes + REMINDER_RULES.autoEndMinutesAfter) * MINUTE_MS;

  return new Date(Math.max(Number.isFinite(end) ? end : 0, input.floorMs)).toISOString();
}

/** A linha do sino de um aviso de live: titulo, texto e link na propria linha; o payload so com ids e o tipo. */
export function webinarNoticeRow(input: {
  body: string;
  expiresAt: string;
  kind: WebinarNoticeKind;
  scheduledAt: string;
  sessionId: string;
  title: string;
  userId: string;
  webinar: Pick<Webinar, "id" | "slug">;
}): NotificationInsert {
  return {
    body: input.body.slice(0, NOTICE_BODY_MAX),
    dedupe_key: webinarDedupeKey(input.sessionId, input.kind, input.scheduledAt),
    expires_at: input.expiresAt,
    href: webinarHref(input.webinar.slug),
    kind: "webinar",
    payload: { kind: input.kind, sessionId: input.sessionId, webinarId: input.webinar.id },
    title: input.title.slice(0, NOTICE_TITLE_MAX),
    user_id: input.userId
  };
}

/** As vagas garantidas de uma sessao sem a equipe (admin_roles). */
export async function listStudentRegistrations(ctx: WebinarNoticeContext, session: { id: string; webinar_id: string }): Promise<RegistrationRow[]> {
  const rows = await listSessionRegistrationRows(ctx.db, session, ["registered"]);

  if (rows.length === 0) {
    return rows;
  }

  const staff = await ctx.staff();

  return rows.filter((row) => !staff.has(row.user_id));
}

/** Enfileira um e-mail de live (fila email_outbox); false quando a mesma chave ja estava na fila. */
export async function queueWebinarEmail(
  ctx: WebinarNoticeContext,
  input: {
    kind: WebinarEmailKey;
    rendered: { html: string; subject: string; text: string };
    scheduledAt: string;
    sessionId: string;
    to: string;
    userId: string;
    webinarId: string;
  }
): Promise<boolean> {
  const { duplicate } = await enqueueEmail(ctx.db, {
    html: input.rendered.html,
    idempotencyKey: webinarIdempotencyKey({ kind: input.kind, sessionId: input.sessionId, stamp: scheduledStamp(input.scheduledAt), userId: input.userId }),
    kind: EMAIL_KIND_OF[input.kind],
    metadata: { session_id: input.sessionId, webinar_id: input.webinarId },
    subject: input.rendered.subject,
    text: input.rendered.text,
    to: input.to,
    userId: input.userId
  });

  return !duplicate;
}

export type WebinarRemindersResult = {
  /** Sessoes 'scheduled'/'waiting' que passaram do fim previsto + 2 h e viraram 'ended'. */
  autoEnded: number;
  emails: number;
  /** Banco sem a migracao 202610280001: nada feito, o tick continua verde. */
  pendingMigration: boolean;
  reminders1h: number;
  reminders24h: number;
  /** Vagas com lembrete vencido que outro tick marcou primeiro (ou que mudaram no meio): nada enviado por aqui. */
  skipped: number;
};

function isMissingWebinars(error: unknown) {
  return isPendingMigrationError(error) || isMissingWebinarSchema(error);
}

/** O texto da equipe (card Vaga e lembretes) para este lembrete; o "Hoje as" do 24 h atrasado e sempre o padrao. */
function customReminderText(webinar: Webinar, decision: ReminderDecision) {
  if (decision.variant === "today") {
    return null;
  }

  return decision.send === "24h" ? webinar.reminderTexts.h24 : webinar.reminderTexts.h1;
}

/** O texto do lembrete no sino (docs/30 §2.7). */
function reminderBody(webinar: Webinar, scheduledAt: string, decision: ReminderDecision) {
  const custom = customReminderText(webinar, decision);

  if (custom) {
    return custom;
  }

  const time = saoPauloTime(scheduledAt);

  switch (decision.variant) {
    case "tomorrow":
      return WEBINAR_COPY.sino.h24(webinar.title, time);
    case "today":
      return WEBINAR_COPY.sino.hoje(webinar.title, time);
    case "one_hour":
      return WEBINAR_COPY.sino.h1(webinar.title);
  }
}

type DueReminder = { decision: ReminderDecision; registration: RegistrationRow };
type DueEmail = DueReminder & { email: string; fullName: string | null };

/** Os lembretes vencidos de uma sessao: marca a vaga, grava o sino e enfileira o e-mail (quando ligado). */
async function remindSession(ctx: WebinarNoticeContext, result: WebinarRemindersResult, webinar: Webinar, session: SessionRow) {
  const due: DueReminder[] = [];

  for (const registration of await listStudentRegistrations(ctx, session)) {
    const decision = reminderDecision({
      now: ctx.nowMs,
      reminders: webinar.reminders,
      scheduledAt: session.scheduled_at,
      sent1h: Boolean(registration.reminder_1h_sent_at),
      sent24h: Boolean(registration.reminder_24h_sent_at)
    });

    if (decision) {
      due.push({ decision, registration });
    }
  }

  if (due.length === 0) {
    return;
  }

  const contacts = webinar.reminders.email ? await ctx.emails(due.map((item) => item.registration.user_id)) : new Map<string, StudentContact>();
  const expiresAt = webinarNoticeExpiresAt({ durationMinutes: webinar.durationMinutes, floorMs: ctx.nowMs, scheduledAt: session.scheduled_at });
  const rows: NotificationInsert[] = [];
  const emails: DueEmail[] = [];

  for (const item of due) {
    if (ctx.signal?.aborted) {
      break;
    }

    const { decision, registration } = item;
    const column = decision.send === "24h" ? "reminder_24h_sent_at" : "reminder_1h_sent_at";

    // So quem marcou envia: dois ticks no mesmo minuto nunca mandam o mesmo lembrete.
    if (!(await markRegistrationSent(ctx.db, registration.id, column, ctx.nowIso))) {
      result.skipped += 1;
      continue;
    }

    if (decision.markAlso === "24h") {
      // Abaixo de 50 min com os dois pendentes: sai so o de 1 h e o de 24 h e dado como feito.
      await markRegistrationSent(ctx.db, registration.id, "reminder_24h_sent_at", ctx.nowIso);
    }

    rows.push(
      webinarNoticeRow({
        body: reminderBody(webinar, session.scheduled_at, decision),
        expiresAt,
        kind: decision.send === "24h" ? "h24" : "h1",
        scheduledAt: session.scheduled_at,
        sessionId: session.id,
        title: WEBINAR_COPY.sino.tituloLembrete,
        userId: registration.user_id,
        webinar
      })
    );

    if (decision.send === "24h") {
      result.reminders24h += 1;
    } else {
      result.reminders1h += 1;
    }

    if (webinar.reminders.email) {
      const contact = contacts.get(registration.user_id);
      const email = contact?.email ?? null;

      if (email) {
        emails.push({ ...item, email, fullName: contact?.fullName ?? null });
      } else {
        console.warn(`[webinarios] ${registration.user_id} sem e-mail no perfil: lembrete so pelo sino.`);
      }
    }
  }

  // O que foi marcado entra no sino mesmo com o orcamento no fim (um upsert por lote de 500).
  if (rows.length > 0) {
    await insertNotificationRows(ctx.db, rows);
  }

  for (const { decision, email, fullName, registration } of emails) {
    if (ctx.signal?.aborted) {
      break;
    }

    const rendered = renderWebinarReminderEmail({
      customText: customReminderText(webinar, decision),
      dateLabel: saoPauloDate(session.scheduled_at),
      fullName,
      link: `${ctx.origin}${webinarHref(webinar.slug)}`,
      timeLabel: saoPauloTime(session.scheduled_at),
      title: webinar.title,
      variant: decision.variant
    });
    const queued = await queueWebinarEmail(ctx, {
      kind: decision.send === "24h" ? "h24" : "h1",
      rendered,
      scheduledAt: session.scheduled_at,
      sessionId: session.id,
      to: email,
      userId: registration.user_id,
      webinarId: webinar.id
    });

    if (queued) {
      result.emails += 1;
    }
  }
}

/**
 * Um tick dos lembretes: uma consulta de sessoes abertas (scheduled/waiting, de 60 dias atras ate 24 h a frente) e,
 * so com sessao na janela, o resto. Lembretes so de sessao 'scheduled' ainda por vir, de webinario publicado e nao
 * cancelado; a sessao que passou do fim previsto + 2 h vira 'ended' (a situacao Encerrado de docs/30 §2.3).
 */
export async function processWebinarReminders(input: { db: WebinarsDb; now?: Date; signal?: AbortSignal }): Promise<WebinarRemindersResult> {
  const { db, signal } = input;
  const now = input.now ?? new Date();
  const result: WebinarRemindersResult = { autoEnded: 0, emails: 0, pendingMigration: false, reminders1h: 0, reminders24h: 0, skipped: 0 };

  if (signal?.aborted) {
    return result;
  }

  try {
    const sessions = await listSessionRowsBetween(db, {
      from: new Date(now.getTime() - AUTO_END_LOOKBACK_MS).toISOString(),
      statuses: ["scheduled", "waiting"],
      to: new Date(now.getTime() + REMINDER_RULES.h24Minutes * MINUTE_MS).toISOString()
    });

    if (sessions.length === 0) {
      return result;
    }

    const ctx = createWebinarNoticeContext(db, now, signal);
    const webinars = new Map<string, Webinar | null>();
    const webinarOf = async (id: string) => {
      if (!webinars.has(id)) {
        const row = await fetchWebinarRow(db, id);
        webinars.set(id, row ? webinarFromRow(row) : null);
      }

      return webinars.get(id) ?? null;
    };

    for (const session of sessions) {
      if (signal?.aborted) {
        break;
      }

      if (session.kind === "replay") {
        continue;
      }

      const webinar = await webinarOf(session.webinar_id);

      if (!webinar) {
        continue;
      }

      const startsAt = toTime(session.scheduled_at);
      const autoEndAt = startsAt + (webinar.durationMinutes + REMINDER_RULES.autoEndMinutesAfter) * MINUTE_MS;

      if (autoEndAt < ctx.nowMs) {
        // Ninguem abriu a sala ate 2 h depois do fim previsto: encerra sozinha (docs/30 §2.3).
        if (await updateSessionRow(db, session.id, { status: "ended" }, { expectedStatuses: ["scheduled", "waiting"] })) {
          result.autoEnded += 1;
        }

        continue;
      }

      if (session.status !== "scheduled" || !(startsAt > ctx.nowMs) || webinar.status !== "published" || webinar.cancelledAt) {
        continue;
      }

      if (!webinar.reminders.h24 && !webinar.reminders.h1) {
        continue;
      }

      await remindSession(ctx, result, webinar, session);
    }
  } catch (error) {
    if (isMissingWebinars(error)) {
      result.pendingMigration = true;
      console.info(`[webinarios] tabelas dos webinarios ausentes (migracao ${WEBINARS_MIGRATION} pendente); nada a fazer.`);

      return result;
    }

    throw error;
  }

  return result;
}

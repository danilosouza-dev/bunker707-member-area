// Garantir vaga e Cancelar minha vaga (docs/30 §1.2, §4.7 e §5.1): acesso conferido, sessao valida (na Live
// ao vivo o pedido pode vir sem sessao: vale a sessao `live`; na Live gravada o aluno escolhe a sessao),
// vaga livre (canRegister: antes do fim e dentro do limite de vagas), uma linha por aluno e sessao
// (upsertRegistrationRow: repetir devolve a que ja existia) e o registro webinar_registered no historico,
// gravado so pelo servidor e so quando algo mudou. Erros: 404 fora do acesso ou sem o webinario/sessao;
// 409 { reason: 'ended' | 'sold_out' | 'cancelled' } quando a vaga nao cabe mais.

import "server-only";

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { recordCommunicationEvents } from "../communications/route-support";
import { requireWebinarAccess } from "./access";
import { WebinarError, webinarsDb, type WebinarsDb } from "./db";
import { canRegister, registrationEventMetadata, nextSession, type Webinar, type WebinarRegistration, type WebinarSession } from "./model";
import { registrationFromRow, sessionFromRow, webinarFromRow } from "./rows";
import { cancelRegistrationRow, countSessionRegistrations, fetchWebinarRow, listSessionRows, upsertRegistrationRow } from "./store";

export type RegistrationRefusal = "cancelled" | "ended" | "sold_out";

const REFUSAL_MESSAGES: Record<RegistrationRefusal, string> = {
  cancelled: WEBINAR_COPY.aluno.cancelada,
  ended: WEBINAR_COPY.aluno.encerrada,
  sold_out: WEBINAR_COPY.aluno.esgotado
};

/** A vaga nao cabe mais (409 { reason }): live encerrada, vagas esgotadas ou live cancelada. */
export class RegistrationRefusedError extends WebinarError {
  reason: RegistrationRefusal;

  constructor(reason: RegistrationRefusal) {
    super(REFUSAL_MESSAGES[reason], 409);
    this.name = "RegistrationRefusedError";
    this.reason = reason;
  }
}

export type StudentWebinarRecord = { sessions: WebinarSession[]; webinar: Webinar };

/**
 * O webinario publicado (nao apagado) que o aluno pode ver, com as sessoes. Rascunho, arquivado, inexistente
 * ou fora do acesso: 404 sem dizer se existe (docs/30 §8.2).
 */
export async function loadStudentWebinarById(db: WebinarsDb, userId: string, webinarId: string, now = Date.now()): Promise<StudentWebinarRecord> {
  const row = await fetchWebinarRow(db, webinarId);
  if (!row || row.status !== "published") {
    throw new WebinarError(WEBINAR_COPY.aluno.naoDisponivel, 404);
  }
  const webinar = webinarFromRow(row);
  await requireWebinarAccess(userId, webinar, { db, now });
  const sessions = (await listSessionRows(db, [webinar.id])).map(sessionFromRow);
  return { sessions, webinar };
}

/**
 * A sessao da vaga: a pedida (precisa ser deste webinario e nao ser a `replay`); sem pedido, na Live ao vivo a
 * sessao `live` (ou a proxima) e, na Live gravada, 400 "Escolha a sessao." (o aluno escolhe antes).
 */
export function resolveStudentSession(record: StudentWebinarRecord, sessionId: string | null | undefined, now = Date.now()): WebinarSession {
  const real = record.sessions.filter((session) => session.kind !== "replay");

  if (sessionId) {
    const found = real.find((session) => session.id === sessionId);
    if (!found) {
      throw new WebinarError("Sessão inválida.", 404);
    }
    return found;
  }

  if (record.webinar.kind === "live") {
    const live = real.find((session) => session.kind === "live") ?? nextSession(real, record.webinar.durationMinutes, now);
    if (!live) {
      throw new WebinarError("Sessão inválida.", 404);
    }
    return live;
  }

  throw new WebinarError(WEBINAR_COPY.aluno.escolhaSessao, 400);
}

export type RegisterStudentInput = {
  campaignId?: string | null;
  db?: WebinarsDb;
  now?: Date;
  sessionId?: string | null;
  source?: string | null;
  userId: string;
  webinarId: string;
};

export type RegisterStudentResult = {
  created: boolean;
  registration: WebinarRegistration;
  session: WebinarSession;
  webinar: Webinar;
};

export async function registerStudent(input: RegisterStudentInput): Promise<RegisterStudentResult> {
  const db = input.db ?? webinarsDb();
  const now = input.now ?? new Date();
  const record = await loadStudentWebinarById(db, input.userId, input.webinarId, now.getTime());
  const { webinar } = record;

  if (webinar.cancelledAt) {
    throw new RegistrationRefusedError("cancelled");
  }
  if (!webinar.registrationRequired) {
    throw new WebinarError(WEBINAR_COPY.aluno.semVaga, 400);
  }

  const session = resolveStudentSession(record, input.sessionId, now.getTime());
  const registeredCount = await countSessionRegistrations(db, { id: session.id, webinar_id: webinar.id });
  const decision = canRegister({
    capacity: webinar.capacity,
    durationMinutes: webinar.durationMinutes,
    now: now.getTime(),
    registeredCount,
    session
  });

  if (!decision.ok) {
    throw new RegistrationRefusedError(decision.reason);
  }

  const { created, row } = await upsertRegistrationRow(
    db,
    { session_id: session.id, source: input.source ?? null, source_campaign_id: input.campaignId ?? null, user_id: input.userId, webinar_id: webinar.id },
    now.toISOString()
  );

  if (created) {
    await recordCommunicationEvents([
      {
        entity_id: session.id,
        entity_type: "webinar",
        event_type: "webinar_registered",
        metadata: registrationEventMetadata({ campaignId: input.campaignId ?? null, sessionId: session.id, source: input.source ?? null, webinarId: webinar.id }),
        user_id: input.userId
      }
    ]);
  }

  return { created, registration: registrationFromRow(row), session, webinar };
}

export type UnregisterStudentInput = {
  db?: WebinarsDb;
  now?: Date;
  sessionId?: string | null;
  userId: string;
  webinarId: string;
};

export type UnregisterStudentResult = {
  /** true quando esta chamada cancelou a vaga (repetir nao grava de novo). */
  cancelled: boolean;
  registration: WebinarRegistration | null;
  session: WebinarSession;
  webinar: Webinar;
};

export async function unregisterStudent(input: UnregisterStudentInput): Promise<UnregisterStudentResult> {
  const db = input.db ?? webinarsDb();
  const now = input.now ?? new Date();
  const record = await loadStudentWebinarById(db, input.userId, input.webinarId, now.getTime());
  const { webinar } = record;
  const session = resolveStudentSession(record, input.sessionId, now.getTime());
  const key = { user_id: input.userId, webinar_id: webinar.id };
  const nowIso = now.toISOString();

  // A vaga da sessao; sem ela, a vaga geral do webinario (session_id nulo), que tambem vale para a sessao.
  let row = await cancelRegistrationRow(db, { ...key, session_id: session.id }, nowIso);
  if (!row || row.cancelled_at !== nowIso) {
    const general = await cancelRegistrationRow(db, { ...key, session_id: null }, nowIso);
    row = general ?? row;
  }

  const cancelled = row?.status === "cancelled" && row.cancelled_at === nowIso;

  if (cancelled && row) {
    await recordCommunicationEvents([
      {
        entity_id: session.id,
        entity_type: "webinar",
        event_type: "webinar_registered",
        metadata: { ...registrationEventMetadata({ campaignId: row.source_campaign_id, sessionId: session.id, source: row.source, webinarId: webinar.id }), cancelled: true },
        user_id: input.userId
      }
    ]);
  }

  return { cancelled, registration: row ? registrationFromRow(row) : null, session, webinar };
}

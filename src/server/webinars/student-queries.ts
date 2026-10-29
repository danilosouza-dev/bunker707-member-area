// Leituras da area do aluno dos Webinarios (docs/30 §1.1, §1.2 e §5.1): /webinarios, /webinarios/[slug], o
// card "Proxima live" e a faixa "Comeca em 1 h" da pagina inicial e a rota GET .../session. Tudo pela service
// role (webinarsDb) e so o que o aluno pode ver: publicados, nao apagados e dentro do "Quem pode" (access.ts).
// As regras ficam em student-model.ts (puro); aqui so a leitura e a montagem.
//
// "Ver como" da equipe (accessPreviewMode): a previa decide o que aparece sem ler acesso nem segmento
// (previewCanSee) e nunca mostra vagas da propria conta. Banco sem a migracao 202610280001: listas vazias,
// sem derrubar a area.

import "server-only";

import type { AccessPreviewMode } from "../../lib/access-preview";
import { redactSecrets } from "../../lib/env-value";
import { resolveEmailSiteOrigin } from "../email/transactional";
import { fetchProfilesByIds } from "../students/store";
import type { SessionUser } from "../auth/session";
import { hasWebinarAccess, loadStudentAccessFacts } from "./access";
import { googleCalendarUrl, outlookCalendarUrl } from "./calendar";
import { isMissingWebinarSchema, WebinarError, webinarsDb, type WebinarsDb } from "./db";
import { webinarHref, type Webinar, type WebinarRegistration, type WebinarSession } from "./model";
import { registrationFromRow, sessionFromRow, webinarFromRow } from "./rows";
import { loadStudentWebinarById, resolveStudentSession } from "./registrations";
import { roomGrantFor } from "./live-room";
import { loadRoomExtras, roomContextOf } from "./room-queries";
import { canJoinSimulated } from "./room-model";
import {
  asRoomPayload,
  buildSessionPayload,
  buildStudentSession,
  buildStudentWebinarView,
  calendarPath,
  groupStudentWebinars,
  pickHomeWebinar,
  previewCanSee,
  roomHref,
  seatRequired,
  type HomeWebinarCard,
  type StudentRoomPayload,
  type StudentSessionPayload,
  type StudentSessionView,
  type StudentWebinarLists,
  type StudentWebinarView
} from "./student-model";
import { countSessionRegistrations, fetchRegistrationRows, fetchWebinarRow, fetchWebinarRowBySlug, listPublishedWebinarRows, listSessionRows } from "./store";

export type StudentQueryOptions = {
  accessPreviewMode?: AccessPreviewMode;
  db?: WebinarsDb;
};

type Loaded = { registrations: WebinarRegistration[]; sessions: WebinarSession[]; webinars: Webinar[] };

function describe(error: unknown) {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}

/** Os webinarios publicados que a pessoa pode ver, com sessoes e as vagas dela (vazio sem a migracao). */
async function loadVisible(db: WebinarsDb, userId: string, now: number, options: StudentQueryOptions, only?: (webinar: Webinar) => boolean): Promise<Loaded> {
  let rows;
  try {
    rows = await listPublishedWebinarRows(db);
  } catch (error) {
    if (isMissingWebinarSchema(error)) {
      return { registrations: [], sessions: [], webinars: [] };
    }
    throw error;
  }

  const published = rows.map((row) => webinarFromRow(row)).filter((webinar) => (only ? only(webinar) : true));
  let webinars: Webinar[];

  if (options.accessPreviewMode) {
    const mode = options.accessPreviewMode;
    webinars = published.filter((webinar) => previewCanSee(mode, webinar.accessMode));
  } else {
    const facts = await loadStudentAccessFacts(db, userId, published, now);
    webinars = published.filter((webinar) => hasWebinarAccess(facts, webinar));
  }

  const ids = webinars.map((webinar) => webinar.id);
  const [sessionRows, registrationRows] = await Promise.all([
    listSessionRows(db, ids),
    options.accessPreviewMode ? Promise.resolve([]) : fetchRegistrationRows(db, { userId, webinarIds: ids })
  ]);

  return { registrations: registrationRows.map(registrationFromRow), sessions: sessionRows.map(sessionFromRow), webinars };
}

function needsCount(webinar: Webinar) {
  return webinar.showRegisteredCount || (webinar.registrationRequired && webinar.capacity != null);
}

async function loadRegisteredCounts(db: WebinarsDb, webinars: readonly Webinar[], sessions: readonly WebinarSession[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const wanted = new Set(webinars.filter(needsCount).map((webinar) => webinar.id));
  const targets = sessions.filter((session) => wanted.has(session.webinarId) && session.kind !== "replay");

  await Promise.all(
    targets.map(async (session) => {
      counts.set(session.id, await countSessionRegistrations(db, { id: session.id, webinar_id: session.webinarId }));
    })
  );

  return counts;
}

async function loadPresenterNames(db: WebinarsDb, webinars: readonly Webinar[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(webinars.map((webinar) => webinar.hostUserId).filter((id): id is string => Boolean(id))));
  const names = new Map<string, string>();
  if (ids.length === 0) {
    return names;
  }
  try {
    for (const profile of await fetchProfilesByIds(db, ids)) {
      const name = profile.full_name?.trim();
      if (name) {
        names.set(profile.id, name);
      }
    }
  } catch (error) {
    // O nome do apresentador e um detalhe: sem ele a pagina continua.
    console.error(`[webinarios] apresentadores nao lidos: ${describe(error)}`);
  }
  return names;
}

async function buildViews(db: WebinarsDb, loaded: Loaded, now: number): Promise<StudentWebinarView[]> {
  const [counts, names] = await Promise.all([loadRegisteredCounts(db, loaded.webinars, loaded.sessions), loadPresenterNames(db, loaded.webinars)]);

  return loaded.webinars.map((webinar) =>
    buildStudentWebinarView({
      now,
      presenterName: webinar.hostUserId ? (names.get(webinar.hostUserId) ?? null) : null,
      registeredCounts: counts,
      registrations: loaded.registrations.filter((registration) => registration.webinarId === webinar.id),
      sessions: loaded.sessions.filter((session) => session.webinarId === webinar.id),
      webinar
    })
  );
}

/** Os tres blocos de /webinarios. Lanca em falha de leitura (a pagina mostra "Tentar de novo"). */
export async function listStudentWebinars(userId: string, now = Date.now(), options: StudentQueryOptions = {}): Promise<StudentWebinarLists> {
  const db = options.db ?? webinarsDb();
  const loaded = await loadVisible(db, userId, now, options);
  return groupStudentWebinars(await buildViews(db, loaded, now));
}

export type SessionCalendarLinks = { downloadUrl: string; googleUrl: string; outlookUrl: string };

/** O endereco publico da pagina do Webinario (NEXT_PUBLIC_SITE_URL; sem ela, o padrao do app). */
export function webinarPublicUrl(slug: string, fallbackOrigin?: string | null) {
  return `${resolveEmailSiteOrigin(fallbackOrigin)}${webinarHref(slug)}`;
}

export function calendarLinksFor(view: Pick<StudentWebinarView, "description" | "durationMinutes" | "id" | "slug" | "title">, session: StudentSessionView): SessionCalendarLinks | null {
  if (!session.calendarToken) {
    return null;
  }
  const event = { description: view.description, durationMinutes: view.durationMinutes, startsAt: session.scheduledAt, title: view.title, url: webinarPublicUrl(view.slug) };
  return { downloadUrl: calendarPath(view.id, session.calendarToken), googleUrl: googleCalendarUrl(event), outlookUrl: outlookCalendarUrl(event) };
}

export type StudentWebinarPage = {
  /** Links do calendario por sessao com vaga (id da sessao -> links). */
  calendars: Record<string, SessionCalendarLinks>;
  view: StudentWebinarView;
};

/** A pagina /webinarios/[slug]; null quando nao existe, nao esta publicado ou o aluno nao pode ver (404). */
export async function getStudentWebinar(userId: string, slug: string, now = Date.now(), options: StudentQueryOptions = {}): Promise<StudentWebinarPage | null> {
  const db = options.db ?? webinarsDb();
  let row;
  try {
    row = await fetchWebinarRowBySlug(db, slug);
  } catch (error) {
    if (isMissingWebinarSchema(error)) {
      return null;
    }
    throw error;
  }
  if (!row || row.status !== "published") {
    return null;
  }

  const loaded = await loadVisible(db, userId, now, options, (webinar) => webinar.id === row.id);
  if (loaded.webinars.length === 0) {
    return null;
  }

  const [view] = await buildViews(db, loaded, now);
  if (!view) {
    return null;
  }

  const calendars: Record<string, SessionCalendarLinks> = {};
  for (const session of view.sessions) {
    const links = calendarLinksFor(view, session);
    if (links) {
      calendars[session.id] = links;
    }
  }

  return { calendars, view };
}

export type HomeWebinars = { card: HomeWebinarCard | null; now: number };

/**
 * Card "Proxima live" da pagina inicial. Nunca lanca: falha vira log e nada. A faixa "Comeca em 1 h: Entrar" saiu
 * daqui para a faixa global do topo (live-banner.ts e GET /api/webinars/live-now; docs/30 §1.1).
 */
export async function getHomeWebinars(userId: string, now = Date.now(), options: StudentQueryOptions = {}): Promise<HomeWebinars> {
  try {
    const db = options.db ?? webinarsDb();
    const loaded = await loadVisible(db, userId, now, options, (webinar) => webinar.showOnHome);
    if (loaded.webinars.length === 0) {
      return { card: null, now };
    }
    const views = await buildViews(db, loaded, now);
    return { card: pickHomeWebinar(views, now), now };
  } catch (error) {
    console.error(`[webinarios] pagina inicial sem as lives: ${describe(error)}`);
    return { card: null, now };
  }
}

/** So o card da pagina inicial (showOnHome: o mais proximo, ou "Replay disponivel" dentro de replayDaysOnHome). */
export async function getNextWebinarForHome(userId: string, now = Date.now(), options: StudentQueryOptions = {}): Promise<HomeWebinarCard | null> {
  return (await getHomeWebinars(userId, now, options)).card;
}

/**
 * GET /api/webinars/[id]/session?sessao=: a sessao pedida (ou a da Live ao vivo) com a situacao, a vaga do
 * aluno e o total de vagas quando a equipe mostra; na fase 2, tambem o que a Sala precisa (relogio, fase, video,
 * mensagem fixada, enquetes, presentes e o aceite do aluno; room-queries.ts). ?sessao= pode ser a sessao `replay`.
 * Fora do acesso ou sem o webinario: WebinarError 404.
 */
export async function getStudentSessionPayload(userId: string, webinarId: string, sessionId: string | null, now = Date.now(), options: StudentQueryOptions = {}): Promise<StudentSessionPayload> {
  const db = options.db ?? webinarsDb();
  const record = await loadStudentWebinarById(db, userId, webinarId, now);
  const replay = sessionId ? (record.sessions.find((item) => item.id === sessionId && item.kind === "replay" && item.status !== "cancelled") ?? null) : null;
  const session = replay ?? resolveStudentSession(record, sessionId, now);
  const registrations = (await fetchRegistrationRows(db, { userId, webinarIds: [record.webinar.id] })).map(registrationFromRow);
  const counts = await loadRegisteredCounts(db, [record.webinar], [session]);
  const names = await loadPresenterNames(db, [record.webinar]);
  const input = {
    now,
    presenterName: record.webinar.hostUserId ? (names.get(record.webinar.hostUserId) ?? null) : null,
    registeredCounts: counts,
    registrations,
    sessions: record.sessions,
    webinar: record.webinar
  };
  const view = buildStudentWebinarView(input);
  const sessionView = view.sessions.find((item) => item.id === session.id) ?? (replay ? buildStudentSession(input, replay) : null);
  if (!sessionView) {
    throw new WebinarError("Sessão inválida.", 404);
  }
  const roomContext = await roomContextOf(db, record, session.id);
  // No "ver como" a equipe abre a sala sem vaga (nada e gravado); o aluno, so com a vaga quando ha limite (A12).
  const seatMissing = !options.accessPreviewMode && seatRequired(record.webinar, session) && !sessionView.registered;
  const room = await loadRoomExtras(db, roomContext, userId, now, { seatMissing });
  return buildSessionPayload(view, sessionView, { lateJoinMinutes: session.lateJoinMinutes, now, room });
}

/* ------------------------------------------------------------------------------------------------
 * A Sala (docs/30 §1.3 e §1.6): /webinarios/[slug]/sala?sessao=
 * ---------------------------------------------------------------------------------------------- */

export type RoomRefusalReason = "banned" | "cancelled" | "ended" | "late" | "no_seat" | "not_started";

export type RoomPageData =
  | {
      href: string;
      now: number;
      page: StudentWebinarPage;
      payload: StudentRoomPayload;
      /** Live ao vivo: host, co-apresentador ou Equipe (entram na Sessao de pratica e com a sala trancada); senao falso. */
      staff: boolean;
      state: "ready";
    }
  | { state: "not_found" }
  | { page: StudentWebinarPage; reason: RoomRefusalReason; state: "refused" }
  | { state: "error" };

/**
 * Se a pessoa entra na sala ao vivo como equipe (host, co-apresentador ou Equipe pela regra unica de live-room.ts,
 * lida do banco, nunca do navegador). Falha de leitura: como aluno (a sala abre do mesmo jeito; o join-token decide).
 */
export async function liveRoomStaff(db: WebinarsDb, userId: string, webinarId: string, now = Date.now()): Promise<boolean> {
  try {
    const row = await fetchWebinarRow(db, webinarId);
    if (!row) {
      return false;
    }
    const grant = await roomGrantFor(db, { nowMs: now, userId, webinar: webinarFromRow(row) });
    return grant.role !== "student";
  } catch (error) {
    console.error(`[webinarios] papel na sala ao vivo nao lido: ${describe(error)}`);
    return false;
  }
}

/**
 * O que a pagina da Sala faz com a sessao (puro, para o teste). A Live gravada pelo relogio: fora da janela de entrada
 * (antes de 15 min, depois do fim ou da Entrada atrasada), recusada com o motivo. A Live ao vivo (fase 3) nao segue o
 * relogio: a sala abre em qualquer situacao (a tela mostra Aguardando o apresentador antes de a equipe abrir, a sala
 * trancada, encerrada com o replay, removido ou banido) e so recusa a sessao cancelada; a vaga obrigatoria (A12) vale
 * para os dois, menos para a equipe na live (o join-token tambem deixa a equipe passar). Na gravada e no replay, o
 * banido de todos os webinarios fica fora (D33).
 */
export function roomPageDecision(
  payload: Pick<StudentRoomPayload, "session">,
  input: { durationMs: number; now: number; staff: boolean }
): { ok: true } | { ok: false; reason: RoomRefusalReason } {
  const { session } = payload;
  const join = session.join;
  if (session.kind === "live") {
    if (session.status === "cancelled") {
      return { ok: false, reason: "cancelled" };
    }
    if (!input.staff && !join.ok && join.reason === "no_seat") {
      return { ok: false, reason: "no_seat" };
    }
    return { ok: true };
  }
  // O banido de todos os webinarios nao entra na Live gravada nem no Replay (D33; a live mostra a frase na propria sala).
  if (!join.ok && (join.reason === "banned" || join.reason === "no_seat")) {
    return { ok: false, reason: join.reason };
  }
  if (session.kind !== "replay") {
    const simulated = canJoinSimulated(
      { kind: session.kind, lateJoinMinutes: session.lateJoinMinutes, recordingAnchorAt: null, scheduledAt: session.scheduledAt, startedAt: session.startedAt, status: session.status },
      input.durationMs,
      input.now
    );
    if (!simulated.ok) {
      return { ok: false, reason: simulated.reason };
    }
  }
  return { ok: true };
}

/**
 * A pagina da Sala: o webinario pelo endereco (404 fora do acesso), a sessao pedida (404 se nao e deste webinario)
 * e a resposta completa da sessao; o resto decide roomPageDecision. Na live, quem e da equipe (staff) vai junto para a
 * tela. No "ver como" da equipe a sala abre sem gravar nada e como aluno (a tela decide).
 */
export async function getRoomPageData(accessPreviewMode: AccessPreviewMode | undefined, user: SessionUser, slug: string, sessionId: string): Promise<RoomPageData> {
  const now = Date.now();
  try {
    const page = await getStudentWebinar(user.id, slug, now, { accessPreviewMode });
    if (!page) {
      return { state: "not_found" };
    }
    const payload = asRoomPayload(await getStudentSessionPayload(user.id, page.view.id, sessionId, now, { accessPreviewMode }));
    if (!payload) {
      return { state: "error" };
    }
    const staff = payload.session.kind === "live" && !accessPreviewMode ? await liveRoomStaff(webinarsDb(), user.id, page.view.id, now) : false;
    const decision = roomPageDecision(payload, { durationMs: payload.session.durationMs, now, staff });
    if (!decision.ok) {
      return { page, reason: decision.reason, state: "refused" };
    }
    return { href: roomHref(page.view.slug, payload.session.id), now, page, payload, staff, state: "ready" };
  } catch (error) {
    if (error instanceof WebinarError && error.status === 404) {
      return { state: "not_found" };
    }
    console.error(`[webinarios] sala nao carregou: ${describe(error)}`);
    return { state: "error" };
  }
}

/* ------------------------------------------------------------------------------------------------
 * Paginas: o mesmo desenho de src/server/member-area/student-pages.ts (erro vira estado, nunca tela branca).
 * ---------------------------------------------------------------------------------------------- */

export type WebinarsPageData = { lists: StudentWebinarLists; now: number; state: "ready" } | { state: "error" };

export async function getWebinarsPageData(accessPreviewMode: AccessPreviewMode | undefined, user: SessionUser): Promise<WebinarsPageData> {
  const now = Date.now();
  try {
    return { lists: await listStudentWebinars(user.id, now, { accessPreviewMode }), now, state: "ready" };
  } catch (error) {
    console.error(`[webinarios] lista do aluno nao carregou: ${describe(error)}`);
    return { state: "error" };
  }
}

export type WebinarPageData = { now: number; page: StudentWebinarPage; state: "ready" } | { state: "not_found" } | { state: "error" };

export async function getWebinarPageData(accessPreviewMode: AccessPreviewMode | undefined, user: SessionUser, slug: string): Promise<WebinarPageData> {
  const now = Date.now();
  try {
    const page = await getStudentWebinar(user.id, slug, now, { accessPreviewMode });
    return page ? { now, page, state: "ready" } : { state: "not_found" };
  } catch (error) {
    console.error(`[webinarios] pagina do webinario nao carregou: ${describe(error)}`);
    return { state: "error" };
  }
}

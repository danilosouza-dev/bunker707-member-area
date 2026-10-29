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
import {
  buildSessionPayload,
  buildStudentWebinarView,
  calendarPath,
  groupStudentWebinars,
  pickHomeWebinar,
  pickStartBanner,
  previewCanSee,
  type HomeWebinarCard,
  type StartBanner,
  type StudentSessionPayload,
  type StudentSessionView,
  type StudentWebinarLists,
  type StudentWebinarView
} from "./student-model";
import { countSessionRegistrations, fetchRegistrationRows, fetchWebinarRowBySlug, listPublishedWebinarRows, listSessionRows } from "./store";

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

export type HomeWebinars = { banner: StartBanner | null; card: HomeWebinarCard | null; now: number };

/** Card "Proxima live" e faixa "Comeca em 1 h: Entrar" da pagina inicial. Nunca lanca: falha vira log e nada. */
export async function getHomeWebinars(userId: string, now = Date.now(), options: StudentQueryOptions = {}): Promise<HomeWebinars> {
  try {
    const db = options.db ?? webinarsDb();
    const loaded = await loadVisible(db, userId, now, options, (webinar) => webinar.showOnHome || webinar.showBanner);
    if (loaded.webinars.length === 0) {
      return { banner: null, card: null, now };
    }
    const views = await buildViews(db, loaded, now);
    return {
      banner: options.accessPreviewMode ? null : pickStartBanner(views, now),
      card: pickHomeWebinar(views, now),
      now
    };
  } catch (error) {
    console.error(`[webinarios] pagina inicial sem as lives: ${describe(error)}`);
    return { banner: null, card: null, now };
  }
}

/** So o card da pagina inicial (showOnHome: o mais proximo, ou "Replay disponivel" dentro de replayDaysOnHome). */
export async function getNextWebinarForHome(userId: string, now = Date.now(), options: StudentQueryOptions = {}): Promise<HomeWebinarCard | null> {
  return (await getHomeWebinars(userId, now, options)).card;
}

/** So a faixa "Comeca em 1 h: Entrar" para quem garantiu vaga (bannerWindow). */
export async function getWebinarBanner(userId: string, now = Date.now(), options: StudentQueryOptions = {}): Promise<StartBanner | null> {
  return (await getHomeWebinars(userId, now, options)).banner;
}

/**
 * GET /api/webinars/[id]/session?sessao=: a sessao pedida (ou a da Live ao vivo) com a situacao, a vaga do
 * aluno e o total de vagas quando a equipe mostra. Fora do acesso ou sem o webinario: WebinarError 404.
 */
export async function getStudentSessionPayload(userId: string, webinarId: string, sessionId: string | null, now = Date.now(), options: StudentQueryOptions = {}): Promise<StudentSessionPayload> {
  const db = options.db ?? webinarsDb();
  const record = await loadStudentWebinarById(db, userId, webinarId, now);
  const session = resolveStudentSession(record, sessionId, now);
  const registrations = (await fetchRegistrationRows(db, { userId, webinarIds: [record.webinar.id] })).map(registrationFromRow);
  const counts = await loadRegisteredCounts(db, [record.webinar], [session]);
  const names = await loadPresenterNames(db, [record.webinar]);
  const view = buildStudentWebinarView({
    now,
    presenterName: record.webinar.hostUserId ? (names.get(record.webinar.hostUserId) ?? null) : null,
    registeredCounts: counts,
    registrations,
    sessions: record.sessions,
    webinar: record.webinar
  });
  const sessionView = view.sessions.find((item) => item.id === session.id);
  if (!sessionView) {
    throw new WebinarError("Sessão inválida.", 404);
  }
  return buildSessionPayload(view, sessionView, { lateJoinMinutes: session.lateJoinMinutes, now });
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

// Leituras do admin dos Webinarios (docs/30 §2.1 e §2.2): a lista com os numeros do periodo, os dados do editor
// e as opcoes do editor (produtos, segmento e a equipe). Tudo pela service role (webinarsDb) com assertNoDbError,
// para a pagina mostrar <PendingMigrationNotice migration="202610280001" /> enquanto o banco nao tem as tabelas.
// Sao poucos webinarios: a lista filtra e pagina em memoria, como o store faz.

import "server-only";

import { ADMIN_ROLE_LABELS, can, customFunctionIdsOf, resolveAdminAccess, type AdminRole, type CustomFunctionDefinition } from "@/server/auth/roles";
import { readCustomFunctions } from "@/server/auth/admin-access";
import { getAuthenticatedUser, getUserDisplayName } from "@/server/auth/session";
import type { AudienceDefinition } from "@/server/communications/audience-model";
import { formatSaoPauloDateTime } from "@/server/communications/campaign-model";
import { loadNoticeEditorOptions, type NoticeEditorOptions } from "@/server/communications/queries";
import { pollFromRow, scriptItemFromRow, transcriptCuesOf } from "./chat-rows";
import { fetchTranscriptRow, listPollRows, listScriptItemRows } from "./chat-store";
import { WEBINARS_PAGE_SIZE, matchesWebinarSearch, webinarDraftOf, webinarKindLabel, webinarSituationLabel, webinarSituationTone, type WebinarTone } from "./editor-model";
import { assertNoDbError, webinarsDb, type WebinarsDb } from "./db";
import {
  TRANSCRIPT_FORMATS,
  nextSession,
  toTime,
  webinarSituation,
  type Poll,
  type ScriptItem,
  type WebinarDraft,
  type WebinarKind,
  type WebinarSession,
  type WebinarSituation,
  type WebinarStatus,
  type WebinarTranscriptFormat
} from "./model";
import { sessionFromRow, webinarFromRow, type RecordingRow, type SessionRow, type WebinarRow } from "./rows";
import { countRegistrationsByWebinar, fetchWebinarRow, listPresenterRows, listRecordingRows, listSessionRows, listWebinarRows } from "./store";

/* ------------------------------------------------------------------------------------------------
 * A lista (docs/30 §2.1)
 * ---------------------------------------------------------------------------------------------- */

export type WebinarListItem = {
  coverUrl: string | null;
  createdAt: string;
  createdByName: string | null;
  id: string;
  kind: WebinarKind;
  kindLabel: string;
  /** Presentes (pico): so a partir da fase 2 (presenca por balde). */
  peakPresent: number | null;
  registeredCount: number;
  /** A sessao no ar ou na espera agora (Abrir o console e Encerrar live do menu); nula fora disso. */
  runningSessionId: string | null;
  sessionsCount: number;
  situation: WebinarSituation;
  situationLabel: string;
  situationTone: WebinarTone;
  slug: string;
  status: WebinarStatus;
  title: string;
  updatedAt: string;
  /** Hora marcada da proxima sessao (ou da ultima, encerrado); null sem sessao e sem hora marcada. */
  whenIso: string | null;
  whenLabel: string;
};

/** Os cinco numeros do periodo (docs/30 §2.1). null = "—" (chega com a fase 2). */
export type WebinarPeriodNumbers = {
  attended: number | null;
  liveNow: number;
  registered: number;
  replayViewers: number | null;
  webinars: number;
};

export type WebinarsAdminPage = {
  items: WebinarListItem[];
  numbers: WebinarPeriodNumbers;
  page: number;
  pageSize: number;
  total: number;
  /** Quantos webinarios existem sem filtro nenhum (o estado vazio "Nenhum webinário ainda" x "encontrado"). */
  totalAll: number;
};

export type WebinarListFilters = {
  kind?: WebinarKind | null;
  q?: string;
  situation?: WebinarSituation | null;
};

type SessionsByWebinar = Map<string, WebinarSession[]>;

function groupSessions(rows: readonly SessionRow[]): SessionsByWebinar {
  const map: SessionsByWebinar = new Map();

  for (const row of rows) {
    const list = map.get(row.webinar_id) ?? [];
    list.push(sessionFromRow(row));
    map.set(row.webinar_id, list);
  }

  return map;
}

/** Nome de quem criou (profiles), so para a coluna "Quem criou"; nunca o e-mail inteiro. */
async function loadCreatorNames(db: WebinarsDb, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const wanted = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));

  for (let index = 0; index < wanted.length; index += 150) {
    const part = wanted.slice(index, index + 150);
    const { data, error } = await db.from("profiles").select("id,full_name").in("id", part);
    assertNoDbError(error, "Webinarios: quem criou");

    for (const row of (data ?? []) as { full_name: string | null; id: string }[]) {
      names.set(row.id, row.full_name?.trim() || "Equipe");
    }
  }

  return names;
}

/** A sessao que esta rodando (no ar ou na espera), nunca o replay. */
export function runningSessionOf(sessions: readonly WebinarSession[]): WebinarSession | null {
  return sessions.find((session) => session.kind !== "replay" && (session.status === "live" || session.status === "waiting")) ?? null;
}

/** A hora que a lista mostra: a proxima sessao; sem proxima, a ultima marcada; sem sessao, a hora marcada do webinario. */
function whenOf(row: WebinarRow, sessions: readonly WebinarSession[], now: number): string | null {
  const next = nextSession(sessions, row.duration_minutes, now);

  if (next) {
    return next.scheduledAt;
  }

  const real = sessions.filter((session) => session.kind !== "replay");

  if (real.length > 0) {
    return real.reduce((latest, session) => (toTime(session.scheduledAt) > toTime(latest.scheduledAt) ? session : latest)).scheduledAt;
  }

  return row.scheduled_at;
}

function toListItem(row: WebinarRow, input: { names: Map<string, string>; now: number; registered: Map<string, number>; sessions: SessionsByWebinar }): WebinarListItem {
  const sessions = input.sessions.get(row.id) ?? [];
  const webinar = webinarFromRow(row);
  const situation = webinarSituation(webinar, sessions, input.now);
  const whenIso = whenOf(row, sessions, input.now);

  return {
    coverUrl: row.cover_url,
    createdAt: row.created_at,
    createdByName: row.created_by ? (input.names.get(row.created_by) ?? null) : null,
    id: row.id,
    kind: webinar.kind,
    kindLabel: webinarKindLabel(webinar.kind),
    peakPresent: null,
    registeredCount: input.registered.get(row.id) ?? 0,
    runningSessionId: runningSessionOf(sessions)?.id ?? null,
    sessionsCount: sessions.filter((session) => session.kind !== "replay" && session.status !== "cancelled").length,
    situation,
    situationLabel: webinarSituationLabel(situation),
    situationTone: webinarSituationTone(situation),
    slug: row.slug,
    status: webinar.status,
    title: row.title,
    updatedAt: row.updated_at,
    whenIso,
    whenLabel: whenIso ? formatSaoPauloDateTime(whenIso) : "—"
  };
}

/** Os numeros do periodo da barra superior (docs/30 §2.1), sobre todos os webinarios (os filtros so valem na tabela). */
function periodNumbers(rows: readonly WebinarRow[], sessions: SessionsByWebinar, registered: Map<string, number>, period: { end: Date; start: Date }): WebinarPeriodNumbers {
  const start = period.start.getTime();
  const end = period.end.getTime();
  let sessionsInPeriod = 0;
  let liveNow = 0;
  const webinarsInPeriod = new Set<string>();

  for (const row of rows) {
    for (const session of sessions.get(row.id) ?? []) {
      if (session.kind === "replay" || session.status === "cancelled") {
        continue;
      }

      if (session.status === "waiting" || session.status === "live") {
        liveNow += 1;
      }

      const at = toTime(session.scheduledAt);

      if (at >= start && at <= end) {
        sessionsInPeriod += 1;
        webinarsInPeriod.add(row.id);
      }
    }
  }

  let registeredInPeriod = 0;

  for (const id of webinarsInPeriod) {
    registeredInPeriod += registered.get(id) ?? 0;
  }

  return { attended: null, liveNow, registered: registeredInPeriod, replayViewers: null, webinars: sessionsInPeriod };
}

/** A lista do admin com os numeros do periodo. Filtros e paginacao em memoria (poucos webinarios). */
export async function listWebinarsForAdmin(input: {
  filters?: WebinarListFilters;
  now?: number;
  page?: number;
  period: { end: Date; start: Date };
}): Promise<WebinarsAdminPage> {
  const db = webinarsDb();
  const now = input.now ?? Date.now();
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const rows = await listWebinarRows(db);
  const ids = rows.map((row) => row.id);
  const [sessionRows, registered, names] = await Promise.all([listSessionRows(db, ids), countRegistrationsByWebinar(db, ids), loadCreatorNames(db, rows.map((row) => row.created_by))]);
  const sessions = groupSessions(sessionRows);
  const all = rows.map((row) => toListItem(row, { names, now, registered, sessions }));
  const filters = input.filters ?? {};
  const filtered = all.filter(
    (item) => (!filters.kind || item.kind === filters.kind) && (!filters.situation || item.situation === filters.situation) && matchesWebinarSearch(item.title, filters.q ?? "")
  );
  // Proximos primeiro (hora marcada mais perto), depois os sem hora e os passados (mais recentes primeiro).
  const sorted = [...filtered].sort((left, right) => {
    const leftTime = left.whenIso ? toTime(left.whenIso) : Number.NaN;
    const rightTime = right.whenIso ? toTime(right.whenIso) : Number.NaN;
    const leftFuture = Number.isFinite(leftTime) && leftTime >= now;
    const rightFuture = Number.isFinite(rightTime) && rightTime >= now;

    if (leftFuture !== rightFuture) {
      return leftFuture ? -1 : 1;
    }

    if (leftFuture && rightFuture) {
      return leftTime - rightTime;
    }

    const leftPast = Number.isFinite(leftTime) ? leftTime : toTime(left.updatedAt);
    const rightPast = Number.isFinite(rightTime) ? rightTime : toTime(right.updatedAt);

    return rightPast - leftPast;
  });
  const from = (page - 1) * WEBINARS_PAGE_SIZE;

  return {
    items: sorted.slice(from, from + WEBINARS_PAGE_SIZE),
    numbers: periodNumbers(rows, sessions, registered, input.period),
    page,
    pageSize: WEBINARS_PAGE_SIZE,
    total: sorted.length,
    totalAll: all.length
  };
}

/* ------------------------------------------------------------------------------------------------
 * O editor (docs/30 §2.2)
 * ---------------------------------------------------------------------------------------------- */

/** A transcricao da gravacao base como o card Roteiro mostra (so o resumo; as cues ficam no servidor). */
export type TranscriptSummary = { cues: number; format: WebinarTranscriptFormat; language: string; updatedAt: string };

export type WebinarEditorData = {
  cancelReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  /** Nome de quem decidiu a Simulacao de cada sessao (simulation_decided_by -> nome), para o card. */
  deciderNames: Record<string, string>;
  draft: WebinarDraft;
  id: string;
  /** Os modelos de enquete (sem sessao); as copias lancadas ficam no console. */
  polls: Poll[];
  publishedAt: string | null;
  /** A gravacao base (o video da Live gravada); a transcricao e o roteiro apontam para ela. */
  recordingId: string | null;
  registeredCount: number;
  /** A sessao `replay` (livre), quando existe e nao foi fechada. */
  replaySession: WebinarSession | null;
  runningSessionId: string | null;
  scriptItems: ScriptItem[];
  sessions: WebinarSession[];
  situation: WebinarSituation;
  slug: string;
  status: WebinarStatus;
  title: string;
  transcript: TranscriptSummary | null;
  updatedAt: string;
};

/** O video da Live gravada colado pela equipe: a gravacao base (sem sessao, origem bunny). */
export function baseRecordingOf(recordings: readonly RecordingRow[]): RecordingRow | null {
  return recordings.find((recording) => recording.session_id === null && recording.source === "bunny") ?? recordings.find((recording) => recording.session_id === null) ?? null;
}

/** As horas marcadas da Live gravada que o editor edita: sessoes `simulated` ainda nao canceladas, com a Entrada atrasada. */
export function draftSessionsOf(sessions: readonly WebinarSession[]): { lateJoinMinutes: number | null; scheduledAt: string }[] {
  return sessions
    .filter((session) => session.kind === "simulated" && session.status !== "cancelled")
    .sort((left, right) => toTime(left.scheduledAt) - toTime(right.scheduledAt))
    .map((session) => ({ lateJoinMinutes: session.lateJoinMinutes, scheduledAt: session.scheduledAt }));
}

function transcriptFormatOf(value: string): WebinarTranscriptFormat {
  return (TRANSCRIPT_FORMATS as readonly string[]).includes(value) ? (value as WebinarTranscriptFormat) : "vtt";
}

export async function getWebinarEditorData(id: string, now = Date.now()): Promise<WebinarEditorData | null> {
  const db = webinarsDb();
  const row = await fetchWebinarRow(db, id);

  if (!row) {
    return null;
  }

  const [presenters, recordings, sessionRows, registered] = await Promise.all([
    listPresenterRows(db, [row.id]),
    listRecordingRows(db, [row.id]),
    listSessionRows(db, [row.id]),
    countRegistrationsByWebinar(db, [row.id])
  ]);
  const sessions = sessionRows.map(sessionFromRow);
  const recording = baseRecordingOf(recordings);
  const webinar = webinarFromRow(row, presenters, recording);
  const simulated = webinar.kind === "simulated";
  const [scriptRows, transcriptRow, pollRows, deciderNames] = await Promise.all([
    simulated ? listScriptItemRows(db, row.id) : Promise.resolve([]),
    simulated && recording ? fetchTranscriptRow(db, recording.id) : Promise.resolve(null),
    listPollRows(db, { sessionId: null, webinarId: row.id }),
    loadCreatorNames(
      db,
      sessions.map((session) => session.simulationDecidedBy)
    )
  ]);

  return {
    cancelReason: webinar.cancelReason,
    cancelledAt: webinar.cancelledAt,
    createdAt: webinar.createdAt,
    deciderNames: Object.fromEntries(deciderNames),
    draft: { ...webinarDraftOf(webinar), sessions: draftSessionsOf(sessions) },
    id: webinar.id,
    polls: pollRows.polls.map((poll) => pollFromRow(poll, pollRows.options)),
    publishedAt: webinar.publishedAt,
    recordingId: recording?.id ?? null,
    registeredCount: registered.get(row.id) ?? 0,
    replaySession: sessions.find((session) => session.kind === "replay" && session.status !== "cancelled") ?? null,
    runningSessionId: runningSessionOf(sessions)?.id ?? null,
    scriptItems: scriptRows.map(scriptItemFromRow),
    sessions,
    situation: webinarSituation(webinar, sessions, now),
    slug: webinar.slug,
    status: webinar.status,
    title: row.title,
    transcript: transcriptRow
      ? { cues: transcriptCuesOf(transcriptRow.cues).length, format: transcriptFormatOf(transcriptRow.source_format), language: transcriptRow.language, updatedAt: transcriptRow.updated_at }
      : null,
    updatedAt: webinar.updatedAt
  };
}

/** Pessoa da equipe que pode ser Apresentador, co-apresentador ou Equipe da sala (docs/30 §2.6). */
export type WebinarPersonOption = {
  avatarUrl: string | null;
  /** messaging.publish: pode ser o Apresentador. */
  canPublish: boolean;
  /** messaging.write: pode ser Equipe da sala. */
  canWrite: boolean;
  id: string;
  isMe: boolean;
  name: string;
  roleLabel: string;
};

export type WebinarEditorOptions = Pick<NoticeEditorOptions, "cohorts" | "names" | "notices" | "products" | "productsLoaded" | "segments"> & {
  currentUserId: string | null;
  /** O nome de quem esta na tela, como a frase da Simulacao (docs/30 §8.6) registra o responsavel. */
  currentUserName: string | null;
  people: WebinarPersonOption[];
  /** false: as permissoes da equipe nao carregaram agora (todos aparecem; o servidor confere ao publicar). */
  peopleLoaded: boolean;
};

/** As permissoes de cada pessoa da equipe (admin_roles + funcoes personalizadas), para os seletores de quem apresenta. */
async function loadTeamPermissions(db: WebinarsDb): Promise<Map<string, { canPublish: boolean; canWrite: boolean; role: AdminRole }>> {
  const { data, error } = await db.from("admin_roles").select("user_id, role, permissions").limit(1_000);
  assertNoDbError(error, "Webinarios: equipe");

  const rows = (data ?? []) as { permissions: unknown; role: unknown; user_id: string }[];
  const customIds = Array.from(new Set(rows.flatMap((row) => customFunctionIdsOf(row.permissions))));
  const customFunctions: ReadonlyMap<string, CustomFunctionDefinition> = await readCustomFunctions(db, customIds);
  const result = new Map<string, { canPublish: boolean; canWrite: boolean; role: AdminRole }>();

  for (const row of rows) {
    const access = resolveAdminAccess(row.role, row.permissions, customFunctions);

    if (access) {
      result.set(row.user_id, { canPublish: can(access, "messaging.publish"), canWrite: can(access, "messaging.write"), role: access.role });
    }
  }

  return result;
}

/**
 * Opcoes do editor: produtos e segmento como o editor do aviso (loadNoticeEditorOptions, com .catch e listas vazias
 * onde ele ja faz isso) e a equipe com as permissoes de cada pessoa. `audiences`: os segmentos ja gravados, para
 * a frase do "Quem pode" ter o nome de um produto fora da lista.
 */
export async function loadWebinarEditorOptions(input: { audiences?: readonly AudienceDefinition[] } = {}): Promise<WebinarEditorOptions> {
  const db = webinarsDb();
  const [base, permissions, viewer] = await Promise.all([
    loadNoticeEditorOptions(input),
    loadTeamPermissions(db)
      .then((map) => ({ loaded: true, map }))
      .catch((error: unknown) => {
        console.error("[admin/webinarios] permissoes da equipe", error);
        return { loaded: false, map: new Map<string, { canPublish: boolean; canWrite: boolean; role: AdminRole }>() };
      }),
    getAuthenticatedUser().catch(() => null)
  ]);
  const currentUserId = viewer?.id ?? base.currentUserId;
  const people: WebinarPersonOption[] = base.senders.map((sender) => {
    const found = permissions.map.get(sender.id);

    return {
      avatarUrl: sender.avatarUrl,
      canPublish: found ? found.canPublish : !permissions.loaded,
      canWrite: found ? found.canWrite : !permissions.loaded,
      id: sender.id,
      isMe: sender.id === currentUserId,
      name: sender.name,
      roleLabel: found ? ADMIN_ROLE_LABELS[found.role] : sender.roleLabel
    };
  });

  return {
    cohorts: base.cohorts,
    currentUserId,
    currentUserName: viewer ? getUserDisplayName(viewer).fullName : (people.find((person) => person.isMe)?.name ?? null),
    names: base.names,
    notices: base.notices,
    people,
    peopleLoaded: permissions.loaded,
    products: base.products,
    productsLoaded: base.productsLoaded,
    segments: base.segments
  };
}

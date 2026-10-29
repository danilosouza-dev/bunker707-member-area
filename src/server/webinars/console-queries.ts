// Leituras do console da sessao (docs/30 §2.4): a sessao que a equipe abre, o retrato que a pagina desenha de
// primeira e que a rota /api/admin/webinars/[id]/console devolve a cada 5 s (chat com os pendentes, o roteiro com o
// que ja entrou, as enquetes com as contagens, as perguntas por voto e os presentes agora). Na Live ao vivo (fase 3,
// §6.4 e §6.7) o retrato ganha o bloco `live`: o gravador (situacao, pedidos, a estimativa do preparo, a ancora e a
// diferenca para o inicio do arquivo pelo ultimo `uploaded`), a gravacao da sessao (com o player assinado para a
// previa do "Alinhar chat"), a sala trancada, quem foi removido, silenciado ou banido, o mapa aluno -> participante da
// sala pelo ultimo webinar_room_joined com o nome que a sala mostra, e se a sala existe neste ambiente. Nada de token
// nem room_name: o iframe do console pede o join-token. Tudo pela service role (webinarsDb) com assertNoDbError: banco
// sem a migracao vira PendingMigrationNotice na pagina. Fase 4 (4e, com o Atendimento da 4c): o seletor de sessoes
// mostra das sessoes "Comeca quando voce entra" (session.jit, uma a cada 15 min o dia inteiro) so as do dia de Sao
// Paulo e as em andamento; a pedida por ?sessao= continua aberta.

import "server-only";

import { CONSENT_COLUMNS, chatMessageFromRow, pollAnswerFromRow, pollFromRow, questionFromRow, scriptItemFromRow, CHAT_MESSAGE_COLUMNS, type ChatMessageRow, type ConsentRow } from "./chat-rows";
import { listPollAnswerRows, listPollRows, listPresentUserIds, listQuestionRows, listScriptItemRows, listSessionChatRows } from "./chat-store";
import { consolePresenceClockMs, consoleSessionOf, countPollAnswers, pickConsoleSession, type ConsoleMessage, type ConsolePollView, type ConsoleSnapshot } from "./console-model";
import { consolePresenceApplies, consolePresenceOf, type ConsolePresence } from "./console-presence-model";
import { assertNoDbError, webinarsDb, type WebinarsDb } from "./db";
import { sessionRecordingOf, sessionVideoDurationMs } from "./export-queries";
import {
  latestRoomJoins,
  liveParticipantName,
  sortLivePeople,
  staffDisplayName,
  type LiveConsolePerson,
  type LiveConsoleRecording,
  type LiveConsoleSnapshot,
  type RoomJoinedRow
} from "./live-console-model";
import { liveBanState, liveRoomConfigured } from "./live-model";
import { fetchSessionRecordingRow, listRecordingEventRows, listSessionBanRows, listUserBanRows, recentRecorderPrepareDurations } from "./live-store";
import type { WebinarKind, WebinarSession } from "./model";
import { baseRecordingOf } from "./queries";
import { recorderDispatcherFrom } from "./recorder-dispatch";
import { anchorDriftMs, parseJibriStartedAt, prepareEstimateMinutes } from "./recorder-model";
import { bunnyEmbedUrl, parseBunnyEmbed, presenceBucket, sessionOffsetMs } from "./room-model";
import { bunnyViewToken, consentIsCurrent } from "./room-queries";
import { RECORDING_COLUMNS, recorderStatusOf, roomSettingsOfRow, sessionFromRow, type RecordingRow, type SessionBanRow, type SessionRow, type WebinarRow } from "./rows";
import { reportViewOf } from "./report-queries";
import { fetchSessionRow, fetchWebinarRow, listPresenterRows, listRecordingRows, listSessionRows } from "./store";
import { saoPauloDayKey } from "../../lib/webinar-time";

const PAGE = 1000;
const CONSENT_CHUNK = 200;
/** Quantas entradas na sala o console le por sessao (a mais nova de cada aluno vale). */
const ROOM_JOINS_LIMIT = 5000;

export type ConsoleWebinar = {
  /** Card Sala: o aluno abre a camera (sem isso, o Apresentador liga a moderacao de video ao entrar). */
  allowStudentCamera: boolean;
  durationMinutes: number;
  hostUserId: string | null;
  id: string;
  kind: WebinarKind;
  /** Card Sala: a Sessao de pratica liga a sala de espera ate Comecar para todos. */
  practiceSession: boolean;
  /** A duracao do video da gravacao base, quando a Bunny informou; senao a duracao prevista vale. */
  recordingDurationSeconds: number | null;
  slug: string;
  title: string;
  /** Card Sala: a Sala de espera fica ligada depois de Comecar para todos (cada um entra por Admitir). */
  waitingRoom: boolean;
};

export type SessionConsoleData = {
  sessions: WebinarSession[];
  /** Nulo quando o webinario ainda nao tem sessao nenhuma. */
  snapshot: ConsoleSnapshot | null;
  webinar: ConsoleWebinar;
};

/**
 * O que o seletor do console lista (fase 4e): as sessoes comuns todas; das "Comeca quando voce entra" (jit), so as
 * marcadas para hoje em Sao Paulo e as em andamento (na espera ou no ar), mais a pedida por ?sessao=.
 */
export function consoleSessionsFor<T extends Pick<WebinarSession, "id" | "jit" | "scheduledAt" | "status">>(sessions: readonly T[], nowMs: number, requestedId: string | null = null): T[] {
  const today = saoPauloDayKey(nowMs);
  return sessions.filter(
    (session) => !session.jit || session.id === requestedId || session.status === "live" || session.status === "waiting" || (Number.isFinite(Date.parse(session.scheduledAt)) && saoPauloDayKey(session.scheduledAt) === today)
  );
}

/** Todas as linhas do chat de uma sessao, na ordem do video (a exportacao em CSV). */
export async function listAllSessionChatRows(db: WebinarsDb, sessionId: string): Promise<ChatMessageRow[]> {
  const rows: ChatMessageRow[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("webinar_chat_messages")
      .select(CHAT_MESSAGE_COLUMNS)
      .eq("session_id", sessionId)
      .is("deleted_at", null)
      .order("offset_ms", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    assertNoDbError(error, "Webinarios: chat inteiro da sessao");
    const part = (data ?? []) as ChatMessageRow[];
    rows.push(...part);

    if (part.length < PAGE) {
      return rows;
    }
  }
}

/** Le em pedacos de CONSENT_CHUNK ids (o `in` do PostgREST vai na URL). */
async function inChunks<T>(ids: readonly string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const wanted = Array.from(new Set(ids));
  const rows: T[] = [];

  for (let index = 0; index < wanted.length; index += CONSENT_CHUNK) {
    rows.push(...(await read(wanted.slice(index, index + CONSENT_CHUNK))));
  }

  return rows;
}

/** Quem ainda tem o aceite do chat valendo (uma linha sem revoked_at), para o "Aprovar para as proximas turmas". */
async function loadConsentFlags(db: WebinarsDb, userIds: readonly string[]): Promise<Set<string>> {
  const consented = new Set<string>();
  const wanted = Array.from(new Set(userIds));

  for (let index = 0; index < wanted.length; index += CONSENT_CHUNK) {
    const { data, error } = await db
      .from("webinar_chat_consents")
      .select("user_id, revoked_at")
      .in("user_id", wanted.slice(index, index + CONSENT_CHUNK));
    assertNoDbError(error, "Webinarios: aceites do chat");

    for (const row of (data ?? []) as { revoked_at: string | null; user_id: string }[]) {
      if (!row.revoked_at) {
        consented.add(row.user_id);
      }
    }
  }

  return consented;
}

/** Os itens do roteiro que ja entraram nesta sessao (pela abertura ou pelo botao), com a hora em que entraram. */
async function loadFiredScript(db: WebinarsDb, sessionId: string): Promise<Record<string, string | null>> {
  const fired: Record<string, string | null> = {};

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("webinar_chat_messages")
      .select("script_item_id, created_at")
      .eq("session_id", sessionId)
      .not("script_item_id", "is", null)
      .range(from, from + PAGE - 1);
    assertNoDbError(error, "Webinarios: roteiro que ja entrou");
    const part = (data ?? []) as { created_at: string; script_item_id: string }[];

    for (const row of part) {
      fired[row.script_item_id] = row.created_at;
    }

    if (part.length < PAGE) {
      return fired;
    }
  }
}

async function loadLaunchedPolls(db: WebinarsDb, webinarId: string, sessionId: string): Promise<ConsolePollView[]> {
  const launched = await listPollRows(db, { sessionId, webinarId });
  const views: ConsolePollView[] = [];

  for (const row of launched.polls) {
    const poll = pollFromRow(row, launched.options);
    const answers = (await listPollAnswerRows(db, poll.id)).map(pollAnswerFromRow);
    views.push({ ...poll, counts: countPollAnswers(poll, answers) });
  }

  return views;
}

/* ------------------------------------------------------------------------------------------------
 * O bloco da Live ao vivo (fase 3)
 * ---------------------------------------------------------------------------------------------- */

/** As entradas na sala desta sessao (webinar_room_joined, so do aluno), das mais novas: o id do participante de cada um. */
async function listRoomJoinRows(db: WebinarsDb, sessionId: string): Promise<RoomJoinedRow[]> {
  const { data, error } = await db
    .from("student_events")
    .select("user_id, metadata, created_at")
    .eq("entity_type", "webinar")
    .eq("entity_id", sessionId)
    .eq("event_type", "webinar_room_joined")
    .order("created_at", { ascending: false })
    .limit(ROOM_JOINS_LIMIT);
  assertNoDbError(error, "Webinarios: entradas na sala ao vivo");
  return (data ?? []) as RoomJoinedRow[];
}

/** Os nomes (so o nome; nada de e-mail), os aceites do chat e quem e da equipe, para a lista da mesa. */
async function loadPeopleFacts(db: WebinarsDb, userIds: readonly string[]) {
  const [profiles, consents, staff] = await Promise.all([
    inChunks(userIds, async (chunk) => {
      const { data, error } = await db.from("profiles").select("id, full_name").in("id", chunk);
      assertNoDbError(error, "Webinarios: nomes da sala ao vivo");
      return (data ?? []) as { full_name: string | null; id: string }[];
    }),
    inChunks(userIds, async (chunk) => {
      const { data, error } = await db.from("webinar_chat_consents").select(CONSENT_COLUMNS).in("user_id", chunk);
      assertNoDbError(error, "Webinarios: aceites da sala ao vivo");
      return (data ?? []) as ConsentRow[];
    }),
    inChunks(userIds, async (chunk) => {
      const { data, error } = await db.from("admin_roles").select("user_id").in("user_id", chunk);
      assertNoDbError(error, "Webinarios: equipe na sala ao vivo");
      return (data ?? []) as { user_id: string }[];
    })
  ]);

  return {
    consents: new Map(consents.map((row) => [row.user_id, row])),
    names: new Map(profiles.map((row) => [row.id, row.full_name ?? null])),
    staff: new Set(staff.map((row) => row.user_id))
  };
}

async function loadLivePeople(db: WebinarsDb, input: { authors: readonly string[]; nowMs: number; session: SessionRow; webinar: WebinarRow }): Promise<LiveConsolePerson[]> {
  const { session, webinar } = input;
  const [joinRows, banRows, presenters] = await Promise.all([listRoomJoinRows(db, session.id), listSessionBanRows(db, session.id), listPresenterRows(db, [webinar.id])]);
  const joins = latestRoomJoins(joinRows);
  const ids = Array.from(new Set([...joins.keys(), ...banRows.map((row) => row.user_id), ...input.authors]));

  if (ids.length === 0) {
    return [];
  }

  const [userBans, facts] = await Promise.all([inChunks(ids, (chunk) => listUserBanRows(db, chunk)), loadPeopleFacts(db, ids)]);
  const banned = new Map(userBans.map((row) => [row.user_id, row]));
  const bansByUser = new Map<string, SessionBanRow[]>();

  for (const row of banRows) {
    bansByUser.set(row.user_id, [...(bansByUser.get(row.user_id) ?? []), row]);
  }

  const presenterIds = new Set(presenters.map((row) => row.user_id));
  const roomDisplayName = roomSettingsOfRow(webinar.room_settings).displayName;

  return sortLivePeople(
    ids.map((userId) => {
      const staff = facts.staff.has(userId) || presenterIds.has(userId) || webinar.host_user_id === userId;
      const consent = facts.consents.get(userId) ?? null;
      const fullName = facts.names.get(userId) ?? null;
      const join = joins.get(userId) ?? null;
      return {
        ban: liveBanState({ nowMs: input.nowMs, sessionBans: bansByUser.get(userId) ?? [], userBan: banned.get(userId) ?? null }),
        displayName: staff
          ? staffDisplayName(fullName)
          : liveParticipantName({
              consent: consentIsCurrent(consent) && consent ? { displayMode: consent.display_mode, nickname: consent.nickname } : null,
              fullName,
              roomDisplayName,
              userId,
              webinarId: webinar.id
            }),
        joinedAt: join?.joinedAt ?? null,
        participantId: join?.participantId ?? null,
        staff,
        userId
      };
    })
  );
}

/** A gravacao da sessao: a mais nova com session_id, ou a apontada por recording_id. */
async function loadSessionRecording(db: WebinarsDb, session: SessionRow): Promise<RecordingRow | null> {
  const own = await fetchSessionRecordingRow(db, session.id);

  if (own || !session.recording_id) {
    return own;
  }

  const { data, error } = await db.from("webinar_recordings").select(RECORDING_COLUMNS).eq("id", session.recording_id).limit(1);
  assertNoDbError(error, "Webinarios: gravacao ligada a sessao");
  return ((data ?? []) as RecordingRow[])[0] ?? null;
}

/** O player da Bunny para a previa do "Alinhar chat": so com a gravacao pronta, com o token quando a biblioteca pede. */
function recordingPreviewUrl(recording: RecordingRow, nowMs: number): string | null {
  if (recording.status !== "ready") {
    return null;
  }

  const ref =
    parseBunnyEmbed(recording.embed_url) ??
    (recording.bunny_library_id && recording.bunny_video_id && /^\d{1,12}$/.test(recording.bunny_library_id) && /^[0-9a-f-]{8,80}$/i.test(recording.bunny_video_id)
      ? { libraryId: recording.bunny_library_id, videoId: recording.bunny_video_id.toLowerCase() }
      : null);

  if (!ref) {
    return null;
  }

  const token = bunnyViewToken(ref.videoId, nowMs);
  return bunnyEmbedUrl(ref, { autoplay: false, expires: token?.expires ?? null, muted: false, showControls: true, token: token?.token ?? null });
}

function liveRecordingOf(recording: RecordingRow | null, nowMs: number): LiveConsoleRecording | null {
  if (!recording) {
    return null;
  }

  return {
    anchorOffsetMs: recording.anchor_offset_ms ?? 0,
    bunnyLibraryId: recording.bunny_library_id,
    bunnyVideoId: recording.bunny_video_id,
    durationSeconds: recording.duration_seconds,
    embedUrl: recording.embed_url,
    errorMessage: recording.error_message,
    id: recording.id,
    previewUrl: recordingPreviewUrl(recording, nowMs),
    source: recording.source,
    status: recording.status
  };
}

/** O inicio do arquivo pelo ultimo `uploaded` do gravador (o carimbo do nome do arquivo, ou startedAt do corpo). */
async function loadFileStartedAt(db: WebinarsDb, sessionId: string): Promise<string | null> {
  const uploaded = (await listRecordingEventRows(db, sessionId, 20)).find((row) => row.state === "uploaded");

  if (!uploaded) {
    return null;
  }

  const startedAt = uploaded.payload && typeof uploaded.payload.startedAt === "string" ? uploaded.payload.startedAt : null;
  return parseJibriStartedAt(startedAt) ?? parseJibriStartedAt(uploaded.file_name);
}

/** O bloco `live` do retrato (so a sessao `live`). */
export async function loadLiveConsole(db: WebinarsDb, input: { authors: readonly string[]; now: Date; session: SessionRow; webinar: WebinarRow }): Promise<LiveConsoleSnapshot> {
  const { session } = input;
  const nowMs = input.now.getTime();
  const status = recorderStatusOf(session.recorder_status);
  const [people, recording, fileStartedAt, pastDurations] = await Promise.all([
    loadLivePeople(db, { authors: input.authors, nowMs, session, webinar: input.webinar }),
    loadSessionRecording(db, session),
    loadFileStartedAt(db, session.id),
    status === "preparing" ? recentRecorderPrepareDurations(db) : Promise.resolve([] as number[])
  ]);

  return {
    meetConfigured: liveRoomConfigured(process.env),
    people,
    recorder: {
      anchorAt: session.recording_anchor_at,
      dispatchConfigured: recorderDispatcherFrom(process.env) !== null,
      driftMs: anchorDriftMs(session.recording_anchor_at, fileStartedAt),
      estimateMinutes: status === "preparing" ? prepareEstimateMinutes({ nowMs, pastDurationsMs: pastDurations, requestedAt: session.recorder_requested_at ?? null }) : null,
      fileStartedAt,
      recordingRequestedAt: session.recording_requested_at ?? null,
      releaseRequestedAt: session.recorder_release_requested_at ?? null,
      requestedAt: session.recorder_requested_at ?? null,
      status
    },
    recording: liveRecordingOf(recording, nowMs),
    roomLocked: session.room_locked === true
  };
}

/* ------------------------------------------------------------------------------------------------
 * O retrato e a pagina
 * ---------------------------------------------------------------------------------------------- */

/**
 * A duracao do video da sessao gravada (onde o relogio do painel Presenca para): a congelada no encerramento, senao a
 * gravacao da sessao, senao a prevista do webinario (a mesma conta do relatorio). NaN fora da gravada; a leitura que
 * falha tambem da NaN (o painel fica sem o teto e o resto do console segue).
 */
async function simulatedDurationMs(db: WebinarsDb, session: WebinarSession, webinar: WebinarRow | undefined): Promise<number> {
  if (session.kind !== "simulated" || !webinar) {
    return Number.NaN;
  }
  if (session.presenceCurve?.durationMs) {
    return session.presenceCurve.durationMs;
  }
  try {
    return sessionVideoDurationMs(session, sessionRecordingOf(await listRecordingRows(db, [session.webinarId]), session), webinar.duration_minutes);
  } catch (error) {
    console.error(`[admin/webinarios] duracao do video da sessao ${session.id}: ${error instanceof Error ? error.message : String(error)}`);
    return Number.NaN;
  }
}

/**
 * O painel Presenca (docs/30 §2.4) pela visao do relatorio em cache (60 s, o minuto do relogio na chave): o console
 * relê a cada 5 s e a RPC roda no maximo uma vez por minuto. `offsetMs` e o relogio do topo (consolePresenceClockMs),
 * que para no encerramento: a curva da sessao encerrada termina no ultimo minuto dela, nao no minuto de agora.
 * Replay, antes de comecar ou a leitura que falhou: nulo (o painel some e o resto do console segue).
 */
async function loadConsolePresence(session: WebinarSession, offsetMs: number, nowMs: number): Promise<ConsolePresence | null> {
  if (!consolePresenceApplies(session.kind, offsetMs)) {
    return null;
  }

  try {
    return consolePresenceOf(await reportViewOf(session.id, nowMs), offsetMs);
  } catch (error) {
    console.error(`[admin/webinarios] presenca do console da sessao ${session.id}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** O retrato do console de uma sessao agora (com `webinar`, o bloco da Live ao vivo na sessao `live`). */
export async function loadConsoleSnapshot(db: WebinarsDb, input: { kind: WebinarKind; now: Date; session: SessionRow; webinar?: WebinarRow }): Promise<ConsoleSnapshot> {
  const session = sessionFromRow(input.session);
  const nowMs = input.now.getTime();
  const offsetMs = sessionOffsetMs(session, nowMs);
  const [chatRows, scriptRows, fired, launched, templates, questionRows, presentIds, durationMs] = await Promise.all([
    listSessionChatRows(db, { sessionId: session.id }),
    input.kind === "simulated" ? listScriptItemRows(db, session.webinarId) : Promise.resolve([]),
    input.kind === "simulated" ? loadFiredScript(db, session.id) : Promise.resolve({}),
    loadLaunchedPolls(db, session.webinarId, session.id),
    listPollRows(db, { sessionId: null, webinarId: session.webinarId }),
    listQuestionRows(db, { order: "votes", sessionId: session.id }),
    Number.isFinite(offsetMs) ? listPresentUserIds(db, { currentBucket: presenceBucket(offsetMs / 1000), sessionId: session.id }) : Promise.resolve([]),
    simulatedDurationMs(db, session, input.webinar)
  ]);
  const authors = chatRows.map((row) => row.author_user_id).filter((id): id is string => Boolean(id));
  const audienceAuthors = chatRows.filter((row) => row.source === "audience" && row.author_user_id).map((row) => row.author_user_id as string);
  const [consented, live, presence] = await Promise.all([
    authors.length > 0 ? loadConsentFlags(db, authors) : Promise.resolve(new Set<string>()),
    session.kind === "live" && input.webinar ? loadLiveConsole(db, { authors: audienceAuthors, now: input.now, session: input.session, webinar: input.webinar }) : Promise.resolve(null),
    loadConsolePresence(session, consolePresenceClockMs(session, durationMs, nowMs), nowMs)
  ]);
  const messages: ConsoleMessage[] = chatRows.map((row) => ({
    ...chatMessageFromRow(row),
    promotable: row.author_user_id !== null && consented.has(row.author_user_id)
  }));

  return {
    live,
    messages,
    pinnedMessageId: session.pinnedMessageId,
    polls: { launched, templates: templates.polls.map((poll) => pollFromRow(poll, templates.options)) },
    presence,
    presentNow: presentIds.length,
    questions: questionRows.map(questionFromRow),
    scriptFired: fired,
    scriptItems: scriptRows.map(scriptItemFromRow),
    serverTime: input.now.toISOString(),
    session: consoleSessionOf(session)
  };
}

/** A pagina do console: o webinario, as sessoes para o seletor e o retrato da sessao escolhida (ou a padrao). */
export async function getSessionConsoleData(webinarId: string, requestedSessionId: string | null, now: Date = new Date()): Promise<SessionConsoleData | null> {
  const db = webinarsDb();
  const row = await fetchWebinarRow(db, webinarId);

  if (!row) {
    return null;
  }

  const [sessionRows, recordings] = await Promise.all([listSessionRows(db, [row.id]), listRecordingRows(db, [row.id])]);
  const sessions = consoleSessionsFor(
    sessionRows.map((session) => consoleSessionOf(sessionFromRow(session))),
    now.getTime(),
    requestedSessionId
  );
  const picked = pickConsoleSession(sessions, requestedSessionId, now.getTime());
  const pickedRow = picked ? (sessionRows.find((session) => session.id === picked.id) ?? null) : null;
  const kind: WebinarKind = row.kind === "simulated" ? "simulated" : "live";
  const roomSettings = roomSettingsOfRow(row.room_settings);

  return {
    sessions,
    snapshot: pickedRow ? await loadConsoleSnapshot(db, { kind, now, session: pickedRow, webinar: row }) : null,
    webinar: {
      allowStudentCamera: row.allow_student_camera !== false,
      durationMinutes: row.duration_minutes,
      hostUserId: row.host_user_id,
      id: row.id,
      kind,
      practiceSession: roomSettings.practiceSession,
      recordingDurationSeconds: baseRecordingOf(recordings)?.duration_seconds ?? null,
      slug: row.slug,
      title: row.title,
      waitingRoom: roomSettings.waitingRoom
    }
  };
}

/** O retrato para a rota de 5 s: nulo quando a sessao nao e deste webinario. */
export async function getConsoleSnapshot(webinarId: string, sessionId: string, now: Date = new Date()): Promise<ConsoleSnapshot | null> {
  const db = webinarsDb();
  const [row, session] = await Promise.all([fetchWebinarRow(db, webinarId), fetchSessionRow(db, sessionId)]);

  if (!row || !session || session.webinar_id !== row.id) {
    return null;
  }

  return loadConsoleSnapshot(db, { kind: row.kind === "simulated" ? "simulated" : "live", now, session, webinar: row });
}

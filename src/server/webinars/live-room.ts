// A sala ao vivo do aluno no servidor (docs/30 §1.3, §1.4, §4.7, §5.1, §5.4, §6.3 e §8.1; fase 3): o token da sala
// (POST .../join-token) e os sinais do iframe (POST .../room-events). O token so sai depois do acesso conferido pelo
// mesmo caminho das rotas da Sala (fora do acesso ou sessao de outro webinario: 404; vaga obrigatoria A12: 403, a
// equipe passa), so para a sessao `live` (as outras: 404 sem dizer por que) e pelo papel da regra unica (host =
// webinars.host_user_id com messaging.publish, co-apresentador e Equipe da sala por webinar_presenters, Equipe por
// messaging.write; nunca vindo do navegador). O aluno so entra na espera ou no ar e nunca removido (409 kicked) nem
// banido (409 banned); a equipe tambem na Sessao de pratica (agendada). Sem WEBINAR_MEET_DOMAIN ou WEBINAR_JWT_SECRET:
// 503 meet_unconfigured e a sala mostra "em breve". O nome no token e o do chat (com o aceite) ou primeiro nome +
// inicial ("Aluno {n}" quando o card Sala manda anonimo), nunca o e-mail; sem avatar (dado pessoal a menos). O token
// nunca e guardado nem escrito em log; webinar_joined (so do aluno) sai uma vez por abertura (renovar o token nao
// grava). Os sinais do iframe viram student_events so com codigos (roomEventRecord), no relogio do chat da live
// (sessionOffsetMs).

import "server-only";

import { TOKEN_REFRESH_BEFORE_MS } from "../../lib/jitsi-room-config";
import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { loadAdminAccess } from "../auth/admin-access";
import { can } from "../auth/roles";
import type { StudentEventInsert } from "../students/store";
import { assertNoDbError, WebinarError, type WebinarsDb } from "./db";
import { jitsiTokenClaims, roomRoleFor, signJitsiToken, type JitsiTokenInput, type RoomGrant } from "./jitsi-token";
import {
  liveBanState,
  liveEmbedSettings,
  liveJoinRefusal,
  liveSessionEndsAtMs,
  liveTokenEnv,
  ROOM_EVENT_TYPES,
  roomEventRecord,
  type JoinTokenReply,
  type LiveBanState
} from "./live-model";
import type { RoomEventsInput } from "./live-schemas";
import { ensureSessionRoomName, fetchStudentBans } from "./live-store";
import type { Webinar, WebinarSession } from "./model";
import { loadStudentWebinarById } from "./registrations";
import { consumeLiveOpening, LIVE_JOIN_WINDOW_MS, takeLiveJoinRecord } from "./room-limits";
import { firstNameInitial, sessionOffsetMs } from "./room-model";
import { hasRoomSeat, INVALID_SESSION_MESSAGE, loadStudentIdentity, roomContextOf, studentDisplayName, type RoomContext, type StudentIdentity } from "./room-queries";
import { deviceOf } from "./room-rules";
import { banRefusalError, RoomRefusedError } from "./room-writes";
import { presenterFromRow } from "./rows";
import { listPresenterRows } from "./store";
import { seatRequired } from "./student-model";

/** O pedido de outro token nunca vem antes disto (o mesmo piso de tokenRefreshDelayMs no navegador). */
export const MIN_REFRESH_MS = 10_000;

/** A sala ao vivo nao existe neste ambiente (sem o hostname ou o segredo do token): 503 { reason: "meet_unconfigured" }. */
export class LiveRoomUnavailableError extends WebinarError {
  readonly reason = "meet_unconfigured";

  constructor() {
    super(WEBINAR_COPY.aoVivo.emBreve, 503);
    this.name = "LiveRoomUnavailableError";
  }
}

/* ------------------------------------------------------------------------------------------------
 * O papel e o nome
 * ---------------------------------------------------------------------------------------------- */

/**
 * O papel na sala pela regra unica (docs/30 §5.4 e D15), sempre lido do banco: host = webinars.host_user_id enquanto a
 * pessoa tiver messaging.publish; co-apresentador e Equipe da sala = webinar_presenters (com o prazo valid_until e o
 * can_moderate_room); Equipe = messaging.write; o resto, aluno.
 */
export async function roomGrantFor(db: WebinarsDb, input: { nowMs: number; userId: string; webinar: Pick<Webinar, "hostUserId" | "id"> }): Promise<RoomGrant> {
  const [access, presenterRows] = await Promise.all([loadAdminAccess(input.userId, db), listPresenterRows(db, [input.webinar.id])]);
  const own = presenterRows.filter((row) => row.user_id === input.userId);
  return roomRoleFor({
    hostUserId: can(access, "messaging.publish") ? input.webinar.hostUserId : null,
    nowMs: input.nowMs,
    presenters: own.map(presenterFromRow),
    staff: can(access, "messaging.write"),
    userId: input.userId,
    validUntilByUser: new Map(own.map((row) => [row.user_id, row.valid_until]))
  });
}

/**
 * O nome que vai no token (e aparece na fileira e em Participantes): a equipe com primeiro nome + inicial; o aluno com o
 * aceite do chat, o nome do chat (o apelido ou "Aluno {n}" quando escolheu); sem o aceite, primeiro nome + inicial, ou
 * "Aluno {n}" quando o card Sala manda sempre anonimo. Nunca o e-mail.
 */
export function liveTokenName(input: { grant: Pick<RoomGrant, "role">; identity: Pick<StudentIdentity, "consented" | "displayMode" | "fullName" | "nickname">; userId: string; webinar: Pick<Webinar, "id" | "roomSettings"> }): string {
  const { identity, userId, webinar } = input;
  if (input.grant.role !== "student") {
    return identity.fullName?.trim() ? firstNameInitial(identity.fullName) : "Equipe";
  }
  if (identity.consented) {
    return studentDisplayName(identity, identity.displayMode ?? webinar.roomSettings.displayName, userId, webinar.id);
  }
  const mode = webinar.roomSettings.displayName === "anonymous" ? "anonymous" : "first_name_initial";
  return studentDisplayName({ fullName: identity.fullName, nickname: null }, mode, userId, webinar.id);
}

/* ------------------------------------------------------------------------------------------------
 * webinar_joined: uma vez por abertura
 * ---------------------------------------------------------------------------------------------- */

/** Ha amostra de presenca da pessoa nesta sessao nos ultimos 90 s (pela hora do sinal, nao pelo balde). */
async function hasRecentPresence(db: WebinarsDb, input: { nowMs: number; sessionId: string; userId: string }): Promise<boolean> {
  const { data, error } = await db
    .from("webinar_presence_samples")
    .select("bucket")
    .eq("session_id", input.sessionId)
    .eq("user_id", input.userId)
    .gte("last_at", new Date(input.nowMs - LIVE_JOIN_WINDOW_MS).toISOString())
    .limit(1);
  assertNoDbError(error, "Webinarios: presenca recente na live");
  return (data ?? []).length > 0;
}

/** A pessoa ja tem alguma entrada (webinar_joined) gravada nesta sessao. */
async function hasJoinedBefore(db: WebinarsDb, input: { sessionId: string; userId: string }): Promise<boolean> {
  const { data, error } = await db
    .from("student_events")
    .select("id")
    .eq("entity_type", "webinar")
    .eq("entity_id", input.sessionId)
    .eq("event_type", "webinar_joined")
    .eq("user_id", input.userId)
    .limit(1);
  assertNoDbError(error, "Webinarios: entradas na live");
  return (data ?? []).length > 0;
}

/**
 * Se este token abre a sala (grava webinar_joined) ou so renova (nao grava). Sem presenca nos ultimos 90 s, e uma
 * abertura. Com presenca, so quando o sinal chegou antes do token nesta abertura (a marca do heartbeat neste processo)
 * ou quando a pessoa ainda nao tem entrada nenhuma na sessao. Em todos os casos, no maximo uma a cada 90 s por aluno e
 * sessao (dois tokens juntos gravam uma so).
 */
async function opensRoom(db: WebinarsDb, input: { nowMs: number; sessionId: string; userId: string }): Promise<boolean> {
  const { nowMs, sessionId, userId } = input;
  if (!(await hasRecentPresence(db, input))) {
    return takeLiveJoinRecord(userId, sessionId, nowMs);
  }
  if (consumeLiveOpening(userId, sessionId, nowMs) || !(await hasJoinedBefore(db, { sessionId, userId }))) {
    return takeLiveJoinRecord(userId, sessionId, nowMs);
  }
  return false;
}

/* ------------------------------------------------------------------------------------------------
 * POST .../join-token
 * ---------------------------------------------------------------------------------------------- */

export type IssueJoinTokenInput = {
  db: WebinarsDb;
  /** O ambiente (process.env por padrao; os testes passam o deles). */
  env?: Record<string, string | undefined>;
  now?: number;
  sessionId: string;
  userAgent?: string | null;
  userId: string;
  webinarId: string;
};

/**
 * O contexto da sala para os sinais frequentes (heartbeat e room-events): o mesmo de loadRoomContext (acesso, sessao do
 * webinario, vaga obrigatoria A12), mas na sessao `live` a equipe (host, co-apresentador, Equipe) passa sem a vaga, como
 * no join-token: quem esta no palco pela pagina do aluno manda os sinais e a presenca sem 403.
 */
export async function loadRoomSignalContext(db: WebinarsDb, input: { nowMs: number; sessionId: string; userId: string; webinarId: string }): Promise<RoomContext> {
  const record = await loadStudentWebinarById(db, input.userId, input.webinarId, input.nowMs);
  const context = await roomContextOf(db, record, input.sessionId);
  if (seatRequired(context.webinar, context.session) && !(await hasRoomSeat(db, input.userId, context))) {
    const staff = context.session.kind === "live" && (await roomGrantFor(db, { nowMs: input.nowMs, userId: input.userId, webinar: context.webinar })).role !== "student";
    if (!staff) {
      throw new WebinarError(WEBINAR_COPY.sala.vagaObrigatoria, 403);
    }
  }
  return context;
}

export type IssueJoinTokenResult = { events: StudentEventInsert[]; reply: JoinTokenReply };

/**
 * O token da sala (docs/30 §5.1 e §5.4): ambiente (503), acesso e sessao (404), sessao `live` (404), papel e
 * banimentos (409 not_started / ended / kicked / banned), vaga obrigatoria do aluno (403), o nome da sala (gerado
 * agora se a sessao ainda nao tinha), o JWT com exp = min(fim previsto + 30 min, agora + 15 min) e quando pedir outro.
 * A live que passou da duracao prevista e continua no ar conta o fim previsto a partir de agora.
 */
export async function issueJoinToken(input: IssueJoinTokenInput): Promise<IssueJoinTokenResult> {
  const env = liveTokenEnv(input.env ?? process.env);
  if (!env) {
    throw new LiveRoomUnavailableError();
  }
  const { db, sessionId, userId } = input;
  const nowMs = input.now ?? Date.now();

  const record = await loadStudentWebinarById(db, userId, input.webinarId, nowMs);
  const context = await roomContextOf(db, record, sessionId);
  const { session, webinar } = context;
  if (session.kind !== "live") {
    throw new WebinarError(INVALID_SESSION_MESSAGE, 404);
  }

  const [grant, bans] = await Promise.all([roomGrantFor(db, { nowMs, userId, webinar }), fetchStudentBans(db, { sessionId: session.id, userId })]);
  const ban = liveBanState({ nowMs, sessionBans: bans.sessionBans, userBan: bans.userBan });
  const refusal = liveJoinRefusal({ ban, practiceSession: webinar.roomSettings.practiceSession, role: grant.role, session });
  if (refusal === "not_live") {
    throw new WebinarError(INVALID_SESSION_MESSAGE, 404);
  }
  if (refusal) {
    throw new RoomRefusedError(refusal);
  }
  if (grant.role === "student" && seatRequired(webinar, session) && !(await hasRoomSeat(db, userId, context))) {
    throw new WebinarError(WEBINAR_COPY.sala.vagaObrigatoria, 403);
  }

  const [room, identity] = await Promise.all([
    ensureSessionRoomName(db, { id: session.id, kind: session.kind, room_name: session.roomName, webinar_id: session.webinarId }),
    loadStudentIdentity(db, userId)
  ]);
  const tokenInput: JitsiTokenInput = {
    appId: env.appId,
    domain: env.domain,
    endsAtMs: Math.max(liveSessionEndsAtMs(session, webinar.durationMinutes), nowMs),
    grant,
    nowMs,
    room,
    secret: env.secret,
    user: { id: userId, name: liveTokenName({ grant, identity, userId, webinar }) }
  };
  const expiresAtMs = Number(jitsiTokenClaims(tokenInput).exp) * 1000;
  const jwt = signJitsiToken(tokenInput);

  // A entrada e do historico do aluno: a equipe na sala (host, co-apresentador, Equipe) nao e plateia.
  const events: StudentEventInsert[] = [];
  if (grant.role === "student" && (await opensRoom(db, { nowMs, sessionId: session.id, userId }))) {
    events.push({ entity_id: session.id, entity_type: "webinar", event_type: "webinar_joined", metadata: { device: deviceOf(input.userAgent), kind: "live" }, user_id: userId });
  }

  return {
    events,
    reply: {
      domain: env.domain,
      expiresAt: new Date(expiresAtMs).toISOString(),
      jwt,
      refreshAt: new Date(Math.max(nowMs + MIN_REFRESH_MS, expiresAtMs - TOKEN_REFRESH_BEFORE_MS)).toISOString(),
      role: grant.role,
      room,
      settings: liveEmbedSettings(webinar)
    }
  };
}

/* ------------------------------------------------------------------------------------------------
 * POST .../room-events
 * ---------------------------------------------------------------------------------------------- */

export type RecordRoomEventsInput = {
  context: Pick<RoomContext, "session" | "webinar">;
  db: WebinarsDb;
  events: RoomEventsInput["events"];
  now?: number;
  userId: string;
};

/**
 * Quem pode mandar sinais agora: so na sessao `live` (outra: 404), em espera ou no ar (409 not_started / ended) e
 * nunca removido nem banido (409 banned, como nas escritas da sala). A equipe passa tambem na Sessao de pratica: o
 * papel so e lido quando o caminho do aluno recusaria (a maior parte dos lotes nao paga a leitura).
 */
async function assertRoomEventsAllowed(db: WebinarsDb, input: { nowMs: number; session: WebinarSession; userId: string; webinar: Pick<Webinar, "hostUserId" | "id" | "roomSettings"> }): Promise<void> {
  const { nowMs, session, userId } = input;
  if (session.kind !== "live") {
    throw new WebinarError(INVALID_SESSION_MESSAGE, 404);
  }
  const bans = await fetchStudentBans(db, { sessionId: session.id, userId });
  const ban: LiveBanState = liveBanState({ nowMs, sessionBans: bans.sessionBans, userBan: bans.userBan });
  const practiceSession = input.webinar.roomSettings.practiceSession;
  let refusal = liveJoinRefusal({ ban, practiceSession, role: "student", session });
  if (refusal === "not_started" || refusal === "kicked" || refusal === "banned") {
    const grant = await roomGrantFor(db, { nowMs, userId, webinar: input.webinar });
    refusal = liveJoinRefusal({ ban, practiceSession, role: grant.role, session });
  }
  if (refusal === "kicked" || refusal === "banned") {
    throw banRefusalError(ban, "interaction") ?? new RoomRefusedError("banned");
  }
  if (refusal === "ended" || refusal === "not_started") {
    throw new RoomRefusedError(refusal);
  }
  if (refusal === "not_live") {
    throw new WebinarError(INVALID_SESSION_MESSAGE, 404);
  }
}

/**
 * O id do participante ja esta ligado a OUTRA conta nesta sessao (um webinar_room_joined de outra pessoa com o mesmo
 * metadata.participant_id). O id vem do navegador e qualquer um ve o dos outros pelo iframe: a primeira conta fica com
 * ele, e o console nunca liga o quadro de B ao aluno A (nem manda o kickParticipant de A para B).
 */
async function participantTakenByOther(db: WebinarsDb, input: { participantId: string; sessionId: string; userId: string }): Promise<boolean> {
  const { data, error } = await db
    .from("student_events")
    .select("user_id")
    .eq("entity_type", "webinar")
    .eq("entity_id", input.sessionId)
    .eq("event_type", ROOM_EVENT_TYPES.videoConferenceJoined)
    .eq("metadata->>participant_id", input.participantId)
    .limit(5);
  assertNoDbError(error, "Webinarios: conferir o participante da sala");
  return ((data ?? []) as { user_id: string | null }[]).some((row) => row.user_id !== input.userId);
}

/**
 * Os sinais do iframe em student_events (docs/30 §4.7 e §6.3): cada um pelo roomEventRecord (event_type de
 * ROOM_EVENT_TYPES, metadata so com codigos, `at` do aparelho e `offset_ms` do servidor no relogio do chat da live),
 * entity_type `webinar` e entity_id = a sessao; o que nao tem os campos combinados (e recordingStatusChanged) sai fora.
 * A entrada com o id de participante de outra conta fica gravada sem o id (participantTakenByOther).
 */
export async function recordRoomEvents(input: RecordRoomEventsInput): Promise<StudentEventInsert[]> {
  const { context, db, userId } = input;
  const nowMs = input.now ?? Date.now();
  await assertRoomEventsAllowed(db, { nowMs, session: context.session, userId, webinar: context.webinar });
  const offset = sessionOffsetMs(context.session, nowMs);
  const offsetMs = Number.isFinite(offset) ? Math.round(offset) : null;
  const records = input.events.flatMap((event) => {
    const record = roomEventRecord(event, offsetMs);
    return record ? [record] : [];
  });
  const checked = await Promise.all(
    records.map(async (record) => {
      const participantId = record.metadata.participant_id;
      if (record.eventType !== ROOM_EVENT_TYPES.videoConferenceJoined || typeof participantId !== "string") {
        return record;
      }
      const taken = await participantTakenByOther(db, { participantId, sessionId: context.session.id, userId });
      return taken ? { ...record, metadata: { ...record.metadata, participant_id: null } } : record;
    })
  );
  return checked.map((record) => ({ entity_id: context.session.id, entity_type: "webinar", event_type: record.eventType, metadata: record.metadata, user_id: userId }));
}

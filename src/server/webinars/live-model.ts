// A sala ao vivo no servidor, a parte pura (docs/30 §1.3, §1.4, §4.7, §5.1, §5.4, §6.5 e §8.1 a §8.3; fase 3): o
// ambiente do token (WEBINAR_MEET_DOMAIN, WEBINAR_JWT_APP_ID, WEBINAR_JWT_SECRET), o estado do aluno pelos banimentos
// (removido, silenciado, banido), quem recebe token e quando, o fim previsto que limita o `exp`, o relogio da presenca
// na live (desde o inicio, nunca pela ancora: webinar_close_session conta assim), o prazo do silencio, o que um sinal
// do iframe vira em student_events (so codigos) e o bloco `live` de GET .../session. Sem "server-only", imports
// relativos: tests/webinarios-*.test.mjs carregam direto pelo Node. Nada aqui le o banco nem o relogio de verdade.

import { meetDomainOf, type LiveEmbedSettings } from "../../lib/jitsi-room-config";
import type { RoomRole } from "./jitsi-token";
import type { RoomEventsInput } from "./live-schemas";
import { toTime, type Quality, type SessionStatus, type WebinarSession } from "./model";
import { sessionOffsetMs, type SessionClock } from "./room-model";
import type { SessionBanRow, UserBanRow } from "./rows";

/* ------------------------------------------------------------------------------------------------
 * Ambiente
 * ---------------------------------------------------------------------------------------------- */

export const DEFAULT_JWT_APP_ID = "bunker707";
const MIN_SECRET_CHARS = 32;

export type LiveTokenEnv = { appId: string; domain: string; secret: string };

/**
 * O que o join-token precisa do ambiente: o hostname do Jitsi proprio, o app id (padrao bunker707) e o segredo HS256
 * (pelo menos 32 caracteres). Faltando o hostname ou o segredo: nulo, e a sala ao vivo mostra "em breve" sem quebrar.
 */
export function liveTokenEnv(env: Record<string, string | undefined>): LiveTokenEnv | null {
  const domain = meetDomainOf(env.WEBINAR_MEET_DOMAIN);
  const secret = (env.WEBINAR_JWT_SECRET ?? "").trim();
  const appId = (env.WEBINAR_JWT_APP_ID ?? "").trim() || DEFAULT_JWT_APP_ID;
  if (!domain || secret.length < MIN_SECRET_CHARS || /\s/.test(secret) || !/^[a-z0-9_-]{2,40}$/i.test(appId)) {
    return null;
  }
  return { appId, domain, secret };
}

/** A sala ao vivo existe neste ambiente (o hostname e o segredo do token configurados). */
export function liveRoomConfigured(env: Record<string, string | undefined>): boolean {
  return liveTokenEnv(env) !== null;
}

/** O que o iframe precisa saber do webinario (card Qualidade e card Sala; D26). */
export function liveEmbedSettings(webinar: { allowStudentCamera: boolean; quality: Quality }): LiveEmbedSettings {
  return { allowStudentCamera: webinar.allowStudentCamera, screenFps: webinar.quality.screenFps, stage: webinar.quality.stage };
}

/* ------------------------------------------------------------------------------------------------
 * Banimentos (docs/30 §1.4 e §8.3)
 * ---------------------------------------------------------------------------------------------- */

/** Os prazos do "Silenciar no chat": 5 / 15 / 60 min; nulo = ate o fim da sessao. */
export const MUTE_MINUTES_OPTIONS = [5, 15, 60] as const;
export type MuteMinutes = (typeof MUTE_MINUTES_OPTIONS)[number];

/** O estado do aluno na sessao: removido (kicked), banido de todas (banned), silenciado no chat ate `mutedUntil` (nulo = ate o fim). */
export type LiveBanState = { banned: boolean; kicked: boolean; muted: boolean; mutedUntil: string | null };

export const NO_BAN: LiveBanState = { banned: false, kicked: false, muted: false, mutedUntil: null };

export function liveBanState(input: {
  nowMs: number;
  sessionBans: readonly Pick<SessionBanRow, "kind" | "until_at">[];
  userBan: Pick<UserBanRow, "user_id"> | null;
}): LiveBanState {
  const kicked = input.sessionBans.some((row) => row.kind === "kicked");
  const mutes = input.sessionBans.filter((row) => row.kind === "muted" && (row.until_at === null || toTime(row.until_at) > input.nowMs));
  const untilEnd = mutes.some((row) => row.until_at === null);
  const latest = mutes.reduce<string | null>((best, row) => (row.until_at && (!best || toTime(row.until_at) > toTime(best)) ? row.until_at : best), null);
  return { banned: input.userBan !== null, kicked, muted: mutes.length > 0, mutedUntil: untilEnd ? null : latest };
}

/** Ate quando o silencio vale (ISO), ou nulo para "ate o fim". */
export function muteUntilIso(minutes: MuteMinutes | null | undefined, nowMs: number): string | null {
  return minutes ? new Date(nowMs + minutes * 60_000).toISOString() : null;
}

/**
 * O que o banimento recusa numa escrita da sala (docs/30 §5.1: 409 `banned` / `muted`): removido ou banido nao escreve
 * nada; silenciado nao escreve no chat nem pergunta (`chat`), mas reage e responde enquete (`interaction`).
 */
export function liveWriteRefusal(ban: LiveBanState, kind: "chat" | "interaction"): "banned" | "muted" | null {
  if (ban.banned || ban.kicked) {
    return "banned";
  }
  return kind === "chat" && ban.muted ? "muted" : null;
}

/* ------------------------------------------------------------------------------------------------
 * Quem entra na sala ao vivo (docs/30 §5.1 join-token, §5.4 e §8.1)
 * ---------------------------------------------------------------------------------------------- */

export type LiveJoinRefusal = "banned" | "ended" | "kicked" | "not_live" | "not_started";

const STAFF_ROLES: readonly RoomRole[] = ["host", "co_host", "team"];

/**
 * A sala de espera da sala (o comando toggleLobby que o console manda): ligada na Sessao de pratica (antes de Comecar
 * para todos, quando o card Sala pede), com a sala trancada ou com a Sala de espera do webinario; desligada no resto
 * (docs/30 §1.4 e §8.1). A sala do aluno le a mesma regra (LiveRoomInfo.lobby): com ela ligada, a entrada espera a
 * equipe admitir (o iframe bate sozinho) e nao conta como falha.
 */
export function desiredLobby(input: { practiceSession: boolean; roomLocked: boolean; status: SessionStatus; waitingRoom: boolean }): boolean {
  if (input.roomLocked || input.waitingRoom) {
    return true;
  }
  return input.practiceSession && (input.status === "scheduled" || input.status === "waiting");
}

/**
 * Se a pessoa recebe token agora. So a sessao `live` (outra: `not_live`, a rota responde 404). Encerrada ou cancelada:
 * `ended`. A equipe (host, co-apresentador, Equipe) entra tambem na sessao agendada: e a Sessao de pratica (§1.4); o
 * aluno so na espera (`waiting`: a sala aberta) ou no ar (`live`) e nunca removido nem banido. Com a Sessao de pratica
 * do card Sala (`practiceSession`), a espera e so da equipe: o aluno recebe `not_started` ate Comecar para todos (D35;
 * "o apresentador e a equipe entram antes sem os alunos").
 */
export function liveJoinRefusal(input: { ban: LiveBanState; practiceSession?: boolean; role: RoomRole; session: Pick<WebinarSession, "kind" | "status"> }): LiveJoinRefusal | null {
  const { session } = input;
  if (session.kind !== "live") {
    return "not_live";
  }
  if (session.status === "ended" || session.status === "cancelled") {
    return "ended";
  }
  if (STAFF_ROLES.includes(input.role)) {
    return null;
  }
  if (input.ban.banned) {
    return "banned";
  }
  if (input.ban.kicked) {
    return "kicked";
  }
  if (session.status === "waiting" && input.practiceSession) {
    return "not_started";
  }
  return session.status === "waiting" || session.status === "live" ? null : "not_started";
}

/**
 * O fim previsto da live para o `exp` do token (docs/30 §5.4: min(fim previsto + 30 min, agora + 15 min)): o inicio de
 * verdade (ou a hora marcada, o que vier depois) + a duracao do webinario.
 */
export function liveSessionEndsAtMs(session: Pick<WebinarSession, "scheduledAt" | "startedAt">, durationMinutes: number): number {
  const start = Math.max(toTime(session.scheduledAt), session.startedAt ? toTime(session.startedAt) : Number.NEGATIVE_INFINITY);
  return start + Math.max(1, durationMinutes) * 60_000;
}

/** A resposta de POST .../join-token (docs/30 §5.1): `room` so aqui (nunca na URL), `refreshAt` = quando pedir outro. */
export type JoinTokenReply = {
  domain: string;
  expiresAt: string;
  jwt: string;
  refreshAt: string;
  role: RoomRole;
  room: string;
  settings: LiveEmbedSettings;
};

/* ------------------------------------------------------------------------------------------------
 * O relogio da live
 * ---------------------------------------------------------------------------------------------- */

/** Antes de Comecar para todos, a espera nunca cai num balde da live: no maximo este offset (balde -1). */
export const WAITING_PRESENCE_MAX_OFFSET_MS = -1000;

/**
 * O offset da presenca (o balde de 30 s): na live conta desde o inicio de verdade (started_at), nunca pela ancora,
 * porque webinar_close_session mede a live por ended_at − started_at. Sem started_at (a sala de espera, mesmo depois da
 * hora marcada: o host abriu as 19:55 e so comecou as 20:10), o offset fica sempre negativo (no maximo −1 s, balde −1):
 * a espera nunca entra nos baldes 0, 1, 2... que o inicio vai usar, e webinar_close_session (que soma `bucket >= 0`)
 * nao conta quem so esperou. Nas outras, o mesmo relogio do chat (sessionOffsetMs). O chat e as interacoes da live usam
 * a ancora (sessionOffsetMs); antes dela, o inicio, e webinar_mark_recording_anchor recalcula o que veio antes quando a
 * gravacao comeca (docs/30 §6.5).
 */
export function presenceOffsetMs(session: SessionClock, nowMs: number): number {
  if (session.kind === "live") {
    if (session.startedAt) {
      return nowMs - toTime(session.startedAt);
    }
    return Math.min(nowMs - toTime(session.scheduledAt), WAITING_PRESENCE_MAX_OFFSET_MS);
  }
  return sessionOffsetMs(session, nowMs);
}

/* ------------------------------------------------------------------------------------------------
 * Sinais do iframe em student_events (docs/30 §4.7 e §6.3)
 * ---------------------------------------------------------------------------------------------- */

/** O event_type de cada sinal; `recordingStatusChanged` nao vira registro (a ancora vem da acao do apresentador). */
export const ROOM_EVENT_TYPES = {
  audioMuteStatusChanged: "webinar_mic_toggled",
  errorOccurred: "webinar_room_error",
  participantRoleChanged: "webinar_room_role",
  raiseHandUpdated: "webinar_hand_raised",
  recordingStatusChanged: null,
  videoConferenceJoined: "webinar_room_joined",
  videoConferenceLeft: "webinar_room_left",
  videoMuteStatusChanged: "webinar_camera_toggled"
} as const satisfies Record<RoomEventsInput["events"][number]["name"], string | null>;

type RoomEventInput = RoomEventsInput["events"][number];

const PARTICIPANT_ID = /^[0-9a-z-]{1,40}$/i;
const ERROR_CODE = /^[a-z0-9._-]{1,80}$/i;

function flag(data: RoomEventInput["data"], key: string): boolean | null {
  const value = data?.[key];
  return typeof value === "boolean" ? value : null;
}

/**
 * O que um sinal do lote vira em student_events: o event_type e o metadata so com codigos (o id do participante no
 * Jitsi para o console achar quem remover, booleanos, o papel, o codigo do erro), mais `at` (a hora do aparelho, so
 * para conferencia) e `offset_ms` (do servidor). Sinal sem os campos combinados: nulo (descartado).
 */
export function roomEventRecord(event: RoomEventInput, offsetMs: number | null): { eventType: string; metadata: Record<string, unknown> } | null {
  const eventType = ROOM_EVENT_TYPES[event.name];
  if (!eventType) {
    return null;
  }
  const base = { at: event.at, offset_ms: offsetMs };
  const data = event.data;
  switch (event.name) {
    case "videoConferenceJoined": {
      const participantId = typeof data?.participantId === "string" && PARTICIPANT_ID.test(data.participantId) ? data.participantId : null;
      return { eventType, metadata: { ...base, participant_id: participantId } };
    }
    case "videoConferenceLeft":
      return { eventType, metadata: base };
    case "raiseHandUpdated": {
      const raised = flag(data, "raised");
      return raised === null ? null : { eventType, metadata: { ...base, raised } };
    }
    case "audioMuteStatusChanged": {
      const muted = flag(data, "muted");
      return muted === null ? null : { eventType, metadata: { ...base, on: !muted } };
    }
    case "videoMuteStatusChanged": {
      const muted = flag(data, "muted");
      return muted === null ? null : { eventType, metadata: { ...base, consented: flag(data, "consented") === true, on: !muted } };
    }
    case "participantRoleChanged": {
      const role = data?.role;
      return role === "moderator" || role === "participant" || role === "none" ? { eventType, metadata: { ...base, role } } : null;
    }
    case "errorOccurred": {
      const code = typeof data?.code === "string" && ERROR_CODE.test(data.code) ? data.code : "unknown";
      return { eventType, metadata: { ...base, code, fatal: flag(data, "fatal") === true } };
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------------------------------------
 * GET .../session: o bloco da live
 * ---------------------------------------------------------------------------------------------- */

/** O que a sala ao vivo do aluno precisa a mais (sem o nome da sala nem o token: esses so no join-token). */
export type LiveRoomInfo = {
  /**
   * A sala de espera da sala esta ligada (desiredLobby: Sessao de pratica, sala trancada ou Sala de espera): quem entra
   * espera a equipe admitir, sem o prazo de 30 s da entrada (o iframe bate sozinho).
   */
  lobby: boolean;
  /** A sala trancada pelo apresentador: quem chega ve "A sala está cheia ou fechada…". */
  locked: boolean;
  /** O ambiente tem a sala ao vivo (hostname + segredo); sem ela, "em breve". */
  meetConfigured: boolean;
  /** Sessao de pratica: a espera e so da equipe; o aluno ve Aguardando o apresentador ate Comecar para todos. */
  practice: boolean;
  /** O selo "Gravando" para todos (a maquina do gravador gravando, ou a gravacao no navegador do Apresentador). */
  recording: boolean;
  startedAt: string | null;
  status: SessionStatus;
};

export function liveRoomInfoOf(
  session: Pick<WebinarSession, "recorderStatus" | "roomLocked" | "startedAt" | "status"> & { browserRecordingAt?: string | null },
  meetConfigured: boolean,
  roomSettings: { practiceSession: boolean; waitingRoom: boolean } = { practiceSession: false, waitingRoom: false }
): LiveRoomInfo {
  return {
    lobby: desiredLobby({ practiceSession: roomSettings.practiceSession, roomLocked: session.roomLocked, status: session.status, waitingRoom: roomSettings.waitingRoom }),
    locked: session.roomLocked,
    meetConfigured,
    practice: roomSettings.practiceSession && (session.status === "scheduled" || session.status === "waiting"),
    recording: session.recorderStatus === "recording" || Boolean(session.browserRecordingAt),
    startedAt: session.startedAt,
    status: session.status
  };
}

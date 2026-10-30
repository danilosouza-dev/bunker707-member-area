// Modelo puro da area do aluno dos Webinarios (docs/30 §1.1 e §1.2): o que /webinarios, /webinarios/[slug],
// o card da pagina inicial e a faixa "Comeca em 1 h: Entrar" mostram, montado a partir das linhas ja lidas
// (student-queries.ts le; aqui so as regras). Sem "server-only", imports relativos: tests/webinarios-aluno-
// modelo.test.mjs carrega direto pelo Node (nada de enum, namespace ou parametro de construtor, docs/18 §2.5).
//
// Toda data mostrada ao aluno sai de src/lib/webinar-time.ts ou src/lib/member-format.ts; toda frase, de
// src/lib/webinar-copy.ts.
//
// Fase 4e ("Comeca quando voce entra", docs/30 §1.2 e §1.6): as sessoes `jit` nunca aparecem uma a uma (nem na lista de
// sessoes, nem como a sessao em destaque, nem na faixa "Comeca em 1 h"); o webinario com o just-in-time ligado vira um
// card so, com a contagem ate o proximo horario (jitPageState), em Em andamento enquanto as sessoes correm e em Proxima
// live fora do horario, nunca em Replays. Sem vaga: a sessao `jit` nunca pede a vaga, nem com limite de vagas.

import { isJitSession, jitActive, jitPageState, type JitPageState } from "./jit-model";
import type { LiveBanState, LiveRoomInfo } from "./live-model";
import { formatMemberDuration } from "../../lib/member-format";
import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { formatCountdown, formatWebinarWhen, saoPauloDate, saoPauloTime } from "../../lib/webinar-time";
import {
  bannerWindow,
  nextSession,
  REMINDER_RULES,
  replaySession,
  sessionEndsAt,
  studentPhase,
  toTime,
  WEBINAR_LIMITS,
  webinarHref,
  type ChatMode,
  type DisplayNameMode,
  type JitSettings,
  type SessionKind,
  type SessionStatus,
  type SimulatedPhase,
  type StudentChatMessage,
  type StudentPhase,
  type Webinar,
  type WebinarKind,
  type WebinarRegistration,
  type WebinarSession
} from "./model";
import type { JoinRefusal } from "./room-model";
import type { StudentPoll } from "./room-rules";

const DAY_MS = 24 * 60 * 60_000;

/** Uma sessao como a pagina do aluno a ve (a `replay` fica fora: ela e o botao Assistir o replay). */
export type StudentSessionView = {
  /** Token do .ics da vaga do aluno nesta sessao (nulo sem vaga). */
  calendarToken: string | null;
  dateLabel: string;
  endedAt: string | null;
  id: string;
  kind: SessionKind;
  /** Entrada atrasada da Live gravada (fase 2): depois deste minuto a sala nao abre mais. */
  lateJoinMinutes: number | null;
  phase: StudentPhase;
  registered: boolean;
  registeredAt: string | null;
  /** "{n} alunos com vaga garantida": so quando a equipe ligou ou ha limite de vagas; senao nulo. */
  registeredCount: number | null;
  scheduledAt: string;
  startedAt: string | null;
  status: SessionStatus;
  /** "20:00" em Sao Paulo. */
  timeLabel: string;
  /** "Quarta, 5/11 as 20:00" em Sao Paulo. */
  whenLabel: string;
};

/**
 * "Comeca quando voce entra" na pagina (fase 4e): as regras que o navegador usa para refazer a conta a cada 15 s e o
 * que a pagina mostra na hora da leitura (jitPageState). Nunca a lista de sessoes `jit`.
 */
export type StudentJitView = {
  /** A duracao do video (a gravacao, senao a prevista): o horario atual so aceita entrada antes do fim. */
  durationMs: number;
  endHour: number;
  everyMinutes: JitSettings["everyMinutes"];
  lateJoinMinutes: number | null;
  startHour: number;
  state: JitPageState;
};

export type StudentWebinarView = {
  cancelReason: string | null;
  cancelled: boolean;
  capacity: number | null;
  coverUrl: string | null;
  description: string;
  durationLabel: string;
  durationMinutes: number;
  /** Quando a ultima sessao real acabou (ms), para o "Replay disponivel" da pagina inicial; nulo se ainda nao acabou. */
  endedAtMs: number | null;
  href: string;
  id: string;
  /** Fase 4e: o "Comeca quando voce entra" ligado (so a Live gravada); nulo sem ele ou no webinario cancelado. */
  jit: StudentJitView | null;
  kind: WebinarKind;
  kindLabel: string;
  /** A situacao da sessao em destaque (a tabela de docs/30 §1.2); com o just-in-time e nada marcado, Agendado. */
  phase: StudentPhase;
  presenterName: string | null;
  /** A sessao em destaque: a proxima (ou a que esta acontecendo); sem nenhuma, a ultima que aconteceu. */
  primary: StudentSessionView | null;
  registrationRequired: boolean;
  replayAvailable: boolean;
  replayDaysOnHome: number;
  /** A sessao `replay` (Replay livre, fase 2) quando existe e nao foi cancelada: o botao Assistir o replay abre a sala dela. */
  replaySessionId: string | null;
  sessions: StudentSessionView[];
  showBanner: boolean;
  showOnHome: boolean;
  showRegisteredCount: boolean;
  slug: string;
  title: string;
};

export type StudentWebinarInput = {
  /** Fase 4e: webinars.jit_settings (nulo ou desligado: o webinario como antes). */
  jit?: JitSettings | null;
  now: number;
  presenterName: string | null;
  /** Vagas garantidas por sessao (id da sessao -> total), so das sessoes que precisam do numero. */
  registeredCounts: ReadonlyMap<string, number>;
  registrations: readonly WebinarRegistration[];
  sessions: readonly WebinarSession[];
  /** A duracao do video da Live gravada (ms), quando a gravacao e conhecida; senao a prevista do webinario. */
  videoDurationMs?: number | null;
  webinar: Webinar;
};

export type StudentWebinarLists = {
  /** Sessoes em sala de espera ou ao vivo (botao Entrar). */
  inProgress: StudentWebinarView[];
  /** Encerrados com replay, do mais recente para o mais antigo. */
  replays: StudentWebinarView[];
  /** Agendados (com ou sem vaga), do mais proximo para o mais distante. */
  upcoming: StudentWebinarView[];
};

export type HomeWebinarCard = { kind: "next" | "replay"; view: StudentWebinarView };

export type StartBanner = { href: string; scheduledAt: string; sessionId: string; title: string };

export const KIND_LABELS: Record<WebinarKind, string> = {
  live: WEBINAR_COPY.aluno.liveAoVivo,
  simulated: WEBINAR_COPY.aluno.liveGravada
};

/** A frase da situacao (docs/30 §1.2): Agendado, Vaga garantida, Vagas esgotadas, Aguardando o apresentador... */
export function phaseLabel(phase: StudentPhase): string {
  return WEBINAR_COPY.aluno.situacoes[phase];
}

/** A vaga do aluno que vale para a sessao: a da propria sessao ou a geral (session_id nulo). */
export function registrationFor(registrations: readonly WebinarRegistration[], sessionId: string): WebinarRegistration | null {
  const active = registrations.filter((registration) => registration.status === "registered");
  return active.find((registration) => registration.sessionId === sessionId) ?? active.find((registration) => registration.sessionId === null) ?? null;
}

/**
 * Se a sala desta sessao so abre para quem garantiu a vaga (A12): com o limite de vagas ligado, sim; o replay
 * nunca pede vaga (e de quem tem acesso), nem a sessao do "Comeca quando voce entra" (so Entrar, docs/30 §1.2).
 */
export function seatRequired(webinar: Pick<Webinar, "capacity" | "registrationRequired">, session: Pick<WebinarSession, "kind"> & { jit?: boolean | null }): boolean {
  return session.kind !== "replay" && !isJitSession(session) && webinar.registrationRequired && webinar.capacity != null;
}

/** As sessoes que o aluno escolhe ou ve (sem a `replay` e sem as `jit`), na ordem das horas marcadas. */
export function realSessions(sessions: readonly WebinarSession[]): WebinarSession[] {
  return sessions.filter((session) => session.kind !== "replay" && !isJitSession(session)).sort((a, b) => toTime(a.scheduledAt) - toTime(b.scheduledAt));
}

/** O "Comeca quando voce entra" da pagina (fase 4e): nulo sem ele, fora da Live gravada ou no webinario cancelado. */
export function studentJitView(input: Pick<StudentWebinarInput, "jit" | "now" | "videoDurationMs" | "webinar">): StudentJitView | null {
  const { jit, webinar } = input;
  if (!jit || webinar.cancelledAt || !jitActive(webinar.kind, jit)) {
    return null;
  }
  const durationMs = input.videoDurationMs && input.videoDurationMs > 0 ? input.videoDurationMs : Math.max(1, webinar.durationMinutes) * 60_000;
  const settings = { endHour: jit.endHour, everyMinutes: jit.everyMinutes, lateJoinMinutes: jit.lateJoinMinutes, startHour: jit.startHour };
  return { ...settings, durationMs, state: jitPageState({ durationMs, nowMs: input.now, settings }) };
}

export function buildStudentSession(input: StudentWebinarInput, session: WebinarSession): StudentSessionView {
  const { webinar } = input;
  const registration = registrationFor(input.registrations, session.id);
  const registeredCount = input.registeredCounts.get(session.id) ?? 0;
  // A sessao `jit` nao tem vaga: nunca o "{n} alunos com vaga garantida".
  const showsCount = !isJitSession(session) && (webinar.showRegisteredCount || (webinar.registrationRequired && webinar.capacity != null));
  const phase = studentPhase({
    cancelled: Boolean(webinar.cancelledAt),
    capacity: webinar.registrationRequired ? webinar.capacity : null,
    durationMinutes: webinar.durationMinutes,
    now: input.now,
    registered: registration !== null,
    registeredCount,
    registrationRequired: webinar.registrationRequired,
    session
  });

  return {
    calendarToken: registration?.calendarToken ?? null,
    dateLabel: saoPauloDate(session.scheduledAt),
    endedAt: session.endedAt,
    id: session.id,
    kind: session.kind,
    lateJoinMinutes: session.lateJoinMinutes,
    phase,
    registered: registration !== null,
    registeredAt: registration?.registeredAt ?? null,
    registeredCount: showsCount ? registeredCount : null,
    scheduledAt: session.scheduledAt,
    startedAt: session.startedAt,
    status: session.status,
    timeLabel: saoPauloTime(session.scheduledAt),
    whenLabel: formatWebinarWhen(session.scheduledAt)
  };
}

function endedAtOf(webinar: Webinar, sessions: readonly WebinarSession[], now: number): number | null {
  if (sessions.length === 0) {
    return null;
  }
  const ends = sessions.map((session) => {
    if (session.status === "ended") {
      return sessionEndsAt(session, webinar.durationMinutes);
    }
    return sessionEndsAt(session, webinar.durationMinutes) + REMINDER_RULES.autoEndMinutesAfter * 60_000;
  });
  const latest = Math.max(...ends);
  const allOver = sessions.every((session) => session.status === "ended" || session.status === "cancelled" || sessionEndsAt(session, webinar.durationMinutes) + REMINDER_RULES.autoEndMinutesAfter * 60_000 <= now);
  return allOver ? latest : null;
}

/** A sessao `replay` que o aluno pode abrir (existe e nao foi cancelada). */
export function openReplaySessionId(sessions: readonly WebinarSession[]): string | null {
  const replay = replaySession(sessions);
  return replay && replay.status !== "cancelled" ? replay.id : null;
}

/** O endereco da Sala de uma sessao (docs/30 §1.6): /webinarios/[slug]/sala?sessao=<id>. */
export function roomHref(slug: string, sessionId: string) {
  return `${webinarHref(slug)}/sala?sessao=${encodeURIComponent(sessionId)}`;
}

/** O webinario como a area do aluno o ve (docs/30 §1.2), a partir das linhas ja lidas. */
export function buildStudentWebinarView(input: StudentWebinarInput): StudentWebinarView {
  const { now, webinar } = input;
  const sessions = realSessions(input.sessions);
  const next = nextSession(sessions, webinar.durationMinutes, now);
  const jit = studentJitView(input);
  // Com o just-in-time ligado, uma hora marcada que ja passou nunca vira o destaque (a pagina mostraria a data antiga,
  // "Agendado" e a contagem para tras ao lado do Entrar): sem marcada por vir, nenhum destaque, e manda o jit.
  const primarySession = next ?? (jit ? null : (sessions[sessions.length - 1] ?? null));
  const views = sessions.map((session) => buildStudentSession(input, session));
  const primary = primarySession ? (views.find((view) => view.id === primarySession.id) ?? null) : null;
  const cancelled = Boolean(webinar.cancelledAt);
  const sessionsPhase: StudentPhase = primary?.phase ?? "ended";
  // Com o just-in-time ligado o webinario nunca acaba sozinho: sem sessao marcada por vir, ele fica Agendado.
  const phase: StudentPhase = cancelled ? "cancelled" : jit && sessionsPhase === "ended" ? "scheduled" : sessionsPhase;

  return {
    cancelReason: webinar.cancelReason,
    cancelled,
    capacity: webinar.registrationRequired ? webinar.capacity : null,
    coverUrl: webinar.coverUrl,
    description: webinar.description,
    durationLabel: formatMemberDuration(webinar.durationMinutes * 60),
    durationMinutes: webinar.durationMinutes,
    endedAtMs: cancelled || jit ? null : endedAtOf(webinar, sessions, now),
    href: webinarHref(webinar.slug),
    id: webinar.id,
    jit,
    kind: webinar.kind,
    kindLabel: KIND_LABELS[webinar.kind],
    phase,
    presenterName: input.presenterName,
    primary,
    registrationRequired: webinar.registrationRequired,
    replayAvailable: replaySession(input.sessions) !== null,
    replayDaysOnHome: webinar.replayDaysOnHome,
    replaySessionId: openReplaySessionId(input.sessions),
    sessions: views,
    showBanner: webinar.showBanner,
    showOnHome: webinar.showOnHome,
    showRegisteredCount: webinar.showRegisteredCount,
    slug: webinar.slug,
    title: webinar.title
  };
}

const UPCOMING_PHASES: readonly StudentPhase[] = ["scheduled", "registered", "sold_out"];
const IN_PROGRESS_PHASES: readonly StudentPhase[] = ["waiting", "live"];

/** A hora que ordena os cards: a sessao em destaque; no just-in-time sem sessao marcada, o horario que a pagina mostra. */
function viewTime(view: StudentWebinarView): number {
  if (view.primary) {
    return toTime(view.primary.scheduledAt);
  }
  const state = view.jit?.state;
  const iso = state ? (state.kind === "closed" ? state.nextIso : state.slotIso) : null;
  return iso ? toTime(iso) : 0;
}

function byPrimaryTime(a: StudentWebinarView, b: StudentWebinarView) {
  return viewTime(a) - viewTime(b);
}

/** Em que bloco o card entra: a sessao em destaque decide; o just-in-time correndo agora e Em andamento. */
function blockOf(view: StudentWebinarView): keyof StudentWebinarLists | null {
  if (IN_PROGRESS_PHASES.includes(view.phase)) {
    return "inProgress";
  }
  if (view.jit) {
    return view.jit.state.kind === "closed" ? "upcoming" : "inProgress";
  }
  if (UPCOMING_PHASES.includes(view.phase)) {
    return "upcoming";
  }
  return view.phase === "ended" && view.replayAvailable ? "replays" : null;
}

/**
 * Os tres blocos de /webinarios (docs/30 §1.1): Proxima live, Em andamento e Replays. Cancelados ficam fora. O
 * webinario com o just-in-time e um card so: Em andamento enquanto as sessoes correm, Proxima live fora do horario.
 */
export function groupStudentWebinars(views: readonly StudentWebinarView[]): StudentWebinarLists {
  const visible = views.filter((view) => !view.cancelled);

  return {
    inProgress: visible.filter((view) => blockOf(view) === "inProgress").sort(byPrimaryTime),
    replays: visible.filter((view) => blockOf(view) === "replays").sort((a, b) => (b.endedAtMs ?? 0) - (a.endedAtMs ?? 0)),
    upcoming: visible.filter((view) => blockOf(view) === "upcoming").sort(byPrimaryTime)
  };
}

/**
 * O card "Proxima live" da pagina inicial (docs/30 §1.1): o mais proximo entre os marcados para avisar
 * (em andamento primeiro); sem nenhum, um "Replay disponivel" encerrado ha menos de `replayDaysOnHome` dias.
 */
export function pickHomeWebinar(views: readonly StudentWebinarView[], now: number): HomeWebinarCard | null {
  const lists = groupStudentWebinars(views.filter((view) => view.showOnHome));
  const next = lists.inProgress[0] ?? lists.upcoming[0] ?? null;
  if (next) {
    return { kind: "next", view: next };
  }
  const replay = lists.replays.find((view) => view.replayDaysOnHome > 0 && view.endedAtMs !== null && now - view.endedAtMs <= view.replayDaysOnHome * DAY_MS);
  return replay ? { kind: "replay", view: replay } : null;
}

/** A faixa "Comeca em 1 h: Entrar" (docs/30 §1.1): a vaga garantida mais proxima que comeca em ate 60 min. */
export function pickStartBanner(views: readonly StudentWebinarView[], now: number): StartBanner | null {
  const candidates: StartBanner[] = [];

  for (const view of views) {
    if (view.cancelled || !view.showBanner) {
      continue;
    }
    for (const session of view.sessions) {
      if (session.registered && session.status === "scheduled" && bannerWindow(session.scheduledAt, now) === "soon") {
        candidates.push({ href: view.href, scheduledAt: session.scheduledAt, sessionId: session.id, title: view.title });
      }
    }
  }

  candidates.sort((a, b) => toTime(a.scheduledAt) - toTime(b.scheduledAt));
  return candidates[0] ?? null;
}

/** "Comeca em 1 h" (60 min ou mais), "Comeca em 12 min" ou "" (ja comecou: a faixa some). */
export function bannerLabel(scheduledAt: string, now: number): string {
  if (bannerWindow(scheduledAt, now) !== "soon") {
    return "";
  }
  const text = formatCountdown(toTime(scheduledAt), now);
  if (!text) {
    return "";
  }
  return text.startsWith("1 h") ? "Começa em 1 h" : `Começa em ${text}`;
}

/** O video da sessao gravada (docs/30 §5.1): o endereco do player da Bunny ja montado no servidor. */
export type StudentRoomVideo = {
  embedUrl: string;
  /** Fim do token de visualizacao (segundos desde 1970), quando a biblioteca da Bunny pede token; senao nulo. */
  expires: number | null;
  libraryId: string;
  provider: "bunny";
  videoId: string;
};

/** O que a Sala precisa alem da fase 1 (docs/30 §5.1 e §6.6), montado por room-queries.ts. */
/**
 * A entrada na sala: aberta, ou o motivo (fora da hora, Entrada atrasada, ou sem a vaga quando ha limite). Na live
 * (fase 3) tambem `kicked` (removido desta sessao) e `banned` (banido de todos os webinarios), como no join-token.
 */
export type RoomJoin = { ok: true } | { ok: false; reason: JoinRefusal | "banned" | "kicked" | "no_seat" };

export type StudentRoomExtras = {
  /** Fase 3: a sala ao vivo (so na sessao `live`; nas outras, nulo). Nunca leva o nome da sala nem o token. */
  live: LiveRoomInfo | null;
  me: {
    /** Fase 3: removido desta sessao, banido de todas, silenciado no chat ate `mutedUntil` (nulo = ate o fim). */
    ban: LiveBanState;
    consented: boolean;
    displayMode: DisplayNameMode | null;
    displayName: string | null;
    nickname: string | null;
  };
  pinned: StudentChatMessage | null;
  polls: StudentPoll[];
  presentNow: number;
  replaySessionId: string | null;
  session: {
    /** A equipe deixou a opcao Anonima ligada nas perguntas (card Sala). */
    anonymousQuestions: boolean;
    chatMode: ChatMode;
    chatSlowModeSeconds: number | null;
    /** A duracao do video em ms (a gravacao quando se sabe; senao a duracao prevista). */
    durationMs: number;
    /** Se a sala abre agora para o aluno (roomJoinFor); o replay sempre abre. */
    join: RoomJoin;
    /** Onde o video esta agora, em ms (autoritativo na gravada); nulo no replay. */
    offsetMs: number | null;
    /** A fase da sessao gravada pelo relogio do servidor; nulo no replay. */
    roomPhase: SimulatedPhase | null;
    showLiveBadge: boolean;
  };
  video: StudentRoomVideo | null;
};

/** O que GET /api/webinars/[id]/session devolve (docs/30 §5.1): a fase 1 sempre; a Sala (fase 2) quando a rota traz `room`. */
export type StudentSessionPayload = {
  me: { calendarUrl: string | null; registered: boolean; registeredAt: string | null } & Partial<StudentRoomExtras["me"]>;
  live?: LiveRoomInfo | null;
  pinned?: StudentChatMessage | null;
  polls?: StudentPoll[];
  presentNow?: number;
  registeredCount: number | null;
  serverTime: string;
  session: {
    endedAt: string | null;
    id: string;
    kind: SessionKind;
    lateJoinMinutes: number | null;
    phase: StudentPhase;
    scheduledAt: string;
    startedAt: string | null;
    status: SessionStatus;
  } & Partial<StudentRoomExtras["session"]>;
  video?: StudentRoomVideo | null;
  webinar: { durationMinutes: number; id: string; kind: WebinarKind; replaySessionId?: string | null; slug: string; title: string };
};

/** A resposta completa da Sala: a fase 1 mais tudo o que `room` traz (o que o navegador da sala recebe). */
export type StudentRoomPayload = Omit<StudentSessionPayload, "live" | "me" | "pinned" | "polls" | "presentNow" | "session" | "video" | "webinar"> & {
  live: LiveRoomInfo | null;
  me: { calendarUrl: string | null; registered: boolean; registeredAt: string | null } & StudentRoomExtras["me"];
  pinned: StudentChatMessage | null;
  polls: StudentPoll[];
  presentNow: number;
  session: StudentSessionPayload["session"] & StudentRoomExtras["session"];
  video: StudentRoomVideo | null;
  webinar: { durationMinutes: number; id: string; kind: WebinarKind; replaySessionId: string | null; slug: string; title: string };
};

/** Caminho do .ics da vaga (a rota nao pede sessao: o token basta). */
export function calendarPath(webinarId: string, calendarToken: string): string {
  return `/api/webinars/${encodeURIComponent(webinarId)}/calendar?token=${encodeURIComponent(calendarToken)}`;
}

export function buildSessionPayload(
  view: StudentWebinarView,
  session: StudentSessionView,
  extra: { lateJoinMinutes: number | null; now: number; room?: StudentRoomExtras }
): StudentSessionPayload {
  const base: StudentSessionPayload = {
    me: {
      calendarUrl: session.calendarToken ? calendarPath(view.id, session.calendarToken) : null,
      registered: session.registered,
      registeredAt: session.registeredAt
    },
    registeredCount: session.registeredCount,
    serverTime: new Date(extra.now).toISOString(),
    session: {
      endedAt: session.endedAt,
      id: session.id,
      kind: session.kind,
      lateJoinMinutes: extra.lateJoinMinutes,
      phase: session.phase,
      scheduledAt: session.scheduledAt,
      startedAt: session.startedAt,
      status: session.status
    },
    webinar: { durationMinutes: view.durationMinutes, id: view.id, kind: view.kind, slug: view.slug, title: view.title }
  };
  const room = extra.room;
  if (!room) {
    return base;
  }
  return {
    ...base,
    live: room.live,
    me: { ...base.me, ...room.me },
    pinned: room.pinned,
    polls: room.polls,
    presentNow: room.presentNow,
    session: { ...base.session, ...room.session },
    video: room.video,
    webinar: { ...base.webinar, replaySessionId: room.replaySessionId }
  };
}

/** A resposta da fase 1 com `room`: o tipo completo que a Sala usa (so para o TypeScript do navegador). */
export function asRoomPayload(payload: StudentSessionPayload): StudentRoomPayload | null {
  if (payload.session.roomPhase === undefined && payload.session.offsetMs === undefined) {
    return null;
  }
  return payload as StudentRoomPayload;
}

/* ------------------------------------------------------------------------------------------------
 * Acesso por produto (docs/30 §8.2): a parte pura de access.ts, para o teste.
 * ---------------------------------------------------------------------------------------------- */

export type WebinarEntitlementLike = {
  ends_at: string | null;
  starts_at: string | null;
  status: string;
  target_id: string;
  target_type: string;
};

function isActiveAccessWindow(startsAt: string | null | undefined, endsAt: string | null | undefined, now: number) {
  const start = startsAt ? new Date(startsAt).getTime() : Number.NaN;
  const end = endsAt ? new Date(endsAt).getTime() : Number.NaN;
  return !(!Number.isNaN(start) && start > now) && !(!Number.isNaN(end) && end < now);
}

/**
 * O acesso vale para o webinario quando esta ativo e na janela e: e o coringa da plataforma; ou aponta para
 * o proprio webinario (target_type 'webinar'); ou aponta para o produto ligado (qualquer target_type), o
 * mesmo criterio de src/server/access/lesson-access.ts.
 */
export function webinarEntitlementMatches(row: WebinarEntitlementLike, webinar: { id: string; productId: string | null }, now: number): boolean {
  if (row.status !== "active" || !isActiveAccessWindow(row.starts_at, row.ends_at, now)) {
    return false;
  }
  if (row.target_type === "platform") {
    return row.target_id === "platform" || row.target_id === "*";
  }
  if (row.target_type === "webinar" && row.target_id === webinar.id) {
    return true;
  }
  return webinar.productId !== null && row.target_id === webinar.productId;
}

/** O que o aluno de uma previa da equipe ("ver como") enxerga, sem ler acesso nem segmento. */
export function previewCanSee(mode: "producer" | "student_with_access" | "student_without_access", accessMode: Webinar["accessMode"]): boolean {
  return mode === "student_without_access" ? accessMode === "everyone" : true;
}

/* ------------------------------------------------------------------------------------------------
 * Endereco e origem
 * ---------------------------------------------------------------------------------------------- */

const SLUG = /^[a-z0-9][a-z0-9-]{2,63}$/;
const SOURCE = /^[A-Za-z0-9_.:-]+$/;

/** O slug como o banco aceita (202610280001): fora disso a pagina nem vai ao banco. */
export function isWebinarSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG.test(value);
}

/** O link de origem (?origem=) que a vaga guarda (docs/30 §2.8): so letras, numeros, _ . : e -, ate 80. */
export function normalizeSource(value: string | string[] | null | undefined): string | null {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  return raw.length > 0 && raw.length <= WEBINAR_LIMITS.source && SOURCE.test(raw) ? raw : null;
}

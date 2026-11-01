// O console V2 de quem apresenta (docs/31 V2-12 a V2-15, fase 2 do redesign), a parte pura: o rotulo de cada sessao
// no seletor do topo, o selo dos presentes com o pico, os botoes de situacao do topo pela espécie e pela situacao da
// sessao e o palco da live (V2-4 e V2-A5): o selo do momento, o de quem esta no video grande e quem decide a coluna de
// miniaturas. Sem React e com imports relativos: tests/webinarios-console-v2-modelo.test.mjs carrega direto pelo Node.
// Cada fatia da fase 2 acrescenta aqui as regras da tela dela.

import { liveElapsedLabel, liveOnAirLabel, stageOwnerId } from "../../components/member/webinars/room/live-room-model";
import type { RoomStageTopLeft } from "../../components/member/webinars/room/room-stage-badges";
import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { formatWebinarDayMonthTime } from "../../lib/webinar-time";
import { canEndSession, canOpenSession, consoleClockLabel, consoleClockMs, consolePhaseOf, type ConsolePhase } from "./console-model";
import { liveSessionButtons, type ConsoleRoomRole, type LiveRoomState } from "./live-console-model";
import type { SessionKind, SessionStatus, WebinarSession } from "./model";

const copy = WEBINAR_COPY.consoleV2;

/**
 * O rotulo de uma sessao no seletor do topo (V2-13): "Sessão de 30/10 às 20:00 · no ar", sem o ano e com a situacao
 * gravada em minuscula (a mesma regra de antes: a situacao do banco, nao o relogio); o Replay so com a hora,
 * "Replay · 30/10 às 20:00".
 */
export function consoleSessionOptionLabel(session: { kind: SessionKind; scheduledAt: string; status: SessionStatus }): string {
  const when = formatWebinarDayMonthTime(session.scheduledAt);
  return session.kind === "replay" ? copy.replayDe(when) : copy.sessaoDe(when, copy.fases[session.status]);
}

/**
 * O selo dos presentes (V2-13; no topo da gravada e do Replay, e no palco da live a partir de G5): "12 presentes ·
 * pico 14". Os presentes vem do retrato de 5 s e o pico do relatorio em cache de 60 s (console-presence-model.ts), entao
 * o pico mostrado e o maior dos dois: sem isso o selo poderia dizer "12 presentes · pico 10". Sem pico (o Replay, antes
 * de comecar ou sem a leitura), so "12 presentes".
 */
export function consolePresenceBadge(input: { peak: number | null; presentNow: number }): string {
  const present = Number.isFinite(input.presentNow) ? Math.max(0, Math.round(input.presentNow)) : 0;
  if (input.peak === null || !Number.isFinite(input.peak)) {
    return copy.presentes(present);
  }
  return copy.presentesComPico(present, Math.max(Math.round(input.peak), present));
}

/** Os botoes de situacao do topo do console, na ordem em que aparecem. */
export const CONSOLE_TOP_ACTIONS = ["open_room", "start", "lock", "end_live", "open_session", "end_session", "report"] as const;
export type ConsoleTopActionId = (typeof CONSOLE_TOP_ACTIONS)[number];
export type ConsoleTopAction = { enabled: boolean; id: ConsoleTopActionId };

export type ConsoleTopActionsInput = {
  /** messaging.publish: abrir e encerrar a sessao gravada. */
  canPublish: boolean;
  /** O que o papel de quem esta no console pode na live (liveControlsFor): o Trancar e os botoes da sessao. */
  controls: { lock: boolean; session: boolean; sessionEnabled: boolean };
  kind: SessionKind;
  /** A fase do topo (consolePhaseOf): o relatorio so com ela encerrada. */
  phase: ConsolePhase;
  status: SessionStatus;
};

/**
 * Os botoes de situacao do topo (V2-13 e a decisao "Botões de situação" do plano da fase 2), na ordem de
 * CONSOLE_TOP_ACTIONS. Na live, a matriz de liveSessionButtons: agendada, Abrir a sala, Começar para todos e Trancar;
 * na espera, Começar para todos, Trancar e Encerrar live; no ar, Trancar e Encerrar live. Abrir a sala, Começar para
 * todos e Encerrar live so para quem comanda a sessao (o Apresentador e a Equipe) e desligados sem messaging.publish.
 * O Trancar so para quem apresenta e nunca na encerrada nem na cancelada (o servidor recusa); fica na agendada (a
 * Sessão de prática: quem apresenta tranca antes de abrir). Na gravada, Abrir sessão e Encerrar sessão so com
 * messaging.publish e pela situacao; o Replay nunca abre nem encerra. Ver relatório com a fase encerrada.
 */
export function consoleTopActionsFor(input: ConsoleTopActionsInput): ConsoleTopAction[] {
  const actions: ConsoleTopAction[] = [];
  if (input.kind === "live") {
    const buttons = liveSessionButtons(input.status);
    const session = input.controls.session;
    const enabled = input.controls.sessionEnabled;
    if (session && buttons.open) {
      actions.push({ enabled, id: "open_room" });
    }
    if (session && buttons.start) {
      actions.push({ enabled, id: "start" });
    }
    if (input.controls.lock && input.status !== "ended" && input.status !== "cancelled") {
      actions.push({ enabled: true, id: "lock" });
    }
    if (session && buttons.end) {
      actions.push({ enabled, id: "end_live" });
    }
  } else if (input.kind === "simulated" && input.canPublish) {
    if (canOpenSession(input.status)) {
      actions.push({ enabled: true, id: "open_session" });
    }
    if (canEndSession(input.status)) {
      actions.push({ enabled: true, id: "end_session" });
    }
  }
  if (input.phase === "ended") {
    actions.push({ enabled: true, id: "report" });
  }
  return actions;
}

/* ------------------------------------------------------------------------------------------------
 * G5 (V2-4, V2-13 e V2-A5): o palco da live no console
 * ---------------------------------------------------------------------------------------------- */

/** O selo de cima a esquerda do palco do console: o "Ao vivo" da sala ou a frase do momento, neutra sobre o video. */
export type ConsoleStageTopLeft = Extract<RoomStageTopLeft, { kind: "label" } | { kind: "on_air" }>;

/**
 * O selo de cima a esquerda do palco (V2-4 e V2-13): no ar (a fase pelo relogio do servidor) e com o inicio de verdade,
 * "Ao vivo · 00:42:10" pelo liveOnAirLabel, como a sala do aluno; fora do ar, a frase do momento do console
 * (consoleClockLabel: "Começa em 4:59", "Durou 1:00:00"); sem frase (a sessao cancelada, a espera depois da hora sem o
 * inicio), nada. `nowMs` e a hora do aparelho e `skewMs` a diferenca para o servidor (servidor menos aparelho).
 */
export function consoleStageTopLeft(input: {
  durationMs: number;
  nowMs: number;
  session: Pick<WebinarSession, "endedAt" | "kind" | "recordingAnchorAt" | "scheduledAt" | "startedAt" | "status">;
  skewMs: number;
}): ConsoleStageTopLeft | null {
  const serverNow = input.nowMs + input.skewMs;
  const phase = consolePhaseOf(input.session, input.durationMs, serverNow);
  const startedAt = input.session.startedAt;
  if (phase === "live" && startedAt && Number.isFinite(Date.parse(startedAt))) {
    return { kind: "on_air", label: liveOnAirLabel(startedAt, input.nowMs, input.skewMs), short: liveElapsedLabel(startedAt, input.nowMs, input.skewMs) };
  }
  const label = consoleClockLabel(consoleClockMs(input.session, input.durationMs, serverNow), phase);
  return label ? { kind: "label", label } : null;
}

/** O selo de baixo a esquerda do palco: quem esta no video grande e o papel. */
export type ConsoleStageBadge = { name: string; role: string };

/** O papel do proprio console no selo: o Apresentador, o co-apresentador ou a Equipe. */
function ownRoleLabel(role: ConsoleRoomRole): string {
  if (role === "host") {
    return WEBINAR_COPY.sala.selos.apresentador;
  }
  return role === "co_host" ? copy.palco.coApresentador : WEBINAR_COPY.sala.selos.equipe;
}

/**
 * O selo de baixo a esquerda do palco do console (V2-4 e V2-13): so dentro da sala e no Palco (na Grade nao ha video
 * grande) e com o motor tendo dito quem esta no video grande (onStageId; a tela compartilhada `<id>-v1` vale pelo
 * dono, stageOwnerId). O proprio console ali: "Você" e o papel dele ("Você · Apresentador", "Você · Co-apresentador").
 * Outro moderador ali (o papel de cada um pelo participantRoleChanged e pelo getRoomsInfo): o nome do apresentador da
 * pagina, como o selo da sala do aluno (V2-A25), ou, sem ele, o nome com que essa pessoa esta na sala, com
 * "Apresentador". Sem papel conhecido, um aluno no video grande ou nenhum nome: nada (nunca um nome por palpite).
 */
export function consoleStageBadgeFor(input: {
  joined: boolean;
  presenterName: string | null;
  role: ConsoleRoomRole;
  room: Pick<LiveRoomState, "onStageId" | "people" | "roles" | "selfId" | "viewShown">;
}): ConsoleStageBadge | null {
  const { room } = input;
  if (!input.joined || room.viewShown === "grid" || room.onStageId === null) {
    return null;
  }
  const owner = stageOwnerId(room.onStageId);
  if (room.selfId !== null && owner === room.selfId) {
    return { name: WEBINAR_COPY.consoleAoVivo.voce, role: ownRoleLabel(input.role) };
  }
  if (!Object.hasOwn(room.roles, owner) || room.roles[owner] !== "moderator") {
    return null;
  }
  const name = input.presenterName?.trim() || room.people.find((person) => person.id === owner)?.name.trim() || "";
  return name ? { name, role: WEBINAR_COPY.sala.selos.apresentador } : null;
}

/**
 * Quem decide a coluna de miniaturas do iframe no console (docs/31 V2-A5): o Apresentador deixa com o motor ("engine")
 * e nunca manda toggleFilmStrip pela propria largura, porque o seguir a visao, que so ele liga, levaria essa escolha
 * local a todos e ao gravador; o co-apresentador e a Equipe seguem a largura do iframe ("width"), como o aluno
 * (columnWanted e filmstripStep).
 */
export function consoleColumnPolicy(role: ConsoleRoomRole): "engine" | "width" {
  return role === "host" ? "engine" : "width";
}

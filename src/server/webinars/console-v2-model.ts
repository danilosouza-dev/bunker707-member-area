// O console V2 de quem apresenta (docs/31 V2-12 a V2-15, fase 2 do redesign), a parte pura: o rotulo de cada sessao
// no seletor do topo e os botoes de situacao do topo pela espécie e pela situacao da sessao. Sem React e com imports
// relativos: tests/webinarios-console-v2-modelo.test.mjs carrega direto pelo Node. Cada fatia da fase 2 acrescenta
// aqui as regras da tela dela.

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { formatWebinarDayMonthTime } from "../../lib/webinar-time";
import { canEndSession, canOpenSession, type ConsolePhase } from "./console-model";
import { liveSessionButtons } from "./live-console-model";
import type { SessionKind, SessionStatus } from "./model";

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

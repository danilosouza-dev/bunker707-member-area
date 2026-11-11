"use client";

// A Simulacao na sala da Live gravada (docs/30 §1.6, §4.3 e §6.6): o contador somado ao real, as entradas e saidas
// ("Ana M. entrou") e os avisos de venda, pela janela de GET /api/webinars/[id]/simulation (calculada no servidor com
// a semente; o navegador nunca conhece a semente nem as regras). Como o chat: a primeira janela ao abrir (comecando 15 s
// antes do offset), a seguinte quando faltam 30 s para o fim da atual (janelas de 120 s, uma a cada 90 s), conferido a
// cada 5 s; depois de uma falha, de novo em 30 s; sessao sem nada ligado, de novo so em 5 min (a equipe pode ligar
// durante a sessao), menos na virada do offset de negativo para zero ou mais (a hora marcada, o "Começar para todos"
// da live), que confere na hora (createSimulationChecker). As contas (fusao, numero do instante, entrada e aviso visiveis) ficam em simulation-model.ts.
// webinar-room.tsx usa este hook no cabecalho ("{n} assistindo" = real + parte simulada) e passa o estado para
// room-simulation.tsx. Sem regra ligada (ou desligado: "ver como", replay, sessao encerrada), o contador e o real e
// nada simulado aparece. Nada aqui grava em student_events.

import { useEffect, useMemo, useRef, useState } from "react";
import type { SimulationFeed } from "@/server/webinars/model";
import {
  EMPTY_SIMULATION_ROOM,
  SIMULATION_ROOM,
  counterExtraFromPoints,
  mergeSimulationFeed,
  simulationWindowToFetch,
  type SimulationJoinEvent,
  type SimulationRoomData,
  type SimulationWindow
} from "@/server/webinars/simulation-model";

export type RoomSimulationState = {
  /** O numero do cabecalho: o real mais a parte simulada daquele instante (sem regra ligada, o real). */
  displayCount: (real: number, offsetMs: number) => number;
  /** Algo simulado ligado nesta sessao (a regiao do leitor de tela so existe com ele). */
  enabled?: boolean;
  /** As entradas (e as saidas, com `left`) das janelas que chegaram; o componente mostra a que acabou de passar. */
  joins: readonly SimulationJoinEvent[];
  /** Os avisos de venda das janelas que chegaram. */
  saleNotices: readonly { atMs: number; text: string }[];
};

export type UseRoomSimulationInput = {
  /** Falso no "ver como", no replay e com a sessao encerrada. */
  enabled: boolean;
  getOffsetMs: () => number;
  sessionId: string;
  webinarId: string;
};

const NONE: RoomSimulationState = { displayCount: (real) => real, enabled: false, joins: [], saleNotices: [] };

/** O estado da sala a partir do que as janelas trouxeram (os testes montam direto). */
export function roomSimulationStateOf(data: SimulationRoomData): RoomSimulationState {
  if (!data.enabled) {
    return NONE;
  }
  return {
    displayCount: (real, offsetMs) => {
      const extra = counterExtraFromPoints(data.counter, offsetMs);
      return extra === null ? real : real + extra;
    },
    enabled: true,
    joins: data.joins,
    saleNotices: data.saleNotices
  };
}

/** GET /api/webinars/[id]/simulation?sessao=&from=&to= (sem cache, mesma origem). */
export async function fetchSimulationFeed(webinarId: string, sessionId: string, range: SimulationWindow, signal?: AbortSignal): Promise<SimulationFeed> {
  const params = new URLSearchParams({ from: String(range.fromMs), sessao: sessionId, to: String(range.toMs) });
  const response = await fetch(`/api/webinars/${encodeURIComponent(webinarId)}/simulation?${params.toString()}`, { cache: "no-store", credentials: "same-origin", signal });
  const payload = (await response.json().catch(() => ({}))) as { data?: SimulationFeed };
  if (!response.ok || !payload.data) {
    throw new Error(`simulation ${response.status}`);
  }
  return payload.data;
}

export type SimulationChecker = {
  /** A conferencia de 5 s: pede a janela que falta, se nao esta esperando. */
  check: () => Promise<void>;
  /** A sala saiu (ou desligou): nada mais e pedido nem entregue. */
  stop: () => void;
};

/**
 * A conferencia das janelas, com o relogio, o offset e o pedido injetados (o hook passa o navegador; os testes, um
 * relogio e um pedido falsos). Sem nada ligado na sessao, de novo so em 5 min, e a janela que veio vazia nao conta (a
 * proxima conferencia pede do offset de agora). Depois de uma falha, de novo em 30 s. Quando o offset passa de negativo
 * para zero ou mais (a hora marcada da gravada, o "Começar para todos" da live), a espera acaba: a equipe pode ligar as
 * regras na espera (D74), e quem chegou cedo nao fica ate 5 min sem a Simulacao depois do inicio.
 */
export function createSimulationChecker(deps: {
  fetchFeed: (range: SimulationWindow) => Promise<SimulationFeed>;
  getOffsetMs: () => number;
  now: () => number;
  onFeed: (feed: SimulationFeed, offsetMs: number) => void;
}): SimulationChecker {
  let stopped = false;
  let busy = false;
  let current: SimulationWindow | null = null;
  let waitUntil = 0;
  let lastOffsetMs = Number.NaN;

  return {
    async check() {
      if (stopped || busy) {
        return;
      }
      const offsetMs = deps.getOffsetMs();
      if (lastOffsetMs < 0 && offsetMs >= 0) {
        waitUntil = 0;
      }
      lastOffsetMs = offsetMs;
      if (deps.now() < waitUntil) {
        return;
      }
      const next = simulationWindowToFetch({ current, offsetMs });
      if (!next) {
        return;
      }
      busy = true;
      try {
        const feed = await deps.fetchFeed(next);
        if (stopped) {
          return;
        }
        current = feed.enabled ? next : null;
        if (!feed.enabled) {
          waitUntil = deps.now() + SIMULATION_ROOM.idleRetryMs;
        }
        deps.onFeed(feed, offsetMs);
      } catch {
        // A janela anterior continua valendo; a proxima tentativa vem depois da espera.
        waitUntil = deps.now() + SIMULATION_ROOM.failureRetryMs;
      } finally {
        busy = false;
      }
    },
    stop() {
      stopped = true;
    }
  };
}

export function useRoomSimulation(input: UseRoomSimulationInput): RoomSimulationState {
  const { enabled, sessionId, webinarId } = input;
  const [data, setData] = useState<SimulationRoomData>(EMPTY_SIMULATION_ROOM);
  const offsetRef = useRef(input.getOffsetMs);

  useEffect(() => {
    offsetRef.current = input.getOffsetMs;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const controller = new AbortController();
    const checker = createSimulationChecker({
      fetchFeed: (range) => fetchSimulationFeed(webinarId, sessionId, range, controller.signal),
      getOffsetMs: () => offsetRef.current(),
      now: () => Date.now(),
      onFeed: (feed, offsetMs) => setData((previous) => mergeSimulationFeed(previous, feed, offsetMs))
    });

    // A primeira janela sai do proprio efeito (sem setState sincrono nele).
    const first = window.setTimeout(() => void checker.check(), 0);
    const timer = window.setInterval(() => void checker.check(), SIMULATION_ROOM.checkEveryMs);
    return () => {
      checker.stop();
      controller.abort();
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [enabled, sessionId, webinarId]);

  return useMemo(() => (enabled ? roomSimulationStateOf(data) : NONE), [data, enabled]);
}

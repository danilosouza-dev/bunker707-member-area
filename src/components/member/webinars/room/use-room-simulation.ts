"use client";

// A Simulacao na sala da Live gravada (docs/30 §1.6, §4.3 e §6.6): o contador somado ao real, as entradas e saidas
// ("Ana M. entrou") e os avisos de venda, pela janela de GET /api/webinars/[id]/simulation (calculada no servidor com
// a semente; o navegador nunca conhece a semente nem as regras). Como o chat: a primeira janela ao abrir (comecando 15 s
// antes do offset), a seguinte quando faltam 30 s para o fim da atual (janelas de 120 s, uma a cada 90 s), conferido a
// cada 5 s; depois de uma falha, de novo em 30 s; sessao sem nada ligado, de novo so em 5 min (a equipe pode ligar
// durante a sessao). As contas (fusao, numero do instante, entrada e aviso visiveis) ficam em simulation-model.ts.
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
    let stopped = false;
    let busy = false;
    let current: SimulationWindow | null = null;
    let waitUntil = 0;
    const controller = new AbortController();

    const check = async () => {
      if (stopped || busy || Date.now() < waitUntil) {
        return;
      }
      const offsetMs = offsetRef.current();
      const next = simulationWindowToFetch({ current, offsetMs });
      if (!next) {
        return;
      }
      busy = true;
      try {
        const feed = await fetchSimulationFeed(webinarId, sessionId, next, controller.signal);
        if (stopped) {
          return;
        }
        current = next;
        if (!feed.enabled) {
          waitUntil = Date.now() + SIMULATION_ROOM.idleRetryMs;
        }
        setData((previous) => mergeSimulationFeed(previous, feed, offsetMs));
      } catch {
        // A janela anterior continua valendo; a proxima tentativa vem depois da espera.
        waitUntil = Date.now() + SIMULATION_ROOM.failureRetryMs;
      } finally {
        busy = false;
      }
    };

    // A primeira janela sai do proprio efeito (sem setState sincrono nele).
    const first = window.setTimeout(() => void check(), 0);
    const timer = window.setInterval(() => void check(), SIMULATION_ROOM.checkEveryMs);
    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [enabled, sessionId, webinarId]);

  return useMemo(() => (enabled ? roomSimulationStateOf(data) : NONE), [data, enabled]);
}

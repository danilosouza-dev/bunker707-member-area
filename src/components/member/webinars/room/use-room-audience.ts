"use client";

// Os participantes simulados nas miniaturas da Live ao vivo (docs/30 D120; pedido do produtor de 13/11/2026), o lado da
// sala. Duas partes:
//
// - useRoomAudience: a lista ordenada de quem pode aparecer (GET /api/webinars/[id]/audience, calculada no servidor: as
//   pessoas que comentam com foto, as sem foto e nomes genericos). Pedida ao entrar, de novo quando a decisao da
//   Simulacao muda (a `simulationKey` que a consulta de 5 s do chat ja traz, depois de 0 a 3 s ao acaso, como a janela
//   da Simulacao) e a cada 2 min (a pessoa criada pelo console no meio da live). Depois de uma falha, de novo em 30 s;
//   a lista de antes continua valendo. Nenhuma consulta periodica nova alem dessa.
// - useAudienceTiles: manda ao iframe quem aparece agora (os primeiros da lista, pelo numero de participantes simulados
//   daquele segundo, que a sala ja calcula para o selo dos presentes). Quem desenha e o proprio motor de video
//   (infra/jitsi/web/bunker707-plateia.js): nenhuma conexao nasce por causa de um simulado. A lista vai na hora em que
//   muda e de novo a cada 30 s (o mesmo conteudo nao muda nada no motor; cobre o iframe que carregou o arquivo depois).
//   No console de quem modera, `relay`: o arquivo nao desenha ninguem ali e so repassa a lista ao gravador.
//
// As contas (a lista, quantas aparecem, a assinatura, a mensagem) ficam em audience-tiles-model.ts e jitsi-room-config.ts.
// Nada aqui grava em student_events.

import { useEffect, useRef, useState } from "react";
import { audienceFrameMessage, type AudienceTilePerson } from "@/lib/jitsi-room-config";
import { AUDIENCE_RESEND_MS, audienceTilesKey, type AudienceTilesFeed } from "@/server/webinars/audience-tiles-model";

/** Os tempos da lista na sala. */
export const AUDIENCE_ROOM = {
  /** Depois de uma falha, de novo em 30 s. */
  failureRetryMs: 30_000,
  /** A lista e pedida de novo a cada 2 min (a pessoa criada no meio da live). */
  refreshMs: 120_000,
  /** Ate quanto a sala espera depois de a decisao mudar (espalha os pedidos da turma). */
  refreshJitterMs: 3_000
} as const;

const NO_PEOPLE: readonly AudienceTilePerson[] = [];

/** GET /api/webinars/[id]/audience?sessao= (sem cache, mesma origem). */
export async function fetchAudienceTiles(webinarId: string, sessionId: string, signal?: AbortSignal): Promise<AudienceTilesFeed> {
  const params = new URLSearchParams({ sessao: sessionId });
  const response = await fetch(`/api/webinars/${encodeURIComponent(webinarId)}/audience?${params.toString()}`, { cache: "no-store", credentials: "same-origin", signal });
  const payload = (await response.json().catch(() => ({}))) as { data?: AudienceTilesFeed };
  if (!response.ok || !payload.data || !Array.isArray(payload.data.people)) {
    throw new Error(`audience ${response.status}`);
  }
  return payload.data;
}

export type AudienceLoader = {
  /** A conferencia periodica: pede a lista quando esta na hora, se nenhum pedido esta a caminho. */
  check: () => Promise<void>;
  /** A decisao da Simulacao mudou: a proxima conferencia pede de novo, e o pedido que estava a caminho e descartado. */
  refresh: () => void;
  /** A sala saiu (ou desligou): nada mais e pedido nem entregue. */
  stop: () => void;
};

/**
 * A conferencia da lista, com o relogio e o pedido injetados (o hook passa o navegador; os testes, um relogio e um
 * pedido falsos). A primeira conferencia pede; as seguintes, so passados os 2 min, ou os 30 s depois de uma falha.
 */
export function createAudienceLoader(deps: { fetchFeed: () => Promise<AudienceTilesFeed>; now: () => number; onFeed: (feed: AudienceTilesFeed) => void }): AudienceLoader {
  let stopped = false;
  let busy = false;
  let nextAt = 0;
  let generation = 0;

  return {
    async check() {
      if (stopped || busy || deps.now() < nextAt) {
        return;
      }
      busy = true;
      const asked = generation;
      try {
        const feed = await deps.fetchFeed();
        if (stopped || asked !== generation) {
          return;
        }
        nextAt = deps.now() + AUDIENCE_ROOM.refreshMs;
        deps.onFeed(feed);
      } catch {
        // A lista de antes continua valendo; a proxima tentativa vem depois da espera.
        if (asked === generation) {
          nextAt = deps.now() + AUDIENCE_ROOM.failureRetryMs;
        }
      } finally {
        busy = false;
      }
    },
    refresh() {
      generation += 1;
      busy = false;
      nextAt = 0;
    },
    stop() {
      stopped = true;
    }
  };
}

export type UseRoomAudienceInput = {
  /** Falso no "ver como" e com a sessao encerrada. */
  enabled: boolean;
  sessionId: string;
  /** O resumo da decisao da Simulacao (useRoomScreen, D79): mudou, a lista e pedida de novo. Nulo sem estado. */
  simulationKey?: string | null;
  webinarId: string;
};

/** A lista ordenada dos simulados da sessao (vazia desligado, sem participantes simulados ou antes da primeira resposta). */
export function useRoomAudience(input: UseRoomAudienceInput): readonly AudienceTilePerson[] {
  const { enabled, sessionId, webinarId } = input;
  const simulationKey = input.simulationKey ?? null;
  const [people, setPeople] = useState<readonly AudienceTilePerson[]>(NO_PEOPLE);
  const loaderRef = useRef<AudienceLoader | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const controller = new AbortController();
    const loader = createAudienceLoader({
      fetchFeed: () => fetchAudienceTiles(webinarId, sessionId, controller.signal),
      now: () => Date.now(),
      onFeed: (feed) => setPeople((previous) => (feed.enabled ? (audienceTilesKey(previous) === audienceTilesKey(feed.people) ? previous : feed.people) : NO_PEOPLE))
    });
    loaderRef.current = loader;

    // O primeiro pedido sai do proprio efeito (sem setState sincrono nele).
    const first = window.setTimeout(() => void loader.check(), 0);
    const timer = window.setInterval(() => void loader.check(), 5_000);
    return () => {
      loader.stop();
      controller.abort();
      window.clearTimeout(first);
      window.clearInterval(timer);
      if (loaderRef.current === loader) {
        loaderRef.current = null;
      }
      setPeople(NO_PEOPLE);
    };
  }, [enabled, sessionId, webinarId]);

  // A chave que a sala ja tem: a primeira (a da pagina) nao pede nada; cada mudanca pede a lista de novo uma vez.
  const lastKeyRef = useRef(simulationKey);
  useEffect(() => {
    if (!enabled || simulationKey === lastKeyRef.current) {
      return;
    }
    lastKeyRef.current = simulationKey;
    const loader = loaderRef.current;
    if (!loader) {
      return;
    }
    loader.refresh();
    const id = window.setTimeout(() => void loader.check(), Math.floor(Math.random() * AUDIENCE_ROOM.refreshJitterMs));
    return () => window.clearTimeout(id);
  }, [enabled, simulationKey]);

  return enabled ? people : NO_PEOPLE;
}

export type UseAudienceTilesInput = {
  /** O iframe confirmou a entrada na sala (o videoConferenceJoined): antes disso nada e mandado. */
  joined: boolean;
  /** Quem aparece agora, na ordem (audienceTilesNow); vazia tira todos. */
  people: readonly AudienceTilePerson[];
  /** O postToFrame do useJitsiMeet. */
  post: (message: unknown) => boolean;
  /** O console de quem modera: a lista so segue para o gravador. */
  relay?: boolean;
};

/** Manda a lista ao iframe quando ela muda e de novo a cada 30 s, enquanto a pessoa esta na sala. */
export function useAudienceTiles(input: UseAudienceTilesInput): void {
  const { joined, post } = input;
  const relay = input.relay === true;
  const key = audienceTilesKey(input.people);
  const latest = useRef(input.people);

  useEffect(() => {
    latest.current = input.people;
  });

  useEffect(() => {
    if (!joined) {
      return;
    }
    const send = () => post(audienceFrameMessage(latest.current, relay));
    // Um instante depois da entrada: o arquivo da instancia ja escuta e o motor ja tem a conferencia.
    const first = window.setTimeout(send, 0);
    const timer = window.setInterval(send, AUDIENCE_RESEND_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [joined, key, post, relay]);
}

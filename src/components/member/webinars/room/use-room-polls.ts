"use client";

import { useCallback, useEffect, useState } from "react";
import { getPolls, postPollAnswer, type StudentPoll } from "./room-api";
import { mergeStudentPolls } from "./room-poll-model";

// As enquetes da sala no nivel da sala (docs/31 V2-10), e nao mais dentro da aba: o palco abre a enquete mesmo com o
// painel fechado, o card do chat e a aba Enquetes leem a mesma lista. Ela chega pela releitura da sessao (a cada 60 s e
// ao voltar para a aba do navegador, useRoomClock) e, so enquanto alguma esta aberta, pela leitura das enquetes a cada
// 15 s (o fechamento e o resultado compartilhado chegam logo; sem enquete aberta, nenhum pedido a mais). As duas fundem
// por id (mergeStudentPolls). A resposta troca a enquete pela que o servidor devolveu; a recusada (na live, o 409
// banned) vai a sala por `onRefused` e a lista e relida (a enquete que acabou de fechar sai do palco). No "ver como"
// nada e lido alem da sessao.

const REFRESH_MS = 15_000;

export type RoomPolls = {
  /** Grava a resposta (as opcoes marcadas) e troca a enquete pela que o servidor devolveu; a falha sobe. */
  answer: (poll: StudentPoll, optionIds: string[]) => Promise<void>;
  polls: StudentPoll[];
};

export function useRoomPolls(input: {
  enabled: boolean;
  getOffsetMs: () => number;
  /** Na live: a resposta recusada (409 banned) e contada a sala. */
  onRefused?: (error: unknown) => void;
  sessionId: string;
  /** As enquetes da ultima leitura da sessao (session.polls). */
  sessionPolls: readonly StudentPoll[];
  webinarId: string;
}): RoomPolls {
  const { enabled, getOffsetMs, onRefused, sessionId, sessionPolls, webinarId } = input;
  const [polls, setPolls] = useState<StudentPoll[]>(() => [...sessionPolls]);
  // A releitura da sessao trouxe uma lista nova: funde (na mesma pintura, sem efeito).
  const [source, setSource] = useState(sessionPolls);
  if (source !== sessionPolls) {
    setSource(sessionPolls);
    setPolls((previous) => mergeStudentPolls(previous, sessionPolls));
  }

  const load = useCallback(async () => {
    try {
      const reply = await getPolls(webinarId, sessionId);
      setPolls((previous) => mergeStudentPolls(previous, reply.data.polls));
    } catch {
      // A proxima leitura vem em 15 s (ou na releitura da sessao).
    }
  }, [sessionId, webinarId]);

  const anyOpen = polls.some((poll) => poll.status === "open");
  useEffect(() => {
    if (!enabled || !anyOpen) {
      return;
    }
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [anyOpen, enabled, load]);

  const answer = useCallback(
    async (poll: StudentPoll, optionIds: string[]) => {
      try {
        const reply = await postPollAnswer(webinarId, { offsetMs: Math.round(getOffsetMs()), optionIds, pollId: poll.id, sessionId });
        setPolls((previous) => previous.map((item) => (item.id === poll.id ? reply.poll : item)));
      } catch (failure) {
        onRefused?.(failure);
        if (enabled) {
          void load();
        }
        throw failure;
      }
    },
    [enabled, getOffsetMs, load, onRefused, sessionId, webinarId]
  );

  return { answer, polls };
}

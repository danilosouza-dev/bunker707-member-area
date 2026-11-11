"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getPolls, postPollAnswer, type StudentPoll } from "./room-api";
import { mergeStudentPolls } from "./room-poll-model";

// As enquetes da sala no nivel da sala (docs/31 V2-10), e nao mais dentro da aba: o palco abre a enquete mesmo com o
// painel fechado, o card do chat e a aba Enquetes leem a mesma lista. Ela chega pela releitura da sessao (a cada 60 s e
// ao voltar para a aba do navegador, useRoomClock) e pela leitura das enquetes UMA vez quando o resumo das enquetes da
// Na tela (`pollsKey`, que vem na consulta de 5 s do chat so quando muda) muda: a enquete lancada, encerrada ou com o
// resultado compartilhado chega em 5 a 10 s, depois de 0 a 3 s ao acaso (mil alunos nao pedem no mesmo segundo), e sem
// mudanca nenhum pedido a mais (a leitura fixa de 15 s saiu: uma enquete fixada ficaria aberta a sessao inteira). As
// duas fundem por id (mergeStudentPolls). A resposta troca a enquete pela que o servidor devolveu; a recusada (na live,
// o 409 banned) vai a sala por `onRefused` e a lista e relida (a enquete que acabou de fechar sai do palco). No "ver
// como" nada e lido alem da sessao.

/** Ate quanto a releitura espera depois de o resumo mudar (espalha os pedidos da turma). */
export const POLLS_RELOAD_JITTER_MS = 3_000;

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
  /** O resumo das enquetes da Na tela (useRoomScreen): quando muda, a lista e relida uma vez. Nulo sem estado. */
  pollsKey?: string | null;
  sessionId: string;
  /** As enquetes da ultima leitura da sessao (session.polls). */
  sessionPolls: readonly StudentPoll[];
  webinarId: string;
}): RoomPolls {
  const { enabled, getOffsetMs, onRefused, sessionId, sessionPolls, webinarId } = input;
  const pollsKey = input.pollsKey ?? null;
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
      // A proxima vem na proxima mudanca do resumo (ou na releitura da sessao).
    }
  }, [sessionId, webinarId]);

  // O resumo que a sala ja tem: o primeiro (o da pagina) nao rele nada; cada mudanca rele uma vez.
  const lastKeyRef = useRef(pollsKey);
  useEffect(() => {
    if (!enabled || pollsKey === null || pollsKey === lastKeyRef.current) {
      return;
    }
    lastKeyRef.current = pollsKey;
    const id = window.setTimeout(() => void load(), Math.floor(Math.random() * POLLS_RELOAD_JITTER_MS));
    return () => window.clearTimeout(id);
  }, [enabled, load, pollsKey]);

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

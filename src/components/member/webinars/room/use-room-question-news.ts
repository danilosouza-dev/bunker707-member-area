"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getQuestions } from "./room-api";
import {
  QUESTION_NEWS_FIRST_MS,
  QUESTION_NEWS_REFRESH_MS,
  hasOwnQuestion,
  questionNewsCount,
  questionNewsMarks,
  questionNewsPolls,
  questionNewsSeen,
  type QuestionNewsQuestion
} from "./room-question-news-model";

// O aviso de resposta nova nas perguntas do aluno (rodada v11, docs/30 D100): quantas falas da equipe nas perguntas dele
// chegaram desde a ultima vez que a aba Perguntas esteve na tela. A aba, quando montada, conta o que le (`ingest`); com
// ela fora da tela, a sala rele as perguntas a cada 20 s, mas so para quem ja perguntou algo nesta sessao (a primeira
// leitura, uma por aluno, descobre). A regra e do modelo (room-question-news-model.ts).

export type RoomQuestionNews = {
  /** As falas novas da equipe nas minhas perguntas (0 com a aba Perguntas na tela). */
  count: number;
  /** A aba Perguntas entrega a lista que leu (ou a que mudou depois de uma escrita). */
  ingest: (questions: readonly QuestionNewsQuestion[]) => void;
};

export function useRoomQuestionNews(input: { enabled: boolean; sessionId: string; shown: boolean; tabMounted: boolean; webinarId: string }): RoomQuestionNews {
  const { enabled, sessionId, shown, tabMounted, webinarId } = input;
  const [marks, setMarks] = useState<readonly string[]>([]);
  const [seen, setSeen] = useState<ReadonlySet<string> | null>(null);
  const [own, setOwn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const shownRef = useRef(shown);
  useEffect(() => {
    shownRef.current = shown;
  });

  const ingest = useCallback((questions: readonly QuestionNewsQuestion[]) => {
    const next = questionNewsMarks(questions);
    setMarks((previous) => (previous.length === next.length && previous.every((mark, index) => mark === next[index]) ? previous : next));
    setOwn(hasOwnQuestion(questions));
    setLoaded(true);
    setSeen((previous) => questionNewsSeen(previous, next, shownRef.current));
  }, []);

  // A aba Perguntas na tela ve tudo o que ja chegou.
  const [wasShown, setWasShown] = useState(shown);
  if (wasShown !== shown) {
    setWasShown(shown);
    if (shown && loaded) {
      setSeen((previous) => questionNewsSeen(previous, marks, true));
    }
  }

  const polls = questionNewsPolls({ enabled, loaded, own, tabMounted });
  useEffect(() => {
    if (!polls) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const answer = await getQuestions(webinarId, sessionId, "recentes");
        if (!cancelled) {
          ingest(answer.data.questions as QuestionNewsQuestion[]);
        }
      } catch {
        // A proxima leitura vem no proximo intervalo.
      }
    };
    const first = window.setTimeout(() => void load(), QUESTION_NEWS_FIRST_MS);
    const id = window.setInterval(() => void load(), QUESTION_NEWS_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [ingest, polls, sessionId, webinarId]);

  return { count: shown ? 0 : questionNewsCount(seen, marks), ingest };
}

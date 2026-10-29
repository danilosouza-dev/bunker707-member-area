"use client";

import { ThumbsUp } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { MemberButton } from "@/components/member/ui/member-button";
import { MemberChip } from "@/components/member/ui/member-chip";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { CHAT_LIMITS } from "@/server/webinars/model";
import { getQuestions, postQuestion, postQuestionVote, type StudentQuestion } from "./room-api";

// A aba Perguntas (docs/30 §1.3 e D22): Fazer uma pergunta (opcao Anonima), a lista com Curtir para subir a
// pergunta, a situacao (Respondida ao vivo / Respondida por escrito, com o texto / Dispensada, so para o autor),
// os filtros Todas / Respondidas e a ordem Mais votadas / Mais recentes. Le ao abrir e a cada 15 s enquanto aberta.

const REFRESH_MS = 15_000;

export function RoomQuestionItem({ onVote, question }: { onVote: (question: StudentQuestion) => void; question: StudentQuestion }) {
  const copy = WEBINAR_COPY.sala;

  return (
    <li className="rounded-[12px] border border-white/[0.08] bg-[#161616] p-3" data-room-question={question.id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-zinc-400">{question.anonymous ? copy.anonima : question.displayName}</p>
          <p className="mt-0.5 whitespace-pre-line break-words text-sm leading-5 text-white">{question.body}</p>
        </div>
        <button
          aria-label={question.voted ? copy.descurtir : copy.curtir}
          aria-pressed={question.voted}
          className={cn(
            "flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-full border px-2.5 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none",
            question.voted ? "border-white bg-white text-black" : "border-white/15 text-zinc-200 hover:border-white/40"
          )}
          onClick={() => onVote(question)}
          type="button"
        >
          <ThumbsUp aria-hidden="true" className="size-3.5" />
          <span className="tabular-nums">{question.upvotes}</span>
        </button>
      </div>
      {question.status === "answered" ? (
        <div className="mt-2">
          <MemberChip tone="success">{question.answeredLive ? copy.respondidaAoVivo : copy.respondidaPorEscrito}</MemberChip>
          {question.answerText ? <p className="mt-1.5 whitespace-pre-line text-sm leading-5 text-zinc-200">{question.answerText}</p> : null}
        </div>
      ) : null}
      {question.status === "dismissed" ? (
        <div className="mt-2">
          <MemberChip tone="muted">{copy.dispensada}</MemberChip>
        </div>
      ) : null}
    </li>
  );
}

export function RoomQuestionsTab({ enabled, getOffsetMs, readOnly, sessionId, webinarId }: { enabled: boolean; getOffsetMs: () => number; readOnly: boolean; sessionId: string; webinarId: string }) {
  const copy = WEBINAR_COPY.sala;
  const [questions, setQuestions] = useState<StudentQuestion[]>([]);
  const [filter, setFilter] = useState<"answered" | "all">("all");
  const [order, setOrder] = useState<"recentes" | "votadas">("votadas");
  const [draft, setDraft] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const answer = await getQuestions(webinarId, sessionId, order);
      setQuestions(answer.data.questions);
    } catch {
      // A proxima leitura vem em 15 s.
    }
  }, [order, sessionId, webinarId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const first = window.setTimeout(() => void load(), 0);
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [enabled, load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || readOnly) {
      return;
    }
    setSending(true);
    setStatus(null);
    try {
      const answer = await postQuestion(webinarId, { anonymous, body: text, offsetMs: Math.round(getOffsetMs()), sessionId });
      setQuestions((previous) => [answer.question, ...previous.filter((question) => question.id !== answer.question.id)]);
      setDraft("");
      setStatus(copy.perguntaEnviada);
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : copy.erroEnviar);
    } finally {
      setSending(false);
    }
  }

  async function vote(question: StudentQuestion) {
    if (readOnly) {
      return;
    }
    const optimistic = { ...question, upvotes: Math.max(0, question.upvotes + (question.voted ? -1 : 1)), voted: !question.voted };
    setQuestions((previous) => previous.map((item) => (item.id === question.id ? optimistic : item)));
    try {
      const answer = await postQuestionVote(webinarId, question.id, sessionId);
      setQuestions((previous) => previous.map((item) => (item.id === question.id ? { ...item, upvotes: answer.upvotes, voted: answer.voted } : item)));
    } catch {
      setQuestions((previous) => previous.map((item) => (item.id === question.id ? question : item)));
    }
  }

  const visible = filter === "answered" ? questions.filter((question) => question.status === "answered") : questions;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="room-questions">
      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
        <div aria-label={copy.filtros.todas} className="flex gap-1" role="group">
          {(["all", "answered"] as const).map((value) => (
            <button aria-pressed={filter === value} className={pillClassName(filter === value)} key={value} onClick={() => setFilter(value)} type="button">
              {value === "all" ? copy.filtros.todas : copy.filtros.respondidas}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1">
          {(["votadas", "recentes"] as const).map((value) => (
            <button aria-pressed={order === value} className={pillClassName(order === value)} key={value} onClick={() => setOrder(value)} type="button">
              {value === "votadas" ? copy.ordem.maisVotadas : copy.ordem.maisRecentes}
            </button>
          ))}
        </div>
      </div>
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {visible.length === 0 ? <li className="py-6 text-center text-sm text-zinc-500">{copy.semPerguntas}</li> : null}
        {visible.map((question) => (
          <RoomQuestionItem key={question.id} onVote={(item) => void vote(item)} question={question} />
        ))}
      </ul>
      <form className="border-t border-white/10 bg-[#111] p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" onSubmit={(event) => void submit(event)}>
        <textarea
          aria-label={copy.suaPergunta}
          className="min-h-11 w-full resize-none rounded-[12px] border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus-visible:border-white/40 disabled:opacity-50"
          disabled={readOnly || sending}
          maxLength={CHAT_LIMITS.question}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={copy.fazerPergunta}
          rows={2}
          value={draft}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <label className="inline-flex min-h-8 items-center gap-2 text-xs text-zinc-300">
            <input checked={anonymous} className="accent-white" onChange={(event) => setAnonymous(event.target.checked)} type="checkbox" />
            {copy.anonima}
          </label>
          <MemberButton disabled={readOnly || sending || !draft.trim()} size="sm" type="submit" variant="primary">
            {copy.fazerPergunta}
          </MemberButton>
        </div>
        <p aria-live="polite" className="mt-1 min-h-4 px-1 text-[11px] text-zinc-500">
          {status ?? (readOnly ? WEBINAR_COPY.aluno.previaSemGravar : "")}
        </p>
      </form>
    </div>
  );
}

function pillClassName(active: boolean) {
  return cn(
    "h-8 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white motion-reduce:transition-none",
    active ? "border-white bg-white text-black" : "border-white/15 text-zinc-300 hover:border-white/40"
  );
}

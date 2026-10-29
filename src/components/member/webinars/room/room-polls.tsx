"use client";

import { BarChart3 } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { MemberButton } from "@/components/member/ui/member-button";
import { MemberChip } from "@/components/member/ui/member-chip";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { getPolls, postPollAnswer, type StudentPoll } from "./room-api";

// As enquetes da Sala (docs/30 §1.3 e §9): a aberta aparece na aba (e como um card por cima do chat), resposta
// unica ou multipla num fieldset com legend, Enviar, depois "Resposta enviada"; o resultado so quando a equipe
// compartilhou (barras, anunciadas uma vez); encerrada com o selo. Le ao abrir e a cada 15 s enquanto aberta.

const REFRESH_MS = 15_000;

export function RoomPollCard({ onAnswer, poll, readOnly }: { onAnswer: (poll: StudentPoll, optionIds: string[]) => Promise<void>; poll: StudentPoll; readOnly: boolean }) {
  const copy = WEBINAR_COPY.sala;
  const id = useId();
  const [chosen, setChosen] = useState<string[]>(poll.myOptionIds ?? []);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const answered = poll.myOptionIds !== null;
  const closed = poll.status === "closed";

  function toggle(optionId: string) {
    setChosen((previous) => (poll.kind === "single" ? [optionId] : previous.includes(optionId) ? previous.filter((item) => item !== optionId) : [...previous, optionId]));
  }

  async function submit() {
    if (chosen.length === 0 || sending || readOnly) {
      return;
    }
    setSending(true);
    setStatus(null);
    try {
      await onAnswer(poll, chosen);
      setStatus(copy.enquete.respondida);
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : copy.erroEnviar);
    } finally {
      setSending(false);
    }
  }

  return (
    <fieldset className="rounded-[12px] border border-white/[0.08] bg-[#161616] p-3" data-room-poll={poll.id}>
      <legend className="sr-only">{poll.question}</legend>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-bold text-white" id={`${id}-q`}>
          {poll.question}
        </p>
        {closed ? <MemberChip tone="muted">{copy.enquete.encerrada}</MemberChip> : null}
      </div>
      <div className="mt-2 space-y-1.5">
        {poll.options.map((option) => {
          const count = poll.results?.counts[option.id] ?? 0;
          const total = poll.results?.total ?? 0;
          const percent = total > 0 ? Math.round((count / total) * 100) : 0;
          const selected = chosen.includes(option.id);

          return (
            <label className={cn("relative block overflow-hidden rounded-[10px] border px-3 py-2 text-sm", selected ? "border-white/60" : "border-white/10")} key={option.id}>
              {poll.results ? <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-white/10" style={{ width: `${percent}%` }} /> : null}
              <span className="relative flex items-center gap-2">
                <input
                  checked={selected}
                  className="accent-white"
                  disabled={answered || closed || readOnly}
                  name={`${id}-opt`}
                  onChange={() => toggle(option.id)}
                  type={poll.kind === "single" ? "radio" : "checkbox"}
                  value={option.id}
                />
                <span className="min-w-0 flex-1 text-zinc-100">{option.label}</span>
                {poll.results ? <span className="tabular-nums text-xs font-bold text-zinc-300">{percent}%</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        {!answered && !closed ? (
          <MemberButton disabled={chosen.length === 0 || sending || readOnly} onClick={() => void submit()} size="sm" variant="primary">
            {copy.enquete.enviar}
          </MemberButton>
        ) : (
          <p className="text-xs font-semibold text-emerald-200">{answered ? copy.enquete.respondida : ""}</p>
        )}
        {poll.results ? (
          <p className="text-[11px] text-zinc-400">
            {copy.enquete.resultado} · {poll.results.total}
          </p>
        ) : answered && !closed ? (
          <p className="text-[11px] text-zinc-500">{copy.enquete.semResultado}</p>
        ) : null}
      </div>
      <p aria-live="polite" className="mt-1 min-h-4 text-[11px] text-zinc-500">
        {status ?? ""}
      </p>
    </fieldset>
  );
}

export function RoomPollsTab({ enabled, getOffsetMs, initial, readOnly, sessionId, webinarId }: { enabled: boolean; getOffsetMs: () => number; initial: readonly StudentPoll[]; readOnly: boolean; sessionId: string; webinarId: string }) {
  const copy = WEBINAR_COPY.sala;
  const [polls, setPolls] = useState<StudentPoll[]>([...initial]);

  const load = useCallback(async () => {
    try {
      const answer = await getPolls(webinarId, sessionId);
      setPolls(answer.data.polls);
    } catch {
      // A proxima leitura vem em 15 s.
    }
  }, [sessionId, webinarId]);

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

  async function answer(poll: StudentPoll, optionIds: string[]) {
    const reply = await postPollAnswer(webinarId, { offsetMs: Math.round(getOffsetMs()), optionIds, pollId: poll.id, sessionId });
    setPolls((previous) => previous.map((item) => (item.id === poll.id ? reply.poll : item)));
  }

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2" data-testid="room-polls">
      {polls.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-6 text-center text-sm text-zinc-500">
          <BarChart3 aria-hidden="true" className="size-4" />
          {copy.semEnquetes}
        </p>
      ) : null}
      {polls.map((poll) => (
        <RoomPollCard key={`${poll.id}:${poll.myOptionIds ? "r" : "a"}:${poll.status}`} onAnswer={answer} poll={poll} readOnly={readOnly} />
      ))}
    </div>
  );
}

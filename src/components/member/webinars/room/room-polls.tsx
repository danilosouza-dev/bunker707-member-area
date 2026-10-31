"use client";

import { BarChart3 } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { getPolls, postPollAnswer, type StudentPoll } from "./room-api";
import { RoomBadge, RoomButton } from "./room-ui";

// As enquetes da Sala (docs/30 §1.3 e §9): a aberta aparece na aba (e como um card por cima do chat), resposta
// unica ou multipla num fieldset com legend, Enviar, depois "Resposta enviada"; o resultado so quando a equipe
// compartilhou (barras, anunciadas uma vez); encerrada com o selo. Le ao abrir e a cada 15 s enquanto aberta. Na live
// (fase 3) a resposta recusada (409 banned) e contada a sala (`onRefused`). Redesign V2, F2 (docs/31 V2-11): as cores
// vem dos tokens do tema da sala; a barra do resultado e --room-poll-bar (aparece sobre o card nos dois temas) e a
// porcentagem fica no texto principal, com 4,5:1 mesmo sobre a barra cheia.

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
    <fieldset className="rounded-[12px] border border-room-border bg-room-surface-2 p-3" data-room-poll={poll.id}>
      <legend className="sr-only">{poll.question}</legend>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-bold text-room-fg-strong" id={`${id}-q`}>
          {poll.question}
        </p>
        {closed ? <RoomBadge tone="muted">{copy.enquete.encerrada}</RoomBadge> : null}
      </div>
      <div className="mt-2 space-y-1.5">
        {poll.options.map((option) => {
          const count = poll.results?.counts[option.id] ?? 0;
          const total = poll.results?.total ?? 0;
          const percent = total > 0 ? Math.round((count / total) * 100) : 0;
          const selected = chosen.includes(option.id);

          return (
            <label className={cn("relative block overflow-hidden rounded-[10px] border px-3 py-2 text-sm", selected ? "border-room-active-bg" : "border-room-input-border")} key={option.id}>
              {poll.results ? <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-room-poll-bar" style={{ width: `${percent}%` }} /> : null}
              <span className="relative flex items-center gap-2">
                <input
                  checked={selected}
                  className="accent-room-active-bg"
                  disabled={answered || closed || readOnly}
                  name={`${id}-opt`}
                  onChange={() => toggle(option.id)}
                  type={poll.kind === "single" ? "radio" : "checkbox"}
                  value={option.id}
                />
                <span className="min-w-0 flex-1 text-room-fg">{option.label}</span>
                {poll.results ? <span className="tabular-nums text-xs font-bold text-room-fg">{percent}%</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        {!answered && !closed ? (
          <RoomButton disabled={chosen.length === 0 || sending || readOnly} onClick={() => void submit()} size="sm" variant="primary">
            {copy.enquete.enviar}
          </RoomButton>
        ) : (
          <p className="text-xs font-semibold text-room-success-fg">{answered ? copy.enquete.respondida : ""}</p>
        )}
        {poll.results ? (
          <p className="text-[11px] text-room-fg-subtle">
            {copy.enquete.resultado} · {poll.results.total}
          </p>
        ) : answered && !closed ? (
          <p className="text-[11px] text-room-fg-subtle">{copy.enquete.semResultado}</p>
        ) : null}
      </div>
      <p aria-live="polite" className="mt-1 min-h-4 text-[11px] text-room-fg-subtle">
        {status ?? ""}
      </p>
    </fieldset>
  );
}

export function RoomPollsTab({
  enabled,
  getOffsetMs,
  initial,
  onRefused,
  readOnly,
  sessionId,
  webinarId
}: {
  enabled: boolean;
  getOffsetMs: () => number;
  initial: readonly StudentPoll[];
  /** Fase 3: a resposta recusada (409 banned) e contada a sala. */
  onRefused?: (error: unknown) => void;
  readOnly: boolean;
  sessionId: string;
  webinarId: string;
}) {
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
    try {
      const reply = await postPollAnswer(webinarId, { offsetMs: Math.round(getOffsetMs()), optionIds, pollId: poll.id, sessionId });
      setPolls((previous) => previous.map((item) => (item.id === poll.id ? reply.poll : item)));
    } catch (failure) {
      onRefused?.(failure);
      throw failure;
    }
  }

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2" data-testid="room-polls">
      {polls.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-6 text-center text-sm text-room-fg-subtle">
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

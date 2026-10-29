"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sortQuestionsForBoard } from "@/server/webinars/console-model";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import { CHAT_LIMITS, type QuestionStatus, type WebinarQuestion } from "@/server/webinars/model";
import { adminTextareaClass } from "../../../form";
import { SectionCard } from "../../../settings/kit";
import { StatusChip } from "../../../status-chip";

// O painel Perguntas do console (docs/30 §2.4): a fila por votos (as abertas primeiro), Responder por escrito (vai
// para o chat como linha da equipe), Respondida ao vivo, Dispensar e Reabrir.

const copy = WEBINAR_ADMIN_COPY.console.questions;

type ConsoleQuestionsProps = {
  busyKey: string | null;
  canAct: boolean;
  onAnswer: (questionId: string, answerText: string, answeredLive: boolean) => Promise<boolean>;
  onStatus: (questionId: string, status: QuestionStatus) => void;
  questions: readonly WebinarQuestion[];
};

const STATUS_TONE: Record<QuestionStatus, "muted" | "neutral" | "success"> = { answered: "success", dismissed: "muted", open: "neutral" };

export function ConsoleQuestions({ busyKey, canAct, onAnswer, onStatus, questions }: ConsoleQuestionsProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const board = sortQuestionsForBoard(questions);

  async function answer(question: WebinarQuestion) {
    const text = (answers[question.id] ?? "").trim();

    if (!text) {
      return;
    }

    if (await onAnswer(question.id, text, false)) {
      setAnswers((current) => ({ ...current, [question.id]: "" }));
    }
  }

  return (
    <SectionCard title={copy.title} titleId="console-questions-title">
      {board.length === 0 ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.empty}</p> : null}
      <ol className="flex max-h-[60vh] min-w-0 flex-col gap-3 overflow-y-auto" data-console-questions="">
        {board.map((question) => {
          const busy = busyKey === `question:${question.id}`;

          return (
            <li className={cn("flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2", question.status === "dismissed" && "opacity-70")} data-console-question={question.id} data-question-status={question.status} key={question.id}>
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs leading-5 text-[var(--text-tertiary)]">
                <span className="font-medium text-[var(--text-primary)]">{question.anonymous ? copy.anonymous : question.displayName}</span>
                <span className="tabular-nums">{copy.votes(question.upvotes)}</span>
                <StatusChip tone={STATUS_TONE[question.status]}>{question.answeredLive && question.status === "answered" ? copy.answerLive : copy.statuses[question.status]}</StatusChip>
              </div>
              <p className="text-sm leading-5 break-words whitespace-pre-wrap text-[var(--text-primary)]">{question.body}</p>
              {question.answerText ? <p className="rounded-md bg-[var(--surface-2)] px-2 py-1 text-[13px] leading-5 text-[var(--text-secondary)]">{question.answerText}</p> : null}
              {canAct && question.status === "open" ? (
                <div className="flex min-w-0 flex-col gap-2">
                  <label className="sr-only" htmlFor={`console-answer-${question.id}`}>
                    {copy.answerPlaceholder}
                  </label>
                  <textarea
                    className={cn(adminTextareaClass, "min-h-14")}
                    disabled={busy}
                    id={`console-answer-${question.id}`}
                    maxLength={CHAT_LIMITS.answer}
                    onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                    placeholder={copy.answerPlaceholder}
                    rows={2}
                    value={answers[question.id] ?? ""}
                  />
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    <Button className="h-8! px-2 text-[13px]" disabled={busy || !(answers[question.id] ?? "").trim()} onClick={() => void answer(question)} type="button" variant="secondary">
                      {copy.answerWritten}
                    </Button>
                    <Button className="h-8! px-2 text-[13px]" disabled={busy} onClick={() => void onAnswer(question.id, "", true)} type="button" variant="secondary">
                      {copy.answerLive}
                    </Button>
                    <Button className="h-8! px-2 text-[13px] text-[var(--text-secondary)]" disabled={busy} onClick={() => onStatus(question.id, "dismissed")} type="button" variant="ghost">
                      {copy.dismiss}
                    </Button>
                  </div>
                </div>
              ) : null}
              {canAct && question.status !== "open" ? (
                <div>
                  <Button className="h-8! px-2 text-[13px] text-[var(--text-secondary)]" disabled={busy} onClick={() => onStatus(question.id, "open")} type="button" variant="ghost">
                    {copy.reopen}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </SectionCard>
  );
}

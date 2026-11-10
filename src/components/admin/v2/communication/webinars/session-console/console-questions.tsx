"use client";

import { useState, type ReactNode } from "react";
import { RoomCommentAvatar } from "@/components/member/webinars/room/room-comment";
import { roomPillClassName } from "@/components/member/webinars/room/room-pill";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { AttendanceQuestionMark } from "@/server/webinars/assistant-queries";
import { sortQuestionsForBoard } from "@/server/webinars/console-model";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import { CHAT_LIMITS, type QuestionStatus, type WebinarQuestion } from "@/server/webinars/model";

// O painel Perguntas do console (docs/30 §2.4; o estilo do YouTube, docs/31 §10): a fila por votos (as abertas
// primeiro), cada pergunta como o comentario do YouTube da sala, direto no cartao do painel (sem cartao proprio), com
// uma linha fina entre elas: o avatar de 24 (a mascara na Anonima), a linha do autor (o nome, os votos e os selos
// tonais: a situacao, e as marcas do Atendimento da fase 4c, docs/30 §1.6 e D24: "Respondida pelo Assistente", "Pediu a
// equipe" e com quem esta), o texto e, com a resposta escrita, a resposta como a do fio (o icone da equipe e o texto).
// Na aberta (ou na respondida pelo Assistente em que o aluno pediu a equipe), o campo da resposta com a linha embaixo,
// como o campo da sala, e as pilulas Responder por escrito (vai para o chat como linha da equipe; branca, desligada sem
// texto), Respondida ao vivo e Dispensar; na que saiu da fila, Reabrir. Nenhuma frase escrita aqui.

const copy = WEBINAR_ADMIN_COPY.console.questions;

type ConsoleQuestionsProps = {
  busyKey: string | null;
  canAct: boolean;
  /** Fase 4c: as marcas do Atendimento por pergunta (de quem e a resposta, com quem esta, pediu a equipe). */
  marks?: Readonly<Record<string, AttendanceQuestionMark>> | null;
  onAnswer: (questionId: string, answerText: string, answeredLive: boolean) => Promise<boolean>;
  onStatus: (questionId: string, status: QuestionStatus) => void;
  questions: readonly WebinarQuestion[];
};

type ChipTone = "neutral" | "success" | "warning";

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: "bg-room-control text-room-fg",
  success: "bg-room-success-bg text-room-success-fg",
  warning: "bg-room-warn-bg text-room-warn-fg"
};

/** O selo tonal do YouTube (o do papel no comentario da sala), com o tom da situacao. */
function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: ChipTone }) {
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-xs leading-[18px] font-medium", CHIP_TONES[tone])}>{children}</span>;
}

const STATUS_TONE: Record<QuestionStatus, ChipTone> = { answered: "success", dismissed: "neutral", open: "neutral" };

export function ConsoleQuestions({ busyKey, canAct, marks = null, onAnswer, onStatus, questions }: ConsoleQuestionsProps) {
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
    <div className="flex min-w-0 flex-col" data-console-questions-pane="">
      {board.length === 0 ? <p className="py-6 text-center text-sm leading-5 text-room-fg-subtle">{copy.empty}</p> : null}
      <ol className="flex min-w-0 flex-col max-lg:max-h-[60vh] max-lg:overflow-y-auto" data-console-questions="">
        {board.map((question) => {
          const busy = busyKey === `question:${question.id}`;
          const mark = marks?.[question.id] ?? null;
          const backToTeam = question.status === "answered" && mark?.answerSource === "ai" && mark.handoffRequested;
          const canAnswer = question.status === "open" || backToTeam;
          const name = question.anonymous ? copy.anonymous : question.displayName;
          const draft = answers[question.id] ?? "";

          return (
            <li
              className={cn("flex min-w-0 gap-3 border-b border-room-border py-4 first:pt-1 last:border-b-0", question.status === "dismissed" && "opacity-70")}
              data-console-question={question.id}
              data-question-status={question.status}
              key={question.id}
            >
              <RoomCommentAvatar kind={question.anonymous ? "anonymous" : "person"} name={question.anonymous ? undefined : question.displayName} />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-[18px]">
                  <span className="truncate font-medium text-room-fg">{name}</span>
                  <span className="tabular-nums text-room-fg-subtle">{copy.votes(question.upvotes)}</span>
                  <Chip tone={STATUS_TONE[question.status]}>{question.answeredLive && question.status === "answered" ? copy.answerLive : copy.statuses[question.status]}</Chip>
                  {mark?.answerSource === "ai" ? <Chip>{WEBINAR_COPY.assistente.console.respondidaPeloAssistente}</Chip> : null}
                  {mark?.handoffRequested ? <Chip tone="warning">{WEBINAR_COPY.assistente.console.pediuEquipe}</Chip> : null}
                  {mark?.assignedName && question.status === "open" ? <Chip tone="success">{WEBINAR_COPY.assistente.console.assumida(mark.assignedName)}</Chip> : null}
                </div>
                <p className="mt-1 text-sm leading-5 break-words whitespace-pre-wrap text-room-fg">{question.body}</p>
                {question.answerText ? (
                  <div className="mt-3 flex min-w-0 gap-3" data-console-answer="">
                    <RoomCommentAvatar kind="team" />
                    <p className="min-w-0 flex-1 text-sm leading-5 break-words whitespace-pre-wrap text-room-fg-muted">{question.answerText}</p>
                  </div>
                ) : null}
                {canAct && canAnswer ? (
                  <div className="mt-3 flex min-w-0 flex-col gap-2">
                    <label className="sr-only" htmlFor={`console-answer-${question.id}`}>
                      {copy.answerPlaceholder}
                    </label>
                    <textarea
                      className="block min-h-6 w-full resize-none border-b border-room-field-line bg-transparent pb-1 text-base leading-[22px] text-room-fg outline-none placeholder:text-room-fg-subtle focus:border-room-fg disabled:text-room-fg-disabled lg:text-sm lg:leading-5"
                      disabled={busy}
                      id={`console-answer-${question.id}`}
                      maxLength={CHAT_LIMITS.answer}
                      onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                      placeholder={copy.answerPlaceholder}
                      rows={draft.includes("\n") || draft.length > 60 ? 3 : 1}
                      value={draft}
                    />
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <button className={roomPillClassName({ size: "s", tone: "white" })} disabled={busy || !draft.trim()} onClick={() => void answer(question)} type="button">
                        {copy.answerWritten}
                      </button>
                      <button className={roomPillClassName({ size: "s", tone: "tonal" })} disabled={busy} onClick={() => void onAnswer(question.id, "", true)} type="button">
                        {copy.answerLive}
                      </button>
                      <button className={roomPillClassName({ size: "s", tone: "text" })} disabled={busy} onClick={() => onStatus(question.id, "dismissed")} type="button">
                        {copy.dismiss}
                      </button>
                    </div>
                  </div>
                ) : null}
                {canAct && question.status !== "open" ? (
                  <div className="mt-2">
                    <button className={roomPillClassName({ className: "-ml-3", size: "s", tone: "text" })} disabled={busy} onClick={() => onStatus(question.id, "open")} type="button">
                      {copy.reopen}
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

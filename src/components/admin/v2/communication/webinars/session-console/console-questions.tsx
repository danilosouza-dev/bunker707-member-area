"use client";

import { Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { RoomCommentAvatar } from "@/components/member/webinars/room/room-comment";
import { roomPillClassName } from "@/components/member/webinars/room/room-pill";
import { RoomReplyField, returnFocusFromReply } from "@/components/member/webinars/room/room-reply-field";
import { RoomIconButton } from "@/components/member/webinars/room/room-ui";
import { chatRoleLabel } from "@/lib/webinar-room-client";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { AttendanceQuestionMark } from "@/server/webinars/assistant-queries";
import { questionAwaitsTeam, replyDraftAfterSent, sortQuestionsForBoard, whileSettling } from "@/server/webinars/console-model";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import { CHAT_LIMITS, QUESTION_REPLY_LIMITS, type QuestionReply, type QuestionStatus, type WebinarQuestion } from "@/server/webinars/model";

// O painel Perguntas do console (docs/30 §2.4; o estilo do YouTube, docs/31 §10): a fila por votos (as abertas
// primeiro), cada pergunta como o comentario do YouTube da sala, direto no cartao do painel (sem cartao proprio), com
// uma linha fina entre elas: o avatar de 24 (a mascara na Anonima, legado de antes de 10/11/2026), a linha do autor (o nome, os votos e os selos
// tonais: a situacao, e as marcas do Atendimento da fase 4c, docs/30 §1.6 e D24: "Respondida pelo Assistente", "Pediu a
// equipe" e com quem esta), o texto e, com a resposta escrita, a resposta como a do fio (o icone da equipe e o texto).
// Na aberta (ou na respondida pelo Assistente em que o aluno pediu a equipe), o campo da resposta com a linha embaixo,
// como o campo da sala, e as pilulas Responder por escrito (vai para o chat como linha da equipe; branca, desligada sem
// texto), Respondida ao vivo e Dispensar; na que saiu da fila, Reabrir. Nenhuma frase escrita aqui.
// O fio (docs/30 §2.4; decisao do produtor de 10/11/2026): depois da primeira resposta, o que o aluno que perguntou e a
// equipe escrevem aparece em ordem embaixo dela, cada resposta com a foto ou as iniciais, o nome, o selo do papel da
// equipe e a lixeira (a equipe apaga qualquer resposta do fio). Na respondida, "Responder" abre o campo da equipe
// (RoomReplyField). Quando o aluno escreveu por ultimo, a pergunta leva o selo "Nova resposta do aluno", sobe para o
// topo do quadro e conta no numero da aba, ate a equipe responder no fio ou pelo campo de cima. O campo de responder e
// a lixeira de uma resposta ficam ocupados ate o retrato novo chegar (whileSettling), o envio fecha so o campo da
// pergunta enviada (replyDraftAfterSent), e o campo que sai com o foco nele devolve o foco ao Responder.

const copy = WEBINAR_ADMIN_COPY.console.questions;

type ConsoleQuestionsProps = {
  busyKey: string | null;
  canAct: boolean;
  /** Fase 4c: as marcas do Atendimento por pergunta (de quem e a resposta, com quem esta, pediu a equipe). */
  marks?: Readonly<Record<string, AttendanceQuestionMark>> | null;
  /** A foto do proprio perfil de quem esta no console (o avatar do campo de responder do fio). */
  currentUserAvatarUrl?: string | null;
  onAnswer: (questionId: string, answerText: string, answeredLive: boolean) => Promise<boolean>;
  /** Apaga uma resposta do fio; sem a prop (o teste de tela de antes), o fio fica sem a lixeira. */
  onDeleteReply?: ((replyId: string) => Promise<boolean>) | null;
  /** A resposta da equipe no fio de uma pergunta respondida (devolve se gravou); sem a prop, sem o Responder. */
  onReply?: ((questionId: string, body: string) => Promise<boolean>) | null;
  onStatus: (questionId: string, status: QuestionStatus) => void;
  questions: readonly WebinarQuestion[];
};

/**
 * Uma resposta do fio no console: quem escreveu (a foto ou as iniciais), o selo do papel da equipe, o texto e a lixeira.
 * Legado: linhas de antes de 10/11/2026 (D64). Na pergunta anonima antiga, "Anônima" e a mascara, como a pergunta.
 */
function ThreadReply({ busy, canAct, onDelete, reply }: { busy: boolean; canAct: boolean; onDelete: ((replyId: string) => void) | null; reply: QuestionReply }) {
  const name = reply.anonymous ? copy.anonymous : reply.displayName;
  const role = reply.role === "student" ? null : chatRoleLabel(reply.role);

  return (
    <li className="group/reply flex min-w-0 gap-3" data-console-reply={reply.id} data-reply-role={reply.role}>
      <RoomCommentAvatar imageSrc={reply.anonymous ? null : reply.avatarUrl} kind={reply.anonymous ? "anonymous" : "person"} name={reply.anonymous ? undefined : reply.displayName} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-[18px]">
          <span className="truncate font-medium text-room-fg">{name}</span>
          {role ? <Chip>{role}</Chip> : null}
        </p>
        <p className="mt-0.5 text-sm leading-5 break-words whitespace-pre-wrap text-room-fg-muted">{reply.body}</p>
      </div>
      {canAct && onDelete ? (
        <RoomIconButton className="shrink-0 [&_svg]:size-4" disabled={busy} label={copy.deleteReply(name)} onClick={() => onDelete(reply.id)} size={32} tone="ghost">
          <Trash2 aria-hidden="true" />
        </RoomIconButton>
      ) : null}
    </li>
  );
}

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

export function ConsoleQuestions({ busyKey, canAct, currentUserAvatarUrl = null, marks = null, onAnswer, onDeleteReply = null, onReply = null, onStatus, questions }: ConsoleQuestionsProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // O campo de responder do fio: uma pergunta por vez, com o rascunho dela.
  const [replying, setReplying] = useState<{ draft: string; id: string } | null>(null);
  // As escritas do fio em andamento ate o retrato novo ("reply:{pergunta}", "delete:{resposta}").
  const [settling, setSettling] = useState<readonly string[]>([]);
  const board = sortQuestionsForBoard(questions);
  // O campo de responder saiu com o foco nele (Esc, Cancelar, o envio): o foco volta ao Responder da pergunta.
  const paneRef = useRef<HTMLDivElement | null>(null);
  const replyingId = replying?.id ?? null;
  const replyWasOpenRef = useRef(replyingId);
  useLayoutEffect(() => {
    const was = replyWasOpenRef.current;
    replyWasOpenRef.current = replyingId;
    if (was && !replyingId) {
      returnFocusFromReply(paneRef.current, document.activeElement, document.body, `[data-console-question="${was}"] [data-console-reply-open]`);
    }
  }, [replyingId]);

  async function sendReply(question: WebinarQuestion) {
    const text = replying?.id === question.id ? replying.draft.trim() : "";

    if (!text || !onReply) {
      return;
    }

    if (await whileSettling({ key: `reply:${question.id}`, set: setSettling, settling, work: () => onReply(question.id, text) })) {
      setReplying((current) => replyDraftAfterSent(current, question.id));
    }
  }

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
    <div className="flex min-w-0 flex-col" data-console-questions-pane="" ref={paneRef}>
      {board.length === 0 ? <p className="py-6 text-center text-sm leading-5 text-room-fg-subtle">{copy.empty}</p> : null}
      <ol className="flex min-w-0 flex-col max-lg:max-h-[60vh] max-lg:overflow-y-auto" data-console-questions="">
        {board.map((question) => {
          const busy = busyKey === `question:${question.id}`;
          const mark = marks?.[question.id] ?? null;
          const backToTeam = question.status === "answered" && mark?.answerSource === "ai" && mark.handoffRequested;
          const canAnswer = question.status === "open" || backToTeam;
          // Legado: linhas de antes de 10/11/2026 (D64). A pergunta anonima antiga continua "Anônima", com a mascara.
          const name = question.anonymous ? copy.anonymous : question.displayName;
          const draft = answers[question.id] ?? "";
          const replies = question.replies ?? [];
          const awaitsTeam = questionAwaitsTeam(question);
          // O Responder do fio: so na respondida que nao voltou para a equipe pelo "Falar com a equipe" (essa usa o campo de cima).
          const canReply = canAct && Boolean(onReply) && question.status === "answered" && !backToTeam && replies.length < QUESTION_REPLY_LIMITS.perQuestion;
          const replyOpen = canReply && replying?.id === question.id;

          return (
            <li
              className={cn("flex min-w-0 gap-3 border-b border-room-border py-4 first:pt-1 last:border-b-0", question.status === "dismissed" && "opacity-70")}
              data-console-question={question.id}
              data-question-awaits-team={awaitsTeam ? "" : undefined}
              data-question-status={question.status}
              key={question.id}
            >
              <RoomCommentAvatar imageSrc={question.anonymous ? null : question.avatarUrl} kind={question.anonymous ? "anonymous" : "person"} name={question.anonymous ? undefined : question.displayName} />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-[18px]">
                  <span className="truncate font-medium text-room-fg">{name}</span>
                  <span className="tabular-nums text-room-fg-subtle">{copy.votes(question.upvotes)}</span>
                  <Chip tone={STATUS_TONE[question.status]}>{question.answeredLive && question.status === "answered" ? copy.answerLive : copy.statuses[question.status]}</Chip>
                  {mark?.answerSource === "ai" ? <Chip>{WEBINAR_COPY.assistente.console.respondidaPeloAssistente}</Chip> : null}
                  {mark?.handoffRequested ? <Chip tone="warning">{WEBINAR_COPY.assistente.console.pediuEquipe}</Chip> : null}
                  {mark?.assignedName && question.status === "open" ? <Chip tone="success">{WEBINAR_COPY.assistente.console.assumida(mark.assignedName)}</Chip> : null}
                  {awaitsTeam ? <Chip tone="warning">{copy.newReply}</Chip> : null}
                </div>
                <p className="mt-1 text-sm leading-5 break-words whitespace-pre-wrap text-room-fg">{question.body}</p>
                {question.answerText ? (
                  <div className="mt-3 flex min-w-0 gap-3" data-console-answer="">
                    <RoomCommentAvatar kind="team" />
                    <p className="min-w-0 flex-1 text-sm leading-5 break-words whitespace-pre-wrap text-room-fg-muted">{question.answerText}</p>
                  </div>
                ) : null}
                {replies.length > 0 ? (
                  <ol className="mt-3 flex min-w-0 flex-col gap-3" data-console-thread="">
                    {replies.map((reply) => (
                      <ThreadReply
                        busy={busy || busyKey === `reply:${reply.id}` || settling.includes(`delete:${reply.id}`)}
                        canAct={canAct}
                        key={reply.id}
                        onDelete={onDeleteReply ? (replyId) => void whileSettling({ key: `delete:${replyId}`, set: setSettling, settling, work: () => onDeleteReply(replyId) }) : null}
                        reply={reply}
                      />
                    ))}
                  </ol>
                ) : null}
                {replyOpen ? (
                  <div className="mt-3">
                    <RoomReplyField
                      ariaLabel={copy.replyLabel}
                      avatar={<RoomCommentAvatar imageSrc={currentUserAvatarUrl} kind="team" />}
                      busy={busy || settling.includes(`reply:${question.id}`)}
                      id={`console-reply-${question.id}`}
                      maxLength={QUESTION_REPLY_LIMITS.teamBody}
                      onCancel={() => setReplying(null)}
                      onChange={(value) => setReplying({ draft: value, id: question.id })}
                      onSubmit={() => void sendReply(question)}
                      placeholder={copy.replyPlaceholder}
                      submitLabel={copy.reply}
                      value={replying?.draft ?? ""}
                    />
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
                  <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                    {canReply && !replyOpen ? (
                      <button
                        className={roomPillClassName({ className: "-ml-3", size: "s", tone: awaitsTeam ? "tonal" : "text" })}
                        data-console-reply-open=""
                        disabled={busy}
                        onClick={() => setReplying({ draft: "", id: question.id })}
                        type="button"
                      >
                        {copy.reply}
                      </button>
                    ) : null}
                    <button className={roomPillClassName({ className: canReply && !replyOpen ? undefined : "-ml-3", size: "s", tone: "text" })} disabled={busy} onClick={() => onStatus(question.id, "open")} type="button">
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

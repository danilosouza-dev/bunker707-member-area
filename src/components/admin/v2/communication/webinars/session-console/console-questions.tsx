"use client";

import { Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { RoomCommentAvatar } from "@/components/member/webinars/room/room-comment";
import { roomPillClassName } from "@/components/member/webinars/room/room-pill";
import { RoomReplyField, returnFocusFromReply } from "@/components/member/webinars/room/room-reply-field";
import { RoomSelectPill } from "@/components/member/webinars/room/room-select-pill";
import { RoomIconButton } from "@/components/member/webinars/room/room-ui";
import { chatRoleLabel } from "@/lib/webinar-room-client";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { ANSWER_AUTHOR_LIMITS, ANSWER_AUTHOR_MODES, answerAuthorCustomName, type AnswerAuthorChoice } from "@/server/webinars/answer-author-model";
import type { AttendanceQuestionMark } from "@/server/webinars/assistant-queries";
import { consoleWriterAvatar, questionAwaitsTeam, replyDraftAfterSent, sortQuestionsForBoard, whileSettling } from "@/server/webinars/console-model";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import { CHAT_LIMITS, QUESTION_REPLY_LIMITS, type QuestionReply, type QuestionStatus, type WebinarQuestion } from "@/server/webinars/model";

// O painel Perguntas do console (docs/30 §2.4; o estilo do YouTube, docs/31 §10): a fila por votos (as abertas
// primeiro), cada pergunta como o comentario do YouTube da sala, direto no cartao do painel (sem cartao proprio), com
// uma linha fina entre elas: o avatar de 24 (a mascara na Anonima, legado de antes de 10/11/2026), a linha do autor (o nome, os votos e os selos
// tonais: a situacao, e as marcas do Atendimento da fase 4c, docs/30 §1.6 e D24: "Respondida pelo Assistente", "Pediu a
// equipe" e com quem esta), o texto e, com a resposta escrita, a resposta como a do fio (o icone da equipe e o texto).
// Na aberta (ou na respondida pelo Assistente em que o aluno pediu a equipe), o campo da resposta com a linha embaixo,
// como o campo da sala, e as pilulas Responder por escrito (fica so no fio da pergunta, nunca no chat: rodada v9, P1,
// docs/30 D85; branca, desligada sem texto), Respondida ao vivo e Dispensar; na que saiu da fila, Reabrir. Nenhuma frase
// escrita aqui.
// "Responder como" (rodada v9, P8; docs/30 D88): no alto do painel, quem assina as respostas da equipe (a primeira e as
// do fio): Meu nome (o padrao), Equipe ou Outro nome (com o campo do nome). A escolha vem de quem usa o painel (o
// console a guarda no navegador, useConsoleAnswerAuthor) e vai com cada resposta; com "Outro nome" sem um nome valido,
// responder fica desligado. A resposta mostra quem assinou como a turma ve (o nome, o selo e a foto; ou so a Equipe).
// O fio (docs/30 §2.4; decisao do produtor de 10/11/2026): depois da primeira resposta, o que o aluno que perguntou e a
// equipe escrevem aparece em ordem embaixo dela, cada resposta com a foto ou as iniciais, o nome, o selo do papel da
// equipe e a lixeira (a equipe apaga qualquer resposta do fio). Na respondida, "Responder" abre o campo da equipe
// (RoomReplyField), com a foto do Perfil de quem esta no console ou as iniciais do nome dele (D82). Quando o aluno
// escreveu por ultimo, a pergunta leva o selo "Nova resposta do aluno", sobe para o
// topo do quadro e conta no numero da aba, ate a equipe responder no fio ou pelo campo de cima. O campo de responder e
// a lixeira de uma resposta ficam ocupados ate o retrato novo chegar (whileSettling), o envio fecha so o campo da
// pergunta enviada (replyDraftAfterSent), e o campo que sai com o foco nele devolve o foco ao Responder. A pergunta
// simulada (11/11/2026, docs/30 D77: a de uma pessoa da lista, sem aluno) aparece como as outras, com a foto ou as
// iniciais da pessoa e o selo "Simulada" (so aqui, nunca na sala); a equipe responde, e o fio dela e so da equipe.

const copy = WEBINAR_ADMIN_COPY.console.questions;
const PESSOAS = WEBINAR_COPY.pessoas;

type ConsoleQuestionsProps = {
  busyKey: string | null;
  canAct: boolean;
  /** Fase 4c: as marcas do Atendimento por pergunta (de quem e a resposta, com quem esta, pediu a equipe). */
  marks?: Readonly<Record<string, AttendanceQuestionMark>> | null;
  /** A foto do proprio perfil de quem esta no console (o avatar do campo de responder do fio). */
  currentUserAvatarUrl?: string | null;
  /** O nome de quem esta no console, para as iniciais do avatar do campo sem a foto; sem ele, o icone da equipe. */
  currentUserName?: string | null;
  /** "Responder como" (docs/30 D88): a escolha de agora; sem ela (o teste de tela de antes), o seletor nao aparece. */
  author?: AnswerAuthorChoice | null;
  onAnswer: (questionId: string, answerText: string, answeredLive: boolean, author?: AnswerAuthorChoice) => Promise<boolean>;
  /** Troca a escolha de "Responder como"; sem a prop, o seletor nao aparece. */
  onAuthor?: ((choice: AnswerAuthorChoice) => void) | null;
  /** Apaga uma resposta do fio; sem a prop (o teste de tela de antes), o fio fica sem a lixeira. */
  onDeleteReply?: ((replyId: string) => Promise<boolean>) | null;
  /** A resposta da equipe no fio de uma pergunta respondida (devolve se gravou); sem a prop, sem o Responder. */
  onReply?: ((questionId: string, body: string, author?: AnswerAuthorChoice) => Promise<boolean>) | null;
  /**
   * Rodada v9 (docs/30 D89): "Mostrar na tela" em cada pergunta que a turma ve (o id) e "Tirar da tela" na que ja esta
   * (nulo). Nula quando a sessao nao aceita a equipe ou no Replay: o botao nao aparece.
   */
  onScreenComment?: ((questionId: string | null) => void) | null;
  /** A pergunta que esta na tela agora (a exibicao de origem pergunta); nula sem nenhuma. */
  screenCommentQuestionId?: string | null;
  onStatus: (questionId: string, status: QuestionStatus) => void;
  questions: readonly WebinarQuestion[];
};

/**
 * Uma resposta do fio no console: quem escreveu (a foto ou as iniciais), o selo do papel da equipe, o texto e a lixeira.
 * Legado: linhas de antes de 10/11/2026 (D64). Na pergunta anonima antiga, "Anônima" e a mascara, como a pergunta.
 */
function ThreadReply({ busy, canAct, onDelete, reply }: { busy: boolean; canAct: boolean; onDelete: ((replyId: string) => void) | null; reply: QuestionReply }) {
  // "Responder como" (docs/30 D88): a resposta da equipe aparece aqui como a turma ve. Com "Equipe", so o selo e o icone
  // da equipe; com "Outro nome", o nome personalizado com o icone da equipe e sem o selo do papel.
  const staff = reply.role !== "student";
  const asTeam = staff && reply.authorAs === "team";
  const custom = staff && reply.authorAs === "custom";
  const name = asTeam ? WEBINAR_COPY.sala.selos.equipe : reply.anonymous ? copy.anonymous : reply.displayName;
  const role = !staff || asTeam || custom ? null : chatRoleLabel(reply.role);

  return (
    <li className="group/reply flex min-w-0 gap-3" data-console-reply={reply.id} data-reply-author-as={staff ? (reply.authorAs ?? undefined) : undefined} data-reply-role={reply.role}>
      {asTeam || custom ? (
        <RoomCommentAvatar kind="team" />
      ) : (
        <RoomCommentAvatar imageSrc={reply.anonymous ? null : reply.avatarUrl} kind={reply.anonymous ? "anonymous" : "person"} name={reply.anonymous ? undefined : reply.displayName} />
      )}
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

/** A escolha de "Responder como" pronta para ir com a resposta: nula quando "Outro nome" ainda nao tem um nome valido. */
export function answerAuthorReady(choice: AnswerAuthorChoice): AnswerAuthorChoice | null {
  if (choice.as !== "custom") {
    return { as: choice.as, name: null };
  }
  const name = answerAuthorCustomName(choice.name);
  return name ? { as: "custom", name } : null;
}

/**
 * "Responder como" no alto das Perguntas: a pilula com as tres opcoes, a frase do que a turma ve e, em "Outro nome", o
 * campo do nome (de 2 a 40 caracteres; fora disso, a frase do erro e as respostas desligadas).
 */
function AnswerAuthorPicker({ choice, name, onChange }: { choice: AnswerAuthorChoice; name: string | null; onChange: (choice: AnswerAuthorChoice) => void }) {
  const custom = choice.as === "custom";
  const invalid = custom && !answerAuthorCustomName(choice.name);
  return (
    <div className="flex min-w-0 flex-col gap-2 border-b border-room-border pb-3" data-console-answer-author={choice.as}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-xs leading-[18px] font-medium text-room-fg-subtle" id="console-answer-author-label">
          {copy.authorAs}
        </span>
        <RoomSelectPill
          id="console-answer-author"
          label={copy.authorAs}
          labelHidden
          onChange={(as) => onChange({ as, name: choice.name ?? null })}
          options={ANSWER_AUTHOR_MODES.map((mode) => ({ label: mode === "self" ? copy.authorModes.self(name) : copy.authorModes[mode], value: mode }))}
          selectData={{ "data-console-answer-author-select": "" }}
          size="s"
          value={choice.as}
        />
      </div>
      {custom ? (
        <div className="flex min-w-0 flex-col gap-1">
          <label className="sr-only" htmlFor="console-answer-author-name">
            {copy.authorCustomName}
          </label>
          <input
            aria-describedby="console-answer-author-hint"
            aria-invalid={invalid ? true : undefined}
            className="block h-8 w-full min-w-0 border-b border-room-field-line bg-transparent pb-1 text-sm leading-5 text-room-fg outline-none placeholder:text-room-fg-subtle focus:border-room-fg"
            data-console-answer-author-name=""
            id="console-answer-author-name"
            maxLength={ANSWER_AUTHOR_LIMITS.nameMax}
            onChange={(event) => onChange({ as: "custom", name: event.target.value })}
            placeholder={copy.authorCustomPlaceholder}
            type="text"
            value={choice.name ?? ""}
          />
        </div>
      ) : null}
      <p className={cn("text-xs leading-[18px]", invalid ? "text-room-warn-fg" : "text-room-fg-subtle")} id="console-answer-author-hint">
        {invalid ? copy.authorNameInvalid(ANSWER_AUTHOR_LIMITS.nameMin, ANSWER_AUTHOR_LIMITS.nameMax) : copy.authorHints[choice.as]}
      </p>
    </div>
  );
}

export function ConsoleQuestions({
  author = null,
  busyKey,
  canAct,
  currentUserAvatarUrl = null,
  currentUserName = null,
  marks = null,
  onAnswer,
  onAuthor = null,
  onDeleteReply = null,
  onReply = null,
  onScreenComment = null,
  onStatus,
  questions,
  screenCommentQuestionId = null
}: ConsoleQuestionsProps) {
  const writer = consoleWriterAvatar(currentUserAvatarUrl, currentUserName);
  // "Responder como": sem a escolha (quem usa o painel nao a passou), a resposta vai sem assinatura, como antes.
  const choice = author ?? null;
  const ready = choice ? answerAuthorReady(choice) : undefined;
  // Com "Outro nome" sem um nome valido, nada e enviado (o campo do nome mostra o porque).
  const authorBlocked = ready === null;
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

    if (authorBlocked) {
      return;
    }

    if (await whileSettling({ key: `reply:${question.id}`, set: setSettling, settling, work: () => onReply(question.id, text, ready ?? undefined) })) {
      setReplying((current) => replyDraftAfterSent(current, question.id));
    }
  }

  async function answer(question: WebinarQuestion) {
    const text = (answers[question.id] ?? "").trim();

    if (!text || authorBlocked) {
      return;
    }

    if (await onAnswer(question.id, text, false, ready ?? undefined)) {
      setAnswers((current) => ({ ...current, [question.id]: "" }));
    }
  }

  return (
    <div className="flex min-w-0 flex-col" data-console-questions-pane="" ref={paneRef}>
      {canAct && choice && onAuthor ? <AnswerAuthorPicker choice={choice} name={currentUserName} onChange={onAuthor} /> : null}
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
          // "Mostrar na tela" (docs/30 D89): a pergunta que a turma ve (a dispensada some para ela, entao nao vai).
          const onScreen = screenCommentQuestionId === question.id;
          const screenButton =
            canAct && onScreenComment && (question.status !== "dismissed" || onScreen) ? (
              <button
                className={roomPillClassName({ size: "s", tone: onScreen ? "tonal" : "text" })}
                data-console-screen-comment={onScreen ? "hide" : "show"}
                disabled={busy}
                onClick={() => onScreenComment(onScreen ? null : question.id)}
                type="button"
              >
                {onScreen ? WEBINAR_COPY.naTela.console.tirarDaTela : WEBINAR_COPY.naTela.console.mostrarNaTela}
              </button>
            ) : null;

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
                  {/* A pergunta simulada (D77): o selo so aqui, nunca na sala; o texto completo no title e no leitor de tela. */}
                  {question.simulated ? (
                    <span data-console-question-simulated="" title={PESSOAS.simuladaDica}>
                      <Chip tone="warning">{PESSOAS.simulada}</Chip>
                      <span className="sr-only"> {PESSOAS.simuladaDica}</span>
                    </span>
                  ) : null}
                  <span className="tabular-nums text-room-fg-subtle">{copy.votes(question.upvotes)}</span>
                  <Chip tone={STATUS_TONE[question.status]}>{question.answeredLive && question.status === "answered" ? copy.answerLive : copy.statuses[question.status]}</Chip>
                  {mark?.answerSource === "ai" ? <Chip>{WEBINAR_COPY.assistente.console.respondidaPeloAssistente}</Chip> : null}
                  {mark?.handoffRequested ? <Chip tone="warning">{WEBINAR_COPY.assistente.console.pediuEquipe}</Chip> : null}
                  {mark?.assignedName && question.status === "open" ? <Chip tone="success">{WEBINAR_COPY.assistente.console.assumida(mark.assignedName)}</Chip> : null}
                  {awaitsTeam ? <Chip tone="warning">{copy.newReply}</Chip> : null}
                  {onScreen ? (
                    <span data-console-question-on-screen="">
                      <Chip tone="success">{WEBINAR_COPY.naTela.console.seloComentarioNaTela}</Chip>
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm leading-5 break-words whitespace-pre-wrap text-room-fg">{question.body}</p>
                {question.answerText ? (
                  // Quem assinou (docs/30 D88), como a turma ve: com "Meu nome", a foto, o nome e o selo do papel; com
                  // "Outro nome", o nome; com "Equipe" (e a resposta de antes), so o icone da equipe.
                  <div className="mt-3 flex min-w-0 gap-3" data-console-answer="" data-console-answer-as={mark?.answerSource === "ai" ? undefined : (question.answerAuthor?.as ?? "team")}>
                    {mark?.answerSource !== "ai" && question.answerAuthor?.as === "self" ? (
                      <RoomCommentAvatar imageSrc={question.answerAuthorAvatarUrl ?? null} kind="person" name={question.answerAuthor.name ?? undefined} />
                    ) : (
                      <RoomCommentAvatar kind="team" />
                    )}
                    <div className="min-w-0 flex-1">
                      {mark?.answerSource !== "ai" && question.answerAuthor && question.answerAuthor.as !== "team" && question.answerAuthor.name ? (
                        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-[18px]">
                          <span className="truncate font-medium text-room-fg">{question.answerAuthor.name}</span>
                          {question.answerAuthor.as === "self" ? <Chip>{chatRoleLabel(question.answerAuthor.role) ?? ""}</Chip> : null}
                        </p>
                      ) : null}
                      <p className="text-sm leading-5 break-words whitespace-pre-wrap text-room-fg-muted">{question.answerText}</p>
                    </div>
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
                      avatar={<RoomCommentAvatar imageSrc={writer.imageSrc} kind={writer.kind} name={writer.name ?? undefined} />}
                      busy={busy || authorBlocked || settling.includes(`reply:${question.id}`)}
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
                      <button className={roomPillClassName({ size: "s", tone: "white" })} disabled={busy || authorBlocked || !draft.trim()} onClick={() => void answer(question)} type="button">
                        {copy.answerWritten}
                      </button>
                      <button className={roomPillClassName({ size: "s", tone: "tonal" })} disabled={busy} onClick={() => void onAnswer(question.id, "", true)} type="button">
                        {copy.answerLive}
                      </button>
                      <button className={roomPillClassName({ size: "s", tone: "text" })} disabled={busy} onClick={() => onStatus(question.id, "dismissed")} type="button">
                        {copy.dismiss}
                      </button>
                      {screenButton}
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
                    {screenButton}
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

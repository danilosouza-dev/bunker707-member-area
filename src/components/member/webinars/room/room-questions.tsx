"use client";

import { ListSortDescending, ThumbsUp } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { chatAgoLabel, chatTimeAt, chatTimeLabel } from "@/lib/webinar-room-client";
import { ASSISTANT_WAIT_MS } from "@/server/webinars/assistant-model";
import { chatRoleLabel } from "@/lib/webinar-room-client";
import { CHAT_CONSENT_VERSION, CHAT_LIMITS, QUESTION_REPLY_LIMITS, type AnswerSource } from "@/server/webinars/model";
import { AssistantHandoff } from "./assistant/assistant-handoff";
import { AssistantHint } from "./assistant/assistant-hint";
import { ownAssistantEnabled, useRoomAssistant, type RoomAssistant } from "./assistant/use-room-assistant";
import { getQuestions, postQuestion, postQuestionReply, postQuestionVote, type QuestionPostBody, type QuestionReplyBody, type StudentQuestion, type StudentQuestionReply } from "./room-api";
import { RoomConsentBox } from "./room-chat";
import { RoomChip, RoomChipBar } from "./room-chip-bar";
import { RoomComment, RoomCommentAvatar, RoomCommentThread, RoomThreadItem, type RoomCommentTime } from "./room-comment";
import { RoomCommentField, RoomCommentFieldNotice } from "./room-comment-field";
import { composerExpandedStep } from "./room-composer-model";
import { menuOpenKey } from "./room-layout-model";
import { RoomMenu } from "./room-menu";
import { RoomPill } from "./room-pill";
import { RoomReplyField, returnFocusFromReply } from "./room-reply-field";
import { useRoomSnackbar } from "./room-snackbar";
import {
  QUESTIONS_FILTERS,
  QUESTIONS_ORDERS,
  questionsEmptyPhrase,
  questionsFilterLabel,
  questionsOrderLabel,
  questionsShown,
  questionStatusOf,
  questionReplyGone,
  questionReplyOpenStep,
  questionThreadCount,
  questionThreadOpen,
  type QuestionsFilter,
  type QuestionsOrder
} from "./room-questions-model";
import { RoomTooltip } from "./room-tooltip";
import { RoomBadge, RoomButton, RoomIconButton } from "./room-ui";

// A aba Perguntas (docs/30 §1.3 e D22): Fazer uma pergunta (sempre com o nome: desde 10/11/2026, D64, nao ha mais a
// opcao Anonima), a lista com Curtir para subir a pergunta, a situacao (Respondida ao vivo / Respondida por escrito, com o texto /
// Dispensada, so para o autor), os filtros Todas / Respondidas e a ordem Mais votadas / Mais recentes. Le ao abrir
// e a cada 15 s enquanto aberta. Sem o aceite do chat (D10), a primeira pergunta abre o mesmo aceite do chat. Na live
// (fase 3), o silenciado no chat tambem nao pergunta: o campo da lugar a frase (`notice`); a recusa de uma escrita (409
// banned / muted) e contada a sala (`onRefused`), que troca pela frase de removido ou banido. Fase 4c (docs/30 §1.6,
// §6.6 e D24): a resposta do Assistente aparece com o selo Assistente e, na pergunta do proprio aluno, "Falar com a
// equipe"; depois de perguntar, "O Assistente esta respondendo..." (com ele ligado e sem atendente para a pergunta)
// ate a resposta chegar, ou "A equipe responde depois pelo sino" quando ninguem esta atendendo. Redesign V2, F2
// (docs/31 V2-11): as cores vem dos tokens do tema da sala.
// A sala no estilo do YouTube (docs/31; spec §7.3): com `look="comment"` (o desenho normal), a partir de lg os filtros
// viram uma linha so de chips (Todas, Sem resposta, Respondidas, Minhas; RoomChipBar) e a ordem vai para o botao de
// ordenar do cabecalho do painel (RoomQuestionsOrderButton, com o menu); o vazio diz o filtro. O filtro e a ordem sao
// da sala (trocar de aba nao os perde), e o numero do cabecalho e o tamanho da lista com o filtro de agora (onCount,
// so depois da primeira leitura). Abaixo de lg ficam as duas linhas de antes. Sem as props (a gaveta do vertical), o
// filtro e a ordem sao da aba e o HTML e o de antes. Y10 (spec §8.4): no `comment` cada pergunta e o comentario do
// YouTube (RoomComment: "Você" na minha, o tempo relativo contra o agora do servidor; legado: a pergunta anonima de
// antes de 10/11/2026 continua "Anônima" com a mascara), com o
// polegar e o numero, a situacao (Respondida ao vivo, Dispensada) na linha de acoes e a resposta escrita da Equipe ou do
// Assistente no fio "1 resposta", aberto na minha e fechado nas outras, com a hora da resposta (V2-A66). Sem cartao.
// O fio continua (decisao do produtor de 10/11/2026, docs/30 §1.3): na minha pergunta ja respondida, o "Responder" da
// linha de acoes abre o campo de resposta no fim do fio (RoomReplyField); o que eu escrevo e o que a equipe responde
// depois entram no fio em ordem, cada um como um comentario (a foto ou as iniciais, o nome, o selo do papel da equipe e
// a hora), e o botao do fio conta todas ("3 respostas"). Os outros alunos leem o fio; so quem perguntou e a equipe
// escrevem nele. O "Responder" de cima, clicado de novo na pergunta com o campo aberto, nao apaga o que foi escrito
// (questionReplyOpenStep); o botao do fio com o campo aberto fecha o campo junto; o campo fecha, com a frase embaixo do
// campo principal, quando a pergunta deixa de aceitar a resposta (questionReplyGone); e, quando o campo sai com o foco
// nele, o foco volta ao Responder da pergunta (returnFocusFromReply).

const REFRESH_MS = 15_000;

/** O id do menu de ordenar (o aria-controls do botao do cabecalho). */
export const QUESTIONS_ORDER_MENU_ID = "room-questions-order";

/** A pergunta como a rota devolve na fase 4c: de quem e a resposta e se o aluno ja pediu a equipe. */
export type RoomQuestion = StudentQuestion & { answerSource?: AnswerSource | null; handoffRequested?: boolean };

/** O tempo do comentario e da resposta: "há 2 minutos" contra o agora do servidor, a hora exata no title. */
function questionTime(iso: string | null | undefined, serverNowMs: number | undefined): RoomCommentTime | null {
  if (!iso || serverNowMs === undefined) {
    return null;
  }
  const input = { kind: "live" as const, offsetMs: 0, sentAt: iso };
  const at = chatTimeAt(input);
  const label = chatAgoLabel({ ...input, nowMs: serverNowMs });
  return at === null || !label ? null : { iso: new Date(at).toISOString(), label, title: chatTimeLabel(input) };
}

/** O campo de responder do fio, que a aba controla (uma pergunta por vez). */
export type RoomQuestionReplyControl = {
  /** O meu avatar no campo (a foto ou as iniciais; a pessoa antes do aceite). */
  avatar: { imageSrc?: string | null; name: string | null };
  busy: boolean;
  /** A sala aceita escrita agora (fora do "ver como", sem a frase no lugar do campo, sessao no ar). */
  canWrite: boolean;
  draft: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onOpen: (questionId: string) => void;
  onSubmit: () => void;
  /** A pergunta com o campo aberto. */
  openId: string | null;
  status: string | null;
};

type RoomQuestionItemProps = {
  /** O "Falar com a equipe" da resposta do Assistente na minha pergunta. */
  footer?: ReactNode;
  /** "comment": o comentario do YouTube com o fio (a sala); "classic": o cartao de antes (a gaveta do vertical). */
  look?: "classic" | "comment";
  onToggleThread?: (questionId: string) => void;
  onVote: (question: RoomQuestion) => void;
  question: RoomQuestion;
  /** O campo de responder do fio (so no `comment`); sem ele, o fio e so de leitura. */
  reply?: RoomQuestionReplyControl | null;
  /** O agora do servidor (o relogio da sala com o skew), para o tempo relativo. */
  serverNowMs?: number;
  /** O fio aberto (questionThreadOpen). */
  threadOpen?: boolean;
};

/**
 * Uma resposta do fio (depois da primeira): quem perguntou ("Você" na minha) ou a equipe, com o selo do papel. Legado:
 * linhas de antes de 10/11/2026 (D64). Na pergunta anonima antiga, a resposta de quem perguntou continua como
 * "Anônima", com a mascara e sem foto.
 */
function RoomQuestionReplyComment({ reply, serverNowMs }: { reply: StudentQuestionReply; serverNowMs?: number }) {
  const sala = WEBINAR_COPY.sala;
  const novas = WEBINAR_COPY.salaV2;
  const role = reply.role === "student" ? null : chatRoleLabel(reply.role);
  const name = reply.anonymous ? sala.anonima : reply.mine ? novas.chat.voce : reply.displayName;
  const time = questionTime(reply.createdAt, serverNowMs);
  return (
    <RoomComment
      as="div"
      avatar={<RoomCommentAvatar imageSrc={reply.avatarUrl} kind={reply.anonymous ? "anonymous" : "person"} name={reply.displayName} />}
      body={reply.body}
      id={reply.id}
      marker="reply"
      meta={{ name, role, time }}
      mine={reply.mine}
      srAuthor={novas.chat.autor([name, role, time?.label].filter((part): part is string => Boolean(part)))}
    />
  );
}

/** A pergunta como o comentario do YouTube: o polegar com o numero, a situacao, o Responder (na minha) e o fio. */
function RoomQuestionComment({ footer, onToggleThread, onVote, question, reply = null, serverNowMs, threadOpen = false }: Omit<RoomQuestionItemProps, "look">) {
  const sala = WEBINAR_COPY.sala;
  const novas = WEBINAR_COPY.salaV2;
  // Legado: linhas de antes de 10/11/2026 (D64). A pergunta anonima antiga continua "Anônima", com a mascara e sem foto.
  const name = question.anonymous ? sala.anonima : question.mine ? novas.chat.voce : question.displayName;
  const time = questionTime(question.createdAt, serverNowMs);
  const status = questionStatusOf(question);
  const ai = question.answerSource === "ai";
  const badge = ai ? sala.selos.assistente : sala.selos.equipe;
  const answerTime = questionTime(question.answeredAt, serverNowMs);
  const autor = (parts: Array<string | undefined>) => novas.chat.autor(parts.filter((part): part is string => Boolean(part)));
  const canReply = Boolean(reply?.canWrite) && question.canReply;
  const replying = canReply && reply?.openId === question.id;
  const count = questionThreadCount(question);
  // Com o campo aberto, o fio fica aberto (quem responde ve a conversa); o botao do fio fecha o campo junto.
  const expanded = threadOpen || replying;

  const items: ReactNode[] = [];
  if (question.status === "answered" && question.answerText?.trim()) {
    items.push(
      <RoomComment
        actions={footer}
        as="div"
        avatar={<RoomCommentAvatar kind={ai ? "assistant" : "team"} />}
        body={question.answerText}
        id={question.id}
        key="answer"
        marker="answer"
        meta={{ name: badge, role: badge, time: answerTime }}
        srAuthor={autor([badge, answerTime?.label])}
      />
    );
  }
  if (question.status === "answered") {
    for (const item of question.replies ?? []) {
      items.push(<RoomQuestionReplyComment key={item.id} reply={item} serverNowMs={serverNowMs} />);
    }
  }
  const field =
    replying && reply ? (
      <RoomReplyField
        ariaLabel={novas.perguntas.suaResposta}
        avatar={<RoomCommentAvatar imageSrc={question.anonymous ? null : reply.avatar.imageSrc} kind={question.anonymous ? "anonymous" : "person"} name={reply.avatar.name ?? undefined} />}
        busy={reply.busy}
        maxLength={QUESTION_REPLY_LIMITS.studentBody}
        onCancel={reply.onCancel}
        onChange={reply.onChange}
        onSubmit={reply.onSubmit}
        placeholder={novas.perguntas.adicioneResposta}
        status={reply.status}
        submitLabel={novas.perguntas.responder}
        value={reply.draft}
      />
    ) : null;

  return (
    <RoomComment
      actions={
        <>
          <RoomPill
            aria-pressed={question.voted}
            className="max-lg:size-11"
            icon={ThumbsUp}
            iconFilled={question.voted}
            label={sala.curtir}
            onClick={() => onVote(question)}
            shape="circle"
            size="s"
            tone="text"
          />
          <span aria-hidden="true" className={cn("mr-2 text-xs leading-[18px] tabular-nums", question.voted ? "text-room-fg" : "text-room-fg-subtle")}>
            {question.upvotes.toLocaleString("pt-BR")}
          </span>
          <span className="sr-only">{sala.curtidas(question.upvotes)}</span>
          {status ? (
            <span className={cn("text-xs leading-[18px]", status === "live" ? "text-room-success-fg" : "text-room-fg-subtle")}>{status === "live" ? sala.respondidaAoVivo : sala.dispensada}</span>
          ) : null}
          {canReply ? (
            <RoomPill aria-expanded={replying} className="ml-1" data-room-reply-open="" label={novas.perguntas.responder} onClick={() => reply?.onOpen(question.id)} size="s" tone="text" touch44 />
          ) : null}
        </>
      }
      avatar={<RoomCommentAvatar imageSrc={question.avatarUrl} kind={question.anonymous ? "anonymous" : "person"} name={question.displayName} />}
      body={question.body}
      id={question.id}
      marker="question"
      meta={{ name, role: null, time }}
      mine={question.mine}
      srAuthor={autor([name, time?.label])}
      thread={
        count > 0 ? (
          <RoomCommentThread
            answerTestId={ai ? "question-answer-assistant" : undefined}
            controlsId={`resposta-${question.id}`}
            expanded={expanded}
            label={expanded ? novas.perguntas.ocultarRespostas : novas.perguntas.respostas(count)}
            onToggle={() => {
              if (replying) {
                // Com o campo aberto o fio nao fecha sozinho: o clique fecha o campo junto. Se o fio so estava aberto por
                // causa do campo (o aluno ja tinha ocultado), fechar o campo basta; trocar o guardado o reabriria.
                reply?.onCancel();
                if (!threadOpen) {
                  return;
                }
              }
              onToggleThread?.(question.id);
            }}
          >
            {items.map((item, index) => (index === 0 ? item : <RoomThreadItem key={`item-${index}`}>{item}</RoomThreadItem>))}
            {field ? <RoomThreadItem>{field}</RoomThreadItem> : null}
          </RoomCommentThread>
        ) : field ? (
          // Respondida so ao vivo, sem nada escrito ainda: o campo logo abaixo da pergunta, alinhado ao texto dela.
          <div className="ml-9 mt-3">{field}</div>
        ) : null
      }
    />
  );
}

export function RoomQuestionItem({ footer = null, look = "classic", onToggleThread, onVote, question, reply = null, serverNowMs, threadOpen }: RoomQuestionItemProps) {
  const copy = WEBINAR_COPY.sala;
  if (look === "comment") {
    return <RoomQuestionComment footer={footer} onToggleThread={onToggleThread} onVote={onVote} question={question} reply={reply} serverNowMs={serverNowMs} threadOpen={threadOpen} />;
  }

  return (
    <li className="rounded-[12px] border border-room-border bg-room-surface-2 p-3" data-room-question={question.id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-room-fg-subtle">{question.anonymous ? copy.anonima : question.displayName}</p>
          <p className="mt-0.5 whitespace-pre-line break-words text-sm leading-5 text-room-fg-strong">{question.body}</p>
        </div>
        <button
          aria-label={question.voted ? copy.descurtir : copy.curtir}
          aria-pressed={question.voted}
          className={cn(
            "flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-full border px-2.5 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-focus motion-reduce:transition-none",
            question.voted ? "border-room-active-bg bg-room-active-bg text-room-active-fg" : "border-room-input-border text-room-fg hover:border-room-fg-subtle"
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
          <div className="flex flex-wrap items-center gap-1.5">
            <RoomBadge tone="success">{question.answeredLive ? copy.respondidaAoVivo : copy.respondidaPorEscrito}</RoomBadge>
            {question.answerSource === "ai" ? (
              <span className="inline-flex" data-testid="question-answer-assistant">
                <RoomBadge tone="outline">{copy.selos.assistente}</RoomBadge>
              </span>
            ) : null}
          </div>
          {question.answerText ? (
            <p className="mt-1.5 whitespace-pre-line text-sm leading-5 text-room-fg">
              {question.answerSource === "ai" ? <span className="sr-only">{`${copy.selos.assistente}: `}</span> : null}
              {question.answerText}
            </p>
          ) : null}
          {footer}
        </div>
      ) : null}
      {question.status === "dismissed" ? (
        <div className="mt-2">
          <RoomBadge tone="muted">{copy.dispensada}</RoomBadge>
        </div>
      ) : null}
    </li>
  );
}

/**
 * A lista das Perguntas no `comment` (Y10): sem cartao, 16 px dos lados e entre as perguntas. O fio aberto e o padrao
 * (aberto na minha) trocado pelos cliques do aluno, guardados aqui por id (questionThreadOpen).
 */
export function RoomQuestionList({
  emptyPhrase,
  footerFor,
  onVote,
  questions,
  reply = null,
  serverNowMs
}: {
  emptyPhrase: string;
  footerFor: (question: RoomQuestion) => ReactNode;
  onVote: (question: RoomQuestion) => void;
  questions: readonly RoomQuestion[];
  /** O campo de responder do fio (a aba controla); sem ele, os fios sao so de leitura. */
  reply?: RoomQuestionReplyControl | null;
  serverNowMs?: number;
}) {
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());

  function toggleThread(questionId: string) {
    setToggled((previous) => {
      const next = new Set(previous);
      if (!next.delete(questionId)) {
        next.add(questionId);
      }
      return next;
    });
  }

  return (
    <ul className="min-h-0 flex-1 overflow-y-auto px-4 pt-2">
      {questions.length === 0 ? <li className="mt-6 text-center text-sm leading-5 text-room-fg-subtle">{emptyPhrase}</li> : null}
      {questions.map((question) => (
        <RoomQuestionItem
          footer={footerFor(question)}
          key={question.id}
          look="comment"
          onToggleThread={toggleThread}
          onVote={onVote}
          question={question}
          reply={reply}
          serverNowMs={serverNowMs}
          threadOpen={questionThreadOpen(question, toggled)}
        />
      ))}
    </ul>
  );
}

/**
 * O ordenar das Perguntas no cabecalho do painel (a partir de lg): o circulo sem fundo com o ListSortDescending, a dica
 * "Ordenar perguntas" no lugar do title e o menu abaixo, alinhado a direita, com Mais votadas e Mais recentes. O Esc
 * fecha so o menu e devolve o foco ao botao (nunca chega a sala, que perguntaria se quer sair).
 */
export function RoomQuestionsOrderButton({ onOrder, order }: { onOrder: (order: QuestionsOrder) => void; order: QuestionsOrder }) {
  const copy = WEBINAR_COPY.salaV2.perguntas;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  /** Fecha e devolve o foco ao botao (no WebKit o toque nao foca o botao, e o foco cairia no body). */
  function close() {
    buttonRef.current?.focus();
    setOpen(false);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!open && menuOpenKey(event.key)) {
      // O Enter e o Espaco nao viram o clique (que fecharia o menu que acabou de abrir): o foco ja vai para a opcao.
      event.preventDefault();
      setOpen(true);
    }
  }

  return (
    <div className="relative">
      <RoomTooltip label={copy.ordenar} side="below">
        <RoomIconButton
          aria-controls={QUESTIONS_ORDER_MENU_ID}
          aria-expanded={open}
          aria-haspopup="menu"
          className="[&_svg]:size-6"
          label={copy.ordenar}
          onClick={() => (open ? close() : setOpen(true))}
          onKeyDown={onKeyDown}
          ref={buttonRef}
          size={40}
          tone="ghost"
          withTitle={false}
        >
          <ListSortDescending aria-hidden="true" strokeWidth={1.75} />
        </RoomIconButton>
      </RoomTooltip>
      <RoomMenu
        align="end"
        groups={[
          {
            items: QUESTIONS_ORDERS.map((value) => ({ checked: value === order, key: value, label: questionsOrderLabel(value), onSelect: () => onOrder(value), radio: true }))
          }
        ]}
        id={QUESTIONS_ORDER_MENU_ID}
        label={copy.ordenar}
        onClose={() => setOpen(false)}
        open={open}
        placement="below"
        triggerRef={buttonRef}
      />
    </div>
  );
}

export function RoomQuestionsTab({
  assistant: sharedAssistant,
  avatarUrl = null,
  consented,
  displayName,
  enabled,
  ended = false,
  filter: filterProp,
  getOffsetMs,
  look = "classic",
  notice = null,
  onConsented,
  onCount,
  onFilter,
  onOrder,
  onRefused,
  order: orderProp,
  readOnly,
  serverNowMs,
  sessionId,
  webinarId
}: {
  /** Redesign V2, F3: o Assistente que a sala ja le; com ele, a aba nao le de novo. */
  assistant?: RoomAssistant;
  /** A minha foto do perfil (o avatar do campo no `comment`, depois do aceite). */
  avatarUrl?: string | null;
  consented: boolean;
  /** O meu nome (as iniciais do avatar do campo no `comment`); antes do aceite, a pessoa. */
  displayName?: string | null;
  enabled: boolean;
  /** A sessao acabou: no `comment`, "Essa live acabou." no lugar do campo. */
  ended?: boolean;
  /** O filtro, quando e da sala (o desenho normal); sem ele, o filtro e da aba (a gaveta do vertical). */
  filter?: QuestionsFilter;
  getOffsetMs: () => number;
  /** "comment": os chips a partir de lg (o desenho normal); "classic": as duas linhas de antes (a gaveta do vertical). */
  look?: "classic" | "comment";
  /** Fase 3: a frase que toma o lugar do campo (silenciado no chat, sala que ainda nao abriu). */
  notice?: string | null;
  /** O aceite foi gravado junto da pergunta: a sala relê a sessao para o chat saber. */
  onConsented: () => void;
  /** O tamanho da lista com o filtro de agora (o numero do cabecalho), depois da primeira leitura. */
  onCount?: (count: number) => void;
  onFilter?: (filter: QuestionsFilter) => void;
  onOrder?: (order: QuestionsOrder) => void;
  /** Fase 3: uma escrita recusada (409 banned / muted) e contada a sala. */
  onRefused?: (error: unknown) => void;
  /** A ordem, quando e da sala; sem ela, a ordem e da aba. */
  order?: QuestionsOrder;
  readOnly: boolean;
  /** O agora do servidor (o relogio da sala com o skew), para o tempo das perguntas no `comment`. */
  serverNowMs?: number;
  sessionId: string;
  webinarId: string;
}) {
  const copy = WEBINAR_COPY.sala;
  const ownAssistant = useRoomAssistant({ enabled: ownAssistantEnabled({ enabled, readOnly, shared: sharedAssistant }), sessionId, webinarId });
  const assistant = sharedAssistant ?? ownAssistant;
  const [questions, setQuestions] = useState<RoomQuestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [ownFilter, setOwnFilter] = useState<QuestionsFilter>("all");
  const [ownOrder, setOwnOrder] = useState<QuestionsOrder>("votadas");
  const filter = filterProp ?? ownFilter;
  const order = orderProp ?? ownOrder;
  const setFilter = onFilter ?? setOwnFilter;
  const setOrder = onOrder ?? setOwnOrder;
  const [draft, setDraft] = useState("");
  // O campo do YouTube aberto (no comentario): liga no foco, desliga no Cancelar e depois do envio.
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  // O fio (docs/30 §1.3): a pergunta com o campo de responder aberto, o rascunho, o envio e o erro; o aceite pedido por
  // uma resposta (e nao por uma pergunta nova) volta para a resposta.
  const [replyOpenId, setReplyOpenId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyStatus, setReplyStatus] = useState<string | null>(null);
  const [replySending, setReplySending] = useState(false);
  const [consentFor, setConsentFor] = useState<"question" | "reply">("question");
  // O campo de responder saiu com o foco nele (Esc, Cancelar, o envio): o foco volta ao Responder da pergunta.
  const tabRef = useRef<HTMLDivElement | null>(null);
  const replyWasOpenRef = useRef(replyOpenId);
  useLayoutEffect(() => {
    const was = replyWasOpenRef.current;
    replyWasOpenRef.current = replyOpenId;
    if (was && !replyOpenId) {
      returnFocusFromReply(tabRef.current, document.activeElement, document.body, `[data-room-question="${was}"] [data-room-reply-open]`);
    }
  }, [replyOpenId]);
  // No comentario, "Pergunta enviada." vai ao aviso da sala (o erro e a instrucao do aceite continuam embaixo do campo);
  // a gaveta do vertical segue com a frase. A faixa do campo diz a altura dela, para o aviso ficar acima (abaixo de lg).
  const snackbar = useRoomSnackbar();
  const roomSnackbar = look === "comment" ? snackbar : null;
  const onFieldHeight = useCallback((px: number) => roomSnackbar?.composer("questions", px), [roomSnackbar]);
  /** O sucesso do envio: no aviso da sala, ou na frase de hoje. */
  const sent = (text: string) => {
    if (roomSnackbar) {
      roomSnackbar.show({ key: "question_sent", text });
    } else {
      setStatus(text);
    }
  };

  const load = useCallback(async () => {
    try {
      const answer = await getQuestions(webinarId, sessionId, order);
      setQuestions(answer.data.questions as RoomQuestion[]);
      setLoaded(true);
    } catch {
      // A proxima leitura vem em 15 s.
    }
  }, [order, sessionId, webinarId]);

  // Fase 4c: o "respondendo" dura no maximo o teto do Assistente e a folga do chat.
  useEffect(() => {
    if (!waiting) {
      return;
    }
    const id = window.setTimeout(() => setWaiting(null), ASSISTANT_WAIT_MS);
    return () => window.clearTimeout(id);
  }, [waiting]);

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

  /** A pergunta; `accepting` quando o aluno acabou de aceitar (o aceite vai junto: consent + versao). */
  async function deliver(accepting = false) {
    const text = draft.trim();
    if (!text || readOnly) {
      return;
    }
    setSending(true);
    setStatus(null);
    const consent: Partial<QuestionPostBody> = accepting ? { consent: true, consentVersion: CHAT_CONSENT_VERSION } : {};
    try {
      const answer = await postQuestion(webinarId, { ...consent, body: text, offsetMs: Math.round(getOffsetMs()), sessionId });
      setQuestions((previous) => [answer.question, ...previous.filter((question) => question.id !== answer.question.id)]);
      setDraft("");
      setExpanded((previous) => composerExpandedStep(previous, { draft: "", type: "sent" }));
      // Fase 4c: o Assistente responde (ligado, e sem atendente quando nao ha "Responder tudo"); senao, sem ninguem
      // atendendo, a equipe responde depois pelo sino.
      const { attendantsOnline, enabled: assistantOn, replyAll } = assistant.state;
      if (assistantOn && (replyAll || attendantsOnline === 0)) {
        setWaiting(answer.question.id);
        sent(copy.perguntaEnviada);
      } else {
        setWaiting(null);
        sent(attendantsOnline === 0 && !assistantOn ? `${copy.perguntaEnviada} ${WEBINAR_COPY.assistente.aluno.equipeRespondeDepois}` : copy.perguntaEnviada);
      }
      setConsentOpen(false);
      if (accepting) {
        onConsented();
      }
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : copy.erroEnviar);
      onRefused?.(failure);
    } finally {
      setSending(false);
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    // Com o envio em andamento, o Ctrl+Enter de novo nao manda a mesma pergunta outra vez.
    if (!draft.trim() || readOnly || sending) {
      return;
    }
    if (!consented) {
      setConsentFor("question");
      setConsentOpen(true);
      setStatus(copy.aceiteParaPerguntar);
      return;
    }
    void deliver();
  }

  function closeReply() {
    setReplyOpenId(null);
    setReplyDraft("");
    setReplyStatus(null);
    if (consentFor === "reply") {
      setConsentOpen(false);
    }
  }

  /** A minha resposta no fio da minha pergunta (com o aceite, quando ele veio agora). */
  async function deliverReply(accepting = false) {
    const questionId = replyOpenId;
    const text = replyDraft.trim();
    if (!questionId || !text || readOnly) {
      return;
    }
    setReplySending(true);
    setReplyStatus(null);
    const consent: Partial<QuestionReplyBody> = accepting ? { consent: true, consentVersion: CHAT_CONSENT_VERSION } : {};
    try {
      const answer = await postQuestionReply(webinarId, questionId, { ...consent, body: text, sessionId });
      setQuestions((previous) =>
        previous.map((question) => (question.id === questionId ? { ...question, replies: [...(question.replies ?? []).filter((item) => item.id !== answer.reply.id), answer.reply] } : question))
      );
      setReplyOpenId(null);
      setReplyDraft("");
      setConsentOpen(false);
      sent(WEBINAR_COPY.salaV2.perguntas.respostaEnviada);
      if (accepting) {
        onConsented();
      }
    } catch (failure) {
      setReplyStatus(failure instanceof Error ? failure.message : copy.erroEnviar);
      onRefused?.(failure);
    } finally {
      setReplySending(false);
    }
  }

  function submitReply() {
    if (!replyDraft.trim() || readOnly || replySending) {
      return;
    }
    if (!consented) {
      setConsentFor("reply");
      setConsentOpen(true);
      setReplyStatus(WEBINAR_COPY.salaV2.perguntas.aceiteParaResponder);
      return;
    }
    void deliverReply();
  }

  async function vote(question: RoomQuestion) {
    if (readOnly) {
      return;
    }
    const optimistic = { ...question, upvotes: Math.max(0, question.upvotes + (question.voted ? -1 : 1)), voted: !question.voted };
    setQuestions((previous) => previous.map((item) => (item.id === question.id ? optimistic : item)));
    try {
      const answer = await postQuestionVote(webinarId, question.id, sessionId);
      setQuestions((previous) => previous.map((item) => (item.id === question.id ? { ...item, upvotes: answer.upvotes, voted: answer.voted } : item)));
    } catch (failure) {
      setQuestions((previous) => previous.map((item) => (item.id === question.id ? question : item)));
      onRefused?.(failure);
    }
  }

  /** O "Falar com a equipe" da resposta do Assistente na minha pergunta (fora do "ver como"). */
  function handoffFor(question: RoomQuestion): ReactNode {
    if (!question.mine || question.answerSource !== "ai" || readOnly) {
      return null;
    }
    return (
      <AssistantHandoff
        attendantsOnline={assistant.state.attendantsOnline}
        done={question.handoffRequested === true}
        onRequest={async () => {
          const requested = await assistant.handoff("question", question.id);
          if (requested) {
            setQuestions((previous) => previous.map((item) => (item.id === question.id ? { ...item, handoffRequested: true } : item)));
          }
          return requested;
        }}
      />
    );
  }

  // No comentario, a frase que toma o lugar do campo: o silenciado, a sala que nao abriu e a live que acabou.
  const fieldNotice = notice ?? (look === "comment" && ended ? copy.encerrada : null);
  // O campo de responder aberto numa pergunta que deixou de aceitar a resposta (reaberta, dispensada, apagada, o fio
  // cheio) ou numa sala que parou de aceitar escrita fecha aqui, no render (nunca num efeito), com a frase quando foi a
  // pergunta; sem isso ele sumiria calado e voltaria sozinho com o rascunho velho.
  const replyWritable = !readOnly && !fieldNotice;
  if (replyOpenId !== null && !replySending && (!replyWritable || questionReplyGone(questions, replyOpenId))) {
    closeReply();
    if (replyWritable) {
      setStatus(WEBINAR_COPY.salaV2.perguntas.respostaFechada);
    }
  }
  const visible = questionsShown(questions, filter);
  const waitedQuestion = waiting ? questions.find((question) => question.id === waiting) : null;
  const waitingNow = Boolean(waitedQuestion && waitedQuestion.status === "open");
  const visibleCount = visible.length;

  // O numero do cabecalho: so depois da primeira leitura, e a sala so pinta de novo quando ele muda.
  useEffect(() => {
    if (loaded) {
      onCount?.(visibleCount);
    }
  }, [loaded, onCount, visibleCount]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="room-questions" ref={tabRef}>
      {look === "comment" ? (
        <div className="hidden shrink-0 lg:block">
          <RoomChipBar label={WEBINAR_COPY.salaV2.perguntas.filtrar} role="group" selectedKey={filter} variant="panel">
            {QUESTIONS_FILTERS.map((value) => (
              <RoomChip as="toggle" key={value} onClick={() => setFilter(value)} selected={filter === value}>
                {questionsFilterLabel(value)}
              </RoomChip>
            ))}
          </RoomChipBar>
        </div>
      ) : null}
      <div className={cn("flex flex-wrap items-center gap-1.5 px-3 pt-2", look === "comment" ? "lg:hidden" : null)}>
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
      {look === "comment" ? (
        <RoomQuestionList
          emptyPhrase={questionsEmptyPhrase(filter)}
          footerFor={handoffFor}
          onVote={(item) => void vote(item)}
          questions={visible}
          reply={{
            avatar: { imageSrc: consented ? avatarUrl : null, name: consented ? (displayName ?? null) : null },
            busy: replySending,
            canWrite: replyWritable,
            draft: replyDraft,
            onCancel: closeReply,
            onChange: setReplyDraft,
            onOpen: (questionId) => {
              const next = questionReplyOpenStep({ draft: replyDraft, openId: replyOpenId, status: replyStatus }, questionId);
              setReplyOpenId(next.openId);
              setReplyDraft(next.draft);
              setReplyStatus(next.status);
            },
            onSubmit: submitReply,
            openId: replyOpenId,
            status: replyStatus
          }}
          serverNowMs={serverNowMs}
        />
      ) : (
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
          {visible.length === 0 ? <li className="py-6 text-center text-sm text-room-fg-subtle">{copy.semPerguntas}</li> : null}
          {visible.map((question) => (
            <RoomQuestionItem footer={handoffFor(question)} key={question.id} onVote={(item) => void vote(item)} question={question} />
          ))}
        </ul>
      )}
      {consentOpen && !consented && !fieldNotice ? (
        <RoomConsentBox
          busy={sending || replySending}
          onAccept={() => void (consentFor === "reply" ? deliverReply(true) : deliver(true))}
          onCancel={() => setConsentOpen(false)}
          variant={look === "comment" ? "card" : "classic"}
        />
      ) : null}
      {look === "comment" ? (
        fieldNotice ? (
          <RoomCommentFieldNotice testId="room-questions-notice">{fieldNotice}</RoomCommentFieldNotice>
        ) : (
          <RoomCommentField
            ariaLabel={copy.suaPergunta}
            avatar={{ imageSrc: consented ? avatarUrl : null, name: consented ? (displayName ?? null) : null }}
            busy={sending}
            disabled={readOnly}
            expanded={expanded}
            maxLength={CHAT_LIMITS.question}
            mode="mod-enter"
            onCancel={() => {
              setDraft("");
              setConsentOpen(false);
            }}
            onChange={setDraft}
            onExpandedChange={setExpanded}
            onHeightChange={onFieldHeight}
            onSubmit={() => submit()}
            placeholder={copy.fazerPergunta}
            status={
              <>
                <p aria-live="polite" className="mt-1 text-room-fg-subtle empty:mt-0">
                  {status ?? (readOnly ? WEBINAR_COPY.aluno.previaSemGravar : "")}
                </p>
                <AssistantHint className="mt-1 px-0 text-xs leading-[18px]" state={waitingNow ? "waiting" : "none"} />
              </>
            }
            submitLabel={WEBINAR_COPY.salaV2.perguntas.perguntar}
            value={draft}
          />
        )
      ) : notice ? (
        <p className="border-t border-room-border bg-room-composer px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-sm font-semibold text-room-warn-fg" data-testid="room-questions-notice" role="status">
          {notice}
        </p>
      ) : (
        <form className="border-t border-room-border bg-room-composer p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" onSubmit={submit}>
          {/* 16 px abaixo de lg, como o campo do chat: o Safari do iPhone da zoom no foco de um campo menor. */}
          <textarea
            aria-label={copy.suaPergunta}
            className="min-h-11 w-full resize-none rounded-[12px] border border-room-input-border bg-room-input-bg px-3 py-2.5 text-base text-room-fg outline-none placeholder:text-room-fg-subtle focus-visible:border-room-fg-subtle disabled:opacity-50 lg:text-sm"
            disabled={readOnly || sending}
            maxLength={CHAT_LIMITS.question}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={copy.fazerPergunta}
            rows={2}
            value={draft}
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <RoomButton disabled={readOnly || sending || !draft.trim()} size="sm" type="submit" variant="primary">
              {copy.fazerPergunta}
            </RoomButton>
          </div>
          <p aria-live="polite" className="mt-1 min-h-4 px-1 text-[11px] text-room-fg-subtle">
            {status ?? (readOnly ? WEBINAR_COPY.aluno.previaSemGravar : "")}
          </p>
          <AssistantHint state={waitingNow ? "waiting" : "none"} />
        </form>
      )}
    </div>
  );
}

function pillClassName(active: boolean) {
  return cn(
    "h-8 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-room-focus motion-reduce:transition-none",
    active ? "border-room-active-bg bg-room-active-bg text-room-active-fg" : "border-room-input-border text-room-fg-muted hover:border-room-fg-subtle"
  );
}

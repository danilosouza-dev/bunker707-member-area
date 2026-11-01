"use client";

import { ListSortDescending, ThumbsUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { chatAgoLabel, chatTimeAt, chatTimeLabel } from "@/lib/webinar-room-client";
import { ASSISTANT_WAIT_MS } from "@/server/webinars/assistant-model";
import { CHAT_CONSENT_VERSION, CHAT_LIMITS, type AnswerSource, type DisplayNameMode } from "@/server/webinars/model";
import { AssistantHandoff } from "./assistant/assistant-handoff";
import { AssistantHint } from "./assistant/assistant-hint";
import { ownAssistantEnabled, useRoomAssistant, type RoomAssistant } from "./assistant/use-room-assistant";
import { getQuestions, postQuestion, postQuestionVote, type QuestionPostBody, type StudentQuestion } from "./room-api";
import { RoomConsentBox, type ConsentChoice } from "./room-chat";
import { RoomChip, RoomChipBar } from "./room-chip-bar";
import { RoomComment, RoomCommentAvatar, RoomCommentThread, type RoomCommentTime } from "./room-comment";
import { menuOpenKey } from "./room-layout-model";
import { RoomMenu } from "./room-menu";
import { RoomPill } from "./room-pill";
import {
  QUESTIONS_FILTERS,
  QUESTIONS_ORDERS,
  questionsEmptyPhrase,
  questionsFilterLabel,
  questionsOrderLabel,
  questionsShown,
  questionHasThread,
  questionStatusOf,
  questionThreadOpen,
  type QuestionsFilter,
  type QuestionsOrder
} from "./room-questions-model";
import { RoomTooltip } from "./room-tooltip";
import { RoomBadge, RoomButton, RoomIconButton } from "./room-ui";

// A aba Perguntas (docs/30 §1.3 e D22): Fazer uma pergunta (opcao Anonima so quando a equipe deixou ligada), a
// lista com Curtir para subir a pergunta, a situacao (Respondida ao vivo / Respondida por escrito, com o texto /
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
// YouTube (RoomComment: "Anônima" com a mascara, "Você" na minha, o tempo relativo contra o agora do servidor), com o
// polegar e o numero, a situacao (Respondida ao vivo, Dispensada) na linha de acoes e a resposta escrita da Equipe ou do
// Assistente no fio "1 resposta", aberto na minha e fechado nas outras, com a hora da resposta (V2-A66). Sem cartao.

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

type RoomQuestionItemProps = {
  /** O "Falar com a equipe" da resposta do Assistente na minha pergunta. */
  footer?: ReactNode;
  /** "comment": o comentario do YouTube com o fio (a sala); "classic": o cartao de antes (a gaveta do vertical). */
  look?: "classic" | "comment";
  onToggleThread?: (questionId: string) => void;
  onVote: (question: RoomQuestion) => void;
  question: RoomQuestion;
  /** O agora do servidor (o relogio da sala com o skew), para o tempo relativo. */
  serverNowMs?: number;
  /** O fio aberto (questionThreadOpen). */
  threadOpen?: boolean;
};

/** A pergunta como o comentario do YouTube: o polegar com o numero, a situacao e o fio "1 resposta". */
function RoomQuestionComment({ footer, onToggleThread, onVote, question, serverNowMs, threadOpen = false }: Omit<RoomQuestionItemProps, "look">) {
  const sala = WEBINAR_COPY.sala;
  const novas = WEBINAR_COPY.salaV2;
  const name = question.anonymous ? sala.anonima : question.mine ? novas.chat.voce : question.displayName;
  const time = questionTime(question.createdAt, serverNowMs);
  const status = questionStatusOf(question);
  const ai = question.answerSource === "ai";
  const badge = ai ? sala.selos.assistente : sala.selos.equipe;
  const answerTime = questionTime(question.answeredAt, serverNowMs);
  const autor = (parts: Array<string | undefined>) => novas.chat.autor(parts.filter((part): part is string => Boolean(part)));

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
        </>
      }
      avatar={<RoomCommentAvatar kind={question.anonymous ? "anonymous" : "person"} name={question.displayName} />}
      body={question.body}
      id={question.id}
      marker="question"
      meta={{ name, role: null, time }}
      mine={question.mine}
      srAuthor={autor([name, time?.label])}
      thread={
        questionHasThread(question) ? (
          <RoomCommentThread
            answerTestId={ai ? "question-answer-assistant" : undefined}
            controlsId={`resposta-${question.id}`}
            expanded={threadOpen}
            label={novas.perguntas.respostas(1)}
            onToggle={() => onToggleThread?.(question.id)}
          >
            <RoomComment
              actions={footer}
              as="div"
              avatar={<RoomCommentAvatar kind={ai ? "assistant" : "team"} />}
              body={question.answerText}
              id={question.id}
              marker="answer"
              meta={{ name: badge, role: badge, time: answerTime }}
              srAuthor={autor([badge, answerTime?.label])}
            />
          </RoomCommentThread>
        ) : null
      }
    />
  );
}

export function RoomQuestionItem({ footer = null, look = "classic", onToggleThread, onVote, question, serverNowMs, threadOpen }: RoomQuestionItemProps) {
  const copy = WEBINAR_COPY.sala;
  if (look === "comment") {
    return <RoomQuestionComment footer={footer} onToggleThread={onToggleThread} onVote={onVote} question={question} serverNowMs={serverNowMs} threadOpen={threadOpen} />;
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
  serverNowMs
}: {
  emptyPhrase: string;
  footerFor: (question: RoomQuestion) => ReactNode;
  onVote: (question: RoomQuestion) => void;
  questions: readonly RoomQuestion[];
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
  allowAnonymous,
  assistant: sharedAssistant,
  consented,
  defaultDisplayMode,
  enabled,
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
  allowAnonymous: boolean;
  /** Redesign V2, F3: o Assistente que a sala ja le; com ele, a aba nao le de novo. */
  assistant?: RoomAssistant;
  consented: boolean;
  defaultDisplayMode: DisplayNameMode;
  enabled: boolean;
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
  const [anonymous, setAnonymous] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);

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

  async function deliver(choice?: ConsentChoice) {
    const text = draft.trim();
    if (!text || readOnly) {
      return;
    }
    setSending(true);
    setStatus(null);
    const consent: Partial<QuestionPostBody> = choice
      ? { consent: true, consentVersion: CHAT_CONSENT_VERSION, displayMode: choice.displayMode, ...(choice.displayMode === "nickname" ? { nickname: choice.nickname } : {}) }
      : {};
    try {
      const answer = await postQuestion(webinarId, { ...consent, anonymous: allowAnonymous && anonymous, body: text, offsetMs: Math.round(getOffsetMs()), sessionId });
      setQuestions((previous) => [answer.question, ...previous.filter((question) => question.id !== answer.question.id)]);
      setDraft("");
      // Fase 4c: o Assistente responde (ligado, e sem atendente quando nao ha "Responder tudo"); senao, sem ninguem
      // atendendo, a equipe responde depois pelo sino.
      const { attendantsOnline, enabled: assistantOn, replyAll } = assistant.state;
      if (assistantOn && (replyAll || attendantsOnline === 0)) {
        setWaiting(answer.question.id);
        setStatus(copy.perguntaEnviada);
      } else {
        setWaiting(null);
        setStatus(attendantsOnline === 0 && !assistantOn ? `${copy.perguntaEnviada} ${WEBINAR_COPY.assistente.aluno.equipeRespondeDepois}` : copy.perguntaEnviada);
      }
      setConsentOpen(false);
      if (choice) {
        onConsented();
      }
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : copy.erroEnviar);
      onRefused?.(failure);
    } finally {
      setSending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || readOnly) {
      return;
    }
    if (!consented) {
      setConsentOpen(true);
      setStatus(copy.aceiteParaPerguntar);
      return;
    }
    void deliver();
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
    <div className="flex min-h-0 flex-1 flex-col" data-testid="room-questions">
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
        <RoomQuestionList emptyPhrase={questionsEmptyPhrase(filter)} footerFor={handoffFor} onVote={(item) => void vote(item)} questions={visible} serverNowMs={serverNowMs} />
      ) : (
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
          {visible.length === 0 ? <li className="py-6 text-center text-sm text-room-fg-subtle">{copy.semPerguntas}</li> : null}
          {visible.map((question) => (
            <RoomQuestionItem footer={handoffFor(question)} key={question.id} onVote={(item) => void vote(item)} question={question} />
          ))}
        </ul>
      )}
      {consentOpen && !consented && !notice ? <RoomConsentBox busy={sending} defaultDisplayMode={defaultDisplayMode} onAccept={(choice) => void deliver(choice)} onCancel={() => setConsentOpen(false)} /> : null}
      {notice ? (
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
          <div className="mt-2 flex items-center justify-between gap-2">
            {allowAnonymous ? (
              <label className="inline-flex min-h-8 items-center gap-2 text-xs text-room-fg-muted">
                <input checked={anonymous} className="accent-room-active-bg" onChange={(event) => setAnonymous(event.target.checked)} type="checkbox" />
                {copy.anonima}
              </label>
            ) : (
              <span />
            )}
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

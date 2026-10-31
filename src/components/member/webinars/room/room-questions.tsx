"use client";

import { ThumbsUp } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { ASSISTANT_WAIT_MS } from "@/server/webinars/assistant-model";
import { CHAT_CONSENT_VERSION, CHAT_LIMITS, type AnswerSource, type DisplayNameMode } from "@/server/webinars/model";
import { AssistantHandoff } from "./assistant/assistant-handoff";
import { AssistantHint } from "./assistant/assistant-hint";
import { useRoomAssistant } from "./assistant/use-room-assistant";
import { getQuestions, postQuestion, postQuestionVote, type QuestionPostBody, type StudentQuestion } from "./room-api";
import { RoomConsentBox, type ConsentChoice } from "./room-chat";
import { RoomBadge, RoomButton } from "./room-ui";

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

const REFRESH_MS = 15_000;

/** A pergunta como a rota devolve na fase 4c: de quem e a resposta e se o aluno ja pediu a equipe. */
export type RoomQuestion = StudentQuestion & { answerSource?: AnswerSource | null; handoffRequested?: boolean };

export function RoomQuestionItem({ footer = null, onVote, question }: { footer?: ReactNode; onVote: (question: RoomQuestion) => void; question: RoomQuestion }) {
  const copy = WEBINAR_COPY.sala;

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

export function RoomQuestionsTab({
  allowAnonymous,
  consented,
  defaultDisplayMode,
  enabled,
  getOffsetMs,
  notice = null,
  onConsented,
  onRefused,
  readOnly,
  sessionId,
  webinarId
}: {
  allowAnonymous: boolean;
  consented: boolean;
  defaultDisplayMode: DisplayNameMode;
  enabled: boolean;
  getOffsetMs: () => number;
  /** Fase 3: a frase que toma o lugar do campo (silenciado no chat, sala que ainda nao abriu). */
  notice?: string | null;
  /** O aceite foi gravado junto da pergunta: a sala relê a sessao para o chat saber. */
  onConsented: () => void;
  /** Fase 3: uma escrita recusada (409 banned / muted) e contada a sala. */
  onRefused?: (error: unknown) => void;
  readOnly: boolean;
  sessionId: string;
  webinarId: string;
}) {
  const copy = WEBINAR_COPY.sala;
  const assistant = useRoomAssistant({ enabled: enabled && !readOnly, sessionId, webinarId });
  const [questions, setQuestions] = useState<RoomQuestion[]>([]);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [filter, setFilter] = useState<"answered" | "all">("all");
  const [order, setOrder] = useState<"recentes" | "votadas">("votadas");
  const [draft, setDraft] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const answer = await getQuestions(webinarId, sessionId, order);
      setQuestions(answer.data.questions as RoomQuestion[]);
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

  const visible = filter === "answered" ? questions.filter((question) => question.status === "answered") : questions;
  const waitedQuestion = waiting ? questions.find((question) => question.id === waiting) : null;
  const waitingNow = Boolean(waitedQuestion && waitedQuestion.status === "open");

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
        {visible.length === 0 ? <li className="py-6 text-center text-sm text-room-fg-subtle">{copy.semPerguntas}</li> : null}
        {visible.map((question) => (
          <RoomQuestionItem
            footer={
              question.mine && question.answerSource === "ai" && !readOnly ? (
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
              ) : null
            }
            key={question.id}
            onVote={(item) => void vote(item)}
            question={question}
          />
        ))}
      </ul>
      {consentOpen && !consented && !notice ? <RoomConsentBox busy={sending} defaultDisplayMode={defaultDisplayMode} onAccept={(choice) => void deliver(choice)} onCancel={() => setConsentOpen(false)} /> : null}
      {notice ? (
        <p className="border-t border-room-border bg-room-composer px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-sm font-semibold text-room-warn-fg" data-testid="room-questions-notice" role="status">
          {notice}
        </p>
      ) : (
        <form className="border-t border-room-border bg-room-composer p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" onSubmit={submit}>
          <textarea
            aria-label={copy.suaPergunta}
            className="min-h-11 w-full resize-none rounded-[12px] border border-room-input-border bg-room-input-bg px-3 py-2.5 text-sm text-room-fg outline-none placeholder:text-room-fg-subtle focus-visible:border-room-fg-subtle disabled:opacity-50"
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

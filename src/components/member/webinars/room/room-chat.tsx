"use client";

import { MoreHorizontal, Pin, SendHorizontal } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { MemberAvatar } from "@/components/member/ui/member-avatar";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { chatRoleLabel, chatTimeLabel, composerState, type ChatTimeKind, type ComposerState, type RoomMessage } from "@/lib/webinar-room-client";
import { ASSISTANT_WAIT_MS, assistantRepliesToMe, mentionsAssistant, studentAtAssistantLimit } from "@/server/webinars/assistant-model";
import { CHAT_CONSENT_VERSION, CHAT_LIMITS, type ChatMode, type ChatRole, type DisplayNameMode, type SimulatedPhase } from "@/server/webinars/model";
import { AssistantHandoff } from "./assistant/assistant-handoff";
import { AssistantHint, type AssistantHintState } from "./assistant/assistant-hint";
import { ownAssistantEnabled, useRoomAssistant, type RoomAssistant } from "./assistant/use-room-assistant";
import type { ChatPostBody } from "./room-api";
import { RoomBadge, RoomButton, RoomIconButton, type RoomBadgeTone } from "./room-ui";
import { verticalChatAnnouncement } from "./vertical/vertical-model";

// O painel do chat da Sala (docs/30 §1.3, §1.6, §8.5 e §9): a lista em role="log" (em rajada, o leitor de tela
// ouve "N mensagens novas" em vez de cada uma), a mensagem fixada no topo, os selos Equipe / Apresentador /
// Assistente, a pendente do proprio aluno ("Aguardando a equipe"), o aceite na primeira mensagem (o texto de §8.5,
// palavra por palavra, com "Entendi e quero participar" e "Participar como anonimo", e como o nome aparece), o
// compositor (desligado, so a equipe, modo lento com a contagem) e o menu "..." com Remover minhas mensagens. Na live
// (fase 3) o campo da lugar a uma frase (`notice`) quando o aluno esta silenciado no chat (ate a hora em Sao Paulo ou
// ate o fim) ou antes de a sala abrir. Fase 4c (docs/30 §1.6, §6.6 e D24), com `webinarId` e `sessionId`: a dica
// "@assistente" quando o Assistente esta ligado, "O Assistente esta respondendo..." logo depois de chama-lo (ate a
// resposta chegar ou o teto de tempo passar), o aviso do limite do minuto e, na resposta do Assistente a uma mensagem
// do proprio aluno, "Falar com a equipe" (a sala ao vivo usa este mesmo painel: tudo vale la tambem). Redesign V2, F2
// (docs/31 V2-11): as cores vem dos tokens do tema da sala; na gaveta e no chat por cima do vertical, sempre o escuro.
// A confirmacao de remover as minhas mensagens usa o aviso, como a de Sair: o acento fica so no Sair. Redesign V2, F6
// (docs/31 V2-9): no painel, cada mensagem e um balao no estilo do Zoom (RoomChatBubble): o avatar so com as iniciais
// do nome de exibicao (§8.5), o balao primeiro e, embaixo, "nome · papel · hora" em cinza, sem etiqueta colorida; a
// minha a direita. Sai a linha do rotulo "Chat" (repetia a aba) e o menu ⋯ vai para a linha do campo, a esquerda. O
// chat por cima do video no vertical (vertical-chat.tsx) continua com o item de antes (RoomMessageItem, V2-18).

export type RoomChatPanelProps = {
  /** Fase 4b: o que fica logo acima do campo (a entrada simulada "Ana M. entrou", docs/30 §1.6). */
  aboveComposer?: ReactNode;
  /**
   * Redesign V2, F3: o Assistente que a sala ja le (o mesmo estado do selo do palco, docs/31 V2-4). Com ele, o painel
   * nao le de novo; sem ele (a gaveta antiga, os testes), o painel le sozinho como antes.
   */
  assistant?: RoomAssistant;
  busy?: boolean;
  chatMode: ChatMode;
  consented: boolean;
  defaultDisplayMode: DisplayNameMode;
  displayName: string | null;
  error: string | null;
  messages: readonly RoomMessage[];
  /** Fase 3: a frase que toma o lugar do campo (silenciado no chat, sala que ainda nao abriu); nulo, o campo fica. */
  notice?: string | null;
  nowMs: number;
  onRemoveMine: () => Promise<number>;
  onSend: (body: Omit<ChatPostBody, "sessionId">) => Promise<{ pending: boolean }>;
  phase: SimulatedPhase | "replay";
  pinned: RoomMessage | null;
  /** "Ver como" da equipe: mostra, mas nao grava. */
  readOnly: boolean;
  /** Fase 4c: a sessao (com o webinario, liga a dica do Assistente e o "Falar com a equipe"). */
  sessionId?: string | null;
  slowUntilMs: number | null;
  /**
   * Redesign V2, F6 (V2-9): de que sala e a hora embaixo do balao (o zero mais o offset da mensagem, chatTimeLabel):
   * "live" e "simulated" com o `zeroMs`; no "replay" (ou sem ele) a mensagem fica sem hora.
   */
  timeKind?: ChatTimeKind;
  /** Fase 4c: o webinario (com a sessao, liga a dica do Assistente e o "Falar com a equipe"). */
  webinarId?: string | null;
  /** O zero da sessao em ms (a ancora ou o inicio na live; a hora marcada na gravada), para a hora das mensagens. */
  zeroMs?: number | null;
};

const ROLE_BADGES: Partial<Record<ChatRole, { label: string; tone: RoomBadgeTone }>> = {
  ai: { label: WEBINAR_COPY.sala.selos.assistente, tone: "outline" },
  host: { label: WEBINAR_COPY.sala.selos.apresentador, tone: "accent" },
  team: { label: WEBINAR_COPY.sala.selos.equipe, tone: "neutral" }
};

export function RoomMessageItem({ footer = null, message }: { footer?: ReactNode; message: RoomMessage }) {
  const badge = ROLE_BADGES[message.role];
  const prefix = badge ? `${badge.label}: ` : "";

  return (
    <li className={cn("rounded-[10px] px-2 py-1.5", message.mine ? "bg-room-control" : undefined)} data-room-message={message.id}>
      <p className="flex flex-wrap items-center gap-1.5 text-[13px]">
        <span className="sr-only">{prefix}</span>
        <span className={cn("font-bold", badge ? "text-room-fg-strong" : "text-room-fg")}>{message.displayName}</span>
        {badge ? (
          <RoomBadge size="sm" tone={badge.tone}>
            {badge.label}
          </RoomBadge>
        ) : null}
        {message.pending ? (
          <RoomBadge size="sm" tone="warning">
            {WEBINAR_COPY.sala.aguardandoEquipe}
          </RoomBadge>
        ) : null}
      </p>
      <p className="whitespace-pre-line break-words text-sm leading-5 text-room-fg">{message.body}</p>
      {footer}
    </li>
  );
}

/**
 * Uma mensagem do painel no estilo do Zoom (docs/31 V2-9): o avatar de 28 px (so as iniciais) de um lado, o balao (os
 * outros a esquerda em --room-surface-2; a minha a direita em --room-bubble-mine-bg, com o avatar a direita) e, embaixo,
 * "nome · papel · hora" em 11 px. O papel so para Apresentador, Equipe e Assistente (chatRoleLabel). A linha de baixo e
 * so para quem ve (aria-hidden): o leitor de tela ouve "{nome}, {papel}, {hora}: " antes do texto, nunca o texto antes
 * do autor; "Aguardando a equipe" fica lido, depois do texto. O "Falar com a equipe" do Assistente vem depois da linha.
 */
export function RoomChatBubble({ footer = null, message, time }: { footer?: ReactNode; message: RoomMessage; time: string }) {
  const role = chatRoleLabel(message.role);
  const mine = message.mine;
  const author = [message.displayName, role, time].filter((part): part is string => Boolean(part));

  return (
    <li className={cn("flex items-end gap-2", mine ? "flex-row-reverse" : undefined)} data-mine={mine ? "" : undefined} data-room-message={message.id}>
      <MemberAvatar name={message.displayName} size="xs" />
      <div className={cn("flex min-w-0 max-w-[270px] flex-col gap-1 lg:max-w-[230px]", mine ? "items-end" : "items-start")}>
        <p
          className={cn(
            "max-w-full whitespace-pre-line break-words rounded-[12px] px-3 py-2 text-[13px] leading-[18px]",
            mine ? "rounded-br-[4px] bg-room-bubble-mine-bg text-room-bubble-mine-fg" : "rounded-bl-[4px] bg-room-surface-2 text-room-bubble-other-fg"
          )}
        >
          <span className="sr-only">{WEBINAR_COPY.salaV2.chat.autor(author)}</span>
          {message.body}
        </p>
        <p className={cn("flex flex-wrap items-center gap-1.5 text-[11px] leading-4 text-room-fg-subtle", mine ? "justify-end pr-1" : "pl-1")} data-room-message-meta="">
          <span aria-hidden="true" className="inline-flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-room-meta-name">{message.displayName}</span>
            {role ? (
              <>
                <span>·</span>
                <span>{role}</span>
              </>
            ) : null}
            {time ? (
              <>
                <span>·</span>
                <span>{time}</span>
              </>
            ) : null}
          </span>
          {message.pending ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-room-warn-fg">{WEBINAR_COPY.sala.aguardandoEquipe}</span>
            </>
          ) : null}
        </p>
        {footer}
      </div>
    </li>
  );
}

function RoomPinned({ message }: { message: RoomMessage }) {
  return (
    <div className="border-b border-room-border bg-room-pinned px-3 py-2" data-testid="room-pinned">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-room-fg-subtle">
        <Pin aria-hidden="true" className="size-3" />
        {WEBINAR_COPY.sala.fixada}
      </p>
      <p className="mt-0.5 text-sm text-room-fg">
        <span className="font-bold text-room-fg-strong">{message.displayName}</span> {message.body}
      </p>
    </div>
  );
}

export type ConsentChoice = { displayMode: DisplayNameMode; nickname: string };

/** O aceite (docs/30 §8.5): o texto exato, como o nome aparece e os dois botoes. */
export function RoomConsentBox({ busy, defaultDisplayMode, onAccept, onCancel }: { busy?: boolean; defaultDisplayMode: DisplayNameMode; onAccept: (choice: ConsentChoice) => void; onCancel: () => void }) {
  const copy = WEBINAR_COPY.sala;
  const id = useId();
  const [mode, setMode] = useState<DisplayNameMode>(defaultDisplayMode === "anonymous" ? "first_name_initial" : defaultDisplayMode);
  const [nickname, setNickname] = useState("");
  const nicknameInvalid = mode === "nickname" && (nickname.trim().length < CHAT_LIMITS.nicknameMin || nickname.trim().length > CHAT_LIMITS.nicknameMax);

  return (
    <div className="border-t border-room-border bg-room-pinned px-3 py-3" data-testid="room-consent" role="group" aria-labelledby={`${id}-title`}>
      <p className="text-sm leading-6 text-room-fg" id={`${id}-title`}>
        {copy.consentimento}
      </p>
      <fieldset className="mt-3">
        <legend className="text-xs font-semibold text-room-fg-subtle">{copy.comoAparece}</legend>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
          {(["first_name_initial", "nickname"] as const).map((option) => (
            <label className="inline-flex min-h-8 items-center gap-2 text-room-fg" key={option}>
              <input checked={mode === option} className="accent-room-active-bg" name={`${id}-mode`} onChange={() => setMode(option)} type="radio" value={option} />
              {option === "nickname" ? copy.responderComo.apelido : copy.responderComo.nome}
            </label>
          ))}
        </div>
        {mode === "nickname" ? (
          <input
            aria-invalid={nicknameInvalid || undefined}
            aria-label={copy.responderComo.apelido}
            className="mt-2 h-10 w-full rounded-[10px] border border-room-input-border bg-room-input-bg px-3 text-sm text-room-fg outline-none placeholder:text-room-fg-subtle focus-visible:border-room-fg-subtle"
            maxLength={CHAT_LIMITS.nicknameMax}
            onChange={(event) => setNickname(event.target.value)}
            placeholder={copy.apelidoPlaceholder}
            value={nickname}
          />
        ) : null}
      </fieldset>
      <div className="mt-3 flex flex-wrap gap-2">
        <RoomButton disabled={busy || nicknameInvalid} onClick={() => onAccept({ displayMode: mode, nickname: nickname.trim() })} size="sm" variant="primary">
          {copy.consentimentoBotao}
        </RoomButton>
        <RoomButton disabled={busy} onClick={() => onAccept({ displayMode: "anonymous", nickname: "" })} size="sm" variant="secondary">
          {copy.participarComoAnonimo}
        </RoomButton>
        <RoomButton disabled={busy} onClick={onCancel} size="sm" variant="ghost">
          {WEBINAR_COPY.admin.cancelar}
        </RoomButton>
      </div>
    </div>
  );
}

function composerHint(state: ComposerState, phase: SimulatedPhase | "replay"): string {
  const copy = WEBINAR_COPY.sala;
  switch (state.reason) {
    case "chat_off":
      return copy.chatDesligado;
    case "team_only":
      return copy.chatSoEquipe;
    case "slow_mode":
      return copy.modoLento(state.waitSeconds);
    case "ended":
      return phase === "replay" ? "" : copy.encerrada;
    default:
      return "";
  }
}

export function RoomChatPanel(props: RoomChatPanelProps) {
  const {
    aboveComposer = null,
    assistant: sharedAssistant,
    busy = false,
    chatMode,
    consented,
    defaultDisplayMode,
    error,
    messages,
    notice = null,
    nowMs,
    onRemoveMine,
    onSend,
    phase,
    pinned,
    readOnly,
    sessionId = null,
    slowUntilMs,
    timeKind = "replay",
    webinarId = null,
    zeroMs = null
  } = props;
  const copy = WEBINAR_COPY.sala;
  const ownAssistant = useRoomAssistant({ enabled: ownAssistantEnabled({ readOnly, shared: sharedAssistant }), sessionId, webinarId });
  const assistant = sharedAssistant ?? ownAssistant;
  const repliesToMe = useMemo(() => assistantRepliesToMe(messages), [messages]);
  const [assistantCalls, setAssistantCalls] = useState<number[]>([]);
  const [waiting, setWaiting] = useState<{ base: number } | null>(null);
  const [limitedUntil, setLimitedUntil] = useState(0);
  // O "respondendo" dura no maximo o teto do Assistente e a folga do chat.
  useEffect(() => {
    if (!waiting) {
      return;
    }
    const id = window.setTimeout(() => setWaiting(null), ASSISTANT_WAIT_MS);
    return () => window.clearTimeout(id);
  }, [waiting]);
  const [draft, setDraft] = useState("");
  const [consentOpen, setConsentOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [announce, setAnnounce] = useState("");
  const listRef = useRef<HTMLOListElement | null>(null);
  const knownRef = useRef<Set<string>>(new Set());
  const stickRef = useRef(true);
  const state = composerState({ chatMode, consented, nowMs, phase, slowUntilMs });
  const hint = composerHint(state, phase);

  // Mensagens novas: anuncia "N mensagens novas" em rajada; a lista rola so quando o aluno esta no fim.
  useEffect(() => {
    const fresh = messages.filter((message) => !knownRef.current.has(message.id));
    if (fresh.length === 0) {
      return;
    }
    const hadKnown = knownRef.current.size > 0;
    fresh.forEach((message) => knownRef.current.add(message.id));
    if (fresh.length > 1) {
      setAnnounce(copy.mensagensNovas(fresh.length));
    } else if (hadKnown && messages.length > 1) {
      // Com mais de uma mensagem o log fica aria-live="off" (§9): a nova sozinha e lida aqui, com o papel na frente.
      setAnnounce(verticalChatAnnouncement(fresh));
    }
    const list = listRef.current;
    if (list && stickRef.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [copy, messages]);

  function handleScroll() {
    const list = listRef.current;
    if (list) {
      stickRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    }
  }

  async function deliver(extra: Partial<ChatPostBody> = {}) {
    const text = draft.trim();
    if (!text || readOnly) {
      return;
    }
    setSending(true);
    setStatus(null);
    try {
      const answer = await onSend({ body: text, kind: "message", ...extra });
      setDraft("");
      setConsentOpen(false);
      setStatus(answer.pending ? copy.aguardandoEquipe : null);
      // Fase 4c: chamou o Assistente (ligado): "respondendo" ate a resposta chegar; no limite do minuto, o aviso.
      if (!answer.pending && assistant.state.enabled && mentionsAssistant(text)) {
        if (studentAtAssistantLimit(assistantCalls, nowMs)) {
          setLimitedUntil(nowMs + 60_000);
          setWaiting(null);
        } else {
          setWaiting({ base: repliesToMe.size });
        }
        setAssistantCalls((previous) => [...previous.filter((at) => nowMs - at < 60_000), nowMs]);
      }
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : copy.erroEnviar);
    } finally {
      setSending(false);
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (state.disabled || !draft.trim()) {
      return;
    }
    if (!consented) {
      setConsentOpen(true);
      return;
    }
    void deliver();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  async function removeMine() {
    setConfirmRemove(false);
    setMenuOpen(false);
    try {
      const removed = await onRemoveMine();
      setStatus(removed > 0 ? WEBINAR_COPY.privacidade.feito(removed) : WEBINAR_COPY.privacidade.nadaParaRemover);
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : copy.erroEnviar);
    }
  }

  const single = messages.length <= 1;
  const waitingNow = waiting !== null && repliesToMe.size <= waiting.base;
  const assistantHint: AssistantHintState = readOnly || notice ? "none" : waitingNow ? "waiting" : limitedUntil > nowMs ? "limit" : assistant.state.enabled && !state.disabled ? "call" : "none";

  // O menu ⋯ (Remover minhas mensagens) fica na linha do campo, a esquerda; com a frase no lugar do campo, tambem.
  const menu = (
    <div className="relative shrink-0">
      <RoomIconButton aria-expanded={menuOpen} aria-haspopup="menu" label={WEBINAR_COPY.salaV2.chat.maisOpcoes} onClick={() => setMenuOpen((open) => !open)} size={40} tone="control">
        <MoreHorizontal aria-hidden="true" />
      </RoomIconButton>
      {menuOpen ? (
        <div className="absolute bottom-full left-0 z-20 mb-1 min-w-[14rem] rounded-[12px] border border-room-border bg-room-surface p-1 shadow-[0_18px_48px_rgba(0,0,0,0.5)]" role="menu">
          <button
            className="flex h-10 w-full items-center rounded-[8px] px-3 text-left text-sm font-semibold text-room-fg hover:bg-room-control hover:text-room-fg-strong"
            disabled={readOnly}
            onClick={() => {
              setMenuOpen(false);
              setConfirmRemove(true);
            }}
            role="menuitem"
            type="button"
          >
            {copy.removerMinhasMensagens}
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="room-chat">
      {pinned ? <RoomPinned message={pinned} /> : null}

      <ol
        aria-label={copy.abas.chat}
        aria-live={single ? "polite" : "off"}
        aria-relevant="additions"
        className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3 pb-2 pt-3"
        onScroll={handleScroll}
        ref={listRef}
        role="log"
      >
        {messages.length === 0 ? <li className="px-2 py-6 text-center text-sm text-room-fg-subtle">{error ?? copy.semMensagens}</li> : null}
        {messages.map((message) => {
          const repliedTo = repliesToMe.get(message.id);
          return (
            <RoomChatBubble
              footer={
                repliedTo && !readOnly && webinarId && sessionId ? (
                  <AssistantHandoff attendantsOnline={assistant.state.attendantsOnline} onRequest={() => assistant.handoff("chat", repliedTo)} readOnly={readOnly} />
                ) : null
              }
              key={message.id}
              message={message}
              time={chatTimeLabel({ kind: timeKind, offsetMs: message.offsetMs, zeroMs })}
            />
          );
        })}
      </ol>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      {aboveComposer}

      {confirmRemove ? (
        <div className="mx-3 my-2 rounded-[12px] border border-room-warn-border bg-room-warn-bg p-3" role="alertdialog" aria-label={WEBINAR_COPY.privacidade.confirmar}>
          <p className="text-sm font-bold text-room-warn-fg">{WEBINAR_COPY.privacidade.confirmar}</p>
          <p className="mt-1 text-xs leading-5 text-room-fg-muted">{WEBINAR_COPY.privacidade.confirmarTexto}</p>
          <div className="mt-2 flex gap-2">
            <RoomButton onClick={() => void removeMine()} size="sm" variant="secondary">
              {copy.removerMinhasMensagens}
            </RoomButton>
            <RoomButton onClick={() => setConfirmRemove(false)} size="sm" variant="ghost">
              {WEBINAR_COPY.admin.cancelar}
            </RoomButton>
          </div>
        </div>
      ) : null}

      {consentOpen && !consented && !notice ? (
        <RoomConsentBox
          busy={sending}
          defaultDisplayMode={defaultDisplayMode}
          onAccept={(choice) =>
            void deliver({
              anonymous: choice.displayMode === "anonymous",
              consent: true,
              consentVersion: CHAT_CONSENT_VERSION,
              displayMode: choice.displayMode,
              ...(choice.displayMode === "nickname" ? { nickname: choice.nickname } : {})
            })
          }
          onCancel={() => setConsentOpen(false)}
        />
      ) : null}

      {notice ? (
        <div className="flex items-center gap-2 border-t border-room-border bg-room-composer p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {menu}
          <p className="min-w-0 flex-1 px-1 py-1 text-sm font-semibold text-room-warn-fg" data-testid="room-chat-notice" role="status">
            {notice}
          </p>
        </div>
      ) : (
        <form className="border-t border-room-border bg-room-composer p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" onSubmit={submit}>
          <div className="flex items-center gap-2">
            {menu}
            {/* 16 px abaixo de lg: o Safari do iPhone da zoom no foco de um campo menor. */}
            <textarea
              aria-label={copy.escreva}
              className="h-11 min-w-0 flex-1 resize-none rounded-[12px] border border-room-input-border bg-room-input-bg px-3 py-2.5 text-base leading-6 text-room-fg outline-none placeholder:text-room-fg-subtle focus-visible:border-room-fg-subtle disabled:opacity-50 lg:text-[13px]"
              disabled={state.disabled || readOnly || busy}
              maxLength={CHAT_LIMITS.body}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={hint || copy.escreva}
              rows={1}
              value={draft}
            />
            <RoomIconButton disabled={state.disabled || readOnly || sending || !draft.trim()} label={copy.enviar} size={44} tone="primary" type="submit">
              <SendHorizontal aria-hidden="true" />
            </RoomIconButton>
          </div>
          <p aria-live="polite" className={cn("mt-1 min-h-4 px-1 text-[11px]", status && status !== copy.aguardandoEquipe ? "text-room-warn-fg" : "text-room-fg-subtle")}>
            {status ?? (readOnly ? WEBINAR_COPY.aluno.previaSemGravar : hint)}
          </p>
          <AssistantHint state={assistantHint} />
        </form>
      )}
    </div>
  );
}

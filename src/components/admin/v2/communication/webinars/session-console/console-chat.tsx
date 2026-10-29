"use client";

import { Pin, PinOff, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { ModerationAction } from "@/server/webinars/chat-schemas";
import { CHAT_MODE_OPTIONS, SLOW_MODE_CHOICES, messageActions, slowModeChoiceOf, slowModeFromChoice, type ConsoleMessage, type SlowModeChoice } from "@/server/webinars/console-model";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import { CHAT_LIMITS, type ChatMode, type SlowModeSeconds, type WebinarSession } from "@/server/webinars/model";
import { offsetLabel } from "@/server/webinars/room-model";
import { PillGroup, adminTextareaClass } from "../../../form";
import { SectionCard } from "../../../settings/kit";
import { StatusChip } from "../../../status-chip";

// O painel Chat do console (docs/30 §2.4 e §8.3): tudo o que o aluno ve mais os pendentes do chat moderado
// (Liberar), Apagar, Fixar/Desafixar, "Aprovar para as próximas turmas" (so mensagem da turma com o aceite do
// autor; sem aceite, a tela diz por que), Quem pode escrever e Modo lento no topo, e a caixa da equipe (Enter envia,
// Shift+Enter quebra a linha). A lista cola no fim quando a pessoa ja estava no fim.

const copy = WEBINAR_ADMIN_COPY.console.chat;

type ConsoleChatProps = {
  busyKey: string | null;
  canAct: boolean;
  currentUserId: string;
  hostUserId: string | null;
  messages: readonly ConsoleMessage[];
  onChatMode: (chatMode: ChatMode, slowModeSeconds: SlowModeSeconds | null) => void;
  onModerate: (action: ModerationAction, messageId: string) => void;
  onSend: (body: string) => Promise<boolean>;
  pinnedMessageId: string | null;
  session: WebinarSession;
};

function roleLabel(message: ConsoleMessage): string | null {
  if (message.source === "scripted") {
    return copy.sources.scripted;
  }
  if (message.source === "original") {
    return copy.sources.original;
  }
  if (message.source === "ai" || message.role === "ai") {
    return WEBINAR_COPY.sala.selos.assistente;
  }
  if (message.role === "host") {
    return WEBINAR_COPY.sala.selos.apresentador;
  }
  if (message.role === "team") {
    return WEBINAR_COPY.sala.selos.equipe;
  }
  return null;
}

export function ConsoleChat({ busyKey, canAct, messages, onChatMode, onModerate, onSend, pinnedMessageId, session }: ConsoleChatProps) {
  const [body, setBody] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const stickToEnd = useRef(true);
  const sending = busyKey === "send";

  useEffect(() => {
    const list = listRef.current;

    if (list && stickToEnd.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages.length]);

  function trackScroll() {
    const list = listRef.current;

    if (list) {
      stickToEnd.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    }
  }

  async function submit() {
    const text = body.trim();

    if (!text || sending) {
      return;
    }

    if (await onSend(text)) {
      setBody("");
      stickToEnd.current = true;
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <SectionCard bodyClassName="flex min-w-0 flex-col gap-4 p-0" title={copy.title} titleId="console-chat-title">
      <div className="flex min-w-0 flex-col gap-3 px-4 pt-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{copy.whoWrites}</span>
          <PillGroup ariaLabel={copy.whoWrites} disabled={!canAct || busyKey === "chat-mode"} name="console-chat-mode" onChange={(mode: ChatMode) => onChatMode(mode, session.chatSlowModeSeconds)} options={CHAT_MODE_OPTIONS} value={session.chatMode} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{copy.slowMode}</span>
          <PillGroup
            ariaLabel={copy.slowMode}
            disabled={!canAct || busyKey === "chat-mode" || session.chatMode === "off"}
            name="console-slow-mode"
            onChange={(choice: SlowModeChoice) => onChatMode(session.chatMode, slowModeFromChoice(choice))}
            options={SLOW_MODE_CHOICES}
            value={slowModeChoiceOf(session.chatSlowModeSeconds)}
          />
        </div>
      </div>

      <ol aria-label={copy.title} className="flex max-h-[60vh] min-h-48 min-w-0 flex-col gap-1 overflow-y-auto border-y border-[var(--border-subtle)] px-4 py-3" data-console-chat="" onScroll={trackScroll} ref={listRef}>
        {messages.length === 0 ? <li className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.empty}</li> : null}
        {messages.map((message) => {
          const actions = messageActions(message, pinnedMessageId);
          const busy = busyKey === `moderate:${message.id}`;
          const label = roleLabel(message);

          return (
            <li className={cn("flex min-w-0 flex-col gap-1 rounded-lg px-2 py-2", !message.approved && "bg-[var(--surface-2)]", pinnedMessageId === message.id && "border border-[var(--border-strong)]")} data-console-message={message.id} data-message-source={message.source} key={message.id}>
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs leading-5 text-[var(--text-tertiary)]">
                <span className="font-medium text-[var(--text-primary)]">{message.displayName}</span>
                {label ? <StatusChip tone={message.source === "scripted" ? "muted" : "neutral"}>{label}</StatusChip> : null}
                <span className="tabular-nums">{offsetLabel(message.offsetMs)}</span>
                {!message.approved ? <StatusChip tone="warning">{copy.pending}</StatusChip> : null}
                {pinnedMessageId === message.id ? <StatusChip tone="success">{copy.pinned}</StatusChip> : null}
                {message.master ? <StatusChip tone="success">{copy.master}</StatusChip> : null}
              </div>
              <p className="text-sm leading-5 break-words whitespace-pre-wrap text-[var(--text-primary)]">{message.body}</p>
              {canAct ? (
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  {actions.approve ? (
                    <Button className="h-8! px-2 text-[13px]" disabled={busy} onClick={() => onModerate("approve", message.id)} type="button" variant="secondary">
                      {copy.approve}
                    </Button>
                  ) : null}
                  {actions.promote ? (
                    <Button className="h-8! px-2 text-[13px]" disabled={busy} onClick={() => onModerate("promote", message.id)} type="button" variant="secondary">
                      {copy.promote}
                    </Button>
                  ) : message.source === "audience" && !message.master && !message.promotable ? (
                    <span className="px-1 text-xs leading-5 text-[var(--text-tertiary)]">{copy.noConsent}</span>
                  ) : null}
                  {actions.pin ? (
                    <Button aria-label={`${copy.pin}: ${message.displayName}`} className="h-8! px-2 text-[13px] text-[var(--text-secondary)]" disabled={busy} onClick={() => onModerate("pin", message.id)} type="button" variant="ghost">
                      <Pin aria-hidden="true" className="size-4" />
                      {copy.pin}
                    </Button>
                  ) : null}
                  {actions.unpin ? (
                    <Button aria-label={`${copy.unpin}: ${message.displayName}`} className="h-8! px-2 text-[13px] text-[var(--text-secondary)]" disabled={busy} onClick={() => onModerate("unpin", message.id)} type="button" variant="ghost">
                      <PinOff aria-hidden="true" className="size-4" />
                      {copy.unpin}
                    </Button>
                  ) : null}
                  <Button aria-label={`${copy.delete}: ${message.displayName}`} className="h-8! px-2 text-[13px] text-[var(--error)]" disabled={busy} onClick={() => onModerate("delete", message.id)} type="button" variant="ghost">
                    <Trash2 aria-hidden="true" className="size-4" />
                    {copy.delete}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="flex min-w-0 flex-col gap-2 px-4 pb-4">
        <label className="sr-only" htmlFor="console-composer">
          {copy.composer}
        </label>
        <textarea
          className={cn(adminTextareaClass, "min-h-16")}
          disabled={!canAct || sending}
          id="console-composer"
          maxLength={CHAT_LIMITS.body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={copy.composer}
          rows={2}
          value={body}
        />
        <div className="flex items-center justify-end">
          <Button className="px-4" disabled={!canAct || sending || !body.trim()} onClick={() => void submit()} type="button">
            <Send aria-hidden="true" className="size-4" />
            {copy.send}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

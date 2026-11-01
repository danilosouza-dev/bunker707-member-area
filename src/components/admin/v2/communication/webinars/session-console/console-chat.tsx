"use client";

import { ChevronDown, MoreHorizontal, SendHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { RoomChatBubble } from "@/components/member/webinars/room/room-chat";
import { ROOM_FOCUS, RoomButton, RoomIconButton } from "@/components/member/webinars/room/room-ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { ModerationAction } from "@/server/webinars/chat-schemas";
import {
  CHAT_MODE_OPTIONS,
  SLOW_MODE_CHOICES,
  consoleChatQueue,
  consoleMessageMeta,
  messageActions,
  slowModeChoiceOf,
  slowModeFromChoice,
  type ConsoleMessage,
  type MessageActions,
  type SlowModeChoice
} from "@/server/webinars/console-model";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import { CHAT_LIMITS, type ChatMode, type SlowModeSeconds, type WebinarQuestion, type WebinarSession } from "@/server/webinars/model";
import { adminMenuItem, adminMenuPopup, adminMenuSeparator } from "../../../styles";
import { useConsolePortal } from "./console-shell";

// A aba Chat do console (docs/30 §2.4 e §8.3; docs/31 V2-15 e V2-9), no cartao do painel e pelos tokens do tema do
// console. Em cima, "Quem escreve" e "Modo lento" em dois seletores compactos (os mesmos valores e a mesma acao de
// antes; o modo lento desligado com o chat desligado) e, a direita, "{n} aguardando". As pendentes do chat moderado
// saem da lista e viram cards ambar no topo, a mais velha primeiro: "Na moderação · nome · hora", o texto, Liberar,
// Recusar (o apagar da pendente) e Virar pergunta (so a mensagem comum de um aluno; a pergunta pelo chat ja vira
// pergunta no Liberar). A lista (role=log, o nome "Chat") usa o balao da sala (RoomChatBubble) com "nome · papel · hora"
// embaixo, a origem que so a equipe ve (Roteiro, Chat original), "Fixada" e, fora da live, "Nas próximas turmas" (na
// live toda mensagem nasce na linha mestre, D31); a minha a direita, com "Você". As acoes de cada mensagem ficam na
// linha de baixo e aparecem com o mouse ou o foco dentro dela (por cima da linha), sempre na tela de toque: Fixar ou Desafixar, Virar
// pergunta, Apagar e o ⋯ com Aprovar para as próximas turmas (so com o aceite do autor; sem ele, a frase do porque),
// Corrigir resposta (Assistente, o texto novo embaixo do balao), Refazer tradução e, na live, os itens da pessoa
// (Silenciar, Remover, Banir; LivePersonMenuItems). Cada botao da linha tem 24 px de altura (WCAG 2.5.8). Embaixo, a
// caixa da equipe com o Enviar redondo (Enter envia, Shift+Enter quebra a linha). A lista enche a aba a partir de lg e
// cola no fim quando a pessoa ja estava no fim. O ⋯ abre no portal da raiz do console. Nenhuma frase escrita aqui.

const copy = WEBINAR_ADMIN_COPY.console.chat;
const v2 = WEBINAR_COPY.consoleV2.chat;
const assistantCopy = WEBINAR_COPY.assistente.console;

/** Um botao da linha de baixo do balao: o texto de 11 px num alvo de 24 px de altura. */
const LINE_ACTION = cn("inline-flex min-h-6 items-center rounded-md px-1 text-[11px] font-semibold disabled:pointer-events-none disabled:opacity-45", ROOM_FOCUS);
/**
 * As acoes da mensagem. Com o mouse (pointer-fine), elas ficam escondidas e aparecem com o mouse ou o foco dentro do
 * item e com o ⋯ aberto, por cima da linha de baixo, no canto do item (a direita; na minha, a esquerda): escondidas, nao
 * ocupam lugar nenhum, e o foco do teclado chega nelas do mesmo jeito. Na tela de toque, sempre a mostra, na linha.
 */
const LINE_ACTIONS = cn(
  "inline-flex flex-wrap items-center gap-0.5 transition-opacity motion-reduce:transition-none",
  "pointer-fine:absolute pointer-fine:bottom-0 pointer-fine:z-10 pointer-fine:rounded-md pointer-fine:bg-room-surface pointer-fine:px-1",
  "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 pointer-fine:has-[[data-popup-open]]:opacity-100"
);
/** O balao do console: o mesmo da sala ate xl; a partir de xl (o painel de 360 e 440 px), ate 320 px. */
const BUBBLE_WIDTH = "max-w-[270px] lg:max-w-[230px] xl:max-w-[320px]";
/** O campo da caixa e o da correcao: 16 px abaixo de lg (o Safari do iPhone da zoom num campo menor). */
const FIELD = "min-w-0 rounded-[12px] border border-room-input-border bg-room-input-bg px-3 text-base leading-5 text-room-fg placeholder:text-room-fg-subtle disabled:opacity-50 lg:text-[13px]";

type ConsoleChatProps = {
  busyKey: string | null;
  canAct: boolean;
  currentUserId: string;
  hostUserId: string | null;
  messages: readonly ConsoleMessage[];
  onChatMode: (chatMode: ChatMode, slowModeSeconds: SlowModeSeconds | null) => void;
  /** Fase 4c: "Corrigir resposta" numa resposta do Assistente (devolve se gravou). */
  onEditAssistant?: ((messageId: string, body: string) => Promise<boolean>) | null;
  onModerate: (action: ModerationAction, messageId: string) => void;
  /** Fase 4f: "Refazer tradução" (apaga a traducao guardada do texto); nulo com a traducao desligada no ambiente. */
  onRetranslate?: ((messageId: string) => void) | null;
  onSend: (body: string) => Promise<boolean>;
  /**
   * Fase 3: os itens da pessoa (Silenciar no chat, Remover, Banir) no ⋯ de uma mensagem da turma; nulo fora da Live ao
   * vivo. Devolve nulo quando nao ha item para aquela pessoa (a equipe, quem nao esta no retrato).
   */
  personMenu?: ((message: ConsoleMessage) => ReactNode) | null;
  pinnedMessageId: string | null;
  /** As perguntas do retrato: a mensagem que ja virou pergunta fica sem o Virar pergunta. */
  questions: readonly Pick<WebinarQuestion, "messageId">[];
  session: WebinarSession;
};

export function ConsoleChat({ busyKey, canAct, currentUserId, messages, onChatMode, onEditAssistant = null, onModerate, onRetranslate = null, onSend, personMenu = null, pinnedMessageId, questions, session }: ConsoleChatProps) {
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<{ body: string; id: string } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const stickToEnd = useRef(true);
  const sending = busyKey === "send";
  const { log, pending } = useMemo(() => consoleChatQueue(messages), [messages]);
  const asked = useMemo(() => new Set(questions.map((question) => question.messageId).filter((id): id is string => Boolean(id))), [questions]);
  const modeBusy = !canAct || busyKey === "chat-mode";

  useEffect(() => {
    const list = listRef.current;

    if (list && stickToEnd.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [log.length]);

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

  async function saveEdit() {
    const text = editing?.body.trim() ?? "";

    if (!editing || !text || !onEditAssistant) {
      return;
    }

    if (await onEditAssistant(editing.id, text)) {
      setEditing(null);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  const metaOf = (message: ConsoleMessage) => consoleMessageMeta({ kind: session.kind, message, scheduledAt: session.scheduledAt });
  const actionsOf = (message: ConsoleMessage) => messageActions(message, pinnedMessageId, { hasQuestion: asked.has(message.id) });

  /** A correcao da resposta do Assistente, embaixo do balao (ou do texto da pendente). */
  function editorOf(message: ConsoleMessage): ReactNode {
    if (editing?.id !== message.id) {
      return null;
    }

    const busy = busyKey === `moderate:${message.id}`;

    return (
      <div className="flex w-full min-w-56 flex-col gap-2" data-console-edit={message.id}>
        <label className="sr-only" htmlFor={`console-edit-${message.id}`}>
          {assistantCopy.corrigir}
        </label>
        <textarea
          className={cn(FIELD, "min-h-16 w-full py-2")}
          disabled={busy}
          id={`console-edit-${message.id}`}
          maxLength={CHAT_LIMITS.body}
          onChange={(event) => setEditing({ body: event.target.value, id: message.id })}
          rows={3}
          value={editing.body}
        />
        <div className="flex flex-wrap justify-end gap-1.5">
          <RoomButton disabled={busy} onClick={() => setEditing(null)} size="xs" variant="ghost">
            {assistantCopy.cancelar}
          </RoomButton>
          <RoomButton disabled={busy || !editing.body.trim()} onClick={() => void saveEdit()} size="xs" variant="secondary">
            {assistantCopy.salvarCorrecao}
          </RoomButton>
        </div>
      </div>
    );
  }

  /** O ⋯ da mensagem: o que nao cabe na linha. Nulo quando nao ha nada para esta mensagem. */
  function menuOf(message: ConsoleMessage, actions: MessageActions, triggerClassName: string): ReactNode {
    const items: ReactNode[] = [];

    if (actions.promote) {
      items.push(
        <DropdownMenuItem className={adminMenuItem} key="promote" onClick={() => onModerate("promote", message.id)}>
          {copy.promote}
        </DropdownMenuItem>
      );
    } else if (message.approved && message.source === "audience" && !message.master && !message.promotable) {
      items.push(
        <p className="px-2.5 py-1 text-xs leading-4 text-[var(--text-tertiary)]" key="no-consent">
          {copy.noConsent}
        </p>
      );
    }

    if (onEditAssistant && message.source === "ai" && editing?.id !== message.id) {
      items.push(
        <DropdownMenuItem className={adminMenuItem} key="edit" onClick={() => setEditing({ body: message.body, id: message.id })}>
          {assistantCopy.corrigir}
        </DropdownMenuItem>
      );
    }

    if (onRetranslate) {
      items.push(
        <DropdownMenuItem className={adminMenuItem} key="retranslate" onClick={() => onRetranslate(message.id)}>
          {WEBINAR_COPY.traducao.console.refazer}
        </DropdownMenuItem>
      );
    }

    const person = personMenu && message.source === "audience" && message.authorUserId ? personMenu(message) : null;

    if (items.length === 0 && !person) {
      return null;
    }

    return (
      <MessageMenu busy={busyKey === `moderate:${message.id}`} name={message.displayName} triggerClassName={triggerClassName}>
        {items}
        {items.length > 0 && person ? <DropdownMenuSeparator className={adminMenuSeparator} /> : null}
        {person}
      </MessageMenu>
    );
  }

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-[var(--member-cover-radius)] border border-room-border bg-room-surface lg:min-h-0 lg:flex-1">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-room-border px-3 py-2.5" data-console-chat-header="">
        <CompactSelect
          disabled={modeBusy}
          id="console-chat-mode"
          label={v2.quemEscreve}
          onChange={(mode: ChatMode) => onChatMode(mode, session.chatSlowModeSeconds)}
          options={CHAT_MODE_OPTIONS}
          value={session.chatMode}
        />
        <CompactSelect
          disabled={modeBusy || session.chatMode === "off"}
          id="console-slow-mode"
          label={v2.modoLento}
          onChange={(choice: SlowModeChoice) => onChatMode(session.chatMode, slowModeFromChoice(choice))}
          options={SLOW_MODE_CHOICES}
          value={slowModeChoiceOf(session.chatSlowModeSeconds)}
        />
        {pending.length > 0 ? (
          <span className="ml-auto text-[11px] leading-4 whitespace-nowrap text-room-fg-muted tabular-nums" data-console-chat-waiting="">
            {v2.aguardando(pending.length)}
          </span>
        ) : null}
      </div>

      {pending.length > 0 ? (
        <ol aria-label={copy.pending} className="relative flex max-h-56 min-w-0 shrink-0 flex-col gap-2 overflow-y-auto px-3 pt-2.5 lg:max-h-[35%]" data-console-chat-queue="">
          {pending.map((message) => {
            const actions = actionsOf(message);
            const busy = busyKey === `moderate:${message.id}`;
            const time = metaOf(message).time;

            return (
              <li className="flex min-w-0 flex-col gap-2 rounded-[12px] border border-room-warn-border bg-room-warn-bg px-3 py-2.5" data-console-pending="" data-room-message={message.id} key={message.id}>
                <p className="text-[11px] leading-4 font-bold text-room-warn-fg">{[copy.pending, message.displayName, time].filter(Boolean).join(" · ")}</p>
                <p className="text-[13px] leading-[18px] break-words whitespace-pre-line text-room-fg">{message.body}</p>
                {editorOf(message)}
                {canAct ? (
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <RoomButton aria-label={`${copy.approve}: ${message.displayName}`} disabled={busy} onClick={() => onModerate("approve", message.id)} size="xs" variant="primary">
                      {copy.approve}
                    </RoomButton>
                    <RoomButton aria-label={`${v2.recusar}: ${message.displayName}`} disabled={busy} onClick={() => onModerate("delete", message.id)} size="xs" variant="secondary">
                      {v2.recusar}
                    </RoomButton>
                    {actions.question ? (
                      <RoomButton aria-label={`${v2.virarPergunta}: ${message.displayName}`} disabled={busy} onClick={() => onModerate("question", message.id)} size="xs" variant="secondary">
                        {v2.virarPergunta}
                      </RoomButton>
                    ) : null}
                    {menuOf(message, actions, "size-7 justify-center rounded-full border border-room-border-strong px-0 text-room-fg-strong hover:bg-room-control")}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      <ol
        aria-label={copy.title}
        className="relative flex min-h-48 min-w-0 flex-col gap-3.5 overflow-y-auto px-3 pt-3 pb-2 max-lg:max-h-[60vh] lg:min-h-0 lg:flex-1"
        data-console-chat=""
        onScroll={trackScroll}
        ref={listRef}
        role="log"
      >
        {log.length === 0 ? <li className="px-2 py-6 text-center text-[13px] leading-5 text-room-fg-subtle">{copy.empty}</li> : null}
        {log.map((message) => {
          const actions = actionsOf(message);
          const busy = busyKey === `moderate:${message.id}`;
          const meta = metaOf(message);
          const pinned = pinnedMessageId === message.id;
          const mine = message.authorUserId === currentUserId;
          // Na live toda mensagem nasce na linha mestre (D31): o selo diria o mesmo em todas.
          const master = message.master && session.kind !== "live";

          return (
            <RoomChatBubble
              extraRole={meta.origin}
              footer={editorOf(message)}
              key={message.id}
              message={{ body: message.body, displayName: message.displayName, id: message.id, mine, pending: false, role: message.role }}
              metaActions={
                <>
                  {pinned ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-room-fg-muted">{copy.pinned}</span>
                    </>
                  ) : null}
                  {master ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-room-fg-muted">{copy.master}</span>
                    </>
                  ) : null}
                  {canAct ? (
                    <span className={cn(LINE_ACTIONS, mine ? "pointer-fine:left-0" : "pointer-fine:right-0")} data-console-message-actions="">
                      <span aria-hidden="true" className="pr-1 pointer-fine:hidden">
                        ·
                      </span>
                      {actions.pin ? (
                        <button aria-label={`${copy.pin}: ${message.displayName}`} className={cn(LINE_ACTION, "text-room-fg-strong hover:underline")} disabled={busy} onClick={() => onModerate("pin", message.id)} type="button">
                          {copy.pin}
                        </button>
                      ) : null}
                      {actions.unpin ? (
                        <button aria-label={`${copy.unpin}: ${message.displayName}`} className={cn(LINE_ACTION, "text-room-fg-strong hover:underline")} disabled={busy} onClick={() => onModerate("unpin", message.id)} type="button">
                          {copy.unpin}
                        </button>
                      ) : null}
                      {actions.question ? (
                        <button aria-label={`${v2.virarPergunta}: ${message.displayName}`} className={cn(LINE_ACTION, "text-room-fg-strong hover:underline")} disabled={busy} onClick={() => onModerate("question", message.id)} type="button">
                          {v2.virarPergunta}
                        </button>
                      ) : null}
                      <button aria-label={`${copy.delete}: ${message.displayName}`} className={cn(LINE_ACTION, "text-room-fg-muted hover:text-room-fg-strong hover:underline")} disabled={busy} onClick={() => onModerate("delete", message.id)} type="button">
                        {copy.delete}
                      </button>
                      {menuOf(message, actions, "min-w-6 justify-center text-room-fg-muted hover:text-room-fg-strong")}
                    </span>
                  ) : null}
                </>
              }
              time={meta.time}
              widthClassName={BUBBLE_WIDTH}
            />
          );
        })}
      </ol>

      <div className="flex shrink-0 items-center gap-2 border-t border-room-border bg-room-composer p-2">
        <label className="sr-only" htmlFor="console-composer">
          {copy.composer}
        </label>
        {/* A linha de 20 px cabe nos 44 px com a borda e o respiro (1 + 10 + 20 + 10 + 1), como o campo da sala. */}
        <textarea
          className={cn(FIELD, "min-h-11 flex-1 resize-none py-2.5")}
          disabled={!canAct || sending}
          id="console-composer"
          maxLength={CHAT_LIMITS.body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={copy.composer}
          rows={1}
          value={body}
        />
        <RoomIconButton disabled={!canAct || sending || !body.trim()} label={copy.send} onClick={() => void submit()} size={44} tone="primary">
          <SendHorizontal aria-hidden="true" />
        </RoomIconButton>
      </div>
    </div>
  );
}

/** Um seletor compacto do cabecalho do chat: o rotulo visivel, o valor e a seta, em 30 px. */
function CompactSelect<T extends string>({ disabled, id, label, onChange, options, value }: { disabled: boolean; id: string; label: string; onChange: (value: T) => void; options: readonly { label: string; value: T }[]; value: T }) {
  return (
    <div className="relative inline-flex h-[30px] max-w-full min-w-0 items-center gap-1.5 rounded-lg border border-room-border-strong bg-room-control pl-2.5 text-xs">
      <label className="shrink-0 text-room-fg-muted" htmlFor={id}>
        {label}
      </label>
      <select
        className={cn("h-full min-w-0 cursor-pointer appearance-none truncate rounded-r-lg bg-transparent pr-7 font-medium text-room-fg-strong disabled:cursor-default disabled:opacity-45", ROOM_FOCUS)}
        disabled={disabled}
        id={id}
        onChange={(event) => {
          const next = options.find((option) => option.value === event.target.value);
          if (next) {
            onChange(next.value);
          }
        }}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2.5 size-3 -translate-y-1/2 text-room-fg-muted" />
    </div>
  );
}

/** O ⋯ de uma mensagem, no portal da raiz do console (no tema dela). */
function MessageMenu({ busy, children, name, triggerClassName }: { busy: boolean; children: ReactNode; name: string; triggerClassName: string }) {
  const portal = useConsolePortal();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={v2.maisAcoes(name)} className={cn(LINE_ACTION, triggerClassName)} disabled={busy}>
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn(adminMenuPopup, "w-64 bg-room-surface text-room-fg")} container={portal}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

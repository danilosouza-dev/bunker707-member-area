"use client";

import { MessageCircleQuestionMark, MoreVertical, Pin, PinOff, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { chatListOnShow } from "@/components/member/webinars/room/room-chat";
import { RoomComment, RoomCommentAvatar } from "@/components/member/webinars/room/room-comment";
import { RoomCommentField } from "@/components/member/webinars/room/room-comment-field";
import { composerExpandedStep } from "@/components/member/webinars/room/room-composer-model";
import { RoomPill, roomPillClassName } from "@/components/member/webinars/room/room-pill";
import { RoomSelectPill } from "@/components/member/webinars/room/room-select-pill";
import { ROOM_FOCUS, RoomIconButton } from "@/components/member/webinars/room/room-ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { ModerationAction } from "@/server/webinars/chat-schemas";
import {
  CHAT_MODE_OPTIONS,
  SLOW_MODE_CHOICES,
  consoleChatFocusAfter,
  consoleChatQueue,
  consoleComment,
  consoleMessageMeta,
  messageActions,
  slowModeChoiceOf,
  slowModeFromChoice,
  type ConsoleChatFocusFrom,
  type ConsoleChatFocusTo,
  type ConsoleMessage,
  type MessageActions,
  type SlowModeChoice
} from "@/server/webinars/console-model";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import { CHAT_LIMITS, type ChatMode, type SlowModeSeconds, type WebinarSession } from "@/server/webinars/model";
import { adminMenuItem, adminMenuPopup, adminMenuSeparator } from "../../../styles";
import { ConsolePinned, consoleMessageBody } from "./console-pinned";
import { useConsolePortal } from "./console-shell";

// A aba Chat do console (docs/30 §2.4 e §8.3; docs/31 V2-15; o estilo do YouTube, docs/31 §10), direto no cartao do
// painel, pelos tokens do tema do console. Em cima, "Quem escreve" e "Modo lento" em duas pilulas tonais com o seletor
// nativo (os mesmos valores e a mesma acao de antes; o modo lento desligado com o chat desligado) e, a direita, "{n}
// aguardando". As pendentes do chat moderado saem da lista e viram cards ambar no topo, a mais velha primeiro: "Na
// moderação · nome · hora", o texto, Liberar (a pilula branca), Recusar (o apagar da pendente) e Virar pergunta (so a
// mensagem comum de um aluno; a pergunta pelo chat ja vira pergunta no Liberar) e o ⋮. A lista (um role=log que rola,
// com o nome "Chat" e aria-live desligado: quem modera le a lista, e cada mensagem nova chegaria lida com os botoes
// dela; dentro dele, a <ol> continua lista) usa o comentario do YouTube da sala (RoomComment, consoleComment): o avatar
// de 24, o nome ("Você" na minha), o selo do papel ou da origem que so a equipe ve (Roteiro, Chat original) e a hora; em
// cima, "Fixada" e, fora da live, "Nas próximas turmas" (na live toda mensagem nasce na linha mestre, D31). As acoes de
// cada mensagem sao circulos de 32 sem fundo (Fixar ou Desafixar, Virar pergunta, Apagar e o ⋮ com Aprovar para as
// próximas turmas, so com o aceite do autor; sem ele, a frase do porque; Corrigir resposta, no Assistente, o texto novo
// embaixo do comentario; com ele aberto, as acoes saem, para nao cobrir o Salvar correção; Refazer tradução e, na live,
// os itens da pessoa, LivePersonMenuItems): com o mouse, numa pilula por cima do canto de cima a direita do item, que
// aparece com o mouse ou o foco dentro dele; no toque, sempre na tela, no fim da linha. O nome de cada circulo diz a acao
// e de quem e a mensagem ("Fixar: Ana M."). O foco nunca cai no comeco da pagina quando o botao sai da tela
// (consoleChatFocusAfter): o Liberar e o Recusar levam ao card seguinte (sem card, ao cabecalho), o Virar pergunta ao
// botao seguinte do item, o Apagar ao comentario seguinte, e a correcao fechada ao ⋮ da mensagem. Embaixo, o campo
// "Escreva para a turma" do YouTube (RoomCommentField, com o icone da equipe; o Enter envia, o Shift+Enter quebra a
// linha; durante o envio o campo continua com o foco). A lista enche a aba a partir de lg e cola no fim quando a pessoa
// ja estava no fim, tambem quando a aba volta a tela (`shown`: a lista escondida nao rola com o que chega,
// chatListOnShow, como na sala). O ⋮ abre no portal da raiz do console. Nenhuma frase escrita aqui.
// A Na tela (docs/30 §2.4; especificacao de 10/11/2026, R1 e §6.2): com o campo aberto, a pilula "Fixar ao enviar"
// (aria-pressed, desligada por padrao) embaixo do texto: ligada, o Enviar publica e fixa num passo, e ela desliga
// sozinha depois de cada envio (e no Cancelar). Acima da lista, fora da rolagem, o bloco "Fixada agora"
// (console-pinned.tsx) com o Desafixar, lido do retrato pela chave (`pinned`, mesmo fora das 200 da lista). Os enderecos
// `https://` das mensagens da equipe viram link na lista e no bloco (consoleMessageBody); a de aluno continua texto.

const copy = WEBINAR_ADMIN_COPY.console.chat;
const v2 = WEBINAR_COPY.consoleV2.chat;
const assistantCopy = WEBINAR_COPY.assistente.console;
const naTelaChat = WEBINAR_COPY.naTela.chat;

/**
 * As acoes da mensagem. Com o mouse (pointer-fine), uma pilula no fundo dos menus por cima do canto de cima a direita do
 * item, escondida ate o mouse ou o foco entrar nele (ou o ⋮ abrir): escondida, nao ocupa lugar, e o foco do teclado
 * chega nela do mesmo jeito. No toque, sempre na tela, no fim da linha do comentario.
 */
const TOOLBAR = cn(
  "ml-1 flex shrink-0 items-center gap-0.5 self-start transition-opacity motion-reduce:transition-none",
  "pointer-fine:absolute pointer-fine:-top-2 pointer-fine:right-0 pointer-fine:z-10 pointer-fine:ml-0 pointer-fine:rounded-full pointer-fine:bg-room-menu pointer-fine:p-0.5 pointer-fine:shadow-[var(--room-menu-shadow)]",
  "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 pointer-fine:has-[[data-popup-open]]:opacity-100"
);
/** O circulo de 32 sem fundo do ⋮ (o gatilho do menu nao e um RoomIconButton). */
const MENU_TRIGGER = cn(
  "relative grid size-8 shrink-0 place-items-center rounded-full text-room-icon transition-colors after:absolute after:-inset-1.5 hover:bg-room-control-hover disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none [&_svg]:size-4",
  ROOM_FOCUS
);

type ConsoleChatProps = {
  /** As mensagens que ja viraram pergunta (o `askedMessageIds` do retrato): ficam sem o Virar pergunta. */
  askedMessageIds: readonly string[];
  busyKey: string | null;
  canAct: boolean;
  /** A foto do proprio perfil de quem esta no console (o avatar do campo da equipe); sem ela, o icone da equipe. */
  currentUserAvatarUrl?: string | null;
  currentUserId: string;
  hostUserId: string | null;
  messages: readonly ConsoleMessage[];
  onChatMode: (chatMode: ChatMode, slowModeSeconds: SlowModeSeconds | null) => void;
  /** A correcao aberta na montagem (o teste de tela; o console sempre comeca sem nenhuma). */
  initialEditing?: { body: string; id: string } | null;
  /** O campo da equipe aberto na montagem (o teste de tela; o console sempre comeca com ele fechado). */
  initialComposerOpen?: boolean;
  /** A hora do servidor agora (o relogio do console): o "há 2 min" do bloco Fixada agora. */
  nowMs?: number;
  /** Fase 4c: "Corrigir resposta" numa resposta do Assistente (devolve se gravou). */
  onEditAssistant?: ((messageId: string, body: string) => Promise<boolean>) | null;
  /** Devolve, quando pode, a promessa da acao (resolvida com o retrato novo): o foco segue depois dela. */
  onModerate: (action: ModerationAction, messageId: string) => Promise<boolean> | void;
  /** Fase 4f: "Refazer tradução" (apaga a traducao guardada do texto); nulo com a traducao desligada no ambiente. */
  onRetranslate?: ((messageId: string) => void) | null;
  /** O envio da equipe; `pin` e o "Fixar ao enviar" ligado (publica e fixa num passo). Devolve se gravou. */
  onSend: (body: string, pin: boolean) => Promise<boolean>;
  /**
   * Fase 3: os itens da pessoa (Silenciar no chat, Remover, Banir) no ⋯ de uma mensagem da turma; nulo fora da Live ao
   * vivo. Devolve nulo quando nao ha item para aquela pessoa (a equipe, quem nao esta no retrato).
   */
  personMenu?: ((message: ConsoleMessage) => ReactNode) | null;
  /** A fixada lida pela chave (snapshot.pinned): o bloco Fixada agora, tambem para uma mensagem fora da lista. */
  pinned?: ConsoleMessage | null;
  pinnedMessageId: string | null;
  session: WebinarSession;
  /**
   * A aba Chat na tela (o painel aberto, a aba escolhida). Escondida, a lista nao rola com o que chega; ao voltar, quem
   * estava no fim volta ao fim. Sem a prop (o teste de tela), na tela.
   */
  shown?: boolean;
};

export function ConsoleChat({
  askedMessageIds,
  busyKey,
  canAct,
  currentUserAvatarUrl = null,
  currentUserId,
  initialComposerOpen = false,
  initialEditing = null,
  messages,
  nowMs = Number.NaN,
  onChatMode,
  onEditAssistant = null,
  onModerate,
  onRetranslate = null,
  onSend,
  personMenu = null,
  pinned = null,
  pinnedMessageId,
  session,
  shown = true
}: ConsoleChatProps) {
  const [body, setBody] = useState("");
  // O campo da equipe aberto (o rodape com o Cancelar e o Enviar), guardado pela regra da sala (composerExpandedStep).
  const [expanded, setExpanded] = useState(initialComposerOpen);
  // O "Fixar ao enviar": desligado por padrao e de novo depois de cada envio (e no Cancelar).
  const [pinOnSend, setPinOnSend] = useState(false);
  const [editing, setEditing] = useState<{ body: string; id: string } | null>(initialEditing);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToEnd = useRef(true);
  // Para onde o foco vai no proximo desenho (pelos ids de cada parte depois da acao) e o sinal que pede esse desenho.
  const focusRequest = useRef<((now: { log: readonly string[]; pending: readonly string[] }) => ConsoleChatFocusTo) | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const sending = busyKey === "send";
  const { log, pending } = useMemo(() => consoleChatQueue(messages), [messages]);
  const asked = useMemo(() => new Set(askedMessageIds), [askedMessageIds]);
  const modeBusy = !canAct || busyKey === "chat-mode";

  // Pela ultima mensagem, nao pela contagem: o retrato traz no maximo as 200 mais novas, e com 200 a contagem para.
  const lastLogId = log.at(-1)?.id ?? null;

  useEffect(() => {
    const list = listRef.current;

    if (list && stickToEnd.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [lastLogId]);

  // A aba voltou a tela: a lista escondida nao rolou com o que chegou; quem estava no fim volta ao fim, antes do desenho
  // (e antes do evento de rolagem que recalcula o stickToEnd).
  useLayoutEffect(() => {
    chatListOnShow(listRef.current, { shown, stick: stickToEnd.current });
  }, [shown]);

  // O foco depois da acao, ja com o retrato novo na tela: so quando ele caiu no comeco da pagina (o botao saiu ou ficou
  // desligado durante a acao); quem ja foi para outro lugar fica onde esta.
  useEffect(() => {
    const request = focusRequest.current;

    if (!request) {
      return;
    }

    focusRequest.current = null;
    const active = document.activeElement;

    if (active && active !== document.body) {
      return;
    }

    focusChatTarget(rootRef.current, request({ log: log.map((message) => message.id), pending: pending.map((message) => message.id) }));
  }, [focusTick, log, pending]);

  function requestFocus(request: (now: { log: readonly string[]; pending: readonly string[] }) => ConsoleChatFocusTo) {
    focusRequest.current = request;
    setFocusTick((tick) => tick + 1);
  }

  /** De onde a acao saiu: a parte, a posicao do item nela e a do botao entre os do item. */
  function focusFrom(message: ConsoleMessage, button: Element | null): ConsoleChatFocusFrom {
    const area = pending.some((entry) => entry.id === message.id) ? "queue" : "log";
    const item = button?.closest("[data-room-message]");
    const buttons = item ? Array.from(item.querySelectorAll("[data-console-action]")) : [];
    const index = (area === "queue" ? pending : log).findIndex((entry) => entry.id === message.id);
    return { area, id: message.id, index, position: button ? Math.max(0, buttons.indexOf(button)) : Number.MAX_SAFE_INTEGER };
  }

  /** Uma acao de um botao da linha ou do card: depois dela (com o retrato novo), o foco segue. */
  async function act(action: ModerationAction, message: ConsoleMessage, event: MouseEvent<HTMLButtonElement>) {
    const from = focusFrom(message, event.currentTarget);
    await onModerate(action, message.id);
    requestFocus((now) => consoleChatFocusAfter(from, now));
  }

  /** Fecha a correcao: o foco volta ao ultimo botao do item (o ⋯ de onde ela abriu). */
  function closeEditor(message: ConsoleMessage) {
    const from = focusFrom(message, null);
    setEditing(null);
    requestFocus((now) => consoleChatFocusAfter(from, now));
  }

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

    if (await onSend(text, pinOnSend)) {
      setBody("");
      setPinOnSend(false);
      setExpanded((current) => composerExpandedStep(current, { draft: "", type: "sent" }));
      stickToEnd.current = true;
    }
  }

  /** O Desafixar do bloco Fixada agora: o bloco sai da tela, e o foco vai a caixa da equipe (nunca ao comeco da pagina). */
  async function unpinFromBlock(message: ConsoleMessage) {
    await onModerate("unpin", message.id);
    requestFocus(() => ({ area: "composer" }));
  }

  async function saveEdit(message: ConsoleMessage) {
    const text = editing?.body.trim() ?? "";

    if (!editing || !text || !onEditAssistant) {
      return;
    }

    if (await onEditAssistant(editing.id, text)) {
      closeEditor(message);
    } else {
      // O campo ficou desligado durante a gravacao: o foco volta para ele.
      requestFocus(() => ({ area: "edit", id: message.id }));
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
          autoFocus
          className="min-h-16 w-full rounded-[12px] border border-room-input-border bg-room-input-bg px-3 py-2 text-base leading-5 text-room-fg placeholder:text-room-fg-subtle disabled:opacity-50 lg:text-sm"
          disabled={busy}
          id={`console-edit-${message.id}`}
          maxLength={CHAT_LIMITS.body}
          onChange={(event) => setEditing({ body: event.target.value, id: message.id })}
          rows={3}
          value={editing.body}
        />
        <div className="flex flex-wrap justify-end gap-1.5">
          <RoomPill disabled={busy} label={assistantCopy.cancelar} onClick={() => closeEditor(message)} size="s" tone="text" />
          <RoomPill disabled={busy || !editing.body.trim()} label={assistantCopy.salvarCorrecao} onClick={() => void saveEdit(message)} size="s" tone="tonal" />
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

  /** As acoes de uma mensagem da lista (circulos de 32 com o nome da acao e de quem e a mensagem) e o ⋮. */
  function toolbarOf(message: ConsoleMessage, actions: MessageActions): ReactNode {
    const busy = busyKey === `moderate:${message.id}`;
    const name = message.displayName;
    return (
      <span className={TOOLBAR} data-console-message-actions="">
        {actions.pin ? (
          <RoomIconButton data-console-action="" disabled={busy} label={`${copy.pin}: ${name}`} onClick={(event) => void act("pin", message, event)} size={32} tone="ghost">
            <Pin aria-hidden="true" />
          </RoomIconButton>
        ) : null}
        {actions.unpin ? (
          <RoomIconButton data-console-action="" disabled={busy} label={`${copy.unpin}: ${name}`} onClick={(event) => void act("unpin", message, event)} size={32} tone="ghost">
            <PinOff aria-hidden="true" />
          </RoomIconButton>
        ) : null}
        {actions.question ? (
          <RoomIconButton data-console-action="" disabled={busy} label={`${v2.virarPergunta}: ${name}`} onClick={(event) => void act("question", message, event)} size={32} tone="ghost">
            <MessageCircleQuestionMark aria-hidden="true" />
          </RoomIconButton>
        ) : null}
        <RoomIconButton data-console-action="" disabled={busy} label={`${copy.delete}: ${name}`} onClick={(event) => void act("delete", message, event)} size={32} tone="ghost">
          <Trash2 aria-hidden="true" />
        </RoomIconButton>
        {menuOf(message, actions, "")}
      </span>
    );
  }

  return (
    <div className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1" ref={rootRef}>
      {/* O corpo do painel corta a partir de lg e este cabecalho e o primeiro filho: as pilulas pedem 4 px em cima para o anel de foco. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 pb-3 lg:px-4 lg:pt-1" data-console-chat-header="">
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
          <span className="ml-auto text-xs leading-[18px] font-medium whitespace-nowrap text-room-warn-fg tabular-nums" data-console-chat-waiting="">
            {v2.aguardando(pending.length)}
          </span>
        ) : null}
      </div>

      {pending.length > 0 ? (
        <ol aria-label={copy.pending} className="relative flex max-h-56 min-w-0 shrink-0 flex-col gap-2 overflow-y-auto pb-3 lg:max-h-[35%] lg:px-4" data-console-chat-queue="">
          {pending.map((message) => {
            const actions = actionsOf(message);
            const busy = busyKey === `moderate:${message.id}`;
            const time = metaOf(message).time;

            return (
              <li className="flex min-w-0 flex-col gap-1.5 rounded-[12px] border border-room-warn-border bg-room-warn-bg px-3 py-2.5" data-console-pending="" data-room-message={message.id} key={message.id}>
                <p className="text-xs leading-[18px] font-medium text-room-warn-fg">{[copy.pending, message.displayName, time].filter(Boolean).join(" · ")}</p>
                <p className="text-sm leading-5 break-words whitespace-pre-line text-room-fg">{message.body}</p>
                {editorOf(message)}
                {canAct ? (
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                    <button aria-label={`${copy.approve}: ${message.displayName}`} className={roomPillClassName({ size: "s", tone: "white" })} data-console-action="" disabled={busy} onClick={(event) => void act("approve", message, event)} type="button">
                      {copy.approve}
                    </button>
                    <button aria-label={`${v2.recusar}: ${message.displayName}`} className={roomPillClassName({ size: "s", tone: "tonal" })} data-console-action="" disabled={busy} onClick={(event) => void act("delete", message, event)} type="button">
                      {v2.recusar}
                    </button>
                    {actions.question ? (
                      <button aria-label={`${v2.virarPergunta}: ${message.displayName}`} className={roomPillClassName({ size: "s", tone: "tonal" })} data-console-action="" disabled={busy} onClick={(event) => void act("question", message, event)} type="button">
                        {v2.virarPergunta}
                      </button>
                    ) : null}
                    {menuOf(message, actions, "bg-room-control")}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {pinned ? (
        <ConsolePinned
          author={consoleComment({ kind: session.kind, message: pinned, mine: pinned.authorUserId === currentUserId, scheduledAt: session.scheduledAt }).name}
          busy={busyKey === `moderate:${pinned.id}`}
          canAct={canAct}
          message={pinned}
          nowMs={nowMs}
          onUnpin={() => void unpinFromBlock(pinned)}
        />
      ) : null}

      <div
        aria-label={copy.title}
        aria-live="off"
        className="relative flex min-h-48 min-w-0 flex-col overflow-y-auto border-t border-room-border pt-4 max-lg:max-h-[60vh] lg:min-h-0 lg:flex-1 lg:px-4"
        data-console-chat=""
        onScroll={trackScroll}
        ref={listRef}
        role="log"
      >
        <ol className="flex min-h-full min-w-0 flex-col">
          {log.length === 0 ? <li className="my-auto px-2 py-6 text-center text-sm leading-5 text-room-fg-subtle">{copy.empty}</li> : null}
          {log.map((message) => {
            const actions = actionsOf(message);
            const pinned = pinnedMessageId === message.id;
            const mine = message.authorUserId === currentUserId;
            const comment = consoleComment({ kind: session.kind, message, mine, scheduledAt: session.scheduledAt });
            // Na live toda mensagem nasce na linha mestre (D31): o selo diria o mesmo em todas.
            const master = message.master && session.kind !== "live";
            // Com a correcao aberta, as acoes (por cima do item) cobririam o Cancelar e o Salvar correção.
            const showActions = canAct && editing?.id !== message.id;
            const headline =
              pinned || master ? (
                <>
                  {pinned ? (
                    <>
                      <Pin aria-hidden="true" className="size-3.5" />
                      <span>{copy.pinned}</span>
                    </>
                  ) : null}
                  {pinned && master ? <span aria-hidden="true">·</span> : null}
                  {master ? <span>{copy.master}</span> : null}
                </>
              ) : null;

            return (
              <RoomComment
                actions={editorOf(message)}
                aside={showActions ? toolbarOf(message, actions) : null}
                avatar={<RoomCommentAvatar imageSrc={message.avatarUrl} kind={comment.avatar} name={message.displayName} />}
                body={consoleMessageBody(message)}
                className="group relative"
                headline={headline}
                id={message.id}
                key={message.id}
                meta={{ name: comment.name, role: comment.role, time: comment.time }}
                mine={mine}
                srAuthor={comment.srAuthor}
              />
            );
          })}
        </ol>
      </div>

      <RoomCommentField
        ariaLabel={copy.composer}
        avatar={{ imageSrc: currentUserAvatarUrl, kind: "team", name: null }}
        busy={sending}
        disabled={!canAct}
        expanded={expanded}
        hint={
          canAct ? (
            // O clique na pilula nao tira o foco do campo (como o rodape do campo): o campo continua aberto.
            <div className="flex" data-console-pin-on-send="" onMouseDown={(event) => event.preventDefault()}>
              <RoomPill
                aria-pressed={pinOnSend}
                disabled={sending}
                icon={Pin}
                iconFilled={pinOnSend}
                label={naTelaChat.fixarAoEnviar}
                onClick={() => setPinOnSend((on) => !on)}
                size="s"
                tone={pinOnSend ? "white" : "tonal"}
              />
            </div>
          ) : null
        }
        id="console-composer"
        maxLength={CHAT_LIMITS.body}
        mode="enter"
        onCancel={() => {
          setBody("");
          setPinOnSend(false);
        }}
        onChange={setBody}
        onExpandedChange={setExpanded}
        onSubmit={() => void submit()}
        placeholder={copy.composer}
        submitLabel={copy.send}
        value={body}
      />
    </div>
  );
}

/**
 * Um seletor compacto do cabecalho do chat: a pilula tonal de 32 px com o rotulo visivel, o valor e a seta (a mesma
 * peca do "Idioma do chat" da sala, com o anel de foco na pilula inteira).
 */
function CompactSelect<T extends string>({ disabled, id, label, onChange, options, value }: { disabled: boolean; id: string; label: string; onChange: (value: T) => void; options: readonly { label: string; value: T }[]; value: T }) {
  return <RoomSelectPill disabled={disabled} id={id} label={label} onChange={onChange} options={options} value={value} />;
}

/** O ⋯ de uma mensagem, no portal da raiz do console (no tema dela). */
function MessageMenu({ busy, children, name, triggerClassName }: { busy: boolean; children: ReactNode; name: string; triggerClassName: string }) {
  const portal = useConsolePortal();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={v2.maisAcoes(name)} className={cn(MENU_TRIGGER, triggerClassName)} data-console-action="" disabled={busy} title={v2.maisAcoes(name)}>
        <MoreVertical aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn(adminMenuPopup, "w-64 bg-room-menu text-room-fg")} container={portal}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Leva o foco ao alvo de consoleChatFocusAfter: o botao do item na posicao pedida (presa ao ultimo), o primeiro seletor
 * do cabecalho, a caixa ou o campo da correcao. Sem o alvo (ou desligado), a caixa da equipe; desligada, nada.
 */
function focusChatTarget(root: HTMLElement | null, target: ConsoleChatFocusTo) {
  if (!root) {
    return;
  }

  const usable = (element: Element | null | undefined): element is HTMLElement => element instanceof HTMLElement && element.isConnected && !element.matches(":disabled");
  const byId = (id: string) => root.ownerDocument.getElementById(id);
  let element: Element | null | undefined = null;

  if (target.area === "header") {
    element = byId("console-chat-mode");
  } else if (target.area === "composer") {
    element = byId("console-composer");
  } else if (target.area === "edit") {
    element = byId(`console-edit-${target.id}`);
  } else {
    const list = root.querySelector(target.area === "queue" ? "[data-console-chat-queue]" : "[data-console-chat]");
    const item = list ? Array.from(list.querySelectorAll("[data-room-message]")).find((entry) => entry.getAttribute("data-room-message") === target.id) : undefined;
    const buttons = item ? Array.from(item.querySelectorAll("[data-console-action]")) : [];
    element = buttons[Math.min(target.position, buttons.length - 1)];
  }

  const fallback = byId("console-composer");
  const next = usable(element) ? element : usable(fallback) ? fallback : null;
  next?.focus();
}

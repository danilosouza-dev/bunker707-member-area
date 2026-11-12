"use client";

import { EllipsisVertical, MoreHorizontal, SendHorizontal } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { MemberAvatar } from "@/components/member/ui/member-avatar";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import {
  chatAgoLabel,
  chatRoleLabel,
  chatTimeAt,
  chatTimeLabel,
  composerState,
  roleBadgeOnly,
  type ChatTimeKind,
  type ComposerState,
  type RoomMessage
} from "@/lib/webinar-room-client";
import { ASSISTANT_WAIT_MS, assistantRepliesToMe, mentionsAssistant, studentAtAssistantLimit } from "@/server/webinars/assistant-model";
import { CHAT_CONSENT_VERSION, CHAT_LIMITS, type ChatMode, type ChatRole, type SimulatedPhase } from "@/server/webinars/model";
import { AssistantHandoff } from "./assistant/assistant-handoff";
import { AssistantHint, type AssistantHintState } from "./assistant/assistant-hint";
import { ownAssistantEnabled, useRoomAssistant, type RoomAssistant } from "./assistant/use-room-assistant";
import type { ChatPostBody } from "./room-api";
import { RoomComment, RoomCommentAvatar, type RoomCommentTime } from "./room-comment";
import { RoomCommentField, RoomCommentFieldNotice } from "./room-comment-field";
import { composerExpandedStep } from "./room-composer-model";
import { menuOpenKey } from "./room-layout-model";
import { RoomMenu } from "./room-menu";
import { RoomPill } from "./room-pill";
import { useRoomSnackbar, useRoomSnackbarListInset } from "./room-snackbar";
import { RoomTooltip } from "./room-tooltip";
import { RoomBadge, RoomButton, RoomIconButton, type RoomBadgeTone } from "./room-ui";
import { RoomTeamText } from "./screen/room-team-text";
import { verticalChatAnnouncement } from "./vertical/vertical-model";

// O painel do chat da Sala (docs/30 §1.3, §1.6, §8.5 e §9): a lista em role="log" (em rajada, o leitor de tela
// ouve "N mensagens novas" em vez de cada uma), os selos Equipe / Apresentador /
// Assistente, a pendente do proprio aluno ("Aguardando a equipe"), o aceite na primeira mensagem (o texto de §8.5,
// palavra por palavra, com "Entendi e quero participar" e Cancelar; sem anonimo e sem apelido desde 10/11/2026, D64), o
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
// minha a direita. Sai a linha do rotulo "Chat" (repetia a aba) e o menu ⋯ vai para a linha do campo, a esquerda. A
// hora: na live, a que o servidor gravou (`sentAt`); na gravada, a hora marcada mais o offset; no Replay, nenhuma. O
// chat por cima do video no vertical (vertical-chat.tsx) continua com o item de antes (RoomMessageItem, V2-18); a
// gaveta do vertical abre este mesmo painel, com o balao.
// A sala no estilo do YouTube (docs/31; spec §7.4 e §8): no desenho normal (`look="comment"`, o padrao) cada mensagem e
// o comentario do YouTube (RoomComment): o avatar de 24, o nome sem "@", o selo tonal do papel, o tempo relativo
// ("há 2 minutos", contra o agora do servidor: `skewMs`) com a hora exata no title, e o texto 14/20 com o "@assistente"
// em peso 600; a minha a esquerda como as outras, com "Você"; a pendente e o "Falar com a equipe" na linha de acoes; o
// Assistente com o selo no lugar do nome. A lista comeca em cima e o chat curto fica embaixo pelo margin-top auto do
// primeiro item (nunca justify-content: flex-end, que deixaria as antigas fora do alcance); quando a lista muda de
// tamanho, quem estava no fim continua no fim. A partir de lg o ⋯ sai da linha do campo e vira o ⋮ do cabecalho do painel
// (RoomChatMoreButton); abaixo de lg, onde o cabecalho nao aparece, o ⋯ fica na linha do campo, como antes. A
// confirmacao de remover continua aqui, aberta pela sala (`removeOpen`). A gaveta do vertical passa `look="classic"`, o
// balao de antes. O console continua com o RoomChatBubble.
// A Na tela (especificacao de 10/11/2026, §3.1): a fixada saiu daqui (do comentario e do balao da gaveta) e virou a
// area das fixadas do proprio painel, em todas as abas (screen/room-pinned.tsx, no espaco `pinned` do RoomPanel e no
// topo da gaveta do vertical). O texto de cada mensagem passa pelo RoomTeamText (screen/room-team-text.tsx): o endereco
// `https://` de uma mensagem da equipe vira link (o `links` do servidor); a de aluno continua texto. O comentario
// (RoomChatComment) e o tempo dele (roomCommentTime) ficam exportados para a fixada usar o mesmo desenho.

export type RoomChatPanelProps = {
  /** Fase 4b: o que fica logo acima do campo (a entrada simulada "Ana M. entrou", docs/30 §1.6). */
  aboveComposer?: ReactNode;
  /**
   * Redesign V2, F3: o Assistente que a sala ja le (o mesmo estado do selo do palco, docs/31 V2-4). Com ele, o painel
   * nao le de novo; sem ele (a gaveta antiga, os testes), o painel le sozinho como antes.
   */
  assistant?: RoomAssistant;
  /** A minha foto do perfil (o avatar do campo, tambem antes do aceite: so eu vejo, D82); sem ela, as minhas iniciais. */
  avatarUrl?: string | null;
  busy?: boolean;
  chatMode: ChatMode;
  consented: boolean;
  /** O meu nome (D64), para as iniciais do avatar do campo sem a foto, tambem antes do aceite (D82); sem ele, a pessoa. */
  displayName: string | null;
  error: string | null;
  messages: readonly RoomMessage[];
  /** Fase 3: a frase que toma o lugar do campo (silenciado no chat, sala que ainda nao abriu); nulo, o campo fica. */
  notice?: string | null;
  nowMs: number;
  onRemoveMine: () => Promise<number>;
  onSend: (body: Omit<ChatPostBody, "sessionId">) => Promise<{ pending: boolean }>;
  phase: SimulatedPhase | "replay";
  /** "Ver como" da equipe: mostra, mas nao grava. */
  readOnly: boolean;
  /** Fase 4c: a sessao (com o webinario, liga a dica do Assistente e o "Falar com a equipe"). */
  sessionId?: string | null;
  /**
   * O painel que leva o chat esta na tela (docs/31 V2-7; padrao: sim). Fechado, o painel fica montado e escondido, e a
   * lista escondida nao rola com as mensagens que chegam: ao reabrir, ela vai ao fim (quem estava no fim ve as novas que
   * o balao contou; quem tinha subido para ler continua onde estava).
   */
  shown?: boolean;
  slowUntilMs: number | null;
  /**
   * Redesign V2, F6 (V2-9): de que sala e a hora embaixo do balao (chatTimeLabel): na "live", a hora em que o servidor
   * gravou a mensagem (`sentAt`); na "simulated", o `zeroMs` mais o offset; no "replay", nenhuma. Obrigatoria: sem ela
   * a hora sumiria sem erro nenhum.
   */
  timeKind: ChatTimeKind;
  /** Fase 4c: o webinario (com a sessao, liga a dica do Assistente e o "Falar com a equipe"). */
  webinarId?: string | null;
  /** So na gravada: o zero da sessao em ms (a hora marcada), para a hora das mensagens. */
  zeroMs?: number | null;
  /** "comment": o comentario do YouTube (o desenho normal, o padrao); "classic": o balao de antes (a gaveta do vertical). */
  look?: "classic" | "comment";
  /** No comentario: a confirmacao de remover as minhas mensagens aberta pela sala (o ⋮ do cabecalho do painel). */
  onRemoveOpenChange?: (open: boolean) => void;
  removeOpen?: boolean;
  /** A diferenca do relogio do aparelho para o do servidor: o tempo do comentario conta do agora do servidor. */
  skewMs?: number;
};

const ROLE_BADGES: Partial<Record<ChatRole, { label: string; tone: RoomBadgeTone }>> = {
  ai: { label: WEBINAR_COPY.sala.selos.assistente, tone: "outline" },
  co_host: { label: WEBINAR_COPY.sala.selos.coApresentador, tone: "neutral" },
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
      <p className="whitespace-pre-line break-words text-sm leading-5 text-room-fg">
        <RoomTeamText message={message} />
      </p>
      {footer}
    </li>
  );
}

/** A coluna do balao e da linha de baixo na sala: ate 270 px, 230 px a partir de lg (o painel de 320 px). */
const BUBBLE_COLUMN = "flex min-w-0 max-w-[270px] flex-col gap-1 lg:max-w-[230px]";

export type RoomChatBubbleProps = {
  footer?: ReactNode;
  /** `links`: o servidor ligou os links da equipe (RoomTeamText); sem ele, o texto como veio. */
  message: Pick<RoomMessage, "body" | "displayName" | "id" | "mine" | "pending" | "role"> & { avatarUrl?: string | null; links?: boolean };
  /**
   * O console: o que entra na linha de baixo depois da hora (Fixada, as acoes da mensagem). Com ele, a linha e um <div>
   * (os botoes e o menu nao cabem num <p>) e o item ganha o `group` e o `relative` (as acoes aparecem com o mouse ou o
   * foco, por cima da linha).
   */
  metaActions?: ReactNode;
  /** O que a pendente diz na linha de baixo (padrao: o "Aguardando a equipe" do aluno). */
  pendingLabel?: string;
  /**
   * O console (docs/31 V2-15): o que a linha diz no lugar do papel, o papel ou a origem que so a equipe ve (Roteiro,
   * Chat original); nulo, nada. Sem a prop, o papel como a sala mostra (chatRoleLabel).
   */
  roleLabel?: string | null;
  time: string;
  /** A largura da coluna do balao (padrao: a da sala, BUBBLE_COLUMN). */
  widthClassName?: string;
};

/**
 * Uma mensagem do painel no estilo do Zoom (docs/31 V2-9): o avatar de 28 px (so as iniciais) de um lado, o balao (os
 * outros a esquerda em --room-surface-2; a minha a direita em --room-bubble-mine-bg, com o avatar a direita) e, embaixo,
 * "nome · papel · hora" em 11 px; na minha, "Você · hora" (o avatar continua com as minhas iniciais). O papel so para Apresentador, Co-apresentador, Equipe e Assistente (chatRoleLabel). A linha de baixo e
 * so para quem ve (aria-hidden): o leitor de tela ouve "{nome}, {papel}, {hora}: " antes do texto, nunca o texto antes
 * do autor; "Aguardando a equipe" fica lido, depois do texto. O "Falar com a equipe" do Assistente vem depois da linha.
 * O console de quem apresenta usa o mesmo balao (V2-9 vale para a sala e o console), com a origem no lugar do papel,
 * as acoes e a largura dele; sem essas props, o HTML e o da sala.
 */
export function RoomChatBubble({ footer = null, message, metaActions = null, pendingLabel = WEBINAR_COPY.sala.aguardandoEquipe, roleLabel, time, widthClassName }: RoomChatBubbleProps) {
  const role = roleLabel === undefined ? chatRoleLabel(message.role) : roleLabel;
  const mine = message.mine;
  const name = mine ? WEBINAR_COPY.salaV2.chat.voce : message.displayName;
  const author = [name, role, time].filter((part): part is string => Boolean(part));
  const Meta = metaActions ? "div" : "p";

  return (
    <li className={cn("flex items-end gap-2", mine ? "flex-row-reverse" : undefined, metaActions ? "group relative" : undefined)} data-mine={mine ? "" : undefined} data-room-message={message.id}>
      <MemberAvatar imageSrc={message.avatarUrl} name={message.displayName} size="xs" />
      <div className={cn(widthClassName ? cn("flex min-w-0 flex-col gap-1", widthClassName) : BUBBLE_COLUMN, mine ? "items-end" : "items-start")}>
        <p
          className={cn(
            "max-w-full whitespace-pre-line break-words rounded-[12px] px-3 py-2 text-[13px] leading-[18px]",
            mine ? "rounded-br-[4px] bg-room-bubble-mine-bg text-room-bubble-mine-fg" : "rounded-bl-[4px] bg-room-surface-2 text-room-bubble-other-fg"
          )}
        >
          <span className="sr-only">{WEBINAR_COPY.salaV2.chat.autor(author)}</span>
          <RoomTeamText message={message} />
        </p>
        <Meta className={cn("flex flex-wrap items-center gap-1.5 text-[11px] leading-4 text-room-fg-subtle", mine ? "justify-end pr-1" : "pl-1")} data-room-message-meta="">
          <span aria-hidden="true" className="inline-flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-room-meta-name">{name}</span>
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
              <span className="font-semibold text-room-warn-fg">{pendingLabel}</span>
            </>
          ) : null}
          {metaActions}
        </Meta>
        {footer}
      </div>
    </li>
  );
}

/** De quem e a mensagem, para o comentario: o nome ("Você" na minha), o papel, o avatar e o que o leitor de tela ouve. */
function commentAuthor(message: RoomMessage, time: RoomCommentTime | null) {
  const role = chatRoleLabel(message.role);
  const name = message.mine ? WEBINAR_COPY.salaV2.chat.voce : message.displayName;
  const badgeOnly = roleBadgeOnly(name, role);
  const parts = (badgeOnly ? [role, time?.label] : [name, role, time?.label]).filter((part): part is string => Boolean(part));
  const avatar = message.role === "ai" ? "assistant" : badgeOnly && message.role === "team" ? "team" : "person";
  return { avatar, name, role, srAuthor: WEBINAR_COPY.salaV2.chat.autor(parts) } as const;
}

/** De que sala e o tempo do comentario: o tipo, o agora do aparelho, a diferenca para o servidor e o zero da gravada. */
export type RoomChatTiming = { kind: ChatTimeKind; nowMs: number; skewMs: number; zeroMs: number | null };

/** O tempo do comentario: "há 2 minutos" contra o agora do servidor, a hora exata no title; no Replay, nenhum. */
export function roomCommentTime(message: Pick<RoomMessage, "offsetMs" | "sentAt">, timing: RoomChatTiming): RoomCommentTime | null {
  const input = { kind: timing.kind, offsetMs: message.offsetMs, sentAt: message.sentAt, zeroMs: timing.zeroMs };
  const at = chatTimeAt(input);
  const label = chatAgoLabel({ ...input, nowMs: timing.nowMs + timing.skewMs });
  return at === null || !label ? null : { iso: new Date(at).toISOString(), label, title: chatTimeLabel(input) };
}

export type RoomChatCommentProps = {
  actions?: ReactNode;
  as?: "div" | "li";
  /** A fixada: o corte do texto, o id e a referencia do paragrafo (RoomComment). */
  bodyClassName?: string;
  bodyId?: string;
  bodyRef?: Ref<HTMLParagraphElement>;
  headline?: ReactNode;
  headlineId?: string;
  message: RoomMessage;
  time: RoomCommentTime | null;
};

/**
 * Uma mensagem do chat da sala como o comentario do YouTube (RoomComment): o texto pelo RoomTeamText, com o
 * "@assistente" em peso 600 (sem azul) e os links da equipe. A fixada (screen/room-pinned.tsx) usa o mesmo, fora da lista.
 */
export function RoomChatComment({ actions = null, as = "li", bodyClassName, bodyId, bodyRef, headline = null, headlineId, message, time }: RoomChatCommentProps) {
  const author = commentAuthor(message, time);
  return (
    <RoomComment
      actions={actions}
      as={as}
      avatar={<RoomCommentAvatar imageSrc={message.avatarUrl} kind={author.avatar} name={message.displayName} />}
      body={<RoomTeamText mentions message={message} />}
      bodyClassName={bodyClassName}
      bodyId={bodyId}
      bodyRef={bodyRef}
      headline={headline}
      headlineId={headlineId}
      id={message.id}
      meta={{ name: author.name, role: author.role, time }}
      mine={message.mine}
      pending={message.pending}
      srAuthor={author.srAuthor}
    />
  );
}

/**
 * O ⋮ "Mais opções" do cabecalho do painel no Chat (a partir de lg): o circulo sem fundo com a dica no lugar do title e
 * o menu abaixo, alinhado a direita, com "Remover minhas mensagens" (que abre a confirmacao no chat). O Esc fecha so o
 * menu e devolve o foco ao botao. No "ver como", a opcao fica desligada.
 */
export function RoomChatMoreButton({ onRemove, readOnly = false }: { onRemove: () => void; readOnly?: boolean }) {
  const label = WEBINAR_COPY.salaV2.chat.maisOpcoes;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  /** Fecha e devolve o foco ao botao (no WebKit o toque nao foca o botao, e o foco cairia no body). */
  function close() {
    buttonRef.current?.focus();
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
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
      <RoomTooltip label={label} side="below">
        <RoomIconButton
          aria-controls={CHAT_MORE_MENU_ID}
          aria-expanded={open}
          aria-haspopup="menu"
          className="[&_svg]:size-6"
          label={label}
          onClick={() => (open ? close() : setOpen(true))}
          onKeyDown={onKeyDown}
          ref={buttonRef}
          size={40}
          tone="ghost"
          withTitle={false}
        >
          <EllipsisVertical aria-hidden="true" strokeWidth={1.75} />
        </RoomIconButton>
      </RoomTooltip>
      <RoomMenu
        align="end"
        groups={[{ items: [{ disabled: readOnly, key: "remove", label: WEBINAR_COPY.sala.removerMinhasMensagens, onSelect: onRemove }] }]}
        id={CHAT_MORE_MENU_ID}
        label={label}
        onClose={() => setOpen(false)}
        open={open}
        placement="below"
        triggerRef={buttonRef}
      />
    </div>
  );
}

/** O id do menu ⋮ do Chat (o aria-controls do botao do cabecalho). */
export const CHAT_MORE_MENU_ID = "room-chat-more";

/**
 * O aceite (docs/30 §8.5): o texto exato e os dois botoes, "Entendi e quero participar" e Cancelar. Desde 10/11/2026
 * (D64) nao ha escolha de como aparecer: todo aluno aparece com o primeiro nome e a inicial do sobrenome, sem apelido e
 * sem anonimo. Na sala no estilo do YouTube (`card`, o padrao; spec §9.4), um cartao de raio 12 com as pilulas (a
 * branca e a de texto); na gaveta do vertical (`classic`), a faixa e os botoes de antes.
 */
export function RoomConsentBox({ busy, onAccept, onCancel, variant = "card" }: { busy?: boolean; onAccept: () => void; onCancel: () => void; variant?: "card" | "classic" }) {
  const copy = WEBINAR_COPY.sala;
  const id = useId();
  const card = variant === "card";

  return (
    <div
      className={card ? "mx-4 my-2 shrink-0 rounded-[12px] bg-room-control p-4" : "border-t border-room-border bg-room-pinned px-3 py-3"}
      data-testid="room-consent"
      role="group"
      aria-labelledby={`${id}-title`}
    >
      <p className="text-sm leading-6 text-room-fg" id={`${id}-title`}>
        {copy.consentimento}
      </p>
      {card ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <RoomPill disabled={busy} label={copy.consentimentoBotao} onClick={onAccept} tone="white" />
          <RoomPill disabled={busy} label={WEBINAR_COPY.admin.cancelar} onClick={onCancel} tone="text" />
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <RoomButton disabled={busy} onClick={onAccept} size="sm" variant="primary">
            {copy.consentimentoBotao}
          </RoomButton>
          <RoomButton disabled={busy} onClick={onCancel} size="sm" variant="ghost">
            {WEBINAR_COPY.admin.cancelar}
          </RoomButton>
        </div>
      )}
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

/**
 * O painel do chat voltou a tela (`shown`): a lista, que nao rola enquanto esta escondida, vai ao fim se o aluno estava
 * no fim (`stick`, o mesmo do rolar com as mensagens que chegam); quem tinha subido para ler fica onde estava. Devolve se
 * rolou.
 */
export function chatListOnShow(list: { scrollHeight: number; scrollTop: number } | null, input: { shown: boolean; stick: boolean }): boolean {
  if (!list || !input.shown || !input.stick) {
    return false;
  }
  list.scrollTop = list.scrollHeight;
  return true;
}

export function RoomChatPanel(props: RoomChatPanelProps) {
  const {
    aboveComposer = null,
    assistant: sharedAssistant,
    avatarUrl = null,
    busy = false,
    chatMode,
    consented,
    displayName,
    error,
    look = "comment",
    messages,
    notice = null,
    nowMs,
    onRemoveMine,
    onRemoveOpenChange,
    onSend,
    phase,
    readOnly,
    removeOpen,
    sessionId = null,
    shown = true,
    skewMs = 0,
    slowUntilMs,
    timeKind,
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
  // O campo do YouTube aberto (no comentario): liga no foco, desliga no Cancelar e depois do envio (composerExpandedStep).
  const [expanded, setExpanded] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [ownConfirmRemove, setOwnConfirmRemove] = useState(false);
  // No comentario, a confirmacao e aberta pelo ⋮ do cabecalho do painel (a sala guarda o aberto).
  const confirmRemove = removeOpen ?? ownConfirmRemove;
  const setConfirmRemove = onRemoveOpenChange ?? setOwnConfirmRemove;
  const [announce, setAnnounce] = useState("");
  const listRef = useRef<HTMLOListElement | null>(null);
  const knownRef = useRef<Set<string>>(new Set());
  const stickRef = useRef(true);
  const state = composerState({ chatMode, consented, nowMs, phase, slowUntilMs });
  const hint = composerHint(state, phase);
  // No comentario, o sucesso vai ao aviso da sala (o erro continua na frase embaixo do campo); a gaveta do vertical
  // segue com a frase. A faixa do campo diz a altura dela, para o aviso ficar acima (abaixo de lg).
  const snackbar = useRoomSnackbar();
  const roomSnackbar = look === "comment" ? snackbar : null;
  const listInset = useRoomSnackbarListInset();
  const onFieldHeight = useCallback((px: number) => roomSnackbar?.composer("chat", px), [roomSnackbar]);

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

  // O painel voltou a tela (o balao): a lista escondida nao rolou com o que chegou; quem estava no fim volta ao fim. Vale
  // tambem para o painel que montou fechado (a primeira leitura do chat chegou com a lista escondida).
  useLayoutEffect(() => {
    chatListOnShow(listRef.current, { shown, stick: stickRef.current });
  }, [shown]);

  // No comentario, a lista muda de tamanho (o campo que abre, a faixa da traducao; a area das fixadas, acima do chat, no
  // painel): quem estava no fim volta ao fim depois do novo tamanho; quem tinha subido para ler fica onde estava.
  useEffect(() => {
    const list = listRef.current;
    if (look !== "comment" || !list || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (stickRef.current) {
        list.scrollTop = list.scrollHeight;
      }
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [look]);

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
      setExpanded((previous) => composerExpandedStep(previous, { draft: "", type: "sent" }));
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
    // Com o envio em andamento, o Enter de novo nao manda a mesma mensagem outra vez.
    if (state.disabled || !draft.trim() || sending) {
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
      const done = removed > 0 ? WEBINAR_COPY.privacidade.feito(removed) : WEBINAR_COPY.privacidade.nadaParaRemover;
      if (roomSnackbar) {
        roomSnackbar.show({ key: "chat_removed", text: done });
      } else {
        setStatus(done);
      }
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

  const timing: RoomChatTiming = { kind: timeKind, nowMs, skewMs, zeroMs };

  const removeBox = confirmRemove ? (
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
  ) : null;

  const consentBox =
    consentOpen && !consented && !notice ? (
      <RoomConsentBox
        busy={sending}
        variant={look === "comment" ? "card" : "classic"}
        onAccept={() => void deliver({ consent: true, consentVersion: CHAT_CONSENT_VERSION })}
        onCancel={() => setConsentOpen(false)}
      />
    ) : null;

  // Abaixo de lg o cabecalho do painel nao aparece: o ⋯ de antes continua na linha do campo so ali (o celular como hoje).
  const mobileMenu = <div className="mr-3 shrink-0 lg:hidden">{menu}</div>;
  // A frase que toma o lugar do campo: o silenciado, a sala que nao abriu e, com a sessao encerrada, "Essa live acabou.".
  const fieldNotice = notice ?? (state.reason === "ended" && hint ? hint : null);

  if (look === "comment") {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="room-chat">
        <ol
          aria-label={copy.abas.chat}
          aria-live={single ? "polite" : "off"}
          aria-relevant="additions"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pt-4 [scrollbar-color:transparent_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin]"
          onScroll={handleScroll}
          ref={listRef}
          role="log"
          // O respiro do aviso acima do campo da folha aberta (abaixo de lg): a mensagem mais nova fica acima dele.
          style={listInset > 0 ? { paddingBottom: listInset } : undefined}
        >
          {messages.length === 0 ? <li className="mt-2 text-center text-sm leading-5 text-room-fg-subtle">{error ?? copy.semMensagens}</li> : null}
          {messages.map((message) => {
            const repliedTo = repliesToMe.get(message.id);
            return (
              <RoomChatComment
                actions={
                  repliedTo && !readOnly && webinarId && sessionId ? (
                    <AssistantHandoff attendantsOnline={assistant.state.attendantsOnline} onRequest={() => assistant.handoff("chat", repliedTo)} readOnly={readOnly} />
                  ) : null
                }
                key={message.id}
                message={message}
                time={roomCommentTime(message, timing)}
              />
            );
          })}
        </ol>
        <p aria-live="polite" className="sr-only">
          {announce}
        </p>
        {aboveComposer}

        {removeBox}
        {consentBox}

        {fieldNotice ? (
          <RoomCommentFieldNotice leading={mobileMenu} testId="room-chat-notice">
            {fieldNotice}
          </RoomCommentFieldNotice>
        ) : (
          <RoomCommentField
            ariaLabel={copy.escreva}
            avatar={{ imageSrc: avatarUrl, name: displayName }}
            busy={sending}
            disabled={state.disabled || readOnly || busy}
            expanded={expanded}
            hint={assistantHint === "call" ? <AssistantHint className="px-0 text-xs leading-[18px]" state="call" /> : null}
            leading={mobileMenu}
            maxLength={CHAT_LIMITS.body}
            mode="enter"
            onCancel={() => {
              setDraft("");
              setConsentOpen(false);
            }}
            onChange={setDraft}
            onExpandedChange={setExpanded}
            onHeightChange={onFieldHeight}
            onSubmit={() => submit()}
            placeholder={hint || copy.escreva}
            status={
              <>
                <p aria-live="polite" className={cn("mt-1 empty:mt-0", status && status !== copy.aguardandoEquipe ? "text-room-warn-fg" : "text-room-fg-subtle")}>
                  {status ?? (readOnly ? WEBINAR_COPY.aluno.previaSemGravar : hint)}
                </p>
                {assistantHint === "waiting" || assistantHint === "limit" ? <AssistantHint className="mt-1 px-0 text-xs leading-[18px]" state={assistantHint} /> : null}
              </>
            }
            submitLabel={copy.enviar}
            value={draft}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="room-chat">
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
              time={chatTimeLabel({ kind: timeKind, offsetMs: message.offsetMs, sentAt: message.sentAt, zeroMs })}
            />
          );
        })}
      </ol>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      {aboveComposer}

      {removeBox}

      {consentBox}

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
            {/* 16 px abaixo de lg: o Safari do iPhone da zoom no foco de um campo menor. A linha de 20 px cabe nos 44 px
                com a borda e o respiro (1 + 10 + 20 + 10 + 1); com 24 px sobrariam 22 e o Chrome mostraria a barra de rolar. */}
            <textarea
              aria-label={copy.escreva}
              className="h-11 min-w-0 flex-1 resize-none rounded-[12px] border border-room-input-border bg-room-input-bg px-3 py-2.5 text-base leading-5 text-room-fg outline-none placeholder:text-room-fg-subtle focus-visible:border-room-fg-subtle disabled:opacity-50 lg:text-[13px]"
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

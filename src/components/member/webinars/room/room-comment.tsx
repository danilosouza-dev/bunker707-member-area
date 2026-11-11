"use client";

import { ChevronDown, ChevronUp, Sparkles, UserRound, UsersRound, VenetianMask, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { MemberAvatar } from "@/components/member/ui/member-avatar";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { roleBadgeOnly } from "@/lib/webinar-room-client";
import { ROOM_FOCUS } from "./room-ui";

// O comentario do YouTube na sala do aluno (docs/31, a sala no estilo do YouTube; spec §8.1 a §8.3 e §8.5): so da sala
// (o console e a gaveta do vertical continuam com o balao do Zoom, RoomChatBubble). O avatar de 24 px a esquerda (as
// iniciais sobre a cor do nome; a Anonima (legado: perguntas de antes de 10/11/2026), a Equipe e o Assistente num circulo tonal com o icone de 14; sem nome, a
// pessoa), 12 px e a coluna do texto: a linha opcional de cima (a fixada), a linha do autor de 20 px (o nome 12/18 peso
// 500 sem "@", o selo tonal do papel e o tempo relativo, com a hora exata no title do <time>), o texto 14/20 que quebra
// a vontade e a linha de acoes de 32 px que comeca 8 px antes do texto (so com algo dentro). A linha do autor e so para
// quem ve (aria-hidden): o leitor de tela ouve o `srAuthor` ("Marina R., Equipe, há 2 minutos: ") antes do texto. Com o
// nome igual ao papel (o Assistente), so o selo, com o nome dentro. So tokens --room-*; nenhuma frase escrita aqui.
// O fio (a pergunta com a resposta escrita, spec §8.4; A §4.6 e §4.7): a linha de 1 px no centro do avatar, de 28 px
// abaixo do topo ate o fim do comentario, a curva de 12 x 30 ate o botao "1 resposta" e, aberto, a linha que segue ate
// a curva de 12 x 24 do avatar da resposta; com o ponteiro no comentario, a linha clareia. Tudo decorativo (aria-hidden).

export type RoomCommentAvatarKind = "anonymous" | "assistant" | "person" | "team" | "unknown";

const AVATAR_ICONS: Record<Exclude<RoomCommentAvatarKind, "person">, LucideIcon> = {
  anonymous: VenetianMask,
  assistant: Sparkles,
  team: UsersRound,
  unknown: UserRound
};

/**
 * O avatar de 24 px: a foto do perfil quando ela vem (`imageSrc`: a da pessoa ou a de quem e da equipe; o servidor so a
 * manda quando ela pode aparecer, docs/30 §8.5), senao as iniciais do nome (MemberAvatar) ou, sem pessoa, o icone de 14
 * num circulo tonal. A Anonima (legado: perguntas de antes de 10/11/2026, D64) e o Assistente nunca levam foto.
 */
export function RoomCommentAvatar({ imageSrc = null, kind, name }: { imageSrc?: string | null; kind: RoomCommentAvatarKind; name?: string }) {
  const photo = kind === "person" || kind === "team" ? imageSrc?.trim() || null : null;
  if (photo || (kind === "person" && name?.trim())) {
    return <MemberAvatar className="size-6 [&>span]:text-[10px]" imageSrc={photo} name={name?.trim() || "A"} size="xs" />;
  }
  const Icon = AVATAR_ICONS[kind === "person" ? "unknown" : kind];
  return (
    <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-room-control text-room-fg">
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={2} />
    </span>
  );
}

/** O selo do papel: a pilula tonal de 20 px, 12/18 peso 500. */
export function RoomRoleBadge({ children }: { children: string }) {
  return <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-room-control px-1.5 text-xs font-medium leading-[18px] text-room-fg">{children}</span>;
}

export type RoomCommentTime = { iso: string; label: string; title: string };

export type RoomCommentProps = {
  /** O que vai na linha de acoes ("Falar com a equipe"); sem nada, a linha nao aparece. */
  actions?: ReactNode;
  /**
   * O que fica depois do comentario, dentro do item e fora da coluna do texto (a barra de acoes da equipe no console,
   * docs/31 §10, que se posiciona sozinha); so no comentario sem fio.
   */
  aside?: ReactNode;
  /** O avatar (RoomCommentAvatar). */
  avatar: ReactNode;
  /** "li" na lista; "div" fora dela (a fixada, no bloco do topo; a resposta no fio). */
  as?: "div" | "li";
  /** O texto do comentario (os trechos com o "@assistente"). */
  body: ReactNode;
  /** A linha de cima, opcional (a fixada: o alfinete e "Fixada pela equipe"). */
  headline?: ReactNode;
  id: string;
  /**
   * O que o id marca: a mensagem do chat (data-room-message), a pergunta (data-room-question), a primeira resposta da
   * equipe no fio (data-room-answer) ou uma resposta seguinte do fio (data-room-reply).
   */
  marker?: "answer" | "message" | "question" | "reply";
  meta: { name: string; role: string | null; time: RoomCommentTime | null };
  mine?: boolean;
  /** A minha mensagem esperando a equipe: "Aguardando a equipe" na linha de acoes, alinhado ao texto. */
  pending?: boolean;
  /** O que o leitor de tela ouve antes do texto ("Marina R., Equipe, há 2 minutos: "). */
  srAuthor: string;
  /** O fio (RoomCommentThread: o botao "1 resposta" e a resposta), embaixo do comentario, com a linha do avatar. */
  thread?: ReactNode;
  /** Classes a mais no item (o console: `group relative`, para a barra de acoes por cima). */
  className?: string;
};

/** A linha do fio: 1 px no centro do avatar (x 12), que clareia com o ponteiro no comentario. */
const THREAD_LINE = "absolute bottom-0 left-3 w-px bg-room-thread-line group-hover/comment:bg-room-thread-line-hover";
/** A curva do fio (o "L" arredondado do YouTube), de x 12 ate o botao ou o avatar da resposta. */
const THREAD_CURVE = "absolute w-3 rounded-bl-[16px] border-b border-l border-room-thread-line group-hover/comment:border-room-thread-line-hover";
/** Aberto, a linha passa pela resposta (em x 12 do comentario) ate o botao "Ocultar respostas", que vem depois dela. */
const THREAD_LINE_TO_TOGGLE = "absolute -left-6 -top-3 bottom-0 w-px bg-room-thread-line group-hover/comment:bg-room-thread-line-hover";

const MARKERS = { answer: "data-room-answer", message: "data-room-message", question: "data-room-question", reply: "data-room-reply" } as const;

export function RoomComment({ actions = null, as: Tag = "li", aside = null, avatar, body, className, headline = null, id, marker = "message", meta, mine = false, pending = false, srAuthor, thread = null }: RoomCommentProps) {
  const badgeOnly = roleBadgeOnly(meta.name, meta.role);
  const hasActions = pending || Boolean(actions);
  const marks = { "data-mine": mine ? "" : undefined, [MARKERS[marker]]: id };

  const row = (
    <>
      {avatar}
      <div className="ml-3 min-w-0 flex-1">
        {headline ? <p className="flex items-center gap-1.5 text-xs leading-[18px] text-room-fg-subtle">{headline}</p> : null}
        <p aria-hidden="true" className="mb-0.5 flex h-5 min-w-0 items-center gap-1" data-room-message-meta="">
          {badgeOnly && meta.role ? (
            <RoomRoleBadge>{meta.role}</RoomRoleBadge>
          ) : (
            <>
              <span className="truncate text-xs font-medium leading-[18px] text-room-fg">{meta.name}</span>
              {meta.role ? <RoomRoleBadge>{meta.role}</RoomRoleBadge> : null}
            </>
          )}
          {meta.time ? (
            <time className="shrink-0 whitespace-nowrap text-xs leading-[18px] text-room-fg-subtle" dateTime={meta.time.iso} title={meta.time.title}>
              {meta.time.label}
            </time>
          ) : null}
        </p>
        <p className="whitespace-pre-wrap text-sm leading-5 text-room-fg [overflow-wrap:anywhere]">
          <span className="sr-only">{srAuthor}</span>
          {body}
        </p>
        {hasActions ? (
          <div className="-ml-2 mt-1 flex min-h-8 items-center">
            {pending ? <span className="ml-2 text-xs leading-[18px] text-room-warn-fg">{WEBINAR_COPY.sala.aguardandoEquipe}</span> : null}
            {actions}
          </div>
        ) : null}
      </div>
    </>
  );

  if (!thread) {
    return (
      <Tag className={cn("flex", Tag === "li" ? "mb-4 first:mt-auto" : null, className)} {...marks}>
        {row}
        {aside}
      </Tag>
    );
  }
  return (
    <Tag className={cn("group/comment relative", Tag === "li" ? "mb-4" : null)} {...marks}>
      <div className="relative flex">
        <span aria-hidden="true" className={cn(THREAD_LINE, "top-7")} />
        {row}
      </div>
      {thread}
    </Tag>
  );
}

/**
 * Um item do fio depois do primeiro (a segunda resposta em diante e o campo de responder): 16 px abaixo do anterior,
 * com a propria curva saindo da linha do fio ate o avatar dele, como cada resposta do YouTube.
 */
export function RoomThreadItem({ children }: { children: ReactNode }) {
  return (
    <div className="relative mt-4">
      <span aria-hidden="true" className={cn(THREAD_CURVE, "-left-6 -top-4 h-7")} />
      {children}
    </div>
  );
}

/**
 * O fio do comentario: o botao "1 resposta" (40 px, raio 20, 14/20 peso 500, sem azul, a 24 px da borda e 12 abaixo
 * do comentario, com a seta de 24) e a resposta, que fica sempre no HTML (`hidden` fechada: o aria-controls aponta
 * para um no que existe), alinhada ao texto do comentario (x 36). Aberto, o botao vira "Ocultar respostas" (o `label`
 * vem de quem chama) e desce para depois da resposta.
 */
export function RoomCommentThread({
  answerTestId,
  children,
  controlsId,
  expanded,
  label,
  onToggle
}: {
  /** O data-testid do bloco da resposta (a do Assistente). */
  answerTestId?: string;
  /** A resposta (um RoomComment as="div"). */
  children: ReactNode;
  controlsId: string;
  expanded: boolean;
  label: string;
  onToggle: () => void;
}) {
  const Chevron = expanded ? ChevronUp : ChevronDown;
  // Como no YouTube: fechado, o botao "1 resposta" logo abaixo do comentario; aberto, a resposta vem primeiro e o botao
  // "Ocultar respostas" fica por ultimo, com a linha do avatar descendo pela resposta ate a curva dele. O botao e o
  // mesmo elemento nos dois estados (so a ordem do flex muda), para o foco continuar nele ao abrir e ao fechar.
  return (
    <div className="flex flex-col">
      <div className={cn("relative", expanded ? "order-2" : null)}>
        <span aria-hidden="true" className={cn(THREAD_CURVE, "left-3 top-0 h-[30px]")} />
        <button
          aria-controls={controlsId}
          aria-expanded={expanded}
          className={cn(
            "ml-6 mt-3 inline-flex h-10 items-center whitespace-nowrap rounded-full px-4 text-sm font-medium leading-5 text-room-fg hover:bg-room-control-hover active:shadow-[inset_0_0_0_999px_var(--room-press-overlay)]",
            ROOM_FOCUS
          )}
          onClick={onToggle}
          type="button"
        >
          {label}
          <Chevron aria-hidden="true" className="-mr-1.5 ml-1.5 size-6" strokeWidth={1.75} />
        </button>
      </div>
      <div className={cn("relative ml-9 mt-3", expanded ? "order-1" : null)} data-testid={answerTestId} hidden={!expanded} id={controlsId}>
        {expanded ? <span aria-hidden="true" className={THREAD_LINE_TO_TOGGLE} /> : null}
        <span aria-hidden="true" className={cn(THREAD_CURVE, "-left-6 -top-3 h-6")} />
        {children}
      </div>
    </div>
  );
}

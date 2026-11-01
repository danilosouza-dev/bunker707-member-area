"use client";

import { Sparkles, UserRound, UsersRound, VenetianMask, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { MemberAvatar } from "@/components/member/ui/member-avatar";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { roleBadgeOnly } from "@/lib/webinar-room-client";

// O comentario do YouTube na sala do aluno (docs/31, a sala no estilo do YouTube; spec §8.1 a §8.3 e §8.5): so da sala
// (o console e a gaveta do vertical continuam com o balao do Zoom, RoomChatBubble). O avatar de 24 px a esquerda (as
// iniciais sobre a cor do nome; a Anonima, a Equipe e o Assistente num circulo tonal com o icone de 14; sem nome, a
// pessoa), 12 px e a coluna do texto: a linha opcional de cima (a fixada), a linha do autor de 20 px (o nome 12/18 peso
// 500 sem "@", o selo tonal do papel e o tempo relativo, com a hora exata no title do <time>), o texto 14/20 que quebra
// a vontade e a linha de acoes de 32 px que comeca 8 px antes do texto (so com algo dentro). A linha do autor e so para
// quem ve (aria-hidden): o leitor de tela ouve o `srAuthor` ("Marina R., Equipe, há 2 minutos: ") antes do texto. Com o
// nome igual ao papel (o Assistente), so o selo, com o nome dentro. So tokens --room-*; nenhuma frase escrita aqui.

export type RoomCommentAvatarKind = "anonymous" | "assistant" | "person" | "team" | "unknown";

const AVATAR_ICONS: Record<Exclude<RoomCommentAvatarKind, "person">, LucideIcon> = {
  anonymous: VenetianMask,
  assistant: Sparkles,
  team: UsersRound,
  unknown: UserRound
};

/** O avatar de 24 px: as iniciais do nome (MemberAvatar) ou, sem pessoa, o icone de 14 num circulo tonal. */
export function RoomCommentAvatar({ kind, name }: { kind: RoomCommentAvatarKind; name?: string }) {
  if (kind === "person" && name?.trim()) {
    return <MemberAvatar className="size-6 [&>span]:text-[10px]" name={name} size="xs" />;
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
  /** O avatar (RoomCommentAvatar). */
  avatar: ReactNode;
  /** "li" na lista; "div" fora dela (a fixada, no bloco do topo). */
  as?: "div" | "li";
  /** O texto do comentario (os trechos com o "@assistente"). */
  body: ReactNode;
  /** A linha de cima, opcional (a fixada: o alfinete e "Fixada pela equipe"). */
  headline?: ReactNode;
  id: string;
  meta: { name: string; role: string | null; time: RoomCommentTime | null };
  mine?: boolean;
  /** A minha mensagem esperando a equipe: "Aguardando a equipe" na linha de acoes, alinhado ao texto. */
  pending?: boolean;
  /** O que o leitor de tela ouve antes do texto ("Marina R., Equipe, há 2 minutos: "). */
  srAuthor: string;
  /** O fio (a resposta da pergunta), depois das acoes. */
  thread?: ReactNode;
};

export function RoomComment({ actions = null, as: Tag = "li", avatar, body, headline = null, id, meta, mine = false, pending = false, srAuthor, thread = null }: RoomCommentProps) {
  const badgeOnly = roleBadgeOnly(meta.name, meta.role);
  const hasActions = pending || Boolean(actions);

  return (
    <Tag className={cn("flex", Tag === "li" ? "mb-4 first:mt-auto" : null)} data-mine={mine ? "" : undefined} data-room-message={id}>
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
        {thread}
      </div>
    </Tag>
  );
}

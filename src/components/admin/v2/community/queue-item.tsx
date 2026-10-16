"use client";

import { ChevronDown, Clock, EyeOff, Flag, GraduationCap, Heart, MonitorPlay, ShieldAlert, UserRound } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatWaitingTime } from "@/server/community/model";
import type { QueueItem } from "@/server/community/types";
import { adminTransition } from "../styles";
import { AuthorAvatar } from "./author-avatar";
import { formatFullDate, plural, studentSearchHref } from "./hrefs";
import { RowMenu, rowButtonClass, type RowMenuAction } from "./row-menu";

// Uma pergunta da fila (prototipo aprovado, shot 13): avatar com a cor do produto, nome, caminho
// "Produto › Módulo › Aula" (abre a aula no admin), tempo de espera (amarelo depois de 24 h), texto,
// reacoes, respostas de colegas recolhidas e as acoes na propria linha. O editor de resposta entra no
// lugar das acoes.

type QueueItemViewProps = {
  busy: boolean;
  canModerate: boolean;
  canReply: boolean;
  /** Editor de resposta aberto (substitui a linha de acoes). */
  composer: ReactNode;
  /** Item ativo da navegacao J/K: unico com tabIndex 0 e o que aparece no celular. */
  isActive: boolean;
  item: QueueItem;
  now: Date;
  onFocusItem: () => void;
  onModerate: (status: "hidden" | "spam") => void;
  onReply: () => void;
  onResolve: () => void;
};

export function QueueItemView({
  busy,
  canModerate,
  canReply,
  composer,
  isActive,
  item,
  now,
  onFocusItem,
  onModerate,
  onReply,
  onResolve
}: QueueItemViewProps) {
  const nameId = useId();
  const textId = useId();
  const menuActions: RowMenuAction[] = [
    ...(canModerate
      ? [
          { icon: EyeOff, label: "Ocultar", onSelect: () => onModerate("hidden") },
          { icon: ShieldAlert, label: "Marcar como spam", onSelect: () => onModerate("spam") }
        ]
      : []),
    { href: studentSearchHref(item.author.name), icon: UserRound, label: "Ver aluno", separatorBefore: canModerate },
    ...(item.path.adminHref ? [{ href: item.path.adminHref, icon: GraduationCap, label: "Abrir aula no admin" }] : []),
    ...(item.path.studentHref
      ? [{ external: true, href: item.path.studentHref, icon: MonitorPlay, label: "Ver na área do aluno" }]
      : [])
  ];

  return (
    <article
      aria-busy={busy || undefined}
      aria-describedby={textId}
      aria-labelledby={nameId}
      className={cn(
        "min-w-0 flex-col gap-2.5 border-b border-[var(--border-subtle)] p-4 last:border-b-0 md:flex",
        "focus:outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-solid",
        isActive ? "flex" : "hidden",
        busy && "opacity-60",
        adminTransition
      )}
      data-queue-item={item.id}
      onFocus={onFocusItem}
      tabIndex={isActive ? 0 : -1}
    >
      <div className="flex min-w-0 items-start gap-3">
        <AuthorAvatar accent={item.path.productAccent} initials={item.author.initials} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm leading-5 font-semibold text-[var(--text-primary)]" id={nameId}>
            {item.author.name}
          </span>
          {item.path.adminHref ? (
            <Link
              className={cn(
                "w-fit max-w-full rounded-sm text-[13px] leading-5 text-[var(--text-secondary)] [overflow-wrap:anywhere] hover:text-[var(--text-primary)] md:truncate",
                adminTransition
              )}
              data-navigation-feedback="false"
              href={item.path.adminHref}
              title={`Abrir a aula no admin: ${item.path.label}`}
            >
              {item.path.label}
            </Link>
          ) : (
            <span className="w-fit max-w-full text-[13px] leading-5 text-[var(--text-secondary)] [overflow-wrap:anywhere] md:truncate">{item.path.label}</span>
          )}
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 text-xs leading-5 font-medium whitespace-nowrap",
            item.isOverdue ? "text-[var(--warning)]" : "text-[var(--text-tertiary)]"
          )}
          title={formatFullDate(item.createdAt)}
        >
          {item.isOverdue ? <Clock aria-hidden="true" className="size-3.5" /> : null}
          <time dateTime={item.createdAt}>{formatWaitingTime(item.createdAt, now)}</time>
          {item.isOverdue ? <span className="sr-only">, passou de 24 horas</span> : null}
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-2.5 md:pl-11">
        <p
          className="max-w-[75ch] text-sm leading-6 whitespace-pre-line text-[var(--text-primary)] [overflow-wrap:anywhere]"
          id={textId}
        >
          {item.body}
        </p>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 font-medium text-[var(--text-tertiary)]">
          <span className="inline-flex items-center gap-1.5">
            <Heart aria-hidden="true" className="size-3.5" />
            {plural(item.reactionCount, "reação", "reações")}
          </span>
          {item.reportCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-[var(--warning)]">
              <Flag aria-hidden="true" className="size-3.5" />
              {plural(item.reportCount, "denúncia", "denúncias")}
            </span>
          ) : null}
        </p>

        {item.studentReplies.length > 0 ? <PeerReplies item={item} now={now} /> : null}

        {composer ?? (
          <div className="flex flex-wrap items-center gap-1.5">
            {canReply ? (
              <>
                <Button className={rowButtonClass} disabled={busy} onClick={onReply} type="button">
                  Responder
                </Button>
                <Button
                  className={cn(rowButtonClass, "text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]")}
                  disabled={busy}
                  onClick={onResolve}
                  title="Tira da fila sem responder (ex.: a dúvida já foi resolvida por um colega)."
                  type="button"
                  variant="ghost"
                >
                  Resolver
                </Button>
              </>
            ) : null}
            <RowMenu actions={menuActions} disabled={busy} label={`Mais ações para a pergunta de ${item.author.name}`} />
          </div>
        )}
      </div>
    </article>
  );
}

function PeerReplies({ item, now }: { item: QueueItem; now: Date }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const count = item.studentReplies.length;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <button
        aria-controls={listId}
        aria-expanded={open}
        className={cn(
          "inline-flex h-11 w-fit items-center gap-1.5 rounded-md text-[13px] leading-5 font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] md:h-7",
          adminTransition
        )}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform duration-150", open && "rotate-180")} />
        {count === 1 ? "1 resposta de colega" : `${count} respostas de colegas`}
      </button>
      {open ? (
        <ul className="flex min-w-0 flex-col gap-2 border-l border-[var(--border-strong)] pl-3" id={listId}>
          {item.studentReplies.map((reply) => (
            <li className="flex min-w-0 items-start gap-2.5" key={reply.id}>
              <AuthorAvatar accent={item.path.productAccent} initials={reply.author.initials} size="sm" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[13px] leading-5">
                  <span className="truncate font-semibold text-[var(--text-primary)]">{reply.author.name}</span>
                  <time className="text-xs text-[var(--text-tertiary)]" dateTime={reply.createdAt} title={formatFullDate(reply.createdAt)}>
                    {formatWaitingTime(reply.createdAt, now)}
                  </time>
                </p>
                <p className="max-w-[75ch] text-[13px] leading-5 whitespace-pre-line text-[var(--text-secondary)] [overflow-wrap:anywhere]">
                  {reply.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

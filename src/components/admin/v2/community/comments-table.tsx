"use client";

import { Flag, GraduationCap, Heart, MonitorPlay, UserRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { moderateComment, moderateComments } from "@/server/community/actions";
import { commentStatusTone, formatWaitingTime } from "@/server/community/model";
import { COMMUNITY_BULK_LIMIT } from "@/server/community/schemas";
import type { CommentListItem } from "@/server/community/types";
import { ErrorBanner } from "../error-banner";
import { StatusChip } from "../status-chip";
import { adminCard, adminTransition } from "../styles";
import { adminToast } from "../toast";
import { AuthorAvatar, ProfessorBadge } from "./author-avatar";
import { formatFullDate, plural, studentSearchHref } from "./hrefs";
import {
  bulkFailureMessage,
  moderationToastMessage,
  pruneSelection,
  rowModerationActions,
  selectionState,
  toggleAllSelected,
  toggleSelected,
  undoGroups,
  type CommentStatusValue,
  type ModerationStatus
} from "./moderation-model";
import { RowMenu, rowButtonClass, type RowMenuAction } from "./row-menu";

// Aba Comentarios (docs/17 §1.9): todos os comentarios das aulas, mais novos primeiro, com filtros no
// endereco e moderacao na propria linha (ate duas acoes) ou em massa (ate 50 por vez, barra flutuante
// no rodape para nao deslocar a tabela ao marcar). Cabe na largura
// sem rolar: table-fixed com larguras por coluna e colunas que aparecem conforme a largura do cartao.
// Abaixo de 640 px de cartao vira lista.

type CommentsTableProps = {
  canModerate: boolean;
  items: readonly CommentListItem[];
  nowIso: string;
};

const headCell = "h-9 px-3 text-left text-xs leading-4 font-medium whitespace-nowrap text-[var(--text-tertiary)]";
const ghostRowButton = cn(rowButtonClass, "text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]");

function rowMenuActions(item: CommentListItem): RowMenuAction[] {
  return [
    ...(item.authorRole === "student"
      ? [{ href: studentSearchHref(item.author.name), icon: UserRound, label: "Ver aluno" }]
      : []),
    ...(item.path.adminHref ? [{ href: item.path.adminHref, icon: GraduationCap, label: "Abrir aula no admin" }] : []),
    ...(item.path.studentHref ? [{ external: true, href: item.path.studentHref, icon: MonitorPlay, label: "Ver na área do aluno" }] : [])
  ];
}

export function CommentsTable({ canModerate, items, nowIso }: CommentsTableProps) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  // Situacao otimista por comentario; volta a valer a do servidor quando a lista chega de novo.
  const [overrideState, setOverrideState] = useState<{ items: readonly CommentListItem[]; values: Record<string, CommentStatusValue> }>({
    items,
    values: {}
  });
  const [selectedRaw, setSelectedRaw] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  if (overrideState.items !== items) {
    setOverrideState({ items, values: {} });
  }

  const overrides = overrideState.values;
  const pageIds = useMemo(() => items.map((item) => item.id), [items]);
  const selected = pruneSelection(selectedRaw, pageIds);
  const allState = selectionState(selected, pageIds);
  const statusOf = (item: CommentListItem): CommentStatusValue => overrides[item.id] ?? item.status;

  function setStatuses(ids: readonly string[], status: CommentStatusValue) {
    setOverrideState((current) => ({
      items: current.items,
      values: { ...current.values, ...Object.fromEntries(ids.map((id) => [id, status])) }
    }));
  }

  function markBusy(ids: readonly string[], value: boolean) {
    setBusy((current) => {
      const next = new Set(current);

      for (const id of ids) {
        if (value) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }

      return next;
    });
  }

  async function moderateOne(item: CommentListItem, status: ModerationStatus) {
    const previous = statusOf(item);
    setError(null);
    markBusy([item.id], true);

    const result = await moderateComment({ commentId: item.id, status });
    markBusy([item.id], false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setStatuses([item.id], status);
    adminToast.success(
      moderationToastMessage(status, 1),
      previous === "pending"
        ? {}
        : {
            onUndo: async () => {
              const undo = await moderateComment({ commentId: item.id, status: previous });

              if (undo.ok) {
                setStatuses([item.id], previous);
              } else {
                setError(undo.error);
              }
            }
          }
    );
  }

  async function moderateSelected(status: ModerationStatus) {
    const ids = pageIds.filter((id) => selected.has(id));

    if (ids.length === 0) {
      return;
    }

    const previous = new Map(items.filter((item) => selected.has(item.id)).map((item) => [item.id, statusOf(item)]));
    setError(null);
    markBusy(ids, true);

    const result = await moderateComments({ commentIds: ids, status });
    markBusy(ids, false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    const { failed, updated } = result.data;
    setStatuses(updated, status);
    setSelectedRaw(new Set(failed));
    setError(bulkFailureMessage(failed.length));

    if (updated.length === 0) {
      return;
    }

    const groups = undoGroups(previous, updated);

    adminToast.success(
      moderationToastMessage(status, updated.length),
      groups.length > 0
        ? {
            onUndo: async () => {
              for (const group of groups) {
                const undo = await moderateComments({ commentIds: group.ids, status: group.status });

                if (!undo.ok) {
                  setError(undo.error);
                  return;
                }

                setStatuses(undo.data.updated, group.status);
              }
            }
          }
        : {}
    );
  }

  const selectedCount = selected.size;
  const anyBusy = busy.size > 0;

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", canModerate && selectedCount > 0 && "pb-20")}>
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}

      {canModerate && selectedCount > 0 ? (
        <div
          aria-label="Ações para os comentários selecionados"
          className={cn(
            "fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-[640px] min-w-0 flex-wrap items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] px-3 py-2 shadow-[0_16px_48px_rgba(0,0,0,0.5)]",
            "animate-in fade-in slide-in-from-bottom-2 duration-150 motion-reduce:animate-none"
          )}
          role="toolbar"
        >
          <p aria-live="polite" className="mr-auto text-[13px] leading-5 font-medium text-[var(--text-primary)] tabular-nums">
            {plural(selectedCount, "selecionado", "selecionados")}
          </p>
          <Button className={cn(rowButtonClass, "border-[var(--border-strong)]")} disabled={anyBusy} onClick={() => void moderateSelected("approved")} type="button" variant="secondary">
            Aprovar
          </Button>
          <Button className={cn(rowButtonClass, "border-[var(--border-strong)]")} disabled={anyBusy} onClick={() => void moderateSelected("hidden")} type="button" variant="secondary">
            Ocultar
          </Button>
          <Button className={cn(rowButtonClass, "border-[var(--border-strong)]")} disabled={anyBusy} onClick={() => void moderateSelected("spam")} type="button" variant="secondary">
            Spam
          </Button>
          <Button className={ghostRowButton} disabled={anyBusy} onClick={() => setSelectedRaw(new Set())} type="button" variant="ghost">
            Limpar seleção
          </Button>
        </div>
      ) : null}

      <div className="@container min-w-0">
        <div className={cn(adminCard, "hidden overflow-hidden @min-[640px]:block")}>
          <table className="w-full table-fixed border-collapse text-sm text-[var(--text-primary)]">
            <caption className="sr-only">Comentários das aulas</caption>
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                {canModerate ? (
                  <th className={cn(headCell, "w-11 pr-0 pl-4")} scope="col">
                    <Checkbox
                      aria-label="Selecionar todos os comentários desta página"
                      checked={allState === "all"}
                      onCheckedChange={() => setSelectedRaw(toggleAllSelected(selected, pageIds, COMMUNITY_BULK_LIMIT))}
                    />
                  </th>
                ) : null}
                <th className={cn(headCell, !canModerate && "pl-4")} scope="col">
                  Comentário
                </th>
                <th className={cn(headCell, "w-[132px]")} scope="col">
                  Situação
                </th>
                <th className={cn(headCell, "hidden w-[84px] text-right @min-[1040px]:table-cell")} scope="col">
                  Reações
                </th>
                <th className={cn(headCell, "hidden w-[96px] text-right @min-[960px]:table-cell")} scope="col">
                  Denúncias
                </th>
                <th className={cn(headCell, "w-[88px]")} scope="col">
                  Quando
                </th>
                <th className={cn(headCell, "w-[172px] pr-4 text-right")} scope="col">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const status = statusOf(item);
                const isBusy = busy.has(item.id);

                return (
                  <tr
                    aria-busy={isBusy || undefined}
                    className={cn(
                      "border-b border-[var(--border-subtle)] align-top last:border-b-0 hover:bg-[var(--hover-overlay)]",
                      selected.has(item.id) && "bg-[var(--hover-overlay)]",
                      isBusy && "opacity-60",
                      adminTransition
                    )}
                    key={item.id}
                  >
                    {canModerate ? (
                      <td className="py-3.5 pr-0 pl-4">
                        <Checkbox
                          aria-label={`Selecionar o comentário de ${item.author.name}`}
                          checked={selected.has(item.id)}
                          onCheckedChange={() => setSelectedRaw(toggleSelected(selected, item.id))}
                        />
                      </td>
                    ) : null}
                    <td className={cn("min-w-0 px-3 py-3", !canModerate && "pl-4")}>
                      <CommentCell item={item} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex min-w-0 flex-col items-start gap-1">
                        <StatusChip tone={commentStatusTone(status)}>{statusLabel(status)}</StatusChip>
                        <AnswerNote item={item} />
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 text-right text-[var(--text-secondary)] tabular-nums @min-[1040px]:table-cell">
                      {new Intl.NumberFormat("pt-BR").format(item.reactionCount)}
                    </td>
                    <td
                      className={cn(
                        "hidden px-3 py-3 text-right tabular-nums @min-[960px]:table-cell",
                        item.reportCount > 0 ? "text-[var(--warning)]" : "text-[var(--text-secondary)]"
                      )}
                    >
                      {new Intl.NumberFormat("pt-BR").format(item.reportCount)}
                    </td>
                    <td className="truncate px-3 py-3 text-[13px] text-[var(--text-secondary)]" title={formatFullDate(item.createdAt)}>
                      <time dateTime={item.createdAt}>{formatWaitingTime(item.createdAt, now)}</time>
                    </td>
                    <td className="px-3 py-2 pr-4">
                      <div className="flex items-center justify-end gap-1">
                        {canModerate
                          ? rowModerationActions(status).map((action) => (
                              <Button
                                className={ghostRowButton}
                                disabled={isBusy}
                                key={action.status}
                                onClick={() => void moderateOne(item, action.status)}
                                type="button"
                                variant="ghost"
                              >
                                {action.label}
                              </Button>
                            ))
                          : null}
                        <RowMenu actions={rowMenuActions(item)} disabled={isBusy} label={`Mais ações para o comentário de ${item.author.name}`} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <ul aria-label="Comentários das aulas" className="flex flex-col gap-2 @min-[640px]:hidden">
          {items.map((item) => {
            const status = statusOf(item);
            const isBusy = busy.has(item.id);

            return (
              <li aria-busy={isBusy || undefined} className={cn(adminCard, "flex min-w-0 flex-col gap-3 p-3", isBusy && "opacity-60")} key={item.id}>
                <div className="flex min-w-0 items-start gap-3">
                  {canModerate ? (
                    <span className="grid size-11 shrink-0 place-items-center">
                      <Checkbox
                        aria-label={`Selecionar o comentário de ${item.author.name}`}
                        checked={selected.has(item.id)}
                        onCheckedChange={() => setSelectedRaw(toggleSelected(selected, item.id))}
                      />
                    </span>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <CommentCell item={item} />
                  </div>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-[var(--text-tertiary)]">
                  <StatusChip tone={commentStatusTone(status)}>{statusLabel(status)}</StatusChip>
                  <time dateTime={item.createdAt} title={formatFullDate(item.createdAt)}>
                    {formatWaitingTime(item.createdAt, now)}
                  </time>
                  <span className="inline-flex items-center gap-1">
                    <Heart aria-hidden="true" className="size-3.5" />
                    {item.reactionCount}
                  </span>
                  {item.reportCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-[var(--warning)]">
                      <Flag aria-hidden="true" className="size-3.5" />
                      {plural(item.reportCount, "denúncia", "denúncias")}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  {canModerate
                    ? rowModerationActions(status).map((action) => (
                        <Button
                          className={cn(rowButtonClass, "border-[var(--border-strong)]")}
                          disabled={isBusy}
                          key={action.status}
                          onClick={() => void moderateOne(item, action.status)}
                          type="button"
                          variant="secondary"
                        >
                          {action.label}
                        </Button>
                      ))
                    : null}
                  <span className="ml-auto">
                    <RowMenu actions={rowMenuActions(item)} disabled={isBusy} label={`Mais ações para o comentário de ${item.author.name}`} />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<CommentStatusValue, string> = {
  approved: "Visível",
  hidden: "Oculto",
  pending: "Aguardando",
  spam: "Spam"
};

function statusLabel(status: CommentStatusValue) {
  return STATUS_LABELS[status];
}

function AnswerNote({ item }: { item: CommentListItem }) {
  if (item.kind !== "comment" || item.authorRole !== "student") {
    return null;
  }

  const text = item.answered ? "Com resposta" : item.resolved ? "Resolvido" : "Sem resposta";

  return <span className="truncate text-xs leading-5 text-[var(--text-tertiary)]">{text}</span>;
}

function CommentCell({ item }: { item: CommentListItem }) {
  const isStaff = item.authorRole !== "student";

  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <AuthorAvatar accent={item.path.productAccent} initials={item.author.initials} professor={isStaff} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex min-w-0 items-center gap-2 text-[13px] leading-5">
          <span className="truncate font-semibold text-[var(--text-primary)]">{item.author.name}</span>
          {isStaff ? <ProfessorBadge /> : null}
          {item.kind === "reply" ? (
            <span className="hidden truncate text-xs text-[var(--text-tertiary)] sm:inline">respondeu a {item.parentAuthorName}</span>
          ) : null}
        </p>
        <p className="line-clamp-2 text-sm leading-5 text-[var(--text-primary)] [overflow-wrap:anywhere]" title={item.body}>
          {item.body}
        </p>
        {item.path.adminHref ? (
          <Link
            className={cn("w-fit max-w-full truncate rounded-sm text-xs leading-5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]", adminTransition)}
            data-navigation-feedback="false"
            href={item.path.adminHref}
            title={`Abrir a aula no admin: ${item.path.label}`}
          >
            {item.path.label}
          </Link>
        ) : (
          <span className="w-fit max-w-full truncate text-xs leading-5 text-[var(--text-tertiary)]">{item.path.label}</span>
        )}
      </div>
    </div>
  );
}

"use client";

import { Check, ChevronDown, GraduationCap, MonitorPlay, ShieldAlert, UserRound } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { moderateComment } from "@/server/community/actions";
import { formatWaitingTime } from "@/server/community/model";
import type { ReportHistoryEntry, ReportItem } from "@/server/community/types";
import { ErrorBanner } from "../error-banner";
import { StatusChip } from "../status-chip";
import { adminCard, adminTransition } from "../styles";
import { adminToast } from "../toast";
import { AuthorAvatar } from "./author-avatar";
import { formatFullDate, plural, studentSearchHref } from "./hrefs";
import { moderationToastMessage, type ModerationStatus } from "./moderation-model";
import { REPORT_HISTORY_LABELS, describeReportResolution } from "./report-model";
import { RowMenu, rowButtonClass, type RowMenuAction } from "./row-menu";

// Aba Denuncias (docs/17 §1.9): abertas primeiro, com o comentario citado, motivo(s), contagem e o
// historico de moderacao (quem fez o que e quando). Manter visivel, Ocultar ou Spam resolvem a
// denuncia (a regra e: denuncia aberta = mais nova que a ultima acao de moderacao).

type ReportListProps = {
  canModerate: boolean;
  items: readonly ReportItem[];
  nowIso: string;
};

type LocalReport = {
  history: ReportHistoryEntry[];
  open: boolean;
  status: ReportItem["comment"]["status"];
};

const ghostButton = cn(rowButtonClass, "text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]");

const ACTION_FOR_STATUS: Record<ModerationStatus, ReportHistoryEntry["action"]> = {
  approved: "approved",
  hidden: "hidden",
  spam: "marked_spam"
};

export function ReportList({ canModerate, items, nowIso }: ReportListProps) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [local, setLocal] = useState<{ items: readonly ReportItem[]; values: Record<string, LocalReport> }>({ items, values: {} });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (local.items !== items) {
    setLocal({ items, values: {} });
  }

  function stateOf(report: ReportItem): LocalReport {
    return local.values[report.comment.id] ?? { history: report.history, open: report.open, status: report.comment.status };
  }

  function apply(report: ReportItem, status: ModerationStatus) {
    const current = stateOf(report);
    const entry: ReportHistoryEntry = {
      action: status === "approved" && current.status !== "approved" ? "restored" : ACTION_FOR_STATUS[status],
      actorName: "Você",
      createdAt: new Date().toISOString(),
      note: null
    };

    setLocal((state) => ({
      items: state.items,
      values: { ...state.values, [report.comment.id]: { history: [entry, ...current.history], open: false, status } }
    }));
  }

  async function moderate(report: ReportItem, status: ModerationStatus) {
    const previous = stateOf(report);
    setError(null);
    setBusy(report.comment.id);

    const result = await moderateComment({ commentId: report.comment.id, status });
    setBusy(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    apply(report, status);

    const message = status === "approved" ? "Comentário mantido. Denúncia resolvida." : `${moderationToastMessage(status, 1)}. Denúncia resolvida.`;

    adminToast.success(
      message,
      status === "approved"
        ? {}
        : {
            onUndo: async () => {
              const undo = await moderateComment({ commentId: report.comment.id, status: "approved" });

              if (undo.ok) {
                setLocal((state) => ({
                  items: state.items,
                  values: { ...state.values, [report.comment.id]: { ...previous, open: false, status: "approved" } }
                }));
                adminToast.success("Comentário visível de novo");
              } else {
                setError(undo.error);
              }
            }
          }
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      <ul aria-label="Comentários denunciados" className={cn(adminCard, "flex min-w-0 flex-col overflow-hidden")}>
        {items.map((report) => (
          <ReportRow
            busy={busy === report.comment.id}
            canModerate={canModerate}
            key={report.comment.id}
            now={now}
            onModerate={(status) => void moderate(report, status)}
            report={report}
            state={stateOf(report)}
          />
        ))}
      </ul>
    </div>
  );
}

type ReportRowProps = {
  busy: boolean;
  canModerate: boolean;
  now: Date;
  onModerate: (status: ModerationStatus) => void;
  report: ReportItem;
  state: LocalReport;
};

function ReportRow({ busy, canModerate, now, onModerate, report, state }: ReportRowProps) {
  const { comment } = report;
  const historyId = useId();
  const [historyOpen, setHistoryOpen] = useState(false);
  const resolution = describeReportResolution(state.history, now);
  const menuActions: RowMenuAction[] = [
    ...(comment.authorRole === "student" ? [{ href: studentSearchHref(comment.author.name), icon: UserRound, label: "Ver aluno" }] : []),
    { href: comment.path.adminHref, icon: GraduationCap, label: "Abrir aula no admin" },
    ...(comment.path.studentHref ? [{ external: true, href: comment.path.studentHref, icon: MonitorPlay, label: "Ver na área do aluno" }] : [])
  ];

  return (
    <li
      aria-busy={busy || undefined}
      className={cn("flex min-w-0 flex-col gap-3 border-b border-[var(--border-subtle)] p-4 last:border-b-0", busy && "opacity-60", adminTransition)}
    >
      <div className="flex min-w-0 items-start gap-3">
        <AuthorAvatar accent={comment.path.productAccent} initials={comment.author.initials} professor={comment.authorRole !== "student"} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm leading-5 font-semibold text-[var(--text-primary)]">
            {comment.kind === "reply" ? "Resposta" : "Comentário"} de {comment.author.name}
          </span>
          <Link
            className={cn("w-fit max-w-full rounded-sm text-[13px] leading-5 text-[var(--text-secondary)] [overflow-wrap:anywhere] hover:text-[var(--text-primary)] md:truncate", adminTransition)}
            data-navigation-feedback="false"
            href={comment.path.adminHref}
            title={`Abrir a aula no admin: ${comment.path.label}`}
          >
            {comment.path.label}
          </Link>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusChip tone={state.open ? "warning" : "muted"}>{state.open ? "Aberta" : "Resolvida"}</StatusChip>
          <time className="text-xs leading-5 text-[var(--text-tertiary)]" dateTime={report.lastReportedAt} title={formatFullDate(report.lastReportedAt)}>
            {formatWaitingTime(report.lastReportedAt, now)}
          </time>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2.5 md:pl-11">
        <blockquote className="max-w-[75ch] rounded-r-lg border-l-2 border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2.5 text-[13px] leading-5 whitespace-pre-line text-[var(--text-secondary)] [overflow-wrap:anywhere]">
          {comment.body}
        </blockquote>

        <p className="text-xs leading-5 font-medium text-[var(--text-tertiary)] [overflow-wrap:anywhere]">
          {plural(report.reportCount, "denúncia", "denúncias")} · motivo{report.reasons.length === 1 ? "" : "s"}: {report.reasons.join(", ") || "sem motivo informado"}
          {state.status !== "approved" ? ` · comentário ${state.status === "spam" ? "marcado como spam" : state.status === "hidden" ? "oculto" : "aguardando"}` : ""}
        </p>

        {state.open && canModerate ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button className={cn(rowButtonClass, "border-[var(--border-strong)]")} disabled={busy} onClick={() => onModerate("hidden")} type="button" variant="secondary">
              Ocultar comentário
            </Button>
            <Button className={ghostButton} disabled={busy} onClick={() => onModerate("approved")} type="button" variant="ghost">
              Manter visível
            </Button>
            <RowMenu
              actions={[{ icon: ShieldAlert, label: "Marcar como spam", onSelect: () => onModerate("spam") }, ...menuActions.map((action, index) => (index === 0 ? { ...action, separatorBefore: true } : action))]}
              disabled={busy}
              label={`Mais ações para o comentário de ${comment.author.name}`}
            />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {resolution ? (
              <p className="inline-flex items-center gap-1.5 text-xs leading-5 font-medium text-[var(--text-secondary)]">
                <Check aria-hidden="true" className="size-3.5 text-[var(--success)]" />
                {resolution}
              </p>
            ) : null}
            {canModerate && state.status !== "approved" ? (
              <Button className={ghostButton} disabled={busy} onClick={() => onModerate("approved")} type="button" variant="ghost">
                Restaurar
              </Button>
            ) : null}
            <span className="ml-auto">
              <RowMenu actions={menuActions} disabled={busy} label={`Mais ações para o comentário de ${comment.author.name}`} />
            </span>
          </div>
        )}

        {state.history.length > 0 ? (
          <div className="flex min-w-0 flex-col gap-2">
            <button
              aria-controls={historyId}
              aria-expanded={historyOpen}
              className={cn(
                "inline-flex h-11 w-fit items-center gap-1.5 rounded-md text-[13px] leading-5 font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] md:h-7",
                adminTransition
              )}
              onClick={() => setHistoryOpen((value) => !value)}
              type="button"
            >
              <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform duration-150", historyOpen && "rotate-180")} />
              Histórico ({state.history.length})
            </button>
            {historyOpen ? (
              <ol className="flex min-w-0 flex-col gap-1.5 border-l border-[var(--border-strong)] pl-3" id={historyId}>
                {state.history.map((entry, index) => (
                  <li className="text-xs leading-5 text-[var(--text-secondary)] [overflow-wrap:anywhere]" key={`${entry.createdAt}-${index}`}>
                    <span className="font-medium text-[var(--text-primary)]">{REPORT_HISTORY_LABELS[entry.action]}</span>
                    {` por ${entry.actorName ?? "alguém da equipe"} · `}
                    <time dateTime={entry.createdAt}>{formatFullDate(entry.createdAt)}</time>
                    {entry.note ? ` · “${entry.note}”` : ""}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

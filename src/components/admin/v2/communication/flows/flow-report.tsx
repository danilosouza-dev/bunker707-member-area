"use client";

import { Info, Pause, Pencil, Play, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { describeAudience } from "@/server/communications/audience-model";
import { withdrawFlowMessage } from "@/server/communications/flow-actions";
import type { FlowBranch } from "@/server/communications/flow-model";
import type { FlowDetail } from "@/server/communications/flow-queries";
import type { FlowNodeDraft } from "@/server/communications/flow-schemas";
import type { NoticeEditorOptions } from "@/server/communications/queries";
import { pageKeyOfHref } from "@/server/member-area/page-visit-model";
import { ErrorBanner } from "../../error-banner";
import { KpiTile } from "../../kpi-tile";
import { AdminLinkButton } from "../../link-button";
import { AdminPage } from "../../page-container";
import { PageHeader } from "../../page-header";
import { AdminSwitch, ConfirmDialog, type RowMenuAction } from "../../settings/kit";
import { StatusChip } from "../../status-chip";
import { adminCard } from "../../styles";
import { adminToast } from "../../toast";
import { useAdminTopbarTitle } from "../../topbar-title";
import { useMediaQuery } from "../../use-media-query";
import { audienceMessageOptions, audienceNamesWithMessages, formatPercent, ratio } from "../notices-view-model";
import { FlowWorkspace } from "./flow-builder";
import { FlowCanvas } from "./flow-canvas";
import { StepNumbers } from "./flow-inspector";
import { FlowRowMenu, useFlowActions, type FlowActionTarget } from "./flow-row-menu";
import {
  backlogLine,
  conditionReportLines,
  describeFlowReview,
  describeNotReceived,
  ENTRY_MODE_OPTIONS,
  entryReportLines,
  entrySentence,
  FLOW_TOASTS,
  flowAudienceNames,
  flowHref,
  FLOWS_HREF,
  flowTitleOf,
  formatReportValue,
  messageReportLines,
  noticeOriginBanner,
  notReceivedLines,
  preorder,
  removedStepLabel,
  sourceNoticeHref,
  withdrawStepCopy,
  type FlowPermissions,
  type ReportLine
} from "./flows-view-model";

// Relatorio de um fluxo (docs/23 §2.8): o desenho com os numeros de cada passo (chave "Mostrar números",
// ligada), os numeros de "Quem entra" no topo, a linha de atraso so quando ha fila vencida e, embaixo, a
// tabela acessivel "Números por passo" (tambem os passos removidos, "Passo removido em 21/10"). Tocar num
// passo mostra os numeros dele (no celular, folha de tela cheia com "Concluir"). Pausar, Retomar, Editar (as
// alteracoes, ?editar=1) e "Retirar do sino" de um passo ficam para quem pode publicar.

type FlowReportProps = {
  detail: FlowDetail;
  initialStep?: string | null;
  now: number;
  options: NoticeEditorOptions;
  permissions: FlowPermissions;
};

const NARROW_QUERY = "(min-width: 1024px)";

function Note({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warning" }) {
  const Icon = tone === "warning" ? TriangleAlert : Info;

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm leading-5",
        tone === "warning" ? "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--text-primary)]" : "border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-secondary)]"
      )}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", tone === "warning" && "text-[var(--warning)]")} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function situationNote(detail: FlowDetail) {
  switch (detail.situation) {
    case "paused":
      return "Fluxo pausado. Nada sai até você retomar. As esperas continuam contando.";
    case "finished":
      return "Fluxo concluído: ninguém mais tinha passo pela frente. Os números ficam aqui.";
    case "ended":
      return "Fluxo encerrado: ninguém mais entra e nada mais sai. As notificações já enviadas continuam no sino.";
    case "waiting_notice":
      return "A notificação principal ainda não saiu: o fluxo começa quando ela sair.";
    default:
      return null;
  }
}

function LinesRows({ lines }: { lines: readonly ReportLine[] }) {
  return (
    <>
      {lines.map((line) => (
        <tr className="border-b border-[var(--border-subtle)] last:border-b-0" key={line.id}>
          <th className="py-2 pr-3 pl-4 text-left font-normal text-[var(--text-secondary)]" scope="row">
            {line.label}
            {line.help ? <span className="block text-xs text-[var(--text-tertiary)]">{line.help}</span> : null}
          </th>
          <td className="px-3 py-2 text-right text-[var(--text-primary)] tabular-nums">{formatReportValue(line.value)}</td>
          <td className="py-2 pr-4 pl-3 text-right text-[var(--text-secondary)] tabular-nums">{line.share ?? ""}</td>
        </tr>
      ))}
    </>
  );
}

export function FlowReport({ detail, initialStep = null, now, options, permissions }: FlowReportProps) {
  const router = useRouter();
  const wide = useMediaQuery(NARROW_QUERY);
  const draft = detail.draft;
  const source = detail.source;
  const report = detail.report;
  const entryNode = draft.nodes.find((node) => node.kind === "entry") ?? null;
  const [selected, setSelected] = useState<string | null>(() => (initialStep && draft.nodes.some((node) => node.id === initialStep && node.kind !== "entry") ? initialStep : null));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sides, setSides] = useState<Record<string, FlowBranch>>({});
  const [showNumbers, setShowNumbers] = useState(true);
  const [withdrawing, setWithdrawing] = useState<{ nodeId: string; received: number; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const flowActions = useFlowActions({ onDeleted: () => router.push(FLOWS_HREF) });
  const baseNames = useMemo(() => audienceNamesWithMessages(options.names, audienceMessageOptions("segment", { notices: options.notices })), [options.names, options.notices]);
  const names = useMemo(() => flowAudienceNames(baseNames, draft, source), [baseNames, draft, source]);
  const titleOf = useMemo(() => flowTitleOf(draft, source), [draft, source]);
  const live = detail.status === "active" || detail.status === "paused";
  const canEdit = live && detail.actions.includes("edit");
  const canPause = detail.actions.includes("pause");
  const canResume = detail.actions.includes("resume");
  const busyAction = flowActions.busyKey?.startsWith(`${detail.id}:`) ?? false;
  const target: FlowActionTarget = {
    actions: detail.actions,
    entryCount: detail.entryCount,
    entryMode: draft.entry.mode,
    id: detail.id,
    name: draft.name,
    origin: draft.origin,
    sourceId: source?.id ?? null,
    status: detail.status,
    updatedAt: detail.updatedAt
  };
  const review = describeFlowReview({ count: detail.entryCount, goal: draft.goal, mode: draft.entry.mode, names, nodes: draft.nodes, origin: draft.origin, sourceTitle: source?.title });
  const entryLines = entryReportLines({
    enteredToday: report?.enteredToday ?? null,
    hasGoal: Boolean(draft.goal),
    origin: draft.origin,
    sourceRecipients: report?.sourceFunnel?.recipients ?? source?.recipients ?? null,
    totals: report?.totals ?? null
  });
  const funnel = report?.sourceFunnel ?? null;
  const backlog = backlogLine(report?.overdue);
  const note = situationNote(detail);
  const steps = preorder(draft.nodes).filter((node) => node.kind !== "entry");
  const selectedNode = selected ? (draft.nodes.find((node) => node.id === selected) ?? null) : null;

  useAdminTopbarTitle(draft.name);

  function select(nodeId: string) {
    setSelected(nodeId === entryNode?.id ? null : nodeId);

    if (!wide) {
      setSheetOpen(true);
    }
  }

  function requestWithdraw(node: FlowNodeDraft) {
    setWithdrawing({ nodeId: node.id, received: report?.nodes[node.id]?.received ?? 0, title: titleOf(node.id) });
  }

  async function withdraw() {
    if (!withdrawing) {
      return;
    }

    setBusy(true);
    setFailure(null);
    const result = await withdrawFlowMessage({ expectedUpdatedAt: detail.updatedAt, id: detail.id, nodeId: withdrawing.nodeId });
    setBusy(false);
    setWithdrawing(null);

    if (!result.ok) {
      setFailure(result.error);
      return;
    }

    adminToast.success(FLOW_TOASTS.withdrawn);
    router.refresh();
  }

  const reportMenu = (node: FlowNodeDraft): RowMenuAction[] =>
    node.kind === "message" && live && permissions.canPublish ? [{ destructive: true, label: "Retirar do sino", onSelect: () => requestWithdraw(node) }] : [];

  let panelTitle = "Quem entra";
  let panelDescription: ReactNode = null;
  let panel: ReactNode;

  if (selectedNode?.kind === "message") {
    panelTitle = "Notificação";
    panelDescription = titleOf(selectedNode.id);
    panel = (
      <StepNumbers
        content={draft.messages[selectedNode.id] ?? null}
        context={{ now, options, senders: options.senders }}
        kind="message"
        stats={report?.nodes[selectedNode.id] ?? null}
        withdraw={live && permissions.canPublish ? () => requestWithdraw(selectedNode) : null}
      />
    );
  } else if (selectedNode?.kind === "condition") {
    panelTitle = "Condição";
    panelDescription = describeAudience(selectedNode.condition, names);
    panel = <StepNumbers content={null} context={{ now, options, senders: options.senders }} kind="condition" stats={report?.nodes[selectedNode.id] ?? null} withdraw={null} />;
  } else {
    panel = (
      <div className="flex min-w-0 flex-col gap-4">
        <p className="text-sm leading-6 text-[var(--text-primary)]">{review}</p>
        <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3">
          {entryLines.map((line) => (
            <div className="flex min-w-0 flex-col gap-0.5" key={line.id}>
              <dt className="text-xs leading-4 font-medium text-[var(--text-tertiary)]">{line.label}</dt>
              <dd className="text-base leading-6 font-semibold text-[var(--text-primary)] tabular-nums">{formatReportValue(line.value)}</dd>
              {line.help ? <dd className="text-xs leading-4 text-[var(--text-secondary)]">{line.help}</dd> : null}
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <AdminPage className="gap-6">
      <PageHeader
        actions={
          <>
            {canPause ? (
              <Button className="px-4" disabled={busyAction} onClick={() => flowActions.request("pause", target)} type="button" variant="secondary">
                <Pause aria-hidden="true" className="size-4" />
                Pausar
              </Button>
            ) : null}
            {canResume ? (
              <Button className="px-4" disabled={busyAction} onClick={() => flowActions.request("resume", target)} type="button">
                <Play aria-hidden="true" className="size-4" />
                Retomar
              </Button>
            ) : null}
            {canEdit ? (
              <AdminLinkButton href={flowHref(detail.id, { edit: true })} variant="secondary">
                <Pencil aria-hidden="true" className="size-4" />
                Editar
              </AdminLinkButton>
            ) : null}
            <FlowRowMenu exclude={["edit", "pause", "resume"]} flow={target} onRequest={flowActions.request} />
          </>
        }
        breadcrumb={[{ href: FLOWS_HREF, label: "Fluxos" }, { label: "Relatório" }]}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusChip tone={detail.situationTone}>{detail.situationLabel}</StatusChip>
            {/* O "·" fica no fim da frase: se a linha quebrar (375 px), a de baixo nao comeca com ele. */}
            <span>
              {entrySentence({ audience: draft.entry.audience, names, origin: draft.origin, sourceTitle: source?.title })}
              {draft.origin === "builder" ? <span className="text-[var(--text-tertiary)]"> ·</span> : null}
            </span>
            {draft.origin === "builder" ? (
              <span className="text-[var(--text-tertiary)]">{ENTRY_MODE_OPTIONS.find((option) => option.value === draft.entry.mode)?.label}</span>
            ) : null}
          </span>
        }
        title={draft.name}
      />

      {flowActions.errorBanner}
      {failure ? (
        <ErrorBanner
          action={
            <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setFailure(null)} type="button" variant="ghost">
              Fechar
            </Button>
          }
          title="Não foi possível retirar do sino"
        >
          {failure}
        </ErrorBanner>
      ) : null}

      {draft.origin === "notice" && source ? (
        <Note>
          <p>{noticeOriginBanner(source.title)}</p>
          <Link className="mt-1 inline-block font-medium text-[var(--text-primary)] underline underline-offset-2" href={sourceNoticeHref(source.id)}>
            Abrir a notificação
          </Link>
        </Note>
      ) : null}
      {note ? <Note>{note}</Note> : null}
      {backlog ? <Note tone="warning">{backlog}</Note> : null}
      {live && !permissions.canPublish ? <Note>Só quem pode publicar muda um fluxo no ar. Duplique para criar outro.</Note> : null}

      <section aria-label="Números de quem entra" className={cn("grid grid-cols-2 gap-3", entryLines.length > 4 ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
        {entryLines.map((line) => (
          <KpiTile definition={line.help} definitionShort={line.help} key={line.id} label={line.label} value={line.value} />
        ))}
      </section>

      {funnel ? (
        <section aria-label="A notificação principal" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <KpiTile definition={`${formatPercent(ratio(funnel.seen, funnel.recipients))} de quem recebeu`} label="Viram" value={funnel.seen} />
          <KpiTile definition={`${formatPercent(ratio(funnel.opened, funnel.seen))} de quem viu`} label="Abriram" value={funnel.opened} />
          <KpiTile definition={`${formatPercent(ratio(funnel.clicked, funnel.seen))} de quem viu`} label="Clicaram" value={funnel.clicked} />
        </section>
      ) : null}

      <div className="-mb-2 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <AdminSwitch checked={showNumbers} id="fluxo-relatorio-numeros" label="Mostrar números" onCheckedChange={setShowNumbers} />
      </div>

      <FlowWorkspace
        canvas={
          <FlowCanvas
            draft={draft}
            editing={null}
            entry={{ countLine: null, modeLabel: null, sentence: entrySentence({ audience: draft.entry.audience, names, origin: draft.origin, sourceTitle: source?.title }) }}
            names={names}
            narrow={!wide}
            numbers={
              showNumbers && report
                ? { entry: `Entraram ${formatReportValue(report.totals.entered)} · No fluxo agora ${formatReportValue(report.totals.active)}`, steps: report.nodes }
                : null
            }
            onSelect={select}
            onSideChange={(conditionId, side) => setSides((current) => ({ ...current, [conditionId]: side }))}
            problems={new Map()}
            reportMenu={reportMenu}
            schoolIconUrl={options.branding.iconUrl}
            selectedId={selected ?? entryNode?.id ?? null}
            senderOf={(userId) => {
              const person = userId ? options.senders.find((sender) => sender.id === userId) : null;
              return person ? { avatarUrl: person.avatarUrl, name: person.name } : null;
            }}
            sides={sides}
            titleOf={titleOf}
          />
        }
        onSheetOpenChange={setSheetOpen}
        panel={panel}
        panelDescription={panelDescription}
        panelTitle={panelTitle}
        sheetOpen={sheetOpen}
        wide={wide}
      />

      <section aria-labelledby="fluxo-numeros-titulo" className={cn(adminCard, "min-w-0 overflow-hidden")}>
        <h2 className="px-4 pt-4 pb-2 text-base leading-6 font-semibold text-[var(--text-primary)]" id="fluxo-numeros-titulo">
          Números por passo
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <caption className="sr-only">Números por passo</caption>
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--text-tertiary)]">
                <th className="py-2 pr-3 pl-4 text-left font-medium" scope="col">
                  Número
                </th>
                <th className="px-3 py-2 text-right font-medium" scope="col">
                  Alunos
                </th>
                <th className="py-2 pr-4 pl-3 text-right font-medium" scope="col">
                  Do anterior
                </th>
              </tr>
            </thead>
            {steps.map((node) => {
              const stats = report?.nodes[node.id] ?? null;
              const content = node.kind === "message" ? draft.messages[node.id] : undefined;
              const notReceived = node.kind === "message" ? notReceivedLines(stats) : null;

              return (
                <tbody key={node.id}>
                  <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-2)]">
                    <th className="py-2 pr-4 pl-4 text-left text-[13px] font-semibold text-[var(--text-primary)]" colSpan={3} scope="rowgroup">
                      {node.kind === "message" ? `Notificação: ${titleOf(node.id)}` : `Condição: ${describeAudience(node.condition, names)}`}
                    </th>
                  </tr>
                  <LinesRows
                    lines={
                      node.kind === "message"
                        ? messageReportLines(stats, { ctaTracked: Boolean(pageKeyOfHref(content?.cta?.href ?? null)), hasAudio: Boolean(content?.audio), hasCta: Boolean(content?.cta), hasResponse: Boolean(content?.response) })
                        : conditionReportLines(stats)
                    }
                  />
                  {notReceived ? (
                    <tr className="border-b border-[var(--border-subtle)]">
                      <th className="py-2 pr-3 pl-4 text-left font-normal text-[var(--text-secondary)]" scope="row">
                        Não receberam
                        {describeNotReceived(notReceived.parts) ? <span className="block text-xs text-[var(--text-tertiary)]">{describeNotReceived(notReceived.parts)}</span> : null}
                      </th>
                      <td className="px-3 py-2 text-right text-[var(--text-primary)] tabular-nums">{formatReportValue(notReceived.total)}</td>
                      <td className="py-2 pr-4 pl-3" />
                    </tr>
                  ) : null}
                </tbody>
              );
            })}
            {(report?.removed ?? []).map((removed) => (
              <tbody key={removed.id}>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-2)]">
                  <th className="py-2 pr-4 pl-4 text-left text-[13px] font-semibold text-[var(--text-secondary)]" colSpan={3} scope="rowgroup">
                    {`${removed.title} · ${removedStepLabel(removed.removedAt)}`}
                  </th>
                </tr>
                <LinesRows
                  lines={
                    removed.kind === "message"
                      ? messageReportLines(report?.nodes[removed.id] ?? null, { ctaTracked: false, hasAudio: false, hasCta: false, hasResponse: false })
                      : conditionReportLines(report?.nodes[removed.id] ?? null)
                  }
                />
              </tbody>
            ))}
          </table>
        </div>
      </section>

      <ConfirmDialog
        busy={busy}
        confirmLabel={withdrawing ? withdrawStepCopy(withdrawing.title, withdrawing.received).confirmLabel : "Retirar do sino"}
        description={withdrawing ? withdrawStepCopy(withdrawing.title, withdrawing.received).description : undefined}
        destructive
        onConfirm={() => void withdraw()}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setWithdrawing(null);
          }
        }}
        open={withdrawing !== null}
        title={withdrawing ? withdrawStepCopy(withdrawing.title, withdrawing.received).title : ""}
      />
      {flowActions.confirmDialog}
    </AdminPage>
  );
}

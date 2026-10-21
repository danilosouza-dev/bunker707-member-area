"use client";

import { CircleStop } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { closeNoticePoll } from "@/server/communications/actions";
import type { NoticePermissions } from "@/server/communications/campaign-model";
import type { NoticeDetail } from "@/server/communications/queries";
import { ErrorBanner } from "../error-banner";
import { KpiTile } from "../kpi-tile";
import { ConfirmDialog, SectionCard } from "../settings/kit";
import { adminToast } from "../toast";
import {
  CLOSE_POLL_CONFIRM,
  CLOSE_POLL_TOAST,
  canCloseNoticePoll,
  pollReportLines,
  pollReportRows,
  pollStatusLine,
  reactionReport,
  showsReactionReport
} from "./notices-view-model";

// O que o aluno fez direto no sino, no relatorio da notificacao (docs/24 §2.6): "Reações" (quem reagiu
// sobre quem viu e um cartao por emoji, sobre o total de reacoes) e "Enquete" (a pergunta, cada opcao com
// a parte de quem votou, quantos votaram e mudaram o voto, quando encerra e, para quem publica com a
// enquete aberta, "Encerrar enquete"). Os numeros sao de communication_message_interactions, sem os testes
// da equipe; nunca nomes, nunca quem votou o que. O relatorio (notice-report.tsx) monta isto depois de
// "Respostas"; o terceiro cartao de Respostas ("Mudaram de resposta"), "Excluíram do sino" e o rodape do
// funil saem dos ajudantes do view model (responseChangedTile, hiddenFromBellTile, INTERACTIONS_OPEN_NOTE).

type NoticeInteractionsReportProps = {
  detail: Pick<NoticeDetail, "draft" | "flowNodeId" | "id" | "interactions" | "kind" | "stats" | "status" | "updatedAt">;
  /** Hora da leitura (servidor): a enquete encerrada por data. */
  now: number;
  permissions: NoticePermissions;
};

type Failure = { message: string; status: number };

function ReactionsSection({ detail }: Pick<NoticeInteractionsReportProps, "detail">) {
  const report = reactionReport({ reacted: detail.interactions.reacted, reactions: detail.interactions.reactions, seen: detail.stats.seen });

  return (
    <section aria-label="Reações" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiTile
        definition={report.reacted.definition}
        definitionShort={report.reacted.definitionShort}
        emptyLabel="de quem viu"
        label={report.reacted.label}
        value={report.reacted.value}
      />
      {report.tiles.map((tile) => (
        <KpiTile definition={tile.definition} definitionShort={tile.definitionShort} key={tile.id} label={tile.label} value={tile.value} />
      ))}
      {report.emptyMessage ? (
        <p className="col-span-1 self-center text-sm leading-5 text-[var(--text-secondary)] lg:col-span-3">{report.emptyMessage}</p>
      ) : null}
    </section>
  );
}

function PollSection({ detail, now, permissions }: NoticeInteractionsReportProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const poll = detail.draft.poll;

  if (!poll) {
    return null;
  }

  const { interactions } = detail;
  const rows = pollReportRows(poll, { options: interactions.pollOptions, voters: interactions.pollVoters });
  const lines = pollReportLines({ changed: interactions.pollChanged, multiple: poll.multiple, seen: detail.stats.seen, voters: interactions.pollVoters });
  const canClose = canCloseNoticePoll({
    canPublish: permissions.canPublish,
    flowNodeId: detail.flowNodeId,
    kind: detail.kind,
    now,
    poll,
    status: detail.status
  });
  const conflict = failure?.status === 409;

  async function close() {
    setBusy(true);
    setFailure(null);

    try {
      const result = await closeNoticePoll({ expectedUpdatedAt: detail.updatedAt, id: detail.id });

      if (!result.ok) {
        setFailure({ message: result.error, status: result.status });
        return;
      }

      adminToast.success(CLOSE_POLL_TOAST);
    } catch {
      setFailure({ message: "Não foi possível encerrar a enquete. Tente de novo.", status: 0 });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <SectionCard
      actions={
        canClose ? (
          <Button
            className="px-4"
            disabled={busy}
            onClick={() => {
              setFailure(null);
              setConfirming(true);
            }}
            type="button"
            variant="secondary"
          >
            <CircleStop aria-hidden="true" className="size-4" />
            {CLOSE_POLL_CONFIRM.confirmLabel}
          </Button>
        ) : null
      }
      title="Enquete"
    >
      <div className="flex min-w-0 flex-col gap-4">
        {failure ? (
          <ErrorBanner
            action={
              conflict ? (
                <Button
                  className="px-3"
                  onClick={() => {
                    setFailure(null);
                    router.refresh();
                  }}
                  type="button"
                  variant="secondary"
                >
                  Recarregar
                </Button>
              ) : (
                <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setFailure(null)} type="button" variant="ghost">
                  Fechar
                </Button>
              )
            }
            title={conflict ? "Este aviso mudou em outra tela" : "Não foi possível concluir"}
          >
            {failure.message}
          </ErrorBanner>
        ) : null}

        <p className="text-sm leading-5 font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]">{poll.question}</p>

        <ul className="flex min-w-0 flex-col gap-3">
          {rows.map((row) => (
            <li className="flex min-w-0 flex-col gap-1.5" key={row.id}>
              <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm leading-5">
                <span className={cn("min-w-0 [overflow-wrap:anywhere]", row.removed ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]")}>{row.label}</span>
                <span className="shrink-0 text-[13px] text-[var(--text-secondary)] tabular-nums">{row.summary}</span>
              </div>
              {/* A barra repete a porcentagem escrita ao lado: fora do leitor de tela. */}
              <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                <div className="h-full rounded-full bg-[var(--text-primary)]/15" style={{ width: `${Math.min(100, row.percent)}%` }} />
              </div>
            </li>
          ))}
        </ul>

        <div className="flex min-w-0 flex-col gap-1 text-[13px] leading-5 text-[var(--text-secondary)] tabular-nums">
          <p>{lines.voted}</p>
          <p>{lines.changed}</p>
          {lines.multiple ? <p>{lines.multiple}</p> : null}
          <p className="text-[var(--text-primary)]">{pollStatusLine(poll, { now, status: detail.status })}</p>
        </div>
      </div>

      <ConfirmDialog
        busy={busy}
        confirmLabel={CLOSE_POLL_CONFIRM.confirmLabel}
        description={CLOSE_POLL_CONFIRM.description}
        destructive={CLOSE_POLL_CONFIRM.destructive}
        onConfirm={() => void close()}
        onOpenChange={setConfirming}
        open={confirming}
        title={CLOSE_POLL_CONFIRM.title}
      />
    </SectionCard>
  );
}

/** Reacoes e enquete da notificacao; nada no pop-up nem quando a notificacao nao tem nenhuma das duas. */
export function NoticeInteractionsReport({ detail, now, permissions }: NoticeInteractionsReportProps) {
  if (detail.kind !== "inbox") {
    return null;
  }

  const reactions = showsReactionReport({ allowsReactions: detail.draft.reactions, kind: detail.kind, reacted: detail.interactions.reacted });

  return (
    <>
      {reactions ? <ReactionsSection detail={detail} /> : null}
      {detail.draft.poll ? <PollSection detail={detail} now={now} permissions={permissions} /> : null}
    </>
  );
}

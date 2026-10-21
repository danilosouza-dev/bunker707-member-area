"use client";

import { Info, Pause, Pencil, Play, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatSaoPauloDateTime, type NoticePermissions } from "@/server/communications/campaign-model";
import type { NoticeDetail, NoticeEditorOptions } from "@/server/communications/queries";
import { PillGroup } from "../form";
import { KpiTile } from "../kpi-tile";
import { AdminLinkButton } from "../link-button";
import type { PreviewDevice } from "../member-area/preview-frame";
import { AdminPage } from "../page-container";
import { PageHeader } from "../page-header";
import { SectionCard } from "../settings/kit";
import { StatusChip } from "../status-chip";
import { adminCard } from "../styles";
import { useAdminTopbarTitle } from "../topbar-title";
import { NoticeFollowUpsReport } from "./notice-follow-ups";
import { NoticePreview } from "./notice-preview";
import { NoticeRowMenu, useNoticeActions, type NoticeActionTarget } from "./notice-row-menu";
import {
  NOTICES_HREF,
  closedWithoutClickRate,
  formatPercent,
  formatStudentCount,
  isHighCloseRate,
  noticeAudioSteps,
  noticeAuthorLine,
  noticeFunnel,
  noticeHref,
  ratio
} from "./notices-view-model";

// Relatorio de um aviso (docs/22 §2.4; docs/17 §1.8 "funil Elegíveis → Vistos → Clicaram"): para quem
// recebeu (ou pode ver o pop-up) -> viram -> clicaram -> voltaram a estudar em 7 dias, cada passo
// sobre o anterior; respostas (Aceitaram / Recusaram) na notificacao com resposta; no pop-up, quem
// fechou sem clicar (alerta acima de 40 %), "Não mostrar de novo" e "Lembrar depois". Ao lado, o
// conteudo na previa real do aluno, a frase do segmento e a linha do tempo. Pop-up no ar: Pausar,
// Retomar e Editar ficam a mao (tambem no celular, docs/17 §1.13).
//
// v2 (docs/23): na notificacao, "Abriram" entra no funil (interacao de verdade; "Marcar todas" nao
// conta) e, com audio, "Começaram o áudio" e "Ouviram até o fim" sobre quem abriu
// (communication_campaign_engagement); quando quem envia e uma pessoa, "Criada por … · em nome de …".
// No fim, "Notificações seguintes" (NoticeFollowUpsReport): as seguintes com os numeros de cada uma e, para
// quem pode publicar, as mudancas em etapas com "Aplicar alterações".

type NoticeReportProps = {
  branding: NoticeEditorOptions["branding"];
  detail: NoticeDetail;
  /** Hora da leitura (servidor). */
  now: number;
  permissions: NoticePermissions;
};

const DEVICE_OPTIONS = [
  { label: "Computador", value: "desktop" },
  { label: "Celular", value: "mobile" }
] as const satisfies readonly { label: string; value: PreviewDevice }[];

function toTarget(detail: NoticeDetail): NoticeActionTarget {
  return {
    actions: detail.actions,
    audienceCount: detail.audienceCount,
    // v2: "Retirar do sino" avisa das seguintes e oferece retirar as que ja sairam.
    followUps: detail.followUps ? { count: detail.followUps.count, sent: detail.followUps.sent } : null,
    id: detail.id,
    kind: detail.kind,
    recipients: detail.stats.recipients,
    status: detail.status,
    title: detail.title,
    updatedAt: detail.updatedAt
  };
}

function Note({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warning" }) {
  const Icon = tone === "warning" ? TriangleAlert : Info;

  return (
    <p
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm leading-5",
        tone === "warning"
          ? "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--text-primary)]"
          : "border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-secondary)]"
      )}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", tone === "warning" && "text-[var(--warning)]")} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** "12% de quem viu" (sem ninguem que viu, so "de quem viu"). */
function ofSeen(percent: number | null) {
  return percent === null ? "de quem viu" : `${formatPercent(percent)} de quem viu`;
}

type TimelineEntry = { label: string; value: string };

function timelineOf(detail: NoticeDetail): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const when = (iso: string | null) => formatSaoPauloDateTime(iso) || "—";

  entries.push({ label: "Criado", value: `${detail.createdBy?.name ?? "Equipe"} · ${when(detail.createdAt)}` });

  if (detail.requestedAt) {
    entries.push({ label: "Aprovação pedida", value: `${detail.requestedBy?.name ?? "Equipe"} · ${when(detail.requestedAt)}` });
  }

  if (detail.approvedAt) {
    entries.push({ label: "Aprovado", value: `${detail.approvedBy?.name ?? "Equipe"} · ${when(detail.approvedAt)}` });
  }

  if (detail.kind === "inbox") {
    if (detail.sentAt) {
      entries.push({ label: "Enviado", value: when(detail.sentAt) });
    }

    if (detail.status === "canceled" && detail.sentAt) {
      entries.push({ label: "Retirado do sino", value: when(detail.updatedAt) });
    }
  } else {
    if (detail.sentAt) {
      entries.push({ label: "Publicado", value: when(detail.sentAt) });
    }

    if (detail.draft.window.startsAt) {
      entries.push({ label: "Começa", value: when(detail.draft.window.startsAt) });
    }

    if (detail.draft.window.endsAt) {
      entries.push({ label: detail.situation === "ended" ? "Terminou" : "Termina", value: when(detail.draft.window.endsAt) });
    }
  }

  return entries;
}

export function NoticeReport({ branding, detail, now, permissions }: NoticeReportProps) {
  const router = useRouter();
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const { busyKey, confirmDialog, errorBanner, request } = useNoticeActions({ onDeleted: () => router.push(NOTICES_HREF) });
  const target = toTarget(detail);
  const { engagement, stats } = detail;
  const funnel = noticeFunnel({ ...stats, opened: engagement.opened }, detail.kind);
  const audioSteps = detail.kind === "inbox" && detail.draft.audio ? noticeAudioSteps(engagement) : [];
  const authorLine = detail.kind === "inbox" ? noticeAuthorLine(detail.createdBy, detail.sender) : null;
  const closeRate = closedWithoutClickRate(stats);
  const canEdit = detail.actions.includes("edit");
  const canPause = detail.actions.includes("pause");
  const canResume = detail.actions.includes("resume");
  const busy = busyKey?.startsWith(`${detail.id}:`) ?? false;
  const answered = stats.accepted + stats.declined;

  useAdminTopbarTitle(detail.title);

  return (
    <AdminPage className="gap-6">
      <PageHeader
        actions={
          <>
            {canPause ? (
              <Button className="px-4" disabled={busy} onClick={() => request("pause", target)} type="button" variant="secondary">
                <Pause aria-hidden="true" className="size-4" />
                Pausar
              </Button>
            ) : null}
            {canResume ? (
              <Button className="px-4" disabled={busy} onClick={() => request("resume", target)} type="button">
                <Play aria-hidden="true" className="size-4" />
                Retomar
              </Button>
            ) : null}
            {canEdit ? (
              <AdminLinkButton href={noticeHref(detail.id, { edit: true })} variant="secondary">
                <Pencil aria-hidden="true" className="size-4" />
                Editar
              </AdminLinkButton>
            ) : null}
            <NoticeRowMenu exclude={["edit", "pause", "resume"]} notice={target} onRequest={request} />
          </>
        }
        breadcrumb={[{ href: NOTICES_HREF, label: "Avisos e pop-ups" }, { label: "Relatório" }]}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusChip tone={detail.situationTone}>{detail.situationLabel}</StatusChip>
            <span>{detail.kindLabel}</span>
            <span className="text-[var(--text-tertiary)]">· {detail.whenLabel}</span>
          </span>
        }
        title={detail.title}
      />

      {errorBanner}

      {detail.status === "sending" ? (
        <Note>
          {detail.lastError
            ? "O envio parou no meio e está sendo retomado. Os números aparecem conforme os alunos recebem."
            : "Enviando para o sino dos alunos. Os números aparecem em instantes."}
        </Note>
      ) : null}
      {detail.status === "canceled" && detail.kind === "inbox" ? (
        <Note>
          {detail.sentAt
            ? "Esta notificação foi retirada do sino: os alunos não veem mais. Os números de quando estava no ar continuam aqui."
            : detail.lastError
              ? "O envio não foi concluído depois de 3 tentativas. Duplique o aviso para tentar de novo."
              : "Esta notificação foi cancelada antes de sair."}
        </Note>
      ) : null}
      {detail.status === "paused" ? <Note>Pop-up pausado: os alunos não veem até você retomar.</Note> : null}

      <section aria-label="Funil do aviso" className={cn("grid grid-cols-2 gap-3", funnel.length > 4 ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
        {funnel.map((step) => (
          <KpiTile
            definition={step.percent === null ? step.base : `${formatPercent(step.percent)} ${step.base}`}
            definitionShort={step.percent === null ? step.base : `${formatPercent(step.percent)} ${step.base}`}
            emptyLabel={step.base}
            key={step.id}
            label={step.id === "studied" ? "Voltaram a estudar" : step.label}
            value={step.value}
          />
        ))}
      </section>
      <p className="-mt-3 text-xs leading-5 text-[var(--text-tertiary)]">
        {detail.kind === "inbox" ? "Abriram: tocaram no cartão, em “Ver mais”, no áudio, no botão ou responderam (“Marcar todas como lidas” não conta). " : ""}
        Voltaram a estudar: viram o aviso e estudaram nos 7 dias seguintes (pelo menos 10 min assistidos ou 1 aula concluída). A equipe e os testes não entram nos números.
      </p>

      {audioSteps.length > 0 ? (
        <section aria-label="Áudio do aviso" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {audioSteps.map((step) => (
            <KpiTile
              definition={step.percent === null ? step.base : `${formatPercent(step.percent)} ${step.base}`}
              definitionShort={step.percent === null ? step.base : `${formatPercent(step.percent)} ${step.base}`}
              emptyLabel={step.base}
              key={step.id}
              label={step.label}
              value={step.value}
            />
          ))}
        </section>
      ) : null}

      {detail.kind === "inbox" && detail.draft.response ? (
        <section aria-label="Respostas" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile
            definition={answered > 0 ? `${formatPercent(ratio(stats.accepted, answered))} de quem respondeu · “${detail.draft.response.acceptLabel}”` : `Botão “${detail.draft.response.acceptLabel}”`}
            definitionShort={answered > 0 ? `${formatPercent(ratio(stats.accepted, answered))} de quem respondeu` : `“${detail.draft.response.acceptLabel}”`}
            label="Aceitaram"
            value={stats.accepted}
          />
          <KpiTile
            definition={answered > 0 ? `${formatPercent(ratio(stats.declined, answered))} de quem respondeu · “${detail.draft.response.declineLabel}”` : `Botão “${detail.draft.response.declineLabel}”`}
            definitionShort={answered > 0 ? `${formatPercent(ratio(stats.declined, answered))} de quem respondeu` : `“${detail.draft.response.declineLabel}”`}
            label="Recusaram"
            value={stats.declined}
          />
        </section>
      ) : null}

      {detail.kind === "popup" ? (
        <section aria-label="O que fizeram com o pop-up" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile definition={ofSeen(closeRate)} label="Fecharam sem clicar" value={stats.closedWithoutClick} />
          <KpiTile definition={ofSeen(ratio(stats.dismissed, stats.seen))} label="Não mostrar de novo" value={stats.dismissed} />
          <KpiTile definition="pediram para ver de novo em 24 h" definitionShort="voltam em 24 h" label="Lembrar depois" value={stats.snoozed} />
        </section>
      ) : null}

      {detail.kind === "popup" && isHighCloseRate(closeRate) ? (
        <Note tone="warning">
          {`${formatPercent(closeRate)} de quem viu fechou sem clicar. Vale rever o título, a imagem ou para quem vai${canPause ? ", ou pausar enquanto ajusta" : ""}.`}
        </Note>
      ) : null}

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <section aria-labelledby="aviso-relatorio-conteudo" className={cn(adminCard, "flex min-w-0 flex-col gap-3 p-4")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id="aviso-relatorio-conteudo">
                Conteúdo
              </h2>
              <p className="text-[13px] leading-5 text-[var(--text-secondary)]">Como o aluno vê.</p>
            </div>
            <PillGroup ariaLabel="Aparelho da prévia" name="aviso-relatorio-aparelho" onChange={setDevice} options={DEVICE_OPTIONS} value={device} />
          </div>
          <NoticePreview
            branding={branding}
            device={device}
            draft={detail.draft}
            now={now}
            senders={detail.sender?.onTeam ? [{ avatarUrl: detail.sender.avatarUrl, id: detail.sender.id, isMe: false, name: detail.sender.name, roleLabel: "" }] : []}
          />
        </section>

        <SectionCard title="Detalhes">
          <dl className="flex min-w-0 flex-col gap-4 text-sm leading-5">
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-xs font-medium text-[var(--text-tertiary)]">Para quem</dt>
              <dd className="text-[var(--text-primary)]">{detail.audienceDescription}</dd>
              <dd className="text-[13px] text-[var(--text-secondary)] tabular-nums">
                {detail.audienceCount === null
                  ? "Contagem na hora de publicar."
                  : `${formatStudentCount(detail.audienceCount)} na última contagem${detail.audienceCountedAt ? ` (${formatSaoPauloDateTime(detail.audienceCountedAt)})` : ""}.`}
              </dd>
            </div>
            {authorLine && detail.sender ? (
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-xs font-medium text-[var(--text-tertiary)]">Quem envia</dt>
                <dd className="text-[var(--text-primary)]">{authorLine}</dd>
                {detail.sender.onTeam ? null : (
                  <dd className="text-[13px] text-[var(--text-secondary)]">{`${detail.sender.name} não está mais na equipe: os alunos veem ${branding.name}.`}</dd>
                )}
              </div>
            ) : null}
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-xs font-medium text-[var(--text-tertiary)]">Quando</dt>
              <dd className="text-[var(--text-primary)]">{detail.whenLabel}</dd>
            </div>
            {timelineOf(detail).map((entry) => (
              <div className="flex min-w-0 flex-col gap-0.5" key={entry.label}>
                <dt className="text-xs font-medium text-[var(--text-tertiary)]">{entry.label}</dt>
                <dd className="text-[var(--text-primary)] tabular-nums">{entry.value}</dd>
              </div>
            ))}
            {permissions.canWrite && !canEdit && detail.actions.includes("duplicate") ? (
              <div className="border-t border-[var(--border-subtle)] pt-4 text-[13px] leading-5 text-[var(--text-secondary)]">
                Este aviso não muda mais. Para mandar de novo ou ajustar, use Duplicar no menu.
              </div>
            ) : null}
          </dl>
        </SectionCard>
      </div>

      {/* v2 (docs/23 §2.2): as notificacoes seguintes, no ar para quem pode publicar ("Aplicar alterações"). */}
      {detail.kind === "inbox" && detail.followUps ? <NoticeFollowUpsReport detail={detail} now={now} /> : null}

      {confirmDialog}
    </AdminPage>
  );
}

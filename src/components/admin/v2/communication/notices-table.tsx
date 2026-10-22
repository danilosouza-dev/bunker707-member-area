"use client";

import { AppWindow, Bell } from "lucide-react";
import Image from "next/image";
import { noticeIconParts } from "@/components/member/notifications/notice-icons";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import type { NoticeListItem } from "@/server/communications/queries";
import { DataTable, type DataTableColumn } from "../data-table";
import { StatusChip } from "../status-chip";
import { NoticeRowMenu, useNoticeActions, type NoticeActionTarget } from "./notice-row-menu";
import { followUpsChip } from "./follow-ups-view-model";
import { formatStudentCount, noticeHref, noticeRowNumbers } from "./notices-view-model";

// Tabela de Avisos e pop-ups (docs/22 §2.1): linha inteira abre o aviso (editor no rascunho, relatorio
// depois de enviado), menu "…" com as acoes da situacao por cima do link. No celular vira um cartao
// por aviso (o menu fica no canto, dá para pausar um pop-up a 375 px; docs/17 §1.13). Vistos e Cliques
// de aviso que nunca saiu (rascunho, aguardando aprovacao, agendado) mostram "—". v2 (docs/23 §2.2): o
// chip "+2 seguintes" ao lado do tipo e, sem imagem, o icone ao lado do titulo no lugar do icone do tipo.
// v3b-1 (docs/25 §2.8): segunda linha na coluna "Quando" do pop-up que nao e o padrao (placementLabel) e o
// "Quantas vezes" (popupMode) no alvo do menu.

export function toNoticeActionTarget(item: NoticeListItem): NoticeActionTarget {
  return {
    actions: item.actions,
    audienceCount: item.audienceCount,
    // v3a: Excluir e Retirar do sino avisam das regras que citam a notificacao; o texto segue a situacao.
    citations: item.citations,
    followUps: item.followUpCount > 0 ? { count: item.followUpCount, sent: item.followUpsSent } : null,
    id: item.id,
    kind: item.kind,
    // v3b-1: o toast de "Mostrar de novo" segue o "Quantas vezes" do pop-up.
    popupMode: item.popupMode,
    recipients: item.stats.recipients,
    situation: item.situation,
    status: item.status,
    title: item.title,
    updatedAt: item.updatedAt
  };
}

/** Miniatura 16:9 da imagem do aviso, ou o icone ao lado do titulo (na cor dele), ou o icone do tipo. */
export function NoticeThumb({ icon, imageUrl, kind }: { icon?: NoticeListItem["icon"]; imageUrl: string | null; kind: NoticeListItem["kind"] }) {
  const message = noticeIconParts(icon);
  const Icon = message?.Icon ?? (kind === "inbox" ? Bell : AppWindow);

  return (
    <span
      aria-hidden="true"
      className="relative grid h-9 w-16 shrink-0 place-items-center overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)]"
    >
      {imageUrl ? (
        <Image alt="" className="object-cover" fill sizes="64px" src={imageUrl} unoptimized={!canOptimizeImageSrc(imageUrl)} />
      ) : (
        <Icon className={message ? `size-4 ${message.className}` : "size-4"} strokeWidth={message ? 2.2 : 1.75} />
      )}
    </span>
  );
}

export function NoticesTable({ items }: { items: readonly NoticeListItem[] }) {
  const { busyKey, confirmDialog, errorBanner, request } = useNoticeActions();

  const columns: DataTableColumn<NoticeListItem>[] = [
    {
      cell: (item) => (
        <span className="flex min-w-0 items-center gap-3 max-md:pr-10">
          <NoticeThumb icon={item.icon} imageUrl={item.imageUrl} kind={item.kind} />
          <span className="block min-w-0 max-w-[280px]">
            <span className="block truncate font-medium text-[var(--text-primary)]">{item.title}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
              <span className="truncate">{item.kindLabel}</span>
              {item.followUpCount > 0 ? (
                <span className="shrink-0 rounded-full border border-[var(--border-strong)] px-1.5 text-[11px] leading-4 font-medium text-[var(--text-secondary)]">
                  {followUpsChip(item.followUpCount)}
                </span>
              ) : null}
            </span>
          </span>
        </span>
      ),
      className: "min-w-[220px]",
      emphasis: true,
      header: "Aviso",
      id: "aviso"
    },
    {
      cell: (item) => (
        <span className="block min-w-0 max-w-[240px] max-md:max-w-none">
          <span className="block truncate text-[var(--text-primary)]" title={item.audienceDescription}>
            {item.audienceDescription}
          </span>
          <span className="block text-xs text-[var(--text-tertiary)] tabular-nums">{formatStudentCount(item.audienceCount)}</span>
        </span>
      ),
      className: "max-md:col-span-full",
      header: "Para quem",
      id: "para-quem",
      mobileLabel: "Para quem"
    },
    {
      cell: (item) => (
        <span className="block text-[13px] leading-5 whitespace-nowrap max-md:whitespace-normal">
          {item.whenLabel}
          {/* v3b-1: onde e quando o pop-up aparece, quando nao e o padrao (so no Inicio, ao abrir, 3 s). */}
          {item.placementLabel ? <span className="block text-xs leading-4 text-[var(--text-secondary)]">{item.placementLabel}</span> : null}
        </span>
      ),
      className: "max-md:col-span-full max-xl:hidden",
      header: "Quando",
      headerClassName: "max-xl:hidden",
      id: "quando",
      mobileLabel: "Quando"
    },
    {
      cell: (item) => <StatusChip tone={item.situationTone}>{item.situationLabel}</StatusChip>,
      header: "Situação",
      id: "situacao",
      mobileLabel: "Situação"
    },
    {
      align: "right",
      cell: (item) => noticeRowNumbers(item).seen,
      header: "Vistos",
      id: "vistos",
      mobileLabel: "Vistos"
    },
    {
      align: "right",
      cell: (item) => noticeRowNumbers(item).clicks,
      header: "Cliques",
      id: "cliques",
      mobileLabel: "Cliques"
    },
    {
      cell: (item) => (
        <span aria-busy={busyKey?.startsWith(`${item.id}:`) || undefined} className="flex justify-end">
          <NoticeRowMenu notice={toNoticeActionTarget(item)} onRequest={request} />
        </span>
      ),
      className: "relative z-10 w-14 max-md:absolute max-md:top-2.5 max-md:right-2 max-md:w-auto",
      header: <span className="sr-only">Ações</span>,
      headerClassName: "w-14",
      id: "acoes"
    }
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {errorBanner}
      <DataTable
        caption="Avisos e pop-ups"
        columns={columns}
        getRowHref={(item) => noticeHref(item.id)}
        getRowKey={(item) => item.id}
        mobile="cards"
        rows={items}
      />
      {confirmDialog}
    </div>
  );
}

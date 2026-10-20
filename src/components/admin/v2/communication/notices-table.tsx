"use client";

import { AppWindow, Bell } from "lucide-react";
import Image from "next/image";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import type { NoticeListItem } from "@/server/communications/queries";
import { DataTable, type DataTableColumn } from "../data-table";
import { StatusChip } from "../status-chip";
import { NoticeRowMenu, useNoticeActions, type NoticeActionTarget } from "./notice-row-menu";
import { formatClicks, formatInteger, formatStudentCount, noticeHref } from "./notices-view-model";

// Tabela de Avisos e pop-ups (docs/22 §2.1): linha inteira abre o aviso (editor no rascunho, relatorio
// depois de enviado), menu "…" com as acoes da situacao por cima do link. No celular vira um cartao
// por aviso (o menu fica no canto, dá para pausar um pop-up a 375 px; docs/17 §1.13).

export function toNoticeActionTarget(item: NoticeListItem): NoticeActionTarget {
  return {
    actions: item.actions,
    audienceCount: item.audienceCount,
    id: item.id,
    kind: item.kind,
    recipients: item.stats.recipients,
    status: item.status,
    title: item.title,
    updatedAt: item.updatedAt
  };
}

/** Miniatura 16:9 da imagem do aviso ou o icone do tipo. */
export function NoticeThumb({ imageUrl, kind }: { imageUrl: string | null; kind: NoticeListItem["kind"] }) {
  const Icon = kind === "inbox" ? Bell : AppWindow;

  return (
    <span
      aria-hidden="true"
      className="relative grid h-9 w-16 shrink-0 place-items-center overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)]"
    >
      {imageUrl ? (
        <Image alt="" className="object-cover" fill sizes="64px" src={imageUrl} unoptimized={!canOptimizeImageSrc(imageUrl)} />
      ) : (
        <Icon className="size-4" strokeWidth={1.75} />
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
          <NoticeThumb imageUrl={item.imageUrl} kind={item.kind} />
          <span className="block min-w-0 max-w-[280px]">
            <span className="block truncate font-medium text-[var(--text-primary)]">{item.title}</span>
            <span className="block truncate text-xs text-[var(--text-tertiary)]">{item.kindLabel}</span>
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
      cell: (item) => <span className="block text-[13px] leading-5 whitespace-nowrap max-md:whitespace-normal">{item.whenLabel}</span>,
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
      cell: (item) => formatInteger(item.stats.seen),
      header: "Vistos",
      id: "vistos",
      mobileLabel: "Vistos"
    },
    {
      align: "right",
      cell: (item) => formatClicks(item.stats.clicked, item.clickRate),
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

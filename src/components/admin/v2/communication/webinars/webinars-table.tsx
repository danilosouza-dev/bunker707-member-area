"use client";

import { CalendarClock } from "lucide-react";
import Image from "next/image";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { WEBINAR_ADMIN_COPY, webinarAdminHref, type WebinarPermissions } from "@/server/webinars/editor-model";
import type { WebinarListItem } from "@/server/webinars/queries";
import { DataTable, type DataTableColumn } from "../../data-table";
import { EMPTY_VALUE } from "../../format";
import { StatusChip } from "../../status-chip";
import { WebinarRowMenu, useWebinarActions, type WebinarActionTarget } from "./webinar-row-menu";

// Tabela de Webinários (docs/30 §2.1): capa pequena (2:3, como a do produto), titulo e tipo, data e hora (Sao
// Paulo) da proxima sessao, situacao, vagas garantidas, presentes (pico: "—" ate a fase 2) e quem criou. A linha
// inteira abre o editor; o menu "…" com as acoes da situacao fica por cima do link. No celular vira um cartao por
// webinario com o menu no canto.

export function toWebinarActionTarget(item: WebinarListItem): WebinarActionTarget {
  return { id: item.id, registeredCount: item.registeredCount, situation: item.situation, status: item.status, title: item.title, updatedAt: item.updatedAt };
}

/** Miniatura 2:3 da capa, ou o icone do webinario. */
export function WebinarThumb({ coverUrl }: { coverUrl: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="relative grid h-12 w-8 shrink-0 place-items-center overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)]"
    >
      {coverUrl ? (
        <Image alt="" className="object-cover" fill sizes="32px" src={coverUrl} unoptimized={!canOptimizeImageSrc(coverUrl)} />
      ) : (
        <CalendarClock className="size-4" strokeWidth={1.75} />
      )}
    </span>
  );
}

const integer = new Intl.NumberFormat("pt-BR");

export function WebinarsTable({ items, permissions }: { items: readonly WebinarListItem[]; permissions: WebinarPermissions }) {
  const { busyKey, confirmDialog, errorBanner, request } = useWebinarActions({ permissions });
  const copy = WEBINAR_ADMIN_COPY.list.columns;

  const columns: DataTableColumn<WebinarListItem>[] = [
    {
      cell: (item) => (
        <span className="flex min-w-0 items-center gap-3 py-1 max-md:pr-10">
          <WebinarThumb coverUrl={item.coverUrl} />
          <span className="block min-w-0 max-w-[300px]">
            <span className="block truncate font-medium text-[var(--text-primary)]">{item.title}</span>
            <span className="block truncate text-xs text-[var(--text-tertiary)]">
              {item.kindLabel}
              {item.kind === "simulated" && item.sessionsCount > 0 ? ` · ${WEBINAR_ADMIN_COPY.list.sessionsCount(item.sessionsCount)}` : ""}
            </span>
          </span>
        </span>
      ),
      className: "min-w-[240px]",
      emphasis: true,
      header: copy.title,
      id: "webinario"
    },
    {
      cell: (item) => <span className="block text-[13px] leading-5 whitespace-nowrap max-md:whitespace-normal">{item.whenLabel}</span>,
      header: copy.when,
      id: "quando",
      mobileLabel: copy.when
    },
    {
      cell: (item) => <StatusChip tone={item.situationTone}>{item.situationLabel}</StatusChip>,
      header: copy.situation,
      id: "situacao",
      mobileLabel: copy.situation
    },
    {
      align: "right",
      cell: (item) => integer.format(item.registeredCount),
      header: copy.registered,
      id: "vagas",
      mobileLabel: copy.registered
    },
    {
      align: "right",
      cell: (item) => (item.peakPresent === null ? EMPTY_VALUE : integer.format(item.peakPresent)),
      header: copy.peak,
      id: "presentes",
      mobileLabel: copy.peak
    },
    {
      cell: (item) => <span className="block max-w-[180px] truncate">{item.createdByName ?? EMPTY_VALUE}</span>,
      className: "max-xl:hidden",
      header: copy.createdBy,
      headerClassName: "max-xl:hidden",
      id: "quem-criou",
      mobileLabel: copy.createdBy
    },
    {
      cell: (item) => (
        <span aria-busy={busyKey?.startsWith(`${item.id}:`) || undefined} className="flex justify-end" data-webinar-menu={item.id}>
          <WebinarRowMenu onRequest={request} permissions={permissions} webinar={toWebinarActionTarget(item)} />
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
        caption={WEBINAR_ADMIN_COPY.list.listHeading}
        columns={columns}
        getRowHref={(item) => webinarAdminHref(item.id)}
        getRowKey={(item) => item.id}
        mobile="cards"
        rows={items}
      />
      {confirmDialog}
    </div>
  );
}

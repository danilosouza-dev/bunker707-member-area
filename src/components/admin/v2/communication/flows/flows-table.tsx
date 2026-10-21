"use client";

import { Pause, Play } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FlowListItem } from "@/server/communications/flow-queries";
import { DataTable, type DataTableColumn } from "../../data-table";
import { adminPillClasses } from "../../form";
import { StatusChip } from "../../status-chip";
import { FlowRowMenu, useFlowActions, type FlowActionTarget } from "./flow-row-menu";
import { entryListLines, FLOW_FILTERS, flowHref, flowRowNumbers, flowsFilterHref, inFlowNowLine, type FlowFilter } from "./flows-view-model";

// Tabela de Fluxos (docs/23 §2.4): a linha inteira abre o fluxo (construtor no rascunho, relatorio depois
// de ativado), menu "…" com as acoes da situacao por cima do link. No celular vira um cartao por fluxo com
// o nome, a situacao e "No fluxo agora", e Pausar / Retomar como botoes de 44 px (docs/17 §1.13). Quem
// nunca foi ativado mostra "—" nos numeros. As pilulas da lista ficam aqui (cliente) porque a pilula do
// admin (adminPillClasses) vem do kit de formularios.

/** Pilulas Todos · Ativos · Rascunhos · Encerrados: links (?situacao=), com o periodo da barra junto. */
export function FlowFilters({ filter, searchParams }: { filter: FlowFilter | undefined; searchParams: Record<string, string | string[] | undefined> }) {
  return (
    <nav aria-label="Situação do fluxo" className="flex min-w-0 flex-wrap gap-2">
      {FLOW_FILTERS.map((option) => {
        const active = option.filter === filter;

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(adminPillClasses(active), "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]")}
            data-navigation-feedback="false"
            href={flowsFilterHref(searchParams, option.filter)}
            key={option.label}
            scroll={false}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function toFlowActionTarget(item: FlowListItem): FlowActionTarget {
  return {
    actions: item.actions,
    entryCount: item.entryCount,
    entryMode: item.entryMode,
    id: item.id,
    name: item.name,
    origin: item.origin,
    sourceId: item.source?.id ?? null,
    status: item.status,
    updatedAt: item.updatedAt
  };
}

export function FlowsTable({ items }: { items: readonly FlowListItem[] }) {
  const { busyKey, confirmDialog, errorBanner, request } = useFlowActions();

  const columns: DataTableColumn<FlowListItem>[] = [
    {
      cell: (item) => (
        <span className="block min-w-0 max-w-[280px] max-md:pr-10">
          <span className="block truncate font-medium text-[var(--text-primary)]">{item.name}</span>
          {item.source ? (
            <span className="mt-1 inline-flex max-w-full items-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-1.5 py-0.5 text-xs leading-4 text-[var(--text-secondary)]">
              <span className="truncate">Da notificação “{item.source.title}”</span>
            </span>
          ) : null}
        </span>
      ),
      className: "min-w-[220px]",
      emphasis: true,
      header: "Fluxo",
      id: "fluxo"
    },
    {
      cell: (item) => {
        const lines = entryListLines({ count: item.entryCount, description: item.entryDescription, mode: item.entryMode, origin: item.origin, sourceTitle: item.source?.title });

        return (
          <span className="block min-w-0 max-w-[260px]">
            <span className="block truncate text-[var(--text-primary)]" title={lines.sentence}>
              {lines.sentence}
            </span>
            {lines.detail ? <span className="block text-xs text-[var(--text-tertiary)] tabular-nums">{lines.detail}</span> : null}
          </span>
        );
      },
      header: "Quem entra",
      hideOnMobile: true,
      id: "quem-entra"
    },
    {
      cell: (item) => <StatusChip tone={item.situationTone}>{item.situationLabel}</StatusChip>,
      header: "Situação",
      id: "situacao",
      mobileLabel: "Situação"
    },
    {
      align: "right",
      cell: (item) => flowRowNumbers(item).entered,
      header: "Entraram",
      hideOnMobile: true,
      id: "entraram"
    },
    {
      align: "right",
      cell: (item) => (
        <>
          <span className="md:hidden">{inFlowNowLine(item.totals)}</span>
          <span className="max-md:hidden">{flowRowNumbers(item).active}</span>
        </>
      ),
      // No cartao do celular, na linha do chip da situacao (nao na do rotulo "Situação").
      className: "max-md:col-span-2 max-md:self-end",
      header: "No fluxo agora",
      id: "no-fluxo"
    },
    {
      align: "right",
      cell: (item) => flowRowNumbers(item).goal,
      header: "Objetivo",
      hideOnMobile: true,
      id: "objetivo"
    },
    {
      align: "right",
      cell: (item) => flowRowNumbers(item).sent,
      header: "Enviadas",
      hideOnMobile: true,
      id: "enviadas"
    },
    {
      // No celular: Pausar / Retomar a mao, fora do menu (44 px).
      cell: (item) => {
        const action = item.actions.includes("pause") ? "pause" : item.actions.includes("resume") ? "resume" : null;

        return action ? (
          <Button
            className="relative z-10 h-11 px-4"
            disabled={busyKey === `${item.id}:${action}`}
            onClick={() => request(action, toFlowActionTarget(item))}
            type="button"
            variant="secondary"
          >
            {action === "pause" ? <Pause aria-hidden="true" className="size-4" /> : <Play aria-hidden="true" className="size-4" />}
            {action === "pause" ? "Pausar" : "Retomar"}
          </Button>
        ) : null;
      },
      className: "md:hidden max-md:col-span-full",
      header: <span className="sr-only">Pausar ou retomar</span>,
      headerClassName: "md:hidden",
      id: "pausar"
    },
    {
      cell: (item) => (
        <span aria-busy={busyKey?.startsWith(`${item.id}:`) || undefined} className="flex justify-end">
          <FlowRowMenu flow={toFlowActionTarget(item)} onRequest={request} />
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
      <DataTable caption="Fluxos" columns={columns} getRowHref={(item) => flowHref(item.id)} getRowKey={(item) => item.id} mobile="cards" rows={items} />
      {confirmDialog}
    </div>
  );
}

"use client";

import { BookmarkPlus } from "lucide-react";
import { useEffect, useRef } from "react";
import type { PopupFontFace } from "@/server/communications/popup-design-model";
import type { TemplateListItem } from "@/server/communications/template-queries";
import { DataTable, type DataTableColumn } from "../../data-table";
import { EmptyState } from "../../empty-state";
import { StatusChip } from "../../status-chip";
import { TemplateRowMenu, useTemplateActions, type TemplateActionTarget } from "./template-row-menu";
import { TemplateListThumb } from "./template-thumbs";
import {
  NEW_TEMPLATE_HREF,
  TEMPLATE_COPY,
  focusAfterDelete,
  templateCreatorLabel,
  templateEditHref,
  templateUpdatedLabel,
  type TemplatesEmptyCopy
} from "./templates-view-model";

// Tabela da aba Modelos (docs/28; spec §5.2): a linha inteira abre o modelo (editor em modo modelo ou a pagina do
// Design), linhas de 64 px com a miniatura (36×48), o nome e o resumo do que o modelo leva; "Não abre" no modelo
// guardado num formato que nao vale mais (so Renomear e Excluir). No celular, um cartao por modelo com o "…" no
// canto e "Atualizado" visivel. Sem modelos (ou nada achado), o estado vazio no lugar da tabela.
// Depois de excluir, quando a lista nova chega, o foco vai para o nome da linha seguinte (ou da anterior); com a
// lista vazia, para o "Novo modelo" do estado vazio.

export function toTemplateActionTarget(item: TemplateListItem): TemplateActionTarget {
  return { id: item.id, name: item.name, readable: item.readable, updatedAt: item.updatedAt };
}

type TemplatesTableProps = {
  empty: TemplatesEmptyCopy;
  fonts: readonly PopupFontFace[];
  items: readonly TemplateListItem[];
};

export function TemplatesTable({ empty, fonts, items }: TemplatesTableProps) {
  const container = useRef<HTMLDivElement>(null);
  // Para onde o foco vai quando a lista sem o modelo excluido chegar (router.refresh numa transicao).
  const pendingFocus = useRef<{ deleted: string; target: string | null } | null>(null);
  const ids = items.map((item) => item.id);
  const { busyKey, confirmDialog, errorBanner, nameDialog, request } = useTemplateActions({
    onDeleted: (id) => {
      pendingFocus.current = { deleted: id, target: focusAfterDelete(ids, id) };
    }
  });

  useEffect(() => {
    const pending = pendingFocus.current;

    if (!pending || items.some((item) => item.id === pending.deleted)) {
      return;
    }

    pendingFocus.current = null;

    if (items.length === 0) {
      container.current?.querySelector<HTMLElement>(`a[href="${NEW_TEMPLATE_HREF}"]`)?.focus();
      return;
    }

    const target = pending.target && items.some((item) => item.id === pending.target) ? pending.target : items[0].id;
    container.current?.querySelector(`[data-template-name="${target}"]`)?.closest<HTMLElement>("a")?.focus();
  }, [items]);

  const columns: DataTableColumn<TemplateListItem>[] = [
    {
      cell: (item) => (
        <span className="flex min-h-16 min-w-0 items-center gap-3 py-2 max-md:pr-10">
          <TemplateListThumb fonts={fonts} thumb={item.thumb} />
          <span className="block min-w-0 max-w-[340px]">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-[var(--text-primary)]" data-template-name={item.id}>
                {item.name}
              </span>
              {item.readable ? null : (
                <StatusChip className="shrink-0" tone="warning">
                  {TEMPLATE_COPY.list.unreadable}
                </StatusChip>
              )}
            </span>
            <span className="block truncate text-[13px] leading-5 text-[var(--text-secondary)]" title={item.summary}>
              {item.summary}
            </span>
          </span>
        </span>
      ),
      className: "min-w-[240px]",
      emphasis: true,
      header: TEMPLATE_COPY.list.columns.template,
      id: "modelo"
    },
    {
      // No cartao do celular a coluna do tipo tem 1/3 da largura: "Design Personalizado" quebra em duas linhas em vez de
      // passar por cima da data ao lado.
      cell: (item) => <span className="md:whitespace-nowrap">{item.typeLabel}</span>,
      className: "max-md:whitespace-normal",
      header: TEMPLATE_COPY.list.columns.type,
      id: "tipo",
      mobileLabel: TEMPLATE_COPY.list.columns.type
    },
    {
      cell: (item) => <span className="text-[13px] leading-5 tabular-nums">{templateUpdatedLabel(item.updatedAt)}</span>,
      // No cartao do celular a data fica visivel (com hideOnMobile a celula some do cartao e o rotulo nunca aparece).
      className: "max-md:col-span-2",
      header: TEMPLATE_COPY.list.columns.updatedAt,
      id: "atualizado",
      mobileLabel: TEMPLATE_COPY.list.columns.updatedAtMobile
    },
    {
      cell: (item) => <span className="block max-w-[200px] truncate">{templateCreatorLabel(item.createdBy)}</span>,
      header: TEMPLATE_COPY.list.columns.createdBy,
      hideOnMobile: true,
      id: "criado-por"
    },
    {
      cell: (item) => (
        <span aria-busy={busyKey?.startsWith(`${item.id}:`) || undefined} className="flex justify-end">
          <TemplateRowMenu onRequest={request} template={toTemplateActionTarget(item)} />
        </span>
      ),
      className: "relative z-10 w-14 max-md:absolute max-md:top-2.5 max-md:right-2 max-md:w-auto",
      header: <span className="sr-only">{TEMPLATE_COPY.list.columns.actions}</span>,
      headerClassName: "w-14",
      id: "acoes"
    }
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3" ref={container}>
      {errorBanner}
      {items.length === 0 ? (
        <EmptyState action={empty.action} description={empty.description} icon={BookmarkPlus} secondaryAction={empty.secondaryAction} title={empty.title} />
      ) : (
        <DataTable
          caption={TEMPLATE_COPY.list.caption}
          columns={columns}
          getRowHref={(item) => templateEditHref(item.id)}
          getRowKey={(item) => item.id}
          mobile="cards"
          rows={items}
        />
      )}
      {confirmDialog}
      {nameDialog}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { reprocessSalesEvent } from "@/server/payments/actions";
import { saleEventLabel, saleOutcomeChip, SALES_PROVIDER_LABELS } from "@/server/payments/model";
import type { SalesEventListItem } from "@/server/payments/queries";
import type { DataTableColumn } from "../../data-table";
import { ErrorBanner } from "../../error-banner";
import { StatusChip } from "../../status-chip";
import { studentHref } from "../../students/hrefs";
import { formatDateTime } from "../../students/format";
import { adminTransition } from "../../styles";
import { adminToast } from "../../toast";
import { ResponsiveTable, SectionCard } from "../kit";

// Lista "Vendas recebidas" (docs/17 §1.10): data, evento, e-mail mascarado, produto e o resultado, com
// o motivo escrito embaixo e Reprocessar para o que falhou ou foi ignorado. Tabela no desktop, cartoes
// no celular (ResponsiveTable).

const EMPTY_TITLE = "Nenhuma venda recebida ainda";
const EMPTY_DESCRIPTION = "Quando a Hotmart avisar uma compra, um reembolso ou um chargeback, ele aparece aqui com o que aconteceu com o acesso.";

function Outcome({ row }: { row: SalesEventListItem }) {
  const chip = saleOutcomeChip({ outcome: row.outcome, status: row.processingStatus });
  const detail = row.errorMessage ?? row.detail;

  return (
    <span className="flex min-w-0 flex-col items-start gap-1">
      <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
      {detail ? <span className="line-clamp-3 text-xs leading-4 text-[var(--text-secondary)]">{detail}</span> : null}
    </span>
  );
}

function Buyer({ row }: { row: SalesEventListItem }) {
  const masked = row.buyerEmailMasked;

  if (!row.userId) {
    return <span className="tabular-nums">{masked}</span>;
  }

  return (
    <Link
      className={cn("rounded-md underline-offset-2 hover:text-[var(--text-primary)] hover:underline", adminTransition)}
      data-navigation-feedback="false"
      href={studentHref(row.userId)}
      title="Abrir o aluno"
    >
      {masked}
    </Link>
  );
}

function ProductCell({ row }: { row: SalesEventListItem }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-[var(--text-primary)]">{row.productTitle ?? "—"}</span>
      {row.externalProductId ? (
        <span className="text-xs leading-4 text-[var(--text-tertiary)] tabular-nums">
          Código {row.externalProductId} na {SALES_PROVIDER_LABELS[row.provider]}
        </span>
      ) : null}
    </span>
  );
}

export function SalesEventsTable({ events }: { events: readonly SalesEventListItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reprocess(row: SalesEventListItem) {
    if (busyId) {
      return;
    }

    setBusyId(row.id);
    setError(null);
    const result = await reprocessSalesEvent({ id: row.id });
    setBusyId(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    if (!result.data.ok) {
      setError(`A venda continua com erro: ${result.data.error}`);
      router.refresh();
      return;
    }

    adminToast.success(result.data.processingStatus === "ignored" ? "Venda reprocessada, mas ainda ignorada" : "Venda reprocessada");
    router.refresh();
  }

  const renderReprocess = (row: SalesEventListItem) =>
    row.canReprocess ? (
      <Button className="h-8! px-3 text-[13px]" disabled={busyId !== null} onClick={() => void reprocess(row)} type="button" variant="secondary">
        {busyId === row.id ? "Reprocessando…" : "Reprocessar"}
      </Button>
    ) : null;

  const columns: DataTableColumn<SalesEventListItem>[] = [
    { cell: (row) => <span className="whitespace-nowrap tabular-nums">{formatDateTime(row.receivedAt)}</span>, header: "Quando", id: "quando" },
    { cell: (row) => <span className="text-[var(--text-primary)]">{saleEventLabel(row.eventType, row.normalizedType)}</span>, emphasis: true, header: "Evento", id: "evento" },
    { cell: (row) => <Buyer row={row} />, header: "Comprador", id: "comprador" },
    { cell: (row) => <ProductCell row={row} />, className: "min-w-[200px]", header: "Produto", id: "produto" },
    { cell: (row) => <Outcome row={row} />, className: "min-w-[220px]", header: "Resultado", id: "resultado" },
    { align: "right", cell: renderReprocess, header: <span className="sr-only">Ações</span>, id: "acoes" }
  ];

  return (
    <SectionCard
      bodyClassName="p-0"
      description="As últimas 50 vendas e eventos que as plataformas avisaram, com o que aconteceu com o acesso."
      title="Vendas recebidas"
    >
      {error ? (
        <div className="px-4 pt-4">
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      ) : null}
      <ResponsiveTable
        caption="Vendas recebidas das plataformas"
        columns={columns}
        emptyDescription={EMPTY_DESCRIPTION}
        emptyTitle={EMPTY_TITLE}
        flush
        getRowKey={(row) => row.id}
        renderCard={(row) => (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-medium text-[var(--text-primary)]">{saleEventLabel(row.eventType, row.normalizedType)}</span>
              <span className="text-xs text-[var(--text-tertiary)] tabular-nums">{formatDateTime(row.receivedAt)}</span>
            </div>
            <div className="text-[13px] text-[var(--text-secondary)]">
              <Buyer row={row} />
            </div>
            <ProductCell row={row} />
            <Outcome row={row} />
            {renderReprocess(row)}
          </div>
        )}
        rows={events}
      />
    </SectionCard>
  );
}

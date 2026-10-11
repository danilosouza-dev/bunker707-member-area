import type { CSSProperties } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AdminPage } from "../page-container";
import { PageHeaderSkeleton } from "../skeletons";
import { adminCard, adminDelayedReveal } from "../styles";

// Skeletons da Comunidade com a forma final de cada aba (docs/17 §2.7): cabecalho, faixa de quatro
// numeros, abas, filtros e o corpo (fila, tabela ou regras). Conteudo aparece depois de 300 ms.

const bar = "bg-[var(--surface-2)] motion-reduce:animate-none";

type CommunitySkeletonVariant = "queue" | "table" | "reports" | "rules";

function StatStripSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--border-subtle)] lg:grid-cols-4"
    >
      {[0, 1, 2, 3].map((cell) => (
        <div className="flex h-[92px] flex-col gap-2 bg-[var(--surface-1)] px-4 py-3.5" key={cell}>
          <div className={cn("flex flex-col gap-2", adminDelayedReveal)}>
            <Skeleton className={cn("h-4 w-24", bar)} />
            <Skeleton className={cn("h-7 w-14", bar)} />
            <Skeleton className={cn("h-3.5 w-32", bar)} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TabsSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-10 items-center gap-6 border-b border-[var(--border-subtle)] px-3">
      <div className={cn("flex items-center gap-6", adminDelayedReveal)}>
        {[148, 104, 92, 88, 56, 60].map((width, index) => (
          <Skeleton className={cn("h-4", bar, index > 2 && "hidden md:block")} key={index} style={{ width }} />
        ))}
      </div>
    </div>
  );
}

function FiltersSkeleton() {
  return (
    <div aria-hidden="true" className={cn("flex flex-wrap gap-2", adminDelayedReveal)}>
      {[230, 260, 176].map((width) => (
        <div className="flex flex-[1_1_130px] items-center gap-1.5 md:flex-none" key={width}>
          <Skeleton className={cn("hidden h-3.5 w-12 md:block", bar)} />
          <Skeleton className={cn("h-9 w-full rounded-lg md:w-(--field-w)", bar)} style={{ "--field-w": `${width}px` } as CSSProperties} />
        </div>
      ))}
    </div>
  );
}

function QueueSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className={cn(adminCard, "overflow-hidden")}>
      {Array.from({ length: rows }, (_, index) => (
        <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] p-4 last:border-b-0" key={index}>
          <div className={cn("flex flex-col gap-3", adminDelayedReveal)}>
            <div className="flex items-start gap-3">
              <Skeleton className={cn("size-8 rounded-full", bar)} />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className={cn("h-4 w-36", bar)} />
                <Skeleton className={cn("h-3.5 w-72 max-w-full", bar)} />
              </div>
              <Skeleton className={cn("h-3.5 w-14", bar)} />
            </div>
            <div className="flex flex-col gap-2 md:pl-11">
              <Skeleton className={cn("h-4 w-full max-w-[640px]", bar)} />
              <Skeleton className={cn("h-4 w-2/3 max-w-[480px]", bar)} />
              <div className="mt-1 flex gap-2">
                <Skeleton className={cn("h-8 w-24 rounded-lg", bar)} />
                <Skeleton className={cn("h-8 w-20 rounded-lg", bar)} />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className={cn(adminCard, "overflow-hidden")}>
      <div className="flex h-9 items-center border-b border-[var(--border-subtle)] px-4">
        <Skeleton className={cn("h-3.5 w-32", bar, adminDelayedReveal)} />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div className="flex h-12 items-center gap-4 border-b border-[var(--border-subtle)] px-4 last:border-b-0" key={index}>
          <div className={cn("flex w-full items-center gap-4", adminDelayedReveal)}>
            <Skeleton className={cn("size-6 rounded-full", bar)} />
            <Skeleton className={cn("h-4 flex-1", bar)} />
            <Skeleton className={cn("hidden h-4 w-16 md:block", bar)} />
            <Skeleton className={cn("hidden h-4 w-16 md:block", bar)} />
            <Skeleton className={cn("h-4 w-12", bar)} />
          </div>
        </div>
      ))}
    </div>
  );
}

function RulesSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      {[3, 4].map((rows, index) => (
        <div className={cn(adminCard, "flex flex-col gap-3 p-4")} key={index}>
          <div className={cn("flex flex-col gap-3", adminDelayedReveal)}>
            <div className="flex items-center justify-between">
              <Skeleton className={cn("h-5 w-40", bar)} />
              <Skeleton className={cn("h-9 w-32 rounded-lg", bar)} />
            </div>
            {Array.from({ length: rows }, (_, row) => (
              <Skeleton className={cn("h-12 w-full rounded-lg", bar)} key={row} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CommunityPageSkeleton({ label, variant }: { label: string; variant: CommunitySkeletonVariant }) {
  return (
    <AdminPage className="gap-6">
      <span aria-live="polite" className="sr-only" role="status">
        {label}
      </span>
      <PageHeaderSkeleton />
      <div className="flex min-w-0 flex-col gap-5">
        <StatStripSkeleton />
        <div className="flex min-w-0 flex-col gap-3">
          <TabsSkeleton />
          {variant === "rules" ? null : <FiltersSkeleton />}
          {variant === "queue" ? <QueueSkeleton /> : null}
          {variant === "reports" ? <QueueSkeleton rows={2} /> : null}
          {variant === "table" ? <TableSkeleton /> : null}
          {variant === "rules" ? <RulesSkeleton /> : null}
        </div>
      </div>
    </AdminPage>
  );
}

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AdminPage } from "./page-container";
import { adminCard, adminDelayedReveal } from "./styles";
import { TodaySkeleton } from "./today/today-skeleton";

// Skeletons com a forma final de cada tela (docs/17 §2.7): nunca o spinner de tela cheia.

const bar = "bg-[var(--surface-2)] motion-reduce:animate-none";

function LoadingStatus({ label }: { label: string }) {
  return (
    <span aria-live="polite" className="sr-only" role="status">
      {label}
    </span>
  );
}

export function PageHeaderSkeleton() {
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-1", adminDelayedReveal)}>
      <Skeleton className={cn("h-8 w-72 max-w-full", bar)} />
      <Skeleton className={cn("h-5 w-52 max-w-full", bar)} />
    </div>
  );
}

/** Mesmas dimensoes do KpiTile: rotulo e delta, numero e sparkline, definicao. */
export function KpiTileSkeleton() {
  return (
    <div aria-hidden="true" className={cn(adminCard, "flex flex-col p-4")}>
      <div className={cn("flex flex-col", adminDelayedReveal)}>
        <Skeleton className={cn("h-5 w-28", bar)} />
        <div className="mt-3 flex items-center gap-6">
          <Skeleton className={cn("h-10 w-20", bar)} />
          <Skeleton className={cn("h-6 min-w-0 flex-1", bar)} />
        </div>
        <Skeleton className={cn("mt-2 h-4 w-36 max-w-full", bar)} />
      </div>
    </div>
  );
}

export function EmptyStateSkeleton() {
  return (
    <div aria-hidden="true" className={cn(adminCard, "flex flex-col items-center gap-4 px-6 py-12 md:py-16")}>
      <div className={cn("flex flex-col items-center gap-4", adminDelayedReveal)}>
        <Skeleton className={cn("size-10 rounded-lg", bar)} />
        <Skeleton className={cn("h-6 w-64 max-w-full", bar)} />
        <Skeleton className={cn("h-5 w-80 max-w-full", bar)} />
        <Skeleton className={cn("h-10 w-40 rounded-lg", bar)} />
      </div>
    </div>
  );
}

/** Forma das telas que ainda vao chegar: cabecalho e estado vazio. */
export function PlaceholderPageSkeleton() {
  return (
    <AdminPage>
      <LoadingStatus label="Carregando a tela" />
      <PageHeaderSkeleton />
      <EmptyStateSkeleton />
    </AdminPage>
  );
}

/**
 * Moldura do admin enquanto a sessao e validada: trilho de 72 px (hamburguer, simbolo, icones),
 * barra superior com a busca a esquerda, lembretes e conta a direita, e a forma do Hoje.
 * Estatico, sem dados, para pintar em menos de 300 ms.
 */
export function AdminShellSkeleton() {
  return (
    <div className="min-h-dvh bg-[var(--surface-0)] text-[var(--text-primary)]" data-scope="admin">
      <div
        aria-hidden="true"
        className="fixed inset-y-0 left-0 z-40 hidden w-[72px] flex-col items-center border-r border-[var(--border-subtle)] bg-[var(--surface-0)] md:flex"
      >
        <div className="flex h-14 w-full shrink-0 items-center justify-center border-b border-[var(--border-subtle)]">
          <Skeleton className={cn("size-6 rounded-md", bar)} />
        </div>
        <div className={cn("mt-3 flex flex-1 flex-col items-center gap-1 px-3", adminDelayedReveal)}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((item) => (
            <Skeleton className={cn("size-12 rounded-xl", bar)} key={item} />
          ))}
        </div>
      </div>
      <div className="md:pl-[72px]">
        <div
          aria-hidden="true"
          className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-0)] px-[clamp(16px,3vw,32px)] max-md:gap-1 max-md:px-4"
        >
          <Skeleton className={cn("size-9 rounded-lg md:hidden", bar)} />
          <Skeleton className={cn("h-5 w-24 md:hidden", bar)} />
          <span className="h-9 w-[320px] max-w-full shrink rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] max-md:ml-auto max-md:w-9 max-md:border-transparent max-md:bg-transparent" />
          <Skeleton className={cn("ml-auto size-8 rounded-full max-md:ml-0", bar)} />
          <Skeleton className={cn("size-8 rounded-full", bar)} />
        </div>
        <main aria-busy="true">
          <TodaySkeleton />
        </main>
      </div>
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { adminCard, adminDelayedReveal } from "../styles";

// Skeletons da Área de membros: o cabecalho e as abas ja estao na moldura (layout.tsx); aqui so a
// forma final do conteudo de cada aba.

const bar = "bg-[var(--surface-2)] motion-reduce:animate-none";

function LoadingStatus({ label }: { label: string }) {
  return (
    <span aria-live="polite" className="sr-only" role="status">
      {label}
    </span>
  );
}

/** Vitrine: lista de fileiras a esquerda e previa a direita (abaixo em telas menores). */
export function VitrineSkeleton() {
  return (
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <LoadingStatus label="Carregando a vitrine" />
      <div aria-hidden="true" className={cn(adminCard, "flex flex-col")}>
        <div className={cn("flex items-center justify-between gap-3 px-4 pt-4 pb-3", adminDelayedReveal)}>
          <div className="flex flex-col gap-1.5">
            <Skeleton className={cn("h-5 w-40", bar)} />
            <Skeleton className={cn("h-4 w-32", bar)} />
          </div>
          <Skeleton className={cn("h-10 w-36 rounded-lg", bar)} />
        </div>
        <div className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div className={cn("flex min-h-14 items-center gap-3 px-4 py-2", adminDelayedReveal)} key={row}>
              <Skeleton className={cn("size-6 rounded-md", bar)} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className={cn("h-4 w-48 max-w-full", bar)} />
                <Skeleton className={cn("h-3.5 w-72 max-w-full", bar)} />
              </div>
              <Skeleton className={cn("hidden h-6 w-16 rounded-md sm:block", bar)} />
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden="true" className={cn(adminCard, "flex flex-col gap-4 p-4")}>
        <Skeleton className={cn("h-5 w-24", bar, adminDelayedReveal)} />
        <Skeleton className={cn("aspect-[16/6] w-full rounded-lg", bar, adminDelayedReveal)} />
        {[0, 1, 2].map((row) => (
          <div className={cn("flex flex-col gap-2", adminDelayedReveal)} key={row}>
            <Skeleton className={cn("h-3.5 w-28", bar)} />
            <div className="flex gap-1.5">
              {[0, 1, 2, 3, 4].map((card) => (
                <Skeleton className={cn("aspect-[9/13] w-11 rounded-[4px]", bar)} key={card} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Marca: o aviso de que o banner foi para Destaque e o card da logo, na coluna de formulario. */
export function BrandSkeleton() {
  return (
    <div className="flex w-full max-w-[720px] flex-col gap-6">
      <LoadingStatus label="Carregando a marca" />
      <div aria-hidden="true" className={cn(adminCard, "flex min-h-14 items-center justify-between gap-4 px-4 py-3", adminDelayedReveal)}>
        <Skeleton className={cn("h-4 w-72 max-w-full", bar)} />
        <Skeleton className={cn("h-4 w-28", bar)} />
      </div>
      <div aria-hidden="true" className={cn(adminCard, "flex flex-col gap-5 p-4")}>
        <div className={cn("flex flex-col gap-1.5", adminDelayedReveal)}>
          <Skeleton className={cn("h-5 w-36", bar)} />
          <Skeleton className={cn("h-4 w-80 max-w-full", bar)} />
        </div>
        <Skeleton className={cn("h-24 w-full rounded-lg", bar, adminDelayedReveal)} />
        <div className={cn("flex gap-2", adminDelayedReveal)}>
          <Skeleton className={cn("h-10 w-36 rounded-lg", bar)} />
          <Skeleton className={cn("h-10 w-44 rounded-lg", bar)} />
        </div>
      </div>
    </div>
  );
}

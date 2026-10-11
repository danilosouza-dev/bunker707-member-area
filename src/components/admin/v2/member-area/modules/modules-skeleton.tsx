import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { adminCard, adminDelayedReveal } from "../../styles";

// Area de membros › Modulos carregando: a frase e a busca, e a tabela (cartoes abaixo de 900 px de
// largura do bloco) na forma final. O cabecalho e as abas ja estao na moldura (layout.tsx).

const bar = "bg-[var(--surface-2)] motion-reduce:animate-none";

export function ModulesSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <span aria-live="polite" className="sr-only" role="status">
        Carregando os módulos
      </span>
      <div aria-hidden="true" className={cn("flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between", adminDelayedReveal)}>
        <Skeleton className={cn("h-4 w-[520px] max-w-full", bar)} />
        <Skeleton className={cn("h-11 w-full rounded-lg md:h-9 md:w-72", bar)} />
      </div>

      <div aria-hidden="true" className="@container min-w-0">
        <div className={cn(adminCard, "hidden overflow-hidden @min-[900px]:block")}>
          <div className={cn("flex h-10 items-center gap-6 border-b border-[var(--border-subtle)] px-4", adminDelayedReveal)}>
            <Skeleton className={cn("h-3.5 w-20", bar)} />
            <Skeleton className={cn("ml-auto h-3.5 w-24", bar)} />
            <Skeleton className={cn("h-3.5 w-28", bar)} />
            <Skeleton className={cn("h-3.5 w-14", bar)} />
          </div>
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div className={cn("flex h-16 items-center gap-4 border-b border-[var(--border-subtle)] px-4 last:border-b-0", adminDelayedReveal)} key={row}>
              <Skeleton className={cn("size-8 rounded-md", bar)} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className={cn("h-4 w-48 max-w-full", bar)} />
                <Skeleton className={cn("h-3.5 w-28", bar)} />
              </div>
              <Skeleton className={cn("h-9 w-[288px] rounded-lg", bar)} />
              <Skeleton className={cn("h-9 w-[248px] rounded-lg", bar)} />
              <Skeleton className={cn("h-3.5 w-24", bar)} />
              <Skeleton className={cn("size-9 rounded-lg", bar)} />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 @min-[900px]:hidden">
          {[0, 1, 2].map((card) => (
            <div className={cn(adminCard, "flex flex-col gap-4 p-4", adminDelayedReveal)} key={card}>
              <div className="flex items-center gap-3">
                <Skeleton className={cn("size-8 rounded-md", bar)} />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className={cn("h-4 w-40", bar)} />
                  <Skeleton className={cn("h-3.5 w-24", bar)} />
                </div>
              </div>
              <Skeleton className={cn("h-11 w-full rounded-lg", bar)} />
              <Skeleton className={cn("h-11 w-full rounded-lg", bar)} />
              <Skeleton className={cn("h-4 w-36", bar)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { adminDelayedReveal } from "../../styles";

// Forma final da tela Login enquanto carrega: galeria de 4 modelos e formulario a esquerda, previa a
// direita (abaixo da galeria em telas menores). O cabecalho e as abas ja estao na moldura (layout.tsx).

const bar = "bg-[var(--surface-2)] motion-reduce:animate-none";

export function LoginEditorSkeleton() {
  return (
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)] lg:gap-8">
      <span aria-live="polite" className="sr-only" role="status">
        Carregando a página de login
      </span>

      <div aria-hidden="true" className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-1">
        <div className={cn("flex flex-col gap-1.5", adminDelayedReveal)}>
          <Skeleton className={cn("h-5 w-24", bar)} />
          <Skeleton className={cn("h-4 w-72 max-w-full", bar)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((card) => (
            <div className={cn("flex flex-col gap-3 rounded-lg border border-[var(--border-subtle)] p-3", adminDelayedReveal)} key={card}>
              <Skeleton className={cn("aspect-[16/10] w-full rounded-lg", bar)} />
              <Skeleton className={cn("h-4 w-40 max-w-full", bar)} />
              <Skeleton className={cn("h-3.5 w-full", bar)} />
            </div>
          ))}
        </div>
      </div>

      <div aria-hidden="true" className={cn("flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-1", adminDelayedReveal)}>
        <div className="flex items-center justify-between gap-3">
          <Skeleton className={cn("h-5 w-20", bar)} />
          <Skeleton className={cn("h-9 w-48 rounded-lg", bar)} />
        </div>
        <Skeleton className={cn("aspect-[16/10] w-full rounded-lg", bar)} />
        <Skeleton className={cn("h-3.5 w-80 max-w-full", bar)} />
      </div>

      <div aria-hidden="true" className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-2">
        {[0, 1, 2].map((block) => (
          <div className={cn("flex flex-col gap-4 border-t border-[var(--border-subtle)] pt-6", adminDelayedReveal)} key={block}>
            <Skeleton className={cn("h-5 w-32", bar)} />
            <Skeleton className={cn("h-10 w-full rounded-lg", bar)} />
            <Skeleton className={cn("h-10 w-full rounded-lg", bar)} />
          </div>
        ))}
      </div>
    </div>
  );
}

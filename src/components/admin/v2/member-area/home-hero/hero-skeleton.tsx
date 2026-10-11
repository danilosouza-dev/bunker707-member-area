import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { adminCard, adminDelayedReveal } from "../../styles";

// Skeleton da aba Destaque na forma final: formulario (quatro cards) a esquerda e previa a direita
// (abaixo do formulario em telas menores). O cabecalho e as abas ja estao na moldura (layout.tsx).

const bar = "bg-[var(--surface-2)] motion-reduce:animate-none";

function CardHeader({ wide = false }: { wide?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1.5", adminDelayedReveal)}>
      <Skeleton className={cn("h-5 w-32", bar)} />
      <Skeleton className={cn("h-4 max-w-full", wide ? "w-96" : "w-72", bar)} />
    </div>
  );
}

function FieldBar({ tall = false }: { tall?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1.5", adminDelayedReveal)}>
      <Skeleton className={cn("h-4 w-24", bar)} />
      <Skeleton className={cn(tall ? "h-20" : "h-10", "w-full rounded-lg", bar)} />
    </div>
  );
}

export function HeroSkeleton() {
  return (
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
      <span aria-live="polite" className="sr-only" role="status">
        Carregando o destaque
      </span>
      <div aria-hidden="true" className="flex min-w-0 flex-col gap-6">
        <div className={cn(adminCard, "flex flex-col gap-4 p-4")}>
          <CardHeader />
          <div className={cn("flex items-center gap-3", adminDelayedReveal)}>
            <Skeleton className={cn("h-6 w-10 rounded-full", bar)} />
            <Skeleton className={cn("h-4 w-64 max-w-full", bar)} />
          </div>
        </div>
        <div className={cn(adminCard, "flex flex-col gap-4 p-4")}>
          <CardHeader />
          <div className={cn("flex gap-2", adminDelayedReveal)}>
            <Skeleton className={cn("h-9 w-24 rounded-lg", bar)} />
            <Skeleton className={cn("h-9 w-20 rounded-lg", bar)} />
          </div>
          <Skeleton className={cn("aspect-[8/3] w-full rounded-lg", bar, adminDelayedReveal)} />
        </div>
        <div className={cn(adminCard, "flex flex-col gap-4 p-4")}>
          <CardHeader wide />
          <FieldBar />
          <FieldBar />
          <FieldBar tall />
        </div>
        <div className={cn(adminCard, "flex flex-col gap-4 p-4")}>
          <CardHeader wide />
          <FieldBar />
          <div className={cn("flex gap-2", adminDelayedReveal)}>
            <Skeleton className={cn("h-9 w-28 rounded-lg", bar)} />
            <Skeleton className={cn("h-9 w-32 rounded-lg", bar)} />
            <Skeleton className={cn("h-9 w-28 rounded-lg", bar)} />
          </div>
        </div>
      </div>
      <div aria-hidden="true" className={cn(adminCard, "flex min-w-0 flex-col gap-3 p-4")}>
        <div className={cn("flex items-center justify-between gap-3", adminDelayedReveal)}>
          <div className="flex flex-col gap-1.5">
            <Skeleton className={cn("h-5 w-20", bar)} />
            <Skeleton className={cn("h-4 w-56 max-w-full", bar)} />
          </div>
          <Skeleton className={cn("h-9 w-48 rounded-lg", bar)} />
        </div>
        <Skeleton className={cn("aspect-[1280/760] w-full rounded-lg", bar, adminDelayedReveal)} />
      </div>
    </div>
  );
}

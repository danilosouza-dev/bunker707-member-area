import { Skeleton } from "@/components/ui/skeleton";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { AdminPage } from "../../../page-container";
import { adminCard, adminDelayedReveal } from "../../../styles";

// O relatorio do webinario enquanto carrega (docs/17 §2.7): trilha e titulo, o seletor de sessao, a situacao com o
// botao Exportar, os onze numeros e a curva, na forma final. Nunca o spinner de tela cheia. O cartao de numero e redesenhado aqui (as mesmas
// medidas do KpiTileSkeleton de skeletons.tsx) para a pagina nao carregar o grafico do Hoje junto.

const bar = "bg-[var(--surface-2)] motion-reduce:animate-none";
const KPI_KEYS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const PILL_KEYS = ["a", "b", "c"] as const;

function KpiTileSkeleton() {
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

export function WebinarReportSkeleton() {
  return (
    <AdminPage className="gap-6">
      <span aria-live="polite" className="sr-only" role="status">
        {WEBINAR_COPY.relatorio.carregando}
      </span>
      <div aria-hidden="true" className={cn("flex flex-col gap-2", adminDelayedReveal)}>
        <Skeleton className={cn("h-4 w-56", bar)} />
        <Skeleton className={cn("h-8 w-72 max-w-full", bar)} />
        <Skeleton className={cn("h-5 w-80 max-w-full", bar)} />
      </div>
      <div aria-hidden="true" className={cn("flex flex-wrap gap-2", adminDelayedReveal)}>
        {PILL_KEYS.map((key) => (
          <Skeleton className={cn("h-[34px] w-44 rounded-full", bar)} key={key} />
        ))}
      </div>
      <div aria-hidden="true" className={cn("flex items-center gap-2", adminDelayedReveal)}>
        <Skeleton className={cn("h-6 w-24 rounded-full", bar)} />
        <Skeleton className={cn("ml-auto h-8 w-28 rounded-lg max-md:h-11", bar)} />
      </div>
      <div aria-hidden="true" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {KPI_KEYS.map((key) => (
          <KpiTileSkeleton key={key} />
        ))}
      </div>
      <div aria-hidden="true" className={cn(adminCard, "flex flex-col gap-4 p-4", adminDelayedReveal)}>
        <Skeleton className={cn("h-6 w-64 max-w-full", bar)} />
        <Skeleton className={cn("h-40 w-full rounded-lg md:h-52", bar)} />
      </div>
    </AdminPage>
  );
}

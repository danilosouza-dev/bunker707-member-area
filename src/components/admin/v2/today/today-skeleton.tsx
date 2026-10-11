import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ChartCardSkeleton } from "../chart-card";
import { AdminPage } from "../page-container";
import { adminCard, adminDelayedReveal } from "../styles";
import { TODAY_ACTIVITY_CHART_COMPACT_HEIGHT, TODAY_ACTIVITY_CHART_HEIGHT } from "./today-activity-card";

const bar = "bg-[var(--surface-2)] motion-reduce:animate-none";

/** Mesma altura do KpiTile (rotulo, numero, definicao). Local, sem importar ../skeletons, para a moldura poder importar este arquivo sem ciclo. */
function KpiSkeleton() {
  return (
    <div className={cn(adminCard, "flex h-[130px] flex-col p-4")}>
      <div className={cn("flex flex-col", adminDelayedReveal)}>
        <Skeleton className={cn("h-5 w-28", bar)} />
        <Skeleton className={cn("mt-3 h-10 w-20", bar)} />
        <Skeleton className={cn("mt-2 h-4 w-36", bar)} />
      </div>
    </div>
  );
}

function HeadingSkeleton({ width }: { width: string }) {
  return <Skeleton className={cn("h-7 max-w-full", width, bar, adminDelayedReveal)} />;
}

/**
 * Forma final da tela Hoje enquanto os dados chegam (docs/17 §2.7: nunca o spinner de tela cheia):
 * cabecalho com o botao Criar, faixa, cartoes de atencao, quatro numeros, atividade e "Por produto".
 */
export function TodaySkeleton() {
  return (
    <AdminPage className="gap-6">
      <span aria-live="polite" className="sr-only" role="status">
        Carregando a tela Hoje
      </span>

      <div aria-hidden="true" className="flex flex-wrap items-end justify-between gap-4">
        <div className={cn("flex flex-col gap-1", adminDelayedReveal)}>
          <Skeleton className={cn("h-[30px] w-56 max-w-full", bar)} />
          <Skeleton className={cn("h-5 w-40", bar)} />
        </div>
        <Skeleton className={cn("h-9 w-24 rounded-lg", bar, adminDelayedReveal)} />
      </div>

      <div aria-hidden="true" className={cn(adminCard, "h-[42px]")} />

      <div aria-hidden="true" className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <HeadingSkeleton width="w-56" />
          <div className="hidden grid-cols-2 gap-3 md:grid min-[1180px]:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <div className={cn(adminCard, "h-[158px]")} key={item} />
            ))}
          </div>
          <div className={cn(adminCard, "h-[168px] md:hidden")} />
        </div>

        <div className="flex flex-col gap-3">
          <HeadingSkeleton width="w-72" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {/* + a linha da legenda, que o card real mostra mesmo vazio */}
          <ChartCardSkeleton compactHeight={TODAY_ACTIVITY_CHART_COMPACT_HEIGHT + 24} height={TODAY_ACTIVITY_CHART_HEIGHT + 24} />
          <div className={cn(adminCard, "flex flex-col gap-3 p-4")}>
            <div className={cn("flex flex-col gap-3", adminDelayedReveal)}>
              <Skeleton className={cn("h-6 w-40", bar)} />
              {[0, 1, 2, 3].map((row) => (
                <Skeleton className={cn("h-9 w-full", bar)} key={row} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </AdminPage>
  );
}

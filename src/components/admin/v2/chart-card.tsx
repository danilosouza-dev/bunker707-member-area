import { useId, type CSSProperties, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { adminCard, adminDelayedReveal } from "./styles";

export const DEFAULT_CHART_HEIGHT = 280;

/**
 * Altura da area do grafico: `height` e, quando a propria area tem menos de 480 px de largura (celular
 * e cards estreitos), `compactHeight` — o prototipo aprovado usa 256 e 208 px. Consulta de container,
 * nao de tela, para o card estreito ao lado de outro seguir a mesma regra.
 */
function plotStyle(height: number, compactHeight: number | undefined) {
  return { "--chart-plot-h": `${height}px`, "--chart-plot-h-compact": `${compactHeight ?? height}px` } as CSSProperties;
}

const plotWrapClass = "@container/chart-plot w-full";
const plotClass = "h-[var(--chart-plot-h)] w-full @max-[480px]/chart-plot:h-[var(--chart-plot-h-compact)]";

type ChartCardProps = {
  /** Acoes do cabecalho, como o alternador grafico | tabela (obrigatorio em graficos com dados). Somem no vazio. */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Altura da area do grafico quando ela tem menos de 480 px de largura (padrao: a mesma de `height`). */
  compactHeight?: number;
  /** Linha abaixo do titulo (uso antigo). Prefira `meta`, na mesma linha do titulo. */
  description?: ReactNode;
  emptyDescription?: ReactNode;
  emptyTitle?: string;
  footer?: ReactNode;
  /** Nivel do titulo: h2 (padrao, card solto na pagina) ou h3 (card dentro de uma secao com H2). */
  headingLevel?: "h2" | "h3";
  /** Altura fixa da area do grafico, em px. O skeleton usa a mesma altura. */
  height?: number;
  /** Legenda das series, numa linha abaixo do cabecalho. Continua visivel no vazio. */
  legend?: ReactNode;
  /** Texto curto 12/500 na mesma linha do titulo: "média móvel de 7 dias", "últimos 30 dias". */
  meta?: ReactNode;
  state?: "ready" | "loading" | "empty";
  title: string;
};

function EmptyChartGrid() {
  return (
    <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between py-2">
      {[0, 1, 2, 3].map((line) => (
        <span className="h-px w-full bg-[var(--border-subtle)]" key={line} />
      ))}
    </div>
  );
}

/**
 * Card de grafico do prototipo aprovado: titulo 16/600 com a meta ao lado, controles no canto direito,
 * legenda abaixo e a area do grafico com altura fixa (pronto, carregando ou vazio).
 */
export function ChartCard({
  actions,
  children,
  className,
  compactHeight,
  description,
  emptyDescription,
  emptyTitle = "Sem dados no período",
  footer,
  headingLevel = "h2",
  height = DEFAULT_CHART_HEIGHT,
  legend,
  meta,
  state = "ready",
  title
}: ChartCardProps) {
  const titleId = useId();
  const Heading = headingLevel;

  return (
    <section
      aria-busy={state === "loading" || undefined}
      aria-labelledby={titleId}
      className={cn(adminCard, "flex min-w-0 flex-col p-4", className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <Heading className="text-base leading-6 font-semibold text-[var(--text-primary)]" id={titleId}>
              {title}
            </Heading>
            {meta ? <span className="text-xs leading-4 font-medium text-[var(--text-tertiary)]">{meta}</span> : null}
          </div>
          {description ? <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">{description}</p> : null}
        </div>
        {actions && state === "ready" ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>

      {legend ? (
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 text-xs leading-5 font-medium text-[var(--text-secondary)]">
          {legend}
        </div>
      ) : null}

      <div className={cn(plotWrapClass, legend ? "mt-2" : "mt-4")}>
        <div className={cn("relative", plotClass)} style={plotStyle(height, compactHeight)}>
        {state === "loading" ? (
          <div className={cn("size-full", adminDelayedReveal)}>
            <Skeleton className="size-full rounded-lg bg-[var(--surface-2)] motion-reduce:animate-none" />
            <span className="sr-only">Carregando gráfico</span>
          </div>
        ) : state === "empty" ? (
          <>
            <EmptyChartGrid />
            <div className="relative flex size-full flex-col items-center justify-center gap-1 px-6 text-center">
              <p className="text-[13px] leading-5 font-medium text-[var(--text-secondary)]">{emptyTitle}</p>
              {emptyDescription ? (
                <p className="max-w-sm text-[13px] leading-5 text-[var(--text-tertiary)]">{emptyDescription}</p>
              ) : null}
            </div>
          </>
        ) : (
          children
        )}
        </div>
      </div>

      {footer ? <div className="mt-4 text-xs leading-5 font-medium text-[var(--text-tertiary)]">{footer}</div> : null}
    </section>
  );
}

/** Mesmo card, ja com a altura final, enquanto os dados chegam. */
export function ChartCardSkeleton({
  className,
  compactHeight,
  height = DEFAULT_CHART_HEIGHT
}: {
  className?: string;
  compactHeight?: number;
  height?: number;
}) {
  return (
    <div aria-hidden="true" className={cn(adminCard, "flex flex-col gap-4 p-4", className)}>
      <div className={cn("flex items-baseline gap-2.5", adminDelayedReveal)}>
        <Skeleton className="h-6 w-44 bg-[var(--surface-2)] motion-reduce:animate-none" />
        <Skeleton className="h-4 w-28 max-w-full bg-[var(--surface-2)] motion-reduce:animate-none" />
      </div>
      <div className={plotWrapClass}>
        <div className={cn(plotClass, adminDelayedReveal)} style={plotStyle(height, compactHeight)}>
          <Skeleton className="size-full rounded-lg bg-[var(--surface-2)] motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}

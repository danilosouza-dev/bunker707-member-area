import { cn } from "@/lib/utils";
import { ChartCard } from "../chart-card";
import { TodayActivityChart } from "./today-activity-chart";
import type { TodayDemoActivityPoint } from "./today-demo";

/** Altura da area do grafico, como no prototipo: 256 px, ou 208 px quando ela tem menos de 480 px de largura. O skeleton usa as mesmas. */
export const TODAY_ACTIVITY_CHART_HEIGHT = 256;
export const TODAY_ACTIVITY_CHART_COMPACT_HEIGHT = 208;

const series = [
  { color: "var(--series-1)", kind: "line", label: "Alunos que assistiram", short: "Assistiram" },
  { color: "var(--series-2)", kind: "line", label: "Aulas concluídas", short: "Concluídas" },
  { color: "var(--series-previous)", kind: "dash", label: "Período anterior", short: "Período anterior" }
] as const;

/** Legenda do grafico: fica visivel mesmo vazio, para o produtor saber o que vai aparecer ali. */
export function TodayActivityLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs leading-5 font-medium text-[var(--text-secondary)]">
      {series.map((item) => (
        <li className="inline-flex items-center gap-2 whitespace-nowrap" key={item.label}>
          <span
            aria-hidden="true"
            className={cn("inline-block h-0.5 w-3 shrink-0", item.kind === "line" ? "rounded-[1px]" : "")}
            style={
              item.kind === "line"
                ? { backgroundColor: item.color }
                : { background: `repeating-linear-gradient(90deg, ${item.color} 0 3px, transparent 3px 5px)` }
            }
          />
          <span className="hidden md:inline">{item.label}</span>
          <span className="md:hidden">{item.short}</span>
        </li>
      ))}
    </ul>
  );
}

type TodayActivityCardProps = {
  /** "por hora" (periodos de ate 3 dias) ou "por dia". */
  meta: string;
  /** Pontos do grafico; sem pontos (ainda nao ha registro de aulas assistidas) o card fica vazio. */
  points?: readonly TodayDemoActivityPoint[];
};

/**
 * Linha 3 do Hoje, primeiro card: quem assistiu e quem concluiu aulas, com o periodo anterior tracejado.
 * Depende do registro de aulas assistidas, que ainda nao existe: grade vazia e "Sem dados no período".
 * O alternador grafico/tabela so aparece com dados (ChartCard esconde as acoes no vazio).
 */
export function TodayActivityCard({ meta, points }: TodayActivityCardProps) {
  const hasPoints = Boolean(points && points.length > 0);

  return (
    <ChartCard
      compactHeight={TODAY_ACTIVITY_CHART_COMPACT_HEIGHT}
      emptyTitle="Sem dados no período"
      height={TODAY_ACTIVITY_CHART_HEIGHT}
      legend={<TodayActivityLegend />}
      meta={meta}
      state={hasPoints ? "ready" : "empty"}
      title="Atividade dos alunos"
    >
      {hasPoints && points ? <TodayActivityChart height={TODAY_ACTIVITY_CHART_HEIGHT} points={points} /> : null}
    </ChartCard>
  );
}

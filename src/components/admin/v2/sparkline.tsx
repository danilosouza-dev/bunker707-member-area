import { useId } from "react";
import { cn } from "@/lib/utils";

const WIDTH = 100;
const FIXED_HEIGHT = 28;
const FLUID_HEIGHT = 32;
const PADDING = 2;

export type SparklineTone = "positive" | "negative" | "neutral";

type SparklineProps = {
  className?: string;
  /** Cor da serie; padrao e a serie neutra. Use o acento do produto quando o produto for a dimensao. */
  color?: string;
  /**
   * Cor do ponto final no modo "fluid": verde quando a variacao e boa, vermelho quando e ruim. Sem tom,
   * compara o ultimo valor com o primeiro.
   */
  tone?: SparklineTone;
  values: readonly number[];
  /**
   * "fixed": 100x28, so a linha (padrao antigo). "fluid": ocupa a largura do pai, 32 px de altura, area
   * suave e ponto final (KPI do prototipo). Sem pontos suficientes, o "fluid" desenha uma linha tracejada.
   */
  variant?: "fixed" | "fluid";
};

const toneDotClass: Record<SparklineTone, string> = {
  negative: "bg-[var(--error)]",
  neutral: "bg-[var(--text-secondary)]",
  positive: "bg-[var(--success)]"
};

/** Pontos no viewBox: x de 0 a 100; y entre `top` e `bottom`, com folga embaixo (`padBelow`) para a area. */
function toPoints(values: readonly number[], top: number, bottom: number, padBelow: number) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(1, Math.abs(max) * 0.2);
  const low = min - span * padBelow;
  const high = max + span * 0.04;
  const step = WIDTH / (values.length - 1);

  return values.map((value, index) => [index * step, bottom - ((value - low) / (high - low)) * (bottom - top)] as const);
}

/** Mini-grafico sem eixos (docs/17 §2.7). Decorativo: o valor esta no texto do KPI. */
export function Sparkline({ className, color = "var(--series-1)", tone, values, variant = "fixed" }: SparklineProps) {
  const gradientId = useId();
  const points = values.filter((value) => Number.isFinite(value));

  if (variant === "fluid") {
    if (points.length < 2) {
      return (
        <span aria-hidden="true" className={cn("relative block h-8 w-full min-w-0", className)}>
          <svg className="absolute inset-0 size-full overflow-visible" focusable="false" preserveAspectRatio="none" viewBox={`0 0 ${WIDTH} ${FLUID_HEIGHT}`}>
            <line
              stroke="var(--text-disabled)"
              strokeDasharray="3 3"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              x1={0}
              x2={WIDTH}
              y1={FLUID_HEIGHT - 6}
              y2={FLUID_HEIGHT - 6}
            />
          </svg>
        </span>
      );
    }

    const coords = toPoints(points, 4, FLUID_HEIGHT - 2, 0.18);
    const line = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join("");
    const last = points[points.length - 1];
    const first = points[0];
    const dotTone: SparklineTone = tone ?? (last > first ? "positive" : last < first ? "negative" : "neutral");
    const lastY = coords[coords.length - 1][1];

    return (
      <span aria-hidden="true" className={cn("relative block h-8 w-full min-w-0", className)}>
        <svg
          className="absolute top-0 left-0 h-full w-[calc(100%-3px)] overflow-visible"
          focusable="false"
          preserveAspectRatio="none"
          viewBox={`0 0 ${WIDTH} ${FLUID_HEIGHT}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity={0.12} />
              <stop offset="1" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={`${line}L${WIDTH},${FLUID_HEIGHT}L0,${FLUID_HEIGHT}Z`} fill={`url(#${gradientId})`} />
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <i
          className={cn("absolute right-px size-1 rounded-full shadow-[0_0_0_2px_var(--surface-1)]", toneDotClass[dotTone])}
          style={{ top: `${(lastY - 2).toFixed(2)}px` }}
        />
      </span>
    );
  }

  if (points.length < 2) {
    return null;
  }

  const path = toPoints(points, PADDING, FIXED_HEIGHT - PADDING, 0)
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");

  return (
    <svg
      aria-hidden="true"
      className={cn("h-7 w-[100px] shrink-0 overflow-visible", className)}
      focusable="false"
      viewBox={`0 0 ${WIDTH} ${FIXED_HEIGHT}`}
    >
      <polyline
        fill="none"
        points={path}
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

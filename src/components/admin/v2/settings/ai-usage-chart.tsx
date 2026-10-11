"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { formatAiCompact, formatAiNumber, type AiUsageBucketPoint } from "./ai-settings-model";

// Grafico de area do consumo por hora ou por dia (docs/17 §2.7): serie 1 neutra (--series-1),
// preenchimento suave, grade so horizontal, eixo em zero, tooltip com linha de referencia. Os pontos
// e os rotulos vem dos baldes do periodo (src/components/admin/v2/period.ts). Carregado com next/dynamic.

type AiUsageChartProps = {
  height: number;
  points: readonly AiUsageBucketPoint[];
};

function UsageTooltip({ active, payload }: TooltipContentProps<number, string>) {
  const point = payload?.[0]?.payload as AiUsageBucketPoint | undefined;

  if (!active || !point) {
    return null;
  }

  const rows = [
    { label: "Tokens", marker: true, value: formatAiNumber(point.totalTokens) },
    { label: "Entrada", marker: false, value: formatAiNumber(point.inputTokens) },
    { label: "Saída", marker: false, value: formatAiNumber(point.outputTokens) },
    { label: "Respostas", marker: false, value: formatAiNumber(point.answers) }
  ];

  return (
    <div className="min-w-48 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] px-3 pt-2 pb-1.5 text-xs font-medium shadow-[0_12px_32px_rgba(0,0,0,0.5)]">
      <p className="mb-1 leading-5 font-semibold whitespace-nowrap text-[var(--text-primary)]">{point.longLabel}</p>
      {rows.map((row) => (
        <p className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-2 leading-6" key={row.label}>
          <span aria-hidden="true" className={row.marker ? "h-0.5 w-3 rounded-full bg-[var(--series-1)]" : ""} />
          <span className="whitespace-nowrap text-[var(--text-secondary)]">{row.label}</span>
          <span className="pl-3 text-right font-semibold text-[var(--text-primary)] tabular-nums">{row.value}</span>
        </p>
      ))}
    </div>
  );
}

export default function AiUsageChart({ height, points }: AiUsageChartProps) {
  const gradientId = useId().replace(/:/g, "");
  const tickInterval = points.length > 45 ? Math.ceil(points.length / 6) - 1 : points.length > 14 ? Math.ceil(points.length / 5) - 1 : 0;

  return (
    <ResponsiveContainer height={height} width="100%">
      <AreaChart data={[...points]} margin={{ bottom: 0, left: 0, right: 12, top: 8 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--series-1)" stopOpacity={0.16} />
            <stop offset="1" stopColor="var(--series-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="0" vertical={false} />
        <XAxis
          axisLine={{ stroke: "var(--border-strong)" }}
          dataKey="label"
          interval={tickInterval}
          minTickGap={12}
          tick={{ fill: "var(--text-tertiary)", fontSize: 12, fontWeight: 500 }}
          tickLine={false}
          tickMargin={10}
        />
        <YAxis
          allowDecimals={false}
          axisLine={false}
          domain={[0, "auto"]}
          tick={{ fill: "var(--text-tertiary)", fontSize: 12, fontWeight: 500 }}
          tickCount={4}
          tickFormatter={(value: number) => formatAiCompact(value)}
          tickLine={false}
          width={56}
        />
        <Tooltip
          content={(props) => <UsageTooltip {...(props as TooltipContentProps<number, string>)} />}
          cursor={{ stroke: "var(--text-tertiary)", strokeDasharray: "3 3", strokeWidth: 1 }}
          isAnimationActive={false}
        />
        <Area
          activeDot={{ fill: "var(--series-1)", r: 4, stroke: "var(--surface-1)", strokeWidth: 2 }}
          dataKey="totalTokens"
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
          name="Tokens"
          stroke="var(--series-1)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          type="monotone"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

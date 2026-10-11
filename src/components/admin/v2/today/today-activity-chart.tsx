"use client";

import { useId } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { TodayDemoActivityPoint } from "./today-demo";

// Grafico "Atividade dos alunos" (prototipo): quem assistiu (area clara), aulas concluidas (linha) e o
// periodo anterior tracejado. Hoje so recebe numeros simulados (ADMIN_DEMO_DATA=on); com o registro de
// aulas assistidas recebe os reais no mesmo formato.

type TodayActivityChartProps = {
  height: number;
  points: readonly TodayDemoActivityPoint[];
};

const numberFormat = new Intl.NumberFormat("pt-BR");

function ActivityTooltip({ active, payload }: TooltipContentProps<number, string>) {
  const point = payload?.[0]?.payload as TodayDemoActivityPoint | undefined;

  if (!active || !point) {
    return null;
  }

  const rows = [
    { label: "Alunos que assistiram", marker: "h-0.5 w-3 rounded-full bg-[var(--series-1)]", value: point.watched },
    { label: "Aulas concluídas", marker: "h-0.5 w-3 rounded-full bg-[var(--series-2)]", value: point.completed },
    { label: "Período anterior", marker: "w-3 border-t border-dashed border-[var(--series-previous)]", value: point.previousWatched }
  ];

  return (
    <div className="min-w-52 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] px-3 pt-2 pb-1.5 text-xs font-medium shadow-[0_12px_32px_rgba(0,0,0,0.5)]">
      <p className="mb-1 leading-5 font-semibold whitespace-nowrap text-[var(--text-primary)]">{point.longLabel}</p>
      {rows.map((row) => (
        <p className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-2 leading-6" key={row.label}>
          <span aria-hidden="true" className={row.marker} />
          <span className="whitespace-nowrap text-[var(--text-secondary)]">{row.label}</span>
          <span className="pl-3 text-right font-semibold text-[var(--text-primary)] tabular-nums">{numberFormat.format(row.value)}</span>
        </p>
      ))}
    </div>
  );
}

export function TodayActivityChart({ height, points }: TodayActivityChartProps) {
  const gradientId = useId().replace(/:/g, "");
  const tickInterval = points.length > 45 ? Math.ceil(points.length / 6) - 1 : points.length > 14 ? Math.ceil(points.length / 5) - 1 : 0;

  return (
    <ResponsiveContainer height={height} width="100%">
      <ComposedChart data={[...points]} margin={{ bottom: 0, left: 0, right: 12, top: 8 }}>
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
          tick={{ fill: "var(--text-tertiary)", fontSize: 12 }}
          tickLine={false}
          tickMargin={8}
        />
        <YAxis
          allowDecimals={false}
          axisLine={false}
          tick={{ fill: "var(--text-tertiary)", fontSize: 12 }}
          tickFormatter={(value: number) => numberFormat.format(value)}
          tickLine={false}
          width={40}
        />
        <Tooltip
          content={(props) => <ActivityTooltip {...(props as TooltipContentProps<number, string>)} />}
          cursor={{ stroke: "var(--text-tertiary)", strokeDasharray: "3 3", strokeWidth: 1 }}
          isAnimationActive={false}
        />
        <Line
          dataKey="previousWatched"
          dot={false}
          isAnimationActive={false}
          stroke="var(--series-previous)"
          strokeDasharray="4 4"
          strokeWidth={1.5}
          type="monotone"
        />
        <Area
          dataKey="watched"
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
          stroke="var(--series-1)"
          strokeWidth={2}
          type="monotone"
        />
        <Line dataKey="completed" dot={false} isAnimationActive={false} stroke="var(--series-2)" strokeWidth={2} type="monotone" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

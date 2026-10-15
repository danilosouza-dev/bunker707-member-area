"use client";

import { Table2, ChartColumn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  LIFECYCLE_ACTIVE_RULE,
  LIFECYCLE_GROUPS,
  LIFECYCLE_GROUP_FORMULAS,
  LIFECYCLE_GROUP_LABELS,
  type LifecycleGroup,
  type LifecycleWeek
} from "@/server/students/model";
import { ChartCard } from "../chart-card";
import { adminCard } from "../styles";
import { formatShortDate } from "./format";
import { studentListHref } from "./hrefs";

// Ciclo de vida semanal (docs/17 §1.11): 12 semanas, barras empilhadas Novos / Retidos / Recuperados /
// Inativos. Clique num pedaco abre a lista daquele grupo naquela semana. "Ver como tabela" e a formula
// de cada grupo ficam visiveis (regra: nenhuma metrica sem formula). Calculado no banco.

type LifecycleCardProps = {
  /** Enquanto houver dados aproximados (backfill), a tela avisa a partir de quando sao exatos. */
  approximateUntil: string | null;
  weeks: readonly LifecycleWeek[];
};

const SERIES: { color: string; group: LifecycleGroup; key: keyof LifecycleWeek }[] = [
  { color: "var(--success)", group: "new", key: "newCount" },
  { color: "var(--text-primary)", group: "retained", key: "retainedCount" },
  { color: "var(--warning)", group: "recovered", key: "recoveredCount" },
  { color: "var(--text-tertiary)", group: "inactive", key: "inactiveCount" }
];

function weekLabel(weekStart: string) {
  return formatShortDate(`${weekStart}T12:00:00.000Z`).slice(0, 5);
}

function LifecycleTooltip({ active, payload, label }: TooltipContentProps<number, string>) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] px-3 py-2 text-xs text-[var(--text-primary)] shadow-[0_14px_36px_rgba(0,0,0,0.55)]">
      <p className="mb-1 font-medium">Semana de {String(label)}</p>
      {payload.map((entry) => (
        <p className="flex items-center gap-2 tabular-nums" key={String(entry.dataKey)}>
          <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: String(entry.color) }} />
          <span className="text-[var(--text-secondary)]">{String(entry.name)}</span>
          <span className="ml-auto font-medium">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

export function LifecycleCard({ approximateUntil, weeks }: LifecycleCardProps) {
  const router = useRouter();
  const [asTable, setAsTable] = useState(false);
  const data = useMemo(
    () => weeks.map((week) => ({ ...week, label: weekLabel(week.weekStart) })),
    [weeks]
  );
  const hasData = weeks.some((week) => week.newCount + week.retainedCount + week.recoveredCount + week.inactiveCount > 0);

  function open(weekStart: string, group: LifecycleGroup) {
    router.push(studentListHref({}, { group, week: weekStart }));
  }

  // Sem estudo registrado ainda: uma faixa de uma linha em vez de um grafico vazio ocupando a tela.
  if (!hasData) {
    return (
      <section aria-label="Ciclo de vida" className={cn(adminCard, "flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-[13px] leading-5")}>
        <ChartColumn aria-hidden="true" className="size-4 shrink-0 text-[var(--text-tertiary)]" />
        <h2 className="font-medium text-[var(--text-primary)]">Ciclo de vida</h2>
        <p className="min-w-0 text-[var(--text-secondary)]">
          Aparece quando houver estudo registrado pelo player. {LIFECYCLE_ACTIVE_RULE}
        </p>
      </section>
    );
  }

  return (
    <ChartCard
      actions={
        <Button aria-pressed={asTable} className="gap-1.5 px-3" onClick={() => setAsTable((value) => !value)} type="button" variant="ghost">
          {asTable ? <ChartColumn aria-hidden="true" className="size-4" /> : <Table2 aria-hidden="true" className="size-4" />}
          {asTable ? "Ver como gráfico" : "Ver como tabela"}
        </Button>
      }
      footer={
        <p className="text-xs leading-5 text-[var(--text-tertiary)]">
          {LIFECYCLE_ACTIVE_RULE}
          {approximateUntil ? ` Dados aproximados até ${formatShortDate(`${approximateUntil}T12:00:00.000Z`)}; exatos a partir daí.` : ""}
        </p>
      }
      height={200}
      legend={
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
          {SERIES.map((series) => (
            <li className="flex items-center gap-1.5" key={series.group} title={LIFECYCLE_GROUP_FORMULAS[series.group]}>
              <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: series.color }} />
              {LIFECYCLE_GROUP_LABELS[series.group]}
            </li>
          ))}
        </ul>
      }
      meta="últimas 12 semanas"
      state="ready"
      title="Ciclo de vida"
    >
      {asTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-[var(--text-secondary)] tabular-nums">
            <caption className="sr-only">Ciclo de vida por semana</caption>
            <thead>
              <tr className="text-left text-xs text-[var(--text-tertiary)]">
                <th className="py-1.5 pr-3 font-medium" scope="col">Semana</th>
                {LIFECYCLE_GROUPS.map((group) => (
                  <th className="py-1.5 pr-3 text-right font-medium" key={group} scope="col" title={LIFECYCLE_GROUP_FORMULAS[group]}>
                    {LIFECYCLE_GROUP_LABELS[group]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr className="border-t border-[var(--border-subtle)]" key={week.weekStart}>
                  <th className="py-1.5 pr-3 text-left font-normal text-[var(--text-primary)]" scope="row">{formatShortDate(`${week.weekStart}T12:00:00.000Z`)}</th>
                  {SERIES.map((series) => (
                    <td className="py-1.5 pr-3 text-right" key={series.group}>
                      <button
                        className={cn("rounded px-1 hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]", Number(week[series.key]) === 0 && "pointer-events-none text-[var(--text-tertiary)]")}
                        onClick={() => open(week.weekStart, series.group)}
                        type="button"
                      >
                        {week[series.key]}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={data} margin={{ bottom: 0, left: 0, right: 8, top: 8 }}>
            <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
            <XAxis axisLine={false} dataKey="label" fontSize={11} stroke="var(--text-tertiary)" tickLine={false} />
            <YAxis allowDecimals={false} axisLine={false} fontSize={11} stroke="var(--text-tertiary)" tickLine={false} width={28} />
            <Tooltip content={(props) => <LifecycleTooltip {...(props as TooltipContentProps<number, string>)} />} cursor={{ fill: "var(--hover-overlay)" }} />
            {SERIES.map((series) => (
              <Bar
                className="cursor-pointer"
                dataKey={series.key}
                fill={series.color}
                key={series.group}
                name={LIFECYCLE_GROUP_LABELS[series.group]}
                onClick={(entry) => {
                  const weekStart = (entry as { payload?: { weekStart?: string } }).payload?.weekStart;

                  if (weekStart) {
                    open(weekStart, series.group);
                  }
                }}
                stackId="semana"
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

"use client";

import { ChartColumn, Table2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceDot, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { PanelFilters } from "@/server/webinars/export-schemas";
import {
  panelHref,
  panelNumberText,
  panelPercentText,
  type HourRow,
  type OverTimePoint,
  type PanelOption,
  type PanelPresenceResult,
  type PanelTabKind,
  type RetentionChart,
  type TripleBar,
  type VariantRow
} from "@/server/webinars/panel-model";
import { ChartCard } from "../../../chart-card";
import { adminInputClass } from "../../../form";
import { PanelDataTable, type PanelColumn } from "./panel-kit";

// Os graficos dos paineis (docs/30 §3.1 a §3.3): cada um num ChartCard (280 px; 208 px quando a area tem menos de 480
// px) com o alternador "Ver como tabela" / "Ver como gráfico" obrigatorio (um botao de acao comum, sem aria-pressed:
// o texto diz o que o clique faz; 44 px no toque) e a formula no rodape. Linhas e barras pelo recharts de
// src/components/ui/chart.tsx; as distribuicoes (Por horario do dia, Oferta por variante) sao barras horizontais
// simples como as do relatorio do pop-up, com o numero escrito ao lado. Nada de pizza. Os pontos chegam prontos de
// panel-model.ts; aqui so o desenho. `initialMode="table"` abre ja em tabela (o teste e quem nao enxerga o grafico).

const COPY = WEBINAR_COPY.paineis.graficos;
const HEIGHT = 280;
const COMPACT = 208;

type Mode = "chart" | "table";

const tick = { fill: "var(--text-tertiary)", fontSize: 12, fontWeight: 500 };

function useMode(initialMode: Mode) {
  const [mode, setMode] = useState<Mode>(initialMode);
  return { mode, toggle: () => setMode((value) => (value === "chart" ? "table" : "chart")) };
}

function ModeToggle({ mode, onToggle }: { mode: Mode; onToggle: () => void }) {
  const table = mode === "table";

  return (
    <Button className="gap-1.5 px-3 pointer-coarse:h-11" onClick={onToggle} type="button" variant="ghost">
      {table ? <ChartColumn aria-hidden="true" className="size-4" /> : <Table2 aria-hidden="true" className="size-4" />}
      {table ? COPY.verComoGrafico : COPY.verComoTabela}
    </Button>
  );
}

function TableArea({ children }: { children: ReactNode }) {
  return <div className="size-full overflow-y-auto pr-1">{children}</div>;
}

function Legend({ items }: { items: readonly { color: string; dashed?: boolean; label: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map((item) => (
        <li className="flex items-center gap-1.5" key={item.label}>
          <span
            aria-hidden="true"
            className={cn("inline-block", item.dashed ? "w-3 border-t border-dashed" : "size-2 rounded-full")}
            style={item.dashed ? { borderColor: item.color } : { backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Presenca minuto a minuto (a sessao escolhida)
 * ---------------------------------------------------------------------------------------------- */

type PresenceCardProps = {
  filters: PanelFilters;
  initialMode?: Mode;
  kind: PanelTabKind;
  options: readonly PanelOption[];
  periodo: string | null;
  result: PanelPresenceResult;
  selectedId: string | null;
};

const presenceConfig = { n: { color: "var(--series-1)", label: COPY.eixoPresentes } } satisfies ChartConfig;

function SessionSelect({ filters, kind, options, periodo, selectedId }: Omit<PresenceCardProps, "initialMode" | "result">) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const label = kind === "live" ? COPY.seletorLive : COPY.seletorSessao;

  if (options.length === 0) {
    return null;
  }

  return (
    <label aria-busy={pending || undefined} className="flex min-w-0 flex-col gap-1 md:flex-row md:items-center md:gap-2">
      <span className="text-xs leading-4 font-medium text-[var(--text-tertiary)]">{label}</span>
      <select
        className={cn(adminInputClass, "h-9 w-full bg-[var(--surface-1)] text-[13px] md:max-w-[360px] pointer-coarse:h-11")}
        onChange={(event) => startTransition(() => router.replace(panelHref({ filters, kind, periodo, sessionId: event.target.value }), { scroll: false }))}
        value={selectedId ?? ""}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PresenceChartCard(props: PresenceCardProps) {
  const { initialMode = "chart", kind, result } = props;
  const { mode, toggle } = useMode(initialMode);
  const chart = result.status === "ok" ? result.chart : null;
  const hasData = Boolean(chart && chart.points.some((point) => point.n > 0));
  const message =
    result.status === "empty"
      ? COPY.escolhaSessao
      : result.status === "pending_migration"
        ? COPY.curvaPendente
        : result.status === "error"
          ? COPY.curvaErro
          : COPY.ninguemNaSessao;
  const columns: PanelColumn<{ label: string; present: number }>[] = [
    { cell: (row) => row.label, header: COPY.eixoMinuto, id: "minuto" },
    { align: "right", cell: (row) => panelNumberText(row.present), header: COPY.eixoPresentes, id: "presentes" }
  ];

  return (
    <ChartCard
      headingLevel="h3"
      actions={hasData ? <ModeToggle mode={mode} onToggle={toggle} /> : null}
      className="lg:col-span-2"
      compactHeight={COMPACT}
      emptyTitle={message}
      footer={
        <div className="flex min-w-0 flex-col gap-3">
          <SessionSelect filters={props.filters} kind={kind} options={props.options} periodo={props.periodo} selectedId={props.selectedId} />
          {chart && hasData ? (
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-semibold text-[var(--text-secondary)]">{COPY.pontosDeQueda}</span>
              {chart.drops.length > 0 ? (
                <ol className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 tabular-nums" data-panel-drops="">
                  {chart.drops.map((drop) => (
                    <li key={drop.minute}>
                      {drop.label} · {panelNumberText(drop.n)}
                    </li>
                  ))}
                </ol>
              ) : (
                <span>{COPY.semQuedas}</span>
              )}
              <span>{WEBINAR_COPY.paineis.formulas.presenca}</span>
            </div>
          ) : null}
        </div>
      }
      height={HEIGHT}
      legend={
        chart && hasData ? (
          <Legend
            items={[
              { color: "var(--series-1)", label: COPY.eixoPresentes },
              { color: "var(--error)", label: COPY.pontosDeQueda },
              ...(chart.offerWindow ? [{ color: "var(--warning)", label: COPY.janelaDaOferta }] : [])
            ]}
          />
        ) : null
      }
      meta={chart?.peak ? COPY.pico(chart.peak.n, chart.peak.label) : undefined}
      state={hasData ? "ready" : "empty"}
      title={COPY.presencaMinutoAMinuto}
    >
      {chart && hasData ? (
        mode === "table" ? (
          <TableArea>
            <PanelDataTable caption={COPY.presencaMinutoAMinuto} columns={columns} rowKey={(row) => row.label} rows={chart.table} />
          </TableArea>
        ) : (
          <ChartContainer className="aspect-auto size-full" config={presenceConfig}>
            <AreaChart data={chart.points} margin={{ bottom: 0, left: 0, right: 12, top: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                axisLine={{ stroke: "var(--border-strong)" }}
                dataKey="minute"
                domain={[0, chart.durationMinutes]}
                tick={tick}
                tickFormatter={(value: number) => `${Math.round(value)}`}
                tickLine={false}
                type="number"
              />
              <YAxis allowDecimals={false} axisLine={false} tick={tick} tickLine={false} width={40} />
              {chart.offerWindow ? (
                <ReferenceArea fill="var(--warning)" fillOpacity={0.12} ifOverflow="extendDomain" stroke="none" x1={chart.offerWindow.from} x2={chart.offerWindow.to} />
              ) : null}
              <ChartTooltip content={<ChartTooltipContent hideIndicator labelFormatter={(_, payload) => String(payload?.[0]?.payload?.label ?? "")} />} />
              <Area dataKey="n" fill="var(--color-n)" fillOpacity={0.12} isAnimationActive={false} name={COPY.eixoPresentes} stroke="var(--color-n)" strokeWidth={2} type="monotone" />
              {chart.drops.map((drop) => (
                <ReferenceDot fill="var(--error)" key={drop.minute} r={4} stroke="var(--surface-1)" x={drop.minute} y={drop.n} />
              ))}
            </AreaChart>
          </ChartContainer>
        )
      ) : null}
    </ChartCard>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Retencao media
 * ---------------------------------------------------------------------------------------------- */

const LINE_COLORS = ["var(--series-2)", "var(--chart-4)", "var(--warning)", "var(--success)", "var(--text-tertiary)"];

export function RetentionChartCard({ chart, initialMode = "chart", kind }: { chart: RetentionChart | null; initialMode?: Mode; kind: PanelTabKind }) {
  const { mode, toggle } = useMode(initialMode);
  const title = kind === "live" ? COPY.retencaoMedia : COPY.retencaoPorWebinario;
  const data = chart
    ? chart.average.map((point, index) => ({
        media: point.value,
        pct: point.pct,
        ...Object.fromEntries(chart.lines.map((line, lineIndex) => [`s${lineIndex}`, line.points[index]?.value ?? 0]))
      }))
    : [];
  const config: ChartConfig = {
    media: { color: "var(--series-1)", label: COPY.media },
    ...Object.fromEntries((chart?.lines ?? []).map((line, index) => [`s${index}`, { color: LINE_COLORS[index % LINE_COLORS.length], label: line.label }]))
  };
  const columns: PanelColumn<(typeof data)[number]>[] = [
    { cell: (row) => `${row.pct} %`, header: COPY.eixoDuracao, id: "pct" },
    { align: "right", cell: (row) => panelPercentText(row.media), header: COPY.media, id: "media" },
    ...(chart?.lines ?? []).map((line, index) => ({
      align: "right" as const,
      cell: (row: (typeof data)[number]) => panelPercentText((row as Record<string, number>)[`s${index}`]),
      header: line.label,
      id: `s${index}`,
      wideOnly: true
    }))
  ];

  return (
    <ChartCard
      headingLevel="h3"
      actions={chart ? <ModeToggle mode={mode} onToggle={toggle} /> : null}
      compactHeight={COMPACT}
      footer={kind === "live" ? WEBINAR_COPY.paineis.formulas.retencao : WEBINAR_COPY.paineis.formulas.retencaoGravadas}
      height={HEIGHT}
      legend={
        chart ? (
          <Legend items={[{ color: "var(--series-1)", label: COPY.media }, ...chart.lines.map((line, index) => ({ color: LINE_COLORS[index % LINE_COLORS.length], dashed: true, label: line.label }))]} />
        ) : null
      }
      meta={chart ? COPY.eixoUnicos : undefined}
      state={chart ? "ready" : "empty"}
      title={title}
    >
      {chart ? (
        mode === "table" ? (
          <TableArea>
            <PanelDataTable caption={title} columns={columns} rowKey={(row) => String(row.pct)} rows={data} />
          </TableArea>
        ) : (
          <ChartContainer className="aspect-auto size-full" config={config}>
            <LineChart data={data} margin={{ bottom: 0, left: 0, right: 12, top: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis axisLine={{ stroke: "var(--border-strong)" }} dataKey="pct" tick={tick} tickFormatter={(value: number) => `${value}%`} tickLine={false} />
              <YAxis axisLine={false} domain={[0, 100]} tick={tick} tickFormatter={(value: number) => `${value}%`} tickLine={false} width={44} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => `${value} %`} />} />
              {chart.lines.map((line, index) => (
                <Line
                  dataKey={`s${index}`}
                  dot={false}
                  isAnimationActive={false}
                  key={line.id}
                  name={line.label}
                  stroke={`var(--color-s${index})`}
                  strokeDasharray="4 3"
                  strokeOpacity={0.7}
                  strokeWidth={1}
                  type="monotone"
                />
              ))}
              <Line dataKey="media" dot={false} isAnimationActive={false} name={COPY.media} stroke="var(--color-media)" strokeWidth={2.5} type="monotone" />
            </LineChart>
          </ChartContainer>
        )
      ) : null}
    </ChartCard>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Vagas × Presentes × Replay (Lives ao vivo)
 * ---------------------------------------------------------------------------------------------- */

const tripleConfig = {
  present: { color: "var(--series-1)", label: COPY.presentes },
  registered: { color: "var(--series-2)", label: COPY.vagas },
  replay: { color: "var(--chart-4)", label: COPY.replay }
} satisfies ChartConfig;

export function TripleBarsChartCard({ bars, initialMode = "chart" }: { bars: readonly TripleBar[]; initialMode?: Mode }) {
  const { mode, toggle } = useMode(initialMode);
  const hasData = bars.some((bar) => bar.registered + bar.present + bar.replay > 0);
  const columns: PanelColumn<TripleBar>[] = [
    { cell: (row) => row.longLabel, header: COPY.eixoData, id: "live" },
    { align: "right", cell: (row) => panelNumberText(row.registered), header: COPY.vagas, id: "vagas" },
    { align: "right", cell: (row) => panelNumberText(row.present), header: COPY.presentes, id: "presentes" },
    { align: "right", cell: (row) => panelNumberText(row.replay), header: COPY.replay, id: "replay" }
  ];

  return (
    <ChartCard
      headingLevel="h3"
      actions={hasData ? <ModeToggle mode={mode} onToggle={toggle} /> : null}
      compactHeight={COMPACT}
      footer={WEBINAR_COPY.paineis.formulas.vagasPresentesReplay}
      height={HEIGHT}
      legend={
        hasData ? (
          <Legend
            items={[
              { color: "var(--series-2)", label: COPY.vagas },
              { color: "var(--series-1)", label: COPY.presentes },
              { color: "var(--chart-4)", label: COPY.replay }
            ]}
          />
        ) : null
      }
      state={hasData ? "ready" : "empty"}
      title={COPY.vagasPresentesReplay}
    >
      {hasData ? (
        mode === "table" ? (
          <TableArea>
            <PanelDataTable caption={COPY.vagasPresentesReplay} columns={columns} rowKey={(row) => row.id} rows={bars} />
          </TableArea>
        ) : (
          <ChartContainer className="aspect-auto size-full" config={tripleConfig}>
            <BarChart data={[...bars]} margin={{ bottom: 0, left: 0, right: 12, top: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis axisLine={{ stroke: "var(--border-strong)" }} dataKey="label" tick={tick} tickLine={false} />
              <YAxis allowDecimals={false} axisLine={false} tick={tick} tickLine={false} width={40} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, payload) => String(payload?.[0]?.payload?.longLabel ?? "")} />} cursor={{ fill: "var(--hover-overlay)" }} />
              <Bar dataKey="registered" fill="var(--color-registered)" isAnimationActive={false} name={COPY.vagas} radius={[3, 3, 0, 0]} />
              <Bar dataKey="present" fill="var(--color-present)" isAnimationActive={false} name={COPY.presentes} radius={[3, 3, 0, 0]} />
              <Bar dataKey="replay" fill="var(--color-replay)" isAnimationActive={false} name={COPY.replay} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )
      ) : null}
    </ChartCard>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Lives ao longo do tempo (Lives ao vivo; "Event performance over time" do Zoom)
 * ---------------------------------------------------------------------------------------------- */

const overTimeConfig = {
  present: { color: "var(--series-1)", label: COPY.presentes },
  reachedEndPct: { color: "var(--warning)", label: COPY.viramAteOFim }
} satisfies ChartConfig;

export function OverTimeChartCard({ initialMode = "chart", points }: { initialMode?: Mode; points: readonly OverTimePoint[] }) {
  const { mode, toggle } = useMode(initialMode);
  const hasData = points.some((point) => point.present > 0);
  const columns: PanelColumn<OverTimePoint>[] = [
    { cell: (row) => row.longLabel, header: COPY.eixoData, id: "live" },
    { align: "right", cell: (row) => panelNumberText(row.present), header: COPY.presentes, id: "presentes" },
    { align: "right", cell: (row) => panelPercentText(row.reachedEndPct), header: COPY.viramAteOFim, id: "fim" }
  ];

  return (
    <ChartCard
      headingLevel="h3"
      actions={hasData ? <ModeToggle mode={mode} onToggle={toggle} /> : null}
      compactHeight={COMPACT}
      footer={WEBINAR_COPY.paineis.formulas.livesAoLongoDoTempo}
      height={HEIGHT}
      legend={
        hasData ? (
          <Legend
            items={[
              { color: "var(--series-1)", label: COPY.presentes },
              { color: "var(--warning)", label: COPY.viramAteOFim }
            ]}
          />
        ) : null
      }
      state={hasData ? "ready" : "empty"}
      title={COPY.livesAoLongoDoTempo}
    >
      {hasData ? (
        mode === "table" ? (
          <TableArea>
            <PanelDataTable caption={COPY.livesAoLongoDoTempo} columns={columns} rowKey={(row) => row.id} rows={points} />
          </TableArea>
        ) : (
          <ChartContainer className="aspect-auto size-full" config={overTimeConfig}>
            <ComposedChart data={[...points]} margin={{ bottom: 0, left: 0, right: 4, top: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis axisLine={{ stroke: "var(--border-strong)" }} dataKey="label" tick={tick} tickLine={false} />
              <YAxis allowDecimals={false} axisLine={false} tick={tick} tickLine={false} width={40} yAxisId="left" />
              <YAxis axisLine={false} domain={[0, 100]} orientation="right" tick={tick} tickFormatter={(value: number) => `${value}%`} tickLine={false} width={44} yAxisId="right" />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, payload) => String(payload?.[0]?.payload?.longLabel ?? "")} />} cursor={{ fill: "var(--hover-overlay)" }} />
              <Bar dataKey="present" fill="var(--color-present)" isAnimationActive={false} name={COPY.presentes} radius={[3, 3, 0, 0]} yAxisId="left" />
              <Line connectNulls dataKey="reachedEndPct" dot={{ r: 3 }} isAnimationActive={false} name={COPY.viramAteOFim} stroke="var(--color-reachedEndPct)" strokeWidth={2} type="monotone" yAxisId="right" />
            </ComposedChart>
          </ChartContainer>
        )
      ) : null}
    </ChartCard>
  );
}

/* ------------------------------------------------------------------------------------------------
 * As distribuicoes em barras horizontais (Lives gravadas)
 * ---------------------------------------------------------------------------------------------- */

function BarLine({ label, percent, summary }: { label: string; percent: number; summary: string }) {
  return (
    <li className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm leading-5">
        <span className="min-w-0 text-[var(--text-primary)] [overflow-wrap:anywhere]">{label}</span>
        <span className="text-[13px] text-[var(--text-secondary)] tabular-nums">{summary}</span>
      </div>
      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div className="h-full rounded-full bg-[var(--text-primary)]/25" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
    </li>
  );
}

export function HourOfDayCard({ initialMode = "chart", offersAvailable, rows }: { initialMode?: Mode; offersAvailable: boolean; rows: readonly HourRow[] }) {
  const { mode, toggle } = useMode(initialMode);
  const hasData = rows.some((row) => row.participants > 0);
  const max = Math.max(1, ...rows.map((row) => row.participants));
  const columns: PanelColumn<HourRow>[] = [
    { cell: (row) => row.label, header: COPY.eixoHora, id: "hora" },
    { align: "right", cell: (row) => panelNumberText(row.sessions), header: COPY.sessoes, id: "sessoes" },
    { align: "right", cell: (row) => panelNumberText(row.participants), header: COPY.participantes, id: "participantes" },
    { align: "right", cell: (row) => (offersAvailable ? panelPercentText(row.conversion) : "—"), header: COPY.conversao, id: "conversao" }
  ];

  return (
    <ChartCard
      headingLevel="h3"
      actions={hasData ? <ModeToggle mode={mode} onToggle={toggle} /> : null}
      compactHeight={COMPACT}
      footer={`${WEBINAR_COPY.paineis.formulas.porHorario} · ${COPY.conversao}: ${WEBINAR_COPY.paineis.formulas.conversao}`}
      height={HEIGHT}
      meta={COPY.eixoHora}
      state={hasData ? "ready" : "empty"}
      title={COPY.porHorarioDoDia}
    >
      {hasData ? (
        <TableArea>
          {mode === "table" ? (
            <PanelDataTable caption={COPY.porHorarioDoDia} columns={columns} rowKey={(row) => String(row.hour)} rows={rows} />
          ) : (
            <ul aria-label={COPY.porHorarioDoDia} className="flex min-w-0 flex-col gap-3">
              {rows.map((row) => (
                <BarLine
                  key={row.hour}
                  label={row.label}
                  percent={(row.participants / max) * 100}
                  summary={`${COPY.resumoHora(row.participants, row.sessions)}${offersAvailable && row.conversion !== null ? ` · ${COPY.conversaoDe(panelPercentText(row.conversion))}` : ""}`}
                />
              ))}
            </ul>
          )}
        </TableArea>
      ) : null}
    </ChartCard>
  );
}

export function VariantsCard({ initialMode = "chart", rows }: { initialMode?: Mode; rows: readonly VariantRow[] | null }) {
  const { mode, toggle } = useMode(initialMode);
  const hasData = Boolean(rows && rows.length > 0);
  const max = Math.max(1, ...(rows ?? []).map((row) => row.seen));
  const columns: PanelColumn<VariantRow>[] = [
    { cell: (row) => WEBINAR_COPY.paineis.filtros.varianteN(row.label), header: COPY.variante, id: "variante" },
    { align: "right", cell: (row) => panelNumberText(row.seen), header: COPY.viram, id: "viram" },
    { align: "right", cell: (row) => panelNumberText(row.clicks), header: COPY.clicaram, id: "clicaram" },
    { align: "right", cell: (row) => panelNumberText(row.purchases), header: COPY.compraram, id: "compraram" },
    { align: "right", cell: (row) => panelPercentText(row.conversion), header: COPY.conversao, id: "conversao" }
  ];

  return (
    <ChartCard
      headingLevel="h3"
      actions={hasData ? <ModeToggle mode={mode} onToggle={toggle} /> : null}
      compactHeight={COMPACT}
      emptyTitle={rows === null ? COPY.ofertaPendente : COPY.semOferta}
      footer={`${COPY.conversao}: ${WEBINAR_COPY.paineis.formulas.conversaoVariante}`}
      height={HEIGHT}
      state={hasData ? "ready" : "empty"}
      title={COPY.ofertaPorVariante}
    >
      {rows && hasData ? (
        <TableArea>
          {mode === "table" ? (
            <PanelDataTable caption={COPY.ofertaPorVariante} columns={columns} rowKey={(row) => row.label} rows={rows} />
          ) : (
            <ul aria-label={COPY.ofertaPorVariante} className="flex min-w-0 flex-col gap-3">
              {rows.map((row) => (
                <BarLine
                  key={row.label}
                  label={WEBINAR_COPY.paineis.filtros.varianteN(row.label)}
                  percent={(row.seen / max) * 100}
                  summary={`${COPY.resumoVariante(row.seen, row.clicks, row.purchases)}${row.conversion !== null ? ` · ${COPY.conversaoDe(panelPercentText(row.conversion))}` : ""}`}
                />
              ))}
            </ul>
          )}
        </TableArea>
      ) : null}
    </ChartCard>
  );
}

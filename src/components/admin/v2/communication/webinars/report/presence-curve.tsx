"use client";

import { ChartColumn, Table2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { bucketLabel, type ReportBucket } from "@/server/webinars/report-model";
import { curveByMinute, curveGeometry } from "@/server/webinars/report-page-model";
import { adminCard } from "../../../styles";

// A curva "Presentes minuto a minuto" (docs/30 §3.4): um SVG inline (um ponto por balde de 30 s, a area por baixo,
// os 5 maiores pontos de queda marcados), com o resumo (pico, minuto e media) escrito para o leitor de tela e o
// alternador "Ver como tabela" / "Ver como gráfico" do relatorio do pop-up: um botao de acao comum (sem
// aria-pressed; o texto diz o que o clique faz), 44 px no toque. A tabela e uma linha por minuto (o maior numero
// de presentes dos dois baldes), com <caption> e <th scope="col">; cabe a 375 px sem rolar de lado. Os pontos
// vem prontos de report-page-model.ts: aqui so o desenho. Quando a gravacao tem transcricao, cada queda da lista
// "Maiores quedas" traz o trecho do video daquele minuto (dropExcerpts; sem cue no minuto, a frase que diz isso).

const COPY = WEBINAR_COPY.relatorio;
const EXPORTAR = WEBINAR_COPY.exportar;
const WIDTH = 600;
const HEIGHT = 160;

type PresenceCurveCardProps = {
  avgPresent: number;
  bucketSeconds?: number;
  curve: readonly ReportBucket[];
  /** O trecho da transcricao de cada queda, pelo balde; nulo quando a gravacao nao tem transcricao. */
  dropExcerpts?: Record<number, string | null> | null;
  drops: readonly ReportBucket[];
  durationMs: number;
  /** Abre ja em tabela (o teste e quem nao enxerga o grafico). */
  initialMode?: "chart" | "table";
  live: boolean;
  peak: ReportBucket | null;
};

export function PresenceCurveCard({ avgPresent, bucketSeconds, curve, dropExcerpts = null, drops, durationMs, initialMode = "chart", live, peak }: PresenceCurveCardProps) {
  const [table, setTable] = useState(initialMode === "table");
  const titleId = useId();
  const hasData = curve.some((point) => point.n > 0);
  const summary = peak ? COPY.curvaResumo(peak.n, bucketLabel(peak.b, bucketSeconds), avgPresent) : COPY.curvaVazia;
  const geometry = hasData ? curveGeometry({ bucketSeconds, curve, drops, durationMs, height: HEIGHT, live, width: WIDTH }) : null;
  const rows = hasData ? curveByMinute(curve, bucketSeconds) : [];

  return (
    <section aria-labelledby={titleId} className={cn(adminCard, "flex min-w-0 flex-col gap-4 p-4")}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id={titleId}>
            {COPY.curva}
          </h2>
          <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">{summary}</p>
        </div>
        {hasData ? (
          <Button className="gap-1.5 px-3 pointer-coarse:h-11" onClick={() => setTable((value) => !value)} type="button" variant="ghost">
            {table ? <ChartColumn aria-hidden="true" className="size-4" /> : <Table2 aria-hidden="true" className="size-4" />}
            {table ? COPY.verComoGrafico : COPY.verComoTabela}
          </Button>
        ) : null}
      </header>

      {!hasData || !geometry ? (
        <p className="text-[13px] leading-5 text-[var(--text-tertiary)]">{COPY.curvaVazia}</p>
      ) : table ? (
        <table className="w-full border-collapse text-sm text-[var(--text-secondary)] tabular-nums">
          <caption className="sr-only">{COPY.curva}</caption>
          <thead>
            <tr>
              <th className="h-9 border-b border-[var(--border-subtle)] px-3 text-left align-middle text-xs font-medium text-[var(--text-tertiary)]" scope="col">
                {COPY.minuto}
              </th>
              <th className="h-9 border-b border-[var(--border-subtle)] px-3 text-right align-middle text-xs font-medium text-[var(--text-tertiary)]" scope="col">
                {COPY.presentes}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="last:[&>*]:border-b-0" key={row.minute}>
                <td className="h-10 border-b border-[var(--border-subtle)] px-3 align-middle text-[var(--text-primary)]">{row.label}</td>
                <td className="h-10 border-b border-[var(--border-subtle)] px-3 text-right align-middle">{row.present}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <figure className="flex min-w-0 flex-col gap-2">
          <svg aria-label={summary} className="h-40 w-full text-[var(--text-primary)] md:h-52" preserveAspectRatio="none" role="img" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
            {[0.25, 0.5, 0.75].map((fraction) => (
              <line key={fraction} stroke="var(--border-subtle)" strokeWidth="1" x1="0" x2={WIDTH} y1={HEIGHT * fraction} y2={HEIGHT * fraction} />
            ))}
            <path d={geometry.area} fill="currentColor" fillOpacity="0.12" stroke="none" />
            <path d={geometry.line} fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            {geometry.drops.map((drop) => (
              <circle cx={drop.x} cy={drop.y} fill="var(--error)" key={drop.b} r="4" stroke="var(--surface-1)" strokeWidth="1.5">
                <title>{drop.label}</title>
              </circle>
            ))}
          </svg>
          <figcaption className="flex min-w-0 justify-between gap-2 text-xs leading-4 text-[var(--text-tertiary)] tabular-nums" aria-hidden="true">
            {geometry.ticks.map((tick) => (
              <span key={tick.label}>{tick.label}</span>
            ))}
          </figcaption>
        </figure>
      )}

      {hasData ? (
        <div className="flex min-w-0 flex-col gap-2 border-t border-[var(--border-subtle)] pt-4">
          <h3 className="text-sm leading-5 font-semibold text-[var(--text-primary)]">{COPY.maioresQuedas}</h3>
          {geometry && geometry.drops.length > 0 && dropExcerpts ? (
            <ol aria-label={COPY.maioresQuedas} className="flex min-w-0 flex-col gap-2 text-[13px] leading-5 text-[var(--text-secondary)]">
              {geometry.drops.map((drop) => {
                const excerpt = dropExcerpts[drop.b] ?? null;

                return (
                  <li className="flex min-w-0 flex-col gap-0.5" key={drop.b}>
                    <span className="tabular-nums">{drop.label}</span>
                    <span className="min-w-0 text-xs text-[var(--text-tertiary)] [overflow-wrap:anywhere]">
                      {excerpt ? `${EXPORTAR.quedas.trechoDaTranscricao} “${excerpt}”` : EXPORTAR.quedas.semTranscricao}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : geometry && geometry.drops.length > 0 ? (
            <ol aria-label={COPY.maioresQuedas} className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-[13px] leading-5 text-[var(--text-secondary)] tabular-nums">
              {geometry.drops.map((drop) => (
                <li key={drop.b}>{drop.label}</li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] leading-5 text-[var(--text-tertiary)]">{COPY.semQuedas}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

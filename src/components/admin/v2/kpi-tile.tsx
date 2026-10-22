import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EMPTY_VALUE, formatDeltaMagnitude, formatKpiValue, type DeltaUnit, type KpiValueFormat } from "./format";
import { isAdminV2Href } from "./nav";
import { Sparkline, type SparklineTone } from "./sparkline";
import { adminCard, adminTransition } from "./styles";

type KpiTileProps = {
  className?: string;
  /** Contra o que o delta compara ("vs. 30 dias anteriores"). Vai para o rodape so quando nao ha `definition`. */
  comparisonLabel?: string;
  /** Linha de baixo do cartao, com o que o numero conta: "≥ 10 min ou 1 aula concluída". */
  definition?: string;
  /** Versao curta da definicao, para o cartao estreito (celular e 1024-1279 px): "≥ 10 min ou 1 aula". */
  definitionShort?: string;
  /** Variacao contra o periodo anterior: percentual (12.5 = 12,5 %) ou pontos, conforme `deltaUnit`. */
  delta?: number | null;
  /** "percent" (padrao): "12 %". "points": "2 pts", para numeros que ja sao percentuais. */
  deltaUnit?: DeltaUnit;
  /** Frase do rodape quando nao ha valor. */
  emptyLabel?: string;
  format?: KpiValueFormat;
  /** Abre a lista correspondente, com o mesmo total do numero. */
  href?: string;
  /** Metricas em que subir e ruim (dispensa, falhas, inativos): queda fica verde. */
  invertDelta?: boolean;
  label: string;
  /** Periodo por extenso para leitores de tela, ex.: "últimos 30 dias". */
  periodLabel?: string;
  /** Serie do periodo (um ponto por balde). Ao lado do numero; sem pontos, linha tracejada. */
  sparkline?: readonly number[];
  sparklineColor?: string;
  value: number | null | undefined;
};

type DeltaTone = SparklineTone;

function getDeltaTone(delta: number, invertDelta: boolean): DeltaTone {
  if (delta === 0) {
    return "neutral";
  }

  return delta > 0 !== invertDelta ? "positive" : "negative";
}

const deltaToneClasses: Record<DeltaTone, string> = {
  negative: "text-[var(--error)]",
  neutral: "text-[var(--text-secondary)]",
  positive: "text-[var(--success)]"
};

// Cartao estreito (@max-[196px]: menos de 196 px de conteudo): celular em 2 colunas e 4 colunas entre
// 1024 e 1279 px. As classes ficam escritas por inteiro para o Tailwind encontra-las no codigo.

/**
 * Indicador na disposicao do prototipo aprovado:
 *   largo     rotulo ............ delta      estreito  rotulo
 *             numero  ~~sparkline~~                    numero delta
 *             definicao                                definicao curta
 *                                                      ~~sparkline~~
 * Numero 32/600 tabular; delta com seta e cor semantica; "—" e "Sem dados no período" sem valor.
 */
export function KpiTile({
  className,
  comparisonLabel = "vs. período anterior",
  definition,
  definitionShort,
  delta,
  deltaUnit = "percent",
  emptyLabel = "Sem dados no período",
  format = "number",
  href,
  invertDelta = false,
  label,
  periodLabel,
  sparkline,
  sparklineColor = "var(--text-secondary)",
  value
}: KpiTileProps) {
  const hasValue = typeof value === "number" && Number.isFinite(value);
  const valueText = hasValue ? formatKpiValue(value, format) : EMPTY_VALUE;
  const hasDelta = hasValue && typeof delta === "number" && Number.isFinite(delta);
  const tone = hasDelta ? getDeltaTone(delta, invertDelta) : "neutral";
  const DeltaIcon = !hasDelta || delta === 0 ? Minus : delta > 0 ? ArrowUp : ArrowDown;
  const deltaText = hasDelta ? formatDeltaMagnitude(delta, deltaUnit) : null;
  const footer = hasValue ? (definition ?? comparisonLabel) : emptyLabel;
  const footerShort = hasValue ? (definitionShort ?? footer) : emptyLabel;
  const showSparkline = sparkline !== undefined || !hasValue;

  const ariaLabel = [
    label,
    hasValue ? valueText : emptyLabel,
    hasDelta && deltaText
      ? `${delta === 0 ? "estável" : delta > 0 ? "alta de" : "queda de"}${delta === 0 ? "" : ` ${deltaText}`} ${comparisonLabel}`
      : null,
    hasValue && definition ? definition : null,
    periodLabel ?? null
  ]
    .filter(Boolean)
    .join(", ");

  const body: ReactNode = (
    <span
      className={cn(
        "grid min-w-0 flex-1 content-start grid-cols-[auto_minmax(0,1fr)_auto] [grid-template-areas:'label_label_delta'_'num_spark_spark'_'def_def_def']",
        "@max-[196px]:grid-cols-[auto_minmax(0,1fr)] @max-[196px]:grid-rows-[auto_auto_auto_1fr] @max-[196px]:[grid-template-areas:'label_label'_'num_delta'_'def_def'_'spark_spark']"
      )}
    >
      {/* Cartao estreito (duas colunas a 375 px): o rotulo e a definicao quebram em ate duas linhas em vez de cortar. */}
      <span className="min-w-0 truncate text-[13px] leading-5 font-medium text-[var(--text-secondary)] [grid-area:label] @max-[196px]:line-clamp-2 @max-[196px]:whitespace-normal">
        {label}
      </span>
      {hasDelta ? (
        <span
          className={cn(
            "inline-flex items-center gap-[3px] justify-self-end pl-2 text-[13px] leading-5 font-semibold whitespace-nowrap tabular-nums [grid-area:delta]",
            "@max-[196px]:mt-2 @max-[196px]:ml-2 @max-[196px]:self-center @max-[196px]:justify-self-start @max-[196px]:pl-0",
            deltaToneClasses[tone]
          )}
        >
          <DeltaIcon aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
          {deltaText}
        </span>
      ) : null}
      <span
        className={cn(
          "mt-3 text-[32px] leading-10 font-semibold tracking-[-0.02em] tabular-nums [grid-area:num] max-[479px]:text-[28px]",
          "@max-[196px]:mt-2 @max-[196px]:leading-9",
          hasValue ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"
        )}
      >
        {valueText}
      </span>
      {showSparkline ? (
        <span className={cn("mt-3 ml-6 block min-w-0 self-start [grid-area:spark]", "@max-[196px]:mt-4 @max-[196px]:ml-0 @max-[196px]:self-end")}>
          <Sparkline color={sparklineColor} tone={hasDelta ? tone : undefined} values={hasValue ? (sparkline ?? []) : []} variant="fluid" />
        </span>
      ) : null}
      <span
        className={cn(
          "mt-2 min-w-0 truncate text-xs leading-4 font-medium text-[var(--text-tertiary)] [grid-area:def]",
          "@max-[196px]:mt-0 @max-[196px]:line-clamp-2 @max-[196px]:whitespace-normal"
        )}
        title={footer}
      >
        <span className="@max-[196px]:hidden">{footer}</span>
        <span aria-hidden="true" className="hidden @max-[196px]:inline">
          {footerShort}
        </span>
      </span>
    </span>
  );

  const tileClasses = cn(adminCard, "@container flex min-w-0 flex-col p-4", className);

  if (href) {
    return (
      <Link
        aria-label={ariaLabel}
        className={cn(tileClasses, adminTransition, "hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]")}
        data-navigation-feedback={isAdminV2Href(href) ? "false" : undefined}
        href={href}
      >
        {body}
      </Link>
    );
  }

  return (
    <div aria-label={ariaLabel} className={tileClasses} role="group">
      {body}
    </div>
  );
}

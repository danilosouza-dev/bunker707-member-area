import { KpiTile } from "../kpi-tile";
import type { TodayDemoData } from "./today-demo";
import { computePercentDelta, computePointsDelta, describeAccessOrigins, type TodayAccessKpiState } from "./today-model";
import { TodaySectionHeading } from "./today-section-heading";

type TodayKpisProps = {
  /** Rodape de comparacao para leitores de tela: "vs. 30 dias anteriores". */
  comparisonLabel: string;
  /** Numeros simulados (ADMIN_DEMO_DATA=on, so localhost). */
  demo?: TodayDemoData;
  heading: { meta: string; title: string };
  newAccesses: TodayAccessKpiState;
  /** Periodo por extenso para leitores de tela. */
  periodLabel: string;
};

const NEW_ACCESSES_EMPTY: Record<Exclude<TodayAccessKpiState["status"], "ready">, string> = {
  error: "Não foi possível carregar",
  "pending-migration": "Precisa da atualização do banco"
};

/**
 * Linha 2 do Hoje: quatro numeros do periodo da barra superior (4 colunas a partir de 1024 px, 2 abaixo).
 * Alunos estudando, Aulas concluidas e Conclusao em 90 dias dependem do registro de aulas assistidas,
 * que ainda nao existe: ficam em "—" com "Sem dados no período", nunca um exemplo.
 */
export function TodayKpis({ comparisonLabel, demo, heading, newAccesses, periodLabel }: TodayKpisProps) {
  if (demo) {
    return (
      <section aria-labelledby="hoje-numeros" className="flex min-w-0 flex-col gap-3">
        <TodaySectionHeading id="hoje-numeros" meta={heading.meta} title={heading.title} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile
            comparisonLabel={comparisonLabel}
            definition="≥ 10 min ou 1 aula concluída"
            definitionShort="≥ 10 min ou 1 aula"
            delta={computePercentDelta(demo.studying.total, demo.studying.previousTotal)}
            label="Alunos estudando"
            periodLabel={periodLabel}
            sparkline={demo.studying.series}
            value={demo.studying.total}
          />
          <KpiTile
            comparisonLabel={comparisonLabel}
            definition="acessos liberados no período"
            definitionShort="liberados no período"
            delta={computePercentDelta(demo.newAccesses.total, demo.newAccesses.previousTotal)}
            label="Novos acessos"
            periodLabel={periodLabel}
            sparkline={demo.newAccesses.series}
            value={demo.newAccesses.total}
          />
          <KpiTile
            comparisonLabel={comparisonLabel}
            definition="aulas marcadas como concluídas"
            definitionShort="aulas concluídas"
            delta={computePercentDelta(demo.completed.total, demo.completed.previousTotal)}
            label="Aulas concluídas"
            periodLabel={periodLabel}
            sparkline={demo.completed.series}
            value={demo.completed.total}
          />
          <KpiTile
            comparisonLabel={comparisonLabel}
            definition="de quem começou no mesmo mês"
            definitionShort="de quem começou"
            delta={computePointsDelta(demo.completion90.total, demo.completion90.previousTotal)}
            deltaUnit="points"
            format="percent"
            label="Conclusão em 90 dias"
            periodLabel={periodLabel}
            sparkline={demo.completion90.series}
            value={demo.completion90.total}
          />
        </div>
      </section>
    );
  }

  const ready = newAccesses.status === "ready" ? newAccesses : null;
  const origins = ready ? describeAccessOrigins(ready.origins) : null;

  return (
    <section aria-labelledby="hoje-numeros" className="flex min-w-0 flex-col gap-3">
      <TodaySectionHeading id="hoje-numeros" meta={heading.meta} title={heading.title} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile comparisonLabel={comparisonLabel} label="Alunos estudando" periodLabel={periodLabel} value={null} />
        <KpiTile
          comparisonLabel={comparisonLabel}
          definition={origins?.definition}
          definitionShort={origins?.definitionShort}
          delta={ready ? computePercentDelta(ready.total, ready.previousTotal) : null}
          deltaUnit="percent"
          emptyLabel={ready ? undefined : NEW_ACCESSES_EMPTY[newAccesses.status as keyof typeof NEW_ACCESSES_EMPTY]}
          label="Novos acessos"
          periodLabel={periodLabel}
          sparkline={ready ? ready.series : undefined}
          value={ready ? ready.total : null}
        />
        <KpiTile comparisonLabel={comparisonLabel} label="Aulas concluídas" periodLabel={periodLabel} value={null} />
        <KpiTile
          comparisonLabel={comparisonLabel}
          format="percent"
          label="Conclusão em 90 dias"
          periodLabel={periodLabel}
          value={null}
        />
      </div>
    </section>
  );
}

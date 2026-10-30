import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { PanelKpi } from "@/server/webinars/panel-model";
import { KpiTile } from "../../../kpi-tile";
import { PanelTextTile } from "./panel-kit";

// Os dez cartoes do painel (docs/30 §3.2 e §3.3): 4 por linha no computador, 2 abaixo de 768 px; cada um com a
// definicao no rodape, o delta contra o periodo anterior de mesmo tamanho (pontos nas porcentagens) e "—" com
// "Sem dados no período" sem valor. A Receita e texto (moedas, M8) num cartao do mesmo desenho, sem delta.

type PanelKpiGridProps = {
  /** "vs. 30 dias anteriores" (o rotulo do periodo anterior da barra). */
  comparisonLabel: string;
  kpis: readonly PanelKpi[];
  /** O periodo por extenso para o leitor de tela. */
  periodLabel: string;
  title: string;
};

export function PanelKpiGrid({ comparisonLabel, kpis, periodLabel, title }: PanelKpiGridProps) {
  return (
    <section aria-label={WEBINAR_COPY.paineis.numerosDoPainel(title)} className="grid grid-cols-2 gap-3 md:grid-cols-4" data-panel-kpis="">
      {kpis.map((kpi) =>
        kpi.text !== null ? (
          <PanelTextTile definition={kpi.definition} key={kpi.id} label={kpi.label} text={kpi.text} />
        ) : (
          <KpiTile
            comparisonLabel={comparisonLabel}
            definition={kpi.definition ?? undefined}
            delta={kpi.delta}
            deltaUnit={kpi.deltaUnit}
            emptyLabel={WEBINAR_COPY.paineis.vazio.periodo}
            format={kpi.format}
            key={kpi.id}
            label={kpi.label}
            periodLabel={periodLabel}
            value={kpi.value}
          />
        )
      )}
    </section>
  );
}

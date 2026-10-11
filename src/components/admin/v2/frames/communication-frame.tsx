import { BellRing, CalendarClock, TicketPercent, type LucideIcon } from "lucide-react";
import { Suspense } from "react";
import { EmptyState } from "../empty-state";
import { KpiTile } from "../kpi-tile";
import { getAdminLegacyAvailability } from "../nav";
import { AdminPage } from "../page-container";
import { PageHeader } from "../page-header";
import type { ResolvedAdminPeriod } from "../period";
import { UNDER_CONSTRUCTION_MESSAGE } from "../phase-placeholder";
import { SectionTabs } from "../section-tabs";
import {
  COMMUNICATION_TAB_META,
  COMMUNICATION_TABS,
  COMMUNICATION_TITLE,
  getCommunicationKpis,
  type CommunicationTab
} from "./communication-model";

// Moldura de Comunicacao na disposicao do prototipo aprovado: cabecalho com a frase da aba, abas
// sublinhadas (Avisos e pop-ups · Webinários · Promoções, cada uma com endereco proprio), os quatro
// numeros da aba e, no lugar da lista, o aviso honesto de tela em construcao. Os numeros seguem o
// periodo da barra superior (?periodo=) e ficam em "—": nada aqui e simulado. Nao ha botao "Novo
// aviso" porque o editor ainda nao existe (seria um botao que finge funcionar).

const TAB_ICONS: Record<CommunicationTab, LucideIcon> = {
  avisos: BellRing,
  promocoes: TicketPercent,
  webinarios: CalendarClock
};

const TAB_ITEMS = COMMUNICATION_TABS.map((tab) => ({
  href: COMMUNICATION_TAB_META[tab].href,
  label: COMMUNICATION_TAB_META[tab].label
}));

function StaticTabs() {
  return <div aria-hidden="true" className="h-10 border-b border-[var(--border-subtle)]" />;
}

export function CommunicationTabs() {
  return (
    <Suspense fallback={<StaticTabs />}>
      <SectionTabs ariaLabel="Seções de Comunicação" items={TAB_ITEMS} preserveParams={["periodo"]} />
    </Suspense>
  );
}

type CommunicationFrameProps = {
  /** Fase do docs/17 em que a aba chega (5 avisos e webinarios, 6 promocoes). So no atributo. */
  "data-phase": number;
  /** Periodo da barra superior, ja resolvido pela pagina com a hora da leitura. */
  period: ResolvedAdminPeriod;
  tab: CommunicationTab;
};

export function CommunicationFrame({ "data-phase": phase, period, tab }: CommunicationFrameProps) {
  const meta = COMMUNICATION_TAB_META[tab];
  const legacy = getAdminLegacyAvailability("comunicacao");
  const note = legacy.kind === "new" ? ` ${legacy.note}` : "";
  const periodLabel = period.label.toLocaleLowerCase("pt-BR");

  return (
    <AdminPage className="gap-6" data-phase={phase}>
      <div className="flex min-w-0 flex-col gap-4">
        <PageHeader description={meta.description} title={COMMUNICATION_TITLE} />
        <CommunicationTabs />
      </div>

      <section aria-label={`Números de ${meta.label.toLocaleLowerCase("pt-BR")}`} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {getCommunicationKpis(tab, period).map((kpi) => (
          <KpiTile format={kpi.format} key={kpi.label} label={kpi.label} periodLabel={periodLabel} value={null} />
        ))}
      </section>

      <EmptyState
        description={`${UNDER_CONSTRUCTION_MESSAGE}${note}`}
        headingLevel="h2"
        icon={TAB_ICONS[tab]}
        title={meta.upcomingTitle}
      />
    </AdminPage>
  );
}

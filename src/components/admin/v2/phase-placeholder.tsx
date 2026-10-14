import { Hourglass, type LucideIcon } from "lucide-react";
import { EmptyState } from "./empty-state";
import { AdminPage } from "./page-container";
import { PageHeader } from "./page-header";

// A frase abaixo e a mesma em toda tela em construcao. Comunicacao usa a moldura de ./frames
// (disposicao do prototipo aprovado, com data-phase na pagina); PhasePlaceholderPage fica para telas
// futuras que ainda nao tenham moldura propria.
export const UNDER_CONSTRUCTION_MESSAGE = "Esta tela ainda está sendo construída.";

type PhasePlaceholderPageProps = {
  description: string;
  icon?: LucideIcon;
  /** Explica o que chega com a tela (ex.: "Avisos e promoções chegam em breve."). */
  note?: string;
  /** Fase do docs/17 em que a tela chega. So vai para data-phase, nunca para o texto. */
  phase: number;
  title: string;
  /** Titulo do estado vazio, no vocabulario do produtor. */
  upcomingTitle: string;
};

/** Tela do admin ainda em construcao. Nao le dados nem oferece atalhos inventados. */
export function PhasePlaceholderPage({ description, icon = Hourglass, note, phase, title, upcomingTitle }: PhasePlaceholderPageProps) {
  return (
    <AdminPage data-phase={phase}>
      <PageHeader description={description} title={title} />
      <EmptyState description={note ? `${UNDER_CONSTRUCTION_MESSAGE} ${note}` : UNDER_CONSTRUCTION_MESSAGE} icon={icon} title={upcomingTitle} />
    </AdminPage>
  );
}

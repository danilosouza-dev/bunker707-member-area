import { Hourglass, type LucideIcon } from "lucide-react";
import { EmptyState } from "./empty-state";
import { getAdminLegacyAvailability, type AdminNavId } from "./nav";
import { AdminPage } from "./page-container";
import { PageHeader } from "./page-header";

// As frases abaixo sao as mesmas em toda tela em construcao. Alunos e Comunicacao usam as molduras de
// ./frames (disposicao do prototipo aprovado, com data-phase na pagina); PhasePlaceholderPage fica para
// telas futuras que ainda nao tenham moldura propria.
export const UNDER_CONSTRUCTION_MESSAGE = "Esta tela ainda está sendo construída.";
export const OPEN_LEGACY_ADMIN_LABEL = "Abrir no admin antigo";

type PhasePlaceholderPageProps = {
  /** Area do menu: decide se ha uma tela equivalente no admin antigo. */
  area: AdminNavId;
  description: string;
  icon?: LucideIcon;
  /** Endereco do admin antigo mais preciso que a tela inicial dele (ex.: lista de alunos ja filtrada). */
  legacyHref?: string;
  /** Fase do docs/17 em que a tela chega. So vai para data-phase, nunca para o texto. */
  phase: number;
  title: string;
  /** Titulo do estado vazio, no vocabulario do produtor. */
  upcomingTitle: string;
};

/**
 * Tela do admin novo ainda em construcao. Oferece o admin antigo so quando a area existe la;
 * areas novas (Comunicacao) explicam que ainda nao ha onde fazer isso. Nao le dados.
 */
export function PhasePlaceholderPage({
  area,
  description,
  icon = Hourglass,
  legacyHref,
  phase,
  title,
  upcomingTitle
}: PhasePlaceholderPageProps) {
  const legacy = getAdminLegacyAvailability(area);

  return (
    <AdminPage data-phase={phase}>
      <PageHeader description={description} title={title} />
      <EmptyState
        action={legacy.kind === "legacy" ? { href: legacyHref ?? legacy.href, label: OPEN_LEGACY_ADMIN_LABEL } : undefined}
        description={legacy.kind === "legacy" ? UNDER_CONSTRUCTION_MESSAGE : `${UNDER_CONSTRUCTION_MESSAGE} ${legacy.note}`}
        icon={icon}
        title={upcomingTitle}
      />
    </AdminPage>
  );
}

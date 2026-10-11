import type { ReactNode } from "react";
import type { CommunityStats } from "@/server/community/types";
import { AdminPage } from "../page-container";
import { PageHeader } from "../page-header";
import { PendingMigrationNotice } from "../pending-migration-notice";
import { SectionTabs } from "../section-tabs";
import { COMMUNITY_CARRIED_PARAMS, COMMUNITY_TAB_HREFS } from "./hrefs";
import { CommunityStatStrip } from "./stat-strip";

// Moldura comum das abas da Comunidade: titulo, quatro numeros, abas com endereco proprio e a area
// da aba (filtros + conteudo). Cada page.tsx renderiza esta moldura com os numeros do produto
// filtrado (o layout do App Router nao recebe ?produto=, por isso nao mora no layout).

export const COMMUNITY_DESCRIPTION = "Comentários de alunos sem resposta do professor, os mais antigos primeiro.";

type CommunityFrameProps = {
  children: ReactNode;
  /** Frase de apoio do cabecalho (a mesma em todas as abas, como no prototipo aprovado). */
  description?: string;
  stats: CommunityStats;
  /** Filtros da aba, logo abaixo das abas. */
  toolbar?: ReactNode;
};

// Espacos do prototipo: cabecalho -> numeros 24 px; numeros -> abas 20 px; abas -> filtros -> lista 12 px.
export function CommunityFrame({ children, description = COMMUNITY_DESCRIPTION, stats, toolbar }: CommunityFrameProps) {
  return (
    <AdminPage className="gap-6">
      <PageHeader description={description} title="Comunidade" />
      <div className="flex min-w-0 flex-col gap-5">
        <CommunityStatStrip stats={stats} />
        <div className="flex min-w-0 flex-col gap-3">
          <SectionTabs
            ariaLabel="Seções da Comunidade"
            items={[
              { count: stats.unanswered, href: COMMUNITY_TAB_HREFS.fila, label: "Precisam de resposta" },
              { href: COMMUNITY_TAB_HREFS.comentarios, label: "Comentários" },
              { count: stats.openReports, href: COMMUNITY_TAB_HREFS.denuncias, label: "Denúncias" },
              { href: COMMUNITY_TAB_HREFS.top, label: "Top alunos" },
              { href: COMMUNITY_TAB_HREFS.aulas, label: "Aulas" },
              { href: COMMUNITY_TAB_HREFS.regras, label: "Regras" }
            ]}
            preserveParams={COMMUNITY_CARRIED_PARAMS}
          />
          {toolbar}
          {children}
        </div>
      </div>
    </AdminPage>
  );
}

/** Banco sem a migracao 202610110020: titulo da Comunidade e o aviso, sem numeros nem abas. */
export function CommunityPendingMigration() {
  return (
    <AdminPage className="gap-6">
      <PageHeader title="Comunidade" />
      <PendingMigrationNotice />
    </AdminPage>
  );
}

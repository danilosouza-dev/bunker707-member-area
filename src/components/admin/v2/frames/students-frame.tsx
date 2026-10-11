import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChartCard } from "../chart-card";
import { EmptyState } from "../empty-state";
import { EMPTY_VALUE } from "../format";
import { AdminLinkButton } from "../link-button";
import { AdminPage } from "../page-container";
import { PageHeader } from "../page-header";
import { OPEN_LEGACY_ADMIN_LABEL, UNDER_CONSTRUCTION_MESSAGE } from "../phase-placeholder";
import { adminCard } from "../styles";

// Moldura de Alunos na disposicao do prototipo aprovado: cabecalho, linha do topo com o "Ciclo de
// vida semanal" e os tres numeros da semana (Ativos, Novos, Inativos) e, no lugar da tabela, o aviso
// honesto de tela em construcao com o caminho para o admin antigo.
//
// O ciclo de vida e os numeros dependem do registro de aulas assistidas: ficam vazios e em "—".
// Segmentos, busca, filtros e a tabela nao sao desenhados (seriam controles que nao funcionam), e
// "Importar CSV" e "Adicionar aluno" so aparecem quando existirem no admin novo.

export const STUDENTS_TITLE = "Alunos";
export const STUDENTS_DESCRIPTION = "Quem está estudando, quem precisa de atenção e o que fazer em massa.";
export const STUDENTS_UPCOMING_TITLE = "A nova lista de alunos está a caminho";

const LIFECYCLE_SERIES = [
  { color: "var(--series-1)", label: "Novos" },
  { color: "var(--series-2)", label: "Recuperados" },
  { color: "var(--series-previous)", label: "Retidos" }
] as const;

const WEEK_NUMBERS = ["Ativos", "Novos", "Inativos"] as const;

function LifecycleLegend() {
  return (
    <>
      {LIFECYCLE_SERIES.map((series) => (
        <span className="inline-flex items-center gap-2" key={series.label}>
          <span aria-hidden="true" className="size-2.5 rounded-[2px]" style={{ background: series.color }} />
          {series.label}
        </span>
      ))}
    </>
  );
}

/** Tres numeros da semana empilhados num card (lado do grafico) ou lado a lado (tela estreita). */
function WeekNumbers() {
  return (
    <section
      aria-label="Resumo da semana"
      className={cn(
        adminCard,
        "flex min-w-0 flex-row divide-x divide-[var(--border-subtle)] @min-[900px]:flex-col @min-[900px]:divide-x-0 @min-[900px]:divide-y"
      )}
    >
      {WEEK_NUMBERS.map((label) => (
        <div
          aria-label={`${label}: sem dados`}
          className="flex min-w-0 flex-1 flex-col justify-center gap-2 p-4 @min-[900px]:px-5"
          key={label}
          role="group"
        >
          <p className="truncate text-[13px] leading-5 font-medium text-[var(--text-secondary)]">{label}</p>
          <p aria-hidden="true" className="text-[28px] leading-8 font-semibold tracking-[-0.02em] text-[var(--text-tertiary)] tabular-nums">
            {EMPTY_VALUE}
          </p>
        </div>
      ))}
    </section>
  );
}

type StudentsFrameProps = {
  /** Fase do docs/17 em que a nova lista chega. So no atributo, nunca no texto. */
  "data-phase": number;
  /** Lista de alunos do admin antigo (ja filtrada quando o endereco trouxe ?busca=). */
  legacyHref: string;
};

export function StudentsFrame({ "data-phase": phase, legacyHref }: StudentsFrameProps) {
  return (
    <AdminPage className="gap-6" data-phase={phase}>
      <PageHeader
        actions={
          <AdminLinkButton href={legacyHref} variant="secondary">
            {OPEN_LEGACY_ADMIN_LABEL}
          </AdminLinkButton>
        }
        description={STUDENTS_DESCRIPTION}
        title={STUDENTS_TITLE}
      />

      <div className="@container flex min-w-0 flex-col gap-4">
        <div className="grid min-w-0 gap-4 @min-[900px]:grid-cols-[minmax(0,1fr)_248px] @min-[1300px]:grid-cols-[minmax(0,1fr)_280px]">
          <ChartCard
            emptyDescription="Aparece quando o registro de aulas assistidas estiver pronto."
            height={228}
            legend={<LifecycleLegend />}
            meta="alunos ativos por semana, últimas 12 semanas"
            state="empty"
            title="Ciclo de vida semanal"
          />
          <WeekNumbers />
        </div>

        <EmptyState
          action={{ href: legacyHref, label: OPEN_LEGACY_ADMIN_LABEL }}
          description={UNDER_CONSTRUCTION_MESSAGE}
          icon={Users}
          title={STUDENTS_UPCOMING_TITLE}
        />
      </div>
    </AdminPage>
  );
}

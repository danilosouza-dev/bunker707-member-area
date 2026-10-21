import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CommunicationTabs } from "../../frames/communication-frame";
import { COMMUNICATION_TAB_META, COMMUNICATION_TITLE } from "../../frames/communication-model";
import { AdminPage } from "../../page-container";
import { PageHeader } from "../../page-header";
import { KpiTileSkeleton, PageHeaderSkeleton } from "../../skeletons";
import { adminCard, adminDelayedReveal } from "../../styles";

// Skeletons de Fluxos na forma final (docs/17 §2.7): lista (cabecalho e abas estaticos, quatro numeros,
// pilulas e linhas), modelos (quatro cartoes) e o construtor ou relatorio (a coluna de cartoes com os
// conectores e, a partir de 1024 px, o painel a direita). Nunca o spinner de tela cheia.

const bar = "bg-[var(--surface-2)] motion-reduce:animate-none";
const ROW_KEYS = ["a", "b", "c", "d", "e"] as const;
const PILL_WIDTHS = [
  { id: "todos", width: "w-16" },
  { id: "ativos", width: "w-20" },
  { id: "rascunhos", width: "w-24" },
  { id: "encerrados", width: "w-24" }
] as const;
const TEMPLATE_KEYS = ["a", "b", "c", "d"] as const;
const STEP_KEYS = ["entrada", "primeira", "condicao"] as const;

function LoadingStatus({ label }: { label: string }) {
  return (
    <span aria-live="polite" className="sr-only" role="status">
      {label}
    </span>
  );
}

export function FlowsListSkeleton() {
  const meta = COMMUNICATION_TAB_META.fluxos;

  return (
    <AdminPage className="gap-6">
      <LoadingStatus label="Carregando fluxos" />
      <div className="flex min-w-0 flex-col gap-4">
        <PageHeader description={meta.description} title={COMMUNICATION_TITLE} />
        <CommunicationTabs />
      </div>
      <div aria-hidden="true" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTileSkeleton />
        <KpiTileSkeleton />
        <KpiTileSkeleton />
        <KpiTileSkeleton />
      </div>
      <div aria-hidden="true" className="flex min-w-0 flex-col gap-3">
        <div className={cn("flex gap-2", adminDelayedReveal)}>
          {PILL_WIDTHS.map((pill) => (
            <Skeleton className={cn("h-[34px] rounded-full", pill.width, bar)} key={pill.id} />
          ))}
        </div>
        <div className={cn(adminCard, "overflow-hidden")}>
          <div className="h-9 border-b border-[var(--border-subtle)]" />
          {ROW_KEYS.map((key) => (
            <div className={cn("flex h-14 items-center gap-3 border-b border-[var(--border-subtle)] px-4 last:border-b-0", adminDelayedReveal)} key={key}>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className={cn("h-4 w-56 max-w-full", bar)} />
                <Skeleton className={cn("h-3 w-32", bar)} />
              </div>
              <Skeleton className={cn("hidden h-4 w-48 md:block", bar)} />
              <Skeleton className={cn("h-[22px] w-20 rounded-md", bar)} />
              <Skeleton className={cn("hidden h-4 w-12 md:block", bar)} />
              <Skeleton className={cn("hidden h-4 w-12 md:block", bar)} />
            </div>
          ))}
        </div>
      </div>
    </AdminPage>
  );
}

export function FlowTemplatesSkeleton() {
  return (
    <AdminPage className="gap-6">
      <LoadingStatus label="Carregando os modelos" />
      <PageHeaderSkeleton />
      <div aria-hidden="true" className="grid min-w-0 gap-3 sm:grid-cols-2">
        {TEMPLATE_KEYS.map((key) => (
          <div className={cn(adminCard, "flex flex-col gap-3 p-4")} key={key}>
            <div className={cn("flex flex-col gap-2", adminDelayedReveal)}>
              <Skeleton className={cn("size-9 rounded-lg", bar)} />
              <Skeleton className={cn("h-5 w-48 max-w-full", bar)} />
              <Skeleton className={cn("h-4 w-full", bar)} />
              <Skeleton className={cn("h-4 w-40", bar)} />
            </div>
          </div>
        ))}
      </div>
    </AdminPage>
  );
}

function StepSkeleton() {
  return (
    <div className="flex flex-col items-center">
      <div className={cn(adminCard, "flex w-full max-w-[320px] flex-col gap-2 p-4")}>
        <div className={cn("flex flex-col gap-2", adminDelayedReveal)}>
          <Skeleton className={cn("h-4 w-20", bar)} />
          <Skeleton className={cn("h-5 w-48 max-w-full", bar)} />
          <Skeleton className={cn("h-4 w-32", bar)} />
        </div>
      </div>
      <div className="h-6 w-px bg-[var(--border-strong)]" />
      <Skeleton className={cn("h-6 w-28 rounded-full", bar)} />
      <div className="h-6 w-px bg-[var(--border-strong)]" />
    </div>
  );
}

/** Construtor ou relatorio: o mesmo endereco abre um ou outro (rascunho ou no ar). */
export function FlowBuilderSkeleton() {
  return (
    <AdminPage className="gap-6">
      <LoadingStatus label="Carregando o fluxo" />
      <PageHeaderSkeleton />
      <div aria-hidden="true" className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col">
          {STEP_KEYS.map((key) => (
            <StepSkeleton key={key} />
          ))}
        </div>
        <div className={cn(adminCard, "hidden flex-col gap-4 p-4 lg:flex")}>
          <div className={cn("flex flex-col gap-3", adminDelayedReveal)}>
            <Skeleton className={cn("h-5 w-32", bar)} />
            <Skeleton className={cn("h-10 w-full rounded-lg", bar)} />
            <Skeleton className={cn("h-4 w-24", bar)} />
            <Skeleton className={cn("h-24 w-full rounded-lg", bar)} />
          </div>
        </div>
      </div>
    </AdminPage>
  );
}

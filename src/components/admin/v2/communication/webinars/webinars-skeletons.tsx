import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CommunicationTabs } from "../../frames/communication-frame";
import { COMMUNICATION_TAB_META, COMMUNICATION_TITLE } from "../../frames/communication-model";
import { AdminPage } from "../../page-container";
import { PageHeader } from "../../page-header";
import { KpiTileSkeleton } from "../../skeletons";
import { adminCard, adminDelayedReveal } from "../../styles";

// Skeletons de Webinários na forma final (docs/17 §2.7): a lista (cabecalho e abas estaticos, cinco numeros,
// as abas da pagina, filtros e linhas), o editor (cards a esquerda, previa a direita) e a pagina de um
// webinario (cabecalho e duas colunas). Nunca o spinner de tela cheia.

const bar = "bg-[var(--surface-2)] motion-reduce:animate-none";
const ROW_KEYS = ["a", "b", "c", "d", "e"] as const;
const KPI_KEYS = ["a", "b", "c", "d", "e"] as const;
const FILTER_WIDTHS = [
  { id: "busca", width: "w-64" },
  { id: "todos", width: "w-16" },
  { id: "rascunho", width: "w-24" },
  { id: "agendado", width: "w-24" },
  { id: "andamento", width: "w-32" }
] as const;

function LoadingStatus({ label }: { label: string }) {
  return (
    <span aria-live="polite" className="sr-only" role="status">
      {label}
    </span>
  );
}

export function WebinarsListSkeleton() {
  const meta = COMMUNICATION_TAB_META.webinarios;

  return (
    <AdminPage className="gap-6">
      <LoadingStatus label="Carregando webinários" />
      <div className="flex min-w-0 flex-col gap-4">
        <PageHeader description={meta.description} title={COMMUNICATION_TITLE} />
        <CommunicationTabs />
      </div>
      <div aria-hidden="true" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {KPI_KEYS.map((key) => (
          <KpiTileSkeleton key={key} />
        ))}
      </div>
      <div aria-hidden="true" className="flex min-w-0 flex-col gap-3">
        <div className="h-10 border-b border-[var(--border-subtle)]" />
        <div className={cn("flex flex-wrap gap-2", adminDelayedReveal)}>
          {FILTER_WIDTHS.map((filter) => (
            <Skeleton className={cn("h-[34px] rounded-full", filter.width, bar)} key={filter.id} />
          ))}
        </div>
        <div className={cn(adminCard, "overflow-hidden")}>
          <div className="h-9 border-b border-[var(--border-subtle)]" />
          {ROW_KEYS.map((key) => (
            <div className={cn("flex h-16 items-center gap-3 border-b border-[var(--border-subtle)] px-4 last:border-b-0", adminDelayedReveal)} key={key}>
              <Skeleton className={cn("h-12 w-8 rounded-md", bar)} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className={cn("h-4 w-56 max-w-full", bar)} />
                <Skeleton className={cn("h-3 w-20", bar)} />
              </div>
              <Skeleton className={cn("hidden h-4 w-40 md:block", bar)} />
              <Skeleton className={cn("hidden h-[22px] w-20 rounded-md md:block", bar)} />
              <Skeleton className={cn("hidden h-4 w-12 md:block", bar)} />
            </div>
          ))}
        </div>
      </div>
    </AdminPage>
  );
}

function CardSkeleton({ fields }: { fields: readonly ("pills" | "tall" | "field")[] }) {
  return (
    <div className={cn(adminCard, "flex flex-col gap-4 p-4")}>
      <div className={cn("flex flex-col gap-1.5", adminDelayedReveal)}>
        <Skeleton className={cn("h-5 w-32", bar)} />
        <Skeleton className={cn("h-4 w-72 max-w-full", bar)} />
      </div>
      {fields.map((field, index) => (
        <div className={cn("flex flex-col gap-1.5", adminDelayedReveal)} key={`${field}-${index}`}>
          {field === "pills" ? (
            <div className="flex gap-2">
              <Skeleton className={cn("h-[34px] w-40 rounded-full", bar)} />
              <Skeleton className={cn("h-[34px] w-32 rounded-full", bar)} />
            </div>
          ) : (
            <>
              <Skeleton className={cn("h-4 w-24", bar)} />
              <Skeleton className={cn(field === "tall" ? "h-24" : "h-10", "w-full rounded-lg", bar)} />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export function WebinarEditorSkeleton() {
  return (
    <AdminPage className="gap-6">
      <LoadingStatus label="Carregando o webinário" />
      <div aria-hidden="true" className={cn("flex flex-col gap-2", adminDelayedReveal)}>
        <Skeleton className={cn("h-4 w-40", bar)} />
        <Skeleton className={cn("h-8 w-64 max-w-full", bar)} />
      </div>
      <div aria-hidden="true" className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <CardSkeleton fields={["pills", "field", "tall", "field", "field"]} />
          <CardSkeleton fields={["pills", "field"]} />
          <CardSkeleton fields={["pills"]} />
        </div>
        <div className={cn(adminCard, "flex min-w-0 flex-col gap-3 p-4")}>
          <div className={cn("flex items-center justify-between gap-3", adminDelayedReveal)}>
            <Skeleton className={cn("h-5 w-20", bar)} />
            <Skeleton className={cn("h-[34px] w-48 rounded-full", bar)} />
          </div>
          <Skeleton className={cn("aspect-[375/520] w-full max-w-[375px] self-center rounded-lg", bar, adminDelayedReveal)} />
        </div>
      </div>
    </AdminPage>
  );
}

/** Um webinario (/webinarios/[id]): o editor com a situacao no cabecalho. */
export function WebinarDetailSkeleton() {
  return (
    <AdminPage className="gap-6">
      <LoadingStatus label="Carregando o webinário" />
      <div aria-hidden="true" className={cn("flex flex-col gap-2", adminDelayedReveal)}>
        <Skeleton className={cn("h-4 w-40", bar)} />
        <Skeleton className={cn("h-8 w-72 max-w-full", bar)} />
        <Skeleton className={cn("h-5 w-48", bar)} />
      </div>
      <div aria-hidden="true" className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <CardSkeleton fields={["field", "tall", "field"]} />
          <CardSkeleton fields={["pills", "field"]} />
        </div>
        <div className={cn(adminCard, "flex min-w-0 flex-col gap-3 p-4")}>
          <Skeleton className={cn("h-5 w-24", bar, adminDelayedReveal)} />
          <Skeleton className={cn("aspect-[375/520] w-full max-w-[375px] self-center rounded-lg", bar, adminDelayedReveal)} />
        </div>
      </div>
    </AdminPage>
  );
}

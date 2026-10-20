import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CommunicationTabs } from "../frames/communication-frame";
import { COMMUNICATION_TAB_META, COMMUNICATION_TITLE } from "../frames/communication-model";
import { AdminPage } from "../page-container";
import { PageHeader } from "../page-header";
import { KpiTileSkeleton } from "../skeletons";
import { adminCard, adminDelayedReveal } from "../styles";

// Skeletons de Avisos e pop-ups na forma final (docs/17 §2.7): lista (cabecalho e abas estaticos,
// quatro numeros, filtro e linhas), editor novo (formulario a esquerda, previa a direita) e um aviso
// (cabecalho e duas colunas, neutro entre o editor e o relatorio). Nunca o spinner de tela cheia.

const bar = "bg-[var(--surface-2)] motion-reduce:animate-none";
const ROW_KEYS = ["a", "b", "c", "d", "e"] as const;
const FILTER_WIDTHS = [{ id: "todos", width: "w-16" }, { id: "notificacoes", width: "w-28" }, { id: "popups", width: "w-20" }] as const;

function LoadingStatus({ label }: { label: string }) {
  return (
    <span aria-live="polite" className="sr-only" role="status">
      {label}
    </span>
  );
}

export function NoticesListSkeleton() {
  const meta = COMMUNICATION_TAB_META.avisos;

  return (
    <AdminPage className="gap-6">
      <LoadingStatus label="Carregando avisos e pop-ups" />
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
          {FILTER_WIDTHS.map((filter) => (
            <Skeleton className={cn("h-[34px] rounded-full", filter.width, bar)} key={filter.id} />
          ))}
        </div>
        <div className={cn(adminCard, "overflow-hidden")}>
          <div className="h-9 border-b border-[var(--border-subtle)]" />
          {ROW_KEYS.map((key) => (
            <div className={cn("flex h-14 items-center gap-3 border-b border-[var(--border-subtle)] px-4 last:border-b-0", adminDelayedReveal)} key={key}>
              <Skeleton className={cn("h-9 w-16 rounded-md", bar)} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className={cn("h-4 w-56 max-w-full", bar)} />
                <Skeleton className={cn("h-3 w-20", bar)} />
              </div>
              <Skeleton className={cn("hidden h-4 w-48 md:block", bar)} />
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

export function NoticeEditorSkeleton() {
  return (
    <AdminPage className="gap-6">
      <LoadingStatus label="Carregando o aviso" />
      <div aria-hidden="true" className={cn("flex flex-col gap-2", adminDelayedReveal)}>
        <Skeleton className={cn("h-4 w-40", bar)} />
        <Skeleton className={cn("h-8 w-64 max-w-full", bar)} />
      </div>
      <div aria-hidden="true" className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <CardSkeleton fields={["pills", "field", "tall", "tall"]} />
          <CardSkeleton fields={["pills", "field"]} />
          <CardSkeleton fields={["pills"]} />
        </div>
        <div className={cn(adminCard, "flex min-w-0 flex-col gap-3 p-4")}>
          <div className={cn("flex items-center justify-between gap-3", adminDelayedReveal)}>
            <Skeleton className={cn("h-5 w-20", bar)} />
            <Skeleton className={cn("h-[34px] w-48 rounded-full", bar)} />
          </div>
          <Skeleton className={cn("aspect-[520/560] w-full rounded-lg", bar, adminDelayedReveal)} />
        </div>
      </div>
    </AdminPage>
  );
}

/**
 * Um aviso (/avisos/[id]): o endereco abre o editor ou o relatorio, entao o skeleton e neutro. So o
 * cabecalho (trilha, titulo e situacao) e duas colunas de blocos, sem a linha de numeros do relatorio.
 */
export function NoticeDetailSkeleton() {
  return (
    <AdminPage className="gap-6">
      <LoadingStatus label="Carregando o aviso" />
      <div aria-hidden="true" className={cn("flex flex-col gap-2", adminDelayedReveal)}>
        <Skeleton className={cn("h-4 w-40", bar)} />
        <Skeleton className={cn("h-8 w-72 max-w-full", bar)} />
        <Skeleton className={cn("h-5 w-48", bar)} />
      </div>
      <div aria-hidden="true" className="grid min-w-0 items-start gap-6 lg:grid-cols-2">
        <CardSkeleton fields={["field", "tall", "field"]} />
        <div className={cn(adminCard, "flex min-w-0 flex-col gap-3 p-4")}>
          <Skeleton className={cn("h-5 w-24", bar, adminDelayedReveal)} />
          <Skeleton className={cn("aspect-[520/480] w-full rounded-lg", bar, adminDelayedReveal)} />
        </div>
      </div>
    </AdminPage>
  );
}

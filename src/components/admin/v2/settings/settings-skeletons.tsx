import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ChartCardSkeleton } from "../chart-card";
import { AdminPage } from "../page-container";
import { KpiTileSkeleton, PageHeaderSkeleton } from "../skeletons";
import { adminCard, adminDelayedReveal } from "../styles";

// Skeletons de Configuracoes com a forma final de cada tela (docs/17 §2.7). Os de Tutor IA ficam
// dentro da moldura de /admin/configuracoes/ia (cabecalho e abas ja aparecem; so o conteudo carrega).

const bar = "bg-[var(--surface-2)] motion-reduce:animate-none";

function LoadingStatus({ label }: { label: string }) {
  return (
    <span aria-live="polite" className="sr-only" role="status">
      {label}
    </span>
  );
}

/** Hub de Configuracoes: cabecalho e a lista de seis linhas. */
export function SettingsHubSkeleton() {
  return (
    <AdminPage className="gap-6">
      <LoadingStatus label="Carregando as configurações" />
      <PageHeaderSkeleton />
      <div aria-hidden="true" className={cn(adminCard, "w-full max-w-[880px] divide-y divide-[var(--border-subtle)] overflow-hidden")}>
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div className="flex min-h-16 items-center gap-4 px-4 py-3" key={row}>
            <Skeleton className={cn("size-10 shrink-0 rounded-lg", bar, adminDelayedReveal)} />
            <div className={cn("flex min-w-0 flex-1 flex-col gap-1.5", adminDelayedReveal)}>
              <Skeleton className={cn("h-4 w-28", bar)} />
              <Skeleton className={cn("h-4 w-80 max-w-full", bar)} />
            </div>
            <Skeleton className={cn("hidden h-6 w-24 rounded-md sm:block", bar, adminDelayedReveal)} />
          </div>
        ))}
      </div>
    </AdminPage>
  );
}

function ProviderPickerSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-3 sm:grid-cols-3">
      {[0, 1, 2].map((item) => (
        <div className={cn(adminCard, "flex min-h-[76px] flex-col justify-center gap-2 px-4 py-3")} key={item}>
          <div className={cn("flex items-center justify-between gap-2", adminDelayedReveal)}>
            <Skeleton className={cn("h-4 w-32", bar)} />
            <Skeleton className={cn("h-5 w-16 rounded-md", bar)} />
          </div>
          <Skeleton className={cn("h-4 w-40", bar, adminDelayedReveal)} />
        </div>
      ))}
    </div>
  );
}

function SectionCardSkeleton({ className, rows = 3 }: { className?: string; rows?: number }) {
  return (
    <div aria-hidden="true" className={cn(adminCard, "flex flex-col gap-5 p-4", className)}>
      <div className={cn("flex flex-col gap-1.5", adminDelayedReveal)}>
        <Skeleton className={cn("h-5 w-48", bar)} />
        <Skeleton className={cn("h-4 w-72 max-w-full", bar)} />
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div className={cn("flex flex-col gap-1.5", adminDelayedReveal)} key={row}>
          <Skeleton className={cn("h-4 w-36", bar)} />
          <Skeleton className={cn("h-10 w-full max-w-[640px] rounded-lg", bar)} />
        </div>
      ))}
    </div>
  );
}

/** Modelos e limites: seletor de provedor e o formulario da politica. */
export function AiPolicySkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <LoadingStatus label="Carregando os modelos do Tutor IA" />
      <ProviderPickerSkeleton />
      <SectionCardSkeleton className="max-w-[720px]" rows={4} />
    </div>
  );
}

/** Conexoes: seletor de provedor, chaves de API e contas conectadas. */
export function AiConnectionsSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <LoadingStatus label="Carregando as conexões do Tutor IA" />
      <ProviderPickerSkeleton />
      <SectionCardSkeleton rows={2} />
      <SectionCardSkeleton rows={1} />
    </div>
  );
}

/** Consumo: quatro numeros, o grafico por dia e as tabelas. */
export function AiUsageSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <LoadingStatus label="Carregando o consumo do Tutor IA" />
      <div aria-hidden="true" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTileSkeleton />
        <KpiTileSkeleton />
        <KpiTileSkeleton />
        <KpiTileSkeleton />
      </div>
      <ChartCardSkeleton />
      <div aria-hidden="true" className="grid min-w-0 gap-6 xl:grid-cols-2">
        <SectionCardSkeleton rows={2} />
        <SectionCardSkeleton rows={2} />
      </div>
    </div>
  );
}

/** Vendas: cabecalho, o cartao da Hotmart com os dois menores ao lado e a lista de vendas recebidas. */
export function SalesSettingsSkeleton() {
  return (
    <AdminPage className="gap-6">
      <LoadingStatus label="Carregando as plataformas de venda" />
      <PageHeaderSkeleton />
      <div aria-hidden="true" className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SectionCardSkeleton rows={3} />
        <div className="flex min-w-0 flex-col gap-6">
          <SectionCardSkeleton rows={0} />
          <SectionCardSkeleton rows={0} />
        </div>
      </div>
      <SectionCardSkeleton rows={3} />
    </AdminPage>
  );
}

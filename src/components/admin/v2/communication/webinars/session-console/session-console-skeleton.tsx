import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AdminPage } from "../../../page-container";
import { adminCard, adminDelayedReveal } from "../../../styles";

// Esqueleto do console da sessao (docs/17 §2.7): cabecalho (trilha, titulo, situacao), o seletor e as duas
// colunas (chat a esquerda; roteiro, enquetes e perguntas a direita). Nunca o spinner de tela cheia.

const bar = "bg-[var(--surface-2)] motion-reduce:animate-none";
const PANEL_KEYS = ["roteiro", "enquetes", "perguntas"] as const;
const LINE_KEYS = ["a", "b", "c", "d"] as const;

export function SessionConsoleSkeleton() {
  return (
    <AdminPage className="gap-6">
      <span aria-live="polite" className="sr-only" role="status">
        Carregando o console da sessão
      </span>
      <div aria-hidden="true" className={cn("flex flex-col gap-2", adminDelayedReveal)}>
        <Skeleton className={cn("h-4 w-56", bar)} />
        <Skeleton className={cn("h-8 w-64 max-w-full", bar)} />
        <Skeleton className={cn("h-5 w-72 max-w-full", bar)} />
      </div>
      <Skeleton aria-hidden="true" className={cn("h-10 w-80 max-w-full rounded-lg", bar, adminDelayedReveal)} />
      <div aria-hidden="true" className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className={cn(adminCard, "flex min-w-0 flex-col gap-3 p-4")}>
          <Skeleton className={cn("h-5 w-20", bar, adminDelayedReveal)} />
          {LINE_KEYS.map((key) => (
            <div className={cn("flex flex-col gap-1.5", adminDelayedReveal)} key={key}>
              <Skeleton className={cn("h-3 w-32", bar)} />
              <Skeleton className={cn("h-4 w-full", bar)} />
            </div>
          ))}
          <Skeleton className={cn("h-16 w-full rounded-lg", bar, adminDelayedReveal)} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          {PANEL_KEYS.map((key) => (
            <div className={cn(adminCard, "flex min-w-0 flex-col gap-3 p-4")} key={key}>
              <Skeleton className={cn("h-5 w-24", bar, adminDelayedReveal)} />
              <Skeleton className={cn("h-12 w-full rounded-lg", bar, adminDelayedReveal)} />
              <Skeleton className={cn("h-12 w-full rounded-lg", bar, adminDelayedReveal)} />
            </div>
          ))}
        </div>
      </div>
    </AdminPage>
  );
}

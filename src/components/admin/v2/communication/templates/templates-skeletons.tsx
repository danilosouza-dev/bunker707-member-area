import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AdminPage } from "../../page-container";
import { PageHeaderSkeleton } from "../../skeletons";
import { adminCard, adminDelayedReveal } from "../../styles";

// Esqueleto da aba Modelos na forma final (docs/17 §2.7; spec §5.2): o cabecalho, a barra das abas, a linha de
// filtros (o campo de busca de 320 px e as 5 pilulas do tipo) e 6 linhas de 64 px com a miniatura de 36×48. Sem
// numeros (a aba nao tem). Nunca o spinner de tela cheia.

const bar = "bg-[var(--surface-2)] motion-reduce:animate-none";
const ROW_KEYS = ["a", "b", "c", "d", "e", "f"] as const;
const PILL_WIDTHS = [
  { id: "todos", width: "w-16" },
  { id: "notificacao", width: "w-28" },
  { id: "popup", width: "w-20" },
  { id: "personalizado", width: "w-44" },
  { id: "livre", width: "w-28" }
] as const;

export function TemplatesListSkeleton() {
  return (
    <AdminPage className="gap-6">
      <span aria-live="polite" className="sr-only" role="status">
        Carregando modelos
      </span>
      <div className="flex min-w-0 flex-col gap-4">
        <PageHeaderSkeleton />
        <div aria-hidden="true" className="h-10 border-b border-[var(--border-subtle)]" />
      </div>
      <div aria-hidden="true" className="flex min-w-0 flex-col gap-3">
        <div className={cn("flex min-w-0 flex-wrap items-center gap-2", adminDelayedReveal)}>
          <Skeleton className={cn("h-9 w-full rounded-lg md:w-[320px]", bar)} />
          {PILL_WIDTHS.map((pill) => (
            <Skeleton className={cn("h-[34px] rounded-full", pill.width, bar)} key={pill.id} />
          ))}
        </div>
        <div className={cn(adminCard, "overflow-hidden")}>
          <div className="h-9 border-b border-[var(--border-subtle)]" />
          {ROW_KEYS.map((key) => (
            <div className={cn("flex h-16 items-center gap-3 border-b border-[var(--border-subtle)] px-4 last:border-b-0", adminDelayedReveal)} key={key}>
              <Skeleton className={cn("h-12 w-9 shrink-0 rounded-md", bar)} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className={cn("h-4 w-56 max-w-full", bar)} />
                <Skeleton className={cn("h-3 w-40 max-w-full", bar)} />
              </div>
              <Skeleton className={cn("hidden h-4 w-28 md:block", bar)} />
              <Skeleton className={cn("hidden h-4 w-32 md:block", bar)} />
              <Skeleton className={cn("hidden h-4 w-24 md:block", bar)} />
            </div>
          ))}
        </div>
      </div>
    </AdminPage>
  );
}

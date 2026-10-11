import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { adminCard, adminDelayedReveal } from "../styles";

// Forma da aba Conteudo enquanto carrega (docs/17 §2.7: skeleton com a forma final, nunca spinner):
// linha de resumo e dois modulos com linhas de aula de 48 px. O cabecalho do produto e as abas sao
// do layout e nao piscam.

const bar = "bg-[var(--surface-2)] motion-reduce:animate-none";

function ModuleSkeleton({ lessons }: { lessons: number }) {
  return (
    <div aria-hidden="true" className={cn(adminCard, "overflow-hidden")}>
      <div className="flex h-[52px] items-center gap-3 border-b border-[var(--border-subtle)] px-4">
        <div className={cn("flex flex-1 items-center gap-3", adminDelayedReveal)}>
          <Skeleton className={cn("h-4 w-20", bar)} />
          <Skeleton className={cn("h-4 w-44 max-w-[40%]", bar)} />
          <Skeleton className={cn("ml-auto hidden h-4 w-32 sm:block", bar)} />
          <Skeleton className={cn("h-4 w-14", bar)} />
        </div>
      </div>
      {Array.from({ length: lessons }, (_, index) => (
        <div className="flex h-12 items-center gap-3 border-b border-[var(--border-subtle)] px-4 last:border-b-0 md:pl-12" key={index}>
          <div className={cn("flex flex-1 items-center gap-3", adminDelayedReveal)}>
            <Skeleton className={cn("h-4 w-4", bar)} />
            <Skeleton className={cn("h-4 w-64 max-w-[50%]", bar)} />
            <Skeleton className={cn("ml-auto hidden h-4 w-24 md:block", bar)} />
            <Skeleton className={cn("hidden h-4 w-12 md:block", bar)} />
            <Skeleton className={cn("h-6 w-20 rounded-md", bar)} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ContentTabSkeleton() {
  return (
    <div aria-busy="true" className="flex min-w-0 flex-col gap-4">
      <span className="sr-only" role="status">
        Carregando o conteúdo do produto
      </span>
      <Skeleton aria-hidden="true" className={cn("h-5 w-64 max-w-full", bar, adminDelayedReveal)} />
      <div className="flex flex-col gap-3">
        <ModuleSkeleton lessons={4} />
        <ModuleSkeleton lessons={3} />
      </div>
    </div>
  );
}

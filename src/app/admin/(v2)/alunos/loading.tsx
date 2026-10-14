import { Skeleton } from "@/components/ui/skeleton";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeaderSkeleton } from "@/components/admin/v2/skeletons";
import { adminCard, adminDelayedReveal } from "@/components/admin/v2/styles";
import { cn } from "@/lib/utils";

// Esqueleto da lista de alunos: cabecalho, linha de filtros e 6 linhas de tabela.
export default function AdminStudentsLoading() {
  return (
    <AdminPage className={cn("gap-6", adminDelayedReveal)}>
      <PageHeaderSkeleton />
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton className="h-[34px] w-24 rounded-full bg-[var(--surface-2)] motion-reduce:animate-none" key={index} />
          ))}
        </div>
        <div className={cn(adminCard, "overflow-hidden")}>
          {Array.from({ length: 6 }, (_, index) => (
            <div className="flex h-12 items-center gap-3 border-b border-[var(--border-subtle)] px-4 last:border-b-0" key={index}>
              <Skeleton className="size-7 rounded-full bg-[var(--surface-2)] motion-reduce:animate-none" />
              <Skeleton className="h-4 w-40 bg-[var(--surface-2)] motion-reduce:animate-none" />
              <Skeleton className="ml-auto h-4 w-24 bg-[var(--surface-2)] motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      </div>
    </AdminPage>
  );
}

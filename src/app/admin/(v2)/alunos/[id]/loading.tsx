import { Skeleton } from "@/components/ui/skeleton";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeaderSkeleton } from "@/components/admin/v2/skeletons";
import { adminCard, adminDelayedReveal } from "@/components/admin/v2/styles";
import { cn } from "@/lib/utils";

export default function StudentLoading() {
  return (
    <AdminPage className={cn("gap-6", adminDelayedReveal)}>
      <PageHeaderSkeleton />
      <div className={cn(adminCard, "grid grid-cols-2 gap-px md:grid-cols-4")}>
        {Array.from({ length: 4 }, (_, index) => (
          <div className="flex flex-col gap-2 px-4 py-3" key={index}>
            <Skeleton className="h-3 w-16 bg-[var(--surface-2)] motion-reduce:animate-none" />
            <Skeleton className="h-5 w-24 bg-[var(--surface-2)] motion-reduce:animate-none" />
          </div>
        ))}
      </div>
      <Skeleton className="h-9 w-72 max-w-full bg-[var(--surface-2)] motion-reduce:animate-none" />
      <Skeleton className="h-48 w-full bg-[var(--surface-2)] motion-reduce:animate-none" />
    </AdminPage>
  );
}

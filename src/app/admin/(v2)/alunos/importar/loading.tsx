import { Skeleton } from "@/components/ui/skeleton";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeaderSkeleton } from "@/components/admin/v2/skeletons";
import { adminDelayedReveal } from "@/components/admin/v2/styles";
import { cn } from "@/lib/utils";

export default function ImportStudentsLoading() {
  return (
    <AdminPage className={cn("gap-6", adminDelayedReveal)}>
      <PageHeaderSkeleton />
      <Skeleton className="h-28 w-full max-w-[880px] bg-[var(--surface-2)] motion-reduce:animate-none" />
    </AdminPage>
  );
}

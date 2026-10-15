import { Skeleton } from "@/components/ui/skeleton";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeaderSkeleton } from "@/components/admin/v2/skeletons";
import { adminDelayedReveal } from "@/components/admin/v2/styles";
import { cn } from "@/lib/utils";

export default function NewStudentLoading() {
  return (
    <AdminPage className={cn("gap-6", adminDelayedReveal)}>
      <PageHeaderSkeleton />
      <div className="flex w-full max-w-[640px] flex-col gap-4">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton className="h-10 w-full bg-[var(--surface-2)] motion-reduce:animate-none" key={index} />
        ))}
        <Skeleton className="h-48 w-full bg-[var(--surface-2)] motion-reduce:animate-none" />
      </div>
    </AdminPage>
  );
}

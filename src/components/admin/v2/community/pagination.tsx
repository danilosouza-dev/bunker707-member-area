import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { communityHref, describePageRange, type SearchParamsRecord } from "./hrefs";

// Paginacao no servidor (?pagina=), com o mesmo filtro no endereco. "1–20 de 54" e anterior/proxima.

type CommunityPaginationProps = {
  itemLabel: string;
  page: number;
  pageSize: number;
  pathname: string;
  searchParams: SearchParamsRecord;
  total: number;
};

const linkClass = cn(
  buttonVariants({ variant: "ghost" }),
  "gap-1 px-3 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]"
);

export function CommunityPagination({ itemLabel, page, pageSize, pathname, searchParams, total }: CommunityPaginationProps) {
  const range = describePageRange(page, pageSize, total);

  if (total <= pageSize && page <= 1) {
    return null;
  }

  return (
    <nav aria-label={`Páginas de ${itemLabel}`} className="flex min-w-0 items-center justify-between gap-3">
      <p className="text-[13px] leading-5 text-[var(--text-secondary)] tabular-nums">
        {range.label} {itemLabel}
      </p>
      <div className="flex items-center gap-1">
        {range.hasPrevious ? (
          <Link
            className={linkClass}
            data-navigation-feedback="false"
            data-slot="button"
            href={communityHref(pathname, searchParams, { pagina: range.page - 1 })}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            Anterior
          </Link>
        ) : (
          <span aria-disabled="true" className={cn(linkClass, "pointer-events-none opacity-40")} data-slot="button">
            <ChevronLeft aria-hidden="true" className="size-4" />
            Anterior
          </span>
        )}
        {range.hasNext ? (
          <Link
            className={linkClass}
            data-navigation-feedback="false"
            data-slot="button"
            href={communityHref(pathname, searchParams, { pagina: range.page + 1 })}
          >
            Próxima
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        ) : (
          <span aria-disabled="true" className={cn(linkClass, "pointer-events-none opacity-40")} data-slot="button">
            Próxima
            <ChevronRight aria-hidden="true" className="size-4" />
          </span>
        )}
      </div>
    </nav>
  );
}

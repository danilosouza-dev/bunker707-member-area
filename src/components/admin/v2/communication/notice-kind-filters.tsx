"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { CampaignKind } from "@/server/communications/campaign-model";
import { adminPillClasses } from "../form";
import { NOTICE_KIND_FILTERS, noticesFilterHref } from "./notices-view-model";

// Filtro Todos · Notificações · Pop-ups da lista de avisos: links (?tipo=), com o periodo da barra
// superior junto. Cliente porque a pilula do admin (adminPillClasses) vem do kit de formularios.

type NoticeKindFiltersProps = {
  kind: CampaignKind | undefined;
  searchParams: Record<string, string | string[] | undefined>;
};

export function NoticeKindFilters({ kind, searchParams }: NoticeKindFiltersProps) {
  return (
    <nav aria-label="Tipo de aviso" className="flex min-w-0 flex-wrap gap-2">
      {NOTICE_KIND_FILTERS.map((filter) => {
        const active = filter.kind === kind;

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(adminPillClasses(active), "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]")}
            data-navigation-feedback="false"
            href={noticesFilterHref(searchParams, filter.kind)}
            key={filter.label}
            scroll={false}
          >
            {filter.label}
          </Link>
        );
      })}
    </nav>
  );
}

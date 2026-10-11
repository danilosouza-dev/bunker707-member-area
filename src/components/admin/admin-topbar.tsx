"use client";

import { getAdminNavLabel } from "@/components/admin/admin-nav";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { AdminView } from "@/lib/platform-types";

export function AdminTopbar({ activeView }: { activeView: AdminView }) {
  const activeLabel = getAdminNavLabel(activeView);

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="-ml-1" />
      <Separator className="h-5" orientation="vertical" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-muted-foreground">Admin Bunker707</p>
        <h1 className="truncate text-sm font-semibold text-foreground">{activeLabel}</h1>
      </div>
    </header>
  );
}

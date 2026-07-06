"use client";

import { Activity, ShieldCheck } from "lucide-react";
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
        <p className="truncate text-xs font-medium text-muted-foreground">CRM Bunker707</p>
        <h1 className="truncate text-sm font-semibold text-foreground">{activeLabel}</h1>
      </div>

      <div className="hidden items-center gap-2 md:flex">
        <div className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-muted/25 px-3 text-xs font-medium text-muted-foreground">
          <ShieldCheck className="size-3.5 text-primary" />
          RBAC ativo
        </div>
        <div className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-muted/25 px-3 text-xs font-medium text-muted-foreground">
          <Activity className="size-3.5 text-[color:var(--chart-2)]" />
          Entitlements como fonte de verdade
        </div>
      </div>
    </header>
  );
}

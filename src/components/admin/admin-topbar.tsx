"use client";

import { Search, UserPlus } from "lucide-react";
import Link from "next/link";
import { adminMainNavItems } from "@/components/admin/admin-nav";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { AdminView } from "@/lib/platform-types";

export function AdminTopbar({ activeView }: { activeView: AdminView }) {
  const activeLabel = adminMainNavItems.find((item) => item.id === activeView)?.label ?? "CRM Admin";

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="-ml-1" />
      <Separator className="h-5" orientation="vertical" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-muted-foreground">CRM Bunker707</p>
        <h1 className="truncate text-sm font-semibold text-foreground">{activeLabel}</h1>
      </div>

      <div
        aria-hidden="true"
        className="hidden h-8 min-w-56 items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 text-sm text-muted-foreground md:flex"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">Buscar no CRM</span>
      </div>

      <Button render={<Link href="/" />} nativeButton={false} size="sm" variant="outline">
        Ver area do aluno
      </Button>
      <Button className="hidden sm:inline-flex" size="sm">
        <UserPlus data-icon="inline-start" />
        Novo aluno
      </Button>
    </header>
  );
}

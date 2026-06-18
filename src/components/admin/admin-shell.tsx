"use client";

import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminTopbar } from "@/components/admin/admin-topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import type { AdminView } from "@/lib/platform-types";
import type { ReactNode } from "react";

export function AdminShell({
  activeView,
  children,
  onChangeView
}: {
  activeView: AdminView;
  children: ReactNode;
  onChangeView: (view: AdminView) => void;
}) {
  return (
    <SidebarProvider defaultOpen={false}>
      <AdminSidebar activeView={activeView} onChangeView={onChangeView} />
      <SidebarInset className="min-h-screen bg-background">
        <AdminTopbar activeView={activeView} />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

"use client";

import Link from "next/link";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail
} from "@/components/ui/sidebar";
import { adminMainNavItems, adminOperationNavItems, adminSettingsNavGroup } from "@/components/admin/admin-nav";
import type { AdminView } from "@/lib/platform-types";

export function AdminSidebar({
  activeView,
  onChangeView
}: {
  activeView: AdminView;
  onChangeView: (view: AdminView) => void;
}) {
  const SettingsIcon = adminSettingsNavGroup.icon;

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="Admin Bunker707">
              <span className="grid aspect-square size-8 place-items-center rounded-[8px] bg-sidebar-primary text-sm font-black text-sidebar-primary-foreground">
                B
              </span>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-black">Admin Bunker707</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Principal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminMainNavItems.map((item) => {
                const Icon = item.icon;

                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={activeView === item.id}
                      onClick={() => onChangeView(item.id)}
                      tooltip={item.label}
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Sistema</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton className="cursor-default hover:bg-transparent" tooltip={adminSettingsNavGroup.label}>
                  <SettingsIcon />
                  <span>{adminSettingsNavGroup.label}</span>
                </SidebarMenuButton>
                <SidebarMenuSub>
                  {adminSettingsNavGroup.children.map((item) => {
                    const Icon = item.icon;

                    return (
                      <SidebarMenuSubItem key={item.id}>
                        <SidebarMenuSubButton
                          isActive={activeView === item.id}
                          onClick={() => onChangeView(item.id)}
                          render={<button type="button" />}
                        >
                          <Icon />
                          <span>{item.label}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    );
                  })}
                </SidebarMenuSub>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Operacao</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminOperationNavItems.map((item) => {
                const Icon = item.icon;

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton render={<Link href={item.href} />} tooltip={item.label}>
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}

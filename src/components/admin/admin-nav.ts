import {
  Bot,
  Boxes,
  GalleryVerticalEnd,
  Home,
  LayoutDashboard,
  LibraryBig,
  MessageSquareWarning,
  Pencil,
  PlugZap,
  Settings,
  UsersRound,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AdminView } from "@/lib/platform-types";

export type AdminNavItem = {
  icon: LucideIcon;
  id: AdminView;
  label: string;
};

export type AdminNavGroup = {
  children: AdminNavItem[];
  icon: LucideIcon;
  label: string;
};

export type AdminExternalNavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
};

export const adminMainNavItems = [
  { icon: LayoutDashboard, id: "overview", label: "Visao geral" },
  { icon: Users, id: "students", label: "Alunos" },
  { icon: LibraryBig, id: "catalog", label: "Produtos" },
  { icon: Boxes, id: "combos", label: "Combos" },
  { icon: GalleryVerticalEnd, id: "structure", label: "Estrutura" },
  { icon: UsersRound, id: "community", label: "Comunidade" },
  { icon: MessageSquareWarning, id: "moderation", label: "Moderacao" },
  { icon: Bot, id: "ai-agents", label: "Agentes de IA" },
  { icon: Pencil, id: "personalization", label: "Personalizacao" }
] satisfies AdminNavItem[];

export const adminSettingsNavGroup = {
  children: [
    { icon: PlugZap, id: "integrations", label: "Integracoes" }
  ],
  icon: Settings,
  label: "Configuracoes"
} satisfies AdminNavGroup;

export function getAdminNavLabel(view: AdminView) {
  return (
    adminMainNavItems.find((item) => item.id === view)?.label ??
    adminSettingsNavGroup.children.find((item) => item.id === view)?.label ??
    "CRM Admin"
  );
}

export const adminOperationNavItems = [
  { href: "/", icon: Home, label: "Area do aluno" }
] satisfies AdminExternalNavItem[];

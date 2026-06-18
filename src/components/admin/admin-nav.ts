import {
  GalleryVerticalEnd,
  Home,
  LayoutDashboard,
  LibraryBig,
  Pencil,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AdminView } from "@/lib/platform-types";

export type AdminNavItem = {
  icon: LucideIcon;
  id: AdminView;
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
  { icon: LibraryBig, id: "catalog", label: "Catalogo" },
  { icon: GalleryVerticalEnd, id: "structure", label: "Estrutura" },
  { icon: Pencil, id: "personalization", label: "Personalizacao" }
] satisfies AdminNavItem[];

export const adminOperationNavItems = [
  { href: "/", icon: Home, label: "Ver area do aluno" }
] satisfies AdminExternalNavItem[];

"use client";

import { Dialog } from "@base-ui/react/dialog";
import {
  Box,
  ChevronRight,
  Eye,
  LayoutDashboard,
  LayoutTemplate,
  Megaphone,
  MessageCircle,
  SlidersHorizontal,
  Users,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AccountMenu, type AdminAccount } from "./account-menu";
import { AdminTopbar } from "./admin-topbar";
import { ADMIN_PERIOD_PARAM, type AdminFilterProduct } from "./filters";
import {
  ADMIN_HOME_HREF,
  ADMIN_SIDEBAR_COOKIE,
  STUDENT_AREA_HREF,
  adminNavItems,
  buildAdminNavHref,
  formatAdminNavCount,
  getActiveAdminNavChild,
  isAdminNavSectionActive,
  normalizeAdminPath,
  type AdminNavCounts,
  type AdminNavId,
  type AdminNavItem
} from "./nav";
import { AdminToaster } from "./toast";
import { adminTransition } from "./styles";
import { AdminTopbarTitleProvider } from "./topbar-title";

// Moldura do Admin Bunker707 na forma do prototipo aprovado: barra lateral de 240 px a partir de 768 px
// (o produtor pode recolher para 64 px, so com icones, e expandir de novo pelo botao da barra superior;
// a escolha fica no cookie ADMIN_SIDEBAR_COOKIE), barra superior de 56 px e a area principal. Abaixo de 768 px a barra lateral vira
// uma gaveta de min(280 px, 86 % da tela) sobre veu escuro, sem botao X (fecha no veu, no Esc ou ao
// navegar).

const SIDEBAR_ID = "admin-sidebar";
const emptyCounts: AdminNavCounts = {};

/** Icone de cada area (os do prototipo). Fica aqui para que nav.ts continue puro (sem React). */
const navIcons: Record<AdminNavId, LucideIcon> = {
  alunos: Users,
  comunicacao: Megaphone,
  comunidade: MessageCircle,
  configuracoes: SlidersHorizontal,
  hoje: LayoutDashboard,
  membros: LayoutTemplate,
  produtos: Box
};

const navItemBase = cn(
  "relative flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm leading-5 font-medium whitespace-nowrap outline-offset-[-2px]",
  adminTransition
);
const navItemIdle = "text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]";
const navItemActive =
  "bg-[var(--surface-2)] text-[var(--text-primary)] before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-[var(--text-primary)]";
const navIconClass = "size-4 shrink-0";
const navItemCollapsed = "justify-center px-0";

function NavCount({ label }: { label: string }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="ml-auto inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-3)] px-1.5 text-xs leading-none font-semibold text-[var(--text-primary)] tabular-nums"
      >
        {label}
      </span>
      <span className="sr-only">{` (${label} pendentes)`}</span>
    </>
  );
}

/** Barra recolhida: um ponto sobre o icone no lugar da pilula; o numero vai para o leitor de tela. */
function NavCountDot({ label }: { label: string }) {
  return (
    <>
      <span aria-hidden="true" className="absolute top-1.5 right-2.5 size-2 rounded-full bg-[var(--text-primary)]" />
      <span className="sr-only">{` (${label} pendentes)`}</span>
    </>
  );
}

type SidebarContentsProps = {
  account: AdminAccount;
  /** So na barra fixa do computador: recolhida mostra so os icones (o nome vai no title e para leitor de tela). */
  collapsed?: boolean;
  counts: AdminNavCounts;
  idPrefix: string;
  isGroupOpen: (item: AdminNavItem, sectionActive: boolean) => boolean;
  onNavigate?: () => void;
  onToggleGroup: (item: AdminNavItem, sectionActive: boolean) => void;
  pathname: string;
  periodParam: string | null;
};

function SidebarContents({
  account,
  collapsed = false,
  counts,
  idPrefix,
  isGroupOpen,
  onNavigate,
  onToggleGroup,
  pathname,
  periodParam
}: SidebarContentsProps) {
  const path = normalizeAdminPath(pathname);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Link
        className={cn(
          "flex h-14 shrink-0 items-center gap-2.5 border-b border-[var(--border-subtle)] px-5 outline-offset-[-2px]",
          collapsed && "justify-center px-0"
        )}
        data-navigation-feedback="false"
        href={buildAdminNavHref(ADMIN_HOME_HREF, periodParam)}
        onClick={onNavigate}
        title={collapsed ? "Bunker707 · Admin" : undefined}
      >
        <span aria-hidden="true" className="size-3 shrink-0 rounded-[3px] bg-[var(--brand-red)]" />
        <span className={cn("text-[15px] leading-5 font-semibold tracking-[-0.01em] text-[var(--text-primary)]", collapsed && "sr-only")}>Bunker707</span>
        {collapsed ? null : <span className="ml-auto text-xs leading-4 font-medium text-[var(--text-tertiary)]">Admin</span>}
      </Link>

      <nav aria-label="Áreas do admin" className={cn("min-h-0 flex-1 overflow-x-hidden overflow-y-auto", collapsed ? "p-2" : "p-3")}>
        <ul className="flex flex-col gap-0.5">
          {adminNavItems.map((item) => {
            const Icon = navIcons[item.id];
            const sectionActive = isAdminNavSectionActive(path, item);
            const countLabel = formatAdminNavCount(counts[item.id]);

            if (!item.children?.length) {
              return (
                <li key={item.id}>
                  <Link
                    aria-current={sectionActive ? (path === item.href ? "page" : "true") : undefined}
                    className={cn(navItemBase, sectionActive ? navItemActive : navItemIdle, collapsed && navItemCollapsed)}
                    data-navigation-feedback="false"
                    href={buildAdminNavHref(item.href, periodParam)}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon aria-hidden="true" className={navIconClass} strokeWidth={1.75} />
                    <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
                    {countLabel ? collapsed ? <NavCountDot label={countLabel} /> : <NavCount label={countLabel} /> : null}
                  </Link>
                </li>
              );
            }

            if (collapsed) {
              // Recolhida nao tem submenu: o icone leva direto para a primeira tela da area.
              return (
                <li key={item.id}>
                  <Link
                    aria-current={sectionActive ? "true" : undefined}
                    className={cn(navItemBase, sectionActive ? navItemActive : navItemIdle, navItemCollapsed)}
                    data-navigation-feedback="false"
                    href={buildAdminNavHref(item.href, periodParam)}
                    onClick={onNavigate}
                    title={item.label}
                  >
                    <Icon aria-hidden="true" className={navIconClass} strokeWidth={1.75} />
                    <span className="sr-only">{item.label}</span>
                    {countLabel ? <NavCountDot label={countLabel} /> : null}
                  </Link>
                </li>
              );
            }

            const groupOpen = isGroupOpen(item, sectionActive);
            const groupId = `${idPrefix}-nav-${item.id}`;
            const activeChild = getActiveAdminNavChild(path, item);

            return (
              <li key={item.id}>
                <button
                  aria-controls={groupId}
                  aria-expanded={groupOpen}
                  className={cn(
                    navItemBase,
                    sectionActive ? "text-[var(--text-primary)] hover:bg-[var(--hover-overlay)]" : navItemIdle
                  )}
                  data-nav-group={item.id}
                  onClick={() => onToggleGroup(item, sectionActive)}
                  type="button"
                >
                  <Icon aria-hidden="true" className={navIconClass} strokeWidth={1.75} />
                  <span className="truncate">{item.label}</span>
                  {countLabel ? <NavCount label={countLabel} /> : null}
                  <ChevronRight
                    aria-hidden="true"
                    className={cn(
                      "size-4 shrink-0 text-[var(--text-tertiary)] transition-transform duration-150 ease-[var(--ease-admin)] motion-reduce:transition-none",
                      countLabel ? "ml-1" : "ml-auto",
                      groupOpen && "rotate-90"
                    )}
                  />
                </button>

                <ul className={cn("mt-0.5 mb-1 flex-col gap-0.5 pl-[26px]", groupOpen ? "flex" : "hidden")} id={groupId}>
                  {item.children.map((child) => {
                    const childActive = activeChild?.href === child.href;

                    return (
                      <li key={child.href}>
                        <Link
                          aria-current={childActive ? (path === child.href ? "page" : "true") : undefined}
                          className={cn(navItemBase, "min-h-8 text-[13px]", childActive ? navItemActive : navItemIdle)}
                          data-navigation-feedback="false"
                          href={buildAdminNavHref(child.href, periodParam)}
                          onClick={onNavigate}
                        >
                          <span className="truncate">{child.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className={cn("flex shrink-0 flex-col gap-1 border-t border-[var(--border-subtle)]", collapsed ? "p-2" : "p-3")}>
        <Link
          className={cn(navItemBase, navItemIdle, collapsed && navItemCollapsed)}
          href={STUDENT_AREA_HREF}
          onClick={onNavigate}
          title={collapsed ? "Ver área do aluno" : undefined}
        >
          <Eye aria-hidden="true" className={navIconClass} strokeWidth={1.75} />
          <span className={collapsed ? "sr-only" : "truncate"}>Ver área do aluno</span>
        </Link>
        <AccountMenu account={account} compact={collapsed} />
      </div>
    </div>
  );
}

/** Le ?periodo= para os links do menu (fica em Suspense: useSearchParams). */
function SidebarWithPeriod(props: Omit<SidebarContentsProps, "periodParam">) {
  const searchParams = useSearchParams();

  return <SidebarContents {...props} periodParam={searchParams.get(ADMIN_PERIOD_PARAM)} />;
}

function Sidebar(props: Omit<SidebarContentsProps, "periodParam">) {
  return (
    <Suspense fallback={<SidebarContents {...props} periodParam={null} />}>
      <SidebarWithPeriod {...props} />
    </Suspense>
  );
}

type AdminShellV2Props = {
  account: AdminAccount;
  children: ReactNode;
  /** Contadores do menu (pilula ao lado do rotulo): Hoje e Comunidade. Zero ou ausente nao aparece. */
  counts?: AdminNavCounts;
  /** Barra lateral recolhida ao abrir a pagina (cookie lido no servidor). */
  initialCollapsed?: boolean;
  /** Opcoes do filtro Produto da barra superior. */
  products?: readonly AdminFilterProduct[];
};

/** Moldura do Admin Bunker707: barra lateral, barra superior e area principal. */
export function AdminShellV2({ account, children, counts = emptyCounts, initialCollapsed = false, products = [] }: AdminShellV2Props) {
  const pathname = usePathname() ?? ADMIN_HOME_HREF;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      document.cookie = `${ADMIN_SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>({});

  function isGroupOpen(item: AdminNavItem, sectionActive: boolean) {
    return groupOverrides[item.id] ?? sectionActive;
  }

  function toggleGroup(item: AdminNavItem, sectionActive: boolean) {
    setGroupOverrides((current) => ({ ...current, [item.id]: !(current[item.id] ?? sectionActive) }));
  }

  const sharedProps = { account, counts, isGroupOpen, onToggleGroup: toggleGroup, pathname };

  return (
    <AdminTopbarTitleProvider>
      <div className="min-h-dvh bg-[var(--surface-0)] font-sans text-[var(--text-primary)]" data-scope="admin">
        <a
          className="sr-only rounded-lg bg-[var(--text-primary)] px-4 py-2 text-sm font-medium text-[var(--surface-0)] focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
          href="#admin-main"
        >
          Pular para o conteúdo
        </a>

        <aside
          aria-label="Menu do admin"
          className={cn(
            "fixed inset-y-0 left-0 z-40 hidden border-r border-[var(--border-subtle)] bg-[var(--surface-0)] transition-[width] duration-200 ease-[var(--ease-admin)] motion-reduce:transition-none md:block",
            collapsed ? "w-16" : "w-60"
          )}
          data-collapsed={collapsed || undefined}
          id={SIDEBAR_ID}
        >
          <Sidebar {...sharedProps} collapsed={collapsed} idPrefix="sidebar" />
        </aside>

        <Dialog.Root onOpenChange={setDrawerOpen} open={drawerOpen}>
          <Dialog.Portal>
            <Dialog.Backdrop
              className={cn(
                "fixed inset-0 z-50 bg-black/60 md:hidden",
                "transition-opacity duration-200 ease-[var(--ease-admin)] data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none"
              )}
            />
            <Dialog.Popup
              aria-label="Menu do admin"
              className={cn(
                "fixed inset-y-0 left-0 z-50 w-[min(280px,86vw)] bg-[var(--surface-1)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-[var(--text-primary)] shadow-[24px_0_48px_rgba(0,0,0,0.4)] outline-none md:hidden",
                "transition-transform duration-200 ease-[var(--ease-admin)] data-ending-style:-translate-x-full data-starting-style:-translate-x-full motion-reduce:transition-none"
              )}
            >
              <Dialog.Title className="sr-only">Menu do admin</Dialog.Title>
              <Sidebar {...sharedProps} idPrefix="drawer" onNavigate={() => setDrawerOpen(false)} />
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>

        <div
          className={cn(
            "flex min-h-dvh min-w-0 flex-col transition-[padding] duration-200 ease-[var(--ease-admin)] motion-reduce:transition-none",
            collapsed ? "md:pl-16" : "md:pl-60"
          )}
        >
          <AdminTopbar
            drawerOpen={drawerOpen}
            onOpenDrawer={() => setDrawerOpen(true)}
            onToggleSidebar={toggleCollapsed}
            products={products}
            sidebarCollapsed={collapsed}
            sidebarId={SIDEBAR_ID}
          />
          <main className="min-w-0 flex-1 outline-none" id="admin-main" tabIndex={-1}>
            {children}
          </main>
        </div>
        <AdminToaster />
      </div>
    </AdminTopbarTitleProvider>
  );
}

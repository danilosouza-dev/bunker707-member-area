"use client";

import { Dialog } from "@base-ui/react/dialog";
import {
  Box,
  ChevronRight,
  Eye,
  History,
  LayoutDashboard,
  LayoutTemplate,
  Megaphone,
  Menu,
  MessageCircle,
  SlidersHorizontal,
  Users,
  type LucideIcon
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { AdminAccount } from "./account-menu";
import { AdminTopbar } from "./admin-topbar";
import { ADMIN_PERIOD_PARAM, type AdminFilterProduct } from "./filters";
import {
  ADMIN_HOME_HREF,
  ADMIN_LEGACY_HREF,
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

// Moldura do Admin Bunker707 (pedido do produtor, 13/10/2026, referencia "sidebar do YouTube", sempre
// escura). A partir de 768 px fica fixo um trilho de 72 px so com icones e o simbolo da marca; o
// hamburguer do trilho abre o menu completo (logo inteira, rotulos e subitens) POR CIMA da pagina, com
// veu escuro, sem empurrar o conteudo. Abaixo de 768 px nao ha trilho: o hamburguer da barra superior
// abre o mesmo menu. Fecha no veu, no Esc, no hamburguer do menu ou ao navegar. A conta, a busca e os
// avisos ficam na barra superior.

const MENU_ID = "admin-menu";
const emptyCounts: AdminNavCounts = {};
const LOGO_SRC = "/brand/logo-bunker.svg";
const SYMBOL_SRC = "/brand/icon-bunker.png";

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

/** Divisoria depois destas areas: acompanhar (Visão geral, Alunos, Produtos), falar com o aluno, ajustar. */
const dividerAfter = new Set<AdminNavId>(["produtos", "comunidade"]);

const hamburgerClass = cn(
  "grid size-10 shrink-0 place-items-center rounded-full text-[var(--text-primary)] hover:bg-[var(--hover-overlay)]",
  adminTransition
);

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

/** Trilho: um ponto sobre o icone no lugar da pilula; o numero vai para o leitor de tela. */
function NavCountDot({ label }: { label: string }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="absolute top-2 right-2.5 size-2 rounded-full bg-[var(--text-primary)] ring-2 ring-[var(--surface-0)]"
      />
      <span className="sr-only">{` (${label} pendentes)`}</span>
    </>
  );
}

function Divider() {
  return <li aria-hidden="true" className="my-2 h-px shrink-0 bg-[var(--border-subtle)]" role="presentation" />;
}

/* ------------------------------------------------------------------------------------------------
 * Trilho fixo (computador): so icones, nome no title e no leitor de tela
 * ---------------------------------------------------------------------------------------------- */

const railItem = cn(
  "relative mx-auto grid size-12 place-items-center rounded-xl outline-offset-[-2px]",
  adminTransition
);
const railItemIdle = "text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]";
const railItemActive = "bg-[var(--surface-2)] text-[var(--text-primary)]";

type RailProps = {
  counts: AdminNavCounts;
  menuOpen: boolean;
  onOpenMenu: () => void;
  pathname: string;
  periodParam: string | null;
};

function RailContents({ counts, menuOpen, onOpenMenu, pathname, periodParam }: RailProps) {
  const path = normalizeAdminPath(pathname);

  return (
    <div className="flex h-full min-h-0 flex-col items-center">
      <div className="flex h-14 w-full shrink-0 items-center justify-center border-b border-[var(--border-subtle)]">
        <button
          aria-controls={MENU_ID}
          aria-expanded={menuOpen}
          aria-label="Abrir menu"
          className={hamburgerClass}
          onClick={onOpenMenu}
          title="Abrir menu"
          type="button"
        >
          <Menu aria-hidden="true" className="size-5" strokeWidth={1.75} />
        </button>
      </div>

      <Link
        className="mt-3 grid size-12 shrink-0 place-items-center rounded-xl outline-offset-[-2px] hover:bg-[var(--hover-overlay)]"
        data-navigation-feedback="false"
        href={buildAdminNavHref(ADMIN_HOME_HREF, periodParam)}
        title="Bunker707 · Visão geral"
      >
        <Image alt="Bunker707" className="size-7" height={35} priority src={SYMBOL_SRC} unoptimized width={35} />
      </Link>

      <nav aria-label="Áreas do admin" className="mt-1 min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto px-3 py-2">
        <ul className="flex flex-col gap-1">
          {adminNavItems.map((item) => {
            const Icon = navIcons[item.id];
            const sectionActive = isAdminNavSectionActive(path, item);
            const countLabel = formatAdminNavCount(counts[item.id]);

            return (
              <Fragment key={item.id}>
                <li>
                  {/* Sem submenu no trilho: o icone leva direto para a primeira tela da area. */}
                  <Link
                    aria-current={sectionActive ? (path === item.href ? "page" : "true") : undefined}
                    className={cn(railItem, sectionActive ? railItemActive : railItemIdle)}
                    data-navigation-feedback="false"
                    href={buildAdminNavHref(item.href, periodParam)}
                    title={item.label}
                  >
                    <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
                    <span className="sr-only">{item.label}</span>
                    {countLabel ? <NavCountDot label={countLabel} /> : null}
                  </Link>
                </li>
                {dividerAfter.has(item.id) ? <Divider /> : null}
              </Fragment>
            );
          })}
        </ul>
      </nav>

      <div className="flex w-full shrink-0 flex-col gap-1 border-t border-[var(--border-subtle)] px-3 py-3">
        <Link className={cn(railItem, railItemIdle)} href={STUDENT_AREA_HREF} title="Ver área do aluno">
          <Eye aria-hidden="true" className="size-5" strokeWidth={1.75} />
          <span className="sr-only">Ver área do aluno</span>
        </Link>
        <Link className={cn(railItem, railItemIdle)} href={ADMIN_LEGACY_HREF} title="Admin antigo">
          <History aria-hidden="true" className="size-5" strokeWidth={1.75} />
          <span className="sr-only">Admin antigo</span>
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Menu completo (por cima da pagina, todas as larguras)
 * ---------------------------------------------------------------------------------------------- */

const menuItemBase = cn(
  "relative flex min-h-11 w-full items-center gap-4 rounded-xl px-3 text-left text-sm leading-5 whitespace-nowrap outline-offset-[-2px]",
  adminTransition
);
const menuItemIdle = "font-normal text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]";
const menuItemActive = "bg-[var(--surface-2)] font-semibold text-[var(--text-primary)]";
const menuIconClass = "size-5 shrink-0";

type MenuContentsProps = {
  counts: AdminNavCounts;
  isGroupOpen: (item: AdminNavItem, sectionActive: boolean) => boolean;
  onClose: () => void;
  onToggleGroup: (item: AdminNavItem, sectionActive: boolean) => void;
  pathname: string;
  periodParam: string | null;
};

function MenuContents({ counts, isGroupOpen, onClose, onToggleGroup, pathname, periodParam }: MenuContentsProps) {
  const path = normalizeAdminPath(pathname);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4">
        <button aria-controls={MENU_ID} aria-expanded="true" aria-label="Fechar menu" className={hamburgerClass} onClick={onClose} type="button">
          <Menu aria-hidden="true" className="size-5" strokeWidth={1.75} />
        </button>
        <Link
          className="flex min-w-0 items-center rounded-md outline-offset-2"
          data-navigation-feedback="false"
          href={buildAdminNavHref(ADMIN_HOME_HREF, periodParam)}
          onClick={onClose}
        >
          <Image alt="Bunker707" className="h-auto w-[148px]" height={35} src={LOGO_SRC} unoptimized width={306} />
          <span className="ml-2 self-end pb-px text-[11px] leading-4 font-medium tracking-[0.04em] text-[var(--text-tertiary)] uppercase">
            Admin
          </span>
        </Link>
      </div>

      <nav aria-label="Áreas do admin" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3">
        <ul className="flex flex-col gap-1">
          {adminNavItems.map((item) => {
            const Icon = navIcons[item.id];
            const sectionActive = isAdminNavSectionActive(path, item);
            const countLabel = formatAdminNavCount(counts[item.id]);
            const divider = dividerAfter.has(item.id) ? <Divider /> : null;

            if (!item.children?.length) {
              return (
                <Fragment key={item.id}>
                  <li>
                    <Link
                      aria-current={sectionActive ? (path === item.href ? "page" : "true") : undefined}
                      className={cn(menuItemBase, sectionActive ? menuItemActive : menuItemIdle)}
                      data-navigation-feedback="false"
                      href={buildAdminNavHref(item.href, periodParam)}
                      onClick={onClose}
                    >
                      <Icon aria-hidden="true" className={menuIconClass} strokeWidth={1.75} />
                      <span className="truncate">{item.label}</span>
                      {countLabel ? <NavCount label={countLabel} /> : null}
                    </Link>
                  </li>
                  {divider}
                </Fragment>
              );
            }

            const groupOpen = isGroupOpen(item, sectionActive);
            const groupId = `${MENU_ID}-${item.id}`;
            const activeChild = getActiveAdminNavChild(path, item);

            return (
              <Fragment key={item.id}>
                <li>
                  <button
                    aria-controls={groupId}
                    aria-expanded={groupOpen}
                    className={cn(menuItemBase, sectionActive ? "font-semibold text-[var(--text-primary)] hover:bg-[var(--hover-overlay)]" : menuItemIdle)}
                    data-nav-group={item.id}
                    onClick={() => onToggleGroup(item, sectionActive)}
                    type="button"
                  >
                    <Icon aria-hidden="true" className={menuIconClass} strokeWidth={1.75} />
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

                  <ul className={cn("mt-1 mb-1 flex-col gap-0.5 pl-9", groupOpen ? "flex" : "hidden")} id={groupId}>
                    {item.children.map((child) => {
                      const childActive = activeChild?.href === child.href;

                      return (
                        <li key={child.href}>
                          <Link
                            aria-current={childActive ? (path === child.href ? "page" : "true") : undefined}
                            className={cn(menuItemBase, "min-h-9 text-[13px]", childActive ? menuItemActive : menuItemIdle)}
                            data-navigation-feedback="false"
                            href={buildAdminNavHref(child.href, periodParam)}
                            onClick={onClose}
                          >
                            <span className="truncate">{child.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </li>
                {divider}
              </Fragment>
            );
          })}
        </ul>
      </nav>

      <div className="flex shrink-0 flex-col gap-1 border-t border-[var(--border-subtle)] px-3 py-3">
        <Link className={cn(menuItemBase, menuItemIdle)} href={STUDENT_AREA_HREF} onClick={onClose}>
          <Eye aria-hidden="true" className={menuIconClass} strokeWidth={1.75} />
          <span className="truncate">Ver área do aluno</span>
        </Link>
        <Link className={cn(menuItemBase, menuItemIdle)} href={ADMIN_LEGACY_HREF} onClick={onClose}>
          <History aria-hidden="true" className={menuIconClass} strokeWidth={1.75} />
          <span className="truncate">Admin antigo</span>
        </Link>
      </div>
    </div>
  );
}

/** Le ?periodo= para os links do menu (fica em Suspense: useSearchParams). */
function WithPeriod({ render }: { render: (periodParam: string | null) => ReactNode }) {
  const searchParams = useSearchParams();

  return render(searchParams.get(ADMIN_PERIOD_PARAM));
}

function PeriodAware({ render }: { render: (periodParam: string | null) => ReactNode }) {
  return (
    <Suspense fallback={render(null)}>
      <WithPeriod render={render} />
    </Suspense>
  );
}

type AdminShellV2Props = {
  account: AdminAccount;
  children: ReactNode;
  /** Contadores do menu (pilula ao lado do rotulo): Hoje e Comunidade. Zero ou ausente nao aparece. */
  counts?: AdminNavCounts;
  /** Opcoes do filtro Produto da barra superior. */
  products?: readonly AdminFilterProduct[];
};

/** Moldura do Admin Bunker707: trilho de icones, menu por cima, barra superior e area principal. */
export function AdminShellV2({ account, children, counts = emptyCounts, products = [] }: AdminShellV2Props) {
  const pathname = usePathname() ?? ADMIN_HOME_HREF;
  const [menuOpen, setMenuOpen] = useState(false);
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>({});

  function isGroupOpen(item: AdminNavItem, sectionActive: boolean) {
    return groupOverrides[item.id] ?? sectionActive;
  }

  function toggleGroup(item: AdminNavItem, sectionActive: boolean) {
    setGroupOverrides((current) => ({ ...current, [item.id]: !(current[item.id] ?? sectionActive) }));
  }

  const openMenu = () => setMenuOpen(true);
  const closeMenu = () => setMenuOpen(false);

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
          className="fixed inset-y-0 left-0 z-40 hidden w-[72px] border-r border-[var(--border-subtle)] bg-[var(--surface-0)] md:block"
        >
          <PeriodAware
            render={(periodParam) => (
              <RailContents counts={counts} menuOpen={menuOpen} onOpenMenu={openMenu} pathname={pathname} periodParam={periodParam} />
            )}
          />
        </aside>

        <Dialog.Root onOpenChange={setMenuOpen} open={menuOpen}>
          <Dialog.Portal>
            <Dialog.Backdrop
              className={cn(
                "fixed inset-0 z-50 bg-black/70",
                "transition-opacity duration-200 ease-[var(--ease-admin)] data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none"
              )}
            />
            <Dialog.Popup
              aria-label="Menu do admin"
              className={cn(
                "fixed inset-y-0 left-0 z-50 w-[min(280px,86vw)] border-r border-[var(--border-subtle)] bg-[var(--surface-0)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-[var(--text-primary)] shadow-[24px_0_48px_rgba(0,0,0,0.5)] outline-none",
                "transition-transform duration-200 ease-[var(--ease-admin)] data-ending-style:-translate-x-full data-starting-style:-translate-x-full motion-reduce:transition-none"
              )}
              id={MENU_ID}
            >
              <Dialog.Title className="sr-only">Menu do admin</Dialog.Title>
              <PeriodAware
                render={(periodParam) => (
                  <MenuContents
                    counts={counts}
                    isGroupOpen={isGroupOpen}
                    onClose={closeMenu}
                    onToggleGroup={toggleGroup}
                    pathname={pathname}
                    periodParam={periodParam}
                  />
                )}
              />
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>

        <div className="flex min-h-dvh min-w-0 flex-col md:pl-[72px]">
          <AdminTopbar account={account} counts={counts} menuId={MENU_ID} menuOpen={menuOpen} onOpenMenu={openMenu} products={products} />
          <main className="min-w-0 flex-1 outline-none" id="admin-main" tabIndex={-1}>
            {children}
          </main>
        </div>
        <AdminToaster />
      </div>
    </AdminTopbarTitleProvider>
  );
}

"use client";

import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { cn } from "@/lib/utils";
import type { AdminAccess } from "@/server/auth/roles";
import type { AdminFilterProduct } from "./filters";
import { GlobalFilters, GlobalFiltersPlaceholder } from "./global-filters";
import { GlobalSearch } from "./global-search";
import { getAdminMobileTitle, getAdminTopbarScope } from "./nav";
import { adminTransition } from "./styles";
import { useAdminTopbarTitleOverride } from "./topbar-title";

type AdminTopbarProps = {
  access: AdminAccess;
  drawerOpen: boolean;
  onOpenDrawer: () => void;
  /** Recolhe ou expande a barra lateral do computador. */
  onToggleSidebar: () => void;
  products: readonly AdminFilterProduct[];
  sidebarCollapsed: boolean;
  sidebarId: string;
};

/**
 * Barra superior do prototipo aprovado, 56 px fixa, com o mesmo respiro lateral do conteudo:
 * busca (Cmd/Ctrl+K) a esquerda e, a direita, so os filtros que a tela usa (Periodo, Produto).
 * Sem migalha e sem avatar (a conta fica no rodape da barra lateral). No celular: hamburguer, titulo
 * da pagina e icones de 36 px (busca, periodo, produto).
 */
export function AdminTopbar({ access, drawerOpen, onOpenDrawer, onToggleSidebar, products, sidebarCollapsed, sidebarId }: AdminTopbarProps) {
  const pathname = usePathname();
  const scope = getAdminTopbarScope(pathname);
  const titleOverride = useAdminTopbarTitleOverride();
  const mobileTitle = titleOverride ?? getAdminMobileTitle(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 flex-nowrap items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-0)] px-[clamp(16px,3vw,32px)] max-md:gap-1 max-md:px-4">
      <button
        aria-controls={sidebarId}
        aria-expanded={drawerOpen}
        aria-label="Abrir menu"
        className={cn(
          "-ml-2 grid size-9 shrink-0 place-items-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--press-overlay)] hover:text-[var(--text-primary)] md:hidden",
          adminTransition
        )}
        onClick={onOpenDrawer}
        type="button"
      >
        <Menu aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </button>
      <button
        aria-controls={sidebarId}
        aria-expanded={!sidebarCollapsed}
        aria-label={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
        className={cn(
          "-ml-2 hidden size-9 shrink-0 place-items-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--press-overlay)] hover:text-[var(--text-primary)] md:grid",
          adminTransition
        )}
        onClick={onToggleSidebar}
        title={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
        type="button"
      >
        {sidebarCollapsed ? (
          <PanelLeftOpen aria-hidden="true" className="size-5" strokeWidth={1.75} />
        ) : (
          <PanelLeftClose aria-hidden="true" className="size-5" strokeWidth={1.75} />
        )}
      </button>
      <span
        aria-hidden="true"
        className="ml-1 min-w-0 flex-1 truncate text-[15px] leading-5 font-semibold tracking-[-0.01em] text-[var(--text-primary)] md:hidden"
      >
        {mobileTitle}
      </span>

      <GlobalSearch access={access} />

      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2 max-md:ml-0 max-md:gap-1">
        <Suspense fallback={<GlobalFiltersPlaceholder scope={scope} />}>
          <GlobalFilters products={products} scope={scope} />
        </Suspense>
      </div>
    </header>
  );
}

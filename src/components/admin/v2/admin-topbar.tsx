"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { cn } from "@/lib/utils";
import { AccountMenu, type AdminAccount } from "./account-menu";
import type { AdminFilterProduct } from "./filters";
import { GlobalFilters, GlobalFiltersPlaceholder } from "./global-filters";
import { GlobalSearch } from "./global-search";
import { getAdminMobileTitle, getAdminTopbarScope, type AdminNavCounts } from "./nav";
import { NotificationsMenu } from "./notifications-menu";
import { adminTransition } from "./styles";
import { useAdminTopbarTitleOverride } from "./topbar-title";

type AdminTopbarProps = {
  account: AdminAccount;
  counts: AdminNavCounts;
  menuId: string;
  menuOpen: boolean;
  /** Abre o menu completo por cima da pagina (no celular; no computador o hamburguer fica no trilho). */
  onOpenMenu: () => void;
  products: readonly AdminFilterProduct[];
};

/**
 * Barra superior, 56 px fixa, com o mesmo respiro lateral do conteudo: busca (Cmd/Ctrl+K) a esquerda
 * e, a direita, so os filtros que a tela usa (Periodo, Produto), os lembretes e a conta. Sem migalha.
 * No celular: hamburguer, titulo da pagina e icones de 36 px.
 */
export function AdminTopbar({ account, counts, menuId, menuOpen, onOpenMenu, products }: AdminTopbarProps) {
  const pathname = usePathname();
  const scope = getAdminTopbarScope(pathname);
  const titleOverride = useAdminTopbarTitleOverride();
  const mobileTitle = titleOverride ?? getAdminMobileTitle(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 flex-nowrap items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-0)] px-[clamp(16px,3vw,32px)] max-md:gap-1 max-md:px-4">
      <button
        aria-controls={menuId}
        aria-expanded={menuOpen}
        aria-label="Abrir menu"
        className={cn(
          "-ml-2 grid size-9 shrink-0 place-items-center rounded-full text-[var(--text-primary)] hover:bg-[var(--press-overlay)] md:hidden",
          adminTransition
        )}
        onClick={onOpenMenu}
        type="button"
      >
        <Menu aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </button>
      <span
        aria-hidden="true"
        className="ml-1 min-w-0 flex-1 truncate text-[15px] leading-5 font-semibold tracking-[-0.01em] text-[var(--text-primary)] md:hidden"
      >
        {mobileTitle}
      </span>

      <GlobalSearch />

      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2 max-md:ml-0 max-md:gap-1">
        <Suspense fallback={<GlobalFiltersPlaceholder scope={scope} />}>
          <GlobalFilters products={products} scope={scope} />
        </Suspense>
        {scope.period || scope.product ? <span aria-hidden="true" className="mx-1 h-6 w-px bg-[var(--border-subtle)] max-md:hidden" /> : null}
        <NotificationsMenu counts={counts} />
        <AccountMenu account={account} />
      </div>
    </header>
  );
}

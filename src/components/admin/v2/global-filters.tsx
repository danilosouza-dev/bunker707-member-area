"use client";

import { cn } from "@/lib/utils";
import type { AdminFilterProduct } from "./filters";
import type { AdminTopbarScope } from "./nav";
import { PeriodMenu } from "./period-menu";
import { ProductFilter } from "./product-filter";

// Filtros da barra superior (prototipo aprovado): so os que a tela usa (getAdminTopbarScope). Periodo
// (Hoje, 1d, 3d, 7d, 30d e calendario, em ?periodo=, modelo em period.ts com buildAdminPeriodHref e
// ADMIN_PERIOD_PRESET_OPTIONS) e Produto (?produto=). Cada troca entra no historico.

type GlobalFiltersProps = {
  products: readonly AdminFilterProduct[];
  scope: AdminTopbarScope;
};

export function GlobalFilters({ products, scope }: GlobalFiltersProps) {
  if (!scope.period && !scope.product) {
    return null;
  }

  return (
    <div className="flex shrink-0 items-center gap-2 max-md:gap-1">
      {scope.period ? <PeriodMenu /> : null}
      {scope.product ? <ProductFilter products={products} /> : null}
    </div>
  );
}

const placeholderControl =
  "h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] max-md:w-9 max-md:border-transparent max-md:bg-transparent";

/** Mesmo tamanho dos filtros, enquanto o endereco ainda nao foi lido no cliente. */
export function GlobalFiltersPlaceholder({ scope }: { scope: AdminTopbarScope }) {
  if (!scope.period && !scope.product) {
    return null;
  }

  return (
    <div aria-hidden="true" className="flex shrink-0 items-center gap-2 max-md:gap-1">
      {scope.period ? <span className={cn(placeholderControl, "w-[200px] max-lg:w-[96px]")} /> : null}
      {scope.product ? <span className={cn(placeholderControl, "w-[221px] max-lg:w-[88px]")} /> : null}
    </div>
  );
}

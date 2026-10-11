"use client";

import { Menu } from "@base-ui/react/menu";
import { Box, ChevronDown } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";
import { ADMIN_PRODUCT_PARAM, buildAdminProductFilterHref, parseAdminProduct, type AdminFilterProduct } from "./filters";
import { getInitials } from "./format";
import { adminMenuItem, adminMenuLabel, adminMenuPopup, adminMenuSeparator, adminTopbarControl } from "./styles";

// Filtro "Produto" da barra superior (prototipo aprovado): "Produto  Todos os produtos ▾". Com um produto
// escolhido, um ponto na cor dele. Valor no endereco (?produto=); a troca entra no historico e volta para
// a primeira pagina. Endereco com um produto fora da lista mostra "Produto selecionado".

const ALL_VALUE = "__todos__";
const UNKNOWN_PRODUCT_LABEL = "Produto selecionado";

export function ProductFilter({ className, products }: { className?: string; products: readonly AdminFilterProduct[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const productId = parseAdminProduct(searchParams.get(ADMIN_PRODUCT_PARAM));
  const known = productId ? products.find((entry) => entry.id === productId) : undefined;
  const selected = productId ? (known ?? { id: productId, label: UNKNOWN_PRODUCT_LABEL }) : null;
  const longText = selected ? selected.label : "Todos os produtos";
  const shortText = selected ? getInitials(selected.label) : "Todos";

  function choose(value: unknown) {
    const next = value === ALL_VALUE || typeof value !== "string" ? null : value;

    startTransition(() => {
      router.push(buildAdminProductFilterHref(pathname, searchParams, next), { scroll: false });
    });
  }

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        aria-busy={pending || undefined}
        aria-label={`Produto: ${longText}`}
        className={cn(adminTopbarControl, className)}
        title={selected ? selected.label : undefined}
      >
        <Box aria-hidden="true" className="hidden size-5 text-[var(--text-secondary)] max-md:block" strokeWidth={1.75} />
        <span aria-hidden="true" className="hidden text-[var(--text-tertiary)] min-[1440px]:inline">
          Produto
        </span>
        <span aria-hidden="true" className="inline-flex min-w-0 items-center gap-2 max-md:contents">
          {selected ? (
            <i
              className="size-2 shrink-0 rounded-[2px] max-md:absolute max-md:top-1.5 max-md:right-1.5 max-md:size-1.5 max-md:rounded-full max-md:shadow-[0_0_0_2px_var(--surface-0)]"
              style={{ background: known?.accent ?? "var(--text-tertiary)" }}
            />
          ) : null}
          <span className="hidden max-w-[180px] truncate lg:inline xl:max-w-[200px] min-[1440px]:max-w-[220px]">{longText}</span>
          <span className="hidden md:inline lg:hidden">{shortText}</span>
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-[var(--text-tertiary)] max-md:hidden" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" className="z-50 outline-none" collisionPadding={8} sideOffset={6}>
          <Menu.Popup className={cn(adminMenuPopup, "max-h-[min(420px,70vh)] w-64 overflow-y-auto")}>
            <Menu.Group>
              <Menu.GroupLabel className={adminMenuLabel}>Produto</Menu.GroupLabel>
              <Menu.RadioGroup onValueChange={choose} value={selected?.id ?? ALL_VALUE}>
                <ProductRadioItem label="Todos os produtos" value={ALL_VALUE} />
                {products.length > 0 || selected ? <Menu.Separator className={adminMenuSeparator} /> : null}
                {products.map((product) => (
                  <ProductRadioItem accent={product.accent ?? undefined} key={product.id} label={product.label} value={product.id} />
                ))}
                {selected && !known ? <ProductRadioItem label={UNKNOWN_PRODUCT_LABEL} value={selected.id} /> : null}
              </Menu.RadioGroup>
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function ProductRadioItem({ accent, label, value }: { accent?: string; label: string; value: string }) {
  return (
    <Menu.RadioItem className={cn(adminMenuItem, "group/radio")} closeOnClick value={value}>
      {accent ? <i aria-hidden="true" className="size-2 shrink-0 rounded-[2px]" style={{ background: accent }} /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-transparent group-data-checked/radio:bg-[var(--text-primary)]" />
    </Menu.RadioItem>
  );
}

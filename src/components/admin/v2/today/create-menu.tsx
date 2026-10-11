"use client";

import { ChevronDown, Plus } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { isAdminV2Href } from "../nav";
import type { TodayCreateItem } from "./today-model";

type CreateMenuProps = {
  items: readonly TodayCreateItem[];
};

const itemClass =
  "flex min-h-[34px] w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:bg-[var(--press-overlay)] data-highlighted:bg-[var(--press-overlay)] data-disabled:opacity-100 data-disabled:text-[var(--text-tertiary)]";

/**
 * Botao primario "Criar" do cabecalho do Hoje (prototipo: menu com rotulo "Criar" e os destinos).
 * So destinos que existem ficam ativos; Aviso, Webinário e Promoção aparecem desativados com "Em breve".
 */
export function CreateMenu({ items }: CreateMenuProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(buttonVariants({ variant: "default" }), "gap-2 px-3.5 font-semibold")} data-slot="button">
        <Plus aria-hidden="true" className="size-4" />
        Criar
        <ChevronDown aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-auto min-w-52 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1 text-[var(--text-primary)] shadow-[0_14px_36px_rgba(0,0,0,0.55)] ring-0"
        sideOffset={6}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2.5 pt-1.5 pb-0.5 text-xs font-medium text-[var(--text-tertiary)]">Criar</DropdownMenuLabel>
          {items.map((item) =>
            item.href ? (
              <DropdownMenuItem
                className={itemClass}
                key={item.id}
                render={<Link data-navigation-feedback={isAdminV2Href(item.href) ? "false" : undefined} href={item.href} />}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.meta ? <span className="ml-4 shrink-0 text-xs text-[var(--text-tertiary)]">{item.meta}</span> : null}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem className={itemClass} disabled key={item.id}>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.meta ? <span className="ml-4 shrink-0 text-xs text-[var(--text-tertiary)]">{item.meta}</span> : null}
              </DropdownMenuItem>
            )
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

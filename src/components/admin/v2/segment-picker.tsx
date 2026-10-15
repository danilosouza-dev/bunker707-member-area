"use client";

import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { adminPillClasses } from "./form";

// Segmentos de uma lista (Alunos hoje; Comunicacao depois), docs/17 §2.7: uma linha de pilulas com a
// contagem de cada segmento e, no fim, o menu "Mais segmentos" com os demais e os salvos pela equipe.
// Cada item e um link (filtros no endereco). A regra do segmento aparece no menu e ao passar o mouse
// nas pilulas (docs/17 §1.11: nenhuma metrica sem formula). Substitui a coluna lateral de 14/10/2026.

export type SegmentPickerItem = {
  active: boolean;
  count: number | null;
  formula?: string;
  href: string;
  id: string;
  label: string;
};

type SegmentPickerProps = {
  ariaLabel: string;
  className?: string;
  /** Pilulas da linha de cima. */
  items: readonly SegmentPickerItem[];
  /** Segmentos do menu "Mais segmentos". */
  more?: readonly SegmentPickerItem[];
  /** Segmentos salvos (secao propria no menu). */
  saved?: readonly SegmentPickerItem[];
  savedEmpty?: string;
  /** Acao ao lado do menu quando um salvo esta ativo (ex.: excluir o segmento). */
  trailing?: ReactNode;
};

const counter = new Intl.NumberFormat("pt-BR");

const itemClass =
  "flex min-h-[38px] w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:bg-[var(--press-overlay)] data-highlighted:bg-[var(--press-overlay)]";

function Count({ active, value }: { active: boolean; value: number | null }) {
  if (value === null) {
    return null;
  }

  return <span className={cn("tabular-nums", active ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]")}>{counter.format(value)}</span>;
}

function MenuItem({ item }: { item: SegmentPickerItem }) {
  return (
    <DropdownMenuItem className={itemClass} render={<Link data-navigation-feedback="false" href={item.href} scroll={false} />}>
      <span aria-hidden="true" className="mt-0.5 grid size-4 shrink-0 place-items-center">
        {item.active ? <Check className="size-4" /> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{item.label}</span>
        {item.formula ? <span className="text-xs leading-4 text-[var(--text-tertiary)]">{item.formula}</span> : null}
      </span>
      {item.count === null ? null : (
        <span className="ml-3 shrink-0 text-xs leading-5 text-[var(--text-tertiary)] tabular-nums">{counter.format(item.count)}</span>
      )}
    </DropdownMenuItem>
  );
}

export function SegmentPicker({ ariaLabel, className, items, more = [], saved, savedEmpty, trailing }: SegmentPickerProps) {
  const activeMenuItem = [...more, ...(saved ?? [])].find((item) => item.active) ?? null;
  const hasMenu = more.length > 0 || saved !== undefined;

  return (
    <nav aria-label={ariaLabel} className={cn("min-w-0", className)}>
      <ul className="flex min-w-0 flex-wrap items-center gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              aria-current={item.active ? "page" : undefined}
              className={cn(adminPillClasses(item.active), "gap-2")}
              data-navigation-feedback="false"
              href={item.href}
              scroll={false}
              title={item.formula}
            >
              {item.active ? <Check aria-hidden="true" className="-mr-0.5 size-4" /> : null}
              {item.label}
              <Count active={item.active} value={item.count} />
            </Link>
          </li>
        ))}

        {hasMenu ? (
          <li className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={activeMenuItem ? `${activeMenuItem.label}: trocar segmento` : "Mais segmentos"}
                className={cn(adminPillClasses(Boolean(activeMenuItem)), "gap-2", !activeMenuItem && "border-dashed")}
              >
                {activeMenuItem ? <Check aria-hidden="true" className="-mr-0.5 size-4" /> : null}
                <span className="max-w-[220px] truncate">{activeMenuItem ? activeMenuItem.label : "Mais segmentos"}</span>
                {activeMenuItem ? <Count active value={activeMenuItem.count} /> : null}
                <ChevronDown aria-hidden="true" className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-[340px] max-w-[calc(100vw-32px)] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1 text-[var(--text-primary)] shadow-[0_14px_36px_rgba(0,0,0,0.55)] ring-0"
                sideOffset={6}
              >
                {more.length > 0 ? (
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="px-2.5 pt-1.5 pb-0.5 text-xs font-medium text-[var(--text-tertiary)]">Mais segmentos</DropdownMenuLabel>
                    {more.map((item) => (
                      <MenuItem item={item} key={item.id} />
                    ))}
                  </DropdownMenuGroup>
                ) : null}
                {saved !== undefined ? (
                  <>
                    {more.length > 0 ? <DropdownMenuSeparator className="my-1 bg-[var(--border-subtle)]" /> : null}
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="px-2.5 pt-1.5 pb-0.5 text-xs font-medium text-[var(--text-tertiary)]">Salvos</DropdownMenuLabel>
                      {saved.length === 0 ? (
                        <p className="px-2.5 pb-2 text-xs leading-5 text-[var(--text-tertiary)]">{savedEmpty}</p>
                      ) : (
                        saved.map((item) => <MenuItem item={item} key={item.id} />)
                      )}
                    </DropdownMenuGroup>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            {trailing}
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

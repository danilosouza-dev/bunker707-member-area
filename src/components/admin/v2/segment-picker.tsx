import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { adminCard, adminTransition } from "./styles";

// Lista de segmentos (prontos e salvos) com contagem, usada por Alunos e, depois, por Comunicacao
// (docs/17 §2.7: componente compartilhado). Cada item e um link (filtros no endereco); a regra do
// segmento vai no `title`, para a formula ficar visivel ao passar o mouse (docs/17 §1.11).
// No celular vira uma lista horizontal rolavel.

export type SegmentPickerItem = {
  active: boolean;
  /** Acao a direita do item (ex.: menu para excluir um segmento salvo). */
  action?: ReactNode;
  count: number | null;
  formula?: string;
  href: string;
  id: string;
  label: string;
};

type SegmentPickerProps = {
  ariaLabel: string;
  className?: string;
  /** Segmentos salvos pela equipe (ficam numa secao propria). */
  saved?: readonly SegmentPickerItem[];
  savedEmpty?: ReactNode;
  savedTitle?: string;
  items: readonly SegmentPickerItem[];
  title?: string;
};

const count = new Intl.NumberFormat("pt-BR");

function SegmentLink({ item }: { item: SegmentPickerItem }) {
  return (
    <li className="flex min-w-0 items-center gap-1">
      <Link
        aria-current={item.active ? "page" : undefined}
        className={cn(
          "flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 text-[13px] leading-5",
          item.active
            ? "bg-[var(--surface-3)] font-medium text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]",
          adminTransition
        )}
        data-navigation-feedback="false"
        href={item.href}
        scroll={false}
        title={item.formula}
      >
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.count === null ? null : (
          <span className="shrink-0 text-xs text-[var(--text-tertiary)] tabular-nums">{count.format(item.count)}</span>
        )}
      </Link>
      {item.action}
    </li>
  );
}

export function SegmentPicker({ ariaLabel, className, items, saved, savedEmpty, savedTitle = "Salvos", title = "Segmentos" }: SegmentPickerProps) {
  return (
    <nav aria-label={ariaLabel} className={cn(adminCard, "flex min-w-0 flex-col gap-3 p-2", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="px-2.5 pt-1 text-xs font-medium text-[var(--text-tertiary)]">{title}</p>
        <ul className="flex min-w-0 flex-col gap-0.5 max-lg:flex-row max-lg:overflow-x-auto max-lg:pb-1">
          {items.map((item) => (
            <SegmentLink item={item} key={item.id} />
          ))}
        </ul>
      </div>
      {saved ? (
        <div className="flex min-w-0 flex-col gap-1 border-t border-[var(--border-subtle)] pt-2">
          <p className="px-2.5 text-xs font-medium text-[var(--text-tertiary)]">{savedTitle}</p>
          {saved.length === 0 ? (
            <div className="px-2.5 pb-1 text-xs leading-5 text-[var(--text-tertiary)]">{savedEmpty}</div>
          ) : (
            <ul className="flex min-w-0 flex-col gap-0.5 max-lg:flex-row max-lg:overflow-x-auto max-lg:pb-1">
              {saved.map((item) => (
                <SegmentLink item={item} key={item.id} />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </nav>
  );
}

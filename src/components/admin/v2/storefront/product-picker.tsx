"use client";

import { Check, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { ProductAccent } from "@/server/catalog/model";
import { adminInputClass, fieldDescribedBy } from "../form";
import { ProductThumb } from "../product-thumb";
import { StatusChip, type StatusChipTone } from "../status-chip";
import { adminTransition } from "../styles";

// Escolha de produtos com busca (fileira manual e destaque da Vitrine, produtos de um Pacote).
// Radios ou checkboxes nativos por baixo: teclado e leitor de tela funcionam sem codigo extra.

export type ProductPickerItem = {
  accent: ProductAccent;
  coverUrl: string | null;
  /** Linha de apoio, ex.: o formato. */
  detail: string;
  /** Avisos curtos ao lado do nome, ex.: Rascunho, Oculto. */
  flags?: { label: string; tone: StatusChipTone }[];
  id: string;
  title: string;
};

type ProductPickerProps = {
  disabled?: boolean;
  emptyText?: string;
  error?: string | null;
  hint?: string;
  /** id do campo de busca (o label do AdminField aponta para ele). */
  id: string;
  items: readonly ProductPickerItem[];
  mode: "single" | "multiple";
  onChange: (ids: string[]) => void;
  value: readonly string[];
};

function fold(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

export function ProductPicker({ disabled = false, emptyText, error, hint, id, items, mode, onChange, value }: ProductPickerProps) {
  const [query, setQuery] = useState("");
  const name = useId();
  const selected = useMemo(() => new Set(value), [value]);
  const filtered = useMemo(() => {
    const term = fold(query.trim());

    return term ? items.filter((item) => fold(item.title).includes(term)) : items;
  }, [items, query]);

  function toggle(itemId: string) {
    if (mode === "single") {
      onChange([itemId]);
      return;
    }

    onChange(selected.has(itemId) ? value.filter((current) => current !== itemId) : [...value, itemId]);
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
        <input
          aria-describedby={fieldDescribedBy(id, { error, hint })}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          className={cn(adminInputClass, "pl-9")}
          disabled={disabled}
          id={id}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar pelo nome"
          type="search"
          value={query}
        />
      </div>
      <div
        aria-label={mode === "single" ? "Produto" : "Produtos"}
        className={cn(
          "max-h-72 min-w-0 overflow-y-auto overscroll-contain rounded-lg border bg-[var(--surface-1)]",
          error ? "border-[var(--error)]" : "border-[var(--border-subtle)]"
        )}
        role="group"
      >
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] leading-5 text-[var(--text-secondary)]">
            {items.length === 0 ? (emptyText ?? "Nenhum produto ainda.") : "Nenhum produto com esse nome."}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {filtered.map((item) => {
              const checked = selected.has(item.id);
              const position = mode === "multiple" && checked ? value.indexOf(item.id) + 1 : null;

              return (
                <li key={item.id}>
                  <label
                    className={cn(
                      "flex min-h-12 cursor-pointer items-center gap-3 px-3 py-1.5",
                      "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:-outline-offset-2 has-[input:focus-visible]:outline-[var(--focus-ring)]",
                      checked ? "bg-[var(--surface-2)]" : "hover:bg-[var(--hover-overlay)]",
                      disabled && "cursor-not-allowed opacity-60",
                      adminTransition
                    )}
                  >
                    <input
                      checked={checked}
                      className="sr-only"
                      disabled={disabled}
                      name={name}
                      onChange={() => toggle(item.id)}
                      type={mode === "single" ? "radio" : "checkbox"}
                      value={item.id}
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-5 shrink-0 place-items-center border text-[11px] font-semibold tabular-nums",
                        mode === "single" ? "rounded-full" : "rounded-[5px]",
                        checked
                          ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--surface-0)]"
                          : "border-[var(--border-strong)] bg-[var(--surface-2)]"
                      )}
                    >
                      {checked ? position ?? <Check className="size-3.5" /> : null}
                    </span>
                    <ProductThumb accent={item.accent} coverUrl={item.coverUrl} title={item.title} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm leading-5 text-[var(--text-primary)]">{item.title}</span>
                      <span className="truncate text-xs leading-5 text-[var(--text-secondary)]">{item.detail}</span>
                    </span>
                    {item.flags?.length ? (
                      <span className="hidden shrink-0 items-center gap-1 sm:flex">
                        {item.flags.map((flag) => (
                          <StatusChip key={flag.label} tone={flag.tone}>
                            {flag.label}
                          </StatusChip>
                        ))}
                      </span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

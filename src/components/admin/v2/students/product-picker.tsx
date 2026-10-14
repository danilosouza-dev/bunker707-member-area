"use client";

import { Search } from "lucide-react";
import { useId, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PRODUCT_FORMAT_LABELS, PRODUCT_SITUATION_LABELS } from "@/server/catalog/model";
import type { ProductOption } from "@/server/catalog/types";
import { ProductThumb } from "../product-thumb";
import { StatusChip, situationTone } from "../status-chip";
import { adminCard, adminTransition } from "../styles";

// Lista de produtos com caixa de marcar (Adicionar aluno, Liberar acesso). Com mais de 8 produtos,
// ganha busca pelo nome. Produto em rascunho ou arquivado pode ser liberado (o aluno so ve quando
// publicar), mas fica marcado com a situacao para nao enganar.

export type PickerProduct = Pick<ProductOption, "accent" | "coverUrl" | "format" | "id" | "situation" | "title">;

type ProductPickerProps = {
  /** Ids com acesso aberto hoje (chip "Já tem acesso"). */
  alreadyGranted?: ReadonlySet<string>;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onChange: (selected: string[]) => void;
  products: readonly PickerProduct[];
  selected: readonly string[];
};

const SEARCH_THRESHOLD = 8;

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function ProductPicker({ alreadyGranted, ariaLabel, className, disabled = false, onChange, products, selected }: ProductPickerProps) {
  const [search, setSearch] = useState("");
  const searchId = useId();
  const query = normalize(search.trim());
  const visible = query ? products.filter((product) => normalize(product.title).includes(query)) : products;
  const selectedSet = new Set(selected);

  function toggle(productId: string, checked: boolean) {
    const next = new Set(selected);

    if (checked) {
      next.add(productId);
    } else {
      next.delete(productId);
    }

    onChange(Array.from(next));
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      {products.length > SEARCH_THRESHOLD ? (
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <label className="sr-only" htmlFor={searchId}>
            Buscar produto pelo nome
          </label>
          <Input
            autoComplete="off"
            className={cn(
              "h-9 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] pr-3 pl-8 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus-visible:border-[var(--text-secondary)] focus-visible:ring-0",
              adminTransition
            )}
            id={searchId}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar produto"
            type="search"
            value={search}
          />
        </div>
      ) : null}

      <div aria-label={ariaLabel} className={cn(adminCard, "max-h-72 overflow-y-auto")} role="group">
        {products.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-[var(--text-secondary)]">Nenhum produto no catálogo ainda.</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-[var(--text-secondary)]">Nenhum produto com “{search.trim()}”.</p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {visible.map((product) => {
              const checked = selectedSet.has(product.id);

              return (
                <li key={product.id}>
                  <label
                    className={cn(
                      "flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-[var(--hover-overlay)]",
                      disabled && "cursor-not-allowed opacity-60",
                      adminTransition
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      className="border-[var(--border-stronger)] data-checked:border-[var(--text-primary)] data-checked:bg-[var(--text-primary)] data-checked:text-[var(--surface-0)]"
                      disabled={disabled}
                      onCheckedChange={(next) => toggle(product.id, next === true)}
                    />
                    <ProductThumb accent={product.accent} coverUrl={product.coverUrl} size="xs" title={product.title} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--text-primary)]">{product.title}</span>
                      <span className="block truncate text-xs text-[var(--text-tertiary)]">{PRODUCT_FORMAT_LABELS[product.format]}</span>
                    </span>
                    {alreadyGranted?.has(product.id) ? <StatusChip tone="success">Já tem acesso</StatusChip> : null}
                    {product.situation !== "published" ? (
                      <StatusChip tone={situationTone(product.situation)}>{PRODUCT_SITUATION_LABELS[product.situation]}</StatusChip>
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

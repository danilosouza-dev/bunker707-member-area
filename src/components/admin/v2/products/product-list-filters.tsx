"use client";

import { Check, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PRODUCT_FORMATS, PRODUCT_FORMAT_LABELS, type ProductFormat } from "@/server/catalog/model";
import { adminPillClasses } from "../form";
import { adminTransition } from "../styles";
import { SITUATION_FILTERS, buildProductListHref, resolveSearchText, type ProductListFilters } from "./list-filters";

// Filtros da lista de produtos, na linha do prototipo aprovado: pilulas de Situação (redondas, 34 px,
// a marcada com borda clara e ✓), "Formato" + select de 110 px e a busca de 280 px encostada a
// direita. Tudo no endereco (?situacao=&formato=&busca=&pagina=); a busca espera 300 ms.
// No celular: pilulas quebram, o select ocupa a linha (sem o rotulo visivel) e a busca vem embaixo.

const SEARCH_DEBOUNCE_MS = 300;

const formatOptions: { label: string; value: ProductFormat | null }[] = [
  { label: "Todos", value: null },
  ...PRODUCT_FORMATS.map((format) => ({ label: PRODUCT_FORMAT_LABELS[format], value: format }))
];

export function ProductListFiltersBar({ filters }: { filters: ProductListFilters }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const addressQuery = filters.q ?? "";
  const [typed, setTyped] = useState({ base: addressQuery, text: addressQuery });
  const searchText = resolveSearchText(addressQuery, typed);

  useEffect(() => {
    const next = searchText.trim();

    if (next === addressQuery) {
      return;
    }

    const timer = window.setTimeout(() => {
      startTransition(() => {
        router.replace(buildProductListHref(filters, { q: next }), { scroll: false });
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [addressQuery, filters, router, searchText]);

  return (
    <div aria-busy={pending || undefined} className="flex min-w-0 flex-wrap items-center gap-2">
      <nav aria-label="Situação" className="min-w-0">
        <ul className="flex flex-wrap gap-2">
          {SITUATION_FILTERS.map((option) => {
            const active = filters.situation === option.value;

            return (
              <li key={option.label}>
                <Link
                  aria-current={active ? "page" : undefined}
                  className={adminPillClasses(active)}
                  data-navigation-feedback="false"
                  href={buildProductListHref(filters, { situation: option.value })}
                  scroll={false}
                >
                  {active ? <Check aria-hidden="true" className="size-4" /> : null}
                  {option.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex min-w-0 items-center gap-1.5 max-md:flex-[1_1_130px]">
        <span className="text-[13px] font-medium text-[var(--text-tertiary)] max-md:sr-only" id="filtro-formato">
          Formato
        </span>
        <Select
          items={formatOptions}
          onValueChange={(value) => {
            startTransition(() => {
              router.push(buildProductListHref(filters, { format: (value as ProductFormat | null) ?? undefined }), { scroll: false });
            });
          }}
          value={filters.format ?? null}
        >
          <SelectTrigger
            aria-labelledby="filtro-formato"
            className={cn(
              "w-[110px] rounded-lg border-[var(--border-subtle)] bg-[var(--surface-1)] pr-2.5 pl-3 text-[13px] font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)] data-[size=default]:h-9 max-md:w-full",
              adminTransition
            )}
          >
            <SelectValue className="min-w-0" />
          </SelectTrigger>
          <SelectContent className="border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)] ring-0">
            {formatOptions.map((option) => (
              <SelectItem key={option.value ?? "todos"} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <span aria-hidden="true" className="hidden flex-1 md:block" />

      <div className="relative min-w-[200px] flex-[0_1_280px]">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
        <label className="sr-only" htmlFor="produtos-busca">
          Buscar produto pelo nome
        </label>
        <Input
          autoComplete="off"
          className={cn(
            "h-9 w-full min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] pr-3 pl-8 text-sm text-[var(--text-primary)]",
            "placeholder:text-[var(--text-tertiary)] hover:border-[var(--border-strong)] focus-visible:border-[var(--text-secondary)] focus-visible:ring-0",
            adminTransition
          )}
          id="produtos-busca"
          maxLength={80}
          onChange={(event) => setTyped({ base: addressQuery, text: event.target.value })}
          placeholder="Buscar pelo nome"
          type="search"
          value={searchText}
        />
      </div>
    </div>
  );
}

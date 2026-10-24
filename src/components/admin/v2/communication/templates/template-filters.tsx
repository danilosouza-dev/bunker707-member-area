"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import type { TemplateFilter } from "@/server/communications/template-queries";
import { adminInputClass, adminPillClasses } from "../../form";
import { TEMPLATE_COPY, TEMPLATE_FILTERS, TEMPLATE_SEARCH_MAX, templatesFilterHref, templatesSearchHref } from "./templates-view-model";

// Filtros da aba Modelos (docs/28; spec §5.2), no endereco: a busca pelo nome (?busca=, espera de 300 ms; mudar a
// busca volta a pagina 1) e as pilulas do tipo (?tipo=, Todos · Notificação · Pop-up · Design Personalizado · Design
// Livre). Numa linha que quebra no celular.

type ParamsRecord = Record<string, string | string[] | undefined>;

export function TemplateFilters({ filter, search, searchParams }: { filter: TemplateFilter; search: string; searchParams: ParamsRecord }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" role="search">
      <TemplateSearchField searchParams={searchParams} value={search} />
      <nav aria-label={TEMPLATE_COPY.list.typeFilterLabel} className="flex min-w-0 flex-wrap gap-2">
        {TEMPLATE_FILTERS.map((option) => {
          const active = option.filter === filter;

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(adminPillClasses(active), "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]")}
              data-navigation-feedback="false"
              href={templatesFilterHref(searchParams, option.filter)}
              key={option.filter}
              scroll={false}
            >
              {option.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function TemplateSearchField({ searchParams, value }: { searchParams: ParamsRecord; value: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(value);
  // Ultimo valor do endereco visto e ultimo enviado: so sobrescreve o campo quando o endereco mudou por fora (ex.:
  // "Limpar filtros"), nunca no meio da digitacao.
  const [seen, setSeen] = useState(value);
  const [sent, setSent] = useState(value);
  const search = useEffectEvent((next: string) => {
    const href = templatesSearchHref(searchParams, next);

    startTransition(() => router.replace(href, { scroll: false }));
  });

  if (value !== seen) {
    setSeen(value);

    if (value !== sent) {
      setSent(value);
      setText(value);
    }
  }

  useEffect(() => {
    const next = text.trim();

    if (next === sent.trim()) {
      return;
    }

    const timer = window.setTimeout(() => {
      setSent(next);
      search(next);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [sent, text]);

  return (
    <label aria-busy={pending || undefined} className="relative block w-full min-w-0 md:w-[320px]">
      <span className="sr-only">{TEMPLATE_COPY.list.searchLabel}</span>
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
      <input
        className={cn(adminInputClass, "h-9 bg-[var(--surface-1)] pl-9 text-[13px] pointer-coarse:h-11")}
        maxLength={TEMPLATE_SEARCH_MAX}
        onChange={(event) => setText(event.target.value)}
        placeholder={TEMPLATE_COPY.list.searchPlaceholder}
        type="search"
        value={text}
      />
    </label>
  );
}

"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import {
  WEBINAR_ADMIN_COPY,
  WEBINAR_KIND_FILTERS,
  WEBINAR_SEARCH_MAX,
  WEBINAR_SITUATION_FILTERS,
  webinarsFilterHref,
  type ParamsRecord,
  type WebinarsListState
} from "@/server/webinars/editor-model";
import { adminInputClass, adminPillClasses } from "../../form";

// Filtros da lista de Webinários (docs/30 §2.1), no endereco: a busca pelo titulo (?busca=, espera de 300 ms),
// as pilulas de situacao (Todos · Rascunho · Agendado · Em andamento · Encerrado · Cancelado, ?situacao=) e as de
// tipo (Ao vivo · Gravada, ?tipo=; clicar na ativa tira o filtro). Toda troca volta para a pagina 1 e leva o
// periodo da barra superior junto. Cliente porque a pilula do admin (adminPillClasses) vem do kit de formularios.

type WebinarFiltersProps = {
  searchParams: ParamsRecord;
  state: WebinarsListState;
};

const pillClass = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]";

export function WebinarFilters({ searchParams, state }: WebinarFiltersProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2" role="search">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <WebinarSearchField searchParams={searchParams} value={state.search} />
        <nav aria-label={WEBINAR_ADMIN_COPY.list.kindFiltersLabel} className="flex min-w-0 flex-wrap gap-2">
          {WEBINAR_KIND_FILTERS.map((filter) => {
            const active = filter.value === state.kind;

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(adminPillClasses(active), pillClass)}
                data-navigation-feedback="false"
                href={webinarsFilterHref(searchParams, { kind: active ? null : filter.value })}
                key={filter.value}
                scroll={false}
              >
                {filter.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <nav aria-label={WEBINAR_ADMIN_COPY.list.filtersLabel} className="flex min-w-0 flex-wrap gap-2">
        {WEBINAR_SITUATION_FILTERS.map((filter) => {
          const active = filter.value === state.situation;

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(adminPillClasses(active), pillClass)}
              data-navigation-feedback="false"
              href={webinarsFilterHref(searchParams, { situation: filter.value })}
              key={filter.label}
              scroll={false}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function WebinarSearchField({ searchParams, value }: { searchParams: ParamsRecord; value: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(value);
  // Ultimo valor do endereco visto e ultimo enviado: o campo so e sobrescrito quando o endereco mudou por fora
  // ("Limpar filtros"), nunca no meio da digitacao.
  const [seen, setSeen] = useState(value);
  const [sent, setSent] = useState(value);
  const search = useEffectEvent((next: string) => {
    startTransition(() => router.replace(webinarsFilterHref(searchParams, { search: next }), { scroll: false }));
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
      <span className="sr-only">{WEBINAR_ADMIN_COPY.list.searchLabel}</span>
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
      <input
        className={cn(adminInputClass, "h-9 bg-[var(--surface-1)] pl-9 text-[13px] pointer-coarse:h-11")}
        maxLength={WEBINAR_SEARCH_MAX}
        onChange={(event) => setText(event.target.value)}
        placeholder={WEBINAR_ADMIN_COPY.list.searchPlaceholder}
        type="search"
        value={text}
      />
    </label>
  );
}

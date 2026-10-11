"use client";

import { ChevronLeft, ChevronRight, Layers, Search, SearchX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ModuleSettingsPage } from "@/server/member-area/modules-queries";
import { buildModuleSettingsHref } from "@/server/member-area/modules-model";
import { EmptyState } from "../../empty-state";
import { adminInputClass } from "../../form";
import { describePageRange, pageCount, resolveSearchText } from "../../products/list-filters";
import { ModulesTable } from "./modules-table";

// Area de membros › Modulos: busca pelo nome (?busca=, com espera de 300 ms), pagina (?pagina=, 25 por
// vez) e a tabela. Estados vazios honestos: nenhum curso ainda, nenhum curso com o nome buscado.

const SEARCH_DEBOUNCE_MS = 300;

type ModulesScreenProps = {
  canWriteCatalog: boolean;
  canWriteStorefront: boolean;
  data: ModuleSettingsPage;
};

const pagerButton = cn(buttonVariants({ variant: "secondary" }), "gap-1 border-[var(--border-strong)] px-3");

export function ModulesScreen({ canWriteCatalog, canWriteStorefront, data }: ModulesScreenProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const addressQuery = data.q ?? "";
  const [typed, setTyped] = useState({ base: addressQuery, text: addressQuery });
  const searchText = resolveSearchText(addressQuery, typed);
  const pages = pageCount(data.total, data.pageSize);
  const current = { page: data.page, q: data.q };

  useEffect(() => {
    const next = searchText.trim();

    if (next === addressQuery) {
      return;
    }

    const timer = window.setTimeout(() => {
      startTransition(() => {
        // Busca nova volta para a pagina 1.
        router.replace(buildModuleSettingsHref({}, { q: next }), { scroll: false });
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [addressQuery, router, searchText]);

  if (data.totalUnfiltered === 0 && !data.q) {
    return (
      <EmptyState
        action={{ href: "/admin/produtos/novo", label: "Criar produto" }}
        description="Crie um curso, uma mentoria ou um bootcamp para decidir como ele abre e se os módulos aparecem na home."
        icon={Layers}
        title="Nenhum curso ainda"
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="max-w-[640px] text-sm leading-5 text-[var(--text-secondary)]">
          Como cada curso abre para o aluno, se os módulos aparecem numa fileira da home e quais módulos já têm capa própria.
        </p>
        <div aria-busy={pending || undefined} className="relative min-w-0 md:w-[280px] md:shrink-0">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <label className="sr-only" htmlFor="modulos-busca">
            Buscar curso pelo nome
          </label>
          <Input
            autoComplete="off"
            className={cn(adminInputClass, "h-11 pl-9 md:h-9")}
            id="modulos-busca"
            maxLength={80}
            onChange={(event) => setTyped({ base: addressQuery, text: event.target.value })}
            placeholder="Buscar pelo nome"
            type="search"
            value={searchText}
          />
        </div>
      </div>

      {!canWriteCatalog && !canWriteStorefront ? (
        <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 text-sm leading-5 text-[var(--text-secondary)]">
          Só o dono, um administrador ou um editor pode mudar os módulos. Você está vendo a configuração atual.
        </p>
      ) : null}

      {data.items.length === 0 ? (
        data.q ? (
          <EmptyState
            action={{ href: buildModuleSettingsHref({}, {}), label: "Limpar busca" }}
            description={`Nenhum curso tem “${data.q}” no nome.`}
            icon={SearchX}
            title="Nenhum curso com esse nome"
          />
        ) : (
          <EmptyState
            action={{ href: buildModuleSettingsHref({}, {}), label: "Voltar para a primeira página" }}
            description="Esta página passou do fim da lista."
            title="Nada nesta página"
          />
        )
      ) : (
        <ModulesTable canWriteCatalog={canWriteCatalog} canWriteStorefront={canWriteStorefront} rows={data.items} />
      )}

      {data.items.length > 0 ? (
        <nav aria-label="Páginas de cursos" className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-[var(--text-secondary)] tabular-nums">{describePageRange(data.page, data.pageSize, data.total)}</p>
          {pages > 1 ? (
            <div className="flex items-center gap-2">
              {data.page > 1 ? (
                <Link className={pagerButton} data-navigation-feedback="false" data-slot="button" href={buildModuleSettingsHref(current, { page: data.page - 1 })}>
                  <ChevronLeft aria-hidden="true" className="size-4" />
                  Anterior
                </Link>
              ) : (
                <span aria-disabled="true" className={cn(pagerButton, "pointer-events-none opacity-50")} data-slot="button">
                  <ChevronLeft aria-hidden="true" className="size-4" />
                  Anterior
                </span>
              )}
              {data.page < pages ? (
                <Link className={pagerButton} data-navigation-feedback="false" data-slot="button" href={buildModuleSettingsHref(current, { page: data.page + 1 })}>
                  Próxima
                  <ChevronRight aria-hidden="true" className="size-4" />
                </Link>
              ) : (
                <span aria-disabled="true" className={cn(pagerButton, "pointer-events-none opacity-50")} data-slot="button">
                  Próxima
                  <ChevronRight aria-hidden="true" className="size-4" />
                </span>
              )}
            </div>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

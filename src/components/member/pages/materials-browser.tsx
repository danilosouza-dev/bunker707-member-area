"use client";

import Link from "next/link";
import { ArrowRight, FolderSearch } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { MemberButton } from "@/components/member/ui/member-button";
import { MemberChip } from "@/components/member/ui/member-chip";
import { MemberEmptyState } from "@/components/member/ui/member-empty-state";
import { MemberFilterPills, MemberSearchField, type MemberFilterOption } from "@/components/member/ui/member-filters";
import { MemberMaterialRow } from "@/components/member/ui/member-material-row";
import { formatMemberCount } from "@/lib/member-format";
import type { StudentMaterialsView } from "@/server/member-area/student-pages-model";
import { ALL_MATERIALS_FILTER, filterMaterialGroups } from "./materials-filter";

// Lista de materiais com filtro por curso e tipo e busca (cliente leve: recebe so o recorte pronto,
// sem endereco de material bloqueado).

const MAX_PILL_LABEL = 34;

function shortLabel(text: string) {
  return text.length > MAX_PILL_LABEL ? `${text.slice(0, MAX_PILL_LABEL - 1).trimEnd()}…` : text;
}

export function MaterialsBrowser({ view }: { view: StudentMaterialsView }) {
  const [productId, setProductId] = useState(ALL_MATERIALS_FILTER);
  const [type, setType] = useState(ALL_MATERIALS_FILTER);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const groups = useMemo(
    () => filterMaterialGroups(view.groups, { productId, query: deferredQuery, type }),
    [deferredQuery, productId, type, view.groups]
  );
  const visibleTotal = groups.reduce((sum, group) => sum + group.total, 0);
  const filtering = productId !== ALL_MATERIALS_FILTER || type !== ALL_MATERIALS_FILTER || Boolean(query.trim());

  const productOptions: MemberFilterOption<string>[] = [
    { count: view.total, id: ALL_MATERIALS_FILTER, label: "Todos os cursos" },
    ...view.groups.map((group) => ({ count: group.total, id: group.id, label: shortLabel(group.title) }))
  ];
  const typeOptions: MemberFilterOption<string>[] = [
    { id: ALL_MATERIALS_FILTER, label: "Todos os tipos" },
    ...view.types.map((item) => ({ count: item.count, id: item.id, label: item.label }))
  ];

  function clearFilters() {
    setProductId(ALL_MATERIALS_FILTER);
    setType(ALL_MATERIALS_FILTER);
    setQuery("");
  }

  return (
    <div className="min-w-0">
      <div className="mb-8 grid gap-3 border-b border-white/[0.08] pb-6">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          {view.groups.length > 1 ? (
            <MemberFilterPills ariaLabel="Filtrar por curso" onChange={setProductId} options={productOptions} value={productId} />
          ) : (
            <span className="hidden lg:block" />
          )}
          <MemberSearchField
            className="lg:w-72 lg:shrink-0"
            label="Buscar nos materiais"
            onChange={setQuery}
            placeholder="Buscar material ou aula"
            value={query}
          />
        </div>
        {view.types.length > 1 ? (
          <MemberFilterPills ariaLabel="Filtrar por tipo de arquivo" onChange={setType} options={typeOptions} value={type} />
        ) : null}
      </div>

      <p aria-live="polite" className="sr-only">
        {filtering ? `${formatMemberCount(visibleTotal, "material encontrado", "materiais encontrados")}` : ""}
      </p>

      {groups.length > 0 ? (
        <div className="grid gap-12">
          {groups.map((group) => {
            const titleId = `materiais-${group.id}`;

            return (
              <section aria-labelledby={titleId} className="min-w-0" key={group.id}>
                <header className="mb-5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <h2 className="min-w-0 text-lg font-bold leading-6 text-white sm:text-xl" id={titleId}>
                    {group.title}
                  </h2>
                  <MemberChip tone="neutral">{group.kindLabel}</MemberChip>
                  <span className="text-xs font-medium text-zinc-500">
                    {formatMemberCount(group.total, "material", "materiais")}
                    {group.lockedCount > 0 ? ` · ${group.lockedCount} para liberar` : ""}
                  </span>
                </header>

                <div className="grid gap-7">
                  {group.lessons.map((lesson) => (
                    <div className="min-w-0 border-l-2 border-white/[0.08] pl-3 sm:pl-5" key={lesson.id}>
                      <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-zinc-100 sm:text-[15px]">{lesson.title}</h3>
                          {lesson.context ? <p className="mt-0.5 truncate text-xs text-zinc-500">{lesson.context}</p> : null}
                        </div>
                        <Link
                          aria-label={`Ir para a aula ${lesson.title}`}
                          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] px-2 text-xs font-semibold text-zinc-400 outline-none transition hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                          href={lesson.href}
                        >
                          <span className="max-sm:hidden">Ir para a aula</span>
                          <span className="sm:hidden">Aula</span>
                          <ArrowRight aria-hidden="true" className="size-3.5" />
                        </Link>
                      </div>
                      <ul className="grid gap-2 xl:grid-cols-2">
                        {lesson.materials.map((material) => (
                          <li className="min-w-0" key={material.id}>
                            <MemberMaterialRow className="h-full" material={material} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <MemberEmptyState
          action={
            <MemberButton onClick={clearFilters} variant="secondary">
              Limpar filtros
            </MemberButton>
          }
          description="Tente outra palavra ou mostre todos os cursos e tipos."
          icon={FolderSearch}
          size="compact"
          title="Nenhum material encontrado"
        />
      )}
    </div>
  );
}

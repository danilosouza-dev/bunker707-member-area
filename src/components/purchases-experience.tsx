"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Clock3,
  LibraryBig,
  Play,
  Search,
  Sparkles
} from "lucide-react";
import { withAccessPreviewParam } from "@/lib/access-preview";
import type { LucideIcon } from "lucide-react";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { cssImageUrl } from "@/lib/css-url";
import type { ContentItem, ContentKind } from "@/lib/platform-types";

type PurchasesExperienceProps = {
  accessPreviewMode?: AccessPreviewMode;
  items: ContentItem[];
};

type PurchaseFilter = "all" | "in-progress" | "completed" | "new" | "formations" | "courses" | "bootcamps";

const filterOptions = [
  { id: "all", label: "Todos" },
  { id: "in-progress", label: "Em andamento" },
  { id: "completed", label: "Concluidos" },
  { id: "new", label: "Novos" },
  { id: "formations", label: "Formacoes" },
  { id: "courses", label: "Cursos" },
  { id: "bootcamps", label: "Bootcamps" }
] satisfies Array<{
  id: PurchaseFilter;
  label: string;
}>;

function getContentHref(item: ContentItem, accessPreviewMode?: AccessPreviewMode) {
  return withAccessPreviewParam(`/conteudo/${item.id}`, accessPreviewMode);
}

function getActionLabel(item: ContentItem) {
  if (item.status === "Concluido" || item.progress >= 100) {
    return "Revisar";
  }

  if (item.status === "Em andamento" || item.progress > 0) {
    return "Continuar";
  }

  if (item.kind === "Formacao") {
    return "Ver cursos";
  }

  if (item.kind === "Bootcamp") {
    return "Comecar bootcamp";
  }

  return "Comecar";
}

function getKindPlural(kind: ContentKind) {
  if (kind === "Formacao") {
    return "Formacoes";
  }

  if (kind === "Bootcamp") {
    return "Bootcamps";
  }

  return "Cursos";
}

function matchesFilter(item: ContentItem, activeFilter: PurchaseFilter) {
  if (activeFilter === "all") {
    return true;
  }

  if (activeFilter === "in-progress") {
    return item.status === "Em andamento" || (item.progress > 0 && item.progress < 100);
  }

  if (activeFilter === "completed") {
    return item.status === "Concluido" || item.progress >= 100;
  }

  if (activeFilter === "new") {
    return item.status === "Novo" || item.progress === 0;
  }

  if (activeFilter === "formations") {
    return item.kind === "Formacao";
  }

  if (activeFilter === "courses") {
    return item.kind === "Curso";
  }

  return item.kind === "Bootcamp";
}

function PurchaseStat({
  icon: Icon,
  label,
  value
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[8px] border border-white/10 bg-white/[0.045] p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-[8px] bg-white/10 text-white">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-2xl font-black leading-none text-white">{value}</p>
          <p className="mt-1 text-xs font-semibold text-zinc-400">{label}</p>
        </div>
      </div>
    </div>
  );
}

function PurchaseCard({ accessPreviewMode, item }: { accessPreviewMode?: AccessPreviewMode; item: ContentItem }) {
  const progress = Math.min(Math.max(item.progress, 0), 100);
  const actionLabel = getActionLabel(item);

  return (
    <Link
      aria-label={`Abrir ${item.title}`}
      className="group block overflow-hidden rounded-[8px] bg-[#181818] shadow-2xl shadow-black/30 outline-none transition hover:-translate-y-1 hover:shadow-[0_34px_90px_rgba(0,0,0,0.68)] focus-visible:ring-2 focus-visible:ring-white/70"
      href={getContentHref(item, accessPreviewMode)}
    >
      <div className="relative aspect-[720/1040] overflow-hidden bg-[#101010]">
        <div
          className="absolute inset-0 bg-cover bg-center transition duration-700 group-hover:scale-[1.035]"
          style={{ backgroundImage: cssImageUrl(item.image) }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/78 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase text-zinc-300">
            <span>{item.kind}</span>
            <span className="h-1 w-1 rounded-full bg-zinc-500" />
            <span>{item.status}</span>
          </div>
          <h2 className="line-clamp-2 text-lg font-black leading-tight text-white">
            {item.title}
          </h2>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-300">
            {item.description ?? item.eyebrow}
          </p>
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-zinc-300">
              <span className="line-clamp-1">{item.lessons ?? getKindPlural(item.kind)}</span>
              <span className="text-white">{Math.round(progress)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <span className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-[8px] bg-white px-4 py-2 text-sm font-extrabold text-black transition group-hover:bg-zinc-200">
            <Play className="h-4 w-4 fill-current" />
            {actionLabel}
          </span>
        </div>
      </div>
    </Link>
  );
}

export function PurchasesExperience({ accessPreviewMode, items }: PurchasesExperienceProps) {
  const [activeFilter, setActiveFilter] = useState<PurchaseFilter>("all");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const filteredItems = useMemo(() => (
    items.filter((item) => {
      const matchesText = !normalizedQuery || [
        item.title,
        item.eyebrow,
        item.description,
        item.kind,
        item.status
      ].some((value) => value?.toLowerCase().includes(normalizedQuery));

      return matchesText && matchesFilter(item, activeFilter);
    })
  ), [activeFilter, items, normalizedQuery]);

  const completedCount = items.filter((item) => item.status === "Concluido" || item.progress >= 100).length;
  const inProgressCount = items.filter((item) => item.status === "Em andamento" || (item.progress > 0 && item.progress < 100)).length;
  const averageProgress = items.length > 0
    ? Math.round(items.reduce((total, item) => total + item.progress, 0) / items.length)
    : 0;

  return (
    <section className="min-h-screen bg-[#141414] px-5 pb-24 pt-28 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[104rem]">
        <div className="max-w-4xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-[6px] border border-white/10 bg-white/[0.055] px-3 py-2 text-xs font-bold uppercase text-zinc-300">
            <LibraryBig className="h-4 w-4 text-[var(--accent)]" />
            Biblioteca liberada
          </div>
          <h1 className="text-4xl font-black leading-none text-white sm:text-5xl lg:text-6xl">
            Minhas compras
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base sm:leading-7">
            Todos os produtos que voce tem acesso ativo: formacoes, cursos avulsos e bootcamps em um unico lugar.
          </p>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PurchaseStat icon={LibraryBig} label="Produtos liberados" value={String(items.length)} />
          <PurchaseStat icon={Clock3} label="Em andamento" value={String(inProgressCount)} />
          <PurchaseStat icon={CheckCircle2} label="Concluidos" value={String(completedCount)} />
          <PurchaseStat icon={BookOpen} label="Progresso medio" value={`${averageProgress}%`} />
        </div>

        <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {filterOptions.map((filter) => {
              const isActive = activeFilter === filter.id;

              return (
                <button
                  className={`min-h-10 rounded-[8px] border px-4 py-2 text-sm font-bold transition ${
                    isActive
                      ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                      : "border-white/10 bg-white/[0.045] text-zinc-300 hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                  }`}
                  key={filter.id}
                  onClick={() => setActiveFilter(filter.id)}
                  type="button"
                >
                  {filter.label}
                </button>
              );
            })}
          </div>

          <label className="flex h-11 w-full items-center gap-3 rounded-[8px] border border-white/10 bg-black/25 px-4 text-sm text-zinc-300 transition focus-within:border-white/25 focus-within:bg-black/35 lg:max-w-sm">
            <Search className="h-4 w-4 text-zinc-500" />
            <span className="sr-only">Buscar em Minhas compras</span>
            <input
              className="min-w-0 flex-1 border-0 bg-transparent text-white outline-none placeholder:text-zinc-500"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar nas compras..."
              type="search"
              value={query}
            />
          </label>
        </div>

        {filteredItems.length > 0 ? (
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {filteredItems.map((item) => (
              <PurchaseCard accessPreviewMode={accessPreviewMode} item={item} key={item.id} />
            ))}
          </div>
        ) : (
          <div className="mt-8 rounded-[8px] border border-white/10 bg-white/[0.04] px-6 py-12 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-[8px] bg-white/10 text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-xl font-black text-white">Nada encontrado</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">
              Tente limpar a busca ou escolher outro filtro para ver os produtos liberados.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

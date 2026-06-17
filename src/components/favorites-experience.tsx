"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, Bookmark, Clock3, Layers3, Play, Search, Sparkles } from "lucide-react";
import { SavedItemButton, savedItemChangedEvent } from "@/components/saved-item-button";
import { withAccessPreviewParam } from "@/lib/access-preview";
import { getSavedItemKey, getSavedTargetTypeForContentKind } from "@/lib/saved-items";
import type { AccessPreviewMode } from "@/lib/access-preview";
import type { ContentItem, SavedLessonItem, SavedModuleItem } from "@/lib/platform-types";

type FavoritesExperienceProps = {
  accessPreviewMode?: AccessPreviewMode;
  contentItems: ContentItem[];
  lessonItems: SavedLessonItem[];
  moduleItems: SavedModuleItem[];
};

type FavoriteFilter = "all" | "content" | "lessons" | "modules";

const filterOptions = [
  { id: "all", label: "Todos" },
  { id: "content", label: "Conteudos" },
  { id: "lessons", label: "Aulas" },
  { id: "modules", label: "Modulos" }
] satisfies Array<{
  id: FavoriteFilter;
  label: string;
}>;

function getContentHref(item: ContentItem, accessPreviewMode?: AccessPreviewMode) {
  return withAccessPreviewParam(`/conteudo/${item.id}`, accessPreviewMode);
}

function getModuleHref(module: SavedModuleItem, accessPreviewMode?: AccessPreviewMode) {
  return withAccessPreviewParam(
    `/conteudo/${encodeURIComponent(module.parentContentId)}/aulas/${encodeURIComponent(module.id)}`,
    accessPreviewMode
  );
}

function getLessonHref(lesson: SavedLessonItem, accessPreviewMode?: AccessPreviewMode) {
  return withAccessPreviewParam(
    `/conteudo/${encodeURIComponent(lesson.parentContentId)}/aulas/${encodeURIComponent(lesson.moduleId)}?lessonId=${encodeURIComponent(lesson.id)}`,
    accessPreviewMode
  );
}

function matchesQuery(values: Array<string | undefined>, query: string) {
  if (!query) {
    return true;
  }

  return values.some((value) => value?.toLowerCase().includes(query));
}

function FavoriteContentCard({ accessPreviewMode, item }: { accessPreviewMode?: AccessPreviewMode; item: ContentItem }) {
  const targetType = getSavedTargetTypeForContentKind(item.kind);

  return (
    <article className="group relative overflow-hidden rounded-[8px] bg-[#181818] shadow-2xl shadow-black/30 transition hover:-translate-y-1 hover:shadow-[0_34px_90px_rgba(0,0,0,0.68)]">
      <Link
        aria-label={`Abrir ${item.title}`}
        className="block outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        href={getContentHref(item, accessPreviewMode)}
      >
        <div className="relative aspect-[720/1040] overflow-hidden bg-[#101010]">
          <div
            className="absolute inset-0 bg-cover bg-center transition duration-700 group-hover:scale-[1.035]"
            style={{ backgroundImage: `url(${item.image})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/78 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase text-zinc-300">
              <span>{item.kind}</span>
              <span className="h-1 w-1 rounded-full bg-zinc-500" />
              <span>{item.status}</span>
            </div>
            <h2 className="line-clamp-2 text-lg font-black leading-tight text-white">{item.title}</h2>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-300">{item.description ?? item.eyebrow}</p>
            <span className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-[8px] bg-white px-4 py-2 text-sm font-extrabold text-black transition group-hover:bg-zinc-200">
              <Play className="h-4 w-4 fill-current" />
              {item.isLocked ? item.purchaseLabel ?? "Ver detalhes" : "Acessar"}
            </span>
          </div>
        </div>
      </Link>
      <SavedItemButton
        className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full border-2 transition"
        iconClassName="h-5 w-5"
        initialSaved
        targetId={item.id}
        targetTitle={item.title}
        targetType={targetType}
      />
    </article>
  );
}

function FavoriteModuleCard({ accessPreviewMode, module }: { accessPreviewMode?: AccessPreviewMode; module: SavedModuleItem }) {
  return (
    <article className="group relative overflow-hidden rounded-[8px] bg-[#181818] shadow-2xl shadow-black/30 transition hover:-translate-y-1 hover:shadow-[0_34px_90px_rgba(0,0,0,0.68)]">
      <Link
        aria-label={`Abrir ${module.title}`}
        className="block outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        href={getModuleHref(module, accessPreviewMode)}
      >
        <div className="relative aspect-[720/1040] overflow-hidden bg-[#101010]">
          <div
            className="absolute inset-0 bg-cover bg-center transition duration-700 group-hover:scale-[1.035]"
            style={{ backgroundImage: `url(${module.image})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/78 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-4">
            <p className="text-[11px] font-bold uppercase text-zinc-300">{module.parentContentTitle}</p>
            <h2 className="mt-2 line-clamp-2 text-lg font-black leading-tight text-white">{module.title}</h2>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-300">{module.description}</p>
            <span className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-[8px] bg-white px-4 py-2 text-sm font-extrabold text-black transition group-hover:bg-zinc-200">
              <Layers3 className="h-4 w-4" />
              {module.meta}
            </span>
          </div>
        </div>
      </Link>
      <SavedItemButton
        className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full border-2 transition"
        iconClassName="h-5 w-5"
        initialSaved
        targetId={module.id}
        targetTitle={module.title}
        targetType="module"
      />
    </article>
  );
}

function FavoriteLessonCard({ accessPreviewMode, lesson }: { accessPreviewMode?: AccessPreviewMode; lesson: SavedLessonItem }) {
  return (
    <article className="group relative overflow-hidden rounded-[8px] bg-[#181818] shadow-2xl shadow-black/30 transition hover:-translate-y-1 hover:shadow-[0_34px_90px_rgba(0,0,0,0.68)]">
      <Link
        aria-label={`Abrir ${lesson.title}`}
        className="block outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        href={getLessonHref(lesson, accessPreviewMode)}
      >
        <div className="relative aspect-video overflow-hidden bg-[#101010]">
          <div
            className="absolute inset-0 bg-cover bg-center transition duration-700 group-hover:scale-[1.035]"
            style={{ backgroundImage: `url(${lesson.image})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/72 to-transparent" />
          <span className="absolute left-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white text-black shadow-xl shadow-black/30">
            <Play className="h-4 w-4 fill-current" />
          </span>
        </div>
        <div className="p-4">
          <p className="text-[11px] font-bold uppercase text-zinc-400">{lesson.parentContentTitle}</p>
          <h2 className="mt-2 line-clamp-2 text-lg font-black leading-tight text-white">{lesson.title}</h2>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-400">{lesson.description}</p>
          <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-zinc-300">
            <Clock3 className="h-4 w-4 text-zinc-500" />
            <span>{lesson.duration}</span>
            <span className="h-1 w-1 rounded-full bg-zinc-500" />
            <span className="line-clamp-1">{lesson.moduleTitle}</span>
          </div>
        </div>
      </Link>
      <SavedItemButton
        className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full border-2 transition"
        iconClassName="h-5 w-5"
        initialSaved
        targetId={lesson.id}
        targetTitle={lesson.title}
        targetType="lesson"
      />
    </article>
  );
}

export function FavoritesExperience({
  accessPreviewMode,
  contentItems,
  lessonItems,
  moduleItems
}: FavoritesExperienceProps) {
  const [activeFilter, setActiveFilter] = useState<FavoriteFilter>("all");
  const [query, setQuery] = useState("");
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    function handleSavedItemChanged(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null;

      if (!detail?.targetId || !detail?.targetType || typeof detail.saved !== "boolean") {
        return;
      }

      const key = getSavedItemKey(detail.targetType, detail.targetId);

      setHiddenKeys((current) => {
        const next = new Set(current);

        if (detail.saved) {
          next.delete(key);
        } else {
          next.add(key);
        }

        return next;
      });
    }

    window.addEventListener(savedItemChangedEvent, handleSavedItemChanged);

    return () => {
      window.removeEventListener(savedItemChangedEvent, handleSavedItemChanged);
    };
  }, []);

  const visibleContentItems = useMemo(() => contentItems.filter((item) => (
    !hiddenKeys.has(getSavedItemKey(getSavedTargetTypeForContentKind(item.kind), item.id)) &&
    matchesQuery([item.title, item.eyebrow, item.description, item.kind], normalizedQuery)
  )), [contentItems, hiddenKeys, normalizedQuery]);

  const visibleModuleItems = useMemo(() => moduleItems.filter((module) => (
    !hiddenKeys.has(getSavedItemKey("module", module.id)) &&
    matchesQuery([module.title, module.description, module.parentContentTitle, module.meta], normalizedQuery)
  )), [hiddenKeys, moduleItems, normalizedQuery]);

  const visibleLessonItems = useMemo(() => lessonItems.filter((lesson) => (
    !hiddenKeys.has(getSavedItemKey("lesson", lesson.id)) &&
    matchesQuery([lesson.title, lesson.description, lesson.parentContentTitle, lesson.moduleTitle], normalizedQuery)
  )), [hiddenKeys, lessonItems, normalizedQuery]);

  const showContent = activeFilter === "all" || activeFilter === "content";
  const showLessons = activeFilter === "all" || activeFilter === "lessons";
  const showModules = activeFilter === "all" || activeFilter === "modules";
  const totalVisible = visibleContentItems.length + visibleModuleItems.length + visibleLessonItems.length;
  const totalSaved = contentItems.length + moduleItems.length + lessonItems.length;

  return (
    <section className="min-h-screen bg-[#141414] px-5 pb-24 pt-28 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[104rem]">
        <div className="max-w-4xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-[6px] border border-white/10 bg-white/[0.055] px-3 py-2 text-xs font-bold uppercase text-zinc-300">
            <Bookmark className="h-4 w-4 text-[var(--accent)]" />
            Favoritos
          </div>
          <h1 className="text-4xl font-black leading-none text-white sm:text-5xl lg:text-6xl">Favoritos</h1>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base sm:leading-7">
            Cursos, produtos, modulos e aulas que voce salvou para voltar depois.
          </p>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[8px] border border-white/10 bg-white/[0.045] p-4">
            <p className="text-2xl font-black leading-none text-white">{totalSaved}</p>
            <p className="mt-1 text-xs font-semibold text-zinc-400">Itens salvos</p>
          </div>
          <div className="rounded-[8px] border border-white/10 bg-white/[0.045] p-4">
            <p className="text-2xl font-black leading-none text-white">{lessonItems.length}</p>
            <p className="mt-1 text-xs font-semibold text-zinc-400">Aulas salvas</p>
          </div>
          <div className="rounded-[8px] border border-white/10 bg-white/[0.045] p-4">
            <p className="text-2xl font-black leading-none text-white">{contentItems.length}</p>
            <p className="mt-1 text-xs font-semibold text-zinc-400">Conteudos salvos</p>
          </div>
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
            <span className="sr-only">Buscar nos favoritos</span>
            <input
              className="min-w-0 flex-1 border-0 bg-transparent text-white outline-none placeholder:text-zinc-500"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar nos favoritos..."
              type="search"
              value={query}
            />
          </label>
        </div>

        {totalVisible > 0 ? (
          <div className="mt-8 space-y-12">
            {showContent && visibleContentItems.length > 0 ? (
              <section>
                <div className="mb-4 flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-zinc-500" />
                  <h2 className="text-2xl font-black text-white">Conteudos</h2>
                </div>
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {visibleContentItems.map((item) => (
                    <FavoriteContentCard accessPreviewMode={accessPreviewMode} item={item} key={item.id} />
                  ))}
                </div>
              </section>
            ) : null}

            {showModules && visibleModuleItems.length > 0 ? (
              <section>
                <div className="mb-4 flex items-center gap-2">
                  <Layers3 className="h-5 w-5 text-zinc-500" />
                  <h2 className="text-2xl font-black text-white">Modulos</h2>
                </div>
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {visibleModuleItems.map((module) => (
                    <FavoriteModuleCard accessPreviewMode={accessPreviewMode} key={module.id} module={module} />
                  ))}
                </div>
              </section>
            ) : null}

            {showLessons && visibleLessonItems.length > 0 ? (
              <section>
                <div className="mb-4 flex items-center gap-2">
                  <Play className="h-5 w-5 text-zinc-500" />
                  <h2 className="text-2xl font-black text-white">Aulas</h2>
                </div>
                <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
                  {visibleLessonItems.map((lesson) => (
                    <FavoriteLessonCard accessPreviewMode={accessPreviewMode} key={lesson.id} lesson={lesson} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="mt-8 rounded-[8px] border border-white/10 bg-white/[0.04] px-6 py-12 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-[8px] bg-white/10 text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-xl font-black text-white">Nenhum favorito encontrado</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">
              Salve cursos, modulos ou aulas para montar uma lista rapida de retorno.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

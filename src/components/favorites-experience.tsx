"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, CircleCheck, CirclePlay, LockKeyhole, SearchX } from "lucide-react";
import { MemberButton, MemberButtonLink } from "@/components/member/ui/member-button";
import { MemberChip } from "@/components/member/ui/member-chip";
import { MemberEmptyState } from "@/components/member/ui/member-empty-state";
import { MemberFilterPills, MemberSearchField, type MemberFilterOption } from "@/components/member/ui/member-filters";
import { MemberLessonCard, memberLessonGridClassName } from "@/components/member/ui/member-lesson-card";
import { MemberPage, MemberPageHeader, MemberSection } from "@/components/member/ui/member-page";
import { MemberPosterCard, memberPosterGridClassName } from "@/components/member/ui/member-poster-card";
import { SavedItemButton, savedItemChangedEvent } from "@/components/saved-item-button";
import { formatMemberCount } from "@/lib/member-format";
import { getSavedItemKey } from "@/lib/saved-items";
import { cn } from "@/lib/utils";
import type { FavoriteItemKind, FavoriteItemView, FavoriteKindFilter, FavoritesPageView } from "@/server/member-area/favorites-view";
import { normalizeMemberSearchText } from "@/server/member-area/purchases-view";

// Favoritos (cliente leve): recebe so o recorte montado no servidor (buildFavoritesPageView). Remover
// tira o item da tela na hora (ouve savedItemChangedEvent); se o servidor recusar, o botao avisa de
// volta e o item reaparece. Favoritar nao libera acesso: item sem acesso fica marcado "Sem acesso".

type FavoritesExperienceProps = {
  view: FavoritesPageView;
};

const kindFilterLabels: Record<FavoriteKindFilter, string> = {
  all: "Todos",
  content: "Conteúdos",
  lesson: "Aulas",
  module: "Módulos"
};

const sectionTitles: Record<FavoriteItemKind, string> = {
  content: "Conteúdos",
  lesson: "Aulas",
  module: "Módulos"
};

// Capa parada no hover: o botao de remover fica fora do link e nao acompanharia o card subindo.
const keepPosterInPlaceClassName = "[&>a>div]:translate-none!";

function RemoveFavoriteButton({ item }: { item: FavoriteItemView }) {
  return (
    <SavedItemButton
      className="grid size-9 place-items-center rounded-full border-2 backdrop-blur-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      iconClassName="size-4"
      initialSaved
      targetId={item.targetId}
      targetTitle={item.title}
      targetType={item.targetType}
    />
  );
}

function FavoriteStatusLine({ item }: { item: FavoriteItemView }) {
  if (!item.canOpen) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-zinc-400">
        <LockKeyhole aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.2} />
        <span className="truncate">Ver detalhes do produto</span>
      </span>
    );
  }

  if (item.releaseLabel) {
    return (
      <span className="inline-flex min-w-0 items-start gap-1.5 text-amber-200">
        <LockKeyhole aria-hidden="true" className="mt-px size-3.5 shrink-0" strokeWidth={2.2} />
        <span className="min-w-0">{item.releaseLabel}</span>
      </span>
    );
  }

  if (item.progress?.completed) {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-300">
        <CircleCheck aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.2} />
        {item.statusLabel ?? "Concluído"}
      </span>
    );
  }

  if (item.progress) {
    return (
      <span className="inline-flex items-center gap-1.5 text-zinc-300">
        <CirclePlay aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.2} />
        {item.statusLabel ?? "Em andamento"} · {item.progress.percent}%
      </span>
    );
  }

  return null;
}

function FavoritePosterCard({ item, priority }: { item: FavoriteItemView; priority: boolean }) {
  const meta = item.kind === "module"
    ? [item.context, item.meta].filter(Boolean).join(" · ")
    : item.meta ?? item.context;

  return (
    <MemberPosterCard
      ariaLabel={item.canOpen ? `Abrir ${item.title}` : `${item.title}. Sem acesso: ver detalhes do produto`}
      badge={
        <>
          <MemberChip tone="solid">{item.kindLabel}</MemberChip>
          {!item.canOpen ? (
            <MemberChip className="bg-black/75 backdrop-blur" icon={LockKeyhole} tone="warning">
              Sem acesso
            </MemberChip>
          ) : null}
        </>
      }
      className={cn(keepPosterInPlaceClassName, !item.canOpen && "[&_img]:brightness-75 [&_img]:grayscale")}
      cornerAction={<RemoveFavoriteButton item={item} />}
      footer={<FavoriteStatusLine item={item} />}
      href={item.href}
      image={item.image}
      meta={meta || undefined}
      priority={priority}
      progress={item.progress ? { label: `Seu progresso em ${item.title}: ${item.progress.percent}%`, value: item.progress.percent } : undefined}
      title={item.title}
    />
  );
}

function FavoriteLessonCard({ item }: { item: FavoriteItemView }) {
  const meta = item.progress?.completed ? (
    <span className="inline-flex items-center gap-1 text-emerald-300">
      <CircleCheck aria-hidden="true" className="size-3.5" strokeWidth={2.2} />
      Concluída
    </span>
  ) : item.meta;

  return (
    <MemberLessonCard
      context={item.context}
      cornerAction={<RemoveFavoriteButton item={item} />}
      href={item.href}
      image={item.image}
      locked={!item.canOpen ? { label: "Sem acesso" } : item.releaseLabel ? { label: item.releaseLabel } : undefined}
      meta={meta ?? undefined}
      progress={item.progress ? { label: `Seu progresso em ${item.title}: ${item.progress.percent}%`, value: item.progress.percent } : undefined}
      thumbnailLabel={item.thumbnailLabel ?? undefined}
      title={item.title}
    />
  );
}

export function FavoritesExperience({ view }: FavoritesExperienceProps) {
  const [kindFilter, setKindFilter] = useState<FavoriteKindFilter>("all");
  const [query, setQuery] = useState("");
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState("");
  const hiddenKeysRef = useRef(hiddenKeys);
  const restoreFocusRef = useRef(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = normalizeMemberSearchText(query);
  const titlesByKey = useMemo(() => new Map(view.items.map((item) => [item.key, item.title])), [view.items]);

  useEffect(() => {
    hiddenKeysRef.current = hiddenKeys;

    // O botao clicado saiu da tela junto com o card: o foco volta para a lista, nao para o topo da pagina.
    if (restoreFocusRef.current) {
      restoreFocusRef.current = false;

      if (document.activeElement === document.body) {
        resultsRef.current?.focus({ preventScroll: true });
      }
    }
  }, [hiddenKeys]);

  useEffect(() => {
    function handleSavedItemChanged(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null;

      if (!detail?.targetId || !detail?.targetType || typeof detail.saved !== "boolean") {
        return;
      }

      const key = getSavedItemKey(detail.targetType, detail.targetId);
      const title = titlesByKey.get(key);
      const wasHidden = hiddenKeysRef.current.has(key);

      if (!detail.saved && !wasHidden && titlesByKey.has(key)) {
        restoreFocusRef.current = true;
      }

      setHiddenKeys((current) => {
        if (detail.saved ? !current.has(key) : current.has(key)) {
          return current;
        }

        const next = new Set(current);

        if (detail.saved) {
          next.delete(key);
        } else {
          next.add(key);
        }

        return next;
      });

      if (title) {
        setAnnouncement(
          detail.saved
            ? wasHidden
              ? `Não foi possível remover ${title}. Ele continua nos favoritos.`
              : ""
            : `${title} saiu dos favoritos.`
        );
      }
    }

    window.addEventListener(savedItemChangedEvent, handleSavedItemChanged);

    return () => {
      window.removeEventListener(savedItemChangedEvent, handleSavedItemChanged);
    };
  }, [titlesByKey]);

  const visibleItems = useMemo(() => view.items.filter((item) => !hiddenKeys.has(item.key)), [hiddenKeys, view.items]);

  const kindOptions = useMemo<MemberFilterOption<FavoriteKindFilter>[]>(() => {
    const counts: Record<FavoriteKindFilter, number> = { all: visibleItems.length, content: 0, lesson: 0, module: 0 };

    for (const item of visibleItems) {
      counts[item.kind] += 1;
    }

    return (["all", "content", "module", "lesson"] as const)
      .filter((id) => id === "all" || id === kindFilter || counts[id] > 0)
      .map((id) => ({ count: counts[id], id, label: kindFilterLabels[id] }));
  }, [kindFilter, visibleItems]);

  const matchingItems = useMemo(() => visibleItems.filter((item) => (
    (kindFilter === "all" || item.kind === kindFilter) &&
    (!normalizedQuery || item.searchText.includes(normalizedQuery))
  )), [kindFilter, normalizedQuery, visibleItems]);

  const sections = (["content", "module", "lesson"] as const)
    .map((kind) => ({ items: matchingItems.filter((item) => item.kind === kind), kind }))
    .filter((section) => section.items.length > 0);

  const isFiltering = kindFilter !== "all" || Boolean(normalizedQuery);

  function clearFilters() {
    setKindFilter("all");
    setQuery("");
  }

  return (
    <MemberPage>
      <MemberPageHeader
        description="Cursos, módulos e aulas que você salvou para voltar depois."
        eyebrow={{ icon: Bookmark, label: "Sua lista" }}
        title="Favoritos"
      />

      {visibleItems.length === 0 ? (
        <MemberEmptyState
          action={
            <MemberButtonLink href={view.exploreHref} variant="primary">
              Explorar a página inicial
            </MemberButtonLink>
          }
          description="Use o botão de salvar (o marcador) nos cursos, módulos e aulas para guardar aqui o que você quer ver depois."
          icon={Bookmark}
          title="Você ainda não salvou nada"
        />
      ) : (
        <>
          <div className="mb-6 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <MemberFilterPills
              ariaLabel="Filtrar favoritos por tipo"
              className="min-w-0"
              onChange={setKindFilter}
              options={kindOptions}
              value={kindFilter}
            />
            <MemberSearchField
              className="sm:w-72 sm:max-w-none sm:shrink-0"
              label="Buscar nos favoritos"
              onChange={setQuery}
              placeholder="Buscar nos favoritos..."
              value={query}
            />
          </div>

          <p className={isFiltering ? "mb-4 text-xs font-medium text-zinc-500" : "sr-only"}>
            {isFiltering
              ? `${matchingItems.length.toLocaleString("pt-BR")} de ${formatMemberCount(visibleItems.length, "item", "itens")}`
              : formatMemberCount(visibleItems.length, "item salvo", "itens salvos")}
          </p>

          <div className="outline-none" ref={resultsRef} tabIndex={-1}>
            {sections.length > 0 ? (
              <div className="grid gap-12">
                {sections.map((section) => (
                  <MemberSection count={section.items.length} id={`favoritos-${section.kind}`} key={section.kind} title={sectionTitles[section.kind]}>
                    <ul className={section.kind === "lesson" ? memberLessonGridClassName : memberPosterGridClassName}>
                      {section.items.map((item, index) => (
                        <li className="min-w-0" key={item.key}>
                          {section.kind === "lesson" ? (
                            <FavoriteLessonCard item={item} />
                          ) : (
                            <FavoritePosterCard item={item} priority={index < 5 && section === sections[0]} />
                          )}
                        </li>
                      ))}
                    </ul>
                  </MemberSection>
                ))}
              </div>
            ) : (
              <MemberEmptyState
                action={
                  <MemberButton onClick={clearFilters} variant="secondary">
                    Limpar filtros
                  </MemberButton>
                }
                description="Nenhum favorito combina com a busca e o filtro escolhidos."
                icon={SearchX}
                title="Nada encontrado"
              />
            )}
          </div>
        </>
      )}

      <p aria-live="polite" className="sr-only" role="status">
        {announcement}
      </p>
    </MemberPage>
  );
}

"use client";

import { Bell, ChevronLeft, ChevronRight, Lock, Play, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cardActionClassName } from "@/components/card-action-style";
import { ContentDetailsModal } from "@/components/content-details-modal";
import { ContinueWatchingCard, VerticalCoverCard } from "@/components/content-card";
import { savedItemChangedEvent } from "@/components/saved-item-button";
import { withAccessPreviewParam } from "@/lib/access-preview";
import { getReleaseRuleNotice } from "@/lib/release-rules";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { getSavedItemKey, getSavedTargetTypeForContentKind } from "@/lib/saved-items";
import type { ContentItem, ContentModalStructure, CourseModule, LockedContentActionMode } from "@/lib/platform-types";

type ContentRowProps = {
  accessPreviewMode?: AccessPreviewMode;
  title: string;
  subtitle?: string;
  items: ContentItem[];
  modalStructures?: Record<string, ContentModalStructure>;
  variant?: "continue" | "vertical";
};

type CourseModulesHomeSectionProps = {
  accessPreviewMode?: AccessPreviewMode;
  course: ContentItem;
  lockedActionMode?: LockedContentActionMode;
  modules: CourseModule[];
  subtitle?: string;
  title: string;
};

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-white/20">
      <div
        className="h-full rounded-full bg-[var(--accent)]"
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
      />
    </div>
  );
}

const homeRowCardHoverScale = 1.14;

function syncHomeRowHoverEdges(row: HTMLDivElement | null) {
  if (!row) {
    return;
  }

  const cards = Array.from(row.querySelectorAll<HTMLElement>("[data-home-row-card]"));

  for (const card of cards) {
    card.removeAttribute("data-hover-edge");
    card.style.removeProperty("--home-row-card-hover-shift-x");
    card.style.removeProperty("--home-row-card-hover-logo-shift-x");
  }

  if (cards.length === 0) {
    return;
  }

  const rowRect = row.getBoundingClientRect();
  const rowStyle = window.getComputedStyle(row);
  const leftBoundary = rowRect.left + (Number.parseFloat(rowStyle.paddingLeft) || 0);
  const rightBoundary = rowRect.right - (Number.parseFloat(rowStyle.paddingRight) || 0);
  const edgeTolerance = 2;
  const visibleCards = cards.filter((card) => {
    const cardRect = card.getBoundingClientRect();

    return cardRect.right > leftBoundary + edgeTolerance && cardRect.left < rightBoundary - edgeTolerance;
  });

  const leftEdgeCard =
    visibleCards.find((card) => card.getBoundingClientRect().left <= leftBoundary + edgeTolerance) ??
    (row.scrollLeft <= edgeTolerance ? cards[0] : undefined);
  let rightEdgeCard: HTMLElement | undefined;

  for (let index = visibleCards.length - 1; index >= 0; index -= 1) {
    const card = visibleCards[index];

    if (card.getBoundingClientRect().right >= rightBoundary - edgeTolerance) {
      rightEdgeCard = card;
      break;
    }
  }

  if (!rightEdgeCard && row.scrollWidth - row.clientWidth - row.scrollLeft <= edgeTolerance) {
    rightEdgeCard = cards[cards.length - 1];
  }

  if (leftEdgeCard) {
    const leftEdgeRect = leftEdgeCard.getBoundingClientRect();
    const leftHiddenOffset = Math.max(leftBoundary - leftEdgeRect.left, 0);

    leftEdgeCard.setAttribute("data-hover-edge", "left");
    leftEdgeCard.style.setProperty("--home-row-card-hover-shift-x", `${leftHiddenOffset}px`);
    leftEdgeCard.style.setProperty("--home-row-card-hover-logo-shift-x", `${leftHiddenOffset}px`);
  }

  if (rightEdgeCard && rightEdgeCard !== leftEdgeCard) {
    const rightEdgeRect = rightEdgeCard.getBoundingClientRect();
    const rightHiddenOffset = Math.max(rightEdgeRect.right - rightBoundary, 0);
    const rightLogoShiftX = Math.round((-rightHiddenOffset - rightEdgeRect.width * (homeRowCardHoverScale - 1)) * 100) / 100;

    rightEdgeCard.setAttribute("data-hover-edge", "right");
    rightEdgeCard.style.setProperty("--home-row-card-hover-shift-x", `${-rightHiddenOffset}px`);
    rightEdgeCard.style.setProperty("--home-row-card-hover-logo-shift-x", `${rightLogoShiftX}px`);
  }
}

function CourseModuleHomeCard({
  accessPreviewMode,
  course,
  module,
  onOpenCourseDetails
}: {
  accessPreviewMode?: AccessPreviewMode;
  course: ContentItem;
  module: CourseModule;
  onOpenCourseDetails: () => void;
}) {
  const releaseNotice = getReleaseRuleNotice(module.releaseRule, "modulo");
  const isLocked = Boolean(course.isLocked || releaseNotice?.isLocked);
  const href = withAccessPreviewParam(`/conteudo/${course.id}/aulas/${module.id}`, accessPreviewMode);
  const imageStateClass = isLocked
    ? "grayscale saturate-0 contrast-110 brightness-75 group-hover:grayscale-0 group-hover:saturate-100 group-hover:contrast-100 group-hover:brightness-100"
    : "";
  const content = (
    <>
      <div className="home-cover-card-surface absolute inset-0 z-0 w-full shadow-2xl shadow-black/35">
        <div className="relative h-full w-full">
          <div
            className={`home-cover-card-image absolute inset-0 bg-cover bg-center ${imageStateClass}`}
            style={{ backgroundImage: `url(${module.image})` }}
          />
          {isLocked ? (
            <div className="absolute right-2 top-2 z-30 grid h-7 w-7 place-items-center rounded-full bg-black/65 text-white shadow-[0_8px_20px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-[2px] sm:right-2.5 sm:top-2.5 sm:h-8 sm:w-8 md:h-9 md:w-9">
              <Lock className="h-3.5 w-3.5 stroke-[3] sm:h-4 sm:w-4 md:h-[1.05rem] md:w-[1.05rem]" aria-hidden="true" />
              <span className="sr-only">Modulo bloqueado</span>
            </div>
          ) : null}
          <div className="home-cover-card-overlay absolute inset-0 z-10" />
          <div className="home-cover-card-gradient absolute inset-x-0 bottom-0 z-10 h-[76%] bg-gradient-to-t from-black via-black/90 to-transparent" />
          <div className="home-cover-card-content absolute inset-x-0 bottom-3 z-20 p-3">
            <h3 className="line-clamp-2 text-sm font-bold leading-tight text-white drop-shadow">
              {module.title}
            </h3>
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between gap-2 text-[11px] font-medium text-zinc-300">
                <span className="line-clamp-1">{module.meta}</span>
                <span className="shrink-0 text-white">{Math.round(module.progress)}%</span>
              </div>
              <ProgressBar value={module.progress} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
  const className =
    `home-cover-card home-row-cover-card group relative aspect-[720/1040] w-[10.25rem] shrink-0 overflow-visible outline-none hover:z-[120] focus-visible:ring-2 focus-visible:ring-white/70 sm:w-[12.25rem] md:w-[14.25rem] lg:w-[16.25rem] xl:w-[17.5rem] ${
      isLocked ? "cursor-not-allowed" : "cursor-pointer"
    }`;

  if (isLocked) {
    return (
      <button
        aria-label={`Ver detalhes de ${module.title}`}
        className={className}
        data-home-row-card
        onClick={onOpenCourseDetails}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <Link aria-label={`Abrir ${module.title}`} className={className} data-home-row-card href={href} prefetch>
      {content}
    </Link>
  );
}

export function CourseModulesHomeSection({
  accessPreviewMode,
  course,
  lockedActionMode = "details_modal",
  modules,
  subtitle,
  title
}: CourseModulesHomeSectionProps) {
  const router = useRouter();
  const rowRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);
  const [detailsItem, setDetailsItem] = useState<ContentItem | null>(null);

  const updateScrollState = useCallback(() => {
    const row = rowRef.current;

    if (!row) {
      return;
    }

    const maxScrollLeft = Math.max(row.scrollWidth - row.clientWidth, 0);
    const hasOverflow = maxScrollLeft > 4;

    syncHomeRowHoverEdges(row);
    setHasHorizontalOverflow(maxScrollLeft > 4);
    setCanScrollLeft(hasOverflow && row.scrollLeft > 4);
    setCanScrollRight(hasOverflow && row.scrollLeft < maxScrollLeft - 4);
  }, []);

  useEffect(() => {
    const row = rowRef.current;

    updateScrollState();

    if (!row) {
      return;
    }

    row.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);

    const timeout = window.setTimeout(updateScrollState, 250);

    return () => {
      row.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
      window.clearTimeout(timeout);
    };
  }, [modules.length, updateScrollState]);

  if (modules.length === 0) {
    return null;
  }

  function scrollRow(direction: "left" | "right") {
    const row = rowRef.current;

    if (!row) {
      return;
    }

    const distance = Math.max(280, row.clientWidth * 0.72);
    row.scrollBy({
      behavior: "smooth",
      left: direction === "right" ? distance : -distance
    });

    window.setTimeout(updateScrollState, 420);
  }

  const courseHref = withAccessPreviewParam(`/conteudo/${course.id}`, accessPreviewMode);
  const releaseNotice = getReleaseRuleNotice(course.releaseRule, course.kind.toLowerCase());
  const isReleaseLocked = Boolean(releaseNotice?.isLocked);
  const isCourseLocked = Boolean(course.isLocked || isReleaseLocked);
  const actionLabel = course.isLocked ? course.purchaseLabel ?? "Comprar" : isReleaseLocked ? "Bloqueado" : "Acessar";
  const CourseActionIcon = course.status === "Em breve" || isReleaseLocked ? Bell : course.isLocked ? ShoppingCart : Play;
  const courseActionClassName = course.isLocked
    ? "bg-emerald-600 text-white shadow-[0_18px_42px_rgba(5,150,105,0.32)] hover:bg-emerald-500"
    : isReleaseLocked
      ? "bg-white/15 text-white hover:bg-white/20"
      : "bg-white text-black hover:bg-zinc-200";

  function openCourseDetails() {
    setDetailsItem(course);
  }

  function openPurchaseUrl() {
    if (!course.purchaseUrl) {
      openCourseDetails();
      return;
    }

    if (course.purchaseTarget === "new_tab") {
      window.open(course.purchaseUrl, "_blank", "noopener,noreferrer");
      return;
    }

    window.location.href = course.purchaseUrl;
  }

  function openCourseAction() {
    if (!isCourseLocked) {
      router.push(courseHref);
      return;
    }

    if (course.isLocked && lockedActionMode === "external_link") {
      openPurchaseUrl();
      return;
    }

    openCourseDetails();
  }

  function prefetchCourseAction() {
    if (!isCourseLocked) {
      router.prefetch(courseHref);
    }
  }

  return (
    <section className="relative">
      <div className="mb-5 flex items-end justify-between gap-4 px-5 sm:px-8 lg:px-12">
        <div className="flex min-w-0 items-center gap-4">
          <button
            aria-label={`${actionLabel} ${title}`}
            className="group/course relative aspect-[720/1040] w-16 shrink-0 overflow-hidden rounded-[8px] bg-[#181818] shadow-2xl shadow-black/35 outline-none transition duration-500 ease-out hover:-translate-y-0.5 hover:scale-[1.035] hover:shadow-[0_20px_60px_rgba(0,0,0,0.62)] focus-visible:ring-2 focus-visible:ring-white/70 sm:w-20 lg:w-24"
            onClick={openCourseAction}
            onFocus={prefetchCourseAction}
            onMouseEnter={prefetchCourseAction}
            type="button"
          >
            <div
              className={`absolute inset-0 bg-cover bg-center transition duration-700 group-hover/course:scale-[1.035] ${
                course.isLocked ? "grayscale saturate-0 contrast-110 brightness-75 group-hover/course:grayscale-0 group-hover/course:saturate-100 group-hover/course:contrast-100 group-hover/course:brightness-100" : ""
              }`}
              style={{ backgroundImage: `url(${course.image})` }}
            />
            <div className="absolute inset-0 bg-black/0 transition duration-300 group-hover/course:bg-black/18" />
            {isCourseLocked ? (
              <div className="absolute right-1 top-1 z-10 grid h-5 w-5 place-items-center rounded-full bg-black/65 text-white shadow-[0_4px_12px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-[2px] sm:right-1.5 sm:top-1.5 sm:h-6 sm:w-6 lg:h-7 lg:w-7">
                <Lock className="h-2.5 w-2.5 stroke-[3] sm:h-3 sm:w-3 lg:h-3.5 lg:w-3.5" aria-hidden="true" />
                <span className="sr-only">Curso bloqueado</span>
              </div>
            ) : null}
          </button>
          <div className="min-w-0">
            <p className="text-xs font-medium text-zinc-500">{subtitle ?? "Cursos Online"}</p>
            <h2 className="mt-1 line-clamp-2 text-xl font-medium leading-tight text-white sm:text-2xl">
              {title}
            </h2>
            {isReleaseLocked ? (
              <p className="mt-2 line-clamp-2 max-w-md text-xs font-semibold leading-5 text-zinc-400">
                {releaseNotice?.detail ?? "Disponivel de acordo com a regra de entrega."}
              </p>
            ) : null}
            <button
              className={`${cardActionClassName} mt-3 flex-none rounded-[6px] ${courseActionClassName}`}
              onClick={course.isLocked ? openPurchaseUrl : openCourseAction}
              onFocus={prefetchCourseAction}
              onMouseEnter={prefetchCourseAction}
              type="button"
            >
              <CourseActionIcon className="h-3.5 w-3.5 fill-current sm:h-4 sm:w-4" />
              {actionLabel}
            </button>
          </div>
        </div>
        {hasHorizontalOverflow ? (
          <div className="flex shrink-0 items-center gap-2">
            <button
              aria-label={`Ver modulos anteriores de ${title}`}
              className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/10 text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-white/10 lg:h-9 lg:w-9"
              disabled={!canScrollLeft}
              onClick={() => scrollRow("left")}
              type="button"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              aria-label={`Ver proximos modulos de ${title}`}
              className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/10 text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-white/10 lg:h-9 lg:w-9"
              disabled={!canScrollRight}
              onClick={() => scrollRow("right")}
              type="button"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
      <div
        className="scrollbar-hidden -my-4 flex scroll-smooth gap-[1.5rem] overflow-x-auto overflow-y-visible overscroll-x-contain px-5 py-4 sm:-my-14 sm:px-8 sm:py-14 lg:px-12"
        ref={rowRef}
      >
        {modules.map((module) => (
          <CourseModuleHomeCard
            accessPreviewMode={accessPreviewMode}
            course={course}
            key={module.id}
            module={module}
            onOpenCourseDetails={openCourseDetails}
          />
        ))}
      </div>
      <ContentDetailsModal
        accessPreviewMode={accessPreviewMode}
        item={detailsItem}
        onClose={() => setDetailsItem(null)}
        structure={{
          formationCourses: [],
          modules
        }}
      />
    </section>
  );
}

export function ContentRow({ accessPreviewMode, title, subtitle, items, modalStructures = {}, variant = "vertical" }: ContentRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);
  const [savedOverrides, setSavedOverrides] = useState<Record<string, boolean>>({});
  const rowGap = variant === "vertical" ? "gap-[0.75rem]" : "gap-[1.5rem]";
  const scrollPadding = variant === "vertical" ? "-my-4 py-4 sm:-my-14 sm:py-14" : "-my-3 py-3 sm:-my-6 sm:py-6";
  const itemsWithSavedState = items.map((item) => {
    const key = getSavedItemKey(getSavedTargetTypeForContentKind(item.kind), item.id);

    if (!(key in savedOverrides)) {
      return item;
    }

    return {
      ...item,
      isSaved: savedOverrides[key] || undefined
    };
  });
  const selectedItemWithSavedState = selectedItem
    ? itemsWithSavedState.find((item) => item.id === selectedItem.id) ?? selectedItem
    : null;

  const updateScrollState = useCallback(() => {
    const row = rowRef.current;

    if (!row) {
      return;
    }

    const maxScrollLeft = Math.max(row.scrollWidth - row.clientWidth, 0);
    const hasOverflow = maxScrollLeft > 4;

    syncHomeRowHoverEdges(row);
    setHasHorizontalOverflow(maxScrollLeft > 4);
    setCanScrollLeft(hasOverflow && row.scrollLeft > 4);
    setCanScrollRight(hasOverflow && row.scrollLeft < maxScrollLeft - 4);
  }, []);

  useEffect(() => {
    const row = rowRef.current;

    updateScrollState();

    if (!row) {
      return;
    }

    row.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);

    const timeout = window.setTimeout(updateScrollState, 250);

    return () => {
      row.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
      window.clearTimeout(timeout);
    };
  }, [items.length, updateScrollState]);

  useEffect(() => {
    function handleSavedItemChanged(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null;

      if (!detail?.targetId || !detail?.targetType || typeof detail.saved !== "boolean") {
        return;
      }

      setSavedOverrides((current) => ({
        ...current,
        [getSavedItemKey(detail.targetType, detail.targetId)]: detail.saved
      }));
    }

    window.addEventListener(savedItemChangedEvent, handleSavedItemChanged);

    return () => {
      window.removeEventListener(savedItemChangedEvent, handleSavedItemChanged);
    };
  }, []);

  if (itemsWithSavedState.length === 0) {
    return null;
  }

  function scrollRow(direction: "left" | "right") {
    const row = rowRef.current;

    if (!row) {
      return;
    }

    const distance = Math.max(320, row.clientWidth * 0.78);
    row.scrollBy({
      behavior: "smooth",
      left: direction === "right" ? distance : -distance
    });

    window.setTimeout(updateScrollState, 420);
  }

  return (
    <section className="relative">
      <div className="mb-4 flex items-end justify-between gap-4 px-5 sm:px-8 lg:px-12">
        <div>
          <h2 className="text-xl font-semibold text-white sm:text-2xl">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-zinc-400">{subtitle}</p> : null}
        </div>
        {hasHorizontalOverflow ? (
          <div className="flex shrink-0 items-center gap-2">
            <button
              aria-label={`Ver cards anteriores de ${title}`}
              className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/10 text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-white/10 lg:h-9 lg:w-9"
              disabled={!canScrollLeft}
              onClick={() => scrollRow("left")}
              type="button"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              aria-label={`Ver proximos cards de ${title}`}
              className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/10 text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-white/10 lg:h-9 lg:w-9"
              disabled={!canScrollRight}
              onClick={() => scrollRow("right")}
              type="button"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
      <div
        className={`scrollbar-hidden flex scroll-smooth ${rowGap} overflow-x-auto overflow-y-visible overscroll-x-contain px-5 sm:px-8 lg:px-12 ${scrollPadding}`}
        ref={rowRef}
      >
        {itemsWithSavedState.map((item) => (
          variant === "continue" ? (
            <ContinueWatchingCard accessPreviewMode={accessPreviewMode} item={item} key={item.id} />
          ) : (
            <VerticalCoverCard accessPreviewMode={accessPreviewMode} item={item} key={item.id} onOpenDetails={setSelectedItem} />
          )
        ))}
      </div>
      <ContentDetailsModal
        accessPreviewMode={accessPreviewMode}
        item={selectedItemWithSavedState}
        onClose={() => setSelectedItem(null)}
        structure={selectedItemWithSavedState ? modalStructures[selectedItemWithSavedState.id] : undefined}
      />
    </section>
  );
}

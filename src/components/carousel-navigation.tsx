"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

type CarouselMetricsOptions = {
  minScrollDistance: number;
  scrollFraction: number;
};

type CarouselPaginationIndicatorProps = {
  currentPage: number;
  label: string;
  pageCount: number;
};

type CarouselEdgeControlsProps = {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  nextLabel: string;
  onNext: () => void;
  onPrevious: () => void;
  previousLabel: string;
  verticalInset: "compact" | "home" | "internal";
};

export type CarouselMetrics = {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  currentPage: number;
  hasOverflow: boolean;
  pageCount: number;
  scrollDistance: number;
};

export function getCarouselMetrics(
  row: HTMLElement,
  { minScrollDistance, scrollFraction }: CarouselMetricsOptions
): CarouselMetrics {
  const maxScrollLeft = Math.max(row.scrollWidth - row.clientWidth, 0);
  const hasOverflow = maxScrollLeft > 4;
  const scrollDistance = Math.max(minScrollDistance, row.clientWidth * scrollFraction);
  const pagePositions = [0];

  if (hasOverflow) {
    for (let position = scrollDistance; position < maxScrollLeft - 4; position += scrollDistance) {
      pagePositions.push(position);
    }

    if (Math.abs(pagePositions[pagePositions.length - 1] - maxScrollLeft) > 4) {
      pagePositions.push(maxScrollLeft);
    }
  }

  let currentPage = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < pagePositions.length; index += 1) {
    const distance = Math.abs(pagePositions[index] - row.scrollLeft);

    if (distance < closestDistance) {
      closestDistance = distance;
      currentPage = index;
    }
  }

  return {
    canScrollLeft: hasOverflow && row.scrollLeft > 4,
    canScrollRight: hasOverflow && row.scrollLeft < maxScrollLeft - 4,
    currentPage,
    hasOverflow,
    pageCount: pagePositions.length,
    scrollDistance
  };
}

export function CarouselPaginationIndicator({
  currentPage,
  label,
  pageCount
}: CarouselPaginationIndicatorProps) {
  if (pageCount <= 1) {
    return null;
  }

  const segmentCount = Math.min(pageCount, 8);
  const activeSegment = pageCount <= segmentCount
    ? currentPage
    : Math.round((currentPage / Math.max(pageCount - 1, 1)) * (segmentCount - 1));

  return (
    <div
      aria-label={`${label}: pagina ${currentPage + 1} de ${pageCount}`}
      className="flex shrink-0 items-center gap-1 pb-1"
      role="status"
    >
      {Array.from({ length: segmentCount }, (_, index) => (
        <span
          aria-hidden="true"
          className={`h-[3px] w-4 rounded-[1px] transition-colors duration-300 ${
            index === activeSegment ? "bg-zinc-200" : "bg-zinc-600/80"
          }`}
          key={index}
        />
      ))}
    </div>
  );
}

export function CarouselEdgeControls({
  canScrollLeft,
  canScrollRight,
  nextLabel,
  onNext,
  onPrevious,
  previousLabel,
  verticalInset
}: CarouselEdgeControlsProps) {
  if (!canScrollLeft && !canScrollRight) {
    return null;
  }

  const verticalInsetClassName = verticalInset === "home"
    ? "inset-y-4 sm:inset-y-14"
    : verticalInset === "compact"
      ? "inset-y-3 sm:inset-y-6"
      : "inset-y-4";

  return (
    <div className="pointer-events-none absolute inset-0 z-[150]">
      {canScrollLeft ? (
        <>
          <div aria-hidden="true" className={`carousel-edge-fade carousel-edge-fade-left absolute left-0 w-16 sm:w-20 lg:w-24 ${verticalInsetClassName}`} />
          <button
            aria-label={previousLabel}
            className={`carousel-edge-button carousel-edge-button-left pointer-events-auto absolute left-0 grid w-11 place-items-center text-white/75 outline-none transition-colors duration-300 hover:text-white focus-visible:text-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80 sm:w-12 lg:w-14 ${verticalInsetClassName}`}
            onClick={onPrevious}
            type="button"
          >
            <ChevronLeft aria-hidden="true" className="h-8 w-8 stroke-[2.6] drop-shadow-[0_3px_10px_rgba(0,0,0,0.9)] transition-transform duration-300 lg:h-10 lg:w-10" />
          </button>
        </>
      ) : null}

      {canScrollRight ? (
        <>
          <div aria-hidden="true" className={`carousel-edge-fade carousel-edge-fade-right absolute right-0 w-16 sm:w-20 lg:w-24 ${verticalInsetClassName}`} />
          <button
            aria-label={nextLabel}
            className={`carousel-edge-button carousel-edge-button-right pointer-events-auto absolute right-0 grid w-11 place-items-center text-white/75 outline-none transition-colors duration-300 hover:text-white focus-visible:text-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80 sm:w-12 lg:w-14 ${verticalInsetClassName}`}
            onClick={onNext}
            type="button"
          >
            <ChevronRight aria-hidden="true" className="h-8 w-8 stroke-[2.6] drop-shadow-[0_3px_10px_rgba(0,0,0,0.9)] transition-transform duration-300 lg:h-10 lg:w-10" />
          </button>
        </>
      ) : null}
    </div>
  );
}

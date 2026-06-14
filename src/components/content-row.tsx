"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContentDetailsModal } from "@/components/content-details-modal";
import { ContinueWatchingCard, VerticalCoverCard } from "@/components/content-card";
import type { ContentItem } from "@/lib/mock-data";

type ContentRowProps = {
  title: string;
  subtitle?: string;
  items: ContentItem[];
  variant?: "continue" | "vertical";
};

export function ContentRow({ title, subtitle, items, variant = "vertical" }: ContentRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const rowGap = variant === "vertical" ? "gap-[0.75rem]" : "gap-[1.5rem]";
  const scrollPadding = variant === "vertical" ? "-my-4 py-4 sm:-my-14 sm:py-14" : "-my-3 py-3 sm:-my-6 sm:py-6";

  const updateScrollState = useCallback(() => {
    const row = rowRef.current;

    if (!row) {
      return;
    }

    const maxScrollLeft = row.scrollWidth - row.clientWidth;

    setCanScrollLeft(row.scrollLeft > 4);
    setCanScrollRight(row.scrollLeft < maxScrollLeft - 4);
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
      </div>
      <div
        className={`scrollbar-hidden flex scroll-smooth ${rowGap} overflow-x-auto overflow-y-visible overscroll-x-contain px-5 sm:px-8 lg:px-12 ${scrollPadding}`}
        ref={rowRef}
      >
        {items.map((item) => (
          variant === "continue" ? (
            <ContinueWatchingCard item={item} key={item.id} />
          ) : (
            <VerticalCoverCard item={item} key={item.id} onOpenDetails={setSelectedItem} />
          )
        ))}
      </div>
      <ContentDetailsModal item={selectedItem} onClose={() => setSelectedItem(null)} />
    </section>
  );
}

"use client";

import { Bell, Bookmark, ChevronDown, Lock, Play, ShoppingCart } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { cardActionClassName } from "@/components/card-action-style";
import type { KeyboardEvent, MouseEvent, TouchEvent } from "react";
import type { ContentItem } from "@/lib/mock-data";

type CardProps = {
  item: ContentItem;
  onOpenDetails?: (item: ContentItem) => void;
};

function getContentHref(item: ContentItem) {
  return `/conteudo/${item.id}`;
}

function usesTouchCardMode() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.matchMedia("(max-width: 1023px)").matches;
}

export function ContinueWatchingCard({ item }: CardProps) {
  return (
    <article className="group relative w-[16.25rem] shrink-0 overflow-visible hover:z-[80] sm:w-[18.75rem] lg:w-[20.625rem]">
      <button
        aria-label={`Continuar ${item.title}`}
        className="relative block aspect-video w-full text-left"
        type="button"
      >
        <div className="absolute inset-0 z-0 w-full origin-center overflow-hidden rounded-[8px] bg-[#181818] shadow-xl shadow-black/35 transition duration-300 ease-out group-hover:scale-[1.06] group-hover:shadow-[0_22px_70px_rgba(0,0,0,0.62)]">
          <div
            className="absolute inset-0 bg-cover bg-center transition duration-500 group-hover:scale-105"
            style={{ backgroundImage: `url(${item.image})` }}
          />
          <div className="absolute inset-0 bg-black/0 transition duration-300 group-hover:bg-black/18" />
          <span className="absolute left-1/2 top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/92 text-black opacity-0 shadow-xl shadow-black/40 transition group-hover:opacity-100">
            <Play className="h-5 w-5 fill-current" />
          </span>
          <div className="absolute bottom-0 left-0 h-1.5 w-full bg-white/20">
            <div className="h-full bg-[var(--accent)]" style={{ width: `${item.progress}%` }} />
          </div>
        </div>
      </button>
      <div className="relative z-10 mt-3">
        <h3 className="line-clamp-1 text-sm font-semibold text-white">{item.title}</h3>
        <div className="mt-1 flex items-center justify-between gap-3 text-xs text-zinc-400">
          <span className="line-clamp-1">{item.eyebrow}</span>
          <span>{item.lessons}</span>
        </div>
        <p className="mt-1 text-xs font-semibold text-emerald-400">{Math.round(item.progress)}% assistido</p>
      </div>
    </article>
  );
}

export function VerticalCoverCard({ item, onOpenDetails }: CardProps) {
  const router = useRouter();
  const touchStateRef = useRef({
    moved: false,
    startX: 0,
    startY: 0
  });
  const description = item.description ?? item.eyebrow;
  const actionLabel = item.isLocked ? item.purchaseLabel ?? "Comprar" : "Acessar";
  const ActionIcon = item.status === "Em breve" ? Bell : item.isLocked ? ShoppingCart : Play;
  const actionClass = item.isLocked
    ? "bg-emerald-600 text-white shadow-[0_18px_42px_rgba(5,150,105,0.32)] hover:bg-emerald-500"
    : "bg-white text-black hover:bg-zinc-200";
  const imageStateClass = item.isLocked
    ? "grayscale saturate-0 contrast-110 brightness-75 group-hover:grayscale-0 group-hover:saturate-100 group-hover:contrast-100 group-hover:brightness-100"
    : "";

  function openContentPage() {
    router.push(getContentHref(item));
  }

  function openCardDestination() {
    if (onOpenDetails && usesTouchCardMode()) {
      onOpenDetails(item);
      return;
    }

    openContentPage();
  }

  function handleCardKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openCardDestination();
    }
  }

  function handleDetailsClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    onOpenDetails?.(item);
  }

  function handleSaveClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
  }

  function handleTouchStart(event: TouchEvent<HTMLElement>) {
    if (!usesTouchCardMode() || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];

    touchStateRef.current = {
      moved: false,
      startX: touch.clientX,
      startY: touch.clientY
    };
  }

  function handleTouchMove(event: TouchEvent<HTMLElement>) {
    if (!usesTouchCardMode() || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    const deltaX = Math.abs(touch.clientX - touchStateRef.current.startX);
    const deltaY = Math.abs(touch.clientY - touchStateRef.current.startY);

    if (deltaX > 10 || deltaY > 10) {
      touchStateRef.current.moved = true;
    }
  }

  function handleTouchEnd(event: TouchEvent<HTMLElement>) {
    if (!usesTouchCardMode() || touchStateRef.current.moved) {
      return;
    }

    if ((event.target as HTMLElement).closest("button")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openCardDestination();
  }

  return (
    <article
      aria-label={`Abrir ${item.title}`}
      className="home-cover-card home-row-cover-card group relative aspect-[720/1040] w-[11.75rem] shrink-0 cursor-pointer overflow-visible hover:z-[120] sm:w-[15rem] md:w-[18.75rem] lg:w-[21.875rem] xl:w-[24.875rem]"
      onClick={openCardDestination}
      onKeyDown={handleCardKeyDown}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onTouchStart={handleTouchStart}
      role="link"
      tabIndex={0}
    >
      <div className="home-cover-card-surface absolute inset-0 z-0 w-full shadow-2xl shadow-black/35 group-hover:z-[120] group-hover:shadow-[0_42px_130px_rgba(0,0,0,0.82)]">
        <div className="relative h-full w-full">
          <div
            className={`home-cover-card-image absolute inset-0 bg-cover bg-center ${imageStateClass}`}
            style={{ backgroundImage: `url(${item.image})` }}
          />
          {item.isLocked ? (
            <div className="home-cover-card-lock-badge absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full bg-black/65 text-white shadow-[0_12px_28px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-[2px] sm:right-4 sm:top-4 sm:h-11 sm:w-11 lg:h-12 lg:w-12">
              <Lock className="h-[1.15rem] w-[1.15rem] stroke-[3.1] sm:h-5 sm:w-5 lg:h-[1.35rem] lg:w-[1.35rem]" aria-hidden="true" />
              <span className="sr-only">Conteudo bloqueado</span>
            </div>
          ) : null}
          <div className="home-cover-card-overlay absolute inset-0" />
          <div className="home-cover-card-gradient absolute inset-x-0 bottom-0 h-[78%] bg-gradient-to-t from-black via-black/92 to-transparent" />
          <div className="home-cover-card-content absolute inset-x-0 bottom-3 p-3 sm:bottom-4 sm:p-4 lg:bottom-5 lg:p-5">
            <h3 className="line-clamp-2 text-sm font-bold leading-tight text-white drop-shadow sm:text-base lg:text-lg">{item.title}</h3>
            <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-zinc-200 drop-shadow sm:mt-3 sm:line-clamp-3 sm:text-xs sm:leading-5">{description}</p>
            <div className="mt-2 flex items-center gap-1.5 sm:mt-3 sm:gap-2 lg:mt-4">
              <button
                className={`${cardActionClassName} ${actionClass}`}
                onClick={(event) => {
                  event.stopPropagation();
                  openContentPage();
                }}
                type="button"
              >
                <ActionIcon className="h-3.5 w-3.5 fill-current sm:h-4 sm:w-4" />
                {actionLabel}
              </button>
              {!item.isLocked ? (
                <button
                  aria-label={`Salvar ${item.title} nos favoritos`}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-zinc-400 bg-black/30 text-white transition hover:border-white hover:bg-white/10 sm:h-9 sm:w-9 lg:h-11 lg:w-11"
                  onClick={handleSaveClick}
                  type="button"
                >
                  <Bookmark className="h-3.5 w-3.5 sm:h-4 sm:w-4 lg:h-5 lg:w-5" />
                </button>
              ) : null}
              <button
                aria-label={`Ver detalhes de ${item.title}`}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-zinc-400 bg-black/30 text-white transition hover:border-white hover:bg-white/10 sm:h-9 sm:w-9 lg:h-11 lg:w-11"
                onClick={handleDetailsClick}
                type="button"
              >
                <ChevronDown className="h-3.5 w-3.5 sm:h-4 sm:w-4 lg:h-5 lg:w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="home-cover-card-logo pointer-events-none absolute left-4 top-4 z-[130] w-[6.6875rem] opacity-0 drop-shadow-[0_6px_14px_rgba(0,0,0,0.7)] sm:w-[7.5625rem]">
        <Image
          alt=""
          aria-hidden="true"
          className="h-auto w-full object-contain"
          height={35}
          src="/brand/logo-bunker.png"
          unoptimized
          width={306}
        />
      </div>
    </article>
  );
}

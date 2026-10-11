"use client";

import { Bell, ChevronDown, Lock, Play, ShoppingCart } from "lucide-react";
import Image from "next/image";
import { useRef } from "react";
import { cardActionClassName } from "@/components/card-action-style";
import { useNavigationFeedbackRouter } from "@/components/navigation-feedback";
import { SavedItemButton } from "@/components/saved-item-button";
import { withAccessPreviewParam } from "@/lib/access-preview";
import { usePlatformLogoImage } from "@/components/platform-branding";
import { getReleaseRuleNotice } from "@/lib/release-rules";
import { getSavedTargetTypeForContentKind } from "@/lib/saved-items";
import type { KeyboardEvent, MouseEvent, TouchEvent } from "react";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { cssImageUrl } from "@/lib/css-url";
import type { ContentItem } from "@/lib/platform-types";

type CardProps = {
  accessPreviewMode?: AccessPreviewMode;
  item: ContentItem;
  onOpenDetails?: (item: ContentItem) => void;
};

function getContentHref(item: ContentItem, accessPreviewMode?: AccessPreviewMode) {
  return withAccessPreviewParam(item.href ?? `/conteudo/${item.id}`, accessPreviewMode);
}

function usesTouchCardMode() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.matchMedia("(max-width: 1023px)").matches;
}

export function ContinueWatchingCard({ accessPreviewMode, item }: CardProps) {
  const router = useNavigationFeedbackRouter();
  const contentHref = getContentHref(item, accessPreviewMode);

  function prefetchContentPage() {
    router.prefetch(contentHref);
  }

  return (
    <article className="group relative w-[16.25rem] shrink-0 overflow-visible hover:z-[80] sm:w-[18.75rem] lg:w-[20.625rem]">
      <button
        aria-label={`Continuar ${item.title}`}
        className="relative block aspect-video w-full text-left"
        onClick={() => router.push(contentHref)}
        onFocus={prefetchContentPage}
        onMouseEnter={prefetchContentPage}
        onTouchStart={prefetchContentPage}
        type="button"
      >
        <div className="absolute inset-0 z-0 w-full origin-center overflow-hidden rounded-[8px] bg-[#181818] shadow-xl shadow-black/35">
          <div
            className="continue-watching-card-image absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: cssImageUrl(item.image) }}
          />
          <div className="continue-watching-card-overlay absolute inset-0" />
          <span className="absolute left-1/2 top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/92 text-black opacity-0 shadow-xl shadow-black/40 transition-opacity duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:opacity-100">
            <Play className="h-5 w-5 fill-current" />
          </span>
          <div className="absolute bottom-0 left-0 h-1 w-full bg-white/20">
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

export function VerticalCoverCard({ accessPreviewMode, item, onOpenDetails }: CardProps) {
  const router = useNavigationFeedbackRouter();
  const touchStateRef = useRef({
    moved: false,
    startX: 0,
    startY: 0
  });
  const description = item.description ?? item.eyebrow;
  const releaseNotice = getReleaseRuleNotice(item.releaseRule, item.kind.toLowerCase(), item.releaseState);
  const isReleaseLocked = Boolean(releaseNotice?.isLocked);
  const isLocked = Boolean(item.isLocked || isReleaseLocked);
  const actionLabel = item.isLocked ? item.purchaseLabel ?? "Comprar" : isReleaseLocked ? "Bloqueado" : "Acessar";
  const ActionIcon = item.status === "Em breve" || isReleaseLocked ? Bell : item.isLocked ? ShoppingCart : Play;
  const actionClass = item.isLocked
    ? "bg-emerald-600 text-white shadow-[0_18px_42px_rgba(5,150,105,0.32)] hover:bg-emerald-500"
    : isReleaseLocked
      ? "bg-white/15 text-white hover:bg-white/20"
    : "bg-white text-black hover:bg-zinc-200";
  const imageStateClass = isLocked
    ? "grayscale saturate-0 contrast-110 brightness-75 group-hover:grayscale-0 group-hover:saturate-100 group-hover:contrast-100 group-hover:brightness-100"
    : "";
  const contentHref = getContentHref(item, accessPreviewMode);
  const hasCover = Boolean(item.image.trim());
  const logoImage = usePlatformLogoImage();

  function prefetchContentPage() {
    if (!isLocked) {
      router.prefetch(contentHref);
    }
  }

  function openContentPage() {
    router.push(contentHref);
  }

  function openDetailsOrContentPage() {
    if (isLocked && onOpenDetails) {
      onOpenDetails(item);
      return;
    }

    openContentPage();
  }

  function openCardDestination() {
    if (isLocked && onOpenDetails) {
      onOpenDetails(item);
      return;
    }

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
      className="home-cover-card home-row-cover-card group relative aspect-[2/3] w-[9.5rem] shrink-0 cursor-pointer overflow-visible hover:z-[120] sm:w-[11.5rem] md:w-[13.5rem] lg:w-[15rem] xl:w-[16rem]"
      data-home-row-card
      onClick={openCardDestination}
      onFocus={prefetchContentPage}
      onKeyDown={handleCardKeyDown}
      onMouseEnter={prefetchContentPage}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onTouchStart={(event) => {
        prefetchContentPage();
        handleTouchStart(event);
      }}
      role="link"
      tabIndex={0}
    >
      <div className="home-cover-card-surface absolute inset-0 z-0 w-full shadow-2xl shadow-black/35 group-hover:z-[120] group-hover:shadow-[0_42px_130px_rgba(0,0,0,0.82)]">
        <div className="relative h-full w-full">
          {hasCover ? (
            <div
              className={`home-cover-card-image absolute inset-0 bg-cover bg-center ${imageStateClass}`}
              style={{ backgroundImage: cssImageUrl(item.image) }}
            />
          ) : (
            <div className="absolute inset-0 bg-[linear-gradient(145deg,#27272a_0%,#18181b_48%,#09090b_100%)]" />
          )}
          {isLocked && hasCover ? (
            <div className="home-cover-card-lock-badge absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-black/65 text-white shadow-[0_12px_28px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-[2px] sm:right-3.5 sm:top-3.5 sm:h-10 sm:w-10">
              <Lock className="h-4 w-4 stroke-[3] sm:h-[1.125rem] sm:w-[1.125rem]" aria-hidden="true" />
              <span className="sr-only">Conteudo bloqueado</span>
            </div>
          ) : null}
          {isReleaseLocked && hasCover ? (
            <div className="absolute inset-x-3 top-3 z-20 rounded-[8px] border border-white/12 bg-black/72 px-3 py-3 text-center shadow-2xl shadow-black/45 backdrop-blur-sm sm:inset-x-4 sm:top-4">
              <Lock className="mx-auto h-5 w-5 stroke-[3] text-white" />
              <p className="mt-2 text-[11px] font-black leading-tight text-white sm:text-xs">
                {releaseNotice?.title ?? "Este conteúdo será liberado"}
              </p>
              <p className="mt-1 line-clamp-2 text-[10px] font-semibold leading-4 text-zinc-300 sm:text-[11px]" suppressHydrationWarning>
                {releaseNotice?.detail ?? "Disponível de acordo com a regra de entrega."}
              </p>
            </div>
          ) : null}
          {hasCover ? <div className="home-cover-card-overlay absolute inset-0" /> : null}
          {hasCover ? <div className="home-cover-card-gradient absolute inset-x-0 bottom-0 h-[78%] bg-gradient-to-t from-black via-black/92 to-transparent" /> : null}
          <div className={hasCover
            ? "home-cover-card-content absolute inset-x-0 bottom-3 p-3 sm:bottom-3.5 sm:p-3.5 lg:bottom-4 lg:p-4"
            : "absolute inset-0 grid place-items-center p-5 text-center"
          }>
            <h3 className="line-clamp-2 text-[13px] font-bold leading-tight text-white drop-shadow sm:text-sm lg:text-base">{item.title}</h3>
            {hasCover ? <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-zinc-200 drop-shadow sm:mt-2 sm:line-clamp-3 sm:text-xs sm:leading-[1.125rem]">{description}</p> : null}
            {hasCover ? <div className="mt-2 flex items-center gap-1.5 sm:mt-2.5 sm:gap-2 lg:mt-3">
              <button
                className={`${cardActionClassName} ${actionClass}`}
                onClick={(event) => {
                  event.stopPropagation();
                  openDetailsOrContentPage();
                }}
                type="button"
              >
                <ActionIcon className="hidden shrink-0 fill-current md:block md:h-3.5 md:w-3.5 lg:h-4 lg:w-4" />
                {actionLabel}
              </button>
              {!isLocked ? (
                <SavedItemButton
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 transition md:h-9 md:w-9"
                  iconClassName="h-3.5 w-3.5 md:h-4 md:w-4"
                  initialSaved={item.isSaved}
                  targetId={item.id}
                  targetTitle={item.title}
                  targetType={getSavedTargetTypeForContentKind(item.kind)}
                />
              ) : null}
              <button
                aria-label={`Ver detalhes de ${item.title}`}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-zinc-400 bg-black/30 text-white transition hover:border-white hover:bg-white/10 md:h-9 md:w-9"
                onClick={handleDetailsClick}
                type="button"
              >
                <ChevronDown className="h-3.5 w-3.5 md:h-4 md:w-4" />
              </button>
            </div> : null}
          </div>
        </div>
      </div>
      {hasCover && logoImage ? <div className="home-cover-card-logo pointer-events-none absolute left-4 top-4 z-[130] w-[5.75rem] opacity-0 drop-shadow-[0_6px_14px_rgba(0,0,0,0.7)] sm:w-[6.25rem] lg:w-[6.75rem]">
        <Image
          alt=""
          aria-hidden="true"
          className="h-auto max-h-10 w-full object-contain object-left"
          height={35}
          src={logoImage}
          unoptimized
          width={306}
        />
      </div> : null}
    </article>
  );
}

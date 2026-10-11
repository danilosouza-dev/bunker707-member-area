"use client";

import { Bell, ChevronDown, ChevronUp, LockKeyhole, Play, ShoppingCart, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigationFeedback, useNavigationFeedbackRouter } from "@/components/navigation-feedback";
import { usePlatformLogoImage } from "@/components/platform-branding";
import { SavedItemButton } from "@/components/saved-item-button";
import { withAccessPreviewParam } from "@/lib/access-preview";
import { getReleaseRuleNotice } from "@/lib/release-rules";
import { getSavedTargetTypeForContentKind } from "@/lib/saved-items";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { cssImageUrl } from "@/lib/css-url";
import type { ContentItem, ContentModalStructure, CourseModule } from "@/lib/platform-types";

type ContentDetailsModalProps = {
  accessPreviewMode?: AccessPreviewMode;
  item: ContentItem | null;
  onClose: () => void;
  structure?: ContentModalStructure;
};

type ModalCard = {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  image: string;
  meta: string;
  isLocked?: boolean;
};

type ModulePreview = CourseModule;

function contentItemToModalCard(content: ContentItem): ModalCard {
  return {
    description: content.description ?? content.eyebrow,
    eyebrow: content.eyebrow,
    id: content.id,
    image: content.image,
    isLocked: content.isLocked,
    meta: content.lessons ?? content.durationLabel ?? content.kind,
    title: content.title
  };
}

function DetailDots({ details }: { details: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-normal text-zinc-300">
      {details.map((detail, index) => (
        <span className="contents" key={detail}>
          {index > 0 ? <span className="h-1 w-1 rounded-full bg-zinc-500" /> : null}
          <span>{detail}</span>
        </span>
      ))}
    </div>
  );
}

function MiniContentCard({ accessPreviewMode, card }: { accessPreviewMode?: AccessPreviewMode; card: ModalCard }) {
  const router = useNavigationFeedbackRouter();
  const imageStateClass = card.isLocked
    ? "modal-vertical-card-image-locked"
    : "";
  const href = withAccessPreviewParam(`/conteudo/${card.id}`, accessPreviewMode);

  function openContentPage() {
    router.push(href);
  }

  function prefetchContentPage() {
    if (!card.isLocked) {
      router.prefetch(href);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openContentPage();
    }
  }

  return (
    <article
      aria-label={`Abrir ${card.title}`}
      className="modal-vertical-card isolate overflow-hidden rounded-[8px] bg-[#242424] shadow-xl shadow-black/25"
      onClick={openContentPage}
      onFocus={prefetchContentPage}
      onKeyDown={handleKeyDown}
      onMouseEnter={prefetchContentPage}
      onTouchStart={prefetchContentPage}
      role="link"
      tabIndex={0}
    >
      <div className="modal-vertical-card-media relative aspect-[720/1040] overflow-hidden bg-[#181818] [transform:translateZ(0)]">
        <div
          className={`modal-vertical-card-image absolute inset-0 bg-cover bg-center ${imageStateClass}`}
          style={{ backgroundImage: cssImageUrl(card.image) }}
        />
        <div className="modal-vertical-card-overlay absolute inset-0" />
        {card.isLocked ? (
          <div className="absolute right-3 top-3 z-10 text-black drop-shadow-[0_1px_5px_rgba(255,255,255,0.78)]">
            <LockKeyhole className="h-6 w-6 stroke-[3]" />
            <span className="sr-only">Conteudo bloqueado</span>
          </div>
        ) : null}
      </div>
      <div className="relative z-10 -mt-px bg-[#242424] p-3">
        <h4 className="line-clamp-2 text-base font-black leading-tight text-white">{card.title}</h4>
        <p className="mt-2 text-xs font-semibold text-zinc-300">{card.meta}</p>
        <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-400">{card.description}</p>
      </div>
    </article>
  );
}

function ExpandSectionButton({
  expanded,
  label,
  onClick,
  className = ""
}: {
  expanded: boolean;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  const Icon = expanded ? ChevronUp : ChevronDown;

  return (
    <div className={`mt-4 flex justify-center ${className}`}>
      <button
        aria-label={label}
        className="grid h-10 w-10 place-items-center rounded-full border-2 border-zinc-500 bg-[#181818] text-white shadow-xl shadow-black/35 transition duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.035] hover:border-white hover:bg-[#242424] active:scale-[0.97]"
        onClick={onClick}
        type="button"
      >
        <Icon className="h-5 w-5 transition duration-300" />
      </button>
    </div>
  );
}

function ExpandableSectionReveal({
  buttonLabel,
  children,
  expanded,
  onToggle
}: {
  buttonLabel: string;
  children: ReactNode;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (expanded) {
    return (
      <>
        <div className="mt-4 space-y-4 overflow-hidden transition-[max-height,opacity,margin] duration-500 ease-out">
          {children}
        </div>
        <ExpandSectionButton
          expanded
          label={buttonLabel}
          onClick={onToggle}
        />
      </>
    );
  }

  return (
    <div className="relative mt-4 overflow-hidden rounded-[8px]">
      <div
        aria-hidden="true"
        className="pointer-events-none max-h-[148px] select-none overflow-hidden opacity-80 sm:max-h-[168px]"
        inert
      >
        {children}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#151515]/0 via-[#151515]/78 to-[#151515]" />
      <ExpandSectionButton
        className="absolute inset-x-0 bottom-3 z-10 mt-0"
        expanded={false}
        label={buttonLabel}
        onClick={onToggle}
      />
    </div>
  );
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function clampProgress(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatCount(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatCompletedCount(
  count: number,
  singular: string,
  plural: string,
  completedSingular: string,
  completedPlural: string
) {
  const noun = count === 1 ? singular : plural;
  const completed = count === 1 ? completedSingular : completedPlural;

  return `${count} ${noun} ${completed}`;
}

function formatCompletedRatio(
  completedCount: number,
  totalCount: number,
  singular: string,
  plural: string,
  completedSingular: string,
  completedPlural: string
) {
  return `${completedCount} de ${formatCount(totalCount, singular, plural)} ${
    totalCount === 1 ? completedSingular : completedPlural
  }`;
}

function getCompletedLessonsCount(module: ModulePreview) {
  return module.lessons.filter((lesson) => lesson.completed).length;
}

function getModuleProgress(module: ModulePreview) {
  const savedModuleProgress = clampProgress(module.progress);
  const completedLessons = getCompletedLessonsCount(module);

  if (savedModuleProgress > 0 || module.lessons.length === 0 || completedLessons === 0) {
    return savedModuleProgress;
  }

  return clampProgress((completedLessons / module.lessons.length) * 100);
}

function getCourseProgressFromModules(modules: ModulePreview[], fallbackProgress: number) {
  if (modules.length === 0) {
    return clampProgress(fallbackProgress);
  }

  const moduleProgressTotal = modules.reduce((total, module) => total + getModuleProgress(module), 0);

  return clampProgress(moduleProgressTotal / modules.length);
}

function ProgressBar({ className = "", value }: { className?: string; value: number }) {
  const progress = clampProgress(value);

  return (
    <div
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={progress}
      className={`overflow-hidden rounded-full bg-white/10 ${className}`}
      role="progressbar"
    >
      <div
        className="h-full rounded-full bg-red-600 transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

// O servidor manda a imagem da aula ja resolvida (thumbnail so de aula liberada com acesso) e nunca o
// video: o modal da home nao revela o video de aula bloqueada ou de produto nao comprado.
function getLessonThumbnailUrl(lesson: ModulePreview["lessons"][number]) {
  return lesson.image || "";
}

function ModuleCard({
  active,
  cardRef,
  module,
  onClick
}: {
  active: boolean;
  cardRef?: Ref<HTMLButtonElement>;
  module: ModulePreview;
  onClick: () => void;
}) {
  const completedLessons = getCompletedLessonsCount(module);
  const moduleProgress = getModuleProgress(module);
  const lessonsLabel = module.lessons.length > 0
    ? formatCount(module.lessons.length, "aula", "aulas")
    : "Sem aulas";
  const completionLabel = module.lessons.length > 0
    ? formatCompletedCount(completedLessons, "aula", "aulas", "concluida", "concluidas")
    : "Aulas ainda nao publicadas";

  return (
    <button
      className={`modal-vertical-card module-card-motion isolate cursor-pointer overflow-hidden rounded-[8px] bg-[#242424] text-left shadow-xl shadow-black/25 transition-[opacity,filter,background-color] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        active ? "module-active-card bg-[#2a2a2a]" : ""
      }`}
      onClick={onClick}
      ref={cardRef}
      type="button"
    >
      <div className="modal-vertical-card-media module-card-media relative aspect-[720/1040] overflow-hidden bg-[#181818] [transform:translateZ(0)]">
        <div
          className="modal-vertical-card-image absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: cssImageUrl(module.image) }}
        />
        <div className="modal-vertical-card-overlay absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black via-black/66 to-transparent" />
        <div className="module-card-media-label absolute inset-x-0 bottom-0 p-3">
          <p className="text-[11px] font-bold uppercase tracking-normal text-zinc-300">
            {module.eyebrow}
          </p>
          <h4 className="mt-1 line-clamp-2 text-base font-black leading-tight text-white">
            {module.title}
          </h4>
        </div>
      </div>
      <div className="module-card-content relative z-10 -mt-px bg-[#242424] p-3">
        <p className="module-card-inline-eyebrow hidden text-[11px] font-bold uppercase tracking-normal text-zinc-400">
          {module.eyebrow}
        </p>
        <h4 className="module-card-inline-title hidden text-sm font-black leading-tight text-white">
          {module.title}
        </h4>
        <div className="flex items-center justify-between gap-3 text-xs font-semibold text-zinc-300">
          <span className="truncate">{lessonsLabel}</span>
          <span className="shrink-0 text-white">{moduleProgress}%</span>
        </div>
        <ProgressBar className="mt-2 h-1" value={moduleProgress} />
        <p className="mt-2 text-[11px] font-medium text-zinc-500">{completionLabel}</p>
        <p className="module-card-description mt-2 line-clamp-3 text-xs leading-5 text-zinc-400">
          {module.description}
        </p>
        <span className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-white">
          {active ? "Ocultar aulas" : "Ver aulas"}
          <ChevronDown className={`h-4 w-4 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${active ? "rotate-180" : ""}`} />
        </span>
      </div>
    </button>
  );
}

function LessonPanel({
  accessPreviewMode,
  contentId,
  maxHeight,
  module
}: {
  accessPreviewMode?: AccessPreviewMode;
  contentId: string;
  maxHeight?: number | null;
  module: ModulePreview;
}) {
  return (
    <div
      className="module-lessons-in flex flex-col self-start overflow-hidden rounded-[8px] border border-white/10 bg-[#1f1f1f] shadow-2xl shadow-black/35"
      style={maxHeight ? { height: maxHeight } : undefined}
    >
      <div className="border-b border-white/10 p-4">
        <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
          {module.eyebrow} • {formatCount(module.lessons.length, "aula", "aulas")}
        </p>
        <h4 className="mt-1 text-lg font-black text-white">{module.title}</h4>
      </div>
      <ol className={`modal-lessons-scroll ${maxHeight ? "modal-lessons-scroll-fit" : ""}`}>
        {module.lessons.length > 0 ? module.lessons.map((lesson, index) => {
          const lessonHref = withAccessPreviewParam(
            `/conteudo/${encodeURIComponent(contentId)}/aulas/${encodeURIComponent(module.id)}?lessonId=${encodeURIComponent(lesson.id)}`,
            accessPreviewMode
          );
          const lessonThumbnailUrl = getLessonThumbnailUrl(lesson);

          return (
            <li
              className="border-b border-white/8 last:border-b-0"
              key={lesson.id}
            >
              <Link
                className="grid cursor-pointer gap-4 p-4 transition-colors duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-white/[0.035] focus-visible:bg-white/[0.045] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white sm:grid-cols-[2rem_9rem_1fr_auto]"
                href={lessonHref}
              >
                <span className="pt-1 text-sm font-semibold text-zinc-500">{index + 1}</span>
                <span className="relative aspect-video overflow-hidden rounded-[6px] bg-[#141414]">
                  {lessonThumbnailUrl ? (
                    <span
                      className="absolute inset-0 bg-cover bg-center"
                      style={{ backgroundImage: `url(${lessonThumbnailUrl})` }}
                    />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center bg-[#101010] text-[10px] font-bold uppercase tracking-normal text-zinc-600">
                      Sem thumbnail
                    </span>
                  )}
                  <span className="absolute inset-0 bg-black/18" />
                  <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:opacity-100">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-white/92 text-black shadow-xl shadow-black/30">
                      <Play className="h-4 w-4 fill-current" />
                    </span>
                  </span>
                </span>
                <span>
                  <span className="block text-sm font-bold text-white">{lesson.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-zinc-400">{lesson.description}</span>
                </span>
                <span className="pt-1 text-xs font-semibold text-zinc-500">{lesson.duration}</span>
              </Link>
            </li>
          );
        }) : (
          <li className="p-4 text-sm leading-6 text-zinc-400">
            Este modulo ainda nao tem aulas publicadas.
          </li>
        )}
      </ol>
    </div>
  );
}

export function ContentDetailsModal({ accessPreviewMode, item, onClose, structure }: ContentDetailsModalProps) {
  const router = useNavigationFeedbackRouter();
  const logoImage = usePlatformLogoImage();
  const { startNavigation } = useNavigationFeedback();
  const [expandedMainSection, setExpandedMainSection] = useState(false);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [lessonPanelHeight, setLessonPanelHeight] = useState<number | null>(null);
  const [closingItemId, setClosingItemId] = useState<string | null>(null);
  const activeModuleCardRef = useRef<HTMLButtonElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalScrollerRef = useRef<HTMLDivElement>(null);
  const moduleSectionHeaderRef = useRef<HTMLDivElement>(null);
  const isClosing = item ? closingItemId === item.id : false;

  function handleClose() {
    if (!item || closingItemId === item.id) {
      return;
    }

    setClosingItemId(item.id);
    closeTimeoutRef.current = setTimeout(() => {
      setExpandedMainSection(false);
      setActiveModuleId(null);
      setClosingItemId(null);
      closeTimeoutRef.current = null;
      onClose();
    }, 190);
  }

  useEffect(() => {
    if (!item) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [item]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!activeModuleId || !item) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      const scroller = modalScrollerRef.current;
      const target = moduleSectionHeaderRef.current;

      if (!scroller || !target) {
        return;
      }

      const scrollerTop = scroller.getBoundingClientRect().top;
      const targetTop = target.getBoundingClientRect().top;

      scroller.scrollTo({
        behavior: "smooth",
        top: scroller.scrollTop + targetTop - scrollerTop - 28
      });
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [activeModuleId, item]);

  useEffect(() => {
    if (!activeModuleId || !item) {
      return;
    }

    function measurePanelHeight() {
      const activeCard = activeModuleCardRef.current;
      const shouldMatchCardHeight = window.matchMedia("(min-width: 1024px)").matches;

      if (!activeCard || !shouldMatchCardHeight) {
        setLessonPanelHeight(null);
        return;
      }

      const nextHeight = Math.round(activeCard.getBoundingClientRect().height);

      setLessonPanelHeight((currentHeight) => (
        currentHeight === nextHeight ? currentHeight : nextHeight
      ));
    }

    const animationFrame = window.requestAnimationFrame(measurePanelHeight);
    const resizeObserver = "ResizeObserver" in window
      ? new ResizeObserver(measurePanelHeight)
      : null;

    if (activeModuleCardRef.current) {
      resizeObserver?.observe(activeModuleCardRef.current);
    }

    window.addEventListener("resize", measurePanelHeight);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measurePanelHeight);
    };
  }, [activeModuleId, item]);

  if (!item) {
    return null;
  }

  const releaseNotice = getReleaseRuleNotice(item.releaseRule, item.kind.toLowerCase(), item.releaseState);
  const isReleaseLocked = Boolean(releaseNotice?.isLocked);
  const isLocked = Boolean(item.isLocked || isReleaseLocked);
  const actionLabel = item.isLocked ? item.purchaseLabel ?? "Comprar" : isReleaseLocked ? "Bloqueado" : "Acessar";
  const ActionIcon = item.status === "Em breve" || isReleaseLocked ? Bell : item.isLocked ? ShoppingCart : Play;
  const actionClass = item.isLocked
    ? "bg-emerald-600 text-white shadow-[0_18px_42px_rgba(5,150,105,0.32)] hover:bg-emerald-500"
    : isReleaseLocked
      ? "bg-white/15 text-white"
    : "bg-white text-black hover:bg-zinc-200";
  const canPurchase = Boolean(item.purchaseUrl);
  const isCourseLike = ["Curso", "Bootcamp", "Mentoria", "Webinario", "Produto"].includes(item.kind);
  const isFormation = item.kind === "Formacao";
  const itemModules = structure?.modules ?? [];
  const formationCourseCards = (structure?.formationCourses ?? []).map(contentItemToModalCard);
  const hasModuleSection = itemModules.length > 0 && (isCourseLike || isFormation);
  const moduleSectionTitle =
    item.kind === "Formacao"
      ? "Modulos da formacao"
      : item.kind === "Bootcamp"
      ? "Modulos do bootcamp"
      : item.kind === "Mentoria"
        ? "Modulos da mentoria"
        : item.kind === "Webinario"
          ? "Modulos do webinario"
          : item.kind === "Produto"
            ? "Modulos do produto"
            : "Modulos do curso";
  const totalCourseLessons = itemModules.reduce((total, module) => total + module.lessons.length, 0);
  const completedCourseLessons = itemModules.reduce((total, module) => total + getCompletedLessonsCount(module), 0);
  const completedModules = itemModules.filter((module) => getModuleProgress(module) >= 100).length;
  const courseProgress = getCourseProgressFromModules(itemModules, item.progress);
  const courseProgressTitle = isFormation
    ? "Progresso da formacao"
    : isCourseLike
      ? "Progresso do curso"
      : "Progresso";
  const completedModulesLabel = itemModules.length > 0
    ? formatCompletedRatio(completedModules, itemModules.length, "modulo", "modulos", "concluido", "concluidos")
    : "";
  const completedLessonsLabel = totalCourseLessons > 0
    ? formatCompletedRatio(completedCourseLessons, totalCourseLessons, "aula", "aulas", "concluida", "concluidas")
    : "";
  const progressContextItems = [completedModulesLabel, completedLessonsLabel].filter(Boolean);
  const courseSummaryLabel = itemModules.length > 0
    ? `${formatCount(itemModules.length, "modulo", "modulos")} • ${formatCount(totalCourseLessons, "aula", "aulas")}`
    : item.durationLabel ?? item.lessons;
  const detailItems = [
    isCourseLike || isFormation ? courseSummaryLabel : item.durationLabel ?? item.lessons,
    item.instructor?.name ? `Professor ${item.instructor.name}` : undefined
  ].filter((detail): detail is string => Boolean(detail));
  const statusNoticeLabel = isReleaseLocked
    ? releaseNotice?.title ?? "Liberacao pendente"
    : item.isLocked
      ? "Acesso bloqueado"
      : item.status === "Em breve"
        ? "Em breve"
        : null;
  const activeModule = itemModules.find((module) => module.id === activeModuleId);
  const primaryModuleCount = 6;
  const primaryModules = itemModules.slice(0, primaryModuleCount);
  const extraModules = itemModules.slice(primaryModuleCount);
  const hiddenModules = activeModule ? [] : extraModules;
  const hiddenModuleRows = chunkItems(hiddenModules, 3);
  const orderedVisibleModules = primaryModules;
  const secondaryVisibleModules = activeModule
    ? itemModules.filter((module) => module.id !== activeModule.id)
    : orderedVisibleModules;
  const primaryFormationRows = chunkItems(formationCourseCards.slice(0, 3), 3);
  const extraFormationRows = chunkItems(formationCourseCards.slice(3), 3);
  const itemHref = withAccessPreviewParam(`/conteudo/${item.id}`, accessPreviewMode);

  function handlePrimaryAction() {
    const currentItem = item;

    if (!currentItem) {
      return;
    }

    if (!currentItem.isLocked && isReleaseLocked) {
      return;
    }

    if (!currentItem.isLocked) {
      router.push(itemHref);
      return;
    }

    if (!currentItem.purchaseUrl) {
      return;
    }

    if (currentItem.purchaseTarget === "new_tab") {
      window.open(currentItem.purchaseUrl, "_blank", "noopener,noreferrer");
      return;
    }

    startNavigation(currentItem.purchaseUrl, { message: "Abrindo página de compra..." });
    window.location.href = currentItem.purchaseUrl;
  }

  function toggleMainSection() {
    if (expandedMainSection && activeModuleId && itemModules.slice(primaryModuleCount).some((module) => module.id === activeModuleId)) {
      setActiveModuleId(null);
    }

    setExpandedMainSection((current) => !current);
  }

  function prefetchPrimaryAction() {
    if (item && !item.isLocked && !isReleaseLocked) {
      router.prefetch(itemHref);
    }
  }

  const modal = (
    <div
      className="modal-viewport-scroll fixed inset-0 z-[220] overflow-y-scroll overscroll-contain px-4 py-8"
      ref={modalScrollerRef}
    >
      <button
        aria-label="Fechar detalhes"
        className={`fixed inset-0 bg-black/78 backdrop-blur-sm ${
          isClosing ? "modal-backdrop-out" : "modal-backdrop-in"
        }`}
        onClick={handleClose}
        onWheel={(event) => {
          event.preventDefault();
          modalScrollerRef.current?.scrollBy({ top: event.deltaY });
        }}
        type="button"
      />
      <section className={`relative z-10 mx-auto w-full max-w-4xl overflow-hidden rounded-[8px] border border-white/10 bg-[#151515] shadow-[0_34px_120px_rgba(0,0,0,0.82)] ${
        isClosing ? "modal-panel-out" : "modal-panel-in"
      }`}>
        <div className="relative min-h-[420px] overflow-hidden sm:min-h-[520px] lg:min-h-[560px]">
          <div
            className="modal-hero-image-in absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: cssImageUrl(item.image) }}
          />
          <div className="absolute inset-0 bg-black/16" />
          <div className="absolute inset-x-0 bottom-0 h-[72%] bg-gradient-to-t from-[#151515] via-[#151515]/88 to-transparent" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/36 via-black/10 to-transparent" />

          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between p-4 sm:p-6">
            <div className="w-[126px] drop-shadow-[0_6px_16px_rgba(0,0,0,0.72)] sm:w-[150px]">
              {logoImage ? (
                <Image
                  alt=""
                  aria-hidden="true"
                  className="h-auto max-h-10 w-full object-contain object-left"
                  height={35}
                  src={logoImage}
                  unoptimized
                  width={306}
                />
              ) : null}
            </div>

            <div className="flex h-10 items-center gap-2">
              {isLocked ? (
                <div className="grid h-10 w-10 place-items-center text-black drop-shadow-[0_1px_5px_rgba(255,255,255,0.78)]">
                  <LockKeyhole className="h-8 w-8 stroke-[3]" />
                  <span className="sr-only">Conteudo bloqueado</span>
                </div>
              ) : null}

              <button
                aria-label="Fechar detalhes"
                className="grid h-10 w-10 place-items-center rounded-full bg-black/70 text-white transition hover:bg-black"
                onClick={handleClose}
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-0 z-10 p-6 sm:p-8 lg:p-10">
            <h2 className="max-w-2xl text-3xl font-black leading-none text-white drop-shadow-[0_6px_24px_rgba(0,0,0,0.72)] sm:text-5xl">
              {item.title}
            </h2>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                className={`inline-flex min-h-12 items-center gap-2 rounded-[8px] px-6 py-3 text-sm font-extrabold transition ${actionClass} disabled:cursor-not-allowed disabled:opacity-45`}
                disabled={(!item.isLocked && isReleaseLocked) || (item.isLocked && !canPurchase)}
                onFocus={prefetchPrimaryAction}
                onMouseEnter={prefetchPrimaryAction}
                onClick={handlePrimaryAction}
                onTouchStart={prefetchPrimaryAction}
                type="button"
              >
                <ActionIcon className="h-4 w-4 fill-current" />
                {actionLabel}
              </button>
              {!isLocked ? (
                <SavedItemButton
                  className="grid h-12 w-12 place-items-center rounded-full border-2 transition"
                  iconClassName="h-5 w-5"
                  initialSaved={item.isSaved}
                  targetId={item.id}
                  targetTitle={item.title}
                  targetType={getSavedTargetTypeForContentKind(item.kind)}
                />
              ) : null}
            </div>
            {isReleaseLocked ? (
              <p className="mt-3 max-w-md text-xs font-semibold leading-5 text-zinc-300" suppressHydrationWarning>
                {releaseNotice?.detail ?? "Conteúdo indisponível de acordo com a regra de entrega."}
              </p>
            ) : item.isLocked && !canPurchase ? (
              <p className="mt-3 max-w-md text-xs font-semibold leading-5 text-zinc-300">
                Link de compra ainda nao configurado para este conteudo.
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-6 p-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                {statusNoticeLabel ? (
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-normal ${
                      isLocked
                        ? "border-orange-400/35 bg-orange-500/10 text-orange-300"
                        : "border-white/10 bg-white/10 text-white"
                    }`}
                  >
                    {statusNoticeLabel}
                  </span>
                ) : null}
                <DetailDots details={detailItems} />
              </div>

              <p className="max-w-2xl text-sm leading-6 text-zinc-200">
                {item.description ?? item.eyebrow}
              </p>
            </div>

            <aside className="border-y border-white/10 py-5 lg:border-y-0 lg:border-l lg:py-0 lg:pl-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
                    {courseProgressTitle}
                  </p>
                  {progressContextItems.length > 0 ? (
                    <DetailDots details={progressContextItems} />
                  ) : null}
                </div>
                <span className="text-3xl font-black leading-none text-white">{courseProgress}%</span>
              </div>
              <ProgressBar className="mt-4 h-1.5" value={courseProgress} />
            </aside>
          </div>
        </div>

        <div className="space-y-10 px-6 pb-8 sm:px-8">
          {hasModuleSection ? (
            <section>
              <div
                className="mb-4 flex items-end justify-between gap-4"
                ref={moduleSectionHeaderRef}
              >
                <div>
                  <h3 className="text-xl font-bold text-white">{moduleSectionTitle}</h3>
                  <p className="mt-1 text-sm text-zinc-400">
                    Abra um modulo para ver as aulas em detalhe.
                  </p>
                </div>
                <DetailDots details={[
                  formatCount(itemModules.length, "modulo", "modulos"),
                  formatCount(totalCourseLessons, "aula", "aulas")
                ]} />
              </div>

              <div className="space-y-4">
                {activeModule ? (
                  <div
                    className="module-focus-layout space-y-5"
                    key={`active-module-${activeModule.id}`}
                  >
                    <div className="grid items-start gap-4 lg:grid-cols-[minmax(190px,0.78fr)_minmax(0,1.42fr)]">
                      <ModuleCard
                        active
                        cardRef={activeModuleCardRef}
                        module={activeModule}
                        onClick={() => setActiveModuleId(null)}
                      />
                      <LessonPanel
                        accessPreviewMode={accessPreviewMode}
                        contentId={item.id}
                        maxHeight={lessonPanelHeight}
                        module={activeModule}
                      />
                    </div>

                    {secondaryVisibleModules.length > 0 ? (
                      <div className="module-secondary-grid space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
                          Outros modulos
                        </p>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {secondaryVisibleModules.map((module) => (
                            <ModuleCard
                              active={false}
                              key={module.id}
                              module={module}
                              onClick={() => setActiveModuleId(module.id)}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="module-grid-layout grid gap-4 sm:grid-cols-3" key="module-grid">
                    {orderedVisibleModules.map((module) => (
                      <ModuleCard
                        active={false}
                        key={module.id}
                        module={module}
                        onClick={() => setActiveModuleId(module.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {!activeModule && itemModules.length > 3 ? (
                hiddenModuleRows.length > 0 ? (
                  <ExpandableSectionReveal
                    buttonLabel={expandedMainSection ? "Ver menos modulos" : "Ver mais modulos"}
                    expanded={expandedMainSection}
                    onToggle={toggleMainSection}
                  >
                    {hiddenModuleRows.map((row, rowIndex) => (
                      <div className="grid gap-4 sm:grid-cols-3" key={`extra-module-row-${rowIndex}`}>
                        {row.map((module) => (
                          <ModuleCard
                            active={false}
                            key={module.id}
                            module={module}
                            onClick={() => setActiveModuleId(module.id)}
                          />
                        ))}
                      </div>
                    ))}
                  </ExpandableSectionReveal>
                ) : (
                  <ExpandSectionButton
                    expanded={expandedMainSection}
                    label={expandedMainSection ? "Ver menos modulos" : "Ver mais modulos"}
                    onClick={toggleMainSection}
                  />
                )
              ) : null}
            </section>
          ) : null}

          {isFormation && formationCourseCards.length > 0 ? (
            <section>
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h3 className="text-xl font-bold text-white">Cursos da formacao</h3>
                  <p className="mt-1 text-sm text-zinc-400">
                    Conteudos organizados dentro desta jornada.
                  </p>
                </div>
                <DetailDots details={[`${formationCourseCards.length} cursos`, item.durationLabel ?? item.lessons ?? "Aulas"]} />
              </div>

              <div className="space-y-4">
                {primaryFormationRows.map((row, rowIndex) => (
                  <div className="grid gap-4 sm:grid-cols-3" key={`formation-row-${rowIndex}`}>
                    {row.map((card) => (
                      <MiniContentCard accessPreviewMode={accessPreviewMode} card={card} key={card.id} />
                    ))}
                  </div>
                ))}

                {extraFormationRows.length > 0 ? (
                  <ExpandableSectionReveal
                    buttonLabel={expandedMainSection ? "Ver menos cursos" : "Ver mais cursos"}
                    expanded={expandedMainSection}
                    onToggle={toggleMainSection}
                  >
                    {extraFormationRows.map((row, rowIndex) => (
                      <div className="grid gap-4 sm:grid-cols-3" key={`extra-formation-row-${rowIndex}`}>
                        {row.map((card) => (
                          <MiniContentCard accessPreviewMode={accessPreviewMode} card={card} key={card.id} />
                        ))}
                      </div>
                    ))}
                  </ExpandableSectionReveal>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="border-t border-white/10 pt-7">
            <h3 className="text-xl font-bold text-white">Sobre {item.title}</h3>
            <div className="mt-4 grid gap-6 text-sm leading-6 text-zinc-400 sm:grid-cols-[1.35fr_0.85fr]">
              <p>
                {item.description ?? "Descricao ainda nao cadastrada para este conteudo."}
              </p>
              <div className="space-y-2">
                {courseSummaryLabel ? (
                  <p>
                    <span className="font-semibold text-zinc-300">Estrutura:</span>{" "}
                    {courseSummaryLabel}
                  </p>
                ) : null}
                {item.instructor ? (
                  <p>
                    <span className="font-semibold text-zinc-300">Professor:</span>{" "}
                    {item.instructor.name}
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(modal, document.body);
}

"use client";

import { ChevronLeft, ChevronRight, Lock, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cardActionClassName } from "@/components/card-action-style";
import { withAccessPreviewParam } from "@/lib/access-preview";
import { getReleaseRuleNotice } from "@/lib/release-rules";
import type { AccessPreviewMode } from "@/lib/access-preview";
import type {
  ContentItem,
  CourseModule,
  FormationCourseOpenMode,
  InternalCardActionMode
} from "@/lib/platform-types";

type ContentStructureSectionProps = {
  accessPreviewMode?: AccessPreviewMode;
  formationCourseOpenMode: FormationCourseOpenMode;
  formationCourses: ContentItem[];
  internalCardActionMode: InternalCardActionMode;
  item: ContentItem;
  modules: CourseModule[];
  showLockedStates?: boolean;
};

type InternalPosterCardProps = {
  actionLabel?: string;
  description?: string;
  href: string;
  image: string;
  isLocked?: boolean;
  lockedDetail?: string;
  lockedTitle?: string;
  meta?: string;
  progress?: number;
  showAction?: boolean;
  showProgress?: boolean;
  title: string;
};

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
      <div
        className="h-full rounded-full bg-[var(--accent)]"
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
      />
    </div>
  );
}

function InternalPosterCard({
  actionLabel = "Acessar",
  description,
  href,
  image,
  isLocked,
  lockedDetail,
  lockedTitle,
  meta,
  progress = 0,
  showAction = true,
  showProgress = true,
  title
}: InternalPosterCardProps) {
  const router = useRouter();
  const imageStateClass = isLocked
    ? "grayscale saturate-0 contrast-110 brightness-75 group-hover:grayscale-0 group-hover:saturate-100 group-hover:contrast-100 group-hover:brightness-100"
    : "";
  const lockedAccessibilityDetail =
    isLocked ? (lockedDetail ?? lockedTitle ?? "Conteudo bloqueado") : undefined;

  function prefetchPosterDestination() {
    if (!isLocked) {
      router.prefetch(href);
    }
  }

  return (
    <Link
      aria-label={lockedAccessibilityDetail ? `${title}. ${lockedAccessibilityDetail}` : `Abrir ${title}`}
      className="home-cover-card internal-poster-card group relative aspect-[1000/1618] w-[11rem] shrink-0 cursor-pointer overflow-visible outline-none hover:z-[120] focus-visible:ring-2 focus-visible:ring-white/70 sm:w-[13.75rem] md:w-[15.5rem] lg:w-[18.75rem] 2xl:w-[20rem]"
      href={href}
      onClick={(event) => {
        if (isLocked) {
          event.preventDefault();
        }
      }}
      onFocus={prefetchPosterDestination}
      onMouseEnter={prefetchPosterDestination}
      onTouchStart={prefetchPosterDestination}
      prefetch
    >
      <div className="home-cover-card-surface absolute inset-0 z-0 w-full shadow-2xl shadow-black/35 group-hover:z-[120] group-hover:shadow-[0_42px_130px_rgba(0,0,0,0.82)]">
        <div className="relative h-full w-full">
          <div
            className={`home-cover-card-image absolute inset-0 bg-cover bg-center ${imageStateClass}`}
            style={{ backgroundImage: `url(${image})` }}
          />
          {isLocked ? (
            <div className="absolute right-2.5 top-2.5 z-20 grid h-8 w-8 place-items-center rounded-full bg-black/65 text-white shadow-[0_10px_24px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-[2px] sm:right-3 sm:top-3 sm:h-9 sm:w-9 md:h-10 md:w-10 lg:right-4 lg:top-4 lg:h-11 lg:w-11">
              <Lock className="h-3.5 w-3.5 stroke-[3] sm:h-4 sm:w-4 md:h-[1.1rem] md:w-[1.1rem] lg:h-5 lg:w-5" aria-hidden="true" />
              <span className="sr-only">{lockedTitle ?? "Conteudo bloqueado"}</span>
            </div>
          ) : null}
          <div className="home-cover-card-overlay absolute inset-0" />
          <div className="home-cover-card-gradient absolute inset-x-0 bottom-0 h-[78%] bg-gradient-to-t from-black via-black/92 to-transparent" />
          <div className="home-cover-card-content absolute inset-x-0 bottom-3 p-3 sm:bottom-4 sm:p-4 lg:bottom-5 lg:p-5">
            <h3 className="line-clamp-2 text-sm font-bold leading-tight text-white drop-shadow sm:text-base lg:text-lg">
              {title}
            </h3>
            {description ? (
              <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-zinc-200 drop-shadow sm:mt-3 sm:line-clamp-3 sm:text-xs sm:leading-5">
                {description}
              </p>
            ) : null}
            {showAction ? (
              <div className="mt-2 flex items-center gap-1.5 sm:mt-3 sm:gap-2 lg:mt-4">
                <span className={`${cardActionClassName} bg-white text-black hover:bg-zinc-200`}>
                  <Play className="h-3.5 w-3.5 fill-current sm:h-4 sm:w-4" />
                  {actionLabel}
                </span>
              </div>
            ) : null}
            {showProgress ? (
              <div className="mt-3">
                <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-medium text-zinc-300 sm:text-xs">
                  <span className="line-clamp-1">{meta ?? "Progresso"}</span>
                  <span className="shrink-0 text-white">{Math.round(progress)}%</span>
                </div>
                <ProgressBar value={progress} />
              </div>
            ) : meta ? (
              <p className="mt-3 line-clamp-1 text-[11px] font-semibold text-zinc-300 sm:text-xs">
                {meta}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="home-cover-card-logo pointer-events-none absolute left-4 top-4 z-[130] w-[6.6875rem] opacity-0 drop-shadow-[0_6px_14px_rgba(0,0,0,0.7)] sm:w-[7.5625rem]">
        <Image
          alt=""
          aria-hidden="true"
          className="h-auto w-full object-contain"
          height={35}
          src="/brand/logo-bunker.svg"
          unoptimized
          width={306}
        />
      </div>
    </Link>
  );
}

type InternalPosterRowProps = {
  children: React.ReactNode;
  description?: string;
  title: string;
};

function InternalPosterRow({ children, description, title }: InternalPosterRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);

  const updateScrollState = useCallback(() => {
    const row = rowRef.current;

    if (!row) {
      return;
    }

    const maxScrollLeft = Math.max(row.scrollWidth - row.clientWidth, 0);
    const hasOverflow = maxScrollLeft > 4;

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
  }, [updateScrollState]);

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
    <section className="relative" id="conteudos">
      <div className="mb-4 flex items-end justify-between gap-4 px-5 sm:px-8 lg:px-12">
        <div>
          <h2 className="text-2xl font-black text-white sm:text-3xl">{title}</h2>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{description}</p>
          ) : null}
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
        className="scrollbar-hidden flex scroll-smooth gap-[0.75rem] overflow-x-auto overflow-y-hidden overscroll-x-contain px-5 py-4 sm:px-8 lg:px-12"
        ref={rowRef}
      >
        {children}
      </div>
    </section>
  );
}

export function ContentStructureSection({
  accessPreviewMode,
  formationCourseOpenMode,
  formationCourses,
  internalCardActionMode,
  item,
  modules,
  showLockedStates = true
}: ContentStructureSectionProps) {
  const isFormation = item.kind === "Formacao";
  const isCourseLike = ["Curso", "Bootcamp", "Mentoria", "Webinario", "Produto"].includes(item.kind);
  const totalLessons = modules.reduce((total, module) => total + module.lessons.length, 0);
  const showInternalCardActions = internalCardActionMode === "button";
  const firstModule = modules[0];
  const moduleRowTitle =
    item.kind === "Bootcamp"
      ? "Modulos do bootcamp"
      : item.kind === "Mentoria"
        ? "Modulos da mentoria"
        : item.kind === "Webinario"
          ? "Modulos do webinario"
          : item.kind === "Produto"
            ? "Modulos do produto"
            : "Modulos do curso";

  if (isFormation) {
    return (
      <div className="pb-24">
        <InternalPosterRow
          description={`${formationCourses.length} cursos organizados para a jornada de ${item.title}.`}
          title="Cursos da formacao"
        >
          {formationCourses.map((course) => {
            const href = formationCourseOpenMode === "course_lesson_format" && firstModule
              ? `/conteudo/${course.id}/aulas/${firstModule.id}`
              : `/conteudo/${course.id}`;
            const releaseNotice = getReleaseRuleNotice(course.releaseRule, "curso");
            const isLocked = showLockedStates && Boolean(item.isLocked || course.isLocked || releaseNotice?.isLocked);
            const lockedDetail = item.isLocked
              ? "Este curso faz parte de um conteudo que ainda nao esta liberado para este aluno."
              : releaseNotice?.detail;

            return (
              <InternalPosterCard
                actionLabel={formationCourseOpenMode === "course_lesson_format" ? "Ver aulas" : "Ver curso"}
                description={course.description}
                href={withAccessPreviewParam(href, accessPreviewMode)}
                image={course.image}
                isLocked={isLocked}
                key={course.id}
                lockedDetail={lockedDetail}
                lockedTitle={item.isLocked ? "Acesso pendente" : releaseNotice?.title}
                meta={course.durationLabel ?? course.lessons}
                progress={course.progress}
                showAction={showInternalCardActions}
                showProgress={false}
                title={course.title}
              />
            );
          })}
        </InternalPosterRow>
      </div>
    );
  }

  if (isCourseLike) {
    return (
      <div className="pb-24">
        <InternalPosterRow
          description={`${modules.length} modulos e ${totalLessons} aulas para seguir em ordem.`}
          title={moduleRowTitle}
        >
          {modules.map((module) => {
            const releaseNotice = getReleaseRuleNotice(module.releaseRule, "modulo");
            const hasLessons = module.lessons.length > 0;
            const isLocked = Boolean((showLockedStates && (item.isLocked || releaseNotice?.isLocked)) || !hasLessons);
            const lockedDetail = item.isLocked
              ? "Este modulo fica disponivel quando o aluno tiver acesso ao conteudo."
              : !hasLessons
                ? "Este modulo ainda nao tem aulas publicadas."
                : releaseNotice?.detail;
            const lockedTitle = item.isLocked
              ? "Acesso pendente"
              : !hasLessons
                ? "Aulas em preparação"
                : releaseNotice?.title;

            return (
              <InternalPosterCard
                actionLabel="Ver aulas"
                description={module.description}
                href={withAccessPreviewParam(`/conteudo/${item.id}/aulas/${module.id}`, accessPreviewMode)}
                image={module.image}
                isLocked={isLocked}
                key={module.id}
                lockedDetail={lockedDetail}
                lockedTitle={lockedTitle}
                meta={module.meta}
                progress={module.progress}
                showAction={showInternalCardActions && !isLocked && hasLessons}
                title={module.title}
              />
            );
          })}
        </InternalPosterRow>
      </div>
    );
  }

  return null;
}

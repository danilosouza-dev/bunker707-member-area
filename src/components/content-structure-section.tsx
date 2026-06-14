"use client";

import { ChevronLeft, ChevronRight, LockKeyhole, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { cardActionClassName } from "@/components/card-action-style";
import type {
  ContentItem,
  CourseModule,
  FormationCourseOpenMode,
  InternalCardActionMode
} from "@/lib/mock-data";

type ContentStructureSectionProps = {
  formationCourseOpenMode: FormationCourseOpenMode;
  formationCourses: ContentItem[];
  internalCardActionMode: InternalCardActionMode;
  item: ContentItem;
  modules: CourseModule[];
};

type InternalPosterCardProps = {
  actionLabel?: string;
  description?: string;
  href: string;
  image: string;
  isLocked?: boolean;
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
  meta,
  progress = 0,
  showAction = true,
  showProgress = true,
  title
}: InternalPosterCardProps) {
  const imageStateClass = isLocked
    ? "grayscale saturate-0 contrast-110 brightness-75 group-hover:grayscale-0 group-hover:saturate-100 group-hover:contrast-100 group-hover:brightness-100"
    : "";

  return (
    <Link
      aria-label={`Abrir ${title}`}
      className="home-cover-card internal-poster-card group relative aspect-[1000/1618] w-[11rem] shrink-0 cursor-pointer overflow-visible outline-none hover:z-[120] focus-visible:ring-2 focus-visible:ring-white/70 sm:w-[13.75rem] md:w-[15.5rem] lg:w-[18.75rem] 2xl:w-[20rem]"
      href={href}
    >
      <div className="home-cover-card-surface absolute inset-0 z-0 w-full shadow-2xl shadow-black/35 group-hover:z-[120] group-hover:shadow-[0_42px_130px_rgba(0,0,0,0.82)]">
        <div className="relative h-full w-full">
          <div
            className={`home-cover-card-image absolute inset-0 bg-cover bg-center ${imageStateClass}`}
            style={{ backgroundImage: `url(${image})` }}
          />
          {isLocked ? (
            <div className="absolute right-4 top-4 z-10 text-black drop-shadow-[0_1px_5px_rgba(255,255,255,0.78)]">
              <LockKeyhole className="h-7 w-7 stroke-[3]" />
              <span className="sr-only">Conteudo bloqueado</span>
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
          src="/brand/logo-bunker.png"
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
        className="scrollbar-hidden flex scroll-smooth gap-[0.75rem] overflow-x-auto overflow-y-hidden overscroll-x-contain px-5 py-4 sm:px-8 lg:px-12"
        ref={rowRef}
      >
        {children}
      </div>
    </section>
  );
}

export function ContentStructureSection({
  formationCourseOpenMode,
  formationCourses,
  internalCardActionMode,
  item,
  modules
}: ContentStructureSectionProps) {
  const isFormation = item.kind === "Formacao";
  const isCourseLike = item.kind === "Curso" || item.kind === "Bootcamp";
  const totalLessons = modules.reduce((total, module) => total + module.lessons.length, 0);
  const showInternalCardActions = internalCardActionMode === "button";
  const firstModule = modules[0];

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

            return (
              <InternalPosterCard
                actionLabel={formationCourseOpenMode === "course_lesson_format" ? "Ver aulas" : "Ver curso"}
                description={course.description}
                href={href}
                image={course.image}
                isLocked={course.isLocked}
                key={course.id}
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
          title={item.kind === "Bootcamp" ? "Modulos do bootcamp" : "Modulos do curso"}
        >
          {modules.map((module) => (
            <InternalPosterCard
              actionLabel="Ver aulas"
              description={module.description}
              href={`/conteudo/${item.id}/aulas/${module.id}`}
              image={module.image}
              key={module.id}
              meta={module.meta}
              progress={module.progress}
              showAction={showInternalCardActions}
              title={module.title}
            />
          ))}
        </InternalPosterRow>
      </div>
    );
  }

  return null;
}

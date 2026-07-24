"use client";

import { Lock, Play, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { CourseModulesHomeSection, ContentRow } from "@/components/content-row";
import { withAccessPreviewParam } from "@/lib/access-preview";
import type { AccessPreviewMode } from "@/lib/access-preview";
import type { HomeRow } from "@/lib/platform-types";

type FeaturedStructureHomeSectionProps = {
  accessPreviewMode?: AccessPreviewMode;
  row: HomeRow;
};

export function FeaturedStructureHomeSection({ accessPreviewMode, row }: FeaturedStructureHomeSectionProps) {
  const course = row.course;
  const modules = row.modules ?? [];
  const structureItems = row.structureItems ?? [];
  const layout = row.layout ?? "compact";
  const isImmersive = layout === "immersive";

  if (!course) {
    return null;
  }

  if (!isImmersive) {
    if (modules.length > 0) {
      return (
        <CourseModulesHomeSection
          accessPreviewMode={accessPreviewMode}
          course={course}
          lockedActionMode={row.lockedActionMode}
          modules={modules}
          subtitle={row.subtitle}
          title={row.title}
        />
      );
    }

    return structureItems.length > 0 ? (
      <ContentRow
        accessPreviewMode={accessPreviewMode}
        items={structureItems}
        subtitle={row.subtitle}
        title={row.title}
        variant="vertical"
      />
    ) : null;
  }

  const courseHref = withAccessPreviewParam(`/conteudo/${course.id}`, accessPreviewMode);
  const actionHref = course.isLocked && course.purchaseUrl ? course.purchaseUrl : courseHref;
  const actionLabel = course.isLocked ? course.purchaseLabel ?? "Comprar" : "Acessar";
  const ActionIcon = course.isLocked ? ShoppingCart : Play;
  const backgroundImage = row.backgroundImage ?? course.image;
  const cards = structureItems.length > 0
    ? structureItems.map((item) => ({
      href: withAccessPreviewParam(`/conteudo/${item.id}`, accessPreviewMode),
      id: item.id,
      image: item.image,
      isLocked: Boolean(course.isLocked || item.isLocked),
      meta: item.lessons ?? item.kind,
      title: item.title
    }))
    : modules.map((module) => ({
      href: course.isLocked
        ? courseHref
        : withAccessPreviewParam(`/conteudo/${course.id}/aulas/${module.id}`, accessPreviewMode),
      id: module.id,
      image: module.image,
      isLocked: Boolean(course.isLocked),
      meta: module.meta,
      title: module.title
    }));

  return (
    <section
      className="relative mx-5 min-h-[34rem] overflow-hidden rounded-[14px] border border-white/10 bg-[#101010] shadow-[0_34px_110px_rgba(0,0,0,0.48)] sm:mx-8 lg:mx-12"
      data-layout="immersive"
    >
      <span className="sr-only">Apresentacao Immersiva</span>
      <div
        className="absolute inset-0 scale-[1.02] bg-cover bg-center"
        style={{ backgroundImage: `url(${backgroundImage})` }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.96)_0%,rgba(0,0,0,0.82)_32%,rgba(0,0,0,0.38)_68%,rgba(0,0,0,0.58)_100%),linear-gradient(0deg,rgba(0,0,0,0.92)_0%,transparent_62%)]" />
      <div className="relative grid min-h-[34rem] items-end gap-8 px-6 py-8 md:px-8 lg:grid-cols-[minmax(15rem,0.72fr)_minmax(0,1.28fr)] lg:px-10 lg:py-10">
        <div className="max-w-xl self-center lg:self-end lg:pb-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-300">{row.subtitle ?? course.eyebrow}</p>
          <h2 className="mt-3 text-3xl font-black leading-[0.98] text-white drop-shadow-2xl sm:text-4xl lg:text-5xl">{row.title}</h2>
          {course.description ? <p className="mt-4 line-clamp-3 text-sm font-medium leading-6 text-zinc-200 sm:text-base">{course.description}</p> : null}
          <Link
            className={`mt-6 inline-flex min-h-11 items-center gap-2 rounded-[7px] px-5 text-sm font-black transition ${course.isLocked ? "bg-emerald-600 text-white hover:bg-emerald-500" : "bg-white text-black hover:bg-zinc-200"}`}
            href={actionHref}
            target={course.isLocked && course.purchaseTarget === "new_tab" ? "_blank" : undefined}
          >
            <ActionIcon className="h-4 w-4 fill-current" />
            {actionLabel}
          </Link>
        </div>

        <div className="min-w-0 self-end">
          <div className="scrollbar-hidden flex snap-x gap-4 overflow-x-auto overscroll-x-contain pb-3 pt-5">
            {cards.map((card) => (
              <Link
                aria-label={`Abrir ${card.title}`}
                className="group relative aspect-[720/1040] w-[10.5rem] shrink-0 snap-start overflow-hidden rounded-[10px] border border-white/12 bg-black/35 shadow-[0_22px_58px_rgba(0,0,0,0.5)] outline-none transition duration-500 hover:-translate-y-2 hover:border-white/30 hover:shadow-[0_32px_80px_rgba(0,0,0,0.72)] focus-visible:ring-2 focus-visible:ring-white sm:w-[12.5rem] xl:w-[14rem]"
                href={card.href}
                key={card.id}
              >
                <div className="absolute inset-0 bg-cover bg-center transition duration-700 group-hover:scale-[1.035]" style={{ backgroundImage: `url(${card.image})` }} />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-transparent" />
                {card.isLocked ? <span className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/70 text-white"><Lock className="h-4 w-4" /></span> : null}
                <div className="absolute inset-x-0 bottom-0 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-300">{card.meta}</p>
                  <h3 className="mt-2 line-clamp-2 text-base font-black leading-tight text-white">{card.title}</h3>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

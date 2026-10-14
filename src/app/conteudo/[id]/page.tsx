import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Bell,
  BookOpen,
  ChevronRight,
  Lock,
  Play,
  ShoppingCart
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { HeroGlow } from "@/components/member/hero-glow";
import { HeroVideo } from "@/components/hero-video";
import { heroVideoPosterOf, heroVideoSourceOf } from "@/lib/hero-video";
import { ContentStructureSection } from "@/components/content-structure-section";
import { MemberFooter } from "@/components/member-footer";
import { normalizeAccessPreviewMode, withAccessPreviewParam } from "@/lib/access-preview";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import {
  getAppShellData,
  getContentPageData
} from "@/server/db/platform-store";
import { requirePageUser } from "@/server/auth/guards";
import type {
  ContentItem,
  ContentPageHeroConfig,
  ContentPageSettings,
  CoursePresentationMode,
  HomeHeroConfig,
  InternalCardActionMode
} from "@/lib/platform-types";

type ContentPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    accessPreview?: string | string[];
  }>;
};

type BreadcrumbItem = {
  href?: string;
  label: string;
};

export const dynamic = "force-dynamic";

function getDefaultCtaLabel(item: ContentItem) {
  if (item.status === "Em breve") {
    return item.purchaseLabel ?? "Avisar-me";
  }

  if (item.isLocked) {
    return item.purchaseLabel ?? "Comprar";
  }

  if (item.kind === "Formacao") {
    return "Ver cursos";
  }

  if (item.kind === "Curso" || item.kind === "Bootcamp") {
    return "Ver modulos";
  }

  return "Acessar";
}

function getCoursePresentationMode(settings?: ContentPageSettings): CoursePresentationMode {
  const configuredMode = settings?.coursePresentationMode;

  if (configuredMode) {
    return configuredMode;
  }

  return "module_cards";
}

function supportsCoursePresentationMode(item: ContentItem) {
  return ["Curso", "Bootcamp", "Mentoria", "Webinario", "Produto"].includes(item.kind);
}

function getInternalCardActionMode(settings?: ContentPageSettings): InternalCardActionMode {
  return settings?.internalCardActionMode ?? "implicit";
}

function getHeroConfig(item: ContentItem, settings: ContentPageSettings | undefined, homeHero: HomeHeroConfig): ContentPageHeroConfig {
  const heroSettings = settings?.hero;
  const defaultVisibility = {
    badge: false,
    title: false,
    description: false,
    cta: false
  };

  return {
    corners: heroSettings?.corners ?? "inherit",
    mediaType: heroSettings?.mediaType ?? "image",
    mediaSrc: heroSettings?.mediaSrc ?? item.image ?? homeHero.image,
    poster: heroSettings?.poster,
    videoOptions: heroSettings?.videoOptions,
    youtubeId: heroSettings?.youtubeId,
    badge: heroSettings?.badge ?? item.accessLabel ?? item.kind,
    title: heroSettings?.title ?? item.title,
    description: heroSettings?.description ?? item.description,
    ctaLabel: heroSettings?.ctaLabel ?? getDefaultCtaLabel(item),
    ctaHref: heroSettings?.ctaHref ?? "#conteudos",
    visibility: {
      badge: heroSettings?.visibility?.badge ?? defaultVisibility.badge,
      title: heroSettings?.visibility?.title ?? defaultVisibility.title,
      description: heroSettings?.visibility?.description ?? defaultVisibility.description,
      cta: heroSettings?.visibility?.cta ?? defaultVisibility.cta
    }
  };
}

function getBreadcrumbItems(item: ContentItem, formations: ContentItem[]): BreadcrumbItem[] {
  const parentFormation = item.commerceScope === "included_content" ? formations[0] : null;
  const sectionLabel = item.kind === "Formacao"
    ? "Formacoes"
    : item.kind === "Bootcamp"
      ? "Bootcamps"
      : "Cursos";

  if (parentFormation) {
    return [
      { href: "/", label: "Home" },
      { href: `/conteudo/${parentFormation.id}`, label: parentFormation.title },
      { label: item.title }
    ];
  }

  return [
    { href: "/", label: "Home" },
    { label: sectionLabel },
    { label: item.title }
  ];
}

function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-300">
      {items.map((breadcrumb, index) => {
        const isCurrent = index === items.length - 1;

        return (
          <span className="contents" key={`${breadcrumb.label}-${index}`}>
            {index > 0 ? <ChevronRight className="h-4 w-4 text-zinc-500" /> : null}
            {breadcrumb.href && !isCurrent ? (
              <Link
                className="rounded-[6px] px-1 py-0.5 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                href={breadcrumb.href}
              >
                {breadcrumb.label}
              </Link>
            ) : (
              <span
                aria-current={isCurrent ? "page" : undefined}
                className={isCurrent ? "px-1 py-0.5 text-white" : "px-1 py-0.5 text-zinc-400"}
              >
                {breadcrumb.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export default async function ContentPage({ params, searchParams }: ContentPageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const requestedAccessPreviewMode = normalizeAccessPreviewMode(resolvedSearchParams?.accessPreview);
  const user = await requirePageUser(`/conteudo/${id}`);
  const shellData = await getAppShellData(user);
  const accessPreviewMode = shellData.canUseAccessPreview ? requestedAccessPreviewMode : undefined;
  const contentPageData = await getContentPageData(id, user, accessPreviewMode);

  if (!contentPageData) {
    notFound();
  }

  const { courseModules, formationInternalCourses, formations, hero, item, settings } = contentPageData;
  const coursePresentationMode = getCoursePresentationMode(settings);
  const isCourseLike = supportsCoursePresentationMode(item);
  const firstModule = courseModules[0];

  if (isCourseLike && !item.isLocked && coursePresentationMode === "lesson_playlist" && firstModule) {
    redirect(withAccessPreviewParam(`/conteudo/${item.id}/aulas/${firstModule.id}`, accessPreviewMode));
  }

  const pageHero = getHeroConfig(item, settings, hero);
  const breadcrumbs = getBreadcrumbItems(item, formations);
  const showBadge = (pageHero.visibility?.badge ?? Boolean(pageHero.badge)) && Boolean(pageHero.badge);
  const showTitle = (pageHero.visibility?.title ?? Boolean(pageHero.title)) && Boolean(pageHero.title);
  const showDescription =
    (pageHero.visibility?.description ?? Boolean(pageHero.description)) && Boolean(pageHero.description);
  const showCta = (pageHero.visibility?.cta ?? Boolean(pageHero.ctaLabel)) && Boolean(pageHero.ctaLabel);
  const hasVisibleHeroContent = showBadge || showTitle || showDescription || showCta;
  const isLocked = Boolean(item.isLocked);
  const ActionIcon = item.status === "Em breve" ? Bell : isLocked ? ShoppingCart : Play;
  const ctaClass = isLocked
    ? "bg-emerald-600 text-white hover:bg-emerald-500"
    : "bg-white text-black hover:bg-zinc-200";
  const formationCourseOpenMode = settings?.formationCourseOpenMode ?? "course_lesson_format";
  const internalCardActionMode = getInternalCardActionMode(settings);

  return (
    <AppShell
      accessPreviewMode={accessPreviewMode}
      bannerCorners={pageHero.corners}
      branding={shellData.branding}
      canUseAccessPreview={shellData.canUseAccessPreview}
      student={shellData.student}
    >
      {/* data-member-banner: a escolha do produto (Detalhes > Cantos do banner) vence a da area so neste banner;
          o cabecalho (logo e perfil) e as fileiras acompanham o banner arredondado. */}
      <div className="min-h-screen bg-[#141414]" data-member-banner={pageHero.corners === "inherit" ? undefined : pageHero.corners}>
        {/* Mesmos cantos e recuo do destaque da home (Marca > Estilo): no modo arredondado a capa fica como la. */}
        <div className="relative flow-root">
        <HeroGlow src={pageHero.mediaType === "video" ? heroVideoPosterOf(pageHero) : pageHero.mediaSrc ?? null} />
        <section className="relative z-[1] min-h-[640px] overflow-hidden rounded-[var(--member-hero-radius)] mx-[var(--member-hero-inset)] mt-[var(--member-hero-top)]">
          {pageHero.mediaType === "video" ? (
            <HeroVideo
              className="absolute inset-0"
              controlsClassName="right-4 bottom-[max(1rem,calc(1rem_-_var(--member-page-overlap)))]"
              options={pageHero.videoOptions}
              poster={pageHero.poster ?? null}
              source={heroVideoSourceOf(pageHero)}
            />
          ) : pageHero.mediaSrc ? (
            <Image
              alt=""
              className="object-cover object-center"
              fetchPriority="high"
              fill
              preload
              sizes="100vw"
              src={pageHero.mediaSrc}
              unoptimized={!canOptimizeImageSrc(pageHero.mediaSrc)}
            />
          ) : null}
          {hasVisibleHeroContent ? (
            <div className="absolute inset-0 bg-gradient-to-r from-black via-black/72 to-black/18" />
          ) : null}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-b from-transparent via-[#141414]/88 to-[#141414] opacity-[var(--member-hero-fade)]" />

          <div className="relative z-10 flex min-h-[640px] max-w-6xl flex-col px-5 pb-36 pt-24 sm:px-8 lg:px-12">
            {hasVisibleHeroContent ? <Breadcrumbs items={breadcrumbs} /> : null}

            <div className="mt-auto">
              {showBadge ? (
                <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-[6px] border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-normal text-white backdrop-blur">
                  <BookOpen className="h-4 w-4 text-[var(--accent-warm)]" />
                  {pageHero.badge}
                </div>
              ) : null}

              {showTitle ? (
                <h1 className="max-w-4xl text-5xl font-black leading-none text-white sm:text-6xl lg:text-7xl">
                  {pageHero.title}
                </h1>
              ) : (
                <h1 className="sr-only">{item.title}</h1>
              )}

              {showDescription ? (
                <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-200 sm:text-lg">
                  {pageHero.description}
                </p>
              ) : null}

              {showCta ? (
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  {pageHero.ctaHref ? (
                    <Link
                      className={`inline-flex min-h-12 items-center gap-2 rounded-[8px] px-6 py-3 text-sm font-extrabold transition ${ctaClass}`}
                      href={withAccessPreviewParam(pageHero.ctaHref, accessPreviewMode)}
                    >
                      <ActionIcon className="h-4 w-4 fill-current" />
                      {pageHero.ctaLabel}
                    </Link>
                  ) : (
                    <button
                      className={`inline-flex min-h-12 items-center gap-2 rounded-[8px] px-6 py-3 text-sm font-extrabold transition ${ctaClass}`}
                      type="button"
                    >
                      <ActionIcon className="h-4 w-4 fill-current" />
                      {pageHero.ctaLabel}
                    </button>
                  )}

                  {isLocked ? (
                    <span className="inline-flex min-h-12 items-center gap-2 rounded-[8px] border border-white/15 bg-black/35 px-4 py-3 text-sm font-bold text-zinc-200">
                      <Lock className="h-4 w-4" />
                      Acesso pendente
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </section>
        </div>

        <div className="relative z-20 mt-[var(--member-page-overlap)]">
          <ContentStructureSection
            accessPreviewMode={accessPreviewMode}
            formationCourseOpenMode={formationCourseOpenMode}
            formationCourses={formationInternalCourses}
            internalCardActionMode={internalCardActionMode}
            item={item}
            modules={courseModules}
          />
        </div>
      </div>
      <MemberFooter branding={shellData.branding} />
    </AppShell>
  );
}

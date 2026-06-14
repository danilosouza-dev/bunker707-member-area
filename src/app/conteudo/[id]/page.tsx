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
import { ContentStructureSection } from "@/components/content-structure-section";
import { MemberFooter } from "@/components/member-footer";
import {
  allContentItems,
  contentPageSettings,
  courseModules,
  formationInternalCourses,
  formations,
  hero,
  type ContentItem,
  type ContentPageHeroConfig,
  type CoursePresentationMode,
  type InternalCardActionMode
} from "@/lib/mock-data";

type ContentPageProps = {
  params: Promise<{
    id: string;
  }>;
};

type BreadcrumbItem = {
  href?: string;
  label: string;
};

export function generateStaticParams() {
  return allContentItems.map((item) => ({
    id: item.id
  }));
}

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

function getCoursePresentationMode(item: ContentItem): CoursePresentationMode {
  const configuredMode = contentPageSettings[item.id]?.coursePresentationMode;

  if (configuredMode) {
    return configuredMode;
  }

  return item.commerceScope === "included_content" ? "lesson_playlist" : "module_cards";
}

function getInternalCardActionMode(item: ContentItem): InternalCardActionMode {
  return contentPageSettings[item.id]?.internalCardActionMode ?? "implicit";
}

function getHeroConfig(item: ContentItem): ContentPageHeroConfig {
  const settings = contentPageSettings[item.id]?.hero;
  const defaultVisibility = {
    badge: false,
    title: false,
    description: false,
    cta: false
  };

  return {
    mediaType: settings?.mediaType ?? "image",
    mediaSrc: settings?.mediaSrc ?? item.image ?? hero.image,
    poster: settings?.poster,
    badge: settings?.badge ?? item.accessLabel ?? item.kind,
    title: settings?.title ?? item.title,
    description: settings?.description ?? item.description,
    ctaLabel: settings?.ctaLabel ?? getDefaultCtaLabel(item),
    ctaHref: settings?.ctaHref ?? "#conteudos",
    visibility: {
      badge: settings?.visibility?.badge ?? defaultVisibility.badge,
      title: settings?.visibility?.title ?? defaultVisibility.title,
      description: settings?.visibility?.description ?? defaultVisibility.description,
      cta: settings?.visibility?.cta ?? defaultVisibility.cta
    }
  };
}

function getBreadcrumbItems(item: ContentItem): BreadcrumbItem[] {
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

export default async function ContentPage({ params }: ContentPageProps) {
  const { id } = await params;
  const item = allContentItems.find((content) => content.id === id);

  if (!item) {
    notFound();
  }

  const settings = contentPageSettings[item.id];
  const coursePresentationMode = getCoursePresentationMode(item);
  const isCourseLike = item.kind === "Curso" || item.kind === "Bootcamp";
  const firstModule = courseModules[0];

  if (isCourseLike && coursePresentationMode === "lesson_playlist" && firstModule) {
    redirect(`/conteudo/${item.id}/aulas/${firstModule.id}`);
  }

  const pageHero = getHeroConfig(item);
  const breadcrumbs = getBreadcrumbItems(item);
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
  const internalCardActionMode = getInternalCardActionMode(item);

  return (
    <AppShell>
      <div className="min-h-screen bg-[#141414]">
        <section className="relative min-h-[640px] overflow-hidden">
          {pageHero.mediaType === "video" ? (
            <video
              aria-hidden="true"
              autoPlay
              className="absolute inset-0 h-full w-full object-cover"
              loop
              muted
              playsInline
              poster={pageHero.poster}
              src={pageHero.mediaSrc}
            />
          ) : (
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${pageHero.mediaSrc})` }}
            />
          )}
          {hasVisibleHeroContent ? (
            <div className="absolute inset-0 bg-gradient-to-r from-black via-black/72 to-black/18" />
          ) : null}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-b from-transparent via-[#141414]/88 to-[#141414]" />

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
                      href={pageHero.ctaHref}
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

        <div className="relative z-20 -mt-28 sm:-mt-32">
          <ContentStructureSection
            formationCourseOpenMode={formationCourseOpenMode}
            formationCourses={formationInternalCourses}
            internalCardActionMode={internalCardActionMode}
            item={item}
            modules={courseModules}
          />
        </div>
      </div>
      <MemberFooter />
    </AppShell>
  );
}

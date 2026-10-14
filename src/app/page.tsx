import { AppShell } from "@/components/app-shell";
import { ContentRow } from "@/components/content-row";
import { HeroSection } from "@/components/hero-section";
import { FeaturedStructureHomeSection } from "@/components/featured-structure-home-section";
import { MemberFooter } from "@/components/member-footer";
import { normalizeAccessPreviewMode } from "@/lib/access-preview";
import { getAppShellData, getHomePageData } from "@/server/db/platform-store";
import { requirePageUser } from "@/server/auth/guards";
import { isHeroVisible, resolveHomeHero } from "@/server/member-area/home-hero-model";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams?: Promise<{
    accessPreview?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const resolvedSearchParams = await searchParams;
  const requestedAccessPreviewMode = normalizeAccessPreviewMode(resolvedSearchParams?.accessPreview);
  const user = await requirePageUser("/");
  const shellData = await getAppShellData(user);
  const accessPreviewMode = shellData.canUseAccessPreview ? requestedAccessPreviewMode : undefined;
  const { hero: storedHero, homeRows, modalStructures } = await getHomePageData(accessPreviewMode, user);
  // Destaque gravado em Área de membros > Destaque: normalizado e com o botão conferido (link seguro).
  const hero = resolveHomeHero(storedHero);
  const heroVisible = isHeroVisible(hero);

  return (
    <AppShell
      accessPreviewMode={accessPreviewMode}
      branding={shellData.branding}
      canUseAccessPreview={shellData.canUseAccessPreview}
      student={shellData.student}
    >
      <HeroSection accessPreviewMode={accessPreviewMode} hero={hero} />
      <div className={`relative z-20 space-y-20 pb-24 ${heroVisible ? "mt-[var(--member-hero-overlap)]" : "pt-24"}`}>
        {homeRows.map((row) => {
          if (row.variant === "course_modules" && row.course && row.modules) {
            return (
              <FeaturedStructureHomeSection
                accessPreviewMode={accessPreviewMode}
                key={row.id}
                media={modalStructures[row.course.id]?.media}
                modalStructures={modalStructures}
                row={row}
              />
            );
          }

          return (
            <ContentRow
              accessPreviewMode={accessPreviewMode}
              items={row.items}
              key={row.id}
              modalStructures={modalStructures}
              subtitle={row.subtitle}
              title={row.title}
              variant={row.variant === "continue" ? "continue" : "vertical"}
            />
          );
        })}
      </div>
      <MemberFooter branding={shellData.branding} />
    </AppShell>
  );
}

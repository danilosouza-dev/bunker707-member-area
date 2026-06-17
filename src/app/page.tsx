import { AppShell } from "@/components/app-shell";
import { ContentRow, CourseModulesHomeSection } from "@/components/content-row";
import { HeroSection } from "@/components/hero-section";
import { MemberFooter } from "@/components/member-footer";
import { normalizeAccessPreviewMode } from "@/lib/access-preview";
import { getAppShellData, getHomePageData } from "@/server/db/platform-store";
import { requirePageUser } from "@/server/auth/guards";

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
  const { hero, homeRows, modalStructures } = await getHomePageData(accessPreviewMode, user);

  return (
    <AppShell
      accessPreviewMode={accessPreviewMode}
      canUseAccessPreview={shellData.canUseAccessPreview}
      student={shellData.student}
    >
      <HeroSection hero={hero} />
      <div className="relative z-20 -mt-24 space-y-20 pb-24">
        {homeRows.map((row) => {
          if (row.variant === "course_modules" && row.course && row.modules) {
            return (
              <CourseModulesHomeSection
                accessPreviewMode={accessPreviewMode}
                course={row.course}
                key={row.id}
                lockedActionMode={row.lockedActionMode}
                modules={row.modules}
                subtitle={row.subtitle}
                title={row.title}
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
      <MemberFooter />
    </AppShell>
  );
}

import { AppShell } from "@/components/app-shell";
import { FavoritesExperience } from "@/components/favorites-experience";
import { MemberFooter } from "@/components/member-footer";
import { normalizeAccessPreviewMode } from "@/lib/access-preview";
import { requirePageUser } from "@/server/auth/guards";
import { getAppShellData, getFavoritesPageData } from "@/server/db/platform-store";

export const dynamic = "force-dynamic";

type FavoritesPageProps = {
  searchParams?: Promise<{
    accessPreview?: string | string[];
  }>;
};

export default async function FavoritesPage({ searchParams }: FavoritesPageProps) {
  const resolvedSearchParams = await searchParams;
  const requestedAccessPreviewMode = normalizeAccessPreviewMode(resolvedSearchParams?.accessPreview);
  const user = await requirePageUser("/favoritos");
  const shellData = await getAppShellData(user);
  const accessPreviewMode = shellData.canUseAccessPreview ? requestedAccessPreviewMode : undefined;
  const favoritesData = await getFavoritesPageData(accessPreviewMode, user);

  return (
    <AppShell
      accessPreviewMode={accessPreviewMode}
      canUseAccessPreview={shellData.canUseAccessPreview}
      student={shellData.student}
    >
      <FavoritesExperience
        accessPreviewMode={accessPreviewMode}
        contentItems={favoritesData.savedContentItems}
        lessonItems={favoritesData.savedLessonItems}
        moduleItems={favoritesData.savedModuleItems}
      />
      <MemberFooter />
    </AppShell>
  );
}

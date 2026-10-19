import { AppShell } from "@/components/app-shell";
import { FavoritesExperience } from "@/components/favorites-experience";
import { MemberFooter } from "@/components/member-footer";
import { normalizeAccessPreviewMode } from "@/lib/access-preview";
import { requireStudentPageUser } from "@/server/auth/guards";
import { getAppShellData, getFavoritesPageData, getMemberLibrary } from "@/server/db/platform-store";
import { buildFavoritesPageView } from "@/server/member-area/favorites-view";

export const dynamic = "force-dynamic";

type FavoritesPageProps = {
  searchParams?: Promise<{
    accessPreview?: string | string[];
  }>;
};

// Favoritos: a lista vem de getFavoritesPageData (inclui o que o aluno salvou e nao pode abrir); o
// progresso vem da biblioteca do aluno. As duas leituras usam a mesma consulta em cache da requisicao.
// O componente de cliente recebe so o recorte da tela (buildFavoritesPageView).
export default async function FavoritesPage({ searchParams }: FavoritesPageProps) {
  const [resolvedSearchParams, user] = await Promise.all([searchParams, requireStudentPageUser("/favoritos")]);
  const requestedAccessPreviewMode = normalizeAccessPreviewMode(resolvedSearchParams?.accessPreview);
  const shellData = await getAppShellData(user);
  const accessPreviewMode = shellData.canUseAccessPreview ? requestedAccessPreviewMode : undefined;
  const [favoritesData, library] = await Promise.all([
    getFavoritesPageData(accessPreviewMode, user),
    getMemberLibrary(accessPreviewMode, user)
  ]);
  const view = buildFavoritesPageView(favoritesData, library);

  return (
    <AppShell
      accessPreviewMode={accessPreviewMode}
      branding={shellData.branding}
      canUseAccessPreview={shellData.canUseAccessPreview}
      student={shellData.student}
    >
      <FavoritesExperience view={view} />
      <MemberFooter branding={shellData.branding} />
    </AppShell>
  );
}

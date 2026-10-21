import { AppShell } from "@/components/app-shell";
import { MemberFooter } from "@/components/member-footer";
import { PurchasesExperience } from "@/components/purchases-experience";
import { normalizeAccessPreviewMode } from "@/lib/access-preview";
import { requirePageUser } from "@/server/auth/guards";
import { pageKeyOfRoute } from "@/server/member-area/page-visit-model";
import { trackMemberPageVisit } from "@/server/member-area/page-visits";
import { getAppShellData, getMemberLibrary } from "@/server/db/platform-store";
import { buildPurchasesPageView } from "@/server/member-area/purchases-view";

export const dynamic = "force-dynamic";

type PurchasesPageProps = {
  searchParams?: Promise<{
    accessPreview?: string | string[];
  }>;
};

// Minhas compras: biblioteca do aluno (acesso real + progresso dele). O componente de cliente recebe so
// o recorte da tela (buildPurchasesPageView), nunca a biblioteca inteira.
export default async function PurchasesPage({ searchParams }: PurchasesPageProps) {
  const [resolvedSearchParams, user] = await Promise.all([searchParams, requirePageUser("/minhas-compras")]);
  const requestedAccessPreviewMode = normalizeAccessPreviewMode(resolvedSearchParams?.accessPreview);
  const shellData = await getAppShellData(user);
  const accessPreviewMode = shellData.canUseAccessPreview ? requestedAccessPreviewMode : undefined;
  // getAppShellData e getMemberLibrary leem a mesma consulta em cache desta requisicao.
  const library = await getMemberLibrary(accessPreviewMode, user);
  const view = buildPurchasesPageView(library);
  await trackMemberPageVisit({ accessPreviewMode, pageKey: pageKeyOfRoute("/minhas-compras"), userId: user.id });

  return (
    <AppShell
      accessPreviewMode={accessPreviewMode}
      branding={shellData.branding}
      canUseAccessPreview={shellData.canUseAccessPreview}
      student={shellData.student}
    >
      <PurchasesExperience view={view} />
      <MemberFooter branding={shellData.branding} />
    </AppShell>
  );
}

import { AppShell } from "@/components/app-shell";
import { MemberFooter } from "@/components/member-footer";
import { PurchasesExperience } from "@/components/purchases-experience";
import { normalizeAccessPreviewMode } from "@/lib/access-preview";
import { getAppShellData, getPurchasesPageData } from "@/server/db/platform-store";
import { requirePageUser } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

type PurchasesPageProps = {
  searchParams?: Promise<{
    accessPreview?: string | string[];
  }>;
};

export default async function PurchasesPage({ searchParams }: PurchasesPageProps) {
  const resolvedSearchParams = await searchParams;
  const requestedAccessPreviewMode = normalizeAccessPreviewMode(resolvedSearchParams?.accessPreview);
  const user = await requirePageUser("/minhas-compras");
  const shellData = await getAppShellData(user);
  const accessPreviewMode = shellData.canUseAccessPreview ? requestedAccessPreviewMode : undefined;
  const { purchasedProducts } = await getPurchasesPageData(accessPreviewMode, user);

  return (
    <AppShell
      accessPreviewMode={accessPreviewMode}
      branding={shellData.branding}
      canUseAccessPreview={shellData.canUseAccessPreview}
      student={shellData.student}
    >
      <PurchasesExperience accessPreviewMode={accessPreviewMode} items={purchasedProducts} />
      <MemberFooter branding={shellData.branding} />
    </AppShell>
  );
}

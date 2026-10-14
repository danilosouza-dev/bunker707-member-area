import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { MemberFooter } from "@/components/member-footer";
import { JourneyView } from "@/components/member/pages/journey-view";
import { normalizeAccessPreviewMode } from "@/lib/access-preview";
import { requirePageUser } from "@/server/auth/guards";
import { getAppShellData } from "@/server/db/platform-store";
import { getJourneyPageData } from "@/server/member-area/student-pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Minha jornada | Bunker707"
};

type JourneyPageProps = {
  searchParams?: Promise<{
    accessPreview?: string | string[];
  }>;
};

export default async function JourneyPage({ searchParams }: JourneyPageProps) {
  const resolvedSearchParams = await searchParams;
  const requestedAccessPreviewMode = normalizeAccessPreviewMode(resolvedSearchParams?.accessPreview);
  const user = await requirePageUser("/minha-jornada");
  const shellData = await getAppShellData(user);
  const accessPreviewMode = shellData.canUseAccessPreview ? requestedAccessPreviewMode : undefined;
  const view = await getJourneyPageData(accessPreviewMode, user);

  return (
    <AppShell
      accessPreviewMode={accessPreviewMode}
      branding={shellData.branding}
      canUseAccessPreview={shellData.canUseAccessPreview}
      student={shellData.student}
    >
      <JourneyView accessPreviewMode={accessPreviewMode} view={view} />
      <MemberFooter branding={shellData.branding} />
    </AppShell>
  );
}

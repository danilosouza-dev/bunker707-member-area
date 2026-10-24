import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { MemberFooter } from "@/components/member-footer";
import { ContinueWatchingView } from "@/components/member/pages/continue-watching-view";
import { normalizeAccessPreviewMode } from "@/lib/access-preview";
import { requireStudentPageUser } from "@/server/auth/guards";
import { pageKeyOfRoute } from "@/server/member-area/page-visit-model";
import { trackMemberPageVisit } from "@/server/member-area/page-visits";
import { getAppShellData } from "@/server/db/platform-store";
import { getContinueWatchingPageData } from "@/server/member-area/student-pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Continue assistindo | Bunker707"
};

type ContinueWatchingPageProps = {
  searchParams?: Promise<{
    accessPreview?: string | string[];
  }>;
};

export default async function ContinueWatchingPage({ searchParams }: ContinueWatchingPageProps) {
  const resolvedSearchParams = await searchParams;
  const requestedAccessPreviewMode = normalizeAccessPreviewMode(resolvedSearchParams?.accessPreview);
  const user = await requireStudentPageUser("/continue-assistindo");
  const shellData = await getAppShellData(user);
  const accessPreviewMode = shellData.canUseAccessPreview ? requestedAccessPreviewMode : undefined;
  const view = await getContinueWatchingPageData(accessPreviewMode, user);
  await trackMemberPageVisit({ accessPreviewMode, pageKey: pageKeyOfRoute("/continue-assistindo"), userId: user.id });

  return (
    <AppShell
      accessPreviewMode={accessPreviewMode}
      branding={shellData.branding}
      canUseAccessPreview={shellData.canUseAccessPreview}
      student={shellData.student}
    >
      <ContinueWatchingView accessPreviewMode={accessPreviewMode} view={view} />
      <MemberFooter branding={shellData.branding} />
    </AppShell>
  );
}

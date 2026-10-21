import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { MemberFooter } from "@/components/member-footer";
import { ProfileView } from "@/components/member/pages/profile-view";
import { normalizeAccessPreviewMode } from "@/lib/access-preview";
import { requirePageUser } from "@/server/auth/guards";
import { pageKeyOfRoute } from "@/server/member-area/page-visit-model";
import { trackMemberPageVisit } from "@/server/member-area/page-visits";
import { getAppShellData } from "@/server/db/platform-store";
import { getProfilePageData } from "@/server/member-area/student-pages";
import { normalizeProfileTab } from "@/server/member-area/student-pages-model";
import { getStudentProfileRecord } from "@/server/member-area/student-profile";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Perfil | Bunker707"
};

type ProfilePageProps = {
  searchParams?: Promise<{
    aba?: string | string[];
    accessPreview?: string | string[];
  }>;
};

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const resolvedSearchParams = await searchParams;
  const requestedAccessPreviewMode = normalizeAccessPreviewMode(resolvedSearchParams?.accessPreview);
  const tab = normalizeProfileTab(resolvedSearchParams?.aba);
  const user = await requirePageUser("/perfil");
  // A linha de profiles (sessao do aluno) nao depende da previa: vai ao banco junto com o menu.
  const [shellData, profile] = await Promise.all([getAppShellData(user), getStudentProfileRecord(user)]);
  const accessPreviewMode = shellData.canUseAccessPreview ? requestedAccessPreviewMode : undefined;
  const { accesses, details } = await getProfilePageData(accessPreviewMode, user, shellData.student.fullName, profile);
  await trackMemberPageVisit({ accessPreviewMode, pageKey: pageKeyOfRoute("/perfil"), userId: user.id });

  return (
    <AppShell
      accessPreviewMode={accessPreviewMode}
      branding={shellData.branding}
      canUseAccessPreview={shellData.canUseAccessPreview}
      student={shellData.student}
    >
      <ProfileView accessPreviewMode={accessPreviewMode} accesses={accesses} details={details} tab={tab} />
      <MemberFooter branding={shellData.branding} />
    </AppShell>
  );
}

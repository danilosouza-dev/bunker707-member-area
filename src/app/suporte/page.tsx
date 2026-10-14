import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { MemberFooter } from "@/components/member-footer";
import { SupportView } from "@/components/member/pages/support-view";
import { normalizeAccessPreviewMode } from "@/lib/access-preview";
import { requirePageUser } from "@/server/auth/guards";
import { getAppShellData } from "@/server/db/platform-store";
import { getSupportPageData } from "@/server/member-area/student-pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Suporte | Bunker707"
};

type SupportPageProps = {
  searchParams?: Promise<{
    accessPreview?: string | string[];
  }>;
};

export default async function SupportPage({ searchParams }: SupportPageProps) {
  const resolvedSearchParams = await searchParams;
  const requestedAccessPreviewMode = normalizeAccessPreviewMode(resolvedSearchParams?.accessPreview);
  const user = await requirePageUser("/suporte");
  // Os canais nao dependem do aluno: leitura em paralelo com o topo da pagina.
  const [shellData, supportData] = await Promise.all([getAppShellData(user), getSupportPageData()]);
  const accessPreviewMode = shellData.canUseAccessPreview ? requestedAccessPreviewMode : undefined;

  return (
    <AppShell
      accessPreviewMode={accessPreviewMode}
      branding={shellData.branding}
      canUseAccessPreview={shellData.canUseAccessPreview}
      student={shellData.student}
    >
      <SupportView
        accessPreviewMode={accessPreviewMode}
        canUseAccessPreview={shellData.canUseAccessPreview}
        channels={supportData.channels}
        email={user.email ?? ""}
      />
      <MemberFooter branding={shellData.branding} />
    </AppShell>
  );
}

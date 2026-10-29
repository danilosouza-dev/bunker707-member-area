import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { MemberFooter } from "@/components/member-footer";
import { WebinarsPageView } from "@/components/member/webinars/webinars-page-view";
import { normalizeAccessPreviewMode } from "@/lib/access-preview";
import { requireStudentPageUser } from "@/server/auth/guards";
import { getAppShellData } from "@/server/db/platform-store";
import { getWebinarsPageData } from "@/server/webinars/student-queries";

// /webinarios (docs/30 §1.1): Proxima live, Em andamento e Replays, so com o que o aluno pode ver.
// Sem chave de visita de pagina nesta fase (pageKeyOfRoute nao conhece a rota: nada e gravado).

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Webinários | Bunker707"
};

type WebinarsPageProps = {
  searchParams?: Promise<{
    accessPreview?: string | string[];
  }>;
};

export default async function WebinarsPage({ searchParams }: WebinarsPageProps) {
  const resolvedSearchParams = await searchParams;
  const requestedAccessPreviewMode = normalizeAccessPreviewMode(resolvedSearchParams?.accessPreview);
  const user = await requireStudentPageUser("/webinarios");
  const shellData = await getAppShellData(user);
  const accessPreviewMode = shellData.canUseAccessPreview ? requestedAccessPreviewMode : undefined;
  const data = await getWebinarsPageData(accessPreviewMode, user);

  return (
    <AppShell
      accessPreviewMode={accessPreviewMode}
      branding={shellData.branding}
      canUseAccessPreview={shellData.canUseAccessPreview}
      student={shellData.student}
    >
      <WebinarsPageView accessPreviewMode={accessPreviewMode} data={data} />
      <MemberFooter branding={shellData.branding} />
    </AppShell>
  );
}

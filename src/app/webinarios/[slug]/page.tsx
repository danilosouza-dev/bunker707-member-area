import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { MemberFooter } from "@/components/member-footer";
import { WebinarPageView } from "@/components/member/webinars/webinar-page-view";
import { normalizeAccessPreviewMode } from "@/lib/access-preview";
import { requireStudentPageUser } from "@/server/auth/guards";
import { getAppShellData } from "@/server/db/platform-store";
import { webinarHref } from "@/server/webinars/model";
import { isWebinarSlug, normalizeSource } from "@/server/webinars/student-model";
import { getWebinarPageData } from "@/server/webinars/student-queries";

// /webinarios/[slug] (docs/30 §1.2): a pagina do Webinario com o Garantir vaga. Quem nao pode ver (fora do
// "Quem pode", rascunho, apagado) recebe a pagina de nao encontrado, sem saber se o webinario existe
// (docs/30 §8.2). ?origem= e o link de origem que a vaga guarda (docs/30 §2.8).

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Webinário | Bunker707"
};

type WebinarPageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{
    accessPreview?: string | string[];
    origem?: string | string[];
  }>;
};

export default async function WebinarPage({ params, searchParams }: WebinarPageProps) {
  const { slug } = await params;

  if (!isWebinarSlug(slug)) {
    notFound();
  }

  const resolvedSearchParams = await searchParams;
  const requestedAccessPreviewMode = normalizeAccessPreviewMode(resolvedSearchParams?.accessPreview);
  const user = await requireStudentPageUser(webinarHref(slug));
  const shellData = await getAppShellData(user);
  const accessPreviewMode = shellData.canUseAccessPreview ? requestedAccessPreviewMode : undefined;
  const data = await getWebinarPageData(accessPreviewMode, user, slug);

  if (data.state === "not_found") {
    notFound();
  }

  return (
    <AppShell
      accessPreviewMode={accessPreviewMode}
      branding={shellData.branding}
      canUseAccessPreview={shellData.canUseAccessPreview}
      student={shellData.student}
    >
      <WebinarPageView accessPreviewMode={accessPreviewMode} data={data} source={normalizeSource(resolvedSearchParams?.origem)} />
      <MemberFooter branding={shellData.branding} />
    </AppShell>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { MemberFooter } from "@/components/member-footer";
import { WebinarPageView } from "@/components/member/webinars/webinar-page-view";
import { normalizeAccessPreviewMode } from "@/lib/access-preview";
import { GuestFrame } from "@/components/member/webinars/guest-frame";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { getAppShellData } from "@/server/db/platform-store";
import { liveRoomConfigured } from "@/server/webinars/live-model";
import { webinarHref } from "@/server/webinars/model";
import { isWebinarSlug, normalizeSource } from "@/server/webinars/student-model";
import { getWebinarPageData } from "@/server/webinars/student-queries";
import { resolveWebinarViewer } from "@/server/webinars/guest-page";
import { WEBINARS_FEATURE } from "@/server/licensing/features";
import { requireFeaturePage } from "@/server/licensing/guards";

// /webinarios/[slug] (docs/30 §1.2): a pagina do Webinario com o Garantir vaga e o Entrar. Quem nao pode ver (fora
// do "Quem pode", rascunho, apagado) recebe a pagina de nao encontrado, sem saber se o webinario existe
// (docs/30 §8.2). ?origem= e o link de origem que a vaga guarda (docs/30 §2.8). Se a sala ao vivo existe neste
// ambiente (WEBINAR_MEET_DOMAIN e o segredo do token) e lido aqui, no servidor, e vai so como sim/nao para a tela:
// sem ela, o Entrar da Live ao vivo diz "em breve" (fase 3, docs/30 §1.3). O link aberto (docs/30 §14): sem sessao e com
// o link ligado, o formulario de entrada; o convidado ve esta pagina na moldura dele, sem o menu da area de membros.

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
  // Sem o modulo dos Webinarios na licenca: 404 antes da sessao e do banco (docs/32 §11.8).
  await requireFeaturePage(WEBINARS_FEATURE);

  const { slug } = await params;

  if (!isWebinarSlug(slug)) {
    notFound();
  }

  const resolvedSearchParams = await searchParams;
  const requestedAccessPreviewMode = normalizeAccessPreviewMode(resolvedSearchParams?.accessPreview);
  const { guest, user } = await resolveWebinarViewer(slug, webinarHref(slug));
  const shellData = await getAppShellData(guest ? undefined : user);
  const accessPreviewMode = !guest && shellData.canUseAccessPreview ? requestedAccessPreviewMode : undefined;
  const data = await getWebinarPageData(accessPreviewMode, user, slug);

  if (data.state === "not_found") {
    notFound();
  }

  if (guest) {
    return (
      <GuestFrame branding={shellData.branding} note={WEBINAR_COPY.linkAberto.moldura.convidado}>
        <WebinarPageView data={data} liveRoomConfigured={liveRoomConfigured(process.env)} source={normalizeSource(resolvedSearchParams?.origem)} />
      </GuestFrame>
    );
  }

  return (
    <AppShell
      accessPreviewMode={accessPreviewMode}
      branding={shellData.branding}
      canUseAccessPreview={shellData.canUseAccessPreview}
      disabledFeatures={shellData.disabledFeatures}
      student={shellData.student}
    >
      <WebinarPageView
        accessPreviewMode={accessPreviewMode}
        data={data}
        liveRoomConfigured={liveRoomConfigured(process.env)}
        source={normalizeSource(resolvedSearchParams?.origem)}
      />
      <MemberFooter branding={shellData.branding} />
    </AppShell>
  );
}

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { GuestEntryForm } from "@/components/member/webinars/guest-entry-form";
import { GuestFrame } from "@/components/member/webinars/guest-frame";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { getSessionUserOrGuest } from "@/server/auth/session";
import { getAppShellData } from "@/server/db/platform-store";
import { webinarsDb } from "@/server/webinars/db";
import { loadOpenLinkWebinar, openLinkNextWhen } from "@/server/webinars/guests";
import { webinarHref } from "@/server/webinars/model";
import { guestConsentText, guestIdentityOf, openLinkShareMetadata } from "@/server/webinars/open-link-model";
import { isWebinarSlug, normalizeSource } from "@/server/webinars/student-model";
import { WEBINARS_FEATURE } from "@/server/licensing/features";
import { requireFeaturePage } from "@/server/licensing/guards";

// /webinarios/[slug]/entrar (docs/30 §14, D127 a D134): o formulario do link aberto, a porta de quem nao e aluno. So
// com o link ligado e o webinario publicado (senao, nao encontrado, sem dizer se existe). O aluno e a equipe logados vao
// direto para a pagina do webinario (o link aberto tambem os deixa entrar); o convidado deste webinario tambem. O
// convidado de outro webinario ve o formulario e, entrando, troca de conta. ?origem= vai junto com a entrada (de onde
// a pessoa veio: o anuncio, o grupo, o e-mail).

export const dynamic = "force-dynamic";

const defaultMetadata: Metadata = {
  title: `${WEBINAR_COPY.linkAberto.entrar.tituloPagina} | Bunker707`
};

// O webinario do pedido uma vez so: o cartao do link e a pagina leem o mesmo.
const readOpenLinkWebinar = cache((slug: string) => loadOpenLinkWebinar(webinarsDb(), slug));

type EntryPageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ origem?: string | string[] }>;
};

/**
 * O cartao do link no WhatsApp e nas redes (D136): a capa, o titulo e a descricao, so com o link ligado e o webinario
 * publicado. Com erro na leitura, o titulo de sempre (o cartao nunca derruba a pagina).
 */
export async function generateMetadata({ params }: EntryPageProps): Promise<Metadata> {
  await requireFeaturePage(WEBINARS_FEATURE);

  const { slug } = await params;

  if (!isWebinarSlug(slug)) {
    return defaultMetadata;
  }

  const webinar = await readOpenLinkWebinar(slug).catch(() => null);

  return webinar ? openLinkShareMetadata(webinar, WEBINAR_COPY.linkAberto.entrar.compartilhar) : defaultMetadata;
}

export default async function WebinarEntryPage({ params, searchParams }: EntryPageProps) {
  await requireFeaturePage(WEBINARS_FEATURE);

  const { slug } = await params;

  if (!isWebinarSlug(slug)) {
    notFound();
  }

  const user = await getSessionUserOrGuest();
  const guest = user ? guestIdentityOf(user.app_metadata) : null;

  // Aluno ou equipe: a pagina do webinario decide pelo acesso (com o link ligado, entra).
  if (user && !guest) {
    redirect(webinarHref(slug));
  }

  const db = webinarsDb();
  const webinar = await readOpenLinkWebinar(slug);

  if (!webinar) {
    notFound();
  }

  if (guest?.webinarId === webinar.id) {
    redirect(webinarHref(slug));
  }

  const [shellData, when] = await Promise.all([getAppShellData(), openLinkNextWhen(db, webinar)]);
  const resolved = await searchParams;

  return (
    <GuestFrame branding={shellData.branding}>
      <GuestEntryForm
        consentText={guestConsentText(webinar.title)}
        coverUrl={webinar.coverUrl}
        description={webinar.description}
        fields={webinar.openLink}
        slug={webinar.slug}
        source={normalizeSource(resolved?.origem)}
        title={webinar.title}
        when={when}
      />
    </GuestFrame>
  );
}

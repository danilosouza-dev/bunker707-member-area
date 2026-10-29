import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { MemberFooter } from "@/components/member-footer";
import { LiveWebinarRoom } from "@/components/member/webinars/room/live-room";
import { WebinarRoom } from "@/components/member/webinars/room/webinar-room";
import { WebinarPageView } from "@/components/member/webinars/webinar-page-view";
import { MemberEmptyState } from "@/components/member/ui/member-empty-state";
import { MemberButtonLink } from "@/components/member/ui/member-button";
import { MemberPage } from "@/components/member/ui/member-page";
import { normalizeAccessPreviewMode, withAccessPreviewParam } from "@/lib/access-preview";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { requireStudentPageUser } from "@/server/auth/guards";
import { isUuid } from "@/server/communications/route-support";
import { getAppShellData } from "@/server/db/platform-store";
import { liveRoomConfigured } from "@/server/webinars/live-model";
import { webinarHref } from "@/server/webinars/model";
import { isWebinarSlug } from "@/server/webinars/student-model";
import { getRoomPageData } from "@/server/webinars/student-queries";
import { Radio } from "lucide-react";

// /webinarios/[slug]/sala?sessao= (docs/30 §1.3 e §1.6): a Sala da Live gravada, do Replay ou da Live ao vivo (fase 3),
// um dialogo de tela cheia por cima da pagina da live (que fica por baixo para a pilula do Minimizar). Fora do acesso ou
// sessao de outro webinario: nao encontrado, sem dizer se existe (docs/30 §8.2). Gravada fora da janela de entrada
// (antes de 15 min, depois do fim ou da Entrada atrasada), sessao cancelada ou sem a vaga numa live com limite de
// vagas (A12): a frase e o caminho de volta. A Live ao vivo abre em qualquer situacao (a tela diz Aguardando o
// apresentador, sala trancada, em breve, encerrada, removido ou banido) e recebe o nonce da pagina: o external_api.js
// do nosso servidor de video entra com ele, sem origem nova na CSP (docs/30 §8.4). Nenhum pop-up aqui (docs/25 §1,
// "onde nunca": a rota nao tem chave de pagina e o palco anuncia o sinal de midia).

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sala | Bunker707"
};

type RoomPageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ accessPreview?: string | string[]; sessao?: string | string[] }>;
};

export default async function WebinarRoomPage({ params, searchParams }: RoomPageProps) {
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;
  const sessao = Array.isArray(resolvedSearchParams?.sessao) ? resolvedSearchParams?.sessao[0] : resolvedSearchParams?.sessao;

  if (!isWebinarSlug(slug) || !isUuid(sessao)) {
    notFound();
  }

  const requestedAccessPreviewMode = normalizeAccessPreviewMode(resolvedSearchParams?.accessPreview);
  const user = await requireStudentPageUser(`${webinarHref(slug)}/sala?sessao=${encodeURIComponent(sessao)}`);
  const shellData = await getAppShellData(user);
  const accessPreviewMode = shellData.canUseAccessPreview ? requestedAccessPreviewMode : undefined;
  const data = await getRoomPageData(accessPreviewMode, user, slug, sessao.toLowerCase());

  if (data.state === "not_found") {
    notFound();
  }

  const backHref = withAccessPreviewParam(webinarHref(slug), accessPreviewMode);
  const copy = WEBINAR_COPY.sala;
  const nonce = data.state === "ready" && data.payload.session.kind === "live" ? ((await headers()).get("x-nonce") ?? null) : null;

  return (
    <AppShell accessPreviewMode={accessPreviewMode} branding={shellData.branding} canUseAccessPreview={shellData.canUseAccessPreview} student={shellData.student}>
      {data.state === "error" ? (
        <MemberPage width="default">
          <MemberEmptyState
            action={
              <MemberButtonLink href={backHref} variant="primary">
                {copy.tentarDeNovo}
              </MemberButtonLink>
            }
            description={WEBINAR_COPY.aluno.erroCarregar}
            icon={Radio}
            title={WEBINAR_COPY.aluno.erroCarregarTitulo}
          />
        </MemberPage>
      ) : null}

      {data.state === "refused" ? (
        <MemberPage width="default">
          <MemberEmptyState
            action={
              <MemberButtonLink href={backHref} variant="primary">
                {WEBINAR_COPY.aluno.titulo}
              </MemberButtonLink>
            }
            description={
              data.reason === "banned"
                ? WEBINAR_COPY.aoVivo.banido
                : data.reason === "not_started"
                  ? copy.naoComecou
                  : data.reason === "late"
                    ? copy.entradaAtrasada
                    : data.reason === "no_seat"
                      ? copy.vagaObrigatoria
                      : data.reason === "cancelled"
                        ? WEBINAR_COPY.aluno.cancelada
                        : copy.encerrada
            }
            icon={Radio}
            title={data.page.view.title}
          />
        </MemberPage>
      ) : null}

      {data.state === "ready" ? (
        <>
          <WebinarPageView
            accessPreviewMode={accessPreviewMode}
            data={{ now: data.now, page: data.page, state: "ready" }}
            liveRoomConfigured={liveRoomConfigured(process.env)}
            source={null}
          />
          {data.payload.session.kind === "live" ? (
            <LiveWebinarRoom
              coverUrl={data.page.view.coverUrl}
              nonce={nonce}
              payload={data.payload}
              presenterName={data.page.view.presenterName}
              readOnly={Boolean(accessPreviewMode)}
              staff={data.staff}
              webinarHref={backHref}
            />
          ) : (
            <WebinarRoom coverUrl={data.page.view.coverUrl} payload={data.payload} readOnly={Boolean(accessPreviewMode)} webinarHref={backHref} />
          )}
        </>
      ) : null}
      <MemberFooter branding={shellData.branding} />
    </AppShell>
  );
}

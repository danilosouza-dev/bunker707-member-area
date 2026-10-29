import Image from "next/image";
import Link from "next/link";
import { CalendarClock, ImageOff, Radio, TriangleAlert } from "lucide-react";
import { MemberButtonLink, memberButtonClassName } from "@/components/member/ui/member-button";
import { MemberChip } from "@/components/member/ui/member-chip";
import { MemberEmptyState } from "@/components/member/ui/member-empty-state";
import { MemberPage, MemberPageHeader, MemberSection } from "@/components/member/ui/member-page";
import { memberPosterGridClassName } from "@/components/member/ui/member-poster-card";
import { MemberSurface } from "@/components/member/ui/member-surface";
import { withAccessPreviewParam, type AccessPreviewMode } from "@/lib/access-preview";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { MEMBER_ROUTES } from "@/lib/member-navigation";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { phaseLabel, type StudentWebinarView } from "@/server/webinars/student-model";
import type { WebinarsPageData } from "@/server/webinars/student-queries";
import { WebinarCountdown } from "./webinar-countdown";
import { WebinarFacts } from "./webinar-facts";
import { WebinarPosterCard } from "./webinar-poster-card";

// /webinarios (docs/30 §1.1): tres blocos em cards verticais. Proxima live (o mais proximo em destaque, com
// capa, data e hora de Sao Paulo, duracao, apresentador e a contagem regressiva; os seguintes numa grade),
// Em andamento (botao Entrar) e Replays (selo Replay). So o que o aluno pode ver; estados honestos para
// "nenhuma live" e para falha de leitura.

function FeaturedWebinar({ accessPreviewMode, serverNow, view }: { accessPreviewMode?: AccessPreviewMode; serverNow: number; view: StudentWebinarView }) {
  const copy = WEBINAR_COPY.aluno;
  const session = view.primary;
  const href = withAccessPreviewParam(view.href, accessPreviewMode);
  const cover = view.coverUrl?.trim();
  const cta =
    view.phase === "registered" ? copy.selo.vagaGarantida : view.phase === "sold_out" ? phaseLabel("sold_out") : view.registrationRequired ? copy.garantirVaga : copy.entrar;

  return (
    <MemberSurface className="overflow-hidden" padding="none">
      <div className="grid grid-cols-[112px_1fr] gap-4 p-4 sm:grid-cols-[180px_1fr] sm:gap-6 sm:p-6 lg:grid-cols-[220px_1fr]">
        <Link
          aria-label={`Abrir ${view.title}`}
          className="block self-start rounded-[var(--member-cover-radius)] outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-4 focus-visible:ring-offset-[#181818]"
          href={href}
        >
          <div className="relative aspect-[2/3] overflow-hidden rounded-[var(--member-cover-radius)] bg-[#1f1f1f] ring-1 ring-white/[0.08]">
            {cover ? (
              <Image
                alt=""
                className="object-cover"
                fill
                priority
                sizes="(min-width: 1024px) 220px, (min-width: 640px) 180px, 112px"
                src={cover}
                unoptimized={!canOptimizeImageSrc(cover)}
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(160deg,#262626,#151515)] text-zinc-500">
                <ImageOff aria-hidden="true" className="size-6" strokeWidth={1.8} />
              </div>
            )}
          </div>
        </Link>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <MemberChip tone="neutral">{view.kindLabel}</MemberChip>
            {view.phase === "registered" ? <MemberChip tone="success">{copy.selo.vagaGarantida}</MemberChip> : null}
            {view.phase === "sold_out" ? <MemberChip tone="warning">{phaseLabel("sold_out")}</MemberChip> : null}
          </div>
          <h3 className="mt-3 text-xl font-bold leading-tight text-white sm:text-2xl">
            <Link className="outline-none hover:underline focus-visible:underline" href={href}>
              {view.title}
            </Link>
          </h3>
          {view.description ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-zinc-400">{view.description}</p> : null}
          {session ? <WebinarFacts className="mt-4" durationLabel={view.durationLabel} presenterName={view.presenterName} session={session} /> : null}
          {session ? (
            <p className="mt-5 flex items-center gap-2 text-lg font-bold text-white">
              <CalendarClock aria-hidden="true" className="size-5 shrink-0 text-[var(--accent)]" strokeWidth={2.2} />
              <WebinarCountdown fallback={copy.aguardando} serverNow={serverNow} targetIso={session.scheduledAt} />
            </p>
          ) : null}
          {session && session.registeredCount !== null ? <p className="mt-1 text-xs text-zinc-500">{copy.vagasGarantidas(session.registeredCount)}</p> : null}
          <div className="mt-5">
            <MemberButtonLink href={href} size="lg" variant={view.phase === "registered" ? "secondary" : "primary"}>
              {cta}
            </MemberButtonLink>
          </div>
        </div>
      </div>
    </MemberSurface>
  );
}

export function WebinarsPageView({ accessPreviewMode, data }: { accessPreviewMode?: AccessPreviewMode; data: WebinarsPageData }) {
  const copy = WEBINAR_COPY.aluno;
  const ready = data.state === "ready" ? data : null;
  const lists = ready?.lists ?? null;
  // Sem leitura nao ha contagem regressiva para desenhar: o valor nao e usado.
  const serverNow = ready?.now ?? 0;
  const empty = lists !== null && lists.upcoming.length === 0 && lists.inProgress.length === 0 && lists.replays.length === 0;
  const [featured, ...rest] = lists?.upcoming ?? [];
  const webinarsHref = withAccessPreviewParam(MEMBER_ROUTES.webinars, accessPreviewMode);

  return (
    <MemberPage width="default">
      <MemberPageHeader description={copy.subtitulo} eyebrow={{ icon: Radio, label: copy.lives }} title={copy.titulo} />

      {lists && !empty ? (
        <div className="grid gap-12">
          {featured ? (
            <MemberSection id="proxima-live" title={copy.proximaLive}>
              <FeaturedWebinar accessPreviewMode={accessPreviewMode} serverNow={serverNow} view={featured} />
              {rest.length > 0 ? (
                <div className="mt-8">
                  <h3 className="mb-4 text-sm font-semibold text-zinc-400">{copy.proximas}</h3>
                  <div className={memberPosterGridClassName}>
                    {rest.map((view) => (
                      <WebinarPosterCard accessPreviewMode={accessPreviewMode} key={view.id} serverNow={serverNow} variant="upcoming" view={view} />
                    ))}
                  </div>
                </div>
              ) : null}
            </MemberSection>
          ) : null}

          {lists.inProgress.length > 0 ? (
            <MemberSection count={lists.inProgress.length} id="em-andamento" title={copy.emAndamento}>
              <div className={memberPosterGridClassName}>
                {lists.inProgress.map((view) => (
                  <WebinarPosterCard accessPreviewMode={accessPreviewMode} key={view.id} serverNow={serverNow} variant="in_progress" view={view} />
                ))}
              </div>
            </MemberSection>
          ) : null}

          {lists.replays.length > 0 ? (
            <MemberSection count={lists.replays.length} id="replays" title={copy.replays}>
              <div className={memberPosterGridClassName}>
                {lists.replays.map((view) => (
                  <WebinarPosterCard accessPreviewMode={accessPreviewMode} key={view.id} serverNow={serverNow} variant="replay" view={view} />
                ))}
              </div>
            </MemberSection>
          ) : null}
        </div>
      ) : null}

      {empty ? <MemberEmptyState description={copy.semLives} icon={Radio} title={copy.semLivesTitulo} /> : null}

      {data.state === "error" ? (
        <MemberEmptyState
          action={
            <a className={memberButtonClassName({ variant: "primary" })} href={webinarsHref}>
              {copy.tentarDeNovo}
            </a>
          }
          description={copy.erroCarregar}
          icon={TriangleAlert}
          title={copy.erroCarregarTitulo}
        />
      ) : null}
    </MemberPage>
  );
}

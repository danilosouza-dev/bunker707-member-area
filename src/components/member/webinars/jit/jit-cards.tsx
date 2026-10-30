import Image from "next/image";
import Link from "next/link";
import { CalendarClock, ImageOff, Radio } from "lucide-react";
import { MemberButtonLink } from "@/components/member/ui/member-button";
import { MemberChip } from "@/components/member/ui/member-chip";
import { MemberPosterCard } from "@/components/member/ui/member-poster-card";
import { MemberSurface } from "@/components/member/ui/member-surface";
import { withAccessPreviewParam, type AccessPreviewMode } from "@/lib/access-preview";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { StudentJitView, StudentWebinarView } from "@/server/webinars/student-model";
import { JitCountdown } from "./jit-countdown";

// O webinario com o "Comeca quando voce entra" em /webinarios (fase 4e; docs/30 §1.1 e §1.6): um card so, nunca cada
// sessao `jit`. No lugar da data, o selo "Começa quando você entra" e a frase de agora ("A próxima sessão começa em
// {n} min", andando no navegador); o card leva a pagina do webinario, onde fica o Entrar (sem Garantir vaga). O card
// vertical das grades (JitPosterCard) e o destaque de Proxima live (JitFeaturedWebinar), no desenho dos outros.

type WithJit = StudentWebinarView & { jit: StudentJitView };

export function hasJit(view: StudentWebinarView): view is WithJit {
  return view.jit !== null;
}

function JitChips({ view }: { view: WithJit }) {
  return (
    <>
      <MemberChip tone="neutral">{view.kindLabel}</MemberChip>
      <MemberChip icon={Radio} tone="outline">
        {WEBINAR_COPY.jit.aluno.selo}
      </MemberChip>
    </>
  );
}

export function JitPosterCard({ accessPreviewMode, className, priority = false, serverNow, view }: { accessPreviewMode?: AccessPreviewMode; className?: string; priority?: boolean; serverNow: number; view: WithJit }) {
  return (
    <MemberPosterCard
      badge={<JitChips view={view} />}
      className={className}
      footer={<JitCountdown jit={view.jit} serverNow={serverNow} />}
      href={withAccessPreviewParam(view.href, accessPreviewMode)}
      image={view.coverUrl}
      meta={view.durationLabel}
      priority={priority}
      title={view.title}
    />
  );
}

export function JitFeaturedWebinar({ accessPreviewMode, serverNow, view }: { accessPreviewMode?: AccessPreviewMode; serverNow: number; view: WithJit }) {
  const copy = WEBINAR_COPY.aluno;
  const href = withAccessPreviewParam(view.href, accessPreviewMode);
  const cover = view.coverUrl?.trim();

  return (
    <MemberSurface className="overflow-hidden" data-jit-featured="" padding="none">
      <div className="grid grid-cols-[112px_1fr] gap-4 p-4 sm:grid-cols-[180px_1fr] sm:gap-6 sm:p-6 lg:grid-cols-[220px_1fr]">
        <Link
          aria-label={`Abrir ${view.title}`}
          className="block self-start rounded-[var(--member-cover-radius)] outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-4 focus-visible:ring-offset-[#181818]"
          href={href}
        >
          <div className="relative aspect-[2/3] overflow-hidden rounded-[var(--member-cover-radius)] bg-[#1f1f1f] ring-1 ring-white/[0.08]">
            {cover ? (
              <Image alt="" className="object-cover" fill priority sizes="(min-width: 1024px) 220px, (min-width: 640px) 180px, 112px" src={cover} unoptimized={!canOptimizeImageSrc(cover)} />
            ) : (
              <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(160deg,#262626,#151515)] text-zinc-500">
                <ImageOff aria-hidden="true" className="size-6" strokeWidth={1.8} />
              </div>
            )}
          </div>
        </Link>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <JitChips view={view} />
          </div>
          <h3 className="mt-3 text-xl font-bold leading-tight text-white sm:text-2xl">
            <Link className="outline-none hover:underline focus-visible:underline" href={href}>
              {view.title}
            </Link>
          </h3>
          {view.description ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-zinc-400">{view.description}</p> : null}
          <p className="mt-5 flex items-center gap-2 text-lg font-bold text-white">
            <CalendarClock aria-hidden="true" className="size-5 shrink-0 text-[var(--accent)]" strokeWidth={2.2} />
            <JitCountdown jit={view.jit} serverNow={serverNow} />
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {view.durationLabel}
            {view.presenterName ? ` · ${copy.apresentador}: ${view.presenterName}` : ""}
          </p>
          <div className="mt-5">
            <MemberButtonLink href={href} size="lg" variant="primary">
              {WEBINAR_COPY.jit.aluno.entrar}
            </MemberButtonLink>
          </div>
        </div>
      </div>
    </MemberSurface>
  );
}

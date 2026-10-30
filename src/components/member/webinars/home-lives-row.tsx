import Link from "next/link";
import { ArrowRight, Radio } from "lucide-react";
import { withAccessPreviewParam, type AccessPreviewMode } from "@/lib/access-preview";
import { MEMBER_ROUTES } from "@/lib/member-navigation";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { HomeWebinarCard } from "@/server/webinars/student-model";
import { JitPosterCard, hasJit } from "./jit/jit-cards";
import { WebinarPosterCard, type WebinarCardVariant } from "./webinar-poster-card";

// A fileira "Lives" da pagina inicial (docs/30 §1.1): o card "Proxima live" (ou "Replay disponivel" por
// alguns dias) acima das fileiras de produto, com o mesmo card vertical e a contagem regressiva. So entra
// quando a equipe marcou "Card na pagina inicial" e o aluno pode ver o webinario; some sozinho ao encerrar.

function variantOf(card: HomeWebinarCard): WebinarCardVariant {
  if (card.kind === "replay") {
    return "replay";
  }
  return card.view.phase === "waiting" || card.view.phase === "live" ? "in_progress" : "upcoming";
}

export function HomeLivesRow({ accessPreviewMode, card, serverNow }: { accessPreviewMode?: AccessPreviewMode; card: HomeWebinarCard; serverNow: number }) {
  const copy = WEBINAR_COPY.aluno;

  return (
    <section aria-labelledby="lives-titulo" className="min-w-0">
      <div className="mb-4 flex items-end justify-between gap-4 px-[var(--member-row-inset)]">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold text-zinc-400">
            <Radio aria-hidden="true" className="size-4 text-[var(--accent)]" strokeWidth={2.2} />
            {card.kind === "replay" ? copy.replayDisponivel : copy.proximaLive}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white sm:text-2xl" id="lives-titulo">
            {copy.lives}
          </h2>
        </div>
        <Link
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] px-2 text-sm font-semibold text-zinc-300 outline-none transition hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          href={withAccessPreviewParam(MEMBER_ROUTES.webinars, accessPreviewMode)}
        >
          {copy.verTodas}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <div className="member-row-scroller scrollbar-hidden flex gap-[0.75rem] overflow-x-auto overscroll-x-contain px-[var(--member-row-inset)]">
        {/* Fase 4e: o webinario do "Começa quando você entra" usa o card com a contagem do proximo horario. */}
        {hasJit(card.view) ? (
          <JitPosterCard accessPreviewMode={accessPreviewMode} className="w-[44vw] shrink-0 sm:w-[200px] lg:w-[220px]" priority serverNow={serverNow} view={card.view} />
        ) : (
          <WebinarPosterCard
            accessPreviewMode={accessPreviewMode}
            className="w-[44vw] shrink-0 sm:w-[200px] lg:w-[220px]"
            priority
            serverNow={serverNow}
            variant={variantOf(card)}
            view={card.view}
          />
        )}
      </div>
    </section>
  );
}

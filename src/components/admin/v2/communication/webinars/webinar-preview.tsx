"use client";

import { CalendarClock, Play } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_ADMIN_COPY, webinarPreviewCard } from "@/server/webinars/editor-model";
import type { WebinarDraft } from "@/server/webinars/model";
import type { PreviewDevice } from "../../member-area/preview-frame";

// Previa do webinario (docs/30 §2.2): o card da pagina inicial (capa 2:3, titulo, tipo e data) e o topo da pagina
// do webinario (capa em 16:9, titulo, data, contagem e o botao), no celular (375 px) e no computador. Desenho
// proprio e inerte (nada recebe foco): a pagina real do aluno e da entrega 1b e nao e importada aqui.

const STUDENT_STYLE: CSSProperties & Record<string, string> = {
  "--accent": "#e50914",
  background: "#141414",
  color: "#f7f7f4"
};

type WebinarPreviewProps = {
  className?: string;
  /** Capa recortada ainda subindo (data URL): a previa mostra antes do envio terminar. */
  coverUrl?: string | null;
  device: PreviewDevice;
  draft: WebinarDraft;
  now: number;
};

function Cover({ className, src, title }: { className?: string; src: string | null; title: string }) {
  return (
    <span className={cn("relative block overflow-hidden rounded-lg bg-[#262626]", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- previa inerte da capa (data URL ou link), sem otimizacao
        <img alt="" className="absolute inset-0 size-full object-cover" src={src} />
      ) : (
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-white/40">
          <CalendarClock className="size-8" strokeWidth={1.5} />
        </span>
      )}
      <span className="sr-only">{title}</span>
    </span>
  );
}

function HomeCard({ card, coverUrl }: { card: ReturnType<typeof webinarPreviewCard>; coverUrl: string | null }) {
  return (
    <div className="flex w-[150px] shrink-0 flex-col gap-2">
      <Cover className="aspect-[2/3] w-full" src={coverUrl} title={card.title} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[11px] leading-4 font-medium tracking-[0.04em] text-[#a8a8a2] uppercase">{card.kindLabel}</span>
        <span className="line-clamp-2 text-[13px] leading-[18px] font-semibold">{card.title}</span>
        <span className="text-xs leading-4 text-[#a8a8a2]">{card.whenLabel}</span>
      </div>
    </div>
  );
}

function PageTop({ card, coverUrl, draft, wide }: { card: ReturnType<typeof webinarPreviewCard>; coverUrl: string | null; draft: WebinarDraft; wide: boolean }) {
  return (
    <div className={cn("flex min-w-0 gap-4", wide ? "flex-row items-start" : "flex-col")}>
      <Cover className={cn(wide ? "aspect-video w-[320px] shrink-0" : "aspect-video w-full")} src={coverUrl} title={card.title} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/15 px-2 py-0.5 text-[11px] leading-4 font-medium text-[#f7f7f4]">
          <Play aria-hidden="true" className="size-3" />
          {card.kindLabel}
        </span>
        <h3 className="text-lg leading-6 font-semibold">{card.title}</h3>
        <p className="text-sm leading-5 text-[#a8a8a2]">
          {card.whenLabel}
          {card.sessionsLabel ? ` · ${card.sessionsLabel}` : ""}
        </p>
        {card.countdown ? <p className="text-sm leading-5 font-medium text-[#f7f7f4]">{card.countdown}</p> : null}
        {draft.description.trim() ? <p className="line-clamp-3 text-sm leading-5 text-[#d4d4d0]">{draft.description.trim()}</p> : null}
        <span className="mt-1 inline-flex h-10 w-fit items-center rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white">{card.registrationLabel}</span>
      </div>
    </div>
  );
}

export function WebinarPreview({ className, coverUrl, device, draft, now }: WebinarPreviewProps) {
  const card = webinarPreviewCard(draft, now);
  const cover = coverUrl ?? draft.coverUrl;
  const wide = device === "desktop";

  return (
    <figure aria-label={`Prévia do webinário no ${wide ? "computador" : "celular"}`} className={cn("m-0 flex min-w-0 flex-col items-center gap-2", className)}>
      <div
        className={cn("flex w-full min-w-0 flex-col gap-6 overflow-hidden rounded-lg border border-[var(--border-strong)] p-4", wide ? "max-w-[720px]" : "max-w-[375px]")}
        inert
        style={STUDENT_STYLE}
      >
        <section className="flex min-w-0 flex-col gap-3">
          <h4 className="text-xs leading-4 font-medium tracking-[0.04em] text-[#a8a8a2] uppercase">{WEBINAR_ADMIN_COPY.preview.homeCard}</h4>
          <div className="flex min-w-0 gap-3 overflow-hidden">
            <HomeCard card={card} coverUrl={cover} />
            <div aria-hidden="true" className="flex w-[150px] shrink-0 flex-col gap-2 opacity-40">
              <span className="block aspect-[2/3] w-full rounded-lg bg-[#262626]" />
              <span className="block h-3 w-3/4 rounded bg-[#262626]" />
            </div>
          </div>
        </section>
        <section className="flex min-w-0 flex-col gap-3 border-t border-white/10 pt-4">
          <h4 className="text-xs leading-4 font-medium tracking-[0.04em] text-[#a8a8a2] uppercase">{WEBINAR_ADMIN_COPY.preview.pageCard}</h4>
          <PageTop card={card} coverUrl={cover} draft={draft} wide={wide} />
        </section>
      </div>
      <figcaption className="text-center text-xs leading-5 text-[var(--text-secondary)]">{wide ? "Computador" : "Celular · 375 px"}</figcaption>
    </figure>
  );
}

"use client";

import { Clock, ExternalLink, Tag, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { MemberButton, memberButtonClassName } from "@/components/member/ui/member-button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { StudentOfferView } from "@/server/webinars/model";
import { offerPillPanelMaxHeight } from "../vertical/vertical-model";

// O desenho do card da Oferta (docs/30 §1.6, §1.7, §8.6 e §9), sem dados vivos (use-room-offer.ts cuida disso): o card
// no canto de baixo do palco (o container do palco e relative) e a pilula da sala vertical que abre o mesmo card. O
// card traz o selo, a imagem, o titulo, o preco de/por, o cupom, o prazo com texto e icone (nunca so cor), Quero
// participar com 44 px e Fechar. O prazo vencido troca o botao pela frase "Essa oferta terminou.". Com
// prefers-reduced-motion o card entra parado.

const COPY = WEBINAR_COPY.oferta.aluno;

export type OfferCardViewProps = {
  busy: boolean;
  countdown: string | null;
  ended: boolean;
  error: string | null;
  fallbackUrl: string | null;
  onBuy: () => void;
  onClose: () => void;
  /** "Ver como" da equipe: o botao aparece e nao abre nem grava nada. */
  readOnly: boolean;
  reducedMotion: boolean;
  view: StudentOfferView;
};

/**
 * O conteudo do card (o mesmo no palco e na pilula aberta). `stage`: no celular o palco tem ~210 px de altura, entao a
 * imagem fica so a partir de 640 px (o card rola por dentro se ainda faltar altura). `compact` (a pilula da sala
 * vertical): a imagem some em tela baixa (ate 640 px de altura), para o Fechar e o botao caberem acima da pilula.
 */
export function OfferCardBody({
  busy,
  compact = false,
  countdown,
  ended,
  error,
  fallbackUrl,
  onBuy,
  onClose,
  readOnly,
  stage = false,
  view
}: Omit<OfferCardViewProps, "reducedMotion"> & { compact?: boolean; stage?: boolean }) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2.5" data-offer-variant={view.variant} data-room-offer-card="">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span className="inline-flex min-h-6 items-center gap-1 rounded-full bg-[var(--accent)]/15 px-2.5 text-[11px] font-bold uppercase tracking-wide text-red-100">
          <Tag aria-hidden="true" className="size-3" />
          {view.badge ?? COPY.rotulo}
        </span>
        <button
          aria-label={COPY.fecharOferta}
          className="-mr-2 -mt-2 grid size-11 shrink-0 place-items-center rounded-full text-zinc-300 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          data-room-offer-close=""
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      {view.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- imagem da oferta num endereco https da equipe, sem otimizacao (o card e pequeno).
        <img
          alt=""
          className={cn("aspect-video w-full rounded-[10px] object-cover", stage && "max-sm:hidden", compact && "[@media(max-height:640px)]:hidden")}
          data-room-offer-image=""
          src={view.imageUrl}
        />
      ) : null}

      <h3 className="text-base font-extrabold leading-snug text-white" id={headingId}>
        {view.headline}
      </h3>

      {view.priceFromLabel || view.priceLabel ? (
        <div className="flex min-w-0 flex-col">
          {view.priceFromLabel ? <span className="text-[13px] text-zinc-400 line-through">{COPY.de(view.priceFromLabel)}</span> : null}
          {view.priceLabel ? <span className="text-xl font-extrabold text-white">{COPY.por(view.priceLabel)}</span> : null}
        </div>
      ) : null}

      {view.coupon ? (
        <p className="w-fit rounded-md border border-dashed border-white/25 px-2 py-0.5 font-mono text-[13px] text-zinc-100" data-room-offer-coupon="">
          {COPY.cupom(view.coupon)}
        </p>
      ) : null}

      {countdown && !ended ? (
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-100" data-room-offer-deadline="">
          <Clock aria-hidden="true" className="size-4 shrink-0" />
          {COPY.terminaEm(countdown)}
        </p>
      ) : null}

      {ended ? (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-300" data-room-offer-ended="" role="status">
          <Clock aria-hidden="true" className="size-4 shrink-0" />
          {COPY.encerrada}
        </p>
      ) : (
        <MemberButton aria-busy={busy || undefined} className="h-11 w-full" data-room-offer-buy="" disabled={busy} onClick={onBuy} variant="accent">
          {COPY.quero}
          <ExternalLink aria-hidden="true" />
        </MemberButton>
      )}

      {busy ? (
        <p className="text-xs text-zinc-300" role="status">
          {COPY.abrindo}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs font-semibold text-red-200" role="alert">
          {error}
        </p>
      ) : null}
      {fallbackUrl ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-zinc-300">{COPY.bloqueado}</p>
          <a className={memberButtonClassName({ className: "h-11 w-full", variant: "primary" })} href={fallbackUrl} rel="noopener noreferrer" target="_blank">
            {COPY.abrirPagamento}
          </a>
        </div>
      ) : null}
      {readOnly ? <p className="text-xs text-zinc-400">{COPY.verComo}</p> : null}
    </section>
  );
}

/** O card no canto de baixo do palco. */
export function OfferStageCard(props: OfferCardViewProps) {
  const { reducedMotion, ...body } = props;

  return (
    <div
      className={cn(
        "absolute bottom-3 right-3 z-20 max-h-[calc(100%-1.5rem)] w-[min(20rem,calc(100%-1.5rem))] overflow-y-auto overscroll-contain rounded-[16px] border border-white/12 bg-[#151515]/95 p-3 shadow-[0_18px_48px_rgba(0,0,0,0.6)] backdrop-blur sm:p-4",
        reducedMotion ? null : "animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none"
      )}
      data-reduced-motion={reducedMotion ? "" : undefined}
      data-room-offer="stage"
    >
      <OfferCardBody {...body} stage />
    </div>
  );
}

export type OfferPillProps = OfferCardViewProps & { onToggle: () => void; open: boolean };

/** A pilula da sala vertical: mostra o selo e o prazo; tocar abre o card por cima. */
export function OfferPill(props: OfferPillProps) {
  const { onToggle, open, reducedMotion, ...body } = props;
  const panelId = useId();
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);

  // Aberto: o card cabe entre a pilula e a barra do topo (o Sair), medido agora e a cada giro ou teclado; o
  // resto rola por dentro. O teto do CSS vale antes da medida.
  useEffect(() => {
    if (!open) {
      return;
    }
    const measure = () => {
      const pill = pillRef.current;
      const top = document.querySelector("[data-room-vertical-top]");
      setMaxHeight(offerPillPanelMaxHeight({ pillTop: pill ? pill.getBoundingClientRect().top : null, topBarBottom: top ? top.getBoundingClientRect().bottom : null }));
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [open]);

  return (
    <div className="relative" data-room-offer="vertical">
      {open ? (
        <div
          className={cn(
            "absolute bottom-full right-0 z-30 mb-2 max-h-[calc(100dvh-env(safe-area-inset-top)-11rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-[16px] border border-white/12 bg-[#151515]/95 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.6)] backdrop-blur",
            reducedMotion ? null : "animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none"
          )}
          data-room-offer-panel=""
          id={panelId}
          style={maxHeight === null ? undefined : { maxHeight }}
        >
          <OfferCardBody {...body} compact />
        </div>
      ) : null}
      <button
        ref={pillRef}
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-bold text-white shadow-[0_12px_32px_rgba(229,9,20,0.28)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        data-room-offer-pill=""
        onClick={onToggle}
        type="button"
      >
        <Tag aria-hidden="true" className="size-4 shrink-0" />
        {body.view.badge ? <span className="sr-only">{COPY.abrirOferta}: </span> : null}
        <span className="truncate">{body.view.badge ?? COPY.abrirOferta}</span>
        {body.countdown && !body.ended ? (
          <span className="flex shrink-0 items-center gap-1 tabular-nums">
            <Clock aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{COPY.terminaEm("")}</span>
            {body.countdown}
          </span>
        ) : null}
      </button>
    </div>
  );
}

"use client";

import { BellRing, PanelTop } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { MemberPopupCard } from "@/components/member/notifications/member-popup";
import { noticeIconParts } from "@/components/member/notifications/notice-icons";
import { cn } from "@/lib/utils";
import { paintToCss, type PopupDesign, type PopupFontFace } from "@/server/communications/popup-design-model";
import { freePreviewPopupItem, type PopupFreeDesign } from "@/server/communications/popup-free-model";
import { resolveFreeArtboard } from "@/server/communications/popup-free-render";
import type { NoticeIconChoice } from "@/server/communications/schemas";
import type { TemplateThumb } from "@/server/communications/template-queries";

// Miniaturas dos modelos (docs/28; spec §5.2): na lista (36×48) e em "Meus modelos" do card Design e do editor
// Livre (60×84 no Personalizado, 120×160 no Livre).
// - Personalizado: as barras coloridas do modelo pronto (StarterThumb), montadas do design salvo; nada baixado (o
//   fundo com imagem vira a cor de apoio).
// - Livre: o proprio cartao do aluno em previa (MemberPopupCard, no computador), encolhido, montado so quando aparece na tela
//   (IntersectionObserver); antes disso, um retangulo do mesmo tamanho. Nunca monta <video>: `still` deixa o video na
//   capa (nada do video e baixado), entao 20 linhas na lista ou 50 no seletor nao fazem pedidos de video.
// - Notificacao: o icone do modelo num circulo (ou o sino); Pop-up Padrão: o icone do pop-up.
// Na lista sao decorativas (aria-hidden: o nome esta no texto); o Livre com `label` vira role="img" (card Design).

export type ThumbSize = "list" | "picker";

const CUSTOM_SIZES: Record<ThumbSize, { height: number; scale: number; width: number }> = {
  list: { height: 48, scale: 0.6, width: 36 },
  picker: { height: 84, scale: 1, width: 60 }
};

const FREE_SIZES: Record<ThumbSize, { height: number; width: number }> = {
  list: { height: 48, width: 36 },
  picker: { height: 160, width: 120 }
};

/** O texto do botao principal nas miniaturas (o destino fica para cada aviso). */
const PREVIEW_CTA = { href: "", label: "Saiba mais", target: "same_tab" } as const;
const NO_FACES: readonly PopupFontFace[] = [];

/** Fundo do cartao sem baixar nada: a pintura (cor ou degrade) ou, com imagem, a cor de apoio. */
function thumbBackground(design: PopupDesign): string {
  const background = design.card.background;

  return background.kind === "image" ? background.color : paintToCss(background);
}

/** Barras do Personalizado: selo, linhas do titulo (ate 2), texto e botao, como as dos modelos prontos. */
export function CustomDesignThumb({ className, design, size }: { className?: string; design: PopupDesign; size: ThumbSize }) {
  const { height, scale, width } = CUSTOM_SIZES[size];
  const px = (value: number) => Math.max(1, Math.round(value * scale * 10) / 10);
  const hasMedia = design.media.kind !== "none";
  const over = hasMedia && design.text.placement !== "below";
  const bars = design.blocks.flatMap((block) => {
    const style: CSSProperties = {};

    if (block.type === "badge") {
      Object.assign(style, { background: paintToCss(block.background), borderRadius: 999, height: px(5), width: px(18) });
    } else if (block.type === "heading") {
      return block.lines.slice(0, 2).map((line, index) => (
        <span
          className="block rounded-full"
          key={`${block.id}-${index}`}
          style={{ background: paintToCss(line.paint ?? block.style.paint), height: px(5), width: px(index === 0 ? 34 : 28) }}
        />
      ));
    } else if (block.type === "text") {
      Object.assign(style, { background: paintToCss(block.style.paint), borderRadius: 999, height: px(3), opacity: 0.7, width: px(40) });
    } else if (block.type === "button") {
      Object.assign(style, { background: paintToCss(block.style.background), borderRadius: 999, height: px(7), width: px(block.style.width === "full" ? 44 : 24) });
    } else {
      return [];
    }

    return [<span className="block" key={block.id} style={style} />];
  });

  return (
    <span
      aria-hidden="true"
      className={cn("relative grid shrink-0 overflow-hidden rounded-md border border-white/10", className)}
      data-template-thumb="custom"
      style={{ background: thumbBackground(design), height, width }}
    >
      {hasMedia ? (
        <span
          className="col-start-1 row-start-1 block w-full"
          style={{ aspectRatio: design.media.aspect.replace(":", " / "), background: "linear-gradient(135deg, #52525b, #27272a)" }}
        />
      ) : null}
      <span
        className={cn("col-start-1 flex flex-col", over ? "row-start-1 self-end" : hasMedia ? "row-start-2" : "row-start-1 self-center")}
        style={{
          alignItems: design.text.align === "center" ? "center" : design.text.align === "right" ? "flex-end" : "flex-start",
          gap: px(3),
          marginTop: !over && hasMedia ? -px(8) : undefined,
          padding: px(6)
        }}
      >
        {bars}
      </span>
    </span>
  );
}

/** Aparece na tela (ou perto dela)? Uma vez visto, fica montado. */
function useSeen(ref: RefObject<HTMLElement | null>): boolean {
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const element = ref.current;

    if (!element || seen) {
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      const timer = window.setTimeout(() => setSeen(true), 0);

      return () => window.clearTimeout(timer);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [ref, seen]);

  return seen;
}

/** O cartao Livre em previa, encolhido e parado (`still`), montado so quando aparece. */
export function FreeDesignThumb({ design, fonts, label, size }: { design: PopupFreeDesign; fonts?: readonly PopupFontFace[]; label?: string; size: ThumbSize }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useSeen(ref);
  const { height, width } = FREE_SIZES[size];
  const stage = resolveFreeArtboard(design).width + 32;
  const scale = width / stage;
  const popup = useMemo(
    () => freePreviewPopupItem({ allowSnooze: true, audio: null, cta: PREVIEW_CTA, design, fonts: fonts ?? NO_FACES, title: "" }),
    [design, fonts]
  );

  return (
    <span
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn("relative block shrink-0 overflow-hidden rounded-md border border-[var(--border-subtle)]", seen ? "bg-black/70" : "bg-[var(--surface-2)]")}
      data-template-thumb="free"
      ref={ref}
      role={label ? "img" : undefined}
      style={{ height, width }}
    >
      {seen ? (
        // Centrado na miniatura: o translate de -50 % e do tamanho de verdade; o scale encolhe em volta do centro.
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-1/2 block origin-center"
          inert
          style={{ containerType: "inline-size", transform: `translate(-50%, -50%) scale(${scale})`, width: stage }}
        >
          <span className="flex justify-center py-4">
            <MemberPopupCard device="desktop" playing={false} popup={popup} preview still />
          </span>
        </span>
      ) : null}
    </span>
  );
}

/** Notificacao: o icone do modelo (na cor dele) num circulo, ou o sino. */
export function InboxTemplateThumb({ icon, size }: { icon: NoticeIconChoice; size: ThumbSize }) {
  const parts = noticeIconParts(icon);
  const Icon = parts?.Icon ?? BellRing;
  const { height, width } = CUSTOM_SIZES[size];

  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)]"
      data-template-thumb="inbox"
      style={{ height, width }}
    >
      <span className="grid size-7 place-items-center rounded-full bg-[var(--surface-3)] text-[var(--text-secondary)]">
        <Icon className={parts ? cn("size-4", parts.className) : "size-4"} strokeWidth={parts ? 2.2 : 1.75} />
      </span>
    </span>
  );
}

/** Pop-up Padrão (sem design). */
export function DefaultPopupThumb({ size }: { size: ThumbSize }) {
  const { height, width } = CUSTOM_SIZES[size];

  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)]"
      data-template-thumb="popup_default"
      style={{ height, width }}
    >
      <PanelTop className="size-4" strokeWidth={1.75} />
    </span>
  );
}

/** A miniatura de uma linha da lista (decorativa); modelo que nao abre: o retangulo vazio. */
export function TemplateListThumb({ fonts, thumb }: { fonts?: readonly PopupFontFace[]; thumb: TemplateThumb | null }) {
  if (!thumb) {
    return <span aria-hidden="true" className="block h-12 w-9 shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)]" data-template-thumb="none" />;
  }

  switch (thumb.kind) {
    case "custom":
      return <CustomDesignThumb design={thumb.design} size="list" />;
    case "free":
      return <FreeDesignThumb design={thumb.design} fonts={fonts} size="list" />;
    case "inbox":
      return <InboxTemplateThumb icon={thumb.icon} size="list" />;
    case "popup_default":
      return <DefaultPopupThumb size="list" />;
  }
}

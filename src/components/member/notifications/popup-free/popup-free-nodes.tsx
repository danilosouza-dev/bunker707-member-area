"use client";

import { Fragment, type CSSProperties, type MouseEvent, type RefCallback } from "react";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { cn } from "@/lib/utils";
import type { PopupItem } from "@/server/communications/notification-model";
import type { FreeButtonNode, FreeId, FreeLine, FreeNode, PopupFreeDesign } from "@/server/communications/popup-free-model";
import type { PopupFontFace } from "@/server/communications/popup-design-model";
import { freeFirstHeading, freeFirstText, freeHasSnoozeButton, freeTextStyleOf, type FreeResolvedTextStyle } from "@/server/communications/popup-free-render";
import { NoticeAudioPlayer } from "../notice-audio-player";
import { resolveNotificationLink, type NotificationLink } from "../notifications-model";
import { primaryButtonTarget } from "../popup-design/popup-design-styles";
import { FreeIcon } from "./popup-free-icons";
import { FreeImageView, FreeVideoView } from "./popup-free-media";
import {
  FREE_BADGE_CSS,
  FREE_BUTTON_LABEL_CSS,
  FREE_FOCUS_CLASS,
  FREE_GRADIENT_SELECTION_CLASS,
  FREE_HEADING_LINE_CSS,
  FREE_ICON_BOX_CSS,
  FREE_INLINE_ICON_CSS,
  FREE_LINK_RESET_CSS,
  FREE_PRESS_CLASS,
  FREE_TOUCH_CLASS,
  freeBoxCss,
  freeBoxLayoutCss,
  freeButtonLayoutCss,
  freeDividerCss,
  freeIconCss,
  freeLinksRowCss,
  freePlaceCss,
  freePointerEvents,
  freeSpanCss,
  freeStyleContext,
  freeTextCss,
  freeTextPaintCss,
  type FreeDragPreview,
  type FreeMotion,
  type FreeParentDir,
  type FreeStyleContext
} from "./popup-free-styles";

// Elementos do pop-up Livre (docs/27; spec §3.3): um `switch` por tipo, na ordem das Camadas (a ordem do DOM e a
// ordem de leitura e de Tab, nao a posicao na tela). Cada elemento tem `data-free-id` num elemento so do DOM (o
// editor mede e seleciona por ele). Texto de verdade em tudo (selecionavel, lido pelo leitor de tela); o primeiro
// titulo visivel e o <h2> que da nome ao dialogo, o primeiro texto visivel o descreve. Na previa do editor, links e
// botoes viram <span> sem acao e o audio fica parado. Escondido nao e desenhado.

export type FreeRenderContext = {
  accessPreviewMode?: AccessPreviewMode;
  bodyId?: string;
  design: PopupFreeDesign;
  drag: FreeDragPreview | null;
  firstHeadingId: FreeId | null;
  firstTextId: FreeId | null;
  motion: FreeMotion;
  onClose?: () => void;
  /** O 3º argumento diz qual botão foi: "cta" (o Botão principal) ou `link:<id>` (um "Abrir um link"). */
  onCta?: (event: MouseEvent<HTMLAnchorElement>, link: NotificationLink, button?: string) => void;
  onDismiss?: () => void;
  onSnooze?: () => void;
  playing: boolean;
  popup: PopupItem;
  /** O ref do elemento com data-free-id (so o editor; undefined no aluno). */
  refFor: (id: FreeId) => RefCallback<HTMLElement> | undefined;
  /** "Lembrar depois" nos Links: o aluno pode adiar e nao ha botao Lembrar depois. */
  showSnoozeLink: boolean;
  style: FreeStyleContext;
  titleId?: string;
};

/** O contexto do desenho a partir das props do cartao (o cartao e os testes usam o mesmo). */
export function freeRenderContextOf(input: {
  accessPreviewMode?: AccessPreviewMode;
  bodyId?: string;
  design: PopupFreeDesign;
  dragPreview?: FreeDragPreview | null;
  faces: readonly PopupFontFace[];
  motion: FreeMotion;
  onClose?: () => void;
  onCta?: (event: MouseEvent<HTMLAnchorElement>, link: NotificationLink, button?: string) => void;
  onDismiss?: () => void;
  onSnooze?: () => void;
  origin: string | null;
  playing?: boolean;
  popup: PopupItem;
  preview?: boolean;
  refFor?: (id: FreeId) => RefCallback<HTMLElement> | undefined;
  titleId?: string;
}): FreeRenderContext {
  const { design, popup } = input;
  const preview = input.preview ?? false;

  return {
    accessPreviewMode: input.accessPreviewMode,
    bodyId: input.bodyId,
    design,
    // O arrastar so existe no editor (previa).
    drag: preview ? (input.dragPreview ?? null) : null,
    firstHeadingId: freeFirstHeading(design)?.id ?? null,
    firstTextId: freeFirstText(design)?.id ?? null,
    motion: input.motion,
    onClose: input.onClose,
    onCta: input.onCta,
    onDismiss: input.onDismiss,
    onSnooze: input.onSnooze,
    playing: input.playing ?? true,
    popup,
    refFor: input.refFor ?? (() => undefined),
    showSnoozeLink: popup.canSnooze && !freeHasSnoozeButton(design),
    style: freeStyleContext(design, { faces: input.faces, origin: input.origin, preview }),
    titleId: input.titleId
  };
}

const ACTION_CLASS = cn(FREE_TOUCH_CLASS, FREE_FOCUS_CLASS, FREE_PRESS_CLASS, "select-none");
const LINK_CLASS = cn(FREE_TOUCH_CLASS, FREE_FOCUS_CLASS, "rounded-sm underline-offset-4 hover:underline");

function FreeSpans({ ctx, line, text }: { ctx: FreeRenderContext; line: FreeLine; text: FreeResolvedTextStyle }) {
  return line.map((span, index) => {
    const { gradient, style } = freeSpanCss(span.style, text, ctx.style);

    return (
      <span className={gradient ? FREE_GRADIENT_SELECTION_CLASS : undefined} key={index} style={style}>
        {span.text}
      </span>
    );
  });
}

/** A pintura do rotulo (selo, botao): so o degrade precisa de um span proprio recortado pelas letras. */
function labelPaintCss(text: FreeResolvedTextStyle): CSSProperties | undefined {
  return text.paint.kind === "solid" ? undefined : freeTextPaintCss(text.paint);
}

type ButtonBehavior = { kind: "close" } | { kind: "link"; link: NotificationLink } | { kind: "snooze" } | { kind: "static" };

/**
 * O que o botao faz e o rotulo dele. Botao principal: o `cta` do aviso (texto e destino conferidos na hora); na
 * previa, o rotulo mesmo com o destino ainda vazio. "Abrir um link": o link conferido (conta como o clique).
 * Lembrar depois: so enquanto o aluno pode adiar. null = nao desenha.
 */
function buttonBehavior(node: FreeButtonNode, ctx: FreeRenderContext): { behavior: ButtonBehavior; label: string } | null {
  const { accessPreviewMode, popup } = ctx;
  const preview = ctx.style.preview;

  switch (node.action.kind) {
    case "cta": {
      const target = primaryButtonTarget(popup.cta, accessPreviewMode);

      if (target) {
        return { behavior: preview ? { kind: "static" } : { kind: "link", link: target.link }, label: target.label };
      }

      return preview ? { behavior: { kind: "static" }, label: popup.cta?.label.trim() || "Saiba mais" } : null;
    }
    case "link": {
      const link = resolveNotificationLink(node.action.href, node.action.target, accessPreviewMode);
      const label = node.label?.trim() ?? "";

      if (!label || (!link && !preview)) {
        return null;
      }

      return { behavior: preview || !link ? { kind: "static" } : { kind: "link", link }, label };
    }
    case "close":
      return node.label?.trim() ? { behavior: preview ? { kind: "static" } : { kind: "close" }, label: node.label.trim() } : null;
    case "snooze":
      return popup.canSnooze && node.label?.trim() ? { behavior: preview ? { kind: "static" } : { kind: "snooze" }, label: node.label.trim() } : null;
  }
}

function ButtonView({ base, ctx, node }: { base: CSSProperties; ctx: FreeRenderContext; node: FreeButtonNode }) {
  const resolved = buttonBehavior(node, ctx);

  if (!resolved) {
    return null;
  }

  const text = freeTextStyleOf(node);
  const style: CSSProperties = { ...base, ...freeTextCss(text, ctx.style), ...freeButtonLayoutCss(node) };
  const icon = node.icon ? <FreeIcon name={node.icon.name} style={FREE_INLINE_ICON_CSS} /> : null;
  const side = node.icon?.side ?? "end";
  const { behavior, label } = resolved;
  const newTab = behavior.kind === "link" && behavior.link.newTab;
  const content = (
    <>
      {side === "start" ? icon : null}
      <span style={{ ...FREE_BUTTON_LABEL_CSS, ...labelPaintCss(text) }}>{label}</span>
      {side === "end" ? icon : null}
      {newTab ? <span className="sr-only"> (abre em nova aba)</span> : null}
    </>
  );
  const ref = ctx.refFor(node.id);
  const kind = node.action.kind;

  if (behavior.kind === "static") {
    return (
      <span data-free-button={kind} data-free-id={node.id} ref={ref} style={style}>
        {content}
      </span>
    );
  }

  if (behavior.kind === "link") {
    const { link } = behavior;

    return (
      <a
        className={ACTION_CLASS}
        data-free-button={kind}
        data-free-id={node.id}
        href={link.href}
        onClick={(event) => ctx.onCta?.(event, link, kind === "cta" ? "cta" : `link:${node.id}`)}
        ref={ref}
        style={style}
        {...(link.newTab ? { rel: "noopener noreferrer", target: "_blank" } : {})}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      className={ACTION_CLASS}
      data-free-button={kind}
      data-free-id={node.id}
      onClick={behavior.kind === "close" ? ctx.onClose : ctx.onSnooze}
      ref={ref}
      style={style}
      type="button"
    >
      {content}
    </button>
  );
}

function LinksView({ base, ctx, node }: { base: CSSProperties; ctx: FreeRenderContext; node: Extract<FreeNode, { type: "links" }> }) {
  const snooze = ctx.showSnoozeLink;
  const dismiss = node.dismiss !== false;

  if (!snooze && !dismiss) {
    return null;
  }

  const text = freeTextStyleOf(node);
  const textCss = freeTextCss(text, ctx.style);
  // Sem linha escolhida, nenhuma linha em linha: o estilo em linha venceria o hover:underline de LINK_CLASS. Em
  // degrade a letra e transparente, entao a linha (escolhida ou ao passar o mouse) usa a primeira parada (icones).
  const linkStyle: CSSProperties = {
    ...FREE_LINK_RESET_CSS,
    ...textCss,
    textDecorationLine: text.decoration,
    ...labelPaintCss(text),
    textAlign: "center",
    textDecorationColor: text.paint.kind === "solid" ? undefined : textCss.color
  };
  const preview = ctx.style.preview;
  const link = (label: string, onClick: (() => void) | undefined, name: string) =>
    preview ? (
      <span data-free-link={name} style={linkStyle}>
        {label}
      </span>
    ) : (
      <button className={LINK_CLASS} data-free-link={name} onClick={onClick} style={linkStyle} type="button">
        {label}
      </button>
    );

  return (
    <div data-free-id={node.id} ref={ctx.refFor(node.id)} style={{ ...base, ...freeLinksRowCss(node, text, ctx.style) }}>
      {snooze ? link("Lembrar depois", ctx.onSnooze, "snooze") : null}
      {dismiss ? link("Não mostrar de novo", ctx.onDismiss, "dismiss") : null}
    </div>
  );
}

export function FreeNodeView({ ctx, node, parentDir }: { ctx: FreeRenderContext; node: FreeNode; parentDir: FreeParentDir }) {
  if (node.hidden) {
    return null;
  }

  const s = ctx.style;
  const base: CSSProperties = {
    ...freePlaceCss(node, s, parentDir, ctx.drag),
    ...freeBoxCss(node.box, s, { ellipse: node.type === "shape" && node.shape === "ellipse" }),
    pointerEvents: freePointerEvents(node, s.preview)
  };
  const ref = ctx.refFor(node.id);

  switch (node.type) {
    case "heading": {
      const text = freeTextStyleOf(node);
      const primary = node.id === ctx.firstHeadingId;
      const Tag = primary ? "h2" : "h3";

      return (
        <Tag data-free-id={node.id} id={primary ? ctx.titleId : undefined} ref={ref} style={{ ...base, ...freeTextCss(text, s) }}>
          {node.lines.map((line, index) => (
            <Fragment key={index}>
              {index > 0 ? " " : null}
              <span style={FREE_HEADING_LINE_CSS}>
                <FreeSpans ctx={ctx} line={line} text={text} />
              </span>
            </Fragment>
          ))}
        </Tag>
      );
    }
    case "text": {
      const text = freeTextStyleOf(node);
      const primary = node.id === ctx.firstTextId;

      return (
        <p data-free-id={node.id} id={primary ? ctx.bodyId : undefined} ref={ref} style={{ ...base, ...freeTextCss(text, s) }}>
          {node.lines.map((line, index) => (
            <Fragment key={index}>
              {index > 0 ? <br /> : null}
              <FreeSpans ctx={ctx} line={line} text={text} />
            </Fragment>
          ))}
        </p>
      );
    }
    case "badge": {
      const text = freeTextStyleOf(node);

      return (
        <span data-free-id={node.id} ref={ref} style={{ ...base, ...freeTextCss(text, s), ...FREE_BADGE_CSS }}>
          {node.icon ? <FreeIcon name={node.icon} style={FREE_INLINE_ICON_CSS} /> : null}
          <span style={labelPaintCss(text)}>{node.label}</span>
        </span>
      );
    }
    case "button":
      return <ButtonView base={base} ctx={ctx} node={node} />;
    case "links":
      return <LinksView base={base} ctx={ctx} node={node} />;
    case "audio":
      return ctx.popup.audio ? (
        <div data-free-id={node.id} ref={ref} style={{ ...base, textAlign: "left" }}>
          <NoticeAudioPlayer audio={ctx.popup.audio} label="Áudio do aviso" preview={s.preview} />
        </div>
      ) : null;
    case "image":
      return <FreeImageView ctx={s} design={ctx.design} elementRef={ref} node={node} style={base} />;
    case "video":
      return <FreeVideoView ctx={s} design={ctx.design} elementRef={ref} motion={ctx.motion} node={node} playing={ctx.playing} style={base} />;
    case "icon":
      return (
        <span aria-hidden="true" data-free-id={node.id} ref={ref} style={{ ...base, ...FREE_ICON_BOX_CSS }}>
          <FreeIcon name={node.icon} strokeWidth={node.stroke ?? 2} style={freeIconCss(node, s)} />
        </span>
      );
    case "divider":
      return <div aria-hidden="true" data-free-id={node.id} ref={ref} style={{ ...base, ...freeDividerCss(node) }} />;
    case "spacer":
    case "shape":
      return <div aria-hidden="true" data-free-id={node.id} ref={ref} style={base} />;
    case "box":
      return (
        <div data-free-id={node.id} ref={ref} style={{ ...base, ...freeBoxLayoutCss(node.layout, s) }}>
          <FreeNodes ctx={ctx} nodes={node.children} parentDir={node.layout?.dir ?? "column"} />
        </div>
      );
  }
}

/** Os elementos de uma caixa (ou da prancheta), na ordem das Camadas. */
export function FreeNodes({ ctx, nodes, parentDir }: { ctx: FreeRenderContext; nodes: readonly FreeNode[]; parentDir: FreeParentDir }) {
  return nodes.map((node) => <FreeNodeView ctx={ctx} key={node.id} node={node} parentDir={parentDir} />);
}

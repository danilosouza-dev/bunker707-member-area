// Estilos do pop-up "Personalizado" (docs/26): objetos de estilo do React montados SO a partir do design ja
// validado (popup-design-model.ts: cores #RRGGBB/#RRGGBBAA, numeros com limite, escolhas de lista). Nenhuma
// string de CSS ou HTML do produtor entra aqui. Modulo puro (imports relativos, sem React em tempo de execucao):
// tests/popup-design-desenho.test.mjs carrega direto pelo Node; o cartao (popup-design-card.tsx), a midia e os
// blocos so aplicam o que sai daqui.
//
// Tamanhos: todo comprimento do design vale para o cartao na largura escolhida (P 360, M 440, G 520) e vira
// `cqw` do proprio cartao (o elemento de fora tem container-type: inline-size), com piso de 12 px na fonte e de
// 44 px nos botoes M/G. Borda (0 a 4 px) e o X (36 px visiveis, 44 px de toque) ficam em px.

import type { CSSProperties } from "react";
import type { AccessPreviewMode } from "../../../../lib/access-preview";
import {
  cardBackgroundCss,
  fadeGradientCss,
  fadeMaskCss,
  fontStackOf,
  fontStretchOf,
  isOwnStorageUrl,
  paintToCss,
  popupDesignAccessibleName,
  popupDesignDescription,
  POPUP_BADGE_PADDING,
  POPUP_BUILTIN_FONTS,
  POPUP_BUTTON_METRICS,
  POPUP_CARD_SHADOW_CSS,
  POPUP_FONT_FAMILY_PATTERN,
  POPUP_FONT_FORMATS,
  POPUP_FONT_PATH_PATTERN,
  POPUP_FONTS_BUCKET,
  POPUP_MEDIA_RATIOS,
  POPUP_VIDEO_BUCKET,
  POPUP_VIDEO_MIME_TYPES,
  POPUP_VIDEO_PATH_PATTERN,
  popupCardOuterWidth,
  popupCardWidthPx,
  popupFadeSpan,
  scaledButtonHeight,
  scaledFontSize,
  scaledLength,
  storagePublicPath,
  type PopupAlign,
  type PopupBadgeBlock,
  type PopupBorder,
  type PopupButton2Block,
  type PopupButtonStyle,
  type PopupDesign,
  type PopupFontFace,
  type PopupHeadingBlock,
  type PopupHeadingLine,
  type PopupMediaPosition,
  type PopupPaint,
  type PopupTextAlign,
  type PopupTextBlock,
  type PopupTextPlacement,
  type PopupTextStyle,
  type PopupVideo
} from "../../../../server/communications/popup-design-model";
import { resolveNotificationLink, type NotificationLink } from "../notifications-model";

type Faces = readonly Pick<PopupFontFace, "family" | "id">[];

/** Alinhamento do grupo em flex (coluna): onde o bloco fica na linha. */
export const POPUP_FLEX_ALIGN: Record<PopupAlign, "center" | "flex-end" | "flex-start"> = {
  center: "center",
  left: "flex-start",
  right: "flex-end"
};

/** Linha do titulo do tamanho do texto (degrade): a margem que a alinha. */
const LINE_MARGIN: Record<PopupAlign, string> = { center: "auto", left: "0 auto", right: "auto 0" };

/** Zona "Sobre a midia": onde o grupo de texto fica na celula da midia. */
const OVER_SELF: Record<Exclude<PopupTextPlacement, "below">, "center" | "end" | "start"> = {
  "over-bottom": "end",
  "over-middle": "center",
  "over-top": "start"
};

export const POPUP_OBJECT_POSITION: Record<PopupMediaPosition, string> = {
  bottom: "center bottom",
  center: "center center",
  top: "center top"
};

/** O X fica 12 px dentro do canto e tem 36 px: o primeiro bloco no topo do cartao guarda 56 px desse lado. */
const CLOSE_CLEARANCE_PX = 56;

function borderCss(border: PopupBorder): string {
  return border.width > 0 ? `${border.width}px solid ${border.color}` : "none";
}

/** Alinhamento de um texto: o dele, ou o do grupo ("Como o grupo"). */
export function resolvedAlign(own: PopupTextAlign, zone: PopupAlign): PopupAlign {
  return own === "inherit" ? zone : own;
}

/**
 * Pintura do texto: cor solida em `color`; degrade no fundo recortado pelas letras (background-clip: text),
 * com a cor do texto transparente para o degrade aparecer.
 */
export function textPaintCss(paint: PopupPaint): CSSProperties {
  if (paint.kind === "solid") {
    return { color: paint.color };
  }

  return {
    backgroundClip: "text",
    backgroundImage: paintToCss(paint),
    color: "transparent",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent"
  };
}

/**
 * Onde o bloco de texto fica no grupo: cor solida ocupa a linha (alinhada por text-align); degrade fica do
 * tamanho do texto (alinhado pelo grupo) para o degrade acompanhar as letras.
 */
export function textBoxCss(paint: PopupPaint, align: PopupAlign): CSSProperties {
  return paint.kind === "gradient"
    ? { alignSelf: POPUP_FLEX_ALIGN[align], maxWidth: "100%", textAlign: align, width: "fit-content" }
    : { alignSelf: "stretch", textAlign: align };
}

/** Tipografia de um texto: fonte (pronta ou enviada), tamanho com piso, peso, altura da linha, letras, maiusculas. */
export function typographyCss(
  style: Pick<PopupTextStyle, "font" | "letterSpacing" | "lineHeight" | "size" | "uppercase" | "weight">,
  cardWidth: number,
  faces: Faces = [],
  size: number = style.size
): CSSProperties {
  return {
    fontFamily: fontStackOf(style.font, faces),
    fontSize: scaledFontSize(size, cardWidth),
    fontStretch: fontStretchOf(style.font),
    fontWeight: style.weight,
    letterSpacing: `${style.letterSpacing}em`,
    lineHeight: style.lineHeight,
    margin: 0,
    overflowWrap: "anywhere",
    textTransform: style.uppercase ? "uppercase" : "none"
  };
}

/** O titulo (h2/h3): ocupa a linha; cada linha e um span em bloco (headingLineCss). */
export function headingCss(block: PopupHeadingBlock, zone: PopupAlign, cardWidth: number, faces: Faces = []): CSSProperties {
  return { ...typographyCss(block.style, cardWidth, faces), alignSelf: "stretch", textAlign: resolvedAlign(block.style.align, zone) };
}

/** Uma linha do titulo: a cor/degrade e o tamanho dela, ou os do titulo. */
export function headingLineCss(line: PopupHeadingLine, block: PopupHeadingBlock, zone: PopupAlign, cardWidth: number): CSSProperties {
  const paint = line.paint ?? block.style.paint;
  const base: CSSProperties = { display: "block", fontSize: scaledFontSize(line.size ?? block.style.size, cardWidth) };

  if (paint.kind === "solid") {
    return { ...base, ...textPaintCss(paint) };
  }

  return { ...base, ...textPaintCss(paint), marginInline: LINE_MARGIN[resolvedAlign(block.style.align, zone)], maxWidth: "100%", width: "fit-content" };
}

/** O bloco Texto (<p>): quebras de linha do produtor viram quebras de verdade. */
export function textBlockCss(block: PopupTextBlock, zone: PopupAlign, cardWidth: number, faces: Faces = []): CSSProperties {
  return {
    ...typographyCss(block.style, cardWidth, faces),
    ...textBoxCss(block.style.paint, resolvedAlign(block.style.align, zone)),
    ...textPaintCss(block.style.paint),
    whiteSpace: "pre-line"
  };
}

/** O selo (pilula): fundo, borda, cantos e respiro; o texto vai num span dentro (badgeTextCss). */
export function badgeCss(block: PopupBadgeBlock, zone: PopupAlign, cardWidth: number): CSSProperties {
  return {
    alignSelf: POPUP_FLEX_ALIGN[resolvedAlign(block.style.align, zone)],
    background: paintToCss(block.background),
    border: borderCss(block.border),
    borderRadius: scaledLength(block.radius, cardWidth),
    display: "block",
    maxWidth: "100%",
    padding: `${scaledLength(POPUP_BADGE_PADDING.y, cardWidth)} ${scaledLength(POPUP_BADGE_PADDING.x, cardWidth)}`
  };
}

export function badgeTextCss(block: PopupBadgeBlock, cardWidth: number, faces: Faces = []): CSSProperties {
  return { ...typographyCss(block.style, cardWidth, faces), ...textPaintCss(block.style.paint), display: "block", textAlign: "center" };
}

/**
 * Botao (principal ou segundo): altura com piso de toque, respiro dos lados, fonte, fundo (cor ou degrade),
 * borda, cantos e brilho. "Ocupa a linha" estica; "Do tamanho do texto" fica alinhado pelo grupo.
 */
export function buttonCss(style: PopupButtonStyle, zone: PopupAlign, cardWidth: number, faces: Faces = []): CSSProperties {
  const metrics = POPUP_BUTTON_METRICS[style.size];

  return {
    alignItems: "center",
    alignSelf: style.width === "full" ? "stretch" : POPUP_FLEX_ALIGN[zone],
    background: paintToCss(style.background),
    border: borderCss(style.border),
    borderRadius: scaledLength(style.radius, cardWidth),
    boxShadow: style.glow ? `0 0 ${scaledLength(24, cardWidth)} ${style.glow}` : "none",
    boxSizing: "border-box",
    color: style.textColor,
    display: "flex",
    fontFamily: fontStackOf(style.font, faces),
    fontSize: scaledFontSize(metrics.fontSize, cardWidth),
    fontStretch: fontStretchOf(style.font),
    fontWeight: style.weight,
    height: scaledButtonHeight(style.size, cardWidth),
    justifyContent: "center",
    letterSpacing: `${style.letterSpacing}em`,
    lineHeight: 1.2,
    maxWidth: "100%",
    paddingInline: scaledLength(metrics.paddingX, cardWidth),
    textDecoration: "none",
    textTransform: style.uppercase ? "uppercase" : "none"
  };
}

/** O texto do botao numa linha so, com reticencias. */
export const POPUP_BUTTON_LABEL_CSS: CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

/* ------------------------------------------------------------------------------------------------
 * Cartao, midia, zona do texto, rodape e X
 * ---------------------------------------------------------------------------------------------- */

/**
 * Elemento de fora: a largura (a escolhida, ou a tela menos 2 rem) e o container das unidades `cqw`. O
 * container fica aqui, e nao no cartao, para os cantos do proprio cartao (em `cqw`) medirem a largura dele.
 */
export function popupOuterCss(design: PopupDesign): CSSProperties {
  return { containerType: "inline-size", position: "relative", width: popupCardOuterWidth(design) };
}

/**
 * O cartao: fundo (cor, degrade ou a imagem na largura do cartao, presa em cima, no meio ou embaixo, com o
 * escuro por cima, a borda sumindo na cor de apoio e a cor de apoio no resto: cardBackgroundCss), borda, cantos
 * e sombra. A imagem fica atras da midia e do texto; com o degrade "Igual ao fundo do cartão" a midia some nela
 * (mascara).
 */
export function popupCardCss(design: PopupDesign): CSSProperties {
  const cardWidth = popupCardWidthPx(design);

  return {
    background: cardBackgroundCss(design.card.background),
    border: borderCss(design.card.border),
    borderRadius: scaledLength(design.card.radius, cardWidth),
    boxShadow: POPUP_CARD_SHADOW_CSS[design.card.shadow],
    fontFamily: POPUP_BUILTIN_FONTS.inter.stack,
    overflow: "hidden",
    position: "relative"
  };
}

/** Preferencia de movimento: "pending" enquanto nao da para ler (servidor); entao nada de video ainda. */
export type PopupMotion = "motion" | "pending" | "still";
export type PopupMediaMode = "image" | "none" | "pending" | "video";

type MotionWindow = {
  matchMedia?: (query: string) => { matches: boolean };
  /** navigator.connection.saveData (Save-Data; so alguns navegadores tem). */
  navigator?: object;
};

export const POPUP_REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** O que o navegador diz: "menos movimento" e "economia de dados" (Save-Data). */
export function readMotionPreferences(win: MotionWindow): { reducedMotion: boolean; saveData: boolean } {
  let reducedMotion = false;

  try {
    reducedMotion = Boolean(win.matchMedia?.(POPUP_REDUCED_MOTION_QUERY).matches);
  } catch {
    reducedMotion = false;
  }

  const connection = (win.navigator as { connection?: { saveData?: boolean } } | undefined)?.connection;

  return { reducedMotion, saveData: Boolean(connection?.saveData) };
}

/** Menos movimento ou economia de dados: so a capa, o video nem e montado (nada baixado). */
export function prefersStillMedia(input: { reducedMotion: boolean; saveData: boolean }): boolean {
  return input.reducedMotion || input.saveData;
}

/** Video do nosso bucket (caminho videos/<uuid>.<ext>, tipo da lista, endereco publico desse objeto). */
export function isOwnPopupVideo(video: PopupVideo | null | undefined): video is PopupVideo {
  return Boolean(
    video &&
      (POPUP_VIDEO_MIME_TYPES as readonly string[]).includes(video.mimeType) &&
      POPUP_VIDEO_PATH_PATTERN.test(video.path) &&
      isOwnStorageUrl(video.url, { bucket: POPUP_VIDEO_BUCKET, objectPath: video.path })
  );
}

/**
 * O que a midia mostra: nada (Sem midia, ou imagem faltando), a imagem, o video (com a imagem de capa) ou
 * "pending" (video escolhido e a preferencia ainda nao lida: a caixa fica vazia, nada e baixado antes).
 * Menos movimento, economia de dados ou video fora do nosso bucket: a capa.
 */
export function popupMediaMode(design: Pick<PopupDesign, "media">, input: { hasImage: boolean; motion: PopupMotion }): PopupMediaMode {
  const { media } = design;

  if (media.kind === "none") {
    return "none";
  }

  if (media.kind === "video" && isOwnPopupVideo(media.video)) {
    if (input.motion === "pending") {
      return "pending";
    }

    if (input.motion === "motion") {
      return "video";
    }
  }

  return input.hasImage ? "image" : "none";
}

/** O degrade "Igual ao fundo do cartão" e uma mascara na caixa da midia (o fundo do cartao aparece por baixo). */
function fadesIntoCard(design: Pick<PopupDesign, "media">): boolean {
  return design.media.fade.enabled && design.media.fade.color === "auto";
}

/**
 * Caixa da midia: o formato escolhido; "Sobre a midia" divide a celula do grid com o texto. Degrade "Igual
 * ao fundo do cartão": a mascara (opaca ate o comeco da passagem, transparente do fim para baixo), entao o
 * fundo de verdade do cartao (cor, degrade ou imagem) aparece onde a midia some.
 */
export function popupMediaBoxCss(design: PopupDesign, over: boolean): CSSProperties {
  const mask = fadesIntoCard(design) ? fadeMaskCss(design) : null;

  return {
    aspectRatio: design.media.aspect.replace(":", " / "),
    overflow: "hidden",
    position: "relative",
    width: "100%",
    ...(mask ? { maskImage: mask, WebkitMaskImage: mask } : null),
    ...(over ? { alignSelf: "start", gridArea: "1 / 1" } : null)
  };
}

/** Imagem ou video cobrindo a caixa, no recorte escolhido. */
export function popupMediaFillCss(design: PopupDesign): CSSProperties {
  return {
    height: "100%",
    inset: 0,
    objectFit: "cover",
    objectPosition: POPUP_OBJECT_POSITION[design.media.position],
    position: "absolute",
    width: "100%"
  };
}

/**
 * O degrade de outra cor por cima da midia: do comeco da passagem ate embaixo, de transparente ate a cor no
 * fim da passagem e a cor solida dali para baixo. null = desligado ou "Igual ao fundo do cartão" (mascara na
 * caixa: popupMediaBoxCss).
 */
export function popupFadeCss(design: PopupDesign): CSSProperties | null {
  if (!design.media.fade.enabled || fadesIntoCard(design)) {
    return null;
  }

  const { start } = popupFadeSpan(design.media.fade);

  // 1 px a mais embaixo: nenhuma linha da imagem aparece entre o degrade e o fundo do cartao.
  return {
    background: fadeGradientCss(design),
    bottom: "-1px",
    height: `calc(${100 - start}% + 1px)`,
    left: 0,
    pointerEvents: "none",
    position: "absolute",
    right: 0
  };
}

/** O texto fica sobre a midia (mesma celula do grid) so com midia e numa zona "Sobre a midia". */
export function isTextOverMedia(design: PopupDesign, hasMedia: boolean): boolean {
  return hasMedia && design.text.placement !== "below";
}

export const POPUP_OVER_STAGE_CSS: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr)" };

/**
 * O grupo de texto (coluna de blocos): respiro do cartao, espaco entre blocos e alinhamento do grupo.
 * "Abaixo da midia" sobe sobre ela pela margem negativa (subir % da altura da midia = % x razao em cqw);
 * "Sobre a midia" fica na mesma celula do grid, em cima, no meio ou embaixo (a celula cresce, nunca corta).
 * `hasFooter`: com o rodape dos links, o respiro de baixo fica por conta dele; sem nenhum link, o cartao
 * termina logo depois do ultimo bloco com o respiro do cartao.
 */
export function popupTextGroupCss(design: PopupDesign, hasMedia: boolean, hasFooter = true): CSSProperties {
  const cardWidth = popupCardWidthPx(design);
  const padding = scaledLength(design.card.padding, cardWidth);
  const base: CSSProperties = {
    alignItems: POPUP_FLEX_ALIGN[design.text.align],
    display: "flex",
    flexDirection: "column",
    gap: scaledLength(design.text.gap, cardWidth),
    minWidth: 0,
    position: "relative",
    textAlign: design.text.align
  };

  if (isTextOverMedia(design, hasMedia)) {
    return { ...base, alignSelf: OVER_SELF[design.text.placement as keyof typeof OVER_SELF], gridArea: "1 / 1", padding };
  }

  const lift = hasMedia ? design.text.overlap * POPUP_MEDIA_RATIOS[design.media.aspect] : 0;

  return { ...base, ...(lift > 0 ? { marginTop: `${-Math.round(lift * 10_000) / 10_000}cqw` } : null), padding: hasFooter ? `${padding} ${padding} 0` : padding };
}

/**
 * O primeiro bloco quando o texto comeca no topo do cartao (sem midia ou "Sobre a midia, em cima"): guarda o
 * canto do X (centro = dos dois lados, para continuar centralizado). null = o X fica sobre a midia.
 */
export function popupFirstBlockClearance(design: PopupDesign, hasMedia: boolean): CSSProperties | null {
  if (hasMedia && design.text.placement !== "over-top") {
    return null;
  }

  const reserve = `max(0px, calc(${CLOSE_CLEARANCE_PX}px - ${scaledLength(design.card.padding, popupCardWidthPx(design))}))`;

  return design.text.align === "center" ? { marginInline: reserve } : { marginInlineEnd: reserve };
}

/**
 * Links pequenos do rodape: "Não mostrar de novo" quando a equipe o mantem (`links.showDismiss`; sem a chave,
 * aparece); "Lembrar depois" quando o aluno ainda pode adiar e nao ha segundo botao "Lembrar depois" (sem
 * repetir). Os dois desligados = sem rodape (popupHasFooter).
 */
export function popupFooterLinks(design: Pick<PopupDesign, "blocks" | "links">, canSnooze: boolean): { dismiss: boolean; snooze: boolean } {
  const snoozeButton = design.blocks.some((block) => block.type === "button2" && block.action.kind === "snooze");

  return { dismiss: design.links.showDismiss !== false, snooze: canSnooze && !snoozeButton };
}

/** Ha rodape so com pelo menos um link; sem nenhum, nada e desenhado (nem o respiro dele). */
export function popupHasFooter(links: { dismiss: boolean; snooze: boolean }): boolean {
  return links.dismiss || links.snooze;
}

/** O rodape: depois de tudo, com o respiro do cartao; o texto dos links alinha com o do grupo. */
export function popupFooterCss(design: PopupDesign): CSSProperties {
  const cardWidth = popupCardWidthPx(design);
  const padding = scaledLength(design.card.padding, cardWidth);

  return {
    alignItems: "center",
    columnGap: scaledLength(8, cardWidth),
    display: "flex",
    flexWrap: "wrap",
    justifyContent: POPUP_FLEX_ALIGN[design.text.align],
    padding: `${scaledLength(4, cardWidth)} max(0px, calc(${padding} - 8px)) ${scaledLength(Math.round(design.card.padding / 2), cardWidth)}`
  };
}

/** Link do rodape: a cor escolhida, 44 px de toque. */
export function popupFooterLinkCss(design: PopupDesign): CSSProperties {
  return {
    alignItems: "center",
    color: design.links.color,
    display: "inline-flex",
    fontSize: scaledFontSize(13, popupCardWidthPx(design)),
    fontWeight: 600,
    lineHeight: 1.2,
    minHeight: "44px",
    paddingInline: "8px"
  };
}

/** O X: so a cor do icone e do fundo mudam (tamanho e toque ficam os de hoje). */
export function popupCloseCss(design: Pick<PopupDesign, "close">): CSSProperties {
  return { background: design.close.background, color: design.close.color };
}

/**
 * Nome e descricao do dialogo. Padrão: o titulo (aria-labelledby) e o texto, se houver. Personalizado: o texto
 * do titulo do design (aria-labelledby no <h2>) ou, sem bloco Título, o titulo do aviso (aria-label); a
 * descricao e o primeiro bloco Texto.
 */
export function popupDialogAria(
  popup: { body: string; design?: PopupDesign; title: string },
  ids: { bodyId: string; titleId: string }
): { "aria-describedby"?: string; "aria-label"?: string; "aria-labelledby"?: string } {
  if (!popup.design) {
    return { "aria-describedby": popup.body ? ids.bodyId : undefined, "aria-labelledby": ids.titleId };
  }

  const named = popupDesignAccessibleName(popup.design, popup.title);
  const describedBy = popupDesignDescription(popup.design) ? ids.bodyId : undefined;

  return named.labelledBy
    ? { "aria-describedby": describedBy, "aria-labelledby": ids.titleId }
    : { "aria-describedby": describedBy, "aria-label": named.label };
}

/* ------------------------------------------------------------------------------------------------
 * Botoes: o que cada um faz
 * ---------------------------------------------------------------------------------------------- */

/** Botao principal: o `cta` do aviso (texto e destino), conferido na hora; null = nao desenha. */
export function primaryButtonTarget(
  cta: { href: string; label: string; target: "new_tab" | "same_tab" } | null | undefined,
  accessPreviewMode?: AccessPreviewMode
): { label: string; link: NotificationLink } | null {
  const label = cta?.label.trim() ?? "";
  const link = cta && label ? resolveNotificationLink(cta.href, cta.target, accessPreviewMode) : null;

  return link ? { label, link } : null;
}

export type PopupButton2Behavior = { kind: "close" } | { kind: "link"; link: NotificationLink } | { kind: "snooze" };

/**
 * Segundo botao: Fechar (como o X), Lembrar depois (so enquanto o aluno pode adiar) ou o link (conta como o
 * clique, como o botao principal). null = nao desenha (adiar esgotado ou link que nao vale mais).
 */
export function button2Behavior(
  block: Pick<PopupButton2Block, "action">,
  input: { accessPreviewMode?: AccessPreviewMode; canSnooze: boolean }
): PopupButton2Behavior | null {
  switch (block.action.kind) {
    case "close":
      return { kind: "close" };
    case "snooze":
      return input.canSnooze ? { kind: "snooze" } : null;
    case "link": {
      const link = resolveNotificationLink(block.action.href, block.action.target, input.accessPreviewMode);

      return link ? { kind: "link", link } : null;
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Fontes enviadas (FontFace)
 * ---------------------------------------------------------------------------------------------- */

/**
 * A fonte `src` do FontFace, so para fonte do nosso bucket de fontes (fonts/<24 hex>.<ext>) com familia
 * bf_<12 hex> e formato da lista; null = nao registra (o texto fica na pilha do sistema).
 */
export function popupFontSource(face: Pick<PopupFontFace, "family" | "format" | "url">): string | null {
  if (!POPUP_FONT_FAMILY_PATTERN.test(face.family) || !(POPUP_FONT_FORMATS as readonly string[]).includes(face.format)) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(face.url);
  } catch {
    return null;
  }

  const objectPath = url.pathname.slice(storagePublicPath(POPUP_FONTS_BUCKET, "").length);

  if (!POPUP_FONT_PATH_PATTERN.test(objectPath) || !isOwnStorageUrl(face.url, { bucket: POPUP_FONTS_BUCKET, objectPath })) {
    return null;
  }

  // O endereco normalizado (sem aspas, barras invertidas ou espacos): nada sai da string do url().
  return `url("${url.href}") format("${face.format}")`;
}

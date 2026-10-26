// Estilos do pop-up Livre (docs/27; spec §3.2): TODOS os objetos de estilo do cartao Livre, montados so a partir do
// design ja validado (cores #RRGGBB/#RRGGBBAA, numeros com limite, escolhas de lista) e da origem conferida do
// nosso Supabase. Nenhum texto do produtor entra em CSS: as unicas strings montadas sao degrades, sombras,
// mascaras, rotate(), translate() (so a previa do arrastar no editor), `sizes` e url(); o url() sai so de
// freeImageLayerUrl, com o endereco de freeAssetUrl (origem conferida + bucket + caminho do padrao).
//
// Modulo puro, sem React em tempo de execucao e com imports relativos: tests/popup-livre-desenho.test.mjs carrega
// direto pelo Node. Importa so popup-free-render.ts e popup-design-model.ts (nunca popup-free-model.ts em tempo
// de execucao, o schema, os modelos ou as dicas: o pedaco do aluno fica pequeno; spec §3.6).
//
// Tamanhos: cada comprimento do design esta em px da prancheta (W = artboard.width) e vira `cqw` do elemento de
// fora (container-type: inline-size), entao no celular tudo encolhe junto. Excecoes: borda e linha em px
// (nitidez), fonte com piso de 12 px (freeFontSize) e a area de toque de 44 px de botoes, links e do X (um
// ::before invisivel, classe estatica, nao muda o desenho).

import type { CSSProperties } from "react";
import { fontStackOf, fontStretchOf, type HexColor, type PopupFontFace } from "../../../../server/communications/popup-design-model";
import type {
  FreeAsset,
  FreeBorder,
  FreeBox,
  FreeBoxLayout,
  FreeColorStop,
  FreeFade,
  FreeFillPaint,
  FreeId,
  FreeImageAsset,
  FreeNode,
  FreeShadow,
  FreeSides,
  FreeSpanStyle,
  FreeTextPaint,
  PopupFreeDesign
} from "../../../../server/communications/popup-free-model";
import {
  FREE_ARTBOARD_DEFAULTS,
  freeArtboardMinHeight,
  freeAssetUrl,
  freeFontSize,
  freeLength,
  resolveFreeArtboard,
  resolveFreeClose,
  type FreeResolvedTextStyle
} from "../../../../server/communications/popup-free-render";

type Faces = readonly Pick<PopupFontFace, "family" | "id">[];

/** O que todo estilo de elemento precisa saber: a largura da prancheta, os arquivos, a origem e as fontes. */
export type FreeStyleContext = {
  assets: readonly FreeAsset[];
  faces: Faces;
  /** Origem conferida do nosso Supabase (freeStorageOrigin); null = nenhum arquivo e desenhado. */
  origin: string | null;
  /** Previa do editor: todos recebem clique (menos os travados), para selecionar. */
  preview: boolean;
  /** artboard.width (px da prancheta). */
  width: number;
};

/** Direcao da caixa de quem e filho (a prancheta e uma coluna). */
export type FreeParentDir = "column" | "row";

/**
 * O deslocamento provisorio de um arrastar no editor (px da prancheta). O translate vale para o elemento solto `id`
 * e, quando a equipe arrasta varios juntos, para cada solto de `ids`; dw e dh (as alcas) so para o `id`.
 */
export type FreeDragPreview = { dh?: number; dw?: number; dx: number; dy: number; id: FreeId; ids?: readonly FreeId[] };

export function freeStyleContext(design: PopupFreeDesign, input: { faces?: Faces; origin: string | null; preview?: boolean }): FreeStyleContext {
  return {
    assets: design.assets ?? [],
    faces: input.faces ?? [],
    origin: input.origin,
    preview: input.preview ?? false,
    width: resolveFreeArtboard(design).width
  };
}

/* ------------------------------------------------------------------------------------------------
 * Pequenas conversoes
 * ---------------------------------------------------------------------------------------------- */

const FLEX_ALIGN = { center: "center", end: "flex-end", start: "flex-start", stretch: "stretch" } as const;
const FLEX_JUSTIFY = { around: "space-around", between: "space-between", center: "center", end: "flex-end", start: "flex-start" } as const;
const TEXT_JUSTIFY = { center: "center", left: "flex-start", right: "flex-end" } as const;

/** Tipos que ficam "do tamanho do conteudo" na sequencia quando a largura nao foi escolhida (spec §2.4). */
const HUG_TYPES: ReadonlySet<FreeNode["type"]> = new Set(["badge", "button", "icon"]);
/** Tipos cuja "altura" e altura minima (o texto empurra a caixa em vez de vazar); os outros tem altura fixa. */
const MIN_HEIGHT_TYPES: ReadonlySet<FreeNode["type"]> = new Set(["audio", "badge", "box", "button", "heading", "links", "text"]);
/** Tipos que recebem clique no aluno (texto selecionavel, botoes, links e o player); os outros sao enfeite. */
const CLICKABLE_TYPES: ReadonlySet<FreeNode["type"]> = new Set(["audio", "badge", "button", "heading", "links", "text"]);

/** Numero com ate 2 casas (porcentagens das paradas suavizadas). */
function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function sidesCss(sides: FreeSides, width: number): string {
  if (typeof sides === "number") {
    return freeLength(sides, width);
  }

  return sides.map((side) => freeLength(side, width)).join(" ");
}

export function freeBorderCss(border: FreeBorder | undefined): string | undefined {
  if (!border) {
    return undefined;
  }

  return border.width > 0 ? `${border.width}px ${border.style ?? "solid"} ${border.color}` : "none";
}

export function freeRadiusCss(radius: FreeBox["radius"], width: number): string | undefined {
  if (radius === undefined) {
    return undefined;
  }

  return typeof radius === "number" ? freeLength(radius, width) : radius.map((corner) => freeLength(corner, width)).join(" ");
}

export function freeShadowCss(shadows: readonly FreeShadow[] | undefined, width: number): string | undefined {
  if (!shadows || shadows.length === 0) {
    return undefined;
  }

  return shadows
    .map((shadow) =>
      [
        shadow.inset ? "inset" : null,
        freeLength(shadow.x, width),
        freeLength(shadow.y, width),
        freeLength(shadow.blur, width),
        freeLength(shadow.spread, width),
        shadow.color
      ]
        .filter(Boolean)
        .join(" ")
    )
    .join(", ");
}

function stopsCss(stops: readonly FreeColorStop[]): string {
  return [...stops]
    .sort((a, b) => a.at - b.at)
    .map((stop) => `${stop.color} ${stop.at}%`)
    .join(", ");
}

/** Degrade linear ou circular em CSS (cor solida = um degrade de uma cor so, para empilhar em camadas). */
export function freeGradientCss(paint: Exclude<FreeFillPaint, { kind: "image" }>): string {
  switch (paint.kind) {
    case "solid":
      return `linear-gradient(${paint.color}, ${paint.color})`;
    case "linear":
      return `linear-gradient(${paint.angle ?? 180}deg, ${stopsCss(paint.stops)})`;
    case "radial":
      return `radial-gradient(${paint.shape ?? "ellipse"} ${paint.extent ?? "farthest-corner"} at ${paint.x}% ${paint.y}%, ${stopsCss(paint.stops)})`;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Arquivos: o endereco e montado da origem conferida (nunca de texto do design)
 * ---------------------------------------------------------------------------------------------- */

/** O formato que freeAssetUrl devolve: so [a-z0-9.:[]-] na maquina e [a-z0-9/._-] no caminho. Conferido de novo aqui. */
const SAFE_ASSET_URL = /^https?:\/\/[a-z0-9.:[\]-]+\/storage\/v1\/object\/public\/[a-z0-9-]+\/[a-z0-9/._-]+$/;

function assetById(ctx: Pick<FreeStyleContext, "assets">, id: FreeId | null | undefined): FreeAsset | null {
  return id ? (ctx.assets.find((asset) => asset.id === id) ?? null) : null;
}

/** O endereco publico de um arquivo do design (imagem ou video), ou null (nada e desenhado). */
export function freeAssetSrc(ctx: Pick<FreeStyleContext, "assets" | "origin">, id: FreeId | null | undefined, kind: FreeAsset["kind"]): string | null {
  const asset = assetById(ctx, id);
  const url = asset && asset.kind === kind ? freeAssetUrl(asset, ctx.origin) : null;

  return url && SAFE_ASSET_URL.test(url) ? url : null;
}

/** A imagem de um arquivo do design (para medidas e pinturas). */
export function freeImageAsset(ctx: Pick<FreeStyleContext, "assets">, id: FreeId | null | undefined): FreeImageAsset | null {
  const asset = assetById(ctx, id);

  return asset && asset.kind === "image" ? asset : null;
}

/** A camada url("...") de uma pintura de imagem: a unica funcao que monta url( no cartao Livre. */
function freeImageLayerUrl(ctx: Pick<FreeStyleContext, "assets" | "origin">, id: FreeId): string | null {
  const src = freeAssetSrc(ctx, id, "image");

  return src ? `url("${src}")` : null;
}

/* ------------------------------------------------------------------------------------------------
 * Pinturas de fundo (ate 3 camadas; a primeira fica por cima)
 * ---------------------------------------------------------------------------------------------- */

export type FreeFillCss = Pick<CSSProperties, "backgroundImage" | "backgroundPosition" | "backgroundRepeat" | "backgroundSize">;

/**
 * As camadas de fundo em listas do CSS. Imagem: so quando o endereco sai de freeAssetUrl (senao a camada sai);
 * cobrindo, cabendo ou repetindo (no tamanho do arquivo, em cqw), com o ponto de foco.
 */
export function freeFillCss(fill: readonly FreeFillPaint[] | undefined, ctx: Pick<FreeStyleContext, "assets" | "origin" | "width">): FreeFillCss {
  const layers: { image: string; position: string; repeat: string; size: string }[] = [];

  for (const paint of fill ?? []) {
    if (paint.kind !== "image") {
      layers.push({ image: freeGradientCss(paint), position: "50% 50%", repeat: "no-repeat", size: "100% 100%" });
      continue;
    }

    const image = freeImageLayerUrl(ctx, paint.asset);

    if (!image) {
      continue;
    }

    const [x, y] = paint.focus ?? [50, 50];
    const fit = paint.fit ?? "cover";
    const asset = freeImageAsset(ctx, paint.asset);
    const size = fit === "tile" ? (asset ? `${freeLength(asset.width, ctx.width)} ${freeLength(asset.height, ctx.width)}` : "auto") : fit;

    layers.push({ image, position: `${x}% ${y}%`, repeat: fit === "tile" ? "repeat" : "no-repeat", size });
  }

  if (layers.length === 0) {
    return {};
  }

  return {
    backgroundImage: layers.map((layer) => layer.image).join(", "),
    backgroundPosition: layers.map((layer) => layer.position).join(", "),
    backgroundRepeat: layers.map((layer) => layer.repeat).join(", "),
    backgroundSize: layers.map((layer) => layer.size).join(", ")
  };
}

/* ------------------------------------------------------------------------------------------------
 * Esmaecer (mascara), caixa, posicao
 * ---------------------------------------------------------------------------------------------- */

/**
 * Esmaecer: o elemento some na direcao de `side`, inteiro ate `start` %, sumido em `end` %, com paradas
 * suavizadas (sem faixa dura), como o degrade do Personalizado.
 */
export function freeFadeMaskCss(fade: FreeFade): string {
  const span = Math.max(0, fade.end - fade.start);

  return `linear-gradient(to ${fade.side}, #000 ${num(fade.start)}%, #000000a6 ${num(fade.start + 0.45 * span)}%, #00000040 ${num(fade.start + 0.75 * span)}%, #0000 ${num(fade.end)}%)`;
}

/** A caixa de um elemento: fundo, borda, cantos, sombras, opacidade, desfoques, corte, respiro e esmaecer. */
export function freeBoxCss(box: FreeBox | undefined, ctx: Pick<FreeStyleContext, "assets" | "origin" | "width">, options: { ellipse?: boolean } = {}): CSSProperties {
  const css: CSSProperties = {};

  if (options.ellipse) {
    css.borderRadius = "50%";
  }

  if (!box) {
    return css;
  }

  Object.assign(css, freeFillCss(box.fill, ctx));

  const border = freeBorderCss(box.border);
  const radius = freeRadiusCss(box.radius, ctx.width);
  const shadow = freeShadowCss(box.shadows, ctx.width);

  if (border) {
    css.border = border;
  }

  if (radius && !options.ellipse) {
    css.borderRadius = radius;
  }

  if (shadow) {
    css.boxShadow = shadow;
  }

  if (box.padding !== undefined) {
    css.padding = sidesCss(box.padding, ctx.width);
  }

  if (box.opacity !== undefined && box.opacity !== 100) {
    css.opacity = box.opacity / 100;
  }

  if (box.blur) {
    css.filter = `blur(${freeLength(box.blur, ctx.width)})`;
  }

  if (box.backdropBlur) {
    const blur = `blur(${freeLength(box.backdropBlur, ctx.width)})`;

    css.backdropFilter = blur;
    css.WebkitBackdropFilter = blur;
  }

  if (box.clip) {
    css.overflow = "hidden";
  }

  if (box.fade) {
    const mask = freeFadeMaskCss(box.fade);

    css.maskImage = mask;
    css.WebkitMaskImage = mask;
  }

  return css;
}

/** O tipo usa altura minima (com texto, caixa, player) em vez de altura fixa. */
export function freeUsesMinHeight(type: FreeNode["type"]): boolean {
  return MIN_HEIGHT_TYPES.has(type);
}

/** Largura na sequencia quando nao foi escolhida: "hug" para selo, botao e icone; "fill" para o resto. */
export function freeFlowWidthOf(node: FreeNode): "fill" | "hug" | number {
  const width = node.place?.mode === "flow" ? node.place.width : undefined;

  return width ?? (HUG_TYPES.has(node.type) ? "hug" : "fill");
}

/** Proporcao da midia sem altura escolhida: a do arquivo (video: a do poster; sem poster, 16 / 9). */
export function freeMediaAspect(node: FreeNode, ctx: Pick<FreeStyleContext, "assets">): string | null {
  if (node.type === "image") {
    const asset = freeImageAsset(ctx, node.asset);

    return asset ? `${asset.width} / ${asset.height}` : "16 / 9";
  }

  if (node.type === "video") {
    const video = assetById(ctx, node.asset);
    const poster = video && video.kind === "video" ? freeImageAsset(ctx, video.poster) : null;

    return poster ? `${poster.width} / ${poster.height}` : "16 / 9";
  }

  return null;
}

/**
 * Onde o elemento fica. Solto: left/top/width (e height ou min-height) em cqw a partir do canto de cima a esquerda
 * da prancheta, girar e camada. Na sequencia (coluna ou linha da caixa de fora): largura que ocupa a linha, do
 * tamanho do conteudo ou fixa; altura fixa (midia, forma, linha, espaco) ou minima (com texto, caixa); margens
 * (negativas sobrepoem); alinhamento proprio e camada.
 */
export function freePlaceCss(node: FreeNode, ctx: Pick<FreeStyleContext, "assets" | "width">, parentDir: FreeParentDir = "column", drag?: FreeDragPreview | null): CSSProperties {
  const { width } = ctx;
  const place = node.place;
  const minHeight = freeUsesMinHeight(node.type);
  const isMedia = node.type === "image" || node.type === "video";

  if (place?.mode === "free") {
    // Arrastando varios juntos, todos de `ids` andam; o tamanho (alcas) muda so no `id`.
    const dragging = drag && (drag.id === node.id || drag.ids?.includes(node.id)) ? drag : null;
    const resizing = dragging && dragging.id === node.id ? dragging : null;
    const w = Math.max(4, place.w + (resizing?.dw ?? 0));
    const h = place.h === undefined ? undefined : Math.max(4, place.h + (resizing?.dh ?? 0));
    const css: CSSProperties = {
      left: freeLength(place.x, width),
      margin: 0,
      position: "absolute",
      top: freeLength(place.y, width),
      width: freeLength(w, width)
    };

    if (h !== undefined) {
      css[minHeight ? "minHeight" : "height"] = freeLength(h, width);
    } else if (isMedia) {
      css.aspectRatio = freeMediaAspect(node, ctx) ?? undefined;
    }

    if (place.rotate) {
      css.transform = `rotate(${place.rotate}deg)`;
      css.transformOrigin = "center";
    }

    if (place.z) {
      css.zIndex = place.z;
    }

    if (dragging && (dragging.dx || dragging.dy)) {
      css.translate = `${freeLength(dragging.dx, width)} ${freeLength(dragging.dy, width)}`;
    }

    return css;
  }

  const css: CSSProperties = { minWidth: 0, position: "relative" };
  const flowWidth = freeFlowWidthOf(node);
  const align = place?.align ? FLEX_ALIGN[place.align] : undefined;

  if (parentDir === "row") {
    if (node.type === "spacer" && place?.width === undefined) {
      css.flex = "none";
      css.width = freeLength(node.size ?? 16, width);
    } else if (flowWidth === "fill") {
      css.flex = "1 1 0";
    } else if (flowWidth === "hug") {
      css.flex = "none";
    } else {
      css.flex = "none";
      css.width = freeLength(flowWidth, width);
    }

    if (align) {
      css.alignSelf = align;
    }
  } else if (flowWidth === "fill") {
    css.alignSelf = "stretch";
  } else {
    css.maxWidth = "100%";
    css.width = flowWidth === "hug" ? "fit-content" : freeLength(flowWidth, width);

    if (align) {
      css.alignSelf = align;
    }
  }

  if (place?.height !== undefined) {
    css[minHeight ? "minHeight" : "height"] = freeLength(place.height, width);
  } else if (isMedia) {
    css.aspectRatio = freeMediaAspect(node, ctx) ?? undefined;
  } else if (node.type === "spacer" && parentDir === "column") {
    css.height = freeLength(node.size ?? 16, width);
  }

  if (node.type === "spacer" || node.type === "divider") {
    css.flexShrink = 0;
  }

  // Sempre explicita (0 sem escolha): a margem do <h2>/<p> do navegador nunca entra, e o texto nao a zera.
  css.margin = place?.margin !== undefined ? sidesCss(place.margin, width) : 0;

  if (place?.z) {
    css.zIndex = place.z;
  }

  return css;
}

/** Clique: no aluno, so texto, botoes, links e o player; na previa do editor todos, menos os travados. */
export function freePointerEvents(node: FreeNode, preview: boolean): "auto" | "none" {
  if (preview) {
    return node.locked ? "none" : "auto";
  }

  return CLICKABLE_TYPES.has(node.type) ? "auto" : "none";
}

/* ------------------------------------------------------------------------------------------------
 * Texto
 * ---------------------------------------------------------------------------------------------- */

/** Pintura do texto: solida = color; degrade = fundo recortado pelas letras (cada parte e um span inline). */
export function freeTextPaintCss(paint: FreeTextPaint): CSSProperties {
  if (paint.kind === "solid") {
    return { color: paint.color };
  }

  return {
    backgroundClip: "text",
    backgroundImage: freeGradientCss(paint),
    boxDecorationBreak: "clone",
    color: "transparent",
    WebkitBackgroundClip: "text",
    WebkitBoxDecorationBreak: "clone",
    WebkitTextFillColor: "transparent"
  };
}

/** A cor que um degrade deixa para o que usa `currentColor` (icones do selo e do botao): a primeira parada. */
function paintBaseColor(paint: FreeTextPaint): HexColor {
  return paint.kind === "solid" ? paint.color : ([...paint.stops].sort((a, b) => a.at - b.at)[0]?.color ?? "#ffffff");
}

/**
 * Tipografia do elemento (fonte pronta ou enviada, tamanho com piso de 12 px, peso, italico, altura da linha,
 * letras, maiusculas, linha no texto, alinhamento, sombra). A pintura em degrade vai nas partes (freeSpanCss); o
 * elemento fica com a primeira cor (icones).
 */
export function freeTextCss(style: FreeResolvedTextStyle, ctx: Pick<FreeStyleContext, "faces" | "width">): CSSProperties {
  const css: CSSProperties = {
    color: paintBaseColor(style.paint),
    fontFamily: fontStackOf(style.font, ctx.faces),
    fontSize: freeFontSize(style.size, ctx.width),
    fontStretch: fontStretchOf(style.font),
    fontStyle: style.italic ? "italic" : "normal",
    fontWeight: style.weight,
    letterSpacing: `${style.letterSpacing}em`,
    lineHeight: style.lineHeight,
    overflowWrap: "anywhere",
    textAlign: style.align,
    textDecorationLine: style.decoration ?? "none",
    textTransform: style.uppercase ? "uppercase" : "none"
  };

  if (style.shadow) {
    const { blur, color, x, y } = style.shadow;

    css.textShadow = `${freeLength(x, ctx.width)} ${freeLength(y, ctx.width)} ${freeLength(blur, ctx.width)} ${color}`;
  }

  return css;
}

/**
 * Uma parte do texto: o que ela muda (cor ou degrade, fonte, tamanho, peso, italico, letras, maiusculas, linha).
 * Degrade (da parte ou do elemento) = background-clip: text no proprio span, com `gradient` true para a classe da
 * cor de selecao (o texto transparente ficaria invisivel quando selecionado).
 */
export function freeSpanCss(
  span: FreeSpanStyle | undefined,
  element: FreeResolvedTextStyle,
  ctx: Pick<FreeStyleContext, "faces" | "width">
): { gradient: boolean; style: CSSProperties | undefined } {
  const paint = span?.paint ?? element.paint;
  const gradient = paint.kind !== "solid";
  const css: CSSProperties = gradient ? freeTextPaintCss(paint) : span?.paint ? { color: paint.color } : {};

  if (span) {
    if (span.font) {
      css.fontFamily = fontStackOf(span.font, ctx.faces);
      css.fontStretch = fontStretchOf(span.font);
    }

    if (span.size !== undefined) {
      css.fontSize = freeFontSize(span.size, ctx.width);
    }

    if (span.weight !== undefined) {
      css.fontWeight = span.weight;
    }

    if (span.italic !== undefined) {
      css.fontStyle = span.italic ? "italic" : "normal";
    }

    if (span.letterSpacing !== undefined) {
      css.letterSpacing = `${span.letterSpacing}em`;
    }

    if (span.uppercase !== undefined) {
      css.textTransform = span.uppercase ? "uppercase" : "none";
    }

    if (span.decoration !== undefined) {
      css.textDecorationLine = span.decoration;
    }
  }

  return { gradient, style: Object.keys(css).length > 0 ? css : undefined };
}

/** Classe estatica das partes em degrade: a selecao aparece (fundo claro, letra escura). */
export const FREE_GRADIENT_SELECTION_CLASS = "selection:bg-white/80 selection:text-black selection:[-webkit-text-fill-color:#000]";

/** Uma linha do titulo: um span em bloco (as partes ficam lado a lado dentro dele). */
export const FREE_HEADING_LINE_CSS: CSSProperties = { display: "block" };

/** Selo: icone e texto lado a lado, centralizados (um texto longo quebra dentro da largura da caixa). */
export const FREE_BADGE_CSS: CSSProperties = { alignItems: "center", display: "inline-flex", gap: "0.35em", justifyContent: "center" };

/** Icone dentro do selo ou do botao: acompanha o tamanho do texto (e o piso de 12 px). */
export const FREE_INLINE_ICON_CSS: CSSProperties = { flexShrink: 0, height: "1.15em", width: "1.15em" };

/**
 * Botao: icone e texto lado a lado; o texto numa linha com reticencias. O alinhamento do texto so muda quando o
 * produtor escolheu um (sem escolha, centralizado, que e o que se espera de um botao largo).
 */
export function freeButtonLayoutCss(node: Extract<FreeNode, { type: "button" }>): CSSProperties {
  const align = node.textStyle?.align;

  return {
    alignItems: "center",
    boxSizing: "border-box",
    cursor: "pointer",
    display: "flex",
    gap: "0.45em",
    justifyContent: align ? TEXT_JUSTIFY[align] : "center",
    maxWidth: "100%",
    textDecorationLine: node.textStyle?.decoration ?? "none"
  };
}

/** O texto do botao numa linha so, com reticencias. */
export const FREE_BUTTON_LABEL_CSS: CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

/** A linha dos links: lado a lado, alinhada pela textStyle.align (esquerda = inicio, centro, direita = fim). */
export function freeLinksRowCss(node: Extract<FreeNode, { type: "links" }>, style: FreeResolvedTextStyle, ctx: Pick<FreeStyleContext, "width">): CSSProperties {
  return {
    alignItems: "center",
    columnGap: freeLength(node.gap ?? 8, ctx.width),
    display: "flex",
    flexWrap: "wrap",
    justifyContent: TEXT_JUSTIFY[style.align],
    rowGap: "4px"
  };
}

/** Um link: o texto do elemento Links (sem fundo nem borda de botao). */
export const FREE_LINK_RESET_CSS: CSSProperties = { backgroundColor: "transparent", border: 0, cursor: "pointer", padding: 0 };

/* ------------------------------------------------------------------------------------------------
 * Caixa (flex), icone, linha, espaco
 * ---------------------------------------------------------------------------------------------- */

/** A caixa em coluna ou em linha: direcao, quebra, espaco, alinhamento e distribuicao dos filhos. */
export function freeBoxLayoutCss(layout: FreeBoxLayout | undefined, ctx: Pick<FreeStyleContext, "width">): CSSProperties {
  return {
    alignItems: FLEX_ALIGN[layout?.align ?? "stretch"],
    display: "flex",
    flexDirection: layout?.dir ?? "column",
    flexWrap: layout?.wrap ? "wrap" : "nowrap",
    gap: freeLength(layout?.gap ?? 0, ctx.width),
    justifyContent: FLEX_JUSTIFY[layout?.justify ?? "start"]
  };
}

/** O elemento Icone: centraliza o desenho na caixa dele. */
export const FREE_ICON_BOX_CSS: CSSProperties = { alignItems: "center", display: "flex", justifyContent: "center" };

/** O desenho do icone: tamanho em cqw e a cor. */
export function freeIconCss(node: Extract<FreeNode, { type: "icon" }>, ctx: Pick<FreeStyleContext, "width">): CSSProperties {
  const size = freeLength(node.size ?? 24, ctx.width);

  return { color: node.color ?? "#ffffff", flexShrink: 0, height: size, width: size };
}

/** A linha: borda de cima em px (nitidez), sem altura propria. */
export function freeDividerCss(node: Extract<FreeNode, { type: "divider" }>): CSSProperties {
  return { borderTop: `${node.thickness ?? 1}px ${node.style ?? "solid"} ${node.color ?? "#ffffff1f"}`, height: 0 };
}

/* ------------------------------------------------------------------------------------------------
 * Midia
 * ---------------------------------------------------------------------------------------------- */

/** Imagem ou video cobrindo a caixa do elemento, no recorte e no ponto de foco escolhidos. */
export function freeMediaFillCss(node: Extract<FreeNode, { type: "image" | "video" }>): CSSProperties {
  const [x, y] = node.focus ?? [50, 50];

  return { height: "100%", inset: 0, objectFit: node.fit ?? "cover", objectPosition: `${x}% ${y}%`, position: "absolute", width: "100%" };
}

/** A caixa da midia sempre corta o que passa (os cantos valem para a imagem e o video). */
export const FREE_MEDIA_BOX_CSS: CSSProperties = { overflow: "hidden" };

/** Quadriculado da previa do editor (Imagem/Video sem arquivo). Valores fixos, nada do produtor. */
export const FREE_MISSING_MEDIA_CSS: CSSProperties = {
  alignItems: "center",
  backgroundColor: "#27272a",
  backgroundImage: "linear-gradient(45deg, #3f3f46 25%, transparent 25%, transparent 75%, #3f3f46 75%), linear-gradient(45deg, #3f3f46 25%, transparent 25%, transparent 75%, #3f3f46 75%)",
  backgroundPosition: "0 0, 8px 8px",
  backgroundSize: "16px 16px",
  color: "#e4e4e7",
  display: "flex",
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: "12px",
  fontWeight: 600,
  justifyContent: "center",
  minHeight: "48px",
  textAlign: "center"
};

/** Preferencia de movimento lida no navegador (usePopupMotion): "pending" no servidor. */
export type FreeMotion = "motion" | "pending" | "still";
export type FreeVideoMode = "none" | "pending" | "poster" | "video";

/**
 * O que o elemento Video mostra: o video (so com movimento e um arquivo do nosso bucket), o poster (menos
 * movimento, economia de dados ou video que nao monta endereco), ou so o fundo do elemento (sem poster: nada e
 * baixado). "pending" (no servidor, antes de ler a preferencia): so o fundo.
 */
export function freeVideoMode(
  node: Extract<FreeNode, { type: "video" }>,
  ctx: Pick<FreeStyleContext, "assets" | "origin">,
  motion: FreeMotion
): { mode: FreeVideoMode; poster: string | null; src: string | null } {
  const video = assetById(ctx, node.asset);
  const src = video && video.kind === "video" ? freeAssetSrc(ctx, video.id, "video") : null;
  const poster = video && video.kind === "video" ? freeAssetSrc(ctx, video.poster, "image") : null;

  if (motion === "pending") {
    return { mode: "pending", poster: null, src: null };
  }

  if (motion === "motion" && src) {
    return { mode: "video", poster, src };
  }

  return poster ? { mode: "poster", poster, src: null } : { mode: "none", poster: null, src: null };
}

/**
 * `sizes` do next/image (sem ele o srcset usa 100vw e o celular baixa a versao grande): no celular, a fatia da
 * tela que o elemento ocupa; no computador, a largura dele. w = largura do solto, ou a fixa na sequencia, ou a
 * largura util da prancheta (W - respiros). So numeros inteiros de valores validados.
 */
export function freeImageSizes(node: FreeNode, design: Pick<PopupFreeDesign, "artboard">): string {
  const artboard = resolveFreeArtboard(design);
  const W = artboard.width;
  let w: number;

  if (node.place?.mode === "free") {
    w = node.place.w;
  } else if (node.place?.mode === "flow" && typeof node.place.width === "number") {
    w = node.place.width;
  } else {
    const padding = artboard.padding;
    const horizontal = typeof padding === "number" ? padding * 2 : padding.length === 2 ? padding[1] * 2 : padding[1] + padding[3];

    w = W - horizontal;
  }

  const px = Math.max(16, Math.min(Math.round(w), 1600));

  return `(max-width: 480px) calc((100vw - 2rem) * ${px} / ${W}), ${px}px`;
}

/* ------------------------------------------------------------------------------------------------
 * Cartao, prancheta e X
 * ---------------------------------------------------------------------------------------------- */

/** Elemento de fora: a largura (a escolhida, ou a tela menos 2 rem) e o container das unidades cqw. */
export function freeOuterCss(design: Pick<PopupFreeDesign, "artboard">): CSSProperties {
  return { containerType: "inline-size", position: "relative", width: `min(${resolveFreeArtboard(design).width}px, calc(100cqw - 2rem))` };
}

/**
 * A prancheta (a caixa de fora): coluna, contexto proprio de camadas (as camadas negativas ficam acima do fundo
 * dela), corta o que passa (nada imita a pagina fora do cartao), altura minima que cobre os soltos com altura,
 * respiro, espaco, alinhamento, borda, cantos, sombras e as camadas de fundo. Sem nenhuma camada que desenhe
 * (imagem que nao monta endereco), fica a cor padrao: o texto nunca cai direto no veu.
 */
export function freeArtboardCss(design: PopupFreeDesign, ctx: Pick<FreeStyleContext, "assets" | "origin">): CSSProperties {
  const artboard = resolveFreeArtboard(design);
  const width = artboard.width;
  const fill = freeFillCss(artboard.fill, { ...ctx, width });
  const css: CSSProperties = {
    alignItems: FLEX_ALIGN[artboard.align],
    display: "flex",
    flexDirection: "column",
    gap: freeLength(artboard.gap, width),
    isolation: "isolate",
    justifyContent: FLEX_JUSTIFY[artboard.justify],
    minHeight: freeLength(freeArtboardMinHeight(design), width),
    overflow: "hidden",
    padding: sidesCss(artboard.padding, width),
    position: "relative",
    ...(fill.backgroundImage ? fill : { backgroundColor: (FREE_ARTBOARD_DEFAULTS.fill[0] as { color: HexColor }).color })
  };
  const border = freeBorderCss(artboard.border);
  const shadow = freeShadowCss(artboard.shadows, width);

  css.borderRadius = freeLength(artboard.radius, width);

  if (border) {
    css.border = border;
  }

  if (shadow) {
    css.boxShadow = shadow;
  }

  return css;
}

/** Tamanho do desenho do X dentro do circulo. */
const CLOSE_ICON_PX: Record<28 | 36 | 44, number> = { 28: 16, 36: 20, 44: 24 };

/** O X: por cima de tudo (fora da prancheta), tamanho em px visiveis, do lado e na distancia escolhidos. */
export function freeCloseCss(design: Pick<PopupFreeDesign, "close">): { button: CSSProperties; icon: CSSProperties } {
  const close = resolveFreeClose(design);
  const border = freeBorderCss(close.border);
  const button: CSSProperties = {
    alignItems: "center",
    backgroundColor: close.background,
    borderRadius: "9999px",
    color: close.color,
    display: "flex",
    height: `${close.size}px`,
    justifyContent: "center",
    position: "absolute",
    top: `${close.inset}px`,
    width: `${close.size}px`,
    zIndex: 60,
    [close.side]: `${close.inset}px`
  };

  if (border) {
    button.border = border;
  }

  const icon = CLOSE_ICON_PX[close.size] ?? 20;

  return { button, icon: { height: `${icon}px`, width: `${icon}px` } };
}

/* ------------------------------------------------------------------------------------------------
 * Classes estaticas (nenhum valor do produtor)
 * ---------------------------------------------------------------------------------------------- */

/** Area de toque de 44 px (invisivel, nao muda o desenho) em botoes, links e no X. */
export const FREE_TOUCH_CLASS =
  "relative before:absolute before:left-1/2 before:top-1/2 before:size-full before:min-h-11 before:min-w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']";

/**
 * Foco visivel por dentro (a prancheta corta o que passa dela): contorno branco + anel escuro. O anel e o box-shadow
 * inteiro com !important: a sombra propria do botao vem no estilo em linha e venceria; no foco, ele toma o lugar dela.
 */
export const FREE_FOCUS_CLASS = "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white focus-visible:[box-shadow:inset_0_0_0_4px_#000000b3]!";

/** Passar o mouse e apertar nos botoes (sem animacao com menos movimento). */
export const FREE_PRESS_CLASS = "transition-[filter,transform] hover:brightness-110 active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0";

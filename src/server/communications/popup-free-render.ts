// Design Livre do pop-up (docs/27): o que o cartao do aluno (PopupFreeCard) importa em tempo de execucao.
// Pequeno de proposito: os padroes, a escala do cartao (cqw do proprio cartao), as leituras do design (primeiro
// titulo, primeiro texto, nome do dialogo, botao "Abrir um link"), a origem conferida do nosso Supabase e o
// endereco dos arquivos montado a partir do caminho. Sem zod, sem os modelos e sem as dicas (ficam em
// popup-free-model.ts, popup-free-starters.ts e popup-free-checks.ts, que so o editor usa). popup-free-model.ts
// importa os padroes daqui (uma fonte so). Imports relativos: os testes carregam pelo Node.

import { isSafeHeroCtaHref } from "../member-area/home-hero-links";
import type { PopupItem } from "./notification-model";
import {
  POPUP_VIDEO_BUCKET,
  POPUP_VIDEO_PATH_PATTERN,
  scaledLength,
  scaledLengthWithFloor,
  STORAGE_SAFE_HOSTNAME,
  storagePublicPath
} from "./popup-design-model";
import type {
  FreeArtboard,
  FreeAsset,
  FreeButtonNode,
  FreeClose,
  FreeHeadingNode,
  FreeNode,
  FreeTextNode,
  FreeTextStyle,
  PopupFreeDesign
} from "./popup-free-model";

/* ------------------------------------------------------------------------------------------------
 * Padroes (omitidos na forma canonica; popup-free-model.ts usa os mesmos)
 * ---------------------------------------------------------------------------------------------- */

/** Piso da fonte no celular (px reais) e area de toque minima de botoes, links e do X (px). */
export const FREE_MIN_FONT_PX = 12;
export const FREE_MIN_TOUCH_PX = 44;

// Objetos literais, sem chamada no topo do modulo (Object.freeze seria mantido pelo minificador e iria para o
// pedaco da janela do pop-up, que so precisa de popupFreeDialogAria). Ninguem muda estes objetos.

/** A prancheta sem nada escolhido: 440 px, fundo escuro, respiro 24, espaco 12, esticada, em cima, cantos 24. */
export const FREE_ARTBOARD_DEFAULTS: Readonly<FreeArtboard> = {
  align: "stretch",
  fill: [{ color: "#16181c", kind: "solid" }],
  gap: 12,
  justify: "start",
  minHeight: 0,
  padding: 24,
  radius: 24,
  width: 440
};

/** O X sem nada escolhido: branco sobre um vidro claro, 36 px, a 12 px do canto direito. */
export const FREE_CLOSE_DEFAULTS: Readonly<FreeClose> = {
  background: "#ffffff1f",
  color: "#ffffff",
  inset: 12,
  side: "right",
  size: 36
};

/** O texto de cada tipo sem nada escolhido (tipos sem texto usam o do Texto). */
export type FreeResolvedTextStyle = Required<Pick<FreeTextStyle, "align" | "font" | "letterSpacing" | "lineHeight" | "paint" | "size" | "weight">> & FreeTextStyle;

export const FREE_TEXT_DEFAULTS: Readonly<Record<"badge" | "button" | "heading" | "links" | "text", Readonly<FreeResolvedTextStyle>>> = {
  badge: { align: "left", font: { key: "inter", kind: "builtin" }, letterSpacing: 0, lineHeight: 1.2, paint: { color: "#ffffff", kind: "solid" }, size: 12, weight: 700 },
  button: { align: "left", font: { key: "inter", kind: "builtin" }, letterSpacing: 0, lineHeight: 1.2, paint: { color: "#ffffff", kind: "solid" }, size: 15, weight: 700 },
  heading: { align: "left", font: { key: "inter", kind: "builtin" }, letterSpacing: 0, lineHeight: 1.1, paint: { color: "#ffffff", kind: "solid" }, size: 28, weight: 800 },
  links: { align: "left", font: { key: "inter", kind: "builtin" }, letterSpacing: 0, lineHeight: 1.2, paint: { color: "#ffffff", kind: "solid" }, size: 13, weight: 600 },
  text: { align: "left", font: { key: "inter", kind: "builtin" }, letterSpacing: 0, lineHeight: 1.5, paint: { color: "#ffffff", kind: "solid" }, size: 15, weight: 400 }
};

/** Os padroes de texto do tipo (os tipos sem texto proprio ficam com os do Texto). */
export function freeTextDefaultsOf(type: FreeNode["type"]): Readonly<FreeResolvedTextStyle> {
  return type === "badge" || type === "button" || type === "heading" || type === "links" ? FREE_TEXT_DEFAULTS[type] : FREE_TEXT_DEFAULTS.text;
}

/* ------------------------------------------------------------------------------------------------
 * Escala: px da prancheta em cqw do proprio cartao (encolhe junto no celular)
 * ---------------------------------------------------------------------------------------------- */

/** Um comprimento do design (px na largura da prancheta) em cqw do cartao. */
export function freeLength(px: number, width: number): string {
  return scaledLength(px, width);
}

/** Tamanho da fonte com o piso de leitura de 12 px no celular. */
export function freeFontSize(px: number, width: number): string {
  return scaledLengthWithFloor(px, width, FREE_MIN_FONT_PX);
}

/* ------------------------------------------------------------------------------------------------
 * Aparelho: o celular com os valores proprios (devices.mobile) por cima do computador
 * ---------------------------------------------------------------------------------------------- */

type Loose = Record<string, unknown>;

const isPlain = (value: unknown): value is Loose => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * O design do aparelho. "desktop" (ou sem valores do celular) devolve o MESMO objeto; "mobile" junta, por elemento,
 * cada parte do celular por cima da do computador (`place`, `textStyle`, `box` e `layout` campo a campo; `size`,
 * `gap` e `hidden` trocam) e a prancheta (respiro, espaco, altura minima). Pequeno de proposito: e o cartao do aluno.
 */
export function resolveFreeForDevice(design: PopupFreeDesign, device: "desktop" | "mobile"): PopupFreeDesign {
  const mobile = device === "mobile" ? design.devices?.mobile : undefined;

  if (!mobile) {
    return design;
  }

  const own = (mobile.nodes ?? {}) as Record<string, Loose | undefined>;
  const merge = (node: FreeNode): FreeNode => {
    const next: Loose = { ...node };
    const values = Object.prototype.hasOwnProperty.call(own, node.id) ? own[node.id] : undefined;

    for (const [key, value] of Object.entries(values ?? {})) {
      next[key] = isPlain(value) && isPlain(next[key]) ? { ...next[key], ...value } : value;
    }

    if (node.type === "box") {
      next.children = node.children.map(merge);
    }

    return next as FreeNode;
  };

  return { ...design, artboard: { ...design.artboard, ...mobile.artboard }, children: design.children.map(merge) };
}

/* ------------------------------------------------------------------------------------------------
 * Leituras do design
 * ---------------------------------------------------------------------------------------------- */

/** A prancheta com os padroes preenchidos (cada campo do design e opcional). */
export function resolveFreeArtboard(design: Pick<PopupFreeDesign, "artboard">): FreeArtboard {
  const artboard = design.artboard ?? {};
  const resolved: FreeArtboard = {
    align: artboard.align ?? FREE_ARTBOARD_DEFAULTS.align,
    fill: artboard.fill && artboard.fill.length > 0 ? artboard.fill : [...FREE_ARTBOARD_DEFAULTS.fill],
    gap: artboard.gap ?? FREE_ARTBOARD_DEFAULTS.gap,
    justify: artboard.justify ?? FREE_ARTBOARD_DEFAULTS.justify,
    minHeight: artboard.minHeight ?? FREE_ARTBOARD_DEFAULTS.minHeight,
    padding: artboard.padding ?? FREE_ARTBOARD_DEFAULTS.padding,
    radius: artboard.radius ?? FREE_ARTBOARD_DEFAULTS.radius,
    width: artboard.width ?? FREE_ARTBOARD_DEFAULTS.width
  };

  if (artboard.border) {
    resolved.border = artboard.border;
  }

  if (artboard.shadows && artboard.shadows.length > 0) {
    resolved.shadows = artboard.shadows;
  }

  return resolved;
}

/** O X com os padroes preenchidos. */
export function resolveFreeClose(design: Pick<PopupFreeDesign, "close">): FreeClose {
  const close = design.close ?? {};
  const resolved: FreeClose = {
    background: close.background ?? FREE_CLOSE_DEFAULTS.background,
    color: close.color ?? FREE_CLOSE_DEFAULTS.color,
    inset: close.inset ?? FREE_CLOSE_DEFAULTS.inset,
    side: close.side ?? FREE_CLOSE_DEFAULTS.side,
    size: close.size ?? FREE_CLOSE_DEFAULTS.size
  };

  if (close.border) {
    resolved.border = close.border;
  }

  return resolved;
}

/** O estilo de texto do elemento com os padroes do tipo preenchidos (o que o elemento nao escolheu). */
export function freeTextStyleOf(node: FreeNode): FreeResolvedTextStyle {
  const defaults = freeTextDefaultsOf(node.type);
  const own = "textStyle" in node && node.textStyle ? node.textStyle : {};
  const resolved: FreeResolvedTextStyle = { ...defaults };

  for (const [key, value] of Object.entries(own)) {
    if (value !== undefined) {
      (resolved as Record<string, unknown>)[key] = value;
    }
  }

  return resolved;
}

/** Visita os elementos que o aluno ve (pula os escondidos e tudo dentro de uma caixa escondida), na ordem do DOM. */
function findVisible<T extends FreeNode>(nodes: readonly FreeNode[], match: (node: FreeNode) => node is T): T | null {
  for (const node of nodes) {
    if (node.hidden) {
      continue;
    }

    if (match(node)) {
      return node;
    }

    if (node.type === "box") {
      const inner = findVisible(node.children, match);

      if (inner) {
        return inner;
      }
    }
  }

  return null;
}

function someVisible(nodes: readonly FreeNode[], match: (node: FreeNode) => boolean): boolean {
  return findVisible(nodes, (node): node is FreeNode => match(node)) !== null;
}

/**
 * Altura minima desenhada da prancheta (px da prancheta): a escolhida, ou o fim do elemento solto visivel com
 * altura mais embaixo (y + h), o que for maior. Soltos sem altura (automatica) nao entram: o Revisar avisa.
 */
export function freeArtboardMinHeight(design: Pick<PopupFreeDesign, "artboard" | "children">): number {
  let height = resolveFreeArtboard(design).minHeight;

  for (const node of design.children) {
    if (!node.hidden && node.place?.mode === "free" && typeof node.place.h === "number") {
      height = Math.max(height, node.place.y + node.place.h);
    }
  }

  return Math.max(0, Math.round(height));
}

/** O primeiro titulo visivel (o <h2> e o nome do dialogo); null = sem titulo. */
export function freeFirstHeading(design: Pick<PopupFreeDesign, "children">): FreeHeadingNode | null {
  return findVisible(design.children, (node): node is FreeHeadingNode => node.type === "heading");
}

/** Texto de um titulo: as partes juntas, as linhas separadas por espaco. */
export function freeHeadingText(node: Pick<FreeHeadingNode, "lines">): string {
  return node.lines
    .map((line) => line.map((span) => span.text).join("").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

/** O primeiro texto visivel (a descricao do dialogo); null = sem texto. */
export function freeFirstText(design: Pick<PopupFreeDesign, "children">): FreeTextNode | null {
  return findVisible(design.children, (node): node is FreeTextNode => node.type === "text");
}

/** Texto de um elemento Texto: as linhas separadas por espaco (para o `body` do PopupItem). */
export function freeTextContent(node: Pick<FreeTextNode, "lines">): string {
  return freeHeadingText(node);
}

/**
 * Nome do dialogo: o texto do primeiro titulo visivel (aria-labelledby no <h2>); sem titulo, o titulo do aviso
 * (aria-label).
 */
export function freeAccessibleName(design: Pick<PopupFreeDesign, "children">, title: string): { label: string; labelledBy: boolean } {
  const heading = freeFirstHeading(design);
  const text = heading ? freeHeadingText(heading) : "";

  return text ? { label: text, labelledBy: true } : { label: title.trim(), labelledBy: false };
}

/** O botao "Abrir um link" visivel (no maximo um; o clique nele conta como o clique do pop-up). */
export function freeLinkButton(design: Pick<PopupFreeDesign, "children"> | null | undefined): FreeButtonNode | null {
  if (!design) {
    return null;
  }

  return findVisible(
    design.children,
    (node): node is FreeButtonNode => node.type === "button" && node.action.kind === "link" && isSafeHeroCtaHref(node.action.href)
  );
}

/** Ha um botao "Lembrar depois" visivel (entao os Links nao repetem o "Lembrar depois"). */
export function freeHasSnoozeButton(design: Pick<PopupFreeDesign, "children">): boolean {
  return someVisible(design.children, (node) => node.type === "button" && node.action.kind === "snooze");
}

/** Nome e descricao do dialogo do Livre (o dialogo importa daqui, sem puxar o cartao). */
export function popupFreeDialogAria(
  popup: Pick<PopupItem, "body" | "freeDesign" | "title">,
  ids: { bodyId: string; titleId: string }
): { "aria-describedby"?: string; "aria-label"?: string; "aria-labelledby"?: string } {
  if (!popup.freeDesign) {
    return { "aria-describedby": popup.body ? ids.bodyId : undefined, "aria-labelledby": ids.titleId };
  }

  const named = freeAccessibleName(popup.freeDesign, popup.title);
  const describedBy = freeFirstText(popup.freeDesign) ? ids.bodyId : undefined;

  return named.labelledBy
    ? { "aria-describedby": describedBy, "aria-labelledby": ids.titleId }
    : { "aria-describedby": describedBy, "aria-label": named.label };
}

/* ------------------------------------------------------------------------------------------------
 * Arquivos: o design guarda so o caminho; o endereco e montado da origem conferida do nosso Supabase
 * ---------------------------------------------------------------------------------------------- */

/** Bucket das imagens do Livre (o mesmo da imagem do aviso). */
export const FREE_IMAGE_BUCKET = "content-assets";
/** Imagens do Livre (enviadas no editor) e as do aviso (reaproveitadas pelos modelos). */
export const FREE_IMAGE_PATH_PATTERN = /^communications\/(?:free|images)\/[a-f0-9]{24}\.webp$/;

const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])$/;

/**
 * A origem do nosso Supabase: https (http so em localhost/127.0.0.1/[::1]), maquina so com [a-z0-9.-], sem
 * usuario, senha, caminho, query ou fragmento; senao null. O URL do WHATWG aceita aspas, parenteses, virgula e
 * ";" no nome da maquina: o padrao recusa, e nada sai do url("...") do cartao.
 */
export function freeStorageOrigin(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 2_048) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  const secure = url.protocol === "https:";
  const loopback = url.protocol === "http:" && LOOPBACK_HOST.test(url.hostname);

  if ((!secure && !loopback) || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    return null;
  }

  if (!STORAGE_SAFE_HOSTNAME.test(url.hostname)) {
    return null;
  }

  return url.origin;
}

/**
 * Endereco publico do arquivo: origem conferida + caminho publico do bucket do tipo + o caminho, so quando o
 * caminho casa com o padrao do tipo (imagem: FREE_IMAGE_PATH_PATTERN; video: POPUP_VIDEO_PATH_PATTERN com a
 * extensao do tipo); senao null (nada e desenhado).
 */
export function freeAssetUrl(asset: FreeAsset, origin: string | null | undefined): string | null {
  if (!origin || freeStorageOrigin(origin) !== origin) {
    return null;
  }

  if (asset.kind === "image") {
    return typeof asset.path === "string" && FREE_IMAGE_PATH_PATTERN.test(asset.path) ? `${origin}${storagePublicPath(FREE_IMAGE_BUCKET, asset.path)}` : null;
  }

  if (asset.kind === "video") {
    const extension = asset.mimeType === "video/mp4" ? ".mp4" : asset.mimeType === "video/webm" ? ".webm" : null;

    return extension && typeof asset.path === "string" && POPUP_VIDEO_PATH_PATTERN.test(asset.path) && asset.path.endsWith(extension)
      ? `${origin}${storagePublicPath(POPUP_VIDEO_BUCKET, asset.path)}`
      : null;
  }

  return null;
}

// Design Livre do pop-up (docs/27; o editor estilo Elementor): tipos, limites, forma canonica, caminhadas na
// arvore, estimativa do jsonb, reescala pela largura e as ajudas do editor. Modulo puro e SEM zod, imports
// relativos (os testes carregam pelo Node). O schema zod mora em popup-free-schema.ts; os padroes e o que o
// cartao do aluno usa em tempo de execucao moram em popup-free-render.ts (o cartao do aluno NAO importa este
// arquivo, so `import type`).
//
// Coexistencia: campaigns.popup_design guarda o Personalizado (sem `mode`) ou o Livre ({ mode: "free",
// version: 1, ... }); a leitura passa pelo roteador (popup-design-router.ts). Toda medida esta em px da
// prancheta na largura escolhida (artboard.width, 280 a 720); o cartao desenha em cqw (encolhe junto no
// celular). Os arquivos guardam so o caminho no nosso Storage: o endereco e montado na hora (freeAssetUrl).

import type { NoticeDraft } from "./schemas";
import type { PopupCta, PopupItem } from "./notification-model";
import {
  contrastRatio,
  type HexColor,
  type PopupFontFace,
  type PopupFontRef,
  type PopupFontWeight,
  type PopupVideoMimeType
} from "./popup-design-model";
import {
  FREE_ARTBOARD_DEFAULTS,
  FREE_CLOSE_DEFAULTS,
  FREE_MIN_FONT_PX,
  FREE_MIN_TOUCH_PX,
  freeFirstText,
  freeHeadingText,
  freeFirstHeading,
  freeTextDefaultsOf,
  resolveFreeArtboard,
  resolveFreeClose
} from "./popup-free-render";

export { FREE_MIN_FONT_PX, FREE_MIN_TOUCH_PX };

export const FREE_DESIGN_MODE = "free" as const;
export const FREE_DESIGN_VERSION = 1 as const;

/** Id de elemento e de arquivo: comeca com letra; minusculas e numeros (o editor gera "titulo2", "img3"...). */
export const FREE_ID_PATTERN = /^[a-z][a-z0-9]{0,15}$/;
export type FreeId = string;

/* Pinturas ------------------------------------------------------------------------------------- */

/** Parada de cor (0 a 100 %). A forma canonica ordena por `at`. */
export type FreeColorStop = { at: number; color: HexColor };
export type FreeSolidPaint = { color: HexColor; kind: "solid" };
/** Angulo em graus (padrao 180 = de cima para baixo). */
export type FreeLinearPaint = { angle?: number; kind: "linear"; stops: FreeColorStop[] };
/** Centro em % da caixa; "closest-side" termina na borda mais perto (bom para manchas de luz). */
export type FreeRadialPaint = { extent?: "closest-side" | "farthest-corner"; kind: "radial"; shape?: "circle" | "ellipse"; stops: FreeColorStop[]; x: number; y: number };
/** Imagem do design (id em `assets`) cobrindo, cabendo ou repetindo, com ponto de foco em %. */
export type FreeImagePaint = { asset: FreeId; fit?: "contain" | "cover" | "tile"; focus?: [number, number]; kind: "image" };
// Textura (pontos, grade, listras) fica para o L6: um `kind` novo na uniao, sem mudar a `version`.

export type FreeTextPaint = FreeLinearPaint | FreeRadialPaint | FreeSolidPaint;
export type FreeFillPaint = FreeImagePaint | FreeLinearPaint | FreeRadialPaint | FreeSolidPaint;

/* Caixa (fundo, borda, cantos, sombras, efeitos) ------------------------------------------------- */

/** Um numero (todos os lados), [vertical, horizontal] ou [cima, direita, baixo, esquerda]. */
export type FreeSides = number | [number, number] | [number, number, number, number];
export type FreeBorder = { color: HexColor; style?: "dashed" | "dotted" | "solid"; width: number };
export type FreeShadow = { blur: number; color: HexColor; inset?: boolean; spread: number; x: number; y: number };
/** Esmaecer (mascara): o elemento some na direcao de `side`; inteiro ate `start` %, sumido em `end` %. */
export type FreeFade = { end: number; side: "bottom" | "left" | "right" | "top"; start: number };

export type FreeBox = {
  /** Fundo do backdrop-filter, 0 a 40 px. */
  backdropBlur?: number;
  /** filter: blur, 0 a 80 px (manchas de luz). */
  blur?: number;
  border?: FreeBorder;
  /** Corta o que passa da caixa (overflow hidden). */
  clip?: boolean;
  fade?: FreeFade;
  /** Ate 3 camadas; a primeira fica por cima (ordem do CSS). */
  fill?: FreeFillPaint[];
  /** 0 a 100 (%). */
  opacity?: number;
  padding?: FreeSides;
  /** 0 a 999 (999 = pilula); um numero ou [sup. esq., sup. dir., inf. dir., inf. esq.]. */
  radius?: number | [number, number, number, number];
  shadows?: FreeShadow[];
};

/* Posicao --------------------------------------------------------------------------------------- */

/** Na sequencia: segue a ordem da caixa (coluna ou linha). */
export type FreeFlowPlace = {
  align?: "center" | "end" | "start" | "stretch";
  /** px fixa (midia, forma, linha, espaco) ou altura minima (elementos com texto e caixas). */
  height?: number;
  /** Pode ser negativa (sobrepor o elemento de cima/do lado). */
  margin?: FreeSides;
  mode: "flow";
  /** "fill" ocupa a linha (na linha: divide o espaco), "hug" do tamanho do conteudo, numero = px. */
  width?: "fill" | "hug" | number;
  /** Camada (-10 a 10); padrao 0. */
  z?: number;
};

/** Solta: so filhos diretos da prancheta nesta versao; X/Y a partir do canto de cima a esquerda da prancheta. */
export type FreeAbsolutePlace = {
  /** Altura (midia, forma, icone, linha) ou altura minima (com texto, caixa); sem = automatica. */
  h?: number;
  mode: "free";
  /** Graus (-180 a 180). */
  rotate?: number;
  w: number;
  x: number;
  y: number;
  z?: number;
};

export type FreePlace = FreeAbsolutePlace | FreeFlowPlace;

/* Texto ----------------------------------------------------------------------------------------- */

export type FreeTextStyle = {
  /** Nos Links: alinha a linha dos links (vira o `justifyContent` dela). */
  align?: "center" | "left" | "right";
  /** Linha no texto: sublinhado ou riscado (preco antigo); sem = nenhuma. */
  decoration?: "line-through" | "underline";
  font?: PopupFontRef;
  italic?: boolean;
  /** em (-0,2 a 1). */
  letterSpacing?: number;
  /** multiplicador (0,7 a 2,5). */
  lineHeight?: number;
  paint?: FreeTextPaint;
  shadow?: { blur: number; color: HexColor; x: number; y: number };
  /** px (10 a 160). */
  size?: number;
  uppercase?: boolean;
  weight?: PopupFontWeight;
};

export type FreeSpanStyle = Pick<FreeTextStyle, "decoration" | "font" | "italic" | "letterSpacing" | "paint" | "size" | "uppercase" | "weight">;
/** Uma parte do texto com estilo proprio (o texto nao e aparado: o espaco entre partes conta). */
export type FreeSpan = { style?: FreeSpanStyle; text: string };
/** Uma linha = partes lado a lado. */
export type FreeLine = FreeSpan[];

/* Elementos ------------------------------------------------------------------------------------- */

export const FREE_ICON_NAMES = [
  "arrow-right", "bell", "book-open", "calendar", "check", "chevron-right", "circle-check", "clock",
  "crown", "flame", "gem", "gift", "graduation-cap", "heart", "lock-open", "megaphone",
  "percent", "play", "rocket", "sparkles", "star", "tag", "trophy", "zap"
] as const;
export type FreeIconName = (typeof FREE_ICON_NAMES)[number];

type FreeNodeCommon = {
  box?: FreeBox;
  /** Nao aparece para o aluno (fica nas Camadas para voltar). */
  hidden?: boolean;
  id: FreeId;
  /** So no editor: nao seleciona nem mexe pelo desenho. */
  locked?: boolean;
  /** Nome na lista de Camadas (ate 40). */
  name?: string;
  place?: FreePlace;
};

export type FreeHeadingNode = FreeNodeCommon & { lines: FreeLine[]; textStyle?: FreeTextStyle; type: "heading" };
export type FreeTextNode = FreeNodeCommon & { lines: FreeLine[]; textStyle?: FreeTextStyle; type: "text" };
export type FreeBadgeNode = FreeNodeCommon & { icon?: FreeIconName; label: string; textStyle?: FreeTextStyle; type: "badge" };
/** cta = o botao principal do aviso (texto e destino no `cta`, o clique contado de sempre). */
export type FreeButtonAction =
  | { kind: "close" }
  | { kind: "cta" }
  | { href: string; kind: "link"; target: "new_tab" | "same_tab" }
  | { kind: "snooze" };
export type FreeButtonNode = FreeNodeCommon & {
  action: FreeButtonAction;
  icon?: { name: FreeIconName; side?: "end" | "start" };
  /** Obrigatorio fora do cta; no cta nao existe (o texto e o do aviso). */
  label?: string;
  textStyle?: FreeTextStyle;
  type: "button";
};
/** asset null so no rascunho (modelo recem-escolhido): salvar pede a imagem. */
export type FreeImageNode = FreeNodeCommon & { alt?: string; asset: FreeId | null; fit?: "contain" | "cover"; focus?: [number, number]; type: "image" };
export type FreeVideoNode = FreeNodeCommon & { asset: FreeId | null; fit?: "contain" | "cover"; focus?: [number, number]; type: "video" };
/** O icone vai em `icon` (o `name` de todos os tipos e o nome da camada). */
export type FreeIconNode = FreeNodeCommon & { color?: HexColor; icon: FreeIconName; size?: number; stroke?: number; type: "icon" };
export type FreeDividerNode = FreeNodeCommon & { color?: HexColor; style?: "dashed" | "dotted" | "solid"; thickness?: number; type: "divider" };
export type FreeSpacerNode = FreeNodeCommon & { size?: number; type: "spacer" };
export type FreeShapeNode = FreeNodeCommon & { shape?: "ellipse" | "rect"; type: "shape" };
/** O player do audio do aviso (entra e sai com o audio). */
export type FreeAudioNode = FreeNodeCommon & { type: "audio" };
/** "Lembrar depois" (quando o aluno pode adiar e nao ha botao Lembrar depois) e "Não mostrar de novo" (se dismiss). */
export type FreeLinksNode = FreeNodeCommon & { dismiss?: boolean; gap?: number; textStyle?: FreeTextStyle; type: "links" };
export type FreeBoxLayout = {
  align?: "center" | "end" | "start" | "stretch";
  dir?: "column" | "row";
  gap?: number;
  justify?: "around" | "between" | "center" | "end" | "start";
  wrap?: boolean;
};
export type FreeBoxNode = FreeNodeCommon & { children: FreeNode[]; layout?: FreeBoxLayout; type: "box" };

export type FreeNode =
  | FreeAudioNode | FreeBadgeNode | FreeBoxNode | FreeButtonNode | FreeDividerNode | FreeHeadingNode | FreeIconNode
  | FreeImageNode | FreeLinksNode | FreeShapeNode | FreeSpacerNode | FreeTextNode | FreeVideoNode;
export type FreeNodeType = FreeNode["type"];

export const FREE_NODE_TYPES = [
  "audio", "badge", "box", "button", "divider", "heading", "icon", "image", "links", "shape", "spacer", "text", "video"
] as const satisfies readonly FreeNodeType[];

/* Arquivos: so o caminho no nosso Storage (o endereco e montado na hora) ------------------------------- */

/** Medidas do servidor (lidas do cabecalho do WebP ao salvar um caminho novo). */
export type FreeImageAsset = { height: number; id: FreeId; kind: "image"; path: string; width: number };
/** `poster`: id de uma imagem de `assets`; sem capa, com menos movimento ou economia de dados aparece so o fundo do elemento. */
export type FreeVideoAsset = { id: FreeId; kind: "video"; mimeType: PopupVideoMimeType; path: string; poster?: FreeId };
export type FreeAsset = FreeImageAsset | FreeVideoAsset;

/* Prancheta, X e o design ---------------------------------------------------------------------- */

/** Completa so depois de `resolveFreeArtboard` (padroes em FREE_ARTBOARD_DEFAULTS); no design, cada campo e opcional. */
export type FreeArtboard = {
  align: "center" | "end" | "start" | "stretch";
  border?: FreeBorder;
  /** Ao menos 1 camada (a de baixo costuma ser a cor solida). */
  fill: FreeFillPaint[];
  gap: number;
  justify: "between" | "center" | "end" | "start";
  /** 0 = cresce com o conteudo. */
  minHeight: number;
  padding: FreeSides;
  radius: number;
  shadows?: FreeShadow[];
  /** px no computador (280 a 720). */
  width: number;
};

/** O X: sempre existe, sempre por cima, 44 px de toque, sempre visivel (regra 11). Padroes em FREE_CLOSE_DEFAULTS. */
export type FreeClose = { background: HexColor; border?: FreeBorder; color: HexColor; inset: number; side: "left" | "right"; size: 28 | 36 | 44 };

/** Forma canonica (gravada, lida e desenhada). */
export type PopupFreeDesign = {
  artboard?: Partial<FreeArtboard>;
  /** Sempre presente na forma canonica (pode ser []). */
  assets: FreeAsset[];
  children: FreeNode[];
  close?: Partial<FreeClose>;
  /** Ids das fontes enviadas usadas (derivado, ordenado; a forma canonica recalcula). Sempre presente. */
  fonts: string[];
  mode: typeof FREE_DESIGN_MODE;
  version: typeof FREE_DESIGN_VERSION;
};

/** O que o schema aceita na entrada (colado, gerado por IA): `assets` e `fonts` podem faltar. */
export type PopupFreeDesignInput = Omit<PopupFreeDesign, "assets" | "fonts"> & { assets?: FreeAsset[]; fonts?: string[] };

/* ------------------------------------------------------------------------------------------------
 * Limites
 * ---------------------------------------------------------------------------------------------- */

export const FREE_DESIGN_LIMITS = {
  alt: 160,
  angle: { max: 360, min: 0 },
  artboardRadius: { max: 64, min: 0 },
  artboardWidth: { max: 720, min: 280 },
  backdropBlur: { max: 40, min: 0 },
  blur: { max: 80, min: 0 },
  borderWidth: { max: 8, min: 0 },
  boxDepth: 2, // caixas: na prancheta (1) e dentro de uma caixa (2); folhas ate 3
  buttons: 3, // alem do principal
  childrenPerBox: 20,
  closeInset: { max: 24, min: 8 },
  dividerThickness: { max: 8, min: 1 },
  effects: 4, // elementos com blur ou backdropBlur
  fills: 3,
  flowHeight: { max: 1600, min: 4 },
  flowWidth: { max: 720, min: 4 },
  fontSize: { max: 160, min: 10 },
  freeNodes: 24,
  gap: { max: 96, min: 0 },
  h: { max: 2400, min: 4 },
  headingLines: 4,
  headings: 4,
  iconSize: { max: 160, min: 8 },
  iconStroke: { max: 3, min: 1 },
  icons: 12,
  imageAssets: 6,
  imageBytes: 420_000,
  imageNodes: 8,
  imageSide: { max: 1600, min: 16 },
  jsonbBytes: 30_000,
  label: 40,
  letterSpacing: { max: 1, min: -0.2 },
  lineHeight: { max: 2.5, min: 0.7 },
  linkButtons: 1, // botoes "Abrir um link" (dentro dos 3)
  margin: { max: 400, min: -400 },
  minHeight: { max: 1600, min: 0 },
  name: 40,
  nodes: 32,
  opacity: { max: 100, min: 0 },
  padding: { max: 200, min: 0 },
  percent: { max: 100, min: 0 },
  radius: { max: 999, min: 0 },
  rotate: { max: 180, min: -180 },
  shadowBlur: { max: 200, min: 0 },
  shadowOffset: { max: 100, min: -100 },
  shadowSpread: { max: 50, min: -50 },
  shadows: 2,
  spacer: { max: 400, min: 0 },
  spanText: 600,
  spansPerLine: 6,
  stops: { max: 5, min: 2 },
  textLines: 12,
  textTotal: 1200,
  uploadedFonts: 4,
  videos: 1,
  w: { max: 1440, min: 4 },
  x: { max: 1440, min: -720 },
  y: { max: 2400, min: -400 },
  z: { max: 10, min: -10 }
} as const;

/** Atalhos de largura do pop-up (P, M, G, GG). */
export const FREE_ARTBOARD_WIDTH_PRESETS = { G: 520, GG: 640, M: 440, P: 360 } as const;

/** Alfa minimo do icone do X (0xcc) e contraste minimo icone x fundo do X. */
export const FREE_CLOSE_MIN_ALPHA = 0xcc;
export const FREE_CLOSE_MIN_CONTRAST = 3;

/* ------------------------------------------------------------------------------------------------
 * Arvore: caminhar, achar, trocar, contar, ids
 * ---------------------------------------------------------------------------------------------- */

export type FreeNodeVisitInfo = { depth: number; index: number; parent: FreeBoxNode | null };

/** Visita todos os elementos na ordem do DOM (profundidade 1 = filhos da prancheta). */
export function walkFreeNodes(nodes: readonly FreeNode[], visit: (node: FreeNode, info: FreeNodeVisitInfo) => void): void {
  const walk = (list: readonly FreeNode[], depth: number, parent: FreeBoxNode | null) => {
    list.forEach((node, index) => {
      visit(node, { depth, index, parent });

      if (node.type === "box" && Array.isArray(node.children)) {
        walk(node.children, depth + 1, node);
      }
    });
  };

  walk(nodes, 1, null);
}

export function findFreeNode(design: Pick<PopupFreeDesign, "children">, id: FreeId): (FreeNodeVisitInfo & { node: FreeNode }) | null {
  let found: (FreeNodeVisitInfo & { node: FreeNode }) | null = null;

  walkFreeNodes(design.children, (node, info) => {
    if (!found && node.id === id) {
      found = { ...info, node };
    }
  });

  return found;
}

function mapNodes(nodes: FreeNode[], id: FreeId, update: (node: FreeNode) => FreeNode): FreeNode[] {
  let changed = false;
  const next = nodes.map((node) => {
    if (node.id === id) {
      const updated = update(node);

      changed ||= updated !== node;

      return updated;
    }

    if (node.type === "box") {
      const children = mapNodes(node.children, id, update);

      if (children !== node.children) {
        changed = true;

        return { ...node, children };
      }
    }

    return node;
  });

  return changed ? next : nodes;
}

/** Troca um elemento pelo id (estrutural: devolve o mesmo objeto se nada mudou). */
export function updateFreeNode(design: PopupFreeDesign, id: FreeId, update: (node: FreeNode) => FreeNode): PopupFreeDesign {
  const children = mapNodes(design.children, id, update);

  return children === design.children ? design : { ...design, children };
}

/** Quantos elementos o design tem (sem contar a prancheta). */
export function freeNodeCount(design: Pick<PopupFreeDesign, "children">): number {
  let count = 0;

  walkFreeNodes(design.children, () => {
    count += 1;
  });

  return count;
}

/** Id novo, unico entre elementos e arquivos: o proprio prefixo, se livre, ou prefixo2, prefixo3... */
export function nextFreeId(design: Pick<PopupFreeDesign, "children"> & { assets?: readonly FreeAsset[] }, prefix: string): FreeId {
  const taken = new Set<string>();

  walkFreeNodes(design.children, (node) => taken.add(node.id));

  for (const asset of design.assets ?? []) {
    taken.add(asset.id);
  }

  let base = prefix.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (!/^[a-z]/.test(base)) {
    base = `e${base}`;
  }

  base = base.slice(0, 12);

  if (!taken.has(base) && FREE_ID_PATTERN.test(base)) {
    return base;
  }

  for (let index = 2; ; index += 1) {
    const candidate = `${base}${index}`.slice(-16).replace(/^[0-9]+/, "e");

    if (!taken.has(candidate) && FREE_ID_PATTERN.test(candidate)) {
      return candidate;
    }
  }
}

function textStylesOf(node: FreeNode): (FreeSpanStyle | FreeTextStyle)[] {
  const styles: (FreeSpanStyle | FreeTextStyle)[] = [];

  if ("textStyle" in node && node.textStyle) {
    styles.push(node.textStyle);
  }

  if (node.type === "heading" || node.type === "text") {
    for (const line of node.lines ?? []) {
      for (const span of line ?? []) {
        if (span?.style) {
          styles.push(span.style);
        }
      }
    }
  }

  return styles;
}

/** Ids das fontes enviadas usadas (estilos dos elementos e das partes), ordenados e sem repeticao. */
export function uploadedFontIdsOfFree(design: Pick<PopupFreeDesign, "children">): string[] {
  const ids = new Set<string>();

  walkFreeNodes(design.children, (node) => {
    for (const style of textStylesOf(node)) {
      if (style.font?.kind === "uploaded" && typeof style.font.id === "string") {
        ids.add(style.font.id.toLowerCase());
      }
    }
  });

  return [...ids].sort();
}

/** Elementos cuja "altura" e altura minima (o texto empurra a caixa em vez de vazar). */
export function isTextBearing(type: FreeNodeType): boolean {
  return type === "heading" || type === "text" || type === "badge" || type === "button" || type === "links" || type === "box";
}

/** Largura padrao na sequencia por tipo (omitida na forma canonica). */
export function freeDefaultFlowWidth(type: FreeNodeType): "fill" | "hug" {
  return type === "badge" || type === "button" || type === "icon" ? "hug" : "fill";
}

/** v1: devolve o proprio design (o layout proprio do celular e do PR L3, em `devices.mobile`). */
export function resolveFreeForDevice(design: PopupFreeDesign, device: "desktop" | "mobile"): PopupFreeDesign {
  void device;

  return design;
}

/** "nodes.botao.action.href" (ou "freeDesign.nodes.botao...") -> "botao"; outras chaves -> null. */
export function freeNodeIdOfKey(key: string): FreeId | null {
  const match = /^(?:freeDesign\.)?nodes\.([^.]+)(?:\.|$)/.exec(key);

  return match && FREE_ID_PATTERN.test(match[1]) ? match[1] : null;
}

/* ------------------------------------------------------------------------------------------------
 * Forma canonica
 * ---------------------------------------------------------------------------------------------- */

function int(value: number) {
  return Math.round(value);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function lower(color: HexColor) {
  return color.toLowerCase();
}

/** Ordena as chaves (ordem alfabetica, como o resto do codigo) e tira as indefinidas. */
function sorted<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) {
      out[key] = value[key];
    }
  }

  return out as T;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalStops(stops: readonly FreeColorStop[]): FreeColorStop[] {
  return stops
    .map((stop, index) => ({ index, stop: { at: int(stop.at), color: lower(stop.color) } }))
    .sort((left, right) => left.stop.at - right.stop.at || left.index - right.index)
    .map(({ stop }) => stop);
}

function canonicalFocus(focus: readonly [number, number] | undefined): [number, number] | undefined {
  if (!focus) {
    return undefined;
  }

  const value: [number, number] = [int(focus[0]), int(focus[1])];

  return value[0] === 50 && value[1] === 50 ? undefined : value;
}

function canonicalPaint<T extends FreeFillPaint>(paint: T): T {
  switch (paint.kind) {
    case "solid":
      return { color: lower(paint.color), kind: "solid" } as T;
    case "linear": {
      const angle = paint.angle === undefined ? undefined : int(paint.angle);

      return sorted({ angle: angle === 180 ? undefined : angle, kind: "linear", stops: canonicalStops(paint.stops) }) as T;
    }
    case "radial":
      return sorted({
        extent: paint.extent === "farthest-corner" ? undefined : paint.extent,
        kind: "radial",
        shape: paint.shape === "ellipse" ? undefined : paint.shape,
        stops: canonicalStops(paint.stops),
        x: int(paint.x),
        y: int(paint.y)
      }) as T;
    case "image":
      return sorted({ asset: paint.asset, fit: paint.fit === "cover" ? undefined : paint.fit, focus: canonicalFocus(paint.focus), kind: "image" }) as T;
  }

  return paint;
}

function canonicalSides(sides: FreeSides): FreeSides {
  if (typeof sides === "number") {
    return int(sides);
  }

  if (sides.length === 2) {
    const [v, h] = [int(sides[0]), int(sides[1])];

    return v === h ? v : [v, h];
  }

  const [top, right, bottom, left] = sides.map(int) as [number, number, number, number];

  if (top === right && right === bottom && bottom === left) {
    return top;
  }

  if (top === bottom && right === left) {
    return [top, right];
  }

  return [top, right, bottom, left];
}

function sidesAreZero(sides: FreeSides) {
  return sides === 0;
}

function canonicalRadius(radius: number | [number, number, number, number]): number | [number, number, number, number] {
  if (typeof radius === "number") {
    return int(radius);
  }

  const values = radius.map(int) as [number, number, number, number];

  return values.every((value) => value === values[0]) ? values[0] : values;
}

function canonicalBorder(border: FreeBorder): FreeBorder {
  return sorted({ color: lower(border.color), style: border.style === "solid" ? undefined : border.style, width: int(border.width) });
}

function canonicalShadow(shadow: FreeShadow): FreeShadow {
  return sorted({
    blur: int(shadow.blur),
    color: lower(shadow.color),
    inset: shadow.inset ? true : undefined,
    spread: int(shadow.spread),
    x: int(shadow.x),
    y: int(shadow.y)
  });
}

function canonicalBox(box: FreeBox | undefined): FreeBox | undefined {
  if (!box) {
    return undefined;
  }

  const padding = box.padding === undefined ? undefined : canonicalSides(box.padding);
  const radius = box.radius === undefined ? undefined : canonicalRadius(box.radius);
  const value = sorted({
    backdropBlur: box.backdropBlur ? int(box.backdropBlur) || undefined : undefined,
    blur: box.blur ? int(box.blur) || undefined : undefined,
    border: box.border ? canonicalBorder(box.border) : undefined,
    clip: box.clip ? true : undefined,
    fade: box.fade ? { end: int(box.fade.end), side: box.fade.side, start: int(box.fade.start) } : undefined,
    fill: box.fill && box.fill.length > 0 ? box.fill.map(canonicalPaint) : undefined,
    opacity: box.opacity === undefined || int(box.opacity) === 100 ? undefined : int(box.opacity),
    padding: padding === undefined || sidesAreZero(padding) ? undefined : padding,
    radius: radius === undefined || radius === 0 ? undefined : radius,
    shadows: box.shadows && box.shadows.length > 0 ? box.shadows.map(canonicalShadow) : undefined
  } satisfies FreeBox);

  return Object.keys(value).length > 0 ? value : undefined;
}

function canonicalPlace(place: FreePlace | undefined, type: FreeNodeType): FreePlace | undefined {
  if (!place) {
    return undefined;
  }

  if (place.mode === "free") {
    return sorted({
      h: place.h === undefined ? undefined : int(place.h),
      mode: "free",
      rotate: place.rotate ? int(place.rotate) || undefined : undefined,
      w: int(place.w),
      x: int(place.x),
      y: int(place.y),
      z: place.z ? int(place.z) || undefined : undefined
    } satisfies FreeAbsolutePlace);
  }

  const margin = place.margin === undefined ? undefined : canonicalSides(place.margin);
  const width = typeof place.width === "number" ? int(place.width) : place.width;
  const value = sorted({
    align: place.align,
    height: place.height === undefined ? undefined : int(place.height),
    margin: margin === undefined || sidesAreZero(margin) ? undefined : margin,
    mode: "flow",
    width: width === undefined || width === freeDefaultFlowWidth(type) ? undefined : width,
    z: place.z ? int(place.z) || undefined : undefined
  } satisfies FreeFlowPlace);

  return Object.keys(value).length === 1 ? undefined : value;
}

function canonicalFont(font: PopupFontRef): PopupFontRef {
  return font.kind === "builtin" ? { key: font.key, kind: "builtin" } : { id: font.id.toLowerCase(), kind: "uploaded" };
}

function canonicalTextPaint(paint: FreeTextPaint): FreeTextPaint {
  return canonicalPaint(paint);
}

/** Estilo de texto do elemento sem o que e igual ao padrao do tipo. */
function canonicalTextStyle(style: FreeTextStyle | undefined, type: FreeNodeType): FreeTextStyle | undefined {
  if (!style) {
    return undefined;
  }

  const defaults = freeTextDefaultsOf(type);
  const font = style.font ? canonicalFont(style.font) : undefined;
  const paint = style.paint ? canonicalTextPaint(style.paint) : undefined;
  const letterSpacing = style.letterSpacing === undefined ? undefined : round2(style.letterSpacing);
  const lineHeight = style.lineHeight === undefined ? undefined : round2(style.lineHeight);
  const size = style.size === undefined ? undefined : int(style.size);
  const value = sorted({
    align: style.align === undefined || style.align === defaults.align ? undefined : style.align,
    decoration: style.decoration,
    font: font === undefined || same(font, defaults.font) ? undefined : font,
    italic: style.italic ? true : undefined,
    letterSpacing: letterSpacing === undefined || letterSpacing === defaults.letterSpacing ? undefined : letterSpacing,
    lineHeight: lineHeight === undefined || lineHeight === defaults.lineHeight ? undefined : lineHeight,
    paint: paint === undefined || same(paint, defaults.paint) ? undefined : paint,
    shadow: style.shadow ? sorted({ blur: int(style.shadow.blur), color: lower(style.shadow.color), x: int(style.shadow.x), y: int(style.shadow.y) }) : undefined,
    size: size === undefined || size === defaults.size ? undefined : size,
    uppercase: style.uppercase ? true : undefined,
    weight: style.weight === undefined || style.weight === defaults.weight ? undefined : style.weight
  } satisfies FreeTextStyle);

  return Object.keys(value).length > 0 ? value : undefined;
}

/** O estilo do elemento com os padroes do tipo (a base das partes). */
function resolvedElementStyle(style: FreeTextStyle | undefined, type: FreeNodeType) {
  const defaults = freeTextDefaultsOf(type);
  const own = style ?? {};

  return {
    decoration: own.decoration,
    font: own.font ? canonicalFont(own.font) : defaults.font,
    italic: own.italic === true,
    letterSpacing: own.letterSpacing === undefined ? defaults.letterSpacing : round2(own.letterSpacing),
    paint: own.paint ? canonicalTextPaint(own.paint) : defaults.paint,
    size: own.size === undefined ? defaults.size : int(own.size),
    uppercase: own.uppercase === true,
    weight: own.weight ?? defaults.weight
  };
}

/** Estilo da parte sem o que ja e igual ao estilo do elemento (a parte so guarda o que muda). */
function canonicalSpanStyle(style: FreeSpanStyle | undefined, base: ReturnType<typeof resolvedElementStyle>): FreeSpanStyle | undefined {
  if (!style) {
    return undefined;
  }

  const font = style.font ? canonicalFont(style.font) : undefined;
  const paint = style.paint ? canonicalTextPaint(style.paint) : undefined;
  const letterSpacing = style.letterSpacing === undefined ? undefined : round2(style.letterSpacing);
  const size = style.size === undefined ? undefined : int(style.size);
  const value = sorted({
    decoration: style.decoration === undefined || style.decoration === base.decoration ? undefined : style.decoration,
    font: font === undefined || same(font, base.font) ? undefined : font,
    italic: style.italic === undefined || style.italic === base.italic ? undefined : style.italic,
    letterSpacing: letterSpacing === undefined || letterSpacing === base.letterSpacing ? undefined : letterSpacing,
    paint: paint === undefined || same(paint, base.paint) ? undefined : paint,
    size: size === undefined || size === base.size ? undefined : size,
    uppercase: style.uppercase === undefined || style.uppercase === base.uppercase ? undefined : style.uppercase,
    weight: style.weight === undefined || style.weight === base.weight ? undefined : style.weight
  } satisfies FreeSpanStyle);

  return Object.keys(value).length > 0 ? value : undefined;
}

/** Partes da linha: estilo minimo e vizinhas com o mesmo estilo juntas (sem passar do limite de letras). */
function canonicalLine(line: FreeLine, base: ReturnType<typeof resolvedElementStyle>): FreeLine {
  const out: FreeSpan[] = [];

  for (const span of line) {
    const style = canonicalSpanStyle(span.style, base);
    const previous = out[out.length - 1];

    if (previous && same(previous.style, style) && previous.text.length + span.text.length <= FREE_DESIGN_LIMITS.spanText) {
      out[out.length - 1] = style ? { style, text: previous.text + span.text } : { text: previous.text + span.text };
      continue;
    }

    out.push(style ? { style, text: span.text } : { text: span.text });
  }

  return out;
}

function canonicalName(name: string | undefined): string | undefined {
  const trimmed = name?.trim();

  return trimmed ? trimmed : undefined;
}

function canonicalCommon(node: FreeNode) {
  return {
    box: canonicalBox(node.box),
    hidden: node.hidden ? true : undefined,
    id: node.id,
    locked: node.locked ? true : undefined,
    name: canonicalName(node.name),
    place: canonicalPlace(node.place, node.type)
  };
}

function canonicalNode(node: FreeNode): FreeNode {
  const common = canonicalCommon(node);

  switch (node.type) {
    case "heading":
    case "text": {
      const base = resolvedElementStyle(node.textStyle, node.type);

      return sorted({ ...common, lines: node.lines.map((line) => canonicalLine(line, base)), textStyle: canonicalTextStyle(node.textStyle, node.type), type: node.type }) as FreeNode;
    }
    case "badge":
      return sorted({ ...common, icon: node.icon, label: node.label.trim(), textStyle: canonicalTextStyle(node.textStyle, "badge"), type: "badge" } satisfies FreeBadgeNode);
    case "button": {
      const action: FreeButtonAction = node.action.kind === "link" ? { href: node.action.href.trim(), kind: "link", target: node.action.target } : { kind: node.action.kind };

      return sorted({
        ...common,
        action,
        icon: node.icon ? sorted({ name: node.icon.name, side: node.icon.side === "end" ? undefined : node.icon.side }) : undefined,
        label: node.action.kind === "cta" ? undefined : node.label?.trim(),
        textStyle: canonicalTextStyle(node.textStyle, "button"),
        type: "button"
      } satisfies FreeButtonNode);
    }
    case "image": {
      const alt = node.alt?.trim();

      return sorted({ ...common, alt: alt ? alt : undefined, asset: node.asset, fit: node.fit === "cover" ? undefined : node.fit, focus: canonicalFocus(node.focus), type: "image" } satisfies FreeImageNode);
    }
    case "video":
      return sorted({ ...common, asset: node.asset, fit: node.fit === "cover" ? undefined : node.fit, focus: canonicalFocus(node.focus), type: "video" } satisfies FreeVideoNode);
    case "icon": {
      const color = node.color === undefined ? undefined : lower(node.color);
      const stroke = node.stroke === undefined ? undefined : round2(node.stroke);
      const size = node.size === undefined ? undefined : int(node.size);

      return sorted({
        ...common,
        color: color === "#ffffff" ? undefined : color,
        icon: node.icon,
        size: size === 24 ? undefined : size,
        stroke: stroke === 2 ? undefined : stroke,
        type: "icon"
      } satisfies FreeIconNode);
    }
    case "divider": {
      const color = node.color === undefined ? undefined : lower(node.color);
      const thickness = node.thickness === undefined ? undefined : int(node.thickness);

      return sorted({
        ...common,
        color: color === "#ffffff1f" ? undefined : color,
        style: node.style === "solid" ? undefined : node.style,
        thickness: thickness === 1 ? undefined : thickness,
        type: "divider"
      } satisfies FreeDividerNode);
    }
    case "spacer": {
      const size = node.size === undefined ? undefined : int(node.size);

      return sorted({ ...common, size: size === 16 ? undefined : size, type: "spacer" } satisfies FreeSpacerNode);
    }
    case "shape":
      return sorted({ ...common, shape: node.shape === "rect" ? undefined : node.shape, type: "shape" } satisfies FreeShapeNode);
    case "audio":
      return sorted({ ...common, type: "audio" } satisfies FreeAudioNode);
    case "links": {
      const gap = node.gap === undefined ? undefined : int(node.gap);

      return sorted({
        ...common,
        dismiss: node.dismiss === false ? false : undefined,
        gap: gap === 8 ? undefined : gap,
        textStyle: canonicalTextStyle(node.textStyle, "links"),
        type: "links"
      } satisfies FreeLinksNode);
    }
    case "box": {
      const layout = node.layout
        ? sorted({
            align: node.layout.align === "stretch" ? undefined : node.layout.align,
            dir: node.layout.dir === "column" ? undefined : node.layout.dir,
            gap: node.layout.gap === undefined || int(node.layout.gap) === 0 ? undefined : int(node.layout.gap),
            justify: node.layout.justify === "start" ? undefined : node.layout.justify,
            wrap: node.layout.wrap ? true : undefined
          } satisfies FreeBoxLayout)
        : undefined;

      return sorted({
        ...common,
        children: node.children.map(canonicalNode),
        layout: layout && Object.keys(layout).length > 0 ? layout : undefined,
        type: "box"
      } satisfies FreeBoxNode);
    }
  }

  return node;
}

function canonicalArtboard(artboard: Partial<FreeArtboard> | undefined): Partial<FreeArtboard> | undefined {
  if (!artboard) {
    return undefined;
  }

  const defaults = FREE_ARTBOARD_DEFAULTS;
  const fill = artboard.fill && artboard.fill.length > 0 ? artboard.fill.map(canonicalPaint) : undefined;
  const padding = artboard.padding === undefined ? undefined : canonicalSides(artboard.padding);
  const pick = <T>(value: T | undefined, fallback: T) => (value === undefined || same(value, fallback) ? undefined : value);
  const value = sorted({
    align: pick(artboard.align, defaults.align),
    border: artboard.border ? canonicalBorder(artboard.border) : undefined,
    fill: pick(fill, defaults.fill),
    gap: pick(artboard.gap === undefined ? undefined : int(artboard.gap), defaults.gap),
    justify: pick(artboard.justify, defaults.justify),
    minHeight: pick(artboard.minHeight === undefined ? undefined : int(artboard.minHeight), defaults.minHeight),
    padding: pick(padding, defaults.padding),
    radius: pick(artboard.radius === undefined ? undefined : int(artboard.radius), defaults.radius),
    shadows: artboard.shadows && artboard.shadows.length > 0 ? artboard.shadows.map(canonicalShadow) : undefined,
    width: pick(artboard.width === undefined ? undefined : int(artboard.width), defaults.width)
  } satisfies Partial<FreeArtboard>);

  return Object.keys(value).length > 0 ? value : undefined;
}

function canonicalClose(close: Partial<FreeClose> | undefined): Partial<FreeClose> | undefined {
  if (!close) {
    return undefined;
  }

  const defaults = FREE_CLOSE_DEFAULTS;
  const background = close.background === undefined ? undefined : lower(close.background);
  const color = close.color === undefined ? undefined : lower(close.color);
  const inset = close.inset === undefined ? undefined : int(close.inset);
  const value = sorted({
    background: background === defaults.background ? undefined : background,
    border: close.border ? canonicalBorder(close.border) : undefined,
    color: color === defaults.color ? undefined : color,
    inset: inset === defaults.inset ? undefined : inset,
    side: close.side === defaults.side ? undefined : close.side,
    size: close.size === defaults.size ? undefined : close.size
  } satisfies Partial<FreeClose>);

  return Object.keys(value).length > 0 ? value : undefined;
}

/** Ids dos arquivos usados por elementos e pinturas (o poster de um video usado conta). */
export function usedFreeAssetIds(design: Pick<PopupFreeDesign, "artboard" | "children"> & { assets?: readonly FreeAsset[] }): Set<FreeId> {
  const used = new Set<FreeId>();
  const fromFill = (fill: readonly FreeFillPaint[] | undefined) => {
    for (const paint of fill ?? []) {
      if (paint.kind === "image") {
        used.add(paint.asset);
      }
    }
  };

  fromFill(design.artboard?.fill);
  walkFreeNodes(design.children, (node) => {
    fromFill(node.box?.fill);

    if ((node.type === "image" || node.type === "video") && node.asset) {
      used.add(node.asset);
    }
  });

  for (const asset of design.assets ?? []) {
    if (asset.kind === "video" && asset.poster && used.has(asset.id)) {
      used.add(asset.poster);
    }
  }

  return used;
}

function canonicalAsset(asset: FreeAsset): FreeAsset {
  return asset.kind === "image"
    ? { height: int(asset.height), id: asset.id, kind: "image", path: asset.path, width: int(asset.width) }
    : sorted({ id: asset.id, kind: "video", mimeType: asset.mimeType, path: asset.path, poster: asset.poster } satisfies FreeVideoAsset);
}

/**
 * Forma canonica (gravada, lida e comparada para "mudancas nao salvas"): sem o que e igual ao padrao, cores
 * minusculas, px e angulos inteiros, altura da linha/espaco entre letras/traco com 2 casas, paradas ordenadas,
 * lados no formato mais curto, nome aparado, partes vizinhas iguais juntas, arquivos sem uso fora, `assets` e
 * `fonts` sempre presentes (`fonts` recalculado) e chaves em ordem alfabetica.
 */
export function canonicalPopupFreeDesign(design: PopupFreeDesignInput): PopupFreeDesign {
  const children = design.children.map(canonicalNode);
  const artboard = canonicalArtboard(design.artboard);
  const used = usedFreeAssetIds({ artboard, assets: design.assets, children });
  const assets = (design.assets ?? []).filter((asset) => used.has(asset.id)).map(canonicalAsset);

  return sorted({
    artboard,
    assets,
    children,
    close: canonicalClose(design.close),
    fonts: uploadedFontIdsOfFree({ children }),
    mode: FREE_DESIGN_MODE,
    version: FREE_DESIGN_VERSION
  } satisfies PopupFreeDesign);
}

/* ------------------------------------------------------------------------------------------------
 * Tamanho: estimativa por cima do jsonb (o check do banco mede o jsonb antes da compressao)
 * ---------------------------------------------------------------------------------------------- */

const ENCODER = new TextEncoder();

/**
 * Estimativa por cima do `pg_column_size` do jsonb: 4 B de cabecalho; por item, 4 B + valor; numero 12 B;
 * texto = bytes UTF-8; verdadeiro/falso/nulo 0 B; objeto e lista 7 B de cabecalho; chave +4 B + bytes da chave.
 */
export function jsonbBytesUpperBound(value: unknown): number {
  const inner = (item: unknown): number => {
    if (item === null || item === undefined || typeof item === "boolean") return 0;
    if (typeof item === "number") return 12;
    if (typeof item === "string") return ENCODER.encode(item).length;
    if (Array.isArray(item)) return 7 + item.reduce((sum: number, entry) => sum + 4 + inner(entry), 0);
    return 7 + Object.entries(item as Record<string, unknown>).reduce((sum, [key, entry]) => sum + 8 + ENCODER.encode(key).length + inner(entry), 0);
  };

  return 4 + inner(value);
}

/* ------------------------------------------------------------------------------------------------
 * Reescala pela largura, o que vai ao aluno, o X visivel e o item de previa
 * ---------------------------------------------------------------------------------------------- */

const L = FREE_DESIGN_LIMITS;

function clamp(value: number, bounds: { max: number; min: number }) {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

/**
 * Troca a largura e multiplica por nova/antiga: X, Y, largura, altura, respiros, margens, espacos, cantos,
 * sombras, desfoques, fontes, icones, linha e espaco (inteiros, dentro dos limites). Borda fica em px.
 */
export function rescaleFreeDesign(design: PopupFreeDesign, width: number): PopupFreeDesign {
  const current = resolveFreeArtboard(design).width;
  const target = int(clamp(width, L.artboardWidth));
  const factor = target / current;
  const scale = (value: number, bounds: { max: number; min: number }) => int(clamp(value * factor, bounds));
  const scaleSides = (sides: FreeSides, bounds: { max: number; min: number }): FreeSides =>
    typeof sides === "number" ? scale(sides, bounds) : (sides.map((value) => scale(value, bounds)) as FreeSides);
  const scaleRadius = (radius: number | [number, number, number, number], bounds: { max: number; min: number }) => {
    const one = (value: number) => (value >= bounds.max ? bounds.max : scale(value, bounds));

    return typeof radius === "number" ? one(radius) : (radius.map(one) as [number, number, number, number]);
  };
  const scaleShadow = (shadow: FreeShadow): FreeShadow => ({
    ...shadow,
    blur: scale(shadow.blur, L.shadowBlur),
    spread: scale(shadow.spread, L.shadowSpread),
    x: scale(shadow.x, L.shadowOffset),
    y: scale(shadow.y, L.shadowOffset)
  });
  /** Estilo de texto escalado; `type` = o do elemento (o tamanho padrao do tipo tambem escala), sem = uma parte. */
  const scaleTextStyle = <T extends FreeSpanStyle | FreeTextStyle>(style: T | undefined, type?: FreeNodeType): T | undefined => {
    const size = style?.size ?? (type ? freeTextDefaultsOf(type).size : undefined);

    if (!style && size === undefined) {
      return style;
    }

    const next = { ...style } as T;

    if (size !== undefined) {
      next.size = scale(size, L.fontSize);
    }

    if (!style) {
      return next;
    }

    const shadow = (style as FreeTextStyle).shadow;

    if (shadow) {
      (next as FreeTextStyle).shadow = { ...shadow, blur: scale(shadow.blur, L.shadowBlur), x: scale(shadow.x, L.shadowOffset), y: scale(shadow.y, L.shadowOffset) };
    }

    return next;
  };
  const scaleBox = (box: FreeBox | undefined): FreeBox | undefined => {
    if (!box) {
      return box;
    }

    return {
      ...box,
      ...(box.backdropBlur !== undefined ? { backdropBlur: scale(box.backdropBlur, L.backdropBlur) } : {}),
      ...(box.blur !== undefined ? { blur: scale(box.blur, L.blur) } : {}),
      ...(box.padding !== undefined ? { padding: scaleSides(box.padding, L.padding) } : {}),
      ...(box.radius !== undefined ? { radius: scaleRadius(box.radius, L.radius) } : {}),
      ...(box.shadows ? { shadows: box.shadows.map(scaleShadow) } : {})
    };
  };
  const scalePlace = (place: FreePlace | undefined): FreePlace | undefined => {
    if (!place) {
      return place;
    }

    if (place.mode === "free") {
      return {
        ...place,
        ...(place.h !== undefined ? { h: scale(place.h, L.h) } : {}),
        w: scale(place.w, L.w),
        x: scale(place.x, L.x),
        y: scale(place.y, L.y)
      };
    }

    return {
      ...place,
      ...(place.height !== undefined ? { height: scale(place.height, L.flowHeight) } : {}),
      ...(place.margin !== undefined ? { margin: scaleSides(place.margin, L.margin) } : {}),
      ...(typeof place.width === "number" ? { width: scale(place.width, L.flowWidth) } : {})
    };
  };
  const scaleNode = (node: FreeNode): FreeNode => {
    const base = { ...node, box: scaleBox(node.box), place: scalePlace(node.place) } as FreeNode;

    switch (base.type) {
      case "heading":
      case "text":
        return {
          ...base,
          lines: base.lines.map((line) => line.map((span) => (span.style ? { ...span, style: scaleTextStyle(span.style) } : span))),
          textStyle: scaleTextStyle(base.textStyle, base.type)
        };
      case "badge":
      case "button":
        return { ...base, textStyle: scaleTextStyle(base.textStyle, base.type) };
      case "links":
        return { ...base, gap: scale(base.gap ?? 8, L.gap), textStyle: scaleTextStyle(base.textStyle, "links") };
      case "icon":
        return { ...base, size: scale(base.size ?? 24, L.iconSize) };
      case "divider":
        return { ...base, thickness: scale(base.thickness ?? 1, L.dividerThickness) };
      case "spacer":
        return { ...base, size: scale(base.size ?? 16, L.spacer) };
      case "box":
        return {
          ...base,
          children: base.children.map(scaleNode),
          ...(base.layout?.gap !== undefined ? { layout: { ...base.layout, gap: scale(base.layout.gap, L.gap) } } : {})
        };
      default:
        return base;
    }
  };

  const artboard = resolveFreeArtboard(design);
  const nextArtboard: Partial<FreeArtboard> = {
    ...design.artboard,
    gap: scale(artboard.gap, L.gap),
    minHeight: scale(artboard.minHeight, L.minHeight),
    padding: scaleSides(artboard.padding, L.padding),
    radius: scale(artboard.radius, L.artboardRadius),
    ...(artboard.shadows ? { shadows: artboard.shadows.map(scaleShadow) } : {}),
    width: target
  };

  return canonicalPopupFreeDesign({ ...design, artboard: nextArtboard, children: design.children.map(scaleNode) });
}

function withoutEditorKeys(node: FreeNode): FreeNode {
  const { locked, name, ...rest } = node;

  void locked;
  void name;

  return rest.type === "box" ? ({ ...rest, children: rest.children.map(withoutEditorKeys) } as FreeNode) : (rest as FreeNode);
}

/** O que vai ao aluno: sem `locked` e sem `name` (so do editor). */
export function freeDesignForStudent(design: PopupFreeDesign): PopupFreeDesign {
  return { ...design, children: design.children.map(withoutEditorKeys) };
}

function alphaOf(color: HexColor) {
  return color.length === 9 ? parseInt(color.slice(7, 9), 16) : 0xff;
}

/** A cor de base da prancheta: a camada de baixo (solida = a cor; degrade = a primeira parada; imagem = sem base). */
export function freeArtboardBaseColor(design: Pick<PopupFreeDesign, "artboard">): HexColor | null {
  const fill = resolveFreeArtboard(design).fill;
  const bottom = fill[fill.length - 1];

  if (!bottom) {
    return null;
  }

  if (bottom.kind === "solid") {
    return bottom.color;
  }

  if (bottom.kind === "linear" || bottom.kind === "radial") {
    return canonicalStops(bottom.stops)[0]?.color ?? null;
  }

  return null;
}

/**
 * O X que nao aparece bem: alfa do icone abaixo de cc, ou contraste icone x fundo do X (o fundo composto sobre a
 * cor de base da prancheta, que com alfa vai sobre preto) abaixo de 3:1. Imagem embaixo: vale so o alfa.
 */
export function freeCloseVisibilityProblem(design: Pick<PopupFreeDesign, "artboard" | "close">): "alpha" | "contrast" | null {
  const close = resolveFreeClose(design);

  if (alphaOf(close.color) < FREE_CLOSE_MIN_ALPHA) {
    return "alpha";
  }

  const base = freeArtboardBaseColor(design);

  if (base && contrastRatio(close.color, close.background, base) < FREE_CLOSE_MIN_CONTRAST) {
    return "contrast";
  }

  return null;
}

function previewCta(cta: NoticeDraft["cta"]): PopupCta | null {
  if (!cta || !cta.label.trim() || !cta.href.trim()) {
    return null;
  }

  return { href: cta.href.trim(), label: cta.label.trim(), target: cta.target };
}

/**
 * Item de previa (palco do editor, previa do aviso e relatorio): o design como esta (com `locked`, para a previa
 * nao selecionar travados), as fontes que ele usa, o titulo do primeiro titulo (ou o nome do pop-up) e o texto do
 * primeiro texto; imagem e icone nulos (como o aluno recebe).
 */
export function freePreviewPopupItem(input: {
  allowSnooze: boolean;
  audio: NoticeDraft["audio"];
  close?: "any" | "x_only";
  cta: NoticeDraft["cta"];
  design: PopupFreeDesign;
  fonts: readonly PopupFontFace[];
  id?: string;
  title: string;
}): PopupItem {
  const heading = freeFirstHeading(input.design);
  const text = freeFirstText(input.design);

  return {
    audio: input.audio ? { ...input.audio } : null,
    body: text ? freeHeadingText(text) : "",
    canSnooze: input.allowSnooze,
    ...(input.close === "x_only" ? { close: "x_only" as const } : {}),
    cta: previewCta(input.cta),
    fonts: input.fonts
      .filter((face) => input.design.fonts.includes(face.id))
      .map((face) => ({ family: face.family, format: face.format, id: face.id, style: face.style, url: face.url, weight: face.weight })),
    freeDesign: input.design,
    id: input.id ?? "previa",
    image: null,
    title: (heading ? freeHeadingText(heading) : "") || input.title.trim()
  };
}

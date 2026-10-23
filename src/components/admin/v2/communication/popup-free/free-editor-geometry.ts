// Editor Livre do pop-up (docs/27; spec §4.4): as contas da area de desenho, puras e testaveis. Mover e
// redimensionar elementos soltos (inclusive girados), guias de alinhamento (bordas e centro da prancheta e dos
// outros soltos), alinhar no pop-up pelo retangulo medido, escala do zoom e do celular nas contas do ponteiro e os
// numeros do "Soltar" e do "Seguir a sequencia". Tudo em px da prancheta (a largura escolhida, artboard.width).
//
// Modulo puro, imports relativos (tests/popup-livre-editor-modelo.test.mjs carrega direto pelo Node).

import { FREE_DESIGN_LIMITS, isTextBearing, type FreeAbsolutePlace, type FreeNodeType } from "../../../../../server/communications/popup-free-model";

export type FreeRect = { h: number; w: number; x: number; y: number };
export type FreeResizeHandle = "e" | "n" | "ne" | "nw" | "s" | "se" | "sw" | "w";
export type FreeAlignEdge = "bottom" | "center" | "left" | "middle" | "right" | "top";
/** Uma guia: linha vertical (`axis: "x"`, em X = `at`) ou horizontal (`axis: "y"`, em Y = `at`). */
export type FreeGuide = { at: number; axis: "x" | "y" };

/** Distancia (px de tela) que o ponteiro anda antes de o clique virar arrastar. */
export const FREE_DRAG_START_PX = 3;
/** Distancia (px de tela) em que as bordas e o centro grudam na guia. */
export const FREE_SNAP_SCREEN_PX = 6;
/** Menor largura e altura de um elemento solto. */
export const FREE_MIN_SIZE = FREE_DESIGN_LIMITS.w.min;
export const FREE_RESIZE_HANDLES: readonly FreeResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const L = FREE_DESIGN_LIMITS;

function clamp(value: number, bounds: { max: number; min: number }) {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

/* ------------------------------------------------------------------------------------------------
 * Escala: zoom x celular
 * ---------------------------------------------------------------------------------------------- */

/**
 * Quantos px de tela vale 1 px da prancheta: a largura medida da prancheta na tela (ja com o zoom e, no celular,
 * com os 343 px do cartao) dividida pela largura escolhida. Nunca zero.
 */
export function freeStageScale(measuredArtboardWidth: number, width: number): number {
  if (!Number.isFinite(measuredArtboardWidth) || measuredArtboardWidth <= 0 || width <= 0) {
    return 1;
  }

  return measuredArtboardWidth / width;
}

/** Um deslocamento do ponteiro (px de tela) em px da prancheta. */
export function freeScreenToArtboard(delta: { x: number; y: number }, scale: number): { x: number; y: number } {
  const safe = scale > 0 ? scale : 1;

  return { x: delta.x / safe, y: delta.y / safe };
}

/** O zoom "Ajustar a tela": o palco inteiro cabe no espaco visivel (com folga), nunca acima de 100 %. */
export function freeFitZoom(viewport: { h: number; w: number }, stage: { h: number; w: number }, margin = 48): number {
  if (stage.w <= 0 || stage.h <= 0) {
    return 1;
  }

  const fit = Math.min((viewport.w - margin) / stage.w, (viewport.h - margin) / stage.h, 1);

  return Math.max(0.25, Math.round(fit * 100) / 100);
}

/** A largura do palco do Computador: a prancheta com 16 px de cada lado, no minimo 600 px. */
export function freeDesktopStageWidth(width: number): number {
  return Math.max(width + 32, 600);
}

/** A moldura do Celular (o cartao fica com 343 px, como no aluno). */
export const FREE_PHONE_FRAME_PX = 375;

/* ------------------------------------------------------------------------------------------------
 * Mover e redimensionar
 * ---------------------------------------------------------------------------------------------- */

export function moveFreeRect(rect: FreeRect, dx: number, dy: number): FreeRect {
  return { ...rect, x: rect.x + dx, y: rect.y + dy };
}

function sidesOf(handle: FreeResizeHandle) {
  return { east: handle.includes("e"), north: handle.includes("n"), south: handle.includes("s"), west: handle.includes("w") };
}

/**
 * O retangulo depois de puxar uma alca (sem giro). O lado oposto fica parado. Com `keepRatio` (Shift), a
 * proporcao do comeco fica: nos cantos vale o maior dos dois movimentos; nas alcas do meio o outro lado acompanha.
 * Nada fica abaixo de `min` (4 px), sem passar do lado parado.
 */
export function resizeFreeRect(rect: FreeRect, handle: FreeResizeHandle, dx: number, dy: number, options: { keepRatio?: boolean; min?: number } = {}): FreeRect {
  const min = options.min ?? FREE_MIN_SIZE;
  const { east, north, south, west } = sidesOf(handle);
  let w = rect.w + (east ? dx : west ? -dx : 0);
  let h = rect.h + (south ? dy : north ? -dy : 0);

  if (options.keepRatio && rect.w > 0 && rect.h > 0) {
    const horizontal = east || west;
    const vertical = north || south;
    const wanted = horizontal && vertical ? Math.max(w / rect.w, h / rect.h) : horizontal ? w / rect.w : h / rect.h;
    // Nunca abaixo do minimo nos dois lados (nem do avesso, quando o ponteiro passa do lado parado).
    const factor = Math.max(wanted, min / rect.w, min / rect.h);

    w = rect.w * factor;
    h = rect.h * factor;
  } else {
    w = Math.max(min, w);
    h = Math.max(min, h);
  }

  const x = west ? rect.x + rect.w - w : rect.x;
  const y = north ? rect.y + rect.h - h : rect.y;

  return { h, w, x, y };
}

function rotateVector(x: number, y: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/**
 * Redimensionar um elemento girado: o movimento do ponteiro passa para os eixos do elemento, a conta e a mesma do
 * sem giro, e o centro anda girado, para o lado oposto ficar parado na tela. O retangulo devolvido e o sem giro
 * (x, y, w, h do design), como o design guarda.
 */
export function resizeRotatedFreeRect(
  rect: FreeRect,
  rotate: number,
  handle: FreeResizeHandle,
  dx: number,
  dy: number,
  options: { keepRatio?: boolean; min?: number } = {}
): FreeRect {
  if (!rotate) {
    return resizeFreeRect(rect, handle, dx, dy, options);
  }

  const local = rotateVector(dx, dy, -rotate);
  const next = resizeFreeRect(rect, handle, local.x, local.y, options);
  const shift = rotateVector(next.x + next.w / 2 - (rect.x + rect.w / 2), next.y + next.h / 2 - (rect.y + rect.h / 2), rotate);
  const cx = rect.x + rect.w / 2 + shift.x;
  const cy = rect.y + rect.h / 2 + shift.y;

  return { h: next.h, w: next.w, x: cx - next.w / 2, y: cy - next.h / 2 };
}

/* ------------------------------------------------------------------------------------------------
 * Guias de alinhamento
 * ---------------------------------------------------------------------------------------------- */

export type FreeSnapTargets = { xs: readonly number[]; ys: readonly number[] };

/** Bordas e centro da prancheta e dos outros soltos (os alvos das guias). */
export function freeSnapTargets(artboard: { h: number; w: number }, others: readonly FreeRect[]): FreeSnapTargets {
  const xs = [0, artboard.w / 2, artboard.w];
  const ys = [0, artboard.h / 2, artboard.h];

  for (const rect of others) {
    xs.push(rect.x, rect.x + rect.w / 2, rect.x + rect.w);
    ys.push(rect.y, rect.y + rect.h / 2, rect.y + rect.h);
  }

  return { xs, ys };
}

/** O alvo mais perto de algum dos valores, dentro do limite: a correcao a somar e onde a guia aparece. */
function nearest(values: readonly number[], targets: readonly number[], threshold: number): { at: number; delta: number } | null {
  let best: { at: number; delta: number } | null = null;

  for (const value of values) {
    for (const target of targets) {
      const delta = target - value;

      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { at: target, delta };
      }
    }
  }

  return best;
}

/**
 * Mover com guias: as bordas e o centro do retangulo grudam no alvo mais perto (limite em px da prancheta). Devolve
 * a correcao a somar ao deslocamento e as guias que aparecem. `disabled` (Alt segurado) devolve sem correcao.
 */
export function snapFreeMove(rect: FreeRect, targets: FreeSnapTargets, threshold: number, disabled = false): { dx: number; dy: number; guides: FreeGuide[] } {
  if (disabled) {
    return { dx: 0, dy: 0, guides: [] };
  }

  const x = nearest([rect.x, rect.x + rect.w / 2, rect.x + rect.w], targets.xs, threshold);
  const y = nearest([rect.y, rect.y + rect.h / 2, rect.y + rect.h], targets.ys, threshold);
  const guides: FreeGuide[] = [];

  if (x) {
    guides.push({ at: x.at, axis: "x" });
  }

  if (y) {
    guides.push({ at: y.at, axis: "y" });
  }

  return { dx: x?.delta ?? 0, dy: y?.delta ?? 0, guides };
}

/**
 * Redimensionar com guias: so as bordas que a alca mexe grudam (sem giro). Com `keepRatio`, nada gruda (a guia
 * quebraria a proporcao). Devolve o retangulo corrigido e as guias.
 */
export function snapFreeResize(
  rect: FreeRect,
  handle: FreeResizeHandle,
  targets: FreeSnapTargets,
  threshold: number,
  options: { disabled?: boolean; keepRatio?: boolean; min?: number } = {}
): { guides: FreeGuide[]; rect: FreeRect } {
  if (options.disabled || options.keepRatio) {
    return { guides: [], rect };
  }

  const min = options.min ?? FREE_MIN_SIZE;
  const { east, north, south, west } = sidesOf(handle);
  const guides: FreeGuide[] = [];
  let { h, w, x, y } = rect;

  if (east || west) {
    const edge = east ? x + w : x;
    const hit = nearest([edge], targets.xs, threshold);

    if (hit) {
      if (east && hit.at - x >= min) {
        w = hit.at - x;
        guides.push({ at: hit.at, axis: "x" });
      } else if (west && x + w - hit.at >= min) {
        w = x + w - hit.at;
        x = hit.at;
        guides.push({ at: hit.at, axis: "x" });
      }
    }
  }

  if (north || south) {
    const edge = south ? y + h : y;
    const hit = nearest([edge], targets.ys, threshold);

    if (hit) {
      if (south && hit.at - y >= min) {
        h = hit.at - y;
        guides.push({ at: hit.at, axis: "y" });
      } else if (north && y + h - hit.at >= min) {
        h = y + h - hit.at;
        y = hit.at;
        guides.push({ at: hit.at, axis: "y" });
      }
    }
  }

  return { guides, rect: { h, w, x, y } };
}

/* ------------------------------------------------------------------------------------------------
 * Alinhar no pop-up, numeros do design
 * ---------------------------------------------------------------------------------------------- */

/** Alinhar no pop-up (a prancheta inteira) pelo retangulo medido: devolve o X ou o Y novo. */
export function alignFreeRect(rect: FreeRect, edge: FreeAlignEdge, artboard: { h: number; w: number }): { x?: number; y?: number } {
  switch (edge) {
    case "left":
      return { x: 0 };
    case "center":
      return { x: (artboard.w - rect.w) / 2 };
    case "right":
      return { x: artboard.w - rect.w };
    case "top":
      return { y: 0 };
    case "middle":
      return { y: (artboard.h - rect.h) / 2 };
    case "bottom":
      return { y: artboard.h - rect.h };
  }
}

/** X, Y, largura e altura inteiros e dentro dos limites do design. */
export function freePlaceNumbers(input: Partial<FreeRect>): Partial<Pick<FreeAbsolutePlace, "h" | "w" | "x" | "y">> {
  const out: Partial<Pick<FreeAbsolutePlace, "h" | "w" | "x" | "y">> = {};

  if (input.x !== undefined) out.x = Math.round(clamp(input.x, L.x));
  if (input.y !== undefined) out.y = Math.round(clamp(input.y, L.y));
  if (input.w !== undefined) out.w = Math.round(clamp(input.w, L.w));
  if (input.h !== undefined) out.h = Math.round(clamp(input.h, L.h));

  return out;
}

/** Setas: 1 px (Shift: 10 px), dentro dos limites. */
export function nudgeFreePlace(place: FreeAbsolutePlace, dx: number, dy: number): FreeAbsolutePlace {
  const next = freePlaceNumbers({ x: place.x + dx, y: place.y + dy });

  return { ...place, x: next.x ?? place.x, y: next.y ?? place.y };
}

/**
 * "Soltar": a posicao solta a partir do retangulo medido (px da prancheta), sem mexer no que se ve. Elementos com
 * texto e caixas ficam com a altura automatica (o texto empurra); os outros guardam a altura medida.
 */
export function freePlaceFromRect(type: FreeNodeType, rect: FreeRect, z?: number): FreeAbsolutePlace {
  const numbers = freePlaceNumbers({ h: Math.max(rect.h, FREE_MIN_SIZE), w: Math.max(rect.w, FREE_MIN_SIZE), x: rect.x, y: rect.y });
  const place: FreeAbsolutePlace = { mode: "free", w: numbers.w ?? FREE_MIN_SIZE, x: numbers.x ?? 0, y: numbers.y ?? 0 };

  if (!isTextBearing(type)) {
    place.h = numbers.h;
  }

  if (z) {
    place.z = z;
  }

  return place;
}

/**
 * "Seguir a sequencia": a posicao na lista da prancheta, logo antes do primeiro elemento da sequencia cujo topo
 * esta abaixo do topo do solto (pela ordem dos retangulos). `flow` = os da sequencia, na ordem, com o indice de
 * cada um na lista da prancheta. Sem nenhum abaixo, no fim.
 */
export function freeSequenceIndexFor(top: number, flow: readonly { index: number; rect: FreeRect | undefined }[], total: number): number {
  for (const item of flow) {
    if (item.rect && item.rect.y >= top) {
      return item.index;
    }
  }

  return total;
}

/** O retangulo do solto no design (a altura medida quando ele nao tem altura fixa). */
export function freeRectOfPlace(place: FreeAbsolutePlace, measuredHeight?: number): FreeRect {
  return { h: place.h ?? measuredHeight ?? 0, w: place.w, x: place.x, y: place.y };
}

/* ------------------------------------------------------------------------------------------------
 * Arrastar e redimensionar com o ponteiro: o design so muda no fim (spec §4.4)
 * ---------------------------------------------------------------------------------------------- */

export type FreeDragMode = "move" | FreeResizeHandle;

export type FreeDragSession = {
  /** Os elementos sem altura fixa (com texto, midia na proporcao) so ganham altura quando a alca mexe nela. */
  hadHeight: boolean;
  id: string;
  /** O ultimo retangulo e as guias (null antes de passar dos 3 px). */
  last: { guides: FreeGuide[]; rect: FreeRect } | null;
  mode: FreeDragMode;
  /** Onde o ponteiro comecou (px de tela). */
  origin: { x: number; y: number };
  rect: FreeRect;
  rotate: number;
  scale: number;
  targets: FreeSnapTargets;
};

export function startFreeDrag(input: {
  hadHeight: boolean;
  id: string;
  mode: FreeDragMode;
  origin: { x: number; y: number };
  rect: FreeRect;
  rotate?: number;
  scale: number;
  targets: FreeSnapTargets;
}): FreeDragSession {
  return { ...input, last: null, rotate: input.rotate ?? 0 };
}

/** O ponteiro andou: o retangulo provisorio (com guias, menos com Alt ou elemento girado). */
export function updateFreeDrag(session: FreeDragSession, pointer: { x: number; y: number }, modifiers: { altKey?: boolean; shiftKey?: boolean } = {}): FreeDragSession {
  const screen = { x: pointer.x - session.origin.x, y: pointer.y - session.origin.y };

  if (!session.last && Math.hypot(screen.x, screen.y) < FREE_DRAG_START_PX) {
    return session;
  }

  const delta = freeScreenToArtboard(screen, session.scale);
  const threshold = FREE_SNAP_SCREEN_PX / (session.scale > 0 ? session.scale : 1);
  const noGuides = Boolean(modifiers.altKey) || Boolean(session.rotate);

  if (session.mode === "move") {
    const moved = moveFreeRect(session.rect, delta.x, delta.y);
    const snap = snapFreeMove(moved, session.targets, threshold, noGuides);

    return { ...session, last: { guides: snap.guides, rect: moveFreeRect(moved, snap.dx, snap.dy) } };
  }

  const keepRatio = Boolean(modifiers.shiftKey);
  const resized = resizeRotatedFreeRect(session.rect, session.rotate, session.mode, delta.x, delta.y, { keepRatio });
  const snap = noGuides ? { guides: [], rect: resized } : snapFreeResize(resized, session.mode, session.targets, threshold, { keepRatio });

  return { ...session, last: snap };
}

function commitsHeight(session: FreeDragSession) {
  return session.mode !== "move" && (session.hadHeight || session.mode.includes("n") || session.mode.includes("s"));
}

/** O deslocamento provisorio que o cartao desenha (dragPreview), sem mudar o design. */
export function freeDragPreview(session: FreeDragSession | null): { dh?: number; dw?: number; dx: number; dy: number; id: string } | null {
  if (!session?.last) {
    return null;
  }

  const { rect } = session.last;
  const preview: { dh?: number; dw?: number; dx: number; dy: number; id: string } = { dx: rect.x - session.rect.x, dy: rect.y - session.rect.y, id: session.id };

  if (session.mode !== "move") {
    preview.dw = rect.w - session.rect.w;

    if (commitsHeight(session)) {
      preview.dh = rect.h - session.rect.h;
    }
  }

  return preview;
}

/** Fim do arrastar: o que gravar no design (um passo so). Null = foi so um clique. */
export function finishFreeDrag(session: FreeDragSession | null): Partial<FreeRect> | null {
  if (!session?.last) {
    return null;
  }

  const { rect } = session.last;

  if (session.mode === "move") {
    return freePlaceNumbers({ x: rect.x, y: rect.y });
  }

  return freePlaceNumbers(commitsHeight(session) ? rect : { w: rect.w, x: rect.x, y: rect.y });
}

// Editor Livre do pop-up (docs/27; spec §4.4): as contas da area de desenho, puras e testaveis. Mover e
// redimensionar elementos soltos (inclusive girados), guias de alinhamento (bordas e centro da prancheta e dos
// outros soltos), alinhar no pop-up pelo retangulo medido, escala do zoom e do celular nas contas do ponteiro e os
// numeros do "Soltar" e do "Seguir a sequencia". Tudo em px da prancheta (a largura escolhida, artboard.width).
// O arrastar do L4a (docs/27 §13.9): o ponto da tela em px da prancheta, o lugar de soltar no desenho (a linha de
// onde entra, a caixa de destino e o motivo quando a caixa recusa) e o lugar de soltar nas Camadas, sempre pelos
// retangulos medidos, nunca pelo elemento sob o ponteiro.
// O L4b (docs/27 §13.10): a caixa que se ve de um girado (alinhar e distribuir por ela), a caixa de varios, alinhar
// numa moldura qualquer, os espacos iguais, o limite comum de um grupo que anda junto, o arrastar de varios (a caixa
// do grupo com guias e o deslocamento inteiro no fim), o zoom em passos (Ajustar a tela, 50, 75, 100, 150 e 200 %),
// a roda com Ctrl, o ponto que fica sob o ponteiro ao mudar o zoom, o ponteiro com a rolagem da area somada e o
// menor rolar que mostra o escolhido.
//
// Modulo puro, imports relativos (tests/popup-livre-editor-modelo.test.mjs carrega direto pelo Node).

import { FREE_DESIGN_LIMITS, isTextBearing, type FreeAbsolutePlace, type FreeId, type FreeNodeType } from "../../../../../server/communications/popup-free-model";

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

/** O -0 vira 0 (um deslocamento nulo nunca sai como -0). */
function tidy(value: number): number {
  return value === 0 ? 0 : value;
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

/**
 * A caixa que se ve de um retangulo girado (L4b): o retangulo em volta do giro, com o mesmo centro, W = w|cos| +
 * h|sin| e H = w|sin| + h|cos|. Sem giro (0, sem valor ou volta inteira) devolve o proprio retangulo; 90 e 270 graus
 * trocam a largura e a altura sem sobra de conta. Nao arredonda. Alinhar e distribuir usam esta caixa.
 */
export function freeVisualRect(rect: FreeRect, rotate?: number): FreeRect {
  const turn = rotate !== undefined && Number.isFinite(rotate) ? ((rotate % 360) + 360) % 360 : 0;

  if (turn === 0) {
    return rect;
  }

  const radians = (turn * Math.PI) / 180;
  const quarter = turn % 90 === 0;
  const cos = quarter ? (turn === 180 ? 1 : 0) : Math.abs(Math.cos(radians));
  const sin = quarter ? (turn === 180 ? 0 : 1) : Math.abs(Math.sin(radians));
  const w = rect.w * cos + rect.h * sin;
  const h = rect.w * sin + rect.h * cos;

  return { h, w, x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2 };
}

/** A caixa que envolve todos os retangulos (varios escolhidos). Lista vazia da null; um so da ele mesmo. */
export function freeBoundsOf(rects: readonly FreeRect[]): FreeRect | null {
  if (rects.length === 0) {
    return null;
  }

  if (rects.length === 1) {
    return rects[0];
  }

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.w);
    bottom = Math.max(bottom, rect.y + rect.h);
  }

  return { h: bottom - top, w: right - left, x: left, y: top };
}

/** O X ou o Y que o retangulo ganha ao alinhar a borda (ou o centro) na moldura. */
function alignTarget(rect: FreeRect, edge: FreeAlignEdge, frame: FreeRect): { x: number } | { y: number } {
  switch (edge) {
    case "left":
      return { x: frame.x };
    case "center":
      return { x: frame.x + (frame.w - rect.w) / 2 };
    case "right":
      return { x: frame.x + frame.w - rect.w };
    case "top":
      return { y: frame.y };
    case "middle":
      return { y: frame.y + (frame.h - rect.h) / 2 };
    case "bottom":
      return { y: frame.y + frame.h - rect.h };
  }
}

/**
 * Alinhar numa moldura qualquer (a prancheta, ou a caixa de varios no "Alinhar entre si"): quanto o retangulo anda.
 * left, center e right mexem so no X; top, middle e bottom so no Y; o outro eixo fica 0.
 */
export function freeAlignDelta(rect: FreeRect, edge: FreeAlignEdge, frame: FreeRect): { dx: number; dy: number } {
  const target = alignTarget(rect, edge, frame);

  return "x" in target ? { dx: tidy(target.x - rect.x), dy: 0 } : { dx: 0, dy: tidy(target.y - rect.y) };
}

/** Alinhar no pop-up (a prancheta inteira) pelo retangulo medido: devolve o X ou o Y novo. */
export function alignFreeRect(rect: FreeRect, edge: FreeAlignEdge, artboard: { h: number; w: number }): { x?: number; y?: number } {
  // A mesma conta do freeAlignDelta, com a moldura na origem: o X ou o Y sai igual ao de antes, sem sobra de conta.
  return alignTarget(rect, edge, { h: artboard.h, w: artboard.w, x: 0, y: 0 });
}

/**
 * Espacos iguais (L4b), com 3 ou mais: quanto cada um anda no eixo, na ordem recebida. A ordem da conta e pelo meio no
 * eixo (no empate, a recebida); o primeiro e o ultimo ficam parados; o espaco e (fim do ultimo - comeco do primeiro -
 * soma dos tamanhos) / (n - 1) e pode ser negativo (sobrepostos). Cada alvo e exato e acumulado, arredondado so no
 * fim: os espacos ficam com ate 1 px de diferenca. Com menos de 3, tudo 0.
 */
export function freeDistributeDeltas(rects: readonly FreeRect[], axis: "x" | "y"): number[] {
  const deltas = rects.map(() => 0);

  if (rects.length < 3) {
    return deltas;
  }

  const startOf = (rect: FreeRect) => (axis === "x" ? rect.x : rect.y);
  const sizeOf = (rect: FreeRect) => (axis === "x" ? rect.w : rect.h);
  const order = rects
    .map((rect, index) => ({ index, middle: startOf(rect) + sizeOf(rect) / 2 }))
    .sort((a, b) => a.middle - b.middle || a.index - b.index)
    .map((item) => item.index);
  const first = rects[order[0]];
  const last = rects[order[order.length - 1]];
  const total = order.reduce((sum, index) => sum + sizeOf(rects[index]), 0);
  const gap = (startOf(last) + sizeOf(last) - startOf(first) - total) / (order.length - 1);
  let cursor = startOf(first);

  order.forEach((index, position) => {
    const rect = rects[index];

    if (position > 0 && position < order.length - 1) {
      deltas[index] = tidy(Math.round(cursor - startOf(rect)));
    }

    cursor += sizeOf(rect) + gap;
  });

  return deltas;
}

/** O deslocamento inteiro de um eixo dentro do limite comum (lo = maior folga para tras, hi = menor para a frente). */
function groupAlong(values: readonly number[], delta: number, bounds: { max: number; min: number }): number {
  const lo = Math.max(...values.map((value) => bounds.min - value));
  const hi = Math.min(...values.map((value) => bounds.max - value));
  const wanted = Math.round(delta);

  if (!Number.isFinite(wanted) || lo > hi) {
    return 0;
  }

  return tidy(Math.min(hi, Math.max(lo, wanted)));
}

/**
 * Mover varios juntos (L4b): o deslocamento inteiro que o grupo inteiro aguenta, pelo limite comum de X (-720 a
 * 1.440) e de Y (-400 a 2.400). Quem chega antes na borda segura os outros: o grupo nunca se deforma (nudgeFreePlace
 * limita um por um). Lista vazia da { dx: 0, dy: 0 }.
 */
export function freeGroupDelta(places: readonly { x: number; y: number }[], dx: number, dy: number): { dx: number; dy: number } {
  if (places.length === 0) {
    return { dx: 0, dy: 0 };
  }

  return { dx: groupAlong(places.map((place) => place.x), dx, L.x), dy: groupAlong(places.map((place) => place.y), dy, L.y) };
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
  /**
   * Mover varios (L4b): os soltos que andam juntos, 2 ou mais (o `id` apertado e um deles). Com eles o modo e sempre
   * "move" e `rect` e a caixa do grupo (as guias valem para ela). Sem, o arrastar e de um elemento so.
   */
  ids?: readonly FreeId[];
  /** O ultimo retangulo e as guias (null antes de passar dos 3 px). */
  last: { guides: FreeGuide[]; rect: FreeRect } | null;
  mode: FreeDragMode;
  /** Onde o ponteiro comecou (px de tela). */
  origin: { x: number; y: number };
  rect: FreeRect;
  rotate: number;
  scale: number;
  /** false: sem guias (algum membro do grupo girado), como com o Alt. Sem valor, as guias valem. */
  snap?: boolean;
  targets: FreeSnapTargets;
};

/** O deslocamento provisorio que o cartao desenha; `ids` so no arrastar de varios. */
type FreeDragPreviewOf = { dh?: number; dw?: number; dx: number; dy: number; id: string; ids?: readonly FreeId[] };

export function startFreeDrag(input: {
  hadHeight: boolean;
  id: string;
  ids?: readonly FreeId[];
  mode: FreeDragMode;
  origin: { x: number; y: number };
  rect: FreeRect;
  rotate?: number;
  scale: number;
  snap?: boolean;
  targets: FreeSnapTargets;
}): FreeDragSession {
  const { ids, snap, ...single } = input;
  const session: FreeDragSession = { ...single, last: null, rotate: input.rotate ?? 0 };

  // Um id so (ou nenhum) e o arrastar de hoje: a sessao fica igual, sem `ids`.
  if (ids && ids.length >= 2) {
    session.ids = ids;
    session.mode = "move";
  }

  if (snap === false) {
    session.snap = false;
  }

  return session;
}

/** O ponteiro andou: o retangulo provisorio (com guias, menos com Alt, elemento girado ou grupo com girado). */
export function updateFreeDrag(session: FreeDragSession, pointer: { x: number; y: number }, modifiers: { altKey?: boolean; shiftKey?: boolean } = {}): FreeDragSession {
  const screen = { x: pointer.x - session.origin.x, y: pointer.y - session.origin.y };

  if (!session.last && Math.hypot(screen.x, screen.y) < FREE_DRAG_START_PX) {
    return session;
  }

  const delta = freeScreenToArtboard(screen, session.scale);
  const threshold = FREE_SNAP_SCREEN_PX / (session.scale > 0 ? session.scale : 1);
  const noGuides = Boolean(modifiers.altKey) || Boolean(session.rotate) || session.snap === false;

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

/** O deslocamento provisorio que o cartao desenha (dragPreview), sem mudar o design. Com varios, leva os `ids`. */
export function freeDragPreview(session: FreeDragSession | null): FreeDragPreviewOf | null {
  if (!session?.last) {
    return null;
  }

  const { rect } = session.last;
  const preview: FreeDragPreviewOf = { dx: rect.x - session.rect.x, dy: rect.y - session.rect.y, id: session.id };

  if (session.ids) {
    preview.ids = session.ids;
  }

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

/**
 * Fim do arrastar de varios (L4b): quanto o grupo andou, inteiro (o limite comum fica com freeGroupDelta, no
 * gravar). Null = foi so um clique (antes dos 3 px).
 */
export function finishFreeDragDelta(session: FreeDragSession | null): { dx: number; dy: number } | null {
  if (!session?.last) {
    return null;
  }

  const { rect } = session.last;

  return { dx: tidy(Math.round(rect.x - session.rect.x)), dy: tidy(Math.round(rect.y - session.rect.y)) };
}

/* ------------------------------------------------------------------------------------------------
 * Zoom em passos e rolagem da area de desenho (L4b)
 * ---------------------------------------------------------------------------------------------- */

/** Os passos do zoom, em %, alem do "Ajustar a tela" ('fit', o zoom ao abrir). */
export const FREE_ZOOM_STEPS = [50, 75, 100, 150, 200] as const;
export type FreeZoomStep = (typeof FREE_ZOOM_STEPS)[number];
export type FreeZoom = "fit" | FreeZoomStep;
/** Quanto a roda (com Ctrl ou ⌘) precisa somar, em px, para um passo de zoom. */
export const FREE_ZOOM_WHEEL_PX = 50;

/**
 * A escala do palco: 'fit' devolve a do "Ajustar a tela" (freeFitZoom); um passo devolve passo / 100. O '100' em
 * texto (o valor da barra de antes do L4b) vale 100 %.
 */
export function freeZoomScale(zoom: FreeZoom | "100", fit: number): number {
  if (zoom === "fit") {
    return Number.isFinite(fit) && fit > 0 ? fit : 1;
  }

  return Number(zoom) / 100;
}

/**
 * O passo seguinte a partir da escala mostrada: o estritamente acima (+) ou abaixo (-) dela, com 0,5 % de folga (de
 * 62 %, + da 75 e - da 50). Nas pontas, null (o botao desliga com o motivo).
 */
export function freeZoomNext(scale: number, direction: 1 | -1): FreeZoomStep | null {
  const percent = scale * 100;

  if (!Number.isFinite(percent)) {
    return null;
  }

  if (direction > 0) {
    return FREE_ZOOM_STEPS.find((step) => step > percent + 0.5) ?? null;
  }

  return [...FREE_ZOOM_STEPS].reverse().find((step) => step < percent - 0.5) ?? null;
}

/**
 * A roda com Ctrl (ou ⌘): soma o movimento em px (linhas valem 16 px; paginas, a altura da pagina) e da um passo a
 * cada 50 px, no maximo um por movimento. O resto fica para o proximo, ate um passo (uma pagina inteira nao deixa
 * passos guardados). Virar de sentido zera o somado. Para cima (deltaY negativo) aproxima: direction 1.
 */
export function freeZoomWheel(acc: number, wheel: { deltaMode: number; deltaY: number }, pageHeight: number): { acc: number; direction: -1 | 0 | 1 } {
  const page = Number.isFinite(pageHeight) && pageHeight > 0 ? pageHeight : FREE_ZOOM_WHEEL_PX;
  const delta = wheel.deltaY * (wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? page : 1);
  const before = Number.isFinite(acc) ? acc : 0;

  if (!Number.isFinite(delta) || delta === 0) {
    return { acc: before, direction: 0 };
  }

  const total = before !== 0 && Math.sign(before) !== Math.sign(delta) ? delta : before + delta;

  if (Math.abs(total) < FREE_ZOOM_WHEEL_PX) {
    return { acc: total, direction: 0 };
  }

  const rest = Math.min(Math.abs(total) - FREE_ZOOM_WHEEL_PX, FREE_ZOOM_WHEEL_PX);

  return { acc: tidy(Math.sign(total) * rest), direction: total < 0 ? 1 : -1 };
}

/**
 * O ponteiro como se a area nao tivesse rolado desde o comeco do gesto: client + (rolagem agora - rolagem do
 * comeco). O arrastar soma isso para o elemento acompanhar a area que rola.
 */
export function freeScrolledPointer(client: FreePoint, scrollStart: FreePoint, scrollNow: FreePoint): FreePoint {
  return { x: client.x + (scrollNow.x - scrollStart.x), y: client.y + (scrollNow.y - scrollStart.y) };
}

/**
 * Quanto somar ao scrollLeft e ao scrollTop depois de mudar o zoom para o mesmo ponto do palco ficar sob o ponteiro
 * (a roda) ou sob o meio da vista (botoes e teclas). `origin` e onde o palco comeca na tela antes e depois da escala
 * nova (antes de rolar); u = (client - origem de antes) / escala de antes, e o ponto volta a client.
 */
export function freeZoomAnchorScroll(client: FreePoint, before: { origin: FreePoint; scale: number }, after: { origin: FreePoint; scale: number }): FreePoint {
  const safe = (scale: number) => (Number.isFinite(scale) && scale > 0 ? scale : 1);
  const u = { x: (client.x - before.origin.x) / safe(before.scale), y: (client.y - before.origin.y) / safe(before.scale) };

  return { x: tidy(after.origin.x + u.x * safe(after.scale) - client.x), y: tidy(after.origin.y + u.y * safe(after.scale) - client.y) };
}

type FreeScreenBox = { bottom: number; left: number; right: number; top: number };

/** Um eixo do freeRevealScroll: o menor rolar que deixa o alvo inteiro na vista, com a folga que couber. */
function revealAlong(viewStart: number, viewEnd: number, start: number, end: number, margin: number): number {
  const room = viewEnd - viewStart;

  // Maior que a vista: alinha pelo comeco, com a folga.
  if (end - start > room) {
    return tidy(start - margin - viewStart);
  }

  // A folga que cabe: menor quando o alvo quase enche a vista.
  const fit = Math.max(0, Math.min(margin, (room - (end - start)) / 2));
  const visible = fit < margin ? start >= viewStart && end <= viewEnd : start - fit >= viewStart && end + fit <= viewEnd;

  if (visible) {
    return 0;
  }

  return tidy(start - fit < viewStart ? start - fit - viewStart : end + fit - viewEnd);
}

/**
 * Mostrar o escolhido (Camadas, Revisar, setas): o menor rolar da area de desenho que deixa o alvo inteiro na vista,
 * com a folga (24 px). Alvo maior que a vista alinha pelo comeco; ja visivel da 0. Conta da propria area (px de tela,
 * como getBoundingClientRect), sem scrollIntoView, que rolaria quem esta fora dela.
 */
export function freeRevealScroll(view: FreeScreenBox, target: FreeScreenBox, margin = 24): { dx: number; dy: number } {
  return { dx: revealAlong(view.left, view.right, target.left, target.right, margin), dy: revealAlong(view.top, view.bottom, target.top, target.bottom, margin) };
}

/* ------------------------------------------------------------------------------------------------
 * Arrastar do L4a (docs/27 §13.9): lugar de soltar no desenho e nas Camadas
 * ---------------------------------------------------------------------------------------------- */

/** Distancia (px de tela) antes de um arrastar de elemento da sequencia comecar no desenho. */
export const FREE_FLOW_DRAG_START_PX = 6;
/** Distancia (px de tela) antes de um arrastar comecar nas Camadas, no Fundo e no painel Elementos. */
export const FREE_LIST_DRAG_START_PX = 4;
/** Faixa da borda de uma caixa da sequencia (px de tela): ali o elemento entra antes ou depois da caixa. */
export const FREE_DROP_EDGE_SCREEN_PX = 8;
/** Lado minimo (px de tela) da zona de soltar de uma caixa: uma caixa vazia nasce sem altura. */
export const FREE_DROP_EMPTY_SCREEN_PX = 24;

export type FreePoint = { x: number; y: number };
/** O lugar de um elemento: o vao `index` na lista do pai como ela esta agora (contando o proprio elemento). */
export type FreeMoveTarget = { index: number; parentId: FreeId | null };
export type FreeFlowItem = { id: FreeId; index: number; rect: FreeRect };
/** Um filho da prancheta desenhado (da sequencia ou solto, quem se move tambem), com a camada e a posicao em children. */
export type FreeFlowLayer = { id: FreeId; index: number; rect: FreeRect; z: number };
/**
 * Um lugar que recebe elementos da sequencia no desenho: a prancheta (`id` null) ou uma caixa desenhada. `index` e a
 * posicao no pai (-1 na prancheta); `flow` diz se a caixa segue a sequencia (false na prancheta e numa caixa solta);
 * `accepts` null = aceita, texto = o motivo de recusa; `items` sao os filhos desenhados da sequencia, com o indice
 * real em `children`; `length` e children.length. `home` e a posicao de hoje do elemento arrastado quando este e o
 * pai dele (soltar no mesmo vao nao muda nada); sem, null. `layers`, so na prancheta: os filhos desenhados dela, para
 * saber quem esta por cima no ponto (sem, valem os itens com z 0).
 */
export type FreeFlowContainer = {
  accepts: string | null;
  depth: number;
  dir: "column" | "row";
  flow: boolean;
  home?: number | null;
  id: FreeId | null;
  index: number;
  items: FreeFlowItem[];
  layers?: FreeFlowLayer[];
  length: number;
  parentId: FreeId | null;
  rect: FreeRect;
  wrap: boolean;
  z: number;
};
/** Onde o elemento entra no desenho: o pai e o vao, a linha de onde entra, a caixa de destino e o motivo de recusa. */
export type FreeFlowDrop = { blocked: { id: FreeId; reason: string } | null; box: FreeRect | null; index: number; line: FreeRect; parentId: FreeId | null };
/** Uma linha das Camadas, medida pela div da linha (px de tela, na ordem do DOM). */
export type FreeLayerLine = { box: boolean; height: number; id: FreeId; top: number };
export type FreeLayerOver = { edge: "after" | "before" | "inside"; id: FreeId } | { end: true };
/** Como o desenho mostra um elemento novo arrastado do painel: solto (o retangulo pelo centro) ou na sequencia. */
export type FreeCanvasDropSpec = { free: false; height: 0 | 1 } | { free: true; rectAt: (center: FreePoint) => FreeRect };
export type FreeCanvasDrop = { center: FreePoint; kind: "free" } | ({ kind: "flow" } & FreeMoveTarget);

/**
 * Um ponto da tela em px da prancheta: (client - origem) / escala. A origem e o canto de dentro da borda da prancheta
 * na tela; a escala, px de tela por px da prancheta (zoom e, no celular, os 343 px do cartao). Escala <= 0 vale 1.
 */
export function freeArtboardPoint(client: FreePoint, origin: FreePoint, scale: number): FreePoint {
  const safe = Number.isFinite(scale) && scale > 0 ? scale : 1;

  return { x: (client.x - origin.x) / safe, y: (client.y - origin.y) / safe };
}

function containsPoint(rect: FreeRect, point: FreePoint) {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

/** O lado menor que `min` cresce ate `min`, centrado. */
function grown(rect: FreeRect, min: number): FreeRect {
  const w = Math.max(rect.w, min);
  const h = Math.max(rect.h, min);

  return { h, w, x: rect.x - (w - rect.w) / 2, y: rect.y - (h - rect.h) / 2 };
}

function hitRectOf(container: FreeFlowContainer, empty: number): FreeRect {
  return container.id === null ? container.rect : grown(container.rect, empty);
}

/** As linhas visuais de uma caixa em linha com quebra: abre linha nova quando o topo do item fica no fundo da anterior ou abaixo. */
function visualLines(items: readonly FreeFlowItem[]): FreeFlowItem[][] {
  const lines: FreeFlowItem[][] = [];
  let bottom = -Infinity;

  for (const item of items) {
    if (lines.length === 0 || item.rect.y >= bottom) {
      lines.push([item]);
      bottom = item.rect.y + item.rect.h;
    } else {
      lines[lines.length - 1].push(item);
      bottom = Math.max(bottom, item.rect.y + item.rect.h);
    }
  }

  return lines;
}

function spanOf(items: readonly FreeFlowItem[], axis: "x" | "y"): { end: number; start: number } {
  const start = Math.min(...items.map((item) => (axis === "x" ? item.rect.x : item.rect.y)));
  const end = Math.max(...items.map((item) => (axis === "x" ? item.rect.x + item.rect.w : item.rect.y + item.rect.h)));

  return { end, start };
}

/** O indice pelo meio dos itens no eixo: o primeiro cujo meio passa do ponto; nenhum, depois do ultimo. */
function indexAlong(items: readonly FreeFlowItem[], axis: "x" | "y", at: number): number {
  for (const item of items) {
    const middle = axis === "x" ? item.rect.x + item.rect.w / 2 : item.rect.y + item.rect.h / 2;

    if (middle > at) {
      return item.index;
    }
  }

  return items[items.length - 1].index + 1;
}

/** A linha de onde entra (px da prancheta): h 0 na coluna, w 0 na linha; sem itens, no meio do contêiner. */
function gapLine(container: FreeFlowContainer, index: number, group: readonly FreeFlowItem[]): FreeRect {
  const prev = [...group].reverse().find((item) => item.index < index);
  const next = group.find((item) => item.index >= index);

  if (!prev && !next) {
    return { h: 0, w: container.rect.w, x: container.rect.x, y: container.rect.y + container.rect.h / 2 };
  }

  if (container.dir === "row") {
    const span = spanOf(group, "y");
    const x = prev && next ? (prev.rect.x + prev.rect.w + next.rect.x) / 2 : next ? next.rect.x : (prev as FreeFlowItem).rect.x + (prev as FreeFlowItem).rect.w;

    return { h: span.end - span.start, w: 0, x, y: span.start };
  }

  const span = spanOf(group, "x");
  const y = prev && next ? (prev.rect.y + prev.rect.h + next.rect.y) / 2 : next ? next.rect.y : (prev as FreeFlowItem).rect.y + (prev as FreeFlowItem).rect.h;

  return { h: 0, w: span.end - span.start, x: span.start, y };
}

/**
 * Soltar no mesmo vao (entre o item de antes e o de depois do arrastado, com so soltos, escondidos ou elementos sem
 * retangulo no meio) e o lugar de hoje: o indice vira `home` e nada muda.
 */
function sameGap(container: FreeFlowContainer, index: number): number {
  const home = container.home;

  if (home === null || home === undefined) {
    return index;
  }

  const prev = [...container.items].reverse().find((item) => item.index < home);
  const next = container.items.find((item) => item.index > home);
  const low = prev ? prev.index + 1 : 0;
  const high = next ? next.index : container.length;

  return index >= low && index <= high ? home : index;
}

/** A caixa de nivel 1 (filha da prancheta) de onde o contêiner vem, subindo por parentId. */
function rootOf(container: FreeFlowContainer, byId: ReadonlyMap<FreeId | null, FreeFlowContainer>): FreeFlowContainer {
  let current = container;

  for (let step = 0; current.parentId !== null && step < byId.size; step += 1) {
    const parent = byId.get(current.parentId);

    if (!parent) {
      break;
    }

    current = parent;
  }

  return current;
}

/**
 * O contêiner acertado pela ordem de pintura. Entre os filhos da prancheta sob o ponto, vence quem esta por cima: o
 * de maior z e, no empate, o ultimo no DOM (o zIndex so sai com z diferente de 0, e a prancheta isola as camadas).
 * Um filho que nao recebe (um item da sequencia, um solto que nao e caixa, quem se move ou um solto girado) tapa o
 * que esta embaixo, e o acerto fica na prancheta: um Titulo por cima de uma caixa solta de fundo (z -1) nao a deixa
 * receber. So dentro da caixa vencedora vale o mais fundo (empate: maior z, depois o ultimo na lista). Cada caixa
 * conta com o retangulo crescido ate `empty`.
 */
function paintedHit(point: FreePoint, containers: readonly FreeFlowContainer[], artboard: FreeFlowContainer, byId: ReadonlyMap<FreeId | null, FreeFlowContainer>, empty: number): FreeFlowContainer {
  const subtrees = new Map<FreeFlowContainer, FreeFlowContainer[]>();

  for (const container of containers) {
    if (container !== artboard && containsPoint(hitRectOf(container, empty), point)) {
      const root = rootOf(container, byId);

      subtrees.set(root, [...(subtrees.get(root) ?? []), container]);
    }
  }

  if (subtrees.size === 0) {
    return artboard;
  }

  type Candidate = { index: number; root: FreeFlowContainer | null; z: number };
  const layers = artboard.layers ?? artboard.items.map((item) => ({ ...item, z: 0 }));
  const candidates: Candidate[] = [
    ...layers.filter((layer) => !byId.has(layer.id) && containsPoint(layer.rect, point)).map((layer) => ({ index: layer.index, root: null, z: layer.z })),
    ...[...subtrees.keys()].map((root) => ({ index: root.index, root, z: root.z }))
  ];
  const top = candidates.reduce<Candidate | null>((best, candidate) => (!best || candidate.z > best.z || (candidate.z === best.z && candidate.index >= best.index) ? candidate : best), null);
  const inside = top?.root ? subtrees.get(top.root) : undefined;

  if (!inside) {
    return artboard;
  }

  return inside.reduce((hit, container) => (container.depth > hit.depth || (container.depth === hit.depth && container.z >= hit.z) ? container : hit), inside[0]);
}

/**
 * O lugar de soltar no desenho (px da prancheta; `edge` e `empty` ja divididos pela escala). Acerta pela ordem de
 * pintura (paintedHit): entre os filhos da prancheta, o que esta por cima no ponto; dentro da caixa vencedora, o
 * contêiner mais fundo; cada caixa crescida ate `empty`. Se ele recusa, sobe ate um que aceite e guarda o primeiro
 * motivo (`blocked`). Numa caixa da sequencia, a faixa da borda (min(edge, 1/4 do lado), no eixo do pai) poe antes ou
 * depois da caixa. O indice sai do meio dos itens no eixo da caixa (na linha com quebra, pela linha visual do ponto).
 * O indice e o real de children, e o mesmo vao do arrastado vale o lugar de hoje. Fora da prancheta, null. Nao olha o
 * aparelho nem o travado.
 */
export function freeFlowDropAt(point: FreePoint, containers: readonly FreeFlowContainer[], options: { edge: number; empty: number }): FreeFlowDrop | null {
  const artboard = containers.find((container) => container.id === null);

  if (!artboard || !containsPoint(artboard.rect, point)) {
    return null;
  }

  const byId = new Map<FreeId | null, FreeFlowContainer>(containers.map((container) => [container.id, container]));
  const hit = paintedHit(point, containers, artboard, byId, options.empty);
  let target = hit;
  let blocked: FreeFlowDrop["blocked"] = null;

  while (target.accepts !== null && target.id !== null) {
    blocked ??= { id: target.id, reason: target.accepts };
    target = byId.get(target.parentId) ?? artboard;
  }

  const finish = (container: FreeFlowContainer, index: number, group: readonly FreeFlowItem[]): FreeFlowDrop => ({
    blocked,
    box: container.id === null ? null : container.rect,
    index: sameGap(container, index),
    line: gapLine(container, index, group),
    parentId: container.id
  });

  // Faixa da borda: antes ou depois da propria caixa, no pai (que precisa aceitar).
  if (target === hit && hit.id !== null && hit.flow) {
    const parent = byId.get(hit.parentId);

    if (parent && parent.accepts === null) {
      const rect = hitRectOf(hit, options.empty);
      const horizontal = parent.dir === "row";
      const start = horizontal ? rect.x : rect.y;
      const size = horizontal ? rect.w : rect.h;
      const at = horizontal ? point.x : point.y;
      const band = Math.min(options.edge, size / 4);
      const index = at < start + band ? hit.index : at > start + size - band ? hit.index + 1 : null;

      if (index !== null) {
        const lines = parent.dir === "row" && parent.wrap ? visualLines(parent.items) : [parent.items];
        const group = lines.find((line) => line.some((item) => item.id === hit.id)) ?? parent.items;

        return finish(parent, index, group);
      }
    }
  }

  if (target.items.length === 0) {
    return finish(target, target.length, []);
  }

  if (target.dir === "row" && target.wrap) {
    const lines = visualLines(target.items);
    const distance = (line: readonly FreeFlowItem[]) => {
      const span = spanOf(line, "y");

      return point.y < span.start ? span.start - point.y : point.y > span.end ? point.y - span.end : 0;
    };
    const line = lines.reduce((best, candidate) => (distance(candidate) < distance(best) ? candidate : best), lines[0]);

    return finish(target, indexAlong(line, "x", point.x), line);
  }

  const index = indexAlong(target.items, target.dir === "row" ? "x" : "y", target.dir === "row" ? point.x : point.y);

  return finish(target, index, target.items);
}

/** As zonas de soltar das caixas vazias que aceitam (o tracejado do desenho), ja crescidas ate `empty`. */
export function freeFlowEmptyRects(containers: readonly FreeFlowContainer[], empty: number): FreeRect[] {
  return containers
    .filter((container) => container.id !== null && container.accepts === null && container.items.length === 0)
    .map((container) => hitRectOf(container, empty));
}

/**
 * O lugar de soltar nas Camadas pela altura do ponteiro (px de tela). Numa caixa, o quarto de cima e antes, o de
 * baixo e depois e o meio e dentro; numa folha, a metade. Acima da primeira linha, antes dela; abaixo da ultima, o
 * fim da prancheta; num vao entre linhas, antes da de baixo. Quem chama devolve null fora do painel das Camadas.
 */
export function freeLayerDropAt(lines: readonly FreeLayerLine[], y: number): FreeLayerOver | null {
  if (lines.length === 0) {
    return null;
  }

  if (y < lines[0].top) {
    return { edge: "before", id: lines[0].id };
  }

  const last = lines[lines.length - 1];

  if (y >= last.top + last.height) {
    return { end: true };
  }

  for (const line of lines) {
    if (y >= line.top && y < line.top + line.height) {
      if (line.box) {
        return { edge: y < line.top + line.height / 4 ? "before" : y >= line.top + (line.height * 3) / 4 ? "after" : "inside", id: line.id };
      }

      return { edge: y < line.top + line.height / 2 ? "before" : "after", id: line.id };
    }
  }

  const below = lines.find((line) => line.top > y) ?? last;

  return { edge: "before", id: below.id };
}

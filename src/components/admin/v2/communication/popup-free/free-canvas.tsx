"use client";

import { ArrowDown, ArrowUp, Copy, GripVertical, Move, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject
} from "react";
import { cn } from "@/lib/utils";
import { PopupFreeCard } from "@/components/member/notifications/popup-free/popup-free-card";
import type { PopupItem } from "@/server/communications/notification-model";
import type { PopupFontFace } from "@/server/communications/popup-design-model";
import { findFreeNode, freeMobileNodeOf, walkFreeNodes, type FreeId, type PopupFreeDesign } from "@/server/communications/popup-free-model";
import type { FreeMeasuredRects } from "@/server/communications/popup-free-checks";
import {
  FREE_DRAG_START_PX,
  FREE_DROP_EDGE_SCREEN_PX,
  FREE_DROP_EMPTY_SCREEN_PX,
  FREE_FLOW_DRAG_START_PX,
  FREE_PHONE_FRAME_PX,
  FREE_RESIZE_HANDLES,
  finishFreeDrag,
  finishFreeDragDelta,
  freeArtboardPoint,
  freeBoundsOf,
  freeDesktopStageWidth,
  freeDragPreview,
  freeFitZoom,
  freeFlowDropAt,
  freeFlowEmptyRects,
  freeRectOfPlace,
  freeRevealScroll,
  freeScrolledPointer,
  freeSnapTargets,
  freeVisualRect,
  freeZoomAnchorScroll,
  freeZoomNext,
  freeZoomScale,
  freeZoomWheel,
  startFreeDrag,
  updateFreeDrag,
  type FreeCanvasDrop,
  type FreeCanvasDropSpec,
  type FreeDragMode,
  type FreeDragSession,
  type FreeFlowContainer,
  type FreeFlowDrop,
  type FreeMoveTarget,
  type FreePoint,
  type FreeRect,
  type FreeResizeHandle,
  type FreeZoom,
  type FreeZoomStep
} from "./free-editor-geometry";
import { FREE_EDITOR_COPY, FREE_HANDLE_LABELS, freeFlowContainers, freeFlowDraggable, freeLayerLabel, freeMoveProblem, freeNodeOf, isFreeMovable } from "./free-editor-model";
import { FREE_SELECTION_COPY, freeMovableIds, freeNextInStack, freeSelectionLive, freeStackFromPoint } from "./free-editor-selection";
import { FREE_POINTER_MOUSE_AND_PEN, FREE_POINTER_MOUSE_PEN_AND_TOUCH, followFreePointer, type FreePointerKeys } from "./free-pointer-drag";

// Area de desenho do editor Livre (spec §4.4): o MESMO PopupFreeCard do aluno, em previa, dentro de um palco com
// container-type: inline-size (Computador = max(W + 32, 600) px; Celular = moldura de 375 px, cartao de 343 px,
// como no aluno). O zoom e transform: scale() no palco (as unidades cqw nao mudam); a escala das contas do
// ponteiro = largura medida da prancheta / W. Camada de selecao por cima (sem receber clique, menos as alcas e a
// barrinha): contorno do elemento sob o mouse, contorno de 2 px do selecionado com a etiqueta do nome, 8 alcas nos
// soltos, guias de alinhamento e a barrinha dos elementos da sequencia. Durante o arrastar de um solto o design nao
// muda: o cartao desenha so aquele elemento deslocado (dragPreview) e o design muda uma vez, no fim. Com "Ver como:
// Celular" o editor entrega o design do celular (resolveFreeForDevice) e grava o fim desse gesto em devices.mobile;
// o selecionado com valores proprios do celular ganha a etiqueta "Celular" ao lado do nome.
// Arrastar da sequencia (docs/27 §13.9, L4a): um elemento da sequencia nao travado se arrasta pelo proprio corpo ou
// pela alca do comeco da barrinha (o jeito de pegar uma caixa coberta pelos filhos), com followFreePointer (mouse e
// caneta; o cartao tem touch-action: none). O gesto comeca a 6 px de tela e so entao captura o ponteiro: o clique de
// selecionar e o duplo clique de editar texto ficam como sao. A foto (os lugares de freeFlowContainers, o lugar de
// antes e o design) e tirada no onStart, depois do limiar; dentro de um solto girado a lista vem vazia e o gesto nao
// comeca (e a alca nem aparece: freeFlowDraggable, uma vez por selecao). A cada movimento, freeFlowDropAt acha o vao, e o indicador mostra a linha de onde entra, a caixa de
// destino, as caixas vazias que aceitam, o lugar de antes, o motivo de recusa e, no Celular, "Muda também no
// computador" (a ordem e uma so, em children). Rolar a area de desenho no meio redesenha o indicador. Soltar
// recalcula com o ponto do pointerup e chama onMoveInFlow (o editor confere e grava num passo); Esc, soltar fora da
// prancheta, no mesmo lugar ou com o design mudado no meio nao mudam nada. Durante o gesto a barrinha fica montada e
// invisivel, o contorno de passar o mouse some e o cartao fica com a mao fechada.
// L4b (docs/27 §13.10):
// - Varios escolhidos (selectedIds, o ultimo e o principal): um contorno por item (data-free-selection-item) e a caixa
//   tracejada do grupo (data-free-selection-group) com a etiqueta "3 elementos" de 12 px, sem alcas nem barrinha. Com
//   um elemento, tudo como antes (data-free-selection).
// - O pointerdown (freeCanvasPress, puro): Shift, Ctrl ou ⌘ poe ou tira e nunca arrasta; sem tecla, num solto de um
//   grupo, a selecao fica e o grupo arrasta junto (o click sem arrastar deixa so ele); o Alt (C2) arrasta o de CIMA
//   sem guias, e so o click que nao passou do limiar anda na pilha do ponto (elementsFromPoint, freeStackFromPoint e
//   freeNextInStack), a partir do principal de ANTES do pointerdown. No Mac, o menu do Ctrl + clique nao abre; o
//   duplo clique com Alt, Shift, Ctrl ou ⌘ nao edita texto.
// - O solto e as alcas pelo followFreePointer (mouse, caneta e toque, decisao 5; 3 px): Esc cancela, as teclas ficam
//   engolidas, o lostpointercapture nao grava, o click de depois e engolido e e um ponteiro por vez. A sessao nasce
//   no onStart; o arrastar soma a rolagem da area (freeScrolledPointer) e a area rola sozinha perto da borda
//   (autoScroll), como a sequencia. O grupo grava num passo por onCommitMoves (o editor limita pelo grupo).
// - Zoom em passos (Ajustar a tela, 50 a 200 %): zoomBy e zoomTo na api (nunca no meio de um arrastar), a roda com
//   Ctrl ou ⌘ so sobre a area (ouvinte nao passivo), o ponto sob o ponteiro (ou o meio da vista) mantido por uma
//   ancora guardada so por eles (C12), a escala mostrada em onScaleChange. A moldura (w-max) nao corta a esquerda do
//   palco, e reveal rola o minimo para mostrar os escolhidos.

const copy = FREE_EDITOR_COPY;

export type FreeCanvasToolbarCommand = "duplicate" | "moveDown" | "moveUp" | "remove" | "toFree";

/**
 * Como o desenho pede a selecao (L4b): so ele ou por e tirar (Shift, Ctrl ou ⌘). O Alt + clique diz tambem onde o
 * escolhido esta na pilha do ponto ("2 de 3 neste ponto"). Sem `how`, so ele.
 */
export type FreeCanvasSelectHow = { mode: "only" | "toggle"; stack?: { index: number; total: number } };

export type FreeCanvasApi = {
  /**
   * Arrastando um elemento novo do painel Elementos (docs/27 §13.9): com o ponteiro (px de tela) e o jeito do
   * elemento, desenha onde ele entra e devolve o lugar (null fora da prancheta visivel). (null, null) limpa.
   */
  previewDrop?: (client: FreePoint | null, spec: FreeCanvasDropSpec | null) => FreeCanvasDrop | null;
  /** O centro do que se ve no palco, em px da prancheta (a Forma nova entra ali). */
  visibleCenter: () => { x: number; y: number } | null;
  /**
   * Mais (1) ou menos (-1) zoom: o passo seguinte a partir da escala mostrada (de 62 %, + da 75 e - da 50), com o
   * mesmo ponto do palco sob `anchor` (px de tela; sem ele, o meio da vista). Devolve o passo pedido ao editor, ou
   * false no meio de um arrastar, na ponta (50 ou 200 %) ou sem onZoomChange.
   */
  zoomBy: (direction: 1 | -1, anchor?: FreePoint) => FreeZoomStep | false;
  /** Um zoom escolhido (o menu: Ajustar a tela ou um passo), mantendo o meio da vista. False no meio de um arrastar. */
  zoomTo: (zoom: FreeZoom) => boolean;
  /** Mostrar os escolhidos (Camadas, Revisar, setas): no proximo quadro, o menor rolar que os deixa inteiros na vista. */
  reveal: (ids: readonly FreeId[]) => void;
  /** A area de desenho que rola (o alvo da rolagem sozinha do painel Elementos). */
  viewport: () => HTMLElement | null;
};

/**
 * O indicador do arrastar (so na camada de selecao): a linha de onde entra, a caixa de destino, o retangulo do solto
 * novo, as caixas vazias que aceitam, o lugar de antes, o motivo de recusa e a etiqueta do Celular.
 */
type FreeDropView = {
  blocked: FreeFlowDrop["blocked"];
  box: FreeRect | null;
  both: boolean;
  empties: FreeRect[];
  line: FreeRect | null;
  newRect: FreeRect | null;
  origin: FreeRect | null;
};

export type FreeCanvasProps = {
  apiRef?: RefObject<FreeCanvasApi | null>;
  description: string;
  design: PopupFreeDesign;
  device: "desktop" | "mobile";
  disabled: boolean;
  fonts: readonly PopupFontFace[];
  /**
   * Fim do arrastar de varios soltos juntos (L4b): quanto o grupo andou, inteiro (o editor limita pelo grupo, com o
   * aparelho do "Ver como", e grava num passo). So vem com 2 ou mais soltos que andam.
   */
  onCommitMoves?: (ids: readonly FreeId[], delta: { dx: number; dy: number }) => void;
  onCommitRect: (id: FreeId, rect: Partial<FreeRect>, kind: "move" | "resize") => void;
  onEditText: (id: FreeId) => void;
  /** Fim de um arrastar de elemento da sequencia no desenho: o vao escolhido (o editor confere e grava num passo). */
  onMoveInFlow?: (id: FreeId, target: FreeMoveTarget) => void;
  onRectsChange: (rects: FreeMeasuredRects) => void;
  /** A escala mostrada (px de tela por px do palco), a cada mudanca: o "62 %" da barra no Ajustar a tela. */
  onScaleChange?: (scale: number) => void;
  /** Escolher pelo desenho: sem `how`, so ele (null limpa); com `how`, por ou tirar e a posicao na pilha do Alt. */
  onSelect: (id: FreeId | null, how?: FreeCanvasSelectHow) => void;
  onToolbar: (command: FreeCanvasToolbarCommand, id: FreeId) => void;
  /** O zoom pedido pela roda com Ctrl e por zoomBy e zoomTo da api: o editor guarda e devolve em `zoom`. */
  onZoomChange?: (zoom: FreeZoom) => void;
  popup: PopupItem;
  rects: FreeMeasuredRects;
  /** O principal (o ultimo escolhido): as alcas, a barrinha e o nome sao dele. */
  selectedId: FreeId | null;
  /** Todos os escolhidos, na ordem da escolha (o ultimo e o principal). Sem a lista, so o principal. */
  selectedIds?: readonly FreeId[];
  stageRef: RefObject<HTMLDivElement | null>;
  toolbarDisabled: Partial<Record<FreeCanvasToolbarCommand, string | null>>;
  /** Ajustar a tela ou um passo (50 a 200 %); o "100" em texto da barra de antes do L4b vale 100 %. */
  zoom: FreeZoom | "100";
};

/** Medidas da prancheta no palco: px de layout por px da prancheta (1 no Computador; 343/W no Celular) e a borda. */
type Frame = { clientLeft: number; clientTop: number; k: number };

/**
 * O arrastar de um elemento da sequencia no desenho, a partir do limiar: a foto do comeco (o design do palco, os
 * lugares que recebem e o lugar de antes), o ultimo ponto (px de tela, para redesenhar quando a area rola) e o vao
 * de agora (null fora da prancheta, no mesmo lugar ou recusado).
 */
type FreeFlowSession = {
  containers: FreeFlowContainer[];
  design: PopupFreeDesign;
  id: FreeId;
  last: FreePoint | null;
  origin: FreeRect;
  target: FreeMoveTarget | null;
};

/**
 * O que o click que nao passou do limiar faz (o de um gesto comecado o ajudante de ponteiro engole): ficar so com
 * `id` (o grupo mantido no pointerdown) ou andar na pilha do ponto (Alt + clique) a partir do principal de antes.
 */
export type FreeCanvasClick = { id: FreeId; kind: "only" } | { before: FreeId | null; kind: "stack"; toggle: boolean };

/** O que o pointerdown no cartao faz: a selecao agora, o arrastar (de um, ou do grupo com `ids`) e o click depois. */
export type FreeCanvasPress = {
  click: FreeCanvasClick | null;
  drag: { id: FreeId; ids?: readonly FreeId[] } | null;
  select: { id: FreeId | null; mode: "only" | "toggle" } | null;
};

/**
 * O pointerdown no cartao (L4b, docs/27 §13.10), puro (testado no Node):
 * - Shift, Ctrl ou ⌘ (sem Alt): poe ou tira o elemento e nunca arrasta; no vazio, nada muda.
 * - Sem tecla, num solto que anda de uma selecao com 2 ou mais soltos que andam: a selecao fica e o grupo arrasta
 *   junto; o click sem arrastar deixa so ele.
 * - Senao: so ele (no vazio, nada escolhido) e o arrastar dele (o do solto e o da sequencia conferem se podem).
 * - Alt (C2): o pointerdown e o de sempre, com o elemento de CIMA (o Alt do onMove tira as guias); o ciclo da pilha
 *   vem so no click que nao passou do limiar, a partir do principal de ANTES deste pointerdown (com o de depois, que
 *   e o de cima, o ciclo nunca sairia do segundo). Com Alt e Shift, Ctrl ou ⌘: nada agora, e o click poe o de baixo
 *   na selecao.
 */
export function freeCanvasPress(input: {
  altKey: boolean;
  ctrlKey: boolean;
  design: PopupFreeDesign;
  id: FreeId | null;
  metaKey: boolean;
  principal: FreeId | null;
  selection: readonly FreeId[];
  shiftKey: boolean;
}): FreeCanvasPress {
  const toggle = input.shiftKey || input.ctrlKey || input.metaKey;
  const stack: FreeCanvasClick | null = input.altKey ? { before: input.principal, kind: "stack", toggle } : null;

  if (toggle) {
    return { click: stack, drag: null, select: input.altKey || !input.id ? null : { id: input.id, mode: "toggle" } };
  }

  const group = input.id && input.selection.length >= 2 && input.selection.includes(input.id) ? freeMovableIds(input.design, input.selection).ids : [];

  if (input.id && group.length >= 2 && group.includes(input.id)) {
    return { click: stack ?? { id: input.id, kind: "only" }, drag: { id: input.id, ids: group }, select: null };
  }

  return { click: stack, drag: input.id ? { id: input.id } : null, select: { id: input.id, mode: "only" } };
}

/**
 * O click que nao passou do limiar: o grupo mantido vira so ele; o Alt + clique escolhe o proximo da pilha do ponto
 * (`stack`, de cima para baixo) a partir do principal de antes, so ele ou posto na selecao (com Shift, Ctrl ou ⌘), com
 * a posicao para a frase. Pilha vazia, nada.
 */
export function freeCanvasClickSelect(click: FreeCanvasClick, stack: readonly FreeId[]): { how?: FreeCanvasSelectHow; id: FreeId } | null {
  if (click.kind === "only") {
    return { id: click.id };
  }

  const next = freeNextInStack(stack, click.before);

  if (!next) {
    return null;
  }

  return { how: { mode: click.toggle ? "toggle" : "only", stack: { index: next.index, total: next.total } }, id: next.id };
}

/** O scroll da area de desenho durante um arrastar (o mesmo objeto para ligar e desligar). */
const DRAG_SCROLL: AddEventListenerOptions = { capture: true, passive: true };

/** A roda com Ctrl (ou ⌘) sobre a area: nao passiva, para o preventDefault valer (o onWheel do React e passivo). */
const ZOOM_WHEEL: AddEventListenerOptions = { passive: false };

const NO_KEYS: FreePointerKeys = { altKey: false, shiftKey: false };

const GUIDE_COLOR = "#ff3ea5";
const HANDLE_CURSOR: Record<FreeResizeHandle, string> = {
  e: "ew-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  nw: "nwse-resize",
  s: "ns-resize",
  se: "nwse-resize",
  sw: "nesw-resize",
  w: "ew-resize"
};

function sameRects(a: FreeMeasuredRects, b: FreeMeasuredRects) {
  const keys = Object.keys(a);

  if (keys.length !== Object.keys(b).length) {
    return false;
  }

  return keys.every((key) => {
    const left = a[key];
    const right = b[key];

    return (
      right !== undefined &&
      Math.abs(left.x - right.x) < 0.25 &&
      Math.abs(left.y - right.y) < 0.25 &&
      Math.abs(left.w - right.w) < 0.25 &&
      Math.abs(left.h - right.h) < 0.25
    );
  });
}

/** O mesmo retangulo e as mesmas guias: nada a redesenhar (a rolagem e o ouvinte de scroll chamam juntos). */
function sameDrag(a: FreeDragSession, b: FreeDragSession) {
  if (!a.last || !b.last) {
    return a.last === b.last;
  }

  const ra = a.last.rect;
  const rb = b.last.rect;

  return (
    ra.x === rb.x &&
    ra.y === rb.y &&
    ra.w === rb.w &&
    ra.h === rb.h &&
    a.last.guides.length === b.last.guides.length &&
    a.last.guides.every((guide, index) => guide.at === b.last?.guides[index]?.at && guide.axis === b.last?.guides[index]?.axis)
  );
}

/** As guias do arrastar: a prancheta e os outros soltos de primeiro nivel que se veem, sem os que andam nem girados. */
function freeDragTargets(stage: PopupFreeDesign, measured: FreeMeasuredRects, exclude: readonly FreeId[]) {
  const others: FreeRect[] = [];

  walkFreeNodes(stage.children, (node, info) => {
    if (info.depth === 1 && !exclude.includes(node.id) && !node.hidden && node.place?.mode === "free" && !node.place.rotate) {
      others.push(freeRectOfPlace(node.place, measured[node.id]?.h));
    }
  });

  const artboard = measured["@artboard"] ?? { h: 400, w: stage.artboard?.width ?? 440, x: 0, y: 0 };

  return freeSnapTargets({ h: artboard.h, w: artboard.w }, others);
}

/**
 * A pilha do Alt + clique: os elementos sob o ponto, de cima para baixo (document.elementsFromPoint ja deixa de fora
 * os travados e o que nao recebe ponteiro), so os de dentro do cartao, cada um levado ao seu elemento do Livre.
 */
function freeStackAt(wrap: HTMLElement, client: FreePoint): FreeId[] {
  const hits = wrap.ownerDocument.elementsFromPoint(client.x, client.y).filter((element): element is HTMLElement | SVGElement => "dataset" in element);

  // freeStackFromPoint devolve ao `inside` os mesmos elementos que recebeu: sao todos Nodes.
  return freeStackFromPoint(hits, (element) => wrap.contains(element as unknown as Node));
}

function handleStyle(handle: FreeResizeHandle, size: number): CSSProperties {
  const half = -size / 2;
  const style: CSSProperties = { cursor: HANDLE_CURSOR[handle], height: size, position: "absolute", width: size };

  style.top = handle.includes("n") ? half : handle.includes("s") ? undefined : `calc(50% - ${size / 2}px)`;
  style.bottom = handle.includes("s") ? half : undefined;
  style.left = handle.includes("w") ? half : handle.includes("e") ? undefined : `calc(50% - ${size / 2}px)`;
  style.right = handle.includes("e") ? half : undefined;

  return style;
}

export function FreeCanvas({
  apiRef,
  description,
  design,
  device,
  disabled,
  fonts,
  onCommitMoves,
  onCommitRect,
  onEditText,
  onMoveInFlow,
  onRectsChange,
  onScaleChange,
  onSelect,
  onToolbar,
  onZoomChange,
  popup,
  rects,
  selectedId,
  selectedIds,
  stageRef,
  toolbarDisabled,
  zoom
}: FreeCanvasProps) {
  const width = design.artboard?.width ?? 440;
  const descriptionId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const nodeEls = useRef(new Map<FreeId, HTMLElement>());
  const observer = useRef<ResizeObserver | null>(null);
  const frameRequest = useRef<number | null>(null);
  const revealFrame = useRef<number | null>(null);
  const lastRects = useRef<FreeMeasuredRects>(rects);
  const [frame, setFrame] = useState<Frame>({ clientLeft: 0, clientTop: 0, k: 1 });
  const [stageSize, setStageSize] = useState({ h: 0, w: 0 });
  const [viewport, setViewport] = useState({ h: 0, w: 0 });
  const [hoverId, setHoverId] = useState<FreeId | null>(null);
  const [session, setSession] = useState<FreeDragSession | null>(null);
  const sessionRef = useRef<FreeDragSession | null>(null);
  // O arrastar do solto (L4b): o gesto seguido (C13), a rolagem da area no pointerdown e o ultimo ponto e teclas.
  const dragDispose = useRef<(() => void) | null>(null);
  const dragScroll = useRef<FreePoint | null>(null);
  const dragLast = useRef<{ client: FreePoint; keys: FreePointerKeys } | null>(null);
  // O click que nao passou do limiar: o grupo mantido ou a pilha do Alt, com o principal de antes do pointerdown.
  const clickRef = useRef<{ origin: FreePoint; plan: FreeCanvasClick } | null>(null);
  // A ancora do zoom (C12): guardada so por zoomBy e zoomTo (a roda chama zoomBy), aplicada e limpa na escala pedida.
  const zoomAnchor = useRef<{ client: FreePoint; origin: FreePoint; scale: number; to: number } | null>(null);
  const designRef = useRef(design);
  const rectsRef = useRef(rects);
  const onRectsChangeRef = useRef(onRectsChange);
  const [dropView, setDropView] = useState<FreeDropView | null>(null);
  const dropKey = useRef("");
  const flowRef = useRef<FreeFlowSession | null>(null);
  const flowDispose = useRef<(() => void) | null>(null);
  const [flowDragging, setFlowDragging] = useState(false);
  const deviceRef = useRef(device);
  const disabledRef = useRef(disabled);
  const onMoveInFlowRef = useRef(onMoveInFlow);
  const onCommitRectRef = useRef(onCommitRect);
  const onCommitMovesRef = useRef(onCommitMoves);
  const onScaleChangeRef = useRef(onScaleChange);
  const onZoomChangeRef = useRef(onZoomChange);
  const stageWidth = device === "mobile" ? FREE_PHONE_FRAME_PX : freeDesktopStageWidth(width);
  const fitScale = freeFitZoom(viewport, { h: stageSize.h || 600, w: stageWidth });
  const scale = freeZoomScale(zoom, fitScale);
  const layoutPerScreen = 1 / scale;
  const scaleRef = useRef(scale);
  const fitRef = useRef(fitScale);
  // Os escolhidos que existem no design do palco, na ordem da escolha (o ultimo e o principal).
  const liveIds = freeSelectionLive(design, selectedIds ?? (selectedId ? [selectedId] : []));
  const many = liveIds.length >= 2;

  useLayoutEffect(() => {
    designRef.current = design;
    rectsRef.current = rects;
    onRectsChangeRef.current = onRectsChange;
    deviceRef.current = device;
    disabledRef.current = disabled;
    onMoveInFlowRef.current = onMoveInFlow;
    onCommitRectRef.current = onCommitRect;
    onCommitMovesRef.current = onCommitMoves;
    onScaleChangeRef.current = onScaleChange;
    onZoomChangeRef.current = onZoomChange;
    scaleRef.current = scale;
    fitRef.current = fitScale;
  });

  /** Troca o indicador do arrastar so quando ele muda (o cartao redesenha a cada troca). */
  const showDropView = useCallback((next: FreeDropView | null) => {
    const key = next ? JSON.stringify(next) : "";

    if (key !== dropKey.current) {
      dropKey.current = key;
      setDropView(next);
    }
  }, []);

  /**
   * Um ponto da tela em px da prancheta e a escala de agora (px de tela por px da prancheta), com a mesma conta de
   * measure e o retangulo lido na hora (a area de desenho rola). Null fora da area de desenho ou fora da prancheta.
   */
  const artboardPointAt = useCallback((client: FreePoint): { point: FreePoint; scale: number } | null => {
    const artboard = wrapRef.current?.querySelector<HTMLElement>("[data-free-artboard]");
    const view = viewportRef.current?.getBoundingClientRect();
    const bounds = rectsRef.current["@artboard"];

    if (!artboard || !view || !bounds || client.x < view.left || client.x > view.right || client.y < view.top || client.y > view.bottom) {
      return null;
    }

    const W = designRef.current.artboard?.width ?? 440;
    const box = artboard.getBoundingClientRect();
    const layoutWidth = artboard.offsetWidth || W;
    const screen = box.width / W || 1;
    const perLayout = box.width / layoutWidth || 1;
    const point = freeArtboardPoint(client, { x: box.left + artboard.clientLeft * perLayout, y: box.top + artboard.clientTop * perLayout }, screen);

    if (point.x < 0 || point.y < 0 || point.x > bounds.w || point.y > bounds.h) {
      return null;
    }

    return { point, scale: screen };
  }, []);

  /** Mede a prancheta e cada elemento (px da prancheta, a partir do canto de dentro da borda). */
  const measure = useCallback(() => {
    frameRequest.current = null;

    const artboard = wrapRef.current?.querySelector<HTMLElement>("[data-free-artboard]");

    if (!artboard) {
      return;
    }

    const current = designRef.current;
    const W = current.artboard?.width ?? 440;
    const box = artboard.getBoundingClientRect();
    const layoutWidth = artboard.offsetWidth || W;
    const k = layoutWidth / W;
    const screen = box.width / W || 1;
    const perLayout = box.width / layoutWidth || 1;
    const originX = box.left + artboard.clientLeft * perLayout;
    const originY = box.top + artboard.clientTop * perLayout;
    const next: Record<string, FreeRect> = { "@artboard": { h: artboard.clientHeight / k, w: artboard.clientWidth / k, x: 0, y: 0 } };

    for (const [id, element] of nodeEls.current) {
      if (!element.isConnected) {
        continue;
      }

      const r = element.getBoundingClientRect();
      const rect: FreeRect = { h: r.height / screen, w: r.width / screen, x: (r.left - originX) / screen, y: (r.top - originY) / screen };
      const node = findFreeNode(current, id)?.node;

      // Girado: o retangulo sem giro (mesmo centro), como o design guarda.
      if (node?.place?.mode === "free" && node.place.rotate) {
        const w = element.offsetWidth / k;
        const h = element.offsetHeight / k;

        next[id] = { h, w, x: rect.x + rect.w / 2 - w / 2, y: rect.y + rect.h / 2 - h / 2 };
      } else {
        next[id] = rect;
      }
    }

    setFrame((previous) =>
      Math.abs(previous.k - k) < 1e-6 && previous.clientLeft === artboard.clientLeft && previous.clientTop === artboard.clientTop
        ? previous
        : { clientLeft: artboard.clientLeft, clientTop: artboard.clientTop, k }
    );

    if (!sameRects(next, lastRects.current)) {
      lastRects.current = next;
      onRectsChangeRef.current(next);
    }
  }, []);

  const scheduleMeasure = useCallback(() => {
    if (frameRequest.current === null && typeof window !== "undefined") {
      frameRequest.current = window.requestAnimationFrame(measure);
    }
  }, [measure]);

  // O cartao entrega o elemento do DOM de cada elemento do design (ref estavel por funcao: esta e estavel).
  const editorNodeRef = useCallback(
    (id: FreeId, element: HTMLElement | null) => {
      const previous = nodeEls.current.get(id);

      if (previous && previous !== element) {
        observer.current?.unobserve(previous);
      }

      if (element) {
        nodeEls.current.set(id, element);
        observer.current?.observe(element);
      } else {
        nodeEls.current.delete(id);
      }

      scheduleMeasure();
    },
    [scheduleMeasure]
  );

  useEffect(() => {
    const resize = new ResizeObserver(() => scheduleMeasure());

    observer.current = resize;

    for (const element of nodeEls.current.values()) {
      resize.observe(element);
    }

    if (contentRef.current) {
      resize.observe(contentRef.current);
    }

    const viewportResize = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (entry) {
        setViewport({ h: entry.contentRect.height, w: entry.contentRect.width });
      }
    });

    if (viewportRef.current) {
      viewportResize.observe(viewportRef.current);
    }

    const stageResize = new ResizeObserver(() => {
      const element = contentRef.current;

      if (element) {
        setStageSize({ h: element.offsetHeight, w: element.offsetWidth });
      }
    });

    if (contentRef.current) {
      stageResize.observe(contentRef.current);
    }

    return () => {
      resize.disconnect();
      viewportResize.disconnect();
      stageResize.disconnect();
      observer.current = null;

      if (frameRequest.current !== null) {
        window.cancelAnimationFrame(frameRequest.current);
        frameRequest.current = null;
      }
    };
  }, [scheduleMeasure]);

  // Toda mudanca do design, do aparelho ou do zoom mede de novo (depois do desenho).
  useLayoutEffect(() => {
    scheduleMeasure();
  }, [design, device, scale, scheduleMeasure]);

  /* --------------------------------------------------------------------------------------------
   * Zoom em passos (L4b): so refs, porque a roda e a api chamam de fora do React
   * ------------------------------------------------------------------------------------------ */

  /**
   * Pede o zoom ao editor e guarda a ancora (C12): o ponto da tela que deve mostrar o mesmo ponto do palco depois da
   * escala nova (o ponteiro na roda; o meio da vista nos botoes e nas teclas). Chamado so por zoomBy e zoomTo: o
   * Ajustar a tela que muda sozinho (a prancheta cresceu, a janela mudou) nao rola nada.
   */
  const changeZoom = useCallback(
    (next: FreeZoom, client: FreePoint | null) => {
      const view = viewportRef.current;
      const stage = stageRef.current;
      const to = freeZoomScale(next, fitRef.current);

      zoomAnchor.current = null;

      if (view && stage && Math.abs(to - scaleRef.current) > 1e-6) {
        const box = view.getBoundingClientRect();
        const origin = stage.getBoundingClientRect();

        zoomAnchor.current = {
          client: client ?? { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 },
          origin: { x: origin.left, y: origin.top },
          scale: scaleRef.current,
          to
        };
      }

      onZoomChangeRef.current?.(next);
    },
    [stageRef]
  );

  const zoomBy = useCallback(
    (direction: 1 | -1, anchor?: FreePoint): FreeZoomStep | false => {
      // No meio de um arrastar a escala e a origem do gesto ficariam velhas (o elemento pularia): nada muda.
      if (sessionRef.current || flowRef.current || !onZoomChangeRef.current) {
        return false;
      }

      const next = freeZoomNext(scaleRef.current, direction);

      if (next === null) {
        return false;
      }

      changeZoom(next, anchor ?? null);

      return next;
    },
    [changeZoom]
  );

  const zoomTo = useCallback(
    (next: FreeZoom): boolean => {
      if (sessionRef.current || flowRef.current || !onZoomChangeRef.current) {
        return false;
      }

      changeZoom(next, null);

      return true;
    },
    [changeZoom]
  );

  // A ancora do zoom: so a que zoomBy ou zoomTo guardou, aplicada uma vez na escala pedida (e sempre limpa).
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    const view = viewportRef.current;
    const stage = stageRef.current;

    zoomAnchor.current = null;

    if (!anchor || !view || !stage || Math.abs(anchor.to - scale) > 1e-6) {
      return;
    }

    const box = stage.getBoundingClientRect();
    const shift = freeZoomAnchorScroll(anchor.client, { origin: anchor.origin, scale: anchor.scale }, { origin: { x: box.left, y: box.top }, scale });

    if (shift.x !== 0 || shift.y !== 0) {
      view.scrollBy(shift.x, shift.y);
    }
  }, [scale, stageRef]);

  // A escala mostrada vai para a barra (o "62 %" do Ajustar a tela), a cada mudanca.
  useEffect(() => {
    onScaleChangeRef.current?.(scale);
  }, [scale]);

  // Ctrl (ou ⌘) + roda so sobre a area de desenho: um passo a cada 50 px somados, no ponto do ponteiro. Nunca o zoom
  // da pagina aqui; no meio de um arrastar, nada.
  useEffect(() => {
    const view = viewportRef.current;

    if (!view) {
      return;
    }

    let acc = 0;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();

      if (sessionRef.current || flowRef.current) {
        acc = 0;

        return;
      }

      // deltaMode antes de deltaY: no Firefox, ler deltaY primeiro troca as linhas por px.
      const wheel = { deltaMode: event.deltaMode, deltaY: event.deltaY };
      const step = freeZoomWheel(acc, wheel, view.clientHeight);

      acc = step.acc;

      if (step.direction !== 0) {
        zoomBy(step.direction, { x: event.clientX, y: event.clientY });
      }
    };

    view.addEventListener("wheel", onWheel, ZOOM_WHEEL);

    return () => view.removeEventListener("wheel", onWheel, ZOOM_WHEEL);
  }, [zoomBy]);

  /** Mostrar os escolhidos: no proximo quadro (depois do desenho), o menor rolar da area que os deixa inteiros na vista. */
  const reveal = useCallback((ids: readonly FreeId[]) => {
    if (typeof window === "undefined") {
      return;
    }

    if (revealFrame.current !== null) {
      window.cancelAnimationFrame(revealFrame.current);
    }

    revealFrame.current = window.requestAnimationFrame(() => {
      revealFrame.current = null;

      const view = viewportRef.current;
      const boxes = ids.flatMap((id) => {
        const element = nodeEls.current.get(id);

        return element?.isConnected ? [element.getBoundingClientRect()] : [];
      });

      if (!view || boxes.length === 0) {
        return;
      }

      // A vista sem as barras de rolagem; o alvo e a caixa que se ve (um girado pela volta).
      const outer = view.getBoundingClientRect();
      const left = outer.left + view.clientLeft;
      const top = outer.top + view.clientTop;
      const shift = freeRevealScroll(
        { bottom: top + view.clientHeight, left, right: left + view.clientWidth, top },
        {
          bottom: Math.max(...boxes.map((box) => box.bottom)),
          left: Math.min(...boxes.map((box) => box.left)),
          right: Math.max(...boxes.map((box) => box.right)),
          top: Math.min(...boxes.map((box) => box.top))
        }
      );

      if (shift.dx !== 0 || shift.dy !== 0) {
        view.scrollBy(shift.dx, shift.dy);
      }
    });
  }, []);

  useEffect(() => {
    if (!apiRef) {
      return;
    }

    apiRef.current = {
      // So refs: o painel Elementos chama a cada movimento do ponteiro, sem esperar o React.
      previewDrop: (client, spec) => {
        const at = client && spec ? artboardPointAt(client) : null;

        if (!spec || !at) {
          showDropView(null);

          return null;
        }

        if (spec.free) {
          const center = { x: Math.round(at.point.x), y: Math.round(at.point.y) };

          showDropView({ blocked: null, box: null, both: false, empties: [], line: null, newRect: spec.rectAt(center), origin: null });

          return { center, kind: "free" };
        }

        // Um elemento novo nunca muda a ordem de outro: sem a etiqueta do Celular.
        const containers = freeFlowContainers(designRef.current, rectsRef.current, { height: spec.height });
        const empty = FREE_DROP_EMPTY_SCREEN_PX / at.scale;
        const drop = freeFlowDropAt(at.point, containers, { edge: FREE_DROP_EDGE_SCREEN_PX / at.scale, empty });

        if (!drop) {
          showDropView(null);

          return null;
        }

        showDropView({ blocked: drop.blocked, box: drop.box, both: false, empties: freeFlowEmptyRects(containers, empty), line: drop.line, newRect: null, origin: null });

        return { index: drop.index, kind: "flow", parentId: drop.parentId };
      },
      visibleCenter: () => {
        const artboard = wrapRef.current?.querySelector<HTMLElement>("[data-free-artboard]");
        const view = viewportRef.current?.getBoundingClientRect();

        if (!artboard || !view) {
          return null;
        }

        const box = artboard.getBoundingClientRect();
        const W = designRef.current.artboard?.width ?? 440;
        const screen = box.width / W || 1;
        const visibleTop = Math.max(box.top, view.top);
        const visibleBottom = Math.min(box.bottom, view.bottom);
        const visibleLeft = Math.max(box.left, view.left);
        const visibleRight = Math.min(box.right, view.right);

        return {
          x: ((visibleLeft + visibleRight) / 2 - box.left) / screen,
          y: (visibleBottom > visibleTop ? (visibleTop + visibleBottom) / 2 - box.top : box.height / 2) / screen
        };
      },
      zoomBy,
      zoomTo,
      reveal,
      viewport: () => viewportRef.current
    };

    return () => {
      apiRef.current = null;
    };
  }, [apiRef, artboardPointAt, reveal, showDropView, zoomBy, zoomTo]);

  /* --------------------------------------------------------------------------------------------
   * Arrastar da sequencia (L4a): so refs, porque o ajudante de ponteiro chama de fora do React
   * ------------------------------------------------------------------------------------------ */

  /**
   * O vao sob o ponto (px de tela) pela foto do comeco, e o indicador. Devolve o vao que o soltar grava: null fora da
   * prancheta, no mesmo lugar (sem linha nem caixa de destino) ou recusado (so o motivo).
   */
  const updateFlow = useCallback(
    (client: FreePoint): FreeMoveTarget | null => {
      const current = flowRef.current;

      if (!current) {
        return null;
      }

      current.last = client;

      const at = artboardPointAt(client);
      const artboard = wrapRef.current?.querySelector<HTMLElement>("[data-free-artboard]");
      const screen = at?.scale ?? (artboard ? artboard.getBoundingClientRect().width / (current.design.artboard?.width ?? 440) || 1 : 1);
      const empty = FREE_DROP_EMPTY_SCREEN_PX / screen;
      const drop = at ? freeFlowDropAt(at.point, current.containers, { edge: FREE_DROP_EDGE_SCREEN_PX / screen, empty }) : null;
      const target: FreeMoveTarget | null = drop ? { index: drop.index, parentId: drop.parentId } : null;
      // "" = o mesmo lugar (ou nada a fazer): sem linha e sem caixa de destino; um texto e um motivo de recusa.
      const problem = target ? freeMoveProblem(current.design, current.id, target) : "";
      const moves = drop !== null && problem === null;

      current.target = moves ? target : null;
      showDropView({
        blocked: drop?.blocked ?? (problem ? { id: current.id, reason: problem } : null),
        box: drop && moves ? drop.box : null,
        both: moves && deviceRef.current === "mobile",
        empties: freeFlowEmptyRects(current.containers, empty),
        line: drop && moves ? drop.line : null,
        newRect: null,
        origin: current.origin
      });

      return current.target;
    },
    [artboardPointAt, showDropView]
  );

  /**
   * O ponteiro passou do limiar: a foto do comeco (o design do palco, os lugares que recebem e o lugar de antes). Ela e
   * tirada aqui e nao no pointerdown: o blur de um campo que grava (Renomear nas Camadas) chega depois do pointerdown.
   */
  const startFlow = useCallback((id: FreeId) => {
    const stage = designRef.current;
    const node = freeNodeOf(stage, id);
    const origin = rectsRef.current[id];
    const containers = freeFlowContainers(stage, rectsRef.current, { id });

    // Passou do limiar: o click que vier (o ajudante engole) nao escolhe nada.
    clickRef.current = null;

    if (disabledRef.current || !node || node.locked || node.place?.mode === "free" || !origin || containers.length === 0) {
      // Nao comeca: desliga o gesto sem chamar nada (o movimento que vem logo depois acha a sessao vazia).
      flowDispose.current?.();
      flowDispose.current = null;

      return;
    }

    flowRef.current = { containers, design: stage, id, last: null, origin, target: null };
    setFlowDragging(true);
  }, []);

  /**
   * Fim do arrastar da sequencia. Com o ponto do pointerup, refaz o vao (a area pode ter rolado sem pointermove) e o
   * editor grava; sem ponto (Esc, pointercancel, blur), so limpa. Com o design mudado no meio, os indices da foto
   * ficaram velhos e nada muda.
   */
  const endFlow = useCallback(
    (client: FreePoint | null) => {
      const current = flowRef.current;
      const target = current && client ? updateFlow(client) : null;

      flowRef.current = null;
      setFlowDragging(false);
      showDropView(null);

      if (current && target && designRef.current === current.design && !disabledRef.current) {
        onMoveInFlowRef.current?.(current.id, target);
      }
    },
    [showDropView, updateFlow]
  );

  /* --------------------------------------------------------------------------------------------
   * Arrastar do solto, de varios juntos e das alcas (L4b): pelo followFreePointer, so refs
   * ------------------------------------------------------------------------------------------ */

  /**
   * O ponteiro andou (ou a area rolou): o retangulo provisorio pelo ponto com a rolagem somada desde o pointerdown
   * (freeScrolledPointer), com o Alt (sem guias) e o Shift (a proporcao nas alcas) desse movimento.
   */
  const moveDrag = useCallback((client: FreePoint, keys: FreePointerKeys) => {
    const current = sessionRef.current;
    const scrollStart = dragScroll.current;

    if (!current || !scrollStart) {
      return;
    }

    dragLast.current = { client, keys };

    const view = viewportRef.current;
    const pointer = view ? freeScrolledPointer(client, scrollStart, { x: view.scrollLeft, y: view.scrollTop }) : client;
    const next = updateFreeDrag(current, pointer, keys);

    if (next !== current && !sameDrag(current, next)) {
      sessionRef.current = next;
      setSession(next);
    }
  }, []);

  const soloDragging = session !== null;

  // Rolar a area de desenho no meio de um arrastar nao manda pointermove: o indicador da sequencia e o retangulo do
  // solto (ou do grupo) saem do ultimo ponto.
  useEffect(() => {
    const view = viewportRef.current;

    if ((!flowDragging && !soloDragging) || !view) {
      return;
    }

    const onScroll = () => {
      const last = flowRef.current?.last;
      const drag = dragLast.current;

      if (last) {
        updateFlow(last);
      } else if (sessionRef.current && drag) {
        moveDrag(drag.client, drag.keys);
      }
    };

    view.addEventListener("scroll", onScroll, DRAG_SCROLL);

    return () => view.removeEventListener("scroll", onScroll, DRAG_SCROLL);
  }, [flowDragging, moveDrag, soloDragging, updateFlow]);

  // Ao desmontar, os gestos que estiverem sendo seguidos sao desligados (o bloqueador do click de um gesto terminado
  // fica), e o quadro do reveal sai.
  useEffect(
    () => () => {
      flowDispose.current?.();
      dragDispose.current?.();

      if (revealFrame.current !== null) {
        window.cancelAnimationFrame(revealFrame.current);
        revealFrame.current = null;
      }
    },
    []
  );

  /**
   * O ponteiro passou do limiar: a sessao nasce aqui, com o design, as medidas e a escala de agora (o blur de um campo
   * que grava chega depois do pointerdown); a origem e a rolagem sao as do pointerdown. Com `ids` (2 ou mais soltos que
   * ainda andam, com o apertado entre eles) e o grupo: a caixa dos que se veem, guias sem os escolhidos e sem guias
   * com algum girado. Sem poder mover, desliga o gesto sem chamar nada.
   */
  function startDrag(id: FreeId, mode: FreeDragMode, ids: readonly FreeId[], origin: FreePoint, scroll: FreePoint) {
    const stage = designRef.current;
    const measured = rectsRef.current;
    const node = freeNodeOf(stage, id);

    // Passou do limiar: o click que vier (o ajudante engole) nao escolhe nada.
    clickRef.current = null;

    if (disabledRef.current || !node || !isFreeMovable(node) || node.place?.mode !== "free") {
      dragDispose.current?.();
      dragDispose.current = null;

      return;
    }

    const W = stage.artboard?.width ?? 440;
    const artboard = wrapRef.current?.querySelector<HTMLElement>("[data-free-artboard]");
    const screen = artboard ? artboard.getBoundingClientRect().width / W || 1 : 1;
    const group = ids.length >= 2 ? freeMovableIds(stage, ids).ids : [];
    let next: FreeDragSession;

    if (group.length >= 2 && group.includes(id)) {
      const members = group.flatMap((member) => {
        const place = freeNodeOf(stage, member)?.place;

        return place?.mode === "free" ? [{ id: member, place }] : [];
      });
      // As guias valem para a caixa do que se ve neste aparelho (um escondido anda junto, mas nao conta na caixa).
      const shown = members.filter((member) => measured[member.id]);
      const bounds = freeBoundsOf((shown.length > 0 ? shown : members).map((member) => freeRectOfPlace(member.place, measured[member.id]?.h)));

      next = startFreeDrag({
        hadHeight: false,
        id,
        ids: group,
        mode: "move",
        origin,
        rect: bounds ?? freeRectOfPlace(node.place, measured[id]?.h),
        scale: screen,
        snap: members.some((member) => member.place.rotate) ? false : undefined,
        targets: freeDragTargets(stage, measured, group)
      });
    } else {
      next = startFreeDrag({
        hadHeight: node.place.h !== undefined,
        id,
        mode,
        origin,
        rect: freeRectOfPlace(node.place, measured[id]?.h),
        rotate: node.place.rotate ?? 0,
        scale: screen,
        targets: freeDragTargets(stage, measured, [id])
      });
    }

    dragScroll.current = scroll;
    dragLast.current = null;
    sessionRef.current = next;
    setSession(next);
  }

  /**
   * Fim do arrastar do solto: soltar (com o ponto do pointerup) grava num passo, de um (onCommitRect) ou do grupo
   * (onCommitMoves, o deslocamento inteiro); Esc, pointercancel e blur so limpam. O lostpointercapture nao grava.
   */
  function endDrag(commit: boolean, client?: FreePoint) {
    if (commit && client) {
      moveDrag(client, dragLast.current?.keys ?? NO_KEYS);
    }

    const current = sessionRef.current;

    sessionRef.current = null;
    dragScroll.current = null;
    dragLast.current = null;
    setSession(null);

    if (!commit || !current || disabledRef.current) {
      return;
    }

    if (current.ids) {
      const delta = finishFreeDragDelta(current);

      if (delta && (delta.dx !== 0 || delta.dy !== 0)) {
        onCommitMovesRef.current?.(current.ids, delta);
      }

      return;
    }

    const patch = finishFreeDrag(current);

    if (patch) {
      onCommitRectRef.current(current.id, patch, current.mode === "move" ? "move" : "resize");
    }
  }

  /**
   * Segue o arrastar de um solto pelo corpo (com `ids`, o grupo) ou de uma alca, com followFreePointer (mouse, caneta e
   * toque: o cartao tem touch-action: none, decisao 5), a 3 px de tela e com a area rolando sozinha perto da borda. A
   * captura e a sessao so vem depois do limiar (startDrag).
   */
  function beginDrag(event: ReactPointerEvent<HTMLElement>, id: FreeId, mode: FreeDragMode, ids?: readonly FreeId[]) {
    // Um ponteiro por vez: um gesto comecado (de um solto ou da sequencia) segue ate o fim, e um segundo dedo (numa
    // alca) nao desliga o do primeiro.
    if (sessionRef.current || flowRef.current || !event.isPrimary) {
      return;
    }

    // O gesto de um pointerdown de antes que ainda esperava o limiar sai (C13).
    dragDispose.current?.();
    dragDispose.current = null;

    const node = freeNodeOf(design, id);

    if (disabled || !node || !isFreeMovable(node) || node.place?.mode !== "free") {
      return;
    }

    const view = viewportRef.current;
    const origin = { x: event.clientX, y: event.clientY };
    const scroll = { x: view?.scrollLeft ?? 0, y: view?.scrollTop ?? 0 };

    dragDispose.current = followFreePointer(event, {
      autoScroll: () => viewportRef.current,
      onCancel: () => endDrag(false),
      onDrop: (client) => endDrag(true, client),
      onMove: moveDrag,
      onStart: () => startDrag(id, mode, ids ?? [], origin, scroll),
      pointerTypes: FREE_POINTER_MOUSE_PEN_AND_TOUCH,
      threshold: FREE_DRAG_START_PX
    });
  }

  /**
   * Segue o arrastar de um elemento da sequencia, pelo corpo (currentTarget = o cartao) ou pela alca da barrinha. So
   * com o editor ligado e quando freeFlowDraggable deixa: um elemento da sequencia nao travado e medido, fora de um
   * solto girado (ali nao ha lugar para ele: o gesto nao comeca). A captura e a foto so vem depois de 6 px (startFlow).
   */
  function beginFlowDrag(event: ReactPointerEvent<HTMLElement>, id: FreeId) {
    // Um gesto comecado segue ate o fim: o pointerdown de outro ponteiro (um toque com o mouse apertado) nao o desliga.
    if (flowRef.current || disabled || !onMoveInFlow || !freeFlowDraggable(design, rects, id)) {
      return;
    }

    flowDispose.current?.();
    flowDispose.current = followFreePointer(event, {
      autoScroll: () => viewportRef.current,
      onCancel: () => endFlow(null),
      onDrop: (client) => endFlow(client),
      onMove: (client) => {
        updateFlow(client);
      },
      onStart: () => startFlow(id),
      pointerTypes: FREE_POINTER_MOUSE_AND_PEN,
      threshold: FREE_FLOW_DRAG_START_PX
    });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // Arrastando da sequencia, outro ponteiro (um toque, a caneta) nao seleciona nem desliga o gesto (beginFlowDrag).
    if (event.button !== 0 || flowRef.current) {
      return;
    }

    // Arrastando um solto (ou varios), tambem nao: um ponteiro por vez.
    if (sessionRef.current) {
      return;
    }

    // Um segundo dedo (isPrimary false) nao escolhe nem desliga o gesto que o primeiro ainda pode comecar.
    if (!event.isPrimary) {
      return;
    }

    clickRef.current = null;

    const target = event.target as Element;

    if (target.closest("[data-free-overlay-control]")) {
      return;
    }

    const hit = target.closest<HTMLElement>("[data-free-id]");
    const id = hit && wrapRef.current?.contains(hit) ? (hit.dataset.freeId ?? null) : null;
    // O principal de ANTES deste pointerdown vai para o click do Alt (o ciclo da pilha anda a partir dele).
    const press = freeCanvasPress({
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      design,
      id,
      metaKey: event.metaKey,
      principal: selectedId,
      selection: liveIds,
      shiftKey: event.shiftKey
    });

    clickRef.current = press.click ? { origin: { x: event.clientX, y: event.clientY }, plan: press.click } : null;

    if (press.select) {
      onSelect(press.select.id, press.select.mode === "toggle" ? { mode: "toggle" } : undefined);
    }

    // Um solto muda X/Y (beginDrag; com `ids`, o grupo todo); um elemento da sequencia muda de lugar na ordem
    // (beginFlowDrag). Com Shift, Ctrl ou ⌘ nada arrasta.
    if (press.drag) {
      beginDrag(event, press.drag.id, "move", press.drag.ids);
      beginFlowDrag(event, press.drag.id);
    }
  }

  /**
   * O click do cartao que nao passou do limiar (o de um gesto comecado o ajudante engole): o grupo mantido no
   * pointerdown fica so com ele, e o Alt + clique anda na pilha do ponto (C2). A pilha so e lida aqui.
   */
  function onClick(event: ReactMouseEvent<HTMLDivElement>) {
    const pending = clickRef.current;
    const wrap = wrapRef.current;

    clickRef.current = null;

    if (!pending || !wrap || (event.target as Element).closest("[data-free-overlay-control]")) {
      return;
    }

    // Andou o limiar sem gesto (um elemento que nao arrasta): nao foi um clique.
    if (Math.hypot(event.clientX - pending.origin.x, event.clientY - pending.origin.y) >= FREE_DRAG_START_PX) {
      return;
    }

    const stack = pending.plan.kind === "stack" ? freeStackAt(wrap, { x: event.clientX, y: event.clientY }) : [];
    const chosen = freeCanvasClickSelect(pending.plan, stack);

    if (chosen) {
      onSelect(chosen.id, chosen.how);
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    // Arrastando (um solto, varios ou da sequencia): o contorno de passar o mouse fica desligado (o ajudante segue o
    // gesto na janela).
    if (sessionRef.current || flowRef.current) {
      return;
    }

    const hit = (event.target as Element).closest<HTMLElement>("[data-free-id]");
    const id = hit && wrapRef.current?.contains(hit) ? (hit.dataset.freeId ?? null) : null;

    if (id !== hoverId) {
      setHoverId(id);
    }
  }

  function onDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    // Com Alt (a pilha), Shift, Ctrl ou ⌘ (por e tirar), o duplo clique nao abre o texto.
    if (event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const hit = (event.target as Element).closest<HTMLElement>("[data-free-id]");
    const id = hit?.dataset.freeId;
    const node = id ? freeNodeOf(design, id) : null;

    if (id && node && !node.locked && (node.type === "heading" || node.type === "text" || node.type === "badge" || node.type === "button")) {
      onEditText(id);
    }
  }

  /* --------------------------------------------------------------------------------------------
   * Camada de selecao
   * ------------------------------------------------------------------------------------------ */

  const selectedNode = freeNodeOf(design, selectedId);
  const preview = freeDragPreview(session);
  const sessionRect = session?.last?.rect ?? null;
  const selectedRect: FreeRect | null = selectedNode
    ? session && session.id === selectedNode.id && sessionRect
      ? sessionRect
      : selectedNode.place?.mode === "free"
        ? freeRectOfPlace(selectedNode.place, rects[selectedNode.id]?.h)
        : (rects[selectedNode.id] ?? null)
    : null;
  const hoverRect = hoverId && !liveIds.includes(hoverId) && !flowDragging && !session && !dropView ? (rects[hoverId] ?? null) : null;
  const rotate = selectedNode?.place?.mode === "free" ? (selectedNode.place.rotate ?? 0) : 0;
  const toLayout = (rect: FreeRect): CSSProperties => ({
    height: rect.h * frame.k,
    left: frame.clientLeft + rect.x * frame.k,
    top: frame.clientTop + rect.y * frame.k,
    width: rect.w * frame.k
  });
  const movable = Boolean(selectedNode && isFreeMovable(selectedNode) && !disabled);
  const flowSelected = Boolean(selectedNode && selectedNode.place?.mode !== "free" && !selectedNode.locked && !disabled);
  const canMoveInFlow = Boolean(onMoveInFlow);
  // A alca so aparece quando o arrastar pode comecar (num filho de um solto girado, nao: ali ficam as Camadas, o Subir
  // e o Descer e o ⋯). Calculada uma vez por selecao (e quando o design ou as medidas mudam), nao a cada desenho.
  const flowGrip = useMemo(
    () => canMoveInFlow && !disabled && selectedId !== null && freeFlowDraggable(design, rects, selectedId),
    [canMoveInFlow, design, disabled, rects, selectedId]
  );
  const handleSize = 9 * layoutPerScreen;
  const artboardRect = rects["@artboard"];

  let overlay: ReactNode = null;

  if (many) {
    // Varios: um contorno por item que se ve neste aparelho (o solto pelo design, seguindo a previa do grupo; o da
    // sequencia pela medida) e a caixa tracejada do grupo com a etiqueta de quantos, sem alcas nem barrinha.
    const items = liveIds.flatMap((id) => {
      const node = freeNodeOf(design, id);
      const measured = rects[id];

      if (!node || !measured) {
        return [];
      }

      const free = node.place?.mode === "free" ? node.place : null;
      const base = free ? freeRectOfPlace(free, measured.h) : measured;
      const rect = preview?.ids?.includes(id) ? { ...base, x: base.x + preview.dx, y: base.y + preview.dy } : base;

      return [{ id, rect, rotate: free?.rotate ?? 0 }];
    });
    const bounds = freeBoundsOf(items.map((item) => freeVisualRect(item.rect, item.rotate)));

    overlay = (
      <>
        {items.map((item) => (
          <div
            className="pointer-events-none absolute"
            data-free-selection-item={item.id}
            key={item.id}
            style={{
              ...toLayout(item.rect),
              outline: `${2 * layoutPerScreen}px solid var(--focus-ring)`,
              outlineOffset: 0,
              transform: item.rotate ? `rotate(${item.rotate}deg)` : undefined,
              transformOrigin: "center"
            }}
          />
        ))}
        {bounds ? (
          <div
            className="pointer-events-none absolute"
            data-free-selection-group=""
            style={{ ...toLayout(bounds), outline: `${layoutPerScreen}px dashed var(--focus-ring)`, outlineOffset: 4 * layoutPerScreen }}
          >
            <span
              aria-hidden="true"
              className="absolute left-0 flex items-center whitespace-nowrap"
              style={{ bottom: "100%", marginBottom: 8 * layoutPerScreen, transform: `scale(${layoutPerScreen})`, transformOrigin: "bottom left" }}
            >
              <span className="rounded-sm bg-[var(--focus-ring)] px-1.5 text-[12px] leading-[18px] font-medium text-[#0f0f10]" data-free-selection-group-tag="">
                {FREE_SELECTION_COPY.groupTag(liveIds.length)}
              </span>
            </span>
          </div>
        ) : null}
      </>
    );
  } else if (selectedNode && selectedRect) {
    const label = freeLayerLabel(selectedNode, popup.cta ? { href: popup.cta.href, label: popup.cta.label, target: popup.cta.target } : null);
    const mobileTag = Object.keys(freeMobileNodeOf(design, selectedNode.id) ?? {}).length > 0;

    overlay = (
      <div
        className="pointer-events-none absolute"
        data-free-selection={selectedNode.id}
        style={{ ...toLayout(selectedRect), transform: rotate ? `rotate(${rotate}deg)` : undefined, transformOrigin: "center" }}
      >
        <div className="absolute inset-0" style={{ outline: `${2 * layoutPerScreen}px solid var(--focus-ring)`, outlineOffset: 0 }} />
        <span
          aria-hidden="true"
          className="absolute left-0 flex items-center gap-1 whitespace-nowrap"
          style={{ bottom: "100%", marginBottom: 4 * layoutPerScreen, transform: `scale(${layoutPerScreen})`, transformOrigin: "bottom left" }}
        >
          <span className="rounded-sm bg-[var(--focus-ring)] px-1.5 text-[12px] leading-[18px] font-medium text-[#0f0f10]">{label}</span>
          {mobileTag ? (
            <span className="rounded-sm border border-[var(--border-strong)] bg-[var(--surface-3)] px-1.5 text-[12px] leading-4 font-medium text-[var(--text-primary)]" data-free-selection-mobile="">
              {copy.layers.tags.mobile}
            </span>
          ) : null}
        </span>
        {movable
          ? FREE_RESIZE_HANDLES.map((handle) => (
              <span
                aria-hidden="true"
                className="pointer-events-auto rounded-[2px] border border-[#0f0f10] bg-[var(--focus-ring)]"
                data-free-handle={handle}
                data-free-overlay-control=""
                key={handle}
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return;
                  }

                  // Antes de qualquer regra de tecla (C14): o cartao nunca ve este pointerdown, entao o Shift aqui e a
                  // proporcao (no onMove) e nao o "por ou tirar" da selecao.
                  event.stopPropagation();
                  beginDrag(event, selectedNode.id, handle);
                }}
                style={handleStyle(handle, handleSize)}
                title={copy.stage.resize(FREE_HANDLE_LABELS[handle])}
              />
            ))
          : null}
        {flowSelected ? (
          <div
            aria-label={copy.toolbar.label}
            // Arrastando da sequencia, a barrinha fica montada (a alca pode ter a captura do ponteiro) e invisivel.
            className={cn(
              "pointer-events-auto absolute right-0 flex items-center gap-0.5 rounded-md border border-[var(--border-strong)] bg-[var(--surface-3)] p-0.5 shadow-lg",
              flowDragging && "invisible"
            )}
            data-free-overlay-control=""
            role="toolbar"
            style={{ bottom: "100%", marginBottom: 4 * layoutPerScreen, transform: `scale(${layoutPerScreen})`, transformOrigin: "bottom right" }}
          >
            {/* A alca: o jeito de pegar uma caixa coberta pelos filhos (o mouse cai sempre no de dentro). So quando o
                arrastar pode comecar (flowGrip). */}
            {flowGrip ? (
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-7 touch-none place-items-center rounded text-[var(--text-secondary)] hover:bg-[var(--press-overlay)]",
                  flowDragging ? "cursor-grabbing" : "cursor-grab"
                )}
                data-free-flow-grip=""
                data-free-overlay-control=""
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return;
                  }

                  event.stopPropagation();
                  beginFlowDrag(event, selectedNode.id);
                }}
                title={copy.toolbar.drag}
              >
                <GripVertical className="size-3.5" />
              </span>
            ) : null}
            <ToolbarButton icon={<ArrowUp className="size-3.5" />} label={copy.toolbar.moveUp} onClick={() => onToolbar("moveUp", selectedNode.id)} reason={toolbarDisabled.moveUp} />
            <ToolbarButton icon={<ArrowDown className="size-3.5" />} label={copy.toolbar.moveDown} onClick={() => onToolbar("moveDown", selectedNode.id)} reason={toolbarDisabled.moveDown} />
            <ToolbarButton icon={<Copy className="size-3.5" />} label={copy.toolbar.duplicate} onClick={() => onToolbar("duplicate", selectedNode.id)} reason={toolbarDisabled.duplicate} />
            <ToolbarButton icon={<Move className="size-3.5" />} label={copy.toolbar.toFree} onClick={() => onToolbar("toFree", selectedNode.id)} reason={toolbarDisabled.toFree} />
            <ToolbarButton icon={<Trash2 className="size-3.5" />} label={copy.toolbar.remove} onClick={() => onToolbar("remove", selectedNode.id)} reason={toolbarDisabled.remove} />
          </div>
        ) : null}
      </div>
    );
  }

  const guides = session?.last?.guides ?? [];
  const isPhone = device === "mobile";
  const dropThickness = 2 * layoutPerScreen;
  let dropIndicator: ReactNode = null;

  if (dropView) {
    const { line } = dropView;
    // Sem linha (o mesmo lugar, com uma caixa cheia sob o ponteiro), o motivo fica embaixo de quem recusou.
    const anchor = line ?? dropView.newRect ?? dropView.box ?? (dropView.blocked ? (rects[dropView.blocked.id] ?? null) : null);
    const dashed = (thickness: number): CSSProperties => ({ outline: `${thickness}px dashed var(--focus-ring)`, outlineOffset: 0 });
    // A linha de onde entra: deitada na coluna (h 0), em pe na linha (w 0); 2 px de tela, a cor do foco (as guias sao rosa).
    const lineStyle: CSSProperties | null = line
      ? line.w === 0 && line.h > 0
        ? { height: line.h * frame.k, left: frame.clientLeft + line.x * frame.k - dropThickness / 2, top: frame.clientTop + line.y * frame.k, width: dropThickness }
        : { height: dropThickness, left: frame.clientLeft + line.x * frame.k, top: frame.clientTop + line.y * frame.k - dropThickness / 2, width: Math.max(line.w * frame.k, dropThickness) }
      : null;

    dropIndicator = (
      <>
        {dropView.origin ? <div className="absolute rounded-[2px] bg-[rgba(10,10,11,0.55)]" data-free-flow-origin="" style={toLayout(dropView.origin)} /> : null}
        {dropView.empties.map((rect, index) => (
          <div className="absolute" data-free-drop-empty="" key={`vazia-${index}`} style={{ ...toLayout(rect), ...dashed(layoutPerScreen) }} />
        ))}
        {dropView.box ? <div className="absolute" data-free-drop-target="" style={{ ...toLayout(dropView.box), ...dashed(dropThickness) }} /> : null}
        {dropView.newRect ? <div className="absolute" data-free-drop-new="" style={{ ...toLayout(dropView.newRect), ...dashed(dropThickness) }} /> : null}
        {lineStyle ? <div className="absolute rounded-full bg-[var(--focus-ring)]" data-free-drop-line="" style={lineStyle} /> : null}
        {anchor && (dropView.blocked || dropView.both) ? (
          <span
            aria-hidden="true"
            className="absolute flex items-center gap-1 whitespace-nowrap"
            style={{
              left: frame.clientLeft + anchor.x * frame.k,
              marginTop: 4 * layoutPerScreen,
              top: frame.clientTop + (anchor.y + anchor.h) * frame.k,
              transform: `scale(${layoutPerScreen})`,
              transformOrigin: "top left"
            }}
          >
            {dropView.blocked ? (
              <span className="rounded-sm border border-[var(--border-strong)] bg-[var(--surface-3)] px-1.5 text-[12px] leading-[18px] font-medium text-[var(--text-primary)]" data-free-drop-hint="">
                {dropView.blocked.reason}
              </span>
            ) : null}
            {dropView.both ? (
              <span className="rounded-sm border border-[var(--border-strong)] bg-[var(--surface-3)] px-1.5 text-[12px] leading-[18px] font-medium text-[var(--text-primary)]" data-free-drop-both="">
                {copy.drag.alsoDesktopTag}
              </span>
            ) : null}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <div
      className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-[#0a0a0b] [background-image:radial-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:16px_16px]"
      data-free-zone="canvas"
      ref={viewportRef}
    >
      {/* A moldura cresce com o palco (w-max) e nunca fica menor que a area (min-w-full): com zoom alto o palco nao
          transborda para a esquerda (la a rolagem nao alcanca). */}
      <div className="flex min-h-full w-max min-w-full items-start justify-center p-6">
        <div className="relative shrink-0" style={{ height: (stageSize.h || 600) * scale, width: stageWidth * scale }}>
          <div
            aria-describedby={descriptionId}
            aria-label={copy.stage.label}
            className="absolute top-0 left-0 rounded-[2px] outline-offset-4"
            data-free-stage=""
            ref={stageRef}
            role="group"
            style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: stageWidth }}
            tabIndex={0}
          >
            <span className="sr-only" id={descriptionId}>
              {description}
            </span>
            <div
              className={cn(
                "flex w-full flex-col",
                isPhone ? "min-h-[667px] justify-center rounded-[36px] bg-[#050506] py-10 shadow-[0_0_0_1px_var(--border-strong)]" : "py-8"
              )}
              ref={contentRef}
              style={{ containerType: "inline-size" }}
            >
              <div
                className={cn("relative mx-auto w-fit touch-none select-none", session ? (session.mode === "move" ? "cursor-grabbing" : "") : flowDragging ? "cursor-grabbing" : "")}
                data-free-canvas-card=""
                onClick={onClick}
                onContextMenu={(event) => {
                  // No Mac, Ctrl + clique abre o menu de contexto: aqui ele poe ou tira da selecao (no pointerdown).
                  if (event.ctrlKey) {
                    event.preventDefault();
                  }
                }}
                onDoubleClick={onDoubleClick}
                onPointerDown={onPointerDown}
                onPointerLeave={() => setHoverId(null)}
                onPointerMove={onPointerMove}
                ref={wrapRef}
              >
                <PopupFreeCard
                  design={design}
                  device={device}
                  dragPreview={preview}
                  editorNodeRef={editorNodeRef}
                  fonts={fonts}
                  playing={false}
                  popup={popup}
                  preview
                />
                <div className="pointer-events-none absolute inset-0" data-free-overlay="">
                  {hoverRect ? (
                    <div className="absolute" style={{ ...toLayout(hoverRect), outline: `${layoutPerScreen}px solid rgba(245,245,244,0.55)` }} />
                  ) : null}
                  {overlay}
                  {guides.map((guide) =>
                    guide.axis === "x" ? (
                      <div
                        className="absolute"
                        key={`x${guide.at}`}
                        style={{ background: GUIDE_COLOR, height: (artboardRect?.h ?? 0) * frame.k, left: frame.clientLeft + guide.at * frame.k, top: frame.clientTop, width: layoutPerScreen }}
                      />
                    ) : (
                      <div
                        className="absolute"
                        key={`y${guide.at}`}
                        style={{ background: GUIDE_COLOR, height: layoutPerScreen, left: frame.clientLeft, top: frame.clientTop + guide.at * frame.k, width: (artboardRect?.w ?? width) * frame.k }}
                      />
                    )
                  )}
                  {dropIndicator}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({ icon, label, onClick, reason }: { icon: ReactNode; label: string; onClick: () => void; reason?: string | null }) {
  const off = reason !== undefined && reason !== null;

  return (
    <button
      aria-disabled={off || undefined}
      aria-label={off && reason ? `${label} (${reason})` : label}
      className={cn("grid size-7 place-items-center rounded text-[var(--text-primary)] hover:bg-[var(--press-overlay)]", off && "cursor-not-allowed opacity-40")}
      data-free-toolbar={label}
      onClick={(event) => {
        event.stopPropagation();

        if (!off) {
          onClick();
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      title={off && reason ? reason : label}
      type="button"
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}

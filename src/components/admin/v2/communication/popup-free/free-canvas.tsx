"use client";

import { ArrowDown, ArrowUp, Copy, Move, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
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
import { findFreeNode, walkFreeNodes, type FreeId, type PopupFreeDesign } from "@/server/communications/popup-free-model";
import type { FreeMeasuredRects } from "@/server/communications/popup-free-checks";
import {
  FREE_PHONE_FRAME_PX,
  FREE_RESIZE_HANDLES,
  finishFreeDrag,
  freeDesktopStageWidth,
  freeDragPreview,
  freeFitZoom,
  freeRectOfPlace,
  freeSnapTargets,
  startFreeDrag,
  updateFreeDrag,
  type FreeDragMode,
  type FreeDragSession,
  type FreeRect,
  type FreeResizeHandle
} from "./free-editor-geometry";
import { FREE_EDITOR_COPY, FREE_HANDLE_LABELS, freeLayerLabel, freeNodeOf, isFreeMovable } from "./free-editor-model";

// Area de desenho do editor Livre (spec §4.4): o MESMO PopupFreeCard do aluno, em previa, dentro de um palco com
// container-type: inline-size (Computador = max(W + 32, 600) px; Celular = moldura de 375 px, cartao de 343 px,
// como no aluno). O zoom e transform: scale() no palco (as unidades cqw nao mudam); a escala das contas do
// ponteiro = largura medida da prancheta / W. Camada de selecao por cima (sem receber clique, menos as alcas e a
// barrinha): contorno do elemento sob o mouse, contorno de 2 px do selecionado com a etiqueta do nome, 8 alcas nos
// soltos, guias de alinhamento e a barrinha dos elementos da sequencia. Durante o arrastar o design nao muda: o
// cartao desenha so aquele elemento deslocado (dragPreview) e o design muda uma vez, no fim.

const copy = FREE_EDITOR_COPY;

export type FreeCanvasToolbarCommand = "duplicate" | "moveDown" | "moveUp" | "remove" | "toFree";

export type FreeCanvasApi = {
  /** O centro do que se ve no palco, em px da prancheta (a Forma nova entra ali). */
  visibleCenter: () => { x: number; y: number } | null;
};

export type FreeCanvasProps = {
  apiRef?: RefObject<FreeCanvasApi | null>;
  description: string;
  design: PopupFreeDesign;
  device: "desktop" | "mobile";
  disabled: boolean;
  fonts: readonly PopupFontFace[];
  onCommitRect: (id: FreeId, rect: Partial<FreeRect>, kind: "move" | "resize") => void;
  onEditText: (id: FreeId) => void;
  onRectsChange: (rects: FreeMeasuredRects) => void;
  onSelect: (id: FreeId | null) => void;
  onToolbar: (command: FreeCanvasToolbarCommand, id: FreeId) => void;
  popup: PopupItem;
  rects: FreeMeasuredRects;
  selectedId: FreeId | null;
  stageRef: RefObject<HTMLDivElement | null>;
  toolbarDisabled: Partial<Record<FreeCanvasToolbarCommand, string | null>>;
  zoom: "100" | "fit";
};

/** Medidas da prancheta no palco: px de layout por px da prancheta (1 no Computador; 343/W no Celular) e a borda. */
type Frame = { clientLeft: number; clientTop: number; k: number };

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
  onCommitRect,
  onEditText,
  onRectsChange,
  onSelect,
  onToolbar,
  popup,
  rects,
  selectedId,
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
  const lastRects = useRef<FreeMeasuredRects>(rects);
  const [frame, setFrame] = useState<Frame>({ clientLeft: 0, clientTop: 0, k: 1 });
  const [stageSize, setStageSize] = useState({ h: 0, w: 0 });
  const [viewport, setViewport] = useState({ h: 0, w: 0 });
  const [hoverId, setHoverId] = useState<FreeId | null>(null);
  const [session, setSession] = useState<FreeDragSession | null>(null);
  const sessionRef = useRef<FreeDragSession | null>(null);
  const designRef = useRef(design);
  const onRectsChangeRef = useRef(onRectsChange);
  const stageWidth = device === "mobile" ? FREE_PHONE_FRAME_PX : freeDesktopStageWidth(width);
  const scale = zoom === "100" ? 1 : freeFitZoom(viewport, { h: stageSize.h || 600, w: stageWidth });
  const layoutPerScreen = 1 / scale;

  useLayoutEffect(() => {
    designRef.current = design;
    onRectsChangeRef.current = onRectsChange;
  });

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

  useEffect(() => {
    if (!apiRef) {
      return;
    }

    apiRef.current = {
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
      }
    };

    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);

  /* --------------------------------------------------------------------------------------------
   * Ponteiro
   * ------------------------------------------------------------------------------------------ */

  function screenScaleNow(): number {
    const artboard = wrapRef.current?.querySelector<HTMLElement>("[data-free-artboard]");

    return artboard ? artboard.getBoundingClientRect().width / width || 1 : 1;
  }

  function targetsFor(id: FreeId) {
    const others: FreeRect[] = [];

    walkFreeNodes(design.children, (node, info) => {
      if (info.depth === 1 && node.id !== id && !node.hidden && node.place?.mode === "free" && !node.place.rotate) {
        const measured = rects[node.id];

        others.push(freeRectOfPlace(node.place, measured?.h));
      }
    });

    const artboard = rects["@artboard"] ?? { h: 400, w: width, x: 0, y: 0 };

    return freeSnapTargets({ h: artboard.h, w: artboard.w }, others);
  }

  function beginDrag(event: ReactPointerEvent<HTMLElement>, id: FreeId, mode: FreeDragMode) {
    const node = freeNodeOf(design, id);

    if (disabled || !node || !isFreeMovable(node) || node.place?.mode !== "free") {
      return;
    }

    const next = startFreeDrag({
      hadHeight: node.place.h !== undefined,
      id,
      mode,
      origin: { x: event.clientX, y: event.clientY },
      rect: freeRectOfPlace(node.place, rects[id]?.h),
      rotate: node.place.rotate ?? 0,
      scale: screenScaleNow(),
      targets: targetsFor(id)
    });

    sessionRef.current = next;
    setSession(next);

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Sem captura (ponteiro ja solto): o arrastar termina no proximo pointerup que chegar aqui.
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as Element;

    if (target.closest("[data-free-overlay-control]")) {
      return;
    }

    const hit = target.closest<HTMLElement>("[data-free-id]");
    const id = hit && wrapRef.current?.contains(hit) ? (hit.dataset.freeId ?? null) : null;

    onSelect(id);

    if (id) {
      beginDrag(event, id, "move");
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = sessionRef.current;

    if (current) {
      const next = updateFreeDrag(current, { x: event.clientX, y: event.clientY }, { altKey: event.altKey, shiftKey: event.shiftKey });

      if (next !== current) {
        sessionRef.current = next;
        setSession(next);
      }

      return;
    }

    const hit = (event.target as Element).closest<HTMLElement>("[data-free-id]");
    const id = hit && wrapRef.current?.contains(hit) ? (hit.dataset.freeId ?? null) : null;

    if (id !== hoverId) {
      setHoverId(id);
    }
  }

  function endDrag(commit: boolean) {
    const current = sessionRef.current;

    sessionRef.current = null;
    setSession(null);

    if (!commit || !current) {
      return;
    }

    const patch = finishFreeDrag(current);

    if (patch) {
      onCommitRect(current.id, patch, current.mode === "move" ? "move" : "resize");
    }
  }

  function onDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
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
  const hoverRect = hoverId && hoverId !== selectedId && !session ? (rects[hoverId] ?? null) : null;
  const rotate = selectedNode?.place?.mode === "free" ? (selectedNode.place.rotate ?? 0) : 0;
  const toLayout = (rect: FreeRect): CSSProperties => ({
    height: rect.h * frame.k,
    left: frame.clientLeft + rect.x * frame.k,
    top: frame.clientTop + rect.y * frame.k,
    width: rect.w * frame.k
  });
  const movable = Boolean(selectedNode && isFreeMovable(selectedNode) && !disabled);
  const flowSelected = Boolean(selectedNode && selectedNode.place?.mode !== "free" && !selectedNode.locked && !disabled);
  const handleSize = 9 * layoutPerScreen;
  const artboardRect = rects["@artboard"];

  let overlay: ReactNode = null;

  if (selectedNode && selectedRect) {
    const label = freeLayerLabel(selectedNode, popup.cta ? { href: popup.cta.href, label: popup.cta.label, target: popup.cta.target } : null);

    overlay = (
      <div
        className="pointer-events-none absolute"
        data-free-selection={selectedNode.id}
        style={{ ...toLayout(selectedRect), transform: rotate ? `rotate(${rotate}deg)` : undefined, transformOrigin: "center" }}
      >
        <div className="absolute inset-0" style={{ outline: `${2 * layoutPerScreen}px solid var(--focus-ring)`, outlineOffset: 0 }} />
        <span
          aria-hidden="true"
          className="absolute left-0 rounded-sm bg-[var(--focus-ring)] px-1.5 text-[11px] leading-[18px] font-medium whitespace-nowrap text-[#0f0f10]"
          style={{ bottom: "100%", marginBottom: 4 * layoutPerScreen, transform: `scale(${layoutPerScreen})`, transformOrigin: "bottom left" }}
        >
          {label}
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
            className="pointer-events-auto absolute right-0 flex items-center gap-0.5 rounded-md border border-[var(--border-strong)] bg-[var(--surface-3)] p-0.5 shadow-lg"
            data-free-overlay-control=""
            role="toolbar"
            style={{ bottom: "100%", marginBottom: 4 * layoutPerScreen, transform: `scale(${layoutPerScreen})`, transformOrigin: "bottom right" }}
          >
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

  return (
    <div
      className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-[#0a0a0b] [background-image:radial-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:16px_16px]"
      data-free-zone="canvas"
      ref={viewportRef}
    >
      <div className="flex min-h-full min-w-full items-start justify-center p-6">
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
                className={cn("relative mx-auto w-fit touch-none select-none", session ? (session.mode === "move" ? "cursor-grabbing" : "") : "")}
                data-free-canvas-card=""
                onDoubleClick={onDoubleClick}
                onLostPointerCapture={() => {
                  if (sessionRef.current) {
                    endDrag(true);
                  }
                }}
                onPointerCancel={() => endDrag(false)}
                onPointerDown={onPointerDown}
                onPointerLeave={() => setHoverId(null)}
                onPointerMove={onPointerMove}
                onPointerUp={() => endDrag(true)}
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

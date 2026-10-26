"use client";

import {
  Blend,
  Columns3,
  Heading,
  Image as ImageIcon,
  Minus,
  MousePointerClick,
  MoveVertical,
  Pilcrow,
  RectangleHorizontal,
  Rows3,
  Sparkles,
  Square,
  Tag,
  Video,
  type LucideIcon
} from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import type { PopupFreeDesign } from "@/server/communications/popup-free-model";
import { FREE_LIST_DRAG_START_PX, type FreePoint } from "./free-editor-geometry";
import { FREE_EDITOR_COPY, FREE_ELEMENT_GROUPS, freeElementDisabledReason, type FreeCatalogItem, type FreeCatalogKind } from "./free-editor-model";
import { followFreePointer } from "./free-pointer-drag";

// Painel "Elementos" do editor Livre (spec §4.3; docs/27 §13.9, L4a): botoes de 72 x 64 px com icone e nome, em
// grupos. Clicar (ou Enter) acrescenta como sempre; arrastar um botao ate o desenho poe o elemento onde foi solto. O
// gesto e so do mouse (followFreePointer, a partir de 4 px): o desenho mostra onde entra (onDragMove leva ao previewDrop
// do editor) e o soltar chama onDragEnd com o ponto, que acrescenta pelo mesmo caminho do clique; Esc, soltar fora
// da prancheta ou o design mudado no meio nao acrescentam. Uma ficha com o icone e o nome segue o ponteiro (portal no
// editor, sem receber ponteiro e escondida do leitor de tela). O click que vem depois de um arrastar e engolido pelo
// ajudante, entao nunca entra duas vezes. Um botao no limite fica desligado com a frase do limite e nunca arrasta, mas
// continua focavel (aria-disabled), para quem usa teclado ou leitor de tela ouvir o motivo.
// L4b (docs/27 L44): com autoScrollTarget (a area de desenho), a area rola sozinha perto da borda enquanto o botao e
// arrastado; o ajudante refaz o onMove com o ultimo ponto quando ela rola, e o desenho mostra o lugar de novo. A
// rolagem so se arma depois que o ponto esteve dentro da area e fora da faixa da borda (C10): entrar pela esquerda
// vindo daqui nao rola.

const ICONS: Record<FreeCatalogKind, LucideIcon> = {
  badge: Tag,
  button: RectangleHorizontal,
  column: Rows3,
  cta: MousePointerClick,
  divider: Minus,
  gradient: Blend,
  heading: Heading,
  icon: Sparkles,
  image: ImageIcon,
  row: Columns3,
  shape: Square,
  spacer: MoveVertical,
  text: Pilcrow,
  video: Video
};

/** Distancia (px de tela) da ficha ate a ponta do ponteiro: o lugar de soltar no desenho fica a vista. */
const CHIP_OFFSET_PX = 12;

export type FreeElementsPanelProps = {
  /** A area que rola sozinha perto da borda durante o arrastar (a area de desenho); lida a cada quadro do gesto. */
  autoScrollTarget?: () => Element | null;
  design: PopupFreeDesign;
  disabled: boolean;
  onAdd: (kind: FreeCatalogKind) => void;
  /** Arrastando um botao ate o desenho: o ponteiro (px de tela) a cada movimento; o desenho mostra onde entra. */
  onDragMove?: (kind: FreeCatalogKind, client: FreePoint) => void;
  /** Fim do arrastar: o ponto do soltar (o editor acrescenta ali) ou null (cancelado: nada entra). */
  onDragEnd?: (kind: FreeCatalogKind, client: FreePoint | null) => void;
};

/** O arrastar que passou do limiar: o que a ficha mostra e onde ela entra (o editor, por portal). */
type FreeElementDrag = FreeCatalogItem & { host: Element };

/**
 * Um gesto seguido: pending (antes do limiar, ainda pode ser clique), dragging (a ficha anda) ou done. `stop` desliga
 * o gesto sem acrescentar nada (e, se a ficha ja andava, limpa a ficha e o lugar mostrado no desenho).
 */
type FreeElementGesture = { state: "done" | "dragging" | "pending"; stop: () => void };

export function FreeElementsPanel({ autoScrollTarget, design, disabled, onAdd, onDragEnd, onDragMove }: FreeElementsPanelProps) {
  const baseId = useId();
  const [drag, setDrag] = useState<FreeElementDrag | null>(null);
  const chipRef = useRef<HTMLDivElement | null>(null);
  const pointRef = useRef<FreePoint | null>(null);
  const frameRef = useRef<number | null>(null);
  const gestureRef = useRef<FreeElementGesture | null>(null);
  // O design, o disabled e as funcoes de agora: o gesto comeca numa renderizacao e termina em outra.
  const latestRef = useRef({ autoScrollTarget, design, disabled, onDragEnd, onDragMove });

  useLayoutEffect(() => {
    latestRef.current = { autoScrollTarget, design, disabled, onDragEnd, onDragMove };
  });

  /** Leva a ficha ate o ultimo ponto do ponteiro (no maximo uma vez por quadro). */
  const placeChip = useCallback(() => {
    frameRef.current = null;

    const chip = chipRef.current;
    const point = pointRef.current;

    if (chip && point) {
      chip.style.transform = `translate3d(${Math.round(point.x + CHIP_OFFSET_PX)}px, ${Math.round(point.y + CHIP_OFFSET_PX)}px, 0)`;
    }
  }, []);

  // A ficha nasce ja no lugar do ponteiro (antes de pintar), e nao no canto da tela.
  useLayoutEffect(() => {
    if (drag) {
      placeChip();
    }
  }, [drag, placeChip]);

  // Ao desmontar no meio de um arrastar: desliga o gesto e limpa o lugar mostrado no desenho (nada entra).
  useEffect(
    () => () => {
      gestureRef.current?.stop();
      gestureRef.current = null;
    },
    []
  );

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, item: FreeCatalogItem) {
    if (!onDragEnd) {
      return;
    }

    // Um gesto anterior que ficou pela metade sai antes (sem acrescentar nada).
    gestureRef.current?.stop();

    const target = event.currentTarget;
    const host = target.closest("[data-free-editor]") ?? target.ownerDocument.body;
    const gesture: FreeElementGesture = { state: "pending", stop: () => {} };
    // A foto do design sai depois do limiar (antes disso o gesto ainda pode ser so um clique).
    let designAtStart: PopupFreeDesign | null = null;

    function finish(client: FreePoint | null) {
      if (gesture.state !== "dragging") {
        return;
      }

      gesture.state = "done";
      pointRef.current = null;

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      setDrag(null);

      const latest = latestRef.current;
      // Ligado e com o mesmo design do comeco: o editor recalcula o lugar com este ponto e acrescenta ali.
      const drop = client && !latest.disabled && latest.design === designAtStart ? client : null;

      latest.onDragEnd?.(item.kind, drop);
    }

    const dispose = followFreePointer(event, {
      // A area de desenho rola sozinha perto da borda (so com o alvo; o de agora, a cada quadro).
      autoScroll: latestRef.current.autoScrollTarget ? () => latestRef.current.autoScrollTarget?.() ?? null : undefined,
      onCancel: () => finish(null),
      onDrop: (client) => finish(client),
      onMove: (client) => {
        if (gesture.state !== "dragging") {
          return;
        }

        pointRef.current = client;

        if (frameRef.current === null) {
          frameRef.current = window.requestAnimationFrame(placeChip);
        }

        latestRef.current.onDragMove?.(item.kind, client);
      },
      onStart: () => {
        gesture.state = "dragging";
        designAtStart = latestRef.current.design;
        setDrag({ host, kind: item.kind, label: item.label });
      },
      threshold: FREE_LIST_DRAG_START_PX
    });

    gesture.stop = () => {
      dispose();
      finish(null);
    };
    gestureRef.current = gesture;
  }

  const ChipIcon = drag ? ICONS[drag.kind] : null;

  return (
    <div aria-label={FREE_EDITOR_COPY.elements.groupsLabel} className="flex min-w-0 flex-col gap-4 p-3" role="group">
      <p className="m-0 text-[12px] leading-4 text-[var(--text-secondary)]" data-free-elements-hint="">
        {FREE_EDITOR_COPY.elements.hint}
      </p>
      {FREE_ELEMENT_GROUPS.map((group) => {
        const groupId = `${baseId}-${group.label}`;

        return (
          <section aria-labelledby={groupId} className="flex min-w-0 flex-col gap-2" key={group.label}>
            <h3 className="text-[12px] leading-4 font-semibold tracking-wide text-[var(--text-tertiary)] uppercase" id={groupId}>
              {group.label}
            </h3>
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,72px)] gap-2 p-0">
              {group.items.map((item) => {
                const reason = disabled ? null : freeElementDisabledReason(design, item.kind);
                const off = disabled || Boolean(reason);
                const reasonId = `${baseId}-${item.kind}-motivo`;
                const Icon = ICONS[item.kind];
                const dragging = drag?.kind === item.kind;

                return (
                  <li className="min-w-0" key={item.kind}>
                    <button
                      aria-describedby={reason ? reasonId : undefined}
                      aria-disabled={off || undefined}
                      className={cn(
                        "flex h-16 w-[72px] flex-col items-center justify-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-1 text-center text-[12px] leading-4 text-[var(--text-primary)] transition-colors duration-150",
                        off ? "cursor-not-allowed opacity-45" : "select-none hover:border-[var(--border-strong)] hover:bg-[var(--surface-3)]",
                        // O cursor: pointer de todo botao (globals.css, fora das camadas) so cede com o !.
                        dragging && "cursor-grabbing! border-[var(--focus-ring)] bg-[var(--surface-3)] outline-2 outline-offset-2 outline-[var(--focus-ring)]"
                      )}
                      data-free-element={item.kind}
                      data-free-element-dragging={dragging ? "" : undefined}
                      onClick={() => {
                        if (!off) {
                          onAdd(item.kind);
                        }
                      }}
                      onPointerDown={(event) => {
                        if (!off) {
                          startDrag(event, item);
                        }
                      }}
                      title={reason ?? undefined}
                      type="button"
                    >
                      <Icon aria-hidden="true" className="size-5 shrink-0 text-[var(--text-secondary)]" strokeWidth={1.8} />
                      <span className="line-clamp-2">{item.label}</span>
                    </button>
                    {reason ? (
                      <span className="sr-only" id={reasonId}>
                        {reason}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {drag && ChipIcon
        ? createPortal(
            <div
              aria-hidden="true"
              className="pointer-events-none fixed top-0 left-0 z-[60] flex items-center gap-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--surface-3)] px-2 py-1 text-[13px] leading-5 font-medium whitespace-nowrap text-[var(--text-primary)] shadow-lg will-change-transform select-none"
              data-free-element-chip={drag.kind}
              ref={chipRef}
            >
              <ChipIcon aria-hidden="true" className="size-4 shrink-0 text-[var(--text-secondary)]" strokeWidth={1.8} />
              {drag.label}
            </div>,
            drag.host
          )
        : null}
    </div>
  );
}

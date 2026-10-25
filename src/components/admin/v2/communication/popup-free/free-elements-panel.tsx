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
import { useId } from "react";
import { cn } from "@/lib/utils";
import type { PopupFreeDesign } from "@/server/communications/popup-free-model";
import type { FreePoint } from "./free-editor-geometry";
import { FREE_EDITOR_COPY, FREE_ELEMENT_GROUPS, freeElementDisabledReason, type FreeCatalogKind } from "./free-editor-model";

// Painel "Elementos" do editor Livre (spec §4.3): botoes de 72 x 64 px com icone e nome, em grupos. Clicar
// acrescenta (arrastar do painel fica para depois). Um botao no limite fica desligado com a frase do limite, mas
// continua focavel (aria-disabled), para quem usa teclado ou leitor de tela ouvir o motivo.

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

export type FreeElementsPanelProps = {
  design: PopupFreeDesign;
  disabled: boolean;
  onAdd: (kind: FreeCatalogKind) => void;
  /** Arrastando um botao ate o desenho: o ponteiro (px de tela) a cada movimento; o desenho mostra onde entra. */
  onDragMove?: (kind: FreeCatalogKind, client: FreePoint) => void;
  /** Fim do arrastar: o ponto do soltar (o editor acrescenta ali) ou null (cancelado: nada entra). */
  onDragEnd?: (kind: FreeCatalogKind, client: FreePoint | null) => void;
};

export function FreeElementsPanel({ design, disabled, onAdd }: FreeElementsPanelProps) {
  const baseId = useId();

  return (
    <div aria-label={FREE_EDITOR_COPY.elements.groupsLabel} className="flex min-w-0 flex-col gap-4 p-3" role="group">
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

                return (
                  <li className="min-w-0" key={item.kind}>
                    <button
                      aria-describedby={reason ? reasonId : undefined}
                      aria-disabled={off || undefined}
                      className={cn(
                        "flex h-16 w-[72px] flex-col items-center justify-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-1 text-center text-[12px] leading-4 text-[var(--text-primary)] transition-colors duration-150",
                        off ? "cursor-not-allowed opacity-45" : "hover:border-[var(--border-strong)] hover:bg-[var(--surface-3)]"
                      )}
                      data-free-element={item.kind}
                      onClick={() => {
                        if (!off) {
                          onAdd(item.kind);
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
    </div>
  );
}

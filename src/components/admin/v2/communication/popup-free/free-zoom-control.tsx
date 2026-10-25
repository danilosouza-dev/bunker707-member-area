"use client";

import { ChevronDown, ZoomIn, ZoomOut } from "lucide-react";
import { useId, useRef } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { adminTransition } from "../../styles";
import { FREE_ZOOM_STEPS, type FreeZoom, type FreeZoomStep } from "./free-editor-geometry";
import { FREE_EDITOR_COPY } from "./free-editor-model";

// Zoom do editor Livre (docs/27 L43, L4b): [Diminuir o zoom] [menu "62 %"] [Aumentar o zoom] na barra de cima, no
// lugar dos dois botoes "Ajustar à tela" e "100 %" de antes. O menu e de radio, com o valor de agora marcado: "Ajustar
// à tela", 50, 75, 100, 150 e 200 % (so esses; 25, 300 e 400 % ficam para o L4c). O gatilho mostra a escala que se ve
// ("62 %" no Ajustar a tela) e se chama "Zoom: Ajustar à tela (62 %)" ou "Zoom: 150 %". Nas pontas o botao fica
// desligado sem sair da ordem do Tab (aria-disabled): o motivo vai no title e num texto so do leitor de tela, ligado
// pelo aria-describedby, e o clique nao faz nada. Ao fechar o menu (escolhendo, Esc ou clique fora), o foco volta ao
// gatilho. Quem decide o zoom e o editor: este controle so avisa (onStep, onFit, onZoom) e mostra o que recebe.
// Nada abaixo de 12 px.

const copy = FREE_EDITOR_COPY.bar;

/** As escolhas do menu, na ordem: "Ajustar à tela" e os passos (FREE_ZOOM_STEPS). */
const OPTIONS: readonly { label: string; zoom: FreeZoom }[] = [
  { label: copy.zoomFit, zoom: "fit" },
  ...FREE_ZOOM_STEPS.map((step) => ({ label: copy.zoomStep(step), zoom: step }))
];

export type FreeZoomControlProps = {
  /** "Aumentar o zoom" desligado: nao ha passo acima da escala mostrada (freeZoomNext(escala, 1) === null). */
  disabledIn: boolean;
  /** "Diminuir o zoom" desligado: nao ha passo abaixo da escala mostrada (freeZoomNext(escala, -1) === null). */
  disabledOut: boolean;
  /** "Ajustar à tela" escolhido no menu. */
  onFit: () => void;
  /** Os botoes [−] (-1) e [+] (1): o passo abaixo ou acima da escala mostrada fica com o editor. */
  onStep: (direction: 1 | -1) => void;
  /** Um passo escolhido no menu. */
  onZoom: (step: FreeZoomStep) => void;
  /** A escala que se ve, em % (no Ajustar a tela, a do palco inteiro na vista). */
  shownPercent: number;
  /** O zoom escolhido: 'fit' (o de abrir) ou um passo. */
  zoom: FreeZoom;
};

/** O valor que o menu de radio devolve, de volta a um zoom; o que nao for uma das escolhas vale null. */
function zoomOfChoice(value: unknown): FreeZoom | null {
  return OPTIONS.find((option) => option.zoom === value)?.zoom ?? null;
}

export function FreeZoomControl({ disabledIn, disabledOut, onFit, onStep, onZoom, shownPercent, zoom }: FreeZoomControlProps) {
  const baseId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // Num passo, o proprio passo (sem esperar a escala medida); no Ajustar a tela, a escala que o editor mediu.
  const percent = zoom === "fit" ? (Number.isFinite(shownPercent) ? Math.round(shownPercent) : 100) : zoom;
  const shown = copy.zoomStep(percent);
  const name = copy.zoomMenu(zoom === "fit" ? copy.zoomFitShown(percent) : shown);

  return (
    <div aria-label={copy.zoom} className="flex items-center gap-2" data-free-zoom-control="" role="group">
      <span aria-hidden="true" className="hidden text-xs leading-4 text-[var(--text-tertiary)] xl:inline">
        {copy.zoom}
      </span>
      <div className="flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-0.5">
        <ZoomStepButton
          direction={-1}
          disabled={disabledOut}
          label={copy.zoomOut}
          onStep={onStep}
          reason={copy.zoomMin}
          reasonId={`${baseId}-menor`}
          shortcuts="Control+- Meta+-"
          title={copy.zoomOutTitle}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={name}
            className={cn(
              "flex h-8 min-w-[68px] items-center justify-center gap-1 rounded-md px-2 text-[13px] leading-5 font-medium text-[var(--text-primary)] tabular-nums hover:bg-[var(--press-overlay)] data-popup-open:bg-[var(--surface-3)]",
              adminTransition
            )}
            data-free-zoom="menu"
            ref={triggerRef}
          >
            <span aria-hidden="true">{shown}</span>
            <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-[var(--text-tertiary)]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="center"
            className="w-48 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1 text-[var(--text-primary)] ring-0"
            finalFocus={triggerRef}
            sideOffset={6}
          >
            <DropdownMenuRadioGroup
              aria-label={copy.zoom}
              onValueChange={(value) => {
                const next = zoomOfChoice(value);

                if (next === "fit") {
                  onFit();
                } else if (next !== null) {
                  onZoom(next);
                }
              }}
              value={zoom}
            >
              {OPTIONS.map((option) => (
                <DropdownMenuRadioItem
                  className="min-h-9 rounded-md py-1.5 pr-8 pl-2 text-sm leading-5 text-[var(--text-primary)] tabular-nums focus:bg-[var(--surface-2)] focus:text-[var(--text-primary)]"
                  closeOnClick
                  data-free-zoom-step={String(option.zoom)}
                  key={option.zoom}
                  label={option.label}
                  value={option.zoom}
                >
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <ZoomStepButton
          direction={1}
          disabled={disabledIn}
          label={copy.zoomIn}
          onStep={onStep}
          reason={copy.zoomMax}
          reasonId={`${baseId}-maior`}
          shortcuts="Control+= Meta+="
          title={copy.zoomInTitle}
        />
      </div>
    </div>
  );
}

/** [−] ou [+]: na ponta continua focavel (aria-disabled), com o motivo no title e no texto do leitor de tela. */
function ZoomStepButton({
  direction,
  disabled,
  label,
  onStep,
  reason,
  reasonId,
  shortcuts,
  title
}: {
  direction: 1 | -1;
  disabled: boolean;
  label: string;
  onStep: (direction: 1 | -1) => void;
  reason: string;
  reasonId: string;
  shortcuts: string;
  title: string;
}) {
  const Icon = direction > 0 ? ZoomIn : ZoomOut;

  return (
    <>
      <button
        aria-describedby={disabled ? reasonId : undefined}
        aria-disabled={disabled || undefined}
        aria-keyshortcuts={shortcuts}
        aria-label={label}
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-md text-[var(--text-secondary)]",
          disabled ? "cursor-not-allowed opacity-45" : "hover:bg-[var(--press-overlay)] hover:text-[var(--text-primary)]",
          adminTransition
        )}
        data-free-zoom={direction > 0 ? "in" : "out"}
        onClick={() => {
          if (!disabled) {
            onStep(direction);
          }
        }}
        title={disabled ? reason : title}
        type="button"
      >
        <Icon aria-hidden="true" className="size-4" />
      </button>
      {disabled ? (
        <span className="sr-only" id={reasonId}>
          {reason}
        </span>
      ) : null}
    </>
  );
}

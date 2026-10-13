"use client";

import { Move, ZoomIn, ZoomOut } from "lucide-react";
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ErrorBanner } from "../error-banner";
import {
  aspectRatioOf,
  chooseEncodedImage,
  cropRect,
  dataUrlByteLength,
  describeEncodingProblem,
  IMAGE_SPECS,
  initialCropState,
  isWebpDataUrl,
  maxZoomFor,
  outputSizeFor,
  panCrop,
  type CropState,
  type ImageSlot,
  WEBP_QUALITY_STEPS,
  zoomCrop
} from "./cover-crop";
import { ProductDialog } from "./dialog-frame";

// Recorte no navegador (docs/17 §2.3): arrastar para posicionar, zoom pelo controle ou teclado,
// canvas -> WebP no tamanho final. Nada sobe para o servidor antes de "Usar esta imagem".

export type CropSource = {
  element: HTMLImageElement;
  height: number;
  /** Endereco usado para mostrar a previa (blob: do arquivo ou o link colado). */
  url: string;
  width: number;
};

type ImageCropDialogProps = {
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
  open: boolean;
  slot: ImageSlot;
  source: CropSource;
};

function cssUrl(url: string) {
  return `url("${url.replace(/["\\\n\r]/g, (character) => encodeURIComponent(character))}")`;
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

export function ImageCropDialog({ onCancel, onConfirm, open, slot, source }: ImageCropDialogProps) {
  const spec = IMAGE_SPECS[slot];
  const size = { height: source.height, width: source.width };
  const [state, setState] = useState<CropState>(() => initialCropState(size, spec));
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ pointerX: number; pointerY: number; scale: number; start: CropState } | null>(null);
  const maxZoom = maxZoomFor(size, spec);
  const rect = cropRect(size, spec, state);
  const canZoom = maxZoom > 1.001;

  const previewStyle: CSSProperties = {
    backgroundImage: cssUrl(source.url),
    backgroundPosition: `${source.width > rect.width ? (rect.x / (source.width - rect.width)) * 100 : 0}% ${
      source.height > rect.height ? (rect.y / (source.height - rect.height)) * 100 : 0
    }%`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${(source.width / rect.width) * 100}% ${(source.height / rect.height) * 100}%`
  };

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();

    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerX: event.clientX, pointerY: event.clientY, scale: rect.width / box.width, start: state };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;

    if (!current) {
      return;
    }

    const deltaX = (event.clientX - current.pointerX) * current.scale;
    const deltaY = (event.clientY - current.pointerY) * current.scale;

    setState(panCrop(size, spec, current.start, -deltaX, -deltaY));
  }

  function handlePointerEnd() {
    drag.current = null;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = rect.width * 0.04;
    const moves: Record<string, [number, number]> = {
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step]
    };

    if (moves[event.key]) {
      event.preventDefault();
      const [deltaX, deltaY] = moves[event.key];
      setState((current) => panCrop(size, spec, current, deltaX, deltaY));
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setState((current) => zoomCrop(size, spec, current, current.zoom + 0.1));
    } else if (event.key === "-") {
      event.preventDefault();
      setState((current) => zoomCrop(size, spec, current, current.zoom - 0.1));
    }
  }

  async function handleConfirm() {
    setProcessing(true);
    setError(null);
    await nextFrame();

    try {
      const canvas = document.createElement("canvas");
      const output = outputSizeFor(rect, spec);
      canvas.width = output.width;
      canvas.height = output.height;
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("canvas");
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(source.element, rect.x, rect.y, rect.width, rect.height, 0, 0, output.width, output.height);

      const attempts: string[] = [];

      for (const quality of WEBP_QUALITY_STEPS) {
        const encoded = canvas.toDataURL("image/webp", quality);
        attempts.push(encoded);

        if (!isWebpDataUrl(encoded) || dataUrlByteLength(encoded) <= spec.maxBytes) {
          break;
        }
      }

      const choice = chooseEncodedImage(attempts, spec);

      if (!choice.ok) {
        setError(describeEncodingProblem(choice.error));
        setProcessing(false);
        return;
      }

      setProcessing(false);
      onConfirm(choice.dataUrl);
    } catch {
      setProcessing(false);
      setError("Não conseguimos recortar esta imagem a partir do link. Envie o arquivo da imagem.");
    }
  }

  return (
    <ProductDialog
      className={spec.orientation === "landscape" ? "max-w-[720px]" : "max-w-[480px]"}
      description={`Arraste para posicionar e use o zoom. A ${spec.label} sai com até ${spec.outputWidth}×${spec.outputHeight} px, sem ampliar imagens menores.`}
      footer={
        <>
          <Button className="px-4" disabled={processing} onClick={onCancel} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button className="px-4" disabled={processing} onClick={() => void handleConfirm()} type="button">
            {processing ? "Preparando…" : "Usar esta imagem"}
          </Button>
        </>
      }
      onOpenChange={(next) => {
        if (!next && !processing) {
          onCancel();
        }
      }}
      open={open}
      title={`Ajustar ${spec.label} (${spec.ratioLabel})`}
    >
      <div className="flex flex-col items-center gap-4">
        {error ? <ErrorBanner className="w-full">{error}</ErrorBanner> : null}
        <div
          aria-label={`Recorte da ${spec.label}. Arraste ou use as setas para mover; + e − mudam o zoom.`}
          className={cn(
            "relative w-full cursor-grab touch-none overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--surface-1)] select-none active:cursor-grabbing",
            spec.orientation === "portrait" && "max-w-[280px]"
          )}
          onKeyDown={handleKeyDown}
          onPointerCancel={handlePointerEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          role="group"
          style={{ ...previewStyle, aspectRatio: aspectRatioOf(spec) }}
          tabIndex={0}
        >
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/20" />
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/20" />
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/20" />
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/20" />
        </div>

        <div className="flex w-full max-w-[420px] items-center gap-3">
          <ZoomOut aria-hidden="true" className="size-4 shrink-0 text-[var(--text-secondary)]" />
          <input
            aria-label="Zoom"
            aria-valuetext={`${Math.round(state.zoom * 100)}%`}
            className="h-10 min-w-0 flex-1 cursor-pointer accent-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canZoom || processing}
            max={maxZoom}
            min={1}
            onChange={(event) => setState((current) => zoomCrop(size, spec, current, Number(event.target.value)))}
            step={0.01}
            type="range"
            value={state.zoom}
          />
          <ZoomIn aria-hidden="true" className="size-4 shrink-0 text-[var(--text-secondary)]" />
        </div>
        <p className="flex items-center gap-1.5 text-xs leading-5 text-[var(--text-secondary)]">
          <Move aria-hidden="true" className="size-3.5" />
          {canZoom ? "Arraste a imagem para escolher o enquadramento." : "Esta imagem está no tamanho mínimo: dá para mover, mas não aproximar."}
        </p>
      </div>
    </ProductDialog>
  );
}

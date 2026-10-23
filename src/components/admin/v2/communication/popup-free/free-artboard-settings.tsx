"use client";

import { useState } from "react";
import type { FreeHint, FreeMeasuredRects } from "@/server/communications/popup-free-checks";
import { FREE_DESIGN_LIMITS, type PopupFreeDesign } from "@/server/communications/popup-free-model";
import { FREE_ARTBOARD_DEFAULTS, resolveFreeArtboard, resolveFreeClose } from "@/server/communications/popup-free-render";
import type { PopupFontOption } from "@/server/communications/popup-design-model";
import { AdminSwitch } from "../../settings/kit";
import { ColorField, PillField } from "../popup-design/design-controls";
import { FontUploadDialog } from "../popup-design/font-upload-dialog";
import { FontsSection } from "../popup-design/fonts-section";
import { FreeBorderField, FreeFillLayersField, FreeGroup, FreeHints, FreeNote, FreeNumberField, FreeRadiusField, FreeSection, FreeShadowsField, FreeSidesField } from "./free-fields";
import {
  FREE_ARTBOARD_ALIGN_OPTIONS,
  FREE_ARTBOARD_JUSTIFY_OPTIONS,
  FREE_ARTBOARD_SHADOW_OPTIONS,
  FREE_ARTBOARD_SHADOW_PRESETS,
  FREE_CLOSE_SIDE_OPTIONS,
  FREE_CLOSE_SIZE_OPTIONS,
  FREE_INSPECTOR_COPY,
  FREE_MIN_HEIGHT_OPTIONS,
  FREE_WIDTH_OPTIONS,
  freeArtboardShadowChoice,
  freeErrorAt,
  freeFieldId,
  freeFillBaseColor,
  freeHintsOf,
  freeWidthChoice,
  freeWidthOfChoice,
  withFreeArtboard,
  withFreeArtboardWidth,
  withFreeClose,
  withFreeFillImage
} from "./free-inspector-model";

// Editor Livre do pop-up (docs/27; spec §4.7), pacote I: o painel "Pop-up" (nada selecionado). Largura no
// computador (P, M, G, GG ou Outra) com "Ajustar os elementos à nova largura" (reescala tudo na mesma proporcao),
// Altura minima, Fundo, Borda, Cantos, Sombra (Sem, Suave, Forte, Personalizada), Respiro interno, Elementos na
// sequencia, o botao de fechar (X, com o erro do X invisivel embaixo da cor) e as Fontes do Personalizado.

const L = FREE_DESIGN_LIMITS;
const C = FREE_INSPECTOR_COPY;
const id = (field: string) => freeFieldId(null, field);

type FreeArtboardSettingsProps = {
  design: PopupFreeDesign;
  disabled: boolean;
  errors: Readonly<Record<string, string>>;
  fonts: readonly PopupFontOption[];
  hints: readonly FreeHint[];
  latest: () => PopupFreeDesign;
  onBusyChange: (reason: string | null) => void;
  onChange: (next: PopupFreeDesign, field?: string) => void;
  onFontsChange: (fonts: PopupFontOption[]) => void;
  rects: FreeMeasuredRects;
};

export function FreeArtboardSettings({ design, disabled, errors, fonts, hints, latest, onBusyChange, onChange, onFontsChange, rects }: FreeArtboardSettingsProps) {
  const artboard = resolveFreeArtboard(design);
  const close = resolveFreeClose(design);
  const [adjust, setAdjust] = useState(true);
  const [otherWidth, setOtherWidth] = useState(() => freeWidthChoice(artboard.width) === "other");
  const [customShadow, setCustomShadow] = useState(() => freeArtboardShadowChoice(artboard.shadows) === "custom");
  const [uploading, setUploading] = useState(false);
  const widthChoice = otherWidth ? "other" : freeWidthChoice(artboard.width);
  const shadowChoice = customShadow ? "custom" : freeArtboardShadowChoice(artboard.shadows);
  const error = (field: string) => freeErrorAt(errors, `artboard.${field}`);
  const closeError = (field: string) => freeErrorAt(errors, `close.${field}`);
  const measuredHeight = rects["@artboard"]?.h;

  function setWidth(width: number, field?: string) {
    onChange(withFreeArtboardWidth(design, width, adjust), field);
  }

  return (
    <div className="flex min-w-0 flex-col gap-5 [&>*:first-child]:border-t-0 [&>*:first-child]:pt-0">
      <FreeGroup>
        <PillField
          disabled={disabled}
          error={error("width")}
          label={C.popup.width}
          name={id("largura")}
          onChange={(choice) => {
            setOtherWidth(choice === "other");

            if (choice !== "other") {
              setWidth(freeWidthOfChoice(choice));
            }
          }}
          options={FREE_WIDTH_OPTIONS}
          value={widthChoice}
        />
        {widthChoice === "other" ? (
          <FreeNumberField bounds={L.artboardWidth} disabled={disabled} id={id("largura-px")} label={C.popup.widthOther} onChange={(width) => setWidth(width, "artboard.width")} unit={C.units.px} value={artboard.width} />
        ) : null}
        <FreeNote>{C.popup.widthNote}</FreeNote>
        <AdminSwitch checked={adjust} disabled={disabled} id={id("ajustar")} label={C.popup.adjust} onCheckedChange={setAdjust} />
      </FreeGroup>

      <FreeGroup>
        <PillField
          disabled={disabled}
          error={error("minHeight")}
          hint={C.popup.minHeightHint}
          label={C.popup.minHeight}
          name={id("altura")}
          onChange={(choice) =>
            onChange(withFreeArtboard(design, { minHeight: choice === "auto" ? undefined : Math.max(1, Math.min(L.minHeight.max, Math.round(measuredHeight ?? 400))) }))
          }
          options={FREE_MIN_HEIGHT_OPTIONS}
          value={artboard.minHeight > 0 ? "fixed" : "auto"}
        />
        <FreeHints hints={freeHintsOf(hints, null, ["phone-scroll"])} />
        {artboard.minHeight > 0 ? (
          <FreeNumberField
            bounds={L.minHeight}
            disabled={disabled}
            id={id("altura-px")}
            label={C.popup.minHeightPx}
            onChange={(minHeight) => onChange(withFreeArtboard(design, { minHeight: minHeight === 0 ? undefined : minHeight }), "artboard.minHeight")}
            unit={C.units.px}
            value={artboard.minHeight}
          />
        ) : null}
      </FreeGroup>

      <FreeGroup>
        <FreeFillLayersField
          baseColor={freeFillBaseColor(artboard.fill)}
          design={design}
          disabled={disabled}
          error={error("fill")}
          id={id("fundo")}
          min={1}
          onBusyChange={onBusyChange}
          onChange={(fill) => onChange(withFreeArtboard(design, { fill: fill && fill.length > 0 ? fill : [...FREE_ARTBOARD_DEFAULTS.fill] }), "artboard.fill")}
          onImageLayer={(build, image) => onChange(withFreeFillImage(latest(), null, image, build))}
          value={artboard.fill}
        />
      </FreeGroup>

      <FreeGroup>
        <FreeBorderField disabled={disabled} error={error("border")} id={id("borda")} onChange={(border) => onChange(withFreeArtboard(design, { border }), "artboard.border")} value={artboard.border} />
      </FreeGroup>

      <FreeGroup>
        <FreeRadiusField
          disabled={disabled}
          error={error("radius")}
          id={id("cantos")}
          max={L.artboardRadius.max}
          onChange={(radius) => onChange(withFreeArtboard(design, { radius: typeof radius === "number" ? radius : radius[0] }), "artboard.radius")}
          pill={false}
          single
          value={artboard.radius}
        />
      </FreeGroup>

      <FreeGroup>
        <PillField
          disabled={disabled}
          error={error("shadows")}
          label={C.popup.shadow}
          name={id("sombra")}
          onChange={(choice) => {
            setCustomShadow(choice === "custom");

            if (choice !== "custom") {
              const preset = FREE_ARTBOARD_SHADOW_PRESETS[choice];

              onChange(withFreeArtboard(design, { shadows: preset.length > 0 ? preset.map((shadow) => ({ ...shadow })) : undefined }));
            }
          }}
          options={FREE_ARTBOARD_SHADOW_OPTIONS}
          value={shadowChoice}
        />
        {shadowChoice === "custom" ? (
          <FreeShadowsField
            disabled={disabled}
            fillColor={freeFillBaseColor(artboard.fill)}
            id={id("sombra-lista")}
            onChange={(shadows) => onChange(withFreeArtboard(design, { shadows }), "artboard.shadows")}
            shortcuts={false}
            value={artboard.shadows}
          />
        ) : null}
      </FreeGroup>

      <FreeGroup>
        <FreeSidesField
          bounds={L.padding}
          disabled={disabled}
          error={error("padding")}
          id={id("respiro")}
          label={C.popup.padding}
          onChange={(padding) => onChange(withFreeArtboard(design, { padding }), "artboard.padding")}
          value={artboard.padding}
        />
      </FreeGroup>

      <FreeSection title={C.popup.flowTitle}>
        <FreeNumberField bounds={L.gap} disabled={disabled} error={error("gap")} id={id("espaco")} label={C.popup.gap} onChange={(gap) => onChange(withFreeArtboard(design, { gap }), "artboard.gap")} unit={C.units.px} value={artboard.gap} />
        <PillField disabled={disabled} label={C.popup.align} name={id("alinhar")} onChange={(align) => onChange(withFreeArtboard(design, { align }))} options={FREE_ARTBOARD_ALIGN_OPTIONS} value={artboard.align} />
        <PillField disabled={disabled} label={C.popup.justify} name={id("na-altura")} onChange={(justify) => onChange(withFreeArtboard(design, { justify }))} options={FREE_ARTBOARD_JUSTIFY_OPTIONS} value={artboard.justify} />
      </FreeSection>

      <FreeSection description={C.popup.closeNote} title={C.popup.closeTitle}>
        <ColorField disabled={disabled} error={closeError("color")} id={id("x-cor")} label={C.popup.closeColor} onChange={(color) => onChange(withFreeClose(design, { color }), "close.color")} value={close.color} />
        <ColorField disabled={disabled} error={closeError("background")} id={id("x-fundo")} label={C.popup.closeBackground} onChange={(background) => onChange(withFreeClose(design, { background }), "close.background")} value={close.background} />
        <FreeBorderField
          colorLabel={C.border.color}
          disabled={disabled}
          error={closeError("border")}
          id={id("x-borda")}
          onChange={(border) => onChange(withFreeClose(design, { border }), "close.border")}
          title={C.popup.closeBorder}
          value={close.border}
        />
        <PillField
          disabled={disabled}
          label={C.popup.closeSize}
          name={id("x-tamanho")}
          onChange={(size) => onChange(withFreeClose(design, { size: Number(size) as 28 | 36 | 44 }))}
          options={FREE_CLOSE_SIZE_OPTIONS}
          value={String(close.size) as "28" | "36" | "44"}
        />
        <FreeNumberField
          bounds={L.closeInset}
          disabled={disabled}
          error={closeError("inset")}
          id={id("x-distancia")}
          label={C.popup.closeInset}
          onChange={(inset) => onChange(withFreeClose(design, { inset }), "close.inset")}
          unit={C.units.px}
          value={close.inset}
        />
        <PillField disabled={disabled} label={C.popup.closeSide} name={id("x-lado")} onChange={(side) => onChange(withFreeClose(design, { side }))} options={FREE_CLOSE_SIDE_OPTIONS} value={close.side} />
      </FreeSection>

      <div className="flex min-w-0 flex-col outline-none" id={id("fontes")} tabIndex={-1}>
        <FontsSection
          disabled={disabled}
          errorFor={(key) => (key === "design.fonts" ? freeErrorAt(errors, "fonts") : undefined)}
          fonts={fonts}
          onFontsChange={onFontsChange}
          onRequestUpload={() => setUploading(true)}
        />
      </div>
      <FontUploadDialog onOpenChange={setUploading} onUploaded={(font) => onFontsChange([...fonts.filter((item) => item.id !== font.id), font])} open={uploading} />
    </div>
  );
}

"use client";

import { POPUP_BUILTIN_FONT_KEYS, POPUP_BUILTIN_FONTS, type PopupFontOption, type PopupFontRef, type PopupFontWeight } from "@/server/communications/popup-design-model";
import { DesignSelect } from "./design-controls";
import { POPUP_DESIGN_COPY, fontRefFromValue, fontRefValue, weightAfterFontChange, weightOptionsFor } from "./popup-design-editor-model";

// Seletor de fonte do design (docs/26): as prontas (Inter e Exo 2 do app, e as do sistema), depois "Suas
// fontes" (a biblioteca) e por ultimo "Enviar fonte…" (abre o dialogo; a fonte enviada ja entra escolhida).
// Fonte que saiu da biblioteca continua na lista ("Fonte que saiu da biblioteca") ate o produtor trocar.

const UPLOAD_VALUE = "__enviar__";

type FontPickerProps = {
  disabled?: boolean;
  id: string;
  library: readonly PopupFontOption[];
  /** Fonte escolhida e o peso que combina com ela (Exo 2 so 500 a 700; a enviada comeca no peso dela). */
  onChange: (font: PopupFontRef, weight: PopupFontWeight) => void;
  /** "Enviar fonte…": o dialogo; a fonte enviada volta por `onChange`. */
  onRequestUpload: (apply: (font: PopupFontOption) => void) => void;
  value: PopupFontRef;
  weight: PopupFontWeight;
};

export function FontPicker({ disabled, id, library, onChange, onRequestUpload, value, weight }: FontPickerProps) {
  const gone = value.kind === "uploaded" && !library.some((font) => font.id === value.id);
  const groups = [
    {
      items: POPUP_BUILTIN_FONT_KEYS.map((key) => ({ label: POPUP_BUILTIN_FONTS[key].label, value: fontRefValue({ key, kind: "builtin" }) })),
      label: POPUP_DESIGN_COPY.style.fontBuiltin
    },
    ...(library.length > 0 || gone
      ? [
          {
            items: [
              ...library.map((font) => ({ label: font.name, value: fontRefValue({ id: font.id, kind: "uploaded" }) })),
              ...(gone ? [{ label: POPUP_DESIGN_COPY.style.fontGone, value: fontRefValue(value) }] : [])
            ],
            label: POPUP_DESIGN_COPY.style.fontUploaded
          }
        ]
      : []),
    { items: [{ label: POPUP_DESIGN_COPY.style.fontUpload, value: UPLOAD_VALUE }] }
  ];

  return (
    <DesignSelect
      disabled={disabled}
      groups={groups}
      id={id}
      label={POPUP_DESIGN_COPY.style.font}
      onChange={(next) => {
        if (next === UPLOAD_VALUE) {
          onRequestUpload((font) => onChange({ id: font.id, kind: "uploaded" }, weightAfterFontChange({ id: font.id, kind: "uploaded" }, weight, [font])));
          return;
        }

        const font = fontRefFromValue(next);

        if (font) {
          onChange(font, weightAfterFontChange(font, weight, library));
        }
      }}
      value={fontRefValue(value)}
    />
  );
}

/** Peso (so os que a fonte tem). */
export function WeightPicker({ disabled, font, id, label, onChange, value }: { disabled?: boolean; font: PopupFontRef; id: string; label: string; onChange: (weight: PopupFontWeight) => void; value: PopupFontWeight }) {
  const options = weightOptionsFor(font);
  const current = options.some((option) => option.value === `${value}`) ? `${value}` : (options[0]?.value ?? "400");

  return (
    <DesignSelect
      disabled={disabled}
      groups={[{ items: options }]}
      id={id}
      label={label}
      onChange={(next) => onChange(Number(next) as PopupFontWeight)}
      value={current}
    />
  );
}

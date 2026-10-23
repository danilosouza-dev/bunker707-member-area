"use client";

import { POPUP_DESIGN_LIMITS, type PopupButtonStyle, type PopupFontOption, type PopupTextStyle } from "@/server/communications/popup-design-model";
import { AdminSwitch } from "../../settings/kit";
import { BorderField, ColorField, NumberField, PaintField, PillField, RadiusField } from "./design-controls";
import { FontPicker, WeightPicker } from "./font-picker";
import { BUTTON_SIZE_OPTIONS, BUTTON_WIDTH_OPTIONS, POPUP_DESIGN_COPY, TEXT_ALIGN_OPTIONS } from "./popup-design-editor-model";

// Estilo do texto (selo, titulo, texto) e estilo do botao (principal e segundo) do design (docs/26 §7.2). Os
// numeros so aceitam o que o design aceita (popup-design-model.POPUP_DESIGN_LIMITS); cores e degrades pelo campo
// de pintura. Fonte: as prontas, as enviadas e "Enviar fonte…".

const LIMITS = POPUP_DESIGN_LIMITS;
const styleCopy = POPUP_DESIGN_COPY.style;
const buttonCopy = POPUP_DESIGN_COPY.button;

export type RequestFontUpload = (apply: (font: PopupFontOption) => void) => void;

type TextStyleFieldsProps = {
  disabled?: boolean;
  /** Prefixo dos ids ("popup-design-bloco-2-estilo"). */
  idBase: string;
  library: readonly PopupFontOption[];
  onChange: (style: PopupTextStyle) => void;
  onRequestUpload: RequestFontUpload;
  /** Rotulo da cor ("Cor"; no titulo, a cor das linhas que ficam "Igual ao título"). */
  paintLabel?: string;
  value: PopupTextStyle;
};

export function TextStyleFields({ disabled, idBase, library, onChange, onRequestUpload, paintLabel = styleCopy.color, value }: TextStyleFieldsProps) {
  const update = (patch: Partial<PopupTextStyle>) => onChange({ ...value, ...patch });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <FontPicker
          disabled={disabled}
          id={`${idBase}-fonte`}
          library={library}
          onChange={(font, weight) => update({ font, weight })}
          onRequestUpload={onRequestUpload}
          value={value.font}
          weight={value.weight}
        />
        <WeightPicker disabled={disabled} font={value.font} id={`${idBase}-peso`} label={styleCopy.weight} onChange={(weight) => update({ weight })} value={value.weight} />
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-4 sm:grid-cols-3">
        <NumberField
          disabled={disabled}
          id={`${idBase}-tamanho`}
          label={styleCopy.size}
          max={LIMITS.fontSize.max}
          min={LIMITS.fontSize.min}
          onChange={(size) => update({ size })}
          suffix="px"
          value={value.size}
        />
        <NumberField
          disabled={disabled}
          id={`${idBase}-altura`}
          integer={false}
          label={styleCopy.lineHeight}
          max={LIMITS.lineHeight.max}
          min={LIMITS.lineHeight.min}
          onChange={(lineHeight) => update({ lineHeight })}
          step={0.05}
          value={value.lineHeight}
        />
        <NumberField
          disabled={disabled}
          id={`${idBase}-letras`}
          integer={false}
          label={styleCopy.letterSpacing}
          max={LIMITS.letterSpacing.max}
          min={LIMITS.letterSpacing.min}
          onChange={(letterSpacing) => update({ letterSpacing })}
          step={0.01}
          value={value.letterSpacing}
        />
      </div>
      <AdminSwitch checked={value.uppercase} disabled={disabled} id={`${idBase}-maiusculas`} label={styleCopy.uppercase} onCheckedChange={(uppercase) => update({ uppercase })} />
      <PaintField disabled={disabled} id={`${idBase}-cor`} label={paintLabel} onChange={(paint) => update({ paint })} value={value.paint} />
      <PillField disabled={disabled} label={styleCopy.align} name={`${idBase}-alinhamento`} onChange={(align) => update({ align })} options={TEXT_ALIGN_OPTIONS} value={value.align} />
    </div>
  );
}

type ButtonStyleFieldsProps = {
  disabled?: boolean;
  idBase: string;
  library: readonly PopupFontOption[];
  onChange: (style: PopupButtonStyle) => void;
  onRequestUpload: RequestFontUpload;
  value: PopupButtonStyle;
};

export function ButtonStyleFields({ disabled, idBase, library, onChange, onRequestUpload, value }: ButtonStyleFieldsProps) {
  const update = (patch: Partial<PopupButtonStyle>) => onChange({ ...value, ...patch });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PaintField disabled={disabled} id={`${idBase}-fundo`} label={buttonCopy.background} onChange={(background) => update({ background })} value={value.background} />
      <ColorField disabled={disabled} id={`${idBase}-texto-cor`} label={buttonCopy.textColor} onChange={(textColor) => update({ textColor })} value={value.textColor} />
      <BorderField disabled={disabled} id={`${idBase}-borda`} label={buttonCopy.border} onChange={(border) => update({ border })} value={value.border} />
      <RadiusField disabled={disabled} id={`${idBase}-cantos`} label={buttonCopy.radius} onChange={(radius) => update({ radius })} pillLabel={buttonCopy.pill} value={value.radius} />
      <div className="flex min-w-0 flex-col gap-3">
        <AdminSwitch
          checked={value.glow !== null}
          disabled={disabled}
          id={`${idBase}-brilho`}
          label={buttonCopy.glow}
          onCheckedChange={(checked) => update({ glow: checked ? `${(value.background.kind === "solid" ? value.background.color : value.background.from).slice(0, 7)}66` : null })}
        />
        {value.glow !== null ? (
          <ColorField disabled={disabled} id={`${idBase}-brilho-cor`} label={buttonCopy.glowColor} onChange={(glow) => update({ glow })} value={value.glow} />
        ) : null}
      </div>
      <PillField disabled={disabled} label={buttonCopy.size} name={`${idBase}-tamanho`} onChange={(size) => update({ size })} options={BUTTON_SIZE_OPTIONS} value={value.size} />
      <PillField disabled={disabled} label={buttonCopy.width} name={`${idBase}-largura`} onChange={(width) => update({ width })} options={BUTTON_WIDTH_OPTIONS} value={value.width} />
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <FontPicker
          disabled={disabled}
          id={`${idBase}-fonte`}
          library={library}
          onChange={(font, weight) => update({ font, weight })}
          onRequestUpload={onRequestUpload}
          value={value.font}
          weight={value.weight}
        />
        <WeightPicker disabled={disabled} font={value.font} id={`${idBase}-peso`} label={styleCopy.weight} onChange={(weight) => update({ weight })} value={value.weight} />
      </div>
      <AdminSwitch checked={value.uppercase} disabled={disabled} id={`${idBase}-maiusculas`} label={styleCopy.uppercase} onCheckedChange={(uppercase) => update({ uppercase })} />
      <NumberField
        disabled={disabled}
        id={`${idBase}-letras`}
        integer={false}
        label={styleCopy.letterSpacing}
        max={LIMITS.letterSpacing.max}
        min={LIMITS.letterSpacing.min}
        onChange={(letterSpacing) => update({ letterSpacing })}
        step={0.01}
        value={value.letterSpacing}
      />
    </div>
  );
}

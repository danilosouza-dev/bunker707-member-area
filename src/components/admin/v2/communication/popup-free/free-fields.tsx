"use client";

import { NumberField as BaseNumberField } from "@base-ui/react/number-field";
import { Popover } from "@base-ui/react/popover";
import { AlertCircle, AlertTriangle, ArrowDown, ArrowUp, Check, GripVertical, ImageIcon, ImageUp, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FreeIcon } from "@/components/member/notifications/popup-free/popup-free-icons";
import type { FreeHint } from "@/server/communications/popup-free-checks";
import {
  FREE_DESIGN_LIMITS,
  FREE_ICON_NAMES,
  type FreeBorder,
  type FreeColorStop,
  type FreeFillPaint,
  type FreeIconName,
  type FreeId,
  type FreeImageAsset,
  type FreeLine,
  type FreeShadow,
  type FreeSides,
  type FreeTextPaint,
  type PopupFreeDesign
} from "@/server/communications/popup-free-model";
import { freeAssetUrl, freeStorageOrigin, type FreeResolvedTextStyle } from "@/server/communications/popup-free-render";
import type { PopupFontOption, PopupFontRef, PopupFontWeight } from "@/server/communications/popup-design-model";
import { adminInputClass, adminPillClasses, adminTextareaClass } from "../../form";
import { AdminSwitch } from "../../settings/kit";
import { adminTransition } from "../../styles";
import { ColorField, DesignSection, PillField, fieldLabelClass } from "../popup-design/design-controls";
import { FontPicker, WeightPicker } from "../popup-design/font-picker";
import { FontUploadDialog } from "../popup-design/font-upload-dialog";
import { uploadFreeImageFile } from "./free-assets";
import { FREE_LIST_DRAG_START_PX } from "./free-editor-geometry";
import {
  FREE_DECORATION_OPTIONS,
  FREE_FILL_IMAGE_FIT_OPTIONS,
  FREE_FILL_KIND_OPTIONS,
  FREE_ICON_LABELS,
  FREE_INSPECTOR_COPY,
  FREE_LINE_STYLE_OPTIONS,
  FREE_MARK_DEFAULT_COLOR,
  FREE_RADIAL_EXTENT_OPTIONS,
  FREE_RADIAL_SHAPE_OPTIONS,
  FREE_SPAN_PAINT_OPTIONS,
  FREE_TEXT_PAINT_OPTIONS,
  addFreeFillLayer,
  addFreeShadow,
  addFreeStop,
  applyFreeSpanStyle,
  freeBottomEdgeShadow,
  freeFillDropAt,
  freeFillFocusAfter,
  freeFillFocusId,
  freeFillPaintOfKind,
  freeFillReorder,
  freeFillSwatch,
  freeGlowShadow,
  freeImageAssets,
  freeLinesText,
  freeMarkPadding,
  freeMarkRadius,
  freeRadiusFour,
  freeRadiusFromFour,
  freeRangeHasOwnStyle,
  freeRangeMessage,
  freeRangeStyle,
  freeSidesFour,
  freeSidesFromFour,
  freeSidesUniform,
  freeStopsPreview,
  freeStrokeDisabledReason,
  freeStrokeSwitchPatch,
  freeStyledParts,
  freeTextAreaChange,
  freeTextPaintOfKind,
  moveFreeFillLayer,
  moveFreeFillLayerTo,
  newFreeBorder,
  newFreeFillLayer,
  newFreeShadow,
  removeFreeFillLayer,
  removeFreeStop,
  setFreeStop,
  splitFreeSpanAtSelection,
  withFreeFillLayerAsset,
  withFreeMarkPadding,
  withFreeMarkRadius,
  type FreeFillPaintKind,
  type FreeFour,
  type FreeSpanStylePatch,
  type FreeTextRange
} from "./free-inspector-model";
import { FREE_POINTER_MOUSE_AND_PEN, followFreePointer } from "./free-pointer-drag";

// Editor Livre do pop-up (docs/27; spec §4.6 e §4.7), pacote I: os campos do painel da direita. Numero com
// unidade (NumberField do Base UI: arrastar no rotulo, setas e Shift = 10, a frase do limite), lados e cantos,
// borda, sombras com os atalhos, paradas do degradê, pintura do texto, camadas de fundo (com a faixa Ordem do L4a:
// arrastar a ficha ou Alt e as setas, docs/27 §13.9), grade de icones, escolher/enviar imagem, a fonte (o seletor e
// o envio do Personalizado, sem mudar nada neles) e a area de texto com "Outro estilo na seleção" (com o contorno e
// o marca-texto da parte, L6b) e as fichas das partes. Tudo so com valores validados; nenhum texto do design em
// estilo (a faixa do degradê e as amostras das camadas usam so cores hex e posicoes inteiras).

const L = FREE_DESIGN_LIMITS;
const C = FREE_INSPECTOR_COPY;

/** A origem do nosso Storage (miniaturas das imagens do design, como o cartao). */
export const FREE_STORAGE_ORIGIN = freeStorageOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);

/* ------------------------------------------------------------------------------------------------
 * Foco num campo (pedido do Revisar ou de um elemento recem-adicionado)
 * ---------------------------------------------------------------------------------------------- */

const FOCUSABLE = 'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Poe o foco no campo pelo id (ou no primeiro controle dentro dele; ou no grupo de radios com esse nome). */
export function focusFreeField(fieldId: string): boolean {
  const byId = document.getElementById(fieldId);
  const target =
    byId && (byId.matches(FOCUSABLE) || byId.tabIndex >= 0)
      ? byId
      : (byId?.querySelector<HTMLElement>(FOCUSABLE) ??
        document.querySelector<HTMLElement>(`input[name="${CSS.escape(fieldId)}"]:checked`) ??
        document.querySelector<HTMLElement>(`input[name="${CSS.escape(fieldId)}"]`) ??
        byId);

  if (!target) {
    return false;
  }

  target.focus({ preventScroll: false });
  target.scrollIntoView?.({ block: "nearest" });

  return true;
}

/** O valor mais novo para quem termina depois (envio de arquivo): lido so em eventos e efeitos. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  });

  return ref;
}

/* ------------------------------------------------------------------------------------------------
 * Pecas pequenas
 * ---------------------------------------------------------------------------------------------- */

export function FreeFieldError({ id, message }: { id?: string; message?: string | null }) {
  return message ? (
    <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" id={id}>
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{message}</span>
    </p>
  ) : null;
}

export function FreeNote({ children, id, tone = "neutral" }: { children: ReactNode; id?: string; tone?: "neutral" | "warning" }) {
  return (
    <p className={cn("text-xs leading-5", tone === "warning" ? "text-[var(--warning)]" : "text-[var(--text-secondary)]")} id={id}>
      {children}
    </p>
  );
}

/** As dicas do Revisar que valem para este campo (nao impedem salvar). */
export function FreeHints({ action, hints }: { action?: ReactNode; hints: readonly FreeHint[] }) {
  if (hints.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {hints.map((hint) => (
        <p className="flex items-start gap-2 text-[13px] leading-5 text-[var(--warning)]" key={`${hint.kind}-${hint.key}`}>
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{hint.message}</span>
        </p>
      ))}
      {action}
    </div>
  );
}

/** Secao do painel (linha em cima e titulo): a mesma do Personalizado. */
export function FreeSection({ children, description, id, title }: { children: ReactNode; description?: string; id?: string; title: string }) {
  return (
    <DesignSection description={description} id={id} title={title}>
      {children}
    </DesignSection>
  );
}

/** Grupo de um campo so (linha em cima, sem titulo: o rotulo do proprio campo diz o que e). */
export function FreeGroup({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-4 border-t border-[var(--border-subtle)] pt-5" id={id}>
      {children}
    </div>
  );
}

export const freeSmallButton = cn("h-9 gap-1.5 px-3 text-[13px] pointer-coarse:h-11", adminTransition);

/**
 * Pilulas com opcao desligada (ex.: "Abrir um link" quando outro botao ja abre um link): a opcao fica visivel,
 * desligada, e a frase do motivo aparece embaixo. Radios nativos: setas e leitor de tela funcionam.
 */
export function FreeChoiceField<Value extends string>({
  disabled,
  disabledReason,
  error,
  label,
  name,
  onChange,
  options,
  value
}: {
  disabled?: boolean;
  disabledReason?: string | null;
  error?: string | null;
  label: string;
  name: string;
  onChange: (value: Value) => void;
  options: readonly { disabled?: boolean; label: string; value: Value }[];
  value: Value;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className={fieldLabelClass} id={`${name}-titulo`}>
        {label}
      </span>
      <div aria-describedby={disabledReason ? `${name}-motivo` : undefined} aria-labelledby={`${name}-titulo`} className="flex min-w-0 flex-wrap gap-2" role="radiogroup">
        {options.map((option) => {
          const checked = option.value === value;
          const off = disabled || (option.disabled && !checked);

          return (
            <label
              className={cn(
                adminPillClasses(checked),
                "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[var(--focus-ring)]",
                off && "cursor-not-allowed opacity-50"
              )}
              key={option.value}
            >
              <input checked={checked} className="sr-only" disabled={off} name={name} onChange={() => onChange(option.value)} type="radio" value={option.value} />
              {checked ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
              {option.label}
            </label>
          );
        })}
      </div>
      {disabledReason ? <FreeNote id={`${name}-motivo`}>{disabledReason}</FreeNote> : null}
      <FreeFieldError message={error} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Numero com unidade
 * ---------------------------------------------------------------------------------------------- */

type FreeNumberFieldProps = {
  bounds: { max: number; min: number };
  disabled?: boolean;
  error?: string | null;
  hint?: ReactNode;
  id: string;
  /** Inteiro (px, %, °) ou com 2 casas (altura da linha, espaco entre letras, traco). */
  integer?: boolean;
  label: string;
  onChange: (value: number) => void;
  step?: number;
  unit?: string;
  value: number;
};

/**
 * Numero com limite (spec §4.6): arrastar no rotulo muda o valor, setas sobem e descem (Shift = 10 passos), a
 * unidade ao lado. So valor dentro do limite vai para o design; fora dele, a frase do limite embaixo e, ao sair
 * do campo, volta ao ultimo valor que valia.
 */
export function FreeNumberField({ bounds, disabled, error, hint, id, integer = true, label, onChange, step, unit, value }: FreeNumberFieldProps) {
  // O campo guarda o que esta escrito (mesmo fora do limite ou vazio); o design so recebe valor que vale.
  const [draft, setDraft] = useState<number | null>(value);
  const [synced, setSynced] = useState(value);
  const unitStep = step ?? (integer ? 1 : 0.01);
  const outside = draft !== null && (draft < bounds.min || draft > bounds.max);
  const message = error ?? (outside ? freeRangeMessage(bounds) : null);
  const describedBy = [message ? `${id}-error` : hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;

  if (!Object.is(value, synced)) {
    setSynced(value);
    setDraft(value);
  }

  function accept(next: number | null) {
    setDraft(next);

    if (next === null || !Number.isFinite(next) || next < bounds.min || next > bounds.max) {
      return;
    }

    const clean = integer ? Math.round(next) : Math.round(next * 100) / 100;

    if (clean !== value) {
      setSynced(clean);
      onChange(clean);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <BaseNumberField.Root
        allowOutOfRange
        className="flex min-w-0 flex-col gap-1.5"
        disabled={disabled}
        format={{ maximumFractionDigits: integer ? 0 : 2, useGrouping: false }}
        id={id}
        largeStep={unitStep * 10}
        locale="pt-BR"
        max={bounds.max}
        min={bounds.min}
        onValueChange={(next) => accept(next)}
        onValueCommitted={(next) => {
          // Ao sair do campo (ou Enter) com valor fora do limite ou vazio: volta ao ultimo que valia.
          if (next === null || !Number.isFinite(next) || next < bounds.min || next > bounds.max) {
            setDraft(value);
          }
        }}
        smallStep={unitStep}
        step={unitStep}
        value={draft}
      >
        <BaseNumberField.ScrubArea className="w-fit cursor-ew-resize touch-none select-none">
          <label className={fieldLabelClass} htmlFor={id}>
            {label}
          </label>
        </BaseNumberField.ScrubArea>
        <BaseNumberField.Group className="flex min-w-0 items-center gap-2">
          <BaseNumberField.Input
            aria-describedby={describedBy}
            aria-invalid={message ? true : undefined}
            className={cn(adminInputClass, "w-24 tabular-nums")}
          />
          {unit ? <span className="text-sm leading-5 text-[var(--text-secondary)]">{unit}</span> : null}
        </BaseNumberField.Group>
      </BaseNumberField.Root>
      {hint && !message ? (
        <p className="text-xs leading-5 text-[var(--text-secondary)]" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      <FreeFieldError id={`${id}-error`} message={message} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Lados (respiro, margem) e cantos
 * ---------------------------------------------------------------------------------------------- */

export function FreeSidesField({
  bounds,
  disabled,
  error,
  hint,
  id,
  label,
  onChange,
  value
}: {
  bounds: { max: number; min: number };
  disabled?: boolean;
  error?: string | null;
  hint?: string;
  id: string;
  label: string;
  onChange: (value: FreeSides) => void;
  value: FreeSides | undefined;
}) {
  const four = freeSidesFour(value);
  const [each, setEach] = useState(() => !freeSidesUniform(value));
  const uniform = !each;

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" id={id} tabIndex={-1}>
      <legend className={cn(fieldLabelClass, "mb-1.5 p-0")}>{label}</legend>
      <AdminSwitch
        checked={uniform}
        disabled={disabled}
        id={`${id}-iguais`}
        label={C.advanced.sidesSame}
        onCheckedChange={(checked) => {
          setEach(!checked);

          if (checked) {
            onChange(four[0]);
          }
        }}
      />
      {uniform ? (
        <FreeNumberField bounds={bounds} disabled={disabled} id={`${id}-todos`} label={label} onChange={(next) => onChange(next)} unit={C.units.px} value={four[0]} />
      ) : (
        <div className="grid min-w-0 grid-cols-2 gap-3">
          {C.advanced.sides.map((side, index) => (
            <FreeNumberField
              bounds={bounds}
              disabled={disabled}
              id={`${id}-${index}`}
              key={side}
              label={side}
              onChange={(next) => {
                const updated = [...four] as FreeFour;

                updated[index] = next;
                onChange(freeSidesFromFour(updated));
              }}
              unit={C.units.px}
              value={four[index]}
            />
          ))}
        </div>
      )}
      {hint && !error ? <FreeNote>{hint}</FreeNote> : null}
      <FreeFieldError message={error} />
    </fieldset>
  );
}

const PILL = 999;

/** Cantos de elemento: "Todos iguais" ou "Cada canto" (4 campos) e o atalho "Pílula". */
export function FreeRadiusField({
  disabled,
  error,
  id,
  max = L.radius.max,
  onChange,
  pill = true,
  single = false,
  value
}: {
  disabled?: boolean;
  error?: string | null;
  id: string;
  max?: number;
  onChange: (value: number | FreeFour) => void;
  pill?: boolean;
  /** A prancheta: um numero so (0 a 64). */
  single?: boolean;
  value: number | FreeFour | undefined;
}) {
  const four = freeRadiusFour(value);
  const [each, setEach] = useState(() => !single && !four.every((corner) => corner === four[0]));
  const bounds = { max, min: 0 };

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" id={id} tabIndex={-1}>
      <legend className={cn(fieldLabelClass, "mb-1.5 p-0")}>{C.radius.title}</legend>
      {single ? null : (
        <PillField
          disabled={disabled}
          label={C.radius.title}
          name={`${id}-modo`}
          onChange={(mode) => {
            setEach(mode === "each");

            if (mode === "same") {
              onChange(four[0]);
            }
          }}
          options={[
            { label: C.radius.same, value: "same" },
            { label: C.radius.each, value: "each" }
          ]}
          value={each ? "each" : "same"}
        />
      )}
      {each ? (
        <div className="grid min-w-0 grid-cols-2 gap-3">
          {C.radius.corners.map((corner, index) => (
            <FreeNumberField
              bounds={bounds}
              disabled={disabled}
              id={`${id}-${index}`}
              key={corner}
              label={corner}
              onChange={(next) => {
                const updated = [...four] as FreeFour;

                updated[index] = next;
                onChange(freeRadiusFromFour(updated));
              }}
              unit={C.units.px}
              value={four[index]}
            />
          ))}
        </div>
      ) : (
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          <FreeNumberField bounds={bounds} disabled={disabled} id={`${id}-valor`} label={C.radius.value} onChange={(next) => onChange(next)} unit={C.units.px} value={Math.min(four[0], max)} />
          {pill ? (
            <Button
              aria-pressed={four[0] >= PILL}
              className={freeSmallButton}
              disabled={disabled}
              onClick={() => {
                setEach(false);
                onChange(PILL);
              }}
              type="button"
              variant="secondary"
            >
              {C.radius.pill}
            </Button>
          ) : null}
        </div>
      )}
      <FreeFieldError message={error} />
    </fieldset>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Borda e sombras
 * ---------------------------------------------------------------------------------------------- */

/** Borda: espessura (0 tira a borda), cor e tipo. */
export function FreeBorderField({
  colorLabel = C.border.color,
  disabled,
  error,
  id,
  onChange,
  title = C.border.title,
  value
}: {
  colorLabel?: string;
  disabled?: boolean;
  error?: string | null;
  id: string;
  onChange: (border: FreeBorder | undefined) => void;
  title?: string;
  value: FreeBorder | undefined;
}) {
  const border = value ?? { ...newFreeBorder(), width: 0 };

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" id={id} tabIndex={-1}>
      <legend className={cn(fieldLabelClass, "mb-1.5 p-0")}>{title}</legend>
      <FreeNumberField
        bounds={L.borderWidth}
        disabled={disabled}
        id={`${id}-espessura`}
        label={C.border.width}
        onChange={(width) => onChange(width === 0 ? undefined : { ...border, width })}
        unit={C.units.px}
        value={value?.width ?? 0}
      />
      {value ? (
        <>
          <ColorField disabled={disabled} id={`${id}-cor`} label={colorLabel} onChange={(color) => onChange({ ...border, color })} value={border.color} />
          <PillField
            disabled={disabled}
            label={C.border.style}
            name={`${id}-tipo`}
            onChange={(style) => onChange(style === "solid" ? { color: border.color, width: border.width } : { ...border, style })}
            options={FREE_LINE_STYLE_OPTIONS}
            value={border.style ?? "solid"}
          />
        </>
      ) : null}
      <FreeFieldError message={error} />
    </fieldset>
  );
}

/** Ate 2 sombras (inclusive por dentro), com os atalhos Brilho e Borda de baixo. */
export function FreeShadowsField({
  disabled,
  error,
  fillColor,
  id,
  onChange,
  shortcuts = true,
  title = C.shadows.title,
  value
}: {
  disabled?: boolean;
  error?: string | null;
  /** A cor de base do fundo do elemento (para os atalhos). */
  fillColor: string | null;
  id: string;
  onChange: (shadows: FreeShadow[] | undefined) => void;
  shortcuts?: boolean;
  title?: string;
  value: readonly FreeShadow[] | undefined;
}) {
  const shadows = value ?? [];
  const full = shadows.length >= L.shadows;

  function update(index: number, patch: Partial<FreeShadow>) {
    onChange(shadows.map((shadow, position) => (position === index ? cleanShadow({ ...shadow, ...patch }) : shadow)));
  }

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" id={id} tabIndex={-1}>
      <legend className={cn(fieldLabelClass, "mb-1.5 p-0")}>{title}</legend>
      {shadows.map((shadow, index) => (
        <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border-subtle)] p-3" key={index}>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{C.shadows.item(index)}</span>
            <Button
              aria-label={`${C.shadows.remove}: ${C.shadows.item(index)}`}
              className={freeSmallButton}
              disabled={disabled}
              onClick={() => {
                const next = shadows.filter((_, position) => position !== index);

                onChange(next.length > 0 ? next : undefined);
              }}
              type="button"
              variant="ghost"
            >
              <Trash2 aria-hidden="true" className="size-4" />
              {C.shadows.remove}
            </Button>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-3">
            <FreeNumberField bounds={L.shadowOffset} disabled={disabled} id={`${id}-${index}-x`} label={C.shadows.x} onChange={(x) => update(index, { x })} unit={C.units.px} value={shadow.x} />
            <FreeNumberField bounds={L.shadowOffset} disabled={disabled} id={`${id}-${index}-y`} label={C.shadows.y} onChange={(y) => update(index, { y })} unit={C.units.px} value={shadow.y} />
            <FreeNumberField bounds={L.shadowBlur} disabled={disabled} id={`${id}-${index}-desfoque`} label={C.shadows.blur} onChange={(blur) => update(index, { blur })} unit={C.units.px} value={shadow.blur} />
            <FreeNumberField
              bounds={L.shadowSpread}
              disabled={disabled}
              id={`${id}-${index}-expansao`}
              label={C.shadows.spread}
              onChange={(spread) => update(index, { spread })}
              unit={C.units.px}
              value={shadow.spread}
            />
          </div>
          <ColorField disabled={disabled} id={`${id}-${index}-cor`} label={C.shadows.color} onChange={(color) => update(index, { color })} value={shadow.color} />
          <AdminSwitch checked={shadow.inset === true} disabled={disabled} id={`${id}-${index}-dentro`} label={C.shadows.inset} onCheckedChange={(inset) => update(index, { inset })} />
        </div>
      ))}
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button aria-label={C.shadows.addLabel} className={freeSmallButton} disabled={disabled || full} onClick={() => onChange(addFreeShadow(shadows, newFreeShadow()))} type="button" variant="secondary">
          <Plus aria-hidden="true" className="size-4" />
          {C.shadows.add}
        </Button>
        {shortcuts ? (
          <>
            <Button className={freeSmallButton} disabled={disabled || full} onClick={() => onChange(addFreeShadow(shadows, freeGlowShadow(fillColor)))} type="button" variant="secondary">
              {C.shadows.glow}
            </Button>
            <Button className={freeSmallButton} disabled={disabled || full} onClick={() => onChange(addFreeShadow(shadows, freeBottomEdgeShadow(fillColor)))} type="button" variant="secondary">
              {C.shadows.bottomEdge}
            </Button>
          </>
        ) : null}
      </div>
      <FreeFieldError message={error} />
    </fieldset>
  );
}

function cleanShadow(shadow: FreeShadow): FreeShadow {
  if (shadow.inset) {
    return shadow;
  }

  const { inset: unused, ...rest } = shadow;

  void unused;

  return rest;
}

/* ------------------------------------------------------------------------------------------------
 * Degradê: paradas e pinturas
 * ---------------------------------------------------------------------------------------------- */

export function FreeStopsField({ disabled, id, onChange, stops }: { disabled?: boolean; id: string; onChange: (stops: FreeColorStop[]) => void; stops: readonly FreeColorStop[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <span aria-hidden="true" className="h-6 w-full rounded-md border border-[var(--border-strong)]" style={{ backgroundImage: freeStopsPreview(stops) }} />
      {stops.map((stop, index) => (
        <div className="flex min-w-0 flex-wrap items-end gap-3" key={index}>
          <ColorField disabled={disabled} id={`${id}-cor-${index}`} label={C.fill.stopColor(index)} onChange={(color) => onChange(setFreeStop(stops, index, { color }))} value={stop.color} />
          <FreeNumberField
            bounds={L.percent}
            disabled={disabled}
            id={`${id}-posicao-${index}`}
            label={C.fill.stopPosition(index)}
            onChange={(at) => onChange(setFreeStop(stops, index, { at }))}
            unit={C.units.percent}
            value={stop.at}
          />
          <Button
            aria-label={C.fill.stopRemove(index)}
            className={cn(freeSmallButton, "px-2")}
            disabled={disabled || stops.length <= L.stops.min}
            onClick={() => onChange(removeFreeStop(stops, index))}
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>
      ))}
      <div>
        <Button aria-label={C.fill.stopAddLabel} className={freeSmallButton} disabled={disabled || stops.length >= L.stops.max} onClick={() => onChange(addFreeStop(stops))} type="button" variant="secondary">
          <Plus aria-hidden="true" className="size-4" />
          {C.fill.stopAdd}
        </Button>
      </div>
    </div>
  );
}

/** As cores de uma pintura de degradê (linear: ângulo; circular: centro, formato e até onde vai). */
function GradientFields({
  disabled,
  id,
  onChange,
  paint
}: {
  disabled?: boolean;
  id: string;
  onChange: (paint: FreeTextPaint) => void;
  paint: Exclude<FreeTextPaint, { kind: "solid" }>;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {paint.kind === "linear" ? (
        <FreeNumberField bounds={L.angle} disabled={disabled} id={`${id}-angulo`} label={C.fill.angle} onChange={(angle) => onChange({ ...paint, angle })} unit={C.units.degrees} value={paint.angle ?? 180} />
      ) : (
        <>
          <div className="grid min-w-0 grid-cols-2 gap-3">
            <FreeNumberField bounds={L.percent} disabled={disabled} id={`${id}-centro-x`} label={C.fill.centerX} onChange={(x) => onChange({ ...paint, x })} unit={C.units.percent} value={paint.x} />
            <FreeNumberField bounds={L.percent} disabled={disabled} id={`${id}-centro-y`} label={C.fill.centerY} onChange={(y) => onChange({ ...paint, y })} unit={C.units.percent} value={paint.y} />
          </div>
          <PillField disabled={disabled} label={C.fill.shape} name={`${id}-formato`} onChange={(shape) => onChange({ ...paint, shape })} options={FREE_RADIAL_SHAPE_OPTIONS} value={paint.shape ?? "ellipse"} />
          <PillField disabled={disabled} label={C.fill.extent} name={`${id}-ate`} onChange={(extent) => onChange({ ...paint, extent })} options={FREE_RADIAL_EXTENT_OPTIONS} value={paint.extent ?? "farthest-corner"} />
        </>
      )}
      <FreeStopsField disabled={disabled} id={id} onChange={(stops) => onChange({ ...paint, stops })} stops={paint.stops} />
    </div>
  );
}

/** Cor do texto: Cor | Degradê | Degradê circular (na parte do texto: Cor | Degradê). */
export function FreeTextPaintField({
  disabled,
  error,
  id,
  label = C.style.paint,
  onChange,
  spanOnly = false,
  value
}: {
  disabled?: boolean;
  error?: string | null;
  id: string;
  label?: string;
  onChange: (paint: FreeTextPaint) => void;
  spanOnly?: boolean;
  value: FreeTextPaint;
}) {
  const options = spanOnly ? FREE_SPAN_PAINT_OPTIONS : FREE_TEXT_PAINT_OPTIONS;

  return (
    <div className="flex min-w-0 flex-col gap-3 outline-none" id={id} tabIndex={-1}>
      <PillField
        disabled={disabled}
        label={label}
        name={`${id}-tipo`}
        onChange={(kind) => onChange(freeTextPaintOfKind(kind, value))}
        options={options as readonly { label: string; value: FreeTextPaint["kind"] }[]}
        value={spanOnly && value.kind === "radial" ? "linear" : value.kind}
      />
      {value.kind === "solid" ? (
        <ColorField disabled={disabled} id={`${id}-cor`} label={label} labelHidden onChange={(color) => onChange({ color, kind: "solid" })} value={value.color} />
      ) : (
        <GradientFields disabled={disabled} id={id} onChange={onChange} paint={value} />
      )}
      <FreeFieldError message={error} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Camadas de fundo
 * ---------------------------------------------------------------------------------------------- */

/** Monta as camadas com o id do arquivo da imagem (o fundo mais novo vem em `current`). */
export type FreeImageLayerHandler = (
  build: (assetId: FreeId, current: readonly FreeFillPaint[]) => readonly FreeFillPaint[],
  image: { height: number; path: string; width: number } | FreeId
) => void;

function fillKindLabel(kind: FreeFillPaintKind) {
  return FREE_FILL_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

/** O que a faixa Ordem fala; o id troca a cada vez, para a mesma frase de novo tambem ser falada. */
type FreeFillSaid = { id: number; text: string };
/** Pedido de foco depois de uma mudanca na lista (resolvido uma vez, depois de a lista nova aparecer). */
type FreeFillFocusRequest = { action: "add" | "down" | "order" | "remove" | "up"; index: number; seq: number };
/** O gesto da faixa Ordem: a ficha que sai e o lugar onde ela entraria (null = fora da faixa, nao muda nada). */
type FreeFillDrag = { from: number; to: number | null };

/** A amostra da ficha: a pintura da camada (cores hex validadas) ou o icone da imagem. */
function FillSwatch({ paint }: { paint: FreeFillPaint }) {
  const swatch = freeFillSwatch(paint);

  return (
    <span
      aria-hidden="true"
      className="grid size-5 shrink-0 place-items-center overflow-hidden rounded border border-[var(--border-strong)] bg-[repeating-conic-gradient(#3f3f46_0%_25%,#18181b_0%_50%)] bg-[length:8px_8px]"
    >
      {swatch ? <span className="size-full" style={{ backgroundImage: swatch }} /> : <ImageIcon className="size-3.5 text-[var(--text-secondary)]" />}
    </span>
  );
}

/**
 * Fundo: camadas (a de cima primeiro), "+ Camada de fundo" (Cor, Degradê, Degradê circular, Imagem), Subir,
 * Descer e Tirar em cada uma. Imagem escolhe uma do design ou envia uma nova.
 * Com 2 ou 3 camadas, a faixa "Ordem" no topo (docs/27 §13.9, L4a): uma ficha por camada, que se arrasta (mouse ou
 * caneta, a partir de 4 px; a ficha tem touch-action: none) ou anda com Alt e as setas (o editor nao move o elemento
 * por elas com o foco na ficha). Mudar a ordem, Tirar e "+ Camada" vao como um passo proprio no historico
 * (`{ step: true }`: nao juntam com a cor de antes); a cor, o tipo e os numeros vao sem `options`. O foco segue a
 * camada pelos ids `${id}-${indice}-subir`, `-descer`, `-tirar`, `-ordem` e `${id}-acrescentar`. O soltar so grava
 * com o fundo igual ao do comeco do gesto; soltar no mesmo lugar ou longe da faixa nao muda nada. Enquanto uma imagem
 * desta lista sobe, a faixa, Subir, Descer, Tirar, "+ Camada" e o cartao que espera a imagem ficam desligados, e a
 * imagem acha a sua camada pela referencia (nunca pelo indice da hora do envio).
 */
export function FreeFillLayersField({
  baseColor,
  disabled,
  error,
  id,
  design,
  min = 0,
  onBusyChange,
  onChange,
  onImageLayer,
  value
}: {
  baseColor: string | null;
  design: PopupFreeDesign;
  disabled?: boolean;
  error?: string | null;
  id: string;
  min?: number;
  onBusyChange: (reason: string | null) => void;
  /** `step`: mudanca de lugar, Tirar ou "+ Camada" (um passo proprio no historico, montado pelo design mais novo). */
  onChange: (fill: FreeFillPaint[] | undefined, options?: { step?: boolean }) => void;
  /** Camada de imagem: quem chama poe o arquivo no design (enviado ou escolhido) e monta as camadas com o id. */
  onImageLayer: FreeImageLayerHandler;
  value: readonly FreeFillPaint[] | undefined;
}) {
  const fill = value ?? [];
  const [adding, setAdding] = useState<FreeFillPaintKind>("solid");
  const [pendingImage, setPendingImage] = useState(false);
  // A camada cuja imagem esta subindo ("new": a camada nova de imagem, ainda fora da lista).
  const [sending, setSending] = useState<FreeFillPaint | "new" | null>(null);
  const [drag, setDrag] = useState<FreeFillDrag | null>(null);
  const [said, setSaid] = useState<FreeFillSaid>({ id: 0, text: "" });
  const [focusAfter, setFocusAfter] = useState<FreeFillFocusRequest | null>(null);
  const focusDone = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);
  const disposeDrag = useRef<(() => void) | null>(null);
  const images = freeImageAssets(design);
  const full = fill.length >= L.fills;
  const busy = sending !== null;
  const off = Boolean(disabled) || busy;

  function commit(next: FreeFillPaint[], options?: { step?: boolean }) {
    onChange(next.length > 0 ? next : undefined, options);
  }

  function update(index: number, paint: FreeFillPaint) {
    commit(fill.map((layer, position) => (position === index ? paint : layer)));
  }

  /** Mudar de lugar, Tirar ou "+ Camada": um passo proprio, e o foco vai para onde a camada ficou. */
  function commitStep(next: FreeFillPaint[], action: FreeFillFocusRequest["action"], index: number) {
    commit(next, { step: true });
    setFocusAfter((current) => ({ action, index, seq: (current?.seq ?? 0) + 1 }));
  }

  /** A faixa Ordem levou uma camada a `to`: grava, poe o foco na ficha dela e fala o lugar novo. */
  function placeLayer(next: FreeFillPaint[], to: number) {
    commitStep(next, "order", to);
    setSaid((current) => ({ id: current.id + 1, text: C.fill.moved(C.fill.layer(to, fillKindLabel(next[to].kind))) }));
  }

  /** O envio da imagem desta camada liga e desliga o ocupado do editor e o desta lista. */
  function busyFor(layer: FreeFillPaint | "new") {
    return (reason: string | null) => {
      setSending(reason ? layer : null);
      onBusyChange(reason);
    };
  }

  // O soltar acontece fora do React (ouvintes na janela): le o fundo e as funcoes da ultima vez que a lista foi
  // desenhada (o onChange de agora monta pelo design mais novo).
  const live = useRef({ fill, placeLayer });

  useLayoutEffect(() => {
    live.current = { fill, placeLayer };
  });

  // O foco segue a camada: uma vez por mudanca, depois de a lista nova aparecer (no WebKit o clique nao da foco ao
  // botao, e um botao que desliga com o foco o perderia).
  useLayoutEffect(() => {
    if (!focusAfter || focusAfter.seq === focusDone.current) {
      return;
    }

    focusDone.current = focusAfter.seq;
    document.getElementById(freeFillFocusId(id, freeFillFocusAfter(focusAfter.action, focusAfter.index, fill.length, min)))?.focus();
  });

  useEffect(() => {
    const dispose = disposeDrag;

    return () => dispose.current?.();
  }, []);

  /** O lugar onde a ficha `from` entraria com o ponteiro neste ponto (px de tela), pelas fichas medidas agora. */
  function dropAt(from: number, client: { x: number; y: number }) {
    const list = listRef.current;

    if (!list) {
      return null;
    }

    const mids = Array.from(list.querySelectorAll<HTMLElement>("[data-free-fill-grip]"), (grip) => {
      const box = grip.getBoundingClientRect();

      return box.top + box.height / 2;
    });

    return freeFillDropAt(from, client, list.getBoundingClientRect(), mids);
  }

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>, from: number) {
    // Um gesto comecado segue ate o fim: o pointerdown de outro ponteiro (um toque com o mouse apertado) nao o desliga.
    if (off || drag || fill.length < 2) {
      return;
    }

    disposeDrag.current?.();

    // A foto do fundo e tirada no comeco do gesto (passado o limiar), nao no pointerdown: antes disso pode ser so um
    // clique, e o blur de um campo pode gravar antes.
    let start: readonly FreeFillPaint[] | null = null;

    disposeDrag.current = followFreePointer(event, {
      onCancel: () => setDrag(null),
      onDrop: (client) => {
        // O lugar sai do ponto do pointerup (a lista pode ter rolado sem mexer o ponteiro).
        const to = dropAt(from, client);
        const now = live.current;
        const next = start && to !== null ? freeFillReorder(start, now.fill, from, to) : null;

        setDrag(null);

        if (next && to !== null) {
          now.placeLayer(next, to);
        }
      },
      onMove: (client) => {
        const to = dropAt(from, client);

        setDrag((current) => (current && current.from === from && current.to === to ? current : { from, to }));
      },
      onStart: () => {
        start = live.current.fill;
        setDrag({ from, to: from });
      },
      pointerTypes: FREE_POINTER_MOUSE_AND_PEN,
      threshold: FREE_LIST_DRAG_START_PX
    });
  }

  function onGripKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, from: number) {
    if (!event.altKey || event.ctrlKey || event.metaKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
      return;
    }

    // Sempre, mesmo sem mudar: com o foco na ficha, Alt e as setas nao chegam ao editor (que moveria o elemento).
    event.preventDefault();
    event.stopPropagation();

    const to = from + (event.key === "ArrowUp" ? -1 : 1);
    const next = off ? null : moveFreeFillLayerTo(fill, from, to);

    if (next) {
      placeLayer(next, to);
    }
  }

  const dropEdge = drag && drag.to !== null && drag.to !== drag.from ? (drag.to < drag.from ? "before" : "after") : null;

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" id={id} tabIndex={-1}>
      <legend className={cn(fieldLabelClass, "mb-0.5 p-0")}>{C.fill.title}</legend>
      {fill.length !== 1 ? <FreeNote>{fill.length > 1 ? C.fill.topFirst : C.fill.empty}</FreeNote> : null}
      {fill.length >= 2 ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <span aria-hidden="true" className={fieldLabelClass}>
            {C.fill.order}
          </span>
          <ol aria-label={C.fill.orderLabel} className="m-0 flex min-w-0 list-none flex-col gap-1 p-0" ref={listRef}>
            {fill.map((paint, index) => {
              const layer = C.fill.layer(index, fillKindLabel(paint.kind));
              const dragging = drag?.from === index;

              return (
                <li className="relative min-w-0" data-free-fill-layer={index} key={index}>
                  {dropEdge && drag?.to === index ? (
                    <span
                      aria-hidden="true"
                      className={cn("pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-[var(--focus-ring)]", dropEdge === "before" ? "-top-[3px]" : "-bottom-[3px]")}
                      data-free-fill-drop={dropEdge}
                    />
                  ) : null}
                  <button
                    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                    aria-label={C.fill.handle(layer)}
                    className={cn(
                      "flex h-9 w-full min-w-0 touch-none items-center gap-2 rounded-md border border-[var(--border-subtle)] px-2 text-left text-[13px] leading-5 text-[var(--text-primary)] outline-none select-none",
                      // O cursor: pointer de todo botao (globals.css, fora das camadas) so cede com o !.
                      "hover:bg-[var(--hover-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] active:cursor-grabbing! disabled:cursor-not-allowed! disabled:opacity-60 pointer-coarse:h-11",
                      dragging ? "cursor-grabbing! opacity-50" : "cursor-grab!",
                      adminTransition
                    )}
                    data-free-fill-dragging={dragging ? "" : undefined}
                    data-free-fill-grip={index}
                    disabled={off}
                    id={`${id}-${index}-ordem`}
                    onKeyDown={(event) => onGripKeyDown(event, index)}
                    onPointerDown={(event) => beginDrag(event, index)}
                    type="button"
                  >
                    <GripVertical aria-hidden="true" className="size-4 shrink-0 text-[var(--text-tertiary)]" />
                    <FillSwatch paint={paint} />
                    <span className="min-w-0 truncate">{layer}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
      {fill.map((paint, index) => {
        const layer = C.fill.layer(index, fillKindLabel(paint.kind));
        // O cartao que espera a imagem: o Tipo, o "Como preenche" e o ponto de foco trocariam a camada que a imagem procura.
        const cardOff = Boolean(disabled) || sending === paint;

        return (
          <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border-subtle)] p-3" key={index}>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{layer}</span>
              <div className="flex items-center gap-1">
                <Button
                  aria-label={`${C.fill.moveUp}: ${layer}`}
                  className={cn(freeSmallButton, "px-2")}
                  disabled={off || index === 0}
                  id={`${id}-${index}-subir`}
                  onClick={() => commitStep(moveFreeFillLayer(fill, index, -1), "up", index)}
                  type="button"
                  variant="ghost"
                >
                  <ArrowUp aria-hidden="true" className="size-4" />
                </Button>
                <Button
                  aria-label={`${C.fill.moveDown}: ${layer}`}
                  className={cn(freeSmallButton, "px-2")}
                  disabled={off || index === fill.length - 1}
                  id={`${id}-${index}-descer`}
                  onClick={() => commitStep(moveFreeFillLayer(fill, index, 1), "down", index)}
                  type="button"
                  variant="ghost"
                >
                  <ArrowDown aria-hidden="true" className="size-4" />
                </Button>
                <Button
                  aria-label={`${C.fill.remove}: ${layer}`}
                  className={cn(freeSmallButton, "px-2")}
                  disabled={off || fill.length <= min}
                  id={`${id}-${index}-tirar`}
                  onClick={() => commitStep(removeFreeFillLayer(fill, index, min), "remove", index)}
                  type="button"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              </div>
            </div>
            <PillField
              disabled={cardOff}
              label={C.fill.kind}
              name={`${id}-${index}-tipo`}
              onChange={(kind) => {
                const next = freeFillPaintOfKind(kind, paint, images[0]?.id ?? null);

                if (next) {
                  update(index, next);
                }
              }}
              options={images.length > 0 || paint.kind === "image" ? FREE_FILL_KIND_OPTIONS : FREE_FILL_KIND_OPTIONS.filter((option) => option.value !== "image")}
              value={paint.kind}
            />
            {paint.kind === "solid" ? (
              <ColorField disabled={disabled} id={`${id}-${index}-cor`} label={C.fill.color} onChange={(color) => update(index, { color, kind: "solid" })} value={paint.color} />
            ) : paint.kind === "image" ? (
              <div className="flex min-w-0 flex-col gap-3">
                <FreeImagePicker
                  design={design}
                  disabled={disabled || (busy && sending !== paint)}
                  id={`${id}-${index}-imagem`}
                  onBusyChange={busyFor(paint)}
                  onPick={(image) => onImageLayer((assetId, current) => withFreeFillLayerAsset(current, paint, assetId), image)}
                  selected={paint.asset}
                />
                <PillField
                  disabled={cardOff}
                  label={C.fill.fit}
                  name={`${id}-${index}-preenche`}
                  onChange={(fit) => update(index, fit === "cover" ? withoutKey(paint, "fit") : { ...paint, fit })}
                  options={FREE_FILL_IMAGE_FIT_OPTIONS}
                  value={paint.fit ?? "cover"}
                />
                <FocusFields disabled={cardOff} focus={paint.focus} id={`${id}-${index}-foco`} onChange={(focus) => update(index, focus ? { ...paint, focus } : withoutKey(paint, "focus"))} />
              </div>
            ) : (
              <GradientFields disabled={disabled} id={`${id}-${index}`} onChange={(next) => update(index, next as FreeFillPaint)} paint={paint} />
            )}
          </div>
        );
      })}
      <div className="flex min-w-0 flex-col gap-2">
        <PillField
          disabled={off || full}
          label={C.fill.add}
          name={`${id}-nova`}
          onChange={(kind) => {
            setAdding(kind);
            setPendingImage(false);
          }}
          options={FREE_FILL_KIND_OPTIONS}
          value={adding}
        />
        <div>
          <Button
            aria-label={C.fill.addLabel}
            className={freeSmallButton}
            disabled={off || full}
            id={`${id}-acrescentar`}
            onClick={() => {
              if (adding === "image") {
                setPendingImage(true);
                return;
              }

              const layer = newFreeFillLayer(adding, baseColor);

              if (layer) {
                commitStep(addFreeFillLayer(fill, layer), "add", 0);
              }
            }}
            type="button"
            variant="secondary"
          >
            <Plus aria-hidden="true" className="size-4" />
            {C.fill.add}
          </Button>
        </div>
        {pendingImage && !full ? (
          <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-dashed border-[var(--border-strong)] p-3">
            <FreeImagePicker
              design={design}
              disabled={disabled || (busy && sending !== "new")}
              id={`${id}-nova-imagem`}
              onBusyChange={busyFor("new")}
              onPick={(image) => {
                setPendingImage(false);
                setFocusAfter((current) => ({ action: "add", index: 0, seq: (current?.seq ?? 0) + 1 }));
                onImageLayer((assetId, current) => addFreeFillLayer(current, { asset: assetId, kind: "image" }), image);
              }}
              selected={null}
            />
          </div>
        ) : null}
      </div>
      <FreeFieldError message={error} />
      <div aria-live="polite" className="sr-only" data-free-fill-status="" role="status">
        {said.text ? <p key={said.id}>{said.text}</p> : null}
      </div>
    </fieldset>
  );
}

function withoutKey<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> & Partial<Pick<T, K>> {
  const { [key]: unused, ...rest } = value;

  void unused;

  return rest as Omit<T, K> & Partial<Pick<T, K>>;
}

/** Ponto de foco (X e Y em %). */
export function FocusFields({ disabled, focus, id, labels = { x: C.image.focusX, y: C.image.focusY }, onChange }: { disabled?: boolean; focus: [number, number] | undefined; id: string; labels?: { x: string; y: string }; onChange: (focus: [number, number] | undefined) => void }) {
  const [x, y] = focus ?? [50, 50];
  const commit = (next: [number, number]) => onChange(next[0] === 50 && next[1] === 50 ? undefined : next);

  return (
    <div className="grid min-w-0 grid-cols-2 gap-3">
      <FreeNumberField bounds={L.percent} disabled={disabled} id={`${id}-x`} label={labels.x} onChange={(next) => commit([next, y])} unit={C.units.percent} value={x} />
      <FreeNumberField bounds={L.percent} disabled={disabled} id={`${id}-y`} label={labels.y} onChange={(next) => commit([x, next])} unit={C.units.percent} value={y} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Imagens do design: escolher uma ou enviar
 * ---------------------------------------------------------------------------------------------- */

function Thumb({ asset, className }: { asset: FreeImageAsset; className?: string }) {
  const url = freeAssetUrl(asset, FREE_STORAGE_ORIGIN);

  return (
    <span className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-md border border-[var(--border-strong)] bg-[repeating-conic-gradient(#3f3f46_0%_25%,#18181b_0%_50%)] bg-[length:12px_12px]", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- miniatura de um arquivo do nosso Storage (qualquer proporcao)
        <img alt="" className="size-full object-contain" src={url} />
      ) : null}
    </span>
  );
}

/**
 * Enviar uma imagem (JPG, PNG ou WebP; o editor deixa leve sozinho) ou escolher uma que ja esta no design. O
 * botao de enviar tem o id do campo (o Revisar e o elemento recem-adicionado poem o foco nele).
 */
export function FreeImagePicker({
  design,
  disabled,
  hint,
  id,
  onBusyChange,
  onPick,
  selected,
  sendLabel = C.image.send
}: {
  design: PopupFreeDesign;
  disabled?: boolean;
  hint?: string;
  id: string;
  onBusyChange: (reason: string | null) => void;
  onPick: (image: { height: number; path: string; width: number } | FreeId) => void;
  selected: FreeId | null;
  sendLabel?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const images = freeImageAssets(design);
  const current = images.find((asset) => asset.id === selected) ?? null;
  const others = images.filter((asset) => asset.id !== selected);
  const groupId = useId();

  async function send(file: File | undefined) {
    if (!file) {
      return;
    }

    setProblem(null);
    setSending(true);
    onBusyChange(C.busy);

    try {
      const uploaded = await uploadFreeImageFile(file);

      onPick(uploaded);
    } catch (caught) {
      setProblem(caught instanceof Error && caught.message ? caught.message : C.imageFailed);
    } finally {
      setSending(false);
      onBusyChange(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {current ? (
        <div className="flex min-w-0 items-center gap-3">
          <Thumb asset={current} className="size-16" />
          <p className="min-w-0 text-[13px] leading-5 text-[var(--text-secondary)]">{C.image.thumb(current.width, current.height)}</p>
        </div>
      ) : (
        <FreeNote>{C.image.none}</FreeNote>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button className={cn(freeSmallButton, "h-10")} disabled={disabled || sending} id={id} onClick={() => input.current?.click()} type="button" variant="secondary">
          {sending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <ImageUp aria-hidden="true" className="size-4" />}
          {sending ? C.image.sending : current ? C.image.replace : sendLabel}
        </Button>
        <input
          accept="image/jpeg,image/png,image/webp"
          aria-label={sendLabel}
          className="sr-only"
          disabled={disabled || sending}
          onChange={(event) => {
            const file = event.target.files?.[0];

            event.target.value = "";
            void send(file);
          }}
          ref={input}
          tabIndex={-1}
          type="file"
        />
      </div>
      {sending ? (
        <p aria-live="polite" className="sr-only" role="status">
          {C.image.sending}
        </p>
      ) : null}
      {problem ? <FreeFieldError message={problem} /> : <FreeNote>{hint ?? C.image.hint}</FreeNote>}
      {others.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className={fieldLabelClass} id={`${groupId}-titulo`}>
            {C.image.reuse}
          </span>
          <div aria-labelledby={`${groupId}-titulo`} className="flex min-w-0 flex-wrap gap-2" role="group">
            {others.map((asset) => (
              <button
                aria-label={`${C.image.choose}: ${C.image.thumb(asset.width, asset.height)}`}
                className={cn("rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:opacity-60", adminTransition)}
                disabled={disabled || sending}
                key={asset.id}
                onClick={() => onPick(asset.id)}
                type="button"
              >
                <Thumb asset={asset} className="size-12 hover:border-[var(--text-secondary)]" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Icones
 * ---------------------------------------------------------------------------------------------- */

/** Grade com os 24 icones (e "Sem ícone" quando pode ficar sem). Radios por baixo: setas e leitor de tela. */
export function FreeIconGrid({
  allowNone = false,
  disabled,
  id,
  label,
  onChange,
  value
}: {
  allowNone?: boolean;
  disabled?: boolean;
  id: string;
  label: string;
  onChange: (icon: FreeIconName | null) => void;
  value: FreeIconName | null;
}) {
  const options: (FreeIconName | null)[] = allowNone ? [null, ...FREE_ICON_NAMES] : [...FREE_ICON_NAMES];

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className={fieldLabelClass} id={`${id}-titulo`}>
        {label}
      </span>
      <div aria-labelledby={`${id}-titulo`} className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1.5" id={id} role="radiogroup">
        {options.map((icon) => {
          const checked = icon === value;
          const name = icon ? FREE_ICON_LABELS[icon] : C.badge.noIcon;

          return (
            <label
              className={cn(
                "grid h-10 cursor-pointer place-items-center rounded-lg border text-[var(--text-secondary)] has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[var(--focus-ring)]",
                checked ? "border-[var(--text-primary)] bg-[var(--surface-3)] text-[var(--text-primary)]" : "border-[var(--border-strong)] hover:bg-[var(--hover-overlay)]",
                disabled && "cursor-not-allowed opacity-60",
                adminTransition
              )}
              key={icon ?? "sem"}
              title={name}
            >
              <input aria-label={name} checked={checked} className="sr-only" disabled={disabled} name={id} onChange={() => onChange(icon)} type="radio" value={icon ?? ""} />
              {icon ? <FreeIcon name={icon} style={{ height: 18, width: 18 }} /> : <X aria-hidden="true" className="size-4" />}
            </label>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Fonte (o seletor e o envio do Personalizado)
 * ---------------------------------------------------------------------------------------------- */

export function FreeFontField({
  disabled,
  fonts,
  id,
  onChange,
  onFontsChange,
  value,
  weight
}: {
  disabled?: boolean;
  fonts: readonly PopupFontOption[];
  id: string;
  onChange: (font: PopupFontRef, weight: PopupFontWeight) => void;
  onFontsChange: (fonts: PopupFontOption[]) => void;
  value: PopupFontRef;
  weight: PopupFontWeight;
}) {
  const [uploading, setUploading] = useState(false);
  const applyRef = useRef<((font: PopupFontOption) => void) | null>(null);

  return (
    <>
      <FontPicker
        disabled={disabled}
        id={id}
        library={fonts}
        onChange={onChange}
        onRequestUpload={(apply) => {
          applyRef.current = apply;
          setUploading(true);
        }}
        value={value}
        weight={weight}
      />
      <FontUploadDialog
        onOpenChange={setUploading}
        onUploaded={(font) => {
          onFontsChange([...fonts.filter((item) => item.id !== font.id), font]);
          applyRef.current?.(font);
          applyRef.current = null;
        }}
        open={uploading}
      />
    </>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Area de texto com "Outro estilo na seleção" e as fichas das partes
 * ---------------------------------------------------------------------------------------------- */

/** O popover aberto: os trechos (por linha) que recebem o estilo; fica ao lado da area de texto. */
type SpanEditing = { targets: FreeTextRange[] };

/**
 * O popover de estilo de uma parte: Cor do texto, Peso, Itálico, Tamanho, Fonte, Maiúsculas, Linha, Espaço, Contorno
 * e Marca-texto (L6b). Cada mudança é um `onApply` com a chave das partes: as seguidas em menos de 700 ms juntam num
 * passo só (os números e também as chaves Contorno e Marca-texto; FREE_HISTORY_COALESCE_MS).
 */
function SpanStylePanel({
  base,
  disabled,
  fonts,
  id,
  lines,
  onApply,
  onClose,
  onFontsChange,
  targets
}: {
  base: FreeResolvedTextStyle;
  disabled?: boolean;
  fonts: readonly PopupFontOption[];
  id: string;
  lines: readonly FreeLine[];
  onApply: (patch: FreeSpanStylePatch | null) => void;
  onClose: () => void;
  onFontsChange: (fonts: PopupFontOption[]) => void;
  targets: readonly FreeTextRange[];
}) {
  const style = freeRangeStyle(lines, targets[0], base);
  const own = freeRangeHasOwnStyle(lines, targets, base);
  const stroke = style.stroke;
  // A parte em degradê (dela ou do elemento) não liga o contorno: ele cobriria a cor (o schema recusa).
  const strokeReason = freeStrokeDisabledReason(style);
  const mark = style.mark;
  const markPadding = mark ? freeMarkPadding(mark) : null;

  return (
    <div className="flex w-[300px] max-w-[calc(100vw-32px)] flex-col gap-4 p-4">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Popover.Title className="m-0 text-sm leading-5 font-semibold text-[var(--text-primary)]">{C.span.title}</Popover.Title>
        <Button aria-label={C.span.close} className={cn(freeSmallButton, "px-2")} onClick={onClose} type="button" variant="ghost">
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <FreeTextPaintField disabled={disabled} id={`${id}-cor`} label={C.span.paint} onChange={(paint) => onApply({ paint })} spanOnly value={style.paint} />
      <WeightPicker disabled={disabled} font={style.font} id={`${id}-peso`} label={C.span.weight} onChange={(weight) => onApply({ weight })} value={style.weight} />
      <AdminSwitch checked={style.italic === true} disabled={disabled} id={`${id}-italico`} label={C.span.italic} onCheckedChange={(italic) => onApply({ italic })} />
      <FreeNumberField bounds={L.fontSize} disabled={disabled} id={`${id}-tamanho`} label={C.span.size} onChange={(size) => onApply({ size })} unit={C.units.px} value={style.size} />
      <FreeFontField disabled={disabled} fonts={fonts} id={`${id}-fonte`} onChange={(font, weight) => onApply({ font, weight })} onFontsChange={onFontsChange} value={style.font} weight={style.weight} />
      <AdminSwitch checked={style.uppercase === true} disabled={disabled} id={`${id}-maiusculas`} label={C.span.uppercase} onCheckedChange={(uppercase) => onApply({ uppercase })} />
      <PillField
        disabled={disabled}
        label={C.span.decoration}
        name={`${id}-linha`}
        onChange={(decoration) => onApply({ decoration: decoration === "none" ? undefined : decoration })}
        options={FREE_DECORATION_OPTIONS}
        value={style.decoration ?? "none"}
      />
      <FreeNumberField
        bounds={L.letterSpacing}
        disabled={disabled}
        id={`${id}-espaco`}
        integer={false}
        label={C.span.letterSpacing}
        onChange={(letterSpacing) => onApply({ letterSpacing })}
        step={0.01}
        unit="em"
        value={style.letterSpacing}
      />
      <div className="flex min-w-0 flex-col gap-3">
        {/* A parte poe ou troca o contorno do elemento, mas nao tira: com contorno no elemento, a chave fica ligada. */}
        <AdminSwitch
          checked={stroke !== undefined}
          description={base.stroke ? C.span.strokeFromElement : (strokeReason ?? undefined)}
          disabled={disabled || base.stroke !== undefined || strokeReason !== null}
          id={`${id}-contorno`}
          label={C.span.stroke}
          onCheckedChange={(on) => onApply(freeStrokeSwitchPatch(style, on))}
        />
        {stroke ? (
          <div className="flex min-w-0 flex-col gap-3 border-l-2 border-[var(--border-subtle)] pl-4">
            <FreeNumberField bounds={L.textStroke} disabled={disabled} id={`${id}-contorno-espessura`} label={C.span.strokeWidth} onChange={(width) => onApply({ stroke: { ...stroke, width } })} unit={C.units.px} value={stroke.width} />
            <ColorField disabled={disabled} id={`${id}-contorno-cor`} label={C.span.strokeColor} onChange={(color) => onApply({ stroke: { ...stroke, color } })} value={stroke.color} />
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <AdminSwitch
          checked={mark !== undefined}
          disabled={disabled}
          id={`${id}-marca-texto`}
          label={C.span.mark}
          onCheckedChange={(on) => onApply({ mark: on ? { color: FREE_MARK_DEFAULT_COLOR } : undefined })}
        />
        {mark && markPadding ? (
          <div className="flex min-w-0 flex-col gap-3 border-l-2 border-[var(--border-subtle)] pl-4">
            <ColorField disabled={disabled} id={`${id}-marca-texto-cor`} label={C.span.markColor} onChange={(color) => onApply({ mark: { ...mark, color } })} value={mark.color} />
            <FreeNumberField
              bounds={L.markPadding}
              disabled={disabled}
              id={`${id}-marca-texto-respiro-y`}
              label={C.span.markPaddingY}
              onChange={(value) => onApply({ mark: withFreeMarkPadding(mark, 0, value) })}
              unit={C.units.px}
              value={markPadding[0]}
            />
            <FreeNumberField
              bounds={L.markPadding}
              disabled={disabled}
              id={`${id}-marca-texto-respiro-x`}
              label={C.span.markPaddingX}
              onChange={(value) => onApply({ mark: withFreeMarkPadding(mark, 1, value) })}
              unit={C.units.px}
              value={markPadding[1]}
            />
            <FreeNumberField
              bounds={L.markRadius}
              disabled={disabled}
              id={`${id}-marca-texto-cantos`}
              label={C.span.markRadius}
              onChange={(radius) => onApply({ mark: withFreeMarkRadius(mark, radius) })}
              unit={C.units.px}
              value={freeMarkRadius(mark)}
            />
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button className={freeSmallButton} disabled={disabled || !own} onClick={() => onApply(null)} type="button" variant="secondary">
          {C.span.reset}
        </Button>
        <Button className={freeSmallButton} onClick={onClose} type="button" variant="ghost">
          {C.span.close}
        </Button>
      </div>
    </div>
  );
}

/**
 * A area de texto do Título e do Texto (spec §4.6): uma `<textarea>` com o texto (cada linha da area e uma linha
 * do elemento), "Outro estilo na seleção" (divide a parte em antes / selecao / depois e abre o estilo da parte do
 * meio) e "Partes com estilo próprio" (uma ficha por parte, que abre o mesmo estilo). Editar mantem os estilos
 * (applyFreeTextEdit).
 */
export function FreeTextArea({
  base,
  disabled,
  error,
  fonts,
  id,
  letters,
  lines,
  onChange,
  onFontsChange,
  type
}: {
  base: FreeResolvedTextStyle;
  disabled?: boolean;
  error?: string | null;
  fonts: readonly PopupFontOption[];
  id: string;
  letters: number;
  lines: readonly FreeLine[];
  onChange: (lines: FreeLine[], kind: "spans" | "text") => void;
  onFontsChange: (fonts: PopupFontOption[]) => void;
  type: "heading" | "text";
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState<SpanEditing | null>(null);
  const text = freeLinesText(lines);
  const parts = freeStyledParts(lines, base, fonts);
  const message = problem ?? error ?? null;
  const over = letters > L.textTotal;
  const describedBy = [message ? `${id}-error` : `${id}-hint`, `${id}-letras`].join(" ");

  function openSelection() {
    const element = textarea.current;

    if (!element) {
      return;
    }

    const split = splitFreeSpanAtSelection(lines, { end: element.selectionEnd, start: element.selectionStart });

    if (!split) {
      setProblem(C.text.selectFirst);
      element.focus();
      return;
    }

    setProblem(null);
    setEditing({ targets: split.targets });
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label className={fieldLabelClass} htmlFor={id}>
        {C.text.label}
      </label>
      <textarea
        aria-describedby={describedBy}
        aria-invalid={message ? true : undefined}
        className={cn(adminTextareaClass, "min-h-24")}
        disabled={disabled}
        id={id}
        onChange={(event) => {
          const result = freeTextAreaChange(type, lines, event.target.value, { base, caret: event.target.selectionEnd });

          setProblem(result.problem);
          setEditing(null);

          if (!result.problem && result.lines !== lines) {
            onChange(result.lines, "text");
          }
        }}
        ref={textarea}
        rows={type === "heading" ? 3 : 4}
        spellCheck
        value={text}
      />
      <div className="flex min-w-0 items-start justify-between gap-3">
        {message ? (
          <FreeFieldError id={`${id}-error`} message={message} />
        ) : (
          <FreeNote id={`${id}-hint`}>{C.text.hint}</FreeNote>
        )}
        <span className={cn("shrink-0 text-xs leading-5 tabular-nums", over ? "text-[var(--error)]" : "text-[var(--text-tertiary)]")} id={`${id}-letras`}>
          {C.text.letters(letters)}
        </span>
      </div>
      <div>
        <Button className={freeSmallButton} disabled={disabled} id={`${id}-selecao`} onClick={openSelection} type="button" variant="secondary">
          {C.text.styleSelection}
        </Button>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className={fieldLabelClass} id={`${id}-partes`}>
          {C.text.parts}
        </span>
        {parts.length === 0 ? (
          <FreeNote>{C.text.partsEmpty}</FreeNote>
        ) : (
          <ul aria-labelledby={`${id}-partes`} className="m-0 flex min-w-0 list-none flex-wrap gap-2 p-0">
            {parts.map((part) => (
              <li className="min-w-0" key={`${part.range.line}-${part.range.start}`}>
                <button
                  className={cn(
                    "inline-flex max-w-full min-h-[34px] items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-3 text-left text-[13px] font-medium text-[var(--text-primary)] outline-none hover:bg-[var(--hover-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:opacity-60 pointer-coarse:min-h-11",
                    adminTransition
                  )}
                  disabled={disabled}
                  onClick={() => setEditing({ targets: [part.range] })}
                  type="button"
                >
                  <span className="truncate">{part.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Popover.Root
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
          }
        }}
        open={editing !== null}
      >
        <Popover.Portal>
          <Popover.Positioner align="start" anchor={textarea} className="z-[80] outline-none" collisionPadding={8} side="left" sideOffset={12}>
            <Popover.Popup
              className={cn(
                "max-h-[var(--available-height)] overflow-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)] shadow-[0_24px_64px_rgba(0,0,0,0.6)] outline-none",
                "transition-[opacity,transform] duration-150 ease-[var(--ease-admin)] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0 motion-reduce:transition-none"
              )}
              finalFocus={textarea}
            >
              {editing ? (
                <SpanStylePanel
                  base={base}
                  disabled={disabled}
                  fonts={fonts}
                  id={`${id}-parte`}
                  lines={lines}
                  onApply={(patch) => onChange(applyFreeSpanStyle(lines, editing.targets, patch, base), "spans")}
                  onClose={() => setEditing(null)}
                  onFontsChange={onFontsChange}
                  targets={editing.targets}
                />
              ) : null}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

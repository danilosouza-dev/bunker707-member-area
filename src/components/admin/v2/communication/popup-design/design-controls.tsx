"use client";

import { AlertCircle, AlertTriangle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { HEX_COLOR_PATTERN, POPUP_DESIGN_LIMITS, alphaPercentOf, withAlphaPercent, type HexColor, type PopupBorder, type PopupPaint } from "@/server/communications/popup-design-model";
import { PillGroup, adminInputClass, type PillOption } from "../../form";
import { AdminSwitch } from "../../settings/kit";
import { adminTransition } from "../../styles";
import { OPACITY_BOUNDS, PAINT_KIND_OPTIONS, POPUP_DESIGN_COPY, clampNumber, opacityAfterBlur, paintOfKind, parseBoundedNumber, rangeMessage, type PaintKind } from "./popup-design-editor-model";

// Pecas pequenas do card "Design" (docs/26): secao com titulo, numero com limite, cor (#RRGGBB ou #RRGGBBAA com o
// seletor do navegador e a opacidade em %), pintura (cor ou degrade), borda, cantos com "Pílula", lista e a dica de contraste. Mesmo
// visual dos campos do admin (form.tsx, kit.tsx): label acima, 40 px, erro embaixo com icone, pilulas.

export const fieldLabelClass = "text-[13px] leading-5 font-medium text-[var(--text-primary)]";

function InlineError({ id, message }: { id: string; message?: string | null }) {
  return message ? (
    <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" id={id}>
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  ) : null;
}

/** Erro de um campo do design (vem do errorFor do editor). */
export function DesignFieldError({ id, message }: { id?: string; message?: string | null }) {
  return <InlineError id={id ?? ""} message={message} />;
}

type DesignSectionProps = {
  children: ReactNode;
  description?: string;
  /** id da secao (recebe o foco quando o erro e dela). */
  id?: string;
  title: string;
};

/** Secao dentro do card "Design": linha em cima e titulo (nunca card dentro de card). */
export function DesignSection({ children, description, id, title }: DesignSectionProps) {
  return (
    <section
      aria-label={title}
      className="flex min-w-0 scroll-mt-24 flex-col gap-4 border-t border-[var(--border-subtle)] pt-5 outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--focus-ring)]"
      id={id}
      tabIndex={id ? -1 : undefined}
    >
      <div className="min-w-0">
        <h3 className="text-sm leading-5 font-semibold text-[var(--text-primary)]">{title}</h3>
        {description ? <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Rotulo + pilulas (escolha unica com ate 6 opcoes). */
export function PillField<Value extends string>({
  disabled,
  error,
  hint,
  label,
  name,
  onChange,
  options,
  value
}: {
  disabled?: boolean;
  error?: string | null;
  hint?: string;
  label: string;
  name: string;
  onChange: (value: Value) => void;
  options: readonly PillOption<Value>[];
  value: Value;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className={fieldLabelClass}>{label}</span>
      <PillGroup ariaLabel={label} disabled={disabled} name={name} onChange={onChange} options={options} value={value} />
      {hint && !error ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{hint}</p> : null}
      <InlineError id={`${name}-error`} message={error} />
    </div>
  );
}

type NumberFieldProps = {
  disabled?: boolean;
  error?: string | null;
  hint?: string;
  id: string;
  integer?: boolean;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  /**
   * Barra de arrastar ao lado do numero (mesmo valor). So para o mouse e o toque: o teclado e o leitor de tela
   * usam o numero (setas sobem e descem), sem dois campos com o mesmo nome.
   */
  slider?: boolean;
  /** Escala da barra quando difere do limite (os dois campos do degradê usam 0 a 100 %, como o desenho ao lado). */
  sliderScale?: { max: number; min: number };
  step?: number;
  suffix?: string;
  value: number;
};

function numberText(value: number) {
  return Number.isFinite(value) ? String(value) : "";
}

/**
 * Numero com limite: so o valor dentro do limite vai para o design (digitar "1" a caminho de "16" nao estraga
 * nada); fora dele, a frase do limite embaixo; ao sair do campo, volta ao valor valido mais perto.
 */
export function NumberField({ disabled, error, hint, id, integer = true, label, max, min, onChange, slider = false, sliderScale, step = 1, suffix, value }: NumberFieldProps) {
  const [text, setText] = useState(() => numberText(value));
  const [synced, setSynced] = useState(value);
  const invalid = parseBoundedNumber(text, { integer, max, min }) === null;
  const message = error ?? (invalid ? rangeMessage(min, max) : null);

  if (!Object.is(value, synced)) {
    setSynced(value);
    setText(numberText(value));
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className={fieldLabelClass} htmlFor={id}>
        {label}
      </label>
      <div className="flex min-w-0 items-center gap-2">
        <input
          aria-describedby={[message ? `${id}-error` : hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined}
          aria-invalid={message ? true : undefined}
          className={cn(adminInputClass, "w-24 tabular-nums")}
          disabled={disabled}
          id={id}
          inputMode={integer && min >= 0 ? "numeric" : "decimal"}
          max={max}
          min={min}
          onBlur={() => {
            const parsed = Number(text.trim().replace(",", "."));
            const next = Number.isFinite(parsed) && text.trim() !== "" ? clampNumber(integer ? Math.round(parsed) : parsed, min, max) : value;

            setText(numberText(next));
            setSynced(next);

            if (next !== value) {
              onChange(next);
            }
          }}
          onChange={(event) => {
            const next = parseBoundedNumber(event.target.value, { integer, max, min });
            setText(event.target.value);

            if (next !== null) {
              setSynced(next);
              onChange(next);
            }
          }}
          step={step}
          type="number"
          value={text}
        />
        {suffix ? <span className="text-sm leading-5 text-[var(--text-secondary)]">{suffix}</span> : null}
        {slider ? (
          <input
            aria-hidden="true"
            className="h-10 min-w-0 flex-1 cursor-pointer accent-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            data-slider-for={id}
            disabled={disabled}
            max={sliderScale?.max ?? max}
            min={sliderScale?.min ?? min}
            onChange={(event) => {
              const next = clampNumber(Number(event.target.value), min, max);
              setText(numberText(next));
              setSynced(next);

              if (next !== value) {
                onChange(next);
              }
            }}
            step={step}
            tabIndex={-1}
            type="range"
            value={clampNumber(value, min, max)}
          />
        ) : null}
      </div>
      {hint && !message ? (
        <p className="text-xs leading-5 text-[var(--text-secondary)]" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      <InlineError id={`${id}-error`} message={message} />
    </div>
  );
}

type ColorFieldProps = {
  disabled?: boolean;
  error?: string | null;
  id: string;
  label: string;
  /** Rotulo so para leitor de tela (a pilula "Cor" logo acima ja diz o que e). */
  labelHidden?: boolean;
  onChange: (value: HexColor) => void;
  value: HexColor;
};

/**
 * Cor: o texto (#RRGGBB ou #RRGGBBAA, o fim e a transparencia), o seletor do navegador ao lado (so #RRGGBB: a
 * transparencia que ja estava no texto continua) e a opacidade em % (0 a 100; 100 grava os 6 digitos, nunca "ff").
 * So cor valida vai para o design; a opacidade so dentro do limite (fora dele, ao sair do campo, encosta no limite).
 */
export function ColorField({ disabled, error, id, label, labelHidden = false, onChange, value }: ColorFieldProps) {
  const [text, setText] = useState(value);
  const [opacityText, setOpacityText] = useState(() => String(alphaPercentOf(value)));
  const [synced, setSynced] = useState(value);
  const invalid = !HEX_COLOR_PATTERN.test(text.trim());
  const message = error ?? (invalid ? POPUP_DESIGN_COPY.color.invalid : null);
  const alpha = value.length === 9 ? value.slice(7) : "";

  if (value !== synced) {
    setSynced(value);
    setText(value);
    setOpacityText(String(alphaPercentOf(value)));
  }

  /** A cor digitada ou escolhida; `typedOpacity` e o que esta escrito no numero quando a mudanca veio dele. */
  function commit(next: string, typedOpacity?: string) {
    const clean = next.trim().toLowerCase();
    setText(next);

    if (HEX_COLOR_PATTERN.test(clean)) {
      setSynced(clean);
      setOpacityText(typedOpacity ?? String(alphaPercentOf(clean)));
      onChange(clean);
    }
  }

  function commitOpacity(percent: number, typed: string) {
    commit(withAlphaPercent(value, percent), typed);
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className={labelHidden ? "sr-only" : fieldLabelClass} htmlFor={id}>
        {label}
      </label>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[repeating-conic-gradient(#3f3f46_0%_25%,#18181b_0%_50%)] bg-[length:12px_12px]">
          <span aria-hidden="true" className="absolute inset-0" style={{ backgroundColor: HEX_COLOR_PATTERN.test(value) ? value : undefined }} />
          <input
            aria-label={`${label}: ${POPUP_DESIGN_COPY.color.picker}`}
            className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            disabled={disabled}
            onChange={(event) => commit(`${event.target.value}${alpha}`)}
            type="color"
            value={HEX_COLOR_PATTERN.test(value) ? value.slice(0, 7) : "#000000"}
          />
        </span>
        <input
          aria-describedby={message ? `${id}-error` : undefined}
          aria-invalid={message ? true : undefined}
          autoComplete="off"
          className={cn(adminInputClass, "w-28 font-mono uppercase tabular-nums")}
          disabled={disabled}
          id={id}
          maxLength={9}
          onBlur={() => {
            if (invalid) {
              setText(value);
            }
          }}
          onChange={(event) => commit(event.target.value)}
          placeholder={POPUP_DESIGN_COPY.color.placeholder}
          spellCheck={false}
          value={text}
        />
        <span className="flex shrink-0 items-center gap-1">
          <input
            aria-describedby={message ? `${id}-error` : undefined}
            aria-invalid={message ? true : undefined}
            aria-label={`${label}: ${POPUP_DESIGN_COPY.color.opacity}`}
            className={cn(adminInputClass, "w-[4.5rem] tabular-nums")}
            disabled={disabled}
            id={`${id}-opacidade`}
            inputMode="numeric"
            max={OPACITY_BOUNDS.max}
            min={OPACITY_BOUNDS.min}
            onBlur={() => {
              // So uma cor diferente vai para o design (no Livre, cada mudanca e um passo do historico).
              const next = opacityAfterBlur(opacityText, value);

              if (next.changed) {
                commit(next.hex, next.text);
              } else {
                setOpacityText(next.text);
              }
            }}
            onChange={(event) => {
              const next = parseBoundedNumber(event.target.value, OPACITY_BOUNDS);
              setOpacityText(event.target.value);

              if (next !== null) {
                commitOpacity(next, event.target.value);
              }
            }}
            step={1}
            type="number"
            value={opacityText}
          />
          <span aria-hidden="true" className="text-sm leading-5 text-[var(--text-secondary)]">
            %
          </span>
        </span>
      </div>
      <InlineError id={`${id}-error`} message={message} />
    </div>
  );
}

type PaintFieldProps = {
  disabled?: boolean;
  error?: string | null;
  id: string;
  label: string;
  onChange: (paint: PopupPaint) => void;
  value: PopupPaint;
};

/** As cores de uma pintura: a cor (rotulo so para leitor de tela) ou De, Para e o Ângulo. */
export function PaintColorFields({ disabled, id, label, onChange, value }: { disabled?: boolean; id: string; label: string; onChange: (paint: PopupPaint) => void; value: PopupPaint }) {
  return value.kind === "solid" ? (
    <ColorField disabled={disabled} id={`${id}-cor`} label={label} labelHidden onChange={(color) => onChange({ color, kind: "solid" })} value={value.color} />
  ) : (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <ColorField disabled={disabled} id={`${id}-de`} label={POPUP_DESIGN_COPY.color.from} onChange={(from) => onChange({ ...value, from })} value={value.from} />
      <ColorField disabled={disabled} id={`${id}-para`} label={POPUP_DESIGN_COPY.color.to} onChange={(to) => onChange({ ...value, to })} value={value.to} />
      <NumberField
        disabled={disabled}
        id={`${id}-angulo`}
        label={POPUP_DESIGN_COPY.color.angle}
        max={POPUP_DESIGN_LIMITS.angle.max}
        min={POPUP_DESIGN_LIMITS.angle.min}
        onChange={(angle) => onChange({ ...value, angle })}
        suffix="°"
        value={value.angle}
      />
    </div>
  );
}

/** Pintura: "Cor" | "Degradê" (De, Para e o Ângulo de 0 a 360°). */
export function PaintField({ disabled, error, id, label, onChange, value }: PaintFieldProps) {
  function changeKind(kind: PaintKind) {
    if (kind === value.kind) {
      return;
    }

    onChange(paintOfKind(kind, value.kind === "solid" ? value.color : value.from));
  }

  return (
    <div className="flex min-w-0 flex-col gap-3" id={id}>
      <PillField disabled={disabled} label={label} name={`${id}-tipo`} onChange={changeKind} options={PAINT_KIND_OPTIONS} value={value.kind} />
      <PaintColorFields disabled={disabled} id={id} label={label} onChange={onChange} value={value} />
      <InlineError id={`${id}-error`} message={error} />
    </div>
  );
}

/** Borda: cor e espessura (0 a 4 px). */
export function BorderField({ disabled, id, label, onChange, value }: { disabled?: boolean; id: string; label: string; onChange: (border: PopupBorder) => void; value: PopupBorder }) {
  return (
    <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-2">
      <legend className={cn(fieldLabelClass, "mb-1.5 p-0")}>{label}</legend>
      <ColorField disabled={disabled} id={`${id}-cor`} label={POPUP_DESIGN_COPY.cardSection.borderColor} onChange={(color) => onChange({ ...value, color })} value={value.color} />
      <NumberField
        disabled={disabled}
        id={`${id}-espessura`}
        label={POPUP_DESIGN_COPY.cardSection.borderWidth}
        max={POPUP_DESIGN_LIMITS.borderWidth.max}
        min={POPUP_DESIGN_LIMITS.borderWidth.min}
        onChange={(width) => onChange({ ...value, width })}
        suffix="px"
        value={value.width}
      />
    </fieldset>
  );
}

const PILL_RADIUS = 999;
const RADIUS_MAX = 40;

/** Cantos (0 a 40 px) e "Pílula" (cantos inteiros). */
export function RadiusField({ disabled, id, label, onChange, pillLabel, value }: { disabled?: boolean; id: string; label: string; onChange: (radius: number) => void; pillLabel: string; value: number }) {
  const pill = value >= PILL_RADIUS;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <AdminSwitch checked={pill} disabled={disabled} id={`${id}-pilula`} label={pillLabel} onCheckedChange={(checked) => onChange(checked ? PILL_RADIUS : 12)} />
      {pill ? null : (
        <NumberField disabled={disabled} id={id} label={label} max={RADIUS_MAX} min={0} onChange={onChange} suffix="px" value={clampNumber(value, 0, RADIUS_MAX)} />
      )}
    </div>
  );
}

export type DesignSelectGroup = { items: readonly { label: string; value: string }[]; label?: string };

/** Lista (mais de 6 opcoes: fonte, peso). O ultimo grupo pode ser uma acao ("Enviar fonte…"). */
export function DesignSelect({
  disabled,
  groups,
  id,
  label,
  onChange,
  value
}: {
  disabled?: boolean;
  groups: readonly DesignSelectGroup[];
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const items = groups.flatMap((group) => group.items);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className={fieldLabelClass} htmlFor={id}>
        {label}
      </label>
      <Select disabled={disabled} items={items} onValueChange={(next) => (typeof next === "string" ? onChange(next) : undefined)} value={value}>
        <SelectTrigger
          className={cn(
            "w-full rounded-lg border-[var(--border-strong)] bg-[var(--surface-2)] pr-2.5 pl-3 text-sm text-[var(--text-primary)] hover:border-[var(--border-stronger)] data-[size=default]:h-10",
            adminTransition
          )}
          id={id}
        >
          <SelectValue className="min-w-0 truncate" />
        </SelectTrigger>
        <SelectContent className="max-h-72 border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)] ring-0">
          {groups.map((group, index) => (
            <SelectGroup key={group.label ?? `grupo-${index}`}>
              {index > 0 ? <SelectSeparator /> : null}
              {group.label ? <SelectLabel>{group.label}</SelectLabel> : null}
              {group.items.map((item) => (
                <SelectItem className="min-h-9 pointer-coarse:min-h-11" key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Dica de contraste (nao impede salvar). */
export function ContrastHint({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-2 text-[13px] leading-5 text-[var(--warning)]">
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{message}</span>
    </p>
  );
}

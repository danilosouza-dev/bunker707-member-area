"use client";

import { AlertCircle, Check } from "lucide-react";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { adminInputClass, adminTextareaClass } from "../../form";
import { adminTransition } from "../../styles";

// Pecas pequenas do editor do destaque: a chave "Mostrar" ao lado de cada texto, o campo de texto
// com contador e o seletor da cor da luz de fundo. Mesmo visual dos campos do admin (AdminField).

type ShowSwitchProps = {
  checked: boolean;
  disabled?: boolean;
  /** Nome lido pelo leitor de tela, ex.: "Mostrar o selo". Na tela aparece so "Mostrar". */
  label: string;
  onCheckedChange: (checked: boolean) => void;
};

/** Chave compacta "Mostrar" (alvo de 44 px de altura). */
export function ShowSwitch({ checked, disabled = false, label, onCheckedChange }: ShowSwitchProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-1 text-[13px] leading-5 font-medium text-[var(--text-secondary)]",
        "hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60",
        adminTransition
      )}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-5 w-8 shrink-0 items-center rounded-full border",
          adminTransition,
          checked ? "border-transparent bg-[var(--text-primary)]" : "border-[var(--border-strong)] bg-[var(--surface-2)]"
        )}
      >
        <span
          className={cn(
            "block size-3.5 rounded-full transition-transform duration-150 ease-[var(--ease-admin)] motion-reduce:transition-none",
            checked ? "translate-x-[15px] bg-[var(--surface-0)]" : "translate-x-[2px] bg-[var(--text-secondary)]"
          )}
        />
      </span>
      <span aria-hidden="true">Mostrar</span>
    </button>
  );
}

type HeroTextFieldProps = {
  disabled?: boolean;
  error?: string;
  hint?: string;
  id: string;
  label: string;
  max: number;
  multiline?: boolean;
  onBlur: () => void;
  onChange: (value: string) => void;
  onShownChange?: (shown: boolean) => void;
  placeholder?: string;
  shown?: boolean;
  /** Completa o nome da chave para leitor de tela: "Mostrar {showLabel}". */
  showLabel?: string;
  value: string;
};

/** Campo de texto com contador ("12 de 40") e, opcionalmente, a chave "Mostrar" ao lado do rotulo. */
export function HeroTextField({
  disabled = false,
  error,
  hint,
  id,
  label,
  max,
  multiline = false,
  onBlur,
  onChange,
  onShownChange,
  placeholder,
  shown,
  showLabel,
  value
}: HeroTextFieldProps) {
  const length = value.trim().length;
  const over = length > max;
  // Texto escrito com "Mostrar" desligado: fica guardado, mas o aluno nao ve. Avisa junto do campo.
  const hiddenNote = onShownChange && shown === false && length > 0 ? "Escondido na home: ligue “Mostrar” para o aluno ver." : null;
  const note = hiddenNote ?? hint;
  const describedBy = [error ? `${id}-error` : note ? `${id}-hint` : null, `${id}-count`].filter(Boolean).join(" ");
  const shared = {
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
    disabled,
    id,
    onBlur,
    placeholder,
    value
  } as const;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <label className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor={id}>
          {label}
        </label>
        {onShownChange && shown !== undefined ? (
          <ShowSwitch checked={shown} disabled={disabled} label={`Mostrar ${showLabel ?? label.toLowerCase()}`} onCheckedChange={onShownChange} />
        ) : null}
      </div>
      {multiline ? (
        <textarea
          {...shared}
          className={cn(adminTextareaClass, "min-h-20")}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
        />
      ) : (
        <Input {...shared} autoComplete="off" className={adminInputClass} onChange={(event) => onChange(event.target.value)} />
      )}
      <div className="flex min-w-0 items-start justify-between gap-3">
        {error ? (
          <p className="flex min-w-0 items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" id={`${id}-error`}>
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : note ? (
          <p className={cn("min-w-0 text-xs leading-5", hiddenNote ? "text-[var(--warning)]" : "text-[var(--text-secondary)]")} id={`${id}-hint`}>
            {note}
          </p>
        ) : (
          <span />
        )}
        <span
          className={cn("shrink-0 text-xs leading-5 tabular-nums", over ? "text-[var(--error)]" : "text-[var(--text-tertiary)]")}
          id={`${id}-count`}
        >
          <span className="sr-only">Caracteres usados: </span>
          {length} de {max}
        </span>
      </div>
    </div>
  );
}

/** Cores prontas da luz de fundo (a primeira e o vermelho da marca). */
export const GLOW_COLOR_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "Vermelho", value: "#e50914" },
  { label: "Laranja", value: "#f97316" },
  { label: "Âmbar", value: "#f59e0b" },
  { label: "Verde", value: "#22c55e" },
  { label: "Azul", value: "#3b82f6" },
  { label: "Roxo", value: "#a855f7" },
  { label: "Rosa", value: "#ec4899" },
  { label: "Cinza", value: "#9ca3af" }
];

type GlowColorPickerProps = {
  color: string;
  disabled?: boolean;
  onChange: (color: string) => void;
};

/** Cor da luz de fundo: cores prontas em bolinhas e o seletor de cor do navegador (qualquer cor). */
export function GlowColorPicker({ color, disabled = false, onChange }: GlowColorPickerProps) {
  const inputId = useId();
  const current = color.toLowerCase();

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div aria-label="Cores prontas" className="flex flex-wrap gap-2" role="group">
        {GLOW_COLOR_PRESETS.map((preset) => {
          const selected = preset.value === current;

          return (
            <button
              aria-label={preset.label}
              aria-pressed={selected}
              className={cn(
                "grid size-9 place-items-center rounded-full border-2 text-white outline-none hover:scale-105 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60",
                adminTransition,
                selected ? "border-white" : "border-transparent"
              )}
              disabled={disabled}
              key={preset.value}
              onClick={() => onChange(preset.value)}
              style={{ backgroundColor: preset.value }}
              title={preset.label}
              type="button"
            >
              {selected ? <Check aria-hidden="true" className="size-4 drop-shadow" strokeWidth={3} /> : null}
            </button>
          );
        })}
      </div>
      <label className="flex min-w-0 items-center gap-3 text-[13px] leading-5 text-[var(--text-secondary)]" htmlFor={inputId}>
        <input
          className="h-9 w-12 shrink-0 cursor-pointer rounded-[6px] border border-white/10 bg-transparent p-0.5 disabled:cursor-not-allowed"
          disabled={disabled}
          id={inputId}
          onChange={(event) => onChange(event.target.value)}
          type="color"
          value={current}
        />
        <span>
          Ou escolha qualquer cor: <span className="font-mono text-[var(--text-primary)]">{current}</span>
        </span>
      </label>
    </div>
  );
}

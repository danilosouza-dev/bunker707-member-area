"use client";

import { AlertCircle, Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { adminTransition } from "./styles";

// Campos do Admin Bunker707 (docs/17 §2.7, "Formularios"): coluna unica, label acima, "(opcional)"
// marcado, erro abaixo do campo com icone, campos de 40 px. Um estilo so de campo em todo o admin:
// use adminInputClass/adminTextareaClass no Input/textarea e AdminField em volta; selects com ate
// 6 opcoes viram PillGroup (pilulas redondas de 34 px do prototipo, adminPillClasses).

/** Input de 40 px sobre a superficie 2. Use em `<Input className={adminInputClass} />` ou <input>. */
export const adminInputClass = cn(
  "h-10 w-full min-w-0 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 text-sm text-[var(--text-primary)]",
  "placeholder:text-[var(--text-tertiary)] focus-visible:border-[var(--text-secondary)] focus-visible:ring-0",
  "aria-invalid:border-[var(--error)] aria-invalid:ring-0 disabled:opacity-60",
  adminTransition
);

export const adminTextareaClass = cn(
  "min-h-24 w-full min-w-0 resize-y rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2.5 text-sm leading-6 text-[var(--text-primary)]",
  "placeholder:text-[var(--text-tertiary)] outline-none focus-visible:border-[var(--text-secondary)]",
  "aria-invalid:border-[var(--error)] disabled:opacity-60",
  adminTransition
);

/** ids de ajuda e erro de um campo, para aria-describedby. */
export function fieldDescribedBy(id: string, parts: { error?: string | null; hint?: ReactNode }) {
  const ids = [parts.hint ? `${id}-hint` : null, parts.error ? `${id}-error` : null].filter(Boolean);

  return ids.length > 0 ? ids.join(" ") : undefined;
}

type AdminFieldProps = {
  children: ReactNode;
  className?: string;
  /** Mensagem de erro do campo (validacao ao sair do campo ou fieldErrors da Server Action). */
  error?: string | null;
  hint?: ReactNode;
  /** id do controle; o label aponta para ele e hint/erro recebem `${id}-hint`/`${id}-error`. */
  id: string;
  label: ReactNode;
  optional?: boolean;
};

export function AdminField({ children, className, error, hint, id, label, optional = false }: AdminFieldProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor={id}>
        {label}
        {optional ? <span className="font-normal text-[var(--text-tertiary)]"> (opcional)</span> : null}
      </label>
      {children}
      {hint && !error ? (
        <p className="text-xs leading-5 text-[var(--text-secondary)]" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" id={`${id}-error`}>
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Pilula de opcao/filtro do prototipo aprovado (`.pill`): 34 px (44 px no toque), raio cheio, borda
 * forte, 13/500. Marcada = fundo --surface-3, borda clara e ✓. Use em <label> com radio escondido
 * (PillGroup) ou em links/botoes de filtro.
 */
export function adminPillClasses(checked: boolean) {
  return cn(
    "inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap select-none pointer-coarse:min-h-11",
    checked
      ? "border-[var(--text-primary)] bg-[var(--surface-3)] text-[var(--text-primary)]"
      : "border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]",
    adminTransition
  );
}

export type PillOption<Value extends string> = {
  label: string;
  value: Value;
};

type PillGroupProps<Value extends string> = {
  ariaLabel: string;
  className?: string;
  /** Desabilita so enquanto salva; nunca por validacao. */
  disabled?: boolean;
  /** name do grupo de radios (unico na pagina). */
  name: string;
  onChange: (value: Value) => void;
  options: readonly PillOption<Value>[];
  value: Value;
};

/**
 * Escolha unica com ate 6 opcoes, em pilulas (Formato, Quem pode ver, Situacao, filtros).
 * Radios nativos por baixo: setas do teclado e leitor de tela funcionam sem codigo extra.
 */
export function PillGroup<Value extends string>({
  ariaLabel,
  className,
  disabled = false,
  name,
  onChange,
  options,
  value
}: PillGroupProps<Value>) {
  return (
    <div aria-label={ariaLabel} className={cn("flex min-w-0 flex-wrap gap-2", className)} role="radiogroup">
      {options.map((option) => {
        const checked = option.value === value;

        return (
          <label
            className={cn(
              adminPillClasses(checked),
              "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[var(--focus-ring)]",
              disabled && "cursor-not-allowed opacity-60"
            )}
            key={option.value}
          >
            <input
              checked={checked}
              className="sr-only"
              disabled={disabled}
              name={name}
              onChange={() => onChange(option.value)}
              type="radio"
              value={option.value}
            />
            {checked ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

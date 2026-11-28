"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ACCESS_TERM_MAX_AMOUNT,
  ACCESS_TERM_PRESETS,
  ACCESS_TERM_UNITS,
  accessTermFromKey,
  accessTermKey,
  accessTermLabel,
  isAccessTermPreset,
  normalizeAccessTerm,
  type AccessTerm,
  type AccessTermUnit
} from "@/server/access/access-term";
import { adminInputClass } from "./form";

// O campo do prazo de acesso (docs/17 §1.6.10), o mesmo no item do pacote, no item "todas as formações" e
// no código de venda de um produto sozinho: frases prontas ("Para sempre", "Por 1 ano"...) e "Outro
// prazo", que abre a quantidade e a unidade. `null` = para sempre.

const CUSTOM = "outro";
/** O prazo que aparece ao escolher "Outro prazo" a partir de uma frase pronta. */
const CUSTOM_START: AccessTerm = { amount: 1, unit: "months" };

const UNIT_LABELS: Record<AccessTermUnit, readonly [string, string]> = {
  days: ["dia", "dias"],
  months: ["mês", "meses"],
  years: ["ano", "anos"]
};

type AccessTermSelectProps = {
  /** Nome do que o prazo vale, para o leitor de tela (ex.: o título do curso). */
  ariaLabel: string;
  className?: string;
  describedBy?: string;
  disabled?: boolean;
  id: string;
  onChange: (term: AccessTerm | null) => void;
  value: AccessTerm | null;
};

export function AccessTermSelect({ ariaLabel, className, describedBy, disabled = false, id, onChange, value }: AccessTermSelectProps) {
  const [customChosen, setCustomChosen] = useState(false);
  /** O texto da quantidade enquanto o produtor digita (vazio ou fora da regra ainda não vira prazo). */
  const [amountText, setAmountText] = useState<string | null>(null);
  const custom = customChosen || !isAccessTermPreset(value);
  const term = value ?? CUSTOM_START;
  const shownAmount = amountText ?? String(term.amount);
  const amountInvalid = amountText !== null && normalizeAccessTerm(term.unit, amountText.trim()) === null;

  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <select
        aria-describedby={describedBy}
        aria-label={`Prazo de acesso: ${ariaLabel}`}
        className={cn(adminInputClass, "w-[176px] max-w-full")}
        disabled={disabled}
        id={id}
        onChange={(event) => {
          setAmountText(null);

          if (event.target.value === CUSTOM) {
            setCustomChosen(true);
            onChange(value ?? CUSTOM_START);
            return;
          }

          setCustomChosen(false);
          onChange(accessTermFromKey(event.target.value));
        }}
        value={custom ? CUSTOM : accessTermKey(value)}
      >
        {ACCESS_TERM_PRESETS.map((preset) => (
          <option key={accessTermKey(preset)} value={accessTermKey(preset)}>
            {accessTermLabel(preset)}
          </option>
        ))}
        <option value={CUSTOM}>Outro prazo…</option>
      </select>
      {custom ? (
        <>
          <input
            aria-invalid={amountInvalid ? true : undefined}
            aria-label={`Quantidade do prazo: ${ariaLabel}`}
            className={cn(adminInputClass, "w-[72px] tabular-nums")}
            disabled={disabled}
            inputMode="numeric"
            maxLength={4}
            onBlur={() => setAmountText(null)}
            onChange={(event) => {
              const text = event.target.value.replace(/\D/g, "");
              const next = normalizeAccessTerm(term.unit, text);

              setAmountText(text);

              if (next) {
                onChange(next);
              }
            }}
            title={`De 1 a ${ACCESS_TERM_MAX_AMOUNT}`}
            value={shownAmount}
          />
          <select
            aria-label={`Unidade do prazo: ${ariaLabel}`}
            className={cn(adminInputClass, "w-[104px]")}
            disabled={disabled}
            onChange={(event) => {
              const next = normalizeAccessTerm(event.target.value, term.amount);

              if (next) {
                onChange(next);
              }
            }}
            value={term.unit}
          >
            {ACCESS_TERM_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {UNIT_LABELS[unit][term.amount === 1 ? 0 : 1]}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </span>
  );
}

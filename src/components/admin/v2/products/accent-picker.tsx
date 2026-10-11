"use client";

import { cn } from "@/lib/utils";
import { PRODUCT_ACCENTS, PRODUCT_ACCENT_LABELS, PRODUCT_ACCENT_ORDER, type ProductAccent } from "@/server/catalog/model";
import { adminTransition } from "../styles";

// Cor do produto (docs/17 §1.6.5) como no prototipo aprovado: seis circulos de 36 px, 10 px entre
// eles; o escolhido ganha um anel claro de 2 px. O nome de cada cor fica no rotulo acessivel e no
// balao do navegador. Radios nativos por baixo: setas do teclado e leitor de tela funcionam sem codigo
// extra.

type AccentPickerProps = {
  disabled?: boolean;
  name: string;
  onChange: (accent: ProductAccent) => void;
  value: ProductAccent;
};

export function AccentPicker({ disabled = false, name, onChange, value }: AccentPickerProps) {
  return (
    <div aria-label="Cor do produto" className="flex min-w-0 flex-wrap gap-2.5" role="radiogroup">
      {PRODUCT_ACCENT_ORDER.map((accent) => {
        const checked = accent === value;
        const label = PRODUCT_ACCENT_LABELS[accent];

        return (
          <label
            className={cn(
              "relative size-9 shrink-0 cursor-pointer rounded-full border-2 border-[var(--surface-0)]",
              "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-[3px] has-[input:focus-visible]:outline-[var(--focus-ring)]",
              checked ? "shadow-[0_0_0_2px_var(--text-primary)]" : "shadow-[0_0_0_1px_var(--border-strong)] hover:shadow-[0_0_0_1px_var(--border-stronger)]",
              disabled && "cursor-not-allowed opacity-60",
              adminTransition
            )}
            key={accent}
            style={{ backgroundColor: PRODUCT_ACCENTS[accent] }}
            title={label}
          >
            <input
              aria-label={label}
              checked={checked}
              className="absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
              disabled={disabled}
              name={name}
              onChange={() => onChange(accent)}
              type="radio"
              value={accent}
            />
          </label>
        );
      })}
    </div>
  );
}

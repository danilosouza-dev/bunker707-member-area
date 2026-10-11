"use client";

import { Check } from "lucide-react";
import { GENERIC_ACTION_ERROR } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { setProductOpensAs } from "@/server/member-area/modules-actions";
import type { CoursePresentationModeValue } from "@/server/member-area/modules-model";
import { PRESENTATION_MODE_OPTIONS } from "../../products/product-forms";
import { adminPillClasses } from "../../form";
import type { RowError } from "./home-row-control";

// "Como abre" na tabela de Area de membros › Modulos: duas pilulas que salvam na hora (mesmas opcoes e
// frases da aba Detalhes). Radios nativos por baixo: setas e leitor de tela funcionam sem codigo extra.

export const OPENS_AS_TOASTS: Record<CoursePresentationModeValue, string> = {
  lesson_playlist: "Agora abre direto nas aulas",
  module_cards: "Agora mostra os módulos"
};

/** Rotulos curtos da tabela larga (o cabecalho "Como abre" completa a frase). */
export const OPENS_AS_SHORT_LABELS: Record<CoursePresentationModeValue, string> = {
  lesson_playlist: "Direto nas aulas",
  module_cards: "Módulos"
};

export async function requestOpensAsChange(
  productId: string,
  mode: CoursePresentationModeValue
): Promise<{ ok: true } | { error: RowError; ok: false }> {
  try {
    const result = await setProductOpensAs({ mode, productId });

    return result.ok ? { ok: true } : { error: { message: result.error, reload: result.status === 409 }, ok: false };
  } catch {
    return { error: { message: GENERIC_ACTION_ERROR, reload: false }, ok: false };
  }
}

type OpensAsPillsProps = {
  /** Rotulos curtos (tabela larga, embaixo de "Como abre"). */
  compact?: boolean;
  disabled?: boolean;
  label: string;
  /** name do grupo de radios (unico na pagina). */
  name: string;
  onChange: (mode: CoursePresentationModeValue) => void;
  pending?: boolean;
  value: CoursePresentationModeValue;
};

/**
 * Pilulas compactas (36 px na tabela larga, 44 px no toque). Salvando, as pilulas ignoram mudancas mas
 * nao ficam `disabled`: um radio focado que vira disabled joga o foco do teclado no body e a proxima
 * seta nao faz nada.
 */
export function OpensAsPills({ compact = false, disabled = false, label, name, onChange, pending = false, value }: OpensAsPillsProps) {
  return (
    <div aria-busy={pending || undefined} aria-label={label} className="flex min-w-0 flex-wrap gap-1.5" role="radiogroup">
      {PRESENTATION_MODE_OPTIONS.map((option) => {
        const checked = option.value === value;

        return (
          <label
            className={cn(
              // Pilula de opcao do prototipo (34 px, raio cheio, marcada com borda clara e ✓); 44 px no toque.
              adminPillClasses(checked),
              "min-h-11 @min-[900px]:min-h-[34px] @min-[900px]:px-3",
              "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[var(--focus-ring)]",
              (disabled || pending) && "cursor-not-allowed opacity-60"
            )}
            key={option.value}
            title={compact ? option.label : undefined}
          >
            <input
              aria-disabled={pending || undefined}
              checked={checked}
              className="sr-only"
              disabled={disabled}
              name={name}
              onChange={() => {
                if (!pending) {
                  onChange(option.value);
                }
              }}
              type="radio"
              value={option.value}
            />
            {checked ? <Check aria-hidden="true" className="size-3.5 shrink-0" /> : null}
            {compact ? OPENS_AS_SHORT_LABELS[option.value] : option.label}
          </label>
        );
      })}
    </div>
  );
}

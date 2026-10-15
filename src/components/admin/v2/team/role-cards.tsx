"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ADMIN_ROLE_LABELS, type AdminRole } from "@/server/auth/roles";
import { TEAM_ROLE_DESCRIPTIONS, TEAM_ROLE_OPTIONS } from "@/server/team/model";
import { adminTransition } from "../styles";

// Escolha da funcao em cartoes (titulo + o que a pessoa pode fazer). Radios nativos por baixo: setas do
// teclado e leitor de tela funcionam sem codigo extra.

type RoleCardsProps = {
  disabled?: boolean;
  name: string;
  onChange: (role: AdminRole) => void;
  value: AdminRole;
};

export function RoleCards({ disabled = false, name, onChange, value }: RoleCardsProps) {
  return (
    <div aria-label="Função" className="grid min-w-0 gap-2 sm:grid-cols-2" role="radiogroup">
      {TEAM_ROLE_OPTIONS.map((role) => {
        const checked = role === value;

        return (
          <label
            className={cn(
              "relative flex min-w-0 cursor-pointer flex-col gap-1 rounded-lg border px-3.5 py-3 pr-10",
              checked
                ? "border-[var(--text-primary)] bg-[var(--surface-2)]"
                : "border-[var(--border-strong)] hover:bg-[var(--hover-overlay)]",
              "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[var(--focus-ring)]",
              adminTransition,
              disabled && "cursor-not-allowed opacity-60"
            )}
            key={role}
          >
            <input
              checked={checked}
              className="sr-only"
              disabled={disabled}
              name={name}
              onChange={() => onChange(role)}
              type="radio"
              value={role}
            />
            <span className="text-sm leading-5 font-semibold text-[var(--text-primary)]">{ADMIN_ROLE_LABELS[role]}</span>
            <span className="text-[13px] leading-5 text-[var(--text-secondary)]">{TEAM_ROLE_DESCRIPTIONS[role]}</span>
            {checked ? <Check aria-hidden="true" className="absolute top-3 right-3.5 size-4 text-[var(--text-primary)]" /> : null}
          </label>
        );
      })}
    </div>
  );
}

"use client";

import { Check, Crown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ADMIN_ROLE_LABELS } from "@/server/auth/roles";
import { TEAM_PRESET_OPTIONS, TEAM_ROLE_DESCRIPTIONS, type TeamCustomFunction } from "@/server/team/model";
import { adminTransition } from "../styles";
import { NEW_TEAM_FUNCTION_PATH } from "./hrefs";

// Funcoes da pessoa em cartoes: varias ao mesmo tempo (prontas e personalizadas), e o Dono a parte,
// porque e exclusivo (ja pode tudo). Caixas de marcar nativas por baixo: teclado e leitor de tela.

type FunctionCardsValue = { functions: readonly string[]; owner: boolean };

type FunctionCardsProps = {
  customFunctions: readonly TeamCustomFunction[];
  disabled?: boolean;
  onChange: (next: { functions: string[]; owner: boolean }) => void;
  value: FunctionCardsValue;
};

function Card({
  checked,
  description,
  disabled,
  icon,
  label,
  onToggle
}: {
  checked: boolean;
  description: string;
  disabled: boolean;
  icon?: ReactNode;
  label: string;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "relative flex min-w-0 cursor-pointer flex-col gap-1 rounded-lg border px-3.5 py-3 pr-10",
        checked ? "border-[var(--text-primary)] bg-[var(--surface-2)]" : "border-[var(--border-strong)] hover:bg-[var(--hover-overlay)]",
        "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[var(--focus-ring)]",
        adminTransition,
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <input checked={checked} className="sr-only" disabled={disabled} onChange={(event) => onToggle(event.target.checked)} type="checkbox" />
      <span className="flex items-center gap-2 text-sm leading-5 font-semibold text-[var(--text-primary)]">
        {icon}
        {label}
      </span>
      <span className="text-[13px] leading-5 text-[var(--text-secondary)]">{description}</span>
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-3 right-3.5 grid size-[18px] place-items-center rounded-[4px] border",
          checked ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--surface-0)]" : "border-[var(--border-stronger)]"
        )}
      >
        {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
      </span>
    </label>
  );
}

function describeCustom(fn: TeamCustomFunction) {
  if (fn.description) {
    return fn.description;
  }

  return fn.actions.length === 1 ? "1 permissão" : `${fn.actions.length} permissões`;
}

export function FunctionCards({ customFunctions, disabled = false, onChange, value }: FunctionCardsProps) {
  const selected = new Set(value.functions);

  function toggle(ref: string, checked: boolean) {
    const next = new Set(selected);

    if (checked) {
      next.add(ref);
    } else {
      next.delete(ref);
    }

    onChange({ functions: [...next], owner: false });
  }

  const sectionLabel = "text-xs leading-4 font-medium text-[var(--text-tertiary)]";

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        <p className={sectionLabel}>Funções prontas</p>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          {TEAM_PRESET_OPTIONS.map((preset) => (
            <Card
              checked={!value.owner && selected.has(preset)}
              description={TEAM_ROLE_DESCRIPTIONS[preset]}
              disabled={disabled || value.owner}
              key={preset}
              label={ADMIN_ROLE_LABELS[preset]}
              onToggle={(checked) => toggle(preset, checked)}
            />
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <p className={sectionLabel}>Suas funções</p>
        {customFunctions.length > 0 ? (
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            {customFunctions.map((fn) => (
              <Card
                checked={!value.owner && selected.has(fn.id)}
                description={describeCustom(fn)}
                disabled={disabled || value.owner}
                key={fn.id}
                label={fn.name}
                onToggle={(checked) => toggle(fn.id, checked)}
              />
            ))}
          </div>
        ) : (
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
            Nenhuma ainda.{" "}
            <Link className="font-medium text-[var(--text-primary)] underline-offset-2 hover:underline" href={NEW_TEAM_FUNCTION_PATH}>
              Criar uma função
            </Link>{" "}
            para dar a um grupo as mesmas permissões, como &quot;Professor com criação&quot;.
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <p className={sectionLabel}>Dono</p>
        <Card
          checked={value.owner}
          description={TEAM_ROLE_DESCRIPTIONS.owner}
          disabled={disabled}
          icon={<Crown aria-hidden="true" className="size-4 text-[var(--text-secondary)]" />}
          label={ADMIN_ROLE_LABELS.owner}
          onToggle={(checked) => onChange({ functions: checked ? [] : [...selected], owner: checked })}
        />
      </div>
    </div>
  );
}

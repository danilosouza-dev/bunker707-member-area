"use client";

import { Check } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { dependentActionsOf, withRequiredActions, type AdminAction } from "@/server/auth/roles";
import { TEAM_PERMISSION_GROUPS } from "@/server/team/model";

// Permissoes do Personalizado, por area. Marcar uma permissao marca o que ela precisa (exportar CSV
// marca "ver a lista de alunos"); desmarcar tira o que depende dela. O servidor fecha a lista do
// mesmo jeito (customActionsOf).

const checkboxClass =
  "mt-0.5 size-[18px] border-[var(--border-stronger)] bg-[var(--surface-1)] data-checked:border-[var(--text-primary)] data-checked:bg-[var(--text-primary)] data-checked:text-[var(--surface-0)] pointer-coarse:size-6";

function SensitiveTag() {
  return (
    <span className="ml-1.5 inline-flex h-5 items-center rounded-full border border-[var(--border-strong)] px-2 align-middle text-[11px] leading-none font-medium text-[var(--warning)]">
      Sensível
    </span>
  );
}

type PermissionChecklistProps = {
  disabled?: boolean;
  onChange: (actions: AdminAction[]) => void;
  selected: readonly AdminAction[];
};

export function PermissionChecklist({ disabled = false, onChange, selected }: PermissionChecklistProps) {
  const current = new Set(selected);

  function toggle(action: AdminAction, checked: boolean) {
    const next = new Set(current);

    if (checked) {
      for (const required of withRequiredActions([action])) {
        next.add(required);
      }
    } else {
      next.delete(action);

      for (const dependent of dependentActionsOf(action)) {
        next.delete(dependent);
      }
    }

    onChange(Array.from(next));
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {TEAM_PERMISSION_GROUPS.map((group) => (
        <fieldset className="flex min-w-0 flex-col gap-1" key={group.id}>
          <legend className="mb-1.5 text-xs leading-4 font-medium text-[var(--text-tertiary)]">{group.label}</legend>
          {group.items.map((item) => {
            const id = `permissao-${item.action.replace(".", "-")}`;

            return (
              <label className={cn("flex min-w-0 cursor-pointer items-start gap-3 rounded-lg px-1 py-1.5", disabled && "cursor-not-allowed opacity-60")} htmlFor={id} key={item.action}>
                <Checkbox
                  checked={current.has(item.action)}
                  className={checkboxClass}
                  disabled={disabled}
                  id={id}
                  onCheckedChange={(next) => toggle(item.action, next === true)}
                />
                <span className="min-w-0">
                  <span className="text-sm leading-5 font-medium text-[var(--text-primary)]">
                    {item.label}
                    {item.sensitive ? <SensitiveTag /> : null}
                  </span>
                  <span className="block text-[13px] leading-5 text-[var(--text-secondary)]">{item.description}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

/** O que uma funcao pronta pode fazer (so leitura), na mesma ordem da lista de permissoes. */
export function PermissionSummary({ actions, extra = [] }: { actions: readonly AdminAction[]; extra?: readonly string[] }) {
  const granted = new Set(actions);
  const groups = TEAM_PERMISSION_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => granted.has(item.action)) })).filter(
    (group) => group.items.length > 0
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {groups.map((group) => (
        <div className="flex min-w-0 flex-col gap-1" key={group.id}>
          <p className="text-xs leading-4 font-medium text-[var(--text-tertiary)]">{group.label}</p>
          <ul className="flex flex-col gap-1">
            {group.items.map((item) => (
              <li className="flex items-start gap-2 text-sm leading-5 text-[var(--text-primary)]" key={item.action}>
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--text-secondary)]" />
                <span>
                  {item.label}
                  {item.sensitive ? <SensitiveTag /> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {extra.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {extra.map((line) => (
            <li className="flex items-start gap-2 text-sm leading-5 text-[var(--text-primary)]" key={line}>
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--text-secondary)]" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

"use client";

import { Check, Lock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  closeGrants,
  dependentActionsOf,
  isScopableAction,
  withRequiredActions,
  type ActionScope,
  type AdminAction,
  type GrantMap
} from "@/server/auth/roles";
import { TEAM_PERMISSION_GROUPS, withoutRedundantExtras } from "@/server/team/model";
import { adminTransition } from "../styles";

// Permissoes por area, com o alcance de cada uma: a escola toda ou so os cursos escolhidos da pessoa.
// Marcar uma permissao marca o que ela precisa (exportar CSV marca "ver dados pessoais"); desmarcar
// tira o que depende dela. Permissao nova que pode ser por curso ja vem "so nos cursos" quando outras
// estao assim; restringir uma permissao aos cursos restringe junto o que ela exige (a nao ser que outra
// permissao da escola toda ainda precise). Permissoes que ja vem das funcoes da pessoa aparecem
// marcadas e travadas, com a origem; se a funcao da so nos cursos, da para liberar a escola toda so
// para esta pessoa. O servidor fecha a lista do mesmo jeito (normalizedExtras).

const checkboxClass =
  "mt-0.5 size-[18px] border-[var(--border-stronger)] bg-[var(--surface-1)] data-checked:border-[var(--text-primary)] data-checked:bg-[var(--text-primary)] data-checked:text-[var(--surface-0)] data-disabled:opacity-60 pointer-coarse:size-6";

export type LockedGrant = { scope: ActionScope; sources: readonly string[] };

function SensitiveTag() {
  return (
    <span className="ml-1.5 inline-flex h-5 items-center rounded-full border border-[var(--border-strong)] px-2 align-middle text-[11px] leading-none font-medium text-[var(--warning)]">
      Sensível
    </span>
  );
}


function ScopeChoice({
  action,
  coursesLabel,
  disabled,
  onChange,
  value
}: {
  action: AdminAction;
  coursesLabel: string;
  disabled: boolean;
  onChange: (scope: ActionScope) => void;
  value: ActionScope;
}) {
  const options: { label: string; value: ActionScope }[] = [
    { label: "Escola toda", value: "school" },
    { label: coursesLabel, value: "courses" }
  ];

  return (
    <span aria-label="Onde vale" className="mt-2 inline-flex rounded-lg border border-[var(--border-strong)] p-0.5" role="radiogroup">
      {options.map((option) => {
        const checked = option.value === value;

        return (
          <label
            className={cn(
              "inline-flex min-h-7 cursor-pointer items-center rounded-md px-2.5 text-xs font-medium whitespace-nowrap pointer-coarse:min-h-9",
              checked ? "bg-[var(--surface-3)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-1 has-[input:focus-visible]:outline-[var(--focus-ring)]",
              adminTransition,
              disabled && "cursor-not-allowed opacity-60"
            )}
            key={option.value}
          >
            <input
              checked={checked}
              className="sr-only"
              disabled={disabled}
              name={`alcance-${action.replace(".", "-")}`}
              onChange={() => onChange(option.value)}
              type="radio"
              value={option.value}
            />
            {option.label}
          </label>
        );
      })}
    </span>
  );
}

type PermissionChecklistProps = {
  /** Texto do alcance por curso ("Só nos cursos dela", "Só nos cursos de cada pessoa"). */
  coursesLabel: string;
  disabled?: boolean;
  /** Permissoes que ja vem das funcoes da pessoa: marcadas e travadas, com a origem. */
  locked?: ReadonlyMap<AdminAction, LockedGrant>;
  onChange: (next: GrantMap) => void;
  /** Permissoes marcadas aqui e o alcance de cada uma. */
  selected: ReadonlyMap<AdminAction, ActionScope>;
};

export function PermissionChecklist({ coursesLabel, disabled = false, locked = new Map(), onChange, selected }: PermissionChecklistProps) {
  function emit(next: GrantMap) {
    onChange(withoutRedundantExtras(closeGrants(next), new Map([...locked].map(([action, item]) => [action, item.scope]))));
  }

  /** Alcance de uma permissao recem-marcada: "so nos cursos" se ja ha outra assim. */
  function defaultScope(action: AdminAction): ActionScope {
    if (!isScopableAction(action)) {
      return "school";
    }

    const scopes = [...selected.values(), ...[...locked.values()].map((item) => item.scope)];

    return scopes.includes("courses") ? "courses" : "school";
  }

  function toggle(action: AdminAction, checked: boolean) {
    const next: GrantMap = new Map(selected);

    if (checked) {
      next.set(action, defaultScope(action));
    } else {
      next.delete(action);

      for (const dependent of dependentActionsOf(action)) {
        next.delete(dependent);
      }
    }

    emit(next);
  }

  function setScope(action: AdminAction, scope: ActionScope) {
    const next: GrantMap = new Map(selected);

    // Permissao que a funcao da so nos cursos: "so nos cursos" volta ao que a funcao da (sem extra).
    if (scope === "courses" && locked.get(action)?.scope === "courses") {
      next.delete(action);
    } else {
      next.set(action, scope);
    }

    // Restringir aos cursos leva junto o que a permissao exige (fechar a lista devolve a escola toda
    // ao que outra permissao da escola toda ainda precisa).
    if (scope === "courses") {
      for (const required of withRequiredActions([action])) {
        if (required !== action && next.has(required) && isScopableAction(required)) {
          next.set(required, "courses");
        }
      }
    }

    emit(next);
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {TEAM_PERMISSION_GROUPS.map((group) => (
        <fieldset className="flex min-w-0 flex-col gap-1" key={group.id}>
          <legend className="mb-1.5 text-xs leading-4 font-medium text-[var(--text-tertiary)]">{group.label}</legend>
          {group.items.map((item) => {
            const id = `permissao-${item.action.replace(".", "-")}`;
            const fromFunctions = locked.get(item.action);
            const scope = selected.get(item.action);
            const checked = Boolean(fromFunctions || scope);
            // A funcao da so nos cursos: um extra "escola toda" libera para esta pessoa.
            const widenable = fromFunctions?.scope === "courses";

            return (
              <div className="flex min-w-0 items-start gap-3 rounded-lg px-1 py-1.5" key={item.action}>
                <Checkbox
                  checked={checked}
                  className={checkboxClass}
                  disabled={disabled || Boolean(fromFunctions)}
                  id={id}
                  onCheckedChange={(next) => toggle(item.action, next === true)}
                />
                <div className="min-w-0">
                  <label className={cn("text-sm leading-5 font-medium text-[var(--text-primary)]", !fromFunctions && !disabled && "cursor-pointer")} htmlFor={id}>
                    {item.label}
                    {item.sensitive ? <SensitiveTag /> : null}
                  </label>
                  <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{item.description}</p>
                  {fromFunctions ? (
                    <>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs leading-5 text-[var(--text-tertiary)]">
                        <Lock aria-hidden="true" className="size-3.5 shrink-0" />
                        Da função {fromFunctions.sources.join(" e ")}
                        {widenable ? `, ${coursesLabel.toLocaleLowerCase("pt-BR")}` : ""}
                      </p>
                      {widenable ? (
                        <ScopeChoice
                          action={item.action}
                          coursesLabel={coursesLabel}
                          disabled={disabled}
                          onChange={(next) => setScope(item.action, next)}
                          value={scope === "school" ? "school" : "courses"}
                        />
                      ) : null}
                    </>
                  ) : scope && isScopableAction(item.action) ? (
                    <ScopeChoice action={item.action} coursesLabel={coursesLabel} disabled={disabled} onChange={(next) => setScope(item.action, next)} value={scope} />
                  ) : null}
                </div>
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

/** O que a pessoa (ou a funcao) pode fazer, so leitura, na ordem da lista de permissoes. */
export function PermissionSummary({
  coursesLabel,
  extra = [],
  grants
}: {
  coursesLabel: string;
  extra?: readonly string[];
  grants: ReadonlyMap<AdminAction, ActionScope>;
}) {
  const groups = TEAM_PERMISSION_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => grants.has(item.action)) })).filter(
    (group) => group.items.length > 0
  );

  if (groups.length === 0 && extra.length === 0) {
    return <p className="text-sm leading-5 text-[var(--text-secondary)]">Nenhuma permissão ainda.</p>;
  }

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
                  {grants.get(item.action) === "courses" ? <span className="text-[var(--text-secondary)]">, {coursesLabel.toLocaleLowerCase("pt-BR")}</span> : null}
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

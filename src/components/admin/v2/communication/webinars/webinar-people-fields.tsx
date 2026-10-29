"use client";

import { AlertCircle, Check, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { WEBINAR_ADMIN_COPY, foldWebinarText } from "@/server/webinars/editor-model";
import type { WebinarPersonOption } from "@/server/webinars/queries";
import { adminInputClass, fieldDescribedBy } from "../../form";
import { StudentAvatar } from "../../students/student-avatar";
import { adminTransition } from "../../styles";

// Quem apresenta (docs/30 §2.2 e §2.6): o Apresentador num seletor (so a equipe com messaging.publish), os
// co-apresentadores e a Equipe da sala numa lista com busca e caixas (como o seletor de produtos), cada pessoa
// com foto e funcao. Na Equipe da sala, a caixa "Pode remover e silenciar na sala" aparece por pessoa marcada.

const NONE_VALUE = "none";

const triggerClass = cn(
  "h-11 w-full min-w-0 rounded-lg border-[var(--border-strong)] bg-[var(--surface-2)] pr-2.5 pl-2 text-sm text-[var(--text-primary)] hover:border-[var(--text-tertiary)] data-[size=default]:h-11",
  adminTransition
);
const contentClass = "max-h-80 border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)] ring-0";

function PersonLabel({ person, placeholder }: { person: WebinarPersonOption | null; placeholder: string }) {
  if (!person) {
    return <span className="min-w-0 truncate text-[var(--text-tertiary)]">{placeholder}</span>;
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      <StudentAvatar avatarUrl={person.avatarUrl} name={person.name} size="sm" />
      <span className="min-w-0 truncate">
        {person.isMe ? `Eu (${person.name})` : person.name}
        <span className="text-[var(--text-tertiary)]"> · {person.roleLabel}</span>
      </span>
    </span>
  );
}

type PersonSelectProps = {
  disabled: boolean;
  error?: string;
  hint?: string;
  id: string;
  label: string;
  onChange: (userId: string | null) => void;
  people: readonly WebinarPersonOption[];
  placeholder: string;
  value: string | null;
};

/** Um membro da equipe (o Apresentador). Quem estava gravado e saiu da lista continua aparecendo pelo id. */
export function PersonSelect({ disabled, error, hint, id, label, onChange, people, placeholder, value }: PersonSelectProps) {
  const known = people.find((person) => person.id === value) ?? null;
  const options = [
    { label: placeholder, value: NONE_VALUE },
    ...people.map((person) => ({ label: person.name, value: person.id })),
    ...(value && !known ? [{ label: "Alguém que saiu da equipe", value }] : [])
  ];
  const selected = value ?? NONE_VALUE;
  const describedBy = fieldDescribedBy(id, { error, hint });

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor={id} id={`${id}-label`}>
        {label}
      </label>
      <Select disabled={disabled} items={options} onValueChange={(next) => onChange(!next || next === NONE_VALUE ? null : String(next))} value={selected}>
        <SelectTrigger aria-describedby={describedBy} aria-invalid={error ? true : undefined} aria-labelledby={`${id}-label`} className={triggerClass} id={id}>
          <SelectValue className="min-w-0">
            {(current: string | null) =>
              current && current !== NONE_VALUE ? (
                <PersonLabel person={people.find((person) => person.id === current) ?? null} placeholder="Alguém que saiu da equipe" />
              ) : (
                <PersonLabel person={null} placeholder={placeholder} />
              )
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent className={contentClass}>
          {options.map((option) => (
            <SelectItem className="min-h-10 pointer-coarse:min-h-11 [&>*:first-child]:min-w-0 [&>*:first-child]:shrink" key={option.value} value={option.value}>
              <PersonLabel person={people.find((person) => person.id === option.value) ?? null} placeholder={option.label} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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

type PeoplePickerProps = {
  disabled: boolean;
  error?: string | null;
  hint?: string;
  /** id do campo de busca (o label do AdminField aponta para ele). */
  id: string;
  items: readonly WebinarPersonOption[];
  max: number;
  /** Equipe da sala: a caixa "Pode remover e silenciar na sala" por pessoa marcada. */
  moderation?: { onToggle: (userId: string, checked: boolean) => void; values: ReadonlyMap<string, boolean> } | null;
  onChange: (userIds: string[]) => void;
  value: readonly string[];
};

/** Varias pessoas da equipe (co-apresentadores, Equipe da sala), com busca e caixas; `max` trava o resto. */
export function PeoplePicker({ disabled, error, hint, id, items, max, moderation = null, onChange, value }: PeoplePickerProps) {
  const [query, setQuery] = useState("");
  const name = useId();
  const selected = useMemo(() => new Set(value), [value]);
  const filtered = useMemo(() => {
    const term = foldWebinarText(query);

    return term ? items.filter((item) => foldWebinarText(item.name).includes(term)) : items;
  }, [items, query]);
  const full = value.length >= max;

  function toggle(userId: string) {
    onChange(selected.has(userId) ? value.filter((current) => current !== userId) : [...value, userId]);
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
        <input
          aria-describedby={fieldDescribedBy(id, { error, hint })}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          className={cn(adminInputClass, "pl-9")}
          disabled={disabled}
          id={id}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={WEBINAR_ADMIN_COPY.people.search}
          type="search"
          value={query}
        />
      </div>
      <p className="text-xs leading-5 text-[var(--text-tertiary)] tabular-nums">{WEBINAR_ADMIN_COPY.people.selected(value.length, max)}</p>
      <div
        aria-label="Pessoas"
        className={cn("max-h-72 min-w-0 overflow-y-auto overscroll-contain rounded-lg border bg-[var(--surface-1)]", error ? "border-[var(--error)]" : "border-[var(--border-subtle)]")}
        role="group"
      >
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] leading-5 text-[var(--text-secondary)]">
            {items.length === 0 ? WEBINAR_ADMIN_COPY.people.empty : WEBINAR_ADMIN_COPY.people.none}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {filtered.map((item) => {
              const checked = selected.has(item.id);
              const itemDisabled = disabled || (!checked && full);

              return (
                <li className="flex min-w-0 flex-col" key={item.id}>
                  <label
                    className={cn(
                      "flex min-h-12 cursor-pointer items-center gap-3 px-3 py-1.5",
                      "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:-outline-offset-2 has-[input:focus-visible]:outline-[var(--focus-ring)]",
                      checked ? "bg-[var(--surface-2)]" : "hover:bg-[var(--hover-overlay)]",
                      itemDisabled && "cursor-not-allowed opacity-60",
                      adminTransition
                    )}
                  >
                    <input checked={checked} className="sr-only" disabled={itemDisabled} name={name} onChange={() => toggle(item.id)} type="checkbox" value={item.id} />
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded-[5px] border",
                        checked ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--surface-0)]" : "border-[var(--border-strong)] bg-[var(--surface-2)]"
                      )}
                    >
                      {checked ? <Check className="size-3.5" /> : null}
                    </span>
                    <StudentAvatar avatarUrl={item.avatarUrl} name={item.name} size="sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm leading-5 text-[var(--text-primary)]">{item.isMe ? `Eu (${item.name})` : item.name}</span>
                      <span className="truncate text-xs leading-5 text-[var(--text-secondary)]">{item.roleLabel}</span>
                    </span>
                  </label>
                  {moderation && checked ? (
                    <label className="flex min-h-9 cursor-pointer items-center gap-2 bg-[var(--surface-2)] px-3 pb-2 pl-11 text-[13px] leading-5 text-[var(--text-secondary)]">
                      <input
                        checked={moderation.values.get(item.id) === true}
                        className="size-4 accent-[var(--text-primary)]"
                        disabled={disabled}
                        onChange={(event) => moderation.onToggle(item.id, event.target.checked)}
                        type="checkbox"
                      />
                      {WEBINAR_ADMIN_COPY.fields.canModerateRoom}
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

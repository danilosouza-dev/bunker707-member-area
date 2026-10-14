"use client";

import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { createCohort } from "@/server/students/actions";
import type { StudentCohort } from "@/server/students/model";
import { cohortNameSchema } from "@/server/students/schemas";
import { adminInputClass } from "../form";
import { adminTransition } from "../styles";

// Escolha de turma: as existentes, "Sem turma" e "Nova turma…" (cria na hora, sem sair da tela).

type CohortSelectProps = {
  cohorts: readonly StudentCohort[];
  disabled?: boolean;
  id?: string;
  /** Rotulo da opcao vazia (ex.: "Sem turma" ou "Tirar da turma"). */
  noneLabel?: string;
  onChange: (cohortId: string | null) => void;
  /** Turma criada aqui: o pai acrescenta a lista. */
  onCreated?: (cohort: StudentCohort) => void;
  /** Com placeholder, o valor null ainda nao escolhido mostra este texto (o pai controla se ja escolheu). */
  placeholder?: string;
  value: string | null;
};

const NEW_VALUE = "__nova__";

/** Lista com a turma nova (ou ja existente, sem duplicar), em ordem alfabetica. */
export function withCohort(current: readonly StudentCohort[], cohort: StudentCohort): StudentCohort[] {
  const next = current.some((item) => item.id === cohort.id) ? [...current] : [...current, cohort];

  return next.sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

export function CohortSelect({ cohorts, disabled = false, id, noneLabel = "Sem turma", onChange, onCreated, placeholder, value }: CohortSelectProps) {
  const [creating, setCreating] = useState(false);
  const [touched, setTouched] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputId = useId();
  const NONE_VALUE = "__nenhuma__";
  const items = [
    { label: noneLabel, value: placeholder ? NONE_VALUE : (null as string | null) },
    ...cohorts.map((cohort) => ({ label: cohort.name, value: cohort.id })),
    { label: "Nova turma…", value: NEW_VALUE }
  ];

  async function create() {
    const check = cohortNameSchema.safeParse(name);

    if (!check.success) {
      setError(check.error.issues[0]?.message ?? "Dê um nome à turma.");
      return;
    }

    setPending(true);
    setError(null);
    const result = await createCohort({ name: check.data });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    onCreated?.(result.data);
    onChange(result.data.id);
    setCreating(false);
    setName("");
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Select
        disabled={disabled || pending}
        items={items}
        onValueChange={(next) => {
          setTouched(true);

          if (next === NEW_VALUE) {
            setCreating(true);
            return;
          }

          setCreating(false);
          onChange(next === NONE_VALUE ? null : ((next as string | null) ?? null));
        }}
        value={creating ? NEW_VALUE : placeholder && value === null && !touched ? null : value}
      >
        <SelectTrigger
          className={cn(
            "w-full rounded-lg border-[var(--border-strong)] bg-[var(--surface-2)] pr-2.5 pl-3 text-sm text-[var(--text-primary)] hover:border-[var(--border-stronger)] data-[size=default]:h-10",
            adminTransition
          )}
          id={id}
        >
          <SelectValue className="min-w-0 truncate" placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="max-h-72 border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)] ring-0">
          {items.map((item) => (
            <SelectItem key={item.value ?? "none"} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {creating ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 gap-2">
            <label className="sr-only" htmlFor={inputId}>
              Nome da nova turma
            </label>
            <Input
              aria-invalid={error ? true : undefined}
              autoComplete="off"
              autoFocus
              className={adminInputClass}
              disabled={pending}
              id={inputId}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void create();
                }
              }}
              placeholder="Ex.: Turma 3 · Março"
              value={name}
            />
            <Button className="shrink-0 gap-1.5 px-3" disabled={pending} onClick={() => void create()} type="button" variant="secondary">
              <Plus aria-hidden="true" className="size-4" />
              {pending ? "Criando…" : "Criar"}
            </Button>
          </div>
          {error ? <p className="text-[13px] text-[var(--error)]">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

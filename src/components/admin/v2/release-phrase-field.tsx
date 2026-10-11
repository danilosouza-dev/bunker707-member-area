"use client";

import { Input } from "@/components/ui/input";
import {
  describeReleaseForStudent,
  releaseDateInputToIso,
  releaseIsoToDateInput,
  type ReleaseEntity,
  type ReleasePhrase
} from "@/server/catalog/model";
import { cn } from "@/lib/utils";
import { AdminField, PillGroup, adminInputClass, fieldDescribedBy } from "./form";

// "Liberação em frases" (docs/17 §1.3): o produtor escolhe o modo e so ve o campo que o modo usa.
// Mesmo componente no modulo, na aula e na liberacao padrao do produto (aba Acesso e venda).

type ReleaseMode = ReleasePhrase["mode"];

const modeLabels: Record<ReleaseMode, string> = {
  after_access: "Dias depois do acesso",
  after_previous_lesson: "Depois da aula anterior",
  fixed_date: "Em uma data",
  immediate: "Na hora"
};

type ReleasePhraseFieldProps = {
  /** "Depois da aula anterior" so faz sentido em aula. Padrao: so quando entity = "aula". */
  allowPreviousLesson?: boolean;
  className?: string;
  disabled?: boolean;
  entity: ReleaseEntity;
  error?: string | null;
  /** Prefixo unico na pagina para ids e name dos radios. */
  id: string;
  onChange: (phrase: ReleasePhrase) => void;
  value: ReleasePhrase;
};

function defaultPhraseFor(mode: ReleaseMode, current: ReleasePhrase): ReleasePhrase {
  switch (mode) {
    case "after_access":
      return current.mode === "after_access" ? current : { amount: 7, mode: "after_access", unit: "dias" };
    case "fixed_date": {
      if (current.mode === "fixed_date") {
        return current;
      }

      // Sugestao: daqui a 7 dias, a meia-noite de Sao Paulo.
      const inAWeek = releaseIsoToDateInput(new Date(Date.now() + 7 * 86_400_000).toISOString());

      return { date: releaseDateInputToIso(inAWeek) ?? new Date().toISOString(), mode: "fixed_date" };
    }
    case "after_previous_lesson":
      return { mode: "after_previous_lesson" };
    default:
      return { mode: "immediate" };
  }
}

export function ReleasePhraseField({
  allowPreviousLesson,
  className,
  disabled = false,
  entity,
  error,
  id,
  onChange,
  value
}: ReleasePhraseFieldProps) {
  const showPreviousLesson = allowPreviousLesson ?? entity === "aula";
  const modes: ReleaseMode[] = showPreviousLesson
    ? ["immediate", "after_access", "fixed_date", "after_previous_lesson"]
    : ["immediate", "after_access", "fixed_date"];
  const preview = describeReleaseForStudent(value, entity);

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <PillGroup
        ariaLabel="Quando liberar"
        disabled={disabled}
        name={`${id}-mode`}
        onChange={(mode) => onChange(defaultPhraseFor(mode, value))}
        options={modes.map((mode) => ({ label: modeLabels[mode], value: mode }))}
        value={value.mode}
      />

      {value.mode === "after_access" ? (
        <AdminField error={error} id={`${id}-amount`} label="Quantos dias depois de ganhar acesso">
          <Input
            aria-describedby={fieldDescribedBy(`${id}-amount`, { error })}
            aria-invalid={error ? true : undefined}
            className={cn(adminInputClass, "w-32")}
            disabled={disabled}
            id={`${id}-amount`}
            inputMode="numeric"
            max={3650}
            min={1}
            onChange={(event) => {
              const amount = Number.parseInt(event.target.value, 10);
              onChange({ ...value, amount: Number.isFinite(amount) ? amount : 0 });
            }}
            type="number"
            value={value.amount > 0 ? String(value.amount) : ""}
          />
        </AdminField>
      ) : null}

      {value.mode === "fixed_date" ? (
        <AdminField error={error} id={`${id}-date`} label="Data de liberação">
          <Input
            aria-describedby={fieldDescribedBy(`${id}-date`, { error })}
            aria-invalid={error ? true : undefined}
            className={cn(adminInputClass, "w-48")}
            disabled={disabled}
            id={`${id}-date`}
            onChange={(event) => {
              const iso = releaseDateInputToIso(event.target.value);

              if (iso) {
                onChange({ date: iso, mode: "fixed_date" });
              }
            }}
            type="date"
            value={releaseIsoToDateInput(value.date)}
          />
        </AdminField>
      ) : null}

      <p aria-live="polite" className="text-[13px] leading-5 text-[var(--text-secondary)]">
        {preview}
      </p>
    </div>
  );
}

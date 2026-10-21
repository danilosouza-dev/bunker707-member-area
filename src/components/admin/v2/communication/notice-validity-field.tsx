"use client";

import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { FlowValidity } from "@/server/communications/message-meta";
import { PillGroup, adminInputClass } from "../form";
import { DateTimeField } from "./notice-when-fields";
import {
  VALIDITY_CHOICE_OPTIONS,
  defaultWindowEnd,
  showsUrgencyHint,
  validityChoiceOf,
  validityDurationMinutes,
  validityDurationParts,
  validityOfChoice,
  type ValidityChoice,
  type ValidityUnit
} from "./notices-view-model";

// "Fica no sino por" (docs/23; docs/22 §2.2): 1, 3, 7, 30 ou 90 dias (padrao) ou "Outro", por um tempo
// (horas ou dias) ou ate uma data e hora de Sao Paulo. Na notificacao seguinte e no construtor ha tambem
// "Até a notificação principal sumir" (`anchorLabel`). Os limites (1 hora a 90 dias, fim pelo menos 1 hora
// depois do envio) vem do zod e de publishProblems; aqui so as frases e os campos.

type NoticeValidityFieldProps = {
  /** "Até a notificação principal sumir" (so em passo que conta de uma notificacao). */
  anchorLabel?: string;
  disabled: boolean;
  errors: { endsAt?: string; minutes?: string; validity?: string };
  /** Prefixo dos ids e nomes: "{prefixo}" (pilulas), "{prefixo}-numero", "{prefixo}-fim-data". */
  idPrefix: string;
  onChange: (validity: FlowValidity) => void;
  /** Hora do envio (agora ou a agendada): base do "Termina em" e do "Até uma data" padrao. */
  sendAt: number;
  value: FlowValidity;
};

const OTHER_OPTIONS = [
  { label: "Por um tempo", value: "duration" },
  { label: "Até uma data", value: "until" }
] as const;

const UNIT_OPTIONS = [
  { label: "horas", value: "hours" },
  { label: "dias", value: "days" }
] as const satisfies readonly { label: string; value: ValidityUnit }[];

const labelClass = "text-[13px] leading-5 font-medium text-[var(--text-primary)]";

export function NoticeValidityField({ anchorLabel, disabled, errors, idPrefix, onChange, sendAt, value }: NoticeValidityFieldProps) {
  const parts = value.mode === "duration" ? validityDurationParts(value.minutes) : null;
  const [unit, setUnit] = useState<ValidityUnit>(parts?.unit ?? "days");
  const [amountText, setAmountText] = useState(parts && Number.isFinite(parts.amount) ? String(parts.amount) : "");
  // "Outro" fica aberto enquanto o produtor digita, mesmo quando o numero bate com uma pilula ("3 dias").
  const [otherOpen, setOtherOpen] = useState(validityChoiceOf(value) === "other");
  const [synced, setSynced] = useState(value);
  const options: readonly { label: string; value: ValidityChoice }[] = anchorLabel ? [...VALIDITY_CHOICE_OPTIONS, { label: anchorLabel, value: "anchor" }] : VALIDITY_CHOICE_OPTIONS;

  // Valor trocado por fora (pilula, rascunho recarregado): o numero, a unidade e o "Outro" seguem o valor.
  if (value !== synced) {
    setSynced(value);
    setOtherOpen(validityChoiceOf(value) === "other");

    if (value.mode === "duration" && Number.isFinite(value.minutes)) {
      const next = validityDurationParts(value.minutes);
      setUnit(next.unit);
      setAmountText(String(next.amount));
    }
  }

  const choice: ValidityChoice = otherOpen && (value.mode === "duration" || value.mode === "until") ? "other" : validityChoiceOf(value);

  function changeAmount(text: string, nextUnit: ValidityUnit) {
    setAmountText(text);
    setUnit(nextUnit);
    const amount = text.trim() === "" ? Number.NaN : Number(text);
    const minutes = validityDurationMinutes(amount, nextUnit);
    const next: FlowValidity = { minutes, mode: "duration" };
    setSynced(next);
    onChange(next);
  }

  const minutesError = errors.minutes ?? (value.mode === "duration" ? errors.validity : undefined);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <span className={labelClass} id={`${idPrefix}-label`}>
        Fica no sino por
      </span>
      <PillGroup
        ariaLabel="Fica no sino por"
        disabled={disabled}
        name={idPrefix}
        onChange={(next) => onChange(validityOfChoice(next, value))}
        options={options}
        value={choice}
      />

      {choice === "other" ? (
        <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
          <PillGroup
            ariaLabel="Outro tempo no sino"
            disabled={disabled}
            name={`${idPrefix}-outro`}
            onChange={(mode) =>
              onChange(mode === "until" ? { endsAt: value.mode === "until" ? value.endsAt : defaultWindowEnd(null, sendAt), mode: "until" } : validityOfChoice("other", { mode: "default" }))
            }
            options={OTHER_OPTIONS}
            value={value.mode === "until" ? "until" : "duration"}
          />
          {value.mode === "until" ? (
            <DateTimeField
              disabled={disabled}
              error={errors.endsAt ?? errors.validity}
              idPrefix={`${idPrefix}-fim`}
              label="Fica no sino até"
              onChange={(iso) => onChange({ endsAt: iso, mode: "until" })}
              value={value.endsAt}
            />
          ) : (
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <input
                  aria-describedby={minutesError ? `${idPrefix}-numero-error` : undefined}
                  aria-invalid={minutesError ? true : undefined}
                  aria-label="Quanto tempo"
                  className={cn(adminInputClass, "w-24 tabular-nums")}
                  disabled={disabled}
                  id={`${idPrefix}-numero`}
                  inputMode="numeric"
                  min={1}
                  onChange={(event) => changeAmount(event.target.value, unit)}
                  type="number"
                  value={amountText}
                />
                <PillGroup
                  ariaLabel="Unidade"
                  disabled={disabled}
                  name={`${idPrefix}-unidade`}
                  onChange={(next) => changeAmount(amountText, next)}
                  options={UNIT_OPTIONS}
                  value={unit}
                />
              </div>
              {minutesError ? (
                <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" id={`${idPrefix}-numero-error`}>
                  <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  {minutesError}
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {errors.validity && choice !== "other" ? (
        <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {errors.validity}
        </p>
      ) : null}

      <p className="text-xs leading-5 text-[var(--text-secondary)]">
        Depois disso a notificação some do sino do aluno, mesmo que ele não tenha aberto.
        {showsUrgencyHint(value, sendAt) ? " Quando faltar menos de 1 dia, o aluno vê “Termina em 3 h” ao lado da hora." : null}
      </p>
    </div>
  );
}

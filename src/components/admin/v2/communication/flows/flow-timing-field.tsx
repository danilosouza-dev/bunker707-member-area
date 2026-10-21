"use client";

import { AlertCircle, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PillGroup, adminInputClass } from "../../form";
import { adminTransition } from "../../styles";
import {
  ANCHOR_LOCKED_NOTE,
  LIVE_WAIT_NOTE,
  TIMING_CHOICE_LABELS,
  WAIT_UNIT_OPTIONS,
  timingChoiceOf,
  timingForChoice,
  waitMinutes,
  waitParts,
  type TimingChoice,
  type WaitUnit
} from "./flows-view-model";

// "Quando" de um passo (docs/23 §2.5): Logo depois · Esperar [número] [minutos | horas | dias] (conta do
// passo anterior) · Antes de uma notificação vencer [notificação ▾] [número] [unidade] · e, em "Mais
// opções", Depois do envio de [notificação ▾]. So as notificacoes acima do passo no caminho entram no
// seletor. Os limites (5 minutos a 60 dias, de 5 em 5; "antes de vencer" a partir de 15 e menos que o tempo
// no sino da notificacao) vem da conferencia da arvore. Num fluxo no ar com alunos esperando o passo, a
// referencia de tempo nao muda (so o numero): a mesma regra do servidor (422).

export type FlowTiming = { anchor: "expires" | "previous" | "sent"; anchorNodeId: string | null; offsetMinutes: number };

type FlowTimingFieldProps = {
  /** As notificacoes acima do passo, de cima para baixo. */
  above: readonly { nodeId: string; title: string }[];
  disabled: boolean;
  errors: { anchorNodeId?: string; offsetMinutes?: string };
  /** Prefixo dos ids e nomes ("passo-…-quando"). */
  idPrefix: string;
  /** Fluxo no ar: mudar o numero vale para quem ja esta esperando. */
  live: boolean;
  /** Alunos esperando o passo num fluxo no ar: a referencia de tempo fica como esta. */
  locked: boolean;
  onChange: (timing: FlowTiming) => void;
  /** Sem o rotulo "Quando" (o painel ja tem o titulo da secao). */
  showLabel?: boolean;
  value: FlowTiming;
};

const selectTriggerClass = cn(
  "h-10 min-w-0 rounded-lg border-[var(--border-strong)] bg-[var(--surface-2)] pr-2.5 pl-3 text-sm text-[var(--text-primary)] hover:border-[var(--text-tertiary)] data-[size=default]:h-10 pointer-coarse:h-11",
  adminTransition
);
const selectContentClass = "max-h-80 border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)] ring-0";
const labelClass = "text-[13px] leading-5 font-medium text-[var(--text-primary)]";

function FieldError({ children, id }: { children: string; id?: string }) {
  return (
    <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" id={id}>
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}

export function FlowTimingField({ above, disabled, errors, idPrefix, live, locked, onChange, showLabel = true, value }: FlowTimingFieldProps) {
  const choice = timingChoiceOf(value);
  const parts = waitParts(value.offsetMinutes);
  const [unit, setUnit] = useState<WaitUnit>(parts.unit);
  const [amountText, setAmountText] = useState(value.offsetMinutes > 0 ? String(parts.amount) : "");
  const [synced, setSynced] = useState(value);
  const [more, setMore] = useState(choice === "after_send");

  // Valor trocado por fora (outro passo, rascunho recarregado): numero e unidade seguem o valor.
  if (value !== synced) {
    setSynced(value);

    if (Number.isFinite(value.offsetMinutes) && value.offsetMinutes !== waitMinutes(Number(amountText), unit)) {
      const next = waitParts(value.offsetMinutes);
      setUnit(next.unit);
      setAmountText(value.offsetMinutes > 0 ? String(next.amount) : "");
    }

    if (value.anchor === "sent") {
      setMore(true);
    }
  }

  const choices: TimingChoice[] = ["now", "wait"];

  if (above.length > 0) {
    choices.push("before_expiry");

    if (more || choice === "after_send") {
      choices.push("after_send");
    }
  }

  // Com alunos esperando, so as escolhas com a mesma referencia (Logo depois e Esperar contam do passo anterior).
  const allowed = locked ? choices.filter((item) => timingForChoice(item, value, above).anchor === value.anchor) : choices;
  const options = allowed.map((item) => ({ label: TIMING_CHOICE_LABELS[item], value: item }));
  const numberError = errors.offsetMinutes;

  function emit(next: FlowTiming) {
    setSynced(next);
    onChange(next);
  }

  function changeChoice(next: TimingChoice) {
    const timing = timingForChoice(next, value, above);
    const nextParts = waitParts(timing.offsetMinutes);
    setUnit(nextParts.unit);
    setAmountText(timing.offsetMinutes > 0 ? String(nextParts.amount) : "");
    emit(timing);
  }

  function changeAmount(text: string, nextUnit: WaitUnit) {
    setAmountText(text);
    setUnit(nextUnit);
    emit({ ...value, offsetMinutes: waitMinutes(text.trim() === "" ? Number.NaN : Number(text), nextUnit) });
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {showLabel ? (
        <span className={labelClass} id={`${idPrefix}-label`}>
          Quando
        </span>
      ) : null}
      <PillGroup ariaLabel="Quando" disabled={disabled} name={idPrefix} onChange={changeChoice} options={options} value={choice} />
      {above.length > 0 && !more && choice !== "after_send" && !locked ? (
        <button
          className="inline-flex min-h-9 w-fit items-center gap-1 rounded-md px-1 text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] pointer-coarse:min-h-11"
          disabled={disabled}
          onClick={() => setMore(true)}
          type="button"
        >
          <ChevronDown aria-hidden="true" className="size-4" />
          Mais opções
        </button>
      ) : null}

      {choice !== "now" ? (
        <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
          {choice === "before_expiry" || choice === "after_send" ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className={labelClass} id={`${idPrefix}-notificacao-label`}>
                {choice === "before_expiry" ? "Antes de vencer a notificação" : "Depois do envio da notificação"}
              </span>
              <Select
                disabled={disabled || locked}
                items={above.map((item) => ({ label: item.title, value: item.nodeId }))}
                onValueChange={(next) => emit({ ...value, anchorNodeId: typeof next === "string" ? next : null })}
                value={value.anchorNodeId}
              >
                <SelectTrigger aria-labelledby={`${idPrefix}-notificacao-label`} aria-invalid={errors.anchorNodeId ? true : undefined} className={cn(selectTriggerClass, "w-full")} id={`${idPrefix}-notificacao`}>
                  <SelectValue className="min-w-0 truncate" />
                </SelectTrigger>
                <SelectContent className={selectContentClass}>
                  {above.map((item) => (
                    <SelectItem key={item.nodeId} value={item.nodeId}>
                      {item.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.anchorNodeId ? <FieldError>{errors.anchorNodeId}</FieldError> : null}
            </div>
          ) : null}

          <div className="flex min-w-0 flex-col gap-1.5">
            <span className={labelClass} id={`${idPrefix}-tempo-label`}>
              {choice === "before_expiry" ? "Quanto tempo antes" : choice === "after_send" ? "Quanto tempo depois" : "Esperar"}
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <input
                aria-describedby={numberError ? `${idPrefix}-numero-error` : undefined}
                aria-invalid={numberError ? true : undefined}
                aria-labelledby={`${idPrefix}-tempo-label`}
                className={cn(adminInputClass, "w-24 tabular-nums pointer-coarse:h-11")}
                disabled={disabled}
                id={`${idPrefix}-numero`}
                inputMode="numeric"
                min={1}
                onChange={(event) => changeAmount(event.target.value, unit)}
                type="number"
                value={amountText}
              />
              <PillGroup ariaLabel="Unidade" disabled={disabled} name={`${idPrefix}-unidade`} onChange={(next) => changeAmount(amountText, next)} options={WAIT_UNIT_OPTIONS} value={unit} />
            </div>
            {numberError ? <FieldError id={`${idPrefix}-numero-error`}>{numberError}</FieldError> : null}
          </div>
        </div>
      ) : null}

      {locked ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{ANCHOR_LOCKED_NOTE}</p> : null}
      {live ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{LIVE_WAIT_NOTE}</p> : null}
    </div>
  );
}

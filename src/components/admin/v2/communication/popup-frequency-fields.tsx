"use client";

import { AlertCircle, AlertTriangle, Check, Info } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { CampaignStatus } from "@/server/communications/campaign-model";
import { popupFrequencyPatch, type PopupFrequency } from "@/server/communications/popup-display-model";
import { describePopupFrequencyLive, popupFrequencyNotes, popupSnoozeNote } from "@/server/communications/popup-sentences";
import type { NoticeDraft } from "@/server/communications/schemas";
import { PillGroup, adminInputClass, adminPillClasses } from "../form";
import { AdminSwitch } from "../settings/kit";
import { RESHOW_SWITCH_LABEL, popupFrequencyChangeHint, reshowSwitchCopy, showsReshowSwitch } from "./notices-view-model";
import {
  POPUP_CLOSE_OPTIONS,
  POPUP_EDITOR_COPY,
  POPUP_FREQUENCY_OPTIONS,
  POPUP_MINUTE_UNIT_OPTIONS,
  POPUP_REPEAT_DEFAULTS,
  POPUP_STOP_OPTIONS,
  clickStopDisabled,
  minutesToParts,
  partsToMinutes,
  popupSettingsOfDraft,
  repeatStartOf,
  snoozeSwitchDescription,
  type PopupMinuteUnit,
  type PopupRepeatFrequency
} from "./popup-editor-model";

// Card "Quantas vezes e como fecha" do pop-up (v3b-1, docs/25 §2.4): "Uma vez" ou "Mais de uma vez" com
// limite por dia, tempo entre uma vez e outra, limite total e o que faz parar; "Permitir “Lembrar depois”"
// com o "Volta em"; no pop-up no ar ou pausado, "Mostrar de novo para quem já viu" (em qualquer "Quantas
// vezes"); "Como fechar"; e a frase ao vivo. Toda mudanca de "Quantas vezes" passa por popupFrequencyPatch
// (grava `popup.frequency` e `repeat` juntos). Os numeros sao texto enquanto o produtor digita (vazio =
// invalido, o zod diz os limites); um tempo gravado reabre na maior unidade exata (1.440 = 1 dia).

/** Pop-up ja publicado (editor com ?editar=1): o que esta salvo e o "Mostrar de novo". */
export type PopupFrequencyLive = {
  onReshowChange: (reshow: boolean) => void;
  reshow: boolean;
  /** Quantos voltam a contar como novo agora (detail.reshowable). */
  reshowable: number | null;
  savedFrequency: PopupFrequency | null;
  status: CampaignStatus;
};

type PopupFrequencyFieldsProps = {
  disabled: boolean;
  draft: Pick<NoticeDraft, "allowSnooze" | "cta" | "popup" | "repeat" | "window">;
  errorFor: (key: string) => string | undefined;
  live: PopupFrequencyLive | null;
  onChange: (patch: Partial<NoticeDraft>) => void;
};

const labelClass = "text-[13px] leading-5 font-medium text-[var(--text-primary)]";

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" id={id}>
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  ) : null;
}

function textOf(value: number) {
  return Number.isFinite(value) ? String(value) : "";
}

function numberOf(text: string) {
  return text.trim() === "" ? Number.NaN : Number(text);
}

type PopupNumberInputProps = {
  ariaLabel?: string;
  disabled: boolean;
  error?: string;
  id: string;
  /** Rotulo visivel acima (sem ele, so o aria-label). */
  label?: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  suffix?: string;
  value: number;
};

/**
 * Numero inteiro do pop-up (vezes, segundos): texto enquanto digita (vazio = NaN, o zod pede o limite), segue
 * o valor quando ele muda por fora (pilula, chave ligada).
 */
export function PopupNumberInput({ ariaLabel, disabled, error, id, label, max, min, onChange, suffix, value }: PopupNumberInputProps) {
  const [text, setText] = useState(() => textOf(value));
  const [synced, setSynced] = useState(value);

  if (!Object.is(value, synced)) {
    setSynced(value);
    setText(textOf(value));
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {label ? (
        <label className={labelClass} htmlFor={id}>
          {label}
        </label>
      ) : null}
      <div className="flex min-w-0 items-center gap-2">
        <input
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error ? true : undefined}
          aria-label={label ? undefined : ariaLabel}
          className={cn(adminInputClass, "w-24 tabular-nums")}
          disabled={disabled}
          id={id}
          inputMode="numeric"
          max={max}
          min={min}
          onChange={(event) => {
            const next = numberOf(event.target.value);
            setText(event.target.value);
            setSynced(next);
            onChange(next);
          }}
          step={1}
          type="number"
          value={text}
        />
        {suffix ? <span className="text-sm leading-5 text-[var(--text-secondary)]">{suffix}</span> : null}
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

type MinutesFieldProps = {
  disabled: boolean;
  error?: string;
  id: string;
  label: string;
  onChange: (minutes: number) => void;
  unitAria: string;
  value: number;
};

/** Tempo em minutos, horas ou dias (intervalo e "Volta em"): reabre na maior unidade exata. */
function MinutesField({ disabled, error, id, label, onChange, unitAria, value }: MinutesFieldProps) {
  const initial = minutesToParts(value);
  const [unit, setUnit] = useState<PopupMinuteUnit>(initial.unit);
  const [text, setText] = useState(() => textOf(initial.amount));
  const [synced, setSynced] = useState(value);

  if (!Object.is(value, synced)) {
    setSynced(value);

    if (Number.isFinite(value)) {
      const next = minutesToParts(value);
      setUnit(next.unit);
      setText(textOf(next.amount));
    }
  }

  function change(nextText: string, nextUnit: PopupMinuteUnit) {
    const minutes = partsToMinutes(numberOf(nextText), nextUnit);
    setText(nextText);
    setUnit(nextUnit);
    setSynced(minutes);
    onChange(minutes);
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className={labelClass} htmlFor={id}>
        {label}
      </label>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <input
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error ? true : undefined}
          className={cn(adminInputClass, "w-24 tabular-nums")}
          disabled={disabled}
          id={id}
          inputMode="numeric"
          min={1}
          onChange={(event) => change(event.target.value, unit)}
          step={1}
          type="number"
          value={text}
        />
        <PillGroup ariaLabel={unitAria} disabled={disabled} name={`${id}-unidade`} onChange={(next) => change(text, next)} options={POPUP_MINUTE_UNIT_OPTIONS} value={unit} />
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function NoteLine({ children, tone }: { children: ReactNode; tone: "info" | "warning" }) {
  const Icon = tone === "warning" ? AlertTriangle : Info;

  return (
    <p className={cn("flex items-start gap-2 text-[13px] leading-5", tone === "warning" ? "text-[var(--warning)]" : "text-[var(--text-secondary)]")}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** "Para de aparecer": pilulas como o PillGroup, com "Quando o aluno clica no botão" desligada sem botao. */
function StopPills({ disabled, noButton, onChange, value }: { disabled: boolean; noButton: boolean; onChange: (value: PopupRepeatFrequency["stopOn"]) => void; value: PopupRepeatFrequency["stopOn"] }) {
  const copy = POPUP_EDITOR_COPY.frequency;

  return (
    <div className="flex min-w-0 flex-col gap-1.5" id="popup-para">
      <div aria-label={copy.stopAria} className="flex min-w-0 flex-wrap gap-2" role="radiogroup">
        {POPUP_STOP_OPTIONS.map((option) => {
          const checked = option.value === value;
          const off = disabled || (noButton && option.value === "click");

          return (
            <label
              className={cn(
                adminPillClasses(checked),
                "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[var(--focus-ring)]",
                off && "cursor-not-allowed opacity-60"
              )}
              key={option.value}
            >
              <input
                aria-describedby={noButton && option.value === "click" ? "popup-para-sem-botao" : undefined}
                checked={checked}
                className="sr-only"
                disabled={off}
                name="popup-para"
                onChange={() => onChange(option.value)}
                type="radio"
                value={option.value}
              />
              {checked ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
              {option.label}
            </label>
          );
        })}
      </div>
      {noButton ? (
        <p className="text-xs leading-5 text-[var(--text-secondary)]" id="popup-para-sem-botao">
          {copy.stopNoButton}
        </p>
      ) : null}
    </div>
  );
}

export function PopupFrequencyFields({ disabled, draft, errorFor, live, onChange }: PopupFrequencyFieldsProps) {
  const copy = POPUP_EDITOR_COPY.frequency;
  const settings = popupSettingsOfDraft(draft);
  const { frequency } = settings;
  const noButton = clickStopDisabled(draft);
  // Ultimos valores desta tela: voltam ao ir e voltar entre "Uma vez" e "Mais de uma vez" e ao religar uma chave.
  const rememberedRepeat = useRef<PopupRepeatFrequency | null>(null);
  const lastValues = useRef<{ everyMinutes: number; maxPerDay: number; maxTotal: number }>({ ...POPUP_REPEAT_DEFAULTS });

  function setFrequency(next: PopupFrequency) {
    onChange(popupFrequencyPatch({ popup: settings }, next));
  }

  function changeMode(mode: PopupFrequency["mode"]) {
    if (mode === frequency.mode) {
      return;
    }

    if (frequency.mode === "repeat") {
      rememberedRepeat.current = frequency;
      setFrequency({ mode: "once" });
      return;
    }

    setFrequency(repeatStartOf(draft, rememberedRepeat.current));
  }

  function changeRepeat(patch: Partial<PopupRepeatFrequency>) {
    if (frequency.mode === "repeat") {
      setFrequency({ ...frequency, ...patch });
    }
  }

  /** Liga ou desliga uma chave de "Mais de uma vez" (ligar traz o ultimo valor desta tela, ou o padrao). */
  function toggleLimit(key: "everyMinutes" | "maxPerDay" | "maxTotal", on: boolean) {
    if (frequency.mode !== "repeat") {
      return;
    }

    const current = frequency[key];

    if (!on && current !== null && Number.isFinite(current)) {
      lastValues.current[key] = current;
    }

    changeRepeat({ [key]: on ? lastValues.current[key] : null });
  }

  const notes = frequency.mode === "repeat" ? popupFrequencyNotes({ endsAt: draft.window.endsAt, frequency, trigger: settings.trigger }) : [];
  const snoozeNote = popupSnoozeNote({ allowSnooze: draft.allowSnooze, frequency, snoozeMinutes: settings.snoozeMinutes });
  const changeHint = live ? popupFrequencyChangeHint({ saved: live.savedFrequency, shown: frequency, status: live.status }) : null;
  const reshowCopy = live ? reshowSwitchCopy(live.reshowable, frequency.mode === "repeat" ? frequency.stopOn : null) : null;
  const numbersOk =
    frequency.mode === "once" ||
    [frequency.everyMinutes, frequency.maxPerDay, frequency.maxTotal].every((value) => value === null || Number.isInteger(value));

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 flex-col gap-3">
        <span className={labelClass}>Quantas vezes</span>
        <PillGroup ariaLabel={copy.modeAria} disabled={disabled} name="popup-vezes" onChange={changeMode} options={POPUP_FREQUENCY_OPTIONS} value={frequency.mode} />
        <FieldError id="popup-vezes-error" message={errorFor("popup.frequency.mode")} />

        {frequency.mode === "once" ? (
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.onceHint}</p>
        ) : (
          <div className="flex min-w-0 flex-col gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
            <div className="flex min-w-0 flex-col gap-2">
              <AdminSwitch
                checked={frequency.maxPerDay !== null}
                description={copy.perDayDescription}
                disabled={disabled}
                id="popup-por-dia-ligar"
                label={copy.perDayLabel}
                onCheckedChange={(on) => toggleLimit("maxPerDay", on)}
              />
              {frequency.maxPerDay !== null ? (
                <div className="pl-[52px] max-sm:pl-0">
                  <PopupNumberInput
                    disabled={disabled}
                    error={errorFor("popup.frequency.maxPerDay")}
                    id="popup-por-dia"
                    label={copy.perDayField}
                    max={100}
                    min={1}
                    onChange={(maxPerDay) => changeRepeat({ maxPerDay })}
                    value={frequency.maxPerDay}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex min-w-0 flex-col gap-2">
              <AdminSwitch
                checked={frequency.everyMinutes !== null}
                description={copy.intervalDescription[settings.trigger]}
                disabled={disabled}
                id="popup-intervalo-ligar"
                label={copy.intervalLabel}
                onCheckedChange={(on) => toggleLimit("everyMinutes", on)}
              />
              {frequency.everyMinutes !== null ? (
                <div className="pl-[52px] max-sm:pl-0">
                  <MinutesField
                    disabled={disabled}
                    error={errorFor("popup.frequency.everyMinutes")}
                    id="popup-intervalo"
                    label={copy.intervalField}
                    onChange={(everyMinutes) => changeRepeat({ everyMinutes })}
                    unitAria={copy.intervalUnitAria}
                    value={frequency.everyMinutes}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex min-w-0 flex-col gap-2">
              <AdminSwitch
                checked={frequency.maxTotal !== null}
                description={copy.totalDescription}
                disabled={disabled}
                id="popup-total-ligar"
                label={copy.totalLabel}
                onCheckedChange={(on) => toggleLimit("maxTotal", on)}
              />
              {frequency.maxTotal !== null ? (
                <div className="pl-[52px] max-sm:pl-0">
                  <PopupNumberInput
                    disabled={disabled}
                    error={errorFor("popup.frequency.maxTotal")}
                    id="popup-total"
                    label={copy.totalField}
                    max={1_000}
                    min={2}
                    onChange={(maxTotal) => changeRepeat({ maxTotal })}
                    value={frequency.maxTotal}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex min-w-0 flex-col gap-1.5">
              <span className={labelClass}>{copy.stopLabel}</span>
              <StopPills disabled={disabled} noButton={noButton} onChange={(stopOn) => changeRepeat({ stopOn })} value={frequency.stopOn} />
              <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.stopHint[frequency.stopOn]}</p>
              <FieldError id="popup-para-error" message={errorFor("popup.frequency.stopOn")} />
            </div>

            {numbersOk && notes.length > 0 ? (
              <div className="flex min-w-0 flex-col gap-2">
                {notes.map((note) => (
                  <NoteLine key={note.text} tone={note.tone}>
                    {note.text}
                  </NoteLine>
                ))}
              </div>
            ) : null}

            <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.dismissLine}</p>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <AdminSwitch
          checked={draft.allowSnooze}
          description={snoozeSwitchDescription(settings.snoozeMinutes)}
          disabled={disabled}
          id="aviso-lembrar"
          label={copy.snoozeLabel}
          onCheckedChange={(allowSnooze) => onChange({ allowSnooze })}
        />
        {draft.allowSnooze ? (
          <div className="pl-[52px] max-sm:pl-0">
            <MinutesField
              disabled={disabled}
              error={errorFor("popup.snoozeMinutes")}
              id="popup-lembrar-tempo"
              label={copy.snoozeField}
              onChange={(snoozeMinutes) => onChange({ popup: { ...settings, snoozeMinutes } })}
              unitAria={copy.snoozeUnitAria}
              value={settings.snoozeMinutes}
            />
          </div>
        ) : null}
        {snoozeNote ? <NoteLine tone="info">{snoozeNote}</NoteLine> : null}
      </div>

      {live && reshowCopy && showsReshowSwitch({ kind: "popup", status: live.status }) ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <AdminSwitch
            checked={live.reshow && !reshowCopy.disabled}
            description={reshowCopy.description}
            disabled={disabled || reshowCopy.disabled}
            id="aviso-mostrar-de-novo"
            label={RESHOW_SWITCH_LABEL}
            onCheckedChange={live.onReshowChange}
          />
          <FieldError id="aviso-mostrar-de-novo-error" message={errorFor("reshow")} />
          {changeHint ? <NoteLine tone="info">{changeHint}</NoteLine> : null}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-1.5" id="popup-fechar">
        <span className={labelClass}>{copy.closeLabel}</span>
        <PillGroup
          ariaLabel={copy.closeAria}
          disabled={disabled}
          name="popup-fechar"
          onChange={(close) => onChange({ popup: { ...settings, close } })}
          options={POPUP_CLOSE_OPTIONS}
          value={settings.close}
        />
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.closeHint[settings.close]}</p>
        <FieldError id="popup-fechar-error" message={errorFor("popup.close")} />
      </div>

      {/* Com um numero ainda invalido, a frase espera (o campo ja diz o limite). */}
      <p aria-live="polite" className="text-sm leading-6 text-[var(--text-primary)]">
        {numbersOk ? describePopupFrequencyLive(settings, draft.allowSnooze) : null}
      </p>
    </div>
  );
}

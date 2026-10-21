"use client";

import { AlertCircle, Info } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { isoToSaoPauloLocal, saoPauloLocalToIso, type CampaignStatus } from "@/server/communications/campaign-model";
import type { NoticeDraft } from "@/server/communications/schemas";
import { PillGroup, adminInputClass } from "../form";
import { AdminSwitch } from "../settings/kit";
import { RESHOW_SWITCH_LABEL, defaultSendAt, defaultWindowEnd, popupRepeatChangeHint, reshowSwitchCopy, showsReshowSwitch } from "./notices-view-model";

// "Quando" do aviso (docs/22 §2.2): notificacao sai agora ou numa data e hora de Sao Paulo; pop-up tem
// janela (comeca ao publicar ou numa data; termina sem data ou numa data), quantas vezes aparece e se
// permite "Lembrar depois". Os limites fixos do pop-up aparecem como texto, nunca como campo
// (docs/17 §1.8.1). Datas nativas (type="date"/"time") no tema escuro; a hora vale para Sao Paulo
// (UTC-3, como o resto do sistema).
// v3a (docs/24 §2.4): no pop-up no ar ou pausado, "Mostrar de novo para quem já viu" logo depois de
// "Quantas vezes", so enquanto a escolha e "Uma vez", e a dica do que muda para quem ja viu quando a escolha
// e diferente da salva.

type WhenDraft = Pick<NoticeDraft, "allowSnooze" | "kind" | "repeat" | "schedule" | "window">;

/** Pop-up ja publicado (editor com ?editar=1): o que esta salvo e o "Mostrar de novo". */
export type NoticeWhenLive = {
  onReshowChange: (reshow: boolean) => void;
  reshow: boolean;
  /** Quantos a regra "Uma vez" pula agora (detail.reshowable). */
  reshowable: number | null;
  savedRepeat: NoticeDraft["repeat"];
  status: CampaignStatus;
};

type NoticeWhenFieldsProps = {
  disabled: boolean;
  draft: WhenDraft;
  errors: { endsAt?: string; reshow?: string; sendAt?: string; startsAt?: string };
  /** v3a: so no pop-up no ar ou pausado. */
  live?: NoticeWhenLive | null;
  onChange: (patch: Partial<WhenDraft>) => void;
};

const SCHEDULE_OPTIONS = [
  { label: "Enviar agora", value: "now" },
  { label: "Agendar", value: "at" }
] as const;

const START_OPTIONS = [
  { label: "Ao publicar", value: "publish" },
  { label: "Em uma data", value: "at" }
] as const;

const END_OPTIONS = [
  { label: "Sem data para acabar", value: "never" },
  { label: "Em uma data", value: "at" }
] as const;

const REPEAT_OPTIONS = [
  { label: "Uma vez", value: "once" },
  { label: "Até o aluno clicar", value: "until_action" }
] as const;

const REPEAT_HINTS: Record<NoticeDraft["repeat"], string> = {
  once: "Aparece uma vez para cada aluno.",
  until_action: "Volta no dia seguinte até o aluno clicar ou escolher “Não mostrar de novo” (no máximo 1 vez por dia)."
};

const labelClass = "text-[13px] leading-5 font-medium text-[var(--text-primary)]";

type DateTimeFieldProps = {
  disabled: boolean;
  error?: string;
  /** Prefixo dos ids: "{prefixo}-data" e "{prefixo}-hora". */
  idPrefix: string;
  label: string;
  onChange: (iso: string) => void;
  /** ISO em UTC, ou "" enquanto a data ou a hora estao incompletas. */
  value: string;
};

/**
 * Data e hora de Sao Paulo; enquanto incompleta, o rascunho guarda "" (o zod pede "Escolha data e hora.").
 * Tambem o "Até uma data" de "Fica no sino por" (notice-validity-field.tsx).
 */
export function DateTimeField({ disabled, error, idPrefix, label, onChange, value }: DateTimeFieldProps) {
  const initial = isoToSaoPauloLocal(value);
  const [date, setDate] = useState(initial?.date ?? "");
  const [time, setTime] = useState(initial?.time ?? "");
  const [synced, setSynced] = useState(value);

  // Valor trocado por fora (padrao ao escolher "Agendar", rascunho recarregado): segue o valor.
  if (value !== synced) {
    setSynced(value);
    const next = isoToSaoPauloLocal(value);

    if (next) {
      setDate(next.date);
      setTime(next.time);
    }
  }

  function update(nextDate: string, nextTime: string) {
    setDate(nextDate);
    setTime(nextTime);
    const iso = saoPauloLocalToIso(nextDate, nextTime) ?? "";
    setSynced(iso);
    onChange(iso);
  }

  const describedBy = error ? `${idPrefix}-error` : `${idPrefix}-hint`;

  return (
    <div aria-labelledby={`${idPrefix}-label`} className="flex min-w-0 flex-col gap-1.5" role="group">
      <span className={labelClass} id={`${idPrefix}-label`}>
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap gap-2">
        <input
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          aria-label="Data"
          className={cn(adminInputClass, "w-[180px] max-w-full [color-scheme:dark]")}
          disabled={disabled}
          id={`${idPrefix}-data`}
          onChange={(event) => update(event.target.value, time)}
          type="date"
          value={date}
        />
        <input
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          aria-label="Hora"
          className={cn(adminInputClass, "w-[130px] max-w-full [color-scheme:dark]")}
          disabled={disabled}
          id={`${idPrefix}-hora`}
          onChange={(event) => update(date, event.target.value)}
          step={60}
          type="time"
          value={time}
        />
      </div>
      {error ? (
        <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" id={`${idPrefix}-error`}>
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : (
        <p className="text-xs leading-5 text-[var(--text-secondary)]" id={`${idPrefix}-hint`}>
          Horário de São Paulo.
        </p>
      )}
    </div>
  );
}

export function NoticeWhenFields({ disabled, draft, errors, live, onChange }: NoticeWhenFieldsProps) {
  // Ultima data escolhida em cada campo, para voltar a ela ao trocar de "agora" para "data".
  const remembered = useRef<{ endsAt?: string; sendAt?: string; startsAt?: string }>({});

  if (draft.kind === "inbox") {
    const sendAt = draft.schedule.mode === "at" ? draft.schedule.sendAt : null;

    return (
      <div className="flex min-w-0 flex-col gap-4">
        <PillGroup
          ariaLabel="Quando enviar"
          disabled={disabled}
          name="aviso-envio"
          onChange={(mode) => {
            if (mode === "now") {
              if (sendAt) {
                remembered.current.sendAt = sendAt;
              }

              onChange({ schedule: { mode: "now" } });
              return;
            }

            onChange({ schedule: { mode: "at", sendAt: remembered.current.sendAt || defaultSendAt(Date.now()) } });
          }}
          options={SCHEDULE_OPTIONS}
          value={draft.schedule.mode}
        />
        {sendAt !== null ? (
          <DateTimeField
            disabled={disabled}
            error={errors.sendAt}
            idPrefix="aviso-envio"
            label="Data e hora do envio"
            onChange={(iso) => onChange({ schedule: { mode: "at", sendAt: iso } })}
            value={sendAt}
          />
        ) : (
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">A notificação chega no sino dos alunos assim que você enviar.</p>
        )}
      </div>
    );
  }

  const { endsAt, startsAt } = draft.window;
  const repeatChangeHint = live ? popupRepeatChangeHint({ saved: live.savedRepeat, shown: draft.repeat, status: live.status }) : null;
  const reshowCopy = live ? reshowSwitchCopy(live.reshowable) : null;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 flex-col gap-3">
        <span className={labelClass}>Começa</span>
        <PillGroup
          ariaLabel="Quando o pop-up começa"
          disabled={disabled}
          name="aviso-inicio"
          onChange={(mode) => {
            if (mode === "publish") {
              if (startsAt) {
                remembered.current.startsAt = startsAt;
              }

              onChange({ window: { endsAt, startsAt: null } });
              return;
            }

            onChange({ window: { endsAt, startsAt: remembered.current.startsAt || defaultSendAt(Date.now()) } });
          }}
          options={START_OPTIONS}
          value={startsAt === null ? "publish" : "at"}
        />
        {startsAt !== null ? (
          <DateTimeField
            disabled={disabled}
            error={errors.startsAt}
            idPrefix="aviso-inicio"
            label="Data e hora do início"
            onChange={(iso) => onChange({ window: { endsAt, startsAt: iso } })}
            value={startsAt}
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <span className={labelClass}>Termina</span>
        <PillGroup
          ariaLabel="Quando o pop-up termina"
          disabled={disabled}
          name="aviso-fim"
          onChange={(mode) => {
            if (mode === "never") {
              if (endsAt) {
                remembered.current.endsAt = endsAt;
              }

              onChange({ window: { endsAt: null, startsAt } });
              return;
            }

            onChange({ window: { endsAt: remembered.current.endsAt || defaultWindowEnd(startsAt, Date.now()), startsAt } });
          }}
          options={END_OPTIONS}
          value={endsAt === null ? "never" : "at"}
        />
        {endsAt !== null ? (
          <DateTimeField
            disabled={disabled}
            error={errors.endsAt}
            idPrefix="aviso-fim"
            label="Data e hora do fim"
            onChange={(iso) => onChange({ window: { endsAt: iso, startsAt } })}
            value={endsAt}
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <span className={labelClass}>Quantas vezes</span>
        <PillGroup ariaLabel="Quantas vezes o pop-up aparece" disabled={disabled} name="aviso-repeticao" onChange={(repeat) => onChange({ repeat })} options={REPEAT_OPTIONS} value={draft.repeat} />
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{REPEAT_HINTS[draft.repeat]}</p>
        {repeatChangeHint ? (
          <p className="flex items-start gap-2 text-[13px] leading-5 text-[var(--text-secondary)]">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {repeatChangeHint}
          </p>
        ) : null}
      </div>

      {live && reshowCopy && showsReshowSwitch({ kind: draft.kind, repeat: draft.repeat, status: live.status }) ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <AdminSwitch
            checked={live.reshow && !reshowCopy.disabled}
            description={reshowCopy.description}
            disabled={disabled || reshowCopy.disabled}
            id="aviso-mostrar-de-novo"
            label={RESHOW_SWITCH_LABEL}
            onCheckedChange={live.onReshowChange}
          />
          {errors.reshow ? (
            <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" id="aviso-mostrar-de-novo-error">
              <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {errors.reshow}
            </p>
          ) : null}
        </div>
      ) : null}

      <AdminSwitch
        checked={draft.allowSnooze}
        description="Volta em 24 h, até 2 vezes."
        disabled={disabled}
        id="aviso-lembrar"
        label="Permitir “Lembrar depois”"
        onCheckedChange={(allowSnooze) => onChange({ allowSnooze })}
      />

      <p className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2.5 text-[13px] leading-5 text-[var(--text-secondary)]">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        Para não cansar o aluno, mostramos no máximo 1 pop-up por dia, só na home e nunca durante uma aula.
      </p>
    </div>
  );
}

"use client";

import { MonitorPlay } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { saoPauloTime } from "@/lib/webinar-time";
import { formatSaoPauloDateTime } from "@/server/communications/campaign-model";
import { WEBINAR_ADMIN_COPY, webinarConsoleHref } from "@/server/webinars/editor-model";
import { saveJitSettings } from "@/server/webinars/jit-actions";
import type { JitSessionSummary } from "@/server/webinars/jit-model";
import { JIT_LIMITS, type JitEveryMinutes, type JitSettings, type SessionStatus } from "@/server/webinars/model";
import { AdminField, PillGroup, adminInputClass, fieldDescribedBy } from "../../../form";
import { AdminSwitch } from "../../../settings/kit";
import { StatusChip } from "../../../status-chip";
import { adminToast } from "../../../toast";
import { SimulationRulesFields } from "../simulation/simulation-rules-fields";
import {
  JIT_END_HOURS,
  JIT_EVERY_OPTIONS,
  JIT_LATE_JOIN_DEFAULT,
  JIT_START_HOURS,
  jitFormChanged,
  jitFormOf,
  jitFormSentence,
  jitFormValue,
  jitNeedsDecision,
  jitSaveRequest,
  type JitForm,
  type JitLateJoinChoice
} from "./jit-card-model";

// "Comeca quando voce entra" no card Sessoes do editor (fase 4e; docs/30 §1.6, §2.2, §8.6, A14, D10 e D25): ligar, uma
// sessao a cada 15 / 30 / 60 min, a janela de horas (horario de Brasilia), a Entrada atrasada e a Simulacao que cada
// sessao copia ao nascer (o selo, o contador, as entradas e os avisos de venda, no mesmo formulario do card Simulacao,
// com o aviso do CDC, a frase de §8.6 e a caixa quando algo simulado muda). Salva tudo de uma vez por saveJitSettings
// (o servidor confere a frase, grava quem e quando e pede messaging.publish com algo simulado). Embaixo, as sessoes que
// nasceram hoje com o caminho do console. Antes do primeiro salvar do webinario, so a frase "Salve o rascunho primeiro".

const COPY = WEBINAR_COPY.jit.card;
const SIM = WEBINAR_COPY.simulacao.card;
const ADMIN = WEBINAR_ADMIN_COPY.simulation;

const LATE_JOIN_OPTIONS: readonly { label: string; value: JitLateJoinChoice }[] = [
  { label: WEBINAR_ADMIN_COPY.fields.lateJoinAlways, value: "always" },
  { label: WEBINAR_ADMIN_COPY.fields.lateJoinUntil, value: "until" }
];

const STATUS_TONE: Record<SessionStatus, "error" | "muted" | "neutral" | "success" | "warning"> = {
  cancelled: "error",
  ended: "muted",
  live: "success",
  scheduled: "neutral",
  waiting: "warning"
};

export type JitCardProps = {
  /** messaging.publish: liga o selo e os numeros simulados (sem ela, a Simulacao fica so para ler). */
  canPublish: boolean;
  /** O nome de quem esta na tela, como a frase de §8.6 registra o responsavel. */
  currentUserName: string | null;
  /** Nome de quem decidiu a Simulacao (decidedBy -> nome). */
  deciderNames: Record<string, string>;
  disabled: boolean;
  /** O video base gravado no card Dados (ligar pede o video). */
  hasVideo: boolean;
  initial: JitSettings;
  /** Hora da tela (a data da frase). */
  now: number;
  /** As regras gravadas e a versao nova do webinario (o editor segue com ela no proximo Salvar). */
  onSaved?: (settings: JitSettings, updatedAt: string) => void;
  sessionsToday: readonly JitSessionSummary[];
  /** Nulo antes do primeiro salvar do webinario. */
  webinarId: string | null;
};

function firstFieldError(fieldErrors: Record<string, string[]> | undefined): string | null {
  if (!fieldErrors) {
    return null;
  }
  return Object.values(fieldErrors).find((messages) => messages.length > 0)?.[0] ?? null;
}

function stripPrefix(errors: Record<string, string>, prefix: string): Record<string, string> {
  return Object.fromEntries(Object.entries(errors).flatMap(([key, message]) => (key.startsWith(prefix) ? [[key.slice(prefix.length), message]] : [])));
}

function HourSelect({ disabled, error, hours, id, label, onChange, value }: { disabled: boolean; error?: string; hours: readonly number[]; id: string; label: string; onChange: (hour: number) => void; value: number }) {
  return (
    <AdminField error={error} id={id} label={label}>
      <select
        aria-describedby={fieldDescribedBy(id, { error })}
        aria-invalid={error ? true : undefined}
        className={adminInputClass}
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(Number(event.target.value))}
        value={value}
      >
        {hours.map((hour) => (
          <option key={hour} value={hour}>
            {COPY.horaDe(hour)}
          </option>
        ))}
      </select>
    </AdminField>
  );
}

export function JitCard({ canPublish, currentUserName, deciderNames, disabled, hasVideo, initial, now, onSaved, sessionsToday, webinarId }: JitCardProps) {
  const idBase = useId();
  const [saved, setSaved] = useState<JitSettings>(initial);
  const [form, setForm] = useState<JitForm>(() => jitFormOf(initial));
  const [acknowledged, setAcknowledged] = useState(false);
  const [sessions, setSessions] = useState<readonly JitSessionSummary[]>(sessionsToday);
  const [names, setNames] = useState<Record<string, string>>(deciderNames);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const responsible = currentUserName ?? "";
  const parsed = jitFormValue(form);
  const changed = jitFormChanged(form, saved);
  const needsDecision = jitNeedsDecision(form, saved);
  const sentence = needsDecision ? jitFormSentence(form, { nowMs: now, responsible }) : null;
  const simulationOn = parsed.value?.rules !== null && parsed.value?.rules !== undefined;
  const publishMissing = !canPublish && (simulationOn || saved.simulation !== null);
  const locked = disabled || busy;
  const simulationLocked = locked || !canPublish;
  const decision = saved.simulation?.decidedAt ? saved.simulation : null;

  const edit = (next: JitForm) => {
    setForm(next);
    setAcknowledged(false);
    setFailure(null);
  };

  if (!webinarId) {
    return (
      <div className="flex min-w-0 flex-col gap-2 border-t border-[var(--border-subtle)] pt-4" data-jit-card="" id="webinar-jit">
        <span className="text-sm leading-6 font-semibold text-[var(--text-primary)]">{COPY.titulo}</span>
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{WEBINAR_ADMIN_COPY.review.saveFirst}</p>
      </div>
    );
  }

  const id = webinarId;

  async function save() {
    const request = jitSaveRequest(form, { acknowledged, saved, sentence, webinarId: id });

    if (!request) {
      return;
    }

    setBusy(true);
    setFailure(null);
    const result = await saveJitSettings(request).catch(() => null);
    setBusy(false);

    if (!result || !result.ok) {
      setFailure(result ? (firstFieldError(result.fieldErrors) ?? result.error) : COPY.erro);
      return;
    }

    const next = result.data.settings;
    const decidedBy = next.simulation?.decidedBy ?? null;

    if (decidedBy && result.data.deciderName) {
      setNames((current) => ({ ...current, [decidedBy]: result.data.deciderName ?? "" }));
    }

    setSaved(next);
    setForm(jitFormOf(next));
    setAcknowledged(false);
    setSessions(result.data.sessionsToday);
    adminToast.success(COPY.salvo);
    onSaved?.(next, result.data.updatedAt);
  }

  const lateJoinId = `${idBase}-late`;
  const lateJoinError = parsed.errors.lateJoinMinutes;
  const canSave = changed && !locked && parsed.value !== null && (!needsDecision || (acknowledged && sentence !== null)) && !(publishMissing && simulationOn);

  return (
    <div className="flex min-w-0 flex-col gap-4 border-t border-[var(--border-subtle)] pt-4" data-jit-card="" id="webinar-jit">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm leading-6 font-semibold text-[var(--text-primary)]">{COPY.titulo}</span>
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{COPY.descricao}</p>
      </div>

      <AdminSwitch
        checked={form.enabled}
        description={form.enabled ? COPY.ligado : COPY.desligado}
        disabled={locked || (!hasVideo && !form.enabled)}
        id="webinar-jit-enabled"
        label={COPY.ligar}
        onCheckedChange={(checked) => edit({ ...form, enabled: checked })}
        pending={busy}
      />
      {!hasVideo ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{COPY.semVideo}</p> : null}

      {form.enabled ? (
        <div className="flex min-w-0 flex-col gap-4" data-jit-fields="">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id={`${idBase}-every-label`}>
              {COPY.aCada}
            </span>
            <PillGroup
              ariaLabel={COPY.aCada}
              disabled={locked}
              name={`${idBase}-every`}
              onChange={(value) => edit({ ...form, everyMinutes: Number(value) as JitEveryMinutes })}
              options={JIT_EVERY_OPTIONS}
              value={`${form.everyMinutes}`}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5" role="group" aria-labelledby={`${idBase}-window-label`}>
            <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id={`${idBase}-window-label`}>
              {COPY.janela} {COPY.horaDe(form.startHour)} {COPY.janelaAte} {COPY.horaDe(form.endHour)} ({COPY.horarioDeBrasilia})
            </span>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <HourSelect disabled={locked} hours={JIT_START_HOURS} id="webinar-jit-startHour" label={COPY.inicioDaJanela} onChange={(startHour) => edit({ ...form, startHour })} value={form.startHour} />
              <HourSelect
                disabled={locked}
                error={parsed.errors.endHour}
                hours={JIT_END_HOURS}
                id="webinar-jit-endHour"
                label={COPY.fimDaJanela}
                onChange={(endHour) => edit({ ...form, endHour })}
                value={form.endHour}
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id={`${lateJoinId}-label`}>
              {COPY.entradaAtrasada}
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <PillGroup
                ariaLabel={COPY.entradaAtrasada}
                disabled={locked}
                name={`${idBase}-late-choice`}
                onChange={(choice: JitLateJoinChoice) => edit({ ...form, lateJoin: choice, lateJoinMinutes: choice === "until" && !form.lateJoinMinutes ? String(JIT_LATE_JOIN_DEFAULT) : form.lateJoinMinutes })}
                options={LATE_JOIN_OPTIONS}
                value={form.lateJoin}
              />
              {form.lateJoin === "until" ? (
                <label className="flex min-w-0 items-center gap-2 text-[13px] leading-5 text-[var(--text-secondary)]">
                  <span className="sr-only">{COPY.minutosDepois}</span>
                  <input
                    aria-describedby={fieldDescribedBy(lateJoinId, { error: lateJoinError })}
                    aria-invalid={lateJoinError ? true : undefined}
                    className={`${adminInputClass} w-28`}
                    disabled={locked}
                    id={lateJoinId}
                    inputMode="numeric"
                    max={JIT_LIMITS.lateJoinMax}
                    min={0}
                    onChange={(event) => edit({ ...form, lateJoinMinutes: event.target.value })}
                    type="number"
                    value={form.lateJoinMinutes}
                  />
                  <span>min</span>
                </label>
              ) : null}
            </div>
            <p className="text-xs leading-5 text-[var(--text-secondary)]">{COPY.entradaAtrasadaDica}</p>
            {lateJoinError ? <p className="text-[13px] leading-5 text-[var(--error)]">{lateJoinError}</p> : null}
          </div>

          <p className="text-xs leading-5 text-[var(--text-secondary)]">{COPY.turma}</p>

          <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border-subtle)] p-3" data-jit-simulation="">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[13px] leading-5 font-semibold text-[var(--text-primary)]">{COPY.simulacao}</span>
              <p className="text-xs leading-5 text-[var(--text-secondary)]">{COPY.simulacaoDica}</p>
              <p className="text-xs leading-5 text-[var(--text-secondary)]">{SIM.avisoCdc}</p>
            </div>
            <AdminSwitch
              checked={form.simulation.showLiveBadge}
              description={ADMIN.badgeHint}
              disabled={simulationLocked}
              id="webinar-jit-badge"
              label={ADMIN.badge}
              onCheckedChange={(checked) => edit({ ...form, simulation: { ...form.simulation, showLiveBadge: checked } })}
              pending={busy}
            />
            <SimulationRulesFields
              disabled={simulationLocked}
              errors={stripPrefix(parsed.errors, "simulation.")}
              form={form.simulation}
              idBase={`${idBase}-sim`}
              onChange={(simulation) => edit({ ...form, simulation })}
            />
            {publishMissing ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{COPY.precisaPublicar}</p> : null}
            <p className="text-xs leading-5 text-[var(--text-secondary)]" data-jit-decision="">
              {decision?.decidedAt && decision.decidedBy ? COPY.decididoPor(names[decision.decidedBy] ?? "—", formatSaoPauloDateTime(decision.decidedAt)) : ADMIN.undecided}
            </p>
          </div>

          {needsDecision && canPublish ? (
            <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] p-3" data-jit-confirm="">
              {sentence ? (
                <p className="text-[13px] leading-5 text-[var(--text-primary)]" data-jit-sentence="">
                  {sentence}
                </p>
              ) : (
                <p className="text-[13px] leading-5 text-[var(--error)]">{COPY.corrijaOsCampos}</p>
              )}
              <label className="flex min-w-0 items-start gap-2 text-[13px] leading-5 text-[var(--text-primary)]" htmlFor={`${idBase}-ack`}>
                <input
                  checked={acknowledged}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--text-primary)]"
                  disabled={locked || !sentence}
                  id={`${idBase}-ack`}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  type="checkbox"
                />
                {COPY.caixa}
              </label>
              {!acknowledged && sentence ? <span className="text-xs leading-5 text-[var(--text-secondary)]">{COPY.marqueACaixa}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {failure ? (
        <p className="text-[13px] leading-5 text-[var(--error)]" role="alert">
          {failure}
        </p>
      ) : null}

      {changed ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button className="px-4" data-jit-save="" disabled={!canSave} onClick={() => void save()} type="button">
            {busy ? COPY.salvando : COPY.salvar}
          </Button>
          <Button className="px-3 text-[var(--text-secondary)]" disabled={locked} onClick={() => edit(jitFormOf(saved))} type="button" variant="ghost">
            {SIM.descartar}
          </Button>
          {parsed.value === null ? <span className="text-xs leading-5 text-[var(--text-secondary)]">{COPY.corrijaOsCampos}</span> : null}
        </div>
      ) : null}

      {saved.enabled || sessions.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-2" data-jit-today="">
          <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{WEBINAR_COPY.jit.admin.sessoesDoDia}</span>
          {sessions.length === 0 ? (
            <p className="text-xs leading-5 text-[var(--text-secondary)]">{WEBINAR_COPY.jit.admin.nenhumaHoje}</p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-1">
              {sessions.map((session) => (
                <li className="flex min-w-0 flex-wrap items-center gap-2" data-jit-session={session.id} key={session.id}>
                  <span className="text-[13px] leading-5 text-[var(--text-primary)] tabular-nums">{WEBINAR_COPY.jit.admin.nasceuAs(saoPauloTime(session.scheduledAt))}</span>
                  <StatusChip tone={STATUS_TONE[session.status]}>{WEBINAR_ADMIN_COPY.console.phases[session.status]}</StatusChip>
                  <Link
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-[var(--text-primary)] underline-offset-4 hover:underline"
                    href={webinarConsoleHref(id, session.id)}
                  >
                    <MonitorPlay aria-hidden="true" className="size-4" />
                    {WEBINAR_ADMIN_COPY.fields.openConsole}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

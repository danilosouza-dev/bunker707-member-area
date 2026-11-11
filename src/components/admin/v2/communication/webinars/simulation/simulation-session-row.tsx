"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { formatSaoPauloDateTime } from "@/server/communications/campaign-model";
import { consoleAckSentence } from "@/server/webinars/console-model";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import type { WebinarSession } from "@/server/webinars/model";
import { saveSimulation } from "@/server/webinars/room-actions";
import { saveSessionSimulation, saveSimulatedAudience, type SessionSimulationView } from "@/server/webinars/simulation-actions";
import type { SimulationAudienceView } from "@/server/webinars/simulation-audience-model";
import { simulationClockMs, simulationSessionStarted } from "@/server/webinars/simulation-model";
import { AdminSwitch } from "../../../settings/kit";
import { SimulationAudienceControl } from "./simulation-audience-control";
import {
  savedSimulationRules,
  simulationFormChanged,
  simulationFormOf,
  simulationFormSentence,
  simulationRulesOfForm,
  simulationSummaryLine,
  type SimulationForm
} from "./simulation-card-model";
import { SimulationRulesFields } from "./simulation-rules-fields";

// Uma sessao gravada no card Simulacao (docs/30 §2.2, §4.3 e §8.6; D10): a data, o selo "Ao vivo", os tres blocos da
// fase 4 (contador, entradas e saidas, avisos de venda; simulation-rules-fields.tsx), a frase de §8.6 do que vai ser
// gravado com a caixa de confirmacao (so quando algo mudou), quem decidiu e quando, a frase gravada e o que a sessao
// mostrou (congelado no fim). Salva tudo de uma vez por saveSessionSimulation (o servidor confere a frase e grava quem
// e quando). Banco sem a 202610300003 ("v2"): so o selo, como na fase 2 (saveSimulation, a frase sem os numeros).
// Enquanto o card le as regras ("loading"), nada muda. A sessao encerrada fica so para ler. A sessao da Live ao vivo
// (adendo de 10/11/2026, R7): "Live de {quando}", sem o selo "Ao vivo" (a live ja e ao vivo; o servidor recusa), o minuto
// do aviso contado da live, a frase da live e o "ja comecou" pelo started_at (na espera ainda muda); so no modo "v4".
// Os participantes simulados mudados a qualquer momento (docs/30 D79, 11/11/2026): o card deixa de travar o numero.
// Com a sessao ja comecada (e de pe), o bloco do contador da lugar ao controle "Participantes simulados" (o mesmo do
// console; saveSimulatedAudience com a origem "editor"), e so as entradas e os avisos de venda ficam travados. Cada
// sessao tem o atalho "Mudar no console" (o console daquela sessao), e a live sem decisao diz que nada simulado aparece
// nela (a live nao tem o selo da gravada).

const COPY = WEBINAR_COPY.simulacao.card;
const ADMIN = WEBINAR_ADMIN_COPY.simulation;
const PLATEIA = WEBINAR_COPY.simulacao.plateia;

export type SimulationRowMode = "loading" | "v2" | "v4";

export type SimulationSaveOutcome = {
  /** A vista nova do controle dos participantes simulados (D79), quando a mudanca foi dele. */
  audience?: SimulationAudienceView;
  deciderName: string;
  /** O aviso do sucesso (sem ele, o do card). */
  notice?: string;
  session: WebinarSession;
  simulation: SessionSimulationView | null;
};

export type SimulationSessionRowProps = {
  /** A vista do controle dos participantes simulados desta sessao (D79); sem ela, o controle nao aparece. */
  audience?: SimulationAudienceView | null;
  /** Esta sessao esta gravando. */
  busy: boolean;
  /** messaging.publish: o controle dos participantes simulados com os botoes. */
  canPublish?: boolean;
  /** O console desta sessao ("Mudar no console"); nulo, sem o atalho. */
  consoleHref?: string | null;
  /** O nome de quem decidiu por ultimo (nulo sem decisao). */
  deciderName: string | null;
  idBase: string;
  /** O formulario inicial (sem ele, o que esta gravado); os testes desenham uma mudanca pendente com ele. */
  initialForm?: SimulationForm;
  /** Sem permissao, desligado pelo editor, outra sessao gravando ou as regras ainda nao lidas. */
  locked: boolean;
  mode: SimulationRowMode;
  /** A hora da tela (a data da frase). */
  now: number;
  onFailure: (failure: { message: string; status: number }) => void;
  onSaved: (outcome: SimulationSaveOutcome) => void;
  onSaving: (saving: boolean) => void;
  /** O nome de quem esta na tela (o mesmo que o servidor poe na frase). */
  responsible: string;
  saved: SessionSimulationView | null;
  session: WebinarSession;
};

function firstFieldError(fieldErrors: Record<string, string[]> | undefined): string | null {
  if (!fieldErrors) {
    return null;
  }
  return fieldErrors.acknowledged?.[0] ?? Object.values(fieldErrors).find((messages) => messages.length > 0)?.[0] ?? null;
}

export function SimulationSessionRow({
  audience = null,
  busy,
  canPublish = true,
  consoleHref = null,
  deciderName,
  idBase,
  initialForm,
  locked,
  mode,
  now,
  onFailure,
  onSaved,
  onSaving,
  responsible,
  saved,
  session
}: SimulationSessionRowProps) {
  const [form, setForm] = useState<SimulationForm>(() => initialForm ?? simulationFormOf(saved, session.showLiveBadge));
  const [acknowledged, setAcknowledged] = useState(false);
  const ended = session.status === "ended";
  const v4 = mode === "v4";
  const live = session.kind === "live";
  // A Simulacao completa nao muda depois que a sessao comecou (o servidor recusa com 409; §4.3 e §8.6).
  const started = v4 && !ended && simulationSessionStarted(session, now);
  const parsed = v4 ? simulationRulesOfForm(form) : null;
  const changed = v4 ? simulationFormChanged(form, savedSimulationRules(saved, session.showLiveBadge)) : form.showLiveBadge !== session.showLiveBadge;
  const sentence = v4 ? simulationFormSentence(form, { live, nowMs: now, responsible }) : consoleAckSentence({ badgeOn: form.showLiveBadge, nowMs: now, responsible });
  const fieldsLocked = locked || ended || started || mode === "loading";
  const checkboxId = `${idBase}-ack`;
  const summary = v4 ? simulationSummaryLine(saved?.summary ?? null) : null;

  const edit = (next: SimulationForm) => {
    setForm(next);
    setAcknowledged(false);
  };

  async function save() {
    if (!sentence) {
      return;
    }
    onSaving(true);
    if (v4) {
      const rules = simulationRulesOfForm(form).rules;
      if (!rules) {
        onSaving(false);
        return;
      }
      const result = await saveSessionSimulation({
        ackText: sentence,
        acknowledged: true,
        countRule: rules.countRule,
        joins: rules.joins,
        saleNotices: rules.saleNotices,
        sessionId: session.id,
        showLiveBadge: rules.showLiveBadge
      });
      onSaving(false);
      if (!result.ok) {
        onFailure({ message: firstFieldError(result.fieldErrors) ?? result.error, status: result.status });
        return;
      }
      onSaved({ deciderName: result.data.deciderName, session: result.data.session, simulation: result.data.simulation });
      return;
    }
    const result = await saveSimulation({ ackText: sentence, acknowledged: true, sessionId: session.id, showLiveBadge: form.showLiveBadge });
    onSaving(false);
    if (!result.ok) {
      onFailure({ message: firstFieldError(result.fieldErrors) ?? result.error, status: result.status });
      return;
    }
    onSaved({ deciderName: result.data.deciderName, session: result.data.session, simulation: null });
  }

  /** O Aplicar e o Tirar do controle (D79), pelo card: a origem "editor"; a falha vai ao banner do card. */
  async function applyAudience(input: { ackText: string | null; extra: number }): Promise<boolean> {
    onSaving(true);
    const result = await saveSimulatedAudience({ ackText: input.ackText ?? undefined, acknowledged: input.ackText !== null, extra: input.extra, sessionId: session.id, source: "editor" });
    onSaving(false);
    if (!result.ok) {
      onFailure({ message: firstFieldError(result.fieldErrors) ?? result.error, status: result.status });
      return false;
    }
    onSaved({ audience: result.data.audience, deciderName: result.data.deciderName, notice: PLATEIA.aplicado(input.extra), session: result.data.session, simulation: null });
    return true;
  }

  // Ja comecada e de pe: o contador da lugar ao controle dos participantes simulados (o resto fica travado).
  const audienceShown = started && audience !== null;

  return (
    <li className="flex min-w-0 flex-col gap-3 border-b border-[var(--border-subtle)] pb-4 last:border-b-0 last:pb-0" data-simulation-session={session.id}>
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm leading-6 font-semibold text-[var(--text-primary)]">{live ? COPY.sessaoLive(formatSaoPauloDateTime(session.scheduledAt)) : ADMIN.sessionLabel(formatSaoPauloDateTime(session.scheduledAt))}</span>
        {consoleHref && v4 && !ended ? (
          <Link className="text-[13px] leading-5 font-medium text-[var(--text-primary)] underline underline-offset-2" data-simulation-console-link="" href={consoleHref}>
            {PLATEIA.abrirConsole}
          </Link>
        ) : null}
      </div>
      {audienceShown && audience ? (
        <SimulationAudienceControl
          audience={audience}
          busy={busy || locked}
          canPublish={canPublish}
          idBase={`${idBase}-plateia`}
          live={live}
          nowMs={now}
          offsetMs={simulationClockMs(session, now)}
          onApply={applyAudience}
          phase="on_air"
          responsible={responsible}
        />
      ) : null}
      {live ? null : (
        <AdminSwitch
          checked={form.showLiveBadge}
          description={ADMIN.badgeHint}
          disabled={fieldsLocked}
          id={`${idBase}-badge`}
          label={ADMIN.badge}
          onCheckedChange={(checked) => edit({ ...form, showLiveBadge: checked })}
          pending={busy}
        />
      )}
      {v4 ? <SimulationRulesFields disabled={fieldsLocked} errors={parsed?.errors ?? {}} form={form} hideCount={audienceShown} idBase={idBase} live={live} onChange={edit} /> : null}
      {v4 && ended ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{COPY.sessaoEncerrada}</p> : null}
      {started ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{live ? COPY.liveComecou : COPY.sessaoComecou}</p> : null}
      {changed && !ended && !started ? (
        <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] p-3" data-simulation-confirm="">
          {sentence ? (
            <p className="text-[13px] leading-5 text-[var(--text-primary)]" data-simulation-sentence="">
              {sentence}
            </p>
          ) : (
            <p className="text-[13px] leading-5 text-[var(--error)]">{parsed?.errors.form ?? COPY.corrijaOsCampos}</p>
          )}
          <label className="flex min-w-0 items-start gap-2 text-[13px] leading-5 text-[var(--text-primary)]" htmlFor={checkboxId}>
            <input
              checked={acknowledged}
              className="mt-0.5 size-4 shrink-0 accent-[var(--text-primary)]"
              disabled={locked || !sentence}
              id={checkboxId}
              onChange={(event) => setAcknowledged(event.target.checked)}
              type="checkbox"
            />
            {v4 ? COPY.caixa : ADMIN.ackLabel}
          </label>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button className="px-4" disabled={locked || !acknowledged || !sentence} onClick={() => void save()} type="button">
              {busy ? COPY.salvando : v4 ? COPY.salvar : ADMIN.confirm}
            </Button>
            <Button
              className="px-3 text-[var(--text-secondary)]"
              disabled={locked}
              onClick={() => edit(simulationFormOf(saved, session.showLiveBadge))}
              type="button"
              variant="ghost"
            >
              {COPY.descartar}
            </Button>
            {!acknowledged && sentence ? <span className="text-xs leading-5 text-[var(--text-secondary)]">{COPY.marqueACaixa}</span> : null}
          </div>
        </div>
      ) : null}
      <p className={cn("text-xs leading-5", session.simulationDecidedAt ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]")} data-simulation-decision="">
        {session.simulationDecidedAt && deciderName ? ADMIN.decidedBy(deciderName, formatSaoPauloDateTime(session.simulationDecidedAt)) : live ? ADMIN.undecidedLive : ADMIN.undecided}
      </p>
      {session.simulationAckText ? <p className="text-xs leading-5 text-[var(--text-tertiary)]">{session.simulationAckText}</p> : null}
      {summary ? (
        <p className="text-xs leading-5 text-[var(--text-secondary)]" data-simulation-summary="">
          {summary}
        </p>
      ) : null}
    </li>
  );
}

"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatSaoPauloDateTime } from "@/server/communications/campaign-model";
import { consoleAckSentence } from "@/server/webinars/console-model";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import type { WebinarSession } from "@/server/webinars/model";
import { saveSimulation } from "@/server/webinars/room-actions";
import { ErrorBanner } from "../../error-banner";
import { AdminSwitch } from "../../settings/kit";
import { adminToast } from "../../toast";

// Card "Simulação" do editor (docs/30 §2.2, §4.3 e §8.6; D10): por sessao gravada, o selo "Ao vivo" com a frase da
// decisao (montada aqui com o nome de quem esta na tela e a data de hoje em Sao Paulo, exatamente como o servidor
// confere), a caixa de confirmacao e quem decidiu quando. Ligar exige a caixa marcada; desligar grava a decisao
// tambem. O aviso do CDC fica fixo no card.

const copy = WEBINAR_ADMIN_COPY.simulation;

type Decision = { ackText: string | null; decidedAt: string | null; decidedBy: string | null; showLiveBadge: boolean };

type SimulationCardProps = {
  canPublish: boolean;
  currentUserName: string | null;
  deciderNames: Record<string, string>;
  disabled: boolean;
  /** Hora da tela (a data de hoje da frase). */
  now: number;
  sessions: readonly WebinarSession[];
};

function decisionOf(session: WebinarSession): Decision {
  return { ackText: session.simulationAckText, decidedAt: session.simulationDecidedAt, decidedBy: session.simulationDecidedBy, showLiveBadge: session.showLiveBadge };
}

export function SimulationCard({ canPublish, currentUserName, deciderNames, disabled, now, sessions }: SimulationCardProps) {
  const idBase = useId();
  const simulated = sessions.filter((session) => session.kind === "simulated" && session.status !== "cancelled");
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => Object.fromEntries(simulated.map((session) => [session.id, decisionOf(session)])));
  const [names, setNames] = useState<Record<string, string>>(deciderNames);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ message: string; status: number } | null>(null);
  const responsible = currentUserName ?? "";
  const locked = disabled || !canPublish || busy !== null;

  /** Grava a decisao com a frase exatamente como esta na tela (a data de hoje em Sao Paulo; o servidor aceita a de ontem tambem). */
  async function confirm(session: WebinarSession, showLiveBadge: boolean, sentence: string) {
    setBusy(session.id);
    setFailure(null);
    const result = await saveSimulation({ ackText: sentence, acknowledged: true, sessionId: session.id, showLiveBadge });
    setBusy(null);
    if (!result.ok) {
      setFailure({ message: result.fieldErrors?.acknowledged?.[0] ?? result.error, status: result.status });
      return;
    }
    setDecisions((current) => ({ ...current, [session.id]: decisionOf(result.data.session) }));
    setNames((current) => ({ ...current, [result.data.session.simulationDecidedBy ?? ""]: result.data.deciderName }));
    setPending((current) => {
      const next = { ...current };
      delete next[session.id];
      return next;
    });
    setAcknowledged((current) => ({ ...current, [session.id]: false }));
    adminToast.success(WEBINAR_ADMIN_COPY.toasts.simulationSaved);
  }

  return (
    <div className="flex min-w-0 flex-col gap-4" data-simulation-card="">
      <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 text-[13px] leading-5 text-[var(--text-secondary)]">{copy.legal}</p>
      <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.numbersReal}</p>
      {!canPublish ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.needsPublish}</p> : null}
      {failure ? (
        <ErrorBanner
          action={
            <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setFailure(null)} type="button" variant="ghost">
              Fechar
            </Button>
          }
          title={WEBINAR_ADMIN_COPY.failures.generic}
        >
          {failure.message}
        </ErrorBanner>
      ) : null}
      {simulated.length === 0 ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.noSessions}</p> : null}
      <ul className="flex min-w-0 flex-col gap-4">
        {simulated.map((session) => {
          const decision = decisions[session.id] ?? decisionOf(session);
          const wanted = session.id in pending ? pending[session.id] : decision.showLiveBadge;
          const changed = wanted !== decision.showLiveBadge;
          const sentence = consoleAckSentence({ badgeOn: wanted, nowMs: now, responsible });
          const checkboxId = `${idBase}-${session.id}-ack`;
          const deciderName = decision.decidedBy ? (names[decision.decidedBy] ?? "Equipe") : null;

          return (
            <li className="flex min-w-0 flex-col gap-3 border-b border-[var(--border-subtle)] pb-4 last:border-b-0 last:pb-0" data-simulation-session={session.id} key={session.id}>
              <span className="text-sm leading-6 font-semibold text-[var(--text-primary)]">{copy.sessionLabel(formatSaoPauloDateTime(session.scheduledAt))}</span>
              <AdminSwitch
                checked={wanted}
                description={copy.badgeHint}
                disabled={locked || session.status === "ended"}
                id={`${idBase}-${session.id}-badge`}
                label={copy.badge}
                onCheckedChange={(checked) => {
                  setPending((current) => ({ ...current, [session.id]: checked }));
                  setAcknowledged((current) => ({ ...current, [session.id]: false }));
                }}
                pending={busy === session.id}
              />
              {changed ? (
                <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] p-3">
                  <p className="text-[13px] leading-5 text-[var(--text-primary)]" data-simulation-sentence="">
                    {sentence}
                  </p>
                  <label className="flex min-w-0 items-start gap-2 text-[13px] leading-5 text-[var(--text-primary)]" htmlFor={checkboxId}>
                    <input
                      checked={acknowledged[session.id] ?? false}
                      className="mt-0.5 size-4 shrink-0 accent-[var(--text-primary)]"
                      disabled={locked}
                      id={checkboxId}
                      onChange={(event) => setAcknowledged((current) => ({ ...current, [session.id]: event.target.checked }))}
                      type="checkbox"
                    />
                    {copy.ackLabel}
                  </label>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Button className="px-4" disabled={locked || !(acknowledged[session.id] ?? false)} onClick={() => void confirm(session, wanted, sentence)} type="button">
                      {busy === session.id ? "Gravando…" : copy.confirm}
                    </Button>
                    <Button
                      className="px-3 text-[var(--text-secondary)]"
                      disabled={locked}
                      onClick={() =>
                        setPending((current) => {
                          const next = { ...current };
                          delete next[session.id];
                          return next;
                        })
                      }
                      type="button"
                      variant="ghost"
                    >
                      Cancelar
                    </Button>
                    {!(acknowledged[session.id] ?? false) ? <span className="text-xs leading-5 text-[var(--text-secondary)]">{copy.unsaved}</span> : null}
                  </div>
                </div>
              ) : null}
              <p className={cn("text-xs leading-5", decision.decidedAt ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]")} data-simulation-decision="">
                {decision.decidedAt && deciderName ? copy.decidedBy(deciderName, formatSaoPauloDateTime(decision.decidedAt)) : copy.undecided}
              </p>
              {decision.ackText ? <p className="text-xs leading-5 text-[var(--text-tertiary)]">{decision.ackText}</p> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

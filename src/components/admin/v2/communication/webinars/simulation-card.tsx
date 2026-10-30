"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import type { WebinarSession } from "@/server/webinars/model";
import { loadSessionSimulations, type SessionSimulationView, type SessionSimulationsData } from "@/server/webinars/simulation-actions";
import { ErrorBanner } from "../../error-banner";
import { PendingMigrationNotice } from "../../pending-migration-notice";
import { adminToast } from "../../toast";
import { SimulationSessionRow, type SimulationRowMode, type SimulationSaveOutcome } from "./simulation/simulation-session-row";

// Card "Simulação" do editor (docs/30 §2.2, §3.5, §4.3, §6.6 e §8.6; D6, D10, D25): por sessao gravada (nunca a live,
// o replay nem a sessao do "Comeca quando voce entra", que copia o modelo), o selo "Ao vivo" da fase 2 e, na fase 4, o
// Contador de plateia (So o real / Real + numero fixo / Real + faixa que varia), as Entradas e saidas (a cada N s, no
// maximo M, nomes genericos) e as Notificacoes de venda (texto + minuto, desligadas por padrao), com o aviso do CDC
// fixo, a frase de §8.6 do que vai ser gravado (data de Sao Paulo, o nome de quem esta na tela, exatamente como o
// servidor confere) e a caixa de confirmacao. Cada sessao salva
// tudo de uma vez (saveSessionSimulation, messaging.publish). As regras sao lidas ao abrir (loadSessionSimulations;
// Tentar de novo quando falha); banco sem a 202610300003, o aviso da migracao no lugar dos numeros e o selo como na
// fase 2. Os numeros simulados aparecem no relatorio so no bloco Simulacao (D6, M6).

const COPY = WEBINAR_COPY.simulacao.card;
const ADMIN = WEBINAR_ADMIN_COPY.simulation;

type LoadState = { data: SessionSimulationsData; kind: "ready" } | { kind: "error"; message: string } | { kind: "loading" };

type SimulationCardProps = {
  canPublish: boolean;
  currentUserName: string | null;
  deciderNames: Record<string, string>;
  disabled: boolean;
  /** As regras ja lidas (sem elas, o card le por loadSessionSimulations ao abrir). */
  initialSimulations?: SessionSimulationsData;
  /** Hora da tela (a data de hoje da frase). */
  now: number;
  sessions: readonly WebinarSession[];
};

export function SimulationCard({ canPublish, currentUserName, deciderNames, disabled, initialSimulations, now, sessions }: SimulationCardProps) {
  const idBase = useId();
  // As sessoes do "Comeca quando voce entra" (jit) seguem o modelo do card Sessoes (4e): nao entram aqui uma a uma.
  const simulated = sessions.filter((session) => session.kind === "simulated" && session.status !== "cancelled" && !session.jit);
  const webinarId = simulated[0]?.webinarId ?? null;
  const [load, setLoad] = useState<LoadState>(() => (initialSimulations ? { data: initialSimulations, kind: "ready" } : { kind: "loading" }));
  const [attempt, setAttempt] = useState(0);
  const [savedSessions, setSavedSessions] = useState<Record<string, WebinarSession>>({});
  const [savedSimulations, setSavedSimulations] = useState<Record<string, SessionSimulationView>>({});
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [names, setNames] = useState<Record<string, string>>(deciderNames);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ message: string; status: number } | null>(null);
  const responsible = currentUserName ?? "";

  useEffect(() => {
    if (initialSimulations || !webinarId) {
      return;
    }
    let stopped = false;
    loadSessionSimulations({ webinarId })
      .then((result) => {
        if (!stopped) {
          setLoad(result.ok ? { data: result.data, kind: "ready" } : { kind: "error", message: result.error || COPY.erroCarregar });
        }
      })
      .catch(() => {
        if (!stopped) {
          setLoad({ kind: "error", message: COPY.erroCarregar });
        }
      });
    return () => {
      stopped = true;
    };
  }, [attempt, initialSimulations, webinarId]);

  const mode: SimulationRowMode = load.kind === "ready" ? (load.data.pendingMigration ? "v2" : "v4") : "loading";
  const loaded = load.kind === "ready" && !load.data.pendingMigration ? new Map(load.data.simulations.map((simulation) => [simulation.sessionId, simulation])) : new Map<string, SessionSimulationView>();
  const locked = disabled || !canPublish || busy !== null || mode === "loading";

  function saved(outcome: SimulationSaveOutcome) {
    const id = outcome.session.id;
    setSavedSessions((current) => ({ ...current, [id]: outcome.session }));
    if (outcome.simulation) {
      const simulation = outcome.simulation;
      setSavedSimulations((current) => ({ ...current, [id]: simulation }));
    }
    if (outcome.session.simulationDecidedBy) {
      const deciderId = outcome.session.simulationDecidedBy;
      setNames((current) => ({ ...current, [deciderId]: outcome.deciderName }));
    }
    setVersions((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
    setFailure(null);
    adminToast.success(mode === "v4" ? COPY.salva : WEBINAR_ADMIN_COPY.toasts.simulationSaved);
  }

  return (
    <div className="flex min-w-0 flex-col gap-4" data-simulation-card="">
      <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 text-[13px] leading-5 text-[var(--text-secondary)]">{COPY.avisoCdc}</p>
      <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
        {COPY.numerosPadrao} {COPY.relatorio}
      </p>
      {!canPublish ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{ADMIN.needsPublish}</p> : null}
      {simulated.length > 0 && load.kind === "loading" ? (
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]" role="status">
          {COPY.carregando}
        </p>
      ) : null}
      {load.kind === "error" ? (
        <ErrorBanner
          action={
            <Button
              className="px-3"
              onClick={() => {
                setLoad({ kind: "loading" });
                setAttempt((value) => value + 1);
              }}
              type="button"
              variant="secondary"
            >
              {COPY.tentarDeNovo}
            </Button>
          }
        >
          {load.message}
        </ErrorBanner>
      ) : null}
      {load.kind === "ready" && load.data.pendingMigration ? <PendingMigrationNotice migration={load.data.migration} size="compact" /> : null}
      {failure ? (
        <ErrorBanner
          action={
            <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setFailure(null)} type="button" variant="ghost">
              {COPY.fechar}
            </Button>
          }
          title={WEBINAR_ADMIN_COPY.failures.generic}
        >
          {failure.message}
        </ErrorBanner>
      ) : null}
      {simulated.length === 0 ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{ADMIN.noSessions}</p> : null}
      <ul className="flex min-w-0 flex-col gap-4">
        {simulated.map((original) => {
          const session = savedSessions[original.id] ?? original;
          const decider = session.simulationDecidedBy ? (names[session.simulationDecidedBy] ?? COPY.equipe) : null;
          const version = versions[session.id] ?? 0;
          return (
            <SimulationSessionRow
              busy={busy === session.id}
              deciderName={decider}
              idBase={`${idBase}-${session.id}`}
              key={`${session.id}:${mode}:${version}`}
              locked={locked}
              mode={mode}
              now={now}
              onFailure={setFailure}
              onSaved={saved}
              onSaving={(saving) => setBusy(saving ? session.id : null)}
              responsible={responsible}
              saved={savedSimulations[session.id] ?? loaded.get(session.id) ?? null}
              session={session}
            />
          );
        })}
      </ul>
    </div>
  );
}

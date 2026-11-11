"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { WEBINAR_ADMIN_COPY, webinarConsoleHref } from "@/server/webinars/editor-model";
import type { WebinarSession } from "@/server/webinars/model";
import { loadSessionSimulations, type SessionSimulationView, type SessionSimulationsData } from "@/server/webinars/simulation-actions";
import type { SimulationAudienceView } from "@/server/webinars/simulation-audience-model";
import { ErrorBanner } from "../../error-banner";
import { PendingMigrationNotice } from "../../pending-migration-notice";
import { adminToast } from "../../toast";
import { simulationChangedElsewhere } from "./simulation/simulation-card-model";
import { SimulationSessionRow, type SimulationRowMode, type SimulationSaveOutcome } from "./simulation/simulation-session-row";

// Card "Simulação" do editor (docs/30 §2.2, §3.5, §4.3, §6.6 e §8.6; D6, D10, D25): por sessao gravada (nunca a live,
// o replay nem a sessao do "Comeca quando voce entra", que copia o modelo), o selo "Ao vivo" da fase 2 e, na fase 4, o
// Contador de plateia (So o real / Real + numero fixo / Real + faixa que varia), as Entradas e saidas (a cada N s, no
// maximo M, nomes genericos) e as Notificacoes de venda (texto + minuto, desligadas por padrao), com o aviso do CDC
// fixo, a frase de §8.6 do que vai ser gravado (data de Sao Paulo, o nome de quem esta na tela, exatamente como o
// servidor confere) e a caixa de confirmacao. Cada sessao salva
// tudo de uma vez (saveSessionSimulation, messaging.publish). As regras sao lidas ao abrir (loadSessionSimulations;
// Tentar de novo quando falha); banco sem a 202610300003, o aviso da migracao no lugar dos numeros e o selo como na
// fase 2. Os numeros simulados aparecem no relatorio so no bloco Simulacao (D6, M6). Na Live ao vivo (adendo de
// 10/11/2026, R7; `webinarKind` "live"): a sessao da live (nunca o Replay), com o aviso do CDC da live e a frase da live;
// sem a 202610300003 nao ha o que decidir na live (ela nunca teve o selo), so o aviso da migracao.
// Os participantes simulados mudados a qualquer momento (docs/30 D79, teste do produtor de 11/11/2026): no alto do
// card, a frase de que o numero muda tambem no ar (aqui ou no console) e de que as entradas e os avisos de venda travam
// quando a sessao comeca; cada sessao com o atalho "Mudar no console" e, ja comecada, o controle dos participantes
// simulados (a vista vem de loadSessionSimulations; a mudanca troca a vista e o aviso diz que a sala recebe em segundos).
// A revisao v8 (11/11/2026, achado 6): o salvar recusado porque a Simulacao mudou em outro lugar (o console ou outra
// aba) mostra a frase com o Recarregar, que le de novo as regras (com a hora da decisao) e a pagina (router.refresh) e
// refaz as linhas com o que esta gravado agora.

const COPY = WEBINAR_COPY.simulacao.card;
const ADMIN = WEBINAR_ADMIN_COPY.simulation;

type LoadState = { data: SessionSimulationsData; kind: "ready" } | { kind: "error"; message: string } | { kind: "loading" };

type Failure = { message: string; status: number };

/**
 * O aviso da falha do salvar: a frase do servidor com o Fechar; quando a Simulacao mudou em outro lugar (a revisao v8,
 * achado 6), com o Recarregar no lugar do Fechar.
 */
export function SimulationFailureBanner({ failure, onClose, onReload }: { failure: Failure; onClose: () => void; onReload: () => void }) {
  const changed = simulationChangedElsewhere(failure);
  return (
    <ErrorBanner
      action={
        changed ? (
          <Button className="px-3" data-simulation-reload="" onClick={onReload} type="button" variant="secondary">
            {COPY.recarregar}
          </Button>
        ) : (
          <Button className="px-3 text-[var(--text-secondary)]" onClick={onClose} type="button" variant="ghost">
            {COPY.fechar}
          </Button>
        )
      }
      title={changed ? WEBINAR_ADMIN_COPY.failures.conflictTitle : WEBINAR_ADMIN_COPY.failures.generic}
    >
      {failure.message}
    </ErrorBanner>
  );
}

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
  /** O tipo do webinario: na Live ao vivo, a sessao da live (R7); sem ele, a Live gravada. */
  webinarKind?: "live" | "simulated";
};

export function SimulationCard({ canPublish, currentUserName, deciderNames, disabled, initialSimulations, now, sessions, webinarKind = "simulated" }: SimulationCardProps) {
  const idBase = useId();
  const router = useRouter();
  const liveWebinar = webinarKind === "live";
  // As sessoes do "Comeca quando voce entra" (jit) seguem o modelo do card Sessoes (4e): nao entram aqui uma a uma.
  const simulated = sessions.filter((session) => session.kind === (liveWebinar ? "live" : "simulated") && session.status !== "cancelled" && !session.jit);
  const webinarId = simulated[0]?.webinarId ?? null;
  const [load, setLoad] = useState<LoadState>(() => (initialSimulations ? { data: initialSimulations, kind: "ready" } : { kind: "loading" }));
  const [attempt, setAttempt] = useState(0);
  const [savedSessions, setSavedSessions] = useState<Record<string, WebinarSession>>({});
  const [savedSimulations, setSavedSimulations] = useState<Record<string, SessionSimulationView>>({});
  const [savedAudiences, setSavedAudiences] = useState<Record<string, SimulationAudienceView>>({});
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [names, setNames] = useState<Record<string, string>>(deciderNames);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Cada Recarregar refaz as linhas (o formulario volta ao que esta gravado agora).
  const [reloads, setReloads] = useState(0);
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
  // A live sem a 202610300003 nao tem o que decidir (so o selo da fase 2, que a live nao tem): so o aviso da migracao.
  const rows = liveWebinar && mode === "v2" ? [] : simulated;
  const loaded = load.kind === "ready" && !load.data.pendingMigration ? new Map(load.data.simulations.map((simulation) => [simulation.sessionId, simulation])) : new Map<string, SessionSimulationView>();
  const locked = disabled || !canPublish || busy !== null || mode === "loading";

  /** O Recarregar do aviso "mudou em outro lugar": as regras de novo, a pagina de novo e as linhas refeitas. */
  function reload() {
    setFailure(null);
    setSavedSessions({});
    setSavedSimulations({});
    setSavedAudiences({});
    setReloads((value) => value + 1);
    if (!initialSimulations) {
      setLoad({ kind: "loading" });
      setAttempt((value) => value + 1);
    }
    router.refresh();
  }

  function saved(outcome: SimulationSaveOutcome) {
    const id = outcome.session.id;
    setSavedSessions((current) => ({ ...current, [id]: outcome.session }));
    if (outcome.simulation) {
      const simulation = outcome.simulation;
      setSavedSimulations((current) => ({ ...current, [id]: simulation }));
    }
    if (outcome.audience) {
      const audience = outcome.audience;
      setSavedAudiences((current) => ({ ...current, [id]: audience }));
    }
    if (outcome.session.simulationDecidedBy) {
      const deciderId = outcome.session.simulationDecidedBy;
      setNames((current) => ({ ...current, [deciderId]: outcome.deciderName }));
    }
    setVersions((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
    setFailure(null);
    adminToast.success(outcome.notice ?? (mode === "v4" ? COPY.salva : WEBINAR_ADMIN_COPY.toasts.simulationSaved));
  }

  return (
    <div className="flex min-w-0 flex-col gap-4" data-simulation-card="">
      <p className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2 text-[13px] leading-5 font-medium text-[var(--text-primary)]" data-simulation-locked-note="">
        {WEBINAR_COPY.simulacao.plateia.travados}
      </p>
      <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 text-[13px] leading-5 text-[var(--text-secondary)]">{liveWebinar ? COPY.avisoCdcLive : COPY.avisoCdc}</p>
      <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
        {liveWebinar ? COPY.numerosPadraoLive : COPY.numerosPadrao} {COPY.relatorio}
      </p>
      {!canPublish ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{liveWebinar ? ADMIN.needsPublishLive : ADMIN.needsPublish}</p> : null}
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
      {failure ? <SimulationFailureBanner failure={failure} onClose={() => setFailure(null)} onReload={reload} /> : null}
      {simulated.length === 0 ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{liveWebinar ? ADMIN.noLiveSession : ADMIN.noSessions}</p> : null}
      <ul className="flex min-w-0 flex-col gap-4">
        {rows.map((original) => {
          const session = savedSessions[original.id] ?? original;
          const decider = session.simulationDecidedBy ? (names[session.simulationDecidedBy] ?? COPY.equipe) : null;
          const version = versions[session.id] ?? 0;
          return (
            <SimulationSessionRow
              audience={savedAudiences[session.id] ?? loaded.get(session.id)?.audience ?? null}
              busy={busy === session.id}
              canPublish={canPublish}
              consoleHref={webinarConsoleHref(session.webinarId, session.id)}
              deciderName={decider}
              idBase={`${idBase}-${session.id}`}
              key={`${session.id}:${mode}:${version}:${reloads}`}
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

// Os participantes simulados mudados a qualquer momento (docs/30 D79 e D80; pedido do produtor de 11/11/2026), a parte
// pura do controle que o console (no alto da entrada Presença, aberto tambem pelo selo dos presentes) e o card
// Simulacao do editor (depois do comeco) mostram: o +N que vale agora, a rampa em curso, quem mudou por ultimo e quando,
// a lista das mudancas, o que a frase da mudanca diz alem do numero (o selo e o que continua ligado) e as contas do
// formulario (o numero digitado ou o atalho, o Aplicar so com a confirmacao, o Tirar). O servidor monta a vista
// (simulationAudienceViewOf) com o relogio da Simulacao; a tela so desenha. Sem React e com imports relativos:
// tests/webinarios-plateia-modelo.test.mjs carrega direto pelo Node. Nada daqui entra num numero real (D6, M6).

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { SIMULATION_LIMITS, type SessionSimulation, type SimulatedCountRule, type SimulationChangeRecord, type SimulationChangeSource } from "./model";
import {
  simulationAudienceExtraOf,
  simulationAudienceRampEndMs,
  simulationAudienceRuleAt,
  type SimulationAudienceFlags
} from "./simulation-model";

const COPY = WEBINAR_COPY.simulacao.plateia;

/** A migracao das mudancas (a mesma de WEBINARS_AUDIENCE_MIGRATION em db.ts, que tem "server-only"; a guarda confere). */
export const AUDIENCE_MIGRATION = "202611140002";

/** Os atalhos do controle: o numero que soma ao real (o campo fica com ele). */
export const AUDIENCE_SHORTCUTS = [50, 100, 300, 500] as const;

/** Quantas mudancas a vista leva (as mais novas); o relatorio le todas. */
export const AUDIENCE_VIEW_CHANGES = 20;

/** Uma mudanca como a tela mostra: quem (o nome), quando, de onde e o +N (nulo na faixa que varia). */
export type SimulationAudienceChangeView = {
  /** O offset do relogio da Simulacao em que vale; nulo antes do comeco. */
  atMs: number | null;
  changedAt: string;
  changedByName: string;
  extra: number | null;
  id: string;
  source: SimulationChangeSource;
};

/** O que o controle recebe do servidor (o console no retrato de 5 s; o card na leitura das regras). */
export type SimulationAudienceView = {
  /** As mudancas, as mais novas primeiro (ate AUDIENCE_VIEW_CHANGES). */
  changes: SimulationAudienceChangeView[];
  /** A regra que vale agora: "+300" (fixed), "+0" (off) ou a faixa que varia (curve, so a de antes do comeco). */
  current: SimulatedCountRule;
  /** O que a frase da mudanca diz alem do numero. */
  flags: SimulationAudienceFlags;
  /** Banco sem a 202611140002: o numero aparece, os botoes nao. */
  pendingMigration: boolean;
  /** Ate que offset a rampa da ultima mudanca anda (a sala chega no numero novo); nulo sem rampa. */
  rampEndsAtMs: number | null;
};

/**
 * A vista do controle agora (`offsetMs`: o relogio da Simulacao, simulationClockMs). A regra de agora e a da ultima
 * mudanca no ar que ja caiu, senao a da sessao (que as mudancas de antes do comeco ja trocaram).
 */
export function simulationAudienceViewOf(input: {
  flags: SimulationAudienceFlags;
  names: Readonly<Record<string, string>>;
  offsetMs: number;
  pendingMigration: boolean;
  records: readonly SimulationChangeRecord[];
  simulation: Pick<SessionSimulation, "countChanges" | "countRule">;
}): SimulationAudienceView {
  const changes = [...input.records]
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
    .slice(0, AUDIENCE_VIEW_CHANGES)
    .map((record) => ({
      atMs: record.atMs,
      changedAt: record.changedAt,
      changedByName: (record.changedBy ? input.names[record.changedBy] : null) ?? WEBINAR_COPY.simulacao.card.equipe,
      extra: simulationAudienceExtraOf(record.rule),
      id: record.id,
      source: record.source
    }));
  return {
    changes,
    current: simulationAudienceRuleAt(input.simulation, input.offsetMs),
    flags: input.flags,
    pendingMigration: input.pendingMigration,
    rampEndsAtMs: simulationAudienceRampEndMs(input.simulation, input.offsetMs)
  };
}

/** O que vale agora em texto: "+300", "+0" ou "de +50 a +300" (a faixa de antes do comeco). */
export function audienceCurrentLabel(rule: SimulatedCountRule): string {
  return rule.mode === "curve" ? COPY.faixa(rule.base, Math.max(rule.base, rule.peak)) : COPY.valor(rule.mode === "fixed" ? rule.base : 0);
}

/** Quando a mudanca vale, para a lista: o minuto do relogio da Simulacao ("12:30", "1:02:03") ou "antes do começo". */
export function audienceChangeWhen(atMs: number | null): string {
  if (atMs === null || !Number.isFinite(atMs) || atMs < 0) {
    return COPY.antes;
  }
  const total = Math.floor(atMs / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** O numero digitado (inteiro de 0 ao teto) ou nulo. */
export function audienceInputOf(text: string): number | null {
  const value = text.trim();
  if (!/^\d{1,9}$/.test(value)) {
    return null;
  }
  const number = Number(value);
  return number <= SIMULATION_LIMITS.countMax ? number : null;
}

/** O momento da sessao para o controle: antes do comeco, no ar ou encerrada (a cancelada e o Replay nao tem controle). */
export type AudiencePhase = "before" | "ended" | "on_air";

/**
 * O estado do formulario: o numero, o erro do campo e se o Aplicar liga (o numero valido, diferente do de agora, a
 * sessao de pe, com permissao e sem outra acao em andamento). Sem frase nem caixa desde 12/11/2026 (D85): o servidor
 * grava a frase da mudanca sozinho.
 */
export function audienceFormState(input: {
  busy: boolean;
  canPublish: boolean;
  current: SimulatedCountRule;
  pendingMigration: boolean;
  phase: AudiencePhase;
  text: string;
}): { canApply: boolean; canRemove: boolean; error: string | null; extra: number | null; same: boolean } {
  const extra = audienceInputOf(input.text);
  const error = input.text.trim() === "" ? null : extra === null ? COPY.numeroInvalido(SIMULATION_LIMITS.countMax) : null;
  const currentExtra = simulationAudienceExtraOf(input.current);
  const same = extra !== null && currentExtra !== null && extra === currentExtra;
  const writable = input.canPublish && !input.busy && !input.pendingMigration && input.phase !== "ended";
  return {
    canApply: writable && extra !== null && !same,
    canRemove: writable && currentExtra !== 0,
    error,
    extra,
    same
  };
}

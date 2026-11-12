// Os participantes simulados mudados a qualquer momento (docs/30 D79 e D80; pedido do produtor de 11/11/2026), a parte
// pura do controle que o console (no alto da entrada Presença, aberto tambem pelo selo dos presentes) e o card
// Simulacao do editor (depois do comeco) mostram: o +N que vale agora, a rampa em curso, quem mudou por ultimo e quando,
// a lista das mudancas, o que a frase da mudanca diz alem do numero (o selo e o que continua ligado) e as contas do
// formulario (o numero digitado ou o atalho, o Aplicar so com a confirmacao, o Tirar). O servidor monta a vista
// (simulationAudienceViewOf) com o relogio da Simulacao; a tela so desenha. Sem React e com imports relativos:
// tests/webinarios-plateia-modelo.test.mjs carrega direto pelo Node. Nada daqui entra num numero real (D6, M6).

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import {
  SIMULATION_LIMITS,
  defaultSimulatedCountVary,
  sameSimulatedCountVary,
  simulatedCountVaryOf,
  type SessionSimulation,
  type SimulatedCountRule,
  type SimulatedCountVary,
  type SimulatedCountVaryDirection,
  type SimulationChangeRecord,
  type SimulationChangeSource
} from "./model";
import {
  simulationAudienceExtraOf,
  simulationAudienceRampEndMs,
  simulationAudienceRuleAt,
  varyRange,
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
  /** O "Variar sozinho" da mudanca (D90); ausente ou nulo, o numero parado. */
  vary?: SimulatedCountVary | null;
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
      source: record.source,
      ...(simulatedCountVaryOf(record.rule) ? { vary: simulatedCountVaryOf(record.rule) } : {})
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

/* ------------------------------------------------------------------------------------------------
 * "Variar sozinho" (rodada v9, pedido do produtor de 12/11/2026; docs/30 D90)
 * ---------------------------------------------------------------------------------------------- */

/** Os campos do "Variar sozinho" (os numeros como texto enquanto a equipe digita). */
export type AudienceVaryForm = { direction: SimulatedCountVaryDirection; everyMax: string; everyMin: string; on: boolean; percent: string };

/** Os campos a partir do que vale agora: desligado, com os numeros do padrao (5 %, 20 a 60 s) prontos para ligar. */
export function audienceVaryFormOf(vary: SimulatedCountVary | null | undefined): AudienceVaryForm {
  const shown = vary ?? defaultSimulatedCountVary();
  return { direction: shown.direction, everyMax: String(shown.everyMaxSeconds), everyMin: String(shown.everyMinSeconds), on: Boolean(vary), percent: String(shown.percent) };
}

export type AudienceVaryResult = {
  errors: { everyMax?: string; everyMin?: string; percent?: string };
  /** Os campos conferem (desligado confere sempre). */
  valid: boolean;
  /** A variacao a gravar; nula desligada ou com erro. */
  vary: SimulatedCountVary | null;
};

/** Os campos de volta como a variacao, ou o erro de cada campo. Desligado: nula, sem erro. */
export function audienceVaryOfForm(form: AudienceVaryForm): AudienceVaryResult {
  if (!form.on) {
    return { errors: {}, valid: true, vary: null };
  }
  const V = COPY.variar;
  const errors: AudienceVaryResult["errors"] = {};
  const integer = (text: string) => (/^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);
  const within = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;
  const percent = integer(form.percent);
  const everyMin = integer(form.everyMin);
  const everyMax = integer(form.everyMax);
  if (!within(percent, SIMULATION_LIMITS.varyPercentMin, SIMULATION_LIMITS.varyPercentMax)) {
    errors.percent = V.percentualInvalido(SIMULATION_LIMITS.varyPercentMin, SIMULATION_LIMITS.varyPercentMax);
  }
  if (!within(everyMin, SIMULATION_LIMITS.varyEverySecondsMin, SIMULATION_LIMITS.varyEverySecondsMax)) {
    errors.everyMin = V.segundosInvalidos(SIMULATION_LIMITS.varyEverySecondsMin, SIMULATION_LIMITS.varyEverySecondsMax);
  }
  if (!within(everyMax, SIMULATION_LIMITS.varyEverySecondsMin, SIMULATION_LIMITS.varyEverySecondsMax)) {
    errors.everyMax = V.segundosInvalidos(SIMULATION_LIMITS.varyEverySecondsMin, SIMULATION_LIMITS.varyEverySecondsMax);
  } else if (!errors.everyMin && everyMax < everyMin) {
    errors.everyMax = V.ordemInvalida;
  }
  if (Object.keys(errors).length > 0) {
    return { errors, valid: false, vary: null };
  }
  return { errors, valid: true, vary: { direction: form.direction, everyMaxSeconds: everyMax, everyMinSeconds: everyMin, percent } };
}

/**
 * A frase de exemplo com os numeros da tela ("Com +300 e 5%, o número fica entre 285 e 315. Muda a cada 20 a 60 s, em
 * horas sorteadas."); sem numero maior que zero, o pedido do numero; com erro nos campos, nula (o erro ja aparece).
 */
export function audienceVaryExample(extra: number | null, form: AudienceVaryForm): string | null {
  const { vary } = audienceVaryOfForm(form);
  if (!form.on || !vary) {
    return null;
  }
  if (extra === null || !(extra > 0)) {
    return COPY.variar.exemploSemNumero;
  }
  const range = varyRange(extra, vary);
  return `${COPY.variar.exemplo(extra, vary.percent, range.min, range.max)} ${COPY.variar.ritmo(vary.everyMinSeconds, vary.everyMaxSeconds)}`;
}

/** A variacao em uma frase, para debaixo do numero de agora ("Varia sozinho até 5%, para mais e para menos, a cada 20 a 60 s."). */
export function audienceVaryLabel(vary: SimulatedCountVary | null | undefined): string | null {
  return vary ? COPY.variar.resumo(vary.percent, COPY.variar.resumoDirecoes[vary.direction], vary.everyMinSeconds, vary.everyMaxSeconds) : null;
}

/** O valor de uma linha das mudancas: "+300" ou "+300, varia até 5%" ("—" na faixa que varia). */
export function audienceChangeValue(change: Pick<SimulationAudienceChangeView, "extra" | "vary">): string {
  if (change.extra === null) {
    return "—";
  }
  return change.vary && change.extra > 0 ? `${COPY.valor(change.extra)}, ${COPY.variar.curto(change.vary.percent)}` : COPY.valor(change.extra);
}

/**
 * O estado do formulario: o numero, o erro do campo e se o Aplicar liga (o numero valido, diferente do de agora, a
 * sessao de pe, com permissao e sem outra acao em andamento). Sem frase nem caixa desde 12/11/2026 (D86): o servidor
 * grava a frase da mudanca sozinho. Com o "Variar sozinho" (D90, `vary`: os campos da tela): o que vai no pedido e
 * `applyExtra` e `vary`; o campo do numero vazio vale o numero de agora (ligar ou mudar a variacao sem digitar o
 * numero de novo), e "igual" so quando o numero e a variacao sao os de agora.
 */
export function audienceFormState(input: {
  busy: boolean;
  canPublish: boolean;
  current: SimulatedCountRule;
  pendingMigration: boolean;
  phase: AudiencePhase;
  text: string;
  vary?: AudienceVaryForm;
}): {
  /** O +N que o Aplicar manda: o digitado ou, com o campo vazio, o de agora; nulo sem numero. */
  applyExtra: number | null;
  canApply: boolean;
  canRemove: boolean;
  error: string | null;
  extra: number | null;
  same: boolean;
  /** A variacao que o Aplicar manda (nula: o numero parado). */
  vary: SimulatedCountVary | null;
  varyErrors: AudienceVaryResult["errors"];
} {
  const extra = audienceInputOf(input.text);
  const empty = input.text.trim() === "";
  const error = empty ? null : extra === null ? COPY.numeroInvalido(SIMULATION_LIMITS.countMax) : null;
  const currentExtra = simulationAudienceExtraOf(input.current);
  const currentVary = simulatedCountVaryOf(input.current);
  const form = audienceVaryOfForm(input.vary ?? audienceVaryFormOf(null));
  const applyExtra = extra !== null ? extra : empty && currentExtra !== null && currentExtra > 0 ? currentExtra : null;
  // Com o +0 a variacao nao vale: o pedido vai sem ela.
  const vary = applyExtra !== null && applyExtra > 0 ? form.vary : null;
  const sameNumber = applyExtra !== null && currentExtra !== null && applyExtra === currentExtra;
  const sameVary = sameSimulatedCountVary(vary, currentVary);
  const same = sameNumber && sameVary;
  const writable = input.canPublish && !input.busy && !input.pendingMigration && input.phase !== "ended";
  return {
    applyExtra,
    canApply: writable && applyExtra !== null && form.valid && !same,
    canRemove: writable && currentExtra !== 0,
    error,
    extra,
    // A frase "já é o de agora" so com algo digitado (o campo vazio com a variacao igual nao tem o que avisar).
    same: same && !empty,
    vary,
    varyErrors: form.errors
  };
}

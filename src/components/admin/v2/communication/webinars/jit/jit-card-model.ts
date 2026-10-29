// O "Comeca quando voce entra" no card Sessoes do editor, a parte pura (fase 4e; docs/30 §2.2, §8.6, A14, D10 e D25):
// as regras gravadas viram campos (ligado, a cada 15 / 30 / 60 min, a janela de horas de Sao Paulo, a Entrada atrasada e
// a Simulacao das sessoes que nascem ali, no mesmo formulario do card Simulacao, simulation-card-model.ts) e voltam como
// o pedido de saveJitSettings, com os erros junto de cada campo; se algo mudou; se a Simulacao pede uma decisao nova (as
// regras simuladas mudaram, ou nunca foram decididas: a caixa de §8.6 com a frase de hoje e o nome de quem esta na tela)
// ou se a decisao gravada continua valendo (a frase gravada volta como esta). Sem React e com imports relativos:
// tests/webinarios-jit-tela.test.mjs carrega direto pelo Node.

import { WEBINAR_COPY } from "../../../../../../lib/webinar-copy";
import { JIT_MESSAGES } from "../../../../../../server/webinars/jit-schemas";
import { JIT_EVERY_MINUTES, JIT_LIMITS, type JitEveryMinutes, type JitSettings } from "../../../../../../server/webinars/model";
import { normalizeSimulationRules, simulationAckFor, type SimulationRules } from "../../../../../../server/webinars/simulation-model";
import { simulationNeedsAck } from "../../../../../../server/webinars/simulation-schemas";
import { simulationFormOf, simulationRulesOfForm, type SimulationForm } from "../simulation/simulation-card-model";

const COPY = WEBINAR_COPY.jit.card;

export type JitLateJoinChoice = "always" | "until";

/** Os campos do card (os minutos da Entrada atrasada como texto enquanto a equipe digita). */
export type JitForm = {
  enabled: boolean;
  endHour: number;
  everyMinutes: JitEveryMinutes;
  lateJoin: JitLateJoinChoice;
  lateJoinMinutes: string;
  simulation: SimulationForm;
  startHour: number;
};

/** A Entrada atrasada quando a equipe troca "até o fim" por "até um minuto" sem minuto anterior. */
export const JIT_LATE_JOIN_DEFAULT = 5;

export const JIT_EVERY_OPTIONS: readonly { label: string; value: `${JitEveryMinutes}` }[] = JIT_EVERY_MINUTES.map((minutes) => ({ label: COPY.minutos(minutes), value: `${minutes}` as const }));

/** As horas do inicio (00:00 a 23:00) e do fim (01:00 a 24:00) da janela. */
export const JIT_START_HOURS: readonly number[] = Array.from({ length: JIT_LIMITS.hourMax - JIT_LIMITS.hourMin }, (_, index) => JIT_LIMITS.hourMin + index);
export const JIT_END_HOURS: readonly number[] = JIT_START_HOURS.map((hour) => hour + 1);

export function jitFormOf(settings: JitSettings): JitForm {
  const simulation = settings.simulation;
  return {
    enabled: settings.enabled,
    endHour: settings.endHour,
    everyMinutes: settings.everyMinutes,
    lateJoin: settings.lateJoinMinutes == null ? "always" : "until",
    lateJoinMinutes: settings.lateJoinMinutes == null ? "" : String(settings.lateJoinMinutes),
    simulation: simulationFormOf(simulation ? { countRule: simulation.countRule, joins: simulation.joins, saleNotices: simulation.saleNotices } : null, simulation?.showLiveBadge ?? false),
    startHour: settings.startHour
  };
}

/** O que o formulario vira (sem a decisao): as regras do horario e as da Simulacao (nulas com tudo desligado). */
export type JitFormValue = {
  enabled: boolean;
  endHour: number;
  everyMinutes: JitEveryMinutes;
  lateJoinMinutes: number | null;
  /** As regras simuladas ligadas (o selo, o contador, as entradas ou os avisos); nulas com tudo desligado. */
  rules: SimulationRules | null;
  startHour: number;
};

export type JitFormResult = { errors: Record<string, string>; value: JitFormValue | null };

/**
 * Os campos de volta, ou os erros por campo: `lateJoinMinutes`, `endHour` e os da Simulacao com o prefixo
 * `simulation.` (os mesmos nomes de simulationRulesOfForm).
 */
export function jitFormValue(form: JitForm): JitFormResult {
  const errors: Record<string, string> = {};
  let lateJoinMinutes: number | null = null;
  if (form.lateJoin === "until") {
    const text = form.lateJoinMinutes.trim();
    const minutes = /^\d{1,4}$/.test(text) ? Number(text) : Number.NaN;
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > JIT_LIMITS.lateJoinMax) {
      errors.lateJoinMinutes = WEBINAR_COPY.simulacao.card.numeroInvalido;
    } else {
      lateJoinMinutes = minutes;
    }
  }
  if (!(form.endHour > form.startHour)) {
    errors.endHour = JIT_MESSAGES.hours;
  }
  const simulation = simulationRulesOfForm(form.simulation);
  for (const [key, message] of Object.entries(simulation.errors)) {
    errors[`simulation.${key}`] = message;
  }
  if (Object.keys(errors).length > 0 || !simulation.rules) {
    return { errors, value: null };
  }
  const rules = simulationNeedsAck(simulation.rules) ? simulation.rules : null;
  return { errors: {}, value: { enabled: form.enabled, endHour: form.endHour, everyMinutes: form.everyMinutes, lateJoinMinutes, rules, startHour: form.startHour } };
}

const rulesKey = (rules: SimulationRules | null) => (rules ? JSON.stringify(normalizeSimulationRules(rules)) : "nenhuma");

/** As regras simuladas gravadas (nulas sem Simulacao ou com tudo desligado). */
export function savedJitRules(settings: JitSettings): SimulationRules | null {
  const simulation = settings.simulation;
  if (!simulation) {
    return null;
  }
  const rules = normalizeSimulationRules({ countRule: simulation.countRule, joins: simulation.joins, saleNotices: simulation.saleNotices, showLiveBadge: simulation.showLiveBadge });
  return simulationNeedsAck(rules) ? rules : null;
}

/** O formulario mudou em relacao ao gravado? Campos com erro contam como mudanca (a tela mostra o erro). */
export function jitFormChanged(form: JitForm, saved: JitSettings): boolean {
  const { value } = jitFormValue(form);
  if (!value) {
    return true;
  }
  return (
    value.enabled !== saved.enabled ||
    value.everyMinutes !== saved.everyMinutes ||
    value.startHour !== saved.startHour ||
    value.endHour !== saved.endHour ||
    value.lateJoinMinutes !== saved.lateJoinMinutes ||
    rulesKey(value.rules) !== rulesKey(savedJitRules(saved))
  );
}

/**
 * A Simulacao pede uma decisao nova (a caixa de §8.6): algo simulado ligado com regras diferentes das decididas (ou
 * nunca decididas). As mesmas regras ja decididas seguem com a decisao gravada.
 */
export function jitNeedsDecision(form: JitForm, saved: JitSettings): boolean {
  const { value } = jitFormValue(form);
  if (!value?.rules) {
    return false;
  }
  const decided = saved.simulation?.decidedAt && saved.simulation.ackText ? savedJitRules(saved) : null;
  return rulesKey(value.rules) !== rulesKey(decided);
}

/** A frase de §8.6 que a caixa confirma (a mesma do servidor: data de hoje em Sao Paulo e o nome de quem decide). */
export function jitFormSentence(form: JitForm, input: { nowMs: number; responsible: string }): string | null {
  const { value } = jitFormValue(form);
  return value?.rules ? simulationAckFor({ nowMs: input.nowMs, responsible: input.responsible, rules: value.rules }) : null;
}

export type JitSaveRequest = {
  settings: {
    enabled: boolean;
    endHour: number;
    everyMinutes: JitEveryMinutes;
    lateJoinMinutes: number | null;
    simulation: (SimulationRules & { ackText: string | null; acknowledged: boolean }) | null;
    startHour: number;
  };
  webinarId: string;
};

/**
 * O pedido de saveJitSettings: com uma decisao nova, a frase mostrada e a caixa; com a decisao gravada valendo, a frase
 * gravada de volta (o servidor guarda a decisao como estava). Nulo com erro nos campos ou com a caixa pendente.
 */
export function jitSaveRequest(form: JitForm, input: { acknowledged: boolean; saved: JitSettings; sentence: string | null; webinarId: string }): JitSaveRequest | null {
  const { value } = jitFormValue(form);
  if (!value) {
    return null;
  }
  let simulation: JitSaveRequest["settings"]["simulation"] = null;
  if (value.rules) {
    if (jitNeedsDecision(form, input.saved)) {
      if (!input.acknowledged || !input.sentence) {
        return null;
      }
      simulation = { ...value.rules, ackText: input.sentence, acknowledged: true };
    } else {
      simulation = { ...value.rules, ackText: input.saved.simulation?.ackText ?? null, acknowledged: true };
    }
  }
  return {
    settings: { enabled: value.enabled, endHour: value.endHour, everyMinutes: value.everyMinutes, lateJoinMinutes: value.lateJoinMinutes, simulation, startHour: value.startHour },
    webinarId: input.webinarId
  };
}

// O card Simulacao do editor, a parte pura (docs/30 §2.2, §4.3 e §8.6; D10): as regras gravadas de uma sessao viram
// campos de texto (numeros, minutos dos avisos) e voltam como as regras que saveSessionSimulation confere, com os erros
// em portugues junto de cada campo; se a sessao mudou em relacao ao que esta gravado (o selo ou as regras, ja
// normalizadas do mesmo jeito que o servidor grava); e a frase de §8.6 do que vai ser gravado (simulationAckFor, a
// mesma conta do servidor). O "Comeca quando voce entra" (4e) pode usar o mesmo formulario no modelo da sessao. Sem
// React e com imports relativos: tests/webinarios-simulacao-tela.test.mjs carrega direto pelo Node.

import { WEBINAR_COPY } from "../../../../../../lib/webinar-copy";
import {
  CHAT_LIMITS,
  SIMULATION_LIMITS,
  defaultSimulatedCountRule,
  defaultSimulatedJoins,
  defaultSimulatedSaleNotices,
  type SessionSimulation,
  type SimulatedCountMode,
  type SimulatedCountRule,
  type SimulatedJoins,
  type SimulatedSaleNotices
} from "../../../../../../server/webinars/model";
import { normalizeSimulationRules, simulationAckFor, type SimulationRules } from "../../../../../../server/webinars/simulation-model";
import { SIMULATION_MESSAGES, simulationRulesSchema } from "../../../../../../server/webinars/simulation-schemas";

const COPY = WEBINAR_COPY.simulacao.card;

export type SaleNoticeForm = { key: string; minute: string; text: string };

/** Os campos do card de uma sessao (numeros como texto enquanto a equipe digita). */
export type SimulationForm = {
  base: string;
  countMode: SimulatedCountMode;
  everySeconds: string;
  jitter: string;
  joinsEnabled: boolean;
  joinsMax: string;
  peak: string;
  sales: SaleNoticeForm[];
  salesEnabled: boolean;
  /** O proximo numero da chave de um aviso novo (as chaves nao mudam quando um aviso sai). */
  seq: number;
  showLiveBadge: boolean;
};

/** O que esta gravado na sessao (as regras; o selo vem da sessao). */
export type SimulationSaved = { countRule: SimulatedCountRule; joins: SimulatedJoins; saleNotices: SimulatedSaleNotices };

export type SimulationFormResult = { errors: Record<string, string>; rules: SimulationRules | null };

/** "12" (12 min) ou "12:30" (12 min 30 s). */
export function minuteMarkOf(offsetMs: number): string {
  const total = Math.max(0, Math.round(offsetMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds === 0 ? String(minutes) : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** O minuto digitado em ms do video ("12" ou "12:30"); qualquer outra coisa, nulo. */
export function minuteMarkToMs(text: string): number | null {
  const match = /^\s*(\d{1,4})(?::([0-5]\d))?\s*$/.exec(text);
  if (!match) {
    return null;
  }
  return (Number(match[1]) * 60 + Number(match[2] ?? 0)) * 1000;
}

/** As regras gravadas da sessao (nada gravado: tudo desligado) com o selo dela. */
export function savedSimulationRules(saved: SimulationSaved | null, showLiveBadge: boolean): SimulationRules {
  return normalizeSimulationRules({
    countRule: saved?.countRule ?? defaultSimulatedCountRule(),
    joins: saved?.joins ?? defaultSimulatedJoins(),
    saleNotices: saved?.saleNotices ?? defaultSimulatedSaleNotices(),
    showLiveBadge
  });
}

export function simulationFormOf(saved: SimulationSaved | null, showLiveBadge: boolean): SimulationForm {
  const count = saved?.countRule ?? defaultSimulatedCountRule();
  const joins = saved?.joins ?? defaultSimulatedJoins();
  const notices = saved?.saleNotices ?? defaultSimulatedSaleNotices();
  return {
    base: String(count.base),
    countMode: count.mode,
    everySeconds: String(joins.everySeconds),
    jitter: String(count.jitter),
    joinsEnabled: joins.enabled,
    joinsMax: String(joins.max),
    peak: String(count.mode === "fixed" ? count.base : count.peak),
    sales: notices.items.map((item, index) => ({ key: `aviso-${index}`, minute: minuteMarkOf(item.offsetMs), text: item.text })),
    salesEnabled: notices.enabled,
    seq: notices.items.length,
    showLiveBadge
  };
}

/**
 * Os campos de volta como regras (normalizadas como o servidor grava) ou os erros por campo: base, peak, jitter,
 * everySeconds, joinsMax, sales e `sales.<chave>.text` / `sales.<chave>.minute`. So o que o modo usa e conferido (um
 * contador desligado ignora os numeros; entradas e avisos desligados ignoram os campos deles).
 */
export function simulationRulesOfForm(form: SimulationForm): SimulationFormResult {
  const errors: Record<string, string> = {};
  const integer = (key: string, text: string, min: number, max: number, message: string): number => {
    const value = text.trim();
    if (!/^\d{1,9}$/.test(value)) {
      errors[key] = COPY.numeroInvalido;
      return 0;
    }
    const number = Number(value);
    if (number < min || number > max) {
      errors[key] = message;
    }
    return number;
  };

  let countRule: SimulatedCountRule = defaultSimulatedCountRule();
  if (form.countMode === "fixed") {
    const base = integer("base", form.base, 0, SIMULATION_LIMITS.countMax, SIMULATION_MESSAGES.count);
    countRule = { base, jitter: 0, mode: "fixed", peak: base };
  } else if (form.countMode === "curve") {
    const base = integer("base", form.base, 0, SIMULATION_LIMITS.countMax, SIMULATION_MESSAGES.count);
    const peak = integer("peak", form.peak, 0, SIMULATION_LIMITS.countMax, SIMULATION_MESSAGES.count);
    const jitter = integer("jitter", form.jitter, 0, SIMULATION_LIMITS.jitterMax, COPY.variacaoInvalida(SIMULATION_LIMITS.jitterMax));
    if (!errors.base && !errors.peak && peak < base) {
      errors.peak = SIMULATION_MESSAGES.peak;
    }
    countRule = { base, jitter, mode: "curve", peak };
  }

  let joins: SimulatedJoins = defaultSimulatedJoins();
  if (form.joinsEnabled) {
    const everySeconds = integer(
      "everySeconds",
      form.everySeconds,
      SIMULATION_LIMITS.joinsEverySecondsMin,
      SIMULATION_LIMITS.joinsEverySecondsMax,
      COPY.segundosInvalidos(SIMULATION_LIMITS.joinsEverySecondsMin, SIMULATION_LIMITS.joinsEverySecondsMax)
    );
    const max = integer("joinsMax", form.joinsMax, 0, SIMULATION_LIMITS.joinsMax, COPY.maximoInvalido(SIMULATION_LIMITS.joinsMax));
    joins = { enabled: true, everySeconds, max, names: "generic" };
  }

  let saleNotices: SimulatedSaleNotices = defaultSimulatedSaleNotices();
  if (form.salesEnabled) {
    if (form.sales.length > SIMULATION_LIMITS.saleNoticesMax) {
      errors.sales = SIMULATION_MESSAGES.saleTooMany;
    }
    const items = form.sales.map((item) => {
      const text = item.text.trim();
      if (text.length < 1 || text.length > SIMULATION_LIMITS.saleNoticeText) {
        errors[`sales.${item.key}.text`] = SIMULATION_MESSAGES.saleText;
      }
      const offsetMs = minuteMarkToMs(item.minute);
      if (offsetMs === null || offsetMs > CHAT_LIMITS.offsetMaxMs) {
        errors[`sales.${item.key}.minute`] = COPY.avisoMinutoInvalido;
      }
      return { offsetMs: offsetMs ?? 0, text };
    });
    saleNotices = { enabled: true, items };
  }

  if (Object.keys(errors).length > 0) {
    return { errors, rules: null };
  }
  const parsed = simulationRulesSchema.safeParse({ countRule, joins, saleNotices, showLiveBadge: form.showLiveBadge });
  if (!parsed.success) {
    return { errors: { form: parsed.error.issues[0]?.message ?? SIMULATION_MESSAGES.invalid }, rules: null };
  }
  return { errors: {}, rules: normalizeSimulationRules(parsed.data) };
}

const rulesKey = (rules: SimulationRules) => JSON.stringify(normalizeSimulationRules(rules));

/** A sessao mudou em relacao ao que esta gravado? Campos com erro contam como mudanca (a tela mostra o erro). */
export function simulationFormChanged(form: SimulationForm, saved: SimulationRules): boolean {
  const { rules } = simulationRulesOfForm(form);
  return !rules || rulesKey(rules) !== rulesKey(saved);
}

/** A frase de §8.6 do que vai ser gravado (nula enquanto ha erro nos campos). */
export function simulationFormSentence(form: SimulationForm, input: { nowMs: number; responsible: string }): string | null {
  const { rules } = simulationRulesOfForm(form);
  return rules ? simulationAckFor({ nowMs: input.nowMs, responsible: input.responsible, rules }) : null;
}

/** A dica do contador com os numeros digitados. */
export function simulationCountHint(form: SimulationForm): string {
  const number = (text: string) => (/^\d{1,9}$/.test(text.trim()) ? Number(text.trim()) : 0);
  if (form.countMode === "fixed") {
    return COPY.contadorDicas.fixed(number(form.base));
  }
  if (form.countMode === "curve") {
    return COPY.contadorDicas.curve(number(form.base), number(form.peak));
  }
  return COPY.contadorDicas.off;
}

export function addSaleNotice(form: SimulationForm): SimulationForm {
  if (form.sales.length >= SIMULATION_LIMITS.saleNoticesMax) {
    return form;
  }
  return { ...form, sales: [...form.sales, { key: `novo-${form.seq}`, minute: "", text: "" }], seq: form.seq + 1 };
}

export function removeSaleNotice(form: SimulationForm, key: string): SimulationForm {
  return { ...form, sales: form.sales.filter((item) => item.key !== key) };
}

export function updateSaleNotice(form: SimulationForm, key: string, patch: Partial<Omit<SaleNoticeForm, "key">>): SimulationForm {
  return { ...form, sales: form.sales.map((item) => (item.key === key ? { ...item, ...patch } : item)) };
}

/** O que a sessao mostrou, congelado no fim (simulation_summary), na frase do card. */
export function simulationSummaryLine(summary: SessionSimulation["summary"]): string | null {
  return summary ? COPY.congelado(summary.counterMax, summary.joinsShown, summary.saleNoticesShown) : null;
}

// Prazo de acesso (docs/05, secao "Prazo de acesso por curso e todas as formacoes"; docs/17 §1.6.10).
// Modulo puro, sem "server-only", sem banco e sem React: a venda (src/server/payments), os pacotes
// (src/server/catalog), as telas do admin e os testes carregam direto.
//
// Um prazo e "para sempre" (null) ou uma quantidade em dias, meses ou anos. O MESMO campo vale no item do
// pacote, no codigo de venda de um produto sozinho e no item "todas as formacoes".
//
// Regras, escritas uma vez:
// - o termino de uma compra = data da compra aprovada + prazo, ate o fim daquele dia no fuso da escola;
// - compra repetida SOMA: quem tem acesso aberto com data de termino fica com o termino atual + o prazo
//   comprado; quem ja venceu (ou nunca teve) conta a partir da compra; nunca encurta;
// - "para sempre" vence qualquer prazo, dos dois lados;
// - a venda desfeita (reembolso, chargeback) refaz a conta so com as compras que sobraram, na ordem em
//   que foram feitas, a partir do que o aluno tinha antes da primeira delas.

export const ACCESS_TERM_UNITS = ["days", "months", "years"] as const;
export type AccessTermUnit = (typeof ACCESS_TERM_UNITS)[number];

/** Um prazo com quantidade. "Para sempre" e `null` (o padrao, igual ao que sempre foi). */
export type AccessTerm = { amount: number; unit: AccessTermUnit };

export const ACCESS_TERM_MAX_AMOUNT = 3650;

const DAY_MS = 86_400_000;
/** Fuso da escola (America/Sao_Paulo, sem horario de verao desde 2019): o mesmo de accessEndDateToIso. */
const SCHOOL_OFFSET_MS = 3 * 3_600_000;

export function isAccessTermUnit(value: unknown): value is AccessTermUnit {
  return typeof value === "string" && (ACCESS_TERM_UNITS as readonly string[]).includes(value);
}

/** Par (unidade, quantidade) lido do banco ou de um formulario -> prazo. Qualquer coisa fora da regra = para sempre. */
export function normalizeAccessTerm(unit: unknown, amount: unknown): AccessTerm | null {
  const value = typeof amount === "string" && amount.trim() ? Number(amount) : amount;

  if (!isAccessTermUnit(unit) || typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > ACCESS_TERM_MAX_AMOUNT) {
    return null;
  }

  return { amount: value, unit };
}

export function sameAccessTerm(left: AccessTerm | null, right: AccessTerm | null) {
  return left === null || right === null ? left === right : left.amount === right.amount && left.unit === right.unit;
}

const UNIT_WORDS: Record<AccessTermUnit, readonly [string, string]> = {
  days: ["dia", "dias"],
  months: ["mês", "meses"],
  years: ["ano", "anos"]
};

/** "1 ano", "6 meses", "30 dias". */
export function accessTermAmountLabel(term: AccessTerm) {
  return `${term.amount} ${UNIT_WORDS[term.unit][term.amount === 1 ? 0 : 1]}`;
}

/** A frase do produtor: "Para sempre", "Por 1 ano", "Por 6 meses", "Por 30 dias". */
export function accessTermLabel(term: AccessTerm | null) {
  return term ? `Por ${accessTermAmountLabel(term)}` : "Para sempre";
}

/** Prazos prontos do seletor; o resto entra por "Outro prazo". */
export const ACCESS_TERM_PRESETS: readonly (AccessTerm | null)[] = [
  null,
  { amount: 30, unit: "days" },
  { amount: 3, unit: "months" },
  { amount: 6, unit: "months" },
  { amount: 1, unit: "years" },
  { amount: 2, unit: "years" }
];

export function isAccessTermPreset(term: AccessTerm | null) {
  return ACCESS_TERM_PRESETS.some((preset) => sameAccessTerm(preset, term));
}

/** Chave de texto de um prazo ("" = para sempre; "years:1"), para o valor de um <select> e para comparar formularios. */
export function accessTermKey(term: AccessTerm | null) {
  return term ? `${term.unit}:${term.amount}` : "";
}

export function accessTermFromKey(key: string): AccessTerm | null {
  const [unit, amount] = key.split(":");

  return normalizeAccessTerm(unit, amount);
}

/**
 * Soma o prazo a um instante. Dias sao 24 h; meses e anos andam no calendario do fuso da escola e, quando
 * o dia nao existe no mes de chegada (31 de janeiro + 1 mes), param no ultimo dia dele.
 */
export function addAccessTerm(fromMs: number, term: AccessTerm): number {
  if (term.unit === "days") {
    return fromMs + term.amount * DAY_MS;
  }

  const local = new Date(fromMs - SCHOOL_OFFSET_MS);
  const months = local.getUTCMonth() + (term.unit === "years" ? term.amount * 12 : term.amount);
  const year = local.getUTCFullYear() + Math.floor(months / 12);
  const month = months % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const moved = Date.UTC(
    year,
    month,
    Math.min(local.getUTCDate(), lastDay),
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
    local.getUTCMilliseconds()
  );

  return moved + SCHOOL_OFFSET_MS;
}

/** O ultimo milissegundo daquele dia no fuso da escola (23:59:59.999). */
export function endOfSchoolDay(ms: number): number {
  const local = ms - SCHOOL_OFFSET_MS;

  return local - (((local % DAY_MS) + DAY_MS) % DAY_MS) + DAY_MS - 1 + SCHOOL_OFFSET_MS;
}

/** Termino de quem compra sem ter acesso aberto: a compra + o prazo, ate o fim daquele dia. `null` = para sempre. */
export function accessEndFromPurchase(purchasedAt: number, term: AccessTerm | null): string | null {
  return term ? new Date(endOfSchoolDay(addAccessTerm(purchasedAt, term))).toISOString() : null;
}

function parseEnd(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? null : parsed;
}

/** Dois terminos sao o mesmo instante? (`null` = para sempre). */
export function sameAccessEnd(left: string | null, right: string | null) {
  return left === null || right === null ? left === right : parseEnd(left) === parseEnd(right);
}

/** O maior dos dois terminos; "para sempre" vence. */
export function maxAccessEnd(left: string | null, right: string | null): string | null {
  if (left === null || right === null) {
    return null;
  }

  return (parseEnd(left) ?? 0) >= (parseEnd(right) ?? 0) ? left : right;
}

/**
 * O termino depois de UMA compra (a regra da soma):
 * - prazo "para sempre" -> para sempre;
 * - acesso aberto sem data (ja era para sempre) -> continua para sempre;
 * - acesso aberto com data depois da compra -> termino atual + prazo;
 * - sem acesso aberto (nunca teve, venceu, revogado, suspenso) -> compra + prazo.
 */
export function nextAccessEndOnSale(input: { currentEndsAt: string | null; purchasedAt: number; term: AccessTerm | null; wasOpen: boolean }): string | null {
  if (!input.term) {
    return null;
  }

  if (input.wasOpen && input.currentEndsAt === null) {
    return null;
  }

  const current = input.wasOpen ? parseEnd(input.currentEndsAt) : null;

  if (current !== null && current > input.purchasedAt) {
    return new Date(addAccessTerm(current, input.term)).toISOString();
  }

  return accessEndFromPurchase(input.purchasedAt, input.term);
}

/** O acesso antes de uma compra: fechado (nunca teve, venceu, foi tirado) ou aberto ate `endsAt` (`null` = para sempre). */
export type AccessBeforeSale = { endsAt: string | null; open: true } | { open: false };

export type SaleTermStep = { purchasedAt: number; term: AccessTerm | null };

/**
 * Refaz a conta do termino: a partir do que o aluno tinha (`base`), aplica cada compra na ordem em que foi
 * feita. Devolve o termino final e, para cada compra, o que havia logo antes dela (o "termino de antes").
 */
export function replaySaleTerms(base: AccessBeforeSale, steps: readonly SaleTermStep[]): { before: AccessBeforeSale[]; endsAt: string | null; open: boolean } {
  let state: AccessBeforeSale = base;
  const before: AccessBeforeSale[] = [];

  for (const step of [...steps].sort((left, right) => left.purchasedAt - right.purchasedAt)) {
    // Aberto na hora da compra: sem data, ou com data depois dela.
    const end = state.open ? parseEnd(state.endsAt) : null;
    const wasOpen = state.open && (state.endsAt === null || (end !== null && end > step.purchasedAt));

    before.push(wasOpen ? state : { open: false });
    state = {
      endsAt: nextAccessEndOnSale({ currentEndsAt: state.open ? state.endsAt : null, purchasedAt: step.purchasedAt, term: step.term, wasOpen }),
      open: true
    };
  }

  return state.open ? { before, endsAt: state.endsAt, open: true } : { before, endsAt: null, open: false };
}

/** O maior de dois prazos ("para sempre" vence); usado quando o mesmo produto aparece duas vezes na mesma compra. */
export function longerAccessTerm(left: AccessTerm | null, right: AccessTerm | null): AccessTerm | null {
  if (left === null || right === null) {
    return null;
  }

  return addAccessTerm(0, left) >= addAccessTerm(0, right) ? left : right;
}

const schoolDateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo", year: "numeric" });

/** "31/12/2027" no fuso da escola; "" quando a data nao e valida. */
export function formatAccessDate(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;

  return Number.isNaN(parsed) ? "" : schoolDateFormatter.format(new Date(parsed));
}

/** A frase do aluno no curso vencido. */
export function accessEndedLabel(endsAt: string) {
  const date = formatAccessDate(endsAt);

  return date ? `Seu acesso terminou em ${date}` : "Seu acesso terminou";
}

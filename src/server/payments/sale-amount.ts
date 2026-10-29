// O valor de uma venda (docs/30 M8, fase 4b): o que a plataforma manda (numero ou texto decimal, com virgula ou ponto)
// vira centavos inteiros sem passar por conta de ponto flutuante (o texto do numero e lido digito a digito), e a moeda
// vira o codigo ISO 4217 em maiusculas de 3 letras. O que nao der para ler com certeza vira null (o webhook grava a
// venda sem o valor; o relatorio mostra "—"). Modulo puro, sem "server-only": os adaptadores (hotmart.ts, ticto.ts), o
// store do webhook e os testes carregam direto. O valor so vai para webhook_events.amount_cents/currency (a receita dos
// webinarios); nunca decide acesso (process-sale.ts nao le).

import type { SaleAmount } from "./types";

/** O teto do check webhook_events_amount_cents_v4 (migracao 202610300003): 1 bilhao na moeda, em centavos. */
export const MAX_SALE_AMOUNT_CENTS = 100_000_000_000;

/** Digitos da parte inteira aceitos (1 bilhao tem 10; o resto e lixo ou outra unidade). */
const MAX_INTEGER_DIGITS = 12;
const CURRENCY_CODE = /^[A-Za-z]{3}$/;

function countOf(text: string, char: string) {
  return text.split(char).length - 1;
}

/** "1.234.567" (grupos de 3 depois do primeiro) -> "1234567"; grupo fora do formato -> null. */
function groupedInteger(raw: string, separator: "," | "." | null) {
  if (!separator || !raw.includes(separator)) {
    return /^\d+$/.test(raw) ? raw : null;
  }

  const groups = raw.split(separator);
  const [first, ...rest] = groups;

  if (!/^\d{1,3}$/.test(first) || rest.some((group) => !/^\d{3}$/.test(group))) {
    return null;
  }

  return groups.join("");
}

/**
 * Parte inteira e fracao (so digitos) -> centavos: as duas primeiras casas da fracao, arredondando pela terceira (meio
 * para cima). Parte inteira longa demais ou acima do teto -> null.
 */
function centsOfParts(integer: string, fraction: string): number | null {
  const trimmed = integer.replace(/^0+(?=\d)/, "");

  if (!/^\d+$/.test(trimmed) || !/^\d*$/.test(fraction) || trimmed.length > MAX_INTEGER_DIGITS) {
    return null;
  }

  const padded = `${fraction}000`;
  const cents = Number(trimmed) * 100 + Number(padded.slice(0, 2)) + (Number(padded[2]) >= 5 ? 1 : 0);

  return Number.isSafeInteger(cents) && cents <= MAX_SALE_AMOUNT_CENTS ? cents : null;
}

/**
 * Texto decimal da plataforma -> centavos. Aceita "1500", "1500.5", "1500,50", "1.500,50", "1,500.50" e "1.234.567"
 * (com os dois separadores, o ultimo e o decimal; com um so repetido, e o de milhar). Um separador so seguido de
 * exatamente 3 digitos ("1.500") e ambiguo (mil e quinhentos ou um e meio): null, nunca um chute. Negativo, vazio,
 * letras e moeda no texto ("R$ 10") tambem sao null.
 */
export function saleAmountCentsOfText(value: string): number | null {
  const text = value.trim().replace(/[\s ]/g, "").replace(/^\+/, "");

  if (!/^\d[\d.,]*$/.test(text) || /[.,]$/.test(text)) {
    return null;
  }

  const dots = countOf(text, ".");
  const commas = countOf(text, ",");

  if (dots > 0 && commas > 0) {
    const decimal = text.lastIndexOf(".") > text.lastIndexOf(",") ? "." : ",";

    if (countOf(text, decimal) !== 1) {
      return null;
    }

    const [integerPart, fraction] = text.split(decimal);
    const integer = groupedInteger(integerPart, decimal === "." ? "," : ".");

    return integer === null ? null : centsOfParts(integer, fraction);
  }

  if (dots + commas === 0) {
    return centsOfParts(text, "");
  }

  const separator = dots > 0 ? "." : ",";
  const parts = text.split(separator);

  if (parts.length > 2) {
    const integer = groupedInteger(text, separator);

    return integer === null ? null : centsOfParts(integer, "");
  }

  return parts[1].length === 3 ? null : centsOfParts(parts[0], parts[1]);
}

/**
 * Numero do JSON (na unidade da moeda: 1500 = mil e quinhentos; 97.9 = noventa e sete e noventa) -> centavos, pelo
 * texto do numero (o ponto e sempre o decimal), nunca por `valor * 100`. Fracao menor que 1 milionesimo (notacao
 * cientifica) vale 0; acima do teto, negativo ou nao finito -> null.
 */
export function saleAmountCentsOfNumber(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }

  const text = String(value);

  if (/e/i.test(text)) {
    return value < 1 ? 0 : null;
  }

  const [integer, fraction = ""] = text.split(".");

  return centsOfParts(integer, fraction);
}

/** Numero ou texto decimal na unidade da moeda -> centavos; o resto (null, objeto, booleano) -> null. */
export function saleAmountCents(value: unknown): number | null {
  if (typeof value === "number") {
    return saleAmountCentsOfNumber(value);
  }

  return typeof value === "string" ? saleAmountCentsOfText(value) : null;
}

/** "brl" / " USD " -> "BRL" / "USD"; qualquer outra coisa (simbolo, nome, 2 ou 4 letras) -> null. */
export function saleCurrencyCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  return CURRENCY_CODE.test(text) ? text.toUpperCase() : null;
}

function isMissing(value: unknown) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/**
 * O valor da venda a partir do que a plataforma mandou: `cents` ja lido (saleAmountCents ou a regra da plataforma) e a
 * moeda. Moeda ausente usa `defaultCurrency` (a Ticto vende em reais); moeda presente e invalida, ou sem moeda e sem
 * padrao, ou centavos ilegiveis -> null.
 */
export function saleAmountOf(input: { cents: number | null; currency: unknown; defaultCurrency?: string }): SaleAmount | null {
  if (input.cents === null || !Number.isSafeInteger(input.cents) || input.cents < 0 || input.cents > MAX_SALE_AMOUNT_CENTS) {
    return null;
  }

  const currency = isMissing(input.currency) ? saleCurrencyCode(input.defaultCurrency) : saleCurrencyCode(input.currency);

  return currency ? { cents: input.cents, currency } : null;
}

/**
 * As colunas de webhook_events para o valor (amount_cents + currency), so quando o valor passa nos checks da migracao
 * 202610300003; senao null (a venda e gravada sem as colunas, que ficam nulas).
 */
export function saleAmountColumns(amount: SaleAmount | null | undefined): { amount_cents: number; currency: string } | null {
  const valid = amount ? saleAmountOf({ cents: amount.cents, currency: amount.currency }) : null;

  return valid ? { amount_cents: valid.cents, currency: valid.currency } : null;
}

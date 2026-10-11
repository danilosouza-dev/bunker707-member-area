// Regras puras da aba Aulas (duvidas e avaliacao por aula). Sem React: tests/community-queue.test.mjs
// carrega este arquivo direto.

import { RATING_MIN_RESPONSES_FOR_ACTION } from "../../../../server/community/model";
import { LESSON_ROWS_SORT_PARAMS } from "../../../../server/community/schemas";

export type RatingCounts = { liked: number; loved: number; notForMe: number };

export type RatingSegment = {
  count: number;
  key: keyof RatingCounts;
  label: string;
  /** Largura em %, inteira; as tres somam 100 quando ha respostas. */
  percent: number;
};

const SEGMENT_ORDER: { key: keyof RatingCounts; label: string }[] = [
  { key: "notForMe", label: "Não gostei" },
  { key: "liked", label: "Gostei" },
  { key: "loved", label: "Amei" }
];

/**
 * Partes da barra 100 % (Não gostei · Gostei · Amei). Arredonda pelo maior resto para a soma dar
 * exatamente 100; sem respostas, tudo 0.
 */
export function ratingSegments(counts: RatingCounts): RatingSegment[] {
  const total = counts.notForMe + counts.liked + counts.loved;

  if (total <= 0) {
    return SEGMENT_ORDER.map(({ key, label }) => ({ count: 0, key, label, percent: 0 }));
  }

  const raw = SEGMENT_ORDER.map(({ key, label }) => {
    const exact = (counts[key] / total) * 100;

    return { count: counts[key], exact, key, label, percent: Math.floor(exact) };
  });
  let missing = 100 - raw.reduce((sum, part) => sum + part.percent, 0);

  for (const part of [...raw].sort((left, right) => right.exact - right.percent - (left.exact - left.percent))) {
    if (missing <= 0) {
      break;
    }

    part.percent += 1;
    missing -= 1;
  }

  return raw.map(({ count, key, label, percent }) => ({ count, key, label, percent }));
}

export type RatingTone = "positive" | "negative" | "neutral" | "insufficient" | "none";

/**
 * Tom do saldo: so pede atencao (positivo/negativo) com respostas suficientes (docs/17 §1.11:
 * agir quando negativo com 20 ou mais respostas). Saldo entre -10 % e +10 % e neutro.
 */
export function ratingTone(balance: number | null, total: number): RatingTone {
  if (balance === null || total <= 0) {
    return "none";
  }

  if (total < RATING_MIN_RESPONSES_FOR_ACTION) {
    return "insufficient";
  }

  if (balance <= -0.1) {
    return "negative";
  }

  return balance >= 0.1 ? "positive" : "neutral";
}

export const LESSON_ROWS_SORT_OPTIONS = [
  { label: "Mais dúvidas", sort: "doubts", value: null },
  { label: "Piores avaliações", sort: "worst", value: LESSON_ROWS_SORT_PARAMS.worst },
  { label: "Melhores avaliações", sort: "best", value: LESSON_ROWS_SORT_PARAMS.best }
] as const;

/** Texto acessivel da avaliacao: "Não gostei 3, Gostei 10, Amei 25 (38 respostas)". */
export function describeRatings(counts: RatingCounts) {
  const total = counts.notForMe + counts.liked + counts.loved;

  if (total === 0) {
    return "Sem avaliações";
  }

  return `Não gostei ${counts.notForMe}, Gostei ${counts.liked}, Amei ${counts.loved} (${total} ${total === 1 ? "resposta" : "respostas"})`;
}

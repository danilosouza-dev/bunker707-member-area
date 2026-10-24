// "No primeiro acesso" do pop-up (Comunicacao v3b-2, docs/29 §4.3): quem conta como aluno novo, decidido no
// recalculo do segmento (dispatch.refreshPopupDeliveries, a cada 15 min e ao publicar), nunca pelo navegador.
// - "A primeira vez na área" (accessProducts vazio): quem ainda nao entrou nenhuma vez ou ganhou a conta depois
//   do comeco do pop-up;
// - "A primeira vez com estes produtos": quem tem acesso aberto a um deles (ou a plataforma inteira) e ganhou
//   esse acesso depois do comeco do pop-up, ou nunca entrou. Os acessos dos fatos ja sao so os abertos: quem
//   perde o acesso (reembolso, cancelamento, fim) deixa de ver.
// A linha habilitada pelo recalculo novo leva a marca campaign_deliveries.first_access_at: so ela continua
// elegivel depois de o aluno entrar na area (last_sign_in_at muda a cada login). Linha elegivel sem a marca e
// sem ser candidato (a de um app sem esta regra, que le first_login como page_load) sai.
// A edicao do pop-up no ar (saveNoticeDraft) tambem decide aqui: a regra dos 500 conta o segmento inteiro
// (liveEditCountsSegment) e mudar so os produtos ou o "Começa" pede o recalculo do minuto seguinte
// (firstAccessRecalcNeeded).
// Modulo puro: sem "server-only", imports relativos; tests/pop-ups-v3b2-modelo.test.mjs carrega direto pelo Node.

import type { AudienceStudentFacts } from "./audience-model";
import { canonicalProductIds, type PopupTrigger } from "./popup-display-model";

/**
 * Num pop-up que ja foi ao ar (sent_at), trocar de ou para "No primeiro acesso" e recusado (D8): "Vezes que
 * apareceu" e o relatorio misturariam dois momentos num pop-up so. 400 em popup.trigger (actions.ts).
 */
export const FIRST_ACCESS_SWITCH_MESSAGE = "Num pop-up que já foi ao ar, não dá para trocar de ou para “No primeiro acesso”. Duplique o pop-up.";

/** A troca de momento que o pop-up que ja foi ao ar nao aceita: de ou para first_login. */
export function switchesFirstAccess(stored: string, next: string | undefined): boolean {
  return (stored === "first_login") !== (next === "first_login");
}

/**
 * A regra dos 500 na edicao do pop-up no ar ou pausado (saveNoticeDraft): conta o segmento de novo quando ele
 * mudou e, em "No primeiro acesso", sempre. Nesse momento a contagem gravada (audience_count) e a dos
 * candidatos e mantidos (docs/29 §4.2), em geral pequena; publicar e retomar contam o segmento inteiro, e a
 * edicao ao vivo (ex.: passar para "A primeira vez na área" num segmento de 3.000) tem de contar igual.
 */
export function liveEditCountsSegment(input: { audienceChanged: boolean; trigger: PopupTrigger }): boolean {
  return input.audienceChanged || input.trigger === "first_login";
}

/**
 * Mudar so os produtos ou o "Começa" de um "No primeiro acesso" no ar ou pausado muda quem e aluno novo sem
 * mudar o segmento, e o recalculo da hora so roda quando o segmento muda. Nesse caso a hora do ultimo
 * recalculo e apagada (audience_refreshed_at = null) e o job do minuto seguinte refaz (fetchPopupsToRefresh:
 * nulo sempre vence, fora das faixas de :07/:22/:37/:52). Com o segmento mudado, o recalculo ja roda na hora.
 */
export function firstAccessRecalcNeeded(input: {
  audienceChanged: boolean;
  current: { accessProducts: readonly string[]; startsAt: string | null };
  next: { accessProducts: readonly string[]; startsAt: string | null };
  trigger: PopupTrigger;
}): boolean {
  if (input.audienceChanged || input.trigger !== "first_login") {
    return false;
  }

  const sameProducts = canonicalProductIds(input.current.accessProducts).join(" ") === canonicalProductIds(input.next.accessProducts).join(" ");

  return !sameProducts || timeOf(input.current.startsAt) !== timeOf(input.next.startsAt);
}

export type FirstAccessFacts = Pick<AudienceStudentFacts, "accesses" | "lastSignInAt" | "userId"> & { createdAt?: number | null };

/** Acesso a plataforma inteira: vale para qualquer lista de produtos (como a regra access_gained dos fluxos). */
const PLATFORM_ACCESS_ID = "platform";

function timeOf(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const time = Date.parse(value);

  return Number.isFinite(time) ? time : null;
}

/** O comeco do pop-up para o primeiro acesso: starts_at, senao a publicacao (sent_at), senao a criacao. */
export function firstAccessSince(row: { created_at: string | null; sent_at: string | null; starts_at: string | null }): number {
  return timeOf(row.starts_at) ?? timeOf(row.sent_at) ?? timeOf(row.created_at) ?? 0;
}

function countsFor(productId: string, accessProducts: readonly string[]) {
  return productId === PLATFORM_ACCESS_ID || accessProducts.includes(productId);
}

/** Tem acesso aberto a um destes produtos (ou a plataforma inteira)? Os acessos dos fatos ja sao so os abertos. */
export function hasOpenAccessToAny(facts: Pick<FirstAccessFacts, "accesses">, accessProducts: readonly string[]): boolean {
  return facts.accesses.some((access) => countsFor(access.productId, accessProducts));
}

/**
 * O aluno conta como primeiro acesso deste pop-up agora?
 * - [] ("A primeira vez na área"): nunca entrou (lastSignInAt null) ou a conta foi criada em `since` ou depois;
 * - ids ("A primeira vez com estes produtos"): tem acesso aberto a um deles (ou a plataforma inteira) e
 *   (nunca entrou ou ganhou esse acesso em `since` ou depois; gainedAt = greatest(created_at, starts_at)).
 */
export function isFirstAccessCandidate(facts: FirstAccessFacts, accessProducts: readonly string[], since: number): boolean {
  const neverEntered = facts.lastSignInAt === null;

  if (accessProducts.length === 0) {
    return neverEntered || (typeof facts.createdAt === "number" && facts.createdAt >= since);
  }

  return facts.accesses.some((access) => countsFor(access.productId, accessProducts) && (neverEntered || (access.gainedAt ?? access.startsAt) >= since));
}

/**
 * O recalculo do pop-up "No primeiro acesso" (D8): fica elegivel quem e candidato (no segmento) e quem ja tinha a
 * marca do recalculo novo e continua no segmento (em "estes produtos", tambem com acesso aberto a um deles ou a
 * plataforma). Linha elegivel sem marca e sem ser candidato sai (a de um app sem esta regra). audienceCount =
 * elegiveis depois.
 */
export function firstAccessDeliveryChanges(input: {
  /** Quem esta no segmento agora (resolveAudienceUserIds). */
  audience: ReadonlySet<string>;
  /** Candidatos no segmento (isFirstAccessCandidate). */
  candidates: ReadonlySet<string>;
  /** As linhas de hoje (fetchFirstAccessDeliveries). */
  current: ReadonlyMap<string, { eligible: boolean; marked: boolean }>;
  /** "Estes produtos": quem tem acesso aberto a um deles ou a plataforma (em memoria, dos fatos); null = "A primeira vez na área". */
  withAccess: ReadonlySet<string> | null;
}): { audienceCount: number; toDisable: string[]; toMark: string[] } {
  const { audience, candidates, current, withAccess } = input;
  const keep = (userId: string) => {
    const row = current.get(userId);

    return row !== undefined && row.eligible && row.marked && audience.has(userId) && (withAccess === null || withAccess.has(userId));
  };
  const toMark: string[] = [];
  const toDisable: string[] = [];
  const eligibleAfter = new Set<string>();

  for (const userId of candidates) {
    const row = current.get(userId);

    eligibleAfter.add(userId);

    if (!row || !row.eligible || !row.marked) {
      toMark.push(userId);
    }
  }

  for (const [userId, row] of current) {
    if (!row.eligible || candidates.has(userId)) {
      continue;
    }

    if (keep(userId)) {
      eligibleAfter.add(userId);
    } else {
      toDisable.push(userId);
    }
  }

  return { audienceCount: eligibleAfter.size, toDisable: toDisable.sort(), toMark: toMark.sort() };
}

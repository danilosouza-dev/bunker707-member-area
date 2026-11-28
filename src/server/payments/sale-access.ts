// O que UMA venda faz com UM acesso (docs/05, secao "Prazo de acesso por curso e todas as formacoes").
// Modulo puro, sem "server-only" e sem banco: a venda (process-sale.ts), a concessao de "todas as
// formacoes" (all-formations.ts) e os testes carregam direto.
//
// A venda abre o acesso (nao existia, venceu, foi tirado) ou soma prazo a um acesso aberto. O plano diz
// o termino novo e o que vai para o vinculo da venda com o acesso (sale_grants): se abriu, que termino
// havia antes, que prazo a venda deu e a data da compra. A mesma venda processada de novo (reprocesso
// depois de uma falha no meio, reenvio da plataforma) nunca soma duas vezes: o vinculo ja gravado manda.

import { accessEndFromPurchase, maxAccessEnd, nextAccessEndOnSale, normalizeAccessTerm, type AccessTerm } from "../access/access-term";

export type SaleRef = { provider: string; transactionId: string };

type AccessRowLike = {
  ends_at: string | null;
  source_event_id: string | null;
  source_provider: string;
  starts_at: string;
  status: string;
};

type SaleGrantSnapshot = {
  closed_at: string | null;
  created_at: string;
  opened: boolean;
  previous_ends_at: string | null;
  purchased_at?: string | null;
  term_amount?: number | null;
  term_unit?: string | null;
};

/** O acesso nasceu desta compra? (mesma plataforma; a transacao, ou a transacao com o sufixo do produto). */
export function entitlementBelongsToTransaction(row: Pick<AccessRowLike, "source_event_id" | "source_provider">, sale: SaleRef) {
  if (row.source_provider !== sale.provider) {
    return false;
  }

  return row.source_event_id === sale.transactionId || Boolean(row.source_event_id?.startsWith(`${sale.transactionId}:`));
}

/** Acesso que libera conteudo agora: ativo, ja comecou e nao venceu (a mesma regra de isAccessOpen). */
export function isAccessRowOpen(row: Pick<AccessRowLike, "ends_at" | "starts_at" | "status">, now: number) {
  if (row.status !== "active") {
    return false;
  }

  const startsAt = Date.parse(row.starts_at);

  if (!Number.isNaN(startsAt) && startsAt > now) {
    return false;
  }

  if (row.ends_at === null) {
    return true;
  }

  const endsAt = Date.parse(row.ends_at);

  return Number.isNaN(endsAt) || endsAt > now;
}

export type SaleAccessPlan = {
  /** O termino do acesso depois desta venda (`null` = para sempre). */
  endsAt: string | null;
  /** A venda abriu o acesso (true) ou so somou prazo a um acesso aberto (false). */
  opened: boolean;
  /** O termino que o acesso tinha antes (so quando somou): o reembolso devolve. */
  previousEndsAt: string | null;
  /** Data da compra aprovada (ISO), de onde o prazo conta. */
  purchasedAt: string;
  term: AccessTerm | null;
};

export function planSaleAccess(input: {
  /**
   * Termino ja decidido, no lugar da soma: a formacao publicada depois entra com o mesmo termino da
   * concessao "todas as formacoes" (nunca encurta um acesso aberto). Ausente = a regra da soma.
   */
  fixedEndsAt?: string | null;
  now: number;
  /** O acesso como esta agora; `null` = o aluno nunca teve. */
  previous: AccessRowLike | null;
  purchasedAt: number;
  sale: SaleRef;
  /** O vinculo desta venda com este acesso, se ja existe (reprocesso). */
  saleGrant?: SaleGrantSnapshot | null;
  term: AccessTerm | null;
}): SaleAccessPlan {
  const { previous } = input;
  const wasOpen = previous ? isAccessRowOpen(previous, input.now) : false;
  const ownedBySale = previous ? entitlementBelongsToTransaction(previous, input.sale) : false;
  // A venda ja contou neste acesso numa tentativa anterior: vale o que ela gravou (o prazo e a data de entao).
  const applied = input.saleGrant && input.saleGrant.closed_at === null ? input.saleGrant : null;
  const term = applied ? normalizeAccessTerm(applied.term_unit, applied.term_amount) : input.term;
  const appliedAt = applied ? Date.parse(applied.purchased_at ?? applied.created_at) : Number.NaN;
  const purchasedAt = Number.isNaN(appliedAt) ? input.purchasedAt : appliedAt;
  const opened = applied ? applied.opened : !wasOpen || ownedBySale;
  const previousEndsAt = applied ? applied.previous_ends_at : wasOpen && !ownedBySale ? (previous?.ends_at ?? null) : null;
  const repeated = Boolean(applied) || ownedBySale;
  let endsAt: string | null;

  if (input.fixedEndsAt !== undefined) {
    endsAt = wasOpen ? maxAccessEnd(previous?.ends_at ?? null, input.fixedEndsAt) : input.fixedEndsAt;
  } else {
    const target = opened
      ? accessEndFromPurchase(purchasedAt, term)
      : nextAccessEndOnSale({ currentEndsAt: previousEndsAt, purchasedAt, term, wasOpen: true });

    // A mesma venda de novo nunca soma duas vezes nem encurta o que outra compra somou depois.
    endsAt = repeated && wasOpen ? maxAccessEnd(previous?.ends_at ?? null, target) : target;
  }

  return { endsAt, opened, previousEndsAt, purchasedAt: new Date(purchasedAt).toISOString(), term };
}

/**
 * A data da compra aprovada de um evento, de onde o prazo conta: a da compra; na reativacao de uma
 * assinatura (sem pagamento novo), quando ela aconteceu. Nunca no futuro; sem data legivel, agora.
 */
export function salePurchasedAt(event: { occurredAt: string | null; purchasedAt: string | null; reactivatesSubscription?: boolean }, now: number) {
  const candidates = event.reactivatesSubscription ? [event.occurredAt] : [event.purchasedAt, event.occurredAt];

  for (const candidate of candidates) {
    const parsed = candidate ? Date.parse(candidate) : Number.NaN;

    if (!Number.isNaN(parsed)) {
      return Math.min(parsed, now);
    }
  }

  return now;
}

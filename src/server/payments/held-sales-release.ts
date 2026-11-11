import "server-only";

// A liberacao das vendas guardadas (docs/32 §2.2 e §11.3, "Venda guardada"), a rodada da tarefa do tick
// `vendas-guardadas` (src/server/jobs/held-sales-job.ts):
//
// - modo "off" (a nossa escola hoje, a dev, a Vercel e os testes): nao faz nada; nem le o banco;
// - modo "enforce": uma consulta por minuto as vendas guardadas (a mais antiga primeiro; indice parcial). Sem nenhuma,
//   termina. Com alguma, pergunta a licenca (a mesma pergunta da venda: a classe matricula passa?). Barrada, so garante
//   o e-mail da equipe do episodio (a segunda chance, se a fila falhou na hora da venda) e termina;
// - liberada (a licenca voltou a permitir acesso novo: renovada, ativada, de volta ao endereco), libera em ordem
//   (held_at, id), ate HELD_SALES_PER_ROUND por rodada e dentro de HELD_SALES_ROUND_BUDGET_MS. Cada venda e reivindicada
//   antes (update condicional em claimed_at): duas rodadas ao mesmo tempo nunca liberam a mesma venda. A liberacao e a
//   regra de acesso de sempre (process-sale.ts, com `release`): a conta nasce agora, com as boas-vindas e o e-mail de
//   compra de sempre, e o acesso conta a partir de agora. A compra reembolsada no meio (o evento de reembolso ja gravado)
//   nao libera nada. O resultado vai para o evento de compra (a lista Vendas recebidas) e para a venda guardada, so com a
//   reivindicacao desta rodada;
// - a venda que falha (erro do banco ou do Auth) solta a reivindicacao, conta a tentativa e guarda o motivo, e a
//   seguinte continua: uma venda com problema nunca segura as outras. Ela volta na rodada seguinte, de novo a primeira.
// Os logs levam so ids, contagens e motivos, nunca o comprador.

import type { LicensingMode } from "@/server/licensing/build-config";
import type { LicenseState } from "@/server/licensing/state";
import { getPaymentAdapter } from "./adapters";
import {
  HELD_SALES_PER_ROUND,
  HELD_SALES_ROUND_BUDGET_MS,
  HELD_SALE_CLAIM_STALE_MS,
  HELD_SALE_MAX_ATTEMPTS,
  heldSaleGaveUpDetail,
  heldSaleNotReleasedDetail,
  heldSaleReleasedDetail,
  newAccessDecisionOf
} from "./held-sales-model";
import { notifyHeldSalesEpisodeSafely } from "./held-sales-notice";
import {
  HELD_SALES_MIGRATION,
  claimHeldSale,
  failHeldSaleAttempt,
  finishHeldSale,
  isHeldSalesSchemaMissing,
  listPendingHeldSales,
  type HeldSaleRow
} from "./held-sales-store";
import { processSaleEvent, type SaleProcessingResult } from "./process-sale";
import { fetchWebhookEvent, updateWebhookEventResult, type SalesDb, type WebhookEventResultPatch, type WebhookEventRow } from "./store";

export type HeldSalesRoundDeps = {
  db: SalesDb;
  mode: LicensingMode;
  /** A situacao da licenca agora (readCurrentLicenseState: nunca lanca; null quando a leitura falha). */
  readLicense: () => Promise<LicenseState | null>;
  /** O endereco configurado da escola: os links dos e-mails de boas-vindas, de compra e da equipe. */
  configuredHost: () => string | null;
  now?: () => Date;
  /** O prazo do tick. */
  signal?: AbortSignal;
  budgetMs?: number;
  perRound?: number;
};

export type HeldSalesRoundResult =
  | { mode: "off" }
  | {
      mode: "enforce";
      /** Banco sem a migracao 202611110002: nada a fazer (nenhuma venda pode estar guardada sem a tabela). */
      missingMigration: boolean;
      /** Quantas vendas guardadas a rodada viu (ate o teto da rodada). */
      pending: number;
      /** A licenca ainda barra o acesso novo: nada foi liberado. */
      blocked: boolean;
      granted: number;
      /** Liberacoes que nao deram acesso (reembolso no meio, produto que saiu, dados apagados): saem da lista. */
      discarded: number;
      /** Liberacoes que falharam (voltam na rodada seguinte). */
      failed: number;
      /** Vendas que outra rodada reivindicou antes (ou que sairam da lista no meio). */
      contended: number;
    };

/** O resultado no evento de compra: liberada, ou o motivo de nao liberar (a venda em parte mantem o que ja tinha). */
function eventPatchOf(event: WebhookEventRow, result: SaleProcessingResult, releasedAt: Date): WebhookEventResultPatch {
  if (result.outcome === "access_granted") {
    return {
      comboId: result.comboId ?? event.combo_id,
      outcome: "access_granted",
      outcomeDetail: heldSaleReleasedDetail({ detail: result.detail, releasedAt }),
      processingStatus: "processed",
      productId: result.productId ?? event.product_id,
      userId: result.userId ?? event.user_id
    };
  }

  const detail = heldSaleNotReleasedDetail(result.detail);

  // A venda em parte: o que foi liberado na hora da venda continua dito no evento.
  if (event.outcome !== "held") {
    return {
      comboId: event.combo_id,
      outcome: event.outcome ?? "access_granted",
      outcomeDetail: `${event.outcome_detail ?? ""} ${detail}`.trim(),
      processingStatus: "processed",
      productId: event.product_id,
      userId: event.user_id
    };
  }

  // A venda inteira que nao pode ser liberada fica como as ignoradas de sempre: o dono corrige (o codigo, o pacote) e
  // usa Reprocessar.
  return {
    comboId: result.comboId ?? event.combo_id,
    outcome: "ignored",
    outcomeDetail: detail,
    processingStatus: "ignored",
    productId: result.productId ?? event.product_id,
    userId: result.userId ?? event.user_id
  };
}

type ReleaseOutcome = "granted" | "discarded" | "contended";

/** Libera uma venda ja reivindicada pela regra de acesso de sempre e grava o resultado. Lanca so em erro de verdade. */
async function releaseHeldSale(db: SalesDb, row: HeldSaleRow, claim: string, input: { now: Date; siteOrigin: string | null }): Promise<ReleaseOutcome> {
  const finish = async (status: "granted" | "discarded", resolution: string): Promise<ReleaseOutcome> =>
    (await finishHeldSale(db, { claim, id: row.id, resolution, status })) ? status : "contended";

  const event = await fetchWebhookEvent(db, row.webhook_event_id);

  if (!event) {
    return finish("discarded", "O evento da compra não existe mais; a venda não pode ser liberada.");
  }

  // A retencao de 12 meses ou a exclusao do aluno ja apagaram o comprador: nao ha a quem liberar.
  if (event.anonymized_at) {
    return finish("discarded", "Os dados da compra já foram apagados (12 meses ou exclusão do aluno); a venda não pode ser liberada.");
  }

  const normalized = getPaymentAdapter(event.provider)?.normalize(event.payload) ?? null;

  if (!normalized || normalized.type !== "purchase_approved") {
    return finish("discarded", "Não foi possível ler a compra guardada; a venda não pode ser liberada. Libere o acesso à mão em Alunos se for o caso.");
  }

  const result = await processSaleEvent(db, {
    event: normalized,
    release: { productIds: row.product_ids },
    siteOrigin: input.siteOrigin,
    webhookEventId: event.id
  });

  await updateWebhookEventResult(db, event.id, eventPatchOf(event, result, input.now));

  return result.outcome === "access_granted"
    ? finish("granted", heldSaleReleasedDetail({ detail: result.detail, releasedAt: input.now }))
    : finish("discarded", heldSaleNotReleasedDetail(result.detail));
}

/**
 * A liberacao falhou HELD_SALE_MAX_ATTEMPTS vezes: a venda sai da lista e o evento de compra vira erro na lista Vendas
 * recebidas, com o motivo e o Reprocessar (a venda em parte mantem o que ja tinha e ganha a frase). Nunca lanca.
 */
async function giveUpHeldSale(db: SalesDb, row: HeldSaleRow, claim: string, message: string) {
  const attempts = row.attempts + 1;
  const detail = heldSaleGaveUpDetail({ attempts, error: message });

  try {
    if (!(await finishHeldSale(db, { claim, id: row.id, resolution: detail, status: "discarded" }))) {
      return;
    }

    const event = await fetchWebhookEvent(db, row.webhook_event_id);

    if (!event) {
      return;
    }

    await updateWebhookEventResult(
      db,
      event.id,
      event.outcome === "held"
        ? { comboId: event.combo_id, errorMessage: detail, outcome: "failed", outcomeDetail: null, processingStatus: "failed", productId: event.product_id, userId: event.user_id }
        : {
            comboId: event.combo_id,
            outcome: event.outcome ?? "access_granted",
            outcomeDetail: `${event.outcome_detail ?? ""} ${detail}`.trim(),
            processingStatus: "processed",
            productId: event.product_id,
            userId: event.user_id
          }
    );
  } catch (error) {
    console.error(`[vendas] venda guardada ${row.id} nao encerrada depois de ${attempts} tentativas: ${error instanceof Error ? error.message : "erro desconhecido"}`);
  }
}

function originOf(host: string | null): string | null {
  if (!host) {
    return null;
  }

  try {
    const url = new URL(/^https?:\/\//i.test(host) ? host : `https://${host}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

export async function runHeldSalesRound(deps: HeldSalesRoundDeps): Promise<HeldSalesRoundResult> {
  if (deps.mode !== "enforce") {
    return { mode: "off" };
  }

  const now = deps.now ?? (() => new Date());
  const startedAt = Date.now();
  const budgetMs = deps.budgetMs ?? HELD_SALES_ROUND_BUDGET_MS;
  const result = { blocked: false, contended: 0, discarded: 0, failed: 0, granted: 0, missingMigration: false, mode: "enforce" as const, pending: 0 };
  let pending: HeldSaleRow[];

  try {
    pending = await listPendingHeldSales(deps.db, deps.perRound ?? HELD_SALES_PER_ROUND);
  } catch (error) {
    if (isHeldSalesSchemaMissing(error)) {
      return { ...result, missingMigration: true };
    }

    throw error;
  }

  result.pending = pending.length;

  if (pending.length === 0) {
    return result;
  }

  const license = await deps.readLicense();
  const decision = newAccessDecisionOf(license);

  if (!decision.allowed) {
    // Ainda barrada: nada e liberado. O e-mail do episodio (uma vez por pessoa, pela chave da fila) e a segunda chance
    // do que a venda tentou na hora.
    await notifyHeldSalesEpisodeSafely(deps.db, { configuredHost: deps.configuredHost(), now: now(), reason: decision.reason, state: license });
    return { ...result, blocked: true };
  }

  const siteOrigin = originOf(deps.configuredHost());

  for (const row of pending) {
    if (deps.signal?.aborted || Date.now() - startedAt > budgetMs) {
      break;
    }

    const claim = await claimHeldSale(deps.db, { id: row.id, now: now(), staleAfterMs: HELD_SALE_CLAIM_STALE_MS });

    if (!claim) {
      result.contended += 1;
      continue;
    }

    try {
      const outcome = await releaseHeldSale(deps.db, row, claim, { now: now(), siteOrigin });

      if (outcome === "granted") {
        result.granted += 1;
      } else if (outcome === "discarded") {
        result.discarded += 1;
      } else {
        result.contended += 1;
      }
    } catch (error) {
      result.failed += 1;
      const message = error instanceof Error ? error.message : "erro desconhecido";
      console.error(`[vendas] venda guardada ${row.id} nao liberada (tentativa ${row.attempts + 1}): ${message}`);

      if (row.attempts + 1 >= HELD_SALE_MAX_ATTEMPTS) {
        await giveUpHeldSale(deps.db, row, claim, message);
      } else {
        await failHeldSaleAttempt(deps.db, { attempts: row.attempts, claim, error: message, id: row.id });
      }
    }
  }

  return result;
}

export { HELD_SALES_MIGRATION };

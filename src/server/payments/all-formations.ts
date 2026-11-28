import "server-only";

// "Todas as formacoes (as de hoje e as que vierem)" (docs/05, secao "Prazo de acesso por curso e todas as
// formacoes"; docs/17 §1.6.10; migracao 202611280001).
//
// Os acessos continuam em entitlements, a unica verdade. A tabela all_formations_grants so diz quem tem
// direito as formacoes que forem publicadas depois, ate quando, de que venda veio e com que turma:
// - na venda (process-sale.ts), cada formacao publicada vira um acesso com vinculo da venda (sale_grants),
//   como qualquer produto de pacote, e a concessao e gravada aqui (recordAllFormationsGrant);
// - ao publicar uma formacao (product-actions.ts) e na tarefa do tick `todas-as-formacoes` (rede de
//   seguranca), materializeAllFormations da a formacao nova a quem tem a concessao aberta, com o MESMO
//   termino dela, e grava o vinculo com a mesma compra;
// - reembolso, chargeback e cancelamento fecham a concessao (closeAllFormationsGrantsOfSale) e, pelos
//   vinculos da compra, tiram o que ela abriu sem tirar o que o aluno tem por outra compra (a regra de
//   sempre, decideEntitlementAfterSale).
// So formacoes (kind = Formacao): mentorias, bootcamps, cursos avulsos e outros tipos nunca entram.
// A formacao que a equipe tirou de um aluno nao volta sozinha: ela ja esta em formation_ids.

import { replaySaleTerms, sameAccessEnd, normalizeAccessTerm, type AccessTerm } from "@/server/access/access-term";
import { isMissingSchemaObjectError, toDbError } from "@/server/db/pending-migration";
import { LicenseRestrictionError } from "@/server/licensing/require-feature";
import { grantProductAccess } from "@/server/students/access";
import { findEntitlementForTarget, type StudentsDb } from "@/server/students/store";
import { planSaleAccess } from "./sale-access";
import { fetchSaleGrantsByTransaction, insertSaleGrants, type SalesDb } from "./store";
import type { SalesProvider } from "./types";

export const ALL_FORMATIONS_MIGRATION = "202611280001";

/** O rotulo do item especial do pacote, igual na tela, no detalhe da venda e nos documentos. */
export const ALL_FORMATIONS_LABEL = "Todas as formações (as de hoje e as que vierem)";

const GRANT_COLUMNS =
  "id,user_id,provider,transaction_id,subscription_code,webhook_event_id,combo_id,cohort_name,term_unit,term_amount,purchased_at,ends_at,status,closed_at,closed_by,formation_ids,created_at";

export type AllFormationsGrantRow = {
  closed_at: string | null;
  closed_by: "refund" | "chargeback" | "subscription_canceled" | "admin" | null;
  cohort_name: string | null;
  combo_id: string | null;
  created_at: string;
  ends_at: string | null;
  formation_ids: string[] | null;
  id: string;
  provider: SalesProvider;
  purchased_at: string;
  status: "active" | "closed";
  subscription_code: string | null;
  term_amount: number | null;
  term_unit: string | null;
  transaction_id: string;
  user_id: string;
  webhook_event_id: string | null;
};

type DbError = { code?: string | null; hint?: string | null; message: string } | null;

function failOnError(error: DbError, context: string) {
  if (error) {
    throw toDbError(error, context);
  }
}

/** As formacoes publicadas e vendidas como produto: o que "todas as formacoes" abre hoje. */
export async function fetchPublishedFormationIds(db: SalesDb): Promise<string[]> {
  const { data, error } = await db
    .from("content_items")
    .select("id")
    .eq("kind", "Formacao")
    .eq("commerce_scope", "sellable_product")
    .eq("publication_status", "published")
    .order("id", { ascending: true });
  failOnError(error, "Formações publicadas");

  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

async function fetchGrantsOfUser(db: SalesDb, userId: string): Promise<AllFormationsGrantRow[]> {
  const { data, error } = await db.from("all_formations_grants").select(GRANT_COLUMNS).eq("user_id", userId).order("purchased_at", { ascending: true });
  failOnError(error, "Acesso a todas as formações");

  return (data ?? []) as AllFormationsGrantRow[];
}

function termStepOf(grant: Pick<AllFormationsGrantRow, "purchased_at" | "term_amount" | "term_unit">) {
  return { purchasedAt: Date.parse(grant.purchased_at), term: normalizeAccessTerm(grant.term_unit, grant.term_amount) };
}

/**
 * O termino do aluno em "todas as formacoes" e um so: a soma das concessoes abertas dele, na ordem das
 * compras (a mesma regra da compra repetida). Todas as concessoes abertas guardam esse termino; a conta
 * e refeita quando uma entra, sai ou volta.
 */
async function syncEffectiveEnd(db: SalesDb, userId: string): Promise<string | null> {
  const active = (await fetchGrantsOfUser(db, userId)).filter((grant) => grant.status === "active");

  if (active.length === 0) {
    return null;
  }

  const effective = replaySaleTerms({ open: false }, active.map(termStepOf)).endsAt;

  for (const grant of active) {
    if (!sameAccessEnd(grant.ends_at, effective)) {
      const { error } = await db.from("all_formations_grants").update({ ends_at: effective }).eq("id", grant.id);
      failOnError(error, "Término do acesso a todas as formações");
    }
  }

  return effective;
}

export type RecordAllFormationsGrantInput = {
  cohortName: string | null;
  comboId: string | null;
  /** As formacoes publicadas na hora da compra (a venda ja cuida do acesso de cada uma). */
  formationIds: readonly string[];
  provider: SalesProvider;
  /** Data da compra aprovada (ms), de onde o prazo conta. */
  purchasedAt: number;
  /** Reativacao da assinatura (Ticto: uncanceled): reabre a concessao que o cancelamento fechou. */
  reactivates?: boolean;
  subscriptionCode: string | null;
  term: AccessTerm | null;
  transactionId: string;
  userId: string;
  webhookEventId: string | null;
};

/**
 * Grava a concessao da venda (uma por compra e aluno; a mesma compra de novo nao cria outra). Concessao
 * fechada por reembolso, chargeback ou pela equipe nao reabre; a fechada pelo cancelamento da assinatura
 * so reabre na reativacao. Devolve o termino do aluno em "todas as formacoes" depois dela.
 */
export async function recordAllFormationsGrant(db: SalesDb, input: RecordAllFormationsGrantInput): Promise<{ created: boolean; endsAt: string | null }> {
  const grants = await fetchGrantsOfUser(db, input.userId);
  const existing = grants.find((grant) => grant.provider === input.provider && grant.transaction_id === input.transactionId);
  let created = false;

  if (!existing) {
    // A concessao ja nasce com o termino certo (a soma com as outras abertas do aluno): uma falha logo depois nunca
    // deixa uma concessao com prazo valendo para sempre.
    const endsAt = replaySaleTerms({ open: false }, [
      ...grants.filter((grant) => grant.status === "active").map(termStepOf),
      { purchasedAt: input.purchasedAt, term: input.term }
    ]).endsAt;
    const { error } = await db.from("all_formations_grants").insert({
      cohort_name: input.cohortName?.trim() ? input.cohortName.trim().slice(0, 80) : null,
      combo_id: input.comboId,
      ends_at: endsAt,
      formation_ids: Array.from(new Set(input.formationIds)),
      provider: input.provider,
      purchased_at: new Date(input.purchasedAt).toISOString(),
      status: "active",
      subscription_code: input.subscriptionCode,
      term_amount: input.term?.amount ?? null,
      term_unit: input.term?.unit ?? null,
      transaction_id: input.transactionId,
      user_id: input.userId,
      webhook_event_id: input.webhookEventId
    });

    // Outra entrega do mesmo evento gravou primeiro: a concessao ja existe.
    if (error?.code !== "23505") {
      failOnError(error, "Registrar o acesso a todas as formações");
      created = true;
    }
  } else if (existing.status === "closed" && existing.closed_by === "subscription_canceled" && input.reactivates) {
    const { error } = await db
      .from("all_formations_grants")
      .update({ closed_at: null, closed_by: null, purchased_at: new Date(input.purchasedAt).toISOString(), status: "active" })
      .eq("id", existing.id);
    failOnError(error, "Reabrir o acesso a todas as formações");
  }

  return { created, endsAt: await syncEffectiveEnd(db, input.userId) };
}

/**
 * Reembolso, chargeback ou assinatura cancelada: fecha as concessoes da compra (ou da assinatura) e refaz
 * o termino das que sobraram do mesmo aluno. Os acessos sao decididos pelos vinculos da venda, em
 * process-sale.ts. Devolve quantas fechou.
 */
export async function closeAllFormationsGrantsOfSale(
  db: SalesDb,
  input: { closedBy: "refund" | "chargeback" | "subscription_canceled"; provider: SalesProvider; subscriptionCode: string | null; transactionId: string | null }
): Promise<number> {
  const found = new Map<string, AllFormationsGrantRow>();

  for (const [column, value] of [
    ["transaction_id", input.transactionId],
    ["subscription_code", input.subscriptionCode]
  ] as const) {
    if (!value) {
      continue;
    }

    const { data, error } = await db.from("all_formations_grants").select(GRANT_COLUMNS).eq("provider", input.provider).eq(column, value).eq("status", "active");
    failOnError(error, "Acesso a todas as formações da compra");

    for (const grant of (data ?? []) as AllFormationsGrantRow[]) {
      found.set(grant.id, grant);
    }
  }

  if (found.size === 0) {
    return 0;
  }

  const { error } = await db
    .from("all_formations_grants")
    .update({ closed_at: new Date().toISOString(), closed_by: input.closedBy, status: "closed" })
    .in("id", [...found.keys()])
    .eq("status", "active");
  failOnError(error, "Fechar o acesso a todas as formações");

  for (const userId of new Set([...found.values()].map((grant) => grant.user_id))) {
    await syncEffectiveEnd(db, userId);
  }

  return found.size;
}

/* ------------------------------------------------------------------------------------------------
 * Formacao publicada depois: entra sozinha para quem tem a concessao aberta
 * ---------------------------------------------------------------------------------------------- */

/** Quantas (concessao, formacao) uma rodada resolve; o resto fica para a rodada seguinte. */
export const ALL_FORMATIONS_PER_ROUND = 40;

export type MaterializeAllFormationsResult = {
  /** Acessos abertos (ou estendidos) nesta rodada. */
  granted: number;
  /** Pares que falharam (voltam na rodada seguinte). */
  failed: number;
  /** Concessoes abertas vistas. */
  grants: number;
  /** Banco sem a migracao 202611280001: nada a fazer. */
  missingMigration: boolean;
  /** Pares que ficaram para a proxima rodada (teto, tempo, ou a licenca barrando acesso novo). */
  pending: number;
};

/**
 * Da as formacoes publicadas que faltam a quem tem "todas as formacoes" valendo. Sem concessao aberta,
 * uma consulta e nada mais. Cada formacao entra com o termino da concessao, com vinculo da mesma compra
 * (o reembolso dela tira) e sem e-mail de compra. `formationIds` restringe a rodada (a formacao que
 * acabou de ser publicada).
 */
export async function materializeAllFormations(
  db: SalesDb,
  input: { budgetMs?: number; formationIds?: readonly string[]; limit?: number; now?: Date; signal?: AbortSignal } = {}
): Promise<MaterializeAllFormationsResult> {
  const now = input.now ?? new Date();
  const result: MaterializeAllFormationsResult = { failed: 0, granted: 0, grants: 0, missingMigration: false, pending: 0 };
  const { data, error } = await db
    .from("all_formations_grants")
    .select(GRANT_COLUMNS)
    .eq("status", "active")
    .or(`ends_at.is.null,ends_at.gt.${now.toISOString()}`)
    .order("purchased_at", { ascending: true });

  if (error && isMissingSchemaObjectError(error)) {
    return { ...result, missingMigration: true };
  }

  failOnError(error, "Acesso a todas as formações");

  const grants = (data ?? []) as AllFormationsGrantRow[];
  result.grants = grants.length;

  if (grants.length === 0) {
    return result;
  }

  const published = await fetchPublishedFormationIds(db);
  const wanted = input.formationIds ? published.filter((id) => input.formationIds?.includes(id)) : published;
  const limit = input.limit ?? ALL_FORMATIONS_PER_ROUND;
  const deadline = input.budgetMs ? Date.now() + input.budgetMs : null;
  let handled = 0;

  for (const grant of grants) {
    const known = new Set(grant.formation_ids ?? []);
    const missing = wanted.filter((id) => !known.has(id));

    for (const formationId of missing) {
      if (handled >= limit || input.signal?.aborted || (deadline !== null && Date.now() > deadline)) {
        result.pending += 1;
        continue;
      }

      handled += 1;

      try {
        await grantFormationOfGrant(db, grant, formationId, now.getTime());
        known.add(formationId);
        const { error: updateError } = await db.from("all_formations_grants").update({ formation_ids: [...known] }).eq("id", grant.id);
        failOnError(updateError, "Formações do acesso a todas as formações");
        result.granted += 1;
      } catch (grantError) {
        // A licenca nao permite acesso novo agora (produto licenciado): fica para quando permitir.
        if (grantError instanceof LicenseRestrictionError) {
          result.pending += 1;
          continue;
        }

        result.failed += 1;
        console.error(`[vendas] todas as formacoes: a formacao ${formationId} nao entrou na concessao ${grant.id}: ${grantError instanceof Error ? grantError.message : String(grantError)}`);
      }
    }
  }

  return result;
}

/** UMA formacao para UMA concessao: o acesso com o termino dela e o vinculo com a mesma compra. */
async function grantFormationOfGrant(db: SalesDb, grant: AllFormationsGrantRow, formationId: string, now: number) {
  const studentsDb = db as StudentsDb;
  const sale = { provider: grant.provider, transactionId: grant.transaction_id };
  const previous = await findEntitlementForTarget(studentsDb, grant.user_id, "formation", formationId);
  const saleGrant = previous ? (await fetchSaleGrantsByTransaction(db, grant.provider, grant.transaction_id)).find((row) => row.entitlement_id === previous.id) : undefined;
  const plan = planSaleAccess({
    fixedEndsAt: grant.ends_at,
    now,
    previous,
    purchasedAt: Date.parse(grant.purchased_at),
    sale,
    saleGrant,
    term: normalizeAccessTerm(grant.term_unit, grant.term_amount)
  });
  const saleGrantFor = (entitlementId: string) => ({
    entitlementId,
    opened: plan.opened,
    previousEndsAt: plan.previousEndsAt,
    productId: formationId,
    provider: grant.provider,
    purchasedAt: plan.purchasedAt,
    subscriptionCode: grant.subscription_code,
    term: plan.term,
    transactionId: grant.transaction_id,
    userId: grant.user_id,
    webhookEventId: grant.webhook_event_id
  });

  // Acesso que ja existe ganha o vinculo ANTES (a mesma ordem da venda): a falha no meio nao perde o termino de antes.
  if (previous) {
    await insertSaleGrants(db, [saleGrantFor(previous.id)]);
  }

  const granted = await grantProductAccess(
    {
      actorId: null,
      endsAt: null,
      productIds: [formationId],
      saleEndsAtByProduct: { [formationId]: plan.endsAt },
      skipPurchaseEmail: true,
      source: "webhook",
      sourceEventId: grant.transaction_id,
      sourceEventPerProduct: true,
      sourceProvider: grant.provider,
      userId: grant.user_id
    },
    studentsDb
  );
  const row = granted.granted.find((candidate) => candidate.target_id === formationId);

  if (!row) {
    throw new Error("a formação não existe mais no catálogo");
  }

  if (!previous) {
    await insertSaleGrants(db, [saleGrantFor(row.id)]);
  }
}

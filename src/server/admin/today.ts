import "server-only";

// Leituras da tela Hoje (docs/17 §1.5) e dos contadores do menu do admin.
//
// - Cartoes de atencao: admin_today_alerts (migracao 202610120001) para perguntas atrasadas e acessos
//   terminando; admin_product_list(p_status => 'published') (202610110011) para "produto publicado sem aula".
// - Novos acessos: admin_access_buckets (202610120001), uma chamada para o periodo e outra para o anterior.
// - Por produto: a mesma lista de publicados, os de mais alunos com acesso primeiro.
// Cada parte falha sozinha: sem a migracao, a parte mostra o aviso; com erro, "Tentar de novo"; as outras
// continuam. Leituras memoizadas por requisicao (React.cache): o layout (contadores do menu) e a pagina
// compartilham a mesma consulta.

import { cache } from "react";
import {
  buildAttentionCards,
  compressSeries,
  fillBucketSeries,
  formatCheckTime,
  isAttentionComplete,
  listProductsWithoutLessons,
  selectByProductRows,
  sumSeries,
  type BucketRow,
  type TodayAccessKpiState,
  type TodayAccessOrigin,
  type TodayAttentionState,
  type TodayByProductState,
  type TodayProductStat
} from "@/components/admin/v2/today/today-model";
import { listAdminPeriodBuckets, type AdminPeriodGranularity, type ResolvedAdminPeriod } from "@/components/admin/v2/period";
import { mapProductListRow, type ProductListRpcRow } from "@/server/catalog/mappers";
import { countOverdueQuestions } from "@/server/community/counts";
import { isPendingMigrationError, toDbError } from "@/server/db/pending-migration";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";

export const TODAY_MIGRATION = "202610120001";

export type TodayAlertSummary = { attentionCount: number; overdueQuestions: number };

type Settled<T> = { data: T; ok: true } | { ok: false; pendingMigration: boolean };

async function settle<T>(context: string, load: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { data: await load(), ok: true };
  } catch (error) {
    const pendingMigration = isPendingMigrationError(error);

    if (pendingMigration) {
      console.error(`[admin] Hoje (${context}): migracao pendente:`, error instanceof Error ? error.message : error);
    } else {
      console.error(`[admin] Hoje (${context}):`, error instanceof Error ? error.message : error);
    }

    return { ok: false, pendingMigration };
  }
}

function toCount(value: unknown) {
  const number = typeof value === "string" ? Number(value) : value;

  return typeof number === "number" && Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

/* ------------------------------------------------------------------------------------------------
 * Leituras
 * ---------------------------------------------------------------------------------------------- */

type AlertCounts = { expiringAccesses: number | null; overdueQuestions: number | null; pendingMigration: boolean };

/** Perguntas atrasadas e acessos terminando. Sem a migracao: perguntas pelo contador da Comunidade (sem filtro). */
const readAlertCounts = cache(async (productId: string | null): Promise<AlertCounts> => {
  const { data, error } = await getSupabaseAdminClient().rpc("admin_today_alerts", { p_content_id: productId });

  if (!error) {
    const row = (Array.isArray(data) ? data[0] : data) as { expiring_accesses?: unknown; overdue_questions?: unknown } | null;

    return {
      expiringAccesses: toCount(row?.expiring_accesses),
      overdueQuestions: toCount(row?.overdue_questions),
      pendingMigration: false
    };
  }

  const dbError = toDbError(error, "Hoje: cartões de atenção");

  if (!isPendingMigrationError(dbError)) {
    throw dbError;
  }

  // O contador da Comunidade (202610110020) nao filtra por produto: com produto escolhido, fica sem numero.
  const fallback = productId ? null : await settle("perguntas atrasadas", countOverdueQuestions);

  return {
    expiringAccesses: null,
    overdueQuestions: fallback?.ok ? fallback.data : null,
    pendingMigration: true
  };
});

const PRODUCT_PAGE_SIZE = 100;
const MAX_PRODUCT_PAGES = 20;

function toProductStat(row: ProductListRpcRow): TodayProductStat | null {
  const item = mapProductListRow(row);

  return item
    ? {
        accent: item.accent,
        coverUrl: item.coverUrl,
        formatLabel: item.formatLabel,
        id: item.id,
        lessonsPublished: item.lessonsPublished,
        studentsWithAccess: item.studentsWithAccess,
        title: item.title
      }
    : null;
}

/** Produtos publicados com aulas publicadas e alunos com acesso agora (paginas de 100). */
const readPublishedProducts = cache(async (): Promise<TodayProductStat[]> => {
  const db = getSupabaseAdminClient();
  const stats: TodayProductStat[] = [];

  for (let page = 0; page < MAX_PRODUCT_PAGES; page += 1) {
    const { data, error } = await db.rpc("admin_product_list", {
      p_kinds: null,
      p_limit: PRODUCT_PAGE_SIZE,
      p_offset: page * PRODUCT_PAGE_SIZE,
      p_search: null,
      p_status: "published"
    });

    if (error) {
      throw toDbError(error, "Hoje: produtos publicados");
    }

    const rows = (data ?? []) as ProductListRpcRow[];

    for (const row of rows) {
      const stat = toProductStat(row);

      if (stat) {
        stats.push(stat);
      }
    }

    if (rows.length < PRODUCT_PAGE_SIZE) {
      break;
    }
  }

  return stats;
});

/** Acessos criados em [start, end), por balde. Janela vazia (hoje as 00:00 em ponto) = nenhuma linha. */
async function readAccessBuckets(
  window: { end: Date; start: Date },
  granularity: AdminPeriodGranularity,
  productId: string | null
): Promise<BucketRow[]> {
  if (window.end.getTime() <= window.start.getTime()) {
    return [];
  }

  const { data, error } = await getSupabaseAdminClient().rpc("admin_access_buckets", {
    p_content_id: productId,
    p_end: window.end.toISOString(),
    p_granularity: granularity,
    p_start: window.start.toISOString()
  });

  if (error) {
    throw toDbError(error, "Hoje: novos acessos");
  }

  return (data ?? []) as BucketRow[];
}

/** Acessos criados em [start, end) por origem (admin_access_origins, 202610170003). Janela vazia = nada. */
async function readAccessOrigins(window: { end: Date; start: Date }, productId: string | null): Promise<TodayAccessOrigin[]> {
  if (window.end.getTime() <= window.start.getTime()) {
    return [];
  }

  const { data, error } = await getSupabaseAdminClient().rpc("admin_access_origins", {
    p_content_id: productId,
    p_end: window.end.toISOString(),
    p_start: window.start.toISOString()
  });

  if (error) {
    throw toDbError(error, "Hoje: origem dos acessos");
  }

  return ((data ?? []) as { source_provider: string | null; total: unknown }[]).map((row) => ({
    provider: row.source_provider ?? "manual",
    total: toCount(row.total)
  }));
}

/* ------------------------------------------------------------------------------------------------
 * Partes da tela
 * ---------------------------------------------------------------------------------------------- */

async function readAttentionInput(productId: string | null) {
  const [counts, products] = await Promise.all([
    settle("cartões de atenção", () => readAlertCounts(productId)),
    settle("produtos publicados", readPublishedProducts)
  ]);

  if (!counts.ok && !counts.pendingMigration) {
    return null;
  }

  return {
    input: {
      expiringAccesses: counts.ok ? counts.data.expiringAccesses : null,
      overdueQuestions: counts.ok ? counts.data.overdueQuestions : null,
      productId,
      productsWithoutLessons: products.ok ? listProductsWithoutLessons(products.data) : null
    },
    pendingMigration: (counts.ok && counts.data.pendingMigration) || !counts.ok || (!products.ok && products.pendingMigration),
    productsFailed: !products.ok && !products.pendingMigration
  };
}

export async function readTodayAttention(productId: string | null, now: Date): Promise<TodayAttentionState> {
  const result = await readAttentionInput(productId);

  if (!result || result.productsFailed) {
    return { status: "error" };
  }

  return {
    cards: buildAttentionCards(result.input),
    checkedAt: formatCheckTime(now),
    complete: isAttentionComplete(result.input),
    pendingMigration: result.pendingMigration,
    status: "ready"
  };
}

export async function readTodayNewAccesses(resolved: ResolvedAdminPeriod, productId: string | null): Promise<TodayAccessKpiState> {
  const result = await settle("novos acessos", () =>
    Promise.all([
      readAccessBuckets(resolved, resolved.granularity, productId),
      readAccessBuckets(resolved.previous, "day", productId)
    ])
  );

  if (!result.ok) {
    return { status: result.pendingMigration ? "pending-migration" : "error" };
  }

  const [currentRows, previousRows] = result.data;
  const series = fillBucketSeries(listAdminPeriodBuckets(resolved), currentRows);
  // A origem e um detalhe do rodape: sem a migracao 202610170003 (ou com erro), o numero segue sem ela.
  const origins = await settle("origem dos acessos", () => readAccessOrigins(resolved, productId));

  return {
    origins: origins.ok ? origins.data : [],
    previousTotal: sumSeries(previousRows.map((row) => toCount(row.total))),
    series: compressSeries(series),
    status: "ready",
    // O total vem das linhas (contagem exata da janela), nao da serie desenhada.
    total: sumSeries(currentRows.map((row) => toCount(row.total)))
  };
}

export async function readTodayByProduct(resolved: ResolvedAdminPeriod, productId: string | null): Promise<TodayByProductState> {
  const products = await settle("por produto", readPublishedProducts);

  if (!products.ok) {
    return { status: products.pendingMigration ? "pending-migration" : "error" };
  }

  return {
    rows: selectByProductRows(products.data, productId, { periodParam: resolved.isDefault ? null : resolved.param }),
    status: "ready"
  };
}

/**
 * Contadores do menu (layout do admin): Hoje = numero de cartoes de atencao (sem filtro de produto);
 * Comunidade = perguntas sem resposta ha mais de 24 h. null quando nada pode ser lido (o menu fica sem contador).
 */
export async function readTodayAlertSummary(): Promise<TodayAlertSummary | null> {
  try {
    const result = await readAttentionInput(null);

    if (!result) {
      return null;
    }

    return {
      attentionCount: buildAttentionCards(result.input).length,
      overdueQuestions: result.input.overdueQuestions ?? 0
    };
  } catch (error) {
    console.error("[admin] Contadores do menu:", error instanceof Error ? error.message : error);
    return null;
  }
}

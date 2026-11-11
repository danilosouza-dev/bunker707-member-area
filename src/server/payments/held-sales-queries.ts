import "server-only";

// Leituras das vendas guardadas para o admin (docs/32 §2.2: a lista "Vendas guardadas", com nome, e-mail e data, e a
// contagem na faixa da Licenca). Quem chama ja passou pela permissao: a tela Vendas (settings.sales, so o dono) e a tela
// Licenca (o dono e os administradores). A lista mostra o nome e o e-mail inteiros de quem comprou porque a pessoa ainda
// nao tem conta na escola: e o unico jeito de a equipe falar com ela. So no modo "enforce": no "off" nada aqui le o
// banco (nenhuma venda e guardada).

import { licensingMode } from "@/server/licensing/build-config";
import { getPaymentAdapter } from "./adapters";
import { heldSaleReasonTitle } from "./held-sales-model";
import { HELD_SALE_COLUMNS, isHeldSalesSchemaMissing, type HeldSaleRow } from "./held-sales-store";
import { SALES_PROVIDER_LABELS } from "./model";
import { salesDb, type SalesDb } from "./store";
import type { SalesProvider } from "./types";

/** Quantas vendas guardadas a lista mostra (a contagem e sempre a de todas). */
export const HELD_SALES_LIST_LIMIT = 50;

export type HeldSaleListItem = {
  attempts: number;
  buyerEmail: string | null;
  buyerName: string | null;
  heldAt: string;
  id: string;
  lastError: string | null;
  /** Os produtos da escola que ficaram sem acesso, pelo nome (o id quando o produto saiu do catalogo). */
  products: string[];
  providerLabel: string;
  reason: string;
  reasonTitle: string;
  receivedAt: string | null;
};

export type HeldSalesOverview = {
  count: number;
  items: HeldSaleListItem[];
  /** O banco ainda nao tem a migracao 202611110002. */
  missingMigration: boolean;
};

type EventRow = { buyer_email: string | null; id: string; payload: unknown; provider: SalesProvider; received_at: string };

async function loadEvents(db: SalesDb, ids: string[]): Promise<Map<string, EventRow>> {
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await db.from("webhook_events").select("id,provider,buyer_email,received_at,payload").in("id", ids);

  if (error) {
    throw new Error(`Compras das vendas guardadas: ${error.message}`);
  }

  return new Map(((data ?? []) as EventRow[]).map((row) => [row.id, row]));
}

async function loadTitles(db: SalesDb, productIds: string[]): Promise<Map<string, string>> {
  if (productIds.length === 0) {
    return new Map();
  }

  const { data, error } = await db.from("content_items").select("id,title").in("id", productIds);

  if (error) {
    console.error(`[vendas] titulos das vendas guardadas: ${error.message}`);
    return new Map();
  }

  return new Map(((data ?? []) as { id: string; title: string }[]).map((row) => [row.id, row.title]));
}

/** O nome de quem comprou, lido do payload guardado pelo mesmo adaptador da venda (nunca gravado a parte). */
function buyerNameOf(event: EventRow | undefined): string | null {
  if (!event) {
    return null;
  }

  return getPaymentAdapter(event.provider)?.normalize(event.payload)?.buyer.name?.trim() || null;
}

/** A contagem e as mais antigas guardadas (a ordem da liberacao). No modo "off", null sem ler nada. */
export async function getHeldSalesOverview(db: SalesDb = salesDb()): Promise<HeldSalesOverview | null> {
  if (licensingMode() !== "enforce") {
    return null;
  }

  const query = await db
    .from("held_sales")
    .select(HELD_SALE_COLUMNS, { count: "exact" })
    .eq("status", "held")
    .order("held_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(HELD_SALES_LIST_LIMIT);

  if (query.error) {
    if (isHeldSalesSchemaMissing(query.error)) {
      return { count: 0, items: [], missingMigration: true };
    }

    throw new Error(`Vendas guardadas: ${query.error.message}`);
  }

  const rows = (query.data ?? []) as HeldSaleRow[];
  const [events, titles] = await Promise.all([
    loadEvents(db, rows.map((row) => row.webhook_event_id)),
    loadTitles(db, Array.from(new Set(rows.flatMap((row) => row.product_ids))))
  ]);

  return {
    count: typeof query.count === "number" ? query.count : rows.length,
    items: rows.map((row) => {
      const event = events.get(row.webhook_event_id);

      return {
        attempts: row.attempts,
        buyerEmail: event?.buyer_email ?? null,
        buyerName: buyerNameOf(event),
        heldAt: row.held_at,
        id: row.id,
        lastError: row.last_error,
        products: row.product_ids.map((productId) => titles.get(productId) ?? productId),
        providerLabel: SALES_PROVIDER_LABELS[row.provider] ?? row.provider,
        reason: row.reason,
        reasonTitle: heldSaleReasonTitle(row.reason),
        receivedAt: event?.received_at ?? null
      };
    }),
    missingMigration: false
  };
}

/** So a contagem (a faixa da Licenca, em toda pagina do admin). No modo "off", 0 sem ler nada; sem a tabela, 0. */
export async function countHeldSalesForBanner(db: SalesDb = salesDb()): Promise<number> {
  if (licensingMode() !== "enforce") {
    return 0;
  }

  const { count, error } = await db.from("held_sales").select("id", { count: "exact", head: true }).eq("status", "held");

  if (error) {
    if (!isHeldSalesSchemaMissing(error)) {
      console.error(`[vendas] contagem das vendas guardadas: ${error.message}`);
    }

    return 0;
  }

  return count ?? 0;
}

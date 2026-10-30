// Os paineis "Lives ao vivo" e "Lives gravadas" no banco (docs/30 §3.1 a §3.3 e §4.6; migracao 202610300002): a RPC
// webinar_panel e as sessoes e webinarios do periodo, pela service role. Quem monta os numeros, os graficos, o cache
// de 60 s (unstable_cache com o minuto na chave e a tag "webinars") e os CSVs e a frente dos paineis
// (panel-model.ts / panel-queries.ts); aqui so o acesso. Banco sem a 202610300002: o erro sobe como
// PendingMigrationError (a tela mostra o aviso com WEBINARS_PANELS_MIGRATION).

import "server-only";

import type { WebinarsDb } from "./db";
import type { PanelKind, PanelRow } from "./model";
import { SESSION_COLUMNS, WEBINAR_COLUMNS, readPanelRows, type SessionRow, type WebinarRow } from "./rows";
import { fetchAll } from "./store";

/**
 * webinar_panel(p_kind, p_start, p_end, p_session_ids): os numeros reais de cada sessao do periodo e os unicos do
 * periodo (session_id nulo). `sessionIds` restringe depois dos filtros da aba; nulo = todas as do periodo. Cada
 * sessao com presenca devolve uns 30 a 45 linhas e o PostgREST corta qualquer resposta (RPC tambem) em 1000 linhas
 * sem erro (supabase/config.toml, max_rows): a leitura e paginada numa ordem total e estavel (session_id com os
 * unicos do periodo primeiro, metric, item; a chave e unica por linha), como o follow-up.
 */
export async function fetchWebinarPanel(db: WebinarsDb, input: { end: string; kind: PanelKind; sessionIds?: readonly string[] | null; start: string }): Promise<PanelRow[]> {
  const args = {
    p_end: input.end,
    p_kind: input.kind,
    p_session_ids: input.sessionIds ? [...input.sessionIds] : null,
    p_start: input.start
  };
  const rows = await fetchAll<unknown>(
    (from, to) => db.rpc("webinar_panel", args).order("session_id", { ascending: true, nullsFirst: true }).order("metric", { ascending: true }).order("item", { ascending: true }).range(from, to),
    "Webinarios: painel"
  );
  return readPanelRows(rows);
}

/** As sessoes do periodo (scheduled_at em [start, end)), do tipo pedido, de qualquer situacao (a aba filtra). */
export async function listPanelSessionRows(db: WebinarsDb, input: { end: string; kind: PanelKind; start: string }): Promise<SessionRow[]> {
  const kinds = input.kind === "all" ? ["live", "simulated"] : [input.kind];
  return fetchAll<SessionRow>(
    (from, to) =>
      db
        .from("webinar_sessions")
        .select(SESSION_COLUMNS)
        .in("kind", kinds)
        .gte("scheduled_at", input.start)
        .lt("scheduled_at", input.end)
        .order("scheduled_at", { ascending: true })
        .range(from, to),
    "Webinarios: sessoes do painel"
  );
}

/** Os webinarios (nao excluidos) das sessoes do painel: titulo, slug, produto, apresentador e tipo. */
export async function listWebinarRowsByIds(db: WebinarsDb, ids: readonly string[]): Promise<WebinarRow[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return [];
  }
  return fetchAll<WebinarRow>(
    (from, to) => db.from("webinars").select(WEBINAR_COLUMNS).in("id", unique).is("deleted_at", null).range(from, to),
    "Webinarios: webinarios do painel"
  );
}

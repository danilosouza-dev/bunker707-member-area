import "server-only";

// Leituras dos paineis "Lives ao vivo" e "Lives gravadas" e dos numeros da lista (docs/30 §2.1, §3.1 a §3.3, §3.5,
// §4.6, D9, M6, M8 e M9). A RPC webinar_panel (202610300002, recriada na 202610300003 com a oferta e o bloco sim_*)
// vai para o unstable_cache de 60 s com o minuto do relogio na chave e a tag "webinars": chave ["webinars-panel", "v1",
// tipo, inicio, fim, hash dos ids das sessoes do recorte, minuto] (o mesmo desenho de getWebinarReport e de
// getPopupReport; o minuto torna a janela de 60 s dura). So os agregados da RPC entram no cache; as sessoes, os
// webinarios, a Oferta, as regras da Simulacao, os nomes dos produtos e o nome da equipe (o filtro Apresentador) sao
// lidos fora dele. Nunca nome nem e-mail de aluno aqui (M9).
//
// Banco sem uma parte: sem a 202610300002 (webinar_panel) o painel inteiro vira o aviso WEBINARS_PANELS_MIGRATION;
// sem a leitura das sessoes (jit, 202610300005), o aviso WEBINARS_MIGRATION; sem a 202610300003 a Oferta e a
// Simulacao ficam em "—" e o resto segue. A curva minuto a minuto da sessao escolhida vem de getWebinarReport
// (report-queries.ts, cache de 60 s da propria visao), passado por quem chama: este modulo nao importa report-queries,
// entao o CSV do painel (export-queries.ts, que report-queries importa) pode usar resolvePanelSelection sem ciclo.

import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import { chunksOf, describeError } from "../communications/db";
import { isPendingMigrationError } from "../db/pending-migration";
import { WEBINARS_TAG } from "./cache";
import { WEBINARS_MIGRATION, WEBINARS_PANELS_MIGRATION, assertNoDbError, isMissingWebinarSchema, webinarsDb, type WebinarsDb } from "./db";
import type { PanelFilters } from "./export-schemas";
import type { PanelKind, PanelRow } from "./model";
import { listOfferDisplayRows, listOffersForWebinars } from "./offer-store";
import {
  buildPanelView,
  filterPanelSessions,
  panelListNumbersOf,
  panelOfferFactsOf,
  panelPresenceOf,
  panelSessionIdsFor,
  panelSessionsOf,
  panelWindowOf,
  type PanelOfferFacts,
  type PanelOfferWindow,
  type PanelPresenceResult,
  type PanelSession,
  type PanelTabKind,
  type PanelView,
  type WebinarListNumbers
} from "./panel-model";
import { fetchWebinarPanel, listPanelSessionRows, listWebinarRowsByIds } from "./panel-store";
import type { WebinarReportResult } from "./report-queries";
import { listSessionSimulations } from "./simulation-store";

const NAME_CHUNK = 150;
/** Ids de sessao por leitura `.in(...)`: o "Comeca quando voce entra" cria dezenas de sessoes por dia e o endereco do PostgREST tem limite. */
const SESSION_CHUNK = 150;

/** Le em partes de SESSION_CHUNK ids e junta (a ordem das partes e a dos ids). */
async function inChunks<T>(ids: readonly string[], load: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];

  for (const part of chunksOf([...new Set(ids)], SESSION_CHUNK)) {
    rows.push(...(await load(part)));
  }

  return rows;
}

/* ------------------------------------------------------------------------------------------------
 * O cache da RPC (60 s, pelo minuto)
 * ---------------------------------------------------------------------------------------------- */

/** O minuto do relogio que entra na chave (cada minuto tem a sua entrada; docs/29 §4.6). */
export function panelCacheMinute(now = Date.now()) {
  return Math.floor(now / 60_000);
}

/** O hash dos ids do recorte (ordenados): a chave nao carrega a lista inteira. Nulo = o periodo inteiro. */
export function panelSessionIdsHash(sessionIds: readonly string[] | null): string {
  if (!sessionIds) {
    return "all";
  }

  return createHash("sha256").update([...sessionIds].sort().join(",")).digest("hex").slice(0, 32);
}

export type PanelRowsInput = { end: string; kind: PanelKind; now: number; sessionIds: readonly string[] | null; start: string };

/** A chave do unstable_cache: ["webinars-panel", "v1", tipo, inicio, fim, hash, minuto]. */
export function panelCacheKey(input: PanelRowsInput): string[] {
  return ["webinars-panel", "v1", input.kind, input.start, input.end, panelSessionIdsHash(input.sessionIds), String(panelCacheMinute(input.now))];
}

/**
 * As linhas de webinar_panel pela chave do minuto. Recorte vazio: nenhuma linha, sem ir ao banco. So o resultado certo
 * entra no cache (o erro sobe e nao fica guardado); lanca PendingMigrationError sem a 202610300002.
 */
export function cachedPanelRows(input: PanelRowsInput): Promise<PanelRow[]> {
  if (input.sessionIds && input.sessionIds.length === 0) {
    return Promise.resolve([]);
  }

  const sessionIds = input.sessionIds ? [...input.sessionIds].sort() : null;
  const load = () => fetchWebinarPanel(webinarsDb(), { end: input.end, kind: input.kind, sessionIds, start: input.start });

  return unstable_cache(load, panelCacheKey(input), { revalidate: 60, tags: [WEBINARS_TAG] })();
}

export type PanelRowsLoader = (input: PanelRowsInput) => Promise<PanelRow[]>;

/* ------------------------------------------------------------------------------------------------
 * Os numeros da lista (aba Webinarios)
 * ---------------------------------------------------------------------------------------------- */

export type { WebinarListNumbers };

/**
 * Compareceram (unique_present) e Assistiram o replay (unique_replay_viewers) do periodo, as duas abas somadas
 * (webinar_panel 'all'). Banco sem a 202610300002 ou qualquer falha: "—" nos dois, a lista segue.
 */
export async function getWebinarListNumbers(period: { end: Date; start: Date }, options: { now?: number; rows?: PanelRowsLoader } = {}): Promise<WebinarListNumbers> {
  const window = panelWindowOf(period);

  try {
    const rows = await (options.rows ?? cachedPanelRows)({ ...window, kind: "all", now: options.now ?? Date.now(), sessionIds: null });
    return panelListNumbersOf(rows);
  } catch (error) {
    if (!isPendingMigrationError(error) && !isMissingWebinarSchema(error)) {
      console.error("[admin/webinarios] numeros da lista", describeError(error));
    }

    return { attended: null, replayViewers: null };
  }
}

/* ------------------------------------------------------------------------------------------------
 * As leituras fora do cache
 * ---------------------------------------------------------------------------------------------- */

/** Uma parte da 202610300003 (Oferta, Simulacao): sem ela, nulo; qualquer outro erro sobe. */
async function unlessOffersPending<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    if (isPendingMigrationError(error) || isMissingWebinarSchema(error)) {
      return null;
    }

    throw error;
  }
}

async function loadNames(db: WebinarsDb, table: "content_items" | "profiles", column: "full_name" | "title", ids: readonly string[]): Promise<Record<string, string>> {
  const names: Record<string, string> = {};

  for (const part of chunksOf([...new Set(ids.filter(Boolean))], NAME_CHUNK)) {
    const { data, error } = await db.from(table).select(`id,${column}`).in("id", part);
    assertNoDbError(error, `Webinarios: nomes do painel (${table})`);

    for (const row of (data ?? []) as Record<string, string | null>[]) {
      const name = row[column]?.trim();

      if (row.id && name) {
        names[row.id] = name;
      }
    }
  }

  return names;
}

/** Os nomes dos produtos (content_items) e da equipe que apresenta (so o nome; nada de aluno). Falha: sem nomes. */
async function loadPanelNames(db: WebinarsDb, sessions: readonly PanelSession[]) {
  const products = sessions.flatMap((session) => (session.productId ? [session.productId] : []));
  const hosts = sessions.flatMap((session) => (session.hostUserId ? [session.hostUserId] : []));
  const [productNames, hostNames] = await Promise.all([
    loadNames(db, "content_items", "title", products).catch((error: unknown) => {
      console.error("[admin/webinarios] produtos do painel", describeError(error));
      return {};
    }),
    loadNames(db, "profiles", "full_name", hosts).catch((error: unknown) => {
      console.error("[admin/webinarios] apresentadores do painel", describeError(error));
      return {};
    })
  ]);

  return { hostNames, productNames };
}

/** Existe alguma sessao deste tipo (fora do periodo): decide entre "Sem lives ao vivo ainda" e "Sem dados no período". */
async function hasAnySession(db: WebinarsDb, kind: PanelTabKind): Promise<boolean> {
  const { count, error } = await db.from("webinar_sessions").select("id", { count: "exact", head: true }).eq("kind", kind);
  assertNoDbError(error, "Webinarios: alguma sessao do painel");
  return (count ?? 0) > 0;
}

/* ------------------------------------------------------------------------------------------------
 * O recorte (tambem para o CSV do painel)
 * ---------------------------------------------------------------------------------------------- */

export type PanelSelection = {
  /** A Oferta de cada webinario e a janela de cada sessao (nulo: banco sem a 202610300003). */
  offers: PanelOfferFacts | null;
  /** O recorte dos filtros (ordem das horas marcadas). */
  selected: PanelSession[];
  /** Os ids para webinar_panel (nulo = o periodo inteiro). */
  sessionIds: string[] | null;
  sessions: PanelSession[];
  window: { end: string; start: string };
};

/**
 * As sessoes do periodo (janela em minutos inteiros), a Oferta delas e o recorte dos filtros da aba. O CSV do painel
 * (Performance e Simulacao do periodo) usa o mesmo recorte, para o arquivo bater com a tela.
 */
export async function resolvePanelSelection(db: WebinarsDb, input: { filters: PanelFilters; kind: PanelTabKind; window: { end: Date; start: Date } }): Promise<PanelSelection> {
  const window = panelWindowOf(input.window);
  const sessionRows = await listPanelSessionRows(db, { end: window.end, kind: input.kind, start: window.start });
  const webinarRows = await listWebinarRowsByIds(db, sessionRows.map((row) => row.webinar_id));
  const sessions = panelSessionsOf(sessionRows, webinarRows);
  const offers = await unlessOffersPending(async () => {
    const [offerList, displays] = await Promise.all([
      inChunks(sessions.map((session) => session.webinarId), (part) => listOffersForWebinars(db, part)),
      inChunks(sessions.map((session) => session.id), (part) => listOfferDisplayRows(db, part))
    ]);

    return panelOfferFactsOf(offerList, displays);
  });
  const selected = filterPanelSessions(sessions, input.filters, offers);

  return { offers, selected, sessionIds: panelSessionIdsFor(selected, sessions), sessions, window };
}

/* ------------------------------------------------------------------------------------------------
 * A aba inteira
 * ---------------------------------------------------------------------------------------------- */

export type PanelLoadInput = {
  filters: PanelFilters;
  kind: PanelTabKind;
  now: number;
  period: { end: Date; previous: { end: Date; start: Date }; start: Date };
  /** A sessao pedida para a curva (?sessao=); fora do recorte, vale a mais recente. */
  sessionId: string | null;
};

export type PanelLoad = { status: "ok"; view: PanelView } | { migration: string; status: "pending_migration" } | { status: "error" };

class PanelPending extends Error {
  readonly migration: string;

  constructor(migration: string) {
    super(`Webinarios: painel sem a migracao ${migration}`);
    this.name = "PanelPending";
    this.migration = migration;
  }
}

async function stage<T>(migration: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (isPendingMigrationError(error) || isMissingWebinarSchema(error)) {
      throw new PanelPending(migration);
    }

    throw error;
  }
}

/** Le e monta a aba (o periodo e o anterior de mesmo tamanho, com o mesmo recorte); `rows` troca o cache nos testes. */
export async function loadWebinarPanel(db: WebinarsDb, input: PanelLoadInput, deps: { rows?: PanelRowsLoader } = {}): Promise<PanelLoad> {
  const rowsOf = deps.rows ?? cachedPanelRows;

  try {
    const [current, previous] = await stage(WEBINARS_MIGRATION, () =>
      Promise.all([
        resolvePanelSelection(db, { filters: input.filters, kind: input.kind, window: input.period }),
        resolvePanelSelection(db, { filters: input.filters, kind: input.kind, window: input.period.previous })
      ])
    );
    const [rows, previousRows] = await stage(WEBINARS_PANELS_MIGRATION, () =>
      Promise.all([
        rowsOf({ ...current.window, kind: input.kind, now: input.now, sessionIds: current.sessionIds }),
        previous.selected.length > 0 ? rowsOf({ ...previous.window, kind: input.kind, now: input.now, sessionIds: previous.sessionIds }) : Promise.resolve([])
      ])
    );
    const [simulations, names, everHadSessions] = await Promise.all([
      input.kind === "simulated" && current.offers !== null
        ? unlessOffersPending(() => inChunks(current.selected.map((session) => session.id), (part) => listSessionSimulations(db, part)))
        : Promise.resolve(null),
      loadPanelNames(db, current.sessions),
      current.sessions.length > 0 ? Promise.resolve(true) : hasAnySession(db, input.kind)
    ]);

    return {
      status: "ok",
      view: buildPanelView({
        everHadSessions,
        filters: input.filters,
        hostNames: names.hostNames,
        kind: input.kind,
        offers: current.offers,
        previousRows,
        previousSelected: previous.selected,
        productNames: names.productNames,
        rows,
        selected: current.selected,
        sessionParam: input.sessionId,
        sessions: current.sessions,
        simulations,
        window: current.window
      })
    };
  } catch (error) {
    if (error instanceof PanelPending) {
      return { migration: error.migration, status: "pending_migration" };
    }

    throw error;
  }
}

/** A aba de painel da pagina (service role); qualquer falha vira a frase de erro, nunca a tela quebrada. */
export async function getWebinarPanel(input: PanelLoadInput): Promise<PanelLoad> {
  try {
    return await loadWebinarPanel(webinarsDb(), input);
  } catch (error) {
    console.error("[admin/webinarios] painel", describeError(error));
    return { status: "error" };
  }
}

/* ------------------------------------------------------------------------------------------------
 * A curva minuto a minuto da sessao escolhida
 * ---------------------------------------------------------------------------------------------- */

export type { PanelPresenceResult };

/** A leitura da visao do relatorio de uma sessao (getWebinarReport de report-queries.ts, com o cache de 60 s dela). */
export type PanelReportLoader = (sessionId: string, options: { now?: number }) => Promise<WebinarReportResult | { status: "error" } | { status: "pending_migration" }>;

/**
 * A curva da sessao escolhida pela visao do relatorio (getWebinarReport: cache de 60 s, a curva congelada no fim ou as
 * amostras da sessao no ar), com os 5 pontos de queda e, na gravada, a janela da oferta.
 */
export async function getPanelPresence(
  input: { durationMs: number; offerWindow: PanelOfferWindow | null; sessionId: string | null },
  options: { now?: number; report: PanelReportLoader }
): Promise<PanelPresenceResult> {
  if (!input.sessionId) {
    return { status: "empty" };
  }

  const result = await options.report(input.sessionId, { now: options.now });

  if (result.status !== "ok") {
    return { status: result.status };
  }

  return { chart: panelPresenceOf(result.view.presence, { durationMs: input.durationMs, offerWindow: input.offerWindow }), status: "ok" };
}

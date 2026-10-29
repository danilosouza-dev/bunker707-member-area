// Os paineis "Lives ao vivo" e "Lives gravadas" e os numeros da lista, a parte pura (docs/30 §2.1, §3.1 a §3.3, §3.5,
// §3.6, §2.9 "Event performance over time", D6, D9, D10, M2, M6, M8, M9 e A19). Sem "server-only", imports relativos:
// tests/webinarios-paineis-*.test.mjs carregam direto pelo Node. Aqui: os filtros da aba no endereco (o mesmo formato
// de panelFiltersSchema, resolvidos em ids de sessao para webinar_panel), as linhas da RPC por sessao e do periodo, os
// dez cartoes de cada painel com o delta contra o periodo anterior de mesmo tamanho (a janela `previous` de
// src/components/admin/v2/period.ts; a conta do delta e a mesma de today-model.ts: percentual nos numeros, pontos nas
// porcentagens, sem delta quando o anterior e zero), os graficos, a tabela de sessoes e o bloco Simulacao.
//
// Regra de ferro (D6, D10, M6): o bloco Simulacao e a UNICA funcao que le as linhas `sim_*` (panelSimulationOf). As
// leituras dos numeros reais (panelSessionStatsOf, panelPeriodStatsOf) ignoram qualquer metrica que nao conhecem, e
// cartoes, graficos, filtros e tabela so leem o que elas devolvem; tests/webinarios-paineis-modelo.test.mjs varre este
// arquivo e prova isso. Nada pessoal aqui (M9): ids de sessao e de webinario, titulos, produtos e o nome da equipe.

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { saoPauloDate, saoPauloTime } from "../../lib/webinar-time";
import { formatSaoPauloDateTime } from "../communications/campaign-model";
import { WEBINARS_HREF, WEBINAR_TAB_PARAM } from "./editor-model";
import { PANEL_KIND_PARAMS } from "./export-links";
import { panelFiltersSchema, type PanelFilters } from "./export-schemas";
import {
  OFFER_VARIANT_LABELS,
  PANEL_RETENTION_POINTS,
  ROOM_RULES,
  SIMULATION_METRICS,
  toTime,
  type OfferVariantLabel,
  type PanelRow,
  type SessionSimulation,
  type SessionStatus,
  type WebinarOffer
} from "./model";
import { bucketLabel, watchTimeLabel, type ReportBucket, type WebinarReportView } from "./report-model";
import { curveByMinute, webinarReportHref } from "./report-page-model";
import { offerDisplaySnapshotOf, type OfferDisplayRow, type SessionRow, type WebinarRow } from "./rows";
import { simulationDecisionRecorded } from "./simulation-ack";

const COPY = WEBINAR_COPY.paineis;

/** As duas abas de painel (o tipo de sessao de webinar_panel; 'all' e so a lista). */
export type PanelTabKind = "live" | "simulated";

/* ------------------------------------------------------------------------------------------------
 * Filtros da aba no endereco (docs/30 §3.2 e §3.3)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Os parametros da pagina (em portugues, como ?periodo= e ?aba=; os mesmos nomes que o CSV do painel le, PANEL_FILTER_PARAMS
 * de export-model.ts; Produto e o ?produto= do filtro global da barra); `sessao` e a sessao da curva minuto a minuto.
 */
export const PANEL_PARAMS = {
  host: "apresentador",
  hour: "hora",
  product: "produto",
  session: "sessao",
  situation: "situacao",
  variant: "variante",
  webinar: "webinario",
  withOffer: "com-oferta"
} as const;

/** Os valores de ?situacao= nos paineis (no plural; a lista usa os do singular, que nao batem com estes), na ordem das pilulas. */
export const PANEL_SITUATION_VALUES = { realized: "realizadas", scheduled: "agendadas", cancelled: "canceladas" } as const;
export type PanelSituation = keyof typeof PANEL_SITUATION_VALUES;

/** "Com oferta" ligado no endereco ("sim" tambem vale na leitura). */
const WITH_OFFER_VALUE = "1";
const WITH_OFFER_VALUES = new Set(["1", "sim"]);
/** O mesmo formato do check de webinars.product_id (id de content_items em texto). */
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,240}$/;

type FilterKey = keyof PanelFilters;

/** Os filtros de cada aba: Lives ao vivo (Situacao, Apresentador, Produto); Lives gravadas (Webinario, Horario do dia, Com oferta, Variante, Produto). */
export const PANEL_TAB_FILTERS: Record<PanelTabKind, readonly FilterKey[]> = {
  live: ["situation", "hostUserId", "productId"],
  simulated: ["webinarId", "hour", "withOffer", "variant", "productId"]
};

type ParamValue = string | string[] | null | undefined;
type ParamsLike = Record<string, ParamValue>;

function firstParam(value: ParamValue): string {
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim();
}

function fieldOrNull<K extends FilterKey>(key: K, value: unknown): PanelFilters[K] | null {
  const parsed = panelFiltersSchema.shape[key].safeParse(value);
  return parsed.success ? (parsed.data as PanelFilters[K]) : null;
}

/** Os filtros vazios (o padrao de panelFiltersSchema). */
export function emptyPanelFilters(): PanelFilters {
  return panelFiltersSchema.parse({});
}

/**
 * Os filtros da aba a partir do endereco: cada campo passa pelo zod de panelFiltersSchema sozinho (um valor ruim vira
 * "sem filtro", nunca erro) e so os filtros da aba ficam (os da outra aba sao ignorados).
 */
export function readPanelFilters(kind: PanelTabKind, params: ParamsLike): PanelFilters {
  const situationText = firstParam(params[PANEL_PARAMS.situation]).toLowerCase();
  const situation = (Object.entries(PANEL_SITUATION_VALUES) as [PanelSituation, string][]).find(([, value]) => value === situationText)?.[0] ?? null;
  const hourText = firstParam(params[PANEL_PARAMS.hour]);
  const productText = firstParam(params[PANEL_PARAMS.product]);
  const candidate: PanelFilters = {
    hostUserId: fieldOrNull("hostUserId", firstParam(params[PANEL_PARAMS.host]) || null),
    hour: /^\d{1,2}$/.test(hourText) ? fieldOrNull("hour", Number(hourText)) : null,
    productId: PRODUCT_ID_PATTERN.test(productText) ? fieldOrNull("productId", productText) : null,
    situation,
    variant: fieldOrNull("variant", firstParam(params[PANEL_PARAMS.variant]).toUpperCase() || null),
    webinarId: fieldOrNull("webinarId", firstParam(params[PANEL_PARAMS.webinar]) || null),
    withOffer: WITH_OFFER_VALUES.has(firstParam(params[PANEL_PARAMS.withOffer]).toLowerCase())
  };
  const filters = emptyPanelFilters();

  for (const key of PANEL_TAB_FILTERS[kind]) {
    (filters as Record<FilterKey, unknown>)[key] = candidate[key] ?? (key === "withOffer" ? false : null);
  }

  return filters;
}

/** O caminho inverso: os parametros do endereco dos filtros da aba (o menu Exportar repassa estes). */
export function panelFilterParams(kind: PanelTabKind, filters: Partial<PanelFilters>): Record<string, string> {
  const params: Record<string, string> = {};
  const allowed = new Set(PANEL_TAB_FILTERS[kind]);

  if (allowed.has("situation") && filters.situation) {
    params[PANEL_PARAMS.situation] = PANEL_SITUATION_VALUES[filters.situation];
  }
  if (allowed.has("hostUserId") && filters.hostUserId) {
    params[PANEL_PARAMS.host] = filters.hostUserId;
  }
  if (allowed.has("productId") && filters.productId) {
    params[PANEL_PARAMS.product] = filters.productId;
  }
  if (allowed.has("webinarId") && filters.webinarId) {
    params[PANEL_PARAMS.webinar] = filters.webinarId;
  }
  if (allowed.has("hour") && typeof filters.hour === "number") {
    params[PANEL_PARAMS.hour] = String(filters.hour);
  }
  if (allowed.has("withOffer") && filters.withOffer) {
    params[PANEL_PARAMS.withOffer] = WITH_OFFER_VALUE;
  }
  if (allowed.has("variant") && filters.variant) {
    params[PANEL_PARAMS.variant] = filters.variant;
  }

  return params;
}

export function hasPanelFilters(kind: PanelTabKind, filters: PanelFilters): boolean {
  return Object.keys(panelFilterParams(kind, filters)).length > 0;
}

/**
 * O endereco da aba com os filtros dados (o periodo da barra superior vai junto). Trocar um filtro tira a sessao da
 * curva (?sessao=): a padrao volta a ser a mais recente do novo recorte.
 */
export function panelHref(input: { filters: Partial<PanelFilters>; kind: PanelTabKind; periodo?: string | null; sessionId?: string | null }): string {
  const params = new URLSearchParams();
  params.set(WEBINAR_TAB_PARAM, PANEL_KIND_PARAMS[input.kind]);

  for (const [key, value] of Object.entries(panelFilterParams(input.kind, input.filters))) {
    params.set(key, value);
  }

  if (input.sessionId) {
    params.set(PANEL_PARAMS.session, input.sessionId);
  }

  if (input.periodo) {
    params.set("periodo", input.periodo);
  }

  return `${WEBINARS_HREF}?${params.toString()}`;
}

/** A sessao pedida para a curva (?sessao=), so quando e um uuid. */
export function readPanelSessionParam(params: ParamsLike): string | null {
  const value = firstParam(params[PANEL_PARAMS.session]);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
}

/* ------------------------------------------------------------------------------------------------
 * As sessoes do periodo e o recorte dos filtros
 * ---------------------------------------------------------------------------------------------- */

/** Uma sessao do painel com o que a tela mostra do webinario (nada de aluno). */
export type PanelSession = {
  endedAt: string | null;
  hostUserId: string | null;
  id: string;
  /** Fase 4e: nasceu no "Comeca quando voce entra" (a linha leva o selo). */
  jit: boolean;
  kind: PanelTabKind;
  productId: string | null;
  /** O webinario pede Garantir vaga (so estes entram no Comparecimento). */
  registrationRequired: boolean;
  scheduledAt: string;
  /** O selo "Ao vivo" da sessao gravada (fase 2, D10): so o bloco Simulacao conta. */
  showLiveBadge: boolean;
  /** A decisao da Simulacao ficou registrada (frase e hora, D10): sem ela, nada simulado apareceu ao aluno. */
  simulationDecided: boolean;
  startedAt: string | null;
  status: SessionStatus;
  webinarId: string;
  webinarSlug: string;
  webinarTitle: string;
};

/** As sessoes `live`/`simulated` de webinarios que existem, na ordem das horas marcadas. */
export function panelSessionsOf(sessionRows: readonly SessionRow[], webinarRows: readonly WebinarRow[]): PanelSession[] {
  const webinars = new Map(webinarRows.filter((row) => !row.deleted_at).map((row) => [row.id, row]));
  const sessions: PanelSession[] = [];

  for (const row of sessionRows) {
    const webinar = webinars.get(row.webinar_id);

    if (!webinar || (row.kind !== "live" && row.kind !== "simulated")) {
      continue;
    }

    sessions.push({
      endedAt: row.ended_at ?? null,
      hostUserId: webinar.host_user_id ?? null,
      id: row.id,
      jit: row.jit === true,
      kind: row.kind,
      productId: webinar.product_id ?? null,
      registrationRequired: webinar.registration_required !== false,
      scheduledAt: row.scheduled_at,
      showLiveBadge: row.show_live_badge === true,
      simulationDecided: simulationDecisionRecorded({ simulationAckText: row.simulation_ack_text, simulationDecidedAt: row.simulation_decided_at }),
      startedAt: row.started_at ?? null,
      status: row.status as SessionStatus,
      webinarId: webinar.id,
      webinarSlug: webinar.slug,
      webinarTitle: webinar.title
    });
  }

  return sessions.sort((left, right) => toTime(left.scheduledAt) - toTime(right.scheduledAt) || left.id.localeCompare(right.id));
}

/** Realizada (encerrou ou esta no ar), agendada (ainda nao comecou) ou cancelada. */
export function panelSessionSituation(session: Pick<PanelSession, "status">): PanelSituation {
  if (session.status === "cancelled") {
    return "cancelled";
  }

  return session.status === "ended" || session.status === "live" ? "realized" : "scheduled";
}

/** A hora marcada no relogio de Sao Paulo (0 a 23). */
export function saoPauloHourOf(iso: string): number {
  const hour = Number(saoPauloTime(iso).slice(0, 2));
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 0;
}

/** A janela mostrada numa sessao (webinar_offer_displays) e as variantes da foto dela. */
export type PanelOfferWindow = { hideOffsetMs: number | null; showOffsetMs: number; variants: readonly OfferVariantLabel[] };

/** O que os filtros "Com oferta" e "Variante" e a faixa da janela leem da Oferta (nulo: banco sem a 202610290005). */
export type PanelOfferFacts = {
  byWebinar: ReadonlyMap<string, { offerId: string; variants: readonly OfferVariantLabel[] }>;
  displays: ReadonlyMap<string, PanelOfferWindow>;
};

/**
 * A Oferta de cada webinario que aparece para o aluno (ativa e com "Quando aparece" diferente de "nunca"; o rascunho
 * nunca aparece) com as variantes ligadas, e a janela de cada sessao que mostrou a Oferta (webinar_offer_displays).
 */
export function panelOfferFactsOf(
  offers: readonly Pick<WebinarOffer, "id" | "status" | "triggerKind" | "variants" | "webinarId">[],
  displayRows: readonly Pick<OfferDisplayRow, "hide_offset_ms" | "session_id" | "show_offset_ms" | "snapshot">[]
): PanelOfferFacts {
  const byWebinar = new Map<string, { offerId: string; variants: readonly OfferVariantLabel[] }>();

  for (const offer of offers) {
    if (offer.status !== "active" || offer.triggerKind === "never") {
      continue;
    }

    byWebinar.set(offer.webinarId, { offerId: offer.id, variants: offer.variants.filter((variant) => variant.enabled).map((variant) => variant.label) });
  }

  const displays = new Map<string, PanelOfferWindow>();

  for (const row of displayRows) {
    const snapshot = offerDisplaySnapshotOf(row.snapshot);
    const current = displays.get(row.session_id);
    const showOffsetMs = Math.max(0, Number(row.show_offset_ms) || 0);
    const hideOffsetMs = row.hide_offset_ms === null || row.hide_offset_ms === undefined ? null : Math.max(showOffsetMs, Number(row.hide_offset_ms) || 0);

    // Uma Oferta ativa por webinario: mais de uma linha so com ofertas trocadas; vale a primeira que apareceu.
    if (!current || showOffsetMs < current.showOffsetMs) {
      displays.set(row.session_id, { hideOffsetMs, showOffsetMs, variants: snapshot ? snapshot.variants.map((variant) => variant.label) : [] });
    }
  }

  return { byWebinar, displays };
}

/** A sessao teve Oferta: mostrou (webinar_offer_displays) ou o webinario tem uma Oferta montada. */
function sessionHasOffer(session: PanelSession, offers: PanelOfferFacts): boolean {
  return offers.displays.has(session.id) || offers.byWebinar.has(session.webinarId);
}

/** As variantes da sessao: as da foto do que ela mostrou; sem foto, as ligadas na Oferta do webinario. */
function sessionVariants(session: PanelSession, offers: PanelOfferFacts): readonly OfferVariantLabel[] {
  const shown = offers.displays.get(session.id)?.variants ?? [];
  return shown.length > 0 ? shown : (offers.byWebinar.get(session.webinarId)?.variants ?? []);
}

/**
 * O recorte dos filtros (vira `sessionIds` de webinar_panel, entao os unicos do topo seguem os filtros). Sem Situacao, as
 * canceladas ficam de fora (as vagas delas continuam `registered` e inchariam Vagas garantidas, como na lista).
 * "Com oferta" e "Variante" sem a 202610290005 (offers nulo) nao casam com nada.
 */
export function filterPanelSessions(sessions: readonly PanelSession[], filters: PanelFilters, offers: PanelOfferFacts | null): PanelSession[] {
  return sessions.filter((session) => {
    const situation = panelSessionSituation(session);

    if (filters.situation ? situation !== filters.situation : situation === "cancelled") {
      return false;
    }
    if (filters.hostUserId && session.hostUserId !== filters.hostUserId) {
      return false;
    }
    if (filters.productId && session.productId !== filters.productId) {
      return false;
    }
    if (filters.webinarId && session.webinarId !== filters.webinarId) {
      return false;
    }
    if (typeof filters.hour === "number" && saoPauloHourOf(session.scheduledAt) !== filters.hour) {
      return false;
    }
    if (filters.withOffer && !(offers && sessionHasOffer(session, offers))) {
      return false;
    }
    if (filters.variant && !(offers && sessionVariants(session, offers).includes(filters.variant))) {
      return false;
    }

    return true;
  });
}

/**
 * Os `sessionIds` de webinar_panel: nulo quando o recorte e o periodo inteiro (a RPC le as mesmas sessoes sem a lista
 * na chamada); senao, os ids em ordem (a chave do cache usa o hash deles).
 */
export function panelSessionIdsFor(selected: readonly PanelSession[], all: readonly PanelSession[]): string[] | null {
  if (selected.length === all.length) {
    return null;
  }

  return selected.map((session) => session.id).sort();
}

/* ------------------------------------------------------------------------------------------------
 * A janela do periodo para a RPC e para a chave do cache
 * ---------------------------------------------------------------------------------------------- */

const MINUTE_MS = 60_000;

/**
 * O periodo da barra em minutos inteiros: inicio para baixo, fim para cima. "Ultimas 24 horas" e "30d" terminam
 * "agora" (muda a cada milissegundo); sem isto a chave do cache nunca se repetiria. Um intervalo fechado ja cai em
 * 00:00 e nao muda.
 */
export function panelWindowOf(window: { end: Date; start: Date }): { end: string; start: string } {
  const start = Math.floor(window.start.getTime() / MINUTE_MS) * MINUTE_MS;
  const end = Math.max(start + MINUTE_MS, Math.ceil(window.end.getTime() / MINUTE_MS) * MINUTE_MS);
  return { end: new Date(end).toISOString(), start: new Date(start).toISOString() };
}

/* ------------------------------------------------------------------------------------------------
 * As linhas de webinar_panel: os numeros reais por sessao e do periodo
 * ---------------------------------------------------------------------------------------------- */

export type PanelVariantStats = { clicks: number; purchases: number; seen: number };

/** Os numeros reais de uma sessao (so as metricas conhecidas; o resto da RPC, inclusive o bloco Simulacao, fica fora). */
export type PanelSessionStats = {
  attendedRegistered: number;
  commenters: number;
  durationMs: number;
  messages: number;
  offer: { buyers: number; clickers: number; clicks: number; purchases: number; seen: number };
  peak: ReportBucket | null;
  pollAnswers: number;
  present: number;
  questions: { answered: number; dismissed: number; open: number };
  reachedEnd: number;
  reactions: number;
  registered: number;
  replayViewers: number;
  /** Presentes em cada um dos 21 pontos (0 a 100 % da duracao, de 5 em 5). */
  retention: number[];
  /** Os alunos unicos da sessao (a base da retencao). */
  retentionBase: number;
  /** Centavos por moeda (M8): so vendas que chegaram com o valor. */
  revenue: Record<string, number>;
  variants: Record<OfferVariantLabel, PanelVariantStats>;
  visitors: number;
  watchMax: number;
  watchSum: number;
};

export function emptyPanelSessionStats(): PanelSessionStats {
  return {
    attendedRegistered: 0,
    commenters: 0,
    durationMs: 0,
    messages: 0,
    offer: { buyers: 0, clickers: 0, clicks: 0, purchases: 0, seen: 0 },
    peak: null,
    pollAnswers: 0,
    present: 0,
    questions: { answered: 0, dismissed: 0, open: 0 },
    reachedEnd: 0,
    reactions: 0,
    registered: 0,
    replayViewers: 0,
    retention: PANEL_RETENTION_POINTS.map(() => 0),
    retentionBase: 0,
    revenue: {},
    variants: { A: { clicks: 0, purchases: 0, seen: 0 }, B: { clicks: 0, purchases: 0, seen: 0 }, C: { clicks: 0, purchases: 0, seen: 0 }, D: { clicks: 0, purchases: 0, seen: 0 } },
    visitors: 0,
    watchMax: 0,
    watchSum: 0
  };
}

function isVariantLabel(value: string): value is OfferVariantLabel {
  return (OFFER_VARIANT_LABELS as readonly string[]).includes(value);
}

/** Os numeros reais por sessao. Metrica que nao esta aqui (as do bloco Simulacao e as que a RPC ganhar) e ignorada. */
export function panelSessionStatsOf(rows: readonly PanelRow[]): Map<string, PanelSessionStats> {
  const map = new Map<string, PanelSessionStats>();
  const statsOf = (sessionId: string) => {
    let stats = map.get(sessionId);

    if (!stats) {
      stats = emptyPanelSessionStats();
      map.set(sessionId, stats);
    }

    return stats;
  };

  for (const row of rows) {
    if (!row.sessionId) {
      continue;
    }

    const stats = statsOf(row.sessionId);

    switch (row.metric) {
      case "duration":
        stats.durationMs = row.total;
        break;
      case "registered":
        stats.registered = row.total;
        break;
      case "present":
        stats.present = row.total;
        break;
      case "attended_registered":
        stats.attendedRegistered = row.total;
        break;
      case "watch_sum":
        stats.watchSum = row.total;
        break;
      case "watch_max":
        stats.watchMax = row.total;
        break;
      case "reached_end":
        stats.reachedEnd = row.total;
        break;
      case "peak":
        stats.peak = { b: Number.parseInt(row.item, 10) || 0, n: row.total };
        break;
      case "messages":
        stats.messages = row.total;
        stats.commenters = row.students;
        break;
      case "question":
        if (row.item === "open" || row.item === "answered" || row.item === "dismissed") {
          stats.questions[row.item] = row.total;
        }
        break;
      case "reactions":
        stats.reactions = row.total;
        break;
      case "poll_answers":
        stats.pollAnswers = row.total;
        break;
      case "replay_viewers":
        stats.replayViewers = row.total;
        break;
      case "visitors":
        stats.visitors = row.total;
        break;
      case "retention": {
        const index = Number(row.item) / 5;

        if (Number.isInteger(index) && index >= 0 && index < PANEL_RETENTION_POINTS.length) {
          stats.retention[index] = row.total;
          stats.retentionBase = Math.max(stats.retentionBase, row.students);
        }
        break;
      }
      case "offer_seen":
        stats.offer.seen = row.students;
        break;
      case "offer_clicks":
        stats.offer.clicks = row.total;
        stats.offer.clickers = row.students;
        break;
      case "offer_purchases":
        stats.offer.purchases = row.total;
        stats.offer.buyers = row.students;
        break;
      case "offer_variant": {
        const [label, what] = row.item.split(":");

        if (isVariantLabel(label ?? "")) {
          const variant = stats.variants[label as OfferVariantLabel];

          if (what === "seen") {
            variant.seen = row.students;
          } else if (what === "clicks") {
            variant.clicks = row.students;
          } else if (what === "purchases") {
            variant.purchases = row.total;
          }
        }
        break;
      }
      case "offer_revenue":
        if (/^[A-Z]{3}$/.test(row.item)) {
          stats.revenue[row.item] = (stats.revenue[row.item] ?? 0) + row.total;
        }
        break;
      default:
        break;
    }
  }

  return map;
}

/** Os unicos do periodo (session_id nulo): o mesmo aluno em duas sessoes conta uma vez. */
export type PanelPeriodStats = {
  attendedRegistered: number;
  buyers: number;
  clickers: number;
  commenters: number;
  offerSeen: number;
  present: number;
  reachedEnd: number;
  registered: number;
  replayViewers: number;
  visitors: number;
};

export function panelPeriodStatsOf(rows: readonly PanelRow[]): PanelPeriodStats {
  const stats: PanelPeriodStats = { attendedRegistered: 0, buyers: 0, clickers: 0, commenters: 0, offerSeen: 0, present: 0, reachedEnd: 0, registered: 0, replayViewers: 0, visitors: 0 };

  for (const row of rows) {
    if (row.sessionId) {
      continue;
    }

    switch (row.metric) {
      case "unique_present":
        stats.present = row.total;
        break;
      case "unique_registered":
        stats.registered = row.total;
        break;
      case "unique_attended_registered":
        stats.attendedRegistered = row.total;
        break;
      case "unique_reached_end":
        stats.reachedEnd = row.total;
        break;
      case "unique_replay_viewers":
        stats.replayViewers = row.total;
        break;
      case "unique_visitors":
        stats.visitors = row.total;
        break;
      case "unique_commenters":
        stats.commenters = row.total;
        break;
      case "unique_offer_seen":
        stats.offerSeen = row.total;
        break;
      case "unique_clickers":
        stats.clickers = row.total;
        break;
      case "unique_buyers":
        stats.buyers = row.total;
        break;
      default:
        break;
    }
  }

  return stats;
}

/** Compareceram e Assistiram o replay da lista; nulo = "—" (banco sem a 202610290004 ou falha na leitura). */
export type WebinarListNumbers = { attended: number | null; replayViewers: number | null };

/** Os dois numeros reais da lista (aba Webinarios): Compareceram e Assistiram o replay do periodo. */
export function panelListNumbersOf(rows: readonly PanelRow[]): { attended: number; replayViewers: number } {
  const period = panelPeriodStatsOf(rows);
  return { attended: period.present, replayViewers: period.replayViewers };
}

/* ------------------------------------------------------------------------------------------------
 * Contas e formatos
 * ---------------------------------------------------------------------------------------------- */

function sumOf(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Porcentagem com uma casa (0 a 100), ou nulo sem base (a tela mostra "—"). */
export function ratioPercent(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) {
    return null;
  }

  return Math.round((part / whole) * 1000) / 10;
}

/** O delta percentual do painel: o mesmo de today-model.ts (sem delta sem os dois lados ou com o anterior zero). */
export function panelPercentDelta(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (typeof current !== "number" || typeof previous !== "number" || !Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) {
    return null;
  }

  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** O delta em pontos para numeros que ja sao porcentagens (41 % contra 39 % = 2 pts). */
export function panelPointsDelta(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (typeof current !== "number" || typeof previous !== "number" || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return null;
  }

  return Math.round((current - previous) * 10) / 10;
}

const integerFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, style: "percent" });

export function panelNumberText(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? integerFormat.format(value) : "—";
}

/** "45,5%" (o mesmo formato do cartao). */
export function panelPercentText(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? percentFormat.format(value / 100) : "—";
}

/** A receita por moeda (M8): "R$ 1.234,56 · US$ 20,00"; sem venda com valor, "—". */
export function formatPanelRevenue(revenue: Readonly<Record<string, number>>): string {
  const parts = Object.entries(revenue)
    .filter(([, cents]) => Number.isFinite(cents) && cents > 0)
    .sort(([left], [right]) => (left === "BRL" ? -1 : right === "BRL" ? 1 : left.localeCompare(right)))
    .map(([currency, cents]) => {
      try {
        return new Intl.NumberFormat("pt-BR", { currency, style: "currency" }).format(cents / 100);
      } catch {
        return `${currency} ${(cents / 100).toFixed(2)}`;
      }
    });

  return parts.length > 0 ? parts.join(" · ") : "—";
}

function addRevenue(into: Record<string, number>, from: Readonly<Record<string, number>>) {
  for (const [currency, cents] of Object.entries(from)) {
    into[currency] = (into[currency] ?? 0) + cents;
  }
}

/** "05/11" (eixo) e "Aula de IA · 05/11/2026 às 20:00" (dica e tabela). */
function shortDate(iso: string): string {
  return saoPauloDate(iso).slice(0, 5);
}

export function panelSessionLabel(session: Pick<PanelSession, "scheduledAt" | "webinarTitle">): string {
  return `${session.webinarTitle} · ${formatSaoPauloDateTime(session.scheduledAt)}`;
}

/* ------------------------------------------------------------------------------------------------
 * Os cartoes do topo (docs/30 §3.2 e §3.3)
 * ---------------------------------------------------------------------------------------------- */

/** O que um painel le de um periodo: as sessoes do recorte e os numeros reais delas. */
export type PanelSnapshot = {
  offersAvailable: boolean;
  period: PanelPeriodStats;
  sessions: readonly PanelSession[];
  stats: ReadonlyMap<string, PanelSessionStats>;
};

export const LIVE_KPI_IDS = [
  "realized",
  "registered",
  "present",
  "attendance",
  "peak",
  "watchAvg",
  "reachedEnd",
  "messages",
  "questionsAnswered",
  "replayViewers"
] as const;
export const RECORDED_KPI_IDS = ["realized", "visitors", "participants", "watchAvg", "reachedEnd", "offerSeen", "clickers", "buyers", "conversion", "revenue"] as const;
export type PanelKpiId = (typeof LIVE_KPI_IDS)[number] | (typeof RECORDED_KPI_IDS)[number];

export type PanelKpi = {
  definition: string | null;
  delta: number | null;
  deltaUnit: "percent" | "points";
  format: "number" | "percent";
  id: PanelKpiId;
  label: string;
  /** Receita: o texto pronto (moedas), sem delta; nos outros, nulo. */
  text: string | null;
  value: number | null;
};

type KpiValues = Partial<Record<PanelKpiId, number | null>>;

function entriesOf(snapshot: PanelSnapshot) {
  return snapshot.sessions.map((session) => ({ session, stats: snapshot.stats.get(session.id) ?? emptyPanelSessionStats() }));
}

/** Tempo medio em minutos: soma do tempo assistido ÷ soma dos presentes das sessoes (docs/30 §3.6). */
function watchAverageMinutes(entries: ReturnType<typeof entriesOf>): number | null {
  const present = sumOf(entries.map((entry) => entry.stats.present));
  return present > 0 ? Math.round(sumOf(entries.map((entry) => entry.stats.watchSum)) / present / 60) : null;
}

/** Pico: o maior numero de presentes num balde; com mais de uma live, a media dos picos (docs/30 §3.2). */
export function panelPeakOf(entries: readonly { stats: PanelSessionStats }[]): number | null {
  const peaks = entries.flatMap((entry) => (entry.stats.peak ? [entry.stats.peak.n] : []));

  if (peaks.length === 0) {
    return null;
  }

  return peaks.length === 1 ? peaks[0] : Math.round(sumOf(peaks) / peaks.length);
}

function liveKpiValues(snapshot: PanelSnapshot): KpiValues {
  const entries = entriesOf(snapshot);
  // Vagas garantidas e Comparecimento sao "dessas sessoes" (as realizadas, docs/30 §3.2): a live de hoje que ainda
  // espera, a que esta no ar e a que o apresentador nunca abriu ficam fora, na mesma base de "Lives realizadas".
  const realized = entries.filter((entry) => entry.session.status === "ended");
  const withRegistration = realized.filter((entry) => entry.session.registrationRequired);
  const asked = sumOf(entries.map((entry) => entry.stats.questions.open + entry.stats.questions.answered + entry.stats.questions.dismissed));

  return {
    attendance: ratioPercent(sumOf(withRegistration.map((entry) => entry.stats.attendedRegistered)), sumOf(withRegistration.map((entry) => entry.stats.registered))),
    messages: sumOf(entries.map((entry) => entry.stats.messages)),
    peak: panelPeakOf(entries),
    present: snapshot.period.present,
    questionsAnswered: ratioPercent(sumOf(entries.map((entry) => entry.stats.questions.answered)), asked),
    reachedEnd: ratioPercent(snapshot.period.reachedEnd, snapshot.period.present),
    realized: realized.length,
    registered: sumOf(realized.map((entry) => entry.stats.registered)),
    replayViewers: snapshot.period.replayViewers,
    watchAvg: watchAverageMinutes(entries)
  };
}

function recordedKpiValues(snapshot: PanelSnapshot): KpiValues {
  const entries = entriesOf(snapshot);
  const offers = snapshot.offersAvailable;

  return {
    buyers: offers ? snapshot.period.buyers : null,
    clickers: offers ? snapshot.period.clickers : null,
    conversion: offers ? ratioPercent(snapshot.period.buyers, snapshot.period.present) : null,
    offerSeen: offers ? snapshot.period.offerSeen : null,
    participants: snapshot.period.present,
    reachedEnd: ratioPercent(snapshot.period.reachedEnd, snapshot.period.present),
    realized: entries.filter((entry) => entry.session.status === "ended").length,
    visitors: snapshot.period.visitors,
    watchAvg: watchAverageMinutes(entries)
  };
}

/** A receita do recorte por moeda (M8); sem a 202610290005, nada. */
export function panelRevenueOf(snapshot: PanelSnapshot): Record<string, number> {
  const revenue: Record<string, number> = {};

  if (!snapshot.offersAvailable) {
    return revenue;
  }

  for (const entry of entriesOf(snapshot)) {
    addRevenue(revenue, entry.stats.revenue);
  }

  return revenue;
}

type KpiSpec = { definition: string | null; format: "number" | "percent"; id: PanelKpiId; label: string };

function liveKpiSpecs(entries: number): KpiSpec[] {
  const card = COPY.cartoes;
  const foot = COPY.rodapes;

  return [
    { definition: foot.livesRealizadas, format: "number", id: "realized", label: card.livesRealizadas },
    { definition: foot.vagasGarantidas, format: "number", id: "registered", label: card.vagasGarantidas },
    { definition: foot.presentes, format: "number", id: "present", label: card.presentes },
    { definition: foot.comparecimento, format: "percent", id: "attendance", label: card.comparecimento },
    { definition: entries > 1 ? foot.picoMedia : foot.picoDePresentes, format: "number", id: "peak", label: card.picoDePresentes },
    { definition: foot.tempoMedio, format: "number", id: "watchAvg", label: card.tempoMedio },
    { definition: foot.viramAteOFim, format: "percent", id: "reachedEnd", label: card.viramAteOFim },
    { definition: foot.mensagens, format: "number", id: "messages", label: card.mensagens },
    { definition: null, format: "percent", id: "questionsAnswered", label: card.perguntasRespondidas },
    { definition: foot.viramOReplay, format: "number", id: "replayViewers", label: card.viramOReplay }
  ];
}

function recordedKpiSpecs(): KpiSpec[] {
  const card = COPY.cartoes;
  const foot = COPY.rodapes;

  return [
    { definition: foot.sessoesRealizadas, format: "number", id: "realized", label: card.sessoesRealizadas },
    { definition: foot.visitantes, format: "number", id: "visitors", label: card.visitantes },
    { definition: foot.participantes, format: "number", id: "participants", label: card.participantes },
    { definition: foot.tempoMedioGravadas, format: "number", id: "watchAvg", label: card.tempoMedio },
    { definition: foot.viramAteOFimGravadas, format: "percent", id: "reachedEnd", label: card.viramAteOFim },
    { definition: foot.viramAOferta, format: "number", id: "offerSeen", label: card.viramAOferta },
    { definition: foot.cliquesNaOferta, format: "number", id: "clickers", label: card.cliquesNaOferta },
    { definition: foot.compras, format: "number", id: "buyers", label: card.compras },
    { definition: foot.conversao, format: "percent", id: "conversion", label: card.conversao },
    { definition: foot.receita, format: "number", id: "revenue", label: card.receita }
  ];
}

/**
 * Os dez cartoes do painel com o delta contra o periodo anterior (mesmo recorte de filtros). Porcentagens comparam em
 * pontos; contagens em %, sem delta quando o anterior e zero. A Receita e texto (moedas) e nao tem delta.
 */
export function panelKpisOf(kind: PanelTabKind, current: PanelSnapshot, previous: PanelSnapshot | null): PanelKpi[] {
  const values = kind === "live" ? liveKpiValues(current) : recordedKpiValues(current);
  const before = previous ? (kind === "live" ? liveKpiValues(previous) : recordedKpiValues(previous)) : null;
  const specs = kind === "live" ? liveKpiSpecs(current.sessions.filter((session) => current.stats.get(session.id)?.peak).length) : recordedKpiSpecs();

  return specs.map((spec) => {
    if (spec.id === "revenue") {
      const text = current.offersAvailable ? formatPanelRevenue(panelRevenueOf(current)) : "—";
      return { ...spec, definition: text === "—" ? COPY.formulas.receitaAMedir : spec.definition, delta: null, deltaUnit: "percent", text, value: null };
    }

    const value = values[spec.id] ?? null;
    const previousValue = before ? (before[spec.id] ?? null) : null;
    const delta = spec.format === "percent" ? panelPointsDelta(value, previousValue) : panelPercentDelta(value, previousValue);

    return { ...spec, delta, deltaUnit: spec.format === "percent" ? "points" : "percent", text: null, value };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Os graficos
 * ---------------------------------------------------------------------------------------------- */

export type RetentionLine = { id: string; label: string; points: { pct: number; value: number }[] };
export type RetentionChart = { average: { pct: number; value: number }[]; lines: RetentionLine[]; sessions: number };

/** Ate quantas sessoes a retencao ganha uma linha fina por sessao (docs/30 §3.2). */
export const RETENTION_LINES_MAX = 5;

/**
 * Retencao media (docs/30 §3.6): cada sessao normalizada pela propria duracao (os 21 pontos de 5 em 5 %) e pelos
 * proprios unicos; depois a media entre as sessoes em cada ponto. Sessao sem ninguem fica fora da media.
 */
export function retentionChartOf(snapshot: PanelSnapshot): RetentionChart | null {
  const entries = entriesOf(snapshot).filter((entry) => entry.stats.retentionBase > 0);

  if (entries.length === 0) {
    return null;
  }

  const curveOf = (stats: PanelSessionStats) =>
    PANEL_RETENTION_POINTS.map((pct, index) => ({ pct, value: Math.round((Math.min(stats.retention[index] ?? 0, stats.retentionBase) / stats.retentionBase) * 1000) / 10 }));
  const curves = entries.map((entry) => ({ entry, points: curveOf(entry.stats) }));
  const average = PANEL_RETENTION_POINTS.map((pct, index) => ({
    pct,
    value: Math.round((sumOf(curves.map((curve) => curve.points[index].value)) / curves.length) * 10) / 10
  }));

  return {
    average,
    lines: curves.length <= RETENTION_LINES_MAX ? curves.map((curve) => ({ id: curve.entry.session.id, label: panelSessionLabel(curve.entry.session), points: curve.points })) : [],
    sessions: curves.length
  };
}

export type TripleBar = { id: string; label: string; longLabel: string; present: number; registered: number; replay: number };

/** Vagas × Presentes × Replay: uma barra tripla por live, na ordem das datas. */
export function tripleBarsOf(snapshot: PanelSnapshot): TripleBar[] {
  return entriesOf(snapshot).map(({ session, stats }) => ({
    id: session.id,
    label: shortDate(session.scheduledAt),
    longLabel: panelSessionLabel(session),
    present: stats.present,
    registered: stats.registered,
    replay: stats.replayViewers
  }));
}

export type OverTimePoint = { id: string; label: string; longLabel: string; present: number; reachedEndPct: number | null };

/** Lives ao longo do tempo (o "Event performance over time" do Zoom): presentes e a % que viu ate o fim, por live. */
export function overTimeOf(snapshot: PanelSnapshot): OverTimePoint[] {
  return entriesOf(snapshot).map(({ session, stats }) => ({
    id: session.id,
    label: shortDate(session.scheduledAt),
    longLabel: panelSessionLabel(session),
    present: stats.present,
    reachedEndPct: ratioPercent(stats.reachedEnd, stats.present)
  }));
}

export type HourRow = { buyers: number; conversion: number | null; hour: number; label: string; participants: number; sessions: number };

/** Por horario do dia (hora de Sao Paulo): sessoes, participantes e conversao de cada hora marcada (D6). */
export function byHourOfDayOf(snapshot: PanelSnapshot): HourRow[] {
  const hours = new Map<number, HourRow>();

  for (const { session, stats } of entriesOf(snapshot)) {
    const hour = saoPauloHourOf(session.scheduledAt);
    const row = hours.get(hour) ?? { buyers: 0, conversion: null, hour, label: COPY.graficos.hora(hour), participants: 0, sessions: 0 };
    row.sessions += 1;
    row.participants += stats.present;
    row.buyers += stats.offer.buyers;
    hours.set(hour, row);
  }

  return [...hours.values()]
    .sort((left, right) => left.hour - right.hour)
    .map((row) => ({ ...row, conversion: snapshot.offersAvailable ? ratioPercent(row.buyers, row.participants) : null }));
}

export type VariantRow = { clicks: number; conversion: number | null; label: OfferVariantLabel; purchases: number; seen: number };

/** Oferta por variante (A/B/C/D): viram, clicaram, compraram e a conversao (compras ÷ quem viu); nulo sem a 202610290005. */
export function offerByVariantOf(snapshot: PanelSnapshot): VariantRow[] | null {
  if (!snapshot.offersAvailable) {
    return null;
  }

  const rows = OFFER_VARIANT_LABELS.map((label) => {
    const seen = sumOf(entriesOf(snapshot).map((entry) => entry.stats.variants[label].seen));
    const clicks = sumOf(entriesOf(snapshot).map((entry) => entry.stats.variants[label].clicks));
    const purchases = sumOf(entriesOf(snapshot).map((entry) => entry.stats.variants[label].purchases));

    return { clicks, conversion: ratioPercent(purchases, seen), label, purchases, seen };
  });

  return rows.filter((row) => row.seen + row.clicks + row.purchases > 0);
}

/* ------------------------------------------------------------------------------------------------
 * A curva minuto a minuto da sessao escolhida (a visao de webinar_report, getWebinarReport)
 * ---------------------------------------------------------------------------------------------- */

export type PresencePoint = { label: string; minute: number; n: number };
export type PresenceDrop = { label: string; minute: number; n: number };
export type PanelPresenceChart = {
  /** Presentes antes de comecar (baldes negativos): so na tabela, na linha "antes de começar". */
  beforeStart: number | null;
  drops: PresenceDrop[];
  durationMinutes: number;
  /** A janela da oferta em minutos (sombreada no grafico da gravada). */
  offerWindow: { from: number; to: number } | null;
  peak: { label: string; n: number } | null;
  points: PresencePoint[];
  table: { label: string; present: number }[];
};

/** A curva da sessao escolhida como a tela recebe: pronta, sem sessao escolhida, banco sem a migracao ou falha. */
export type PanelPresenceResult = { chart: PanelPresenceChart; status: "ok" } | { status: "empty" } | { status: "error" } | { status: "pending_migration" };

/** A curva de uma sessao no eixo de minutos (um ponto por balde de 30 s), os 5 pontos de queda e a janela da oferta. */
export function panelPresenceOf(presence: WebinarReportView["presence"], options: { durationMs: number; offerWindow: PanelOfferWindow | null }): PanelPresenceChart {
  const bucketSeconds = ROOM_RULES.bucketSeconds;
  const minuteOf = (bucket: number) => Math.round(((bucket * bucketSeconds) / 60) * 10) / 10;
  const curve = [...presence.curve].sort((left, right) => left.b - right.b);
  const before = curve.filter((point) => point.b < 0);
  const points = curve.filter((point) => point.b >= 0).map((point) => ({ label: bucketLabel(point.b, bucketSeconds), minute: minuteOf(point.b), n: point.n }));
  const durationMinutes = Math.max(1, Math.ceil(options.durationMs / 60_000), points.length > 0 ? Math.ceil(points[points.length - 1].minute) : 0);
  const offerWindow = options.offerWindow
    ? {
        from: Math.round((options.offerWindow.showOffsetMs / 60_000) * 10) / 10,
        to: Math.round(((options.offerWindow.hideOffsetMs ?? Math.max(options.durationMs, options.offerWindow.showOffsetMs)) / 60_000) * 10) / 10
      }
    : null;
  const beforeStart = before.length > 0 ? Math.max(...before.map((point) => point.n)) : null;

  return {
    beforeStart,
    drops: presence.drops.filter((drop) => drop.b >= 0).map((drop) => ({ label: bucketLabel(drop.b, bucketSeconds), minute: minuteOf(drop.b), n: drop.n })),
    durationMinutes,
    offerWindow: offerWindow && offerWindow.to > offerWindow.from ? offerWindow : null,
    peak: presence.peak ? { label: bucketLabel(presence.peak.b, bucketSeconds), n: presence.peak.n } : null,
    points,
    table: [
      ...(beforeStart !== null ? [{ label: COPY.graficos.antesDeComecar, present: beforeStart }] : []),
      ...curveByMinute(curve, bucketSeconds).map((row) => ({ label: row.label, present: row.present }))
    ]
  };
}

/* ------------------------------------------------------------------------------------------------
 * A tabela "Lives do periodo" / "Sessoes do periodo"
 * ---------------------------------------------------------------------------------------------- */

export const LIVE_TABLE_COLUMNS = [
  "live",
  "produto",
  "data",
  "vagasGarantidas",
  "presentes",
  "comparecimento",
  "pico",
  "tempoMedio",
  "ateOFim",
  "mensagens",
  "perguntas",
  "replay"
] as const;
export const RECORDED_TABLE_COLUMNS = ["webinario", "produto", "horario", "visitantes", "participantes", "tempoMedio", "ateOFim", "viramAOferta", "cliques", "compras", "conversao"] as const;
export type PanelTableColumn = (typeof LIVE_TABLE_COLUMNS)[number] | (typeof RECORDED_TABLE_COLUMNS)[number];

/** Ate quantas linhas a tabela mostra (as mais recentes): o "Comeca quando voce entra" cria dezenas de sessoes por dia. */
export const PANEL_TABLE_ROWS_MAX = 200;

export type PanelTableRow = {
  id: string;
  jit: boolean;
  reportHref: string;
  title: string;
  values: Partial<Record<PanelTableColumn, string>>;
};

export function panelTableColumns(kind: PanelTabKind): readonly PanelTableColumn[] {
  return kind === "live" ? LIVE_TABLE_COLUMNS : RECORDED_TABLE_COLUMNS;
}

/** Uma linha por sessao do recorte, as mais recentes primeiro, com os numeros ja escritos e o link do Relatorio. */
export function panelTableOf(kind: PanelTabKind, snapshot: PanelSnapshot, productNames: Readonly<Record<string, string>>): { rows: PanelTableRow[]; total: number } {
  const entries = entriesOf(snapshot).sort((left, right) => toTime(right.session.scheduledAt) - toTime(left.session.scheduledAt));
  const offers = snapshot.offersAvailable;
  const product = (session: PanelSession) => (session.productId ? (productNames[session.productId] ?? COPY.filtros.produtoSemNome) : COPY.tabela.semProduto);
  const watch = (stats: PanelSessionStats) => (stats.present > 0 ? watchTimeLabel(stats.watchSum / stats.present) : "—");
  const rows = entries.slice(0, PANEL_TABLE_ROWS_MAX).map(({ session, stats }): PanelTableRow => {
    const asked = stats.questions.open + stats.questions.answered + stats.questions.dismissed;
    const values: Partial<Record<PanelTableColumn, string>> =
      kind === "live"
        ? {
            ateOFim: panelPercentText(ratioPercent(stats.reachedEnd, stats.present)),
            comparecimento: session.registrationRequired ? panelPercentText(ratioPercent(stats.attendedRegistered, stats.registered)) : "—",
            data: formatSaoPauloDateTime(session.scheduledAt),
            live: session.webinarTitle,
            mensagens: panelNumberText(stats.messages),
            perguntas: COPY.tabela.perguntasDe(stats.questions.answered, asked),
            pico: stats.peak ? panelNumberText(stats.peak.n) : "—",
            presentes: panelNumberText(stats.present),
            produto: product(session),
            replay: panelNumberText(stats.replayViewers),
            tempoMedio: watch(stats),
            vagasGarantidas: panelNumberText(stats.registered)
          }
        : {
            ateOFim: panelPercentText(ratioPercent(stats.reachedEnd, stats.present)),
            cliques: offers ? panelNumberText(stats.offer.clickers) : "—",
            compras: offers ? panelNumberText(stats.offer.purchases) : "—",
            conversao: offers ? panelPercentText(ratioPercent(stats.offer.buyers, stats.present)) : "—",
            horario: formatSaoPauloDateTime(session.scheduledAt),
            participantes: panelNumberText(stats.present),
            produto: product(session),
            tempoMedio: watch(stats),
            viramAOferta: offers ? panelNumberText(stats.offer.seen) : "—",
            visitantes: panelNumberText(stats.visitors),
            webinario: session.webinarTitle
          };

    return { id: session.id, jit: session.jit, reportHref: webinarReportHref(session.webinarId, session.id), title: session.webinarTitle, values };
  });

  return { rows, total: entries.length };
}

/* ------------------------------------------------------------------------------------------------
 * O bloco Simulacao (docs/30 §3.5; D6, D10, M6): a UNICA leitura das linhas sim_*
 * ---------------------------------------------------------------------------------------------- */

export type PanelSimulationView = {
  /** Banco com a 202610290005 (sem ela, tudo "—"). */
  available: boolean;
  badge: { on: number; total: number };
  counterMax: number | null;
  joinsShown: number | null;
  /** O numero real ao lado do contador, para a equipe comparar (lido dos cartoes; nunca o contrario). */
  realParticipants: number | null;
  rules: string[];
  saleNoticesShown: number | null;
  scriptFired: number | null;
};

function ruleText(rule: SessionSimulation["countRule"]): string | null {
  if (rule.mode === "fixed") {
    return COPY.simulacao.regras.fixed(rule.base);
  }

  if (rule.mode === "curve") {
    return COPY.simulacao.regras.curve(rule.base, rule.peak);
  }

  return null;
}

/**
 * O bloco Simulacao do painel Lives gravadas: o selo "Ao vivo" (quantas sessoes ligaram, D10), as regras do contador e
 * o maior numero mostrado, as entradas e os avisos de venda que apareceram e os comentarios do roteiro disparados. Le
 * so as linhas sim_* (o resumo congelado no fim de cada sessao) e as regras; nada daqui volta para outro numero.
 */
export function panelSimulationOf(input: {
  realParticipants: number | null;
  rows: readonly PanelRow[];
  sessions: readonly PanelSession[];
  simulations: readonly SessionSimulation[] | null;
}): PanelSimulationView {
  const ids = new Set(input.sessions.map((session) => session.id));
  const available = input.simulations !== null;
  const sim = input.rows.filter((row) => row.sessionId !== null && ids.has(row.sessionId) && (SIMULATION_METRICS as readonly string[]).includes(row.metric));
  const totalOf = (metric: (typeof SIMULATION_METRICS)[number]) => sumOf(sim.filter((row) => row.metric === metric).map((row) => row.total));
  const counters = sim.filter((row) => row.metric === "sim_counter").map((row) => row.total);
  const rules = [...new Set((input.simulations ?? []).filter((simulation) => ids.has(simulation.sessionId)).flatMap((simulation) => ruleText(simulation.countRule) ?? []))];

  return {
    available,
    badge: { on: input.sessions.filter((session) => session.showLiveBadge).length, total: input.sessions.length },
    counterMax: available && counters.length > 0 ? Math.max(...counters) : null,
    joinsShown: available ? totalOf("sim_joins") : null,
    realParticipants: input.realParticipants,
    rules,
    saleNoticesShown: available ? totalOf("sim_sales") : null,
    scriptFired: available ? totalOf("sim_script") : null
  };
}

/* ------------------------------------------------------------------------------------------------
 * A visao inteira de uma aba
 * ---------------------------------------------------------------------------------------------- */

export type PanelOption = { id: string; label: string };

export type PanelFilterOptions = {
  hosts: PanelOption[];
  hours: number[];
  products: PanelOption[];
  variants: OfferVariantLabel[];
  webinars: PanelOption[];
  /** "Com oferta" so aparece quando algum webinario do periodo tem Oferta (e o banco tem a 202610290005). */
  withOffer: boolean;
};

/** "never": nenhuma sessao deste tipo existe; "period": nenhuma no periodo; "filtered": os filtros tiraram todas. */
export type PanelEmpty = "never" | "period" | "filtered" | null;

export type PanelView = {
  empty: PanelEmpty;
  /** A janela do periodo (minutos inteiros) e os parametros dos filtros: o menu Exportar repassa. */
  exportWindow: { end: string; start: string };
  filterOptions: PanelFilterOptions;
  filterParams: Record<string, string>;
  filters: PanelFilters;
  hasFilters: boolean;
  kind: PanelTabKind;
  kpis: PanelKpi[];
  offersAvailable: boolean;
  overTime: OverTimePoint[];
  presence: { durationMs: number; offerWindow: PanelOfferWindow | null; options: PanelOption[]; selectedId: string | null };
  retention: RetentionChart | null;
  simulation: PanelSimulationView | null;
  table: { rows: PanelTableRow[]; total: number };
  tripleBars: TripleBar[];
  byHour: HourRow[];
  variants: VariantRow[] | null;
};

function optionsOf(entries: Iterable<[string, string]>): PanelOption[] {
  return [...new Map(entries).entries()].map(([id, label]) => ({ id, label })).sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));
}

/** As opcoes dos filtros saem das sessoes do periodo inteiro (nao do recorte): da para trocar de um para outro. */
export function panelFilterOptionsOf(input: {
  hostNames: Readonly<Record<string, string>>;
  offers: PanelOfferFacts | null;
  productNames: Readonly<Record<string, string>>;
  sessions: readonly PanelSession[];
}): PanelFilterOptions {
  const sessions = input.sessions;
  const variants = new Set<OfferVariantLabel>();

  for (const session of sessions) {
    for (const label of input.offers ? sessionVariants(session, input.offers) : []) {
      variants.add(label);
    }
  }

  return {
    hosts: optionsOf(sessions.flatMap((session) => (session.hostUserId ? [[session.hostUserId, input.hostNames[session.hostUserId] ?? COPY.filtros.equipe] as [string, string]] : []))),
    hours: [...new Set(sessions.map((session) => saoPauloHourOf(session.scheduledAt)))].sort((left, right) => left - right),
    products: optionsOf(sessions.flatMap((session) => (session.productId ? [[session.productId, input.productNames[session.productId] ?? COPY.filtros.produtoSemNome] as [string, string]] : []))),
    variants: OFFER_VARIANT_LABELS.filter((label) => variants.has(label)),
    webinars: optionsOf(sessions.map((session) => [session.webinarId, session.webinarTitle] as [string, string])),
    withOffer: Boolean(input.offers && sessions.some((session) => sessionHasOffer(session, input.offers as PanelOfferFacts)))
  };
}

/** As sessoes da curva: as que ja aconteceram (ou estao no ar), a mais recente primeiro. */
export function presenceOptionsOf(sessions: readonly PanelSession[]): PanelOption[] {
  return sessions
    .filter((session) => panelSessionSituation(session) === "realized")
    .sort((left, right) => toTime(right.scheduledAt) - toTime(left.scheduledAt))
    .map((session) => ({ id: session.id, label: panelSessionLabel(session) }));
}

export type BuildPanelViewInput = {
  /** Existe alguma sessao deste tipo (para "Sem lives ao vivo ainda"). */
  everHadSessions: boolean;
  filters: PanelFilters;
  hostNames: Readonly<Record<string, string>>;
  kind: PanelTabKind;
  offers: PanelOfferFacts | null;
  previousRows: readonly PanelRow[];
  previousSelected: readonly PanelSession[];
  productNames: Readonly<Record<string, string>>;
  rows: readonly PanelRow[];
  /** Todas as sessoes do periodo (para as opcoes dos filtros) e o recorte. */
  selected: readonly PanelSession[];
  sessionParam: string | null;
  sessions: readonly PanelSession[];
  simulations: readonly SessionSimulation[] | null;
  window: { end: string; start: string };
};

/** A aba inteira a partir das sessoes, do recorte e das linhas da RPC (o atual e o periodo anterior). */
export function buildPanelView(input: BuildPanelViewInput): PanelView {
  const offersAvailable = input.offers !== null;
  const current: PanelSnapshot = { offersAvailable, period: panelPeriodStatsOf(input.rows), sessions: input.selected, stats: panelSessionStatsOf(input.rows) };
  const previous: PanelSnapshot | null =
    input.previousSelected.length > 0
      ? { offersAvailable, period: panelPeriodStatsOf(input.previousRows), sessions: input.previousSelected, stats: panelSessionStatsOf(input.previousRows) }
      : null;
  const hasFilters = hasPanelFilters(input.kind, input.filters);
  const empty: PanelEmpty = input.selected.length > 0 ? null : hasFilters ? "filtered" : input.sessions.length === 0 && !input.everHadSessions ? "never" : "period";
  const options = presenceOptionsOf(input.selected);
  const selectedId = input.sessionParam && options.some((option) => option.id === input.sessionParam) ? input.sessionParam : (options[0]?.id ?? null);
  const kpis = panelKpisOf(input.kind, current, previous);
  const participants = kpis.find((kpi) => kpi.id === "participants")?.value ?? null;

  return {
    byHour: input.kind === "simulated" ? byHourOfDayOf(current) : [],
    empty,
    exportWindow: input.window,
    filterOptions: panelFilterOptionsOf({ hostNames: input.hostNames, offers: input.offers, productNames: input.productNames, sessions: input.sessions }),
    filterParams: panelFilterParams(input.kind, input.filters),
    filters: input.filters,
    hasFilters,
    kind: input.kind,
    kpis,
    offersAvailable,
    overTime: input.kind === "live" ? overTimeOf(current) : [],
    presence: {
      durationMs: selectedId ? (current.stats.get(selectedId)?.durationMs ?? 0) : 0,
      offerWindow: selectedId && input.offers ? (input.offers.displays.get(selectedId) ?? null) : null,
      options,
      selectedId
    },
    retention: retentionChartOf(current),
    simulation: input.kind === "simulated" ? panelSimulationOf({ realParticipants: participants, rows: input.rows, sessions: input.selected, simulations: input.simulations }) : null,
    table: panelTableOf(input.kind, current, input.productNames),
    tripleBars: input.kind === "live" ? tripleBarsOf(current) : [],
    variants: input.kind === "simulated" ? offerByVariantOf(current) : null
  };
}

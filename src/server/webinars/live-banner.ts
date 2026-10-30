// A faixa do topo de todas as paginas da area (docs/30 §1.1, §1.5, §1.7 e §2.7; A16 e A24), a parte pura: o que
// GET /api/webinars/live-now devolve (as lives no ar e a "Comeca em" de quem garantiu vaga) e o que a faixa mostra.
//
// A escolha, com `nowMs`: no ar > comeca em N min > nada. No ar = a Live ao vivo com a sessao `live` (so com a sala
// neste ambiente: sem ela a pagina diz "em breve" e a faixa nao chama ninguem) e a Live gravada so com o selo ligado
// na sessao (show_live_badge, A16), na fase `live` do relogio e com a entrada aberta (Entrada atrasada). Mais recente
// primeiro (o inicio de verdade; na gravada, a hora marcada), uma por webinario; com duas ou mais, "+1 ao vivo" leva
// a /webinarios (§1.5). "Comeca em": so para quem garantiu vaga, de 60 min antes ate a hora marcada (bannerWindow), a
// mais proxima primeiro. Tudo so com "Faixa no topo" ligada (show_banner) e nunca num webinario cancelado; quem le o
// banco (a rota) ja deixou de fora o que o aluno nao pode ver (access.ts). O Entrar leva a sala quando ela abre agora
// para o aluno; com limite de vagas e sem a vaga (A12), a pagina do Webinario (la ele garante e entra). As sessoes do
// "Comeca quando voce entra" (fase 4e, `jit`) nunca entram na faixa: cada uma e a sessao de quem chegou naquele horario,
// nunca uma live no ar para todos (nem com o selo ligado), e nao tem vaga para a "Comeca em".
//
// Na tela: o X dispensa por 1 dia naquele navegador (o mapa chave -> ate quando, em localStorage pela faixa; aqui so a
// leitura e a escrita do texto guardado), a resposta da rota conferida antes de desenhar (so links internos de
// /webinarios) e os caminhos onde a faixa nunca aparece (a sala, o login, o Modo TV). Sem "server-only", imports
// relativos: tests/webinarios-faixa-ao-vivo.test.mjs carrega direto pelo Node. Nada aqui le o banco nem o relogio.

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { WEBINAR_ROOM_PATH } from "../../lib/webinar-paths";
import { bannerWindow, REMINDER_RULES, toTime, webinarHref, type Webinar, type WebinarRegistration, type WebinarSession } from "./model";
import { isJitSession } from "./jit-model";
import { canJoinSimulated, simulatedPhase } from "./room-model";
import { registrationFor, roomHref, seatRequired } from "./student-model";

/* ------------------------------------------------------------------------------------------------
 * A resposta da rota
 * ---------------------------------------------------------------------------------------------- */

/** Uma live no ar: o titulo, o Entrar e o inicio (ISO). Nada do nome da sala, de token ou de outro aluno. */
export type LiveNowItem = { href: string; startedAt: string; title: string };

/** A "Comeca em" de quem garantiu vaga: o titulo, o Entrar e a hora marcada (ISO). */
export type LiveSoonItem = { href: string; scheduledAt: string; title: string };

/** `data` de GET /api/webinars/live-now. */
export type LiveNowData = { live: LiveNowItem[]; serverTime: string; soon: LiveSoonItem | null };

/** De quanto em quanto a faixa pergunta de novo (e ao voltar para a aba). */
export const LIVE_NOW_POLL_MS = 60_000;
/** Ao voltar para a aba, so pergunta de novo se a ultima resposta tem pelo menos isto. */
export const LIVE_NOW_REVISIT_MS = 15_000;
/** Sessoes marcadas ate 24 h atras ainda entram na conta (uma live que comecou atrasada e ainda esta no ar). */
export const LIVE_NOW_LOOKBACK_MS = 24 * 60 * 60_000;
/** As sessoes que podem virar "Comeca em": ate 60 min a frente (docs/30 §1.1). */
export const LIVE_NOW_LOOKAHEAD_MS = REMINDER_RULES.bannerMinutesBefore * 60_000;
/** Quantas lives no ar a resposta leva, no maximo (a faixa mostra uma e conta as outras). */
export const LIVE_NOW_MAX_ITEMS = 20;

export const EMPTY_LIVE_NOW: Omit<LiveNowData, "serverTime"> = { live: [], soon: null };

/** O que a escolha precisa de um webinario que o aluno pode ver: as sessoes, as vagas dele e a duracao do video. */
export type LiveBannerEntry = {
  /** A duracao do video da sessao gravada (ms), quando a gravacao e conhecida; senao a prevista do webinario. */
  durationMsBySession?: ReadonlyMap<string, number>;
  registrations: readonly WebinarRegistration[];
  sessions: readonly WebinarSession[];
  webinar: Pick<Webinar, "cancelledAt" | "capacity" | "durationMinutes" | "registrationRequired" | "showBanner" | "slug" | "title">;
};

function durationMsOf(entry: LiveBannerEntry, session: WebinarSession): number {
  return entry.durationMsBySession?.get(session.id) ?? Math.max(1, entry.webinar.durationMinutes) * 60_000;
}

/**
 * Se a sessao esta no ar agora para a faixa (a Live ao vivo pela situacao; a gravada pelo selo e pelo relogio). A sessao
 * do "Comeca quando voce entra" nunca.
 */
export function sessionOnAir(session: WebinarSession, durationMs: number, input: { meetConfigured: boolean; nowMs: number }): boolean {
  if (session.kind === "live") {
    return input.meetConfigured && session.status === "live";
  }
  if (session.kind !== "simulated" || !session.showLiveBadge || isJitSession(session)) {
    return false;
  }
  return simulatedPhase(session, durationMs, input.nowMs) === "live" && canJoinSimulated(session, durationMs, input.nowMs).ok;
}

/** Se a sala desta sessao abre agora para o aluno (a Live ao vivo aberta pela equipe; a gravada 15 min antes). */
export function sessionRoomOpen(session: WebinarSession, durationMs: number, input: { meetConfigured: boolean; nowMs: number }): boolean {
  if (session.kind === "live") {
    return input.meetConfigured && (session.status === "waiting" || session.status === "live");
  }
  return session.kind === "simulated" && canJoinSimulated(session, durationMs, input.nowMs).ok;
}

/** O inicio que ordena as lives no ar: o de verdade na Live ao vivo (sem ele, a hora marcada); a hora marcada na gravada. */
function startedAtOf(session: WebinarSession): string {
  return session.kind === "live" ? (session.startedAt ?? session.scheduledAt) : session.scheduledAt;
}

/**
 * A escolha da faixa a partir das linhas ja lidas (so os webinarios que o aluno pode ver): as lives no ar (mais
 * recente primeiro, uma por webinario) e a "Comeca em" mais proxima de quem garantiu vaga.
 */
export function chooseLiveNow(input: { entries: readonly LiveBannerEntry[]; meetConfigured: boolean; nowMs: number }): Omit<LiveNowData, "serverTime"> {
  const clock = { meetConfigured: input.meetConfigured, nowMs: input.nowMs };
  const live: LiveNowItem[] = [];
  const soon: LiveSoonItem[] = [];

  for (const entry of input.entries) {
    const { webinar } = entry;
    if (webinar.cancelledAt || !webinar.showBanner) {
      continue;
    }
    let onAir: LiveNowItem | null = null;

    for (const session of entry.sessions) {
      if (session.kind === "replay" || isJitSession(session) || session.status === "cancelled" || session.status === "ended") {
        continue;
      }
      const durationMs = durationMsOf(entry, session);
      const registered = registrationFor(entry.registrations, session.id) !== null;
      // Com limite de vagas so quem garantiu entra (A12): sem a vaga, o Entrar leva a pagina, onde ele garante.
      const seatMissing = seatRequired(webinar, session) && !registered;
      const enterHref = seatMissing ? webinarHref(webinar.slug) : roomHref(webinar.slug, session.id);

      if (sessionOnAir(session, durationMs, clock)) {
        const item = { href: enterHref, startedAt: startedAtOf(session), title: webinar.title };
        if (!onAir || toTime(item.startedAt) > toTime(onAir.startedAt)) {
          onAir = item;
        }
        continue;
      }

      if (registered && (session.status === "scheduled" || session.status === "waiting") && bannerWindow(session.scheduledAt, input.nowMs) === "soon") {
        soon.push({
          href: sessionRoomOpen(session, durationMs, clock) ? roomHref(webinar.slug, session.id) : webinarHref(webinar.slug),
          scheduledAt: session.scheduledAt,
          title: webinar.title
        });
      }
    }

    if (onAir) {
      live.push(onAir);
    }
  }

  live.sort((a, b) => toTime(b.startedAt) - toTime(a.startedAt) || a.title.localeCompare(b.title, "pt-BR"));
  soon.sort((a, b) => toTime(a.scheduledAt) - toTime(b.scheduledAt) || a.title.localeCompare(b.title, "pt-BR"));
  return { live: live.slice(0, LIVE_NOW_MAX_ITEMS), soon: soon[0] ?? null };
}

/* ------------------------------------------------------------------------------------------------
 * O Entrar da Live ao vivo na pagina do Webinario (docs/30 §1.2)
 * ---------------------------------------------------------------------------------------------- */

/**
 * O que o Entrar da Live ao vivo mostra: `unavailable` sem a sala neste ambiente (desligado, "em breve"); `enter` com a
 * sala aberta pela equipe (waiting) ou no ar (live); `countdown` antes da hora marcada; `waiting` da hora marcada ate a
 * equipe abrir (Aguardando o apresentador, sem link: o join-token recusaria com not_started); `ended` encerrada ou
 * cancelada. A pagina reconsulta a cada 15 s de 15 min antes da hora ate a sala abrir (LIVE_ROOM_REFRESH_MS).
 */
export type LiveEnterState = "countdown" | "ended" | "enter" | "unavailable" | "waiting";

export function liveEnterState(session: Pick<WebinarSession, "scheduledAt" | "status">, input: { liveRoomConfigured: boolean; nowMs: number }): LiveEnterState {
  if (session.status === "ended" || session.status === "cancelled") {
    return "ended";
  }
  if (!input.liveRoomConfigured) {
    return "unavailable";
  }
  if (session.status === "waiting" || session.status === "live") {
    return "enter";
  }
  return input.nowMs < toTime(session.scheduledAt) ? "countdown" : "waiting";
}

/** De quanto em quanto a pagina da Live ao vivo pergunta de novo se a equipe ja abriu a sala. */
export const LIVE_ROOM_REFRESH_MS = 15_000;
/** A pagina comeca a perguntar este tanto antes da hora marcada (a equipe pode abrir a sala antes). */
export const LIVE_ROOM_WATCH_MINUTES_BEFORE = 15;

/** Se a pagina deve reconsultar agora: so na Live ao vivo ainda nao aberta, com a sala no ambiente, perto da hora. */
export function shouldWatchLiveRoom(session: Pick<WebinarSession, "kind" | "scheduledAt" | "status">, input: { liveRoomConfigured: boolean; nowMs: number }): boolean {
  return (
    input.liveRoomConfigured &&
    session.kind === "live" &&
    session.status === "scheduled" &&
    input.nowMs >= toTime(session.scheduledAt) - LIVE_ROOM_WATCH_MINUTES_BEFORE * 60_000 &&
    input.nowMs < toTime(session.scheduledAt) + REMINDER_RULES.autoEndMinutesAfter * 60_000
  );
}

/* ------------------------------------------------------------------------------------------------
 * A resposta conferida no navegador
 * ---------------------------------------------------------------------------------------------- */

const INTERNAL_HREF = /^\/webinarios\/[a-z0-9][a-z0-9-]{2,63}(\/sala\?sessao=[0-9a-f-]{36})?$/;
const MAX_TITLE = 200;

function isIso(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function isTitle(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TITLE;
}

/** Um link da faixa: so a pagina de um Webinario ou a sala dele (nunca um endereco de fora). */
export function isLiveBannerHref(value: unknown): value is string {
  return typeof value === "string" && INTERNAL_HREF.test(value);
}

/** O `data` da rota conferido: forma errada ou link de fora = nulo (a faixa nao desenha nada). */
export function parseLiveNowData(value: unknown): LiveNowData | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const data = value as { live?: unknown; serverTime?: unknown; soon?: unknown };
  if (!isIso(data.serverTime) || !Array.isArray(data.live)) {
    return null;
  }
  const live: LiveNowItem[] = [];
  for (const item of data.live.slice(0, LIVE_NOW_MAX_ITEMS)) {
    const candidate = item as Partial<LiveNowItem> | null;
    if (!candidate || !isLiveBannerHref(candidate.href) || !isIso(candidate.startedAt) || !isTitle(candidate.title)) {
      return null;
    }
    live.push({ href: candidate.href, startedAt: candidate.startedAt, title: candidate.title });
  }
  let soon: LiveSoonItem | null = null;
  if (data.soon !== null && data.soon !== undefined) {
    const candidate = data.soon as Partial<LiveSoonItem>;
    if (!isLiveBannerHref(candidate.href) || !isIso(candidate.scheduledAt) || !isTitle(candidate.title)) {
      return null;
    }
    soon = { href: candidate.href, scheduledAt: candidate.scheduledAt, title: candidate.title };
  }
  return { live, serverTime: data.serverTime, soon };
}

/* ------------------------------------------------------------------------------------------------
 * O que a faixa mostra
 * ---------------------------------------------------------------------------------------------- */

/** "Comeca em 1 h: Entrar" (60 min) ou "Comeca em 12 min: Entrar" (a conta desce); "" fora da janela (a faixa some). */
export function soonLabel(scheduledAt: string, nowMs: number): string {
  if (bannerWindow(scheduledAt, nowMs) !== "soon") {
    return "";
  }
  const minutes = Math.ceil((toTime(scheduledAt) - nowMs) / 60_000);
  return minutes >= REMINDER_RULES.bannerMinutesBefore ? WEBINAR_COPY.faixa.comecaEm1h : WEBINAR_COPY.faixa.comecaEmMin(minutes);
}

function slugOf(href: string): string {
  return /^\/webinarios\/([a-z0-9-]+)/.exec(href)?.[1] ?? href;
}

/** A chave da dispensa: a live pelo endereco da sala; a "Comeca em" pelo webinario e a hora (o link muda quando a sala abre). */
export function liveBannerKey(item: { kind: "live"; href: string } | { kind: "soon"; href: string; scheduledAt: string }): string {
  return item.kind === "live" ? `live:${item.href}` : `soon:${slugOf(item.href)}:${item.scheduledAt}`;
}

export type LiveBannerView =
  | { href: string; key: string; kind: "live"; /** Quantas outras lives estao no ar ("+1 ao vivo"). */ more: number; title: string }
  | { href: string; key: string; kind: "soon"; label: string; title: string };

/** A faixa de agora: a live no ar mais recente que nao foi dispensada; sem ela, a "Comeca em"; sem as duas, nada. */
export function liveBannerView(data: Pick<LiveNowData, "live" | "soon"> | null, nowMs: number, dismissals: Readonly<Record<string, number>> = {}): LiveBannerView | null {
  if (!data) {
    return null;
  }
  const live = data.live.filter((item) => !isDismissed(dismissals, liveBannerKey({ href: item.href, kind: "live" }), nowMs));
  const top = live[0];
  if (top) {
    return { href: top.href, key: liveBannerKey({ href: top.href, kind: "live" }), kind: "live", more: live.length - 1, title: top.title };
  }
  const soon = data.soon;
  if (!soon) {
    return null;
  }
  const key = liveBannerKey({ href: soon.href, kind: "soon", scheduledAt: soon.scheduledAt });
  const label = soonLabel(soon.scheduledAt, nowMs);
  return label && !isDismissed(dismissals, key, nowMs) ? { href: soon.href, key, kind: "soon", label, title: soon.title } : null;
}

/* ------------------------------------------------------------------------------------------------
 * O X: dispensa por 1 dia naquele navegador
 * ---------------------------------------------------------------------------------------------- */

export const LIVE_BANNER_STORAGE_KEY = "bunker707:webinar-faixa";
export const LIVE_BANNER_DISMISS_MS = 24 * 60 * 60_000;
const MAX_DISMISSALS = 50;

/** O mapa guardado (chave -> ate quando, ms), sem as vencidas e sem lixo; texto estragado = mapa vazio. */
export function parseDismissals(raw: string | null | undefined, nowMs: number): Record<string, number> {
  if (!raw) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const map: Record<string, number> = {};
  for (const [key, until] of Object.entries(parsed as Record<string, unknown>)) {
    if (key.length <= 300 && typeof until === "number" && Number.isFinite(until) && until > nowMs && until <= nowMs + LIVE_BANNER_DISMISS_MS) {
      map[key] = until;
    }
  }
  return map;
}

/** O mapa com mais uma dispensa (ate agora + 1 dia), sem as vencidas e com no maximo as 50 mais novas. */
export function withDismissal(map: Readonly<Record<string, number>>, key: string, nowMs: number): Record<string, number> {
  const entries = Object.entries(map).filter(([other, until]) => other !== key && until > nowMs);
  entries.push([key, nowMs + LIVE_BANNER_DISMISS_MS]);
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, MAX_DISMISSALS));
}

export function isDismissed(map: Readonly<Record<string, number>>, key: string, nowMs: number): boolean {
  const until = map[key];
  return typeof until === "number" && until > nowMs;
}

/* ------------------------------------------------------------------------------------------------
 * Onde a faixa aparece
 * ---------------------------------------------------------------------------------------------- */

const NEVER_ON = [WEBINAR_ROOM_PATH, /^\/(login|tv|auth|alterar-senha|admin)(\/|$)/];

/** Todas as paginas da area, menos a propria sala (/webinarios/<slug>/sala), o login e o Modo TV (docs/30 §1.1). */
export function liveBannerAllowedOn(pathname: string | null | undefined): boolean {
  if (!pathname || !pathname.startsWith("/")) {
    return false;
  }
  const path = pathname.split(/[?#]/)[0]!.toLowerCase();
  return !NEVER_ON.some((pattern) => pattern.test(path));
}

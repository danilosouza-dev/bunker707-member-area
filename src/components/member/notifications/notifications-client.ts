"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useSyncExternalStore } from "react";
import type { ReactionId } from "@/server/communications/interactions-model";
import type {
  NotificationAudioProgress,
  NotificationItem,
  NotificationPoll,
  NotificationResponseValue,
  NotificationsFilter,
  NotificationsPage,
  NotificationsSummary
} from "@/server/communications/notification-model";
import type { PopupEvent } from "@/server/communications/campaign-model";
import { INBOX_KEEP_MS, INBOX_REUSE_MS, isSummaryFresh } from "./notifications-model";

// Conversa do sino e do pop-up com /api/notifications e /api/popups (docs/22 §4.4), mais o numero do
// sino guardado na memoria do navegador. O topo (AppShell) remonta a cada pagina; o numero fica aqui,
// fora do React, vale por 1 minuto (SUMMARY_TTL_MS) e e buscado de novo quando a aba volta a ficar
// visivel e ja passou desse tempo. Cada chamada a API custa uma conferencia de sessao no Auth, entao
// nada aqui roda em intervalo, uma falha tambem conta como tentativa (espera o mesmo minuto) e, na
// home, o resumo com o pop-up (MemberPopupHost) e a unica leitura: o numero do sino vem junto.
//
// Envios que podem sair junto com a pagina (clique num link, eventos do pop-up, o ouvido do audio com a
// aba escondida ou o painel fechando) vao por navigator.sendBeacon, com fetch keepalive de reserva. O
// resto do audio (comecou, cresceu tocando, pausa e fim) vai por fetch: a resposta atualiza a lista.
//
// v3a (docs/24 §5.1 e §7.3): reagir, votar e excluir do sino; a primeira pagina guardada entre aberturas
// (busca por intencao, no maximo um pedido em andamento) e o Esc que fica dentro do seletor de reacoes.
//
// Ajustes da v3a: a memoria (o numero do sino e a primeira pagina) tem dono, o id do aluno que o topo
// passa (AppShell -> MemberNotificationsMenu -> painel). O login troca de pagina sem recarregar
// (router.replace): sem o dono, a conta seguinte via o numero e a pagina da anterior. Outro id = nada do
// que estava guardado vale, e a resposta de um pedido feito para o dono anterior nao e guardada.

export class NotificationsRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "NotificationsRequestError";
    this.status = status;
  }
}

async function readData<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string };

  if (!response.ok || payload.data === undefined) {
    // 4xx traz a frase do servidor; 5xx e falha de rede ficam com a frase da tela.
    const message = response.status >= 400 && response.status < 500 && payload.error ? payload.error : fallback;
    throw new NotificationsRequestError(message, response.status);
  }

  return payload.data;
}

async function getJson<T>(url: string, fallback: string, signal?: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal });
  return readData<T>(response, fallback);
}

async function postJson<T>(url: string, body: unknown, fallback: string) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });

  return readData<T>(response, fallback);
}

/**
 * POST que sobrevive a saida da pagina; nunca lanca (registro de clique, evento e visita e melhor esforco).
 * Tambem usado pelo beacon das visitas de pagina (page-visit-beacon.ts).
 */
export function sendBeaconPost(url: string, body?: string) {
  try {
    const data = body === undefined ? undefined : new Blob([body], { type: "text/plain;charset=UTF-8" });

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url, data)) {
      return;
    }
  } catch {
    // Sem beacon (ou recusado): vai pelo fetch keepalive.
  }

  void fetch(url, {
    body,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "text/plain;charset=UTF-8" },
    keepalive: true,
    method: "POST"
  }).catch(() => undefined);
}

function notificationPath(id: string, action: "audio" | "click" | "hide" | "poll" | "reaction" | "response") {
  return `/api/notifications/${encodeURIComponent(id)}/${action}`;
}

export function fetchNotificationsPage(input: { cursor?: string | null; filter: NotificationsFilter; signal?: AbortSignal }) {
  const params = new URLSearchParams();

  if (input.filter === "unread") {
    params.set("filter", "unread");
  }

  if (input.cursor) {
    params.set("cursor", input.cursor);
  }

  const query = params.toString();

  return getJson<NotificationsPage>(
    query ? `/api/notifications?${query}` : "/api/notifications",
    "Não foi possível carregar as notificações.",
    input.signal
  );
}

export function fetchSummary(input: { popup?: boolean; signal?: AbortSignal } = {}) {
  return getJson<NotificationsSummary>(
    input.popup ? "/api/notifications/summary?popup=1" : "/api/notifications/summary",
    "Não foi possível carregar as notificações.",
    input.signal
  );
}

/**
 * `asOf` (a hora do servidor que veio com a primeira pagina): "abriu o sino" e "Marcar todas" so mexem
 * no que ja aparecia quando a lista foi lida. `shown`: avisos que o painel mostrou e que chegaram ha
 * menos de 15 s (recentFlowIds), para as linhas de fluxo recem-gravadas tambem contarem.
 */
export type ReadRequest =
  | { asOf?: string; seen: true; shown?: string[] }
  | { ids: string[] }
  | { all: true; asOf?: string; shown?: string[] };

export function postRead(body: ReadRequest) {
  return postJson<{ unread: number; unseen: number }>("/api/notifications/read", body, "Não foi possível marcar como lida.");
}

/** Clique num link ou botao da notificacao (tambem marca como lida no servidor). */
export function postClick(id: string) {
  sendBeaconPost(notificationPath(id, "click"));
}

/** Aceitar/Recusar, e a troca depois (v3a): `changed` diz se a resposta que valia mudou. */
export function postResponse(id: string, response: NotificationResponseValue) {
  return postJson<{ changed?: boolean; response: NotificationResponseValue }>(
    notificationPath(id, "response"),
    { response },
    "Não foi possível enviar sua resposta. Tente de novo."
  );
}

/** Reacao do aluno (null = tirar). Devolve a que ficou valendo. */
export function postReaction(id: string, reaction: ReactionId | null) {
  return postJson<{ reaction: ReactionId | null }>(notificationPath(id, "reaction"), { reaction }, "Não foi possível reagir. Tente de novo.");
}

/** Voto na enquete ([] = tirar o voto). Devolve a enquete como o aluno pode ver agora. */
export function postPollVote(id: string, optionIds: readonly string[]) {
  return postJson<{ poll: NotificationPoll }>(
    notificationPath(id, "poll"),
    { optionIds },
    "Não foi possível registrar seu voto. Tente de novo."
  );
}

/** Excluir do sino (so para este aluno) ou desfazer. Devolve os contadores. */
export function postHide(id: string, hidden: boolean) {
  return postJson<{ unread: number; unseen: number }>(
    notificationPath(id, "hide"),
    { hidden },
    hidden ? "Não foi possível excluir. Tente de novo." : "Não foi possível desfazer. Tente de novo."
  );
}

export type AudioRequest = { event: "started" } | { event: "progress"; heard: string };

/** "started" tambem devolve os contadores (substitui o POST /read {ids} do primeiro play). */
export type AudioAnswer = { audioProgress: NotificationAudioProgress; unread?: number; unseen?: number };

/** Audio do aviso no sino: comecou ou o ouvido cresceu (a resposta substitui o estado da lista). */
export function postAudio(id: string, body: AudioRequest) {
  return postJson<AudioAnswer>(notificationPath(id, "audio"), body, "Não foi possível guardar o áudio ouvido.");
}

/** O ouvido quando a pagina pode sair (aba escondida, saida, painel fechando): a resposta nao e lida. */
export function beaconAudio(id: string, body: AudioRequest) {
  sendBeaconPost(notificationPath(id, "audio"), JSON.stringify(body));
}

export function postPopupEvent(id: string, event: PopupEvent) {
  sendBeaconPost(`/api/popups/${encodeURIComponent(id)}/events`, JSON.stringify({ event }));
}

// --- Numero do sino (memoria do navegador) ---------------------------------------------------------

export type NotificationsSummaryState = {
  /** Momento da ultima tentativa (resposta, falha ou atualizacao local); null antes da primeira. */
  fetchedAt: number | null;
  status: "error" | "idle" | "ready";
  unseen: number;
};

/** O numero guardado e de quem: o id do aluno (null antes do topo dizer, ou sem o id). */
type SummaryMemory = NotificationsSummaryState & { owner: string | null };

const INITIAL_SUMMARY: SummaryMemory = { fetchedAt: null, owner: null, status: "idle", unseen: 0 };

// --- Dono da memoria (ajustes da v3a) ------------------------------------------------------------

/** De quem e o que esta guardado aqui (numero do sino e primeira pagina); null = sem id (como antes). */
let memoryOwner: string | null = null;

function ownerOf(userId: string | null | undefined) {
  return userId ? userId : null;
}

/**
 * O topo diz de quem e a memoria (o id do aluno da sessao). Outro id = o numero, a pagina guardada e os
 * pedidos em andamento deixam de valer (a resposta deles nao e guardada). `undefined` (quem nao sabe o
 * id, como o pop-up da home) nao muda nada. Chamado fora do desenho (efeito ou evento): avisa o topo.
 */
export function claimNotificationsMemory(userId: string | null | undefined): void {
  if (userId === undefined || ownerOf(userId) === memoryOwner) {
    return;
  }

  memoryOwner = ownerOf(userId);
  keptInbox = null;
  inboxRequest = null;
  inboxGeneration += 1;
  summaryRequest = null;
  setSummaryState({ ...INITIAL_SUMMARY, owner: memoryOwner });
}

/** O pedido ou a resposta e de outro dono (a conta mudou): nao vale aqui. */
function isOtherOwner(userId: string | null | undefined) {
  return userId !== undefined && ownerOf(userId) !== memoryOwner;
}

let summaryState: SummaryMemory = INITIAL_SUMMARY;
let summaryRequest: { owner: string | null; popup: boolean; promise: Promise<NotificationsSummary | null> } | null = null;
/** A home vai pedir o resumo junto com o pop-up: ate la, o topo nao pede o seu (um pedido so). */
let summaryHeldForPopup = false;
const summaryListeners = new Set<() => void>();

function setSummaryState(next: SummaryMemory) {
  summaryState = next;
  summaryListeners.forEach((listener) => listener());
}

function subscribeSummary(listener: () => void) {
  summaryListeners.add(listener);
  return () => {
    summaryListeners.delete(listener);
  };
}

function getSummarySnapshot() {
  return summaryState;
}

function getServerSummarySnapshot() {
  return INITIAL_SUMMARY;
}

/**
 * Numero vindo de outra resposta (pagina do painel, resumo do pop-up, marcar como vistas). Com `userId`
 * (o painel), a resposta que chega depois da troca de conta nao vira o numero da conta nova.
 */
export function setSummaryUnseen(unseen: number, userId?: string | null) {
  if (isOtherOwner(userId)) {
    return;
  }

  const safe = Number.isFinite(unseen) ? Math.max(0, Math.trunc(unseen)) : 0;
  setSummaryState({ fetchedAt: Date.now(), owner: memoryOwner, status: "ready", unseen: safe });
}

/**
 * O pop-up da home (MemberPopupHost) vai pedir o resumo com `popup`: enquanto `held`, o pedido comum do
 * topo (ao voltar para a aba, por exemplo) espera por ele em vez de sair sozinho.
 */
export function holdSummaryForPopup(held: boolean) {
  summaryHeldForPopup = held;
}

/**
 * Busca o numero do sino se o guardado ja passou do prazo (ou com `force`); com `popup`, busca sempre,
 * trazendo junto o pop-up da vez (so a home pede). Um pedido comum aproveita o que ja esta em andamento.
 * Devolve o resumo, ou null quando nao buscou ou falhou. Nunca lanca.
 */
export function refreshNotificationsSummary(
  options: { force?: boolean; popup?: boolean; userId?: string | null } = {}
): Promise<NotificationsSummary | null> {
  const popup = Boolean(options.popup);

  claimNotificationsMemory(options.userId);

  if (summaryRequest && summaryRequest.owner === memoryOwner && (summaryRequest.popup || !popup)) {
    return summaryRequest.promise;
  }

  if (!popup && !options.force && (summaryHeldForPopup || isSummaryFresh(summaryState.fetchedAt, Date.now()))) {
    return Promise.resolve(null);
  }

  // O dono de quando o pedido saiu: a resposta que volta depois da troca de conta nao e guardada.
  const owner = memoryOwner;
  const promise: Promise<NotificationsSummary | null> = fetchSummary({ popup })
    .then((summary) => {
      setSummaryUnseen(summary.unseen, owner);
      return summary;
    })
    .catch((error: unknown) => {
      if (owner !== memoryOwner) {
        return null;
      }

      // A falha conta como tentativa: troca de pagina e volta para a aba esperam o mesmo minuto (numa
      // queda, nao sai um pedido por pagina). Sessao encerrada (401) zera o numero; o resto mantem.
      const sessionEnded = error instanceof NotificationsRequestError && error.status === 401;

      setSummaryState({
        fetchedAt: Date.now(),
        owner,
        status: summaryState.status === "ready" && !sessionEnded ? "ready" : "error",
        unseen: sessionEnded ? 0 : summaryState.unseen
      });
      return null;
    })
    .finally(() => {
      if (summaryRequest?.promise === promise) {
        summaryRequest = null;
      }
    });

  summaryRequest = { owner, popup, promise };

  return promise;
}

/**
 * Numero do sino para o topo: busca depois da hidratacao e ao voltar para a aba, respeitando o prazo.
 * `refreshOnMount: false` na home, onde o resumo vem com o pedido do pop-up. `userId` (o aluno da
 * sessao) diz de quem e a memoria: antes do efeito, o numero de outra conta nunca aparece (vale o zero).
 */
export function useNotificationsSummary(options: { refreshOnMount?: boolean; userId?: string | null } = {}): NotificationsSummaryState {
  const state = useSyncExternalStore(subscribeSummary, getSummarySnapshot, getServerSummarySnapshot);
  const refreshOnMount = options.refreshOnMount ?? true;
  const userId = options.userId;

  // No layout: o dono muda antes dos efeitos comuns da pagina (o pop-up da home pede o resumo num deles).
  useLayoutEffect(() => {
    claimNotificationsMemory(userId);
  }, [userId]);

  useEffect(() => {
    if (refreshOnMount) {
      void refreshNotificationsSummary({ userId });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshNotificationsSummary({ userId });
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [refreshOnMount, userId]);

  return summaryFor(state, userId);
}

/** O numero guardado so vale para o seu dono; para outro id, o comeco (zero, sem pedido ainda). */
export function summaryFor(state: NotificationsSummaryState & { owner?: string | null }, userId: string | null | undefined): NotificationsSummaryState {
  return userId === undefined || (state.owner ?? null) === ownerOf(userId) ? state : INITIAL_SUMMARY;
}

/** O numero guardado para este aluno, fora do React (o mesmo que useNotificationsSummary devolve). */
export function currentSummaryFor(userId: string | null | undefined): NotificationsSummaryState {
  return summaryFor(summaryState, userId);
}

// --- Primeira pagina guardada (v3a, docs/24 §7.3) --------------------------------------------------
//
// Memoria do modulo, fora do React (como o numero do sino): a primeira pagina do filtro "Todas" fica
// guardada por ate 10 min entre aberturas, com o que o aluno mexeu nela. A busca comeca na intencao
// (mouse parado ou foco pelo Tab no sino, dedo ou Enter no sino fechado), junto com o codigo do painel,
// e o painel entra no pedido que ja saiu. Nada roda em intervalo; fechar o painel nao pede nada.

export type KeptInbox = {
  asOf: string;
  /** Quando a pagina veio do servidor (mudancas locais nao mexem nisso). */
  fetchedAt: number;
  items: NotificationItem[];
  nextCursor: string | null;
  unread: number;
  unseen: number;
};

let keptInbox: KeptInbox | null = null;
let inboxRequest: Promise<KeptInbox> | null = null;
/**
 * Sobe sempre que o guardado deixa de valer (outra conta, 401, mudanca feita com o filtro "Não lidas"):
 * a resposta de um pedido que saiu antes disso volta para quem esperava, mas nao e guardada.
 */
let inboxGeneration = 0;

/** Um pedido da primeira pagina por vez: quem chega depois entra no que esta em andamento. */
function requestInboxFirstPage(): Promise<KeptInbox> {
  if (inboxRequest) {
    return inboxRequest;
  }

  const generation = inboxGeneration;
  const owner = memoryOwner;
  const promise: Promise<KeptInbox> = fetchNotificationsPage({ filter: "all" })
    .then((page) => {
      const kept: KeptInbox = {
        asOf: page.asOf,
        fetchedAt: Date.now(),
        items: page.items,
        nextCursor: page.nextCursor,
        unread: page.unread,
        unseen: page.unseen
      };

      if (generation === inboxGeneration) {
        keptInbox = kept;
        // A pagina buscada antes do clique tambem acerta o numero do sino (nunca marca nada como visto).
        setSummaryUnseen(page.unseen, owner);
      }

      return kept;
    })
    .catch((error: unknown) => {
      if (error instanceof NotificationsRequestError && error.status === 401 && generation === inboxGeneration) {
        forgetInbox();
      }

      throw error;
    })
    .finally(() => {
      if (inboxRequest === promise) {
        inboxRequest = null;
      }
    });

  inboxRequest = promise;

  return promise;
}

/**
 * Busca por intencao: nada quando ja ha um pedido em andamento ou a pagina guardada e mais nova que
 * `minAgeMs` (5 s ao apertar o sino, 1 minuto ao passar o mouse ou o foco). Nunca lanca. Com `userId`,
 * o que estava guardado para outro id sai antes (e a busca vale para este).
 */
export function prefetchInbox(input: { minAgeMs: number; now?: number; userId?: string | null }): void {
  const now = input.now ?? Date.now();

  claimNotificationsMemory(input.userId);

  if (inboxRequest) {
    return;
  }

  if (keptInbox) {
    const age = now - keptInbox.fetchedAt;

    if (age >= 0 && age < input.minAgeMs) {
      return;
    }
  }

  void requestInboxFirstPage().catch(() => undefined);
}

/**
 * A pagina guardada, se ainda vale (ate 10 min); `reuse` = mais nova que 5 s (abre sem pedir de novo).
 * Com `userId`: guardada para outro id nao vale (e sai). Chamada no desenho do painel: nao avisa o topo.
 */
export function takeKeptInbox(now: number = Date.now(), userId?: string | null): { kept: KeptInbox; reuse: boolean } | null {
  if (isOtherOwner(userId)) {
    keptInbox = null;
    return null;
  }

  if (!keptInbox) {
    return null;
  }

  const age = now - keptInbox.fetchedAt;

  if (age > INBOX_KEEP_MS) {
    keptInbox = null;
    return null;
  }

  return { kept: keptInbox, reuse: age >= 0 && age < INBOX_REUSE_MS };
}

/**
 * Primeira pagina do filtro "Todas" para o painel: entra no pedido que ja saiu (a busca por intencao)
 * ou faz um. O `signal` so solta este painel da espera; o pedido segue e a pagina fica guardada. Com
 * `userId`, um pedido feito para outro id nao serve (sai um novo).
 */
export function loadInboxFirstPage(signal?: AbortSignal, userId?: string | null): Promise<KeptInbox> {
  claimNotificationsMemory(userId);

  const request = requestInboxFirstPage();

  if (!signal) {
    return request;
  }

  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  return new Promise<KeptInbox>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));

    signal.addEventListener("abort", onAbort, { once: true });
    request.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Guarda o que o painel mostra (filtro "Todas"), a cada mudanca local e ao fechar: as linhas excluidas
 * saem (reabrir nunca mostra uma notificacao excluida) e o `fetchedAt` e o da pagina, nao o da mudanca.
 * Uma pagina mais nova que ja esta guardada (chegou depois) nao e trocada pela mais velha. Com `userId`,
 * o painel de outra conta (a troca aconteceu) nao guarda nada.
 */
export function keepInbox(next: KeptInbox & { hiddenIds?: Iterable<string>; userId?: string | null }): void {
  if (isOtherOwner(next.userId) || (keptInbox && keptInbox.fetchedAt > next.fetchedAt)) {
    return;
  }

  const hidden = new Set(next.hiddenIds ?? []);

  keptInbox = {
    asOf: next.asOf,
    fetchedAt: next.fetchedAt,
    items: hidden.size > 0 ? next.items.filter((item) => !hidden.has(item.id)) : next.items,
    nextCursor: next.nextCursor,
    unread: next.unread,
    unseen: next.unseen
  };
}

/**
 * Sessao encerrada (401), ou uma mudanca feita com o filtro "Não lidas" (que nao chega a pagina guardada do
 * "Todas"): nada guardado vale, e um pedido que ja saiu nao guarda a resposta (a proxima abertura pede de
 * novo antes de mostrar). Com `userId` de outra conta, nao mexe na memoria da conta atual.
 */
export function forgetInbox(userId?: string | null): void {
  if (isOtherOwner(userId)) {
    return;
  }

  keptInbox = null;
  inboxRequest = null;
  inboxGeneration += 1;
}

// --- Esc que nao vaza ----------------------------------------------------------------------------

/**
 * Esc com escopo proprio (v3a): dentro de `[data-escape-scope="local"]` (o seletor de reacoes) o Esc e
 * do controle, que fecha so ele no proprio onKeyDown; o painel nao fecha.
 */
export function isInLocalEscapeScope(target: unknown): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null;

  return typeof element?.closest === "function" && Boolean(element.closest('[data-escape-scope="local"]'));
}

/**
 * Esc fecha so o painel ou o pop-up aberto. A IA Diretor escuta `keydown` no document e fecha com
 * qualquer Esc; o React tambem escuta no document (raiz do App Router), entao stopPropagation num
 * onKeyDown nao a impede. Por isso o Esc e interceptado na captura da window, antes de tudo, quando o
 * foco esta dentro de `isInside` (ou em lugar nenhum). Dentro de um escopo local (isInLocalEscapeScope)
 * passa reto: sem preventDefault nem stopPropagation, o controle trata.
 */
export function useEscapeToClose(active: boolean, onEscape: () => void, isInside: (target: Node) => boolean) {
  const handleEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.isComposing || event.defaultPrevented || isInLocalEscapeScope(event.target)) {
      return;
    }

    const target = event.target instanceof Node ? event.target : null;
    const focusNowhere = !target || target === document.body || target === document.documentElement || target === document;

    if (!focusNowhere && !(target && isInside(target))) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onEscape();
  });

  useEffect(() => {
    if (!active) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      handleEscape(event);
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [active]);
}

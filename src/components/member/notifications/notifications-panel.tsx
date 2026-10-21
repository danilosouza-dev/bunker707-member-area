"use client";

import { Popover } from "@base-ui/react/popover";
import { BellOff, CheckCheck, LogIn, RotateCw } from "lucide-react";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { MemberButton, memberButtonClassName } from "@/components/member/ui/member-button";
import { MemberEmptyState } from "@/components/member/ui/member-empty-state";
import { MemberFilterPills } from "@/components/member/ui/member-filters";
import { MemberSkeletonBlock } from "@/components/member/ui/member-skeletons";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { cn } from "@/lib/utils";
import type { ReactionId } from "@/server/communications/interactions-model";
import type {
  NotificationItem,
  NotificationPoll,
  NotificationResponseValue,
  NotificationsFilter
} from "@/server/communications/notification-model";
import { NotificationCard, type CardInteractionState } from "./notification-card";
import {
  beaconAudio,
  fetchNotificationsPage,
  forgetInbox,
  keepInbox,
  loadInboxFirstPage,
  NotificationsRequestError,
  postAudio,
  postClick,
  postHide,
  postPollVote,
  postReaction,
  postRead,
  postResponse,
  setSummaryUnseen,
  takeKeptInbox,
  type KeptInbox
} from "./notifications-client";
import {
  appendNotifications,
  applyPollChoice,
  createWriteQueue,
  groupNotificationsByDay,
  HIDDEN_STATUS,
  HIDE_ERROR_MESSAGE,
  markNotificationsOpened,
  markNotificationsRead,
  mergeRefreshedPage,
  needsAudioStart,
  NOTIFICATION_GONE_MESSAGE,
  NOTIFICATIONS_FOOTER,
  openingPlan,
  REACTION_ERROR_MESSAGE,
  reactionStatus,
  recentFlowIds,
  REFRESH_FAILED_MESSAGE,
  RESTORED_STATUS,
  samePollChoice,
  TOO_MANY_WRITES_MESSAGE,
  UNHIDE_ERROR_MESSAGE,
  VOTE_ERROR_MESSAGE,
  type AudioProgressEvent,
  type NotificationLink,
  type OpeningPlan
} from "./notifications-model";

// Painel do sino (docs/22 §1.1; desenho em docs/12), montado so com o sino aberto (e baixado so quando o
// aluno chega perto do sino). Ao abrir: carrega a primeira pagina do filtro e, se havia novidades,
// marca todas como vistas (o numero do sino some; as bolinhas de nao lida ficam). Clique num link ou
// botao registra o clique, marca como lida, fecha o painel e navega pelo AppShell (salva progresso e
// favoritos antes). Sem toast: erros ficam no proprio painel. Foco: quando o controle usado some
// ("Marcar todas como lidas", o ultimo "Carregar mais"), o foco vai para o titulo ou para o fim da
// lista, e uma frase para o leitor de tela confirma o que aconteceu. "Visto" ao abrir e "Marcar todas"
// levam a hora do servidor da primeira pagina (asOf): o que chegou com o painel aberto continua novo; os
// avisos recem-chegados que a lista mostrou vao em `shown` (recentFlowIds).
//
// v2 (docs/23): "abriu" e diferente de "lida". O cartao, "Ver mais", o audio, o botao e a resposta abrem
// (tambem num cartao ja lido pelo "Marcar todas"); "Marcar todas" so marca como lida. O primeiro play do
// audio manda "started" (que tambem marca como lida e aberta e devolve os contadores, no lugar do POST
// /read {ids}); o ouvido vai por fetch e a resposta atualiza a lista. "Termina em" usa a hora do
// servidor da lista (asOf).
//
// v3a (docs/24 §1 e §7.3): a primeira pagina do filtro "Todas" vem da memoria do navegador quando tem
// menos de 10 min (menos de 5 s: abre como esta; senao abre na hora e atualiza por tras, e uma falha
// deixa a de antes com o aviso). O "abriu o sino" sai uma vez por abertura, com a pagina que fica na
// tela. Lixeira: o cartao vira a linha "Notificação excluída." com o Desfazer ate o painel fechar.
// Reagir e votar sao otimistas, com no maximo uma escrita em andamento por cartao e tipo (o ultimo
// estado vai quando a anterior volta); reagir e votar abrem a notificacao. Cada mudanca local volta
// para a memoria (sem as excluidas), para reabrir mostrar o mesmo.

type ListState = {
  /** Hora do servidor na primeira pagina (limite do "visto" e do "Marcar todas"); "" antes de carregar. */
  asOf: string;
  /** Status HTTP da falha ao carregar (401 = sessao encerrada); 0 sem falha ou falha de rede. */
  errorStatus: number;
  /** Quando a primeira pagina veio do servidor (memoria entre aberturas); 0 sem pagina do filtro "Todas". */
  fetchedAt: number;
  items: NotificationItem[];
  loadingMore: boolean;
  loadMoreFailed: boolean;
  nextCursor: string | null;
  /** Instante do carregamento: base do "há 2 horas" e dos grupos por dia. */
  now: number;
  /** A atualizacao por tras falhou: fica a pagina de antes, com o aviso e o "Tentar de novo". */
  refreshFailed: boolean;
  /** Mostrando a pagina guardada enquanto a nova chega. */
  refreshing: boolean;
  status: "error" | "loading" | "ready";
  /** Nao vistas da pagina na tela (vai para a memoria). */
  unseen: number;
};

const LOADING_LIST: ListState = {
  asOf: "",
  errorStatus: 0,
  fetchedAt: 0,
  items: [],
  loadingMore: false,
  loadMoreFailed: false,
  nextCursor: null,
  now: 0,
  refreshFailed: false,
  refreshing: false,
  status: "loading",
  unseen: 0
};

const SESSION_ENDED = "Sua sessão terminou. Entre de novo para continuar.";

const FILTER_LABELS: Record<NotificationsFilter, string> = { all: "Todas", unread: "Não lidas" };

type CardInteractions = Partial<Record<"hide" | "reaction" | "vote", CardInteractionState>>;

/** Linha da notificacao excluida (com o Desfazer) ate o painel fechar. */
type HiddenRow = { error: string | null; restoring: boolean };

// As frases do servidor para 4xx de validacao sao tecnicas; so as de conflito (409, com acento), a de
// sessao encerrada, a da notificacao que saiu do sino (404) e a de muitas tentativas (429) viram texto
// para o aluno.
function errorMessage(error: unknown, fallback: string) {
  if (error instanceof NotificationsRequestError) {
    if (error.status === 401) return SESSION_ENDED;
    if (error.status === 404) return NOTIFICATION_GONE_MESSAGE;
    if (error.status === 409) return error.message;
    if (error.status === 429) return TOO_MANY_WRITES_MESSAGE;
  }

  return fallback;
}

/** Entrar de novo e voltar para esta pagina (navegacao completa: a sessao do navegador recomeca). */
function loginHref() {
  return `/login?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`;
}

/** O que esta abertura faz com a memoria: decidido uma vez, ao montar (docs/24 §7.3). */
type Opening = { kept: KeptInbox | null; plan: OpeningPlan };

function planOpening(): Opening {
  const now = Date.now();
  const taken = takeKeptInbox(now);
  const plan = openingPlan(taken ? taken.kept.fetchedAt : null, now);

  return { kept: plan.render === "kept" && taken ? taken.kept : null, plan };
}

function listFromPage(page: KeptInbox, input: { refreshing: boolean }): ListState {
  return {
    asOf: page.asOf,
    errorStatus: 0,
    fetchedAt: page.fetchedAt,
    items: page.items,
    loadingMore: false,
    loadMoreFailed: false,
    nextCursor: page.nextCursor,
    now: Date.now(),
    refreshFailed: false,
    refreshing: input.refreshing,
    status: "ready",
    unseen: page.unseen
  };
}

function PanelSkeleton() {
  return (
    <div className="px-4 py-2">
      <p className="sr-only" role="status">
        Carregando notificações
      </p>
      {["first", "second", "third"].map((row) => (
        <div className="grid grid-cols-[40px_minmax(0,1fr)] gap-3 py-3" key={row}>
          <MemberSkeletonBlock className="size-10 rounded-full" />
          <span className="block space-y-2 pt-1">
            <MemberSkeletonBlock className="h-3.5 w-4/5" />
            <MemberSkeletonBlock className="h-3 w-3/5" />
            <MemberSkeletonBlock className="h-3 w-16" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** "Notificação excluída." no lugar do cartao, com o Desfazer (sem prazo: some quando o painel fecha). */
function HiddenNotificationRow({ onUndo, row }: { onUndo: () => void; row: HiddenRow }) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <p className="text-sm text-zinc-300">Notificação excluída.</p>
        <MemberButton
          aria-busy={row.restoring || undefined}
          aria-disabled={row.restoring || undefined}
          data-undo-hide=""
          onClick={() => {
            if (!row.restoring) {
              onUndo();
            }
          }}
          size="sm"
          variant="secondary"
        >
          {row.restoring ? "Desfazendo..." : "Desfazer"}
        </MemberButton>
      </div>
      {row.error ? (
        <p className="mt-1 text-xs text-red-300" role="alert">
          {row.error}
        </p>
      ) : null}
    </div>
  );
}

export function NotificationsPanel({
  accessPreviewMode,
  onClose,
  onNavigate,
  schoolIconUrl,
  schoolLogoUrl,
  schoolName
}: {
  accessPreviewMode?: AccessPreviewMode;
  /** Fecha o sino (antes de navegar). */
  onClose: () => void;
  /** Navegacao do AppShell (salva progresso e favoritos antes de trocar de pagina). */
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  schoolIconUrl?: string | null;
  schoolLogoUrl?: string | null;
  schoolName: string;
}) {
  const headingId = useId();
  const [opening] = useState(planOpening);
  const [filter, setFilter] = useState<NotificationsFilter>("all");
  const [reloadToken, setReloadToken] = useState(0);
  const [list, setList] = useState<ListState>(() =>
    opening.kept ? listFromPage(opening.kept, { refreshing: opening.plan.fetch }) : LOADING_LIST
  );
  const [unread, setUnread] = useState(() => opening.kept?.unread ?? 0);
  const [markingAll, setMarkingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [responding, setResponding] = useState<{ id: string; value: NotificationResponseValue } | null>(null);
  const [responseErrors, setResponseErrors] = useState<Record<string, string>>({});
  const [interactions, setInteractions] = useState<Record<string, CardInteractions>>({});
  const [hiddenRows, setHiddenRows] = useState<Record<string, HiddenRow>>({});
  const [statusMessage, setStatusMessage] = useState("");
  const [markedAll, setMarkedAll] = useState(0);
  const seenSentRef = useRef(false);
  /** O filtro ja mudou nesta abertura: a pagina guardada so vale para a primeira carga. */
  const filterChangedRef = useRef(false);
  const loadMoreRef = useRef<AbortController | null>(null);
  const refreshRef = useRef<AbortController | null>(null);
  const readRequestedRef = useRef(new Set<string>());
  const audioStartedRef = useRef(new Set<string>());
  /** Cartoes que o aluno mexeu nesta abertura: a pagina atualizada por tras nao desfaz o que ele fez. */
  const touchedRef = useRef(new Set<string>());
  /** Linhas excluidas na tela agora (espelho de `hiddenRows` para as respostas assincronas). */
  const excludedRef = useRef(new Set<string>());
  /** Excluida sem a resposta do servidor ainda: a bolinha contada aqui volta se a exclusao nao valer. */
  const unreadTakenRef = useRef(new Set<string>());
  const [writes] = useState(createWriteQueue);
  /** Para onde o foco vai depois de excluir ou desfazer (o elemento chega na tela no proximo desenho). */
  const focusAfterRef = useRef<{ id: string; target: "hide" | "undo" } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const endRef = useRef<HTMLParagraphElement>(null);
  const focusEndRef = useRef(false);

  /** "Abriu o sino": uma vez por abertura, com a pagina que fica na tela (a hora dela e os avisos recentes). */
  function markSeen(page: { asOf: string; items: NotificationItem[]; unseen: number }) {
    if (seenSentRef.current || page.unseen <= 0) {
      return;
    }

    seenSentRef.current = true;
    setSummaryUnseen(0);
    const shown = recentFlowIds(page.items, page.asOf);
    postRead({ asOf: page.asOf, seen: true, ...(shown.length > 0 ? { shown } : {}) })
      .then((counts) => {
        setSummaryUnseen(counts.unseen);
        setUnread(counts.unread);
        setList((current) => ({ ...current, unseen: counts.unseen }));
      })
      .catch(() => undefined);
  }

  /** A pagina nova substitui a da tela; o que o aluno mexeu nesta abertura e as excluidas ficam. */
  function showFreshPage(page: KeptInbox) {
    setList((current) => {
      const next = listFromPage(page, { refreshing: false });

      if (current.status !== "ready") {
        return next;
      }

      return {
        ...next,
        items: mergeRefreshedPage(page.items, current.items, { excludedIds: excludedRef.current, touchedIds: touchedRef.current })
      };
    });
    setUnread(page.unread);
  }

  /** Primeira pagina do filtro "Todas" (entra no pedido da busca por intencao, se ja saiu). */
  function loadFirstPage(signal: AbortSignal, kept: KeptInbox | null) {
    loadInboxFirstPage(signal)
      .then((page) => {
        showFreshPage(page);
        markSeen(page);
      })
      .catch((error: unknown) => {
        if (signal.aborted) {
          return;
        }

        const status = error instanceof NotificationsRequestError ? error.status : 0;

        if (kept && status !== 401) {
          // Fica a pagina de antes; o "abriu o sino" vai com a hora dela.
          setList((current) => ({ ...current, refreshFailed: true, refreshing: false }));
          markSeen(kept);
          return;
        }

        if (status === 401) {
          forgetInbox();
        }

        setList((current) => ({ ...LOADING_LIST, asOf: current.asOf, errorStatus: status, status: "error" }));
      });
  }

  useEffect(() => {
    const controller = new AbortController();
    const firstOpening = filter === "all" && reloadToken === 0 && !filterChangedRef.current && opening.kept !== null;

    if (firstOpening && opening.kept) {
      const kept = opening.kept;

      // A pagina guardada tinha novidades: o numero do sino some na hora.
      if (kept.unseen > 0) {
        setSummaryUnseen(0);
      }

      if (opening.plan.fetch) {
        loadFirstPage(controller.signal, kept);
      } else {
        markSeen(kept);
      }

      return () => controller.abort();
    }

    if (filter === "all") {
      loadFirstPage(controller.signal, null);
      return () => controller.abort();
    }

    fetchNotificationsPage({ filter, signal: controller.signal })
      .then((page) => {
        setList({ ...LOADING_LIST, asOf: page.asOf, items: page.items, nextCursor: page.nextCursor, now: Date.now(), status: "ready", unseen: page.unseen });
        setUnread(page.unread);
        setSummaryUnseen(page.unseen);
        markSeen(page);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setList((current) => ({ ...current, errorStatus: error instanceof NotificationsRequestError ? error.status : 0, status: "error" }));
        }
      });

    return () => controller.abort();
    // `opening` e decidido uma vez ao montar; as funcoes leem o estado pelos setters e refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, reloadToken]);

  useEffect(
    () => () => {
      loadMoreRef.current?.abort();
      refreshRef.current?.abort();
    },
    []
  );

  // Cada mudanca local volta para a memoria (so o filtro "Todas"; as excluidas saem): reabrir o sino
  // mostra o mesmo. O `fetchedAt` e o da pagina, nao o desta mudanca.
  useEffect(() => {
    if (filter !== "all" || list.status !== "ready" || list.fetchedAt === 0) {
      return;
    }

    keepInbox({
      asOf: list.asOf,
      fetchedAt: list.fetchedAt,
      hiddenIds: Object.keys(hiddenRows),
      items: list.items,
      nextCursor: list.nextCursor,
      unread,
      unseen: list.unseen
    });
  }, [filter, hiddenRows, list, unread]);

  // "Marcar todas como lidas" some quando nao sobra nada para ler: o foco que estava nele vai para o
  // titulo (senao cairia no corpo da pagina ou no painel inteiro).
  useEffect(() => {
    if (markedAll > 0 && !rootRef.current?.contains(document.activeElement)) {
      titleRef.current?.focus();
    }
  }, [markedAll]);

  // O ultimo "Carregar mais" vira o rodape: o foco que estava no botao vai para ele.
  useEffect(() => {
    if (focusEndRef.current && !list.nextCursor && endRef.current) {
      focusEndRef.current = false;
      endRef.current.focus();
    }
  }, [list.nextCursor, list.items]);

  // Excluiu: foco no Desfazer. Desfez (ou a exclusao falhou): foco na lixeira do cartao que voltou.
  useEffect(() => {
    const target = focusAfterRef.current;

    if (!target) {
      return;
    }

    const row = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-notification-id]") ?? []).find(
      (element) => element.dataset.notificationId === target.id
    );
    const control = row?.querySelector<HTMLElement>(target.target === "undo" ? "[data-undo-hide]" : "[data-card-hide]");

    if (control) {
      focusAfterRef.current = null;
      control.focus();
    }
  }, [hiddenRows]);

  function changeFilter(next: NotificationsFilter) {
    if (next === filter) {
      return;
    }

    loadMoreRef.current?.abort();
    refreshRef.current?.abort();
    filterChangedRef.current = true;
    // Ate a lista nova chegar, "Marcar todas" vale para o que a lista anterior mostrou.
    setList((current) => ({ ...LOADING_LIST, asOf: current.asOf }));
    setActionError(null);
    setFilter(next);
  }

  function retry() {
    setList(LOADING_LIST);
    setReloadToken((token) => token + 1);
  }

  /** "Tentar de novo" da atualizacao por tras: a pagina de antes continua na tela enquanto isso. */
  function retryRefresh() {
    const kept: KeptInbox = {
      asOf: list.asOf,
      fetchedAt: list.fetchedAt,
      items: list.items,
      nextCursor: list.nextCursor,
      unread,
      unseen: list.unseen
    };

    const controller = new AbortController();
    refreshRef.current?.abort();
    refreshRef.current = controller;
    setList((current) => ({ ...current, refreshFailed: false, refreshing: true }));
    loadFirstPage(controller.signal, kept);
  }

  function loadMore(buttonHadFocus: boolean) {
    const cursor = list.nextCursor;

    if (!cursor || list.loadingMore) {
      return;
    }

    const controller = new AbortController();
    loadMoreRef.current?.abort();
    loadMoreRef.current = controller;
    setList((current) => ({ ...current, loadingMore: true, loadMoreFailed: false }));

    fetchNotificationsPage({ cursor, filter, signal: controller.signal })
      .then((page) => {
        focusEndRef.current = buttonHadFocus && !page.nextCursor;
        setList((current) => ({
          ...current,
          items: appendNotifications(current.items, page.items),
          loadingMore: false,
          nextCursor: page.nextCursor
        }));
        setUnread(page.unread);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setList((current) => ({ ...current, loadingMore: false, loadMoreFailed: true }));
        }
      });
  }

  function updateItem(id: string, change: (item: NotificationItem) => NotificationItem) {
    setList((current) => ({ ...current, items: current.items.map((entry) => (entry.id === id ? change(entry) : entry)) }));
  }

  function setInteraction(id: string, kind: keyof CardInteractions, state: CardInteractionState | null) {
    setInteractions((current) => {
      const card = { ...current[id] };

      if (state) {
        card[kind] = state;
      } else {
        delete card[kind];
      }

      return { ...current, [id]: card };
    });
  }

  /**
   * Marca como aberta (e lida) aqui; `send` tambem avisa o servidor (o clique, a resposta, o audio, a
   * reacao e o voto ja marcam la). Cartao lido pelo "Marcar todas" ainda abre (uma vez): a bolinha nao muda.
   */
  function markRead(item: NotificationItem, send: boolean) {
    touchedRef.current.add(item.id);

    if (item.openedAt || readRequestedRef.current.has(item.id)) {
      return;
    }

    readRequestedRef.current.add(item.id);
    setList((current) => ({ ...current, items: markNotificationsOpened(current.items, [item.id], new Date().toISOString()) }));

    if (!item.readAt) {
      setUnread((count) => Math.max(0, count - 1));
    }

    if (send) {
      postRead({ ids: [item.id] })
        .then((counts) => setUnread(counts.unread))
        .catch(() => undefined);
    }
  }

  async function markAllRead() {
    if (markingAll) {
      return;
    }

    setMarkingAll(true);
    setActionError(null);
    setStatusMessage("");

    try {
      const shown = list.asOf ? recentFlowIds(list.items, list.asOf) : [];
      const counts = await postRead({ all: true, asOf: list.asOf || undefined, ...(shown.length > 0 ? { shown } : {}) });
      setList((current) => ({ ...current, items: markNotificationsRead(current.items, "all", new Date().toISOString()) }));
      setUnread(counts.unread);
      setSummaryUnseen(counts.unseen);
      setStatusMessage("Todas as notificações foram marcadas como lidas.");
      setMarkedAll((count) => count + 1);
    } catch (error) {
      setActionError(errorMessage(error, "Não foi possível marcar como lidas. Tente de novo."));
    } finally {
      setMarkingAll(false);
    }
  }

  function openLink(event: MouseEvent<HTMLAnchorElement>, item: NotificationItem, link: NotificationLink) {
    postClick(item.id);
    markRead(item, false);
    onClose();

    // Link de fora ou em nova aba: o navegador abre sozinho.
    if (link.internal && !link.newTab) {
      onNavigate?.(event, link.href);
    }
  }

  /** O ouvido que o servidor devolveu substitui o da lista (o player soma com o desta visita). */
  function setAudioProgress(id: string, audioProgress: NotificationItem["audioProgress"]) {
    setList((current) => ({
      ...current,
      items: current.items.map((entry) => (entry.id === id && entry.audio ? { ...entry, audioProgress } : entry))
    }));
  }

  function handleAudio(item: NotificationItem, event: AudioProgressEvent) {
    if (event.event === "started") {
      // O primeiro play abre a notificacao: o "started" grava visto, lido e aberto no servidor.
      markRead(item, false);

      if (audioStartedRef.current.has(item.id) || !needsAudioStart(item)) {
        return;
      }

      audioStartedRef.current.add(item.id);
      postAudio(item.id, { event: "started" })
        .then((answer) => {
          setAudioProgress(item.id, answer.audioProgress);

          if (typeof answer.unread === "number") {
            setUnread(answer.unread);
          }

          if (typeof answer.unseen === "number") {
            setSummaryUnseen(answer.unseen);
          }
        })
        .catch(() => undefined);
      return;
    }

    // Saindo (aba escondida, painel fechando): beacon, a resposta nao e lida. A proxima leva tudo (OU).
    if (event.via === "beacon") {
      beaconAudio(item.id, { event: "progress", heard: event.heard });
      return;
    }

    postAudio(item.id, { event: "progress", heard: event.heard })
      .then((answer) => setAudioProgress(item.id, answer.audioProgress))
      .catch(() => undefined);
  }

  /** Aceitar/Recusar, e a troca depois (v3a): uma resposta em andamento por vez, sem otimismo. */
  async function respond(item: NotificationItem, value: NotificationResponseValue) {
    if (responding) {
      return;
    }

    touchedRef.current.add(item.id);
    setResponding({ id: item.id, value });
    setResponseErrors((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });

    try {
      const result = await postResponse(item.id, value);
      updateItem(item.id, (entry) => (entry.response ? { ...entry, response: { ...entry.response, value: result.response } } : entry));
      markRead(item, true);
    } catch (error) {
      setResponseErrors((current) => ({
        ...current,
        [item.id]: errorMessage(error, "Não foi possível enviar sua resposta. Tente de novo.")
      }));
    } finally {
      setResponding(null);
    }
  }

  /** Reacao otimista: a pilula troca na hora; um erro volta para a que vale e mostra a frase. */
  function react(item: NotificationItem, value: ReactionId | null) {
    const current = item.reactions;

    if (!current) {
      return;
    }

    markRead(item, false);
    updateItem(item.id, (entry) => (entry.reactions ? { ...entry, reactions: { value } } : entry));
    setStatusMessage(reactionStatus(value));
    setInteraction(item.id, "reaction", { busy: true, error: null });

    writes.push<ReactionId | null>(`reaction:${item.id}`, value, {
      confirmed: current.value,
      equal: (left, right) => left === right,
      send: (next) => postReaction(item.id, next).then((answer) => answer.reaction),
      settle: (outcome) => {
        updateItem(item.id, (entry) => (entry.reactions ? { ...entry, reactions: { value: outcome.value } } : entry));
        setInteraction(
          item.id,
          "reaction",
          outcome.failed ? { busy: false, error: errorMessage(outcome.error, REACTION_ERROR_MESSAGE) } : null
        );
      }
    });
  }

  /** Voto otimista (uma por cartao em andamento; o ultimo conjunto vai quando a resposta volta). */
  function vote(item: NotificationItem, choice: string[]) {
    const current = item.poll;

    if (!current || current.closed) {
      return;
    }

    markRead(item, false);
    const next = applyPollChoice(current, choice);
    updateItem(item.id, (entry) => (entry.poll ? { ...entry, poll: next } : entry));
    setInteraction(item.id, "vote", { busy: true, error: null });

    writes.push<NotificationPoll>(`vote:${item.id}`, next, {
      confirmed: current,
      equal: (left, right) => samePollChoice(left.choice, right.choice),
      send: (poll) => postPollVote(item.id, poll.choice).then((answer) => answer.poll),
      settle: (outcome) => {
        const closed = outcome.failed && outcome.error instanceof NotificationsRequestError && outcome.error.status === 409;
        const poll = closed ? { ...outcome.value, closed: true } : outcome.value;

        updateItem(item.id, (entry) => (entry.poll ? { ...entry, poll } : entry));
        setInteraction(item.id, "vote", outcome.failed ? { busy: false, error: errorMessage(outcome.error, VOTE_ERROR_MESSAGE) } : null);
      }
    });
  }

  function sendHidden(item: NotificationItem, hidden: boolean): Promise<boolean> {
    return postHide(item.id, hidden).then((counts) => {
      unreadTakenRef.current.delete(item.id);
      setUnread(counts.unread);
      setSummaryUnseen(counts.unseen);
      return hidden;
    });
  }

  /** Fila do excluir/desfazer: o que valeu no servidor decide se fica a linha do Desfazer ou o cartao. */
  function settleHidden(item: NotificationItem, outcome: { error: unknown; failed: boolean; value: boolean }) {
    if (outcome.value) {
      excludedRef.current.add(item.id);
      setHiddenRows((current) =>
        current[item.id]
          ? { ...current, [item.id]: { error: outcome.failed ? errorMessage(outcome.error, UNHIDE_ERROR_MESSAGE) : null, restoring: false } }
          : current
      );
      return;
    }

    // O cartao volta (desfez, ou a exclusao nao valeu): a bolinha contada aqui volta junto.
    if (unreadTakenRef.current.delete(item.id)) {
      setUnread((count) => count + 1);
    }

    excludedRef.current.delete(item.id);
    focusAfterRef.current = { id: item.id, target: "hide" };
    setHiddenRows((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });

    if (outcome.failed) {
      setInteraction(item.id, "hide", { busy: false, error: errorMessage(outcome.error, HIDE_ERROR_MESSAGE) });
    } else {
      setStatusMessage(RESTORED_STATUS);
    }
  }

  /** Lixeira: otimista (a linha do Desfazer na hora, o foco vai para ela); o cartao volta se falhar. */
  function hide(item: NotificationItem) {
    if (hiddenRows[item.id]) {
      return;
    }

    touchedRef.current.add(item.id);
    excludedRef.current.add(item.id);
    focusAfterRef.current = { id: item.id, target: "undo" };
    setHiddenRows((current) => ({ ...current, [item.id]: { error: null, restoring: false } }));
    setInteraction(item.id, "hide", null);
    setStatusMessage(HIDDEN_STATUS);

    if (!item.readAt && !unreadTakenRef.current.has(item.id)) {
      unreadTakenRef.current.add(item.id);
      setUnread((count) => Math.max(0, count - 1));
    }

    writes.push<boolean>(`hide:${item.id}`, true, {
      confirmed: false,
      equal: (left, right) => left === right,
      send: (hidden) => sendHidden(item, hidden),
      settle: (outcome) => settleHidden(item, outcome)
    });
  }

  /** Desfazer: a linha fica (com "Desfazendo...") ate o servidor confirmar; o erro aparece nela. */
  function undoHide(item: NotificationItem) {
    setHiddenRows((current) => (current[item.id] ? { ...current, [item.id]: { error: null, restoring: true } } : current));

    writes.push<boolean>(`hide:${item.id}`, false, {
      confirmed: true,
      equal: (left, right) => left === right,
      send: (hidden) => sendHidden(item, hidden),
      settle: (outcome) => settleHidden(item, outcome)
    });
  }

  const groups = list.status === "ready" ? groupNotificationsByDay(list.items, list.now) : [];
  // "Termina em" pela hora do servidor da lista (nada conta no navegador); sem ela, a hora do carregamento.
  const serverNow = list.asOf && Number.isFinite(Date.parse(list.asOf)) ? Date.parse(list.asOf) : list.now;
  const filterOptions = (["all", "unread"] as const).map((id) => ({
    count: id === "unread" && unread > 0 ? unread : undefined,
    id,
    label: FILTER_LABELS[id]
  }));

  const sessionEnded = list.status === "error" && list.errorStatus === 401;

  return (
    <div className="flex flex-col" ref={rootRef}>
      <p className="sr-only" role="status">
        {statusMessage}
      </p>
      {/* Altura fixa: o cabecalho nao pula quando "Marcar todas como lidas" some. */}
      <div className="flex min-h-[3.75rem] items-center justify-between gap-3 px-4 pb-3 pt-4">
        <Popover.Title
          className="rounded-[4px] text-base font-semibold text-white outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          ref={titleRef}
          tabIndex={-1}
        >
          Notificações
        </Popover.Title>
        {unread > 0 ? (
          <button
            aria-busy={markingAll}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none"
            onClick={() => void markAllRead()}
            type="button"
          >
            <CheckCheck aria-hidden="true" className="size-4" />
            {markingAll ? "Marcando..." : "Marcar todas como lidas"}
          </button>
        ) : null}
      </div>
      <MemberFilterPills
        ariaLabel="Filtrar notificações"
        className="mx-0 px-4 pb-3 sm:mx-0 sm:px-4"
        onChange={changeFilter}
        options={filterOptions}
        value={filter}
      />
      {actionError ? (
        <p className="px-4 pb-2 text-xs text-red-300" role="alert">
          {actionError}
        </p>
      ) : null}
      {list.status === "ready" && list.refreshFailed ? (
        <div className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-[12px] border border-red-400/20 bg-red-500/[0.07] px-3 py-2" role="alert">
          <p className="text-xs font-medium text-red-100">{REFRESH_FAILED_MESSAGE}</p>
          <MemberButton className="h-8 px-2.5 text-xs" onClick={retryRefresh} size="sm" variant="secondary">
            Tentar de novo
          </MemberButton>
        </div>
      ) : null}
      <div
        aria-busy={list.status === "loading" || list.loadingMore || list.refreshing}
        className="max-h-[min(70vh,36rem,calc(var(--available-height,100vh)_-_8rem))] overflow-y-auto overscroll-contain border-t border-white/[0.06]"
      >
        {list.status === "loading" ? <PanelSkeleton /> : null}

        {list.status === "error" ? (
          <div className="m-4 flex flex-col items-start gap-3 rounded-[12px] border border-red-400/20 bg-red-500/[0.07] px-4 py-4" role="alert">
            <p className="text-sm font-medium text-red-100">{sessionEnded ? SESSION_ENDED : "Não foi possível carregar as notificações."}</p>
            {sessionEnded ? (
              // Tentar de novo daria 401 outra vez: o caminho e entrar de novo.
              <a className={memberButtonClassName({ size: "sm", variant: "secondary" })} href={loginHref()}>
                <LogIn aria-hidden="true" />
                Entrar de novo
              </a>
            ) : (
              <MemberButton onClick={retry} size="sm" variant="secondary">
                <RotateCw aria-hidden="true" />
                Tentar de novo
              </MemberButton>
            )}
          </div>
        ) : null}

        {list.status === "ready" && list.items.length === 0 ? (
          <div className="p-4">
            {filter === "unread" ? (
              <MemberEmptyState description="Nenhuma notificação nova." icon={CheckCheck} size="compact" title="Você está em dia" />
            ) : (
              <MemberEmptyState
                description="Avisos da escola e respostas aos seus comentários aparecem aqui."
                icon={BellOff}
                size="compact"
                title="Nenhuma notificação por enquanto"
              />
            )}
          </div>
        ) : null}

        {groups.map((group) => (
          <section aria-labelledby={`${headingId}-${group.key}`} key={group.key}>
            <h3 className="px-4 pb-1 pt-3 text-xs font-semibold text-zinc-400" id={`${headingId}-${group.key}`}>
              {group.label}
            </h3>
            <ul>
              {group.items.map((item, index) => {
                const hiddenRow = hiddenRows[item.id];

                return (
                  <li className={cn(index > 0 && "border-t border-white/[0.06]")} data-notification-id={item.id} key={item.id}>
                    {hiddenRow ? (
                      <HiddenNotificationRow onUndo={() => undoHide(item)} row={hiddenRow} />
                    ) : (
                      <NotificationCard
                        accessPreviewMode={accessPreviewMode}
                        interaction={interactions[item.id]}
                        item={item}
                        now={list.now}
                        onAudioProgress={(event) => handleAudio(item, event)}
                        onHide={() => hide(item)}
                        onOpenLink={(event, link) => openLink(event, item, link)}
                        onReact={(value) => react(item, value)}
                        onRead={() => markRead(item, true)}
                        onRespond={(value) => void respond(item, value)}
                        onVote={(choice) => vote(item, choice)}
                        responding={responding?.id === item.id ? responding.value : null}
                        responseError={responseErrors[item.id] ?? null}
                        schoolIconUrl={schoolIconUrl}
                        schoolLogoUrl={schoolLogoUrl}
                        schoolName={schoolName}
                        serverNow={serverNow}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {list.status === "ready" && list.items.length > 0 ? (
          list.nextCursor ? (
            <div className="border-t border-white/[0.06] px-4 py-3">
              <MemberButton
                aria-busy={list.loadingMore}
                className="w-full"
                onClick={(event) => loadMore(document.activeElement === event.currentTarget)}
                size="sm"
                variant="secondary"
              >
                {list.loadingMore ? "Carregando..." : "Carregar mais"}
              </MemberButton>
              {list.loadMoreFailed ? (
                <p className="mt-2 text-center text-xs text-red-300" role="alert">
                  Não foi possível carregar mais. Tente de novo.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="border-t border-white/[0.06] px-4 py-3 text-center text-xs text-zinc-400 outline-none" ref={endRef} tabIndex={-1}>
              {NOTIFICATIONS_FOOTER}
            </p>
          )
        ) : null}
      </div>
    </div>
  );
}

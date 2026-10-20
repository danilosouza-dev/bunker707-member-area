"use client";

import { Popover } from "@base-ui/react/popover";
import { BellOff, CheckCheck, RotateCw } from "lucide-react";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { MemberButton } from "@/components/member/ui/member-button";
import { MemberEmptyState } from "@/components/member/ui/member-empty-state";
import { MemberFilterPills } from "@/components/member/ui/member-filters";
import { MemberSkeletonBlock } from "@/components/member/ui/member-skeletons";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { cn } from "@/lib/utils";
import type {
  NotificationItem,
  NotificationResponseValue,
  NotificationsFilter
} from "@/server/communications/notification-model";
import { NotificationCard } from "./notification-card";
import {
  fetchNotificationsPage,
  NotificationsRequestError,
  postClick,
  postRead,
  postResponse,
  setSummaryUnseen
} from "./notifications-client";
import {
  appendNotifications,
  groupNotificationsByDay,
  markNotificationsRead,
  type NotificationLink
} from "./notifications-model";

// Painel do sino (docs/22 §1.1; desenho em docs/12), montado so com o sino aberto. Ao abrir: carrega a primeira pagina do
// filtro e, se havia novidades, marca todas como vistas (o numero do sino some; as bolinhas de nao
// lida ficam). Clique num link ou botao registra o clique, marca como lida, fecha o painel e navega
// pelo AppShell (salva progresso e favoritos antes). Sem toast: erros ficam no proprio painel.

type ListState = {
  items: NotificationItem[];
  loadingMore: boolean;
  loadMoreFailed: boolean;
  nextCursor: string | null;
  /** Instante do carregamento: base do "há 2 horas" e dos grupos por dia. */
  now: number;
  status: "error" | "loading" | "ready";
};

const LOADING_LIST: ListState = { items: [], loadingMore: false, loadMoreFailed: false, nextCursor: null, now: 0, status: "loading" };

const FILTER_LABELS: Record<NotificationsFilter, string> = { all: "Todas", unread: "Não lidas" };

// As frases do servidor para 4xx de validacao sao tecnicas; so a de conflito ("Você já respondeu.") e a
// de sessao encerrada viram texto para o aluno.
function errorMessage(error: unknown, fallback: string) {
  if (error instanceof NotificationsRequestError) {
    if (error.status === 401) return "Sua sessão terminou. Entre de novo para continuar.";
    if (error.status === 409) return error.message;
  }

  return fallback;
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

export function NotificationsPanel({
  accessPreviewMode,
  onClose,
  onNavigate,
  schoolLogoUrl,
  schoolName
}: {
  accessPreviewMode?: AccessPreviewMode;
  /** Fecha o sino (antes de navegar). */
  onClose: () => void;
  /** Navegacao do AppShell (salva progresso e favoritos antes de trocar de pagina). */
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  schoolLogoUrl?: string | null;
  schoolName: string;
}) {
  const headingId = useId();
  const [filter, setFilter] = useState<NotificationsFilter>("all");
  const [reloadToken, setReloadToken] = useState(0);
  const [list, setList] = useState<ListState>(LOADING_LIST);
  const [unread, setUnread] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [responding, setResponding] = useState<{ id: string; value: NotificationResponseValue } | null>(null);
  const [responseErrors, setResponseErrors] = useState<Record<string, string>>({});
  const seenSentRef = useRef(false);
  const loadMoreRef = useRef<AbortController | null>(null);
  const readRequestedRef = useRef(new Set<string>());

  useEffect(() => {
    const controller = new AbortController();

    fetchNotificationsPage({ filter, signal: controller.signal })
      .then((page) => {
        setList({ items: page.items, loadingMore: false, loadMoreFailed: false, nextCursor: page.nextCursor, now: Date.now(), status: "ready" });
        setUnread(page.unread);
        setSummaryUnseen(page.unseen);

        // Abriu o sino: tudo que chegou ate aqui passa a "visto" (uma vez por abertura).
        if (page.unseen > 0 && !seenSentRef.current) {
          seenSentRef.current = true;
          setSummaryUnseen(0);
          postRead({ seen: true })
            .then((counts) => {
              setSummaryUnseen(counts.unseen);
              setUnread(counts.unread);
            })
            .catch(() => undefined);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setList((current) => ({ ...current, status: "error" }));
        }
      });

    return () => controller.abort();
  }, [filter, reloadToken]);

  useEffect(() => () => loadMoreRef.current?.abort(), []);

  function changeFilter(next: NotificationsFilter) {
    if (next === filter) {
      return;
    }

    loadMoreRef.current?.abort();
    setList(LOADING_LIST);
    setActionError(null);
    setFilter(next);
  }

  function retry() {
    setList(LOADING_LIST);
    setReloadToken((token) => token + 1);
  }

  function loadMore() {
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

  /** Marca como lida aqui; `send` tambem avisa o servidor (o clique ja marca la). */
  function markRead(item: NotificationItem, send: boolean) {
    if (item.readAt || readRequestedRef.current.has(item.id)) {
      return;
    }

    readRequestedRef.current.add(item.id);
    setList((current) => ({ ...current, items: markNotificationsRead(current.items, [item.id], new Date().toISOString()) }));
    setUnread((count) => Math.max(0, count - 1));

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

    try {
      const counts = await postRead({ all: true });
      setList((current) => ({ ...current, items: markNotificationsRead(current.items, "all", new Date().toISOString()) }));
      setUnread(counts.unread);
      setSummaryUnseen(counts.unseen);
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

  async function respond(item: NotificationItem, value: NotificationResponseValue) {
    if (responding) {
      return;
    }

    setResponding({ id: item.id, value });
    setResponseErrors((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });

    try {
      const result = await postResponse(item.id, value);
      setList((current) => ({
        ...current,
        items: current.items.map((entry) =>
          entry.id === item.id && entry.response ? { ...entry, response: { ...entry.response, value: result.response } } : entry
        )
      }));
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

  const groups = list.status === "ready" ? groupNotificationsByDay(list.items, list.now) : [];
  const filterOptions = (["all", "unread"] as const).map((id) => ({
    count: id === "unread" && unread > 0 ? unread : undefined,
    id,
    label: FILTER_LABELS[id]
  }));

  return (
    <div className="flex flex-col">
      {/* Altura fixa: o cabecalho nao pula quando "Marcar todas como lidas" some. */}
      <div className="flex min-h-[3.75rem] items-center justify-between gap-3 px-4 pb-3 pt-4">
        <Popover.Title className="text-base font-semibold text-white">Notificações</Popover.Title>
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
      <div
        aria-busy={list.status === "loading" || list.loadingMore}
        className="max-h-[min(70vh,36rem,calc(var(--available-height,100vh)_-_8rem))] overflow-y-auto overscroll-contain border-t border-white/[0.06]"
      >
        {list.status === "loading" ? <PanelSkeleton /> : null}

        {list.status === "error" ? (
          <div className="m-4 flex flex-col items-start gap-3 rounded-[12px] border border-red-400/20 bg-red-500/[0.07] px-4 py-4" role="alert">
            <p className="text-sm font-medium text-red-100">Não foi possível carregar as notificações.</p>
            <MemberButton onClick={retry} size="sm" variant="secondary">
              <RotateCw aria-hidden="true" />
              Tentar de novo
            </MemberButton>
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
            <h3 className="px-4 pb-1 pt-3 text-xs font-semibold text-zinc-500" id={`${headingId}-${group.key}`}>
              {group.label}
            </h3>
            <ul>
              {group.items.map((item, index) => (
                <li className={cn(index > 0 && "border-t border-white/[0.06]")} key={item.id}>
                  <NotificationCard
                    accessPreviewMode={accessPreviewMode}
                    item={item}
                    now={list.now}
                    onOpenLink={(event, link) => openLink(event, item, link)}
                    onRead={() => markRead(item, true)}
                    onRespond={(value) => void respond(item, value)}
                    responding={responding?.id === item.id ? responding.value : null}
                    responseError={responseErrors[item.id] ?? null}
                    schoolLogoUrl={schoolLogoUrl}
                    schoolName={schoolName}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}

        {list.status === "ready" && list.items.length > 0 ? (
          list.nextCursor ? (
            <div className="border-t border-white/[0.06] px-4 py-3">
              <MemberButton aria-busy={list.loadingMore} className="w-full" onClick={loadMore} size="sm" variant="secondary">
                {list.loadingMore ? "Carregando..." : "Carregar mais"}
              </MemberButton>
              {list.loadMoreFailed ? (
                <p className="mt-2 text-center text-xs text-red-300" role="alert">
                  Não foi possível carregar mais. Tente de novo.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="border-t border-white/[0.06] px-4 py-3 text-center text-xs text-zinc-500">
              As notificações ficam aqui por 90 dias.
            </p>
          )
        ) : null}
      </div>
    </div>
  );
}

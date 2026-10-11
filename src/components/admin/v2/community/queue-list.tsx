"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { moderateComment, resolveComment } from "@/server/community/actions";
import type { QueueItem, QuickReply } from "@/server/community/types";
import { ErrorBanner } from "../error-banner";
import { adminCard } from "../styles";
import { adminToast } from "../toast";
import { moderationToastMessage } from "./moderation-model";
import { focusAfterRemoval, moveQueueIndex, queueKeyCommand } from "./queue-model";
import { QueueItemView } from "./queue-item";
import { ReplyComposer } from "./reply-composer";

// Fila "Precisam de resposta" (docs/17 §1.9, shot 13). Responder em 2 interacoes: "Responder" (ou R)
// abre o editor na propria linha e Cmd/Ctrl+Enter publica. Respondida, resolvida, oculta ou spam sai
// da lista na hora, o foco vai para a seguinte e o aviso oferece "Desfazer" quando ha volta.
// J/K navegam com foco visivel. No celular aparece uma pergunta por vez, com Anterior/Proxima.

type QueueListProps = {
  canModerate: boolean;
  canReply: boolean;
  items: readonly QueueItem[];
  /** "Agora" do servidor, para o tempo de espera nao mudar entre o HTML e a hidratacao. */
  nowIso: string;
  quickReplies: readonly QuickReply[];
};

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.isContentEditable ||
      target.closest("input, textarea, select, [contenteditable='true'], [role='menu'], [role='dialog'], [role='listbox']")
  );
}

function focusQueueItem(id: string) {
  const element = document.querySelector<HTMLElement>(`[data-queue-item="${CSS.escape(id)}"]`);

  if (element) {
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "nearest" });
  }
}

export function QueueList({ canModerate, canReply, items, nowIso, quickReplies }: QueueListProps) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [composerId, setComposerId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);

  const visible = useMemo(() => items.filter((item) => !removed.has(item.id)), [items, removed]);
  const visibleIds = useMemo(() => visible.map((item) => item.id), [visible]);
  const activeIndex = Math.max(0, activeId ? visibleIds.indexOf(activeId) : 0);
  const currentId = visibleIds[activeIndex] ?? null;

  useEffect(() => {
    const target = pendingFocus.current;

    if (!target) {
      return;
    }

    pendingFocus.current = null;

    if (target === "empty") {
      document.getElementById("queue-empty-title")?.focus();
    } else {
      focusQueueItem(target);
    }
  });

  const setItemBusy = useCallback((id: string, value: boolean) => {
    setBusy((current) => {
      const next = new Set(current);

      if (value) {
        next.add(id);
      } else {
        next.delete(id);
      }

      return next;
    });
  }, []);

  function hide(id: string) {
    const next = focusAfterRemoval(visibleIds, id);
    const hadFocus = typeof document !== "undefined" && Boolean(document.activeElement?.closest(`[data-queue-item="${CSS.escape(id)}"]`));

    setRemoved((current) => new Set(current).add(id));
    setActiveId(next);

    if (composerId === id) {
      setComposerId(null);
    }

    if (hadFocus || composerId === id) {
      pendingFocus.current = next ?? (visibleIds.length <= 1 ? "empty" : null);
    }
  }

  function restore(id: string) {
    setRemoved((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  function openComposer(id: string) {
    if (!canReply) {
      return;
    }

    setActiveId(id);
    setComposerId(id);
    setError(null);
  }

  function closeComposer(id: string) {
    setComposerId((current) => (current === id ? null : current));
    pendingFocus.current = id;
  }

  async function resolve(item: QueueItem) {
    setError(null);
    hide(item.id);

    const result = await resolveComment({ commentId: item.id, resolved: true });

    if (!result.ok) {
      restore(item.id);
      setError(result.error);
      return;
    }

    adminToast.success("Pergunta resolvida", {
      onUndo: async () => {
        const undo = await resolveComment({ commentId: item.id, resolved: false });

        if (undo.ok) {
          restore(item.id);
          adminToast.success("Pergunta de volta na fila");
        } else {
          setError(undo.error);
        }
      }
    });
  }

  async function moderate(item: QueueItem, status: "hidden" | "spam") {
    setError(null);
    setItemBusy(item.id, true);

    const result = await moderateComment({ commentId: item.id, status });
    setItemBusy(item.id, false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    hide(item.id);
    adminToast.success(moderationToastMessage(status, 1), {
      onUndo: async () => {
        const undo = await moderateComment({ commentId: item.id, status: "approved" });

        if (undo.ok) {
          restore(item.id);
          adminToast.success("Comentário visível de novo");
        } else {
          setError(undo.error);
        }
      }
    });
  }

  function published(item: QueueItem) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    hide(item.id);
    adminToast.success(`Resposta publicada para ${item.author.name.split(/\s+/)[0] || "o aluno"}`);
  }

  function move(direction: "next" | "previous") {
    const index = moveQueueIndex(activeId ? visibleIds.indexOf(activeId) : -1, visibleIds.length, direction);
    const id = visibleIds[index];

    if (id) {
      setActiveId(id);
      pendingFocus.current = id;
    }
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const command = queueKeyCommand({
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      key: event.key,
      metaKey: event.metaKey,
      targetIsEditable: isEditableTarget(event.target)
    });

    if (!command || visibleIds.length === 0) {
      return;
    }

    event.preventDefault();

    if (command === "reply") {
      const id = activeId && visibleIds.includes(activeId) ? activeId : visibleIds[0];

      if (id) {
        openComposer(id);
      }

      return;
    }

    move(command);
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  if (visible.length === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-3">
        {error ? <ErrorBanner>{error}</ErrorBanner> : null}
        <QueueAllDone />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      <section aria-label="Perguntas sem resposta" className={cn(adminCard, "flex min-w-0 flex-col overflow-hidden")}>
        {visible.map((item) => (
          <QueueItemView
            busy={busy.has(item.id)}
            canModerate={canModerate}
            canReply={canReply}
            composer={
              composerId === item.id ? (
                <ReplyComposer
                  draft={drafts[item.id] ?? ""}
                  item={item}
                  onCancel={() => closeComposer(item.id)}
                  onDraftChange={(value) => setDrafts((current) => ({ ...current, [item.id]: value }))}
                  onPublished={() => published(item)}
                  quickReplies={quickReplies}
                />
              ) : null
            }
            isActive={item.id === currentId}
            item={item}
            key={item.id}
            now={now}
            onFocusItem={() => setActiveId(item.id)}
            onModerate={(status) => void moderate(item, status)}
            onReply={() => openComposer(item.id)}
            onResolve={() => void resolve(item)}
          />
        ))}
      </section>

      <nav aria-label="Pergunta anterior e próxima" className="flex items-center justify-between gap-2 md:hidden">
        <Button
          className="h-11! gap-1 border-[var(--border-strong)] px-4"
          disabled={activeIndex <= 0}
          onClick={() => move("previous")}
          type="button"
          variant="secondary"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          Anterior
        </Button>
        <p aria-live="polite" className="text-[13px] leading-5 text-[var(--text-secondary)] tabular-nums">
          Pergunta {activeIndex + 1} de {visible.length}
        </p>
        <Button
          className="h-11! gap-1 border-[var(--border-strong)] px-4"
          disabled={activeIndex >= visible.length - 1}
          onClick={() => move("next")}
          type="button"
          variant="secondary"
        >
          Próxima
          <ChevronRight aria-hidden="true" className="size-4" />
        </Button>
      </nav>
    </div>
  );
}

/** Vazio depois de responder tudo o que estava na tela (o servidor confirma ao recarregar). */
function QueueAllDone() {
  return (
    <div className={cn(adminCard, "flex flex-col items-center gap-3 px-6 py-12 text-center md:py-16")}>
      <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)] outline-none" id="queue-empty-title" tabIndex={-1}>
        Tudo respondido
      </h2>
      <p className="max-w-md text-sm leading-5 text-[var(--text-secondary)]">
        Nenhuma pergunta esperando nesta página. A próxima aparece aqui, a mais antiga primeiro.
      </p>
    </div>
  );
}

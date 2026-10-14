"use client";

import { Bookmark } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { savedItemCollectionLabel } from "@/lib/saved-items";
import { cn } from "@/lib/utils";
import type { MouseEvent } from "react";
import type { SavedItemTargetType } from "@/lib/platform-types";

export const savedItemChangedEvent = "bunker707:saved-item-changed";

type SavedItemChangedDetail = {
  saved: boolean;
  targetId: string;
  targetType: SavedItemTargetType;
};

type SavedItemSyncEntry = {
  collectionLabel: string;
  desiredSaved: boolean;
  lastConfirmedSaved: boolean;
  syncPromise?: Promise<void>;
  targetId: string;
  targetType: SavedItemTargetType;
};

type SavedItemButtonProps = {
  className: string;
  iconClassName: string;
  initialSaved?: boolean;
  onSavedChange?: (saved: boolean) => void;
  targetId: string;
  targetTitle: string;
  targetType: SavedItemTargetType;
};

const savedItemSyncQueue = new Map<string, SavedItemSyncEntry>();

function getSavedItemSyncKey(targetType: SavedItemTargetType, targetId: string) {
  return `${targetType}:${targetId}`;
}

function dispatchSavedItemChanged(detail: SavedItemChangedDetail) {
  window.dispatchEvent(new CustomEvent(savedItemChangedEvent, {
    detail
  }));
}

async function persistSavedItemChange(entry: SavedItemSyncEntry, saved: boolean) {
  const response = await fetch("/api/saved-items", {
    body: JSON.stringify({
      collectionLabel: entry.collectionLabel,
      saved,
      targetId: entry.targetId,
      targetType: entry.targetType
    }),
    headers: {
      "Content-Type": "application/json"
    },
    keepalive: true,
    method: "PUT"
  });

  if (!response.ok) {
    throw new Error("Nao foi possivel atualizar favorito.");
  }
}

function flushSavedItemSync(key: string): Promise<void> {
  const entry = savedItemSyncQueue.get(key);

  if (!entry) {
    return Promise.resolve();
  }

  if (entry.syncPromise) {
    return entry.syncPromise;
  }

  const syncPromise = (async () => {
    while (entry.desiredSaved !== entry.lastConfirmedSaved) {
      const savedToSend = entry.desiredSaved;

      try {
        await persistSavedItemChange(entry, savedToSend);
        entry.lastConfirmedSaved = savedToSend;
      } catch {
        if (entry.desiredSaved === savedToSend) {
          entry.desiredSaved = entry.lastConfirmedSaved;
          dispatchSavedItemChanged({
            saved: entry.lastConfirmedSaved,
            targetId: entry.targetId,
            targetType: entry.targetType
          });
        }
      }
    }
  })().finally(() => {
    entry.syncPromise = undefined;

    if (entry.desiredSaved !== entry.lastConfirmedSaved) {
      void flushSavedItemSync(key);
    }
  });

  entry.syncPromise = syncPromise;
  return syncPromise;
}

export async function flushPendingSavedItemChanges() {
  while (true) {
    const pendingKeys = [...savedItemSyncQueue.entries()]
      .filter(([, entry]) => entry.syncPromise || entry.desiredSaved !== entry.lastConfirmedSaved)
      .map(([key]) => key);

    if (pendingKeys.length === 0) {
      return;
    }

    await Promise.all(pendingKeys.map((key) => flushSavedItemSync(key)));
  }
}

function requestSavedItemSync({
  previousSaved,
  saved,
  targetId,
  targetType
}: {
  previousSaved: boolean;
  saved: boolean;
  targetId: string;
  targetType: SavedItemTargetType;
}) {
  const key = getSavedItemSyncKey(targetType, targetId);
  const entry = savedItemSyncQueue.get(key) ?? {
    collectionLabel: savedItemCollectionLabel,
    desiredSaved: previousSaved,
    lastConfirmedSaved: previousSaved,
    targetId,
    targetType
  };

  entry.collectionLabel = savedItemCollectionLabel;
  entry.desiredSaved = saved;
  entry.targetId = targetId;
  entry.targetType = targetType;
  savedItemSyncQueue.set(key, entry);
  void flushSavedItemSync(key);
}

export function SavedItemButton({
  className,
  iconClassName,
  initialSaved = false,
  onSavedChange,
  targetId,
  targetTitle,
  targetType
}: SavedItemButtonProps) {
  const stateKey = getSavedItemSyncKey(targetType, targetId);
  const [savedState, setSavedState] = useState({
    key: stateKey,
    saved: initialSaved
  });
  const saved = savedState.key === stateKey ? savedState.saved : initialSaved;
  const savedRef = useRef(saved);

  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  useEffect(() => {
    function handleSavedItemChanged(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null;

      if (
        detail?.targetId === targetId &&
        detail?.targetType === targetType &&
        typeof detail.saved === "boolean"
      ) {
        savedRef.current = detail.saved;
        setSavedState({
          key: stateKey,
          saved: detail.saved
        });
        onSavedChange?.(detail.saved);
      }
    }

    window.addEventListener(savedItemChangedEvent, handleSavedItemChanged);

    return () => {
      window.removeEventListener(savedItemChangedEvent, handleSavedItemChanged);
    };
  }, [onSavedChange, stateKey, targetId, targetType]);

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    const previousSaved = savedState.key === stateKey ? savedRef.current : initialSaved;
    const nextSaved = !saved;
    dispatchSavedItemChanged({
      saved: nextSaved,
      targetId,
      targetType
    });
    requestSavedItemSync({
      previousSaved,
      saved: nextSaved,
      targetId,
      targetType
    });
  }

  return (
    <button
      aria-label={saved ? `Remover ${targetTitle} dos favoritos` : `Salvar ${targetTitle} nos favoritos`}
      aria-pressed={saved}
      className={cn("relative", className,
        // Estado so pelo traco: circulo fino e marcador vazado quando nao esta salvo; salvo, o circulo
        // engrossa (2,5 px) e o marcador fica preenchido de branco. Sem cor nem check: verde com check e o
        // "concluido" (anel de progresso) e nao se repete no mesmo card.
        saved
          ? "border-[2.5px] border-white bg-black/45 text-white shadow-[0_12px_34px_rgba(0,0,0,0.42)] hover:bg-black/60"
          : "border-[1.5px] border-zinc-300/80 bg-black/30 text-white hover:border-white hover:bg-white/10"
      )}
      onClick={handleClick}
      type="button"
    >
      <Bookmark className={`${iconClassName} transition-transform ${saved ? "scale-95 fill-current" : ""}`} />
    </button>
  );
}

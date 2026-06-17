"use client";

import { Bookmark, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { savedItemCollectionLabel } from "@/lib/saved-items";
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
  inFlight: boolean;
  lastConfirmedSaved: boolean;
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
    method: "PUT"
  });

  if (!response.ok) {
    throw new Error("Nao foi possivel atualizar favorito.");
  }
}

async function flushSavedItemSync(key: string) {
  const entry = savedItemSyncQueue.get(key);

  if (!entry || entry.inFlight) {
    return;
  }

  const savedToSend = entry.desiredSaved;
  entry.inFlight = true;

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
  } finally {
    entry.inFlight = false;

    if (entry.desiredSaved !== entry.lastConfirmedSaved) {
      void flushSavedItemSync(key);
    }
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
    inFlight: false,
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
      className={`${className} relative ${
        saved
          ? "border-emerald-400/85 bg-[#2f2f2f]/95 text-white shadow-[0_12px_34px_rgba(0,0,0,0.42)] ring-2 ring-emerald-400/70 ring-offset-2 ring-offset-black hover:border-emerald-300 hover:bg-[#3a3a3a]"
          : "border-zinc-400 bg-black/30 text-white hover:border-white hover:bg-white/10"
      }`}
      onClick={handleClick}
      type="button"
    >
      <Bookmark className={`${iconClassName} transition-transform ${saved ? "scale-95 fill-current" : ""}`} />
      {saved ? (
        <span className="pointer-events-none absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_6px_16px_rgba(16,185,129,0.45)] ring-2 ring-black">
          <Check className="h-2.5 w-2.5 stroke-[3.5]" />
        </span>
      ) : null}
    </button>
  );
}

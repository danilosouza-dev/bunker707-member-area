"use client";

import { useCallback, useState, useSyncExternalStore, type RefObject } from "react";
import { isTextEntry, readPortraitPhone, readPortraitScreen, roomDesignFor, subscribePortraitPhone, type PortraitMatchMedia, type RoomDesign } from "./vertical/vertical-model";

// O desenho da Sala da Live gravada e do Replay (docs/30 §1.6 e §6.6): o celular em pe usa a Sala Live vertical 9:16;
// girar para o lado (ou um tablet, ou o computador) volta ao desenho normal. Segue a mudanca pelo matchMedia de
// VERTICAL_ROOM_QUERY. O servidor e a primeira pintura sao sempre do desenho normal (getServerSnapshot): a hidratacao
// confere com o HTML do servidor e so depois a sala passa para o vertical, trocando so as classes do esqueleto (o
// player nao remonta; vertical/vertical-model.ts). `forced` (a previa e os testes) vence a consulta. Com um campo de
// texto da sala em foco (o teclado aberto), a troca vertical -> normal fica travada (roomDesignFor): nas WebViews dos
// apps o teclado encolhe a viewport e a consulta passaria a "deitado", desmontando o campo em que o aluno digita;
// screen.orientation (que o teclado nao muda) confirma quando o aparelho girou de verdade.

function windowMatchMedia(): PortraitMatchMedia {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return (query: string) => window.matchMedia(query);
}

function subscribe(callback: () => void) {
  return subscribePortraitPhone(windowMatchMedia(), callback);
}

function getSnapshot() {
  return readPortraitPhone(windowMatchMedia());
}

/** O servidor nao sabe do aparelho: o desenho normal (a mesma primeira pintura no navegador). */
function getServerSnapshot() {
  return false;
}

function subscribeFocus(callback: () => void) {
  if (typeof document === "undefined") {
    return () => undefined;
  }
  document.addEventListener("focusin", callback);
  document.addEventListener("focusout", callback);
  return () => {
    document.removeEventListener("focusin", callback);
    document.removeEventListener("focusout", callback);
  };
}

function subscribeScreen(callback: () => void) {
  const orientation = typeof screen === "undefined" ? null : screen.orientation;
  if (!orientation || typeof orientation.addEventListener !== "function") {
    return () => undefined;
  }
  orientation.addEventListener("change", callback);
  return () => orientation.removeEventListener("change", callback);
}

function getScreenSnapshot() {
  return typeof screen === "undefined" ? null : readPortraitScreen(screen);
}

function getServerScreenSnapshot() {
  return null;
}

function getServerEditing() {
  return false;
}

export function useRoomOrientation(forced?: RoomDesign | null, rootRef?: RefObject<HTMLElement | null>): RoomDesign {
  const portraitPhone = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const portraitScreen = useSyncExternalStore(subscribeScreen, getScreenSnapshot, getServerScreenSnapshot);
  const getEditing = useCallback(() => {
    if (typeof document === "undefined") {
      return false;
    }
    const active = document.activeElement as HTMLElement | null;
    const root = rootRef?.current ?? null;
    return isTextEntry(active) && Boolean(active && (!root || root.contains(active)));
  }, [rootRef]);
  const editing = useSyncExternalStore(subscribeFocus, getEditing, getServerEditing);
  // O desenho da pintura anterior (o padrao do React para guardar o que veio antes): so muda quando o calculado muda.
  const [previous, setPrevious] = useState<RoomDesign>("normal");
  const design = roomDesignFor({ editing, forced, portraitPhone, portraitScreen, previous });
  if (design !== previous) {
    setPrevious(design);
  }
  return design;
}

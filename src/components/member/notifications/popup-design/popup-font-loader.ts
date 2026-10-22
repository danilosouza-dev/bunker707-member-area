"use client";

import { useEffect, useEffectEvent, useState } from "react";
import type { PopupFontFace } from "../../../../server/communications/popup-design-model";
import { popupFontSource } from "./popup-design-styles";

// Fontes enviadas do design do pop-up no navegador (docs/26): FontFace com font-display swap, registradas em
// document.fonts uma vez por familia e endereco (cache do modulo), peso "100 900" (o arquivo vale para qualquer
// peso pedido, sem negrito imitado) e o estilo da fonte. Falha de uma fonte nunca derruba o pop-up: o texto
// fica na pilha do sistema. So fonte do nosso bucket de fontes e familia bf_<12 hex> (popupFontSource). So o
// pedaco da janela do pop-up (e o editor) importa este arquivo.

/** Uma promessa por familia + endereco: o mesmo arquivo nunca e baixado nem registrado duas vezes. */
const loading = new Map<string, Promise<void>>();

function faceKey(face: Pick<PopupFontFace, "family" | "url">) {
  return `${face.family}|${face.url}`;
}

function loadOne(face: PopupFontFace): Promise<void> {
  const key = faceKey(face);
  const cached = loading.get(key);

  if (cached) {
    return cached;
  }

  const source = popupFontSource(face);

  if (!source || typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) {
    return Promise.resolve();
  }

  let promise: Promise<void>;

  try {
    const fontFace = new FontFace(face.family, source, { display: "swap", style: face.style, weight: "100 900" });

    document.fonts.add(fontFace);
    promise = fontFace.load().then(
      () => undefined,
      () => undefined
    );
  } catch {
    promise = Promise.resolve();
  }

  loading.set(key, promise);

  return promise;
}

/** Carrega as fontes (uma vez por endereco); resolve quando todas terminaram, com ou sem erro. */
export async function loadPopupFontFaces(faces: readonly PopupFontFace[]): Promise<void> {
  await Promise.all(faces.map(loadOne));
}

/** Hook: dispara o carregamento ao montar; true quando terminou (o cartao desenha antes, com font-display swap). */
export function usePopupFontFaces(faces: readonly PopupFontFace[] | undefined): boolean {
  const key = (faces ?? []).map(faceKey).join(",");
  const [doneKey, setDoneKey] = useState("");
  const load = useEffectEvent(() => loadPopupFontFaces(faces ?? []));

  useEffect(() => {
    if (!key) {
      return;
    }

    let active = true;

    void load().then(() => {
      if (active) {
        setDoneKey(key);
      }
    });

    return () => {
      active = false;
    };
  }, [key]);

  return !key || doneKey === key;
}

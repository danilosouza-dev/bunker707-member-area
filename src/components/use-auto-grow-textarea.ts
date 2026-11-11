"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

// O campo de texto que cresce com o que se escreve ate um teto e depois rola (docs/30 D81): a medida de todos os campos
// assim (o chat e as Perguntas da sala, o fio das Perguntas, o campo da equipe no console, os comentarios da aula, o
// Tutor e a IA Diretor), num lugar so.
//
// O defeito de 11/11/2026: cada campo gravava `height = min(scrollHeight, teto)` so quando o texto mudava. Montado
// dentro de um painel escondido (display:none: o painel do chat guardado fechado, o painel do console, a aba que nao
// esta na frente), o scrollHeight e 0 e a altura virava 0px; com o border-box e o pb-1 sobrava uma faixa de 4 px, sem a
// frase, ate a primeira tecla. Agora: "auto" primeiro e a altura so com scrollHeight > 0 (escondido, fica a linha
// natural do rows={1}); e um ResizeObserver no proprio campo mede de novo quando ele aparece ou muda de largura. So a
// largura chama a medida: a altura que a propria medida grava nao entra em laco.

/** O que a medida le e escreve de um textarea (um objeto qualquer nos testes). */
export type AutoGrowArea = { scrollHeight: number; style: { height: string } };

/**
 * Mede o campo: "auto" primeiro (o scrollHeight volta a ser o do texto); visivel, a altura do texto ate o `max`;
 * escondido (scrollHeight 0), fica "auto", nunca 0px.
 */
export function fitTextareaHeight(area: AutoGrowArea, max: number): void {
  area.style.height = "auto";
  const natural = area.scrollHeight;
  if (natural > 0) {
    area.style.height = `${Math.min(natural, max)}px`;
  }
}

type SizeEntry = { borderBoxSize?: ReadonlyArray<{ inlineSize: number }>; contentRect: { width: number } };
type SizeObserver = { disconnect(): void; observe(target: never): void };
type SizeObserverClass = new (callback: (entries: readonly SizeEntry[]) => void) => SizeObserver;

/** A largura da caixa do campo (a borda inteira, que nao muda quando a barra de rolagem aparece dentro dele). */
function entryWidth(entry: SizeEntry): number {
  return entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
}

/**
 * Mede de novo quando o campo aparece (o painel escondido que abre: a largura sai de 0) ou muda de largura (o painel
 * que estreita, a janela que gira). A primeira leitura do observador ja mede. Sem ResizeObserver (o servidor), nada.
 * Devolve o desligar.
 */
export function observeAutoGrow<T extends AutoGrowArea>(area: T, max: number, Observer: SizeObserverClass | undefined = globalThis.ResizeObserver as SizeObserverClass | undefined): () => void {
  if (!Observer) {
    return () => undefined;
  }
  let width = -1;
  const observer = new Observer((entries) => {
    const last = entries[entries.length - 1];
    const next = last ? entryWidth(last) : 0;
    if (next === width) {
      return;
    }
    width = next;
    fitTextareaHeight(area, max);
  });
  observer.observe(area as never);
  return () => observer.disconnect();
}

/**
 * O campo de `ref` cresce com `value` ate `max` px e depois rola. Mede antes da pintura quando o texto muda e de novo
 * quando o campo aparece ou muda de largura; o campo montado de novo (o painel que fecha e abre com outro elemento)
 * ganha o observador dele.
 */
export function useAutoGrowTextarea(ref: RefObject<HTMLTextAreaElement | null>, value: string, max: number): void {
  const watched = useRef<{ area: HTMLTextAreaElement; max: number; stop: () => void } | null>(null);

  // Sem lista de dependencias de proposito: a cada desenho, so confere se o elemento e outro (barato).
  useLayoutEffect(() => {
    const area = ref.current;
    if (watched.current?.area === area && watched.current?.max === max) {
      return;
    }
    watched.current?.stop();
    watched.current = area ? { area, max, stop: observeAutoGrow(area, max) } : null;
  });

  useEffect(
    () => () => {
      watched.current?.stop();
      watched.current = null;
    },
    []
  );

  useLayoutEffect(() => {
    const area = ref.current;
    if (area) {
      fitTextareaHeight(area, max);
    }
  }, [max, ref, value]);
}

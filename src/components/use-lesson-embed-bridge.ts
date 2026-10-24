"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { announceLessonMedia } from "@/lib/lesson-media-signal";
import type { EmbedBridge, EmbedCallbacks } from "@/lib/lesson-embed-bridge";
import { embedBridgeTarget } from "@/lib/lesson-embed-origins";

// A ponte com o player de fora da aula (Bunny, Vimeo, Mux; docs/29 §4.4) dentro do React: so liga e desliga a
// sessao de src/lib/lesson-embed-bridge.ts. O efeito depende so de enabled, do iframe (o elemento, por um ref de
// funcao com estado: o iframe monta um quadro depois do primeiro desenho), da aula e do src; callbacks novos a
// cada desenho vao para um ref e nunca religam a ponte. O estado so muda quando a ponte, o tocar ou a tela cheia
// mudam: o tempo do video (ate 4 vezes por segundo no Vimeo) nao redesenha a pagina nem vira anuncio.
//
// O codigo da ponte so baixa quando a aula tem um player da lista (nunca no video de arquivo nem no YouTube):
// fica fora do JS inicial da pagina da aula. Enquanto baixa, a aula conta como "ponte pendente" pelo snapshot
// (lesson-media-signal.ts), e a ponte que liga depois de o player carregar ainda confirma (o aperto de mao).

type EmbedSession = ReturnType<typeof import("@/lib/lesson-embed-bridge").createEmbedBridgeSession>;

const loadBridge = () => import("@/lib/lesson-embed-bridge");

export function useLessonEmbedBridge(input: EmbedCallbacks & {
  enabled: boolean;
  /** O elemento (por um ref de funcao com estado): o efeito roda de novo quando o iframe monta depois do primeiro render. */
  iframe: HTMLIFrameElement | null;
  lessonId: string | null;
  src: string | null;
}): { bridge: EmbedBridge; playing: boolean } {
  const { enabled, iframe, lessonId, onEnded, onPause, onPlay, onTime, src } = input;
  const callbacksRef = useRef<EmbedCallbacks>({ onEnded, onPause, onPlay, onTime });
  const sessionRef = useRef<EmbedSession | null>(null);
  const [state, setState] = useState<{ bridge: EmbedBridge; playing: boolean }>({ bridge: "silent", playing: false });

  // Os callbacks mais novos, depois de cada desenho (a sessao le na hora de chamar).
  useLayoutEffect(() => {
    callbacksRef.current = { onEnded, onPause, onPlay, onTime };
  });

  useEffect(() => {
    const settings = { enabled, iframe, lessonId, src };
    let current = true;

    // Nada a ligar e nada ligado: nem baixa a ponte.
    if (!sessionRef.current && !(enabled && iframe && lessonId && embedBridgeTarget(src))) {
      return;
    }

    void loadBridge()
      .then(({ createEmbedBridgeSession }) => {
        // So o efeito mais novo liga (o iframe, a aula ou o src mudaram enquanto baixava).
        if (!current) {
          return;
        }

        sessionRef.current ??= createEmbedBridgeSession({
          announce: (signal) => {
            announceLessonMedia({ bridge: signal.bridge, fullscreen: signal.fullscreen, kind: "embed", lessonId: signal.lessonId, playing: signal.playing });
            setState((previous) => (previous.bridge === signal.bridge && previous.playing === signal.playing ? previous : { bridge: signal.bridge, playing: signal.playing }));
          },
          callbacks: () => callbacksRef.current,
          win: window
        });
        sessionRef.current.set(settings);
      })
      // Sem o codigo (rede caiu, deploy novo): tudo como sem ponte.
      .catch(() => undefined);

    return () => {
      current = false;
    };
  }, [enabled, iframe, lessonId, src]);

  useEffect(
    () => () => {
      sessionRef.current?.stop();
      sessionRef.current = null;
    },
    []
  );

  return state;
}

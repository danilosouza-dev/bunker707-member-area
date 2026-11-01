"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { EmbedBridge, EmbedBridgeHandle, EmbedBridgeState, EmbedCommand, EmbedMessage } from "@/lib/lesson-embed-bridge";
import { embedBridgeTarget } from "@/lib/lesson-embed-origins";
import { announceLessonMedia } from "@/lib/lesson-media-signal";
import { lockDecision, roomMediaLessonId, targetOffsetMs } from "@/lib/webinar-room-client";

// O player da Bunny na Sala (docs/30 §6.6): a ponte do Player.js (src/lib/lesson-embed-bridge.ts, baixada so aqui)
// com os comandos novos. Na Live gravada o player fica travado no relogio do servidor: a cada `timeupdate`, se
// |atual − alvo| > 2 s, setCurrentTime(alvo); a cada `seeked` fora do alvo, volta; um `pause` vira `play` de novo
// (nao ha pausa na sessao); no fim do video, encerrada. No Replay o player e livre e so avisa o segundo (o chat
// segue). O sinal de midia da aula (lesson-media-signal) e anunciado com o id da sessao: o pop-up nunca abre
// com o player tocando. Nada aqui fala com a rede.

export type RoomPlayerState = { bridge: EmbedBridge; currentSeconds: number | null; ended: boolean; playing: boolean };

const INITIAL: RoomPlayerState = { bridge: "pending", currentSeconds: null, ended: false, playing: false };
/** Depois de recolocar o player, espera isto antes de conferir de novo (o salto leva um instante). */
const SEEK_SETTLE_MS = 1_500;

const loadBridge = () => import("@/lib/lesson-embed-bridge");

export function useRoomPlayer(input: {
  durationMs: number;
  enabled: boolean;
  iframe: HTMLIFrameElement | null;
  /** Live gravada: segue o relogio; Replay: livre. */
  locked: boolean;
  onEnded?: () => void;
  /** Replay: o segundo do player, no maximo 1 vez por segundo (o chat segue por ele). */
  onTime?: (seconds: number) => void;
  sessionId: string;
  skewRef: RefObject<number>;
  src: string | null;
  zeroMs: number;
}): RoomPlayerState & { send: (command: EmbedCommand, value?: number) => boolean; unmute: () => void } {
  const { durationMs, enabled, iframe, locked, sessionId, skewRef, src, zeroMs } = input;
  const [state, setState] = useState<RoomPlayerState>(INITIAL);
  const handleRef = useRef<EmbedBridgeHandle | null>(null);
  const protocolRef = useRef<"playerjs" | "vimeo">("playerjs");
  const commandRef = useRef<((command: EmbedCommand, value?: number) => boolean) | null>(null);
  const seekUntilRef = useRef(0);
  const endedRef = useRef(false);
  const lastSecondRef = useRef<number | null>(null);
  const callbacksRef = useRef({ onEnded: input.onEnded, onTime: input.onTime });

  useEffect(() => {
    callbacksRef.current = { onEnded: input.onEnded, onTime: input.onTime };
  });

  const send = useCallback((command: EmbedCommand, value?: number) => commandRef.current?.(command, value) ?? false, []);

  useEffect(() => {
    const target = enabled && iframe ? embedBridgeTarget(src) : null;
    if (!target || !iframe) {
      return;
    }
    let current = true;
    const lessonId = roomMediaLessonId(sessionId);
    endedRef.current = false;
    lastSecondRef.current = null;

    void loadBridge()
      .then(({ embedCommand, openEmbedBridge }) => {
        if (!current) {
          return;
        }
        protocolRef.current = target.protocol;

        const handle = openEmbedBridge({
          extraEvents: ["seeked"],
          iframe,
          onChange(next: EmbedBridgeState, message: EmbedMessage | null) {
            announceLessonMedia({ bridge: next.bridge, fullscreen: next.fullscreen, kind: "embed", lessonId, playing: next.playing });
            setState((previous) =>
              previous.bridge === next.bridge && previous.playing === next.playing && previous.ended === next.ended && previous.currentSeconds === next.seconds
                ? previous
                : { bridge: next.bridge, currentSeconds: next.seconds, ended: next.ended || endedRef.current, playing: next.playing }
            );
            if (!message || next.bridge !== "confirmed") {
              return;
            }
            if (message.kind === "ended") {
              endedRef.current = true;
              callbacksRef.current.onEnded?.();
              return;
            }
            if (!locked) {
              if ((message.kind === "time" || message.kind === "seeked" || message.kind === "current_time") && next.seconds !== null) {
                const second = Math.floor(next.seconds);
                if (second !== lastSecondRef.current || message.kind === "seeked") {
                  lastSecondRef.current = second;
                  callbacksRef.current.onTime?.(next.seconds);
                }
              }
              return;
            }
            // A trava: o player segue o relogio do servidor; o aluno nao pausa nem volta.
            const now = Date.now();
            if (message.kind === "pause" && !endedRef.current) {
              handle.send(embedCommand(target.protocol, "play"));
              return;
            }
            if (message.kind !== "time" && message.kind !== "seeked" && message.kind !== "play") {
              return;
            }
            if (now < seekUntilRef.current) {
              return;
            }
            const targetSeconds = targetOffsetMs({ deviceNowMs: now, skewMs: skewRef.current ?? 0, zeroMs }) / 1000;
            const decision = lockDecision({ currentSeconds: next.seconds, durationSeconds: durationMs / 1000, targetSeconds });
            if (decision.action === "seek") {
              seekUntilRef.current = now + SEEK_SETTLE_MS;
              handle.send(embedCommand(target.protocol, "setCurrentTime", decision.to));
            } else if (decision.action === "ended" && !endedRef.current) {
              endedRef.current = true;
              handle.send(embedCommand(target.protocol, "pause"));
              setState((previous) => (previous.ended ? previous : { ...previous, ended: true, playing: false }));
              callbacksRef.current.onEnded?.();
            }
          },
          target,
          win: window
        });
        handleRef.current = handle;
        commandRef.current = (command, value) => handle.send(embedCommand(target.protocol, command, value));
      })
      .catch(() => undefined);

    return () => {
      current = false;
      handleRef.current?.disconnect();
      handleRef.current = null;
      commandRef.current = null;
      announceLessonMedia({ bridge: "silent", fullscreen: false, kind: "embed", lessonId, playing: false });
      setState(INITIAL);
    };
  }, [durationMs, enabled, iframe, locked, sessionId, skewRef, src, zeroMs]);

  const unmute = useCallback(() => {
    send("unmute");
    send("play");
  }, [send]);

  return { ...state, send, unmute };
}

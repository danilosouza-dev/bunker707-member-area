"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ChatLanguage } from "@/server/webinars/model";
import { TRANSLATION_POLL_MS, applyTranslations, translatedCount } from "@/server/webinars/translation-model";
import type { RoomMessage } from "@/lib/webinar-room-client";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { getRoomTranslations, getViewerPrefs, putViewerPrefs, WebinarsRequestError } from "../translation/translation-api";
import {
  loadViewerPrefsOnce,
  pollRoomTranslations,
  rememberViewerPrefs,
  subscribeRoomTranslation,
  translationMemoryKey,
  translationMemoryOf,
  viewerPrefsSnapshot
} from "../translation/room-translation-cache";

// A traducao do chat e do roteiro na sala (docs/30 §1.6, fase 4f): as mensagens que a sala mostra trocadas pela
// traducao guardada no idioma do aluno (GET /api/webinars/[id]/translations), com a original a um toque ("Ver
// original" na faixa de translation/room-translation-bar.tsx). O idioma e lido uma vez por pagina (GET
// /api/webinars/preferences, Perfil › Privacidade); com ele, a cada 5 s a sala pede as mensagens visiveis que ainda
// nao tem resposta (lotes de ate 100; as do proprio aluno ficam como ele escreveu), guarda id -> corpo na memoria do
// modulo (sobrevive a troca de desenho normal <-> vertical) e devolve as mensagens com o corpo trocado; as pendentes
// sao pedidas de novo ate 6 vezes e depois ficam como foram escritas. Sem idioma, desligado no ambiente ou no banco,
// ou no "ver como" (enabled falso), as mensagens passam como vieram e nada e pedido. webinar-room.tsx passa as
// mensagens reveladas por aqui e entrega `messages` ao chat (as duas formas da sala mostram so as traduzidas). O
// aluno tambem escolhe o idioma na propria sala (`chooseLanguage`, o seletor compacto da faixa): o mesmo PUT do Perfil,
// guardado na memoria da pagina, e a traducao liga sem recarregar nem sair da sala.

export type UseRoomTranslationInput = {
  /** Falso no "ver como" e sem a traducao ligada no ambiente. */
  enabled: boolean;
  messages: readonly RoomMessage[];
  sessionId: string;
  webinarId: string;
};

export type RoomTranslationState = {
  /** A traducao esta ligada para este aluno (ambiente e banco) e fora do "ver como": a faixa mostra o seletor. */
  available: boolean;
  /** Troca o idioma na sala (nulo = como foi escrito); a falha vira `chooseError`. */
  chooseLanguage: (language: ChatLanguage | null) => Promise<void>;
  /** A frase da falha ao salvar o idioma na sala. */
  chooseError: string | null;
  /** O idioma esta sendo salvo. */
  choosing: boolean;
  /** O idioma escolhido pelo aluno; nulo = como foi escrito (ou traducao desligada). */
  language: ChatLanguage | null;
  /** As mensagens para mostrar (com o corpo traduzido quando ha traducao guardada; as originais com "Ver original"). */
  messages: readonly RoomMessage[];
  /** "Ver original" ligado: a sala mostra como foi escrito sem parar de traduzir. */
  showOriginal: boolean;
  toggleOriginal: () => void;
  /** Quantas das mensagens mostradas tem traducao agora. */
  translated: number;
  /** Alguma mensagem mostrada ainda esta sendo traduzida. */
  translating: boolean;
};

export function useRoomTranslation(input: UseRoomTranslationInput): RoomTranslationState {
  const { enabled, messages, sessionId, webinarId } = input;
  const prefs = useSyncExternalStore(subscribeRoomTranslation, viewerPrefsSnapshot, viewerPrefsSnapshot);
  const language = enabled && prefs.value?.enabled ? prefs.value.chatLanguage : null;
  const key = language ? translationMemoryKey(webinarId, sessionId, language) : null;
  const readMemory = useCallback(() => translationMemoryOf(key), [key]);
  const memory = useSyncExternalStore(subscribeRoomTranslation, readMemory, readMemory);
  const [showOriginal, setShowOriginal] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [chooseError, setChooseError] = useState<string | null>(null);
  const available = enabled && prefs.status === "ready" && prefs.value?.enabled === true;
  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
  });

  // O idioma, uma vez por pagina (quem salvou no Perfil nesta mesma pagina ja deixou na memoria).
  useEffect(() => {
    if (enabled) {
      void loadViewerPrefsOnce(() => getViewerPrefs());
    }
  }, [enabled]);

  // A consulta: logo ao ter o idioma e depois no intervalo que a rodada devolve (5 s; 1 s no atraso; Retry-After); com
  // a aba escondida, so espera.
  useEffect(() => {
    if (!key || !language) {
      return;
    }
    let stopped = false;
    let timer: number | null = null;
    const controller = new AbortController();

    const tick = async () => {
      // Aba escondida: nada a mostrar, nada a pedir (a rodada seguinte confere de novo).
      const next =
        document.visibilityState === "hidden"
          ? TRANSLATION_POLL_MS
          : await pollRoomTranslations({
              fetchTranslations: (ids) => getRoomTranslations(webinarId, sessionId, language, ids, controller.signal),
              key,
              messages: messagesRef.current
            });
      if (!stopped) {
        timer = window.setTimeout(() => void tick(), next);
      }
    };

    timer = window.setTimeout(() => void tick(), 0);
    return () => {
      stopped = true;
      controller.abort();
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [key, language, sessionId, webinarId]);

  const toggleOriginal = useCallback(() => setShowOriginal((value) => !value), []);

  const chooseLanguage = useCallback(
    async (next: ChatLanguage | null) => {
      if (!enabled) {
        return;
      }
      setChoosing(true);
      setChooseError(null);
      try {
        // O mesmo PUT do Perfil: a memoria da pagina troca e o efeito da consulta comeca no idioma novo.
        rememberViewerPrefs(await putViewerPrefs(next));
        setShowOriginal(false);
      } catch (failure) {
        setChooseError(failure instanceof WebinarsRequestError && failure.status < 500 ? failure.message : WEBINAR_COPY.traducao.erro);
      } finally {
        setChoosing(false);
      }
    },
    [enabled]
  );

  const shown = useMemo(() => (language && !showOriginal ? applyTranslations(messages, memory.bodies) : messages), [language, memory, messages, showOriginal]);
  const translated = useMemo(() => (language ? translatedCount(messages, memory.bodies) : 0), [language, memory, messages]);
  const translating = useMemo(() => Boolean(language) && messages.some((message) => memory.attempts.has(message.id.toLowerCase())), [language, memory, messages]);

  return { available, chooseError, chooseLanguage, choosing, language, messages: shown, showOriginal, toggleOriginal, translated, translating };
}

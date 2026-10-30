// A memoria da traducao no navegador (docs/30 §1.6, fase 4f): o idioma do chat lido UMA vez por pagina (GET
// /api/webinars/preferences; o salvar do Perfil troca na hora) e, por sessao e idioma, o que a sala ja sabe de cada
// mensagem (id -> corpo traduzido, as resolvidas como foram escritas e as tentativas das pendentes; as contas em
// translation-model.ts). Vive no modulo para sobreviver a troca de desenho da sala (normal <-> vertical, minimizar) e
// avisa quem assina (useSyncExternalStore). So o navegador escreve aqui: no servidor nada roda (os efeitos nao rodam
// na primeira pintura), entao a memoria la fica sempre vazia e a primeira pintura e a do chat como foi escrito.
// `pollRoomTranslations` e uma rodada da consulta de 5 s, fora do React (os testes chamam direto).

import type { ChatLanguage } from "@/server/webinars/model";
import {
  EMPTY_TRANSLATION_MEMORY,
  TRANSLATION_POLL_MS,
  rememberTranslations,
  translationRequestIds,
  type RoomTranslationMemory,
  type TranslationsReply,
  type ViewerPrefsReply
} from "@/server/webinars/translation-model";
import { retryAfterSecondsOf } from "./translation-api";

export type ViewerPrefsSnapshot = { status: "error" | "idle" | "loading" | "ready"; value: ViewerPrefsReply | null };

const IDLE: ViewerPrefsSnapshot = Object.freeze({ status: "idle", value: null });
/** Quantas sessoes/idiomas ficam na memoria ao mesmo tempo (a sala aberta e as ultimas). */
const MAX_MEMORIES = 8;
/** Quando sobram mais de 100 mensagens sem resposta (entrar com o historico), a proxima rodada vem logo. */
const CATCH_UP_MS = 1_000;

let prefs: ViewerPrefsSnapshot = IDLE;
let prefsPromise: Promise<ViewerPrefsReply | null> | null = null;
const memories = new Map<string, RoomTranslationMemory>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) {
    listener();
  }
}

export function subscribeRoomTranslation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function viewerPrefsSnapshot(): ViewerPrefsSnapshot {
  return prefs;
}

/** O idioma que a pagina usa a partir de agora (resposta do GET, do PUT do Perfil ou da sala dizendo desligado). */
export function rememberViewerPrefs(value: ViewerPrefsReply): void {
  prefs = { status: "ready", value: { chatLanguage: value.chatLanguage, enabled: value.enabled } };
  emit();
}

/** Le o idioma uma vez por pagina (quem chega depois espera a mesma leitura); a falha deixa como foi escrito. */
export function loadViewerPrefsOnce(load: () => Promise<ViewerPrefsReply>): Promise<ViewerPrefsReply | null> {
  if (prefs.status === "ready" || prefs.status === "error") {
    return Promise.resolve(prefs.value);
  }
  if (prefsPromise) {
    return prefsPromise;
  }
  prefs = { status: "loading", value: null };
  emit();
  prefsPromise = load().then(
    (value) => {
      rememberViewerPrefs(value);
      return prefs.value;
    },
    () => {
      prefs = { status: "error", value: null };
      emit();
      return null;
    }
  );
  void prefsPromise.finally(() => {
    prefsPromise = null;
  });
  return prefsPromise;
}

/** A chave da memoria: o webinario, a sessao e o idioma (trocar o idioma comeca do zero). */
export function translationMemoryKey(webinarId: string, sessionId: string, language: ChatLanguage): string {
  return `${webinarId.toLowerCase()}:${sessionId.toLowerCase()}:${language}`;
}

export function translationMemoryOf(key: string | null): RoomTranslationMemory {
  return (key ? memories.get(key) : undefined) ?? EMPTY_TRANSLATION_MEMORY;
}

/** Guarda a resposta de um pedido (os ids pedidos e o que voltou) na memoria da chave. */
export function rememberRoomAnswer(key: string, requested: readonly string[], answer: Pick<TranslationsReply, "pending" | "translations">): void {
  const next = rememberTranslations(translationMemoryOf(key), requested, answer);
  memories.delete(key);
  while (memories.size >= MAX_MEMORIES) {
    const oldest = memories.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    memories.delete(oldest);
  }
  memories.set(key, next);
  emit();
}

/** Zera o idioma lido e a memoria (testes). */
export function resetRoomTranslationCache(): void {
  prefs = IDLE;
  prefsPromise = null;
  memories.clear();
  emit();
}

type PollMessage = { body: string; id: string; mine: boolean };

/**
 * Uma rodada da consulta: pede (ate 100 por vez) as mensagens mostradas ainda sem resposta, guarda o que voltou e
 * diz quando rodar de novo (5 s; 1 s quando ainda sobram mais de 100; o Retry-After no 429). A sala dizendo desligado
 * (env ou banco) desliga a traducao na pagina; falha de rede so espera a proxima rodada.
 */
export async function pollRoomTranslations(input: { fetchTranslations: (ids: string[]) => Promise<TranslationsReply>; key: string; messages: readonly PollMessage[] }): Promise<number> {
  const memory = translationMemoryOf(input.key);
  const ids = translationRequestIds({ memory, messages: input.messages });
  if (ids.length === 0) {
    return TRANSLATION_POLL_MS;
  }
  const overflow = translationRequestIds({ limit: 1, memory: { ...memory, done: new Set([...memory.done, ...ids]) }, messages: input.messages }).length > 0;
  try {
    const answer = await input.fetchTranslations(ids);
    if (!answer.enabled) {
      rememberViewerPrefs({ chatLanguage: prefs.value?.chatLanguage ?? null, enabled: false });
      return TRANSLATION_POLL_MS;
    }
    rememberRoomAnswer(input.key, ids, answer);
    return overflow ? CATCH_UP_MS : TRANSLATION_POLL_MS;
  } catch (error) {
    const retry = retryAfterSecondsOf(error);
    return retry ? retry * 1000 : TRANSLATION_POLL_MS;
  }
}

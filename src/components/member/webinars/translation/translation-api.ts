"use client";

// A conversa da traducao do chat com /api/webinars/preferences e /api/webinars/[id]/translations (docs/30 §1.6, fase
// 4f), no desenho de room-api.ts: fetch sem cache e na mesma origem; { data } | { error, reason? } desembrulhado em
// WebinarsRequestError (4xx traz a frase do servidor; 5xx e falha de rede ficam com a frase da tela; o 429 leva o
// Retry-After). Nada de segredo aqui; o navegador nunca chama a IA.

import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { ChatLanguage } from "@/server/webinars/model";
import type { TranslationsReply, ViewerPrefsReply } from "@/server/webinars/translation-model";
import { WebinarsRequestError } from "../webinars-client";

export { WebinarsRequestError };
export type { TranslationsReply, ViewerPrefsReply };

export const VIEWER_PREFS_PATH = "/api/webinars/preferences";

export function translationsPath(webinarId: string, sessionId: string, language: ChatLanguage, ids: readonly string[]): string {
  const params = new URLSearchParams({ ids: ids.join(","), lang: language, sessao: sessionId });
  return `/api/webinars/${encodeURIComponent(webinarId)}/translations?${params.toString()}`;
}

async function readData<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string; reason?: string };
  if (!response.ok || payload.data === undefined) {
    const message = response.status >= 400 && response.status < 500 && payload.error ? payload.error : fallback;
    const error = new WebinarsRequestError(message, response.status, payload.reason);
    const retry = Number(response.headers.get("Retry-After"));
    if (Number.isFinite(retry) && retry > 0) {
      (error as WebinarsRequestError & { retryAfterSeconds?: number }).retryAfterSeconds = retry;
    }
    throw error;
  }
  return payload.data;
}

/** O idioma do chat escolhido pelo aluno e se a traducao esta ligada. */
export async function getViewerPrefs(signal?: AbortSignal): Promise<ViewerPrefsReply> {
  const response = await fetch(VIEWER_PREFS_PATH, { cache: "no-store", credentials: "same-origin", signal });
  return readData<ViewerPrefsReply>(response, WEBINAR_COPY.traducao.erro);
}

/** Grava o idioma (nulo = como foi escrito). */
export async function putViewerPrefs(chatLanguage: ChatLanguage | null): Promise<ViewerPrefsReply> {
  const response = await fetch(VIEWER_PREFS_PATH, {
    body: JSON.stringify({ chatLanguage }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "PUT"
  });
  return readData<ViewerPrefsReply>(response, WEBINAR_COPY.traducao.erro);
}

/** As traducoes guardadas das mensagens que a sala mostra (e quais ainda estao sendo traduzidas). */
export async function getRoomTranslations(webinarId: string, sessionId: string, language: ChatLanguage, ids: readonly string[], signal?: AbortSignal): Promise<TranslationsReply> {
  const response = await fetch(translationsPath(webinarId, sessionId, language, ids), { cache: "no-store", credentials: "same-origin", signal });
  return readData<TranslationsReply>(response, WEBINAR_COPY.traducao.erroLer);
}

export function retryAfterSecondsOf(error: unknown): number | null {
  const value = (error as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
  return typeof value === "number" && value > 0 ? value : null;
}

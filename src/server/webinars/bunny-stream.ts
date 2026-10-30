// O cliente minimo da API da Bunny Stream (docs/30 §4.5, §5.3 e §6.4 passo 10; D10): o job webinar-recordings do tick
// consulta a codificacao do video que o finalize.sh do gravador enviou (GET .../videos/<id>: status e duracao) ate
// `finished`, e apaga o video quando a retencao vence (DELETE; 404 conta como apagado). So no servidor: a chave
// (BUNNY_STREAM_API_KEY, a "API Key" da biblioteca) vai no cabecalho AccessKey, nunca no navegador nem em
// NEXT_PUBLIC_*; a biblioteca e BUNNY_STREAM_LIBRARY_ID. Sem as duas variaveis, bunnyStreamFrom devolve nulo e o job
// nao consulta (a gravacao fica `processing` ate a equipe ligar o video pelo console). Cada pedido tem teto de 10 s
// (junto do sinal do tick, quando vem). O `fetch` e injetavel (tests/webinarios-gravacoes-job.test.mjs usa um duble).

import "server-only";

export const BUNNY_STREAM_API = "https://video.bunnycdn.com";
export const BUNNY_TIMEOUT_MS = 10_000;

/** O status de um video na Bunny Stream (VideoModelStatus da API). */
export const BUNNY_VIDEO_STATUS = {
  created: 0,
  uploaded: 1,
  processing: 2,
  transcoding: 3,
  finished: 4,
  error: 5,
  uploadFailed: 6,
  jitSegmenting: 7,
  jitPlaylistsCreated: 8
} as const;

export type BunnyVideo = {
  /** Duracao em segundos (`length`); nulo enquanto a Bunny nao mediu. */
  lengthSeconds: number | null;
  /** O numero da Bunny (BUNNY_VIDEO_STATUS): 4 pronto, 5 erro, 6 envio falhou; o resto ainda codificando. */
  status: number;
};

/** Falha que nao diz nada sobre o video (rede, tempo, 401, 5xx): quem chama tenta de novo depois. */
export class BunnyStreamError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "BunnyStreamError";
    this.status = status;
  }
}

type FetchResponse = { json(): Promise<unknown>; ok: boolean; status: number };
export type BunnyFetch = (url: string, init: { headers: Record<string, string>; method: string; signal?: AbortSignal }) => Promise<FetchResponse>;

export type BunnyRequestOptions = { signal?: AbortSignal };

export type BunnyStreamClient = {
  /** A biblioteca configurada: a gravacao sem biblioteca anotada usa esta. */
  libraryId: string;
  /** Apaga o video; `missing` quando ele ja nao existia (404 conta como apagado). */
  deleteVideo(libraryId: string, videoId: string, options?: BunnyRequestOptions): Promise<"deleted" | "missing">;
  /** O status e a duracao do video; nulo quando a Bunny responde 404 (o video nao existe). */
  getVideo(libraryId: string, videoId: string, options?: BunnyRequestOptions): Promise<BunnyVideo | null>;
};

const LIBRARY_ID = /^\d{1,12}$/;
const VIDEO_ID = /^[0-9A-Za-z-]{8,80}$/;
const API_KEY = /^[A-Za-z0-9-]{16,128}$/;

/** O endereco do video na API, com os ids conferidos (nada de caminho montado com texto livre). */
export function bunnyVideoUrl(libraryId: string, videoId: string): string {
  if (!LIBRARY_ID.test(libraryId) || !VIDEO_ID.test(videoId)) {
    throw new BunnyStreamError("Bunny: biblioteca ou video invalidos.");
  }
  return `${BUNNY_STREAM_API}/library/${libraryId}/videos/${videoId}`;
}

function signalFor(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

function lengthOf(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(86_400, Math.round(number)) : null;
}

/** O cliente com a chave e a biblioteca ja conferidas (bunnyStreamFrom confere o ambiente). */
export function bunnyStreamClient(input: { apiKey: string; fetchImpl?: BunnyFetch; libraryId: string; timeoutMs?: number }): BunnyStreamClient {
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as BunnyFetch);
  const timeoutMs = input.timeoutMs ?? BUNNY_TIMEOUT_MS;
  const headers = { accept: "application/json", AccessKey: input.apiKey };

  async function call(method: "DELETE" | "GET", libraryId: string, videoId: string, options?: BunnyRequestOptions): Promise<FetchResponse> {
    const url = bunnyVideoUrl(libraryId, videoId);
    try {
      return await fetchImpl(url, { headers, method, signal: signalFor(timeoutMs, options?.signal) });
    } catch (error) {
      const reason = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "sem resposta em tempo" : "falha de rede";
      throw new BunnyStreamError(`Bunny: ${method} do video ${videoId} (${reason}).`);
    }
  }

  return {
    async deleteVideo(libraryId, videoId, options) {
      const response = await call("DELETE", libraryId, videoId, options);
      if (response.status === 404) {
        return "missing";
      }
      if (!response.ok) {
        throw new BunnyStreamError(`Bunny: apagar o video ${videoId} respondeu ${response.status}.`, response.status);
      }
      return "deleted";
    },
    async getVideo(libraryId, videoId, options) {
      const response = await call("GET", libraryId, videoId, options);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new BunnyStreamError(`Bunny: ler o video ${videoId} respondeu ${response.status}.`, response.status);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new BunnyStreamError(`Bunny: resposta sem JSON para o video ${videoId}.`, response.status);
      }
      const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      const status = typeof raw.status === "number" ? raw.status : Number(raw.status);
      if (!Number.isInteger(status)) {
        throw new BunnyStreamError(`Bunny: resposta sem status para o video ${videoId}.`, response.status);
      }
      return { lengthSeconds: lengthOf(raw.length), status };
    },
    libraryId: input.libraryId
  };
}

/**
 * O cliente deste ambiente: BUNNY_STREAM_API_KEY (a chave da biblioteca, so letras, numeros e hifens) e
 * BUNNY_STREAM_LIBRARY_ID (numero). Faltando ou invalida qualquer uma: nulo (o job nao consulta nem apaga).
 */
export function bunnyStreamFrom(env: Record<string, string | undefined>, fetchImpl?: BunnyFetch): BunnyStreamClient | null {
  const apiKey = (env.BUNNY_STREAM_API_KEY ?? "").trim();
  const libraryId = (env.BUNNY_STREAM_LIBRARY_ID ?? "").trim();
  if (!API_KEY.test(apiKey) || !LIBRARY_ID.test(libraryId)) {
    return null;
  }
  return bunnyStreamClient({ apiKey, fetchImpl, libraryId });
}

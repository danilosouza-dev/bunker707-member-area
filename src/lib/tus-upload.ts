// O envio com retomada (TUS 1.0.0) de um arquivo grande, direto do navegador (docs/30 D142: a gravacao no computador de
// quem apresenta vai para a Bunny sem passar pelo nosso servidor). Puro: sem React, o `fetch` e a espera sao injetaveis
// (tests/tus-envio.test.mjs). Manda em pedacos; a rede que cai ou o servidor que falha espera e continua do ponto que o
// servidor diz ter recebido (HEAD), nunca do que o navegador acha que mandou. Devolve "expired" quando o endereco do envio
// nao existe mais (a Bunny guarda um envio parado por cerca de 48 h): quem chama pede outro.

export const TUS_CHUNK_BYTES = 8 * 1024 * 1024;
/** Falhas seguidas sem nenhum pedaco aceito antes de desistir (cerca de 9 min com as esperas abaixo). */
export const TUS_MAX_FAILURES = 22;
const WAITS_MS = [1_000, 3_000, 8_000, 15_000, 30_000];
const REQUEST_TIMEOUT_MS = 5 * 60_000;

export class TusUploadError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "TusUploadError";
    this.status = status;
  }
}

type TusFetch = (url: string, init: RequestInit) => Promise<Response>;

export type TusUploadInput = {
  blob: Blob;
  chunkBytes?: number;
  endpoint: string;
  fetchImpl?: TusFetch;
  /** A autorizacao, em todo pedido. */
  headers: Record<string, string>;
  /** O endereco de um envio ja comecado (a retomada); nulo, um envio novo. */
  location: string | null;
  metadata: Record<string, string>;
  onLocation?: (location: string) => void;
  onProgress?: (sentBytes: number) => void;
  signal?: AbortSignal;
  wait?: (ms: number) => Promise<void>;
};

function base64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

/** "titulo <base64>,filetype <base64>" (o cabecalho Upload-Metadata). */
export function tusMetadata(metadata: Record<string, string>): string {
  return Object.entries(metadata)
    .map(([key, value]) => `${key} ${base64(value)}`)
    .join(",");
}

function offsetOf(response: Response): number | null {
  const raw = response.headers.get("upload-offset");
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/** O pedido recusado que nao adianta repetir (o 409 e o 423 voltam pelo HEAD; 429 e 5xx esperam). */
function denied(status: number): boolean {
  return status >= 400 && status < 500 && ![408, 409, 423, 425, 429, 460].includes(status);
}

export async function tusUpload(input: TusUploadInput): Promise<"done" | "expired"> {
  const fetchImpl = input.fetchImpl ?? ((url, init) => fetch(url, init));
  const wait = input.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const chunk = input.chunkBytes ?? TUS_CHUNK_BYTES;
  const size = input.blob.size;
  const base = { ...input.headers, "Tus-Resumable": "1.0.0" };
  let location = input.location;
  let offset: number | null = location ? null : 0;
  let failures = 0;

  const request = (url: string, init: RequestInit) => {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    return fetchImpl(url, { ...init, signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout });
  };

  while (location === null || offset === null || offset < size) {
    input.signal?.throwIfAborted();

    try {
      if (location === null) {
        const response = await request(input.endpoint, { headers: { ...base, "Upload-Length": String(size), "Upload-Metadata": tusMetadata(input.metadata) }, method: "POST" });
        const header = response.headers.get("location");
        if (response.status !== 201 || !header) {
          throw new TusUploadError("O envio não começou.", response.status);
        }
        const url = new URL(header, input.endpoint);
        // O arquivo so segue para o mesmo servidor da autorizacao.
        if (url.origin !== new URL(input.endpoint).origin) {
          throw new TusUploadError("O envio respondeu um endereço de outro servidor.", 400);
        }
        location = url.href;
        offset = 0;
        input.onLocation?.(location);
      } else if (offset === null) {
        const response = await request(location, { headers: base, method: "HEAD" });
        if (response.status === 404 || response.status === 410) {
          return "expired";
        }
        offset = response.ok ? offsetOf(response) : null;
        // Mais bytes do que o arquivo tem: esse envio nao serve mais, comeca outro.
        if (offset !== null && offset > size) {
          return "expired";
        }
        if (offset === null) {
          throw new TusUploadError("O envio não respondeu de onde continuar.", response.status);
        }
        input.onProgress?.(offset);
      } else {
        const response = await request(location, {
          body: input.blob.slice(offset, Math.min(size, offset + chunk)),
          headers: { ...base, "Content-Type": "application/offset+octet-stream", "Upload-Offset": String(offset) },
          method: "PATCH"
        });
        if (response.status === 404 || response.status === 410) {
          return "expired";
        }
        const next = response.ok ? offsetOf(response) : null;
        if (next === null || next <= offset || next > size) {
          throw new TusUploadError("O envio recusou um pedaço.", response.status);
        }
        offset = next;
        failures = 0;
        input.onProgress?.(offset);
      }
    } catch (error) {
      input.signal?.throwIfAborted();
      const status = error instanceof TusUploadError ? error.status : null;
      failures += 1;
      if ((status !== null && denied(status)) || failures >= TUS_MAX_FAILURES) {
        throw error instanceof TusUploadError ? error : new TusUploadError("A conexão caiu durante o envio.");
      }
      await wait(WAITS_MS[Math.min(failures - 1, WAITS_MS.length - 1)]);
      // So o servidor sabe quanto chegou.
      offset = location === null ? 0 : null;
    }
  }

  return "done";
}

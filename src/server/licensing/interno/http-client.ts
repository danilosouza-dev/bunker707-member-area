// O cliente HTTP da API interna do Emissor (docs/32 §11.2, "API interna"; contract.ts). So a nossa escola o usa, e so
// com EMISSOR_INTERNO_URL e EMISSOR_INTERNO_CREDENCIAL (config.ts).
//
// Regras:
// - nunca lanca: toda falha volta como { ok: false, error } com o codigo do Emissor ou um do cliente;
// - tempo limite por pedido (padrao de 8 s; a tarefa do tick soma o `signal` dela), sem seguir redirecionamento, sem
//   cache e com teto no corpo da resposta;
// - `Authorization: Bearer <credencial>` e `X-Pedido` em todo pedido; a credencial, a Chave de ativacao e os dados do
//   comprador nunca vao para log nem para o erro devolvido (este arquivo nao escreve log);
// - toda resposta passa pelo schema do contrato: fora do formato vira `resposta_invalida`.
//
// Modulo puro (sem "server-only"): recebe o fetch (os testes passam o deles, ou falam com o Emissor falso por HTTP).

import type { z } from "zod";
import {
  customerLicensesSchema,
  errorBodySchema,
  issuedKeySchema,
  LICENSE_ID_PATTERN,
  AREA_USER_ID_PATTERN,
  saleReceiptSchema,
  savedHolderSchema,
  type CallOptions,
  type InternalEmissorClient,
  type InternalFailure,
  type InternalResult
} from "./contract";

/** O tempo limite de cada pedido (a pagina espera isso no maximo; a tarefa do tick soma o `signal` dela). */
export const INTERNAL_REQUEST_TIMEOUT_MS = 8_000;
/** Teto do corpo da resposta: a lista de Licencas de um comprador e pequena. */
export const INTERNAL_MAX_RESPONSE_BYTES = 256 * 1024;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

export type HttpInternalEmissorOptions = {
  /** O endereco ja conferido (parseInternalBaseUrl), terminado em /interno/v1. */
  baseUrl: string;
  credential: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

type Exchange = { status: number; body: unknown; retryAfter: number | null } | { failure: InternalFailure };

function fail(error: string, status: number | null = null, message: string | null = null, retryAfterSeconds?: number): InternalFailure {
  return retryAfterSeconds === undefined ? { error, message, ok: false, status } : { error, message, ok: false, retryAfterSeconds, status };
}

async function readCapped(response: Response): Promise<string | null> {
  if (!response.body) {
    return "";
  }

  const declared = Number(response.headers.get("content-length"));

  if (Number.isFinite(declared) && declared > INTERNAL_MAX_RESPONSE_BYTES) {
    await response.body.cancel().catch(() => undefined);
    return null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    size += value.byteLength;

    if (size > INTERNAL_MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }

    chunks.push(value);
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

function retryAfterOf(response: Response): number | null {
  const header = response.headers.get("retry-after")?.trim();
  return header && /^\d{1,5}$/.test(header) ? Math.min(Number(header), 86_400) : null;
}

/** A recusa do Emissor: o codigo do corpo `{ erro, mensagem }`; sem ele, pelo status. */
function refusalOf(status: number, body: unknown, retryAfter: number | null): InternalFailure {
  const parsed = errorBodySchema.safeParse(body);
  const wait = parsed.success ? (parsed.data.esperarSegundos ?? retryAfter ?? undefined) : (retryAfter ?? undefined);

  if (parsed.success) {
    return fail(parsed.data.erro, status, parsed.data.mensagem?.trim().slice(0, 300) || null, wait);
  }

  if (status === 401 || status === 403) {
    return fail("credencial_invalida", status);
  }

  if (status === 429) {
    return fail("limite_de_pedidos", status, null, wait);
  }

  if (status === 404) {
    return fail("nao_encontrado", status);
  }

  return fail(status >= 500 ? "indisponivel" : "recusado", status);
}

/** O cliente HTTP da API interna. Cada metodo devolve o resultado tipado e nunca lanca. */
export function createHttpInternalEmissor(options: HttpInternalEmissorOptions): InternalEmissorClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? INTERNAL_REQUEST_TIMEOUT_MS;
  const doFetch = options.fetch ?? fetch;
  const authorization = `Bearer ${options.credential}`;

  async function call(method: "GET" | "POST" | "PUT", path: string, body: unknown, call: CallOptions): Promise<Exchange> {
    if (!REQUEST_ID_PATTERN.test(call.requestId)) {
      return { failure: fail("erro_inesperado") };
    }

    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = call.signal ? AbortSignal.any([call.signal, timeout]) : timeout;
    const headers: Record<string, string> = { accept: "application/json", authorization, "x-pedido": call.requestId };

    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }

    try {
      const response = await doFetch(`${baseUrl}${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        headers,
        method,
        redirect: "error",
        signal
      });
      const text = await readCapped(response);
      const retryAfter = retryAfterOf(response);

      if (text === null) {
        return { failure: response.ok ? fail("resposta_invalida", response.status) : refusalOf(response.status, null, retryAfter) };
      }

      let parsed: unknown = undefined;

      try {
        parsed = text.length > 0 ? JSON.parse(text) : undefined;
      } catch {
        return { failure: response.ok ? fail("resposta_invalida", response.status) : refusalOf(response.status, null, retryAfter) };
      }

      return { body: parsed, retryAfter, status: response.status };
    } catch {
      // Sem rede, DNS, certificado, redirecionamento ou tempo esgotado.
      return { failure: fail("sem_resposta") };
    }
  }

  /** So 2xx conta como resposta; o corpo passa pelo schema do contrato. */
  function answered<T>(exchange: Exchange, schema: z.ZodType<T>): InternalResult<T> {
    if ("failure" in exchange) {
      return exchange.failure;
    }

    if (exchange.status < 200 || exchange.status >= 300) {
      return refusalOf(exchange.status, exchange.body, exchange.retryAfter);
    }

    const parsed = schema.safeParse(exchange.body);
    return parsed.success ? { data: parsed.data, ok: true } : fail("resposta_invalida", exchange.status);
  }

  async function guarded<T>(work: () => Promise<InternalResult<T>>): Promise<InternalResult<T>> {
    try {
      return await work();
    } catch {
      return fail("erro_inesperado");
    }
  }

  const validUser = (areaUserId: string) => AREA_USER_ID_PATTERN.test(areaUserId);
  const validLicense = (licenseId: string) => LICENSE_ID_PATTERN.test(licenseId);

  return Object.freeze({
    registerSale(body, callOptions) {
      return guarded(async () => answered(await call("POST", "/vendas", body, callOptions), saleReceiptSchema));
    },
    undoSale(body, callOptions) {
      return guarded(async () => answered(await call("POST", "/vendas/desfazer", body, callOptions), saleReceiptSchema));
    },
    listLicenses(areaUserId, callOptions) {
      return guarded(async () =>
        validUser(areaUserId)
          ? answered(await call("GET", `/clientes/${encodeURIComponent(areaUserId)}/licencas`, undefined, callOptions), customerLicensesSchema)
          : fail("pedido_invalido")
      );
    },
    saveHolder(areaUserId, body, callOptions) {
      return guarded(async () =>
        validUser(areaUserId)
          ? answered(await call("PUT", `/clientes/${encodeURIComponent(areaUserId)}/titular`, body, callOptions), savedHolderSchema)
          : fail("pedido_invalido")
      );
    },
    issueKey(licenseId, body, callOptions) {
      return guarded(async () =>
        validLicense(licenseId) && validUser(body.areaUserId)
          ? answered(await call("POST", `/licencas/${encodeURIComponent(licenseId)}/chave`, body, callOptions), issuedKeySchema)
          : fail("pedido_invalido")
      );
    },
    revokeKey(licenseId, body, callOptions) {
      return guarded(async () =>
        validLicense(licenseId) && validUser(body.areaUserId)
          ? answered(await call("POST", `/licencas/${encodeURIComponent(licenseId)}/revogar`, body, callOptions), saleReceiptSchema)
          : fail("pedido_invalido")
      );
    }
  } satisfies InternalEmissorClient);
}

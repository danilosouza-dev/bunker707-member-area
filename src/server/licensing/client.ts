import "server-only";

// O cliente do Emissor (docs/32 §2.1, §2.3, §11.2 e §11.3; o contrato de fio em docs/protocolo.md do bunker-licensing):
// a conferencia inicial (preflight), a ativacao, a conferencia diaria (check-in, tambem o Verificar agora) e o desativar.
// Duas implementacoes: a HTTP de verdade, quando o build traz o endereco do Emissor (BUNKER_LICENSING_EMISSOR_URL,
// gravado como o modo e as raizes, build-config.ts), e a "nao configurado", que responde uma falha tipada sem abrir
// conexao (a nossa escola hoje, a `dev`, a Vercel e os testes sem Emissor).
//
// Regras que toda implementacao segue:
// - nunca lanca: toda falha volta como { ok: false, error } com um dos codigos abaixo. Falha de rede nunca vira erro do
//   agendador, e a licenca guardada continua valendo (docs/32 §11.3);
// - tempo limite curto por pedido (15 s, o do protocolo), somado ao `signal` de quem chama (a tarefa do tick poe 10 s);
// - o `nonce` e sorteado por quem chama, a cada pedido, e volta DENTRO da licenca assinada da resposta. So devolve
//   `ok: true` quando a licenca devolvida confere com as raizes gravadas no produto, traz o mesmo nonce, e desta
//   Instalacao (e deste endereco, na ativacao) e nao e mais antiga que a mais nova ja aceita (`newestIssuedAt`): uma
//   resposta velha repetida, ou guardada por alguem no meio do caminho, nao volta o relogio da Instalacao (docs/32 §16);
// - o segredo da Instalacao, a sequencia, a Chave de ativacao e a licenca so vao no pedido ao Emissor: este arquivo nao
//   escreve log, e nenhum erro devolvido os carrega;
// - so https (ou http://127.0.0.1, nos testes), sem seguir redirecionamento, sem cache, corpo da resposta com teto;
// - a licenca devolvida ainda passa pelo store (store.ts) antes de ser gravada. O cliente nao grava nada.

import { z } from "zod";
import { MAX_LICENSE_TOKEN_LENGTH, verifyLicenseToken } from "./artifact";
import { emissorBaseUrl, parseEmissorBaseUrl, trustedRoots } from "./build-config";
import { normalizeHost } from "./evaluate";
import { hostSchema, type LicensePayload, type TrustedRoot } from "./model";

/** Os codigos de erro do protocolo (docs/protocolo.md, "Erros"), como o Emissor os devolve. */
export const EMISSOR_PROTOCOL_ERROR_CODES = [
  "pedido_invalido",
  "tipo_de_conteudo",
  "pedido_grande_demais",
  "nao_encontrado",
  "metodo_nao_permitido",
  "chave_invalida",
  "chave_vencida",
  "chave_usada",
  "chave_de_outro_endereco",
  "licenca_indisponivel",
  "vaga_em_uso",
  "endereco_em_uso",
  "endereco_ja_largado",
  "limite_de_mudancas",
  "credencial_invalida",
  "limite_de_pedidos",
  "indisponivel",
  "erro_interno"
] as const;

/**
 * Os codigos do proprio cliente:
 * - nao_configurado: este build nao fala com o Emissor;
 * - sem_endereco: a Instalacao nao tem um endereco configurado valido para mandar (NEXT_PUBLIC_SITE_URL);
 * - sem_resposta: sem rede, DNS, certificado ou tempo esgotado (o servidor do comprador sem saida);
 * - recusado: o Emissor recusou com um codigo que esta versao nao conhece;
 * - resposta_invalida: respondeu fora do formato;
 * - licenca_invalida: a licenca devolvida nao confere com as raizes, ou e de outra Instalacao ou de outro endereco;
 * - nonce_diferente: a licenca devolvida nao traz o numero deste pedido (a resposta velha repetida);
 * - licenca_antiga: a licenca devolvida e mais antiga que a mais nova ja aceita;
 * - erro_inesperado: defeito deste lado.
 */
export const EMISSOR_CLIENT_ERROR_CODES = [
  "nao_configurado",
  "sem_endereco",
  "sem_resposta",
  "recusado",
  "resposta_invalida",
  "licenca_invalida",
  "nonce_diferente",
  "licenca_antiga",
  "erro_inesperado"
] as const;

export type EmissorProtocolErrorCode = (typeof EMISSOR_PROTOCOL_ERROR_CODES)[number];
export type EmissorClientErrorCode = (typeof EMISSOR_CLIENT_ERROR_CODES)[number];
export type EmissorErrorCode = EmissorProtocolErrorCode | EmissorClientErrorCode;

/** Todos os codigos de falha. Todos cabem na coluna check_in_result (^[a-z_]{1,40}$). */
export const EMISSOR_ERROR_CODES: readonly EmissorErrorCode[] = Object.freeze([...EMISSOR_PROTOCOL_ERROR_CODES, ...EMISSOR_CLIENT_ERROR_CODES]);

const PROTOCOL_ERRORS = new Set<string>(EMISSOR_PROTOCOL_ERROR_CODES);

export type EmissorFailure = {
  ok: false;
  error: EmissorErrorCode;
  /** vaga_em_uso: o endereco em que a vaga da Licenca esta em uso. */
  host?: string;
  /** limite_de_pedidos: quanto esperar. */
  retryAfterSeconds?: number;
  /** limite_de_mudancas: quantas mudancas a Licenca ja teve em 12 meses. */
  changes?: number;
};

/** As versoes do produto e do pacote; o que nao segue o formato do protocolo nao vai. */
export type EmissorVersions = { product?: string | null; bundle?: string | null };

type Signal = { signal?: AbortSignal };

export type EmissorPreflightRequest = Signal & {
  /** A Chave de ativacao, de uso unico (docs/32 §11.4). */
  activationKey: string;
  /** O endereco da Instalacao (o nome do host, como a licenca o guarda). */
  host: string;
  /** Sorteado no comeco da ativacao (o mesmo do activate). */
  instanceId?: string;
};

export type PortState = "aberta" | "fechada";

export type EmissorPreflightResult =
  | {
      ok: true;
      /** Tudo passou: IPv4 publico e as portas 80 e 443 abertas. So entao a Chave fica reservada ao endereco por 7 dias. */
      passed: boolean;
      /** livre: a Licenca nao tem Instalacao; mesmo_endereco: ja ha Instalacao ativa neste endereco (ativar nao gasta vaga). */
      slot: "livre" | "mesmo_endereco";
      ip: string | null;
      ipPublic: boolean;
      ports: { "80": PortState; "443": PortState } | null;
      reservedUntil: string | null;
    }
  | EmissorFailure;

export type EmissorActivateRequest = Signal & {
  activationKey: string;
  host: string;
  /** O identificador sorteado na hora (§2.1): o Painel ve quando outro servidor ativou no mesmo endereco. */
  instanceId: string;
  /** Sorteado na hora; volta dentro da licenca assinada. */
  nonce: string;
  versions?: EmissorVersions;
  /** A data da licenca mais nova ja aceita (anti-volta). */
  newestIssuedAt?: Date | null;
};

export type EmissorActivateResult =
  | {
      ok: true;
      /** A licenca assinada (texto BKL1), com o nonce do pedido dentro. */
      token: string;
      license: LicensePayload;
      installationId: string;
      /** O segredo desta Instalacao: sai so nesta resposta; o Emissor guarda so o resumo (docs/32 §11.4). */
      installationSecret: string;
      /** O numero que a Instalacao apresenta na primeira conferencia (docs/32 §11.2, A sequencia). */
      sequence: string;
    }
  | EmissorFailure;

export type EmissorCheckInRequest = Signal & {
  installationId: string;
  installationSecret: string;
  /** O numero devolvido pela conferencia anterior (ou pela ativacao); null se nunca houve. */
  sequence: string | null;
  /** Sorteado a cada conferencia; volta dentro da licenca assinada. */
  nonce: string;
  /** O endereco configurado da Instalacao (o nome do host); null sem endereco valido (vira sem_endereco, sem pedido). */
  host: string | null;
  /** A licenca guardada: vai sempre, para a readocao depois de uma restauracao do banco do Emissor. */
  storedLicense?: string | null;
  /** O numero da Licenca da licenca guardada; se vier, o Emissor confere que e o desta Instalacao. */
  licenseId?: string | null;
  versions?: EmissorVersions;
  newestIssuedAt?: Date | null;
};

export type EmissorCheckInResult =
  | {
      ok: true;
      /** A licenca assinada nova (texto BKL1), com o nonce do pedido dentro. */
      token: string;
      license: LicensePayload;
      /** O numero para apresentar na proxima conferencia. */
      sequence: string;
    }
  | EmissorFailure;

export type EmissorDeactivateRequest = Signal & {
  installationId: string;
  installationSecret: string;
  nonce: string;
  newestIssuedAt?: Date | null;
};

/** A ordem assinada (Escola congelada, motivo desativada), gravada como qualquer licenca nova. */
export type EmissorDeactivateResult = { ok: true; token: string; license: LicensePayload } | EmissorFailure;

/** O que a Instalacao pede ao Emissor. Baixar versoes entra com a peca dos pacotes (fase 2). */
export type EmissorClient = {
  preflight(request: EmissorPreflightRequest): Promise<EmissorPreflightResult>;
  activate(request: EmissorActivateRequest): Promise<EmissorActivateResult>;
  checkIn(request: EmissorCheckInRequest): Promise<EmissorCheckInResult>;
  deactivate(request: EmissorDeactivateRequest): Promise<EmissorDeactivateResult>;
};

const NOT_CONFIGURED: EmissorFailure = Object.freeze({ ok: false, error: "nao_configurado" });

/** O cliente sem Emissor: nenhum pedido sai, toda chamada responde "nao_configurado". */
export const notConfiguredEmissorClient: EmissorClient = Object.freeze({
  async preflight(): Promise<EmissorPreflightResult> {
    return NOT_CONFIGURED;
  },
  async activate(): Promise<EmissorActivateResult> {
    return NOT_CONFIGURED;
  },
  async checkIn(): Promise<EmissorCheckInResult> {
    return NOT_CONFIGURED;
  },
  async deactivate(): Promise<EmissorDeactivateResult> {
    return NOT_CONFIGURED;
  }
});

// ---- O cliente HTTP --------------------------------------------------------------------------------------

/** O tempo limite de cada pedido, do lado da Instalacao (docs/protocolo.md: 15 s; a conferencia inicial bate nas portas). */
export const EMISSOR_REQUEST_TIMEOUT_MS = 15_000;
/** Teto do corpo da resposta: a maior e a da ativacao, com a licenca (ate 16 KB). */
export const EMISSOR_MAX_RESPONSE_BYTES = 64 * 1024;

const NONCE_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const SEQUENCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const LICENSE_ID_PATTERN = /^lic_[0-9a-z]{8,40}$/;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;

const isoOrNull = z.union([z.iso.datetime({ offset: true }), z.null()]);
const portState = z.enum(["aberta", "fechada"]);
const tokenText = z.string().min(1).max(MAX_LICENSE_TOKEN_LENGTH);

const preflightResponse = z.object({
  ok: z.boolean(),
  slot: z.enum(["livre", "mesmo_endereco"]),
  ip: z.string().max(64).nullable(),
  ipPublic: z.boolean(),
  ports: z.object({ "80": portState, "443": portState }).nullable(),
  reservedUntil: isoOrNull
});

const activateResponse = z.object({
  installationId: z.string().regex(/^inst_[0-9a-z]{8,40}$/),
  secret: z.string().regex(/^bks_[A-Za-z0-9_-]{43}$/),
  sequence: z.string().regex(SEQUENCE_PATTERN),
  license: tokenText
});

const checkInResponse = z.object({ license: tokenText, sequence: z.string().regex(SEQUENCE_PATTERN) });
const deactivateResponse = z.object({ license: tokenText });

const errorResponse = z.object({
  error: z.string().regex(/^[a-z_]{1,40}$/),
  host: z.string().max(253).optional(),
  retryAfterSeconds: z.number().int().min(0).max(86_400).optional(),
  changes: z.number().int().min(0).max(1_000).optional()
});

export type HttpEmissorClientOptions = {
  /** O endereco da API publica (parseEmissorBaseUrl: https, ou http://127.0.0.1 nos testes). */
  baseUrl: string;
  /** As raizes gravadas no produto: a licenca devolvida so vale se confere com uma delas. */
  roots: readonly TrustedRoot[];
  /** Tempo limite de cada pedido (padrao: EMISSOR_REQUEST_TIMEOUT_MS). */
  timeoutMs?: number;
  /** O fetch (os testes passam o deles; padrao: o global). */
  fetch?: typeof fetch;
};

type Exchange = { status: number; body: unknown; retryAfter: number | null } | { failure: EmissorFailure };

function fail(error: EmissorErrorCode, extra: Omit<EmissorFailure, "ok" | "error"> = {}): EmissorFailure {
  return { ok: false, error, ...extra };
}

/** Le o corpo com teto; acima dele, ou sem corpo legivel, devolve null. */
async function readCapped(response: Response): Promise<string | null> {
  if (!response.body) {
    return "";
  }

  const declared = Number(response.headers.get("content-length"));

  if (Number.isFinite(declared) && declared > EMISSOR_MAX_RESPONSE_BYTES) {
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

    if (size > EMISSOR_MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function retryAfterOf(response: Response): number | null {
  const header = response.headers.get("retry-after");
  const seconds = header && /^\d{1,6}$/.test(header.trim()) ? Number(header.trim()) : null;
  return seconds !== null && seconds <= 86_400 ? seconds : null;
}

/** A recusa do Emissor: o codigo do protocolo, com os detalhes que a tela mostra; codigo desconhecido pelo status. */
function refusalOf(status: number, body: unknown, retryAfter: number | null): EmissorFailure {
  const parsed = errorResponse.safeParse(body);

  if (parsed.success && PROTOCOL_ERRORS.has(parsed.data.error)) {
    const code = parsed.data.error as EmissorProtocolErrorCode;
    const extra: Omit<EmissorFailure, "ok" | "error"> = {};
    const host = parsed.data.host ? hostSchema.safeParse(parsed.data.host) : null;

    if (code === "vaga_em_uso" && host?.success) {
      extra.host = host.data;
    }

    if (code === "limite_de_pedidos") {
      const wait = parsed.data.retryAfterSeconds ?? retryAfter;

      if (wait !== null && wait !== undefined) {
        extra.retryAfterSeconds = wait;
      }
    }

    if (code === "limite_de_mudancas" && parsed.data.changes !== undefined) {
      extra.changes = parsed.data.changes;
    }

    return fail(code, extra);
  }

  if (status === 429) {
    return fail("limite_de_pedidos", retryAfter === null ? {} : { retryAfterSeconds: retryAfter });
  }

  return fail(status >= 500 ? "indisponivel" : "recusado");
}

type LicenseExpectation = {
  roots: readonly TrustedRoot[];
  nonce: string;
  newestIssuedAt?: Date | null;
  installationId?: string;
  host?: string;
};

/**
 * A licenca devolvida so vale como resposta a ESTE pedido: confere com as raizes, traz o nonce do pedido, e da
 * Instalacao (e do endereco) esperados e nao e mais antiga que a mais nova ja aceita. Data invalida guardada como a mais
 * nova nunca libera (como em state.ts).
 */
function expectedLicense(token: string, expected: LicenseExpectation): { ok: true; license: LicensePayload } | EmissorFailure {
  const verification = verifyLicenseToken(token, expected.roots);

  if (!verification.ok) {
    return fail("licenca_invalida");
  }

  const license = verification.license;

  if (license.nonce !== expected.nonce) {
    return fail("nonce_diferente");
  }

  if (expected.newestIssuedAt instanceof Date) {
    const newestMs = expected.newestIssuedAt.getTime();

    if (!Number.isFinite(newestMs) || Date.parse(license.issuedAt) < newestMs) {
      return fail("licenca_antiga");
    }
  }

  if (expected.installationId !== undefined && license.installation.id !== expected.installationId) {
    return fail("licenca_invalida");
  }

  if (expected.host !== undefined && license.installation.host !== expected.host) {
    return fail("licenca_invalida");
  }

  return { ok: true, license };
}

function versionsOf(versions: EmissorVersions | undefined): { product?: string; bundle?: string } | undefined {
  const product = versions?.product && VERSION_PATTERN.test(versions.product) ? versions.product : undefined;
  const bundle = versions?.bundle && VERSION_PATTERN.test(versions.bundle) ? versions.bundle : undefined;

  if (!product && !bundle) {
    return undefined;
  }

  return { ...(product ? { product } : {}), ...(bundle ? { bundle } : {}) };
}

/**
 * O host como o protocolo pede (so o nome, em minusculas, punycode, sem porta e sem ponto final), a partir do nome ou do
 * endereco configurado (https://...); null se nao da um nome de host (porta que nao e a 443, IP, texto qualquer).
 */
function protocolHost(host: string | null | undefined): string | null {
  const parsed = hostSchema.safeParse(normalizeHost(host));
  return parsed.success ? parsed.data : null;
}

/** O cliente HTTP do Emissor. Cada metodo devolve o resultado tipado e nunca lanca. */
export function createHttpEmissorClient(options: HttpEmissorClientOptions): EmissorClient {
  const baseUrl = parseEmissorBaseUrl(options.baseUrl);
  const roots = options.roots;
  const timeoutMs = options.timeoutMs ?? EMISSOR_REQUEST_TIMEOUT_MS;
  const doFetch = options.fetch ?? fetch;

  async function post(path: string, body: Record<string, unknown>, signal: AbortSignal | undefined): Promise<Exchange> {
    if (!baseUrl) {
      return { failure: NOT_CONFIGURED };
    }

    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    try {
      const response = await doFetch(`${baseUrl}${path}`, {
        body: JSON.stringify(body),
        cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json" },
        method: "POST",
        redirect: "error",
        signal: combined
      });
      const text = await readCapped(response);
      const retryAfter = retryAfterOf(response);

      if (text === null) {
        return { failure: response.ok ? fail("resposta_invalida") : refusalOf(response.status, null, retryAfter) };
      }

      let parsed: unknown = null;

      try {
        parsed = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        return { failure: response.ok ? fail("resposta_invalida") : refusalOf(response.status, null, retryAfter) };
      }

      return { status: response.status, body: parsed, retryAfter };
    } catch {
      // Sem rede, DNS, certificado, redirecionamento ou tempo esgotado (o fetch e a leitura do corpo param no `signal`).
      return { failure: fail("sem_resposta") };
    }
  }

  /** So 200 conta como resposta boa; outro 2xx esta fora do protocolo, e o resto e a recusa do Emissor. */
  function answered<T>(exchange: Exchange, schema: z.ZodType<T>): { ok: true; data: T } | EmissorFailure {
    if ("failure" in exchange) {
      return exchange.failure;
    }

    if (exchange.status !== 200) {
      return exchange.status >= 200 && exchange.status < 300 ? fail("resposta_invalida") : refusalOf(exchange.status, exchange.body, exchange.retryAfter);
    }

    const parsed = schema.safeParse(exchange.body);
    return parsed.success ? { ok: true, data: parsed.data } : fail("resposta_invalida");
  }

  async function guarded<T>(work: () => Promise<T | EmissorFailure>): Promise<T | EmissorFailure> {
    try {
      return await work();
    } catch {
      return fail("erro_inesperado");
    }
  }

  return Object.freeze({
    preflight(request: EmissorPreflightRequest): Promise<EmissorPreflightResult> {
      return guarded(async () => {
        const host = protocolHost(request.host);

        if (!host) {
          return fail("sem_endereco");
        }

        const body: Record<string, unknown> = { activationKey: request.activationKey, host };

        if (request.instanceId && INSTANCE_ID_PATTERN.test(request.instanceId)) {
          body.instanceId = request.instanceId;
        }

        const reply = answered(await post("/v1/preflight", body, request.signal), preflightResponse);

        if (!reply.ok) {
          return reply;
        }

        const { ok: passed, ...rest } = reply.data;
        return { ok: true as const, passed, ...rest };
      });
    },

    activate(request: EmissorActivateRequest): Promise<EmissorActivateResult> {
      return guarded(async () => {
        const host = protocolHost(request.host);

        if (!host) {
          return fail("sem_endereco");
        }

        if (!NONCE_PATTERN.test(request.nonce) || !INSTANCE_ID_PATTERN.test(request.instanceId)) {
          return fail("erro_inesperado");
        }

        const versions = versionsOf(request.versions);
        const body: Record<string, unknown> = {
          activationKey: request.activationKey,
          host,
          instanceId: request.instanceId,
          nonce: request.nonce,
          ...(versions ? { versions } : {})
        };
        const reply = answered(await post("/v1/activate", body, request.signal), activateResponse);

        if (!reply.ok) {
          return reply;
        }

        const checked = expectedLicense(reply.data.license, {
          roots,
          nonce: request.nonce,
          newestIssuedAt: request.newestIssuedAt,
          installationId: reply.data.installationId,
          host
        });

        if (!checked.ok) {
          return checked;
        }

        return {
          ok: true as const,
          token: reply.data.license,
          license: checked.license,
          installationId: reply.data.installationId,
          installationSecret: reply.data.secret,
          sequence: reply.data.sequence
        };
      });
    },

    checkIn(request: EmissorCheckInRequest): Promise<EmissorCheckInResult> {
      return guarded(async () => {
        const host = protocolHost(request.host);

        if (!host) {
          return fail("sem_endereco");
        }

        if (!NONCE_PATTERN.test(request.nonce)) {
          return fail("erro_inesperado");
        }

        const versions = versionsOf(request.versions);
        // Campo opcional fora do formato nao vai: o Emissor recusaria o pedido inteiro, e a conferencia nunca mais
        // passaria. Sem a sequencia, ele responde do mesmo jeito e grava um alerta (docs/protocolo.md, A sequencia).
        const body: Record<string, unknown> = {
          installationId: request.installationId,
          secret: request.installationSecret,
          host,
          nonce: request.nonce,
          ...(request.sequence && SEQUENCE_PATTERN.test(request.sequence) ? { sequence: request.sequence } : {}),
          ...(request.licenseId && LICENSE_ID_PATTERN.test(request.licenseId) ? { licenseId: request.licenseId } : {}),
          ...(versions ? { versions } : {}),
          ...(request.storedLicense && request.storedLicense.length <= MAX_LICENSE_TOKEN_LENGTH ? { license: request.storedLicense } : {})
        };
        const reply = answered(await post("/v1/check-in", body, request.signal), checkInResponse);

        if (!reply.ok) {
          return reply;
        }

        const checked = expectedLicense(reply.data.license, {
          roots,
          nonce: request.nonce,
          newestIssuedAt: request.newestIssuedAt,
          installationId: request.installationId
        });

        if (!checked.ok) {
          return checked;
        }

        return { ok: true as const, token: reply.data.license, license: checked.license, sequence: reply.data.sequence };
      });
    },

    deactivate(request: EmissorDeactivateRequest): Promise<EmissorDeactivateResult> {
      return guarded(async () => {
        if (!NONCE_PATTERN.test(request.nonce)) {
          return fail("erro_inesperado");
        }

        const body = { installationId: request.installationId, secret: request.installationSecret, nonce: request.nonce };
        const reply = answered(await post("/v1/deactivate", body, request.signal), deactivateResponse);

        if (!reply.ok) {
          return reply;
        }

        const checked = expectedLicense(reply.data.license, {
          roots,
          nonce: request.nonce,
          newestIssuedAt: request.newestIssuedAt,
          installationId: request.installationId
        });

        if (!checked.ok) {
          return checked;
        }

        return { ok: true as const, token: reply.data.license, license: checked.license };
      });
    }
  });
}

/** As versoes que a Instalacao manda ao Emissor: a do produto (APP_VERSION, lida ao rodar). O pacote entra na fase 2. */
export function installationVersions(): EmissorVersions {
  return { product: process.env.APP_VERSION?.trim() || null };
}

/**
 * O cliente que a tarefa de conferencia e a tela Licenca usam: o HTTP de verdade quando o build traz o endereco do
 * Emissor; senao, o "nao configurado".
 */
export function emissorClient(): EmissorClient {
  const baseUrl = emissorBaseUrl();
  return baseUrl ? createHttpEmissorClient({ baseUrl, roots: trustedRoots() }) : notConfiguredEmissorClient;
}

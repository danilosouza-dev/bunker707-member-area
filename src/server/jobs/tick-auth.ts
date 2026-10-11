// Validacao do token Bearer da rota POST /api/jobs/tick.
//
// Modulo puro (sem "server-only" nem aliases) para que os testes em
// tests/jobs-tick.test.mjs possam importa-lo diretamente pelo Node.
import { createHash, timingSafeEqual } from "node:crypto";

// Tokens curtos sao tratados como configuracao ausente. Gere com `openssl rand -hex 32`.
export const MIN_JOBS_TICK_TOKEN_LENGTH = 32;

export type JobsTickAuthorization =
  | { ok: true }
  | { ok: false; status: 401 | 503; message: string };

const bearerPattern = /^Bearer[ \t]+(\S+)[ \t]*$/i;

export function readBearerToken(authorizationHeader: string | null | undefined) {
  if (typeof authorizationHeader !== "string") {
    return null;
  }

  const match = bearerPattern.exec(authorizationHeader.trim());

  return match ? match[1] : null;
}

export function isJobsTickTokenConfigured(configuredToken: string | null | undefined): configuredToken is string {
  return typeof configuredToken === "string" && configuredToken.trim().length >= MIN_JOBS_TICK_TOKEN_LENGTH;
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

// Compara em tempo constante. Os dois lados viram digests SHA-256 de 32 bytes antes do
// timingSafeEqual, o que evita tanto o RangeError de tamanhos diferentes quanto o
// vazamento do tamanho do token esperado pelo tempo de resposta.
export function isValidJobsTickToken(
  providedToken: string | null | undefined,
  configuredToken: string | null | undefined
) {
  if (!isJobsTickTokenConfigured(configuredToken)) {
    return false;
  }

  const provided = typeof providedToken === "string" ? providedToken : "";
  const matches = timingSafeEqual(digest(provided), digest(configuredToken.trim()));

  return matches && provided.length > 0;
}

export function authorizeJobsTickRequest(
  authorizationHeader: string | null | undefined,
  configuredToken: string | null | undefined
): JobsTickAuthorization {
  if (!isJobsTickTokenConfigured(configuredToken)) {
    return {
      ok: false,
      status: 503,
      message: "Execução de jobs indisponível: token do servidor não configurado."
    };
  }

  if (!isValidJobsTickToken(readBearerToken(authorizationHeader), configuredToken)) {
    return { ok: false, status: 401, message: "Não autorizado." };
  }

  return { ok: true };
}

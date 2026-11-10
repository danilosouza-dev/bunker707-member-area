// A tarefa de minuto da licenca (docs/32 §11.3, `licenca-conferencia`), sem banco nem rede proprios: recebe o
// adaptador da tabela (store.ts) e o cliente do Emissor (client.ts) e decide. O job do tick
// (src/server/jobs/license-check-in-job.ts) so liga as pecas do servidor. Sem "server-only" e sem "@/": os testes
// carregam este arquivo direto pelo Node (do cliente, so os tipos).
//
// - modo "off" (a nossa escola hoje, a dev, a Vercel e os testes): nao faz nada; nem cria o banco nem o cliente;
// - modo "enforce": uma gravacao por rodada com o que o store manda (a ultima hora vista, a primeira vez da licenca
//   ilegivel ou do endereco diferente, a conferencia pedida) e, quando a conferencia vence ou foi pedida, a reserva
//   dela na mesma gravacao. Ai fala com o Emissor, com tempo limite curto, e grava o resultado. Falha do Emissor
//   nunca lanca: fica em license_state, e a licenca guardada continua valendo.

import { randomBytes } from "node:crypto";
import { MAX_LICENSE_TOKEN_LENGTH } from "./artifact";
import type { LicensingMode } from "./build-config";
import type { EmissorCheckInRequest, EmissorClient } from "./client";
import { normalizeHost } from "./evaluate";
import type { TrustedRoot } from "./model";
import {
  CHECK_IN_RESULT_PATTERN,
  mutateLicenseState,
  planCheckInFailure,
  planCheckInSuccess,
  planLicenseTick,
  type CheckInDecision,
  type LicenseStateDb
} from "./store";

/** Quanto a tarefa espera o Emissor: curto, para nunca segurar o tick (orcamento de 45 s para todos os jobs). */
export const CHECK_IN_TIMEOUT_MS = 10_000;
/** Tamanho maximo da sequencia devolvida pelo Emissor (o mesmo check da coluna check_in_sequence). */
export const MAX_CHECK_IN_SEQUENCE_LENGTH = 128;

export type LicenseTickDeps = {
  mode: LicensingMode;
  /** Criado so no modo "enforce". */
  db: () => LicenseStateDb;
  /** Criado so quando uma conferencia vai sair. */
  client: () => EmissorClient;
  roots: () => readonly TrustedRoot[];
  /** O endereco configurado da Instalacao (o mesmo que monta os links dos e-mails). */
  configuredHost: () => string | null;
  /** O relogio do servidor. */
  now: () => Date;
  /** Sorteia o nonce de cada conferencia (padrao: 18 bytes aleatorios em base64url). */
  nonce?: () => string;
  /** O prazo do tick; a tarefa soma o tempo limite curto da conferencia. */
  signal?: AbortSignal;
};

export type LicenseTickResult =
  | { mode: "off" }
  | {
      mode: "enforce";
      /** A rodada perdeu LICENSE_WRITE_ATTEMPTS vezes para outra gravacao e nao gravou (a seguinte refaz). */
      contended: boolean;
      /** Por que conferiu ou nao; null se a rodada nao chegou a decidir. */
      checkIn: CheckInDecision | null;
      /** O que a conferencia deu, quando houve: "ok" ou o codigo da falha. */
      result: string | null;
    };

type CheckInAnswer = { ok: true; token: string; sequence: string } | { ok: false; error: string };

function newNonce() {
  return randomBytes(18).toString("base64url");
}

function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }

    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/**
 * Pergunta ao Emissor sem nunca lancar: resposta fora do formato vira "resposta_invalida", tempo esgotado vira
 * "sem_resposta" e cliente que lanca vira "erro_inesperado". A licenca devolvida ainda passa pelo store.
 */
async function askEmissor(client: EmissorClient, request: Omit<EmissorCheckInRequest, "signal">, tickSignal?: AbortSignal): Promise<CheckInAnswer> {
  const timeout = AbortSignal.timeout(CHECK_IN_TIMEOUT_MS);
  const signal = tickSignal ? AbortSignal.any([tickSignal, timeout]) : timeout;
  const aborted = untilAborted(signal);
  aborted.catch(() => undefined);

  try {
    const response = await Promise.race([client.checkIn({ ...request, signal }), aborted]);

    if (response?.ok === true) {
      const wellFormed =
        typeof response.token === "string" &&
        response.token.length > 0 &&
        response.token.length <= MAX_LICENSE_TOKEN_LENGTH &&
        typeof response.sequence === "string" &&
        response.sequence.length > 0 &&
        response.sequence.length <= MAX_CHECK_IN_SEQUENCE_LENGTH;

      return wellFormed ? { ok: true, token: response.token, sequence: response.sequence } : { ok: false, error: "resposta_invalida" };
    }

    if (response?.ok === false && typeof response.error === "string" && CHECK_IN_RESULT_PATTERN.test(response.error)) {
      return { ok: false, error: response.error };
    }

    return { ok: false, error: "resposta_invalida" };
  } catch {
    return { ok: false, error: signal.aborted ? "sem_resposta" : "erro_inesperado" };
  }
}

export async function runLicenseTick(deps: LicenseTickDeps): Promise<LicenseTickResult> {
  if (deps.mode !== "enforce") {
    return { mode: "off" };
  }

  const db = deps.db();
  const roots = deps.roots();
  const configuredHost = deps.configuredHost();
  const round = await mutateLicenseState(db, (record) => {
    const plan = planLicenseTick(record, { configuredHost, roots, systemNow: deps.now() });
    return { patch: plan.patch, outcome: plan.checkIn };
  });

  if (!round) {
    return { mode: "enforce", contended: true, checkIn: null, result: null };
  }

  const record = round.record;
  const attemptStartedAt = record?.checkInAttemptedAt ?? null;

  if (!round.outcome.due || !record?.installationId || !record.installationSecret || !attemptStartedAt) {
    return { mode: "enforce", contended: false, checkIn: round.outcome, result: null };
  }

  const answer = await askEmissor(
    deps.client(),
    {
      installationId: record.installationId,
      installationSecret: record.installationSecret,
      sequence: record.checkInSequence,
      nonce: (deps.nonce ?? newNonce)(),
      host: normalizeHost(configuredHost)
    },
    deps.signal
  );
  const receivedAt = deps.now();
  const recorded = await mutateLicenseState(db, (current) =>
    answer.ok
      ? planCheckInSuccess(current, { attemptStartedAt, receivedAt, roots, sequence: answer.sequence, token: answer.token })
      : planCheckInFailure(current, { attemptStartedAt, result: answer.error })
  );

  if (!recorded) {
    // A reserva vence sozinha (CHECK_IN_LEASE_MS) e a tentativa conta como falha: nova tentativa em 1 hora.
    return { mode: "enforce", contended: true, checkIn: round.outcome, result: answer.ok ? null : answer.error };
  }

  return {
    mode: "enforce",
    contended: false,
    checkIn: round.outcome,
    result: recorded.outcome.accepted ? "ok" : recorded.outcome.result
  };
}

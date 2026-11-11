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
//
// O Verificar agora da tela Licenca (runLicenseCheckInNow) e a mesma conferencia, fora da agenda, pela mesma reserva: so
// nao anda a ultima hora vista, que so anda pela rodada do tick.

import { MAX_LICENSE_TOKEN_LENGTH, verifyLicenseToken } from "./artifact";
import type { LicensingMode } from "./build-config";
import type { EmissorCheckInRequest, EmissorClient, EmissorVersions } from "./client";
import { normalizeHost } from "./evaluate";
import type { TrustedRoot } from "./model";
import { newRequestNonce } from "./request-ids";
import {
  CHECK_IN_RESULT_PATTERN,
  mutateLicenseState,
  planCheckInFailure,
  planCheckInSuccess,
  planConversationStart,
  planLicenseTick,
  type CheckInDecision,
  type EnforcedLicenseState,
  type LicenseStateDb,
  type LicenseStateRecord
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
  /** Sorteia o nonce de cada conferencia (padrao: 32 bytes aleatorios em base64url, request-ids.ts). */
  nonce?: () => string;
  /** As versoes do produto e do pacote que vao na conferencia (o que nao segue o formato do protocolo nao vai). */
  versions?: () => EmissorVersions;
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
      /**
       * A situacao com o que estava guardado no comeco da rodada (a dos e-mails de degrau); null se a rodada nao
       * gravou. Uma conferencia que trouxe licenca nova aparece na rodada seguinte.
       */
      state: EnforcedLicenseState | null;
    };

type CheckInAnswer = { ok: true; token: string; sequence: string } | { ok: false; error: string };

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

/** O numero da Licenca da licenca guardada, quando ela confere: vai junto para o Emissor conferir (opcional no protocolo). */
function storedLicenseId(record: LicenseStateRecord, roots: readonly TrustedRoot[]): string | null {
  if (!record.token) {
    return null;
  }

  const verification = verifyLicenseToken(record.token, roots);
  return verification.ok ? verification.license.licenseId : null;
}

type CheckInConversation = {
  /** O que a conferencia deu: "ok" ou o codigo da falha (do Emissor, do cliente ou do store). */
  result: string;
  /** false: outra gravacao chegou antes LICENSE_WRITE_ATTEMPTS vezes e o resultado nao foi gravado. */
  recorded: boolean;
};

/**
 * A conferencia ja reservada (`attemptStartedAt` gravado na linha): pede ao Emissor, com o pedido inteiro do protocolo
 * (identificador, segredo, sequencia, nonce, endereco, a licenca guardada para a readocao, o numero da Licenca e as
 * versoes), e grava o resultado pelo store.
 */
async function checkInWithEmissor(
  db: LicenseStateDb,
  record: LicenseStateRecord,
  attemptStartedAt: Date,
  deps: Omit<LicenseTickDeps, "mode" | "db">
): Promise<CheckInConversation> {
  const roots = deps.roots();
  const answer = await askEmissor(
    deps.client(),
    {
      installationId: record.installationId ?? "",
      installationSecret: record.installationSecret ?? "",
      sequence: record.checkInSequence,
      nonce: (deps.nonce ?? newRequestNonce)(),
      host: normalizeHost(deps.configuredHost()),
      storedLicense: record.token,
      licenseId: storedLicenseId(record, roots),
      versions: deps.versions?.(),
      newestIssuedAt: record.newestIssuedAt
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
    return { recorded: false, result: answer.ok ? "ok" : answer.error };
  }

  return { recorded: true, result: recorded.outcome.accepted ? "ok" : recorded.outcome.result };
}

export async function runLicenseTick(deps: LicenseTickDeps): Promise<LicenseTickResult> {
  if (deps.mode !== "enforce") {
    return { mode: "off" };
  }

  const db = deps.db();
  const roots = deps.roots();
  const configuredHost = deps.configuredHost();
  let state: EnforcedLicenseState | null = null;
  const round = await mutateLicenseState(db, (record) => {
    const plan = planLicenseTick(record, { configuredHost, roots, systemNow: deps.now() });
    state = plan.state;
    return { patch: plan.patch, outcome: plan.checkIn };
  });

  if (!round) {
    return { mode: "enforce", contended: true, checkIn: null, result: null, state: null };
  }

  const record = round.record;
  const attemptStartedAt = record?.checkInAttemptedAt ?? null;

  if (!round.outcome.due || !record?.installationId || !record.installationSecret || !attemptStartedAt) {
    return { mode: "enforce", contended: false, checkIn: round.outcome, result: null, state };
  }

  const conversation = await checkInWithEmissor(db, record, attemptStartedAt, deps);

  if (!conversation.recorded) {
    return { mode: "enforce", contended: true, checkIn: round.outcome, result: conversation.result === "ok" ? null : conversation.result, state };
  }

  return { mode: "enforce", contended: false, checkIn: round.outcome, result: conversation.result, state };
}

export type LicenseCheckInNowResult =
  | { done: true; result: string }
  | { done: false; reason: "em_andamento" | "sem_instalacao" | "relogio_invalido" | "disputada" };

/**
 * O Verificar agora (docs/32 §2.1 e §2.2): a conferencia na hora, fora da agenda diaria e sem a espera de 1 hora depois
 * de uma falha, pela mesma reserva da rodada do tick (nunca duas conversas com o Emissor juntas). Vale em todo degrau,
 * inclusive sem licenca legivel; sem identificador e segredo da Instalacao (nunca ativada, ou so a licenca por
 * arquivo) nao ha com quem conferir. Nao anda a ultima hora vista. Nunca lanca por causa do Emissor.
 */
export async function runLicenseCheckInNow(deps: Omit<LicenseTickDeps, "mode">): Promise<LicenseCheckInNowResult> {
  const db = deps.db();
  const reservation = await mutateLicenseState(db, (record) => planConversationStart(record, { systemNow: deps.now(), requireInstallation: true }));

  if (!reservation) {
    return { done: false, reason: "disputada" };
  }

  const start = reservation.outcome;

  if (!start.reserved) {
    return { done: false, reason: start.reason };
  }

  if (!reservation.record) {
    return { done: false, reason: "disputada" };
  }

  const conversation = await checkInWithEmissor(db, reservation.record, start.attemptStartedAt, deps);
  return conversation.recorded ? { done: true, result: conversation.result } : { done: false, reason: "disputada" };
}

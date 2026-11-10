// A tabela license_state (docs/32 §11.3 e §16): o que a Instalacao guarda sobre a propria licenca, numa linha so,
// gravada so pelo servidor. Aqui ficam as regras de gravacao, por tras de um adaptador pequeno (LicenseStateDb): o
// do Supabase fica em store-db.ts ("server-only"); os testes usam um banco em memoria com a mesma interface.
// Sem "server-only" e sem "@/": os testes carregam este arquivo direto pelo Node.
//
// Contrato do store (docs/32 §16, revisao independente do nucleo):
// - unreadableSince e hostMismatchSince sao gravados na primeira vez que a tarefa do tick percebe a licenca ilegivel
//   ou o endereco diferente, com a hora confiavel, e apagados quando o caso se resolve. Data invalida guardada fica
//   como esta: a avaliacao a conta como ha muito tempo;
// - lastSeenAt so avanca, e so pela tarefa do tick (planLicenseTick): um minuto por rodada, a partir do maior
//   instante que a Instalacao sabe que ja passou (ela mesma, a emissao da licenca, a ultima conferencia). Nunca e
//   copiada do relogio do servidor. Uma conferencia boa a realinha com a hora assinada pelo Emissor, para a frente
//   ou para tras: rodadas repetidas no mesmo minuto a adiantam, e a hora do Emissor e a que vale;
// - newestIssuedAt so sobe;
// - uma licenca nova so e aceita se confere com as raizes, se nao e mais antiga que newestIssuedAt e se e desta
//   Instalacao;
// - quando a licenca guardada nao confere, a tarefa pede uma conferencia na hora.
// A leitura de cada pedido (loadLicenseState) nunca grava e, no modo "off", nem chega a criar o banco.
//
// Concorrencia: toda gravacao leva a versao lida (`version`) e so vale se ninguem gravou antes; quem perde le de novo
// e refaz a conta (mutateLicenseState). A conferencia com o Emissor e reservada na mesma gravacao que a decide
// (checkInResult = "em_andamento"): duas rodadas do tick nunca conferem juntas, o que daria duas sequencias ao
// Emissor e um alerta falso de copia (docs/32 §11.2, A sequencia).

import type { LicensingMode } from "./build-config";
import { sameHost } from "./evaluate";
import { DAY_MS, type LicensePayload, type TrustedRoot } from "./model";
import {
  EMPTY_LICENSE_SNAPSHOT,
  checkLicenseToken,
  computeLicenseState,
  type LicenseState,
  type LicenseStoreSnapshot
} from "./state";

export type EnforcedLicenseState = Extract<LicenseState, { mode: "enforce" }>;

/** A linha de license_state: o retrato que a avaliacao usa e o que a conversa com o Emissor precisa. */
export type LicenseStateRecord = LicenseStoreSnapshot & {
  /** O identificador da Instalacao no Emissor (chega na ativacao). */
  installationId: string | null;
  /** O segredo da Instalacao (chega na ativacao). So o servidor le: nunca vai para a situacao, log ou tela. */
  installationSecret: string | null;
  /** O numero da ultima conferencia, apresentado na seguinte (docs/32 §11.2, A sequencia). */
  checkInSequence: string | null;
  /** Hora do relogio do servidor em que a ultima tentativa de conferencia comecou. */
  checkInAttemptedAt: Date | null;
  /** Como a ultima tentativa terminou: "ok", "em_andamento" (reservada por uma rodada) ou o codigo da falha. */
  checkInResult: string | null;
  /** Conferencia pedida para ja: a licenca guardada que nao confere (e, numa peca seguinte, o Verificar agora). */
  checkInRequestedAt: Date | null;
  /** Versao da linha: toda gravacao confere a lida e soma 1. */
  version: number;
};

export type LicenseStatePatch = Partial<Omit<LicenseStateRecord, "version">>;

/** O adaptador do banco: uma linha, lida inteira e gravada so com a versao lida. */
export type LicenseStateDb = {
  /** A linha; null se ainda nao existe. */
  read(): Promise<LicenseStateRecord | null>;
  /**
   * Grava so os campos do patch, se a linha ainda esta na versao `expectedVersion` (null: cria a linha, se ela ainda
   * nao existe). Devolve a linha gravada, ou null quando outra gravacao chegou antes e nada foi gravado.
   */
  write(patch: LicenseStatePatch, expectedVersion: number | null): Promise<LicenseStateRecord | null>;
};

export const EMPTY_LICENSE_RECORD: LicenseStateRecord = Object.freeze({
  ...EMPTY_LICENSE_SNAPSHOT,
  installationId: null,
  installationSecret: null,
  checkInSequence: null,
  checkInAttemptedAt: null,
  checkInResult: null,
  checkInRequestedAt: null,
  version: 0
});

/** Quanto a ultima hora vista anda por rodada do tick. */
export const LAST_SEEN_STEP_MS = 60_000;
/** Conferencia diaria: no minuto sorteado da Instalacao, pelo menos 6 horas depois da ultima conferencia boa. */
export const CHECK_IN_MIN_GAP_MS = 6 * 60 * 60 * 1000;
/** Conferencia que falhou: nova tentativa de hora em hora (docs/32 §11.3). */
export const CHECK_IN_RETRY_MS = 60 * 60 * 1000;
/** Reserva de uma rodada: passado isso sem resultado, a rodada caiu e a tentativa conta como falha. */
export const CHECK_IN_LEASE_MS = 5 * 60 * 1000;
export const CHECK_IN_OK = "ok";
export const CHECK_IN_RUNNING = "em_andamento";
/** O formato de todo resultado gravado (o mesmo check da coluna check_in_result). */
export const CHECK_IN_RESULT_PATTERN = /^[a-z_]{1,40}$/;
/** Quantas vezes uma gravacao tenta de novo quando outra chegou antes. */
export const LICENSE_WRITE_ATTEMPTS = 3;

/** O maior instante que uma Date aceita. */
const LATEST_DATE_MS = 8.64e15;
const MINUTE_MS = 60_000;

function validMs(value: Date | null | undefined): number | null {
  if (!(value instanceof Date)) {
    return null;
  }

  const ms = value.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function latestValidMs(values: Array<Date | null | undefined>): number | null {
  return values.reduce<number | null>((latest, value) => {
    const ms = validMs(value);
    return ms !== null && (latest === null || ms > latest) ? ms : latest;
  }, null);
}

/** So o retrato que a avaliacao usa (state.ts): sem o segredo, a sequencia e a conferencia em andamento. */
export function snapshotOf(record: LicenseStateRecord | null): LicenseStoreSnapshot {
  if (!record) {
    return EMPTY_LICENSE_SNAPSHOT;
  }

  return {
    token: record.token,
    everActivated: record.everActivated,
    unreadableSince: record.unreadableSince,
    lastSeenAt: record.lastSeenAt,
    lastCheckIn: record.lastCheckIn,
    hostMismatchSince: record.hostMismatchSince,
    newestIssuedAt: record.newestIssuedAt
  };
}

// ---- Leitura de cada pedido ---------------------------------------------------------------------------

export type LoadLicenseStateInput = {
  mode: LicensingMode;
  /** O banco so e criado no modo "enforce": no "off", nada aqui toca nele. */
  db: () => LicenseStateDb;
  roots: () => readonly TrustedRoot[];
  /** O endereco configurado da Instalacao (o mesmo que monta os links dos e-mails). */
  configuredHost: () => string | null;
  systemNow: () => Date;
};

/** A situacao da licenca agora. Le a linha e avalia; nunca grava (quem grava e a tarefa do tick). */
export async function loadLicenseState(input: LoadLicenseStateInput): Promise<LicenseState> {
  if (input.mode !== "enforce") {
    return { mode: "off" };
  }

  const record = await input.db().read();

  return computeLicenseState({
    mode: "enforce",
    roots: input.roots(),
    snapshot: snapshotOf(record),
    systemNow: input.systemNow(),
    configuredHost: input.configuredHost()
  });
}

// ---- Gravacao com a versao lida -----------------------------------------------------------------------

export type LicensePlan<T> = { patch: LicenseStatePatch; outcome: T };
export type LicenseMutation<T> = { record: LicenseStateRecord | null; outcome: T; wrote: boolean };

/**
 * Le a linha, calcula o patch e grava com a versao lida. Se outra gravacao chegou antes, le de novo e refaz a conta,
 * ate LICENSE_WRITE_ATTEMPTS vezes; devolve null se perdeu todas (nada foi gravado por esta chamada). Patch vazio
 * nao grava.
 */
export async function mutateLicenseState<T>(
  db: LicenseStateDb,
  plan: (record: LicenseStateRecord | null) => LicensePlan<T>
): Promise<LicenseMutation<T> | null> {
  for (let attempt = 0; attempt < LICENSE_WRITE_ATTEMPTS; attempt += 1) {
    const current = await db.read();
    const planned = plan(current);

    if (Object.keys(planned.patch).length === 0) {
      return { record: current, outcome: planned.outcome, wrote: false };
    }

    const written = await db.write(planned.patch, current ? current.version : null);

    if (written) {
      return { record: written, outcome: planned.outcome, wrote: true };
    }
  }

  return null;
}

// ---- Quando conferir ----------------------------------------------------------------------------------

export type CheckInDecision =
  | { due: true; reason: "pedida" | "diaria" | "nova_tentativa" }
  | { due: false; reason: "sem_instalacao" | "em_andamento" | "em_dia" | "aguardando_nova_tentativa" };

/** O minuto do dia (UTC) sorteado para a conferencia diaria desta Instalacao: fixo, tirado do identificador. */
export function checkInMinuteOfDay(installationId: string): number {
  // FNV-1a de 32 bits: espalha as Instalacoes pelo dia sem guardar nada a mais.
  let hash = 0x811c9dc5;

  for (let index = 0; index < installationId.length; index += 1) {
    hash ^= installationId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash % 1440;
}

/** A proxima conferencia diaria: o primeiro minuto sorteado pelo menos 6 horas depois da ultima conferencia boa. */
export function nextDailyCheckInMs(lastOkMs: number, installationId: string): number {
  const offsetMs = checkInMinuteOfDay(installationId) * MINUTE_MS;
  return Math.ceil((lastOkMs + CHECK_IN_MIN_GAP_MS - offsetMs) / DAY_MS) * DAY_MS + offsetMs;
}

/**
 * A conferencia vence agora? Pela ordem: sem identificador e segredo nao ha com quem conferir; uma rodada com a
 * reserva viva esta conferindo; pedida vai na hora; a que falhou tenta de novo de hora em hora; a boa volta uma vez
 * por dia, no minuto sorteado da Instalacao. Tudo pelo relogio do servidor, que aqui so marca a agenda: relogio
 * voltado para antes da ultima tentativa ou conferencia nao segura a conferencia.
 */
export function checkInDecision(record: LicenseStateRecord, systemNow: Date): CheckInDecision {
  if (!record.installationId || !record.installationSecret) {
    return { due: false, reason: "sem_instalacao" };
  }

  const nowMs = validMs(systemNow);

  if (nowMs === null) {
    return { due: false, reason: "em_dia" };
  }

  const attemptedMs = validMs(record.checkInAttemptedAt);
  // Negativo quando o relogio voltou para antes da tentativa: ai a espera nao vale.
  const sinceAttemptMs = attemptedMs === null ? Number.POSITIVE_INFINITY : nowMs - attemptedMs;

  if (record.checkInResult === CHECK_IN_RUNNING && sinceAttemptMs >= 0 && sinceAttemptMs < CHECK_IN_LEASE_MS) {
    return { due: false, reason: "em_andamento" };
  }

  if (record.checkInRequestedAt !== null) {
    return { due: true, reason: "pedida" };
  }

  if (record.checkInResult !== null && record.checkInResult !== CHECK_IN_OK) {
    return sinceAttemptMs < 0 || sinceAttemptMs >= CHECK_IN_RETRY_MS
      ? { due: true, reason: "nova_tentativa" }
      : { due: false, reason: "aguardando_nova_tentativa" };
  }

  const lastOkMs = validMs(record.lastCheckIn?.localTime);

  if (lastOkMs === null || nowMs < lastOkMs || nowMs >= nextDailyCheckInMs(lastOkMs, record.installationId)) {
    return { due: true, reason: "diaria" };
  }

  return { due: false, reason: "em_dia" };
}

// ---- A rodada do tick ---------------------------------------------------------------------------------

export type LicenseTickInput = {
  roots: readonly TrustedRoot[];
  configuredHost: string | null;
  systemNow: Date;
};

export type LicenseTickPlan = {
  patch: LicenseStatePatch;
  /** A situacao com o que estava guardado antes desta rodada. */
  state: EnforcedLicenseState;
  checkIn: CheckInDecision;
};

/**
 * O que uma rodada do tick grava (modo "enforce"). E o unico lugar que avanca a ultima hora vista e o unico que
 * grava a primeira vez da licenca ilegivel e do endereco diferente. Se a conferencia vence, reserva na mesma
 * gravacao.
 */
export function planLicenseTick(record: LicenseStateRecord | null, input: LicenseTickInput): LicenseTickPlan {
  const current = record ?? EMPTY_LICENSE_RECORD;
  const snapshot = snapshotOf(current);
  const state = computeLicenseState({
    mode: "enforce",
    roots: input.roots,
    snapshot,
    systemNow: input.systemNow,
    configuredHost: input.configuredHost
  });

  if (state.mode !== "enforce") {
    throw new Error("A situacao da licenca saiu sem o modo enforce.");
  }

  const license = state.license;
  const patch: LicenseStatePatch = {};
  const systemMs = validMs(input.systemNow);
  // A marca de "desde quando" leva a hora confiavel (nunca menos que a ultima hora vista), como a avaliacao.
  const stampMs = validMs(state.clock.now) ?? systemMs;

  // 1. A ultima hora vista: um minuto por rodada, a partir do maior instante conhecido. Nunca do relogio do servidor.
  const baseMs = latestValidMs([
    snapshot.lastSeenAt,
    license ? new Date(license.issuedAt) : null,
    snapshot.lastCheckIn?.emissorTime,
    snapshot.newestIssuedAt
  ]);

  if (baseMs !== null) {
    const nextMs = Math.min(baseMs + LAST_SEEN_STEP_MS, LATEST_DATE_MS);

    if (nextMs !== validMs(snapshot.lastSeenAt)) {
      patch.lastSeenAt = new Date(nextMs);
    }
  }

  // 2. A licenca que confere marca a Instalacao como ativada; a data da mais nova aceita so sobe.
  if (license) {
    const issuedMs = Date.parse(license.issuedAt);
    const newestMs = validMs(snapshot.newestIssuedAt);

    if (!snapshot.everActivated) {
      patch.everActivated = true;
    }

    if (newestMs === null || issuedMs > newestMs) {
      patch.newestIssuedAt = new Date(issuedMs);
    }
  }

  // 3. Licenca ilegivel (a guardada nao confere, ou a linha perdeu a licenca de uma Instalacao ja ativada): grava a
  // primeira vez que percebe e pede a conferencia na hora; apaga quando a licenca guardada volta a conferir.
  const unreadable = license === null && (snapshot.token !== null || snapshot.everActivated);

  if (unreadable) {
    if (snapshot.unreadableSince === null && stampMs !== null) {
      patch.unreadableSince = new Date(stampMs);

      if (current.checkInRequestedAt === null && systemMs !== null) {
        patch.checkInRequestedAt = new Date(systemMs);
      }
    }
  } else if (license && snapshot.unreadableSince !== null) {
    patch.unreadableSince = null;
  }

  // 4. Endereco: o configurado tem de ser o da licenca. Grava a primeira vez que diverge; apaga quando volta a bater.
  // (Os pedidos do admin chegando por outro endereco entram numa peca seguinte, somados aqui.)
  if (license) {
    const mismatch = !sameHost(license.installation.host, input.configuredHost);

    if (mismatch) {
      if (snapshot.hostMismatchSince === null && stampMs !== null) {
        patch.hostMismatchSince = new Date(stampMs);
      }
    } else if (snapshot.hostMismatchSince !== null) {
      patch.hostMismatchSince = null;
    }
  }

  // 5. A conferencia, decidida sobre a linha como ela fica, e reservada na mesma gravacao.
  const checkIn = checkInDecision({ ...current, ...patch }, input.systemNow);

  if (checkIn.due && systemMs !== null) {
    patch.checkInAttemptedAt = new Date(systemMs);
    patch.checkInResult = CHECK_IN_RUNNING;
  }

  return { patch, state, checkIn };
}

// ---- O resultado da conferencia -----------------------------------------------------------------------

/** Por que o store recusou a licenca que o Emissor devolveu. */
export type LicenseRefusal = "licenca_invalida" | "licenca_antiga" | "outra_instalacao";

export type CheckInOutcome = { accepted: true; license: LicensePayload } | { accepted: false; result: string };

/** A tentativa atendeu o pedido de conferencia (o pedido feito durante a tentativa fica para a seguinte). */
function requestServed(requestedAt: Date | null, attemptStartedAt: Date): boolean {
  if (requestedAt === null) {
    return false;
  }

  const requestedMs = validMs(requestedAt);
  const startedMs = validMs(attemptStartedAt);
  return requestedMs === null || startedMs === null || requestedMs <= startedMs;
}

export type CheckInFailureInput = {
  /** O codigo da falha (do cliente do Emissor ou do store). */
  result: string;
  /** Quando a tentativa comecou (checkInAttemptedAt gravado na reserva). */
  attemptStartedAt: Date;
};

/** A conferencia nao trouxe licenca: grava o motivo; a licenca guardada continua valendo, e o resto nao muda. */
export function planCheckInFailure(record: LicenseStateRecord | null, input: CheckInFailureInput): LicensePlan<CheckInOutcome> {
  const result = CHECK_IN_RESULT_PATTERN.test(input.result) ? input.result : "erro_inesperado";

  if (!record) {
    return { patch: {}, outcome: { accepted: false, result } };
  }

  const patch: LicenseStatePatch = { checkInResult: result };

  if (requestServed(record.checkInRequestedAt, input.attemptStartedAt)) {
    patch.checkInRequestedAt = null;
  }

  return { patch, outcome: { accepted: false, result } };
}

export type CheckInSuccessInput = {
  token: string;
  sequence: string;
  roots: readonly TrustedRoot[];
  /** O relogio do servidor quando a resposta chegou: vira a hora local da ultima conferencia. */
  receivedAt: Date;
  attemptStartedAt: Date;
};

/**
 * O Emissor devolveu uma licenca nova. So vale se confere com as raizes, se nao e mais antiga que a mais nova ja
 * aceita e se e desta Instalacao; recusada, grava o motivo como uma falha e nada mais muda. Aceita, troca a licenca e
 * a sequencia, guarda a hora assinada (a emissao da licenca nova) como a ultima conferencia, realinha a ultima hora
 * vista com ela e apaga a marca de licenca ilegivel.
 */
export function planCheckInSuccess(record: LicenseStateRecord | null, input: CheckInSuccessInput): LicensePlan<CheckInOutcome> {
  const refuse = (result: LicenseRefusal) => planCheckInFailure(record, { result, attemptStartedAt: input.attemptStartedAt });

  if (!record) {
    return refuse("outra_instalacao");
  }

  const checked = checkLicenseToken(input.token, input.roots, record.newestIssuedAt);

  if (!checked.ok) {
    return refuse(checked.error === "licenca_antiga" ? "licenca_antiga" : "licenca_invalida");
  }

  const license = checked.license;

  if (record.installationId === null || license.installation.id !== record.installationId) {
    return refuse("outra_instalacao");
  }

  const issuedMs = Date.parse(license.issuedAt);
  const newestMs = validMs(record.newestIssuedAt);
  const patch: LicenseStatePatch = {
    token: input.token,
    everActivated: true,
    newestIssuedAt: new Date(newestMs === null ? issuedMs : Math.max(newestMs, issuedMs)),
    lastCheckIn: { emissorTime: new Date(issuedMs), localTime: new Date(validMs(input.receivedAt) ?? issuedMs) },
    lastSeenAt: new Date(issuedMs),
    unreadableSince: null,
    checkInSequence: input.sequence,
    checkInResult: CHECK_IN_OK
  };

  if (requestServed(record.checkInRequestedAt, input.attemptStartedAt)) {
    patch.checkInRequestedAt = null;
  }

  return { patch, outcome: { accepted: true, license } };
}

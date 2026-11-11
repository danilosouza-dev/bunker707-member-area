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
// - newestIssuedAt so sobe, com uma excecao: a resposta fresca do Emissor (a que traz o nonce deste pedido) a leva
//   junto, para tras tambem. Sem isso, um salto do relogio do nosso Emissor para a frente prendia a escola: toda
//   conferencia certa depois dele era recusada como mais antiga (revisao de 11/11/2026);
// - a licenca da conversa com o Emissor so e aceita se confere com as raizes, traz o nonce deste pedido e e desta
//   Instalacao. A licenca guardada e a licenca por arquivo, que nao tem nonce, seguem a anti-volta: nao valem se forem
//   mais antigas que newestIssuedAt;
// - quando a licenca guardada nao confere, a tarefa pede uma conferencia na hora.
// A leitura de cada pedido (loadLicenseState) nunca grava e, no modo "off", nem chega a criar o banco.
//
// Concorrencia: toda gravacao leva a versao lida (`version`) e so vale se ninguem gravou antes; quem perde le de novo
// e refaz a conta (mutateLicenseState). A conferencia com o Emissor e reservada na mesma gravacao que a decide
// (checkInResult = "em_andamento"): duas rodadas do tick nunca conferem juntas, o que daria duas sequencias ao
// Emissor e um alerta falso de copia (docs/32 §11.2, A sequencia). A tela Licenca (ativar, Verificar agora e
// desativar) usa a mesma reserva (planConversationStart): nenhuma conversa com o Emissor corre junto com outra, e o
// resultado de uma tentativa que outra substituiu (a reserva venceu e outra comecou) nao grava nada.

import { verifyLicenseToken } from "./artifact";
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

/** A Instalacao tem identificador e segredo, para conferir e desativar? So o fato; o segredo nao sai daqui. */
export function hasInstallationCredentials(record: LicenseStateRecord | null): boolean {
  return Boolean(record?.installationId && record.installationSecret);
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

/**
 * Por que o store recusou a licenca que chegou:
 * - licenca_invalida, licenca_antiga, outra_instalacao: as regras do contrato do store;
 * - nonce_diferente: a licenca da conversa com o Emissor nao traz o nonce deste pedido (a resposta de outro pedido);
 * - tentativa_substituida: outra conversa com o Emissor comecou depois desta (a reserva venceu e outra rodada, a
 *   ativacao ou o Verificar agora reservou de novo): o resultado velho nao passa por cima do novo;
 * - nao_e_arquivo, endereco_diferente: a licenca por arquivo enviada pela tela Licenca (planLicenseFile).
 */
export type LicenseRefusal =
  | "licenca_invalida"
  | "licenca_antiga"
  | "nonce_diferente"
  | "outra_instalacao"
  | "tentativa_substituida"
  | "nao_e_arquivo"
  | "endereco_diferente";

export type CheckInOutcome = { accepted: true; license: LicensePayload } | { accepted: false; result: string };

/**
 * A tentativa ainda e a da linha? Outra reserva gravou outra hora de inicio depois desta: o resultado desta nao grava
 * nada. Hora guardada invalida ou ausente nao prende ninguem (o caso do banco mexido).
 */
function attemptSuperseded(record: LicenseStateRecord, attemptStartedAt: Date): boolean {
  const storedMs = validMs(record.checkInAttemptedAt);
  const startedMs = validMs(attemptStartedAt);
  return storedMs !== null && startedMs !== null && storedMs !== startedMs;
}

const SUPERSEDED: LicensePlan<CheckInOutcome> = Object.freeze({ patch: {}, outcome: { accepted: false, result: "tentativa_substituida" } });

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

/**
 * A conferencia nao trouxe licenca: grava o motivo; a licenca guardada continua valendo, e o resto nao muda. A tentativa
 * que ja foi substituida por outra nao grava nada.
 */
export function planCheckInFailure(record: LicenseStateRecord | null, input: CheckInFailureInput): LicensePlan<CheckInOutcome> {
  const result = CHECK_IN_RESULT_PATTERN.test(input.result) ? input.result : "erro_inesperado";

  if (!record) {
    return { patch: {}, outcome: { accepted: false, result } };
  }

  if (attemptSuperseded(record, input.attemptStartedAt)) {
    return SUPERSEDED;
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
  /** O nonce que esta Instalacao sorteou para o pedido: a licenca devolvida tem de traze-lo (resposta fresca). */
  nonce: string;
  roots: readonly TrustedRoot[];
  /** O relogio do servidor quando a resposta chegou: vira a hora local da ultima conferencia. */
  receivedAt: Date;
  attemptStartedAt: Date;
};

type FreshLicense = { ok: true; license: LicensePayload } | { ok: false; error: "licenca_invalida" | "nonce_diferente" };

/**
 * A licenca de uma conversa com o Emissor (conferencia, ativacao, desativacao): confere com as raizes e traz o nonce que
 * esta Instalacao sorteou para este pedido. Com o nonce, a resposta e fresca, assinada agora para esta conversa: vale
 * mesmo que a emissao seja mais antiga que a mais nova ja aceita. O caso e o relogio do nosso Emissor que pulou para a
 * frente e voltou: sem isso, toda conferencia certa depois do salto era recusada, e a escola ficava presa sem volta pela
 * internet (revisao de 11/11/2026). A resposta repetida de outro pedido nao traz este nonce e continua recusada; a
 * anti-volta segue valendo para a licenca guardada e para a licenca por arquivo (checkLicenseToken, state.ts).
 */
function freshConversationLicense(token: string, roots: readonly TrustedRoot[], nonce: string): FreshLicense {
  const verification = verifyLicenseToken(token, roots);

  if (!verification.ok) {
    return { ok: false, error: "licenca_invalida" };
  }

  if (typeof nonce !== "string" || nonce.length === 0 || verification.license.nonce !== nonce) {
    return { ok: false, error: "nonce_diferente" };
  }

  return { ok: true, license: verification.license };
}

/**
 * O patch de uma conversa boa com o Emissor (conferencia, ativacao, desativacao): troca a licenca, guarda a hora
 * assinada (a emissao da licenca nova) como a ultima conferencia, realinha com ela a ultima hora vista e a data da mais
 * nova aceita (as duas, para a frente ou para tras: a resposta e fresca), apaga a marca de licenca ilegivel, devolve a
 * reserva ("ok") e atende o pedido de conferencia feito antes da tentativa.
 */
function goodConversationPatch(record: LicenseStateRecord, license: LicensePayload, input: { token: string; receivedAt: Date; attemptStartedAt: Date }): LicenseStatePatch {
  const issuedMs = Date.parse(license.issuedAt);
  const patch: LicenseStatePatch = {
    token: input.token,
    everActivated: true,
    newestIssuedAt: new Date(issuedMs),
    lastCheckIn: { emissorTime: new Date(issuedMs), localTime: new Date(validMs(input.receivedAt) ?? issuedMs) },
    lastSeenAt: new Date(issuedMs),
    unreadableSince: null,
    checkInResult: CHECK_IN_OK
  };

  if (requestServed(record.checkInRequestedAt, input.attemptStartedAt)) {
    patch.checkInRequestedAt = null;
  }

  return patch;
}

/**
 * O Emissor devolveu uma licenca nova. So vale se confere com as raizes, se traz o nonce deste pedido (a resposta
 * fresca, freshConversationLicense) e se e desta Instalacao; recusada, grava o motivo como uma falha e nada mais muda.
 * Aceita, troca a licenca e a sequencia, guarda a hora assinada (a emissao da licenca nova) como a ultima conferencia,
 * realinha com ela a ultima hora vista e a data da mais nova aceita e apaga a marca de licenca ilegivel. A tentativa que
 * ja foi substituida por outra nao grava nada.
 */
export function planCheckInSuccess(record: LicenseStateRecord | null, input: CheckInSuccessInput): LicensePlan<CheckInOutcome> {
  const refuse = (result: LicenseRefusal) => planCheckInFailure(record, { result, attemptStartedAt: input.attemptStartedAt });

  if (!record) {
    return refuse("outra_instalacao");
  }

  if (attemptSuperseded(record, input.attemptStartedAt)) {
    return SUPERSEDED;
  }

  const checked = freshConversationLicense(input.token, input.roots, input.nonce);

  if (!checked.ok) {
    return refuse(checked.error);
  }

  const license = checked.license;

  if (record.installationId === null || license.installation.id !== record.installationId) {
    return refuse("outra_instalacao");
  }

  return { patch: { ...goodConversationPatch(record, license, input), checkInSequence: input.sequence }, outcome: { accepted: true, license } };
}

// ---- Conversas fora da rodada do tick (a tela Licenca) ------------------------------------------------

/**
 * Ativar, Verificar agora e desativar falam com o Emissor fora da rodada do tick, mas pela mesma reserva
 * (checkInResult = "em_andamento"): duas conversas nunca correm juntas. Duas ativacoes ao mesmo tempo dariam dois
 * segredos, e o Emissor so guarda o ultimo: a Instalacao que gravasse o outro ficaria sem conferir.
 */
export type ConversationStart =
  | {
      reserved: true;
      attemptStartedAt: Date;
      /** O que a linha tinha antes da reserva: a ativacao e o desativar que falham devolvem isto (planConversationRelease). */
      previous: { checkInResult: string | null; checkInAttemptedAt: Date | null };
    }
  | { reserved: false; reason: "em_andamento" | "sem_instalacao" | "relogio_invalido" };

export type ConversationStartInput = {
  systemNow: Date;
  /** Verificar agora e desativar precisam do identificador e do segredo da Instalacao; ativar, nao. */
  requireInstallation: boolean;
};

/** Reserva a conversa com o Emissor, se nenhuma outra esta correndo (a reserva viva de CHECK_IN_LEASE_MS). */
export function planConversationStart(record: LicenseStateRecord | null, input: ConversationStartInput): LicensePlan<ConversationStart> {
  const current = record ?? EMPTY_LICENSE_RECORD;
  const nowMs = validMs(input.systemNow);

  if (nowMs === null) {
    return { patch: {}, outcome: { reserved: false, reason: "relogio_invalido" } };
  }

  if (input.requireInstallation && (!current.installationId || !current.installationSecret)) {
    return { patch: {}, outcome: { reserved: false, reason: "sem_instalacao" } };
  }

  const attemptedMs = validMs(current.checkInAttemptedAt);
  const sinceAttemptMs = attemptedMs === null ? Number.POSITIVE_INFINITY : nowMs - attemptedMs;

  if (current.checkInResult === CHECK_IN_RUNNING && sinceAttemptMs >= 0 && sinceAttemptMs < CHECK_IN_LEASE_MS) {
    return { patch: {}, outcome: { reserved: false, reason: "em_andamento" } };
  }

  const attemptStartedAt = new Date(nowMs);

  return {
    patch: { checkInAttemptedAt: attemptStartedAt, checkInResult: CHECK_IN_RUNNING },
    outcome: { reserved: true, attemptStartedAt, previous: { checkInResult: current.checkInResult, checkInAttemptedAt: current.checkInAttemptedAt } }
  };
}

export type ConversationReleaseInput = {
  attemptStartedAt: Date;
  previous: { checkInResult: string | null; checkInAttemptedAt: Date | null };
};

/**
 * A ativacao ou o desativar falhou: devolve a reserva como estava antes, sem mexer na agenda da conferencia diaria (uma
 * Chave errada nao vira "conferencia que falhou"). So quem ainda segura a reserva devolve.
 */
export function planConversationRelease(record: LicenseStateRecord | null, input: ConversationReleaseInput): LicensePlan<{ released: boolean }> {
  if (!record || record.checkInResult !== CHECK_IN_RUNNING || attemptSuperseded(record, input.attemptStartedAt)) {
    return { patch: {}, outcome: { released: false } };
  }

  return {
    patch: { checkInResult: input.previous.checkInResult, checkInAttemptedAt: input.previous.checkInAttemptedAt },
    outcome: { released: true }
  };
}

export type ActivationSuccessInput = {
  token: string;
  installationId: string;
  installationSecret: string;
  sequence: string;
  /** O nonce que esta Instalacao sorteou para a ativacao. */
  nonce: string;
  roots: readonly TrustedRoot[];
  receivedAt: Date;
  attemptStartedAt: Date;
};

/**
 * A ativacao deu certo: grava, numa gravacao so, a licenca, o identificador, o segredo e a sequencia (docs/protocolo.md:
 * o segredo sai so nesta resposta). Ativar troca a identidade da Instalacao (a Chave nova num endereco largado cria
 * outra), entao a licenca tem de ser do identificador que veio junto, nao do guardado. A licenca tem de trazer o nonce
 * desta ativacao (o cliente ja conferiu; o store confere de novo): fresca, ela vale mesmo mais antiga que a mais nova
 * ja aceita, e a data da mais nova acompanha (freshConversationLicense).
 */
export function planActivationSuccess(record: LicenseStateRecord | null, input: ActivationSuccessInput): LicensePlan<CheckInOutcome> {
  const current = record ?? EMPTY_LICENSE_RECORD;

  if (record && attemptSuperseded(record, input.attemptStartedAt)) {
    return SUPERSEDED;
  }

  const checked = freshConversationLicense(input.token, input.roots, input.nonce);

  if (!checked.ok) {
    return { patch: {}, outcome: { accepted: false, result: checked.error } };
  }

  if (checked.license.installation.id !== input.installationId) {
    return { patch: {}, outcome: { accepted: false, result: "outra_instalacao" } };
  }

  return {
    patch: {
      ...goodConversationPatch(current, checked.license, input),
      installationId: input.installationId,
      installationSecret: input.installationSecret,
      checkInSequence: input.sequence
    },
    outcome: { accepted: true, license: checked.license }
  };
}

export type DeactivationSuccessInput = {
  token: string;
  /** O nonce que esta Instalacao sorteou para o desativar. */
  nonce: string;
  roots: readonly TrustedRoot[];
  receivedAt: Date;
  attemptStartedAt: Date;
};

/**
 * O desativar deu certo: grava a ordem assinada (Escola congelada, motivo desativada) como qualquer licenca nova da
 * conversa com o Emissor, com a mesma sequencia (o desativar nao devolve outra). O segredo fica: a conferencia diaria
 * continua recebendo a ordem assinada, e o Painel ve a desativada que continua respondendo.
 */
export function planDeactivationSuccess(record: LicenseStateRecord | null, input: DeactivationSuccessInput): LicensePlan<CheckInOutcome> {
  if (!record) {
    return { patch: {}, outcome: { accepted: false, result: "outra_instalacao" } };
  }

  if (attemptSuperseded(record, input.attemptStartedAt)) {
    return SUPERSEDED;
  }

  const checked = freshConversationLicense(input.token, input.roots, input.nonce);

  if (!checked.ok) {
    return { patch: {}, outcome: { accepted: false, result: checked.error } };
  }

  if (record.installationId === null || checked.license.installation.id !== record.installationId) {
    return { patch: {}, outcome: { accepted: false, result: "outra_instalacao" } };
  }

  return { patch: goodConversationPatch(record, checked.license, input), outcome: { accepted: true, license: checked.license } };
}

export type LicenseFileInput = {
  token: string;
  roots: readonly TrustedRoot[];
  /** O endereco configurado da Instalacao: o arquivo tem de ser dele. */
  configuredHost: string | null;
};

/**
 * A licenca por arquivo (docs/32 §2.3 e docs/protocolo.md, "A licenca por arquivo"), enviada pela tela Licenca: vale
 * como licenca, nunca como conferencia. So aceita a que confere com as raizes, foi baixada como arquivo
 * (`delivery: "file"`, sem nonce), e deste endereco e desta Instalacao (quando ja ha uma) e nao e mais antiga que a mais
 * nova ja aceita. Nao mexe na ultima conferencia nem na ultima hora vista (quem anda a hora e o tick, a partir da
 * emissao assinada do arquivo) nem na reserva da conversa com o Emissor.
 */
export function planLicenseFile(record: LicenseStateRecord | null, input: LicenseFileInput): LicensePlan<CheckInOutcome> {
  const current = record ?? EMPTY_LICENSE_RECORD;
  const checked = checkLicenseToken(input.token, input.roots, current.newestIssuedAt);
  const refuse = (result: LicenseRefusal): LicensePlan<CheckInOutcome> => ({ patch: {}, outcome: { accepted: false, result } });

  if (!checked.ok) {
    return refuse(checked.error === "licenca_antiga" ? "licenca_antiga" : "licenca_invalida");
  }

  const license = checked.license;

  if (license.delivery !== "file" || license.nonce !== undefined) {
    return refuse("nao_e_arquivo");
  }

  if (!sameHost(license.installation.host, input.configuredHost)) {
    return refuse("endereco_diferente");
  }

  if (current.installationId !== null && license.installation.id !== current.installationId) {
    return refuse("outra_instalacao");
  }

  const issuedMs = Date.parse(license.issuedAt);
  const newestMs = validMs(current.newestIssuedAt);
  const patch: LicenseStatePatch = {
    token: input.token,
    everActivated: true,
    newestIssuedAt: new Date(newestMs === null ? issuedMs : Math.max(newestMs, issuedMs)),
    unreadableSince: null
  };

  if (current.installationId === null) {
    patch.installationId = license.installation.id;
  }

  return { patch, outcome: { accepted: true, license } };
}

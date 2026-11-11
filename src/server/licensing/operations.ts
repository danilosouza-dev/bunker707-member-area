// O que a tela Licenca do admin faz com a licenca desta Instalacao (docs/32 §2.1, §2.3 e §2.4): ativar com a Chave de
// ativacao (conferencia inicial e depois a ativacao), desativar e carregar a licenca por arquivo. O Verificar agora e a
// conferencia do tick fora da agenda (runLicenseCheckInNow, tick.ts). Puro, sem "server-only" e sem "@/": recebe o
// banco (store.ts) e o cliente do Emissor (client.ts) por parametro, e os testes carregam direto.
//
// - toda conversa com o Emissor passa pela mesma reserva da conferencia diaria (planConversationStart): duas nunca
//   correm juntas, e duas ativacoes ao mesmo tempo nao deixam a Instalacao com o segredo que o Emissor ja trocou;
// - a ativacao e o desativar que falham devolvem a reserva como estava: uma Chave errada nao mexe na agenda da
//   conferencia diaria;
// - o cliente ja conferiu a licenca devolvida (raizes, nonce do pedido, Instalacao, endereco e a mais nova aceita), e o
//   store confere de novo antes de gravar;
// - nada daqui escreve log, e nenhum resultado carrega a Chave, o segredo, a sequencia ou a licenca.

import type { EmissorClient, EmissorFailure, EmissorVersions } from "./client";
import { normalizeHost } from "./evaluate";
import { hostSchema, type LicensePayload, type TrustedRoot } from "./model";
import { newInstanceId, newRequestNonce } from "./request-ids";
import {
  mutateLicenseState,
  planActivationSuccess,
  planConversationRelease,
  planConversationStart,
  planDeactivationSuccess,
  planLicenseFile,
  type CheckInOutcome,
  type ConversationStart,
  type LicenseMutation,
  type LicenseStateDb,
  type LicenseStateRecord
} from "./store";

export type LicenseOperationDeps = {
  db: () => LicenseStateDb;
  client: () => EmissorClient;
  roots: () => readonly TrustedRoot[];
  /** O endereco configurado da Instalacao (NEXT_PUBLIC_SITE_URL): e ele que vai para o Emissor. */
  configuredHost: () => string | null;
  now: () => Date;
  nonce?: () => string;
  instanceId?: () => string;
  versions?: () => EmissorVersions;
};

/** Por que a conversa nem comecou: outra esta correndo, nao ha Instalacao, o relogio e invalido ou a linha disputada. */
export type ConversationNotStarted = "em_andamento" | "sem_instalacao" | "relogio_invalido" | "disputada";

export type LicenseOperationFailure = {
  ok: false;
  /** Um codigo do protocolo, do cliente (client.ts), do store (store.ts) ou desta tela. */
  error: string;
  host?: string;
  retryAfterSeconds?: number;
  changes?: number;
};

/** Quantas vezes a gravacao da ativacao refaz mutateLicenseState (cada uma com LICENSE_WRITE_ATTEMPTS tentativas). */
const ACTIVATION_WRITE_ROUNDS = 3;

/** A conferencia inicial nao passou inteira (a ativacao seguiu): o que a tela avisa. */
export type ActivationPortsNote = "ok" | "portas_fechadas" | "sem_ipv4_publico";

export type ActivationOutcome =
  | { ok: true; license: LicensePayload; slot: "livre" | "mesmo_endereco"; ports: ActivationPortsNote }
  | LicenseOperationFailure;

export type DeactivationOutcome = { ok: true; license: LicensePayload } | LicenseOperationFailure;

export type LicenseFileOutcome = { ok: true; license: LicensePayload } | LicenseOperationFailure;

function failureOf(failure: EmissorFailure): LicenseOperationFailure {
  return {
    ok: false,
    error: failure.error,
    ...(failure.host ? { host: failure.host } : {}),
    ...(failure.retryAfterSeconds !== undefined ? { retryAfterSeconds: failure.retryAfterSeconds } : {}),
    ...(failure.changes !== undefined ? { changes: failure.changes } : {})
  };
}

/** O endereco configurado como o protocolo pede (o nome, sem porta); null se nao ha um valido. */
function protocolHostOf(configured: string | null): string | null {
  const parsed = hostSchema.safeParse(normalizeHost(configured));
  return parsed.success ? parsed.data : null;
}

type Reservation = { record: LicenseStateRecord; start: Extract<ConversationStart, { reserved: true }> };

async function reserve(db: LicenseStateDb, now: Date, requireInstallation: boolean): Promise<Reservation | ConversationNotStarted> {
  const reservation = await mutateLicenseState(db, (record) => planConversationStart(record, { systemNow: now, requireInstallation }));

  if (!reservation) {
    return "disputada";
  }

  if (!reservation.outcome.reserved) {
    return reservation.outcome.reason;
  }

  return reservation.record ? { record: reservation.record, start: reservation.outcome } : "disputada";
}

/** Devolve a reserva como estava. Perdeu a disputa: a reserva vence sozinha em CHECK_IN_LEASE_MS. */
async function release(db: LicenseStateDb, reservation: Reservation): Promise<void> {
  await mutateLicenseState(db, (record) =>
    planConversationRelease(record, { attemptStartedAt: reservation.start.attemptStartedAt, previous: reservation.start.previous })
  );
}

/**
 * Ativar com a Chave de ativacao (docs/32 §2.1; docs/protocolo.md, preflight e activate). Primeiro a conferencia
 * inicial, que confere a Chave e a vaga sem gastar a Chave: o erro dela (Chave mal copiada, vencida, usada, vaga em uso
 * noutro endereco...) para tudo antes de gastar. Ela tambem bate de fora nas portas 80 e 443 do IP de onde o pedido
 * saiu; o admin ja abre pelo endereco publico, entao a porta que nao respondeu nao para a ativacao (o IP de saida pode
 * nao ser o de entrada): vira um aviso na tela. Depois a ativacao, que gasta a Chave e devolve a licenca, o segredo e
 * a sequencia, gravados numa gravacao so. Ativar de novo no mesmo endereco nao gasta outra vaga.
 */
export async function activateWithKey(deps: LicenseOperationDeps, activationKey: string): Promise<ActivationOutcome> {
  const host = protocolHostOf(deps.configuredHost());

  if (!host) {
    return { ok: false, error: "sem_endereco" };
  }

  const db = deps.db();
  const reservation = await reserve(db, deps.now(), false);

  if (typeof reservation === "string") {
    return { ok: false, error: reservation };
  }

  const client = deps.client();
  const instanceId = (deps.instanceId ?? newInstanceId)();
  const preflight = await client.preflight({ activationKey, host, instanceId });

  if (!preflight.ok) {
    await release(db, reservation);
    return failureOf(preflight);
  }

  const activation = await client.activate({
    activationKey,
    host,
    instanceId,
    nonce: (deps.nonce ?? newRequestNonce)(),
    versions: deps.versions?.(),
    newestIssuedAt: reservation.record.newestIssuedAt
  });

  if (!activation.ok) {
    await release(db, reservation);
    return failureOf(activation);
  }

  const roots = deps.roots();
  const receivedAt = deps.now();
  let recorded: LicenseMutation<CheckInOutcome> | null = null;

  // O segredo sai so nesta resposta: perder a gravacao para a rodada do tick (que grava a cada minuto) seria perder a
  // Instalacao. Mais voltas que as das outras gravacoes; a reserva segura qualquer outra conversa enquanto isso.
  for (let round = 0; round < ACTIVATION_WRITE_ROUNDS && !recorded; round += 1) {
    recorded = await mutateLicenseState(db, (record) =>
      planActivationSuccess(record, {
        token: activation.token,
        installationId: activation.installationId,
        installationSecret: activation.installationSecret,
        sequence: activation.sequence,
        roots,
        receivedAt,
        attemptStartedAt: reservation.start.attemptStartedAt
      })
    );
  }

  if (!recorded) {
    return { ok: false, error: "disputada" };
  }

  if (!recorded.outcome.accepted) {
    await release(db, reservation);
    return { ok: false, error: recorded.outcome.result };
  }

  const ports: ActivationPortsNote = preflight.passed ? "ok" : preflight.ipPublic ? "portas_fechadas" : "sem_ipv4_publico";
  return { ok: true, license: recorded.outcome.license, slot: preflight.slot, ports };
}

/**
 * Desativar (docs/32 §2.3): a Instalacao vai na hora para a Escola congelada e a vaga da Licenca fica livre para outra.
 * Grava a ordem assinada que o Emissor devolve. Soma no limite de duas mudancas por ano (limite_de_mudancas).
 */
export async function deactivateInstallation(deps: LicenseOperationDeps): Promise<DeactivationOutcome> {
  const db = deps.db();
  const reservation = await reserve(db, deps.now(), true);

  if (typeof reservation === "string") {
    return { ok: false, error: reservation };
  }

  const { installationId, installationSecret, newestIssuedAt } = reservation.record;
  const answer = await deps.client().deactivate({
    installationId: installationId ?? "",
    installationSecret: installationSecret ?? "",
    nonce: (deps.nonce ?? newRequestNonce)(),
    newestIssuedAt
  });

  if (!answer.ok) {
    await release(db, reservation);
    return failureOf(answer);
  }

  const roots = deps.roots();
  const recorded = await mutateLicenseState(db, (record) =>
    planDeactivationSuccess(record, { token: answer.token, roots, receivedAt: deps.now(), attemptStartedAt: reservation.start.attemptStartedAt })
  );

  if (!recorded) {
    return { ok: false, error: "disputada" };
  }

  if (!recorded.outcome.accepted) {
    await release(db, reservation);
    return { ok: false, error: recorded.outcome.result };
  }

  return { ok: true, license: recorded.outcome.license };
}

/** O arquivo da licenca por arquivo: uma linha com o texto BKL1 (espacos e quebras de linha em volta nao contam). */
export const MAX_LICENSE_FILE_BYTES = 32 * 1024;

/**
 * Carregar a licenca por arquivo (docs/32 §2.3): para o servidor que nao consegue falar com o Emissor. Conferida aqui,
 * com as raizes gravadas no produto, e gravada como licenca, nunca como conferencia (planLicenseFile). Nao fala com o
 * Emissor.
 */
export async function loadLicenseFile(deps: Pick<LicenseOperationDeps, "db" | "roots" | "configuredHost">, text: string): Promise<LicenseFileOutcome> {
  const token = text.trim();

  if (token.length === 0) {
    return { ok: false, error: "arquivo_vazio" };
  }

  if (token.length > MAX_LICENSE_FILE_BYTES || !/^BKL1\.[A-Za-z0-9_.-]+$/.test(token)) {
    return { ok: false, error: "licenca_invalida" };
  }

  const roots = deps.roots();
  const configuredHost = deps.configuredHost();
  const recorded = await mutateLicenseState(deps.db(), (record) => planLicenseFile(record, { token, roots, configuredHost }));

  if (!recorded) {
    return { ok: false, error: "disputada" };
  }

  return recorded.outcome.accepted ? { ok: true, license: recorded.outcome.license } : { ok: false, error: recorded.outcome.result };
}

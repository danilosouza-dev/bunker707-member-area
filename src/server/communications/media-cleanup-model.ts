// Regras da limpeza automatica dos arquivos da Comunicacao (docs/22 §4.6). Modulo puro (imports relativos): os
// prazos, quando o job trabalha no dia e o plano de cada rodada a partir do que esta no Storage, do que esta em uso
// e do que ja estava marcado. O job (media-cleanup.ts) so le, chama estas funcoes e grava.
//
// - Arquivo enviado ha menos de 24 h nunca e julgado (pode ser um envio no meio do caminho ou um rascunho que
//   ainda vai ser salvo).
// - Sem uso: entra em communication_media_orphans com a hora em que foi visto sem uso; volta a ser usado, sai.
// - Sem uso ha 30 dias ou mais: sai do Storage (no maximo 500 por rodada; o resto na rodada seguinte). Os 30 dias
//   deixam desfazer uma exclusao ou duplicar um aviso excluido sem perder o video, a imagem, o audio ou a fonte.

import { COMMUNICATION_MEDIA_LOCATIONS, mediaKey, mediaLocationOf, type MediaLocation, type MediaRef } from "./media-refs";

export const MEDIA_CLEANUP_RULES = {
  /** Dias sem uso ate o arquivo sair do Storage. */
  graceDays: 30,
  /** Horas desde o envio antes de um arquivo poder ser julgado. */
  uploadGraceHours: 24,
  /** Arquivos apagados por rodada, no maximo. */
  maxDeletesPerRun: 500,
  /** Itens por pagina ao listar o Storage. */
  listPageSize: 1_000,
  /** Teto de arquivos listados por lugar numa rodada (bem acima do volume esperado: so a equipe envia). */
  maxListedPerLocation: 20_000,
  /** Horario do dia (UTC) a partir do qual a rodada do dia pode sair: 03:53 em Brasilia, depois da retencao das 06:41 UTC. */
  dailyAtUtc: { hour: 6, minute: 53 },
  /** Depois de uma rodada que falhou, espera antes de tentar de novo. */
  retryAfterFailureMinutes: 60,
  /** Rodada que parou no teto ou no fim do tempo continua depois desta pausa. */
  continueAfterMinutes: 5,
  /** Rodada em andamento ha menos que isso: outro tick esta trabalhando (STALE_JOB_RUN_MINUTES de job-runs.ts). */
  runningMinutes: 15,
  /** Tempo proprio da rodada dentro do tick de minuto. */
  budgetMs: 20_000,
  /** Sobra minima do tick para comecar; menos que isso, fica para o minuto seguinte. */
  minTickLeftMs: 15_000
} as const;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function timeOf(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const time = Date.parse(value);

  return Number.isFinite(time) ? time : null;
}

/** Enviado ha menos de 24 h (ou sem data legivel): ainda nao e julgado. */
export function isTooRecentToJudge(createdAt: string | null | undefined, now: Date): boolean {
  const created = timeOf(createdAt);

  return created === null || now.getTime() - created < MEDIA_CLEANUP_RULES.uploadGraceHours * HOUR_MS;
}

/** Sem uso desde `firstOrphanAt` ha 30 dias ou mais (data ilegivel nunca vence). */
export function isOrphanDue(firstOrphanAt: string | null | undefined, now: Date): boolean {
  const since = timeOf(firstOrphanAt);

  return since !== null && now.getTime() - since >= MEDIA_CLEANUP_RULES.graceDays * DAY_MS;
}

/** Ate quando (exclusive) a marca precisa ter nascido para o arquivo poder sair agora. */
export function orphanDueCutoff(now: Date): Date {
  return new Date(now.getTime() - MEDIA_CLEANUP_RULES.graceDays * DAY_MS);
}

/** Inicio da janela do dia: o ultimo horario diario (UTC) que ja passou. */
export function dailySlotStart(now: Date): Date {
  const { hour, minute } = MEDIA_CLEANUP_RULES.dailyAtUtc;
  const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute));

  return slot.getTime() <= now.getTime() ? slot : new Date(slot.getTime() - DAY_MS);
}

/** Uma rodada anterior (linha de job_runs com metadata.media_cleanup). */
export type MediaCleanupRunRecord = { done: boolean; startedAt: string; status: "failed" | "running" | "succeeded" };

export type MediaCleanupDecision = { reason: "already_done" | "cooling_down" | "due" | "running"; run: boolean };

/**
 * O job roda a cada minuto e decide aqui se trabalha: uma rodada completa por dia, a partir do horario diario;
 * outra rodada em andamento, uma falha recente ou uma pausa curta depois de parar no teto seguram a vez.
 */
export function mediaCleanupDecision(now: Date, runs: readonly MediaCleanupRunRecord[]): MediaCleanupDecision {
  const slot = dailySlotStart(now).getTime();
  const at = now.getTime();
  const recent = runs
    .map((run) => ({ ...run, time: timeOf(run.startedAt) }))
    .filter((run): run is MediaCleanupRunRecord & { time: number } => run.time !== null)
    .sort((left, right) => right.time - left.time);

  if (recent.some((run) => run.status === "succeeded" && run.done && run.time >= slot)) {
    return { reason: "already_done", run: false };
  }

  const latest = recent[0];

  if (latest) {
    const minutesAgo = (at - latest.time) / 60_000;

    if (latest.status === "running" && minutesAgo < MEDIA_CLEANUP_RULES.runningMinutes) {
      return { reason: "running", run: false };
    }

    if (latest.status === "failed" && minutesAgo < MEDIA_CLEANUP_RULES.retryAfterFailureMinutes) {
      return { reason: "cooling_down", run: false };
    }

    if (latest.status === "succeeded" && !latest.done && minutesAgo < MEDIA_CLEANUP_RULES.continueAfterMinutes) {
      return { reason: "cooling_down", run: false };
    }
  }

  return { reason: "due", run: true };
}

/** Um arquivo listado no Storage (so os que casam com o padrao do lugar). */
export type ListedMedia = MediaRef & { createdAt: string | null };
/** Uma linha de communication_media_orphans. */
export type OrphanMark = MediaRef & { firstOrphanAt: string };

export type MediaCleanupPlan = {
  /** Vencidos para sair agora (os mais antigos primeiro, ate o teto). */
  due: OrphanMark[];
  /** Sem uso pela primeira vez: entram na tabela com a hora de agora. */
  mark: MediaRef[];
  /** Enviados ha menos de 24 h e sem uso (nao julgados). */
  recent: number;
  /** Vencidos que passaram do teto da rodada. */
  remaining: number;
  /** Sairam da tabela: voltaram a ser usados, sumiram do Storage, foram enviados de novo ou nao sao de um lugar nosso. */
  unmark: MediaRef[];
  /** Sem uso, esperando os 30 dias. */
  waiting: number;
};

function locationKey(location: MediaLocation) {
  return `${location.bucket}/${location.prefix}`;
}

/** Chave do lugar para `completeLocations` (o job anota os lugares listados ate o fim). */
export function mediaLocationKey(location: MediaLocation): string {
  return locationKey(location);
}

/**
 * O plano da rodada. `completeLocations`: lugares listados ate o fim (so neles "nao esta no Storage" quer dizer
 * que o arquivo sumiu). `referenced`: chaves (mediaKey) de tudo que esta em uso agora.
 */
export function planMediaCleanup(input: {
  completeLocations: ReadonlySet<string>;
  listed: readonly ListedMedia[];
  locations?: readonly MediaLocation[];
  marked: readonly OrphanMark[];
  maxDeletes?: number;
  now: Date;
  referenced: ReadonlySet<string>;
}): MediaCleanupPlan {
  const locations = input.locations ?? COMMUNICATION_MEDIA_LOCATIONS;
  const maxDeletes = Math.max(0, input.maxDeletes ?? MEDIA_CLEANUP_RULES.maxDeletesPerRun);
  const listed = new Map<string, ListedMedia>();

  for (const item of input.listed) {
    if (mediaLocationOf(item, locations)) {
      listed.set(mediaKey(item), item);
    }
  }

  const marked = new Map(input.marked.map((row) => [mediaKey(row), row]));
  const plan: MediaCleanupPlan = { due: [], mark: [], recent: 0, remaining: 0, unmark: [], waiting: 0 };
  const due: OrphanMark[] = [];

  for (const [key, row] of marked) {
    const location = mediaLocationOf(row, locations);
    const object = listed.get(key);
    const gone = !object && location !== null && input.completeLocations.has(locationKey(location));

    if (input.referenced.has(key) || !location || gone || (object && isTooRecentToJudge(object.createdAt, input.now))) {
      plan.unmark.push({ bucket: row.bucket, path: row.path });
    } else if (object && isOrphanDue(row.firstOrphanAt, input.now)) {
      due.push(row);
    } else if (object) {
      plan.waiting += 1;
    }
  }

  for (const [key, object] of listed) {
    if (input.referenced.has(key) || marked.has(key)) {
      continue;
    }

    if (isTooRecentToJudge(object.createdAt, input.now)) {
      plan.recent += 1;
    } else {
      plan.mark.push({ bucket: object.bucket, path: object.path });
    }
  }

  due.sort((left, right) => Date.parse(left.firstOrphanAt) - Date.parse(right.firstOrphanAt) || mediaKey(left).localeCompare(mediaKey(right)));
  plan.due = due.slice(0, maxDeletes);
  plan.remaining = due.length - plan.due.length;

  return plan;
}

/** Agrupa por bucket (cada chamada ao Storage e a uma tabela filtrada vai por bucket). */
export function groupByBucket<T extends MediaRef>(refs: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const ref of refs) {
    const group = groups.get(ref.bucket) ?? [];
    group.push(ref);
    groups.set(ref.bucket, group);
  }

  return groups;
}

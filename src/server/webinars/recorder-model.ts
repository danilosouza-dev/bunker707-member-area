// O gravador por hora, a parte pura (docs/30 §5.3, §6.5 e §6.7): a maquina de estados de recorder_status, o
// carimbo de inicio que o Jibri poe no nome do arquivo, o que cada chamada do webhook muda na sessao e na
// gravacao, e a diferenca entre a ancora (hora do servidor) e o inicio do arquivo, mostrada como conferencia.
// Modulo puro (tests/webinarios-sala-ao-vivo-modelo.test.mjs).

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import type { RecorderState } from "./live-schemas";

export const RECORDER_STATUSES = ["none", "preparing", "ready", "recording", "uploading", "uploaded", "upload_failed", "unavailable", "gone"] as const;
export type RecorderStatus = (typeof RECORDER_STATUSES)[number];

/**
 * O que um estado do webhook faz com recorder_status: devolve o proximo, ou nulo quando a chamada e velha ou fora de
 * ordem (ela fica gravada em webinar_recording_events como `ignored`). `recording` so vem da acao markRecordingAnchor
 * (o navegador do host), nunca do webhook, mas e aceito quando chega por ele.
 */
export function recorderTransition(current: RecorderStatus, incoming: RecorderState): RecorderStatus | null {
  switch (incoming) {
    case "ready":
      return current === "none" || current === "preparing" || current === "unavailable" ? "ready" : null;
    case "recording":
      return current === "ready" || current === "preparing" ? "recording" : null;
    case "uploaded":
      // upload_failed -> uploaded: o finalize.sh rodado de novo a mao depois de um envio que falhou (docs/20 §8B.5).
      // none/preparing: o `ready` se perdeu (ou a maquina foi pedida a mao) e a ancora nao andou; uploaded: o segundo
      // arquivo da mesma live (Parar e Gravar de novo; a repeticao do mesmo arquivo ja cai na chave unica do evento).
      // O arquivo existe e vale mais que a ordem dos avisos.
      return current === "gone" || current === "unavailable" ? null : "uploaded";
    case "upload_failed":
      return current === "none" || current === "preparing" || current === "recording" || current === "uploading" || current === "ready" ? "upload_failed" : null;
    case "unavailable":
      return current === "none" || current === "preparing" ? "unavailable" : null;
    case "gone":
      return current === "gone" ? null : "gone";
    default:
      return null;
  }
}

/** A maquina do gravador existe (foi pedida e ainda nao foi apagada). */
export function recorderMachineAlive(status: RecorderStatus): boolean {
  return status === "preparing" || status === "ready" || status === "recording" || status === "uploading" || status === "uploaded" || status === "upload_failed";
}

/** O Jibri nomeia o arquivo `<sala>_yyyy-MM-dd-HH-mm-ss.mp4` em UTC; devolve o ISO ou nulo. */
export function parseJibriStartedAt(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const text = value.trim();
  const stamp = /(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})(?:\.mp4)?$/.exec(text);
  if (stamp) {
    const [, year, month, day, hour, minute, second] = stamp;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const iso = new Date(text);
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}

/** Quanto o arquivo comecou depois (ou antes) da ancora gravada pelo servidor, em ms: a conferencia do "Alinhar chat". */
export function anchorDriftMs(anchorAtIso: string | null | undefined, fileStartedAtIso: string | null | undefined): number | null {
  if (!anchorAtIso || !fileStartedAtIso) {
    return null;
  }
  const anchor = new Date(anchorAtIso).getTime();
  const started = new Date(fileStartedAtIso).getTime();
  return Number.isFinite(anchor) && Number.isFinite(started) ? started - anchor : null;
}

export type RecordingPatch = {
  bunny_library_id?: string | null;
  bunny_video_id?: string | null;
  duration_seconds?: number | null;
  error_message?: string | null;
  file_name?: string | null;
  sha256?: string | null;
  size_bytes?: number | null;
  status: "processing" | "failed";
};

/** O que `uploaded` e `upload_failed` gravam em webinar_recordings (source jibri); os outros estados nao tocam nela. */
export function recordingPatchFor(input: {
  bunnyLibraryId?: string;
  bunnyVideoId?: string;
  durationSeconds?: number;
  error?: string;
  fileName?: string;
  sha256?: string;
  sizeBytes?: number;
  state: RecorderState;
}): RecordingPatch | null {
  if (input.state === "uploaded") {
    return {
      bunny_library_id: input.bunnyLibraryId ?? null,
      bunny_video_id: input.bunnyVideoId ?? null,
      duration_seconds: input.durationSeconds ?? null,
      error_message: null,
      file_name: input.fileName ?? null,
      sha256: input.sha256?.toLowerCase() ?? null,
      size_bytes: input.sizeBytes ?? null,
      status: "processing"
    };
  }
  if (input.state === "upload_failed") {
    return { error_message: input.error ?? "Envio para a Bunny falhou.", file_name: input.fileName ?? null, status: "failed" };
  }
  return null;
}

/** A frase do admin para cada situacao do gravador (os nomes do card Gravacao, docs/30 §2.2; frases em webinar-copy.ts). */
export const RECORDER_LABELS: Record<RecorderStatus, string> = WEBINAR_COPY.consoleAoVivo.gravador;

/** Os ritmos do gravador por hora (docs/30 §6.4 e §6.7; I6). */
export const RECORDER_RULES = {
  /** "Preparar gravação" automatico: o tick pede a maquina este tanto antes da hora marcada (com Gravar automaticamente). */
  prepareLeadMinutes: 30,
  /** A maquina ligada ha mais que isto vira aviso no sino da equipe (uma vez por sessao, recorder_alerted_at). */
  alertAfterHours: 6,
  /** Sem `gone` depois deste tanto do pedido de devolucao, o job pede de novo (jibri-down e idempotente). */
  releaseRetryMinutes: 120,
  /** Quantas subidas recentes entram na estimativa "Preparando a gravação, {n} min". */
  estimateSamples: 5,
  /** A codificacao na Bunny: de quanto em quanto tempo o job consulta e quando desiste (a gravacao vira failed). */
  bunnyCheckEveryMinutes: 2,
  bunnyGiveUpHours: 24,
  /**
   * O preparo que nao respondeu: o jibri-up so avisa o app no `ready` e no `unavailable`; nas outras falhas (criar a
   * maquina, cloud-init, o gravador sem saude em 5 min, o workflow com erro, o `ready` perdido) a sessao ficaria em
   * `preparing` para sempre. Passado este prazo do pedido (acima da mediana do preparo + os 5 min de saude), o preparo
   * vale como sem gravador: Preparar de novo (o jibri-up e idempotente e reenvia o `ready`) e a reserva.
   */
  prepareTimeoutMinutes: 25
} as const;

/** O preparo passou do prazo sem `ready` nem `unavailable` (recorder_requested_at ha mais de 25 min; sem a hora, tambem). */
export function recorderPrepareStale(input: { nowMs: number; requestedAt: string | null | undefined; status: RecorderStatus }): boolean {
  if (input.status !== "preparing") {
    return false;
  }
  const requested = input.requestedAt ? new Date(input.requestedAt).getTime() : Number.NaN;
  return !Number.isFinite(requested) || input.nowMs - requested > RECORDER_RULES.prepareTimeoutMinutes * 60_000;
}

/**
 * "Preparar gravação" (requestRecorder) vale sem maquina viva: nunca pedida, sem estoque, ou ja apagada; e tambem com o
 * preparo vencido (`stale`, recorderPrepareStale), que nao avisou o app.
 */
export function canRequestRecorder(status: RecorderStatus, options: { stale?: boolean } = {}): boolean {
  return status === "none" || status === "unavailable" || status === "gone" || (status === "preparing" && options.stale === true);
}

/** Devolver a maquina (releaseRecorder) so quando ela existe e o arquivo nao corre risco (docs/30 §6.7: jibri-down so com uploaded). */
export function canReleaseRecorder(status: RecorderStatus, force = false): boolean {
  if (force) {
    return recorderMachineAlive(status);
  }
  return status === "uploaded" || status === "ready";
}

/**
 * O que o botao Gravar faz agora (docs/30 §1.4 e §6.7): `start` (maquina pronta: startRecording ja), `queue` (a maquina
 * esta preparando: o clique fica em recording_requested_at e a gravacao comeca sozinha no ready), `recording` (ja grava),
 * `unavailable` (sem maquina: "Gravação não preparada para esta live" e a reserva Gravar no navegador).
 */
export function recordButtonAction(status: RecorderStatus, options: { stale?: boolean } = {}): "queue" | "recording" | "start" | "unavailable" {
  switch (status) {
    case "ready":
      return "start";
    case "preparing":
      // O preparo vencido nao entra na fila: a reserva (Gravar no navegador) e Preparar de novo.
      return options.stale ? "unavailable" : "queue";
    case "recording":
    case "uploading":
      return "recording";
    default:
      return "unavailable";
  }
}

/** A maquina esta ligada ha mais de 6 h (o aviso do sino; o tick confere recorder_alerted_at para avisar uma vez). */
export function recorderOverdue(input: { nowMs: number; requestedAt: string | null; status: RecorderStatus }): boolean {
  if (!input.requestedAt || !recorderMachineAlive(input.status)) {
    return false;
  }
  const requested = new Date(input.requestedAt).getTime();
  return Number.isFinite(requested) && input.nowMs - requested > RECORDER_RULES.alertAfterHours * 60 * 60_000;
}

/**
 * A estimativa do "Preparando a gravação, {n} min" (docs/30 §6.7): o restante pela mediana das ultimas subidas
 * (pedido ate o `ready`, em ms), arredondado para cima e nunca abaixo de 1 min; sem medida, nulo ("em alguns minutos").
 */
export function prepareEstimateMinutes(input: { nowMs: number; pastDurationsMs: readonly number[]; requestedAt: string | null }): number | null {
  const samples = input.pastDurationsMs
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(-RECORDER_RULES.estimateSamples)
    .sort((a, b) => a - b);
  if (samples.length === 0 || !input.requestedAt) {
    return null;
  }
  const middle = Math.floor(samples.length / 2);
  const median = samples.length % 2 ? samples[middle] : (samples[middle - 1] + samples[middle]) / 2;
  const elapsed = input.nowMs - new Date(input.requestedAt).getTime();
  const left = Number.isFinite(elapsed) ? median - elapsed : median;
  return Math.max(1, Math.ceil(left / 60_000));
}

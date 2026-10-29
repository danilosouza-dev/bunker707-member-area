// O gravador por hora, a parte pura (docs/30 §5.3, §6.5 e §6.7): a maquina de estados de recorder_status, o
// carimbo de inicio que o Jibri poe no nome do arquivo, o que cada chamada do webhook muda na sessao e na
// gravacao, e a diferenca entre a ancora (hora do servidor) e o inicio do arquivo, mostrada como conferencia.
// Modulo puro (tests/webinarios-sala-ao-vivo-modelo.test.mjs).

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
      return current === "recording" || current === "uploading" || current === "ready" ? "uploaded" : null;
    case "upload_failed":
      return current === "recording" || current === "uploading" || current === "ready" ? "upload_failed" : null;
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

/** A frase do admin para cada situacao do gravador (docs/30 §2.4). */
export const RECORDER_LABELS: Record<RecorderStatus, string> = {
  gone: "Máquina apagada",
  none: "Não preparado",
  preparing: "Preparando a gravação",
  ready: "Pronto para gravar",
  recording: "Gravando",
  unavailable: "Sem máquina disponível",
  upload_failed: "Envio falhou",
  uploaded: "Enviado para a Bunny",
  uploading: "Enviando"
};

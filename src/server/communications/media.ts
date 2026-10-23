import "server-only";

// Audio dos avisos (arquivo enviado ou gravado no navegador do admin; docs/22 §4.5). O servidor nao confia
// no tipo informado: confere os primeiros bytes (MP3, M4A, OGG, WEBM, WAV) e recusa o que nao bate.
// Bucket publico `communication-audio` (migracao 202610200001, ate 10 MB, so audio), nome pelo hash do
// conteudo: reenviar o mesmo audio nao duplica. Duracao e forma de onda sao medidas no navegador e
// chegam com o rascunho (o schema confere os limites). Imagens usam persistImageAsset (content-assets).

import { createHash } from "node:crypto";
import { isHttpsOrLoopbackUrl } from "@/lib/loopback-url";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { AUDIO_LIMITS } from "./campaign-model";
import { CommunicationError } from "./db";
import { forgetOrphanMark } from "./media-cleanup";
import { NOTICE_AUDIO_BUCKET } from "./media-refs";

export { NOTICE_AUDIO_BUCKET };
export const NOTICE_AUDIO_FORMAT_MESSAGE = "Use um arquivo de áudio MP3, M4A, OGG, WEBM ou WAV.";
export const NOTICE_AUDIO_SIZE_MESSAGE = "O áudio deve ter no máximo 10 MB.";

type AudioFormat = { extension: string; family: string; mimeType: string };

const FORMATS = {
  aac: { extension: "aac", family: "aac", mimeType: "audio/aac" },
  mp4: { extension: "m4a", family: "mp4", mimeType: "audio/mp4" },
  mpeg: { extension: "mp3", family: "mpeg", mimeType: "audio/mpeg" },
  ogg: { extension: "ogg", family: "ogg", mimeType: "audio/ogg" },
  wav: { extension: "wav", family: "wav", mimeType: "audio/wav" },
  webm: { extension: "webm", family: "webm", mimeType: "audio/webm" }
} satisfies Record<string, AudioFormat>;

/** Tipo declarado pelo navegador -> familia. Desconhecido ou generico ("application/octet-stream") = sem declaracao. */
const DECLARED_FAMILIES: Record<string, string> = {
  "application/ogg": "ogg",
  "audio/aac": "aac",
  "audio/m4a": "mp4",
  "audio/mp3": "mpeg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mpeg",
  "audio/mpeg3": "mpeg",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/vnd.wave": "wav",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/webm": "webm",
  "audio/x-aac": "aac",
  "audio/x-m4a": "mp4",
  "audio/x-mpeg": "mpeg",
  "audio/x-wav": "wav",
  "video/mp4": "mp4",
  "video/webm": "webm"
};

const GENERIC_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/** Formato pelo conteudo (assinatura no comeco do arquivo); null = nao e um audio aceito. */
export function sniffAudioFormat(bytes: Uint8Array): AudioFormat | null {
  if (bytes.length < 12) {
    return null;
  }

  if (ascii(bytes, 0, 3) === "ID3") {
    return FORMATS.mpeg;
  }

  if (ascii(bytes, 4, 4) === "ftyp") {
    return FORMATS.mp4;
  }

  if (ascii(bytes, 0, 4) === "OggS") {
    return FORMATS.ogg;
  }

  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return FORMATS.webm;
  }

  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") {
    return FORMATS.wav;
  }

  if (bytes[0] === 0xff) {
    // ADTS (AAC puro): sincronia de 12 bits e camada 00; quadro MPEG (MP3): 11 bits e camada diferente de 00.
    if ((bytes[1] & 0xf6) === 0xf0) {
      return FORMATS.aac;
    }

    if ((bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0) {
      return FORMATS.mpeg;
    }
  }

  return null;
}

function declaredFamily(mimeType: string | null | undefined) {
  const base = (mimeType ?? "").split(";")[0].trim().toLowerCase();

  if (GENERIC_TYPES.has(base)) {
    return null;
  }

  return DECLARED_FAMILIES[base] ?? "unknown";
}

/** Envia o audio ao Storage e devolve o endereco publico e o tipo real. */
export async function persistNoticeAudio(input: { bytes: Uint8Array; mimeType: string | null }): Promise<{ mimeType: string; url: string }> {
  if (input.bytes.length > AUDIO_LIMITS.maxBytes) {
    throw new CommunicationError(NOTICE_AUDIO_SIZE_MESSAGE, 413);
  }

  const format = sniffAudioFormat(input.bytes);
  const declared = declaredFamily(input.mimeType);

  if (!format || (declared !== null && declared !== format.family)) {
    throw new CommunicationError(NOTICE_AUDIO_FORMAT_MESSAGE, 422);
  }

  const hash = createHash("sha256").update(input.bytes).digest("hex").slice(0, 24);
  const objectPath = `campaigns/${hash}.${format.extension}`;
  const storage = getSupabaseAdminClient().storage.from(NOTICE_AUDIO_BUCKET);

  // O mesmo audio enviado de novo cai no mesmo caminho: antes de enviar, a marca da limpeza sai (o prazo recomeca) e
  // uma remocao em andamento do mesmo caminho termina primeiro; so depois "ja existe" vale como enviado (docs/22 §4.6).
  await forgetOrphanMark(getSupabaseAdminClient(), { bucket: NOTICE_AUDIO_BUCKET, path: objectPath });

  const upload = await storage.upload(objectPath, input.bytes, { cacheControl: "31536000", contentType: format.mimeType, upsert: false });

  if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) {
    throw new Error(`Comunicacao: nao foi possivel enviar o audio ao Storage: ${upload.error.message}`);
  }

  const url = storage.getPublicUrl(objectPath).data.publicUrl;

  if (!isHttpsOrLoopbackUrl(new URL(url))) {
    throw new Error("Comunicacao: o audio nao ficou num endereco publico seguro.");
  }

  return { mimeType: format.mimeType, url };
}

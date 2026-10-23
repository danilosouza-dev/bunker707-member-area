import "server-only";

// Video e fontes do design do pop-up (docs/26): o servidor nunca confia no tipo nem no nome que o navegador
// informa. Confere os primeiros bytes de cada arquivo e define o tipo a partir do que encontrou.
// - Video (mp4 H.264 ou webm, ate 15 MB): o navegador envia direto ao bucket communication-popup-video por um
//   endereco assinado (o arquivo nunca passa pelo servidor do app); depois o servidor confere o tamanho pelo
//   Storage e so os primeiros 64 bytes (pedido com Range). Tipo diferente da extensao, tamanho acima do limite
//   ou bytes que nao sao de video: o objeto e apagado. Caminho videos/<uuid>.<mp4|webm>, sempre aleatorio.
// - Fonte (woff2, woff, ttf, otf, ate 2 MB): chega pela rota multipart do admin; o servidor confere a
//   assinatura e a estrutura minima do cabecalho, grava em communication-fonts/fonts/<24 hex do sha256>.<ext>
//   (o mesmo arquivo nao duplica) com o tipo do formato encontrado, e cria a linha da biblioteca com a familia
//   bf_<12 hex aleatorios> (o nome do produtor so aparece no seletor do editor, nunca no CSS).
// - Imagem do fundo do cartao: a imagem do aviso (uploadNoticeImage confere o WebP e grava em
//   content-assets/communications/images/<24 hex>.webp). Ao salvar um caminho novo, o servidor confere que o
//   objeto existe no nosso bucket e foi gravado como WebP (inspectPopupCardImage).
// Modulo do servidor; os testes de unidade carregam com "server-only" trocado por um duble.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isHttpsOrLoopbackUrl } from "@/lib/loopback-url";
import { assertNoDbError, CommunicationError, type CommunicationsDb } from "./db";
import { forgetOrphanMark } from "./media-cleanup";
import {
  POPUP_CARD_IMAGE_BUCKET,
  POPUP_CARD_IMAGE_PATH_PATTERN,
  POPUP_FONT_LIMITS,
  POPUP_FONT_PATH_PATTERN,
  POPUP_FONTS_BUCKET,
  POPUP_VIDEO_BUCKET,
  POPUP_VIDEO_LIMITS,
  POPUP_VIDEO_PATH_PATTERN,
  type PopupFontFormat,
  type PopupFontOption,
  type PopupFontStyle,
  type PopupVideo,
  type PopupVideoMimeType
} from "./popup-design-model";
import { fontRowToFace, POPUP_FONT_COLUMNS, type PopupFontRow } from "./popup-fonts";

export const POPUP_VIDEO_FORMAT_MESSAGE = "Use um vídeo MP4 (H.264) ou WEBM.";
export const POPUP_VIDEO_SIZE_MESSAGE = "O vídeo deve ter no máximo 15 MB.";
export const POPUP_VIDEO_AGAIN_MESSAGE = "Envie o vídeo de novo.";
export const POPUP_CARD_IMAGE_AGAIN_MESSAGE = "Envie a imagem do fundo de novo.";
export const POPUP_FONT_FORMAT_MESSAGE = "Use uma fonte WOFF2, WOFF, TTF ou OTF.";
export const POPUP_FONT_SIZE_MESSAGE = "A fonte deve ter no máximo 2 MB.";
export const POPUP_FONT_FILE_MESSAGE = "Escolha um arquivo de fonte.";
export const POPUP_FONT_NAME_MESSAGE = `Use de 1 a ${POPUP_FONT_LIMITS.name} caracteres.`;
export const POPUP_FONT_GONE_MESSAGE = "Esta fonte não existe mais.";
export const POPUP_FONT_LIBRARY_FULL_MESSAGE = `A biblioteca já tem ${POPUP_FONT_LIMITS.maxLibrary} fontes. Exclua uma antes de enviar outra.`;

/** Quantos bytes do comeco do video o servidor le para conferir o formato (nunca o arquivo inteiro). */
export const POPUP_VIDEO_SNIFF_BYTES = 64;

/** Nome que a fonte recebe quando o arquivo nao da um nome aproveitavel. */
const FALLBACK_FONT_NAME = "Fonte enviada";

/* ------------------------------------------------------------------------------------------------
 * Bytes
 * ---------------------------------------------------------------------------------------------- */

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function uint16(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function uint32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

/* ------------------------------------------------------------------------------------------------
 * Video
 * ---------------------------------------------------------------------------------------------- */

const VIDEO_EXTENSIONS = { "video/mp4": "mp4", "video/webm": "webm" } as const satisfies Record<PopupVideoMimeType, string>;

/**
 * Marcas principais do `ftyp` que nao sao video MP4 que o navegador toca: QuickTime (.mov), audio da Apple
 * (M4A/M4B/M4P) e do Flash (F4A/F4B), e imagens no mesmo envelope (HEIF/HEIC, AVIF, JPEG 2000, CR3).
 */
const REFUSED_MP4_BRANDS = new Set([
  "qt  ",
  "M4A ",
  "M4B ",
  "M4P ",
  "F4A ",
  "F4B ",
  "avif",
  "avis",
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
  "jp2 ",
  "jpm ",
  "jpx ",
  "mjp2",
  "crx "
]);

/** Inteiro de tamanho variavel do EBML (webm/matroska): comprimento pelo primeiro bit ligado. */
function readEbmlVint(bytes: Uint8Array, offset: number, keepMarker: boolean): { length: number; value: number } | null {
  const first = bytes[offset];

  if (first === undefined || first === 0) {
    return null;
  }

  const length = Math.clz32(first) - 23;

  if (length < 1 || length > 8 || offset + length > bytes.length) {
    return null;
  }

  let value = keepMarker ? first : first & (0xff >> length);

  for (let index = 1; index < length; index += 1) {
    value = value * 256 + bytes[offset + index];
  }

  return { length, value };
}

/** O DocType do cabecalho EBML ("webm" ou "matroska"); null se nao aparecer nos bytes lidos. */
function ebmlDocType(bytes: Uint8Array): string | null {
  const header = readEbmlVint(bytes, 4, false);

  if (!header) {
    return null;
  }

  let offset = 4 + header.length;
  const end = Math.min(bytes.length, offset + header.value);

  while (offset < end) {
    const id = readEbmlVint(bytes, offset, true);

    if (!id) {
      return null;
    }

    const size = readEbmlVint(bytes, offset + id.length, false);

    if (!size) {
      return null;
    }

    const dataStart = offset + id.length + size.length;

    // 0x4282 = DocType.
    if (id.value === 0x4282) {
      return dataStart + size.value <= bytes.length ? ascii(bytes, dataStart, size.value).replace(/\0+$/, "") : null;
    }

    offset = dataStart + size.value;
  }

  return null;
}

/**
 * Tipo do video pelos primeiros bytes; null = nao e um video aceito.
 * - MP4: caixa `ftyp` nos bytes 4 a 8, com tamanho coerente e marca principal de video (nao .mov, nao audio,
 *   nao imagem HEIF/AVIF);
 * - WEBM: cabecalho EBML 1A 45 DF A3 com o DocType "webm" (matroska/.mkv fica de fora).
 */
export function sniffPopupVideo(bytes: Uint8Array): PopupVideoMimeType | null {
  if (bytes.length < 16) {
    return null;
  }

  if (ascii(bytes, 4, 4) === "ftyp") {
    const boxSize = uint32(bytes, 0);
    const brand = ascii(bytes, 8, 4);

    if (boxSize < 16 || boxSize > 4_096 || !/^[\x20-\x7e]{4}$/.test(brand) || REFUSED_MP4_BRANDS.has(brand)) {
      return null;
    }

    return "video/mp4";
  }

  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return ebmlDocType(bytes) === "webm" ? "video/webm" : null;
  }

  return null;
}

/** O tipo que o caminho promete (pela extensao), ou null fora do formato videos/<uuid>.<mp4|webm>. */
export function popupVideoMimeTypeOfPath(objectPath: string): PopupVideoMimeType | null {
  if (!POPUP_VIDEO_PATH_PATTERN.test(objectPath)) {
    return null;
  }

  return objectPath.endsWith(".mp4") ? "video/mp4" : "video/webm";
}

/** Caminho novo e aleatorio para o video no bucket (nunca o nome do arquivo do produtor). */
export function newPopupVideoPath(mimeType: PopupVideoMimeType) {
  return `videos/${randomUUID()}.${VIDEO_EXTENSIONS[mimeType]}`;
}

export function baseMimeType(value: unknown) {
  return typeof value === "string" ? value.split(";")[0].trim().toLowerCase() : "";
}

export function isStorageNotFound(error: { message?: string; status?: unknown; statusCode?: unknown }) {
  return String(error.statusCode ?? "") === "404" || Number(error.status) === 404 || /not.?found/i.test(error.message ?? "");
}

/** Os primeiros `count` bytes de um endereco publico (pedido com Range; nunca le alem disso). */
export async function readFirstBytes(url: string, count: number): Promise<Uint8Array> {
  if (!isHttpsOrLoopbackUrl(new URL(url))) {
    throw new Error("Comunicacao: o video nao esta num endereco publico seguro.");
  }

  const response = await fetch(url, { cache: "no-store", headers: { Range: `bytes=0-${count - 1}` } });

  if (response.status === 400 || response.status === 404) {
    void response.body?.cancel().catch(() => undefined);
    throw new CommunicationError(POPUP_VIDEO_AGAIN_MESSAGE, 404);
  }

  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(`Comunicacao: nao foi possivel ler o comeco do video (${response.status}).`);
  }

  const reader = response.body.getReader();
  const head = new Uint8Array(count);
  let filled = 0;

  try {
    while (filled < count) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      const take = Math.min(value.length, count - filled);
      head.set(value.subarray(0, take), filled);
      filled += take;
    }
  } finally {
    // Servidor que ignora o Range manda o arquivo todo: o resto nem e lido. Sem await: dentro do Next (fetch
    // do servidor do app) o cancel de um corpo lido pela metade nao resolve e a Server Action ficava presa.
    void reader.cancel().catch(() => undefined);
  }

  return head.subarray(0, filled);
}

/** Video recusado: apaga o objeto (falha ao apagar so vira log) e devolve o erro para o editor. */
async function refuseVideo(db: CommunicationsDb, objectPath: string, error: CommunicationError): Promise<never> {
  const removed = await db.storage.from(POPUP_VIDEO_BUCKET).remove([objectPath]);

  if (removed.error) {
    console.error(`[comunicacao] video recusado nao foi apagado: ${removed.error.message}`);
  }

  throw error;
}

/**
 * Confere o video que o navegador enviou ao bucket: existe (senao 404), tamanho ate 15 MB (senao 413), os
 * primeiros bytes sao do tipo que a extensao promete e o tipo gravado no Storage e o mesmo (senao 422). Os
 * recusados sao apagados. Devolve o PopupVideo com o endereco publico calculado do caminho.
 */
export async function inspectPopupVideo(db: CommunicationsDb, objectPath: string): Promise<{ sizeBytes: number; video: PopupVideo }> {
  const expected = popupVideoMimeTypeOfPath(objectPath);

  if (!expected) {
    throw new CommunicationError(POPUP_VIDEO_AGAIN_MESSAGE, 400);
  }

  const storage = db.storage.from(POPUP_VIDEO_BUCKET);
  const info = await storage.info(objectPath);

  if (info.error) {
    if (isStorageNotFound(info.error as { message?: string; status?: unknown; statusCode?: unknown })) {
      throw new CommunicationError(POPUP_VIDEO_AGAIN_MESSAGE, 404);
    }

    throw new Error(`Comunicacao: nao foi possivel ler o video no Storage: ${info.error.message}`);
  }

  const details = info.data as { contentType?: unknown; metadata?: { mimetype?: unknown; size?: unknown } | null; size?: unknown };
  const sizeBytes = Number(details.size ?? details.metadata?.size ?? 0);

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return refuseVideo(db, objectPath, new CommunicationError(POPUP_VIDEO_FORMAT_MESSAGE, 422));
  }

  if (sizeBytes > POPUP_VIDEO_LIMITS.maxBytes) {
    return refuseVideo(db, objectPath, new CommunicationError(POPUP_VIDEO_SIZE_MESSAGE, 413));
  }

  const url = storage.getPublicUrl(objectPath).data.publicUrl;
  const head = await readFirstBytes(url, POPUP_VIDEO_SNIFF_BYTES);
  const storedType = baseMimeType(details.contentType ?? details.metadata?.mimetype);

  // O tipo gravado no Storage veio do navegador: so vale se for o mesmo que os bytes mostram.
  if (sniffPopupVideo(head) !== expected || storedType !== expected) {
    return refuseVideo(db, objectPath, new CommunicationError(POPUP_VIDEO_FORMAT_MESSAGE, 422));
  }

  return { sizeBytes, video: { mimeType: expected, path: objectPath, url } };
}

/**
 * Confere a imagem do fundo do cartao no nosso bucket de imagens: caminho communications/images/<24 hex>.webp,
 * o objeto existe e foi gravado como WebP (so o uploadNoticeImage grava ali, depois de conferir o WebP).
 * Faltando ou fora disso: CommunicationError com "Envie a imagem do fundo de novo." (nada e apagado: a
 * imagem pode ser a de outro aviso).
 */
export async function inspectPopupCardImage(db: CommunicationsDb, objectPath: string): Promise<void> {
  if (!POPUP_CARD_IMAGE_PATH_PATTERN.test(objectPath)) {
    throw new CommunicationError(POPUP_CARD_IMAGE_AGAIN_MESSAGE, 400);
  }

  const info = await db.storage.from(POPUP_CARD_IMAGE_BUCKET).info(objectPath);

  if (info.error) {
    if (isStorageNotFound(info.error as { message?: string; status?: unknown; statusCode?: unknown })) {
      throw new CommunicationError(POPUP_CARD_IMAGE_AGAIN_MESSAGE, 404);
    }

    throw new Error(`Comunicacao: nao foi possivel ler a imagem do fundo no Storage: ${info.error.message}`);
  }

  const details = info.data as { contentType?: unknown; metadata?: { mimetype?: unknown } | null };

  if (baseMimeType(details.contentType ?? details.metadata?.mimetype) !== "image/webp") {
    throw new CommunicationError(POPUP_CARD_IMAGE_AGAIN_MESSAGE, 422);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Fontes
 * ---------------------------------------------------------------------------------------------- */

export type PopupFontFileType = {
  extension: "otf" | "ttf" | "woff" | "woff2";
  format: PopupFontFormat;
  mimeType: "font/otf" | "font/ttf" | "font/woff" | "font/woff2";
};

export const POPUP_FONT_FILE_TYPES = {
  opentype: { extension: "otf", format: "opentype", mimeType: "font/otf" },
  truetype: { extension: "ttf", format: "truetype", mimeType: "font/ttf" },
  woff: { extension: "woff", format: "woff", mimeType: "font/woff" },
  woff2: { extension: "woff2", format: "woff2", mimeType: "font/woff2" }
} as const satisfies Record<PopupFontFormat, PopupFontFileType>;

/** Versao do sfnt dentro do arquivo: TrueType (00 01 00 00 ou "true") ou OpenType com CFF ("OTTO"). Colecao ("ttcf") fica de fora. */
function sfntFlavor(bytes: Uint8Array, offset: number): "opentype" | "truetype" | null {
  const tag = ascii(bytes, offset, 4);

  if (uint32(bytes, offset) === 0x00010000 || tag === "true") {
    return "truetype";
  }

  return tag === "OTTO" ? "opentype" : null;
}

/**
 * Formato da fonte pelos primeiros bytes e pela estrutura minima do cabecalho; null = nao e uma fonte aceita.
 * - WOFF2 ("wOF2") e WOFF ("wOFF"): o campo de tamanho bate com o arquivo e o conteudo e TrueType/OpenType;
 * - TTF (00 01 00 00 ou "true") e OTF ("OTTO"): de 1 a 512 tabelas, com o diretorio inteiro no arquivo.
 * Colecoes (ttcf), Type 1 e qualquer outro arquivo renomeado (HTML, executavel, imagem) sao recusados.
 */
export function sniffPopupFont(bytes: Uint8Array): PopupFontFileType | null {
  if (bytes.length < 12) {
    return null;
  }

  const signature = ascii(bytes, 0, 4);

  if (signature === "wOF2" || signature === "wOFF") {
    const headerSize = signature === "wOF2" ? 48 : 44;

    if (bytes.length < headerSize || uint32(bytes, 8) !== bytes.length || uint16(bytes, 12) === 0 || !sfntFlavor(bytes, 4)) {
      return null;
    }

    return signature === "wOF2" ? POPUP_FONT_FILE_TYPES.woff2 : POPUP_FONT_FILE_TYPES.woff;
  }

  const flavor = sfntFlavor(bytes, 0);
  const tables = uint16(bytes, 4);

  if (!flavor || tables < 1 || tables > 512 || bytes.length < 12 + 16 * tables) {
    return null;
  }

  return POPUP_FONT_FILE_TYPES[flavor];
}

/** Nome limpo para o seletor: sem caracteres de controle, espacos juntados e aparado. */
export function cleanPopupFontName(value: string) {
  return value
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Nome padrao a partir do nome do arquivo: sem extensao e sem pasta, aparado e cortado em 60. */
export function defaultPopupFontName(fileName: string) {
  const base = (fileName.split(/[\\/]/).pop() ?? "").trim();
  const withoutExtension = base.replace(/\.(?:woff2|woff|ttf|otf)$/i, "").replace(/[_]+/g, " ");
  const name = cleanPopupFontName(withoutExtension).slice(0, POPUP_FONT_LIMITS.name).trim();

  return name || FALLBACK_FONT_NAME;
}

/** Familia CSS da fonte enviada: bf_ + 12 hex aleatorios (nunca o nome do produtor nem do arquivo). */
export function newPopupFontFamilyKey() {
  return `bf_${randomBytes(6).toString("hex")}`;
}

/** Caminho no bucket pelo conteudo: o mesmo arquivo cai no mesmo objeto. */
export function popupFontFilePath(bytes: Uint8Array, type: PopupFontFileType) {
  return `fonts/${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}.${type.extension}`;
}

/** A linha da biblioteca vira a opcao do editor; linha fora do formato = null. */
export function fontRowToOption(db: CommunicationsDb, row: PopupFontRow): PopupFontOption | null {
  const face = fontRowToFace(db, row);

  return face ? { ...face, createdAt: row.created_at, name: row.name, sizeBytes: row.size_bytes } : null;
}

function optionOrGone(db: CommunicationsDb, row: PopupFontRow) {
  const option = fontRowToOption(db, row);

  if (!option) {
    throw new CommunicationError(POPUP_FONT_GONE_MESSAGE, 404);
  }

  return option;
}

async function liveFontByPath(db: CommunicationsDb, filePath: string) {
  const { data, error } = await db.from("communication_fonts").select(POPUP_FONT_COLUMNS).eq("file_path", filePath).is("deleted_at", null).limit(1);
  assertNoDbError(error, "Comunicacao: fonte pelo arquivo");

  return ((data ?? []) as PopupFontRow[])[0] ?? null;
}

export type PersistPopupFontInput = {
  bytes: Uint8Array;
  name: string;
  style: PopupFontStyle;
  userId: string | null;
  weight: number;
};

/**
 * Guarda a fonte enviada: confere tamanho (413) e formato pelos bytes (422), reaproveita a linha quando o
 * mesmo arquivo ja esta na biblioteca, recusa a 41a fonte (409), envia ao bucket com o tipo do formato e cria
 * a linha com uma familia bf_ nova. `created` diz se a linha e nova (a auditoria so registra as novas).
 */
export async function persistPopupFont(db: CommunicationsDb, input: PersistPopupFontInput): Promise<{ created: boolean; font: PopupFontOption }> {
  if (input.bytes.length > POPUP_FONT_LIMITS.maxBytes) {
    throw new CommunicationError(POPUP_FONT_SIZE_MESSAGE, 413);
  }

  const type = sniffPopupFont(input.bytes);

  if (!type) {
    throw new CommunicationError(POPUP_FONT_FORMAT_MESSAGE, 422);
  }

  const filePath = popupFontFilePath(input.bytes, type);

  if (!POPUP_FONT_PATH_PATTERN.test(filePath)) {
    throw new Error("Comunicacao: caminho da fonte fora do formato.");
  }

  const existing = await liveFontByPath(db, filePath);

  if (existing) {
    return { created: false, font: optionOrGone(db, existing) };
  }

  // O arquivo de uma fonte excluida pode estar marcado sem uso: antes de enviar, a marca sai (o prazo da limpeza
  // recomeca) e uma remocao em andamento do mesmo caminho termina primeiro; so depois "ja existe" vale como enviado e
  // a linha nova pode apontar para o arquivo (docs/22 §4.6).
  await forgetOrphanMark(db, { bucket: POPUP_FONTS_BUCKET, path: filePath });

  const { count, error: countError } = await db.from("communication_fonts").select("id", { count: "exact", head: true }).is("deleted_at", null);
  assertNoDbError(countError, "Comunicacao: tamanho da biblioteca de fontes");

  if ((count ?? 0) >= POPUP_FONT_LIMITS.maxLibrary) {
    throw new CommunicationError(POPUP_FONT_LIBRARY_FULL_MESSAGE, 409);
  }

  const upload = await db.storage
    .from(POPUP_FONTS_BUCKET)
    .upload(filePath, input.bytes, { cacheControl: "31536000", contentType: type.mimeType, upsert: false });

  if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) {
    throw new Error(`Comunicacao: nao foi possivel enviar a fonte ao Storage: ${upload.error.message}`);
  }

  const { data, error } = await db
    .from("communication_fonts")
    .insert({
      created_by: input.userId,
      family_key: newPopupFontFamilyKey(),
      file_path: filePath,
      format: type.format,
      name: input.name,
      size_bytes: input.bytes.length,
      style: input.style,
      weight: input.weight
    })
    .select(POPUP_FONT_COLUMNS)
    .single();

  if (error) {
    // Dois envios do mesmo arquivo ao mesmo tempo: o indice unico do caminho segura; vale a linha que entrou.
    if (error.code === "23505") {
      const winner = await liveFontByPath(db, filePath);

      if (winner) {
        return { created: false, font: optionOrGone(db, winner) };
      }
    }

    assertNoDbError(error, "Comunicacao: gravando a fonte");
  }

  return { created: true, font: optionOrGone(db, data as PopupFontRow) };
}

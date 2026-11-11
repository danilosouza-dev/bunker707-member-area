// Um ZIP escrito aos pedacos, sem biblioteca (docs/32 §4, "Exportar dados"): cada arquivo entra comprimido (deflate),
// pedaco a pedaco, e o ZIP sai na mesma hora para quem baixa. A memoria fica do tamanho de um pedaco, qualquer que seja
// o tamanho da escola.
//
// - Cada pedaco e comprimido sozinho com Z_SYNC_FLUSH (o mesmo truque do pigz): o fim de cada pedaco cai numa fronteira
//   de byte, e os pedacos em sequencia formam um deflate valido; o arquivo termina com o bloco final vazio. A compressao
//   perde pouco por nao levar o dicionario de um pedaco para o outro (cada pedaco e uma pagina inteira de CSV).
// - O tamanho e o CRC-32 de cada arquivo so sao conhecidos no fim: o cabecalho local leva zeros e o bit 3 (data
//   descriptor), e o diretorio central, no fim do ZIP, leva os valores certos. E o que os ZIPs em fluxo fazem; o
//   Windows, o macOS, o unzip e as planilhas abrem.
// - Nomes em UTF-8 (bit 11). Datas na hora de Brasilia (o ZIP guarda a hora local, sem fuso).
// - Sem ZIP64: arquivo ou ZIP acima de 4 GB para com erro (o download falha, nunca sai um ZIP corrompido). Uma escola
//   que chegue perto disso precisa de outra forma de exportar.
//
// Puro (so node:zlib e node:buffer), sem "server-only" e sem "@/": os testes carregam direto.

import { Buffer } from "node:buffer";
import { constants, crc32, deflateRawSync } from "node:zlib";

/** Um arquivo do ZIP: o nome e os pedacos do conteudo, gerados so quando o ZIP chega nele. */
export type ZipEntry = { name: string; content: () => AsyncIterable<string | Uint8Array> | Iterable<string | Uint8Array> };

export type ZipEntryResult = { name: string; compressedBytes: number; uncompressedBytes: number };

const UINT32_MAX = 0xffffffff;
const VERSION = 20;
/** Bit 3 (tamanhos e CRC no data descriptor) e bit 11 (nome em UTF-8). */
const FLAGS = 0x0008 | 0x0800;
const DEFLATE = 8;
/** "Feito por" Unix, versao 2.0, para as permissoes 0644 valerem ao extrair. */
const MADE_BY = (3 << 8) | VERSION;
const UNIX_FILE_0644 = (0o100644 << 16) >>> 0;

const timeParts = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: "America/Sao_Paulo",
  year: "numeric"
});

/** A data e a hora no formato do MS-DOS que o ZIP usa (hora de Brasilia). */
export function dosDateTime(date: Date): { date: number; time: number } {
  const parts = Object.fromEntries(timeParts.formatToParts(date).map((part) => [part.type, Number(part.value)]));
  const year = Math.min(Math.max(parts.year, 1980), 2107);

  return {
    date: ((year - 1980) << 9) | (parts.month << 5) | parts.day,
    time: (parts.hour << 11) | (parts.minute << 5) | Math.floor(parts.second / 2)
  };
}

function assertFits(value: number, what: string) {
  if (value > UINT32_MAX) {
    throw new Error(`A exportação passou de 4 GB (${what}); o ZIP sem ZIP64 não comporta.`);
  }
}

function localHeader(name: Buffer, stamp: { date: number; time: number }) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(FLAGS, 6);
  header.writeUInt16LE(DEFLATE, 8);
  header.writeUInt16LE(stamp.time, 10);
  header.writeUInt16LE(stamp.date, 12);
  // CRC-32 e tamanhos ficam no data descriptor (bit 3).
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name]);
}

function dataDescriptor(crc: number, compressed: number, uncompressed: number) {
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(crc >>> 0, 4);
  descriptor.writeUInt32LE(compressed, 8);
  descriptor.writeUInt32LE(uncompressed, 12);
  return descriptor;
}

type CentralRecord = { compressed: number; crc: number; name: Buffer; offset: number; stamp: { date: number; time: number }; uncompressed: number };

function centralHeader(record: CentralRecord) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(MADE_BY, 4);
  header.writeUInt16LE(VERSION, 6);
  header.writeUInt16LE(FLAGS, 8);
  header.writeUInt16LE(DEFLATE, 10);
  header.writeUInt16LE(record.stamp.time, 12);
  header.writeUInt16LE(record.stamp.date, 14);
  header.writeUInt32LE(record.crc >>> 0, 16);
  header.writeUInt32LE(record.compressed, 20);
  header.writeUInt32LE(record.uncompressed, 24);
  header.writeUInt16LE(record.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(UNIX_FILE_0644, 38);
  header.writeUInt32LE(record.offset, 42);
  return Buffer.concat([header, record.name]);
}

function endOfCentralDirectory(entries: number, size: number, offset: number) {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries, 8);
  end.writeUInt16LE(entries, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return end;
}

/** O bloco final vazio do deflate (um bloco fixo so com o fim): fecha a sequencia de pedacos com Z_SYNC_FLUSH. */
const FINAL_BLOCK = deflateRawSync(Buffer.alloc(0));

/**
 * O ZIP, pedaco a pedaco: os bytes de cada arquivo saem assim que a pagina dele e comprimida. Quem consome puxa o
 * proximo pedaco quando ja mandou o anterior (o ReadableStream da rota): a leitura do banco segue o ritmo do download.
 * `onEntry` recebe os tamanhos de cada arquivo quando ele termina (a auditoria e os testes).
 */
export async function* zipStream(
  entries: Iterable<ZipEntry> | AsyncIterable<ZipEntry>,
  options: { modifiedAt: Date; onEntry?: (result: ZipEntryResult) => void; level?: number }
): AsyncGenerator<Uint8Array, void, undefined> {
  const stamp = dosDateTime(options.modifiedAt);
  const level = options.level ?? 6;
  const records: CentralRecord[] = [];
  const names = new Set<string>();
  let offset = 0;

  for await (const entry of entries) {
    if (records.length >= 0xffff) {
      throw new Error("A exportação passou de 65.535 arquivos; o ZIP sem ZIP64 não comporta.");
    }

    if (names.has(entry.name) || !/^[^/\\][^\\]*$/.test(entry.name) || entry.name.split("/").includes("..")) {
      throw new Error(`Nome de arquivo inválido ou repetido no ZIP: ${entry.name}`);
    }

    names.add(entry.name);
    const name = Buffer.from(entry.name, "utf8");
    const header = localHeader(name, stamp);
    const entryOffset = offset;
    let crc = 0;
    let compressed = 0;
    let uncompressed = 0;

    offset += header.length;
    yield header;

    for await (const piece of entry.content()) {
      const bytes = typeof piece === "string" ? Buffer.from(piece, "utf8") : Buffer.from(piece.buffer, piece.byteOffset, piece.byteLength);

      if (bytes.length === 0) {
        continue;
      }

      crc = crc32(bytes, crc);
      uncompressed += bytes.length;
      const deflated = deflateRawSync(bytes, { finishFlush: constants.Z_SYNC_FLUSH, level });
      compressed += deflated.length;
      assertFits(uncompressed, entry.name);
      assertFits(compressed, entry.name);
      offset += deflated.length;
      yield deflated;
    }

    compressed += FINAL_BLOCK.length;
    offset += FINAL_BLOCK.length;
    yield FINAL_BLOCK;

    const descriptor = dataDescriptor(crc, compressed, uncompressed);
    offset += descriptor.length;
    assertFits(offset, entry.name);
    yield descriptor;

    records.push({ compressed, crc, name, offset: entryOffset, stamp, uncompressed });
    options.onEntry?.({ compressedBytes: compressed, name: entry.name, uncompressedBytes: uncompressed });
  }

  const centralOffset = offset;
  let centralSize = 0;

  for (const record of records) {
    const header = centralHeader(record);
    centralSize += header.length;
    yield header;
  }

  assertFits(centralOffset + centralSize, "diretório central");
  yield endOfCentralDirectory(records.length, centralSize, centralOffset);
}

/** O ZIP inteiro na memoria (so os testes e arquivos pequenos). */
export async function zipToBuffer(entries: Iterable<ZipEntry> | AsyncIterable<ZipEntry>, options: { modifiedAt: Date }): Promise<Buffer> {
  const parts: Uint8Array[] = [];

  for await (const part of zipStream(entries, options)) {
    parts.push(part);
  }

  return Buffer.concat(parts);
}

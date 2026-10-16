import { deflateSync } from "node:zlib";

// Gera um PNG quadrado em memoria, sem biblioteca de imagem: serve para os testes da foto de perfil
// (o navegador recorta e reencoda; o servidor le o cabecalho). Cores em degrade para o arquivo nao ser
// trivial e parecer uma foto de verdade no recorte.

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;

  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }

  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));

  return Buffer.concat([length, typeBytes, data, crc]);
}

/** PNG RGB de `size` x `size` px com um degrade; devolve os bytes. */
export function pngQuadrado(size = 320) {
  const rows = [];

  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0; // filtro "nenhum"

    for (let x = 0; x < size; x += 1) {
      const offset = 1 + x * 3;
      row[offset] = Math.round((x / size) * 255);
      row[offset + 1] = Math.round((y / size) * 255);
      row[offset + 2] = 180;
    }

    rows.push(row);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits por canal
  header[9] = 2; // RGB
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/** O mesmo PNG como data URL (formato que a rota da foto recebe). */
export function pngQuadradoDataUrl(size = 320) {
  return `data:image/png;base64,${pngQuadrado(size).toString("base64")}`;
}

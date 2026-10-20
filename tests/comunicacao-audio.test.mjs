import assert from "node:assert/strict";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";

// Audio dos avisos (docs/22 §4.5): o servidor nao confia no tipo que o navegador informa. Le os primeiros
// bytes, aceita MP3, M4A, OGG, WEBM e WAV (e AAC puro), recusa o resto e o que passa de 10 MB, e guarda
// no bucket publico pelo hash do conteudo. Storage falso; a rota com o Storage local de verdade esta em
// tests/integration/avisos-e-notificacoes.test.mjs.

const media = await import("../src/server/communications/media.ts");

const bytes = (...parts) => Uint8Array.from(parts.flatMap((part) => (typeof part === "string" ? [...Buffer.from(part, "latin1")] : part)));
const pad = (head) => {
  const full = new Uint8Array(64);
  full.set(head, 0);
  return full;
};

const AMOSTRAS = {
  aac: pad(bytes([0xff, 0xf1, 0x50, 0x80])),
  m4a: pad(bytes([0x00, 0x00, 0x00, 0x20], "ftypM4A ")),
  mp3: pad(bytes("ID3", [0x04, 0x00])),
  mp3SemId3: pad(bytes([0xff, 0xfb, 0x90, 0x64])),
  ogg: pad(bytes("OggS", [0x00, 0x02])),
  wav: pad(bytes("RIFF", [0x24, 0x00, 0x00, 0x00], "WAVEfmt ")),
  webm: pad(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f]))
};

function fakeStorage() {
  const uploads = [];

  actionStubs.db = {
    storage: {
      from(bucket) {
        return {
          getPublicUrl(path) {
            return { data: { publicUrl: `https://projeto.supabase.co/storage/v1/object/public/${bucket}/${path}` } };
          },
          async upload(path, body, options) {
            const duplicate = uploads.some((upload) => upload.bucket === bucket && upload.path === path);
            uploads.push({ bucket, options, path, size: body.length });
            return { error: duplicate ? { message: "The resource already exists" } : null };
          }
        };
      }
    }
  };

  return uploads;
}

test("reconhece o audio pelos primeiros bytes, nao pelo nome nem pelo tipo informado", () => {
  const formato = (sample) => media.sniffAudioFormat(sample)?.mimeType ?? null;

  assert.equal(formato(AMOSTRAS.mp3), "audio/mpeg");
  assert.equal(formato(AMOSTRAS.mp3SemId3), "audio/mpeg");
  assert.equal(formato(AMOSTRAS.m4a), "audio/mp4");
  assert.equal(formato(AMOSTRAS.ogg), "audio/ogg");
  assert.equal(formato(AMOSTRAS.webm), "audio/webm");
  assert.equal(formato(AMOSTRAS.wav), "audio/wav");
  assert.equal(formato(AMOSTRAS.aac), "audio/aac");

  assert.equal(formato(pad(bytes([0x89], "PNG\r\n"))), null, "imagem");
  assert.equal(formato(pad(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))), null, "RIFF que nao e WAVE");
  assert.equal(formato(pad(bytes("isto e texto"))), null);
  assert.equal(formato(bytes("ID3")), null, "arquivo curto demais");
});

test("guarda no bucket communication-audio pelo hash, com o tipo real e cache longo; repetir o mesmo arquivo nao e erro", async () => {
  const uploads = fakeStorage();
  const enviado = await media.persistNoticeAudio({ bytes: AMOSTRAS.webm, mimeType: "audio/webm;codecs=opus" });

  assert.equal(enviado.mimeType, "audio/webm");
  assert.match(enviado.url, /^https:\/\/projeto\.supabase\.co\/storage\/v1\/object\/public\/communication-audio\/campaigns\/[a-f0-9]{24}\.webm$/);
  assert.deepEqual(uploads[0].options, { cacheControl: "31536000", contentType: "audio/webm", upsert: false });

  const repetido = await media.persistNoticeAudio({ bytes: AMOSTRAS.webm, mimeType: null });
  assert.equal(repetido.url, enviado.url);

  const gravadoNoSafari = await media.persistNoticeAudio({ bytes: AMOSTRAS.m4a, mimeType: "audio/mp4" });
  assert.match(gravadoNoSafari.url, /\.m4a$/);
  assert.equal((await media.persistNoticeAudio({ bytes: AMOSTRAS.mp3, mimeType: "application/octet-stream" })).mimeType, "audio/mpeg", "tipo generico vale o conteudo");
});

test("recusa o que nao e audio, o tipo informado diferente do conteudo e arquivo acima de 10 MB, sem enviar nada", async () => {
  const uploads = fakeStorage();
  const recusa = (input) => media.persistNoticeAudio(input).then(
    () => null,
    (error) => ({ message: error.message, status: error.status })
  );

  assert.deepEqual(await recusa({ bytes: pad(bytes("nao e audio")), mimeType: "audio/mpeg" }), { message: "Use um arquivo de áudio MP3, M4A, OGG, WEBM ou WAV.", status: 422 });
  assert.deepEqual(await recusa({ bytes: AMOSTRAS.wav, mimeType: "audio/mpeg" }), { message: "Use um arquivo de áudio MP3, M4A, OGG, WEBM ou WAV.", status: 422 });
  assert.deepEqual(await recusa({ bytes: AMOSTRAS.wav, mimeType: "image/png" }), { message: "Use um arquivo de áudio MP3, M4A, OGG, WEBM ou WAV.", status: 422 });

  const grande = new Uint8Array(10 * 1024 * 1024 + 1);
  grande.set(AMOSTRAS.mp3, 0);
  assert.deepEqual(await recusa({ bytes: grande, mimeType: "audio/mpeg" }), { message: "O áudio deve ter no máximo 10 MB.", status: 413 });
  assert.equal(uploads.length, 0);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Design do pop-up (docs/26), envio de video e de fontes (pacote U): o servidor nunca confia no nome nem no tipo
// que o navegador informa. Confere os primeiros bytes (e a estrutura minima do cabecalho) de cada arquivo, da
// caminhos aleatorios ou pelo hash, e uma familia CSS bf_ que nunca e o nome do produtor. Os arquivos de
// tests/fixtures/popup-design/ sao de verdade (ffmpeg e um subconjunto da Inter, licenca OFL em LICENCA.txt).
// O envio contra o Storage local de verdade esta em tests/integration/pop-ups-design-envios.test.mjs.

const media = await import("../src/server/communications/popup-media.ts");
const model = await import("../src/server/communications/popup-design-model.ts");

const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/popup-design/${name}`, import.meta.url)));
const bytes = (...parts) => Uint8Array.from(parts.flatMap((part) => (typeof part === "string" ? [...Buffer.from(part, "latin1")] : part)));
const pad = (head, length = 64) => {
  const full = new Uint8Array(length);
  full.set(head, 0);
  return full;
};
const u32 = (value) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const u16 = (value) => [(value >>> 8) & 0xff, value & 0xff];

/** Cabecalho ftyp com a marca principal pedida. */
const ftyp = (brand) => pad(bytes(u32(32), "ftyp", brand, u32(0x200), "isomiso2avc1mp41"));
/** Cabecalho EBML minimo com o DocType pedido (como o ffmpeg escreve). */
const ebml = (docType) => {
  const body = bytes([0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0x82, 0x80 | docType.length], docType, [0x42, 0x87, 0x81, 0x02]);
  return pad(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x80 | body.length], [...body]));
};
/** sfnt (TTF/OTF) com `tables` entradas no diretorio. */
const sfnt = (version, tables) => pad(bytes(version, u16(tables), u16(0), u16(0), u16(0)), 12 + 16 * tables);
/** WOFF/WOFF2 com o campo de tamanho igual ao arquivo (ou outro, para o teste de recusa). */
const woff = (signature, flavor, { length, total = 96 } = {}) => pad(bytes(signature, flavor, u32(length ?? total), u16(3)), total);

test("video: aceita MP4 (ftyp) e WEBM (EBML com DocType webm) pelos primeiros 64 bytes; recusa o resto", () => {
  const tipo = (sample) => media.sniffPopupVideo(sample.subarray(0, media.POPUP_VIDEO_SNIFF_BYTES));

  assert.equal(media.POPUP_VIDEO_SNIFF_BYTES, 64);
  assert.equal(tipo(fixture("video-de-teste.mp4")), "video/mp4", "mp4 H.264 de verdade (ffmpeg)");
  assert.equal(tipo(fixture("video-de-teste.webm")), "video/webm", "webm VP8 de verdade (ffmpeg)");
  assert.equal(tipo(ftyp("mp42")), "video/mp4");
  assert.equal(tipo(ebml("webm")), "video/webm");

  assert.equal(tipo(ftyp("qt  ")), null, ".mov (QuickTime)");
  assert.equal(tipo(ftyp("M4A ")), null, "audio m4a");
  assert.equal(tipo(ftyp("M4B ")), null, "audiolivro");
  assert.equal(tipo(ftyp("heic")), null, "foto HEIC no mesmo envelope");
  assert.equal(tipo(ftyp("avif")), null, "imagem AVIF");
  assert.equal(tipo(pad(bytes(u32(4), "ftypmp42"))), null, "caixa ftyp com tamanho impossivel");
  assert.equal(tipo(ebml("matroska")), null, ".mkv (matroska) nao e webm");
  assert.equal(tipo(pad(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01]))), null, "EBML sem DocType");
  assert.equal(tipo(pad(bytes("<!DOCTYPE html><html><body>video</body></html>"))), null, "HTML renomeado para .mp4");
  assert.equal(tipo(pad(bytes("MZ", [0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]))), null, "executavel renomeado");
  assert.equal(tipo(fixture("fonte-de-teste.woff2")), null, "fonte nao e video");
  assert.equal(tipo(bytes([0, 0, 0, 0x20], "ftypmp4")), null, "curto demais");
});

test("video: o caminho e sempre videos/<uuid>.<mp4|webm> e a extensao diz o tipo esperado", () => {
  const mp4 = media.newPopupVideoPath("video/mp4");
  const webm = media.newPopupVideoPath("video/webm");

  assert.match(mp4, model.POPUP_VIDEO_PATH_PATTERN);
  assert.match(webm, model.POPUP_VIDEO_PATH_PATTERN);
  assert.ok(mp4.endsWith(".mp4") && webm.endsWith(".webm"));
  assert.notEqual(media.newPopupVideoPath("video/mp4"), mp4, "aleatorio a cada envio");
  assert.equal(media.popupVideoMimeTypeOfPath(mp4), "video/mp4");
  assert.equal(media.popupVideoMimeTypeOfPath(webm), "video/webm");
  assert.equal(media.popupVideoMimeTypeOfPath("videos/../fonts/x.mp4"), null);
  assert.equal(media.popupVideoMimeTypeOfPath("videos/nome-do-produtor.mp4"), null);
  assert.equal(media.popupVideoMimeTypeOfPath(mp4.replace(".mp4", ".mov")), null);
});

test("fonte: WOFF2, WOFF, TTF e OTF pelos bytes; colecao, cabecalho incoerente e arquivo renomeado sao recusados", () => {
  const formato = (sample) => media.sniffPopupFont(sample);

  assert.deepEqual(formato(fixture("fonte-de-teste.woff2")), { extension: "woff2", format: "woff2", mimeType: "font/woff2" }, "woff2 de verdade");
  assert.deepEqual(formato(fixture("fonte-de-teste.ttf")), { extension: "ttf", format: "truetype", mimeType: "font/ttf" }, "ttf de verdade");
  assert.equal(formato(woff("wOFF", "OTTO"))?.format, "woff");
  assert.equal(formato(woff("wOF2", [0, 1, 0, 0]))?.format, "woff2");
  assert.deepEqual(formato(sfnt("OTTO", 10)), { extension: "otf", format: "opentype", mimeType: "font/otf" });
  assert.equal(formato(sfnt("true", 9))?.format, "truetype", "TrueType da Apple ('true')");
  assert.equal(formato(sfnt([0, 1, 0, 0], 12))?.format, "truetype");

  assert.equal(formato(sfnt("ttcf", 4)), null, "colecao (.ttc)");
  assert.equal(formato(woff("wOF2", "ttcf")), null, "woff2 de uma colecao");
  assert.equal(formato(woff("wOF2", "OTTO", { length: 4_000 })), null, "tamanho do cabecalho diferente do arquivo");
  assert.equal(formato(woff("wOFF", "abcd")), null, "conteudo que nao e TrueType/OpenType");
  assert.equal(formato(sfnt("OTTO", 0)), null, "sem tabelas");
  assert.equal(formato(sfnt("OTTO", 10).subarray(0, 40)), null, "diretorio de tabelas cortado");
  assert.equal(formato(pad(bytes("true and false are words, not a font"))), null, "texto que comeca com 'true'");
  assert.equal(formato(pad(bytes("<!doctype html><script>alert(1)</script>"))), null, "HTML renomeado para .woff2");
  assert.equal(formato(pad(bytes("MZ", [0x90, 0x00, 0x03, 0x00]))), null, "executavel renomeado");
  assert.equal(formato(fixture("video-de-teste.mp4")), null, "video nao e fonte");
  assert.equal(formato(bytes("wOF2")), null, "curto demais");
});

test("fonte: nome padrao vem do arquivo (sem pasta, sem extensao, limpo, ate 60); familia bf_ aleatoria; caminho pelo hash", () => {
  assert.equal(media.defaultPopupFontName("Minha_Fonte-Bold.woff2"), "Minha Fonte-Bold");
  assert.equal(media.defaultPopupFontName("C:\\Fontes\\Display Condensada.TTF"), "Display Condensada");
  assert.equal(media.defaultPopupFontName("/tmp/fontes/Serifada.otf"), "Serifada");
  assert.equal(media.defaultPopupFontName("  Nome\u0000com\u202econtrole\n.woff  "), "Nome com controle");
  assert.equal(media.defaultPopupFontName(".woff2"), "Fonte enviada", "sem nome aproveitavel");
  assert.equal(media.defaultPopupFontName(`${"A".repeat(80)}.woff2`), "A".repeat(60));
  assert.equal(media.cleanPopupFontName("  Inter \t Display  "), "Inter Display");

  const familia = media.newPopupFontFamilyKey();
  assert.match(familia, model.POPUP_FONT_FAMILY_PATTERN);
  assert.notEqual(media.newPopupFontFamilyKey(), familia);

  const woff2 = fixture("fonte-de-teste.woff2");
  const tipo = media.sniffPopupFont(woff2);
  const caminho = media.popupFontFilePath(woff2, tipo);
  assert.match(caminho, model.POPUP_FONT_PATH_PATTERN);
  assert.ok(caminho.endsWith(".woff2"));
  assert.equal(media.popupFontFilePath(woff2, tipo), caminho, "o mesmo arquivo cai no mesmo objeto");
  assert.notEqual(media.popupFontFilePath(fixture("fonte-de-teste.ttf"), media.sniffPopupFont(fixture("fonte-de-teste.ttf"))), caminho);
});

test("fonte: acima de 2 MB e 413 e formato errado e 422 antes de tocar no Storage ou no banco", async () => {
  const toques = [];
  const db = new Proxy({}, { get: (_target, key) => (toques.push(String(key)), () => { throw new Error("nao devia tocar no banco"); }) });
  const recusa = (input) =>
    media.persistPopupFont(db, { name: "Teste", style: "normal", userId: null, weight: 400, ...input }).then(
      () => assert.fail("devia recusar"),
      (error) => ({ message: error.message, status: error.status })
    );

  assert.deepEqual(await recusa({ bytes: new Uint8Array(model.POPUP_FONT_LIMITS.maxBytes + 1) }), { message: "A fonte deve ter no máximo 2 MB.", status: 413 });
  assert.deepEqual(await recusa({ bytes: pad(bytes("<!doctype html>")) }), { message: "Use uma fonte WOFF2, WOFF, TTF ou OTF.", status: 422 });
  assert.deepEqual(toques, []);
});

/** Storage falso do bucket de video + fetch falso do endereco publico (registra os pedidos). */
function videoStorage({ contentType, head, size }) {
  const removed = [];
  const requests = [];
  const db = {
    storage: {
      from(bucket) {
        assert.equal(bucket, model.POPUP_VIDEO_BUCKET);
        return {
          getPublicUrl: (path) => ({ data: { publicUrl: `https://projeto.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
          info: async () => (size === null ? { data: null, error: { message: "Object not found", status: 400, statusCode: "404" } } : { data: { contentType, size }, error: null }),
          remove: async (paths) => (removed.push(...paths), { data: [], error: null })
        };
      }
    }
  };
  const originalFetch = globalThis.fetch;
  let pulled = 0;

  globalThis.fetch = async (url, init) => {
    requests.push({ range: new Headers(init?.headers).get("range"), url: String(url) });
    // Servidor que ignora o Range: manda o arquivo inteiro em pedacos de 16 bytes.
    const full = pad(head, 4_096);
    let offset = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (offset >= full.length) {
          controller.close();
          return;
        }

        controller.enqueue(full.subarray(offset, offset + 16));
        offset += 16;
        pulled += 16;
      }
    });

    return new Response(body, { status: 200 });
  };

  return { db, pulled: () => pulled, removed, requests, restore: () => (globalThis.fetch = originalFetch) };
}

test("video enviado: pede so os primeiros 64 bytes (Range) e para de ler mesmo se o servidor mandar tudo", async () => {
  const path = media.newPopupVideoPath("video/mp4");
  const fake = videoStorage({ contentType: "video/mp4", head: fixture("video-de-teste.mp4").subarray(0, 64), size: 2_862 });

  try {
    const result = await media.inspectPopupVideo(fake.db, path);

    assert.deepEqual(result, {
      sizeBytes: 2_862,
      video: { mimeType: "video/mp4", path, url: `https://projeto.supabase.co/storage/v1/object/public/${model.POPUP_VIDEO_BUCKET}/${path}` }
    });
    assert.deepEqual(fake.requests.map((request) => request.range), ["bytes=0-63"]);
    assert.ok(fake.pulled() <= 128, `leu ${fake.pulled()} bytes`);
    assert.deepEqual(fake.removed, []);
  } finally {
    fake.restore();
  }
});

test("video enviado: bytes de outro tipo, tipo gravado diferente ou tamanho acima de 15 MB apagam o objeto; inexistente e 404", async () => {
  const casos = [
    { esperado: { message: "Use um vídeo MP4 (H.264) ou WEBM.", status: 422 }, head: bytes("<html>"), nome: "HTML com extensao .mp4", size: 900 },
    { esperado: { message: "Use um vídeo MP4 (H.264) ou WEBM.", status: 422 }, head: fixture("video-de-teste.webm").subarray(0, 64), nome: "webm com extensao .mp4", size: 900 },
    { contentType: "video/webm", esperado: { message: "Use um vídeo MP4 (H.264) ou WEBM.", status: 422 }, head: fixture("video-de-teste.mp4").subarray(0, 64), nome: "tipo gravado pelo navegador diferente", size: 900 },
    { esperado: { message: "O vídeo deve ter no máximo 15 MB.", status: 413 }, head: fixture("video-de-teste.mp4").subarray(0, 64), nome: "acima de 15 MB", size: model.POPUP_VIDEO_LIMITS.maxBytes + 1 }
  ];

  for (const caso of casos) {
    const path = media.newPopupVideoPath("video/mp4");
    const fake = videoStorage({ contentType: caso.contentType ?? "video/mp4", head: caso.head, size: caso.size });

    try {
      const erro = await media.inspectPopupVideo(fake.db, path).then(
        () => assert.fail(`${caso.nome}: devia recusar`),
        (error) => ({ message: error.message, status: error.status })
      );
      assert.deepEqual(erro, caso.esperado, caso.nome);
      assert.deepEqual(fake.removed, [path], `${caso.nome}: o objeto e apagado`);
    } finally {
      fake.restore();
    }
  }

  const faltando = videoStorage({ contentType: "video/mp4", head: bytes(), size: null });

  try {
    const erro = await media.inspectPopupVideo(faltando.db, media.newPopupVideoPath("video/webm")).catch((error) => ({ message: error.message, status: error.status }));
    assert.deepEqual(erro, { message: "Envie o vídeo de novo.", status: 404 });
    assert.deepEqual(faltando.requests, [], "nem pede os bytes");
  } finally {
    faltando.restore();
  }
});

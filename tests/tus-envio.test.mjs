import assert from "node:assert/strict";
import test from "node:test";
import { TUS_MAX_FAILURES, tusMetadata, tusUpload } from "../src/lib/tus-upload.ts";

// O envio com retomada da gravacao no computador (docs/30 D142), contra um servidor TUS de mentira que guarda os bytes: o
// arquivo chega inteiro e na ordem; a queda no meio continua do ponto que o servidor diz, inclusive quando o pedaco chegou
// e so a resposta se perdeu; a retomada com o endereco guardado; o envio vencido; a recusa e a desistencia.

const ENDPOINT = "https://video.test/tusupload";
const HEADERS = { AuthorizationSignature: "abc", VideoId: "v1" };
const texto = "0123456789abcdefghijklmnopqrstuvwxyz";

function servidor({ antes = () => null, inicial = null, location = "/tusupload/u1" } = {}) {
  const s = { bytes: inicial ?? "", log: [], size: null };
  s.fetch = async (url, init) => {
    s.log.push(`${init.method} ${new URL(url).pathname}`);
    for (const [key, value] of Object.entries(HEADERS)) assert.equal(init.headers[key], value, "a autorizacao vai em todo pedido");
    assert.equal(init.headers["Tus-Resumable"], "1.0.0");
    const trama = antes(s, init);
    if (trama === "cai") throw new TypeError("rede");
    if (typeof trama === "number") return new Response(null, { status: trama });
    if (init.method === "POST") {
      s.size = Number(init.headers["Upload-Length"]);
      s.metadata = init.headers["Upload-Metadata"];
      return new Response(null, { headers: { location }, status: 201 });
    }
    if (init.method === "PATCH") {
      if (Number(init.headers["Upload-Offset"]) !== s.bytes.length) return new Response(null, { status: 409 });
      s.bytes += await init.body.text();
      if (trama === "perde-resposta") throw new TypeError("rede");
    }
    return new Response(null, { headers: { "upload-offset": String(s.bytes.length) }, status: init.method === "HEAD" ? 200 : 204 });
  };
  return s;
}

const enviar = (s, extra = {}) => tusUpload({ blob: new Blob([texto]), chunkBytes: 10, endpoint: ENDPOINT, fetchImpl: s.fetch, headers: HEADERS, location: null, metadata: { filetype: "video/mp4", title: "Aula ç" }, wait: async () => {}, ...extra });

test("envia inteiro, na ordem, em pedacos, com os metadados e o endereco guardado", async () => {
  const s = servidor();
  const progresso = [];
  const lugares = [];
  assert.equal(await enviar(s, { onLocation: (l) => lugares.push(l), onProgress: (n) => progresso.push(n) }), "done");
  assert.equal(s.bytes, texto);
  assert.deepEqual(s.log, ["POST /tusupload", ...Array(4).fill("PATCH /tusupload/u1")]);
  assert.deepEqual(lugares, ["https://video.test/tusupload/u1"]);
  assert.deepEqual(progresso, [10, 20, 30, 36]);
  assert.equal(s.metadata, tusMetadata({ filetype: "video/mp4", title: "Aula ç" }));
  assert.equal(Buffer.from(s.metadata.split("title ")[1], "base64").toString("utf8"), "Aula ç");
});

test("a rede cai e o servidor falha no meio: continua do que o servidor recebeu, sem repetir nem pular byte", async () => {
  let patches = 0;
  const s = servidor({ antes: (_, init) => (init.method === "PATCH" ? [null, "cai", "perde-resposta", 503, null, null][patches++] ?? null : null) });
  assert.equal(await enviar(s), "done");
  assert.equal(s.bytes, texto);
  assert.ok(s.log.filter((l) => l.startsWith("HEAD")).length >= 3);
});

test("a retomada com o endereco guardado comeca do que ja chegou; ja inteiro, nao manda nada", async () => {
  const s = servidor({ inicial: texto.slice(0, 17) });
  assert.equal(await enviar(s, { location: "https://video.test/tusupload/u1" }), "done");
  assert.equal(s.bytes, texto);
  assert.deepEqual(s.log.map((l) => l.split(" ")[0]), ["HEAD", "PATCH", "PATCH"]);
  const pronto = servidor({ inicial: texto });
  assert.equal(await enviar(pronto, { location: "https://video.test/tusupload/u1" }), "done");
  assert.deepEqual(pronto.log, ["HEAD /tusupload/u1"]);
});

test("o envio que venceu na Bunny (404 ou 410) pede outro: expired", async () => {
  for (const status of [404, 410]) {
    assert.equal(await enviar(servidor({ antes: () => status }), { location: "https://video.test/tusupload/u1" }), "expired");
    const s = servidor({ antes: (_, init) => (init.method === "PATCH" ? status : null) });
    assert.equal(await enviar(s), "expired");
  }
});

test("mais bytes no servidor do que o arquivo tem: esse envio nao serve, pede outro", async () => {
  assert.equal(await enviar(servidor({ inicial: `${texto}sobra` }), { location: "https://video.test/tusupload/u1" }), "expired");
});

test("recusado para na hora; sem rede desiste depois de muitas tentativas; outro servidor no endereco nunca recebe o arquivo", async () => {
  const negado = servidor({ antes: () => 401 });
  await assert.rejects(enviar(negado), (error) => error.status === 401);
  assert.equal(negado.log.length, 1);
  const fora = servidor({ antes: () => "cai" });
  await assert.rejects(enviar(fora));
  assert.equal(fora.log.length, TUS_MAX_FAILURES);
  const desvio = servidor({ location: "https://outro.test/u1" });
  await assert.rejects(enviar(desvio));
  assert.deepEqual(desvio.log, ["POST /tusupload"]);
});

test("cancelado, para", async () => {
  const controle = new AbortController();
  const s = servidor({ antes: (_, init) => { if (init.method === "PATCH") controle.abort(); return null; } });
  await assert.rejects(enviar(s, { signal: controle.signal }), { name: "AbortError" });
});

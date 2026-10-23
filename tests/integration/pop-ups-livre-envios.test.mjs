import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { after, before, beforeEach, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparComunicacao, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Design Livre do pop-up (docs/27 §5.2), os envios contra o banco e o Storage LOCAIS (pacote M): a imagem do Livre
// (WebP com transparencia, conferida pelos bytes, caminho e medidas do servidor, sem endereco); as recusas
// (nao e WebP, lados, tamanho, sem permissao); ao salvar, todo caminho novo e conferido no Storage (imagem que
// nao existe ou de outro lugar recusada, medidas trocadas pelas do servidor, video que nao passou pela
// conferencia recusado e apagado) e o video do Personalizado ja gravado na linha e reaproveitado sem conferir
// de novo e sem apagar.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const freeActions = await import("../../src/server/communications/popup-free-actions.ts");
const designActions = await import("../../src/server/communications/popup-design-actions.ts");
const actions = await import("../../src/server/communications/actions.ts");
const { emptyNoticeDraft } = await import("../../src/server/communications/schemas.ts");
const custom = await import("../../src/server/communications/popup-design-model.ts");
const { POPUP_FREE_MESSAGES } = await import("../../src/server/communications/popup-free-schema.ts");
const { anonKey, url: supabaseUrl } = readLocalSupabaseConfig();
// O navegador do editor: envia o video pelo endereco assinado com a chave publica.
const navegador = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const PRODUTO = ESCOLA_DE_TESTE.cursoBloqueado.id;
const IMAGES = "content-assets";

const fixture = (name, folder = "popup-livre") => readFileSync(new URL(`../fixtures/${folder}/${name}`, import.meta.url));
const TRANSPARENTE = fixture("imagem-transparente.webp");
const LARGA = fixture("imagem-larga.webp");
const PNG = fixture("nao-e-webp.png");
const MP4 = fixture("video-de-teste.mp4", "popup-design");
const HTML = Buffer.from("<!doctype html><html><body><script>alert('oi')</script></body></html>");

const quemTemOProduto = { kind: "rules", root: { items: [{ op: "has", productIds: [PRODUTO], type: "product" }], match: "all" } };
const BOTAO = { href: `/conteudo/${PRODUTO}`, label: "Ver o curso", target: "same_tab" };

/** Objetos criados no Storage pelo teste (apagados no fim). */
const criados = { [IMAGES]: new Set(), [custom.POPUP_VIDEO_BUCKET]: new Set() };

before(() => limparComunicacao(db));
beforeEach(() => limparComunicacao(db));

after(async () => {
  await limparComunicacao(db);

  for (const [bucket, paths] of Object.entries(criados)) {
    if (paths.size > 0) {
      unwrap(await db.storage.from(bucket).remove([...paths]), `Apagando os arquivos de teste de ${bucket}`);
    }
  }
});

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

const dataUrl = (bytes) => `data:image/webp;base64,${Buffer.from(bytes).toString("base64")}`;

/** WebP com bytes diferentes a cada chamada (outro sha256, outro caminho): a transparente com lixo no fim. */
function webpUnico(base = TRANSPARENTE) {
  return Buffer.concat([base, randomBytes(8)]);
}

async function enviarImagem(user, bytes) {
  actAs(user);
  const result = await freeActions.uploadPopupFreeImage({ image: typeof bytes === "string" ? bytes : dataUrl(bytes) });

  if (result.ok) {
    criados[IMAGES].add(result.data.asset.path);
  }

  return result;
}

async function existeNoBucket(bucket, path) {
  const { error } = await db.storage.from(bucket).info(path);
  return !error;
}

/** Pop-up Livre com uma Imagem (asset "foto") e/ou um Vídeo (asset "midia"). */
function popupLivre({ image = null, video = null } = {}) {
  const assets = [...(image ? [{ id: "foto", kind: "image", ...image }] : []), ...(video ? [{ id: "midia", kind: "video", ...video }] : [])];

  return {
    ...emptyNoticeDraft("popup"),
    audience: quemTemOProduto,
    cta: BOTAO,
    design: null,
    freeDesign: {
      assets,
      children: [
        ...(video ? [{ asset: "midia", id: "video", place: { h: 248, mode: "free", w: 440, x: 0, y: 0 }, type: "video" }] : []),
        { id: "titulo", lines: [[{ text: "Aula nova" }]], type: "heading" },
        ...(image ? [{ asset: "foto", id: "imagem", type: "image" }] : []),
        { action: { kind: "cta" }, id: "botao", type: "button" },
        { id: "links", type: "links" }
      ],
      mode: "free",
      version: 1
    },
    title: "Pop-up Livre"
  };
}

async function salvar(draft, id) {
  actAs(produtor);
  return actions.saveNoticeDraft(id ? { draft, id } : { draft });
}

async function gravado(id) {
  return unwrap(await db.from("campaigns").select("popup_design").eq("id", id).single(), "Lendo o aviso").popup_design;
}

/** O caminho do envio direto: endereco assinado -> PUT com a chave publica (sem a conferencia do fim). */
async function enviarVideoSemConferir(bytes) {
  actAs(produtor);
  const ticket = ok(await designActions.startPopupVideoUpload({ mimeType: "video/mp4", sizeBytes: bytes.length }));
  criados[custom.POPUP_VIDEO_BUCKET].add(ticket.path);
  unwrap(await navegador.storage.from(custom.POPUP_VIDEO_BUCKET).uploadToSignedUrl(ticket.path, ticket.token, bytes, { contentType: "video/mp4" }), "Enviando o video pelo endereco assinado");

  return ticket.path;
}

/* ------------------------------------------------------------------------------------------------
 * Envio da imagem
 * ---------------------------------------------------------------------------------------------- */

test("uploadPopupFreeImage aceita WebP com transparência e devolve caminho e medidas do servidor, sem endereço", async () => {
  const bytes = webpUnico();
  const data = ok(await enviarImagem(produtor, bytes));

  assert.deepEqual(Object.keys(data), ["asset"]);
  assert.deepEqual(Object.keys(data.asset).sort(), ["height", "kind", "path", "width"], "sem endereco");
  assert.equal(data.asset.kind, "image");
  assert.deepEqual([data.asset.width, data.asset.height], [64, 48]);
  assert.match(data.asset.path, /^communications\/free\/[a-f0-9]{24}\.webp$/);
  assert.equal(await existeNoBucket(IMAGES, data.asset.path), true);

  const info = unwrap(await db.storage.from(IMAGES).info(data.asset.path), "Lendo o objeto");
  assert.equal(String(info.contentType ?? info.metadata?.mimetype).split(";")[0], "image/webp");

  // O arquivo guardado e o enviado, com a transparencia (VP8X com a marca de alfa).
  const salvo = Buffer.from(await (await fetch(db.storage.from(IMAGES).getPublicUrl(data.asset.path).data.publicUrl)).arrayBuffer());
  assert.deepEqual(salvo, bytes);
  assert.equal(salvo.subarray(12, 16).toString("ascii"), "VP8X");
  assert.equal(salvo[20] & 0x10, 0x10, "a marca de alfa continua");

  const [auditoria] = unwrap(
    await db.from("admin_audit_log").select("actor_id,entity_type,metadata").eq("action", "communication.free_image_uploaded").order("occurred_at", { ascending: false }).limit(1),
    "Lendo a auditoria"
  );
  assert.deepEqual(auditoria, { actor_id: produtor.id, entity_type: "campaign_media", metadata: { height: 48, size_bytes: bytes.length, width: 64 } });

  // O mesmo arquivo de novo cai no mesmo caminho (sha256), sem erro.
  assert.equal(ok(await enviarImagem(produtor, bytes)).asset.path, data.asset.path);
});

test("recusa bytes que não são WebP, lados fora de 16 a 1.600 e acima de 420.000 bytes", async () => {
  const antes = criados[IMAGES].size;
  const comoWebp = await enviarImagem(produtor, dataUrl(PNG));
  assert.deepEqual([comoWebp.status, comoWebp.fieldErrors], [400, { image: [POPUP_FREE_MESSAGES.imageUploadFormat] }]);

  const png = await enviarImagem(produtor, `data:image/png;base64,${PNG.toString("base64")}`);
  assert.deepEqual([png.status, png.fieldErrors], [400, { image: [POPUP_FREE_MESSAGES.imageUploadFormat] }]);

  const larga = await enviarImagem(produtor, LARGA);
  assert.deepEqual([larga.status, larga.fieldErrors], [400, { image: [POPUP_FREE_MESSAGES.imageUploadSides] }]);

  // Cabecalho WebP de 64 x 48 com o arquivo passando de 420.000 bytes.
  const pesada = Buffer.concat([TRANSPARENTE, Buffer.alloc(420_001 - TRANSPARENTE.length, 0)]);
  const grande = await enviarImagem(produtor, pesada);
  assert.deepEqual([grande.status, grande.fieldErrors], [400, { image: [POPUP_FREE_MESSAGES.imageUploadBytes] }]);

  const muitoGrande = await enviarImagem(produtor, Buffer.alloc(600_000, 1));
  assert.equal(muitoGrande.status, 400, "acima do teto do corpo: recusado antes de decodificar");

  assert.equal(criados[IMAGES].size, antes, "nenhuma recusa chegou ao Storage");
});

test("sem messaging.write é 403", async () => {
  const result = await enviarImagem(analista, webpUnico());

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

/* ------------------------------------------------------------------------------------------------
 * Conferencia ao salvar
 * ---------------------------------------------------------------------------------------------- */

test("imagem nova que não está no Storage é recusada ao salvar", async () => {
  const caminho = `communications/free/${randomBytes(12).toString("hex")}.webp`;
  const result = await salvar(popupLivre({ image: { height: 48, path: caminho, width: 64 } }));

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.deepEqual(result.fieldErrors, { "freeDesign.assets.foto": [POPUP_FREE_MESSAGES.image] });

  // Um PNG gravado no caminho do Livre (como se tivesse sido enviado por fora): o tipo nao e WebP.
  criados[IMAGES].add(caminho);
  unwrap(await db.storage.from(IMAGES).upload(caminho, PNG, { contentType: "image/png", upsert: true }), "Gravando um PNG no caminho");
  const png = await salvar(popupLivre({ image: { height: 48, path: caminho, width: 64 } }));

  assert.deepEqual(png.fieldErrors, { "freeDesign.assets.foto": [POPUP_FREE_MESSAGES.image] });

  const { count } = await db.from("campaigns").select("id", { count: "exact", head: true }).eq("created_by", produtor.id);
  assert.equal(count, 0, "nada e gravado");
});

test("medidas erradas vindas do navegador são trocadas pelas do servidor", async () => {
  const { asset } = ok(await enviarImagem(produtor, webpUnico()));
  const salvo = ok(await salvar(popupLivre({ image: { height: 1600, path: asset.path, width: 16 } })));
  const imagem = (await gravado(salvo.id)).assets.find((item) => item.id === "foto");

  assert.deepEqual([imagem.width, imagem.height], [64, 48]);

  // Salvar de novo com o mesmo caminho (ja gravado): as medidas gravadas valem, sem conferir de novo.
  ok(await salvar(popupLivre({ image: { height: 99, path: asset.path, width: 99 } }), salvo.id));
  const outraVez = (await gravado(salvo.id)).assets.find((item) => item.id === "foto");

  assert.deepEqual([outraVez.width, outraVez.height], [64, 48]);
});

test("caminho de imagem de outro lugar do bucket é recusado", async () => {
  for (const path of [`catalog/${"a".repeat(24)}.webp`, `communications/free/${"a".repeat(24)}.png`, `communications/free/../images/${"a".repeat(24)}.webp`]) {
    const result = await salvar(popupLivre({ image: { height: 48, path, width: 64 } }));

    assert.equal(result.ok, false, path);
    assert.equal(result.status, 400, path);
    // Erro do zod com o indice; o editor troca por ids (freeErrorKeys).
    assert.deepEqual(result.fieldErrors["draft.freeDesign.assets.0.path"], [POPUP_FREE_MESSAGES.image], path);
  }
});

test("vídeo novo que não passou pela conferência é recusado e apagado", async () => {
  const caminho = await enviarVideoSemConferir(HTML);
  const result = await salvar(popupLivre({ video: { mimeType: "video/mp4", path: caminho } }));

  assert.deepEqual([result.ok, result.status], [false, 400]);
  assert.deepEqual(result.fieldErrors, { "freeDesign.assets.midia": [POPUP_FREE_MESSAGES.video] });
  assert.equal(await existeNoBucket(custom.POPUP_VIDEO_BUCKET, caminho), false, "o objeto recusado foi apagado");

  // Caminho que nunca recebeu arquivo.
  const vazio = await salvar(popupLivre({ video: { mimeType: "video/mp4", path: `videos/${randomUUID()}.mp4` } }));
  assert.deepEqual(vazio.fieldErrors, { "freeDesign.assets.midia": [POPUP_FREE_MESSAGES.video] });

  // Um video de verdade enviado sem a conferencia do fim e conferido aqui e entra.
  const bom = await enviarVideoSemConferir(MP4);
  const salvo = ok(await salvar(popupLivre({ video: { mimeType: "video/mp4", path: bom } })));

  assert.equal((await gravado(salvo.id)).assets.find((item) => item.id === "midia").path, bom);
});

test("vídeo do Personalizado gravado reusado no Livre não é conferido de novo nem apagado", async () => {
  actAs(produtor);
  const caminho = await enviarVideoSemConferir(MP4);
  actAs(produtor);
  const video = ok(await designActions.finishPopupVideoUpload({ path: caminho }));
  const personalizado = structuredClone(custom.popupStarterDesign("media_top_fade", { video }));
  const salvo = ok(
    await salvar({
      ...emptyNoticeDraft("popup"),
      audience: quemTemOProduto,
      cta: BOTAO,
      design: personalizado,
      image: { alt: "", url: `${new URL(supabaseUrl).origin}/storage/v1/object/public/content-assets/communications/images/capa-de-teste.webp` },
      title: "Pop-up Personalizado"
    })
  );

  // O objeto passa a ter bytes que a conferencia recusaria (e apagaria): o Livre na mesma linha reaproveita o
  // caminho gravado sem conferir de novo.
  unwrap(await db.storage.from(custom.POPUP_VIDEO_BUCKET).upload(caminho, HTML, { contentType: "video/mp4", upsert: true }), "Trocando os bytes do video gravado");

  const livre = ok(await salvar(popupLivre({ video: { mimeType: "video/mp4", path: caminho } }), salvo.id));

  assert.equal((await gravado(livre.id)).mode, "free");
  assert.equal((await gravado(livre.id)).assets[0].path, caminho);
  assert.equal(await existeNoBucket(custom.POPUP_VIDEO_BUCKET, caminho), true, "o arquivo que a linha usa nunca e apagado");

  // De novo, agora com o Livre gravado: continua sem conferir.
  ok(await salvar(popupLivre({ video: { mimeType: "video/mp4", path: caminho } }), salvo.id));
  assert.equal(await existeNoBucket(custom.POPUP_VIDEO_BUCKET, caminho), true);

  // Num aviso novo (a linha nao usa o caminho), o mesmo objeto e conferido e recusado.
  const novo = await salvar(popupLivre({ video: { mimeType: "video/mp4", path: caminho } }));

  assert.deepEqual(novo.fieldErrors, { "freeDesign.assets.midia": [POPUP_FREE_MESSAGES.video] });
});

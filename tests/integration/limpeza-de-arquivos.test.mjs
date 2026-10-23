import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { limparComunicacao, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Limpeza automatica dos arquivos da Comunicacao sem uso (docs/22 §4.6; migracao 202610240001) contra o banco e o
// Storage LOCAIS de verdade:
// - o video de um pop-up excluido e marcado na rodada (o arquivo tem mais de 24 h), fica ate os 30 dias e sai do
//   Storage depois (o tempo e simulado mudando first_orphan_at);
// - arquivo usado (Personalizado, Livre, imagem e audio do aviso) nunca e tocado, mesmo com uma marca antiga;
// - arquivo que volta a ser usado e desmarcado; enviado ha menos de 24 h nao e julgado;
// - fonte excluida que um pop-up no ar ainda usa fica; a que ninguem usa sai depois dos 30 dias;
// - o mesmo audio enviado de novo esquece a marca (o prazo recomeca);
// - o job do tick trabalha uma vez no dia e grava so contagens em job_runs.
// A rodada lista o Storage local inteiro: arquivos que outros testes deixaram sem uso ganham uma marca nova (nunca
// vencida), e as marcas sao apagadas no fim. Precisa da migracao 202610240001 aplicada no banco local.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const produtor = usuarioDeTeste(contas.produtor);
const cleanup = await import("../../src/server/communications/media-cleanup.ts");
const media = await import("../../src/server/communications/media.ts");
const custom = await import("../../src/server/communications/popup-design-model.ts");
const { COMMUNICATION_MEDIA_JOB_NAME, communicationMediaJob } = await import("../../src/server/jobs/communication-media-job.ts");
const { runJobsTick } = await import("../../src/server/jobs/run-tick.ts");

const DIA = 86_400_000;
/** "Amanha": os arquivos enviados agora ja passaram das 24 h. */
const AMANHA = new Date(Date.now() + 25 * 3_600_000);
const antesDeAmanha = (ms) => new Date(AMANHA.getTime() - ms).toISOString();

const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
const MP4 = fixture("popup-design/video-de-teste.mp4");
const WOFF2 = fixture("popup-design/fonte-de-teste.woff2");
const WEBP = fixture("popup-livre/capa-de-teste.webp");
const hex = (bytes = 12) => randomBytes(bytes).toString("hex");

/** Objetos criados pelo teste (apagados no fim, se ainda existirem). */
const criados = new Map();

async function enviar(bucket, path, bytes, contentType) {
  unwrap(await db.storage.from(bucket).upload(path, bytes, { contentType, upsert: false }), `Enviando ${bucket}/${path}`);
  criados.set(`${bucket}/${path}`, { bucket, path });

  return { bucket, path, url: db.storage.from(bucket).getPublicUrl(path).data.publicUrl };
}

const enviarVideo = () => enviar("communication-popup-video", `videos/${randomUUID()}.mp4`, MP4, "video/mp4");
const enviarImagem = (pasta = "images") => enviar("content-assets", `communications/${pasta}/${hex()}.webp`, WEBP, "image/webp");
const enviarAudio = () => enviar("communication-audio", `campaigns/${hex()}.mp3`, Buffer.concat([Buffer.from("ID3"), randomBytes(64)]), "audio/mpeg");
const enviarFonte = () => enviar("communication-fonts", `fonts/${hex()}.woff2`, WOFF2, "font/woff2");

async function existe({ bucket, path }) {
  const { error } = await db.storage.from(bucket).info(path);
  return !error;
}

async function marca({ bucket, path }) {
  const rows = unwrap(await db.from("communication_media_orphans").select("first_orphan_at").eq("bucket", bucket).eq("path", path), "Lendo a marca");
  return rows[0]?.first_orphan_at ?? null;
}

async function marcar({ bucket, path }, firstOrphanAt) {
  unwrap(
    await db.from("communication_media_orphans").upsert({ bucket, first_orphan_at: firstOrphanAt, path }, { onConflict: "bucket,path" }),
    "Gravando a marca"
  );
}

async function aviso(campos) {
  const [linha] = unwrap(
    await db.from("campaigns").insert({ created_by: produtor.id, title: "Limpeza de arquivos", updated_by: produtor.id, ...campos }).select("id"),
    "Criando o aviso"
  );
  return linha.id;
}

function personalizadoCom(video, imagemDoFundo) {
  const design = custom.popupStarterDesign("media_top_fade", { video: { mimeType: "video/mp4", path: video.path, url: video.url } });

  if (imagemDoFundo) {
    design.card.background = { color: "#16181c", dim: 40, kind: "image", position: "bottom", url: imagemDoFundo.url };
  }

  return design;
}

const rodada = (now = AMANHA) => cleanup.runMediaCleanup({ db, now });

async function zerarMarcas() {
  unwrap(await db.from("communication_media_orphans").delete().neq("path", ""), "Apagando as marcas");
}

before(async () => {
  await limparComunicacao(db);
  await zerarMarcas();
});
beforeEach(() => limparComunicacao(db));

after(async () => {
  await limparComunicacao(db);
  await zerarMarcas();
  unwrap(await db.from("job_runs").delete().eq("job", COMMUNICATION_MEDIA_JOB_NAME), "Apagando as execucoes do job");

  for (const [bucket, paths] of Object.entries(Object.groupBy([...criados.values()], (item) => item.bucket))) {
    await db.storage.from(bucket).remove(paths.map((item) => item.path));
  }
});

/* ------------------------------------------------------------------------------------------------
 * 30 dias, 24 h, em uso
 * ---------------------------------------------------------------------------------------------- */

test("pop-up excluido: o video e marcado, fica ate os 30 dias e sai do Storage depois", async () => {
  const video = await enviarVideo();
  const popUp = await aviso({ kind: "popup", popup_design: personalizadoCom(video), status: "ended" });
  unwrap(await db.from("campaigns").update({ deleted_at: new Date().toISOString(), deleted_by: produtor.id }).eq("id", popUp), "Excluindo o pop-up");

  const primeira = await rodada();
  assert.equal(Date.parse(await marca(video)), AMANHA.getTime(), "marcado com a hora da rodada");
  assert.ok(primeira.marked >= 1);
  assert.equal(primeira.pendingMigration, false);

  await marcar(video, antesDeAmanha(29 * DIA));
  await rodada();
  assert.equal(await existe(video), true, "com 29 dias, fica");
  assert.notEqual(await marca(video), null);

  await marcar(video, antesDeAmanha(30 * DIA + 60_000));
  const vencida = await rodada();
  assert.equal(await existe(video), false, "com 30 dias, sai do Storage");
  assert.equal(await marca(video), null, "e sai da tabela");
  assert.ok(vencida.deleted >= 1);
});

test("arquivo em uso nunca e tocado: Personalizado, Livre, imagem e audio do aviso, mesmo com marca antiga", async () => {
  const [video, fundo, livre, imagem, audio] = await Promise.all([enviarVideo(), enviarImagem(), enviarImagem("free"), enviarImagem(), enviarAudio()]);

  await aviso({ kind: "popup", popup_design: personalizadoCom(video, fundo), status: "active" });
  await aviso({
    kind: "popup",
    popup_design: { assets: [{ height: 90, id: "img", kind: "image", path: livre.path, width: 160 }], children: [{ asset: "img", id: "foto", type: "image" }, { id: "links", type: "links" }], fonts: [], mode: "free", version: 1 },
    status: "paused"
  });
  await aviso({ audio_duration_seconds: 5, audio_mime: "audio/mpeg", audio_url: audio.url, image_url: imagem.url, kind: "inbox", status: "draft" });

  const arquivos = [video, fundo, livre, imagem, audio];
  for (const arquivo of arquivos) {
    await marcar(arquivo, antesDeAmanha(40 * DIA));
  }

  await rodada();

  for (const arquivo of arquivos) {
    assert.equal(await existe(arquivo), true, `${arquivo.bucket}/${arquivo.path} continua no Storage`);
    assert.equal(await marca(arquivo), null, "e a marca antiga sai");
  }
});

test("arquivo que volta a ser usado e desmarcado; enviado ha menos de 24 h nao e julgado", async () => {
  const imagem = await enviarImagem();
  await rodada();
  assert.notEqual(await marca(imagem), null, "sem uso: marcado");

  await marcar(imagem, antesDeAmanha(31 * DIA));
  await aviso({ image_url: imagem.url, kind: "inbox", status: "draft" });
  await rodada();
  assert.equal(await existe(imagem), true);
  assert.equal(await marca(imagem), null, "voltou a ser usado: desmarcado");

  const recente = await enviarVideo();
  const hoje = await rodada(new Date());
  assert.equal(await marca(recente), null, "enviado agora: nao e julgado");
  assert.ok(hoje.recent >= 1);
});

test("fonte excluida que um pop-up no ar usa fica; a que ninguem usa sai depois dos 30 dias", async () => {
  const [emUso, semUso] = await Promise.all([enviarFonte(), enviarFonte()]);
  const linhas = unwrap(
    await db
      .from("communication_fonts")
      .insert(
        [emUso, semUso].map((arquivo) => ({
          created_by: produtor.id,
          deleted_at: new Date().toISOString(),
          family_key: `bf_${hex(6)}`,
          file_path: arquivo.path,
          format: "woff2",
          name: "Fonte de teste",
          size_bytes: WOFF2.length
        }))
      )
      .select("id,file_path"),
    "Criando as fontes excluidas"
  );
  const idEmUso = linhas.find((linha) => linha.file_path === emUso.path).id;
  const design = custom.popupStarterDesign("text_only");
  design.blocks[1].style.font = { id: idEmUso, kind: "uploaded" };
  design.fonts = [idEmUso];
  await aviso({ kind: "popup", popup_design: design, status: "active" });

  await marcar(emUso, antesDeAmanha(40 * DIA));
  await rodada();
  assert.equal(await existe(emUso), true, "a fonte do pop-up no ar fica");
  assert.equal(await marca(emUso), null);
  assert.notEqual(await marca(semUso), null, "a fonte excluida sem uso e marcada");

  await marcar(semUso, antesDeAmanha(30 * DIA));
  await rodada();
  assert.equal(await existe(semUso), false, "e sai depois dos 30 dias");
});

test("o mesmo audio enviado de novo esquece a marca (o prazo recomeca)", async () => {
  const bytes = Buffer.concat([Buffer.from("ID3"), randomBytes(256)]);
  const enviado = await media.persistNoticeAudio({ bytes, mimeType: "audio/mpeg" });
  const path = new URL(enviado.url).pathname.split("/communication-audio/")[1];
  const arquivo = { bucket: "communication-audio", path };
  criados.set(`communication-audio/${path}`, arquivo);

  await marcar(arquivo, antesDeAmanha(40 * DIA));
  await media.persistNoticeAudio({ bytes, mimeType: "audio/mpeg" });
  assert.equal(await marca(arquivo), null);
});

test("o job do tick trabalha uma vez no dia e grava so contagens em job_runs", async () => {
  unwrap(await db.from("job_runs").delete().eq("job", COMMUNICATION_MEDIA_JOB_NAME), "Apagando as execucoes do job");

  const primeiro = await runJobsTick({ jobs: [communicationMediaJob], supabase: db });
  assert.deepEqual(primeiro.failed, [], JSON.stringify(primeiro));
  const segundo = await runJobsTick({ jobs: [communicationMediaJob], supabase: db });
  assert.deepEqual(segundo.failed, [], JSON.stringify(segundo));

  const execucoes = unwrap(
    await db.from("job_runs").select("status,metadata").eq("job", COMMUNICATION_MEDIA_JOB_NAME).order("started_at"),
    "Lendo as execucoes"
  );
  assert.equal(execucoes.length, 2);
  assert.deepEqual(execucoes.map((row) => row.status), ["succeeded", "succeeded"]);
  const trabalho = execucoes[0].metadata.media_cleanup;
  assert.equal(trabalho.done, true);
  assert.ok(Object.values(trabalho).every((value) => typeof value === "number" || typeof value === "boolean"), JSON.stringify(trabalho));
  assert.equal(execucoes[1].metadata.media_cleanup, undefined, "o segundo tick do dia nao trabalha");
});

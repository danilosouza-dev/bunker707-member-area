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
// - envio do mesmo audio ou da mesma fonte entre a reserva e a remocao (reserva, envio dos mesmos bytes, remocao):
//   o envio espera a rodada terminar e grava de novo; no fim o arquivo esta no Storage e sem marca;
// - reserva esquecida (rodada que caiu): o envio toma, a rodada seguinte solta e decide de novo; a reserva de uma
//   rodada em andamento fica com ela;
// - o job do tick trabalha uma vez no dia e grava so contagens em job_runs;
// - modelos (docs/28 D17): o modelo nao excluido segura o arquivo (notificacao com imagem e audio, pop-up
//   Personalizado com video e fundo, design Livre com imagens) e a fonte excluida que ele cita; excluido o modelo,
//   o arquivo e marcado na rodada seguinte e sai depois dos 30 dias.
// A rodada lista o Storage local inteiro: arquivos que outros testes deixaram sem uso ganham uma marca nova (nunca
// vencida), e as marcas sao apagadas no fim. Precisa da migracao 202610240001 aplicada no banco local.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const produtor = usuarioDeTeste(contas.produtor);
const cleanup = await import("../../src/server/communications/media-cleanup.ts");
const media = await import("../../src/server/communications/media.ts");
const popupMedia = await import("../../src/server/communications/popup-media.ts");
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

async function reserva({ bucket, path }) {
  const rows = unwrap(await db.from("communication_media_orphans").select("claimed_at").eq("bucket", bucket).eq("path", path), "Lendo a reserva");
  return rows[0]?.claimed_at ?? null;
}

async function reservar({ bucket, path }, firstOrphanAt, claimedAt) {
  unwrap(
    await db.from("communication_media_orphans").upsert({ bucket, claimed_at: claimedAt, first_orphan_at: firstOrphanAt, path }, { onConflict: "bucket,path" }),
    "Gravando a reserva"
  );
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const audioDeTeste = () => Buffer.concat([Buffer.from("ID3"), randomBytes(256)]);
/** TTF minimo aceito por sniffPopupFont (00 01 00 00, uma tabela, diretorio inteiro), unico por chamada. */
const fonteDeTeste = () => Buffer.concat([Buffer.from([0, 1, 0, 0, 0, 1, 0, 16, 0, 0, 0, 0]), randomBytes(16 + 64)]);

/** Envia o audio pelo caminho do editor e devolve o arquivo (bucket e caminho). */
async function audioDoEditor(bytes) {
  const enviado = await media.persistNoticeAudio({ bytes, mimeType: "audio/mpeg" });
  const path = new URL(enviado.url).pathname.split("/communication-audio/")[1];
  const arquivo = { bucket: "communication-audio", path };
  criados.set(`communication-audio/${path}`, arquivo);

  return arquivo;
}

/**
 * O banco da rodada com um gancho na remocao do Storage: `aoRemover` roda depois da reserva e antes de o Storage
 * apagar (e onde o editor envia o mesmo arquivo de novo). O resto e o cliente local de verdade.
 */
function comGanchoNaRemocao(aoRemover) {
  const storage = {
    from(bucket) {
      const api = db.storage.from(bucket);
      return {
        list: (...args) => api.list(...args),
        async remove(paths) {
          await aoRemover(bucket, paths);
          return api.remove(paths);
        }
      };
    }
  };

  return new Proxy(db, {
    get(target, property) {
      if (property === "storage") {
        return storage;
      }

      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

/**
 * Reserva -> envio dos mesmos bytes -> remocao: `enviar` comeca quando a rodada ja reservou o arquivo e vai pedir a
 * remocao; o Storage so apaga 1 s depois. Devolve o resultado da rodada e o do envio.
 */
async function rodadaComEnvioNoMeio(arquivo, enviar) {
  let envio = null;
  let enviado = false;
  const rodadaDb = comGanchoNaRemocao(async (bucket, paths) => {
    if (bucket !== arquivo.bucket || !paths.includes(arquivo.path)) {
      return;
    }

    assert.notEqual(await reserva(arquivo), null, "reservado antes da remocao, e a linha ainda esta la");
    envio = enviar().then((resultado) => {
      enviado = true;
      return resultado;
    });
    await esperar(1_000);
    assert.equal(enviado, false, "o envio espera a remocao terminar");
  });

  const resultado = await cleanup.runMediaCleanup({ db: rodadaDb, now: AMANHA });
  assert.ok(envio, "a rodada pediu a remocao do arquivo");

  return { enviado: await envio, resultado };
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

/* ------------------------------------------------------------------------------------------------
 * Modelos (docs/28 D17)
 * ---------------------------------------------------------------------------------------------- */

async function modelo(payload, extra = {}) {
  const [linha] = unwrap(
    await db
      .from("communication_templates")
      .insert({
        created_by: produtor.id,
        design_mode: payload.kind === "inbox" ? null : payload.design ? (payload.design.mode === "free" ? "free" : "custom") : null,
        kind: payload.kind,
        name: "Modelo da limpeza",
        payload,
        updated_by: produtor.id,
        ...extra
      })
      .select("id"),
    "Criando o modelo"
  );
  return linha.id;
}

const POPUP_SETTINGS = { close: "any", delaySeconds: 3, exclude: [], frequency: { mode: "once" }, pages: ["home"], snoozeMinutes: 1440, trigger: "page_load" };

function conteudoCom({ audio = null, imagem = null } = {}) {
  return {
    audio: audio ? { durationSeconds: 5, mimeType: "audio/mpeg", peaks: [], url: audio.url } : null,
    body: "",
    cta: null,
    image: imagem ? { alt: "", url: imagem.url } : null,
    poll: null,
    reactions: false,
    response: null,
    title: "Modelo"
  };
}

test("modelos seguram os arquivos: notificação com imagem e áudio, pop-up Personalizado com vídeo e fundo e design Livre com imagens", async () => {
  const [imagem, audio, video, fundo, livre, capa] = await Promise.all([enviarImagem(), enviarAudio(), enviarVideo(), enviarImagem(), enviarImagem("free"), enviarImagem("free")]);

  await modelo({
    audience: null,
    content: conteudoCom({ audio, imagem }),
    followUps: null,
    kind: "inbox",
    settings: { allowHide: true, icon: null, sender: null, validity: { mode: "default" } },
    version: 1
  });
  await modelo({ audience: null, content: null, design: personalizadoCom(video, fundo), designSupport: { ctaLabel: null, image: null }, kind: "popup", settings: { allowSnooze: true, icon: null, popup: POPUP_SETTINGS }, version: 1 });
  await modelo({
    design: {
      artboard: { fill: [{ asset: "fundo", kind: "image" }], width: 440 },
      assets: [
        { height: 90, id: "img", kind: "image", path: livre.path, width: 160 },
        { height: 90, id: "fundo", kind: "image", path: capa.path, width: 160 }
      ],
      children: [{ asset: "img", id: "foto", type: "image" }, { id: "links", type: "links" }],
      fonts: [],
      mode: "free",
      version: 1
    },
    designSupport: { ctaLabel: null, image: null },
    kind: "design",
    version: 1
  });

  const arquivos = [imagem, audio, video, fundo, livre, capa];
  for (const arquivo of arquivos) {
    await marcar(arquivo, antesDeAmanha(40 * DIA));
  }

  await rodada();

  for (const arquivo of arquivos) {
    assert.equal(await existe(arquivo), true, `${arquivo.bucket}/${arquivo.path} continua no Storage`);
    assert.equal(await marca(arquivo), null, "e a marca antiga sai");
  }
});

test("modelo excluído: o arquivo é marcado na rodada seguinte e sai depois dos 30 dias", async () => {
  const video = await enviarVideo();
  const id = await modelo({ design: personalizadoCom(video), designSupport: { ctaLabel: null, image: null }, kind: "design", version: 1 });

  await rodada();
  assert.equal(await marca(video), null, "o modelo segura o vídeo");

  unwrap(await db.from("communication_templates").update({ deleted_at: new Date().toISOString(), deleted_by: produtor.id }).eq("id", id), "Excluindo o modelo");
  await rodada();
  assert.equal(Date.parse(await marca(video)), AMANHA.getTime(), "marcado na rodada seguinte à exclusão");
  assert.equal(await existe(video), true);

  await marcar(video, antesDeAmanha(31 * DIA));
  await rodada();
  assert.equal(await existe(video), false, "com 31 dias, sai do Storage");
  assert.equal(await marca(video), null);
});

test("a fonte excluída que um modelo não excluído cita continua no Storage", async () => {
  const arquivo = await enviarFonte();
  const [linha] = unwrap(
    await db
      .from("communication_fonts")
      .insert({ created_by: produtor.id, deleted_at: new Date().toISOString(), family_key: `bf_${hex(6)}`, file_path: arquivo.path, format: "woff2", name: "Fonte do modelo", size_bytes: WOFF2.length })
      .select("id"),
    "Criando a fonte excluida"
  );
  const design = custom.popupStarterDesign("text_only");
  design.blocks[1].style.font = { id: linha.id, kind: "uploaded" };
  design.fonts = [linha.id];
  await modelo({ design, designSupport: { ctaLabel: null, image: null }, kind: "design", version: 1 });

  await marcar(arquivo, antesDeAmanha(40 * DIA));
  await rodada();
  assert.equal(await existe(arquivo), true, "a fonte do modelo fica");
  assert.equal(await marca(arquivo), null);
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

/* ------------------------------------------------------------------------------------------------
 * Envio do mesmo arquivo durante a remocao (reserva antes de apagar)
 * ---------------------------------------------------------------------------------------------- */

test("o mesmo audio enviado entre a reserva e a remocao: o envio espera a rodada e o arquivo fica, sem marca", async () => {
  const bytes = audioDeTeste();
  const arquivo = await audioDoEditor(bytes);
  await marcar(arquivo, antesDeAmanha(40 * DIA));

  const { enviado, resultado } = await rodadaComEnvioNoMeio(arquivo, () => media.persistNoticeAudio({ bytes, mimeType: "audio/mpeg" }));

  assert.ok(resultado.deleted >= 1, "a rodada apagou o arquivo antigo");
  assert.ok(new URL(enviado.url).pathname.endsWith(`/communication-audio/${arquivo.path}`), "o editor recebeu o mesmo caminho");
  assert.equal(await existe(arquivo), true, "o arquivo que o editor recebeu esta no Storage");
  assert.equal(await marca(arquivo), null, "e sem marca");
});

test("a mesma fonte enviada de novo entre a reserva e a remocao: a fonte nova da biblioteca fica com o arquivo", async () => {
  const bytes = fonteDeTeste();
  const fonte = { name: "Fonte da limpeza", style: "normal", userId: produtor.id, weight: 400 };
  const primeira = await popupMedia.persistPopupFont(db, { ...fonte, bytes });
  const arquivo = { bucket: "communication-fonts", path: popupMedia.popupFontFilePath(bytes, popupMedia.sniffPopupFont(bytes)) };
  criados.set(`communication-fonts/${arquivo.path}`, arquivo);
  assert.equal(primeira.created, true);

  unwrap(await db.from("communication_fonts").update({ deleted_at: new Date().toISOString() }).eq("id", primeira.font.id), "Excluindo a fonte");
  await marcar(arquivo, antesDeAmanha(40 * DIA));

  const { enviado, resultado } = await rodadaComEnvioNoMeio(arquivo, () => popupMedia.persistPopupFont(db, { ...fonte, bytes }));

  assert.ok(resultado.deleted >= 1);
  assert.equal(enviado.created, true, "linha nova na biblioteca");
  const viva = unwrap(await db.from("communication_fonts").select("file_path").eq("id", enviado.font.id).is("deleted_at", null), "Lendo a fonte nova");
  assert.deepEqual(viva.map((linha) => linha.file_path), [arquivo.path]);
  assert.equal(await existe(arquivo), true, "o arquivo da fonte nova esta no Storage");
  assert.equal(await marca(arquivo), null);
});

test("reserva esquecida: o envio toma; a rodada seguinte solta e decide de novo; a de uma rodada em andamento fica", async () => {
  const vinteMinutos = () => new Date(Date.now() - 20 * 60_000).toISOString();

  const bytes = audioDeTeste();
  const tomado = await audioDoEditor(bytes);
  await reservar(tomado, antesDeAmanha(40 * DIA), vinteMinutos());
  await media.persistNoticeAudio({ bytes, mimeType: "audio/mpeg" });
  assert.equal(await marca(tomado), null, "o envio tomou a reserva esquecida");
  assert.equal(await existe(tomado), true);

  const [esquecido, emAndamento] = await Promise.all([enviarAudio(), enviarAudio()]);
  await reservar(esquecido, antesDeAmanha(40 * DIA), vinteMinutos());
  await reservar(emAndamento, antesDeAmanha(40 * DIA), new Date().toISOString());

  const resultado = await rodada();
  assert.ok(resultado.released >= 1, JSON.stringify(resultado));
  assert.equal(await existe(esquecido), false, "solta, vencida e sem uso: saiu do Storage");
  assert.equal(await marca(esquecido), null);
  assert.equal(await existe(emAndamento), true, "a reserva de outra rodada fica com ela");
  assert.notEqual(await reserva(emAndamento), null);
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

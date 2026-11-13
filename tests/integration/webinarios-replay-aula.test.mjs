import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { invalidations } from "../support/integration-next-cache.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, LIVE_AO_VIVO_ENCERRADA_DE_TESTE, limparWebinarios, seedEscolaDeTeste, seedLiveAoVivoEncerradaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Publicar replay como aula (docs/30 §2.2, §2.3 e §6.8; D108 a D113) contra o Supabase local, com as tabelas de verdade
// (lessons, course_modules, webinar_recordings, admin_audit_log) e as permissoes de verdade da equipe de teste:
// 1. o replay que nasce com "Publicar sozinho" vira uma aula publicada no fim do ultimo modulo do curso, com o video da
//    Bunny no formato das outras aulas, a contagem do modulo, a auditoria e o catalogo invalidado;
// 2. o botao Publicar replay: quem nao publica recebe 403; de novo nao cria a segunda aula; a excluida pela equipe volta;
// 3. a retencao le o video da aula pelo jsonb (video_config->>assetId): enquanto a aula existe, o video fica na Bunny
//    e a conferencia e adiada; com a aula excluida, e apagado como antes.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/webinars/actions.ts");
const { createReplayForSession } = await import("../../src/server/webinars/session-lifecycle.ts");
const { replayLessonIdFor } = await import("../../src/server/webinars/replay-lesson-model.ts");
const { RECORDINGS_LESSON_RECHECK_DAYS, RECORDINGS_PURGE_MINUTE, runRecordingsTick } = await import("../../src/server/webinars/recordings-tick.ts");

const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const { curso } = ESCOLA_DE_TESTE;
const { id: webinarId, sessaoId, titulo } = LIVE_AO_VIVO_ENCERRADA_DE_TESTE;
const AULA = replayLessonIdFor(webinarId);
const VIDEO = "7e57a11a-0000-4000-8000-00000000a01a";
const PLAYER = `https://iframe.mediadelivery.net/embed/42/${VIDEO}`;
const DAY = 24 * 60 * 60_000;

async function aula() {
  return unwrap(await db.from("lessons").select("*").eq("id", AULA).maybeSingle(), "Lendo a aula do replay");
}

async function gravacao() {
  return unwrap(await db.from("webinar_recordings").select("id, purge_due_at, purged_at, status").eq("bunny_video_id", VIDEO).single(), "Lendo a gravacao de teste");
}

async function apagarAula() {
  unwrap(await db.from("lessons").delete().eq("id", AULA), "Apagando a aula do replay de teste");
}

/** O duble da Bunny: anota as chamadas; o DELETE sempre da certo. */
function bunnyFalsa() {
  const log = [];
  return {
    async deleteVideo(libraryId, videoId) {
      log.push(["DELETE", libraryId, videoId]);
      return "deleted";
    },
    async getVideo(libraryId, videoId) {
      log.push(["GET", libraryId, videoId]);
      return null;
    },
    libraryId: "42",
    log
  };
}

/** Um tick das gravacoes no minuto da retencao, com a gravacao de teste vencida ha uma hora. */
async function rodarRetencao() {
  const naHora = new Date();
  naHora.setUTCMinutes(RECORDINGS_PURGE_MINUTE, 0, 0);
  unwrap(await db.from("webinar_recordings").update({ purge_due_at: new Date(naHora.getTime() - 60 * 60_000).toISOString() }).eq("bunny_video_id", VIDEO), "Vencendo a gravacao de teste");
  const bunny = bunnyFalsa();
  const result = await runRecordingsTick({ bunny, db, now: naHora });

  return { apagados: bunny.log.filter(([metodo, , video]) => metodo === "DELETE" && video === VIDEO).length, naHora, result };
}

before(async () => {
  await limparWebinarios(db);
  await apagarAula();
  await seedEscolaDeTeste(db);
  await seedLiveAoVivoEncerradaDeTeste(db);
  unwrap(
    await db.from("webinars").update({ replay_lesson_target: { autoPublish: true, moduleId: null, productId: curso.id, title: null } }).eq("id", webinarId),
    "Gravando o destino do replay"
  );
  unwrap(
    await db.from("webinar_recordings").insert({
      bunny_library_id: "42",
      bunny_video_id: VIDEO,
      duration_seconds: 1800,
      embed_url: PLAYER,
      provider: "bunny",
      session_id: sessaoId,
      source: "jibri",
      status: "ready",
      webinar_id: webinarId
    }),
    "Gravando a gravacao pronta da live de teste"
  );
  invalidations.length = 0;
});

after(async () => {
  actAs(null);
  await limparWebinarios(db);
  await apagarAula();
  // A contagem de aulas do modulo volta ao que a escola de teste espera.
  await seedEscolaDeTeste(db);
});

test("1. o replay que nasce com Publicar sozinho vira uma aula publicada no fim do ultimo modulo do curso, com o video da Bunny, a contagem, a auditoria e o catalogo invalidado", async () => {
  assert.equal(await aula(), null, "antes do replay nao ha aula");
  // O que ja esta no ultimo modulo do curso de teste (a aula 3; outro teste pode ter deixado mais alguma).
  const antes = unwrap(await db.from("lessons").select("sort_order, status").eq("module_id", curso.modulos.modulo2), "Lendo as aulas do modulo");
  const dePe = antes.filter((linha) => linha.status !== "deleted").length;
  const ultima = Math.max(...antes.map((linha) => linha.sort_order));

  assert.equal(await createReplayForSession(db, sessaoId, new Date()), true, "a sessao encerrada com a gravacao pronta ganha o replay");

  const criada = await aula();
  assert.ok(criada, "a aula nasceu");
  assert.deepEqual(
    { completed: criada.completed, duration: criada.duration, module_id: criada.module_id, sort_order: criada.sort_order, status: criada.status, title: criada.title, video_config: criada.video_config },
    {
      completed: false,
      duration: "30:00",
      module_id: curso.modulos.modulo2,
      sort_order: ultima + 1,
      status: "published",
      title: titulo,
      video_config: { assetId: VIDEO, provider: "bunny", url: PLAYER }
    },
    "no ultimo modulo, depois das aulas que ja estavam la"
  );
  assert.equal(criada.deleted_at, null);
  const modulo = unwrap(await db.from("course_modules").select("meta").eq("id", curso.modulos.modulo2).single(), "Lendo o modulo");
  assert.equal(modulo.meta, `${dePe + 1} aulas`, "a contagem do modulo acompanha");
  const auditoria = unwrap(await db.from("admin_audit_log").select("actor_id, entity_type, metadata").eq("action", "webinar.replay_lesson_published").eq("entity_id", webinarId), "Lendo a auditoria");
  assert.equal(auditoria.length, 1);
  assert.equal(auditoria[0].actor_id, null, "no automatico ninguem pediu");
  assert.deepEqual(
    { lesson_id: auditoria[0].metadata.lesson_id, mode: auditoria[0].metadata.mode, module_created: auditoria[0].metadata.module_created, module_id: auditoria[0].metadata.module_id, product_id: auditoria[0].metadata.product_id },
    { lesson_id: AULA, mode: "auto", module_created: false, module_id: curso.modulos.modulo2, product_id: curso.id }
  );
  assert.ok(invalidations.some((item) => item.kind === "tag" && item.tag === "catalog"), "o catalogo dos alunos se refaz");

  // O replay ja existe: nada de novo, e a aula continua uma so.
  assert.equal(await createReplayForSession(db, sessaoId, new Date()), false);
  assert.equal(unwrap(await db.from("lessons").select("id").eq("id", AULA), "Contando a aula").length, 1);
});

test("2. Publicar replay: quem nao publica recebe 403; de novo nao cria a segunda aula; a excluida pela equipe volta publicada", async () => {
  actAs(analista);
  const semPublicar = await actions.publishWebinarReplay({ id: webinarId });
  assert.deepEqual([semPublicar.ok, semPublicar.status], [false, 403]);

  actAs(produtor);
  const repetida = await actions.publishWebinarReplay({ id: webinarId });
  assert.equal(repetida.ok, true, repetida.ok ? "" : `${repetida.status}: ${repetida.error}`);
  assert.deepEqual(repetida.data, { created: false, lessonId: AULA, title: titulo });

  unwrap(await db.from("lessons").update({ deleted_at: new Date().toISOString(), deleted_by: produtor.id, status: "deleted" }).eq("id", AULA), "Excluindo a aula como a equipe faria");
  const devolvida = await actions.publishWebinarReplay({ id: webinarId });
  assert.equal(devolvida.ok, true, devolvida.ok ? "" : `${devolvida.status}: ${devolvida.error}`);
  assert.deepEqual(devolvida.data, { created: true, lessonId: AULA, title: titulo });
  const deVolta = await aula();
  assert.deepEqual([deVolta.status, deVolta.deleted_at, deVolta.deleted_by, deVolta.module_id], ["published", null, null, curso.modulos.modulo2]);
  const pedidos = unwrap(await db.from("admin_audit_log").select("actor_id, metadata").eq("action", "webinar.replay_lesson_published").eq("entity_id", webinarId).eq("actor_id", produtor.id), "Lendo a auditoria do botao");
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].metadata.restored, true);

  const modulos = await actions.listReplayLessonModules({ productId: curso.id });
  assert.equal(modulos.ok, true);
  assert.deepEqual(
    modulos.data.modules.map((modulo) => modulo.id).filter((id) => Object.values(curso.modulos).includes(id)),
    [curso.modulos.modulo1, curso.modulos.modulo2],
    "os modulos do curso, na ordem, para o card"
  );
});

test("3. retencao: o video da aula fica na Bunny e a conferencia e adiada (o filtro pelo jsonb de verdade); com a aula excluida, o video e apagado", async () => {
  const poupada = await rodarRetencao();
  assert.equal(poupada.apagados, 0, "a aula ainda usa o video");
  assert.ok(poupada.result.keptAsLesson >= 1);
  const adiada = await gravacao();
  assert.equal(adiada.purged_at, null);
  assert.ok(Date.parse(adiada.purge_due_at) >= poupada.naHora.getTime() + (RECORDINGS_LESSON_RECHECK_DAYS - 1) * DAY, "a proxima conferencia fica para daqui a cerca de 30 dias");

  unwrap(await db.from("lessons").update({ deleted_at: new Date().toISOString(), status: "deleted" }).eq("id", AULA), "Excluindo a aula");
  const apagada = await rodarRetencao();
  assert.equal(apagada.apagados, 1, "sem aula de pe, a retencao apaga o video");
  assert.ok((await gravacao()).purged_at);
});

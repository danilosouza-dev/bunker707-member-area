import assert from "node:assert/strict";
import { before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparProgresso, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Progresso da aula contra o banco LOCAL de verdade (docs/18 §3.1, "Concluir aula e progresso"):
// a rota PUT /api/progress/lessons grava, e os leitores do aluno (pagina da aula e fileira
// "Continue assistindo" da home) devolvem o MESMO estado. E o teste de regressao da familia do bug
// "Concluída pelo modulo, Concluir pelo card".

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const { POST, PUT } = await import("../../src/app/api/progress/lessons/route.ts");
const { getHomePageData, getLessonPageData } = await import("../../src/server/db/platform-store.ts");
const { getContinueWatchingPageData, getJourneyPageData } = await import("../../src/server/member-area/student-pages.ts");

const { curso } = ESCOLA_DE_TESTE;
const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);

function putProgresso(payload) {
  return PUT(
    new Request("http://localhost/api/progress/lessons", {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method: "PUT"
    })
  );
}

async function lerProgressoNoBanco(userId) {
  return unwrap(
    await db.from("lesson_progress").select("completed_lesson_ids,lesson_watch_states").eq("user_id", userId).eq("content_id", curso.id).maybeSingle(),
    "Lendo lesson_progress"
  );
}

async function fileiraContinueAssistindo(user) {
  const { homeRows } = await getHomePageData(undefined, user);

  return homeRows.find((row) => row.variant === "continue") ?? null;
}

before(async () => {
  await limparProgresso(db, [contas.aluna.id, contas.alunoSemAcesso.id]);
});

test("sem sessao, a rota responde 401 e nao grava nada", async () => {
  actAs(null);
  const response = await putProgresso({ contentId: curso.id, lessonId: curso.aulas.aula1, status: "completed" });

  assert.equal(response.status, 401);
});

test("payload sem aula e sem progresso responde 400", async () => {
  actAs(aluna);
  const response = await putProgresso({ contentId: curso.id });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Progresso de aula invalido.");
});

test("aluno sem acesso ao curso recebe 403 e nada e gravado", async () => {
  actAs(alunoSemAcesso);
  const response = await putProgresso({
    completedLessonIds: [curso.aulas.aula1],
    contentId: curso.id,
    lessonId: curso.aulas.aula1,
    status: "completed"
  });

  assert.equal(response.status, 403);
  assert.equal(await lerProgressoNoBanco(contas.alunoSemAcesso.id), null);
});

test("concluir a aula 1 pelo botao: a rota grava a aula como concluida no banco", async () => {
  actAs(aluna);
  const response = await putProgresso({
    completedLessonIds: [curso.aulas.aula1],
    contentId: curso.id,
    durationSeconds: 600,
    lessonId: curso.aulas.aula1,
    maxProgressPercent: 100,
    progressPercent: 100,
    progressSeconds: 600,
    status: "completed"
  });

  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data.completedLessonIds, [curso.aulas.aula1]);
  assert.equal(data.lessonWatchStates[curso.aulas.aula1].status, "completed");
  assert.equal(data.lessonWatchStates[curso.aulas.aula1].progressPercent, 100);

  const row = await lerProgressoNoBanco(contas.aluna.id);
  assert.deepEqual(row.completed_lesson_ids, [curso.aulas.aula1]);
  assert.equal(row.lesson_watch_states[curso.aulas.aula1].status, "completed");
});

test("a pagina da aula le o mesmo estado: aula 1 concluida, aula 2 nao, modulo 1 pela metade", async () => {
  const page = await getLessonPageData(curso.id, curso.modulos.modulo1, aluna);

  assert.ok(page, "a aluna abre o modulo 1");
  assert.equal(page.item.isLocked, undefined, "o curso comprado nao esta bloqueado");
  const [aula1, aula2] = page.selectedModule.lessons;
  assert.equal(aula1.id, curso.aulas.aula1);
  assert.equal(aula1.completed, true);
  assert.equal(aula2.completed, false);
  assert.equal(page.selectedModule.progress, 50, "1 de 2 aulas do modulo concluida");
  assert.equal(page.initialLessonWatchStates[curso.aulas.aula1].status, "completed");
  assert.equal(page.allModules.find((courseModule) => courseModule.id === curso.modulos.modulo2).progress, 0);
});

test("aula concluida nao entra em Continue assistindo; aula comecada e nao terminada entra, com o mesmo progresso", async () => {
  actAs(aluna);
  const response = await putProgresso({
    contentId: curso.id,
    durationSeconds: 600,
    lessonId: curso.aulas.aula2,
    progressSeconds: 120,
    status: "in_progress"
  });
  assert.equal(response.status, 200);

  const fileira = await fileiraContinueAssistindo(aluna);
  assert.ok(fileira, "a home tem a fileira Continue assistindo");
  const ids = fileira.items.map((item) => item.id);
  assert.deepEqual(ids, [curso.aulas.aula2], "so a aula 2 (comecada) aparece; a aula 1 (concluida) nao");
  const card = fileira.items[0];
  assert.equal(card.progress, 20, "120 s de 600 s = 20%");
  assert.equal(card.href, `/conteudo/${curso.id}/aulas/${curso.modulos.modulo1}?lessonId=${curso.aulas.aula2}`);

  const page = await getLessonPageData(curso.id, curso.modulos.modulo1, aluna);
  assert.equal(page.selectedModule.lessons[1].completed, false);
  assert.equal(page.initialLessonWatchStates[curso.aulas.aula2].progressPercent, 20);
  assert.equal(page.selectedModule.progress, 60, "(100 + 20) / 2 aulas");
});

test("desmarcar a aula 1 pelo botao: a rota tira a aula da lista e a pagina da aula volta a mostrar como nao concluida", async () => {
  actAs(aluna);
  const response = await putProgresso({
    completedLessonIds: [],
    contentId: curso.id,
    durationSeconds: 600,
    lessonId: curso.aulas.aula1,
    maxProgressPercent: 100,
    progressPercent: 100,
    progressSeconds: 600,
    status: "in_progress"
  });

  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data.completedLessonIds, []);
  assert.equal(data.lessonWatchStates[curso.aulas.aula1].status, "in_progress");

  const page = await getLessonPageData(curso.id, curso.modulos.modulo1, aluna);
  assert.equal(page.selectedModule.lessons[0].completed, false, "a aula 1 deixou de ser concluida");
  assert.equal(page.initialLessonWatchStates[curso.aulas.aula1].status, "in_progress");

  // Desmarcada depois de assistida ate o fim, ela volta para Continue assistindo (99%), junto com a aula 2.
  const fileira = await fileiraContinueAssistindo(aluna);
  assert.deepEqual(fileira.items.map((item) => item.id).sort(), [curso.aulas.aula1, curso.aulas.aula2].sort());
});

test("aula de outro curso no payload e recusada: nada muda no progresso do curso", async () => {
  actAs(aluna);
  const antes = await lerProgressoNoBanco(contas.aluna.id);
  const response = await putProgresso({
    completedLessonIds: [ESCOLA_DE_TESTE.cursoBloqueado.aulas.aula1],
    contentId: curso.id,
    lessonId: ESCOLA_DE_TESTE.cursoBloqueado.aulas.aula1,
    status: "completed"
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await lerProgressoNoBanco(contas.aluna.id), antes);
});

test("aluno sem acesso nao ve o curso liberado nem a fileira Continue assistindo", async () => {
  const fileira = await fileiraContinueAssistindo(alunoSemAcesso);
  assert.equal(fileira, null);

  const page = await getLessonPageData(curso.id, curso.modulos.modulo1, alunoSemAcesso);
  assert.equal(page?.item.isLocked, true, "a pagina da aula marca o curso como bloqueado (a tela redireciona)");
});

test("Minha jornada e a pagina Continue assistindo leem o mesmo progresso que a aula e a home", async () => {
  // Estado deixado pelos testes acima: aula 1 desmarcada (em andamento no fim do video) e aula 2 em andamento (20%).
  actAs(aluna);
  const concluir = await putProgresso({
    completedLessonIds: [curso.aulas.aula1],
    contentId: curso.id,
    durationSeconds: 600,
    lessonId: curso.aulas.aula1,
    progressPercent: 100,
    progressSeconds: 600,
    status: "completed"
  });
  assert.equal(concluir.status, 200);

  const jornada = await getJourneyPageData(undefined, aluna);
  assert.equal(jornada.stats.completedLessons, 1, "1 aula concluida no total");
  assert.equal(jornada.stats.totalContents, 2, "os dois cursos comprados (o bloqueado nao conta)");
  assert.equal(jornada.stats.totalLessons, 5, "3 aulas do curso de agentes + 2 publicadas do curso de liberacao (rascunho nao conta)");
  assert.equal(jornada.stats.inProgressContents, 1, "so o curso de agentes foi comecado");
  const liberacao = jornada.products.find((entry) => entry.id === ESCOLA_DE_TESTE.cursoLiberacao.id);
  assert.equal(liberacao?.lockedLessons, 1, "a aula com data futura conta como a liberar");
  assert.equal(liberacao?.status, "not_started");
  const produto = jornada.products.find((entry) => entry.id === curso.id);
  assert.ok(produto, "o curso comprado aparece na jornada");
  assert.equal(produto.completedLessons, 1);
  assert.equal(produto.status, "in_progress");
  assert.equal(produto.resume?.label, "Continuar");
  assert.equal(produto.resume?.lessonTitle, "Aula 2: As peças de um agente", "retoma a aula comecada, nao a concluida");
  assert.deepEqual(jornada.continueWatching.map((card) => card.title), ["Aula 2: As peças de um agente"]);

  const continuar = await getContinueWatchingPageData(undefined, aluna);
  assert.deepEqual(continuar.inProgress.map((card) => card.title), ["Aula 2: As peças de um agente"], "mesma regra da fileira da home");
  assert.deepEqual(continuar.recentlyCompleted.map((card) => card.title), ["Aula 1: O que é um agente"]);

  const fileira = await fileiraContinueAssistindo(aluna);
  assert.deepEqual(fileira.items.map((item) => item.id), [curso.aulas.aula2]);
});

test("reacao da aula (Gostei / Amei / Nao e para mim): a rota grava e a pagina da aula devolve; reacao desconhecida e 400", async () => {
  actAs(aluna);
  const gostei = await putProgresso({ contentId: curso.id, lessonId: curso.aulas.aula3, lessonReactions: { [curso.aulas.aula3]: "liked" } });
  assert.equal(gostei.status, 200);
  let page = await getLessonPageData(curso.id, curso.modulos.modulo2, aluna);
  assert.equal(page.initialLessonReactions[curso.aulas.aula3], "liked");

  const amei = await putProgresso({ contentId: curso.id, lessonId: curso.aulas.aula3, lessonReactions: { [curso.aulas.aula3]: "loved" } });
  assert.equal(amei.status, 200);
  page = await getLessonPageData(curso.id, curso.modulos.modulo2, aluna);
  assert.equal(page.initialLessonReactions[curso.aulas.aula3], "loved", "a reacao nova substitui a anterior");

  const tirada = await putProgresso({ contentId: curso.id, lessonId: curso.aulas.aula3, lessonReactions: {} });
  assert.equal(tirada.status, 200);
  page = await getLessonPageData(curso.id, curso.modulos.modulo2, aluna);
  assert.equal(page.initialLessonReactions[curso.aulas.aula3], undefined, "sem reacao de novo");

  const invalida = await putProgresso({ contentId: curso.id, lessonId: curso.aulas.aula3, lessonReactions: { [curso.aulas.aula3]: "odiei" } });
  assert.equal(invalida.status, 400);
});

test("sair da pagina manda o progresso por POST (sendBeacon) e grava igual ao PUT", async () => {
  actAs(aluna);
  const response = await POST(
    new Request("http://localhost/api/progress/lessons", {
      body: JSON.stringify({ contentId: curso.id, durationSeconds: 900, lessonId: curso.aulas.aula3, progressSeconds: 450, status: "in_progress" }),
      headers: { "content-type": "application/json" },
      method: "POST"
    })
  );

  assert.equal(response.status, 200);
  const page = await getLessonPageData(curso.id, curso.modulos.modulo2, aluna);
  assert.equal(page.initialLessonWatchStates[curso.aulas.aula3].progressPercent, 50);
  assert.equal(page.selectedModule.progress, 50, "o modulo 2 (1 aula) fica em 50%");
});

test("v3b-2 (docs/29 §4.3): so a resposta que fecha o curso leva courseCompleted (PUT e beacon); heartbeat e fim repetido nao", async () => {
  await limparProgresso(db, [contas.aluna.id]);
  actAs(aluna);
  const todas = [curso.aulas.aula1, curso.aulas.aula2, curso.aulas.aula3];

  const parcial = await (await putProgresso({ completedLessonIds: todas.slice(0, 2), contentId: curso.id, lessonId: curso.aulas.aula2, status: "completed" })).json();
  assert.deepEqual(Object.keys(parcial), ["data"], "ainda falta aula: a resposta de sempre");

  // Heartbeat no meio (sem a lista): a gravacao rele a linha e o curso continua incompleto.
  const heartbeat = await (await putProgresso({ contentId: curso.id, lessonId: curso.aulas.aula3, progressSeconds: 30 })).json();
  assert.deepEqual(Object.keys(heartbeat), ["data"]);

  const fechou = await (await putProgresso({ completedLessonIds: todas, contentId: curso.id, lessonId: curso.aulas.aula3, status: "completed" })).json();
  assert.equal(fechou.courseCompleted, true);
  assert.deepEqual((await lerProgressoNoBanco(contas.aluna.id)).completed_lesson_ids.sort(), [...todas].sort());

  // O fim do video na ultima aula repetido (a Bunny manda ended duas vezes): so a primeira virou o curso.
  const repetido = await (await putProgresso({ contentId: curso.id, lessonId: curso.aulas.aula3, progressPercent: 100, status: "completed" })).json();
  assert.equal(repetido.courseCompleted, undefined);

  // O beacon (POST) fecha igual, depois de desmarcar.
  await putProgresso({ completedLessonIds: todas.slice(0, 2), contentId: curso.id, lessonId: curso.aulas.aula3, status: "in_progress" });
  const beacon = await POST(
    new Request("http://localhost/api/progress/lessons", {
      body: JSON.stringify({ completedLessonIds: todas, contentId: curso.id, lessonId: curso.aulas.aula3, status: "completed" }),
      headers: { "content-type": "application/json" },
      method: "POST"
    })
  );
  assert.equal((await beacon.json()).courseCompleted, true);

  await limparProgresso(db, [contas.aluna.id]);
});

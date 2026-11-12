import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { LIVE_GRAVADA_NO_AR_DE_TESTE, limparWebinarios, seedEscolaDeTeste, seedLiveGravadaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// A rodada v10 dos webinarios (teste do produtor de 12/11/2026, a tarde; docs/30 D94) contra o banco LOCAL de verdade,
// com a migracao 202611160001 aplicada, na Live gravada no ar: "Marcar como vista" nas Perguntas do console.
// - o banco: as duas colunas novas existem, nulas por padrao, e quem marcou e uma conta de verdade (a chave para
//   auth.users, que fica nula se a conta sair);
// - a aluna pergunta, a equipe responde, a aluna responde no fio: o console marca "Nova resposta do aluno", conta a
//   pergunta na aba e a sobe; a equipe marca como vista e o aviso, a conta e o lugar no topo saem, sem responder nada;
//   a pergunta, a resposta e o fio continuam como estavam, e a aluna nao recebe a marca;
// - a aluna escreve de novo: o aviso volta sozinho; marcar de novo tira de novo;
// - quem nao escreve no chat (analista) recebe 403; a pergunta apagada e a que nao existe, 404.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const questionsRoute = await import("../../src/app/api/webinars/[id]/questions/route.ts");
const repliesRoute = await import("../../src/app/api/webinars/[id]/questions/[qid]/replies/route.ts");
const roomActions = await import("../../src/server/webinars/room-actions.ts");
const consoleQueries = await import("../../src/server/webinars/console-queries.ts");
const consoleModel = await import("../../src/server/webinars/console-model.ts");
const consoleV2 = await import("../../src/server/webinars/console-v2-model.ts");
const { clearV9ColumnsMemory } = await import("../../src/server/webinars/chat-store.ts");
const { clearAuthorPhotoCache } = await import("../../src/server/webinars/author-photos.ts");
const { resetRoomLimits } = await import("../../src/server/webinars/room-limits.ts");
const { CHAT_CONSENT_VERSION } = await import("../../src/server/webinars/model.ts");

const aluna = usuarioDeTeste(contas.aluna);
const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const pessoas = [aluna.id, produtor.id, analista.id];
const { id: webinarId, sessaoId } = LIVE_GRAVADA_NO_AR_DE_TESTE;
const contexto = { params: Promise.resolve({ id: webinarId }) };
const ACEITE = { consent: true, consentVersion: CHAT_CONSENT_VERSION };

const pedido = (path, method = "GET", body) =>
  new Request(`http://localhost/api/webinars/${webinarId}/${path}`, body === undefined ? { method } : { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method });
const json = async (response) => ({ body: await response.json(), status: response.status });

function ok(result) {
  assert.equal(result.ok, true, result.ok ? "" : `${result.status}: ${result.error}`);
  return result.data;
}

async function limparRastros() {
  unwrap(await db.from("student_events").delete().in("user_id", pessoas).eq("entity_type", "webinar"), "Apagando o historico de webinario de teste");
  unwrap(await db.from("notifications").delete().in("user_id", pessoas).eq("kind", "webinar"), "Apagando o sino de webinario de teste");
}

async function perguntar(body) {
  // O limite de escrita da sala (uma pergunta a cada tantos segundos) nao e o que este teste confere.
  resetRoomLimits();
  actAs(aluna);
  const resposta = await json(await questionsRoute.POST(pedido("questions", "POST", { body, sessionId: sessaoId, ...ACEITE }), contexto));
  assert.equal(resposta.status, 201, JSON.stringify(resposta.body));
  return resposta.body.data.question;
}

async function perguntasDaAluna() {
  actAs(aluna);
  const resposta = await json(await questionsRoute.GET(pedido(`questions?sessao=${sessaoId}&ordem=recentes`), contexto));
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
  return resposta.body.data.questions;
}

async function alunaRespondeNoFio(questionId, body) {
  resetRoomLimits();
  actAs(aluna);
  const resposta = await json(await repliesRoute.POST(pedido(`questions/${questionId}/replies`, "POST", { body, sessionId: sessaoId }), { params: Promise.resolve({ id: webinarId, qid: questionId }) }));
  assert.equal(resposta.status, 201, JSON.stringify(resposta.body));
  return resposta.body.data;
}

/** O que o console le desta pergunta: a linha do retrato, se pede a equipe, a conta da aba e a ordem das respondidas. */
async function noConsole(questionId) {
  actAs(produtor);
  const snapshot = await consoleQueries.getConsoleSnapshot(webinarId, sessaoId);
  assert.ok(snapshot, "o retrato do console");
  const question = snapshot.questions.find((item) => item.id === questionId);
  return {
    awaits: consoleModel.questionAwaitsTeam(question),
    count: consoleV2.consoleTabCounts({ hands: 0, questions: snapshot.questions }).perguntas,
    // A ordem do quadro so entre as respondidas (a aberta do teste 1 fica sempre no topo e nao e o assunto aqui).
    order: consoleModel.sortQuestionsForBoard(snapshot.questions.filter((item) => item.status === "answered")).map((item) => item.id),
    question
  };
}

const marca = async (questionId) => unwrap(await db.from("webinar_questions").select("thread_seen_at, thread_seen_by, status, answer_text, updated_at").eq("id", questionId).single(), "Lendo a marca gravada");

before(async () => {
  await limparWebinarios(db);
  await limparRastros();
  await seedLiveGravadaDeTeste(db, { comecouHa: 120_000 });
  resetRoomLimits();
  clearV9ColumnsMemory();
  clearAuthorPhotoCache();
});

after(async () => {
  actAs(null);
  await limparWebinarios(db);
  await limparRastros();
  clearV9ColumnsMemory();
});

test("1. o banco: a pergunta nasce sem a marca; quem marcou e uma conta de verdade (a chave para auth.users)", async () => {
  const pergunta = await perguntar("A gravação fica disponível?");
  const linha = await marca(pergunta.id);
  assert.deepEqual([linha.thread_seen_at, linha.thread_seen_by], [null, null], "nula por padrao");
  // Uma conta que nao existe e recusada (23503); a hora sozinha vale.
  const semConta = await db.from("webinar_questions").update({ thread_seen_by: "00000000-0000-4000-8000-00000000dead" }).eq("id", pergunta.id).select("id");
  assert.equal(semConta.error?.code, "23503");
  unwrap(await db.from("webinar_questions").update({ thread_seen_at: null, thread_seen_by: null }).eq("id", pergunta.id), "Voltando a pergunta de teste");
});

test("2. o console: a aluna responde no fio e o aviso aparece; Marcar como vista tira o aviso, a conta e o lugar no topo sem responder; a aluna escreve de novo e o aviso volta; marcar de novo tira", async () => {
  // A outra respondida e mais antiga: entre duas respondidas com os mesmos votos, a mais antiga vem primeiro.
  const outra = await perguntar("E material de apoio?");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const pergunta = await perguntar("Vai ter certificado?");
  actAs(produtor);
  ok(await roomActions.answerQuestion({ answerText: "Vai sim.", questionId: pergunta.id }));
  ok(await roomActions.answerQuestion({ answerText: "Tambem.", questionId: outra.id }));
  let console_ = await noConsole(pergunta.id);
  assert.equal(console_.awaits, false, "respondida, sem fala nova da aluna");
  assert.deepEqual(console_.order, [outra.id, pergunta.id], "as duas respondidas, pela hora");
  const semAviso = console_.count;

  await alunaRespondeNoFio(pergunta.id, "E quando sai?");
  console_ = await noConsole(pergunta.id);
  assert.equal(console_.awaits, true, "a aluna escreveu por ultimo");
  assert.equal(console_.count, semAviso + 1, "conta no numero da aba");
  assert.deepEqual(console_.order, [pergunta.id, outra.id], "sobe para junto do que pede a equipe");
  assert.equal(console_.question.threadSeenAt, null);

  // Marcar como vista: grava a hora do servidor e quem marcou; nada mais muda.
  const antes = await marca(pergunta.id);
  const chatAntes = unwrap(await db.from("webinar_chat_messages").select("id").eq("session_id", sessaoId), "Contando o chat").length;
  const fioAntes = unwrap(await db.from("webinar_question_replies").select("id").eq("question_id", pergunta.id), "Contando o fio").length;
  actAs(produtor);
  const marcada = ok(await roomActions.markQuestionSeen({ questionId: pergunta.id }));
  const gravada = await marca(pergunta.id);
  assert.equal(Date.parse(gravada.thread_seen_at), Date.parse(marcada.seenAt));
  assert.equal(gravada.thread_seen_by, produtor.id);
  assert.deepEqual([gravada.status, gravada.answer_text], [antes.status, antes.answer_text], "a pergunta continua respondida, com a mesma resposta");
  assert.equal(unwrap(await db.from("webinar_chat_messages").select("id").eq("session_id", sessaoId), "Contando o chat").length, chatAntes, "nada vai ao chat");
  assert.equal(unwrap(await db.from("webinar_question_replies").select("id").eq("question_id", pergunta.id), "Contando o fio").length, fioAntes, "nada entra no fio");

  console_ = await noConsole(pergunta.id);
  assert.equal(console_.awaits, false, "o aviso saiu sem a equipe responder");
  assert.equal(console_.count, semAviso);
  assert.deepEqual(console_.order, [outra.id, pergunta.id], "desce para junto das respondidas");
  assert.equal(Date.parse(console_.question.threadSeenAt), Date.parse(marcada.seenAt), "o retrato do console le a marca");
  assert.equal(console_.question.replies.length, 1, "o fio continua no console");

  // A aluna nao recebe a marca, e continua podendo responder.
  const [paraAluna] = (await perguntasDaAluna()).filter((item) => item.id === pergunta.id);
  assert.ok(!JSON.stringify(paraAluna).match(/seen/i), JSON.stringify(Object.keys(paraAluna)));
  assert.equal(paraAluna.canReply, true);
  assert.equal(paraAluna.replies.length, 1);

  // Ela escreve de novo: o aviso volta sozinho, sem ninguem desmarcar.
  await new Promise((resolve) => setTimeout(resolve, 20));
  await alunaRespondeNoFio(pergunta.id, "Pode ser por e-mail?");
  console_ = await noConsole(pergunta.id);
  assert.equal(console_.awaits, true, "a fala nova e mais nova que a marca");
  assert.equal(console_.count, semAviso + 1);
  assert.deepEqual(console_.order, [pergunta.id, outra.id]);

  // Marcar de novo tira de novo; responder no fio depois tambem continua valendo.
  await new Promise((resolve) => setTimeout(resolve, 20));
  actAs(produtor);
  const deNovo = ok(await roomActions.markQuestionSeen({ questionId: pergunta.id }));
  assert.ok(Date.parse(deNovo.seenAt) > Date.parse(marcada.seenAt));
  console_ = await noConsole(pergunta.id);
  assert.equal(console_.awaits, false);
  assert.equal(console_.count, semAviso);
});

test("3. quem nao escreve no chat (analista) recebe 403 e nada e gravado; a pergunta apagada e a que nao existe, 404", async () => {
  const pergunta = await perguntar("Tem desconto para a turma?");
  actAs(produtor);
  ok(await roomActions.answerQuestion({ answerText: "Tem.", questionId: pergunta.id }));
  await alunaRespondeNoFio(pergunta.id, "Qual o cupom?");

  actAs(analista);
  const negado = await roomActions.markQuestionSeen({ questionId: pergunta.id });
  assert.deepEqual([negado.ok, negado.status], [false, 403]);
  assert.equal((await marca(pergunta.id)).thread_seen_at, null);
  assert.equal((await noConsole(pergunta.id)).awaits, true, "o aviso continua");

  actAs(produtor);
  const inexistente = await roomActions.markQuestionSeen({ questionId: "00000000-0000-4000-8000-00000000beef" });
  assert.deepEqual([inexistente.ok, inexistente.status], [false, 404]);
  unwrap(await db.from("webinar_questions").update({ deleted_at: new Date().toISOString(), deleted_reason: "team" }).eq("id", pergunta.id), "Apagando a pergunta de teste");
  const apagada = await roomActions.markQuestionSeen({ questionId: pergunta.id });
  assert.deepEqual([apagada.ok, apagada.status], [false, 404]);
  assert.equal((await marca(pergunta.id)).thread_seen_at, null);
});

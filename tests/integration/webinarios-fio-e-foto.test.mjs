import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { LIVE_GRAVADA_NO_AR_DE_TESTE, limparWebinarios, seedEscolaDeTeste, seedLiveGravadaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// A foto do perfil na sala e o fio das Perguntas (docs/30 §1.3, §2.4 e §8.5; decisoes do produtor de 10/11/2026) contra
// o banco LOCAL de verdade, com a migracao 202611100001 aplicada:
// - a foto: a minha mensagem ja sai com a minha foto; o outro aluno ve a foto de quem aceitou o texto de agora (versao
//   2, que cita a foto) e as iniciais de quem aceitou o de antes; o que foi escrito como anonimo nunca leva foto, nem
//   para a equipe; a mensagem da equipe leva a foto de quem escreveu; o console ve a foto do aluno sem depender do aceite;
// - o fio: so quem perguntou responde (403 para o outro aluno) e so depois da resposta da equipe (409 antes); a
//   resposta aparece no fio para todos; o console marca "Nova resposta do aluno" e conta a pergunta ate a equipe
//   responder no fio; a equipe apaga uma resposta; na pergunta Anonima a resposta continua sem nome e sem foto; quem
//   nao escreve no chat (analista) recebe 403; "Remover minhas mensagens" leva tambem o que o aluno escreveu no fio.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const chatRoute = await import("../../src/app/api/webinars/[id]/chat/route.ts");
const sessionRoute = await import("../../src/app/api/webinars/[id]/session/route.ts");
const questionsRoute = await import("../../src/app/api/webinars/[id]/questions/route.ts");
const repliesRoute = await import("../../src/app/api/webinars/[id]/questions/[qid]/replies/route.ts");
const roomActions = await import("../../src/server/webinars/room-actions.ts");
const consoleQueries = await import("../../src/server/webinars/console-queries.ts");
const consoleModel = await import("../../src/server/webinars/console-model.ts");
const consoleV2 = await import("../../src/server/webinars/console-v2-model.ts");
const { clearAuthorPhotoCache } = await import("../../src/server/webinars/author-photos.ts");
const { resetRoomLimits } = await import("../../src/server/webinars/room-limits.ts");
const { CHAT_CONSENT_VERSION } = await import("../../src/server/webinars/model.ts");
const { anonymousDisplayName } = await import("../../src/server/webinars/room-model.ts");

const aluna = usuarioDeTeste(contas.aluna);
const outro = usuarioDeTeste(contas.alunoSemAcesso);
const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const pessoas = [aluna.id, outro.id, produtor.id, analista.id];
const { id: webinarId, sessaoId } = LIVE_GRAVADA_NO_AR_DE_TESTE;
const contexto = { params: Promise.resolve({ id: webinarId }) };
const FOTO = { aluna: "https://exemplo.test/fotos/aluna.jpg", outro: "https://exemplo.test/fotos/outro.jpg", produtor: "https://exemplo.test/fotos/produtor.jpg" };
const ACEITE = { consent: true, consentVersion: CHAT_CONSENT_VERSION, displayMode: "first_name_initial" };
const fotosDeAntes = new Map();

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

async function foto(userId, url) {
  unwrap(await db.from("profiles").update({ avatar_url: url }).eq("id", userId), "Gravando a foto de teste");
}

async function enviar(user, body) {
  actAs(user);
  return json(await chatRoute.POST(pedido("chat", "POST", { sessionId: sessaoId, ...body }), contexto));
}

/** As mensagens novas da sessao (o modo da consulta de 5 s), como `user` as recebe. */
async function chatDe(user) {
  actAs(user);
  const lido = await json(await chatRoute.GET(pedido(`chat?sessao=${sessaoId}&since=${encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString())}`), contexto));
  assert.equal(lido.status, 200, JSON.stringify(lido.body));
  return lido.body.data.messages;
}

async function perguntar(user, body) {
  actAs(user);
  return json(await questionsRoute.POST(pedido("questions", "POST", { sessionId: sessaoId, ...body }), contexto));
}

async function perguntasDe(user) {
  actAs(user);
  const lido = await json(await questionsRoute.GET(pedido(`questions?sessao=${sessaoId}&ordem=recentes`), contexto));
  assert.equal(lido.status, 200, JSON.stringify(lido.body));
  return lido.body.data.questions;
}

async function responderNoFio(user, questionId, body) {
  actAs(user);
  return json(await repliesRoute.POST(pedido(`questions/${questionId}/replies`, "POST", { sessionId: sessaoId, ...body }), { params: Promise.resolve({ id: webinarId, qid: questionId }) }));
}

async function retrato() {
  actAs(produtor);
  const snapshot = await consoleQueries.getConsoleSnapshot(webinarId, sessaoId);
  assert.ok(snapshot, "o retrato do console");
  return snapshot;
}

before(async () => {
  await limparWebinarios(db);
  await limparRastros();
  await seedLiveGravadaDeTeste(db, { comecouHa: 90_000 });
  for (const row of unwrap(await db.from("profiles").select("id, avatar_url").in("id", pessoas), "Lendo as fotos de antes")) {
    fotosDeAntes.set(row.id, row.avatar_url);
  }
  await foto(aluna.id, FOTO.aluna);
  await foto(outro.id, FOTO.outro);
  await foto(produtor.id, FOTO.produtor);
  resetRoomLimits();
  clearAuthorPhotoCache();
});

after(async () => {
  actAs(null);
  for (const [id, url] of fotosDeAntes) {
    await foto(id, url);
  }
  await limparWebinarios(db);
  await limparRastros();
  clearAuthorPhotoCache();
});

test("1. a foto no chat: a minha ja sai com a foto; o outro aluno ve a de quem aceitou o texto de agora; o anonimo nunca leva foto; a equipe leva a dela", async () => {
  actAs(aluna);
  const antes = await json(await sessionRoute.GET(pedido(`session?sessao=${sessaoId}`), contexto));
  assert.equal(antes.body.data.me.avatarUrl, FOTO.aluna, "a minha foto vai para o campo de escrever");

  const minha = await enviar(aluna, { ...ACEITE, body: "Oi, pessoal!" });
  assert.equal(minha.status, 201, JSON.stringify(minha.body));
  assert.equal(minha.body.data.message.avatarUrl, FOTO.aluna, "a minha mensagem ja sai com a minha foto");

  const anonima = await enviar(aluna, { anonymous: true, body: "Pergunto sem aparecer" });
  assert.equal(anonima.status, 201, JSON.stringify(anonima.body));
  assert.equal(anonima.body.data.message.displayName, anonymousDisplayName(aluna.id, webinarId));
  assert.equal(anonima.body.data.message.avatarUrl, null, "escrita como anonima: sem foto ate para mim");

  // O outro aluno aceitou o texto de antes (versao 1, que so falava do nome) e escreveu.
  unwrap(await db.from("webinar_chat_consents").insert({ consent_version: 1, display_mode: "first_name_initial", user_id: outro.id }), "Gravando o aceite antigo");
  unwrap(
    await db.from("webinar_chat_messages").insert({ approved: true, author_user_id: outro.id, body: "Cheguei", display_name: "Aluno S.", offset_ms: 60_000, role: "student", session_id: sessaoId, source: "audience", webinar_id: webinarId }),
    "Gravando a mensagem do outro aluno"
  );
  ok(await (actAs(produtor), roomActions.sendTeamMessage({ body: "Bem-vindos!", sessionId: sessaoId })));
  clearAuthorPhotoCache();

  const paraOutro = await chatDe(outro);
  const porTexto = (lista, texto) => lista.find((item) => item.body === texto);
  assert.equal(porTexto(paraOutro, "Oi, pessoal!").avatarUrl, FOTO.aluna, "o outro aluno ve a foto de quem aceitou a versao de agora");
  assert.equal(porTexto(paraOutro, "Pergunto sem aparecer").avatarUrl, null, "a anonima sem foto para os outros");
  assert.equal(porTexto(paraOutro, "Bem-vindos!").avatarUrl, FOTO.produtor, "a equipe com a foto dela");

  const paraAluna = await chatDe(aluna);
  assert.equal(porTexto(paraAluna, "Cheguei").avatarUrl, null, "quem aceitou o texto de antes fica com as iniciais para os outros alunos");

  // O console: a equipe ve a foto do aluno sem depender do aceite, mas nunca no anonimo.
  const console_ = await retrato();
  assert.equal(porTexto(console_.messages, "Cheguei").avatarUrl, FOTO.outro);
  assert.equal(porTexto(console_.messages, "Oi, pessoal!").avatarUrl, FOTO.aluna);
  assert.equal(porTexto(console_.messages, "Pergunto sem aparecer").avatarUrl, null, "nem a equipe ve a foto no anonimo");
  assert.equal(porTexto(console_.messages, "Bem-vindos!").avatarUrl, FOTO.produtor);
});

let pergunta = null;

test("2. o fio: antes da resposta ninguem responde (409); o outro aluno nunca (403); depois da resposta, quem perguntou responde e todos veem", async () => {
  const feita = await perguntar(aluna, { anonymous: false, body: "Vai ter replay?" });
  assert.equal(feita.status, 201, JSON.stringify(feita.body));
  pergunta = feita.body.data.question;
  assert.equal(pergunta.avatarUrl, FOTO.aluna, "a pergunta com a foto de quem perguntou");
  assert.deepEqual(pergunta.replies, []);
  assert.equal(pergunta.canReply, false, "sem resposta da equipe, nada a comentar");

  const cedo = await responderNoFio(aluna, pergunta.id, { body: "Alguem?" });
  assert.equal(cedo.status, 409, JSON.stringify(cedo.body));

  actAs(analista);
  const semPermissao = await roomActions.replyToQuestion({ body: "Oi", questionId: pergunta.id });
  assert.deepEqual([semPermissao.ok, semPermissao.status], [false, 403]);

  actAs(produtor);
  const equipeCedo = await roomActions.replyToQuestion({ body: "Continua a conversa", questionId: pergunta.id });
  assert.deepEqual([equipeCedo.ok, equipeCedo.status], [false, 409], "a primeira resposta e o Responder por escrito");
  ok(await roomActions.answerQuestion({ answerText: "Vai, fica 7 dias.", questionId: pergunta.id }));

  const intruso = await responderNoFio(outro, pergunta.id, { ...ACEITE, body: "Eu tambem quero saber" });
  assert.equal(intruso.status, 403, JSON.stringify(intruso.body));

  const resposta = await responderNoFio(aluna, pergunta.id, { body: "  E fica no app também?  " });
  assert.equal(resposta.status, 201, JSON.stringify(resposta.body));
  const reply = resposta.body.data.reply;
  assert.equal(reply.body, "E fica no app também?");
  assert.deepEqual([reply.mine, reply.role, reply.anonymous, reply.avatarUrl], [true, "student", false, FOTO.aluna]);

  const linha = unwrap(await db.from("webinar_question_replies").select("*").eq("id", reply.id).single(), "Lendo a resposta do fio");
  assert.deepEqual([linha.question_id, linha.session_id, linha.user_id, linha.role, linha.deleted_at], [pergunta.id, sessaoId, aluna.id, "student", null]);
  const eventos = unwrap(await db.from("student_events").select("event_type, metadata").eq("user_id", aluna.id).eq("event_type", "webinar_question_reply_sent"), "Lendo o historico");
  assert.equal(eventos.length, 1, "o historico registra a resposta");
  assert.deepEqual(Object.keys(eventos[0].metadata).sort(), ["length", "question_id", "reply_id"], "sem o texto");

  const [paraAluna] = (await perguntasDe(aluna)).filter((item) => item.id === pergunta.id);
  assert.equal(paraAluna.canReply, true);
  assert.deepEqual(paraAluna.replies.map((item) => [item.body, item.mine]), [["E fica no app também?", true]]);
  const [paraOutro] = (await perguntasDe(outro)).filter((item) => item.id === pergunta.id);
  assert.equal(paraOutro.canReply, false, "o outro aluno le o fio, mas nao escreve");
  assert.deepEqual(paraOutro.replies.map((item) => [item.body, item.mine, item.avatarUrl]), [["E fica no app também?", false, FOTO.aluna]]);
});

test("3. o console: 'Nova resposta do aluno' conta e sobe ate a equipe responder no fio; a resposta da equipe leva o papel e a foto; a equipe apaga uma resposta", async () => {
  let console_ = await retrato();
  let noConsole = console_.questions.find((item) => item.id === pergunta.id);
  assert.equal(noConsole.replies.length, 1);
  assert.equal(noConsole.replies[0].avatarUrl, FOTO.aluna);
  assert.equal(consoleModel.questionAwaitsTeam(noConsole), true);
  assert.equal(consoleV2.consoleTabCounts({ hands: 0, questions: console_.questions }).perguntas, 1, "a respondida que espera a equipe conta no numero da aba");
  assert.equal(consoleModel.sortQuestionsForBoard(console_.questions)[0].id, pergunta.id);

  actAs(produtor);
  const daEquipe = ok(await roomActions.replyToQuestion({ body: "Fica sim, na página do webinário.", questionId: pergunta.id }));
  assert.deepEqual([daEquipe.reply.role, daEquipe.reply.anonymous], ["host", false], "quem apresenta responde como Apresentador");

  console_ = await retrato();
  noConsole = console_.questions.find((item) => item.id === pergunta.id);
  assert.equal(consoleModel.questionAwaitsTeam(noConsole), false, "a equipe respondeu por ultimo");
  assert.equal(consoleV2.consoleTabCounts({ hands: 0, questions: console_.questions }).perguntas, 0);

  const [paraOutro] = (await perguntasDe(outro)).filter((item) => item.id === pergunta.id);
  assert.deepEqual(
    paraOutro.replies.map((item) => [item.role, item.avatarUrl]),
    [
      ["student", FOTO.aluna],
      ["host", FOTO.produtor]
    ],
    "o fio em ordem, com o papel e a foto de cada um"
  );

  // A equipe apaga a resposta dela; a do aluno fica.
  actAs(analista);
  const semPermissao = await roomActions.deleteQuestionReply({ replyId: daEquipe.reply.id });
  assert.deepEqual([semPermissao.ok, semPermissao.status], [false, 403]);
  actAs(produtor);
  ok(await roomActions.deleteQuestionReply({ replyId: daEquipe.reply.id }));
  const deNovo = await roomActions.deleteQuestionReply({ replyId: daEquipe.reply.id });
  assert.deepEqual([deNovo.ok, deNovo.status], [false, 404], "a apagada nao existe mais");
  const [depois] = (await perguntasDe(aluna)).filter((item) => item.id === pergunta.id);
  assert.deepEqual(depois.replies.map((item) => item.role), ["student"]);
  const apagada = unwrap(await db.from("webinar_question_replies").select("deleted_at, deleted_by, deleted_reason").eq("id", daEquipe.reply.id).single(), "Lendo a apagada");
  assert.deepEqual([apagada.deleted_by, apagada.deleted_reason, apagada.deleted_at !== null], [produtor.id, "team", true]);
});

test("4. a pergunta Anonima: a resposta de quem perguntou continua sem nome e sem foto, para os alunos e para a equipe", async () => {
  const feita = await perguntar(aluna, { anonymous: true, body: "Posso perguntar sem aparecer?" });
  assert.equal(feita.status, 201, JSON.stringify(feita.body));
  const anonima = feita.body.data.question;
  assert.deepEqual([anonima.anonymous, anonima.avatarUrl], [true, null]);
  actAs(produtor);
  ok(await roomActions.answerQuestion({ answeredLive: true, questionId: anonima.id }));

  const resposta = await responderNoFio(aluna, anonima.id, { body: "Obrigada!" });
  assert.equal(resposta.status, 201, JSON.stringify(resposta.body));
  assert.deepEqual([resposta.body.data.reply.anonymous, resposta.body.data.reply.avatarUrl, resposta.body.data.reply.displayName], [true, null, anonima.displayName]);

  const [paraOutro] = (await perguntasDe(outro)).filter((item) => item.id === anonima.id);
  assert.deepEqual(paraOutro.replies.map((item) => [item.anonymous, item.avatarUrl]), [[true, null]]);
  const noConsole = (await retrato()).questions.find((item) => item.id === anonima.id);
  assert.equal(noConsole.avatarUrl, null);
  assert.deepEqual(noConsole.replies.map((item) => [item.anonymous, item.avatarUrl ?? null]), [[true, null]]);
});

test("5. 'Remover minhas mensagens' leva tambem o que o aluno escreveu no fio", async () => {
  actAs(aluna);
  const removido = await json(await chatRoute.DELETE(pedido("chat", "DELETE", { all: true }), contexto));
  assert.equal(removido.status, 200, JSON.stringify(removido.body));
  const linhas = unwrap(await db.from("webinar_question_replies").select("deleted_at, deleted_reason").eq("user_id", aluna.id), "Lendo o fio depois de remover");
  assert.ok(linhas.length >= 2);
  assert.ok(linhas.every((linha) => linha.deleted_at !== null && linha.deleted_reason === "consent_revoked"));
});

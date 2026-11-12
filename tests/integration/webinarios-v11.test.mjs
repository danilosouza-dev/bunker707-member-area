import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import { LIVE_GRAVADA_NO_AR_DE_TESTE, limparWebinarios, seedEscolaDeTeste, seedLiveGravadaDeTeste, SENHA_DE_TESTE, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// A rodada v11 dos webinarios (terceiro teste do produtor de 12/11/2026; docs/30 D101 e D102) contra o banco LOCAL de
// verdade, com a migracao 202611170001 aplicada, na Live gravada no ar:
// - o banco: o aluno logado nao le webinar_question_likes (so o service_role); uma curtida por pessoa em cada alvo; a
//   resposta do fio apagada do banco leva as curtidas dela;
// - o aluno curte a resposta escrita e uma resposta do fio pela rota da sala: a contagem e a curtida dele voltam na
//   leitura das perguntas; o outro aluno ve o total sem a curtida dele; curtir de novo tira; a pergunta sem resposta
//   escrita e a resposta de outra pergunta respondem 404;
// - a equipe curte pelo console a pergunta, a resposta e a resposta do fio: o retrato do console traz os totais e as
//   curtidas de quem pede; o analista (sem escrever no chat) recebe 403;
// - mostrar quantas pessoas estao na sala: desligada no webinario, o retrato da sala e o sinal de 15 s vao com o numero
//   zerado e `presentHidden`; ligada de novo, o numero volta.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const { anonKey, url: supabaseUrl } = readLocalSupabaseConfig();
const questionsRoute = await import("../../src/app/api/webinars/[id]/questions/route.ts");
const repliesRoute = await import("../../src/app/api/webinars/[id]/questions/[qid]/replies/route.ts");
const likeRoute = await import("../../src/app/api/webinars/[id]/questions/[qid]/like/route.ts");
const sessionRoute = await import("../../src/app/api/webinars/[id]/session/route.ts");
const heartbeatRoute = await import("../../src/app/api/webinars/[id]/heartbeat/route.ts");
const roomActions = await import("../../src/server/webinars/room-actions.ts");
const consoleQueries = await import("../../src/server/webinars/console-queries.ts");
const { clearV9ColumnsMemory } = await import("../../src/server/webinars/chat-store.ts");
const { clearAuthorPhotoCache } = await import("../../src/server/webinars/author-photos.ts");
const { resetRoomLimits } = await import("../../src/server/webinars/room-limits.ts");
const { resetRoomAccessCache } = await import("../../src/server/webinars/room-route.ts");
const { CHAT_CONSENT_VERSION } = await import("../../src/server/webinars/model.ts");

const aluna = usuarioDeTeste(contas.aluna);
const outro = usuarioDeTeste(contas.alunoSemAcesso);
const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const pessoas = [aluna.id, outro.id, produtor.id, analista.id];
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
  resetRoomLimits();
  actAs(aluna);
  const resposta = await json(await questionsRoute.POST(pedido("questions", "POST", { body, sessionId: sessaoId, ...ACEITE }), contexto));
  assert.equal(resposta.status, 201, JSON.stringify(resposta.body));
  return resposta.body.data.question;
}

async function perguntasDe(user) {
  actAs(user);
  const resposta = await json(await questionsRoute.GET(pedido(`questions?sessao=${sessaoId}&ordem=recentes`), contexto));
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
  return resposta.body.data.questions;
}

async function alunaRespondeNoFio(questionId, body) {
  resetRoomLimits();
  actAs(aluna);
  const resposta = await json(await repliesRoute.POST(pedido(`questions/${questionId}/replies`, "POST", { body, sessionId: sessaoId }), { params: Promise.resolve({ id: webinarId, qid: questionId }) }));
  assert.equal(resposta.status, 201, JSON.stringify(resposta.body));
  return resposta.body.data.reply;
}

/** O aluno curte (ou tira a curtida de) a resposta escrita (`replyId` nulo) ou uma resposta do fio, pela rota da sala. */
async function curtir(user, questionId, replyId = null) {
  resetRoomLimits();
  actAs(user);
  return json(await likeRoute.POST(pedido(`questions/${questionId}/like`, "POST", { replyId, sessionId: sessaoId }), { params: Promise.resolve({ id: webinarId, qid: questionId }) }));
}

const curtidasDe = async (questionId) =>
  unwrap(await db.from("webinar_question_likes").select("question_id, reply_id, session_id, user_id").eq("question_id", questionId).order("created_at", { ascending: true }), "Lendo as curtidas gravadas");

async function configurar(roomSettings) {
  const atual = unwrap(await db.from("webinars").select("room_settings").eq("id", webinarId).single(), "Lendo as configuracoes da sala").room_settings ?? {};
  unwrap(await db.from("webinars").update({ room_settings: { ...atual, ...roomSettings } }).eq("id", webinarId), "Gravando as configuracoes da sala");
  resetRoomAccessCache();
}

let pergunta;
let aberta;
let doProdutorNoFio;
let daAlunaNoFio;

before(async () => {
  await limparWebinarios(db);
  await limparRastros();
  await seedLiveGravadaDeTeste(db, { comecouHa: 120_000 });
  resetRoomLimits();
  resetRoomAccessCache();
  clearV9ColumnsMemory();
  clearAuthorPhotoCache();
  // A aluna pergunta duas vezes; a equipe responde a primeira por escrito; ela agradece no fio e a equipe responde.
  aberta = await perguntar("E o material de apoio?");
  pergunta = await perguntar("A gravação fica disponível?");
  actAs(produtor);
  ok(await roomActions.answerQuestion({ answerText: "Fica sim, por 30 dias.", questionId: pergunta.id }));
  daAlunaNoFio = await alunaRespondeNoFio(pergunta.id, "Obrigada!");
  actAs(produtor);
  doProdutorNoFio = ok(await roomActions.replyToQuestion({ body: "De nada.", questionId: pergunta.id })).reply;
});

after(async () => {
  actAs(null);
  await configurar({ showPresentCount: true });
  await limparWebinarios(db);
  await limparRastros();
  clearV9ColumnsMemory();
});

test("1. o banco: o aluno logado nao le as curtidas; uma por pessoa em cada alvo; a resposta do fio apagada do banco leva as curtidas dela", async () => {
  const cliente = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  unwrap(await cliente.auth.signInWithPassword({ email: contas.aluna.email, password: SENHA_DE_TESTE }), "Entrando como a aluna");
  const negado = await cliente.from("webinar_question_likes").select("id").limit(1);
  assert.equal(negado.error?.code, "42501", JSON.stringify(negado.error));
  await cliente.auth.signOut();

  const linha = (extra = {}) => ({ question_id: pergunta.id, reply_id: null, session_id: sessaoId, user_id: outro.id, ...extra });
  const codigo = async (row) => (await db.from("webinar_question_likes").insert(row).select("id").maybeSingle()).error?.code ?? null;
  assert.equal(await codigo(linha()), null, "a curtida da resposta escrita");
  assert.equal(await codigo(linha()), "23505", "a mesma pessoa, a mesma resposta escrita");
  // Uma resposta do fio so para este teste, apagada no fim.
  const descartavel = unwrap(
    await db
      .from("webinar_question_replies")
      .insert({ anonymous: false, body: "linha de teste", display_name: "Equipe", question_id: pergunta.id, role: "host", session_id: sessaoId, user_id: produtor.id })
      .select("id")
      .single(),
    "Gravando a resposta descartavel"
  );
  assert.equal(await codigo(linha({ reply_id: descartavel.id })), null, "a mesma pessoa noutro alvo");
  assert.equal(await codigo(linha({ reply_id: descartavel.id })), "23505", "a mesma pessoa, a mesma resposta do fio");
  assert.equal(await codigo(linha({ reply_id: descartavel.id, user_id: aluna.id })), null, "outra pessoa, o mesmo alvo");
  assert.equal(await codigo(linha({ user_id: "00000000-0000-4000-8000-00000000dead" })), "23503", "a conta precisa existir");
  // A resposta apagada do banco (a retencao) leva as curtidas dela; a da resposta escrita fica.
  unwrap(await db.from("webinar_question_replies").delete().eq("id", descartavel.id), "Apagando a resposta descartavel");
  assert.deepEqual((await curtidasDe(pergunta.id)).map((row) => [row.reply_id, row.user_id]), [[null, outro.id]]);
  unwrap(await db.from("webinar_question_likes").delete().eq("question_id", pergunta.id), "Limpando as curtidas do teste 1");
});

test("2. o aluno curte a resposta escrita e uma resposta do fio: a contagem e a curtida dele voltam na leitura; o outro aluno ve o total; de novo, tira; o que nao existe, 404", async () => {
  const daResposta = await curtir(aluna, pergunta.id);
  assert.equal(daResposta.status, 200, JSON.stringify(daResposta.body));
  assert.deepEqual(daResposta.body.data, { liked: true, likes: 1 });
  const doFio = await curtir(aluna, pergunta.id, doProdutorNoFio.id);
  assert.deepEqual(doFio.body.data, { liked: true, likes: 1 });
  const doOutro = await curtir(outro, pergunta.id, doProdutorNoFio.id);
  assert.deepEqual(doOutro.body.data, { liked: true, likes: 2 }, "o outro aluno tambem curte");
  assert.deepEqual(
    (await curtidasDe(pergunta.id)).map((row) => [row.reply_id, row.session_id, row.user_id]),
    [
      [null, sessaoId, aluna.id],
      [doProdutorNoFio.id, sessaoId, aluna.id],
      [doProdutorNoFio.id, sessaoId, outro.id]
    ]
  );

  // A leitura das perguntas: para a aluna, as curtidas dela marcadas; para o outro, so a dele.
  const [paraAluna] = (await perguntasDe(aluna)).filter((item) => item.id === pergunta.id);
  assert.deepEqual([paraAluna.answerLiked, paraAluna.answerLikes], [true, 1]);
  assert.deepEqual(
    paraAluna.replies.map((item) => [item.id, item.liked, item.likes]),
    [
      [daAlunaNoFio.id, false, 0],
      [doProdutorNoFio.id, true, 2]
    ]
  );
  const [paraOutro] = (await perguntasDe(outro)).filter((item) => item.id === pergunta.id);
  assert.deepEqual([paraOutro.answerLiked, paraOutro.answerLikes], [false, 1]);
  assert.deepEqual(paraOutro.replies.map((item) => [item.liked, item.likes]), [[false, 0], [true, 2]]);
  assert.doesNotMatch(JSON.stringify(paraOutro), new RegExp(aluna.id), "quem curtiu nao sai para a turma");
  // A pergunta aberta: sem resposta escrita, sem curtida de resposta.
  const [semResposta] = (await perguntasDe(aluna)).filter((item) => item.id === aberta.id);
  assert.deepEqual([semResposta.answerLiked, semResposta.answerLikes], [false, 0]);

  // De novo: tira so a do alvo tocado.
  const tirou = await curtir(aluna, pergunta.id);
  assert.deepEqual(tirou.body.data, { liked: false, likes: 0 });
  assert.deepEqual((await curtidasDe(pergunta.id)).map((row) => [row.reply_id, row.user_id]), [[doProdutorNoFio.id, aluna.id], [doProdutorNoFio.id, outro.id]]);

  // O que nao existe para curtir: 404, sem gravar.
  const antes = (await curtidasDe(pergunta.id)).length;
  assert.equal((await curtir(aluna, aberta.id)).status, 404, "a pergunta sem resposta escrita");
  assert.equal((await curtir(aluna, aberta.id, doProdutorNoFio.id)).status, 404, "a resposta do fio de outra pergunta");
  assert.equal((await curtir(aluna, pergunta.id, "00000000-0000-4000-8000-00000000beef")).status, 404);
  assert.equal((await curtir(aluna, "00000000-0000-4000-8000-00000000beef")).status, 404);
  assert.equal((await curtidasDe(pergunta.id)).length, antes);
  assert.equal((await curtidasDe(aberta.id)).length, 0);
});

test("3. a equipe curte pelo console a pergunta, a resposta e a resposta do fio: o retrato do console traz os totais e as curtidas de quem pede; o analista recebe 403", async () => {
  actAs(produtor);
  const naPergunta = ok(await roomActions.likeQuestionItem({ questionId: pergunta.id, target: "question" }));
  assert.deepEqual([naPergunta.liked, naPergunta.likes], [true, 1]);
  const naResposta = ok(await roomActions.likeQuestionItem({ questionId: pergunta.id, target: "answer" }));
  assert.deepEqual([naResposta.liked, naResposta.likes], [true, 1]);
  const noFio = ok(await roomActions.likeQuestionItem({ questionId: pergunta.id, replyId: daAlunaNoFio.id, target: "reply" }));
  assert.deepEqual([noFio.liked, noFio.likes], [true, 1]);

  // O retrato do console de quem curtiu: tudo marcado, com os totais (os dois alunos continuam na resposta do produtor).
  const doProdutor = await consoleQueries.getConsoleSnapshot(webinarId, sessaoId, new Date(), produtor.id);
  const noConsole = doProdutor.questions.find((item) => item.id === pergunta.id);
  assert.deepEqual([noConsole.voted, noConsole.upvotes, noConsole.answerLiked, noConsole.answerLikes], [true, 1, true, 1]);
  assert.deepEqual(
    noConsole.replies.map((item) => [item.id, item.liked, item.likes]),
    [
      [daAlunaNoFio.id, true, 1],
      [doProdutorNoFio.id, false, 2]
    ]
  );
  // Outra pessoa da equipe (ou o retrato sem quem pede): os mesmos totais, nada marcado.
  const semQuemPede = await consoleQueries.getConsoleSnapshot(webinarId, sessaoId, new Date());
  const paraOutros = semQuemPede.questions.find((item) => item.id === pergunta.id);
  assert.deepEqual([paraOutros.voted, paraOutros.upvotes, paraOutros.answerLiked, paraOutros.answerLikes], [false, 1, false, 1]);
  assert.deepEqual(paraOutros.replies.map((item) => [item.liked, item.likes]), [[false, 1], [false, 2]]);
  // A aluna ve a curtida da equipe no total, sem saber de quem e.
  const [paraAluna] = (await perguntasDe(aluna)).filter((item) => item.id === pergunta.id);
  assert.deepEqual([paraAluna.answerLikes, paraAluna.upvotes, paraAluna.voted], [1, 1, false]);
  assert.deepEqual(paraAluna.replies.map((item) => item.likes), [1, 2]);

  // De novo: tira.
  actAs(produtor);
  assert.deepEqual([ok(await roomActions.likeQuestionItem({ questionId: pergunta.id, target: "question" })).liked], [false]);
  assert.deepEqual([ok(await roomActions.likeQuestionItem({ questionId: pergunta.id, target: "answer" })).likes], [0]);

  // Quem nao escreve no chat nao curte pelo console.
  actAs(analista);
  const negado = await roomActions.likeQuestionItem({ questionId: pergunta.id, target: "answer" });
  assert.deepEqual([negado.ok, negado.status], [false, 403]);
});

test("4. mostrar quantas pessoas estao na sala: desligada, o retrato e o sinal de 15 s vao com o numero zerado e presentHidden; ligada de novo, o numero volta", async () => {
  const retrato = async () => {
    actAs(aluna);
    const resposta = await json(await sessionRoute.GET(pedido(`session?sessao=${sessaoId}`), contexto));
    assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
    return resposta.body.data;
  };
  const sinal = async () => {
    actAs(aluna);
    const resposta = await json(await heartbeatRoute.POST(pedido("heartbeat", "POST", { offsetSeconds: 120, sessionId: sessaoId, state: "playing", visible: true }), contexto));
    assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
    return resposta.body.data;
  };

  // Ligada (o padrao): a aluna presente conta.
  assert.equal((await sinal()).presentNow, 1);
  const ligada = await retrato();
  assert.deepEqual([ligada.presentHidden, ligada.presentNow], [false, 1]);

  // A equipe desliga: o numero nao sai do servidor.
  await configurar({ showPresentCount: false });
  assert.equal((await sinal()).presentNow, 0);
  const desligada = await retrato();
  assert.deepEqual([desligada.presentHidden, desligada.presentNow], [true, 0]);
  // A equipe continua vendo no console.
  actAs(produtor);
  assert.equal((await consoleQueries.getConsoleSnapshot(webinarId, sessaoId, new Date(), produtor.id)).presentNow, 1);

  // Ligada de novo: volta.
  await configurar({ showPresentCount: true });
  assert.equal((await sinal()).presentNow, 1);
  assert.deepEqual([(await retrato()).presentHidden, (await retrato()).presentNow], [false, 1]);
});

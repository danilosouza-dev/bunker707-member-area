import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { LIVE_GRAVADA_NO_AR_DE_TESTE, limparWebinarios, seedEscolaDeTeste, seedLiveGravadaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// A foto do perfil na sala e o fio das Perguntas (docs/30 §1.3, §2.4 e §8.5; decisoes do produtor de 10/11/2026) contra
// o banco LOCAL de verdade, com a migracao 202611100001 aplicada:
// - a foto (D115, 13/11/2026): a minha mensagem ja sai com a minha foto; o outro aluno ve a foto de quem a enviou pelo
//   Perfil, com ou sem o aceite do chat (antes do D115, quem aceitou o texto de antes ficava com as iniciais); a
//   mensagem da equipe leva a foto de quem escreveu; o console ve a mesma foto;
// - sem anonimato e sem apelido (D64, 10/11/2026): o pedido de uma pagina antiga que ainda pede anonimo e recusado
//   com 400 e nada e gravado; o aceite antigo com modo anonimo ou apelido, mesmo na versao de agora, conta como sem
//   aceite (409 nas escritas; a foto aparece assim mesmo, D115) ate o aluno aceitar de novo, e ai grava first_name_initial;
// - legado (linhas de antes de 10/11/2026, postas direto no banco): a mensagem gravada como "Aluno {n}" e a pergunta
//   gravada como anonima continuam sem foto, nem para a equipe, e a resposta de quem perguntou herda o nome gravado;
// - o fio: so quem perguntou responde (403 para o outro aluno) e so depois da resposta da equipe (409 antes); a
//   resposta aparece no fio para todos; o console marca "Nova resposta do aluno" e conta a pergunta ate a equipe
//   responder no fio; a equipe apaga uma resposta; quem
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
const { anonymousDisplayName, firstNameInitial } = await import("../../src/server/webinars/room-model.ts");

const aluna = usuarioDeTeste(contas.aluna);
const outro = usuarioDeTeste(contas.alunoSemAcesso);
const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const pessoas = [aluna.id, outro.id, produtor.id, analista.id];
const { id: webinarId, sessaoId } = LIVE_GRAVADA_NO_AR_DE_TESTE;
const contexto = { params: Promise.resolve({ id: webinarId }) };
// A sala so mostra o arquivo enviado pelo Perfil (avatars/{id}/arquivo no bucket), com o endereco montado pela origem do
// nosso Supabase (author-photos.roomPhotoUrl): o arquivo nao precisa existir, so o endereco.
const fotoNoBucket = (id) => db.storage.from("content-assets").getPublicUrl(`avatars/${id}/foto.webp`).data.publicUrl;
const FOTO = { aluna: fotoNoBucket(aluna.id), outro: fotoNoBucket(outro.id), produtor: fotoNoBucket(produtor.id) };
const ACEITE = { consent: true, consentVersion: CHAT_CONSENT_VERSION };
const FRASE_DA_PAGINA_ANTIGA = "A participação anônima ou com apelido não está mais disponível. Atualize a página para continuar.";
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

test("1. a foto no chat: a minha ja sai com a foto; o outro aluno ve a foto do Perfil de quem escreveu, com ou sem o aceite de agora (D115); a pagina antiga que pede anonimo e recusada; a mensagem anonima de antes (legado) nunca leva foto; a equipe leva a dela", async () => {
  actAs(aluna);
  const antes = await json(await sessionRoute.GET(pedido(`session?sessao=${sessaoId}`), contexto));
  assert.equal(antes.body.data.me.avatarUrl, FOTO.aluna, "a minha foto vai para o campo de escrever");

  const minha = await enviar(aluna, { ...ACEITE, body: "Oi, pessoal!" });
  assert.equal(minha.status, 201, JSON.stringify(minha.body));
  assert.equal(minha.body.data.message.avatarUrl, FOTO.aluna, "a minha mensagem ja sai com a minha foto");

  assert.equal(minha.body.data.message.displayName, "Aluna T.", "o primeiro nome com a inicial do sobrenome");

  // D64: a pagina aberta com o codigo de antes ainda pede anonimo ou apelido. 400, e nada e gravado no banco de verdade.
  for (const antigo of [{ anonymous: true }, { displayMode: "anonymous" }, { displayMode: "nickname", nickname: "aninha" }]) {
    const recusada = await enviar(aluna, { ...antigo, body: "Pergunto sem aparecer (pagina antiga)" });
    assert.equal(recusada.status, 400, `${JSON.stringify(antigo)}: ${JSON.stringify(recusada.body)}`);
    assert.equal(recusada.body.error, FRASE_DA_PAGINA_ANTIGA);
  }
  const recusadas = unwrap(await db.from("webinar_chat_messages").select("id").eq("session_id", sessaoId).eq("body", "Pergunto sem aparecer (pagina antiga)"), "Lendo as recusadas");
  assert.equal(recusadas.length, 0, "a mensagem pedida como anonima nao foi gravada (nem com o nome, nem sem)");
  const aceiteDaAluna = unwrap(await db.from("webinar_chat_consents").select("display_mode, nickname").eq("user_id", aluna.id).single(), "Lendo o aceite da aluna");
  assert.deepEqual(aceiteDaAluna, { display_mode: "first_name_initial", nickname: null });

  // Legado: linhas de antes de 10/11/2026. Uma mensagem gravada na epoca com o nome anonimo da aluna ("Aluno {n}"),
  // posta direto no banco: continua aparecendo como foi gravada e sem foto para todo mundo.
  unwrap(
    await db
      .from("webinar_chat_messages")
      .insert({ approved: true, author_user_id: aluna.id, body: "Pergunto sem aparecer", display_name: anonymousDisplayName(aluna.id, webinarId), offset_ms: 50_000, role: "student", session_id: sessaoId, source: "audience", webinar_id: webinarId }),
    "Gravando a mensagem anonima de antes"
  );

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
  assert.equal(porTexto(paraOutro, "Pergunto sem aparecer").avatarUrl, null, "a anonima de antes sem foto para os outros");
  assert.match(porTexto(paraOutro, "Pergunto sem aparecer").displayName, /^Aluno \d{3}$/, "e com o nome gravado na epoca");
  assert.equal(porTexto(paraOutro, "Bem-vindos!").avatarUrl, FOTO.produtor, "a equipe com a foto dela");

  const paraAluna = await chatDe(aluna);
  assert.equal(porTexto(paraAluna, "Cheguei").avatarUrl, FOTO.outro, "quem aceitou o texto de antes aparece com a foto do Perfil (D115)");
  assert.equal(porTexto(paraAluna, "Pergunto sem aparecer").avatarUrl, null, "a anonima de antes sem foto ate para quem escreveu");

  // O console: a mesma foto, nunca no anonimo.
  const console_ = await retrato();
  assert.equal(porTexto(console_.messages, "Cheguei").avatarUrl, FOTO.outro);
  assert.equal(porTexto(console_.messages, "Oi, pessoal!").avatarUrl, FOTO.aluna);
  assert.equal(porTexto(console_.messages, "Pergunto sem aparecer").avatarUrl, null, "nem a equipe ve a foto no anonimo");
  assert.equal(porTexto(console_.messages, "Bem-vindos!").avatarUrl, FOTO.produtor);
});

test("1b. D64, o aceite antigo com anonimo ou apelido na versao de agora conta como sem aceite: consented falso, 409 nas escritas, e a foto do Perfil aparece assim mesmo (D115); aceitar de novo grava first_name_initial sem apelido", async () => {
  for (const [modo, apelido] of [
    ["anonymous", null],
    ["nickname", "Apelido Antigo"]
  ]) {
    // A linha de aceite de antes de 10/11/2026, na versao de agora, com o modo antigo (o check do banco ainda aceita).
    unwrap(
      await db.from("webinar_chat_consents").upsert({ consent_version: CHAT_CONSENT_VERSION, consented_at: new Date().toISOString(), display_mode: modo, nickname: apelido, revoked_at: null, user_id: outro.id }, { onConflict: "user_id" }),
      `Gravando o aceite antigo (${modo})`
    );
    clearAuthorPhotoCache();

    const porTexto = (lista, texto) => lista.find((item) => item.body === texto);
    assert.equal(porTexto(await chatDe(aluna), "Cheguei").avatarUrl, FOTO.outro, `${modo}: sem o aceite em dia, a foto do Perfil aparece para os outros alunos (D115)`);
    actAs(outro);
    const sessao = await json(await sessionRoute.GET(pedido(`session?sessao=${sessaoId}`), contexto));
    // Sem aceite, a caixa do aceite de novo; o proprio nome e a propria foto ja vem para o avatar do campo (D82), nunca o
    // apelido antigo.
    assert.deepEqual(
      [sessao.body.data.me.consented, sessao.body.data.me.displayName, sessao.body.data.me.avatarUrl],
      [false, firstNameInitial(contas.alunoSemAcesso.nome), FOTO.outro],
      `${modo}: a sala mostra a caixa do aceite de novo`
    );
    assert.ok(!("displayMode" in sessao.body.data.me) && !("nickname" in sessao.body.data.me) && !("anonymousQuestions" in sessao.body.data.session));

    const semAceite = await enviar(outro, { body: `Sem aceitar (${modo})` });
    assert.equal(semAceite.status, 409, JSON.stringify(semAceite.body));
    assert.equal(semAceite.body.reason, "consent_required");
    const perguntaSemAceite = await perguntar(outro, { body: `Pergunta sem aceitar (${modo})` });
    assert.equal(perguntaSemAceite.status, 409, JSON.stringify(perguntaSemAceite.body));
    assert.equal(perguntaSemAceite.body.reason, "consent_required");
    const antes = unwrap(await db.from("webinar_chat_consents").select("display_mode, nickname").eq("user_id", outro.id).single(), "Lendo o aceite antes");
    assert.deepEqual(antes, { display_mode: modo, nickname: apelido }, "a linha antiga fica como estava ate o aluno aceitar");

    const aceitou = await enviar(outro, { ...ACEITE, body: `Aceitei de novo (${modo})` });
    assert.equal(aceitou.status, 201, JSON.stringify(aceitou.body));
    assert.equal(aceitou.body.data.message.avatarUrl, FOTO.outro);
    assert.doesNotMatch(aceitou.body.data.message.displayName, /^Aluno \d{3}$|Apelido Antigo/, "o nome e o primeiro nome com a inicial, nunca o anonimo nem o apelido");
    const depois = unwrap(await db.from("webinar_chat_consents").select("consent_version, display_mode, nickname, revoked_at").eq("user_id", outro.id).single(), "Lendo o aceite depois");
    assert.deepEqual(depois, { consent_version: CHAT_CONSENT_VERSION, display_mode: "first_name_initial", nickname: null, revoked_at: null });
    const paraAluna = await chatDe(aluna);
    assert.equal(porTexto(paraAluna, `Aceitei de novo (${modo})`).avatarUrl, FOTO.outro, `${modo}: com o aceite de agora, a mesma foto para os outros alunos`);
    assert.equal(porTexto(paraAluna, `Sem aceitar (${modo})`), undefined, "a recusada nao foi gravada");
    resetRoomLimits();
  }
  const semPerguntas = unwrap(await db.from("webinar_questions").select("id").eq("session_id", sessaoId).eq("user_id", outro.id), "Lendo as perguntas do outro aluno");
  assert.equal(semPerguntas.length, 0, "nenhuma pergunta gravada sem o aceite");
});

let pergunta = null;

test("2. o fio: antes da resposta ninguem responde (409); o outro aluno nunca (403); depois da resposta, quem perguntou responde e todos veem", async () => {
  const feita = await perguntar(aluna, { body: "Vai ter replay?" });
  assert.equal(feita.status, 201, JSON.stringify(feita.body));
  pergunta = feita.body.data.question;
  assert.deepEqual([pergunta.anonymous, pergunta.displayName], [false, "Aluna T."], "toda pergunta sai com o nome (D64)");
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

test("4. sem pergunta anonima (D64): a pagina antiga que pede anonima recebe 400 e nada e gravado; legado: a pergunta anonima de antes continua sem foto e a resposta de quem perguntou herda o nome gravado, para os alunos e para a equipe", async () => {
  // A pagina antiga: a pilula Anonima ligada. Recusada, sem pergunta no banco.
  for (const antigo of [{ anonymous: true }, { displayMode: "anonymous" }]) {
    const recusada = await perguntar(aluna, { ...antigo, body: "Posso perguntar sem aparecer? (pagina antiga)" });
    assert.equal(recusada.status, 400, `${JSON.stringify(antigo)}: ${JSON.stringify(recusada.body)}`);
    assert.equal(recusada.body.error, FRASE_DA_PAGINA_ANTIGA);
  }
  const gravadas = unwrap(await db.from("webinar_questions").select("id").eq("session_id", sessaoId).eq("body", "Posso perguntar sem aparecer? (pagina antiga)"), "Lendo as recusadas");
  assert.equal(gravadas.length, 0, "nenhuma pergunta gravada, nem com o nome de verdade");

  // Legado: linhas de antes de 10/11/2026. A pergunta gravada como anonima na epoca, posta direto no banco.
  const nomeAnonimo = anonymousDisplayName(aluna.id, webinarId);
  const linha = unwrap(
    await db
      .from("webinar_questions")
      .insert({ anonymous: true, body: "Posso perguntar sem aparecer?", display_name: nomeAnonimo, offset_ms: 70_000, session_id: sessaoId, user_id: aluna.id })
      .select("id")
      .single(),
    "Gravando a pergunta anonima de antes"
  );
  const [anonima] = (await perguntasDe(aluna)).filter((item) => item.id === linha.id);
  assert.deepEqual([anonima.anonymous, anonima.avatarUrl, anonima.displayName, anonima.mine], [true, null, nomeAnonimo, true]);
  actAs(produtor);
  ok(await roomActions.answerQuestion({ answeredLive: true, questionId: anonima.id }));

  // A resposta de quem perguntou herda o nome anonimo gravado na pergunta (a promessa da epoca), sem foto.
  const resposta = await responderNoFio(aluna, anonima.id, { body: "Obrigada!" });
  assert.equal(resposta.status, 201, JSON.stringify(resposta.body));
  assert.deepEqual([resposta.body.data.reply.anonymous, resposta.body.data.reply.avatarUrl, resposta.body.data.reply.displayName], [true, null, nomeAnonimo]);
  const gravada = unwrap(await db.from("webinar_question_replies").select("anonymous, display_name, user_id").eq("id", resposta.body.data.reply.id).single(), "Lendo a resposta herdada");
  assert.deepEqual(gravada, { anonymous: true, display_name: nomeAnonimo, user_id: aluna.id });

  const [paraOutro] = (await perguntasDe(outro)).filter((item) => item.id === anonima.id);
  assert.deepEqual([paraOutro.anonymous, paraOutro.avatarUrl], [true, null], "a pergunta anonima de antes sem foto para os outros");
  assert.deepEqual(paraOutro.replies.map((item) => [item.anonymous, item.avatarUrl]), [[true, null]]);
  const noConsole = (await retrato()).questions.find((item) => item.id === anonima.id);
  assert.equal(noConsole.avatarUrl, null, "nem a equipe ve a foto na anonima de antes");
  assert.deepEqual(noConsole.replies.map((item) => [item.anonymous, item.avatarUrl ?? null]), [[true, null]]);

  // Numa pergunta nova (com o nome), a resposta sai com o nome e a foto, como no teste 2.
  const [nova] = (await perguntasDe(aluna)).filter((item) => item.id === pergunta.id);
  assert.deepEqual(nova.replies.filter((item) => item.role === "student").map((item) => [item.anonymous, item.displayName]), [[false, "Aluna T."]]);
});

test("5. 'Remover minhas mensagens' leva tambem o que o aluno escreveu no fio", async () => {
  actAs(aluna);
  const removido = await json(await chatRoute.DELETE(pedido("chat", "DELETE", { all: true }), contexto));
  assert.equal(removido.status, 200, JSON.stringify(removido.body));
  const linhas = unwrap(await db.from("webinar_question_replies").select("deleted_at, deleted_reason").eq("user_id", aluna.id), "Lendo o fio depois de remover");
  assert.ok(linhas.length >= 2);
  assert.ok(linhas.every((linha) => linha.deleted_at !== null && linha.deleted_reason === "consent_revoked"));
});

test("6. a foto de fora (um endereco gravado direto no perfil, fora do bucket) vira iniciais: no proprio campo, para o outro aluno e no console", async () => {
  await foto(aluna.id, "https://exemplo.test/fotos/aluna.jpg");
  clearAuthorPhotoCache();
  resetRoomLimits();
  const enviada = await enviar(aluna, { ...ACEITE, body: "Foto de fora" });
  assert.equal(enviada.status, 201, JSON.stringify(enviada.body));
  assert.equal(enviada.body.data.message.avatarUrl, null);
  actAs(aluna);
  const sessao = await json(await sessionRoute.GET(pedido(`session?sessao=${sessaoId}`), contexto));
  assert.equal(sessao.body.data.me.avatarUrl, null, "o proprio campo de escrever");
  assert.equal((await chatDe(outro)).find((item) => item.body === "Foto de fora").avatarUrl, null, "o outro aluno");
  assert.equal((await retrato()).messages.find((item) => item.body === "Foto de fora").avatarUrl, null, "o console");
});

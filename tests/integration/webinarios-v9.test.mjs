import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import { LIVE_GRAVADA_NO_AR_DE_TESTE, limparWebinarios, seedEscolaDeTeste, seedLiveGravadaDeTeste, SENHA_DE_TESTE, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// A rodada v9 dos webinarios (teste do produtor de 12/11/2026; docs/30 D85 a D89) contra o banco LOCAL de verdade, com
// a migracao 202611150001 aplicada, na Live gravada no ar:
// - o banco: o aluno logado nao le webinar_screen_comments (so o service_role); os checks da tabela (uma origem so, a
//   janela), o indice unico parcial (um comentario na tela por sessao) e o cascade (a mensagem apagada do banco leva a
//   linha); os checks das tres colunas novas;
// - P3: o banner salvo com "So a imagem" chega a aluna com o alvo do link; sem escolha, "Imagem e botao"; "So o botao"
//   sem texto do botao e recusado;
// - P1 e P8: a resposta escrita nao vira mensagem do chat; quem assina fica em answer_author (o nome personalizado, o
//   papel de quem escreveu) e a aluna ve so o nome escolhido; no fio, "Equipe" sai sem nome nem foto de quem escreveu,
//   e "Meu nome" sai com o nome, o papel e a foto;
// - P11: Mostrar na tela uma mensagem (a consulta do chat com o carimbo velho traz o comentario numa chamada, com o
//   nome, o texto e a foto pela regra do chat), o mesmo de novo nao grava nada, a pergunta troca a mensagem
//   (`replaced`), apagar a mensagem ou dispensar a pergunta tira da tela (`removed`), Remover as mensagens do aluno
//   tira o que e dele (a leitura do dono pelo embedding do PostgREST), Tirar da tela (`team`); o analista recebe 403.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const { anonKey, url: supabaseUrl } = readLocalSupabaseConfig();
const GRAVADA = LIVE_GRAVADA_NO_AR_DE_TESTE;
const chatRoute = await import("../../src/app/api/webinars/[id]/chat/route.ts");
const questionsRoute = await import("../../src/app/api/webinars/[id]/questions/route.ts");
const acoesDaTela = await import("../../src/server/webinars/screen-actions.ts");
const acoesDaSala = await import("../../src/server/webinars/room-actions.ts");
const { clearScreenDisplayIdsCache, clearScreenStateCache, clearScreenStatsCache } = await import("../../src/server/webinars/screen-queries.ts");
const { clearScreenItemColumnsMemory } = await import("../../src/server/webinars/screen-store.ts");
const { clearV9ColumnsMemory } = await import("../../src/server/webinars/chat-store.ts");
const { clearAuthorPhotoCache } = await import("../../src/server/webinars/author-photos.ts");
const { resetRoomLimits } = await import("../../src/server/webinars/room-limits.ts");
const { CHAT_CONSENT_VERSION } = await import("../../src/server/webinars/model.ts");
const { WEBINAR_COPY } = await import("../../src/lib/webinar-copy.ts");

const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const aluna = usuarioDeTeste(contas.aluna);
const aluno = usuarioDeTeste(contas.alunoSemAcesso);
const pessoas = [aluna.id, aluno.id, produtor.id, analista.id];
const LINK = "https://bunker707.com.br/turma";
const ACEITE = { consent: true, consentVersion: CHAT_CONSENT_VERSION };
// A sala so mostra o arquivo enviado pelo Perfil (avatars/{id}/arquivo no bucket): o arquivo nao precisa existir.
const fotoNoBucket = (id) => db.storage.from("content-assets").getPublicUrl(`avatars/${id}/foto.webp`).data.publicUrl;
const FOTO = { aluna: fotoNoBucket(aluna.id), produtor: fotoNoBucket(produtor.id) };
const fotosDeAntes = new Map();

function comoEquipe(module, user = produtor) {
  return new Proxy(module, {
    get(target, name) {
      const action = target[name];
      return typeof action === "function" ? (...args) => (actAs(user), action(...args)) : action;
    }
  });
}

const screenActions = comoEquipe(acoesDaTela);
const roomActions = comoEquipe(acoesDaSala);

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

function falhou(result, status) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.status, status, JSON.stringify(result));
  return result;
}

const json = async (response) => ({ body: await response.json(), status: response.status });
const contexto = { params: Promise.resolve({ id: GRAVADA.id }) };
const pedido = (path, method = "GET", body) =>
  new Request(`http://localhost/api/webinars/${GRAVADA.id}/${path}`, body === undefined ? { method } : { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method });

/** A consulta de 5 s do chat com um carimbo que nunca e o de agora: o estado inteiro da Na tela, como `user` recebe. */
async function estadoDaTela(user = aluna) {
  actAs(user);
  const query = new URLSearchParams({ sessao: GRAVADA.sessaoId, since: new Date(Date.now() - 5000).toISOString(), tela: "2026-01-01T00:00:00+00:00" });
  const resposta = await json(await chatRoute.GET(pedido(`chat?${query}`), contexto));
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
  return resposta.body.data.screen;
}

async function chatDe(user) {
  actAs(user);
  const resposta = await json(await chatRoute.GET(pedido(`chat?sessao=${GRAVADA.sessaoId}&since=${encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString())}`), contexto));
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
  return resposta.body.data.messages;
}

async function escrever(user, body) {
  actAs(user);
  const resposta = await json(await chatRoute.POST(pedido("chat", "POST", { body, sessionId: GRAVADA.sessaoId, ...ACEITE }), contexto));
  assert.equal(resposta.status, 201, JSON.stringify(resposta.body));
  return resposta.body.data.message;
}

async function perguntar(user, body) {
  actAs(user);
  const resposta = await json(await questionsRoute.POST(pedido("questions", "POST", { body, sessionId: GRAVADA.sessaoId, ...ACEITE }), contexto));
  assert.equal(resposta.status, 201, JSON.stringify(resposta.body));
  return resposta.body.data.question;
}

async function perguntasDe(user) {
  actAs(user);
  const resposta = await json(await questionsRoute.GET(pedido(`questions?sessao=${GRAVADA.sessaoId}&ordem=recentes`), contexto));
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
  return resposta.body.data.questions;
}

async function comentarios() {
  return unwrap(
    await db.from("webinar_screen_comments").select("id, source, message_id, question_id, hidden_at, hidden_reason, hidden_by, shown_by").eq("session_id", GRAVADA.sessaoId).order("shown_at", { ascending: true }),
    "Lendo os comentarios na tela"
  );
}

async function codigoDoInsert(table, row) {
  const { error } = await db.from(table).insert(row).select("id").maybeSingle();
  return error?.code ?? null;
}

function limparMemorias() {
  resetRoomLimits();
  clearScreenStateCache();
  clearScreenDisplayIdsCache();
  clearScreenStatsCache();
  clearScreenItemColumnsMemory();
  clearV9ColumnsMemory();
  clearAuthorPhotoCache();
}

async function limparRastros() {
  unwrap(await db.from("student_events").delete().in("user_id", pessoas).eq("entity_type", "webinar"), "Apagando o historico de webinario de teste");
  unwrap(await db.from("notifications").delete().in("user_id", pessoas).eq("kind", "webinar"), "Apagando o sino de webinario de teste");
}

async function foto(userId, url) {
  unwrap(await db.from("profiles").update({ avatar_url: url }).eq("id", userId), "Gravando a foto de teste");
}

before(async () => {
  await limparWebinarios(db);
  await limparRastros();
  await seedLiveGravadaDeTeste(db, { comecouHa: 120_000 });
  for (const row of unwrap(await db.from("profiles").select("id, avatar_url").in("id", pessoas), "Lendo as fotos de antes")) {
    fotosDeAntes.set(row.id, row.avatar_url);
  }
  await foto(aluna.id, FOTO.aluna);
  await foto(produtor.id, FOTO.produtor);
  limparMemorias();
});

after(async () => {
  actAs(null);
  for (const [id, url] of fotosDeAntes) {
    await foto(id, url);
  }
  await limparWebinarios(db);
  await limparRastros();
  limparMemorias();
});

test("1. o banco: o aluno logado nao le webinar_screen_comments; uma origem so, a janela, um comentario na tela por sessao; a mensagem apagada do banco leva a linha; os checks das colunas novas", async () => {
  const cliente = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  unwrap(await cliente.auth.signInWithPassword({ email: contas.aluna.email, password: SENHA_DE_TESTE }), "Entrando como a aluna");
  const negado = await cliente.from("webinar_screen_comments").select("id").limit(1);
  assert.equal(negado.error?.code, "42501", JSON.stringify(negado.error));
  await cliente.auth.signOut();

  const mensagem = unwrap(
    await db.from("webinar_chat_messages").insert({ approved: true, author_user_id: produtor.id, body: "linha de teste", display_name: "Equipe", offset_ms: 60_000, role: "host", session_id: GRAVADA.sessaoId, source: "audience", webinar_id: GRAVADA.id }).select("id").single(),
    "Gravando a mensagem de teste"
  );
  const linha = (extra = {}) => ({ message_id: mensagem.id, session_id: GRAVADA.sessaoId, source: "chat", ...extra });

  for (const [rotulo, row] of [
    ["origem desconhecida", linha({ source: "enquete" })],
    ["chat sem a mensagem", linha({ message_id: null })],
    ["pergunta com a mensagem", linha({ source: "question" })],
    ["saiu sem o motivo", linha({ hidden_at: new Date().toISOString() })],
    ["motivo sem a hora", linha({ hidden_reason: "team" })],
    ["motivo desconhecido", linha({ hidden_at: new Date().toISOString(), hidden_reason: "cansou" })]
  ]) {
    assert.equal(await codigoDoInsert("webinar_screen_comments", row), "23514", rotulo);
  }
  assert.equal(await codigoDoInsert("webinar_screen_comments", linha()), null, "a primeira na tela entra");
  assert.equal(await codigoDoInsert("webinar_screen_comments", linha()), "23505", "uma na tela por sessao");
  unwrap(await db.from("webinar_screen_comments").update({ hidden_at: new Date(Date.now() + 1000).toISOString(), hidden_reason: "team" }).eq("session_id", GRAVADA.sessaoId).is("hidden_at", null), "Tirando da tela");
  assert.equal(await codigoDoInsert("webinar_screen_comments", linha()), null, "a que saiu libera o lugar");
  unwrap(await db.from("webinar_chat_messages").delete().eq("id", mensagem.id), "Apagando a mensagem do banco");
  assert.deepEqual(await comentarios(), [], "a retencao que apaga a origem apaga a linha");

  // As tres colunas novas das tabelas que ja existiam.
  const item = { kind: "banner", link_url: LINK, name: "Turma nova", title: "Turma nova", webinar_id: GRAVADA.id };
  assert.equal(await codigoDoInsert("webinar_screen_items", { ...item, link_target: "card" }), "23514", "alvo do link desconhecido");
  const semEscolha = unwrap(await db.from("webinar_screen_items").insert(item).select("id, link_target").single(), "Gravando o banner sem alvo");
  assert.equal(semEscolha.link_target, "both", "o padrao e a imagem e o botao");
  unwrap(await db.from("webinar_screen_items").delete().eq("id", semEscolha.id), "Apagando o banner de teste");
  const pergunta = { body: "check", display_name: "Aluna T.", offset_ms: 60_000, session_id: GRAVADA.sessaoId, user_id: aluna.id };
  assert.equal(await codigoDoInsert("webinar_questions", { ...pergunta, answer_author: ["lista"] }), "23514", "a assinatura e um objeto");
  assert.equal(await codigoDoInsert("webinar_questions", { ...pergunta, answer_author: { as: "custom", name: "x".repeat(600), v: 1 } }), "23514", "a assinatura cabe em 512 bytes");
});

test("2. P3: 'So a imagem' chega a aluna com o alvo do link; sem escolha, 'Imagem e botao'; 'So o botao' sem texto do botao e recusado", async () => {
  const semTexto = falhou(await screenActions.saveScreenItem({ kind: "banner", linkTarget: "button", linkUrl: LINK, title: "Turma nova", webinarId: GRAVADA.id }), 400);
  assert.match(JSON.stringify(semTexto), new RegExp(WEBINAR_COPY.naTela.erros.soBotaoSemTexto.slice(0, 20)));

  const { item: padrao } = ok(await screenActions.saveScreenItem({ buttonLabel: "Quero entrar", kind: "banner", linkUrl: LINK, title: "Turma nova", webinarId: GRAVADA.id }));
  assert.equal(padrao.linkTarget, "both");
  const { item: soImagem } = ok(await screenActions.saveScreenItem({ buttonLabel: "Quero entrar", id: padrao.id, kind: "banner", linkTarget: "image", linkUrl: LINK, title: "Turma nova", webinarId: GRAVADA.id }));
  assert.equal(soImagem.linkTarget, "image");
  assert.equal(unwrap(await db.from("webinar_screen_items").select("link_target").eq("id", padrao.id).single(), "Lendo o alvo gravado").link_target, "image");

  ok(await screenActions.showScreenItem({ itemId: padrao.id, sessionId: GRAVADA.sessaoId }));
  const estado = await estadoDaTela();
  const [naTela] = estado.items;
  assert.deepEqual([naTela.kind, naTela.linkTarget, naTela.linkUrl], ["banner", "image", LINK], "a copia congelada leva o alvo");
  assert.equal(naTela.buttonLabel ?? null, null, "com So a imagem o botao nao e desenhado");

  ok(await screenActions.hideScreenItem({ displayId: naTela.displayId }));
});

test("3. P1 e P8: a resposta escrita nao entra no chat; a aluna ve so o nome escolhido; no fio, Equipe sai sem nome nem foto e Meu nome sai com o nome, o papel e a foto", async () => {
  const pergunta = await perguntar(aluna, "A gravação fica disponível?");
  const chatAntes = (await chatDe(aluna)).length;
  const linhasAntes = unwrap(await db.from("webinar_chat_messages").select("id").eq("session_id", GRAVADA.sessaoId), "Contando o chat").length;

  const curto = falhou(await roomActions.answerQuestion({ answerText: "Fica.", author: { as: "custom", name: "E" }, questionId: pergunta.id }), 400);
  assert.equal(curto.ok, false);
  const respondida = ok(await roomActions.answerQuestion({ answerText: "Fica sim, por 30 dias.", author: { as: "custom", name: "Equipe Bunker 707" }, questionId: pergunta.id }));
  assert.equal(respondida.message, null, "nenhuma mensagem nasce no chat");
  assert.equal(unwrap(await db.from("webinar_chat_messages").select("id").eq("session_id", GRAVADA.sessaoId), "Contando o chat").length, linhasAntes, "o chat fica como estava");
  assert.equal((await chatDe(aluna)).length, chatAntes);

  const gravada = unwrap(await db.from("webinar_questions").select("answer_author, answer_text, answered_by, status").eq("id", pergunta.id).single(), "Lendo a resposta gravada");
  assert.deepEqual(gravada.answer_author, { as: "custom", name: "Equipe Bunker 707", role: "host", v: 1 });
  assert.deepEqual([gravada.answered_by, gravada.status], [produtor.id, "answered"], "quem escreveu continua registrado");

  let [paraAluna] = (await perguntasDe(aluna)).filter((item) => item.id === pergunta.id);
  assert.equal(paraAluna.answerText, "Fica sim, por 30 dias.");
  assert.deepEqual(paraAluna.answerAuthor, { as: "custom", avatarUrl: null, name: "Equipe Bunker 707", role: null }, "so o nome escolhido: sem papel e sem foto de quem escreveu");
  assert.doesNotMatch(JSON.stringify(paraAluna), new RegExp(produtor.id), "o id de quem escreveu nao sai");

  // No fio: Equipe (sem nome), depois Meu nome (com a foto).
  const comoEquipeNoFio = ok(await roomActions.replyToQuestion({ author: { as: "team", name: null }, body: "Qualquer dúvida, chame aqui.", questionId: pergunta.id }));
  const comMeuNome = ok(await roomActions.replyToQuestion({ author: { as: "self", name: null }, body: "Eu mesmo confirmo.", questionId: pergunta.id }));
  const linhas = unwrap(await db.from("webinar_question_replies").select("id, author_as, display_name, user_id").in("id", [comoEquipeNoFio.reply.id, comMeuNome.reply.id]), "Lendo o fio gravado");
  const porId = new Map(linhas.map((row) => [row.id, row]));
  assert.equal(porId.get(comoEquipeNoFio.reply.id).author_as, "team");
  assert.equal(porId.get(comoEquipeNoFio.reply.id).user_id, produtor.id, "quem escreveu continua registrado");
  assert.equal(porId.get(comMeuNome.reply.id).author_as, "self");

  clearAuthorPhotoCache();
  [paraAluna] = (await perguntasDe(aluna)).filter((item) => item.id === pergunta.id);
  const [daEquipe, doProdutor] = paraAluna.replies;
  assert.deepEqual([daEquipe.authorAs, daEquipe.displayName, daEquipe.avatarUrl, daEquipe.mine], ["team", "", null, false], "Equipe: sem nome e sem foto");
  assert.deepEqual([doProdutor.authorAs ?? null, doProdutor.role, doProdutor.avatarUrl], [null, "host", FOTO.produtor], "Meu nome: o papel e a foto");
  assert.ok(doProdutor.displayName.length > 0);

  // Responder ao vivo continua sem texto e sem assinatura.
  const outra = await perguntar(aluna, "Vai ter certificado?");
  ok(await roomActions.answerQuestion({ answeredLive: true, questionId: outra.id }));
  assert.equal(unwrap(await db.from("webinar_questions").select("answer_author").eq("id", outra.id).single(), "Lendo a respondida ao vivo").answer_author, null);
});

test("4. P11: Mostrar na tela a mensagem, o mesmo de novo nada, a pergunta troca, apagar ou dispensar tira, Remover as mensagens do aluno tira, Tirar da tela; o analista recebe 403", async () => {
  unwrap(await db.from("webinar_screen_comments").delete().eq("session_id", GRAVADA.sessaoId), "Zerando os comentarios na tela");
  limparMemorias();
  const mensagem = await escrever(aluna, "Essa aula mudou a minha semana!");
  const pergunta = await perguntar(aluna, "Tem turma nova em janeiro?");

  falhou(await comoEquipe(acoesDaTela, analista).showScreenComment({ messageId: mensagem.id, sessionId: GRAVADA.sessaoId }), 403);
  falhou(await screenActions.showScreenComment({ messageId: mensagem.id, questionId: pergunta.id, sessionId: GRAVADA.sessaoId }), 400);
  falhou(await screenActions.showScreenComment({ messageId: "bbbbbbbb-0000-4000-8000-0000000009ff", sessionId: GRAVADA.sessaoId }), 404);
  assert.equal((await estadoDaTela()).comment ?? null, null, "nada na tela ainda");

  const mostrou = ok(await screenActions.showScreenComment({ messageId: mensagem.id, sessionId: GRAVADA.sessaoId }));
  assert.deepEqual([mostrou.changed, mostrou.replaced, mostrou.source, mostrou.sourceId], [true, 0, "chat", mensagem.id]);
  let estado = await estadoDaTela(aluno);
  assert.deepEqual(
    [estado.comment.displayId, estado.comment.source, estado.comment.sourceId, estado.comment.body, estado.comment.avatarUrl, estado.comment.role],
    [mostrou.displayId, "chat", mensagem.id, "Essa aula mudou a minha semana!", FOTO.aluna, null],
    "o outro aluno recebe o comentario numa chamada, com o texto e a foto pela regra do chat"
  );
  assert.equal(estado.comment.name, mensagem.displayName, "o nome que a aluna ja mostra no chat");

  const deNovo = ok(await screenActions.showScreenComment({ messageId: mensagem.id, sessionId: GRAVADA.sessaoId }));
  assert.deepEqual([deNovo.changed, deNovo.displayId], [false, mostrou.displayId], "o mesmo de novo nao grava nada");
  assert.equal((await comentarios()).length, 1);

  // A pergunta troca a mensagem.
  const trocou = ok(await screenActions.showScreenComment({ questionId: pergunta.id, sessionId: GRAVADA.sessaoId }));
  assert.deepEqual([trocou.changed, trocou.replaced, trocou.source], [true, 1, "question"]);
  let linhas = await comentarios();
  assert.deepEqual(linhas.map((row) => [row.source, row.hidden_reason, row.hidden_at === null]), [["chat", "replaced", false], ["question", null, true]]);
  estado = await estadoDaTela();
  assert.deepEqual([estado.comment.source, estado.comment.sourceId, estado.comment.body], ["question", pergunta.id, "Tem turma nova em janeiro?"]);

  // Dispensar a pergunta tira da tela.
  ok(await roomActions.setQuestionStatus({ questionId: pergunta.id, status: "dismissed" }));
  assert.equal((await estadoDaTela()).comment ?? null, null, "a pergunta dispensada sai da tela");
  linhas = await comentarios();
  assert.deepEqual([linhas.at(-1).hidden_reason, linhas.at(-1).hidden_at !== null], ["removed", true]);
  falhou(await screenActions.showScreenComment({ questionId: pergunta.id, sessionId: GRAVADA.sessaoId }), 404);

  // Apagar a mensagem tira da tela.
  ok(await screenActions.showScreenComment({ messageId: mensagem.id, sessionId: GRAVADA.sessaoId }));
  assert.equal((await estadoDaTela()).comment.sourceId, mensagem.id);
  ok(await roomActions.moderateMessage({ action: "delete", messageId: mensagem.id }));
  assert.equal((await estadoDaTela()).comment ?? null, null, "a mensagem apagada sai da tela");
  assert.equal((await comentarios()).at(-1).hidden_reason, "removed");
  falhou(await screenActions.showScreenComment({ messageId: mensagem.id, sessionId: GRAVADA.sessaoId }), 404);

  // Remover as mensagens do aluno tira o que e dele (o dono lido pelo embedding).
  const outra = await escrever(aluna, "Obrigada pela aula.");
  ok(await screenActions.showScreenComment({ messageId: outra.id, sessionId: GRAVADA.sessaoId }));
  assert.equal((await estadoDaTela()).comment.sourceId, outra.id);
  ok(await roomActions.removeStudentMessages({ reason: "pedido pelo e-mail de 12/11", userId: aluna.id }));
  assert.equal((await estadoDaTela()).comment ?? null, null, "o que era da aluna sai da tela");
  assert.equal((await comentarios()).at(-1).hidden_reason, "removed");

  // A mensagem da equipe, e o Tirar da tela.
  const daEquipe = ok(await roomActions.sendTeamMessage({ body: "Bem-vindos!", sessionId: GRAVADA.sessaoId }));
  ok(await screenActions.showScreenComment({ messageId: daEquipe.message.id, sessionId: GRAVADA.sessaoId }));
  clearAuthorPhotoCache();
  estado = await estadoDaTela();
  assert.deepEqual([estado.comment.sourceId, estado.comment.role, estado.comment.avatarUrl], [daEquipe.message.id, "host", FOTO.produtor], "a da equipe com o selo e a foto");
  falhou(await comoEquipe(acoesDaTela, analista).hideScreenComment({ sessionId: GRAVADA.sessaoId }), 403);
  assert.deepEqual(ok(await screenActions.hideScreenComment({ sessionId: GRAVADA.sessaoId })), { hidden: true, sessionId: GRAVADA.sessaoId });
  assert.equal((await estadoDaTela()).comment ?? null, null);
  const ultima = (await comentarios()).at(-1);
  assert.deepEqual([ultima.hidden_reason, ultima.hidden_by, ultima.shown_by], ["team", produtor.id, produtor.id]);
  assert.deepEqual(ok(await screenActions.hideScreenComment({ sessionId: GRAVADA.sessaoId })), { hidden: false, sessionId: GRAVADA.sessaoId }, "sem nada na tela, nada muda");
});

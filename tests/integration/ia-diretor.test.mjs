import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { actAs, provedorFalso } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import {
  ESCOLA_DE_TESTE,
  limparConversasDeIa,
  limparProvedoresDeIa,
  seedEscolaDeTeste,
  usuarioDeTeste
} from "../fixtures/escola-de-teste.mjs";

// IA Diretor com banco de verdade e provedor falso: so quem tem conteudo comprado conversa; a resposta
// so pode apontar para conteudos que o servidor autorizou (a referencia [R1] vira link interno);
// pergunta repetida nao gera outra resposta; limite diario; renomear e excluir so os proprios chats;
// a IA Diretor nao mexe nos chats do Tutor.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const conversas = await import("../../src/app/api/guide/conversations/route.ts");
const conversa = await import("../../src/app/api/guide/conversations/[conversationId]/route.ts");
const mensagens = await import("../../src/app/api/guide/conversations/[conversationId]/messages/route.ts");
const { removeAIProviderConfig, saveAIProviderConfig } = await import("../../src/server/ai/provider-config.ts");
const { removeAIProviderConnection, saveAIProviderAPIConnection } = await import("../../src/server/ai/provider-connections.ts");

const { curso } = ESCOLA_DE_TESTE;
const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const produtor = usuarioDeTeste(contas.produtor);
const SEM_CACHE = "private, no-store, max-age=0";
const SEM_CONTEUDO = "Voce ainda nao possui conteudos publicados disponiveis para consultar.";
const SEM_PROVEDOR = "O produtor ainda nao configurou o modelo da IA Diretor.";
const LINK_DA_AULA_1 = `/conteudo/${curso.id}/aulas/${curso.modulos.modulo1}?lessonId=${curso.aulas.aula1}`;

const rota = (conversationId) => ({ params: Promise.resolve({ conversationId }) });

function pedido(body, method = "POST") {
  return new Request("http://127.0.0.1:3100/api/guide/conversations", {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method
  });
}

async function lerDiretora() {
  const response = await conversas.GET();
  return { body: await response.json(), response };
}

async function criarChat() {
  const response = await conversas.POST();
  return { body: await response.json(), response };
}

async function perguntar(conversationId, question, clientRequestId = randomUUID()) {
  const response = await mensagens.POST(pedido({ clientRequestId, question }), rota(conversationId));
  return { body: await response.json(), clientRequestId, response };
}

async function lerChat(conversationId) {
  const response = await conversa.GET(pedido(undefined, "GET"), rota(conversationId));
  return { body: await response.json(), response };
}

let chat;
let conexao;

before(async () => {
  await limparConversasDeIa(db, [contas.aluna.id, contas.alunoSemAcesso.id]);
  await limparProvedoresDeIa(db);
  provedorFalso.zerar();
});

after(async () => {
  if (conexao) await removeAIProviderConnection(conexao.id, produtor.id).catch(() => undefined);
  await removeAIProviderConfig("openai", produtor.id).catch(() => undefined);
  await limparProvedoresDeIa(db);
  await limparConversasDeIa(db, [contas.aluna.id, contas.alunoSemAcesso.id]);
  provedorFalso.zerar();
});

test("sem sessao responde 401 sem cache; sem provedor, a aluna ve o motivo e nao cria chat", async () => {
  actAs(null);
  const semSessao = await lerDiretora();
  assert.equal(semSessao.response.status, 401);
  assert.equal(semSessao.response.headers.get("cache-control"), SEM_CACHE);

  actAs(aluna);
  const { body, response } = await lerDiretora();
  assert.equal(response.status, 200);
  assert.deepEqual(body.data.availability, { available: false, reason: SEM_PROVEDOR });
  assert.deepEqual(body.data.conversations, []);
  assert.equal((await criarChat()).response.status, 503);
});

test("com o provedor configurado: a aluna (com cursos) pode conversar; quem nao comprou nada ve o motivo e nao cria chat", async () => {
  await saveAIProviderConfig({ actorId: produtor.id, dailyQuestionLimit: 3, defaultModel: "modelo-de-teste", provider: "openai" });
  conexao = await saveAIProviderAPIConnection({ actorId: produtor.id, apiKey: "sk-teste-de-integracao-12345678", label: "Conexao de teste", provider: "openai" });

  actAs(aluna);
  assert.deepEqual((await lerDiretora()).body.data.availability, { available: true, reason: null });

  actAs(alunoSemAcesso);
  assert.deepEqual((await lerDiretora()).body.data.availability, { available: false, reason: SEM_CONTEUDO });
  assert.equal((await criarChat()).response.status, 503);
});

test("a aluna cria um chat e ele aparece na lista", async () => {
  actAs(aluna);
  const { body, response } = await criarChat();
  assert.equal(response.status, 201, body.error);
  chat = body.data;
  assert.equal(chat.title, "Novo chat");
  assert.equal(chat.messageCount, 0);
  assert.deepEqual((await lerDiretora()).body.data.conversations.map((entry) => entry.id), [chat.id]);
});

test("a aluna pergunta por onde comecar: o provedor recebe so o catalogo autorizado; a referencia [R] vira link interno da aula", async () => {
  provedorFalso.zerar();
  provedorFalso.responder = ({ system }) => {
    const id = system.match(/\[(R\d+)\] AULA \|[^\n]*Aula 1: O que é um agente/)?.[1] ?? "R0";
    return `Comece pela primeira aula do curso de agentes. [${id}] Depois siga para as pecas do agente.`;
  };

  actAs(aluna);
  const { body, clientRequestId, response } = await perguntar(chat.id, "Por onde eu começo a aprender sobre agentes?");
  assert.equal(response.status, 200, body.error);
  assert.equal(response.headers.get("cache-control"), SEM_CACHE);

  assert.equal(provedorFalso.chamadas.length, 1);
  const chamada = provedorFalso.chamadas[0];
  assert.match(chamada.system, /CATALOGO AUTORIZADO PARA ESTA RESPOSTA/);
  assert.match(chamada.system, /Curso de Teste: Agentes de IA/);
  assert.doesNotMatch(chamada.system, /Curso de Teste: Bloqueado/, "o curso que ela nao comprou nao entra no catalogo");
  assert.deepEqual(chamada.messages.at(-1), { content: "Por onde eu começo a aprender sobre agentes?", role: "user" });

  const resposta = body.data.messages.at(-1);
  assert.equal(resposta.role, "assistant");
  assert.equal(resposta.status, "completed");
  assert.ok(resposta.body.includes(`[Aula: Aula 1: O que é um agente](${LINK_DA_AULA_1})`), `link interno no texto: ${resposta.body}`);
  assert.doesNotMatch(resposta.body, /\[R\d+\]/, "nenhum identificador cru sobra");
  assert.equal(resposta.references.length, 1);
  assert.equal(resposta.references[0].href, LINK_DA_AULA_1);
  assert.equal(resposta.references[0].verified, true);
  assert.equal(body.data.conversation.title, "Por onde eu começo a aprender sobre agentes");

  const repetida = await perguntar(chat.id, "Por onde eu começo a aprender sobre agentes?", clientRequestId);
  assert.equal(repetida.response.status, 200);
  assert.equal(repetida.body.data.messages.length, 2, "envio repetido nao duplica");
  assert.equal(provedorFalso.chamadas.length, 1);
});

test("resposta com referencia inventada ou link externo: o aluno nao recebe nenhum dos dois", async () => {
  provedorFalso.zerar();
  provedorFalso.responder = () => "Veja [este site](https://exemplo.test/curso) e a aula [R999].";

  actAs(aluna);
  const { body, response } = await perguntar(chat.id, "Tem algum link externo?");
  assert.equal(response.status, 200, body.error);
  const resposta = body.data.messages.at(-1);
  assert.doesNotMatch(resposta.body, /exemplo\.test|R999/);
  assert.deepEqual(resposta.references, []);
});

test("limite diario (3 na politica): a terceira pergunta responde; a quarta e 429", async () => {
  provedorFalso.zerar();
  provedorFalso.responder = () => "Siga a ordem dos modulos.";

  actAs(aluna);
  const terceira = await perguntar(chat.id, "E depois?");
  assert.equal(terceira.response.status, 200, terceira.body.error);

  const quarta = await perguntar(chat.id, "Mais uma?");
  assert.equal(quarta.response.status, 429);
  assert.equal(quarta.body.error, "Voce atingiu o limite de perguntas das ultimas 24 horas.");
  assert.equal(provedorFalso.chamadas.length, 1);
});

test("renomear e excluir so os proprios chats; a IA Diretor nao mexe nos chats do Tutor", async () => {
  actAs(aluna);
  const renomear = await conversa.PATCH(pedido({ title: "Trilha de agentes" }, "PATCH"), rota(chat.id));
  assert.equal(renomear.status, 200);
  assert.equal((await renomear.json()).data.title, "Trilha de agentes");

  actAs(alunoSemAcesso);
  assert.equal((await conversa.PATCH(pedido({ title: "Invasao" }, "PATCH"), rota(chat.id))).status, 404);
  assert.equal((await lerChat(chat.id)).response.status, 404);

  // Um chat do Tutor da mesma aluna nao aparece nem se mexe pela IA Diretor.
  const doTutor = unwrap(await db.from("ai_conversations").insert({
    agent_type: "lesson_tutor",
    content_id_snapshot: curso.id,
    lesson_id: curso.aulas.aula1,
    lesson_title_snapshot: "Aula 1: O que é um agente",
    title: "Chat do Tutor",
    user_id: contas.aluna.id
  }).select("id").single(), "Criando chat do Tutor");
  actAs(aluna);
  assert.equal((await conversa.PATCH(pedido({ title: "Nao" }, "PATCH"), rota(doTutor.id))).status, 404);
  assert.equal((await lerChat(doTutor.id)).response.status, 404);
  assert.deepEqual((await lerDiretora()).body.data.conversations.map((entry) => entry.id), [chat.id], "a lista da IA Diretor nao mostra o chat do Tutor");

  const excluir = await conversa.DELETE(pedido(undefined, "DELETE"), rota(chat.id));
  assert.equal(excluir.status, 200);
  assert.deepEqual((await lerDiretora()).body.data.conversations, []);
  assert.equal((await lerChat(chat.id)).response.status, 404);
  const guardadas = unwrap(await db.from("ai_messages").select("id").eq("conversation_id", chat.id), "Lendo ai_messages");
  assert.ok(guardadas.length >= 2, "as mensagens continuam guardadas");
});

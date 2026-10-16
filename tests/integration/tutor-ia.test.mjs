import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { actAs, provedorFalso } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import {
  ESCOLA_DE_TESTE,
  limparConversasDeIa,
  limparProvedoresDeIa,
  limparTranscricaoDeTeste,
  seedEscolaDeTeste,
  usuarioDeTeste
} from "../fixtures/escola-de-teste.mjs";

// Tutor IA com banco de verdade e provedor falso (docs/18 §2.5): o produtor cola a transcricao da
// aula e configura o provedor; a aluna abre um chat na aula, pergunta e recebe a resposta com a
// citacao virando tempo do video; pergunta repetida nao gera outra resposta; falha do provedor fica
// registrada; limite diario; renomear e excluir so os proprios chats; o Tutor nao mexe nas conversas
// da IA Diretor. O que e chamada HTTP ao provedor vira `provedorFalso`; o resto (pool, limites,
// mensagens, citacoes) roda como em producao.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const conversas = await import("../../src/app/api/tutor/lessons/[lessonId]/conversations/route.ts");
const conversa = await import("../../src/app/api/tutor/conversations/[conversationId]/route.ts");
const mensagens = await import("../../src/app/api/tutor/conversations/[conversationId]/messages/route.ts");
const transcricao = await import("../../src/app/api/admin/lessons/[lessonId]/transcript/route.ts");
const processar = await import("../../src/app/api/admin/lessons/[lessonId]/tutor/process/route.ts");
const { removeAIProviderConfig, saveAIProviderConfig } = await import("../../src/server/ai/provider-config.ts");
const { removeAIProviderConnection, saveAIProviderAPIConnection } = await import("../../src/server/ai/provider-connections.ts");
const { createPlatformGuideConversation } = await import("../../src/server/ai/platform-guide.ts");

const { curso } = ESCOLA_DE_TESTE;
const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const produtor = usuarioDeTeste(contas.produtor);
const aula = curso.aulas.aula1;
const SEM_CACHE = "private, no-store, max-age=0";
const SEM_TRANSCRICAO = "O produtor ainda nao preparou o conteudo desta aula para o Tutor IA.";
const SEM_PROVEDOR = "O produtor ainda nao configurou o modelo de IA do tutor.";
const TRANSCRICAO_SRT = `1
00:00:05,000 --> 00:00:09,000
Um agente de inteligencia artificial e um programa que decide sozinho qual e o proximo passo.

2
00:00:12,000 --> 00:00:18,000
O agente usa ferramentas para agir no mundo, como buscar na web ou enviar um e-mail.

3
00:00:20,000 --> 00:00:26,000
A memoria guarda o que o agente ja fez, para ele nao repetir o mesmo trabalho.

4
00:00:28,000 --> 00:00:34,000
O modelo de linguagem e o cerebro: ele le o contexto e escolhe a proxima acao.

5
00:00:36,000 --> 00:00:42,000
Na proxima aula vamos montar o primeiro agente do zero, passo a passo.
`;

const rotaAula = { params: Promise.resolve({ lessonId: aula }) };
const rota = (conversationId) => ({ params: Promise.resolve({ conversationId }) });

function pedido(body, method = "POST", url = "http://127.0.0.1:3100/api/tutor") {
  return new Request(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method
  });
}

async function lerTutor() {
  const response = await conversas.GET(pedido(undefined, "GET", `http://127.0.0.1:3100/api/tutor/lessons/${aula}/conversations?contentId=${curso.id}`), rotaAula);
  return { body: await response.json(), response };
}

async function criarChat() {
  const response = await conversas.POST(pedido({ contentId: curso.id }), rotaAula);
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

const mensagensNoBanco = async (conversationId) => unwrap(
  await db.from("ai_messages").select("role,status,body,provider,model,citations").eq("conversation_id", conversationId).order("message_sequence"),
  "Lendo ai_messages"
);

let chat;
let conexao;

before(async () => {
  await limparConversasDeIa(db, [contas.aluna.id, contas.alunoSemAcesso.id]);
  await limparTranscricaoDeTeste(db, aula);
  await limparProvedoresDeIa(db);
  provedorFalso.zerar();
});

after(async () => {
  if (conexao) await removeAIProviderConnection(conexao.id, produtor.id).catch(() => undefined);
  await removeAIProviderConfig("openai", produtor.id).catch(() => undefined);
  await limparProvedoresDeIa(db);
  await limparConversasDeIa(db, [contas.aluna.id, contas.alunoSemAcesso.id]);
  await limparTranscricaoDeTeste(db, aula);
  provedorFalso.zerar();
});

test("sem sessao, o Tutor responde 401 sem cache; aluno sem acesso a aula recebe 403", async () => {
  actAs(null);
  const semSessao = await lerTutor();
  assert.equal(semSessao.response.status, 401);
  assert.equal(semSessao.response.headers.get("cache-control"), SEM_CACHE);

  actAs(alunoSemAcesso);
  assert.equal((await lerTutor()).response.status, 403);
  assert.equal((await criarChat()).response.status, 403);
});

test("aula sem transcricao: o Tutor fica indisponivel com o motivo, e criar chat e recusado", async () => {
  actAs(aluna);
  const { body, response } = await lerTutor();
  assert.equal(response.status, 200);
  assert.deepEqual(body.data.availability, { available: false, reason: SEM_TRANSCRICAO });
  assert.deepEqual(body.data.conversations, []);

  const criar = await criarChat();
  assert.equal(criar.response.status, 503);
});

test("o produtor cola a transcricao (SRT): fica pronta em trechos; sem provedor, a analise fica esperando e o Tutor segue indisponivel", async () => {
  actAs(produtor);
  const response = await transcricao.PUT(pedido({ format: "srt", language: "pt-BR", text: TRANSCRICAO_SRT }, "PUT"), rotaAula);
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.data.status, "ready");
  assert.equal(body.data.format, "srt");
  assert.ok(body.data.chunkCount >= 1);
  assert.equal(body.data.profileStatus, "waiting_provider", "a analise espera um provedor");

  actAs(aluna);
  assert.deepEqual((await lerTutor()).body.data.availability, { available: false, reason: SEM_PROVEDOR });
});

test("o produtor configura o provedor (politica + conexao por chave) e analisa a aula: o Tutor fica disponivel", async () => {
  await saveAIProviderConfig({ actorId: produtor.id, dailyQuestionLimit: 3, defaultModel: "modelo-de-teste", provider: "openai" });
  conexao = await saveAIProviderAPIConnection({ actorId: produtor.id, apiKey: "sk-teste-de-integracao-12345678", label: "Conexao de teste", provider: "openai" });
  assert.equal(conexao.status, "active");

  provedorFalso.responder = () => JSON.stringify({ chapters: [], faq: [], summary: "Aula sobre o que e um agente e suas pecas.", topics: ["agentes", "ferramentas", "memoria"] });
  actAs(produtor);
  const response = await processar.POST(pedido(undefined), rotaAula);
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.data.profileStatus, "ready");
  assert.equal(provedorFalso.chamadas.length, 1, "a analise chamou o provedor uma vez");
  assert.match(provedorFalso.chamadas[0].system, /organiza uma aula/);

  actAs(aluna);
  assert.deepEqual((await lerTutor()).body.data.availability, { available: true, reason: null });
});

test("a aluna cria um chat: nasce como 'Novo chat', sem mensagens, e aparece na lista", async () => {
  actAs(aluna);
  const { body, response } = await criarChat();
  assert.equal(response.status, 201, body.error);
  chat = body.data;
  assert.equal(chat.title, "Novo chat");
  assert.equal(chat.messageCount, 0);

  const lista = await lerTutor();
  assert.deepEqual(lista.body.data.conversations.map((entry) => entry.id), [chat.id]);
});

test("pergunta invalida: vazia e 400; identificador de envio que nao e UUID e 400", async () => {
  actAs(aluna);
  const vazia = await perguntar(chat.id, "   ");
  assert.equal(vazia.response.status, 400);
  assert.equal(vazia.body.error, "Digite uma pergunta para o Tutor IA.");

  const semId = await perguntar(chat.id, "O que e um agente?", "nao-e-uuid");
  assert.equal(semId.response.status, 400);
  assert.equal(semId.body.error, "Identificador de envio invalido.");
  assert.equal(provedorFalso.chamadas.length, 1, "nada foi ao provedor");
});

test("a aluna pergunta: o provedor recebe a transcricao com identificadores; a citacao vira tempo do video; o chat ganha o titulo da pergunta", async () => {
  provedorFalso.zerar();
  provedorFalso.responder = ({ system }) => {
    const id = system.match(/\[(F\d+)\] O agente usa ferramentas para agir no mundo/)?.[1] ?? "F0";
    return `O agente usa ferramentas para agir no mundo, como buscar na web ou enviar um e-mail. [${id}]`;
  };

  actAs(aluna);
  const { body, clientRequestId, response } = await perguntar(chat.id, "Para que o agente usa ferramentas?");
  assert.equal(response.status, 200, body.error);
  assert.equal(response.headers.get("cache-control"), SEM_CACHE);

  assert.equal(provedorFalso.chamadas.length, 1);
  const chamada = provedorFalso.chamadas[0];
  assert.match(chamada.system, /CONTEUDO AUTORIZADO DA AULA/);
  assert.match(chamada.system, /Resumo previamente analisado: Aula sobre o que e um agente/, "o resumo da analise entra no contexto");
  assert.doesNotMatch(chamada.system, /00:00:12|00:12/, "o modelo nao recebe horarios");
  assert.deepEqual(chamada.messages.at(-1), { content: "Para que o agente usa ferramentas?", role: "user" });
  assert.equal(chamada.config.model, "modelo-de-teste");

  const [pergunta, resposta] = body.data.messages;
  assert.equal(pergunta.role, "user");
  assert.equal(resposta.role, "assistant");
  assert.equal(resposta.status, "completed");
  assert.equal(resposta.body, "O agente usa ferramentas para agir no mundo, como buscar na web ou enviar um e-mail. [00:09]", "12 s da linha menos 3 s de folga");
  assert.equal(resposta.citations.length, 1);
  assert.equal(resposta.citations[0].verified, true);
  assert.equal(resposta.citations[0].startSeconds, 9);
  assert.equal(resposta.citations[0].label, "00:09");
  assert.equal(body.data.conversation.title, "Para que o agente usa ferramentas", "o titulo vem da primeira pergunta, sem a interrogacao");

  const noBanco = await mensagensNoBanco(chat.id);
  assert.deepEqual(noBanco.map((row) => [row.role, row.status]), [["user", "completed"], ["assistant", "completed"]]);
  assert.equal(noBanco[1].provider, "openai");
  assert.equal(noBanco[1].model, "modelo-de-teste");

  // Mesmo envio de novo (rede repetiu): nada muda e o provedor nao e chamado outra vez.
  const repetida = await perguntar(chat.id, "Para que o agente usa ferramentas?", clientRequestId);
  assert.equal(repetida.response.status, 200);
  assert.equal(repetida.body.data.messages.length, 2);
  assert.equal(provedorFalso.chamadas.length, 1);
});

test("o provedor falha: a resposta fica marcada como falha, com a frase para o aluno, e a rota responde 500", async () => {
  provedorFalso.zerar();
  provedorFalso.responder = () => "";

  actAs(aluna);
  const { body, response } = await perguntar(chat.id, "E a memoria, para que serve?");
  assert.equal(response.status, 500);
  assert.equal(body.error, "Nao foi possivel obter a resposta do Tutor IA.");

  const noBanco = await mensagensNoBanco(chat.id);
  assert.equal(noBanco.length, 4);
  assert.equal(noBanco[3].status, "failed");
  assert.equal(noBanco[3].body, "Nao consegui concluir esta resposta. Tente novamente em alguns instantes.");
  const { body: chatLido } = await lerChat(chat.id);
  assert.equal(chatLido.data.messages[3].status, "failed");
});

test("limite diario (3 perguntas na politica): a terceira responde; a quarta e recusada com 429", async () => {
  provedorFalso.zerar();
  provedorFalso.responder = () => "A memoria guarda o que o agente ja fez, para ele nao repetir o mesmo trabalho.";

  actAs(aluna);
  const terceira = await perguntar(chat.id, "E a memoria?");
  assert.equal(terceira.response.status, 200, terceira.body.error);
  assert.equal(terceira.body.data.messages.at(-1).status, "completed");

  const quarta = await perguntar(chat.id, "Mais uma?");
  assert.equal(quarta.response.status, 429);
  assert.equal(quarta.body.error, "Voce atingiu o limite de perguntas das ultimas 24 horas.");
  assert.equal(provedorFalso.chamadas.length, 1);
});

test("renomear: a dona renomeia; titulo vazio e 400; outro aluno recebe 404", async () => {
  actAs(aluna);
  const response = await conversa.PATCH(pedido({ title: "Ferramentas do agente" }, "PATCH"), rota(chat.id));
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.data.title, "Ferramentas do agente");

  const vazio = await conversa.PATCH(pedido({ title: "   " }, "PATCH"), rota(chat.id));
  assert.equal(vazio.status, 400);

  actAs(alunoSemAcesso);
  assert.equal((await conversa.PATCH(pedido({ title: "Invasao" }, "PATCH"), rota(chat.id))).status, 404);
  assert.equal((await lerChat(chat.id)).response.status, 404, "outro aluno nao le o chat");
});

test("o Tutor nao mexe nas conversas da IA Diretor: renomear ou excluir por aqui e 404", async () => {
  const daDiretora = await createPlatformGuideConversation(contas.aluna.id);

  actAs(aluna);
  assert.equal((await conversa.PATCH(pedido({ title: "Nao" }, "PATCH"), rota(daDiretora.id))).status, 404);
  assert.equal((await conversa.DELETE(pedido(undefined, "DELETE"), rota(daDiretora.id))).status, 404);
  assert.equal((await lerChat(daDiretora.id)).response.status, 404);
});

test("excluir: o chat some da lista e nao abre mais, mas as mensagens continuam guardadas para analise", async () => {
  const antes = await mensagensNoBanco(chat.id);

  actAs(aluna);
  const response = await conversa.DELETE(pedido(undefined, "DELETE"), rota(chat.id));
  assert.equal(response.status, 200);
  assert.deepEqual((await lerTutor()).body.data.conversations, []);
  assert.equal((await lerChat(chat.id)).response.status, 404);
  assert.equal((await conversa.DELETE(pedido(undefined, "DELETE"), rota(chat.id))).status, 404, "excluir de novo e 404");

  assert.equal((await mensagensNoBanco(chat.id)).length, antes.length, "nada foi apagado do banco");
});

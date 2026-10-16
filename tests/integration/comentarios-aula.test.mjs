import assert from "node:assert/strict";
import { before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Comentarios da aula contra o banco LOCAL de verdade (docs/18 §3.1 "Comentarios"): rotas /api/comments
// chamadas como funcao, com a sessao simulada e o resto real (regra de acesso, store, gatilhos e RPC de
// moderacao). Quem pode ler e escrever, o que a equipe aparece como, reacao, denuncia, palavra bloqueada
// e o que some depois de moderado.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const lessonsRoute = await import("../../src/app/api/comments/lessons/[lessonId]/route.ts");
const reactionRoute = await import("../../src/app/api/comments/[commentId]/reaction/route.ts");
const reportRoute = await import("../../src/app/api/comments/[commentId]/report/route.ts");
const { createBlockedWord, deleteBlockedWord, moderateLessonComment } = await import("../../src/server/comments/comment-store.ts");

const { curso } = ESCOLA_DE_TESTE;
const aula = curso.aulas.aula3;
const aluna = usuarioDeTeste(contas.aluna);
const alunoSemAcesso = usuarioDeTeste(contas.alunoSemAcesso);
const produtor = usuarioDeTeste(contas.produtor);
const professor = usuarioDeTeste(contas.professor);
const analista = usuarioDeTeste(contas.analista);
const PALAVRA_BLOQUEADA = "teste-palavra-proibida";

const contasDeTeste = Object.values(contas).map((conta) => conta.id);

async function limparComentarios() {
  // Apagar os comentarios leva junto reacoes e denuncias (on delete cascade).
  unwrap(await db.from("lesson_comments").delete().in("author_id", contasDeTeste), "Limpando comentarios de teste");
  const rules = unwrap(await db.from("lesson_comment_blocked_words").select("id,word").eq("word", PALAVRA_BLOQUEADA), "Lendo regras de teste");

  for (const rule of rules) {
    await deleteBlockedWord(rule.id);
  }
}

function jsonRequest(url, method, payload) {
  return new Request(url, {
    body: payload === undefined ? undefined : JSON.stringify(payload),
    headers: { "content-type": "application/json" },
    method
  });
}

function listar(user, lessonId = aula, contentId = curso.id) {
  actAs(user);
  return lessonsRoute.GET(
    new Request(`http://localhost/api/comments/lessons/${lessonId}?contentId=${contentId}`),
    { params: Promise.resolve({ lessonId }) }
  );
}

function publicar(user, body, extra = {}) {
  actAs(user);
  return lessonsRoute.POST(
    jsonRequest(`http://localhost/api/comments/lessons/${aula}`, "POST", { body, contentId: curso.id, ...extra }),
    { params: Promise.resolve({ lessonId: aula }) }
  );
}

function reagir(user, commentId, reaction) {
  actAs(user);
  return reactionRoute.PUT(
    jsonRequest(`http://localhost/api/comments/${commentId}/reaction`, "PUT", { reaction }),
    { params: Promise.resolve({ commentId }) }
  );
}

function denunciar(user, commentId, reason) {
  actAs(user);
  return reportRoute.POST(
    jsonRequest(`http://localhost/api/comments/${commentId}/report`, "POST", { reason }),
    { params: Promise.resolve({ commentId }) }
  );
}

before(limparComentarios);

let comentarioDaAluna;
let respostaDoProfessor;

test("sem sessao, 401; aluno sem compra nao le nem escreve (403); conteudo faltando, 400", async () => {
  actAs(null);
  const semSessao = await lessonsRoute.GET(new Request(`http://localhost/api/comments/lessons/${aula}?contentId=${curso.id}`), { params: Promise.resolve({ lessonId: aula }) });
  assert.equal(semSessao.status, 401);

  assert.equal((await listar(alunoSemAcesso)).status, 403);
  assert.equal((await publicar(alunoSemAcesso, "Tentando comentar sem comprar")).status, 403);

  actAs(aluna);
  const semConteudo = await lessonsRoute.GET(new Request(`http://localhost/api/comments/lessons/${aula}`), { params: Promise.resolve({ lessonId: aula }) });
  assert.equal(semConteudo.status, 400);
});

test("aula sem comentarios devolve lista vazia para quem tem acesso", async () => {
  const response = await listar(aluna);

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, []);
});

test("aluna publica um comentario: volta aprovado, como Aluno, com o nome do perfil e aparece na lista", async () => {
  const response = await publicar(aluna, "  Primeira dúvida da aluna sobre a aula 3.  ");

  assert.equal(response.status, 201);
  comentarioDaAluna = (await response.json()).data;
  assert.equal(comentarioDaAluna.body, "Primeira dúvida da aluna sobre a aula 3.", "espacos das pontas saem");
  assert.equal(comentarioDaAluna.authorRole, "student");
  assert.equal(comentarioDaAluna.authorName, contas.aluna.nome);
  assert.equal(comentarioDaAluna.status, "approved");
  assert.equal(comentarioDaAluna.isOwn, true);

  const lista = (await (await listar(aluna)).json()).data;
  assert.deepEqual(lista.map((comment) => comment.id), [comentarioDaAluna.id]);
  assert.equal(lista[0].isOwn, true);
  assert.equal(lista[0].reportedByCurrentUser, false);
});

test("o mesmo texto de novo em menos de 30 s e recusado como duplicado (409)", async () => {
  const response = await publicar(aluna, "Primeira dúvida da aluna sobre a aula 3.");

  assert.equal(response.status, 409);
});

test("comentario vazio ou acima de 2000 letras e recusado (400)", async () => {
  assert.equal((await publicar(aluna, "   ")).status, 400);
  const longo = await publicar(aluna, "x".repeat(2001));
  assert.equal(longo.status, 400);
  assert.match((await longo.json()).error, /2000/);
});

test("professor responde: a resposta entra aninhada no comentario, etiquetada como Professor", async () => {
  const response = await publicar(professor, "Boa pergunta! A resposta está no módulo 2.", { parentCommentId: comentarioDaAluna.id });

  assert.equal(response.status, 201);
  respostaDoProfessor = (await response.json()).data;
  assert.equal(respostaDoProfessor.authorRole, "producer", "quem monta conteudo aparece como Professor");
  assert.equal(respostaDoProfessor.parentCommentId, comentarioDaAluna.id);

  const lista = (await (await listar(aluna)).json()).data;
  assert.equal(lista.length, 1, "a resposta nao vira comentario de primeiro nivel");
  assert.deepEqual(lista[0].replies.map((reply) => reply.id), [respostaDoProfessor.id]);
  assert.equal(lista[0].replies[0].isOwn, false, "para a aluna, a resposta nao e dela");
});

test("analista comenta como Moderador; responder a uma resposta e recusado (409)", async () => {
  const response = await publicar(analista, "Aviso da moderação: mantenham o respeito.");
  assert.equal(response.status, 201);
  assert.equal((await response.json()).data.authorRole, "moderator");

  const respostaDaResposta = await publicar(aluna, "Respondendo a resposta", { parentCommentId: respostaDoProfessor.id });
  assert.equal(respostaDaResposta.status, 409);
});

test("reacao: a aluna curte a resposta, troca por fogo, tira; a lista mostra a contagem e a reacao escolhida", async () => {
  assert.equal((await reagir(aluna, respostaDoProfessor.id, "like")).status, 200);
  let resposta = (await (await listar(aluna)).json()).data[0].replies[0];
  assert.deepEqual(resposta.reactions, { like: 1 });
  assert.equal(resposta.selectedReaction, "like");

  assert.equal((await reagir(aluna, respostaDoProfessor.id, "fire")).status, 200);
  resposta = (await (await listar(aluna)).json()).data[0].replies[0];
  assert.deepEqual(resposta.reactions, { fire: 1 }, "uma reacao por pessoa");

  assert.equal((await reagir(aluna, respostaDoProfessor.id, null)).status, 200);
  resposta = (await (await listar(aluna)).json()).data[0].replies[0];
  assert.deepEqual(resposta.reactions, {});
  assert.equal(resposta.selectedReaction, undefined);

  assert.equal((await reagir(aluna, respostaDoProfessor.id, "abraco")).status, 400, "reacao desconhecida");
  assert.equal((await reagir(alunoSemAcesso, respostaDoProfessor.id, "like")).status, 403, "sem acesso a aula, sem reacao");
});

test("denuncia: a aluna denuncia a resposta uma vez so; o proprio comentario nao pode ser denunciado", async () => {
  assert.equal((await denunciar(aluna, respostaDoProfessor.id, "Fora do tema")).status, 201);
  assert.equal((await denunciar(aluna, respostaDoProfessor.id, "De novo")).status, 201, "repetir nao duplica nem falha");
  const denuncias = unwrap(await db.from("lesson_comment_reports").select("reporter_id,reason").eq("comment_id", respostaDoProfessor.id), "Lendo denuncias");
  assert.equal(denuncias.length, 1);
  assert.equal(denuncias[0].reason, "Fora do tema", "a primeira razao fica");

  const resposta = (await (await listar(aluna)).json()).data[0].replies[0];
  assert.equal(resposta.reportedByCurrentUser, true);

  assert.equal((await denunciar(aluna, comentarioDaAluna.id, "Me denunciando")).status, 400);
});

test("palavra bloqueada pelo produtor: o comentario e recusado com a mensagem da regra (422)", async () => {
  await createBlockedWord({ actorId: contas.produtor.id, message: "Essa palavra não é permitida aqui.", word: PALAVRA_BLOQUEADA });

  const response = await publicar(aluna, `Olha a ${PALAVRA_BLOQUEADA.toUpperCase()} no meio do texto`);
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, "Essa palavra não é permitida aqui.");
});

test("comentario escondido pela moderacao some da lista do aluno; aprovado de novo, volta", async () => {
  await moderateLessonComment({ actorId: contas.produtor.id, commentId: comentarioDaAluna.id, note: "Fora do tema", status: "hidden" });
  let lista = (await (await listar(aluna)).json()).data;
  assert.ok(!lista.some((comment) => comment.id === comentarioDaAluna.id), "escondido nao aparece nem para a autora");
  assert.equal((await reagir(aluna, comentarioDaAluna.id, "like")).status, 404, "escondido nao recebe reacao");

  await moderateLessonComment({ actorId: contas.produtor.id, commentId: comentarioDaAluna.id, status: "approved" });
  lista = (await (await listar(aluna)).json()).data;
  assert.ok(lista.some((comment) => comment.id === comentarioDaAluna.id));
});

test("limite de 5 comentarios por minuto por pessoa (429)", async () => {
  // O produtor ainda nao comentou nesta rodada: 5 passam, o sexto e barrado.
  for (let index = 1; index <= 5; index += 1) {
    assert.equal((await publicar(produtor, `Comentário ${index} do produtor`)).status, 201);
  }

  const sexto = await publicar(produtor, "Comentário 6 do produtor");
  assert.equal(sexto.status, 429);
  assert.match((await sexto.json()).error, /Aguarde um minuto/);
});

import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Ajustes da v3a no sino do aluno (docs/24; src/components/member/notifications/): a lixeira por
// notificacao (allowHide: so o false desliga, comentario sempre pode, 403 tira o "⋯"), reagir e votar so
// abrem a notificacao depois que o servidor aceitou, a memoria do sino com dono (o id do aluno: depois de
// entrar com outra conta sem recarregar, nada da anterior aparece, nem a resposta atrasada de um pedido
// dela) e a pagina guardada do "Todas" que deixa de valer quando algo muda com o filtro "Não lidas". O
// fetch e o relogio sao trocados aqui; nada de rede.

const pedidos = [];
let pendentes = [];

// Cada GET (lista e resumo) fica pendente ate o teste responder.
globalThis.fetch = async (url, init) => {
  const address = String(url);
  pedidos.push({ method: init?.method ?? "GET", url: address });

  return new Promise((resolve) => {
    pendentes.push({
      responder: (body, status = 200) => resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status })),
      url: address
    });
  });
};

let agora = Date.parse("2026-10-22T15:00:00.000Z");
Date.now = () => agora;

const client = await import("../src/components/member/notifications/notifications-client.ts");
const model = await import("../src/components/member/notifications/notifications-model.ts");

const pagina = (ids, extra = {}) => ({
  asOf: new Date(agora).toISOString(),
  items: ids.map((id) => ({ createdAt: "2026-10-22T14:00:00.000Z", id, kind: "notice", readAt: null })),
  nextCursor: null,
  unread: ids.length,
  unseen: ids.length,
  ...extra
});
const listas = () => pedidos.filter((pedido) => pedido.url === "/api/notifications");
const resumos = () => pedidos.filter((pedido) => pedido.url.startsWith("/api/notifications/summary"));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function responder(url, body, status = 200) {
  const index = pendentes.findIndex((pendente) => pendente.url === url);
  assert.ok(index >= 0, `havia um pedido esperando em ${url}`);
  const [pendente] = pendentes.splice(index, 1);
  pendente.responder(status === 200 ? { data: body } : body, status);
  await tick();
  await tick();
}

const responderLista = (body, status) => responder("/api/notifications", body, status);

function recomecar(dono) {
  client.claimNotificationsMemory(dono);
  client.forgetInbox();
  pedidos.length = 0;
  pendentes = [];
}

// --- Lixeira por notificacao --------------------------------------------------------------------

test("lixeira por notificacao: so o false desliga; ausente ou nulo pode (aviso de antes); comentario sempre pode", () => {
  assert.equal(model.allowHideOf(false), false);
  assert.equal(model.allowHideOf(true), true);
  assert.equal(model.allowHideOf(null), true, "coluna nula (banco sem a 202610220002)");
  assert.equal(model.allowHideOf(undefined), true, "chave ausente na pagina do sino");
  assert.equal(model.allowHideOf("false"), true, "so o booleano false desliga");

  assert.equal(model.canHideNotification({ allowHide: false, kind: "notice" }), false);
  assert.equal(model.canHideNotification({ allowHide: true, kind: "notice" }), true);
  assert.equal(model.canHideNotification({ kind: "notice" }), true, "aviso sem a chave (previa ou API antiga)");
  assert.equal(model.canHideNotification({ allowHide: false, kind: "comment_reply" }), true, "comentario sempre tem o ⋯");
  assert.equal(model.canHideNotification({ allowHide: false, kind: "comment_mention" }), true);
});

test("o servidor recusou o excluir (403): o item perde o ⋯ sem mexer no resto", () => {
  const item = { allowHide: true, id: "n1", kind: "notice", readAt: null, title: "Aula nova" };
  const recusado = model.withHideRefused(item);

  assert.notEqual(recusado, item, "item novo (o estado do React troca)");
  assert.deepEqual(recusado, { ...item, allowHide: false });
  assert.equal(model.canHideNotification(recusado), false);
  assert.equal(item.allowHide, true, "o original nao muda");
});

test("o ⋯ leva o titulo no nome (numa lista de botoes, nunca vinte 'Mais opções' iguais)", () => {
  assert.equal(model.cardActionLabels({ reactions: null, title: " Aula nova " }).more, "Mais opções da notificação “Aula nova”");
  assert.equal(model.cardActionLabels({ reactions: null, title: "Aula nova" }).hide, "Excluir notificação “Aula nova”");
});

// --- Reagir e votar abrem so depois do servidor ---------------------------------------------------

test("reagir e votar: numa falha (429, 409, rede) nada e marcado como aberto; no sucesso, uma vez, com o valor gravado", async () => {
  const writes = model.createWriteQueue();
  const abertas = [];
  const resultados = [];
  let falhar = true;

  const enviar = model.openAfterWrite(
    (valor) => (falhar ? Promise.reject(Object.assign(new Error("Muitas tentativas. Espere um pouco."), { status: 429 })) : Promise.resolve(valor)),
    (valor, gravado) => abertas.push([valor, gravado])
  );

  writes.push("reaction:n1", "love", { confirmed: null, equal: (a, b) => a === b, send: enviar, settle: (outcome) => resultados.push(outcome) });
  await tick();
  await tick();
  assert.deepEqual(abertas, [], "429: o cartao continua nao lido (a abertura de verdade ainda vai)");
  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].failed, true);
  assert.equal(resultados[0].value, null, "volta para a reacao que vale no servidor");

  falhar = false;
  writes.push("reaction:n1", "like", { confirmed: null, equal: (a, b) => a === b, send: enviar, settle: (outcome) => resultados.push(outcome) });
  await tick();
  await tick();
  assert.deepEqual(abertas, [["like", "like"]], "gravou: abre, com o que ficou valendo");
  assert.equal(resultados[1].failed, false);

  // O erro do envio continua chegando ao settle (a frase do cartao): openAfterWrite nao engole a falha.
  await assert.rejects(model.openAfterWrite(() => Promise.reject(new Error("rede")), () => abertas.push("nunca"))("x"), /rede/);
  assert.equal(abertas.length, 1);
});

// --- Memoria com dono ---------------------------------------------------------------------------

test("a pagina guardada e do aluno: com outro id ela nao vale, e a busca sai de novo para o novo dono", async () => {
  recomecar("aluno-a");
  client.prefetchInbox({ minAgeMs: model.INBOX_REUSE_MS, userId: "aluno-a" });
  await responderLista(pagina(["a1", "a2"]));
  assert.deepEqual(client.takeKeptInbox(agora, "aluno-a")?.kept.items.map((item) => item.id), ["a1", "a2"]);
  assert.ok(client.takeKeptInbox(agora), "sem id (quem nao sabe o dono): como antes");

  // Outra conta entrou sem recarregar a pagina (router.replace depois do login).
  assert.equal(client.takeKeptInbox(agora, "aluno-b"), null, "a pagina da conta anterior nao abre para a nova");

  client.prefetchInbox({ minAgeMs: model.INBOX_REUSE_MS, userId: "aluno-b" });
  assert.equal(listas().length, 2, "a pagina guardada era de outro: a busca sai de novo");
  await responderLista(pagina(["b1"]));
  assert.deepEqual(client.takeKeptInbox(agora, "aluno-b")?.kept.items.map((item) => item.id), ["b1"]);
  assert.equal(client.takeKeptInbox(agora, "aluno-a"), null, "e a de B nunca abre para A");
});

test("resposta atrasada de um pedido do dono anterior nao e guardada; o painel do novo dono nao entra nele", async () => {
  recomecar("aluno-a");
  client.prefetchInbox({ minAgeMs: model.INBOX_REUSE_MS, userId: "aluno-a" });
  assert.equal(listas().length, 1);

  client.claimNotificationsMemory("aluno-b");
  const doPainel = client.loadInboxFirstPage(undefined, "aluno-b");
  assert.equal(listas().length, 2, "o pedido que saiu para A nao serve para B");

  // A resposta de A chega depois da troca: volta para quem esperava, mas nao fica guardada.
  await responder("/api/notifications", { ...pagina(["a1"]) });
  assert.equal(client.takeKeptInbox(agora, "aluno-b"), null);
  assert.equal(client.currentSummaryFor("aluno-b").unseen, 0, "nem vira o numero do sino de B");

  await responder("/api/notifications", { ...pagina(["b1", "b2"]) });
  assert.deepEqual((await doPainel).items.map((item) => item.id), ["b1", "b2"]);
  assert.deepEqual(client.takeKeptInbox(agora, "aluno-b")?.kept.items.map((item) => item.id), ["b1", "b2"]);
  assert.equal(client.currentSummaryFor("aluno-b").unseen, 2);
});

test("o painel de outra conta nao guarda nada nem mexe na memoria do dono atual", async () => {
  recomecar("aluno-b");
  client.prefetchInbox({ minAgeMs: model.INBOX_REUSE_MS, userId: "aluno-b" });
  await responderLista(pagina(["b1"]));
  const guardada = client.takeKeptInbox(agora, "aluno-b").kept;

  client.keepInbox({ ...pagina(["a1"]), fetchedAt: agora + 1, userId: "aluno-a" });
  client.forgetInbox("aluno-a");
  assert.deepEqual(client.takeKeptInbox(agora, "aluno-b")?.kept, guardada);

  client.keepInbox({ ...guardada, hiddenIds: ["b1"], userId: "aluno-b" });
  assert.deepEqual(client.takeKeptInbox(agora, "aluno-b")?.kept.items, [], "o dono guarda (sem as excluidas)");
});

test("o numero do sino e do aluno: o da conta anterior nunca aparece, nem o que chega atrasado", async () => {
  recomecar("aluno-a");
  agora += 5 * 60_000;
  const deA = client.refreshNotificationsSummary({ userId: "aluno-a" });
  await responder("/api/notifications/summary", { popup: null, unseen: 7 });
  await deA;
  assert.equal(client.currentSummaryFor("aluno-a").unseen, 7);
  assert.equal(client.currentSummaryFor("aluno-b").unseen, 0, "antes de o topo dizer o novo dono: zero, nunca o 7 de A");
  assert.equal(client.currentSummaryFor(undefined).unseen, 7, "sem id: como antes");

  // A pede, a conta troca, e a resposta de A chega depois.
  agora += 2 * 60_000;
  const atrasado = client.refreshNotificationsSummary({ userId: "aluno-a" });
  client.claimNotificationsMemory("aluno-b");
  assert.deepEqual(client.currentSummaryFor("aluno-b"), { fetchedAt: null, owner: "aluno-b", status: "idle", unseen: 0 }, "a troca zera o numero");

  const deB = client.refreshNotificationsSummary({ userId: "aluno-b" });
  assert.notEqual(deB, atrasado, "B nao entra no pedido de A");
  assert.equal(resumos().length, 3);

  await responder("/api/notifications/summary", { popup: null, unseen: 9 });
  await atrasado;
  assert.equal(client.currentSummaryFor("aluno-b").unseen, 0, "o 9 de A chegou depois da troca: nao vale para B");

  await responder("/api/notifications/summary", { popup: null, unseen: 1 });
  await deB;
  assert.equal(client.currentSummaryFor("aluno-b").unseen, 1);

  // O painel de A que ainda responde (marcar como vistas) nao muda o numero de B.
  client.setSummaryUnseen(4, "aluno-a");
  assert.equal(client.currentSummaryFor("aluno-b").unseen, 1);
  client.setSummaryUnseen(0, "aluno-b");
  assert.equal(client.currentSummaryFor("aluno-b").unseen, 0);

  // Quem nao sabe o dono (o pop-up da home) continua pedindo para o dono atual.
  agora += 2 * 60_000;
  const doPopup = client.refreshNotificationsSummary({ popup: true });
  await responder("/api/notifications/summary?popup=1", { popup: null, unseen: 2 });
  await doPopup;
  assert.equal(client.currentSummaryFor("aluno-b").unseen, 2);
});

test("summaryFor: o numero so vale para o seu dono", () => {
  const deA = { fetchedAt: agora, owner: "aluno-a", status: "ready", unseen: 3 };

  assert.equal(client.summaryFor(deA, "aluno-a"), deA);
  assert.equal(client.summaryFor(deA, undefined), deA);
  assert.deepEqual(client.summaryFor(deA, "aluno-b"), { fetchedAt: null, owner: null, status: "idle", unseen: 0 });
  assert.deepEqual(client.summaryFor({ fetchedAt: agora, status: "ready", unseen: 3 }, null).unseen, 3, "sem dono gravado vale para null");
});

// --- Mudancas com o filtro "Não lidas" ---------------------------------------------------------------

test("mudanca com o filtro 'Não lidas': a pagina guardada do 'Todas' deixa de valer e a proxima abertura pede antes de mostrar", async () => {
  recomecar("aluno-a");
  client.prefetchInbox({ minAgeMs: model.INBOX_REUSE_MS, userId: "aluno-a" });
  await responderLista(pagina(["a1", "excluida"]));
  assert.ok(client.takeKeptInbox(agora, "aluno-a"));

  // O painel excluiu (ou abriu, reagiu, votou, respondeu, "Marcar todas") com o filtro "Não lidas".
  client.forgetInbox("aluno-a");
  assert.equal(client.takeKeptInbox(agora, "aluno-a"), null);
  assert.deepEqual(model.openingPlan(null, agora), { fetch: true, render: "skeleton", seen: "after_fetch" }, "reabrir: esqueleto e pedido, nunca a pagina velha");
});

test("um pedido do 'Todas' que saiu antes da mudanca nao guarda a resposta (seria a pagina de antes da exclusao)", async () => {
  recomecar("aluno-a");
  client.prefetchInbox({ minAgeMs: model.INBOX_REUSE_MS, userId: "aluno-a" });
  assert.equal(listas().length, 1);

  client.forgetInbox("aluno-a");
  await responderLista(pagina(["a1", "excluida"]));
  assert.equal(client.takeKeptInbox(agora, "aluno-a"), null, "a resposta do pedido de antes nao fica guardada");

  const depois = client.loadInboxFirstPage(undefined, "aluno-a");
  assert.equal(listas().length, 2, "o painel nao entra no pedido de antes: sai um novo");
  await responderLista(pagina(["a1"]));
  assert.deepEqual((await depois).items.map((item) => item.id), ["a1"]);
  assert.deepEqual(client.takeKeptInbox(agora, "aluno-a")?.kept.items.map((item) => item.id), ["a1"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Primeira pagina do sino guardada entre aberturas e a busca por intencao (docs/24 §7.3;
// src/components/member/notifications/notifications-client.ts): duas intencoes viram um pedido so, o
// painel entra no pedido que ja saiu, pagina nova o bastante nao pede de novo, 401 esquece tudo, e o que
// volta para a memoria sai sem as excluidas e com a hora da pagina. Mais a guarda pura da intencao
// (shouldPrefetchOnIntent), o Esc que fica no seletor de reacoes e as tres escritas novas. O fetch e o
// relogio sao trocados aqui; nada de rede.

const pedidos = [];
let pendentes = [];

// Cada GET da lista fica pendente ate o teste responder; as escritas respondem na hora.
let responderEscrita = () => ({ body: { data: {} }, status: 200 });

globalThis.fetch = async (url, init) => {
  const address = String(url);
  pedidos.push({ body: init?.body ? JSON.parse(String(init.body)) : null, method: init?.method ?? "GET", url: address });

  if ((init?.method ?? "GET") === "GET" && address.startsWith("/api/notifications") && !address.includes("summary")) {
    return new Promise((resolve) => {
      pendentes.push((body, status = 200) => resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status })));
    });
  }

  const { body, status } = responderEscrita(address);

  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
};

let agora = Date.parse("2026-10-21T15:00:00.000Z");
Date.now = () => agora;

const client = await import("../src/components/member/notifications/notifications-client.ts");
const model = await import("../src/components/member/notifications/notifications-model.ts");

const pagina = (ids, extra = {}) => ({
  asOf: new Date(agora).toISOString(),
  items: ids.map((id) => ({ createdAt: "2026-10-21T14:00:00.000Z", id, kind: "notice", readAt: null })),
  nextCursor: null,
  unread: ids.length,
  unseen: 1,
  ...extra
});
const listas = () => pedidos.filter((pedido) => pedido.method === "GET" && pedido.url === "/api/notifications");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function recomecar() {
  client.forgetInbox();
  pedidos.length = 0;
  pendentes = [];
}

async function responderLista(body, status = 200) {
  const responder = pendentes.shift();
  assert.ok(responder, "havia um pedido da lista esperando");
  responder(status === 200 ? { data: body } : body, status);
  await tick();
}

test("duas intencoes viram um pedido; o painel entra no pedido que ja saiu", async () => {
  recomecar();
  client.prefetchInbox({ minAgeMs: model.INBOX_INTENT_STALE_MS });
  client.prefetchInbox({ minAgeMs: model.INBOX_REUSE_MS });
  assert.equal(listas().length, 1, "pedido em andamento: a segunda intencao nao pede");

  const doPainel = client.loadInboxFirstPage();
  assert.equal(listas().length, 1, "a abertura entra no pedido da intencao");

  await responderLista(pagina(["a", "b"]));
  const page = await doPainel;
  assert.deepEqual(page.items.map((item) => item.id), ["a", "b"]);
  assert.equal(page.fetchedAt, agora);
  assert.deepEqual(client.takeKeptInbox(agora)?.reuse, true, "a pagina ficou guardada");
});

test("pagina com menos de 5 s nao pede de novo ao apertar o sino; passar o mouse so busca com ela mais velha que 1 minuto", async () => {
  recomecar();
  client.prefetchInbox({ minAgeMs: model.INBOX_REUSE_MS });
  await responderLista(pagina(["a"]));
  assert.equal(listas().length, 1);

  agora += 4_000;
  client.prefetchInbox({ minAgeMs: model.INBOX_REUSE_MS });
  assert.equal(listas().length, 1, "guardada ha 4 s: nada");
  assert.equal(client.takeKeptInbox(agora)?.reuse, true);

  agora += 26_000;
  client.prefetchInbox({ minAgeMs: model.INBOX_INTENT_STALE_MS });
  assert.equal(listas().length, 1, "mouse com a pagina de 30 s: nada");
  assert.equal(client.takeKeptInbox(agora)?.reuse, false, "30 s: mostra e atualiza");

  agora += 40_000;
  client.prefetchInbox({ minAgeMs: model.INBOX_INTENT_STALE_MS });
  assert.equal(listas().length, 2, "mouse com a pagina de 70 s: busca");
  await responderLista(pagina(["n", "a"]));
  assert.deepEqual(client.takeKeptInbox(agora)?.kept.items.map((item) => item.id), ["n", "a"]);
});

test("passados 10 min a pagina guardada some", async () => {
  recomecar();
  client.prefetchInbox({ minAgeMs: model.INBOX_REUSE_MS });
  await responderLista(pagina(["a"]));

  agora += model.INBOX_KEEP_MS;
  assert.ok(client.takeKeptInbox(agora), "10 min exatos: ainda vale");
  agora += 1;
  assert.equal(client.takeKeptInbox(agora), null);
  assert.equal(client.takeKeptInbox(agora), null);
});

test("401 esquece a pagina guardada; outra falha mantem", async () => {
  recomecar();
  client.prefetchInbox({ minAgeMs: model.INBOX_REUSE_MS });
  await responderLista(pagina(["a"]));

  agora += 6_000;
  const falha = assert.rejects(client.loadInboxFirstPage(), (error) => error instanceof client.NotificationsRequestError && error.status === 503);
  await responderLista({ error: "Servico indisponivel." }, 503);
  await falha;
  assert.ok(client.takeKeptInbox(agora), "falha comum: a de antes continua");

  const sessao = assert.rejects(client.loadInboxFirstPage(), (error) => error.status === 401);
  await responderLista({ error: "Sessao obrigatoria." }, 401);
  await sessao;
  assert.equal(client.takeKeptInbox(agora), null, "sessao encerrada: nada guardado vale");

  // Pela busca por intencao tambem (nunca lanca).
  client.prefetchInbox({ minAgeMs: model.INBOX_REUSE_MS });
  client.keepInbox({ ...pagina(["x"]), fetchedAt: 0 });
  await responderLista({ error: "Sessao obrigatoria." }, 401);
  await tick();
  assert.equal(client.takeKeptInbox(agora), null);
});

test("o que volta para a memoria sai sem as excluidas e com a hora da pagina; uma pagina mais nova nao e trocada", async () => {
  recomecar();
  client.prefetchInbox({ minAgeMs: model.INBOX_REUSE_MS });
  await responderLista(pagina(["a", "b", "c"]));
  const original = client.takeKeptInbox(agora).kept;

  agora += 3_000;
  client.keepInbox({ ...original, hiddenIds: ["b"], unread: 1 });
  const guardada = client.takeKeptInbox(agora);
  assert.deepEqual(guardada.kept.items.map((item) => item.id), ["a", "c"], "excluida nao volta ao reabrir");
  assert.equal(guardada.kept.fetchedAt, original.fetchedAt, "mudanca local nao torna a pagina nova");
  assert.equal(guardada.kept.unread, 1);

  agora += 3_000;
  assert.equal(client.takeKeptInbox(agora).reuse, false, "6 s depois do pedido: atualiza, mesmo com a mudanca de 3 s atras");

  // Chegou uma pagina mais nova (atualizacao por tras): o painel com a velha nao a desfaz.
  const nova = client.loadInboxFirstPage();
  await responderLista(pagina(["n", "a", "c"]));
  await nova;
  client.keepInbox({ ...original, hiddenIds: [] });
  assert.deepEqual(client.takeKeptInbox(agora).kept.items.map((item) => item.id), ["n", "a", "c"]);
});

test("o painel que fecha solta a espera, mas o pedido segue e a pagina fica guardada", async () => {
  recomecar();
  const controller = new AbortController();
  const espera = assert.rejects(client.loadInboxFirstPage(controller.signal), (error) => error.name === "AbortError");
  controller.abort();
  await espera;

  await responderLista(pagina(["a"]));
  assert.deepEqual(client.takeKeptInbox(agora)?.kept.items.map((item) => item.id), ["a"]);
  await assert.rejects(client.loadInboxFirstPage(controller.signal), (error) => error.name === "AbortError", "sinal ja abortado");
});

test("intencao: nunca com o painel aberto nem logo depois de fechar; foco so pelo teclado; apertar o sino fechado sempre", () => {
  const base = { closedAt: null, focusVisible: false, kind: "hover", now: agora, open: false };

  assert.equal(model.shouldPrefetchOnIntent(base), true);
  assert.equal(model.shouldPrefetchOnIntent({ ...base, open: true }), false, "painel aberto");
  assert.equal(model.shouldPrefetchOnIntent({ ...base, kind: "press", open: true }), false, "apertar com o painel aberto fecha");
  assert.equal(model.shouldPrefetchOnIntent({ ...base, closedAt: agora - 500 }), false, "500 ms depois de fechar");
  assert.equal(model.shouldPrefetchOnIntent({ ...base, closedAt: agora - 500, focusVisible: true, kind: "focus" }), false);
  assert.equal(model.shouldPrefetchOnIntent({ ...base, closedAt: agora - 1_000 }), true, "passado 1 s");
  assert.equal(model.shouldPrefetchOnIntent({ ...base, kind: "focus" }), false, "foco por codigo ou clique (sem :focus-visible)");
  assert.equal(model.shouldPrefetchOnIntent({ ...base, focusVisible: true, kind: "focus" }), true, "foco pelo Tab");
  assert.equal(model.shouldPrefetchOnIntent({ ...base, closedAt: agora - 100, kind: "press" }), true, "pointerdown no sino fechado");

  assert.equal(model.intentPrefetchMinAge("press"), model.INBOX_REUSE_MS);
  assert.equal(model.intentPrefetchMinAge("hover"), model.INBOX_INTENT_STALE_MS);
  assert.equal(model.intentPrefetchMinAge("focus"), model.INBOX_INTENT_STALE_MS);
});

test("Esc dentro do seletor de reacoes (escopo local) nao fecha o painel", () => {
  const elemento = (dentro) => ({ closest: (selector) => (selector === '[data-escape-scope="local"]' && dentro ? {} : null) });

  assert.equal(client.isInLocalEscapeScope(elemento(true)), true);
  assert.equal(client.isInLocalEscapeScope(elemento(false)), false);
  assert.equal(client.isInLocalEscapeScope(null), false);
  assert.equal(client.isInLocalEscapeScope({}), false, "o document e a window nao tem closest");
});

test("reagir, votar e excluir: rota, corpo e as frases do servidor (429 com a frase de muitas tentativas)", async () => {
  recomecar();
  responderEscrita = (url) => {
    if (url.endsWith("/reaction")) return { body: { data: { reaction: "love" } }, status: 200 };
    if (url.endsWith("/poll")) return { body: { data: { poll: { choice: ["sim"] } } }, status: 200 };
    if (url.endsWith("/hide")) return { body: { data: { unread: 2, unseen: 0 } }, status: 200 };
    return { body: { data: { changed: true, response: "declined" } }, status: 200 };
  };

  assert.deepEqual(await client.postReaction("n 1", "love"), { reaction: "love" });
  assert.deepEqual(await client.postPollVote("n1", ["sim"]), { poll: { choice: ["sim"] } });
  assert.deepEqual(await client.postHide("n1", true), { unread: 2, unseen: 0 });
  assert.deepEqual(await client.postResponse("n1", "declined"), { changed: true, response: "declined" });
  assert.deepEqual(
    pedidos.map((pedido) => [pedido.method, pedido.url, pedido.body]),
    [
      ["POST", "/api/notifications/n%201/reaction", { reaction: "love" }],
      ["POST", "/api/notifications/n1/poll", { optionIds: ["sim"] }],
      ["POST", "/api/notifications/n1/hide", { hidden: true }],
      ["POST", "/api/notifications/n1/response", { response: "declined" }]
    ]
  );

  responderEscrita = () => ({ body: { error: "Muitas tentativas. Espere um pouco." }, status: 429 });
  await assert.rejects(client.postReaction("n1", null), (error) => error.status === 429 && error.message === "Muitas tentativas. Espere um pouco.");
  responderEscrita = () => ({ body: { error: "A enquete foi encerrada." }, status: 409 });
  await assert.rejects(client.postPollVote("n1", []), (error) => error.status === 409 && error.message === "A enquete foi encerrada.");
  responderEscrita = () => ({ body: { error: "Erro interno." }, status: 500 });
  await assert.rejects(client.postHide("n1", false), (error) => error.status === 500 && error.message === "Não foi possível desfazer. Tente de novo.");
});

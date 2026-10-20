import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Numero do sino guardado no navegador (src/components/member/notifications/notifications-client.ts;
// docs/22 §1.1 e §4.3): na home, o pedido do pop-up e o unico (traz o numero junto) e o topo nao pede o
// seu enquanto ele vai sair; pedido comum aproveita o que esta em andamento; e uma falha conta como
// tentativa (troca de pagina e volta para a aba esperam o mesmo minuto, sem um pedido por pagina numa
// queda). O fetch e o relogio sao trocados aqui; nada de rede.

const pedidos = [];
let responder = () => ({ body: { data: { popup: null, unseen: 2 } }, status: 200 });

globalThis.fetch = async (url) => {
  pedidos.push(String(url));
  const { body, status } = responder(String(url));

  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
};

let agora = Date.parse("2026-10-20T15:00:00.000Z");
Date.now = () => agora;

const client = await import("../src/components/member/notifications/notifications-client.ts");
const MINUTO = 60_000;

test("na home o pedido do pop-up e o unico: o topo espera por ele e um pedido comum aproveita o que esta em andamento", async () => {
  client.holdSummaryForPopup(true);
  assert.equal(await client.refreshNotificationsSummary(), null, "o pop-up vai pedir: o topo nao pede o seu");
  assert.deepEqual(pedidos, []);

  client.holdSummaryForPopup(false);
  responder = () => ({ body: { data: { popup: { id: "aviso" }, unseen: 3 } }, status: 200 });
  const doPopup = client.refreshNotificationsSummary({ popup: true });
  const comum = client.refreshNotificationsSummary();

  assert.equal(comum, doPopup, "o pedido comum aproveita o do pop-up");
  assert.deepEqual(await doPopup, { popup: { id: "aviso" }, unseen: 3 });
  assert.deepEqual(pedidos, ["/api/notifications/summary?popup=1"]);

  assert.equal(await client.refreshNotificationsSummary(), null, "numero recente: nada de pedido novo");
  assert.equal(pedidos.length, 1);
});

test("o pedido do pop-up sai mesmo com um pedido comum em andamento (o comum nao traz o pop-up)", async () => {
  agora += 2 * MINUTO;
  pedidos.length = 0;
  responder = (url) => ({ body: { data: { popup: url.includes("popup=1") ? { id: "aviso" } : null, unseen: 1 } }, status: 200 });

  const comum = client.refreshNotificationsSummary();
  const doPopup = client.refreshNotificationsSummary({ popup: true });

  assert.notEqual(comum, doPopup);
  assert.deepEqual((await doPopup).popup, { id: "aviso" });
  await comum;
  assert.deepEqual(pedidos, ["/api/notifications/summary", "/api/notifications/summary?popup=1"]);
});

test("falha conta como tentativa: dentro do mesmo minuto ninguem pede de novo; depois dele, pede", async () => {
  agora += 2 * MINUTO;
  pedidos.length = 0;
  responder = () => ({ body: { error: "Servico indisponivel." }, status: 503 });

  assert.equal(await client.refreshNotificationsSummary(), null, "falhou: nunca lanca");
  assert.equal(pedidos.length, 1);

  agora += 10_000;
  assert.equal(await client.refreshNotificationsSummary(), null);
  assert.equal(pedidos.length, 1, "troca de pagina logo depois da falha nao pede de novo");

  agora += MINUTO;
  responder = () => ({ body: { data: { popup: null, unseen: 4 } }, status: 200 });
  assert.deepEqual(await client.refreshNotificationsSummary(), { popup: null, unseen: 4 });
  assert.equal(pedidos.length, 2, "passado o minuto, tenta de novo");

  agora += MINUTO;
  responder = () => ({ body: { error: "Sessao obrigatoria." }, status: 401 });
  assert.equal(await client.refreshNotificationsSummary({ force: true }), null);
  assert.equal(pedidos.length, 3, "force pede mesmo dentro do minuto");
});

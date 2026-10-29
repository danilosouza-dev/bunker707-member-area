import assert from "node:assert/strict";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Beacon das visitas que nao sao navegacao (src/components/member/page-visit-beacon.ts; docs/23 §5.2). O
// modulo vive enquanto a aba navega pelo App Router (nunca recarrega): abrir os detalhes do mesmo produto
// de novo depois da trava do servidor manda outro beacon, senao a visita depois de uma notificacao (ou
// de um fluxo que passou a acompanhar o produto) nunca seria gravada. navigator.sendBeacon e o relogio
// sao trocados aqui; nada de rede.

const enviados = [];
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    sendBeacon(url, data) {
      enviados.push({ data, url });
      return true;
    }
  }
});
globalThis.fetch = async () => {
  throw new Error("o beacon nao deveria cair no fetch");
};

let agora = Date.parse("2026-10-21T12:00:00.000Z");
Date.now = () => agora;

const beacon = await import("../src/components/member/page-visit-beacon.ts");
const { PAGE_VISIT_THROTTLE_MS } = await import("../src/server/member-area/page-visit-model.ts");

async function chaves() {
  const lidas = enviados.map(({ data, url }) => {
    // Texto, nunca Blob: no WebKit o Blob pode ser coletado antes do envio e o POST sai vazio (notifications-client.ts).
    assert.equal(typeof data, "string", "o beacon manda o corpo como texto");
    return [url, JSON.parse(data).key];
  });
  enviados.length = 0;
  return lidas;
}

test("detalhes do produto: repetir dentro da trava nao manda nada; depois dela (mesma aba, sem recarregar) manda de novo", async () => {
  assert.equal(PAGE_VISIT_THROTTLE_MS, 10_000, "a mesma trava do servidor (page-visits.ts)");

  beacon.trackProductDetails("produto-x");
  beacon.trackProductDetails("produto-x");
  assert.deepEqual(await chaves(), [["/api/page-visits", "content:produto-x"]], "abrir e fechar rapido: um beacon so");

  agora += PAGE_VISIT_THROTTLE_MS - 1;
  beacon.trackProductDetails("produto-x");
  assert.deepEqual(await chaves(), []);

  // 40 minutos depois, a aluna toca na notificacao e abre os detalhes de novo: a visita conta.
  agora += 40 * 60_000;
  beacon.trackProductDetails("produto-x");
  beacon.trackProductDetails("produto-y");
  assert.deepEqual(await chaves(), [
    ["/api/page-visits", "content:produto-x"],
    ["/api/page-visits", "content:produto-y"]
  ]);

  beacon.trackProductDetails("id com espaco");
  assert.deepEqual(await chaves(), [], "chave invalida nao sai");
});

test("clicar em Comprar manda sempre (o servidor absorve a repeticao)", async () => {
  beacon.trackCheckoutClick("produto-x");
  beacon.trackCheckoutClick("produto-x");
  assert.deepEqual(await chaves(), [
    ["/api/page-visits", "checkout:produto-x"],
    ["/api/page-visits", "checkout:produto-x"]
  ]);
});

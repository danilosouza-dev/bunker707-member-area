import assert from "node:assert/strict";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Lista de avisos da equipe (docs/22 §2.1): ?pagina= depois do fim nao derruba a tela. O PostgREST
// responde 416 (PGRST103) quando o `.range()` passa da ultima linha, mesmo com zero avisos e ?pagina=2;
// listCampaignRows devolve pagina vazia e a tela redireciona para uma pagina que existe
// (noticesPageFallbackHref, em tests/comunicacao-admin-modelo.test.mjs). Banco falso; a mesma leitura
// contra o PostgREST de verdade esta em tests/integration/avisos-e-notificacoes.test.mjs.

const { listCampaignRows } = await import("../src/server/communications/store.ts");

/** Banco falso da consulta da lista: registra os filtros e responde `result` no `.range()`. */
function fakeDb(result) {
  const calls = [];
  const query = {
    eq(...args) {
      calls.push(["eq", ...args]);
      return query;
    },
    is(...args) {
      calls.push(["is", ...args]);
      return query;
    },
    order(...args) {
      calls.push(["order", ...args]);
      return query;
    },
    range(...args) {
      calls.push(["range", ...args]);
      return Promise.resolve(result);
    },
    select(...args) {
      calls.push(["select", args[1]]);
      return query;
    }
  };

  return { calls, db: { from: (table) => (calls.push(["from", table]), query) } };
}

test("pagina depois do fim (416 / PGRST103) vira pagina vazia, sem erro", async () => {
  const { calls, db } = fakeDb({ count: null, data: null, error: { code: "PGRST103", details: "An offset of 100 was requested, but there are only 3 rows.", message: "Requested range not satisfiable" } });
  const result = await listCampaignRows(db, { kind: "popup", page: 6, pageSize: 20 });

  assert.deepEqual(result, { rows: [], total: 0 }, "sem total: a tela volta para a primeira pagina");
  assert.deepEqual(calls.find((call) => call[0] === "range"), ["range", 100, 119]);
  assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "kind" && call[2] === "popup"));
  assert.ok(calls.some((call) => call[0] === "is" && call[1] === "deleted_at" && call[2] === null), "excluidos ficam fora");

  const withCount = fakeDb({ count: 41, data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" } });
  assert.deepEqual(await listCampaignRows(withCount.db, { page: 6, pageSize: 20 }), { rows: [], total: 41 });
});

test("pagina que existe devolve as linhas e o total; outro erro do banco continua erro", async () => {
  const row = { id: "aviso-1", kind: "inbox", status: "draft" };
  const { db } = fakeDb({ count: 21, data: [row], error: null });
  assert.deepEqual(await listCampaignRows(db, { page: 2, pageSize: 20 }), { rows: [row], total: 21 });

  const broken = fakeDb({ count: null, data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
  await assert.rejects(() => listCampaignRows(broken.db, { page: 1, pageSize: 20 }));
});

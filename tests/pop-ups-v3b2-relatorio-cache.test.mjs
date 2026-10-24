import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";

// O cache do relatorio do pop-up (docs/29 §4.6), sem banco e sem Next: "next/cache" vira um duble que imita o
// Data Cache do Next 16.4 dentro de um request (uma entrada, achada pela chave e pelos argumentos, e devolvida
// para sempre: a vencida sai na hora e so renova por tras, e nenhuma vence sozinha). Com isso, so o minuto do
// relogio na chave garante que "Atualiza a cada minuto" vale: duas leituras 61 s depois, com numeros novos no
// banco, mostram os numeros novos; duas no mesmo minuto vem do cache (uma ida ao banco).

const estado = (globalThis.__popupV3b2RelatorioCache ??= { entradas: new Map() });

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/cache") {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(`
          export function unstable_cache(fn, keyParts) {
            const entradas = globalThis.__popupV3b2RelatorioCache.entradas;
            return async (...args) => {
              const chave = JSON.stringify([keyParts, args]);
              if (!entradas.has(chave)) {
                entradas.set(chave, await fn(...args));
              }
              return entradas.get(chave);
            };
          }
          export function revalidateTag() {}
          export function updateTag() {}
          export function revalidatePath() {}
          export function unstable_noStore() {}
          export function cacheTag() {}
          export function cacheLife() {}`)}`
      };
    }

    return nextResolve(specifier, context);
  }
});

const queries = await import("../src/server/communications/queries.ts");

const POPUP = "cccccccc-0000-4000-8000-000000000001";
const MIN = 60_000;
const T0 = Date.parse("2026-10-24T15:00:10Z");

/** Banco falso: so a RPC do relatorio, com os numeros que o teste troca entre as leituras. */
function banco(numeros) {
  const calls = { rpc: [] };
  const db = {
    calls,
    from() {
      throw new Error("sem produto citado, o relatorio nao le content_items");
    },
    async rpc(name, args) {
      calls.rpc.push({ args, name });
      return { data: [{ item: "", metric: "viewers", students: numeros.alunos, total: numeros.vezes }], error: null };
    }
  };
  actionStubs.db = db;
  return db;
}

function comRelogio(agora, run) {
  const original = Date.now;
  Date.now = () => agora;
  return run().finally(() => {
    Date.now = original;
  });
}

async function vezesQueApareceu(agora) {
  const result = await comRelogio(agora, () => queries.getPopupReport(POPUP));
  assert.equal(result.status, "ok");
  return result.view.kpis.find((kpi) => kpi.id === "times").value;
}

test("o minuto na chave do cache", () => {
  assert.equal(queries.popupReportCacheMinute(T0), queries.popupReportCacheMinute(T0 + 40_000), "mesmo minuto, mesma chave");
  assert.notEqual(queries.popupReportCacheMinute(T0), queries.popupReportCacheMinute(T0 + 61_000), "61 s depois, outra chave");
});

test("61 s depois, com números novos no banco, o relatório mostra os números novos mesmo com a entrada antiga guardada", async () => {
  estado.entradas.clear();
  const numeros = { alunos: 0, vezes: 0 };
  const db = banco(numeros);

  assert.equal(await vezesQueApareceu(T0), 0, "logo depois de publicar: ninguem viu");
  assert.equal(db.calls.rpc.length, 1);
  assert.equal(db.calls.rpc[0].name, "communication_popup_report");
  assert.deepEqual(db.calls.rpc[0].args, { p_campaign_id: POPUP });

  numeros.alunos = 35;
  numeros.vezes = 40;

  assert.equal(await vezesQueApareceu(T0 + 61_000), 40, "a janela de 60 s e dura: a entrada antiga nao volta");
  assert.equal(db.calls.rpc.length, 2, "uma ida nova ao banco");
});

test("no mesmo minuto, a segunda leitura vem do cache (uma ida ao banco)", async () => {
  estado.entradas.clear();
  const numeros = { alunos: 35, vezes: 40 };
  const db = banco(numeros);
  const inicio = T0 + 10 * MIN;

  assert.equal(await vezesQueApareceu(inicio), 40);
  numeros.vezes = 41;
  assert.equal(await vezesQueApareceu(inicio + 20_000), 40, "ainda o numero guardado");
  assert.equal(db.calls.rpc.length, 1);
});

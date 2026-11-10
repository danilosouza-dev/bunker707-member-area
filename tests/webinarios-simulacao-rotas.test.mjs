import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import {
  AVISOS,
  CONTADOR,
  DECISAO,
  ENDED_SESSION,
  ENTRADAS,
  LIVE_SESSION,
  MIN,
  OTHER_SESSION,
  REPLAY,
  SESSION,
  WEBINAR,
  bancoDaSimulacao,
  escolaDaSimulacao,
  iso,
  semAsColunasDaSimulacao
} from "./support/webinarios-v4-simulacao-banco.mjs";

// A rota da Simulacao do aluno (docs/30 §1.6, §4.3, §6.6 e §8.6; D6, D10; docs/18 §2.2), sem banco: o banco da
// Simulacao em memoria (tests/support/webinarios-v4-simulacao-banco.mjs) e a sessao do aluno pelo teste. GET
// .../simulation?sessao=&from=&to=: 401 sem sessao, 400 sem id, sem ?sessao= ou com a janela maior que 120 s, 404 para
// a sessao de outro webinario; a sessao gravada com regra devolve o contador, as entradas e os avisos da janela, iguais
// ao modelo e iguais para todos os alunos, sem a semente nem as regras; replay, sessao sem regra e banco sem a
// 202610300003 devolvem enabled false; nada vai para student_events; a resposta e sem cache. R7 (adendo de 10/11/2026):
// a Live ao vivo com regra e decisao devolve a janela contada do started_at, com a forma pela duracao prevista.

const sessao = (globalThis.__simulacaoRotasSessao ??= { user: null });

function moduloDeSrc(specifier, context) {
  if (specifier.startsWith("@/")) {
    return specifier.slice(2);
  }
  if (/^\.{1,2}\//.test(specifier) && context.parentURL) {
    const url = new URL(specifier, context.parentURL).href;
    const index = url.indexOf("/src/");
    return index === -1 ? null : url.slice(index + 5).replace(/\.tsx?$/, "");
  }
  return null;
}

const stub = (source) => ({ shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` });

registerHooks({
  resolve(specifier, context, nextResolve) {
    const modulo = moduloDeSrc(specifier, context);
    if (modulo === "server/auth/guards") {
      return stub(`
        export async function requireApiUser() {
          const user = globalThis.__simulacaoRotasSessao.user;
          return user ? { response: null, user } : { response: Response.json({ error: "Sessao obrigatoria." }, { status: 401 }), user: null };
        }
        export const requireApiSessionUser = requireApiUser;`);
    }
    if (modulo === "server/db/supabase/client") {
      return stub(`
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`);
    }
    return nextResolve(specifier, context);
  }
});

const route = await import("../src/app/api/webinars/[id]/simulation/route.ts");
const model = await import("../src/server/webinars/simulation-model.ts");
const { sessionSimulationFromRow } = await import("../src/server/webinars/rows.ts");
const { resetRoomAccessCache } = await import("../src/server/webinars/room-route.ts");

let proximoAluno = 500;

function novoAluno() {
  proximoAluno += 1;
  const id = `66666666-7777-4666-8666-${String(proximoAluno).padStart(12, "0")}`;
  sessao.user = { id };
  return id;
}

function montar(options = {}, { semColunas = false } = {}) {
  const tables = escolaDaSimulacao(options);
  const db = semColunas ? semAsColunasDaSimulacao({ tables }) : bancoDaSimulacao({ tables });
  actionStubs.db = db;
  resetRoomAccessCache();
  return { db, userId: novoAluno() };
}

const contexto = (id = WEBINAR) => ({ params: Promise.resolve({ id }) });
const ler = async ({ from = 0, sessionId = SESSION, to = 120_000, webinarId = WEBINAR } = {}) => {
  const response = await route.GET(new Request(`http://localhost/api/webinars/${webinarId}/simulation?sessao=${sessionId}&from=${from}&to=${to}`), contexto(webinarId));
  return { body: await response.json(), headers: response.headers, status: response.status };
};
const regras = { ...DECISAO, simulated_count_rule: CONTADOR, simulated_joins: ENTRADAS, simulated_sale_notices: AVISOS };
const semDecisao = { simulated_count_rule: CONTADOR, simulated_joins: ENTRADAS, simulated_sale_notices: AVISOS };

test("guardas: 401 sem sessao, 400 sem id, sem ?sessao= ou com a janela maior que 120 s ou ao contrario, 404 para a sessao de outro webinario", async () => {
  montar({ sessao: regras });
  sessao.user = null;
  assert.equal((await ler()).status, 401);

  novoAluno();
  const semId = await route.GET(new Request(`http://localhost/api/webinars/x/simulation?sessao=${SESSION}&from=0&to=1000`), contexto("nao-e-id"));
  assert.equal(semId.status, 400);
  const semSessao = await route.GET(new Request(`http://localhost/api/webinars/${WEBINAR}/simulation?from=0&to=1000`), contexto());
  assert.equal(semSessao.status, 400);
  assert.equal((await ler({ from: 0, to: 120_001 })).status, 400, "no maximo 120 s");
  assert.equal((await ler({ from: 5_000, to: 1_000 })).status, 400, "o fim antes do comeco");
  assert.equal((await ler({ from: "abc", to: 1_000 })).status, 400);
  const outra = await ler({ sessionId: OTHER_SESSION });
  assert.equal(outra.status, 404, "a sessao e de outro webinario");
  assert.equal(outra.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("a sessao gravada com regra: o contador, as entradas e os avisos da janela, iguais ao modelo e para todos; nunca a semente nem as regras; nada em student_events", async () => {
  const { db } = montar({ minutosNoAr: 12, sessao: regras });
  const row = db.tables.webinar_sessions.find((item) => item.id === SESSION);
  const from = 10 * MIN;
  const to = from + 120_000;

  const primeira = await ler({ from, to });
  assert.equal(primeira.status, 200);
  assert.equal(primeira.headers.get("cache-control"), "private, no-store, max-age=0");
  const feed = primeira.body.data;
  assert.equal(feed.enabled, true);
  assert.deepEqual(feed, model.simulationFeed({ durationMs: 60 * MIN, fromMs: from, kind: "simulated", simulation: sessionSimulationFromRow(row), status: "live", toMs: to }));
  assert.ok(feed.counter.every((point) => point.extra === 40), "Real + 40 fixo");
  assert.ok(feed.joins.length >= 3, "uma entrada a cada 30 s");
  assert.deepEqual(feed.saleNotices, [{ atMs: 11 * MIN, text: "Carlos acabou de garantir a vaga na Formação" }]);
  assert.doesNotMatch(JSON.stringify(primeira.body), /424242|seed|every_seconds|jitter|peak/, "nem a semente nem as regras");

  novoAluno();
  const segunda = await ler({ from, to });
  assert.deepEqual(segunda.body.data, feed, "outro aluno ve o mesmo numero e as mesmas entradas");
  assert.equal(db.tables.student_events.length, 0, "nada no historico (§6.6)");
  assert.equal(db.calls.writes.length, 0, "a rota so le");
});

test("replay, live sem regra, sessao sem regra, sessao encerrada antes do minuto e banco sem a 202610300003 devolvem enabled false com listas vazias", async () => {
  montar({ sessao: regras });
  const vazio = (from, to) => ({ counter: [], enabled: false, from, joins: [], saleNotices: [], to });

  for (const sessionId of [REPLAY, LIVE_SESSION]) {
    const { db } = montar({ sessao: regras });
    const row = db.tables.webinar_sessions.find((item) => item.id === sessionId);
    Object.assign(row, sessionId === LIVE_SESSION ? {} : regras);
    const answer = await ler({ sessionId });
    assert.equal(answer.status, 200, sessionId);
    assert.deepEqual(answer.body.data, vazio(0, 120_000), sessionId === REPLAY ? "o Replay livre nunca simula" : "a live sem regra nao simula");
  }

  montar();
  assert.deepEqual((await ler()).body.data, vazio(0, 120_000), "sem regra, nada");

  const encerrada = montar({ sessao: regras });
  const ended = encerrada.db.tables.webinar_sessions.find((item) => item.id === ENDED_SESSION);
  Object.assign(ended, regras, { ended_at: iso(Date.parse(ended.scheduled_at) + 20 * MIN) });
  const depois = await ler({ from: 30 * MIN, sessionId: ENDED_SESSION, to: 30 * MIN + 60_000 });
  assert.equal(depois.status, 200);
  assert.deepEqual([depois.body.data.joins, depois.body.data.saleNotices], [[], []], "a equipe encerrou aos 20 min: nada depois");
  assert.ok(depois.body.data.counter.every((point) => point.extra === 0));

  montar({ sessao: regras }, { semColunas: true });
  const pendente = await ler();
  assert.equal(pendente.status, 200);
  assert.deepEqual(pendente.body.data, vazio(0, 120_000), "banco sem a 202610300003: a sala segue como hoje");
});

test("CDC (§8.6, D10): a regra gravada sem a decisao registrada (sem a frase marcada ou sem a hora) nao mostra nada ao aluno", async () => {
  const vazio = { counter: [], enabled: false, from: 0, joins: [], saleNotices: [], to: 120_000 };

  montar({ sessao: semDecisao });
  assert.deepEqual((await ler()).body.data, vazio, "regra sem decisao: nada simulado na sala");

  montar({ sessao: { ...regras, simulation_ack_text: "   " } });
  assert.deepEqual((await ler()).body.data, vazio, "frase vazia nao vale como decisao");

  montar({ sessao: { ...regras, simulation_decided_at: null } });
  assert.deepEqual((await ler()).body.data, vazio, "sem a hora da decisao, nada");

  montar({ sessao: regras });
  assert.equal((await ler()).body.data.enabled, true, "com a decisao registrada, a sala simula");
});

test("R7: a Live ao vivo com regra e decisao devolve a janela contada do started_at (a forma pela duracao prevista, sem fim antes do Encerrar live), igual para todos", async () => {
  const { db } = montar({ webinar: { kind: "live" } });
  const live = db.tables.webinar_sessions.find((item) => item.id === LIVE_SESSION);
  Object.assign(live, regras, { ended_at: null, recording_anchor_at: null, scheduled_at: iso(Date.now() - 20 * MIN), started_at: iso(Date.now() - 12 * MIN), status: "live" });
  const from = 10 * MIN;
  const to = from + 120_000;
  const answer = await ler({ from, sessionId: LIVE_SESSION, to });
  assert.equal(answer.status, 200);
  const feed = answer.body.data;
  assert.equal(feed.enabled, true);
  assert.deepEqual(feed, model.simulationFeed({ durationMs: 60 * MIN, endMs: Number.POSITIVE_INFINITY, fromMs: from, kind: "live", simulation: sessionSimulationFromRow(live), status: "live", toMs: to }));
  assert.ok(feed.counter.every((point) => point.extra === 40), "Real + 40 fixo");
  assert.deepEqual(feed.saleNotices, [{ atMs: 11 * MIN, text: "Carlos acabou de garantir a vaga na Formação" }]);
  novoAluno();
  assert.deepEqual((await ler({ from, sessionId: LIVE_SESSION, to })).body.data, feed, "outro aluno ve o mesmo");
  assert.equal(db.calls.writes.length, 0);

  // A live que passou do previsto (60 min) segue somando ate o Encerrar live.
  const depois = await ler({ from: 70 * MIN, sessionId: LIVE_SESSION, to: 70 * MIN + 60_000 });
  assert.ok(depois.body.data.counter.every((point) => point.extra === 40));

  // Sem a decisao registrada, nada (como na gravada).
  Object.assign(live, { simulation_ack_text: null });
  resetRoomAccessCache();
  assert.equal((await ler({ from, sessionId: LIVE_SESSION, to })).body.data.enabled, false);
});

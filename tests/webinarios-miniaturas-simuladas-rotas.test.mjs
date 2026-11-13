import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { CONTADOR, DECISAO, LIVE_SESSION, MIN, OTHER_SESSION, REPLAY, SESSION, WEBINAR, bancoDaSimulacao, escolaDaSimulacao, iso, semAsColunasDaSimulacao } from "./support/webinarios-v4-simulacao-banco.mjs";

// A rota das miniaturas simuladas da Live ao vivo (docs/30 D120; docs/18 §2.2), sem banco: o banco da Simulacao em
// memoria e a sessao do aluno pelo teste. GET .../audience?sessao=: 401 sem sessao, 400 sem id ou sem ?sessao=, 404
// para a sessao de outro webinario; a live com participantes simulados e a decisao registrada devolve a lista
// ordenada (quem comenta com foto, quem comenta sem foto, os nomes genericos), igual para todos, sem a semente nem as
// regras; a sessao gravada, o replay, a live sem participantes simulados, sem a decisao, encerrada ou cancelada e o
// banco sem as colunas devolvem enabled false; a resposta fica 30 s na memoria do processo; nada vai para
// student_events e a rota so le.

const sessao = (globalThis.__miniaturasRotasSessao ??= { user: null });

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
          const user = globalThis.__miniaturasRotasSessao.user;
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

const ORIGIN = "https://projeto.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGIN;

const route = await import("../src/app/api/webinars/[id]/audience/route.ts");
const tiles = await import("../src/server/webinars/audience-tiles-model.ts");
const { AUDIENCE_TILES_CACHE_MS, loadAudienceTiles, resetAudienceTilesCache } = await import("../src/server/webinars/audience-tiles-store.ts");
const { resetRoomAccessCache } = await import("../src/server/webinars/room-route.ts");

const FOTO = "webinars/personas/aaaaaaaaaaaaaaaaaaaaaaaa.webp";
const pessoa = (id, name, avatar_path = null, webinar_id = WEBINAR) => ({ avatar_path, created_at: iso(Date.now() - 60 * MIN), id, name, role: "student", updated_at: iso(Date.now() - 60 * MIN), webinar_id });
const PESSOAS = [
  pessoa("11111111-aaaa-4bbb-8ccc-000000000001", "Zélia Prado"),
  pessoa("22222222-aaaa-4bbb-8ccc-000000000002", "Marcos Lima", FOTO),
  pessoa("99999999-aaaa-4bbb-8ccc-000000000009", "De Outro Webinario", FOTO, "ffffffff-0000-4000-8000-00000000ffff")
];
// O roteiro deste webinario: a Zélia e o Marcos comentam aqui; a pessoa criada em outro webinario, nao (a lista de
// pessoas e uma so da escola, docs/30 D117).
const ROTEIRO = [
  { id: "aaaaaaaa-1111-4aaa-8aaa-000000000001", persona_avatar_path: null, persona_id: PESSOAS[0].id, webinar_id: WEBINAR },
  { id: "aaaaaaaa-1111-4aaa-8aaa-000000000002", persona_avatar_path: FOTO, persona_id: PESSOAS[1].id, webinar_id: WEBINAR },
  { id: "aaaaaaaa-1111-4aaa-8aaa-000000000003", persona_avatar_path: null, persona_id: null, webinar_id: WEBINAR },
  { id: "aaaaaaaa-1111-4aaa-8aaa-000000000004", persona_avatar_path: FOTO, persona_id: PESSOAS[2].id, webinar_id: "ffffffff-0000-4000-8000-00000000ffff" }
];
const NO_AR = { ended_at: null, recording_anchor_at: null, scheduled_at: iso(Date.now() - 20 * MIN), started_at: iso(Date.now() - 12 * MIN), status: "live" };
const regras = { ...DECISAO, simulated_count_rule: CONTADOR };

let proximoAluno = 700;

function novoAluno() {
  proximoAluno += 1;
  const id = `66666666-7777-4666-8666-${String(proximoAluno).padStart(12, "0")}`;
  sessao.user = { id };
  return id;
}

/** A escola com o webinario ao vivo, a sessao da live com `live` por cima e as pessoas que comentam. */
function montar(live = {}, { pessoas = PESSOAS, roteiro = ROTEIRO, semColunas = false } = {}) {
  const tables = escolaDaSimulacao({ webinar: { kind: "live" } });
  if (pessoas) {
    tables.webinar_personas = pessoas.map((row) => ({ ...row }));
  }
  tables.webinar_chat_script_items = roteiro.map((row) => ({ ...row }));
  const db = semColunas ? semAsColunasDaSimulacao({ tables }) : bancoDaSimulacao({ tables });
  Object.assign(db.tables.webinar_sessions.find((item) => item.id === LIVE_SESSION), NO_AR, live);
  actionStubs.db = db;
  resetRoomAccessCache();
  resetAudienceTilesCache();
  return { db, userId: novoAluno() };
}

const contexto = (id = WEBINAR) => ({ params: Promise.resolve({ id }) });
const ler = async ({ sessionId = LIVE_SESSION, webinarId = WEBINAR } = {}) => {
  const response = await route.GET(new Request(`http://localhost/api/webinars/${webinarId}/audience?sessao=${sessionId}`), contexto(webinarId));
  return { body: await response.json(), headers: response.headers, status: response.status };
};
const DESLIGADO = { enabled: false, people: [] };

test("guardas: 401 sem sessao, 400 sem id ou sem ?sessao=, 404 para a sessao de outro webinario, sem cache", async () => {
  montar(regras);
  sessao.user = null;
  assert.equal((await ler()).status, 401);

  novoAluno();
  assert.equal((await route.GET(new Request(`http://localhost/api/webinars/x/audience?sessao=${LIVE_SESSION}`), contexto("nao-e-id"))).status, 400);
  assert.equal((await route.GET(new Request(`http://localhost/api/webinars/${WEBINAR}/audience`), contexto())).status, 400);
  assert.equal((await route.GET(new Request(`http://localhost/api/webinars/${WEBINAR}/audience?sessao=abc`), contexto())).status, 400);
  const outra = await ler({ sessionId: OTHER_SESSION });
  assert.equal(outra.status, 404, "a sessao e de outro webinario");
  assert.equal(outra.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("a live com participantes simulados e a decisao: a lista ordenada, igual ao modelo e para todos, com as pessoas da escola e quem comenta neste roteiro na frente; nunca a semente nem as regras", async () => {
  const { db } = montar(regras);
  const primeira = await ler();
  assert.equal(primeira.status, 200);
  assert.equal(primeira.headers.get("cache-control"), "private, no-store, max-age=0");
  const feed = primeira.body.data;
  assert.equal(feed.enabled, true);
  assert.equal(feed.people.length, 300);
  // Com foto: quem comenta neste roteiro, depois a outra pessoa da escola; sem foto: quem comenta neste roteiro.
  assert.deepEqual(feed.people.slice(0, 3), [
    { id: "simp22222222aaaa4bbb", name: "Marcos Lima", photoUrl: `${ORIGIN}/storage/v1/object/public/content-assets/${FOTO}` },
    { id: "simp99999999aaaa4bbb", name: "De Outro Webinario", photoUrl: `${ORIGIN}/storage/v1/object/public/content-assets/${FOTO}` },
    { id: "simp11111111aaaa4bbb", name: "Zélia Prado", photoUrl: null }
  ]);
  assert.ok(feed.people.slice(3).every((person) => person.id.startsWith("simg") && person.photoUrl === null));
  const seed = db.tables.webinar_sessions.find((item) => item.id === LIVE_SESSION).simulation_seed;
  const personas = PESSOAS.map((row) => ({ avatarPath: row.avatar_path, id: row.id, name: row.name }));
  const scriptPersonaIds = new Set([PESSOAS[0].id, PESSOAS[1].id]);
  assert.deepEqual(feed.people, tiles.audienceTilesRoster({ origin: ORIGIN, personas, scriptPersonaIds, seed }), "o roteiro de outro webinario nao poe ninguem na frente");
  assert.deepEqual(Object.keys(primeira.body.data).sort(), ["enabled", "people"]);
  assert.deepEqual([...new Set(feed.people.flatMap((person) => Object.keys(person)))].sort(), ["id", "name", "photoUrl"], "nem a semente nem as regras");

  novoAluno();
  assert.deepEqual((await ler()).body.data, feed, "outro aluno ve as mesmas pessoas");
  assert.equal(db.tables.student_events.length, 0, "nada no historico (§6.6)");
  assert.equal(db.calls.writes.length, 0, "a rota so le");
});

test("so a Live ao vivo no ar com participantes simulados e a decisao registrada; o resto devolve enabled false com a lista vazia", async () => {
  const off = { base: 0, jitter: 0, mode: "off", peak: 0 };
  const casos = [
    ["sem participantes simulados (o contador so com o real)", { ...DECISAO, simulated_count_rule: null }],
    ["o contador desligado", { ...DECISAO, simulated_count_rule: off }],
    ["sem a decisao registrada (§8.6)", { simulated_count_rule: CONTADOR }],
    ["encerrada", { ...regras, ended_at: iso(Date.now() - MIN), status: "ended" }],
    ["cancelada", { ...regras, status: "cancelled" }]
  ];
  for (const [nome, live] of casos) {
    montar(live);
    const answer = await ler();
    assert.equal(answer.status, 200, nome);
    assert.deepEqual(answer.body.data, DESLIGADO, nome);
  }

  // A Live gravada e o replay nao tem o motor de video: nunca a lista, mesmo com regra e decisao.
  for (const sessionId of [SESSION, REPLAY]) {
    const tables = escolaDaSimulacao({ sessao: regras });
    tables.webinar_personas = PESSOAS.map((row) => ({ ...row }));
    actionStubs.db = bancoDaSimulacao({ tables });
    Object.assign(actionStubs.db.tables.webinar_sessions.find((item) => item.id === sessionId), regras);
    resetRoomAccessCache();
    resetAudienceTilesCache();
    novoAluno();
    assert.deepEqual((await ler({ sessionId })).body.data, DESLIGADO, sessionId);
  }

  montar(regras, { semColunas: true });
  const semColunas = await ler();
  assert.equal(semColunas.status, 200);
  assert.deepEqual(semColunas.body.data, DESLIGADO, "banco sem as colunas da Simulacao");
});

test("sem a lista de pessoas que comentam (ou com ela vazia): so os nomes genericos", async () => {
  for (const pessoas of [null, []]) {
    montar(regras, { pessoas });
    const answer = await ler();
    assert.equal(answer.status, 200);
    assert.equal(answer.body.data.enabled, true);
    assert.equal(answer.body.data.people.length, 300);
    assert.ok(answer.body.data.people.every((person) => person.id.startsWith("simg")));
  }
});

test("a lista de cada sessao fica 30 s na memoria do processo: a turma que entra junta le o banco uma vez, e a pessoa nova chega depois do prazo", async () => {
  const { db } = montar(regras);
  const session = { id: LIVE_SESSION, kind: "live" };
  const now = Date.now();
  const leituras = () => db.calls.reads?.length ?? db.calls.selects?.length ?? null;
  const primeira = await loadAudienceTiles(db, { session, webinarId: WEBINAR }, now);
  const depois = leituras();
  db.tables.webinar_personas.push(pessoa("33333333-aaaa-4bbb-8ccc-000000000003", "Alba Nova", FOTO.replace("aaaa", "bbbb")));
  const segunda = await loadAudienceTiles(db, { session, webinarId: WEBINAR }, now + AUDIENCE_TILES_CACHE_MS - 1);
  assert.equal(segunda, primeira, "a mesma resposta, sem ler o banco");
  if (depois !== null) assert.equal(leituras(), depois);
  const terceira = await loadAudienceTiles(db, { session, webinarId: WEBINAR }, now + AUDIENCE_TILES_CACHE_MS + 1);
  assert.deepEqual(
    terceira.people.slice(0, 4).map((person) => person.name),
    ["Marcos Lima", "Alba Nova", "De Outro Webinario", "Zélia Prado"],
    "passado o prazo, a pessoa nova com foto entra entre as com foto, depois de quem comenta neste roteiro"
  );
  assert.deepEqual(await loadAudienceTiles(db, { session: { id: SESSION, kind: "simulated" }, webinarId: WEBINAR }, now), DESLIGADO, "a sessao gravada nem le o banco");
});

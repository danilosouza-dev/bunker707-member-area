import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";

// A lista de barrados que o Prosody busca (docs/30 §1.4 e §8.1; seguranca-01), sem banco: a rota de verdade
// (GET /api/webhooks/room-guard) contra um banco falso em memoria, assinada como o mod_bunker_room_guard.lua assina
// (HMAC-SHA256 de "<timestamp>." com a chave derivada do segredo do token). Aqui: 401 sem assinatura, com a errada, com a
// do webhook do gravador ou com carimbo velho; 503 sem a sala ao vivo no ambiente; 200 com os removidos de cada sala
// aberta (espera ou no ar) e os banidos de todos; silenciados, salas encerradas ou agendadas e sessoes sem sala ficam fora.
// Com isso o removido que abre a sala com o token antigo e recusado na entrada (o gancho do Prosody le esta lista).

const sem = (globalThis.__guardaDaSala ??= { banco: true });

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

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (moduloDeSrc(specifier, context) === "server/db/supabase/client") {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(`
          export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
          export function hasSupabaseConfig() { return globalThis.__guardaDaSala.banco; }`)}`
      };
    }
    return nextResolve(specifier, context);
  }
});

const JWT = "s".repeat(48);
process.env.WEBINAR_MEET_DOMAIN = "meet.bunker707.test";
process.env.WEBINAR_JWT_SECRET = JWT;

const route = await import("../src/app/api/webhooks/room-guard/route.ts");
const { recorderHeaders, roomGuardKey } = await import("../src/server/webinars/recorder-signature.ts");

const WEBINAR = "acacacac-0000-4000-8000-000000000001";
const NO_AR = "acacacac-0000-4000-8000-000000000002";
const ESPERA = "acacacac-0000-4000-8000-000000000003";
const ENCERRADA = "acacacac-0000-4000-8000-000000000004";
const AGENDADA = "acacacac-0000-4000-8000-000000000005";
const SALA = (letra) => `w-${WEBINAR}-${letra.repeat(16)}`;
const ANA = "11111111-1111-4111-8111-111111111111";
const BIA = "22222222-2222-4222-8222-222222222222";
const CAIO = "33333333-3333-4333-8333-333333333333";
const DIA = "44444444-4444-4444-8444-444444444444";

/** O banco falso: as leituras que a lista faz (eq, in, not is null, limit). */
function bancoFalso(tables) {
  const calls = [];
  return {
    calls,
    from(name) {
      const state = { filters: [], limit: null };
      calls.push(name);
      const chain = {
        eq: (column, value) => (state.filters.push((row) => row[column] === value), chain),
        in: (column, values) => (state.filters.push((row) => values.includes(row[column])), chain),
        limit: (value) => ((state.limit = value), chain),
        not: (column, op, value) => (state.filters.push((row) => (op === "is" && value === null ? row[column] !== null && row[column] !== undefined : true)), chain),
        select: () => chain,
        then: (resolve, reject) =>
          Promise.resolve()
            .then(() => {
              const rows = (tables[name] ?? []).filter((row) => state.filters.every((filter) => filter(row)));
              return { data: state.limit === null ? rows : rows.slice(0, state.limit), error: null };
            })
            .then(resolve, reject)
      };
      return chain;
    },
    tables
  };
}

function escola() {
  const db = bancoFalso({
    webinar_session_bans: [
      { kind: "kicked", session_id: NO_AR, user_id: ANA },
      { kind: "muted", session_id: NO_AR, user_id: BIA },
      { kind: "kicked", session_id: ESPERA, user_id: CAIO },
      { kind: "kicked", session_id: ENCERRADA, user_id: BIA }
    ],
    webinar_sessions: [
      { id: NO_AR, kind: "live", room_name: SALA("b"), status: "live" },
      { id: ESPERA, kind: "live", room_name: SALA("c"), status: "waiting" },
      { id: ENCERRADA, kind: "live", room_name: SALA("d"), status: "ended" },
      { id: AGENDADA, kind: "live", room_name: SALA("e"), status: "scheduled" },
      { id: "acacacac-0000-4000-8000-000000000006", kind: "simulated", room_name: null, status: "live" }
    ],
    webinar_user_bans: [{ user_id: DIA }]
  });
  actionStubs.db = db;
  return db;
}

/** O GET como o mod_bunker_room_guard.lua faz: HMAC de "<timestamp>." com a chave derivada do JWT_APP_SECRET. */
async function buscar(headers) {
  const assinado = headers ?? recorderHeaders(roomGuardKey(JWT), "", Date.now());
  const response = await route.GET(new Request("https://membros.exemplo.test/api/webhooks/room-guard", { headers: assinado, method: "GET" }));
  return { body: await response.json(), status: response.status };
}

async function quieto(fn) {
  const original = { error: console.error, warn: console.warn };
  console.error = () => undefined;
  console.warn = () => undefined;
  try {
    return await fn();
  } finally {
    Object.assign(console, original);
  }
}

test("200: os removidos de cada sala aberta (espera ou no ar) e os banidos de todos; silenciado, sala encerrada ou agendada e sessao sem sala ficam fora", async () => {
  escola();
  const resposta = await buscar();
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
  assert.deepEqual(resposta.body.rooms, { [SALA("b")]: [ANA], [SALA("c")]: [CAIO] }, "so os removidos das salas abertas");
  assert.deepEqual(resposta.body.banned, [DIA]);
  assert.ok(resposta.body.at);
  assert.ok(!JSON.stringify(resposta.body).includes(BIA), "o silenciado assiste; o removido de uma sala encerrada nao importa mais");
});

test("o removido que volta com o token antigo: a sala dele aparece com a conta, que o gancho do Prosody recusa; o Desfazer tira da lista", async () => {
  const db = escola();
  assert.ok((await buscar()).body.rooms[SALA("b")].includes(ANA));
  db.tables.webinar_session_bans = db.tables.webinar_session_bans.filter((row) => !(row.user_id === ANA && row.kind === "kicked"));
  assert.deepEqual((await buscar()).body.rooms[SALA("b")], [], "desfeito: entra de novo");
});

test("401 sem assinatura, com a assinatura errada, com o segredo do gravador no lugar da chave ou com carimbo de 6 min; 503 sem a sala ao vivo neste ambiente ou sem banco", async () => {
  const db = escola();
  await quieto(async () => {
    assert.equal((await buscar({})).status, 401);
    const ts = String(Math.floor(Date.now() / 1000));
    assert.equal((await buscar({ "x-bunker-signature": "0".repeat(64), "x-bunker-timestamp": ts })).status, 401);
    // O proprio segredo do token (sem a derivacao) nao assina a lista: a assinatura nunca vale como token, nem o contrario.
    const comOJwt = createHmac("sha256", JWT).update(`${ts}.`).digest("hex");
    assert.equal((await buscar({ "x-bunker-signature": comOJwt, "x-bunker-timestamp": ts })).status, 401);
    assert.equal((await buscar(recorderHeaders(roomGuardKey(JWT), "", Date.now() - 6 * 60_000))).status, 401);
  });
  assert.equal(db.calls.length, 0, "nada lido sem a assinatura");

  delete process.env.WEBINAR_MEET_DOMAIN;
  try {
    assert.equal((await buscar()).status, 503);
  } finally {
    process.env.WEBINAR_MEET_DOMAIN = "meet.bunker707.test";
  }
  sem.banco = false;
  try {
    assert.equal((await quieto(() => buscar())).status, 503);
  } finally {
    sem.banco = true;
  }
});

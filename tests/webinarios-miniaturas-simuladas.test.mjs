import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/transpile-tsx.mjs";

// Os participantes simulados nas miniaturas da live, a parte pura (docs/30 D117; docs/18 §2.1; pedido do produtor de
// 13/11/2026): a lista ordenada (as pessoas que comentam com foto, as sem foto e os nomes genericos ate o teto), sempre
// a mesma para a mesma entrada; quantas aparecem em cada instante; a mensagem que a pagina manda ao iframe; e os sinais
// do iframe sobre um simulado, que a pagina descarta. O que o arquivo da instancia faz com a mensagem esta em
// tests/infra-jitsi-plateia.test.mjs.

const tiles = await import("../src/server/webinars/audience-tiles-model.ts");
const frame = await import("../src/lib/jitsi-room-config.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const ORIGIN = "https://projeto.supabase.co";
const photo = (hex) => `webinars/personas/${hex.padEnd(24, "0")}.webp`;
const persona = (id, name, avatarPath = null) => ({ avatarPath, id, name });
const PERSONAS = [
  persona("11111111-aaaa-4bbb-8ccc-000000000001", "Zélia Prado"),
  persona("22222222-aaaa-4bbb-8ccc-000000000002", "Marcos Lima", photo("a1")),
  persona("33333333-aaaa-4bbb-8ccc-000000000003", "ana m.", photo("b2")),
  persona("44444444-aaaa-4bbb-8ccc-000000000004", "Bia Costa")
];

test("a ordem da lista: quem comenta com foto, quem comenta sem foto e so depois os nomes genericos", () => {
  const roster = tiles.audienceTilesRoster({ origin: ORIGIN, personas: PERSONAS, seed: 7 });
  assert.equal(roster.length, 300, "ate o teto");
  assert.deepEqual(roster.slice(0, 4), [
    { id: "simp33333333aaaa4bbb", name: "ana m.", photoUrl: `${ORIGIN}/storage/v1/object/public/content-assets/${photo("b2")}` },
    { id: "simp22222222aaaa4bbb", name: "Marcos Lima", photoUrl: `${ORIGIN}/storage/v1/object/public/content-assets/${photo("a1")}` },
    { id: "simp44444444aaaa4bbb", name: "Bia Costa", photoUrl: null },
    { id: "simp11111111aaaa4bbb", name: "Zélia Prado", photoUrl: null }
  ]);
  assert.ok(roster.slice(4).every((person) => person.id.startsWith("simg") && person.photoUrl === null), "os genericos nunca tem foto");
  assert.ok(roster.every((person) => frame.isSimulatedParticipantId(person.id)), "todo id no formato que o arquivo da instancia aceita");
  assert.equal(new Set(roster.map((person) => person.id)).size, roster.length, "sem id repetido");
});

test("os nomes genericos: primeiro nome + inicial, sem repetir, sem o nome de quem comenta, e os das entradas do chat na frente", () => {
  const roster = tiles.audienceTilesRoster({ origin: ORIGIN, personas: PERSONAS, seed: 7 });
  const generic = roster.slice(4).map((person) => person.name);
  assert.ok(generic.every((name) => /^\p{Lu}[\p{L}]+ [A-Z]\.$/u.test(name)), "o formato de todo aluno na sala (D64)");
  assert.equal(new Set(generic).size, generic.length);
  assert.equal(generic.includes("Ana M."), false, "a pessoa que comenta com esse nome ja esta na lista (sem caixa)");
  const joinNames = WEBINAR_COPY.simulacao.nomesGenericos.filter((name) => name !== "Ana M.");
  assert.deepEqual([...generic.slice(0, joinNames.length)].sort(), [...joinNames].sort(), "quem \"entrou\" no chat tem miniatura antes dos outros genericos");
  const pool = tiles.genericTileNames();
  assert.equal(pool.length, WEBINAR_COPY.simulacao.primeirosNomes.length * WEBINAR_COPY.simulacao.iniciais.length);
  assert.ok(pool.length >= 1000, "nomes de sobra para o teto de 300");
  assert.ok(WEBINAR_COPY.simulacao.nomesGenericos.every((name) => pool.includes(name)), "todo nome das entradas existe nas miniaturas");
  assert.equal(new Set(pool).size, pool.length);
});

test("a mesma sessao da sempre as mesmas pessoas; outra semente muda a ordem dos genericos; o id de cada nome nao muda", () => {
  const a = tiles.audienceTilesRoster({ origin: ORIGIN, personas: PERSONAS, seed: 7 });
  const again = tiles.audienceTilesRoster({ origin: ORIGIN, personas: [...PERSONAS].reverse(), seed: 7 });
  assert.deepEqual(again, a, "nem a ordem em que as pessoas chegam do banco muda a lista");
  const b = tiles.audienceTilesRoster({ origin: ORIGIN, personas: PERSONAS, seed: 8 });
  assert.notDeepEqual(b.slice(30).map((person) => person.name), a.slice(30).map((person) => person.name));
  const idOf = (roster) => new Map(roster.map((person) => [person.name, person.id]));
  const shared = [...idOf(a)].filter(([name]) => idOf(b).has(name));
  assert.ok(shared.length > 20);
  assert.ok(shared.every(([name, id]) => idOf(b).get(name) === id), "o mesmo nome leva o mesmo id em qualquer sessao");
  assert.doesNotMatch(readFileSync(new URL("../src/server/webinars/audience-tiles-model.ts", import.meta.url), "utf8"), /Math\.random/);
});

test("a foto so sai do nosso bucket pela origem conferida; sem origem ou com caminho de fora, as iniciais", () => {
  const outside = [persona("55555555-aaaa-4bbb-8ccc-000000000005", "Com Foto De Fora", "https://outro.site/foto.png"), persona("66666666-aaaa-4bbb-8ccc-000000000006", "Com Foto Nossa", photo("c3"))];
  const roster = tiles.audienceTilesRoster({ max: 2, origin: ORIGIN, personas: outside, seed: 1 });
  assert.deepEqual(roster.map((person) => [person.name, person.photoUrl]), [
    ["Com Foto Nossa", `${ORIGIN}/storage/v1/object/public/content-assets/${photo("c3")}`],
    ["Com Foto De Fora", null]
  ]);
  assert.deepEqual(tiles.audienceTilesRoster({ max: 2, origin: null, personas: outside, seed: 1 }).map((person) => person.photoUrl), [null, null]);
  assert.deepEqual(tiles.audienceTilesRoster({ max: 2, origin: "javascript:alert(1)", personas: outside, seed: 1 }).map((person) => person.photoUrl), [null, null]);
});

test("o teto e os limites: no maximo 300, o pedido menor corta, nomes repetidos de quem comenta entram uma vez", () => {
  assert.equal(tiles.audienceTilesRoster({ max: 5_000, origin: ORIGIN, personas: [], seed: 3 }).length, 300);
  assert.equal(tiles.audienceTilesRoster({ max: 0, origin: ORIGIN, personas: PERSONAS, seed: 3 }).length, 0);
  assert.equal(tiles.audienceTilesRoster({ max: 2, origin: ORIGIN, personas: PERSONAS, seed: 3 }).length, 2);
  const twins = [persona("77777777-aaaa-4bbb-8ccc-000000000007", "Lia Reis"), persona("88888888-aaaa-4bbb-8ccc-000000000008", "  lia   reis ")];
  assert.deepEqual(tiles.audienceTilesRoster({ max: 2, origin: ORIGIN, personas: twins, seed: 3 }).filter((person) => person.id.startsWith("simp")).length, 1);
  const many = Array.from({ length: 320 }, (_, index) => persona(`${index.toString(16).padStart(8, "0")}-aaaa-4bbb-8ccc-000000000000`, `Pessoa ${String(index).padStart(3, "0")}`));
  const full = tiles.audienceTilesRoster({ origin: ORIGIN, personas: many, seed: 3 });
  assert.equal(full.length, 300);
  assert.ok(full.every((person) => person.id.startsWith("simp")), "com mais pessoas criadas que o teto, so elas");
});

test("quantas aparecem agora: o numero de simulados deste segundo, do comeco da lista, nunca alem dela", () => {
  const roster = tiles.audienceTilesRoster({ max: 10, origin: ORIGIN, personas: PERSONAS, seed: 7 });
  assert.deepEqual(tiles.audienceTilesNow(roster, 0), []);
  assert.deepEqual(tiles.audienceTilesNow(roster, 3).map((person) => person.name), ["ana m.", "Marcos Lima", "Bia Costa"], "com menos simulados que pessoas criadas, as primeiras (as com foto)");
  assert.equal(tiles.audienceTilesNow(roster, 9.9).length, 9);
  assert.equal(tiles.audienceTilesNow(roster, 5_000).length, 10);
  assert.equal(tiles.audienceTilesNow(roster, 10), roster, "a lista inteira sem copiar");
  for (const bad of [-4, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
    assert.deepEqual(tiles.audienceTilesNow(roster, bad), [], String(bad));
  }
});

test("a lista so e montada com participantes simulados possiveis: o contador ligado ou uma mudanca no ar", () => {
  const rule = (mode) => ({ base: 50, jitter: 0, mode, peak: 80 });
  assert.equal(tiles.audienceTilesPossible({ countRule: rule("off") }), false);
  assert.equal(tiles.audienceTilesPossible({ countChanges: [], countRule: rule("off") }), false);
  assert.equal(tiles.audienceTilesPossible({ countRule: rule("fixed") }), true);
  assert.equal(tiles.audienceTilesPossible({ countRule: rule("curve") }), true);
  assert.equal(tiles.audienceTilesPossible({ countChanges: [{ atMs: 60_000, rule: rule("fixed") }], countRule: rule("off") }), true, "ligado no ar pelo console");
  assert.equal(tiles.audienceTilesPossible({ countChanges: [{ atMs: 60_000, rule: rule("off") }], countRule: rule("off") }), false);
});

test("a assinatura da lista muda com quem entra, sai, troca de nome ou de foto, e so com isso", () => {
  const roster = tiles.audienceTilesRoster({ max: 6, origin: ORIGIN, personas: PERSONAS, seed: 7 });
  const key = tiles.audienceTilesKey(roster);
  assert.equal(tiles.audienceTilesKey(roster.map((person) => ({ ...person }))), key);
  assert.notEqual(tiles.audienceTilesKey(roster.slice(0, 5)), key);
  assert.notEqual(tiles.audienceTilesKey(roster.map((person, index) => (index === 2 ? { ...person, name: "Outro Nome" } : person))), key);
  assert.notEqual(tiles.audienceTilesKey(roster.map((person, index) => (index === 0 ? { ...person, photoUrl: null } : person))), key);
  assert.equal(tiles.audienceTilesKey([]), "");
});

test("a mensagem para o iframe: o tipo do arquivo da instancia, a foto vazia sem foto, o teto e o repasse do console", () => {
  const roster = tiles.audienceTilesRoster({ max: 3, origin: ORIGIN, personas: PERSONAS, seed: 7 });
  assert.deepEqual(frame.audienceFrameMessage(roster), {
    people: [
      { id: "simp33333333aaaa4bbb", name: "ana m.", photo: `${ORIGIN}/storage/v1/object/public/content-assets/${photo("b2")}` },
      { id: "simp22222222aaaa4bbb", name: "Marcos Lima", photo: `${ORIGIN}/storage/v1/object/public/content-assets/${photo("a1")}` },
      { id: "simp44444444aaaa4bbb", name: "Bia Costa", photo: "" }
    ],
    type: "bunker707:plateia"
  });
  assert.deepEqual(frame.audienceFrameMessage([], true), { people: [], relay: true, type: "bunker707:plateia" }, "o console de quem modera so repassa ao gravador");
  const many = Array.from({ length: 400 }, (_, index) => ({ id: `simg${index.toString(36)}`, name: `Pessoa ${index}`, photoUrl: null }));
  assert.equal(frame.audienceFrameMessage(many).people.length, 300);
  // Os tres valores sao os mesmos do arquivo da instancia: mudou um, muda o outro.
  const script = readFileSync(new URL("../infra/jitsi/web/bunker707-plateia.js", import.meta.url), "utf8");
  assert.ok(script.includes(`var MESSAGE = '${frame.AUDIENCE_FRAME_MESSAGE}';`));
  assert.ok(script.includes(`var MAX_PEOPLE = ${frame.AUDIENCE_TILES_MAX};`));
  assert.ok(script.includes("var ID = /^sim[pg][0-9a-z]{1,16}$/;"));
});

test("os sinais do iframe sobre um simulado sao descartados; os de uma pessoa na sala, nunca", () => {
  for (const id of ["simp33333333aaaa4bbb", "simg0", "simgx9", "simp1"]) {
    assert.equal(frame.isSimulatedParticipantId(id), true, id);
    assert.equal(frame.aboutSimulatedParticipant({ displayName: "Ana M.", id }), true);
  }
  // O id de uma pessoa no motor (8 caracteres de 0-9a-f), o da tela compartilhada dela e o "local".
  for (const id of ["2da1c4af", "2da1c4af-v1", "local", "sim", "simx1", "SIMP1", "simg-1", "", `simg${"a".repeat(17)}`]) {
    assert.equal(frame.isSimulatedParticipantId(id), false, id);
    assert.equal(frame.aboutSimulatedParticipant({ id }), false);
  }
  for (const payload of [null, undefined, "simp1", 7, {}, { id: 7 }, { participantId: "simp1" }]) {
    assert.equal(frame.aboutSimulatedParticipant(payload), false);
  }
});

// O lado da sala: a conferencia da lista (o relogio e o pedido na mao do teste) e o pedido em si.
const roomAudience = await import("../src/components/member/webinars/room/use-room-audience.ts");

test("a sala pede a lista ao entrar, de novo a cada 2 min, e depois de uma falha em 30 s com a lista de antes valendo", async () => {
  let now = 1_000_000;
  const feeds = [];
  let fail = false;
  let calls = 0;
  const loader = roomAudience.createAudienceLoader({
    fetchFeed: async () => {
      calls += 1;
      if (fail) throw new Error("fora do ar");
      return { enabled: true, people: [{ id: `simg${calls}`, name: `Pessoa ${calls}`, photoUrl: null }] };
    },
    now: () => now,
    onFeed: (feed) => feeds.push(feed)
  });
  await loader.check();
  assert.equal(calls, 1, "ao entrar");
  await loader.check();
  now += roomAudience.AUDIENCE_ROOM.refreshMs - 1;
  await loader.check();
  assert.equal(calls, 1, "dentro dos 2 min, nenhum pedido");
  now += 1;
  await loader.check();
  assert.equal(calls, 2, "passados os 2 min");

  fail = true;
  now += roomAudience.AUDIENCE_ROOM.refreshMs;
  await loader.check();
  assert.equal(calls, 3);
  assert.equal(feeds.length, 2, "a falha nao entrega nada: a lista de antes continua");
  now += roomAudience.AUDIENCE_ROOM.failureRetryMs - 1;
  await loader.check();
  assert.equal(calls, 3, "espera os 30 s");
  fail = false;
  now += 1;
  await loader.check();
  assert.equal(calls, 4);
  assert.equal(feeds.at(-1).people[0].name, "Pessoa 4");

  loader.stop();
  now += 10 * roomAudience.AUDIENCE_ROOM.refreshMs;
  await loader.check();
  assert.equal(calls, 4, "a sala saiu: nada mais e pedido");
});

test("a decisao da Simulacao mudou: a lista e pedida de novo na hora e a resposta que estava a caminho e descartada", async () => {
  const now = 5_000_000;
  const feeds = [];
  const pending = [];
  const loader = roomAudience.createAudienceLoader({
    fetchFeed: () => new Promise((resolve) => pending.push(resolve)),
    now: () => now,
    onFeed: (feed) => feeds.push(feed)
  });
  const first = loader.check();
  loader.refresh();
  const second = loader.check();
  assert.equal(pending.length, 2, "o pedido novo sai sem esperar o de antes");
  pending[0]({ enabled: true, people: [{ id: "simg1", name: "Da Regra Velha", photoUrl: null }] });
  await first;
  assert.deepEqual(feeds, [], "a resposta da regra de antes nao vale");
  pending[1]({ enabled: false, people: [] });
  await second;
  assert.deepEqual(feeds, [{ enabled: false, people: [] }]);
});

test("o pedido da lista: a rota da sessao, sem cache e com a sessao do aluno; resposta torta ou erro vira falha", async (t) => {
  const calls = [];
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const answer = (status, body) => { globalThis.fetch = async (url, init) => { calls.push({ init, url }); return new Response(JSON.stringify(body), { status }); }; };

  answer(200, { data: { enabled: true, people: [{ id: "simg1", name: "Ana M.", photoUrl: null }] } });
  const feed = await roomAudience.fetchAudienceTiles("aaaaaaaa-0000-4000-8000-000000000001", "eeeeeeee-0000-4000-8000-0000000000a3");
  assert.deepEqual(feed, { enabled: true, people: [{ id: "simg1", name: "Ana M.", photoUrl: null }] });
  assert.equal(calls[0].url, "/api/webinars/aaaaaaaa-0000-4000-8000-000000000001/audience?sessao=eeeeeeee-0000-4000-8000-0000000000a3");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.credentials, "same-origin");

  answer(404, { error: "Sessão não encontrada." });
  await assert.rejects(() => roomAudience.fetchAudienceTiles("a", "b"), /audience 404/);
  answer(200, { data: { enabled: true, people: "ninguem" } });
  await assert.rejects(() => roomAudience.fetchAudienceTiles("a", "b"), /audience 200/);
  answer(200, {});
  await assert.rejects(() => roomAudience.fetchAudienceTiles("a", "b"), /audience 200/);
});

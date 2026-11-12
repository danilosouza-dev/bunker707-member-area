import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { ENDED_SESSION, LIVE_SESSION, MIN, REPLAY, SESSION, WEBINAR, bancoDaSimulacao, escolaDaSimulacao } from "./support/webinarios-v4-simulacao-banco.mjs";

// Os participantes simulados mudados a qualquer momento, no servidor e sem banco (docs/30 D79 e D80; docs/18 §2.2):
// saveSimulatedAudience no banco da Simulacao em memoria. Somar nao pede frase nem caixa desde 12/11/2026 (D86): o
// servidor grava sozinho a frase da mudanca (a de hoje, com o numero e o nome de quem muda) no registro; com a live
// no ar, a mudanca vira uma linha de webinar_simulation_changes com o offset
// desde o Começar para todos, a decisao da sessao passa a ser a frase dela (o carimbo da sala muda) e a sessao sem
// contador fica com "Real + 0"; a janela da Simulacao devolve o numero novo depois da rampa; antes do comeco a linha fica
// sem offset e a regra da sessao muda; o Tirar grava a frase do +0; o mesmo numero, a encerrada, o Replay,
// quem nao publica e o banco sem a tabela recusam sem gravar; o teto de 200 mudancas; a leitura do card com a vista do
// controle; o resumo do fim (o tick) que junta os trechos; e as mudancas lidas todas, em paginas, alem do teto de 1.000
// linhas do PostgREST (a revisao v8, achado 8).

const estado = (globalThis.__plateiaAcoes ??= { revalidados: [], semPublicar: false });
const PRODUTORA = "00000000-0000-4000-8000-0000000000f1";
const OUTRA = "00000000-0000-4000-8000-0000000000f2";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/server/auth/permissions") {
      const source = `
        export async function requireRole(action) {
          if (globalThis.__plateiaAcoes.semPublicar && action === "messaging.publish") {
            const error = new Error("Sem permissão para publicar na Comunicação.");
            error.status = 403;
            throw error;
          }
          return globalThis.__adminActionStubs.role;
        }
        export async function requireScope() {}`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    if (specifier === "@/server/auth/session") {
      const source = `
        export function getUserDisplayName(user) {
          const fullName = (user.user_metadata?.full_name ?? "").trim() || (user.email?.split("@")[0] ?? "Aluno");
          return { fullName, name: fullName.split(/\\s+/)[0] || "Aluno" };
        }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    if (specifier.endsWith("/db/supabase/client")) {
      const source = `
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    if (specifier === "next/cache") {
      const source = `
        export function revalidatePath(path) { globalThis.__plateiaAcoes.revalidados.push(path); }
        export function revalidateTag(tag) { globalThis.__plateiaAcoes.revalidados.push(tag); }
        export function updateTag(tag) { globalThis.__plateiaAcoes.revalidados.push(tag); }
        export function unstable_cache(fn) { return fn; }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    return nextResolve(specifier, context);
  }
});

actionStubs.role = { role: "owner", user: { email: "produtora@bunker707.test", id: PRODUTORA, user_metadata: { full_name: "Produtora de Teste" } } };

const actions = await import("../src/server/webinars/simulation-actions.ts");
const model = await import("../src/server/webinars/simulation-model.ts");
const store = await import("../src/server/webinars/simulation-store.ts");
const tick = await import("../src/server/webinars/simulation-tick.ts");
const { SIMULATION_LIMITS } = await import("../src/server/webinars/model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const SERVIDOR = WEBINAR_COPY.simulacao.servidor;
const NOME = "Produtora de Teste";
const SEM_NADA = { badgeOn: false, joinsSimulated: false, saleNoticesSimulated: false };

function usar(db) {
  actionStubs.db = db;
  estado.semPublicar = false;
  estado.revalidados.length = 0;
  return db;
}

const ok = (result) => {
  assert.equal(result.ok, true, result.ok ? "" : `${result.status} ${result.error} ${JSON.stringify(result.fieldErrors ?? {})}`);
  return result.data;
};
const linha = (db, id) => db.tables.webinar_sessions.find((row) => row.id === id);
const mudancas = (db) => db.tables.webinar_simulation_changes ?? [];
const frase = (extra, { flags = SEM_NADA, live = true } = {}) => model.simulationAudienceAckFor({ extra, flags, live, nowMs: Date.now(), responsible: NOME });

/** A escola com o webinario ao vivo: a sessao da live com `sessaoDaLive` (padrao: no ar ha 20 min, sem regra). */
function escolaAoVivo(sessaoDaLive = {}) {
  const tables = escolaDaSimulacao({ webinar: { kind: "live" } });
  Object.assign(
    tables.webinar_sessions.find((row) => row.id === LIVE_SESSION),
    {
      ended_at: null,
      recording_anchor_at: null,
      scheduled_at: new Date(Date.now() - 25 * MIN).toISOString(),
      started_at: new Date(Date.now() - 20 * MIN).toISOString(),
      status: "live",
      ...sessaoDaLive
    }
  );
  tables.webinar_simulation_changes = [];
  tables.profiles = [{ full_name: "Outra Pessoa", id: OUTRA }];
  return tables;
}

/** O banco sem a 202611140002: a tabela das mudancas nao existe (PGRST205). */
function semATabela(db) {
  const from = db.from.bind(db);
  db.from = (name) => {
    const chain = from(name);
    if (name === "webinar_simulation_changes") {
      chain.then = (resolve, reject) => Promise.resolve({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.webinar_simulation_changes' in the schema cache" } }).then(resolve, reject);
    }
    return chain;
  };
  return db;
}

test("a live no ar: +300 direto, sem frase nem caixa (D86); o servidor grava a frase da mudanca, a linha com o offset, a decisao da sessao (o carimbo) e a janela com o numero novo depois da rampa", async () => {
  const db = usar(bancoDaSimulacao({ tables: escolaAoVivo() }));
  const antes = linha(db, LIVE_SESSION).updated_at;

  const texto = frase(300);
  assert.match(texto, /A partir de agora, os participantes simulados somam \+300 ao número de quem assiste\. Responsável: Produtora de Teste\.$/);
  // O pedido leva so o numero, a sessao e a origem: a frase e a confirmacao da tela sairam (D86).
  const salvo = ok(await actions.saveSimulatedAudience({ extra: 300, sessionId: LIVE_SESSION }));
  const [mudanca] = mudancas(db);
  assert.equal(mudanca.session_id, LIVE_SESSION);
  assert.deepEqual(mudanca.count_rule, { base: 300, jitter: 0, mode: "fixed", peak: 300 });
  assert.ok(Math.abs(mudanca.at_offset_ms - 20 * MIN) < 5_000, `o offset desde o Começar para todos (${mudanca.at_offset_ms})`);
  assert.deepEqual([mudanca.ack_text, mudanca.changed_by, mudanca.source], [texto, PRODUTORA, "console"], "a frase montada pelo servidor fica no registro (D80), sem a tela pedir");
  const sessao = linha(db, LIVE_SESSION);
  assert.deepEqual(sessao.simulated_count_rule, { base: 0, jitter: 0, mode: "fixed", peak: 0 }, "a sessao sem contador fica com Real + 0 (o mesmo numero ate a mudanca)");
  assert.deepEqual([sessao.simulation_ack_text, sessao.simulation_decided_by], [texto, PRODUTORA], "a decisao da sessao e a frase da mudanca");
  assert.notEqual(sessao.updated_at, antes, "o carimbo da sessao muda: a consulta de 5 s leva a mudanca a sala");
  const escritas = db.calls.writes.map((write) => `${write.op}:${write.table}`);
  assert.ok(escritas.indexOf("insert:webinar_simulation_changes") < escritas.indexOf("update:webinar_sessions"), "o dado antes do carimbo");
  assert.deepEqual(salvo.audience.current, { base: 300, jitter: 0, mode: "fixed", peak: 300 });
  assert.ok(salvo.audience.rampEndsAtMs > 20 * MIN, "a sala ainda esta chegando");
  assert.equal(salvo.audience.changes[0].changedByName, NOME);
  const auditoria = db.tables.admin_audit_log.find((row) => row.action === "webinar.simulation_audience_changed");
  assert.equal(auditoria.metadata.count_extra, 300);
  assert.equal(auditoria.metadata.before_start, false);
  assert.equal(auditoria.metadata.source, "console");

  // A janela que a sala pede (a mesma conta da rota GET .../simulation) mostra o numero novo depois da rampa.
  const simulation = await store.fetchSessionSimulation(db, LIVE_SESSION);
  assert.equal(simulation.countChanges.length, 1);
  const depois = mudanca.at_offset_ms + SIMULATION_LIMITS.countRampSeconds * 1000 + 15_000;
  assert.equal(model.simulationCounterNow({ durationMs: 60 * MIN, endMs: Number.POSITIVE_INFINITY, kind: "live", offsetMs: depois, simulation, status: "live" }), 300);
  assert.equal(model.simulationCounterNow({ durationMs: 60 * MIN, endMs: Number.POSITIVE_INFINITY, kind: "live", offsetMs: mudanca.at_offset_ms - 1, simulation, status: "live" }), 0, "antes da mudanca, so o real");

  // O mesmo numero de novo nao muda nada.
  const igual = await actions.saveSimulatedAudience({ extra: 300, sessionId: LIVE_SESSION });
  assert.deepEqual([igual.status, igual.fieldErrors?.extra?.[0]], [400, SERVIDOR.plateiaIgual]);

  // O Tirar (+0) grava a frase do +0.
  const tirado = ok(await actions.saveSimulatedAudience({ extra: 0, sessionId: LIVE_SESSION, source: "editor" }));
  const ultima = mudancas(db).at(-1);
  assert.equal(ultima.count_rule, null, "Só o real");
  assert.equal(ultima.source, "editor");
  assert.match(ultima.ack_text, /A partir de agora, sem participantes simulados: o aluno vê só o número real de quem assiste\./);
  assert.deepEqual(tirado.audience.current, { base: 0, jitter: 0, mode: "off", peak: 0 });
  assert.deepEqual(linha(db, LIVE_SESSION).simulated_count_rule, { base: 0, jitter: 0, mode: "fixed", peak: 0 }, "a regra de antes do comeco nao muda no ar");
});

test("antes do comeco: a linha sem offset e a regra da sessao passa a ser a nova (vale na hora); a gravada agendada tambem", async () => {
  const db = usar(bancoDaSimulacao({ tables: escolaAoVivo({ scheduled_at: new Date(Date.now() - 5 * MIN).toISOString(), started_at: null, status: "waiting" }) }));
  ok(await actions.saveSimulatedAudience({ extra: 200, sessionId: LIVE_SESSION }));
  assert.equal(mudancas(db)[0].at_offset_ms, null, "antes do comeco");
  assert.deepEqual(linha(db, LIVE_SESSION).simulated_count_rule, { base: 200, jitter: 0, mode: "fixed", peak: 200 });
  const simulation = await store.fetchSessionSimulation(db, LIVE_SESSION);
  assert.deepEqual(simulation.countChanges, [], "a linha de antes do comeco fica so no registro");
  assert.equal(model.simulationCounterNow({ durationMs: 60 * MIN, kind: "live", offsetMs: -1000, simulation, status: "waiting" }), 200, "na espera, o numero novo na hora");

  const gravada = usar(bancoDaSimulacao({ tables: escolaDaSimulacao({ minutosNoAr: -60, sessao: { status: "scheduled" } }) }));
  const textoGravada = model.simulationAudienceAckFor({ extra: 100, flags: SEM_NADA, nowMs: Date.now(), responsible: NOME });
  ok(await actions.saveSimulatedAudience({ extra: 100, sessionId: SESSION }));
  assert.deepEqual(linha(gravada, SESSION).simulated_count_rule, { base: 100, jitter: 0, mode: "fixed", peak: 100 });
  assert.equal(linha(gravada, SESSION).simulation_ack_text, textoGravada);
});

test("recusas sem gravar: quem nao publica (403), a encerrada, o Replay, a sessao que nao existe, o banco sem a 202611140002 e o teto de mudancas", async () => {
  const db = usar(bancoDaSimulacao({ tables: escolaAoVivo() }));
  estado.semPublicar = true;
  const negado = await actions.saveSimulatedAudience({ extra: 300, sessionId: LIVE_SESSION });
  assert.equal(negado.status, 403);
  estado.semPublicar = false;

  const tabelas = escolaAoVivo();
  const comEncerrada = usar(bancoDaSimulacao({ tables: tabelas }));
  linha(comEncerrada, LIVE_SESSION).status = "ended";
  linha(comEncerrada, LIVE_SESSION).ended_at = new Date().toISOString();
  const encerrada = await actions.saveSimulatedAudience({ extra: 300, sessionId: LIVE_SESSION });
  assert.deepEqual([encerrada.status, encerrada.error], [409, SERVIDOR.plateiaEncerrada], "depois do Encerrar, recusa");
  const replay = await actions.saveSimulatedAudience({ extra: 0, sessionId: REPLAY });
  assert.deepEqual([replay.status, replay.error], [409, SERVIDOR.semReplay]);
  const gravadaEncerrada = await actions.saveSimulatedAudience({ extra: 0, sessionId: ENDED_SESSION });
  assert.equal(gravadaEncerrada.status, 409);
  const inexistente = await actions.saveSimulatedAudience({ extra: 0, sessionId: "eeeeeeee-0000-4000-8000-0000000000ff" });
  assert.equal(inexistente.status, 404);
  assert.equal(mudancas(db).length + mudancas(comEncerrada).length, 0);

  const semTabela = usar(semATabela(bancoDaSimulacao({ tables: escolaAoVivo() })));
  const pendente = await actions.saveSimulatedAudience({ extra: 300, sessionId: LIVE_SESSION });
  assert.deepEqual([pendente.status, pendente.error], [409, SERVIDOR.precisaMigracaoPlateia("202611140002")]);
  assert.equal(linha(semTabela, LIVE_SESSION).simulation_ack_text, null, "nada muda na sessao");
  assert.equal(semTabela.calls.writes.length, 0, "nenhuma escrita");
  // Sem a tabela, a leitura da Simulacao segue (as mudancas vazias).
  assert.deepEqual((await store.fetchSessionSimulation(semTabela, LIVE_SESSION)).countChanges, []);

  const cheia = escolaAoVivo();
  cheia.webinar_simulation_changes = Array.from({ length: SIMULATION_LIMITS.countChangesMax }, (_, index) => ({
    ack_text: "x",
    at_offset_ms: index * 1000,
    changed_by: PRODUTORA,
    count_rule: null,
    created_at: new Date(Date.now() - (300 - index) * 1000).toISOString(),
    id: `m${index}`,
    session_id: LIVE_SESSION,
    source: "console"
  }));
  usar(bancoDaSimulacao({ tables: cheia }));
  const limite = await actions.saveSimulatedAudience({ extra: 300, sessionId: LIVE_SESSION });
  assert.deepEqual([limite.status, limite.error], [409, SERVIDOR.plateiaLimite(SIMULATION_LIMITS.countChangesMax)]);
});

test("o card le a vista do controle de cada sessao: o numero de agora e as mudancas com o nome de quem mudou", async () => {
  const tabelas = escolaAoVivo({ simulated_count_rule: { base: 0, jitter: 0, mode: "fixed", peak: 0 } });
  tabelas.webinar_simulation_changes = [
    { ack_text: "x", at_offset_ms: 60_000, changed_by: OUTRA, count_rule: { base: 150, jitter: 0, mode: "fixed", peak: 150 }, created_at: new Date(Date.now() - 19 * MIN).toISOString(), id: "m1", session_id: LIVE_SESSION, source: "console" }
  ];
  usar(bancoDaSimulacao({ tables: tabelas }));
  const data = ok(await actions.loadSessionSimulations({ webinarId: WEBINAR }));
  const [live] = data.simulations;
  assert.deepEqual(live.audience.current, { base: 150, jitter: 0, mode: "fixed", peak: 150 });
  assert.deepEqual(live.audience.changes.map((change) => [change.changedByName, change.extra, change.source]), [["Outra Pessoa", 150, "console"]]);
  assert.equal(live.audience.pendingMigration, false);
  assert.ok(!("countChanges" in live) && !("seed" in live), "nada da conta vai para a tela");

  usar(semATabela(bancoDaSimulacao({ tables: escolaAoVivo() })));
  const semTabela = ok(await actions.loadSessionSimulations({ webinarId: WEBINAR }));
  assert.equal(semTabela.simulations[0].audience.pendingMigration, true, "sem a tabela, o controle sem os botoes");
});

test("o resumo do fim (o tick) junta os trechos de cada regra: o maior numero que a turma viu", async () => {
  const startedAt = Date.now() - 50 * MIN;
  const tabelas = escolaAoVivo({
    ended_at: new Date(startedAt + 30 * MIN).toISOString(),
    simulated_count_rule: { base: 0, jitter: 0, mode: "fixed", peak: 0 },
    simulation_ack_text: "Decisão do produtor em 11/11/2026: …",
    simulation_decided_at: new Date(startedAt).toISOString(),
    simulation_decided_by: PRODUTORA,
    started_at: new Date(startedAt).toISOString(),
    status: "ended"
  });
  tabelas.webinar_simulation_changes = [
    { ack_text: "a", at_offset_ms: 5 * MIN, changed_by: PRODUTORA, count_rule: { base: 300, jitter: 0, mode: "fixed", peak: 300 }, created_at: new Date(startedAt + 5 * MIN).toISOString(), id: "m1", session_id: LIVE_SESSION, source: "console" },
    { ack_text: "b", at_offset_ms: 10 * MIN, changed_by: PRODUTORA, count_rule: { base: 1000, jitter: 0, mode: "fixed", peak: 1000 }, created_at: new Date(startedAt + 10 * MIN).toISOString(), id: "m2", session_id: LIVE_SESSION, source: "console" },
    { ack_text: "c", at_offset_ms: 10 * MIN + 30_000, changed_by: PRODUTORA, count_rule: null, created_at: new Date(startedAt + 10 * MIN + 30_000).toISOString(), id: "m3", session_id: LIVE_SESSION, source: "console" }
  ];
  const db = usar(bancoDaSimulacao({ tables: tabelas }));
  const original = console.info;
  console.info = () => undefined;
  try {
    await tick.runSimulationSummariesTick({ db });
  } finally {
    console.info = original;
  }
  const resumo = linha(db, LIVE_SESSION).simulation_summary;
  // +300 inteiro (de 5 a 10 min); o +1000 durou 30 s de rampa (ate o ponto de 10:30, saindo de 300) e desceu.
  const esperado = model.simulationTotals(
    { countChanges: [{ atMs: 5 * MIN, rule: { base: 300, jitter: 0, mode: "fixed", peak: 300 } }, { atMs: 10 * MIN, rule: { base: 1000, jitter: 0, mode: "fixed", peak: 1000 } }, { atMs: 10 * MIN + 30_000, rule: { base: 0, jitter: 0, mode: "off", peak: 0 } }], countRule: { base: 0, jitter: 0, mode: "fixed", peak: 0 }, joins: { enabled: false, everySeconds: 60, max: 30, names: "generic" }, saleNotices: { enabled: false, items: [] }, seed: 7 },
    { endMs: 30 * MIN, videoMs: 60 * MIN },
    true
  ).counterMax;
  assert.equal(resumo.counter_max, esperado);
  assert.ok(resumo.counter_max > 300 && resumo.counter_max < 1000, `o trecho curto conta so o que a turma viu (${resumo.counter_max})`);
});

/** O teto do PostgREST (max_rows = 1000 em supabase/config.toml) nas leituras das mudancas: a resposta corta, sem erro. */
function comTetoDoPostgrest(db) {
  const from = db.from.bind(db);
  db.from = (name) => {
    const chain = from(name);
    if (name === "webinar_simulation_changes") {
      const then = chain.then;
      chain.then = (resolve, reject) => then((result) => resolve(Array.isArray(result.data) ? { ...result, data: result.data.slice(0, 1000) } : result), reject);
    }
    return chain;
  };
  return db;
}

test("revisao v8, achado 8: as mudancas de varias sessoes passam das 1.000 linhas do PostgREST e vem todas, na ordem; a sessao das mais novas nao perde as dela (o tick e o card leem assim)", async () => {
  const tabelas = escolaAoVivo();
  // Seis sessoes com o teto de 200 mudancas cada: 1.200 linhas; as 200 mais novas sao da ultima sessao.
  const sessoes = Array.from({ length: 6 }, (_, index) => `eeeeeeee-3333-4000-8000-${String(index).padStart(12, "0")}`);
  const inicio = Date.now() - 6 * 3_600_000;
  tabelas.webinar_simulation_changes = sessoes.flatMap((sessionId, sessao) =>
    Array.from({ length: SIMULATION_LIMITS.countChangesMax }, (_, index) => ({
      ack_text: "x",
      at_offset_ms: index * 1000,
      changed_by: PRODUTORA,
      count_rule: { base: sessao * 1000 + index, jitter: 0, mode: "fixed", peak: sessao * 1000 + index },
      created_at: new Date(inicio + (sessao * SIMULATION_LIMITS.countChangesMax + index) * 1000).toISOString(),
      id: `m-${sessao}-${String(index).padStart(3, "0")}`,
      session_id: sessionId,
      source: "console"
    }))
  );
  const db = comTetoDoPostgrest(bancoDaSimulacao({ tables: tabelas }));
  const todas = await store.listSimulationChanges(db, sessoes);
  assert.equal(todas.length, 6 * SIMULATION_LIMITS.countChangesMax, "todas, alem das 1.000 primeiras");
  assert.ok(todas.every((record, index) => index === 0 || Date.parse(todas[index - 1].changedAt) <= Date.parse(record.changedAt)), "da mais antiga para a mais nova");
  assert.equal(new Set(todas.map((record) => record.id)).size, todas.length, "nenhuma repetida entre as paginas");
  const daUltima = store.withCountChanges({ sessionId: sessoes[5] }, todas).countChanges;
  assert.equal(daUltima.length, SIMULATION_LIMITS.countChangesMax);
  assert.deepEqual(daUltima.at(-1).rule, { base: 5199, jitter: 0, mode: "fixed", peak: 5199 }, "a mudanca que vale agora na ultima sessao");
});

/* "Variar sozinho" (rodada v9, pedido do produtor de 12/11/2026; docs/30 D90). */

const VARIA = { direction: "both", everyMaxSeconds: 60, everyMinSeconds: 20, percent: 5 };
const VARIA_NA_LINHA = { direction: "both", every_max_seconds: 60, every_min_seconds: 20, percent: 5 };

test("Variar sozinho no ar: a mudanca grava a variacao na regra e na frase; o mesmo numero com a mesma variacao recusa; mudar ou desligar a variacao aplica; o +0 ignora", async () => {
  const db = usar(bancoDaSimulacao({ tables: escolaAoVivo() }));

  const salvo = ok(await actions.saveSimulatedAudience({ extra: 300, sessionId: LIVE_SESSION, vary: VARIA }));
  const [mudanca] = mudancas(db);
  assert.deepEqual(mudanca.count_rule, { base: 300, jitter: 0, mode: "fixed", peak: 300, vary: VARIA_NA_LINHA });
  assert.equal(mudanca.ack_text, `${frase(300)} Varia sozinho até 5%, para mais e para menos, a cada 20 a 60 s.`, "a variacao entra no registro (D80)");
  assert.deepEqual(salvo.audience.current, { base: 300, jitter: 0, mode: "fixed", peak: 300, vary: VARIA });
  assert.deepEqual(salvo.audience.changes[0].vary, VARIA);
  const auditoria = db.tables.admin_audit_log.find((row) => row.action === "webinar.simulation_audience_changed");
  assert.deepEqual([auditoria.metadata.vary_percent, auditoria.metadata.vary_direction, auditoria.metadata.vary_every_min_seconds, auditoria.metadata.vary_every_max_seconds], [5, "both", 20, 60]);

  // A janela da sala depois da rampa: o numero dentro da faixa do exemplo, mudando sozinho.
  const simulation = await store.fetchSessionSimulation(db, LIVE_SESSION);
  const depois = mudanca.at_offset_ms + SIMULATION_LIMITS.countRampSeconds * 1000 + 15_000;
  const vistos = new Set();
  for (let offset = depois; offset < depois + 20 * MIN; offset += 5_000) {
    const numero = model.simulationCounterNow({ durationMs: 60 * MIN, endMs: Number.POSITIVE_INFINITY, kind: "live", offsetMs: offset, simulation, status: "live" });
    assert.ok(numero >= 285 && numero <= 315, `${offset}: ${numero}`);
    vistos.add(numero);
  }
  assert.ok(vistos.size >= 5, "o numero muda sozinho");

  // O mesmo numero com a mesma variacao: nada mudaria.
  const igual = await actions.saveSimulatedAudience({ extra: 300, sessionId: LIVE_SESSION, vary: { ...VARIA } });
  assert.deepEqual([igual.status, igual.fieldErrors?.extra?.[0]], [400, WEBINAR_COPY.simulacao.plateia.variar.igual]);
  assert.equal(mudancas(db).length, 1);

  // O mesmo numero com outra variacao aplica; sem a variacao (desligar) tambem.
  ok(await actions.saveSimulatedAudience({ extra: 300, sessionId: LIVE_SESSION, vary: { ...VARIA, direction: "up", percent: 10 } }));
  assert.deepEqual(mudancas(db).at(-1).count_rule.vary, { ...VARIA_NA_LINHA, direction: "up", percent: 10 });
  const desligada = ok(await actions.saveSimulatedAudience({ extra: 300, sessionId: LIVE_SESSION }));
  assert.deepEqual(mudancas(db).at(-1).count_rule, { base: 300, jitter: 0, mode: "fixed", peak: 300 }, "sem a chave, o numero parado");
  assert.equal(desligada.audience.current.vary, undefined);
  assert.equal(mudancas(db).at(-1).ack_text, frase(300));
  const parado = await actions.saveSimulatedAudience({ extra: 300, sessionId: LIVE_SESSION, vary: null });
  assert.deepEqual([parado.status, parado.fieldErrors?.extra?.[0]], [400, SERVIDOR.plateiaIgual]);

  // Com o +0 (o Tirar) a variacao e ignorada.
  ok(await actions.saveSimulatedAudience({ extra: 0, sessionId: LIVE_SESSION, vary: VARIA }));
  assert.equal(mudancas(db).at(-1).count_rule, null);

  // Fora dos limites: 400 no campo, nada gravado.
  const total = mudancas(db).length;
  const invalida = await actions.saveSimulatedAudience({ extra: 300, sessionId: LIVE_SESSION, vary: { ...VARIA, percent: 80 } });
  assert.equal(invalida.status, 400);
  assert.equal(mudancas(db).length, total);
});

test("Variar sozinho antes do comeco: a regra da sessao leva a variacao e vale na hora; o resumo do fim (o tick) conta o pico da variacao", async () => {
  const db = usar(bancoDaSimulacao({ tables: escolaAoVivo({ scheduled_at: new Date(Date.now() - 5 * MIN).toISOString(), started_at: null, status: "waiting" }) }));
  ok(await actions.saveSimulatedAudience({ extra: 200, sessionId: LIVE_SESSION, source: "editor", vary: { ...VARIA, direction: "up", percent: 10 } }));
  assert.deepEqual(linha(db, LIVE_SESSION).simulated_count_rule, { base: 200, jitter: 0, mode: "fixed", peak: 200, vary: { ...VARIA_NA_LINHA, direction: "up", percent: 10 } });
  assert.equal(mudancas(db)[0].at_offset_ms, null);

  // A sessao encerrada 30 min depois: o resumo e o maior numero que a turma viu, acima do fixo e dentro da faixa.
  const startedAt = Date.now() - 50 * MIN;
  const tabelas = escolaAoVivo({
    ended_at: new Date(startedAt + 30 * MIN).toISOString(),
    simulated_count_rule: { base: 200, jitter: 0, mode: "fixed", peak: 200, vary: { ...VARIA_NA_LINHA, direction: "up", percent: 10 } },
    simulation_ack_text: "Decisão do produtor em 12/11/2026: …",
    simulation_decided_at: new Date(startedAt).toISOString(),
    simulation_decided_by: PRODUTORA,
    started_at: new Date(startedAt).toISOString(),
    status: "ended"
  });
  const encerrada = usar(bancoDaSimulacao({ tables: tabelas }));
  const original = console.info;
  console.info = () => undefined;
  try {
    await tick.runSimulationSummariesTick({ db: encerrada });
  } finally {
    console.info = original;
  }
  const resumo = linha(encerrada, LIVE_SESSION).simulation_summary;
  assert.ok(resumo.counter_max > 200 && resumo.counter_max <= 220, `o pico da variacao entra no resumo honesto (${resumo.counter_max})`);
});

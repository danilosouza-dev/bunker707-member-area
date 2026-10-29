import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import {
  ENDED_SESSION,
  LIVE_SESSION,
  MIN,
  REPLAY,
  SESSION,
  WEBINAR,
  bancoDaSimulacao,
  escolaDaSimulacao,
  semAsColunasDaSimulacao
} from "./support/webinarios-v4-simulacao-banco.mjs";

// As Server Actions do card Simulacao (docs/30 §2.2, §2.6, §4.3, §5.2 e §8.6; D10; docs/18 §2.2), sem banco: o banco
// da Simulacao em memoria, a permissao por um duble (sem messaging.publish recusa o salvar com 403 e deixa ler), o nome
// de quem decide pelo duble da sessao e "next/cache" so anotando. Aqui: ler as regras sem a semente (e o aviso da
// 202610300003); salvar exige a caixa e a frase de hoje com o nome de quem decide (com algo simulado ligado), grava as
// colunas de §4.3, quem e quando; tudo desligado salva sem caixa com a frase de tudo desligado; a live, o replay, a
// encerrada e a que nao existe recusam; a auditoria leva so numeros e booleanos (dos avisos, so a contagem).

const estado = (globalThis.__simulacaoAcoes ??= { revalidados: [], semPublicar: false });
const PRODUTORA = "00000000-0000-4000-8000-0000000000f1";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/server/auth/permissions") {
      const source = `
        export async function requireRole(action) {
          if (globalThis.__simulacaoAcoes.semPublicar && action === "messaging.publish") {
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
        export function revalidatePath(path) { globalThis.__simulacaoAcoes.revalidados.push(path); }
        export function revalidateTag(tag) { globalThis.__simulacaoAcoes.revalidados.push(tag); }
        export function updateTag(tag) { globalThis.__simulacaoAcoes.revalidados.push(tag); }
        export function unstable_cache(fn) { return fn; }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    return nextResolve(specifier, context);
  }
});

actionStubs.role = { role: "owner", user: { email: "produtora@bunker707.test", id: PRODUTORA, user_metadata: { full_name: "Produtora de Teste" } } };

const actions = await import("../src/server/webinars/simulation-actions.ts");
const model = await import("../src/server/webinars/simulation-model.ts");
const { SIMULATION_MESSAGES } = await import("../src/server/webinars/simulation-schemas.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

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
const linha = (db, id = SESSION) => db.tables.webinar_sessions.find((row) => row.id === id);
const auditorias = (db) => db.tables.admin_audit_log.filter((row) => row.action === "webinar.simulation_saved");

// A sessao gravada que ainda nao comecou (daqui a 1 h): a unica em que a Simulacao muda.
const AGENDADA = { minutosNoAr: -60, sessao: { status: "scheduled" } };
const contador = { base: 50, jitter: 10, mode: "curve", peak: 300 };
const entradas = { enabled: true, everySeconds: 45, max: 20, names: "generic" };
const avisos = { enabled: true, items: [{ offsetMs: 15 * MIN, text: "Carlos acabou de garantir a vaga na Formação" }] };
const regrasLigadas = { countRule: contador, joins: entradas, saleNotices: avisos, showLiveBadge: true };
const fraseDeHoje = (rules = regrasLigadas, responsible = "Produtora de Teste") => model.simulationAckFor({ nowMs: Date.now(), responsible, rules: model.normalizeSimulationRules(rules) });

test("ler: as regras das sessoes gravadas do webinario sem a semente; banco sem a 202610300003 devolve o aviso da migracao; quem so escreve tambem le", async () => {
  const tables = escolaDaSimulacao({ sessao: { simulated_count_rule: { base: 30, jitter: 0, mode: "fixed", peak: 30 }, simulation_summary: null } });
  usar(bancoDaSimulacao({ tables }));
  estado.semPublicar = true;
  const data = ok(await actions.loadSessionSimulations({ webinarId: WEBINAR }));
  assert.equal(data.pendingMigration, false);
  assert.deepEqual(data.simulations.map((item) => item.sessionId).sort(), [ENDED_SESSION, SESSION].sort(), "so as sessoes gravadas (nem a live nem o replay)");
  const minha = data.simulations.find((item) => item.sessionId === SESSION);
  assert.deepEqual(minha.countRule, { base: 30, jitter: 0, mode: "fixed", peak: 30 });
  assert.ok(!("seed" in minha), "a semente fica no servidor");
  assert.doesNotMatch(JSON.stringify(data), /424242/);

  usar(semAsColunasDaSimulacao({ tables: escolaDaSimulacao() }));
  assert.deepEqual(ok(await actions.loadSessionSimulations({ webinarId: WEBINAR })), { migration: "202610300003", pendingMigration: true });
  assert.equal((await actions.loadSessionSimulations({ webinarId: "nao-e-id" })).status, 400);
});

test("salvar: 403 sem messaging.publish; com algo simulado, a caixa e a frase de hoje com o nome de quem decide sao obrigatorias", async () => {
  const db = usar(bancoDaSimulacao({ tables: escolaDaSimulacao(AGENDADA) }));
  estado.semPublicar = true;
  const negado = await actions.saveSessionSimulation({ ...regrasLigadas, ackText: fraseDeHoje(), acknowledged: true, sessionId: SESSION });
  assert.equal(negado.status, 403);
  assert.equal(linha(db).simulated_count_rule, null);
  estado.semPublicar = false;

  const semCaixa = await actions.saveSessionSimulation({ ...regrasLigadas, sessionId: SESSION });
  assert.deepEqual([semCaixa.status, semCaixa.fieldErrors?.acknowledged?.[0]], [400, SIMULATION_MESSAGES.ack]);
  for (const so of [{ showLiveBadge: true }, { countRule: { base: 5, jitter: 0, mode: "fixed", peak: 5 } }, { joins: entradas }, { saleNotices: avisos }]) {
    const resultado = await actions.saveSessionSimulation({ ...so, sessionId: SESSION });
    assert.equal(resultado.status, 400, `${Object.keys(so)[0]} sozinho pede a caixa`);
  }

  const outroNome = await actions.saveSessionSimulation({ ...regrasLigadas, ackText: fraseDeHoje(regrasLigadas, "Outra Pessoa"), acknowledged: true, sessionId: SESSION });
  assert.deepEqual([outroNome.status, outroNome.fieldErrors?.acknowledged?.[0]], [400, WEBINAR_COPY.simulacao.servidor.fraseNaoBate]);
  const outrosNumeros = await actions.saveSessionSimulation({ ...regrasLigadas, ackText: fraseDeHoje({ ...regrasLigadas, saleNotices: { enabled: false, items: [] } }), acknowledged: true, sessionId: SESSION });
  assert.equal(outrosNumeros.status, 400, "a frase diz que os avisos nao aparecem, mas eles estao ligados");
  assert.equal(linha(db).simulated_count_rule, null, "nada gravado");
  assert.equal(auditorias(db).length, 0);
});

test("salvar: grava o selo, as colunas de §4.3, a frase marcada, quem e quando; devolve a sessao e as regras sem a semente; a auditoria leva os valores", async () => {
  const db = usar(bancoDaSimulacao({ tables: escolaDaSimulacao(AGENDADA) }));
  const antes = Date.now();
  const frase = fraseDeHoje();
  const salvo = ok(await actions.saveSessionSimulation({ ...regrasLigadas, ackText: `  ${frase} `, acknowledged: true, sessionId: SESSION }));

  const row = linha(db);
  assert.deepEqual(row.simulated_count_rule, { base: 50, jitter: 10, mode: "curve", peak: 300 });
  assert.deepEqual(row.simulated_joins, { enabled: true, every_seconds: 45, max: 20, names: "generic" });
  assert.deepEqual(row.simulated_sale_notices, { enabled: true, items: [{ offset_ms: 15 * MIN, text: "Carlos acabou de garantir a vaga na Formação" }] });
  assert.equal(row.show_live_badge, true);
  assert.equal(row.simulation_ack_text, frase);
  assert.equal(row.simulation_decided_by, PRODUTORA);
  assert.ok(Date.parse(row.simulation_decided_at) >= antes - 1000 && Date.parse(row.simulation_decided_at) <= Date.now() + 1000, "agora, no servidor");
  assert.equal(row.simulation_seed, 424242, "a semente nao muda");

  assert.equal(salvo.deciderName, "Produtora de Teste");
  assert.equal(salvo.session.showLiveBadge, true);
  assert.equal(salvo.session.simulationAckText, frase);
  assert.deepEqual(salvo.simulation.countRule, contador);
  assert.ok(!("seed" in salvo.simulation));
  assert.ok(estado.revalidados.includes(`/admin/comunicacao/webinarios/${WEBINAR}`));

  const [auditoria] = auditorias(db);
  assert.equal(auditoria.actor_id, PRODUTORA);
  assert.equal(auditoria.entity_id, WEBINAR);
  assert.deepEqual(auditoria.metadata, {
    acknowledged: true,
    count_base: 50,
    count_jitter: 10,
    count_mode: "curve",
    count_peak: 300,
    decided_by: PRODUTORA,
    joins_enabled: true,
    joins_every_seconds: 45,
    joins_max: 20,
    numbers_simulated: true,
    sale_notices: 1,
    sale_notices_enabled: true,
    session_id: SESSION,
    show_live_badge: true
  });
  assert.doesNotMatch(JSON.stringify(auditoria), /Carlos|Formação|Decisão/, "nem o texto dos avisos nem a frase na auditoria");
});

test("salvar tudo desligado: sem caixa, grava nulo nas regras e a frase de tudo desligado; avisos ligados sem nenhum item contam como desligados", async () => {
  const db = usar(bancoDaSimulacao({ tables: escolaDaSimulacao({ minutosNoAr: -60, sessao: { status: "scheduled", show_live_badge: true, simulated_count_rule: { base: 9, jitter: 0, mode: "fixed", peak: 9 }, simulated_joins: { enabled: true, every_seconds: 30, max: 5, names: "generic" } } }) }));
  const salvo = ok(await actions.saveSessionSimulation({ saleNotices: { enabled: true, items: [] }, sessionId: SESSION }));
  const row = linha(db);
  assert.deepEqual([row.simulated_count_rule, row.simulated_joins, row.simulated_sale_notices, row.show_live_badge], [null, null, null, false]);
  assert.match(row.simulation_ack_text, /fica desligado, os números de plateia são reais e os avisos de venda não aparecem\. .*Responsável: Produtora de Teste\.$/);
  assert.equal(salvo.simulation.saleNotices.enabled, false);
  assert.equal(auditorias(db)[0].metadata.acknowledged, false);
  assert.equal(auditorias(db)[0].metadata.numbers_simulated, false);
});

test("salvar recusa: a live e o replay (409, so a sessao gravada), a encerrada (409), a que nao existe (404) e o banco sem a 202610300003 (409 com a frase)", async () => {
  const db = usar(bancoDaSimulacao({ tables: escolaDaSimulacao(AGENDADA) }));
  const pedido = (sessionId) => actions.saveSessionSimulation({ ...regrasLigadas, ackText: fraseDeHoje(), acknowledged: true, sessionId });

  const live = await pedido(LIVE_SESSION);
  assert.deepEqual([live.status, live.error], [409, WEBINAR_COPY.simulacao.card.soLiveGravada], "a sala ao vivo nunca simula");
  assert.equal(linha(db, LIVE_SESSION).simulated_count_rule, null);
  assert.equal((await pedido(REPLAY)).status, 409, "o Replay livre nunca simula");
  const encerrada = await pedido(ENDED_SESSION);
  assert.deepEqual([encerrada.status, encerrada.error], [409, WEBINAR_COPY.simulacao.servidor.encerrada]);
  assert.equal((await pedido("eeeeeeee-0000-4000-8000-00000000ffff")).status, 404);
  assert.equal(auditorias(db).length, 0);

  usar(semAsColunasDaSimulacao({ tables: escolaDaSimulacao(AGENDADA) }));
  const pendente = await pedido(SESSION);
  assert.deepEqual([pendente.status, pendente.error], [409, WEBINAR_COPY.simulacao.servidor.precisaMigracao("202610300003")]);
});

test("salvar recusa a troca de regra com a sessao ja comecada (no ar, ou com a hora marcada passada e o status atrasado): 409 e nada gravado", async () => {
  const pedido = (sessionId) => actions.saveSessionSimulation({ ...regrasLigadas, ackText: fraseDeHoje(), acknowledged: true, sessionId });
  const decisaoDeAntes = { simulated_count_rule: { base: 30, jitter: 0, mode: "fixed", peak: 30 }, simulation_ack_text: "a decisao do comeco", simulation_decided_at: new Date(Date.now() - 2 * 3_600_000).toISOString() };

  // O tick ainda nao abriu a sessao (status agendada), mas o zero do video ja passou ha 10 min.
  const atrasada = usar(bancoDaSimulacao({ tables: escolaDaSimulacao({ minutosNoAr: 10, sessao: { ...decisaoDeAntes, status: "scheduled" } }) }));
  const recusada = await pedido(SESSION);
  assert.deepEqual([recusada.status, recusada.error], [409, WEBINAR_COPY.simulacao.servidor.comecou]);
  assert.deepEqual(linha(atrasada).simulated_count_rule, decisaoDeAntes.simulated_count_rule, "a regra que valia fica");
  assert.equal(linha(atrasada).simulation_ack_text, "a decisao do comeco", "e a decisao tambem");
  assert.equal(auditorias(atrasada).length, 0);

  // No ar: tambem recusa (desligar tudo no meio tiraria o resumo do que a turma ja viu).
  const noAr = usar(bancoDaSimulacao({ tables: escolaDaSimulacao({ minutosNoAr: 30, sessao: { ...decisaoDeAntes, started_at: new Date(Date.now() - 30 * 60_000).toISOString(), status: "live" } }) }));
  const desligar = await actions.saveSessionSimulation({ sessionId: SESSION });
  assert.deepEqual([desligar.status, desligar.error], [409, WEBINAR_COPY.simulacao.servidor.comecou]);
  assert.deepEqual(linha(noAr).simulated_count_rule, decisaoDeAntes.simulated_count_rule);

  // O modelo: agendada no futuro ainda muda; a hora marcada passada nao.
  const agora = Date.parse("2026-11-05T23:00:00.000Z");
  assert.equal(model.simulationSessionStarted({ scheduledAt: "2026-11-05T23:01:00.000Z", status: "scheduled" }, agora), false);
  assert.equal(model.simulationSessionStarted({ scheduledAt: "2026-11-05T23:00:00+00:00", status: "scheduled" }, agora), true, "compara instantes");
  assert.equal(model.simulationSessionStarted({ scheduledAt: "2026-11-05T23:30:00.000Z", status: "live" }, agora), true);
});
